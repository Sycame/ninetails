// Package auth identifies the caller and decides what they may do. Identity comes from GitLab
// (the same GitLab Application the Angular app signs in with); the service never sees a password.
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	// ErrUnauthenticated => 401: no/invalid/expired token.
	ErrUnauthenticated = errors.New("missing or invalid access token")
	// ErrForbidden => 403: valid user who is not allowed to use the service.
	ErrForbidden = errors.New("your GitLab account is not allowed to use this service")
)

type User struct {
	ID       string
	Username string
	Name     string
}

// Authenticator turns a request into a User.
type Authenticator interface {
	Authenticate(r *http.Request) (*User, error)
}

// Policy maps GitLab group memberships to access. It mirrors `authz` in the app's environment.ts.
type Policy struct {
	AllowedGroups []string // empty = any GitLab user may sign in
}

// Authorize decides whether a user may use the service: they must be in one of AllowedGroups (any
// GitLab user when it is empty). That is the only access rule: there are no roles, and a user's team
// cannot be verified, so it plays no part either. Everyone let in can do everything.
func (p Policy) Authorize(groups []string) bool {
	if len(p.AllowedGroups) == 0 {
		return true
	}
	for _, w := range p.AllowedGroups {
		for _, g := range groups {
			if g == w {
				return true
			}
		}
	}
	return false
}

// ---- context helpers ----------------------------------------------------------------------

type ctxKey struct{}

func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func FromContext(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

// ---- development: everybody is the same user ----------------------------------------------

// Dev lets every request through as a fixed user. NEVER use outside local development.
type Dev struct{ User User }

func NewDev() Dev {
	return Dev{User: User{ID: "dev", Username: "dev", Name: "Dev User"}}
}

func (d Dev) Authenticate(*http.Request) (*User, error) {
	u := d.User
	return &u, nil
}

// ---- GitLab: validate the bearer token against GitLab's OpenID userinfo endpoint -----------

// GitLab asks GitLab "who owns this token?" (GET /oauth/userinfo) and applies the Policy to the
// user's group claim. Results are cached briefly so a burst of requests costs one call.
type GitLab struct {
	BaseURL string
	Policy  Policy
	Client  *http.Client
	TTL     time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	user    *User
	expires time.Time
}

func NewGitLab(baseURL string, policy Policy) *GitLab {
	return &GitLab{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Policy:  policy,
		Client:  &http.Client{Timeout: 10 * time.Second},
		TTL:     60 * time.Second,
		cache:   map[string]cached{},
	}
}

func (g *GitLab) Authenticate(r *http.Request) (*User, error) {
	token, ok := BearerToken(r)
	if !ok {
		return nil, ErrUnauthenticated
	}
	key := sha256Hex(token) // never keep the raw token as a map key

	g.mu.Lock()
	if c, hit := g.cache[key]; hit && time.Now().Before(c.expires) {
		g.mu.Unlock()
		return c.user, nil
	}
	g.mu.Unlock()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, g.BaseURL+"/oauth/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := g.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitlab unreachable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthenticated
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitlab userinfo returned %d", res.StatusCode)
	}

	var info struct {
		Sub      string   `json:"sub"`
		Name     string   `json:"name"`
		Nickname string   `json:"nickname"`
		Groups   []string `json:"groups"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("gitlab userinfo: %w", err)
	}
	if !g.Policy.Authorize(info.Groups) {
		return nil, ErrForbidden
	}
	u := &User{ID: info.Sub, Username: info.Nickname, Name: info.Name}

	g.mu.Lock()
	if len(g.cache) > 1000 { // crude bound; entries expire anyway
		g.cache = map[string]cached{}
	}
	g.cache[key] = cached{user: u, expires: time.Now().Add(g.TTL)}
	g.mu.Unlock()
	return u, nil
}

// BearerToken extracts the token from "Authorization: Bearer <token>".
func BearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if len(h) <= len(p) || !strings.EqualFold(h[:len(p)], p) {
		return "", false
	}
	return strings.TrimSpace(h[len(p):]), true
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

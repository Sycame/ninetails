// Package api is the HTTP layer: routing, auth, JSON and the SSE stream. It implements the contract
// in the Angular app's docs/api.md. Business rules are kept small and visible in the handlers.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"ninetails-api/internal/auth"
	"ninetails-api/internal/docs"
	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
	"ninetails-api/internal/store"
)

// PipelineStarter kicks off the pipeline for a queued deployment (GitLab in production, sim today).
type PipelineStarter interface {
	Start(ctx context.Context, d model.Deployment)
}

type Server struct {
	Config    *store.ConfigStore
	Status    *store.StatusStore
	Deploys   *store.DeployStore
	Hub       *events.Hub
	Auth      auth.Authenticator
	Pipelines PipelineStarter

	Log          *slog.Logger
	BaseContext  context.Context // cancelled on shutdown: ends SSE streams and background pipelines
	PingEvery    time.Duration   // SSE heartbeat; the app reconnects after 45 s of silence
	CORSOrigin   string
	LockedEnvs   []string // environment names that refuse deployments
	PipelinesURL string   // GitLab pipelines URL used for deployment links

	DevTools bool       // register the /api/v1/dev endpoints (development only)
	Sim      SimControl // nil when the simulators are off
}

const apiPrefix = "/api/v1"

// Handler returns the full HTTP handler: /healthz plus the authenticated /api/v1 routes.
func (s *Server) Handler() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET "+apiPrefix+"/config", s.getConfig)
	api.HandleFunc("GET "+apiPrefix+"/config/version", s.getConfigVersion)
	api.HandleFunc("GET "+apiPrefix+"/status", s.getStatus)
	api.HandleFunc("GET "+apiPrefix+"/deployments", s.listDeployments)
	api.HandleFunc("POST "+apiPrefix+"/environments/{envId}/deployments", s.createDeployment)
	api.HandleFunc("GET "+apiPrefix+"/events", s.streamEvents)

	if s.DevTools {
		s.registerDev(api)
	}

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", s.healthz)
	root.Handle(apiPrefix+"/", s.authenticate(api))
	docs.Register(root) // /openapi.json and the Swagger UI at /docs, no login needed

	// outermost first: recover > log > cors
	return s.recoverPanics(s.logRequests(s.cors(root)))
}

// ---- read endpoints ----------------------------------------------------------------------

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "configVersion": s.Config.Version().Version, "eventClients": s.Hub.Subscribers(),
	})
}

// GET /config - the whole baseline. The version doubles as the ETag so unchanged polls cost a 304.
func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	b, raw := s.Config.Current()
	etag := `"` + b.Version + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

func (s *Server) getConfigVersion(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, s.Config.Version())
}

func (s *Server) getStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.Status.Snapshot())
}

func (s *Server) listDeployments(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "bad_request", "limit must be a number between 1 and 500.")
			return
		}
		limit = n
	}
	writeJSON(w, http.StatusOK, s.Deploys.List(limit))
}

// ---- deploy ------------------------------------------------------------------------------

// POST /environments/{envId}/deployments - accepts and queues; progress arrives as events.
func (s *Server) createDeployment(w http.ResponseWriter, r *http.Request) {
	user := auth.FromContext(r.Context())
	env, ok := s.Config.Environment(r.PathValue("envId"))
	if !ok {
		writeError(w, http.StatusNotFound, "env_not_found", "Environment not found.")
		return
	}

	// Any signed-in user may deploy to any environment. Teams are display labels only: a user's team
	// cannot be verified, so who may deploy where is managed by people, not enforced here.
	if slices.Contains(s.LockedEnvs, env.Name) {
		writeError(w, http.StatusConflict, "env_locked", "Environment is locked.")
		return
	}
	if s.Deploys.ActiveFor(env.ID) {
		writeError(w, http.StatusConflict, "deploy_in_progress", "A deployment to this environment is already running.")
		return
	}

	d := s.Deploys.Create(env, user.Username, s.PipelinesURL)
	s.Log.Info("deployment queued", "id", d.ID, "env", env.Name, "user", user.Username)
	if s.Pipelines != nil {
		s.Pipelines.Start(s.BaseContext, d)
	}
	w.Header().Set("Location", fmt.Sprintf("%s/deployments", apiPrefix))
	writeJSON(w, http.StatusAccepted, d)
}

// ---- events (Server-Sent Events) -----------------------------------------------------------

func (s *Server) streamEvents(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	// The server has a write timeout for normal responses; a stream must outlive it.
	_ = rc.SetWriteDeadline(time.Time{})

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // tell nginx not to buffer the stream
	w.WriteHeader(http.StatusOK)
	if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil || rc.Flush() != nil {
		return
	}

	ch := s.Hub.Subscribe()
	defer s.Hub.Unsubscribe(ch)
	ping := time.NewTicker(s.PingEvery)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done(): // client went away
			return
		case <-s.BaseContext.Done(): // service shutting down
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
		case e, open := <-ch:
			if !open { // dropped as a slow consumer: end the stream, the app reconnects and resyncs
				return
			}
			data, err := json.Marshal(e.Data)
			if err != nil {
				s.Log.Error("event not serialisable", "type", e.Type, "err", err)
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Type, data); err != nil {
				return
			}
		}
		if rc.Flush() != nil {
			return
		}
	}
}

// ---- helpers -----------------------------------------------------------------------------

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// writeError sends the error envelope the app expects: { "error": { "code", "message" } }.
func writeError(w http.ResponseWriter, status int, code, message string) {
	var b errorBody
	b.Error.Code, b.Error.Message = code, message
	writeJSON(w, status, b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// authFailure maps auth errors to HTTP responses.
func authFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		w.Header().Set("WWW-Authenticate", `Bearer realm="ninetails"`)
		writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in again.")
	case errors.Is(err, auth.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", err.Error())
	default:
		writeError(w, http.StatusBadGateway, "auth_unavailable", "Could not verify your sign-in right now.")
	}
}

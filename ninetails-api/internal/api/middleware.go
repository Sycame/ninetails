package api

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"runtime/debug"
	"time"

	"ninetails-api/internal/auth"
)

// authenticate resolves the caller; every /api/v1 route runs behind it.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { // CORS preflight carries no credentials
			next.ServeHTTP(w, r)
			return
		}
		u, err := s.Auth.Authenticate(r)
		if err != nil {
			if !errors.Is(err, auth.ErrUnauthenticated) && !errors.Is(err, auth.ErrForbidden) {
				s.Log.Error("authentication failed", "err", err)
			}
			authFailure(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
	})
}

// cors is only needed when the browser app is served from a different origin than the API.
// The recommended setup (reverse proxy or `ng serve --proxy-config`) keeps one origin and needs none.
func (s *Server) cors(next http.Handler) http.Handler {
	if s.CORSOrigin == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", s.CORSOrigin)
		h.Set("Vary", "Origin")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
		h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		h.Set("Access-Control-Expose-Headers", "ETag")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.Log.Error("panic", "path", r.URL.Path, "panic", v, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/healthz" {
			return
		}
		s.Log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"ms", time.Since(start).Milliseconds())
	})
}

// statusRecorder remembers the status code. It forwards Flush/Hijack/Unwrap so SSE keeps working.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	return h.Hijack()
}

// Unwrap lets http.ResponseController reach the real writer (flush, write deadline).
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

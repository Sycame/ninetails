// Command ninetails-api is the REST backend for the Ninetails dashboard.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ninetails-api/data"
	"ninetails-api/internal/api"
	"ninetails-api/internal/auth"
	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
	"ninetails-api/internal/settings"
	"ninetails-api/internal/sim"
	"ninetails-api/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := settings.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg.LogLevel)

	// Cancelled on Ctrl+C / SIGTERM: stops background work and ends open event streams.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := events.NewHub()

	// ---- baseline configuration: from a watched file if given, else the embedded mock ----
	configs := store.NewConfigStore(hub, log)
	raw := data.Config
	if cfg.ConfigFile != "" {
		if raw, err = os.ReadFile(cfg.ConfigFile); err != nil {
			return err
		}
	}
	baseline, err := store.ParseBaseline(raw)
	if err != nil {
		return err
	}
	if err := configs.Publish(baseline); err != nil {
		return err
	}
	if cfg.ConfigFile != "" {
		go configs.WatchFile(ctx, cfg.ConfigFile, 2*time.Second)
		log.Info("watching baseline file", "path", cfg.ConfigFile)
	}

	// ---- live status + deployments (mock data) ----
	var snapshot model.StatusSnapshot
	if err := json.Unmarshal(store.StripBOM(data.Status), &snapshot); err != nil {
		return err
	}
	var history []model.Deployment
	if err := json.Unmarshal(store.StripBOM(data.Deployments), &history); err != nil {
		return err
	}
	statuses := store.NewStatusStore(snapshot, hub)
	deploys := store.NewDeployStore(history, hub)

	var pipelines api.PipelineStarter
	var simControl api.SimControl
	if cfg.Simulate {
		ctl := &sim.Control{}
		simControl = ctl
		go sim.Status{Status: statuses, Config: configs, Every: cfg.SimulateEvery, Control: ctl}.Run(ctx)
		pipelines = sim.Pipeline{Deploys: deploys, QueuedFor: 2500 * time.Millisecond, RunFor: 5 * time.Second, Control: ctl}
		log.Info("simulation on: fake status changes and pipeline progress", "every", cfg.SimulateEvery)
	}

	// ---- authentication ----
	var authn auth.Authenticator
	switch cfg.AuthMode {
	case "gitlab":
		authn = auth.NewGitLab(cfg.GitLabURL, auth.Policy{
			AllowedGroups: cfg.AllowedGroups,
		})
		log.Info("auth: validating GitLab tokens", "gitlab", cfg.GitLabURL)
	default:
		authn = auth.NewDev()
		log.Warn("auth: DEV MODE - every request is accepted without login. Never use this outside local development.")
	}

	srv := &api.Server{
		Config: configs, Status: statuses, Deploys: deploys, Hub: hub, Auth: authn, Pipelines: pipelines,
		Log: log, BaseContext: ctx, PingEvery: 15 * time.Second, CORSOrigin: cfg.CORSOrigin,
		LockedEnvs: cfg.LockedEnvs, PipelinesURL: cfg.PipelineBaseURL,
		DevTools: cfg.DevTools, Sim: simControl,
	}
	if cfg.DevTools {
		log.Warn("dev tools on: /api/v1/dev can forge status, deployments, baselines and events (see /docs)")
	}

	return serve(ctx, log, cfg.Addr, srv)
}

func serve(ctx context.Context, log *slog.Logger, addr string, srv *api.Server) error {
	hs := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second, // the event stream clears its own deadline
		IdleTimeout:       120 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", addr)
		errc <- hs.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := hs.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}

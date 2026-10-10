// Package settings reads the service configuration from environment variables (12-factor style).
package settings

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Settings struct {
	Addr string // listen address

	AuthMode        string // "dev" (no login, every request is the dev user) | "gitlab"
	GitLabURL       string
	AllowedGroups   []string
	PipelineBaseURL string // GitLab pipelines URL used to build links in deployments

	ConfigFile string // baseline file to load and watch; empty = embedded mock baseline

	Simulate      bool          // generate fake live status changes and pipeline progress
	SimulateEvery time.Duration // pause between fake status changes
	LockedEnvs    []string      // environment names that refuse deployments (business-rule mock)
	DevTools      bool          // serve /api/v1/dev: trigger status, deployments, config and events by hand

	CORSOrigin string // allowed browser origin when the app is not served through the same host ("" = off)
	LogLevel   string // debug | info | warn | error
}

// Load reads NINETAILS_* variables. Defaults are for local development.
func Load() (Settings, error) {
	s := Settings{
		Addr:            env("NINETAILS_ADDR", ":8080"),
		AuthMode:        strings.ToLower(env("NINETAILS_AUTH", "dev")),
		GitLabURL:       env("NINETAILS_GITLAB_URL", "https://gitlab.example.com"),
		AllowedGroups:   list(os.Getenv("NINETAILS_ALLOWED_GROUPS")),
		PipelineBaseURL: env("NINETAILS_PIPELINE_URL", "https://gitlab.example.com/acme/app/-/pipelines"),
		ConfigFile:      os.Getenv("NINETAILS_CONFIG_FILE"),
		LockedEnvs:      list(env("NINETAILS_LOCKED_ENVS", "legacy")),
		CORSOrigin:      os.Getenv("NINETAILS_CORS_ORIGIN"),
		LogLevel:        strings.ToLower(env("NINETAILS_LOG_LEVEL", "info")),
	}

	var err error
	if s.AuthMode != "dev" && s.AuthMode != "gitlab" {
		return s, fmt.Errorf("NINETAILS_AUTH must be \"dev\" or \"gitlab\", got %q", s.AuthMode)
	}

	s.Simulate, err = strconv.ParseBool(env("NINETAILS_SIMULATE", "true"))
	if err != nil {
		return s, fmt.Errorf("NINETAILS_SIMULATE: %w", err)
	}
	s.SimulateEvery, err = time.ParseDuration(env("NINETAILS_SIMULATE_EVERY", "8s"))
	if err != nil {
		return s, fmt.Errorf("NINETAILS_SIMULATE_EVERY: %w", err)
	}
	// On by default only with dev auth: these endpoints let the caller forge any status or deployment.
	s.DevTools, err = strconv.ParseBool(env("NINETAILS_DEV_TOOLS", strconv.FormatBool(s.AuthMode == "dev")))
	if err != nil {
		return s, fmt.Errorf("NINETAILS_DEV_TOOLS: %w", err)
	}
	if s.DevTools && s.AuthMode != "dev" {
		return s, fmt.Errorf("NINETAILS_DEV_TOOLS=true needs NINETAILS_AUTH=dev: the dev endpoints must never run against real users")
	}
	return s, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// list splits "a, b,c" into ["a","b","c"].
func list(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

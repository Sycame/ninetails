// Package sim stands in for the parts of the real system that do not exist yet: the monitoring
// collector that produces live status, and the GitLab pipeline that runs a deployment. Replace
// these with real integrations; the rest of the service does not change.
package sim

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sync/atomic"
	"time"

	"ninetails-api/internal/model"
	"ninetails-api/internal/store"
)

// Control pauses both simulators so a developer can drive status and deployments by hand (the
// /api/v1/dev endpoints). The zero value is running; a nil *Control is never paused.
type Control struct{ paused atomic.Bool }

func (c *Control) Paused() bool     { return c != nil && c.paused.Load() }
func (c *Control) SetPaused(p bool) { c.paused.Store(p) }

// ---- status ------------------------------------------------------------------------------

// Status periodically flips the status of a random node or VM, like a monitoring system would.
type Status struct {
	Status  *store.StatusStore
	Config  *store.ConfigStore
	Every   time.Duration
	Control *Control
}

func (s Status) Run(ctx context.Context) {
	t := time.NewTicker(s.Every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if s.Control.Paused() {
			continue
		}
		cfg, _ := s.Config.Current()
		var nodeIDs, vmIDs []string
		for _, r := range cfg.Racks {
			for _, n := range r.Nodes {
				nodeIDs = append(nodeIDs, n.ID)
			}
		}
		for _, v := range cfg.VMs {
			vmIDs = append(vmIDs, v.ID)
		}

		st := randomStatus()
		if len(nodeIDs) > 0 && (len(vmIDs) == 0 || rand.Float64() < 0.7) {
			id := nodeIDs[rand.IntN(len(nodeIDs))]
			checks := checksFor(st)
			s.Status.ApplyNode(model.NodeUpdate{ID: id, Status: &st, Checks: &checks})
		} else if len(vmIDs) > 0 {
			s.Status.ApplyVM(model.VMUpdate{ID: vmIDs[rand.IntN(len(vmIDs))], Status: &st})
		}
	}
}

func randomStatus() model.Status {
	switch r := rand.Float64(); {
	case r < 0.7:
		return model.StatusOK
	case r < 0.95:
		return model.StatusWarn
	default:
		return model.StatusFail
	}
}

func checksFor(st model.Status) []model.HealthCheck {
	at := time.Now().UTC().Format(time.RFC3339)
	ping := model.HealthCheck{Name: "Ping", Status: model.StatusOK, CheckedAt: at}
	switch st {
	case model.StatusWarn:
		return []model.HealthCheck{ping, {Name: "Disk", Status: model.StatusWarn, Message: "Disk /data 86% full", CheckedAt: at}}
	case model.StatusFail:
		ping.Status, ping.Message = model.StatusFail, "No response for 12 min"
		return []model.HealthCheck{ping}
	}
	return []model.HealthCheck{ping}
}

// ---- pipelines ---------------------------------------------------------------------------

// Pipeline walks a deployment queued -> running -> succeeded, standing in for a GitLab pipeline.
type Pipeline struct {
	Deploys   *store.DeployStore
	QueuedFor time.Duration
	RunFor    time.Duration
	Control   *Control
}

// Start returns immediately; the deployment progresses in the background until ctx is cancelled.
// While paused the deployment stays queued until it is moved by hand (POST /dev/deployments/{id}/update).
func (p Pipeline) Start(ctx context.Context, d model.Deployment) {
	if p.Control.Paused() {
		return
	}
	go func() {
		if !sleep(ctx, p.QueuedFor) {
			return
		}
		p.Deploys.Update(d.ID, model.DeployRunning, fmt.Sprintf("%s running.", pipelineLabel(d)))
		if !sleep(ctx, p.RunFor) {
			return
		}
		p.Deploys.Update(d.ID, model.DeploySucceeded, fmt.Sprintf("%s passed.", pipelineLabel(d)))
	}()
}

func pipelineLabel(d model.Deployment) string {
	var n string
	if _, err := fmt.Sscanf(d.ID, "d-%s", &n); err != nil {
		return "Pipeline"
	}
	return "Pipeline #" + n
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-ctx.Done():
		return false
	}
}

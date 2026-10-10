package store

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
)

const maxHistory = 500

// DeployStore keeps the deployment history (newest first) and announces every change.
type DeployStore struct {
	mu    sync.Mutex
	items []model.Deployment
	seq   int
	hub   *events.Hub
}

// NewDeployStore seeds the history; new ids continue after the highest "d-<number>" seen.
func NewDeployStore(seed []model.Deployment, hub *events.Hub) *DeployStore {
	s := &DeployStore{items: append([]model.Deployment(nil), seed...), seq: 1000, hub: hub}
	for _, d := range seed {
		if n, err := strconv.Atoi(strings.TrimPrefix(d.ID, "d-")); err == nil && n > s.seq {
			s.seq = n
		}
	}
	return s
}

// List returns up to limit deployments, newest first.
func (s *DeployStore) List(limit int) []model.Deployment {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > len(s.items) {
		limit = len(s.items)
	}
	return append([]model.Deployment{}, s.items[:limit]...)
}

// ActiveFor reports whether the environment already has a queued or running deployment.
func (s *DeployStore) ActiveFor(envID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range s.items {
		if d.EnvID == envID && (d.Status == model.DeployQueued || d.Status == model.DeployRunning) {
			return true
		}
	}
	return false
}

// Create records a new queued deployment. pipelineBase is the GitLab project pipelines URL.
func (s *DeployStore) Create(env model.Environment, user, pipelineBase string) model.Deployment {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	d := model.Deployment{
		ID: fmt.Sprintf("d-%d", s.seq), EnvID: env.ID, EnvName: env.Name,
		Status: model.DeployQueued, StartedBy: user, StartedAt: now(),
		PipelineURL: fmt.Sprintf("%s/%d", strings.TrimRight(pipelineBase, "/"), s.seq),
		Message:     fmt.Sprintf("Pipeline #%d queued.", s.seq),
	}
	s.items = append([]model.Deployment{d}, s.items...)
	if len(s.items) > maxHistory {
		s.items = s.items[:maxHistory]
	}
	return d
}

// Update moves a deployment to a new status and pushes `deployment.updated`. It reports whether
// the deployment exists.
func (s *DeployStore) Update(id string, status model.DeploymentStatus, message string) bool {
	s.mu.Lock()
	u := model.DeploymentUpdate{ID: id, Status: status, Message: message}
	if status == model.DeploySucceeded || status == model.DeployFailed {
		u.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	}
	found := false
	for i := range s.items {
		if s.items[i].ID == id {
			s.items[i].Status = status
			if u.FinishedAt != "" {
				s.items[i].FinishedAt = u.FinishedAt
			}
			if message != "" {
				s.items[i].Message = message
			}
			found = true
			break
		}
	}
	s.mu.Unlock()
	if found {
		s.hub.Publish(events.Event{Type: events.DeploymentUpdated, Data: u})
	}
	return found
}

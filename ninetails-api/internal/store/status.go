package store

import (
	"sync"
	"time"

	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
)

// StatusStore is the live state (status, health checks, link state) keyed by baseline ids.
// In production a collector (monitoring, SNMP, agents...) would call ApplyNode/ApplyVM; today the
// simulator does. Every change is pushed to connected clients.
type StatusStore struct {
	mu   sync.RWMutex
	snap model.StatusSnapshot
	hub  *events.Hub
}

func NewStatusStore(initial model.StatusSnapshot, hub *events.Hub) *StatusStore {
	if initial.Nodes == nil {
		initial.Nodes = map[string]model.NodeState{}
	}
	if initial.VMs == nil {
		initial.VMs = map[string]model.Status{}
	}
	return &StatusStore{snap: initial, hub: hub}
}

// Snapshot returns a deep copy, safe to marshal while updates continue.
func (s *StatusStore) Snapshot() model.StatusSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := model.StatusSnapshot{
		AsOf:  s.snap.AsOf,
		Nodes: make(map[string]model.NodeState, len(s.snap.Nodes)),
		VMs:   make(map[string]model.Status, len(s.snap.VMs)),
	}
	for id, n := range s.snap.Nodes {
		out.Nodes[id] = copyState(n)
	}
	for id, st := range s.snap.VMs {
		out.VMs[id] = st
	}
	return out
}

// NodeStatus / VMStatus are used by the simulator to decide what to change next.
func (s *StatusStore) NodeStatus(id string) (model.Status, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n, ok := s.snap.Nodes[id]
	return n.Status, ok
}

// ApplyNode merges a partial update (fields not set are kept) and pushes it to clients.
func (s *StatusStore) ApplyNode(u model.NodeUpdate) {
	s.mu.Lock()
	s.snap.Nodes[u.ID] = PatchState(s.snap.Nodes[u.ID], u)
	s.snap.AsOf = now()
	s.mu.Unlock()
	s.hub.Publish(events.Event{Type: events.NodeUpdated, Data: u})
}

func (s *StatusStore) ApplyVM(u model.VMUpdate) {
	if u.Status == nil {
		return
	}
	s.mu.Lock()
	s.snap.VMs[u.ID] = *u.Status
	s.snap.AsOf = now()
	s.mu.Unlock()
	s.hub.Publish(events.Event{Type: events.VMUpdated, Data: u})
}

// PatchState is pure: a copy of prev with the update applied. Mirrors StatusService.patchState in the app.
func PatchState(prev model.NodeState, u model.NodeUpdate) model.NodeState {
	out := copyState(prev)
	if out.Status == "" {
		out.Status = model.StatusOK
	}
	if u.Status != nil {
		out.Status = *u.Status
	}
	if u.Checks != nil {
		out.Checks = append([]model.HealthCheck(nil), (*u.Checks)...)
	}
	for _, l := range u.Interfaces {
		if out.Links == nil {
			out.Links = map[string]bool{}
		}
		out.Links[l.Name] = l.LinkUp
	}
	return out
}

func copyState(n model.NodeState) model.NodeState {
	out := model.NodeState{Status: n.Status, Checks: append([]model.HealthCheck{}, n.Checks...)}
	if n.Links != nil {
		out.Links = make(map[string]bool, len(n.Links))
		for k, v := range n.Links {
			out.Links[k] = v
		}
	}
	return out
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

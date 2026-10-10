// Package store holds the service's state: the baseline configuration, the live status and the
// deployment history. All of it is in memory and seeded from mock data for now; the method
// signatures are what a database-backed implementation would keep.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
)

// ErrVersionReused is returned when a baseline with an already-published version but different
// content is offered: published baselines are immutable, every change needs a new version.
var ErrVersionReused = errors.New("version already published with different content; bump the version")

// InvalidError lists everything wrong with a rejected baseline.
type InvalidError struct{ Problems []string }

func (e *InvalidError) Error() string {
	return fmt.Sprintf("baseline is invalid (%d problems): %s", len(e.Problems), strings.Join(e.Problems, "; "))
}

// ConfigStore serves the current baseline. Publishing a new one is atomic: readers see either the
// old baseline or the new one, never a mix, and every connected client is told with `config.changed`.
type ConfigStore struct {
	mu  sync.RWMutex
	cur *model.ConfigBaseline
	raw []byte // cur marshalled once, served as-is

	hub *events.Hub
	log *slog.Logger
}

func NewConfigStore(hub *events.Hub, log *slog.Logger) *ConfigStore {
	return &ConfigStore{hub: hub, log: log}
}

// Publish validates and installs a baseline. Identical content is a no-op.
func (s *ConfigStore) Publish(b *model.ConfigBaseline) error {
	if problems := Validate(b); len(problems) > 0 {
		return &InvalidError{Problems: problems}
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}

	s.mu.Lock()
	if s.cur != nil && s.cur.Version == b.Version {
		same := bytes.Equal(s.raw, raw)
		s.mu.Unlock()
		if same {
			return nil
		}
		return ErrVersionReused
	}
	first := s.cur == nil
	s.cur, s.raw = b, raw
	s.mu.Unlock()

	s.log.Info("baseline published", "version", b.Version, "racks", len(b.Racks), "vms", len(b.VMs),
		"environments", len(b.Environments), "teams", len(b.Teams))
	if !first {
		s.hub.Publish(events.Event{Type: events.ConfigChanged, Data: b.ConfigVersion})
	}
	return nil
}

// Current returns the baseline and its JSON encoding. Do not modify the baseline.
func (s *ConfigStore) Current() (*model.ConfigBaseline, []byte) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cur, s.raw
}

func (s *ConfigStore) Version() model.ConfigVersion {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cur.ConfigVersion
}

func (s *ConfigStore) Environment(id string) (model.Environment, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.cur.Environments {
		if e.ID == id {
			return e, true
		}
	}
	return model.Environment{}, false
}

// HasNode reports whether a server or switch with this id is in the baseline.
func (s *ConfigStore) HasNode(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.cur.Racks {
		for _, n := range r.Nodes {
			if n.ID == id {
				return true
			}
		}
	}
	return false
}

// HasVM reports whether a VM with this id is in the baseline.
func (s *ConfigStore) HasVM(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, v := range s.cur.VMs {
		if v.ID == id {
			return true
		}
	}
	return false
}

// StripBOM removes a UTF-8 byte-order mark. Many Windows editors add one to JSON files, and
// encoding/json rejects it.
func StripBOM(data []byte) []byte { return bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}) }

// ParseBaseline decodes strictly: an unknown field is almost always a typo in a hand-edited file.
func ParseBaseline(data []byte) (*model.ConfigBaseline, error) {
	dec := json.NewDecoder(bytes.NewReader(StripBOM(data)))
	dec.DisallowUnknownFields()
	var b model.ConfigBaseline
	if err := dec.Decode(&b); err != nil {
		return nil, err
	}
	return &b, nil
}

// WatchFile re-reads path whenever it changes and publishes the result. A broken or unversioned
// edit is logged and ignored - the service keeps serving the last good baseline.
func (s *ConfigStore) WatchFile(ctx context.Context, path string, every time.Duration) {
	var lastMod time.Time
	var lastSize int64
	if fi, err := os.Stat(path); err == nil {
		lastMod, lastSize = fi.ModTime(), fi.Size()
	}

	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		fi, err := os.Stat(path)
		if err != nil || (fi.ModTime().Equal(lastMod) && fi.Size() == lastSize) {
			continue
		}
		lastMod, lastSize = fi.ModTime(), fi.Size()

		data, err := os.ReadFile(path)
		if err != nil {
			s.log.Error("baseline file unreadable", "path", path, "err", err)
			continue
		}
		b, err := ParseBaseline(data)
		if err == nil {
			err = s.Publish(b)
		}
		if err != nil {
			s.log.Error("baseline change rejected, still serving the previous one", "path", path, "err", err)
		}
	}
}

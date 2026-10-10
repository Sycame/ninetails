// Package events is the in-process fan-out behind GET /events (Server-Sent Events).
package events

import "sync"

// Event names - the SSE "event:" field. They match LiveEvent in the Angular app.
const (
	ConfigChanged     = "config.changed"
	NodeUpdated       = "node.updated"
	VMUpdated         = "vm.updated"
	DeploymentUpdated = "deployment.updated"
	Resync            = "resync"
)

// Event is one message for every connected client. Data is marshalled to JSON by the SSE handler.
type Event struct {
	Type string
	Data any
}

// Hub broadcasts events to all subscribers. Publishing never blocks: a subscriber that cannot keep
// up (full buffer) is dropped and its channel closed. The client then reconnects and the app
// refetches everything, so a dropped client loses nothing.
type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[chan Event]struct{}{}} }

// Subscribe returns a buffered channel of events. Call Unsubscribe when done.
func (h *Hub) Subscribe() chan Event {
	ch := make(chan Event, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *Hub) Unsubscribe(ch chan Event) {
	h.mu.Lock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
	h.mu.Unlock()
}

func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default: // slow consumer: drop it, it will reconnect and resync
			delete(h.subs, ch)
			close(ch)
		}
	}
}

// Subscribers is used by tests and the health endpoint.
func (h *Hub) Subscribers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

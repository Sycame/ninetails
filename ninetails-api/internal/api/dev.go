package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"ninetails-api/internal/events"
	"ninetails-api/internal/model"
	"ninetails-api/internal/store"
)

// SimControl pauses and resumes the background simulators (random status flips, automatic
// pipeline progress) so a developer can drive the system by hand without them interfering.
type SimControl interface {
	Paused() bool
	SetPaused(bool)
}

// Dev tools: endpoints under /api/v1/dev that stand in for the monitoring collector, the GitLab
// pipeline and the change-management system, so the app can be tested end to end from Swagger UI.
// They are only registered when Server.DevTools is set (NINETAILS_DEV_TOOLS, on by default in
// dev auth mode and refused with gitlab auth). Every call goes through the same stores as the
// real integrations will, so the app sees exactly what it would see in production.
func (s *Server) registerDev(api *http.ServeMux) {
	p := apiPrefix + "/dev"
	api.HandleFunc("GET "+p, s.devState)
	api.HandleFunc("POST "+p+"/simulation", s.devSimulation)
	api.HandleFunc("POST "+p+"/nodes/{nodeId}/update", s.devNode)
	api.HandleFunc("POST "+p+"/vms/{vmId}/update", s.devVM)
	api.HandleFunc("POST "+p+"/deployments/{deploymentId}/update", s.devDeployment)
	api.HandleFunc("POST "+p+"/config/bump", s.devConfigBump)
	api.HandleFunc("POST "+p+"/config", s.devConfigPublish)
	api.HandleFunc("POST "+p+"/events", s.devEvent)
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func validStatus(st model.Status) bool {
	return st == model.StatusOK || st == model.StatusWarn || st == model.StatusFail
}

func (s *Server) devState(w http.ResponseWriter, r *http.Request) {
	paused := false
	if s.Sim != nil {
		paused = s.Sim.Paused()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"simulationAvailable": s.Sim != nil, "simulationPaused": paused,
		"configVersion": s.Config.Version().Version, "eventClients": s.Hub.Subscribers(),
	})
}

type simulationBody struct {
	Paused bool `json:"paused"`
}

// POST /dev/simulation - pause the random status changes and automatic pipeline progress.
func (s *Server) devSimulation(w http.ResponseWriter, r *http.Request) {
	if s.Sim == nil {
		writeError(w, http.StatusConflict, "simulation_off", "Simulation is off (NINETAILS_SIMULATE=false); nothing to pause.")
		return
	}
	var b simulationBody
	if !decodeBody(w, r, &b) {
		return
	}
	s.Sim.SetPaused(b.Paused)
	s.Log.Info("dev: simulation", "paused", b.Paused)
	writeJSON(w, http.StatusOK, b)
}

// POST /dev/nodes/{nodeId}/update - what the monitoring collector would send for a server or switch.
func (s *Server) devNode(w http.ResponseWriter, r *http.Request) {
	var u model.NodeUpdate
	if !decodeBody(w, r, &u) {
		return
	}
	u.ID = r.PathValue("nodeId")
	if !s.Config.HasNode(u.ID) {
		writeError(w, http.StatusNotFound, "node_not_found", "No server or switch with that id in the baseline.")
		return
	}
	if u.Status != nil && !validStatus(*u.Status) {
		writeError(w, http.StatusBadRequest, "bad_request", "status must be OK, WARN or FAIL.")
		return
	}
	if u.Checks != nil {
		at := time.Now().UTC().Format(time.RFC3339)
		checks := make([]model.HealthCheck, len(*u.Checks))
		for i, c := range *u.Checks {
			if c.Name == "" || !validStatus(c.Status) {
				writeError(w, http.StatusBadRequest, "bad_request", "every check needs a name and a status of OK, WARN or FAIL.")
				return
			}
			if c.CheckedAt == "" {
				c.CheckedAt = at
			}
			checks[i] = c
		}
		u.Checks = &checks
	}
	s.Status.ApplyNode(u)
	s.Log.Info("dev: node update", "id", u.ID)
	writeJSON(w, http.StatusOK, s.Status.Snapshot().Nodes[u.ID])
}

// POST /dev/vms/{vmId}/update
func (s *Server) devVM(w http.ResponseWriter, r *http.Request) {
	var u model.VMUpdate
	if !decodeBody(w, r, &u) {
		return
	}
	u.ID = r.PathValue("vmId")
	if !s.Config.HasVM(u.ID) {
		writeError(w, http.StatusNotFound, "vm_not_found", "No VM with that id in the baseline.")
		return
	}
	if u.Status == nil || !validStatus(*u.Status) {
		writeError(w, http.StatusBadRequest, "bad_request", "status is required: OK, WARN or FAIL.")
		return
	}
	s.Status.ApplyVM(u)
	s.Log.Info("dev: vm update", "id", u.ID, "status", *u.Status)
	writeJSON(w, http.StatusOK, u)
}

// POST /dev/deployments/{deploymentId}/update - what the GitLab pipeline webhook would send.
func (s *Server) devDeployment(w http.ResponseWriter, r *http.Request) {
	var u model.DeploymentUpdate
	if !decodeBody(w, r, &u) {
		return
	}
	u.ID = r.PathValue("deploymentId")
	switch u.Status {
	case model.DeployQueued, model.DeployRunning, model.DeploySucceeded, model.DeployFailed:
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "status must be queued, running, succeeded or failed.")
		return
	}
	if !s.Deploys.Update(u.ID, u.Status, u.Message) {
		writeError(w, http.StatusNotFound, "deployment_not_found", "No deployment with that id.")
		return
	}
	s.Log.Info("dev: deployment update", "id", u.ID, "status", u.Status)
	for _, d := range s.Deploys.List(0) {
		if d.ID == u.ID {
			writeJSON(w, http.StatusOK, d)
			return
		}
	}
}

type bumpBody struct {
	Version     string `json:"version"`
	Description string `json:"description"`
}

// POST /dev/config/bump - republish the current baseline under a new version. This is the quickest
// way to see the app's "Configuration updated" flow without editing a file.
func (s *Server) devConfigBump(w http.ResponseWriter, r *http.Request) {
	var b bumpBody
	if r.ContentLength != 0 && !decodeBody(w, r, &b) {
		return
	}
	cur, _ := s.Config.Current()
	next := *cur // shallow copy: the baseline is immutable, only the version header changes
	next.Version = b.Version
	if next.Version == "" {
		next.Version = "dev-" + time.Now().UTC().Format("20060102T150405")
	}
	next.Description = b.Description
	if next.Description == "" {
		next.Description = "Dev tools: republished unchanged"
	}
	next.PublishedAt = time.Now().UTC().Format(time.RFC3339)
	s.publish(w, &next)
}

// POST /dev/config - publish a whole new baseline (copy GET /config, edit, bump the version, paste).
func (s *Server) devConfigPublish(w http.ResponseWriter, r *http.Request) {
	body, err := readAll(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Could not read the body: "+err.Error())
		return
	}
	next, err := store.ParseBaseline(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid baseline JSON: "+err.Error())
		return
	}
	if next.PublishedAt == "" {
		next.PublishedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.publish(w, next)
}

func (s *Server) publish(w http.ResponseWriter, b *model.ConfigBaseline) {
	var invalid *store.InvalidError
	switch err := s.Config.Publish(b); {
	case err == nil:
		s.Log.Info("dev: baseline published", "version", b.Version)
		writeJSON(w, http.StatusOK, s.Config.Version())
	case errors.As(err, &invalid):
		writeError(w, http.StatusUnprocessableEntity, "baseline_invalid", err.Error())
	case errors.Is(err, store.ErrVersionReused):
		writeError(w, http.StatusConflict, "version_reused", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
	}
}

type eventBody struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// POST /dev/events - broadcast any event to every connected app, verbatim. For events with no
// dedicated endpoint (`resync`) and for sending names or payloads the app should tolerate or ignore.
// This does NOT change server state: a hand-made `node.updated` here is shown by the app but not
// kept in /status, so the next resync reverts it. Use the typed endpoints above to change state.
func (s *Server) devEvent(w http.ResponseWriter, r *http.Request) {
	var b eventBody
	if !decodeBody(w, r, &b) {
		return
	}
	if b.Type == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "type is required, e.g. \"resync\".")
		return
	}
	if len(b.Data) == 0 {
		b.Data = json.RawMessage("{}")
	}
	s.Hub.Publish(events.Event{Type: b.Type, Data: b.Data})
	s.Log.Info("dev: event broadcast", "type", b.Type)
	writeJSON(w, http.StatusOK, map[string]any{"sent": b.Type, "clients": s.Hub.Subscribers()})
}

func readAll(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	return io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
}

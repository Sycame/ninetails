// Package model holds the wire types of the REST API. Field names and JSON tags mirror the
// Angular app's src/app/core/models.ts exactly - that file and docs/api.md are the contract.
package model

// Status is the single health model used everywhere.
type Status string

const (
	StatusOK   Status = "OK"
	StatusWarn Status = "WARN"
	StatusFail Status = "FAIL"
)

// ---- baseline configuration (GET /config) -------------------------------------------------
// Contains NO health information: that lives in the status types further down.

type Team struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Contact string `json:"contact,omitempty"`
}

type Environment struct {
	ID          string `json:"id"`
	Name        string `json:"name"` // free-form, may contain spaces/symbols
	Description string `json:"description,omitempty"`
	TeamID      string `json:"teamId"`
}

// Placement is a node's cell inside a chassis grid (1-based): columns x one row per RU.
// A column holds at most one server per RU (no vertical stacking inside an RU).
type Placement struct {
	Col     int `json:"col"`
	Row     int `json:"row"`
	ColSpan int `json:"colSpan"`
	RowSpan int `json:"rowSpan"`
}

type Chassis struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Model     string `json:"model"`
	PositionU int    `json:"positionU"` // lowest RU, 1 = bottom of the rack
	SizeU     int    `json:"sizeU"`
	Columns   int    `json:"columns"`
	EnvID     string `json:"envId,omitempty"`
	TeamID    string `json:"teamId,omitempty"`
}

type NetworkInterface struct {
	Name      string `json:"name"`
	Purpose   string `json:"purpose,omitempty"`
	IPAddress string `json:"ipAddress"`
	MAC       string `json:"mac"`
	VLAN      *int   `json:"vlan,omitempty"`
	SpeedGbps int    `json:"speedGbps"`
}

type Network struct {
	Hostname   string             `json:"hostname"`
	MgmtIP     string             `json:"mgmtIp,omitempty"` // out-of-band (iDRAC/iLO/BMC)
	Gateway    string             `json:"gateway,omitempty"`
	Interfaces []NetworkInterface `json:"interfaces"`
}

// Node is a server or a switch ("type"). Standalone nodes use PositionU/SizeU; nodes inside a
// chassis use ChassisID/Placement instead.
type Node struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"` // "server" | "switch"
	Name      string     `json:"name"`
	Model     string     `json:"model"`
	RackID    string     `json:"rackId"`
	PositionU *int       `json:"positionU,omitempty"`
	SizeU     *int       `json:"sizeU,omitempty"`
	ChassisID string     `json:"chassisId,omitempty"`
	Placement *Placement `json:"placement,omitempty"`
	EnvID     string     `json:"envId,omitempty"`
	TeamID    string     `json:"teamId,omitempty"`
	Network   *Network   `json:"network,omitempty"`
	Ports     *int       `json:"ports,omitempty"` // switches
}

type Rack struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Location string    `json:"location"`
	HeightU  int       `json:"heightU"`
	Chassis  []Chassis `json:"chassis"`
	Nodes    []Node    `json:"nodes"`
}

type VM struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	HostID string `json:"hostId"`          // server it runs on
	EnvID  string `json:"envId,omitempty"` // may differ from the host's environment
	OS     string `json:"os"`
}

// ConfigVersion is the tiny document served by GET /config/version.
type ConfigVersion struct {
	Version     string `json:"version"` // opaque; changes with every published baseline
	PublishedAt string `json:"publishedAt"`
	Description string `json:"description,omitempty"`
}

// ConfigBaseline is the whole baseline (GET /config). Immutable once published.
type ConfigBaseline struct {
	ConfigVersion
	Racks        []Rack        `json:"racks"`
	VMs          []VM          `json:"vms"`
	Environments []Environment `json:"environments"`
	Teams        []Team        `json:"teams"`
}

// ---- live state (GET /status + events) ----------------------------------------------------

type HealthCheck struct {
	Name      string `json:"name"`
	Status    Status `json:"status"`
	Message   string `json:"message,omitempty"`
	CheckedAt string `json:"checkedAt"`
}

type NodeState struct {
	Status Status          `json:"status"`
	Checks []HealthCheck   `json:"checks"`
	Links  map[string]bool `json:"links,omitempty"` // interface name -> link up
}

type StatusSnapshot struct {
	AsOf  string               `json:"asOf"`
	Nodes map[string]NodeState `json:"nodes"`
	VMs   map[string]Status    `json:"vms"`
}

// ---- deployments ---------------------------------------------------------------------------

type DeploymentStatus string

const (
	DeployQueued    DeploymentStatus = "queued"
	DeployRunning   DeploymentStatus = "running"
	DeploySucceeded DeploymentStatus = "succeeded"
	DeployFailed    DeploymentStatus = "failed"
)

type Deployment struct {
	ID          string           `json:"id"`
	EnvID       string           `json:"envId"`
	EnvName     string           `json:"envName"`
	Status      DeploymentStatus `json:"status"`
	StartedBy   string           `json:"startedBy"`
	StartedAt   string           `json:"startedAt"`
	FinishedAt  string           `json:"finishedAt,omitempty"`
	PipelineURL string           `json:"pipelineUrl,omitempty"`
	Message     string           `json:"message,omitempty"`
}

// ---- event payloads (GET /events) ----------------------------------------------------------

type LinkUpdate struct {
	Name   string `json:"name"`
	LinkUp bool   `json:"linkUp"`
}

// NodeUpdate is a partial update: only the fields that are set change.
type NodeUpdate struct {
	ID         string         `json:"id"`
	Status     *Status        `json:"status,omitempty"`
	Checks     *[]HealthCheck `json:"checks,omitempty"`
	Interfaces []LinkUpdate   `json:"interfaces,omitempty"`
}

type VMUpdate struct {
	ID     string  `json:"id"`
	Status *Status `json:"status,omitempty"`
}

type DeploymentUpdate struct {
	ID         string           `json:"id"`
	Status     DeploymentStatus `json:"status"`
	FinishedAt string           `json:"finishedAt,omitempty"`
	Message    string           `json:"message,omitempty"`
}

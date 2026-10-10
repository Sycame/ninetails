// Package data embeds the mock datasets so the service runs with zero setup. To edit the baseline
// without rebuilding, copy config.json somewhere and point NINETAILS_CONFIG_FILE at it (see README).
package data

import _ "embed"

//go:embed config.json
var Config []byte

//go:embed status.json
var Status []byte

//go:embed deployments.json
var Deployments []byte

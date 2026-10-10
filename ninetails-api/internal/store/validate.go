package store

import (
	"fmt"

	"ninetails-api/internal/model"
)

// Validate checks a baseline for the mistakes a change process can introduce and returns
// human-readable problems (empty = valid). The same layout rules are enforced by the Angular app:
//   - ids are unique and references resolve (rack, chassis, host, environment, team);
//   - everything fits inside its rack and nothing overlaps (a rack unit holds one server vertically);
//   - inside a chassis, nodes stay within its grid and never share a cell.
func Validate(b *model.ConfigBaseline) []string {
	var p []string
	add := func(format string, a ...any) { p = append(p, fmt.Sprintf(format, a...)) }

	if b.Version == "" {
		add("version is empty")
	}
	if b.PublishedAt == "" {
		add("publishedAt is empty")
	}

	teams := map[string]bool{}
	for _, t := range b.Teams {
		if teams[t.ID] {
			add("duplicate team id %q", t.ID)
		}
		teams[t.ID] = true
	}
	envs := map[string]bool{}
	for _, e := range b.Environments {
		if envs[e.ID] {
			add("duplicate environment id %q", e.ID)
		}
		envs[e.ID] = true
		if !teams[e.TeamID] {
			add("environment %q: unknown team %q", e.Name, e.TeamID)
		}
	}

	nodeIDs := map[string]string{} // id -> type
	rackIDs := map[string]bool{}
	for _, r := range b.Racks {
		if rackIDs[r.ID] {
			add("duplicate rack id %q", r.ID)
		}
		rackIDs[r.ID] = true
		if r.HeightU < 1 {
			add("rack %q: heightU must be at least 1", r.Name)
			continue
		}

		occupied := make([]string, r.HeightU+1) // 1-based RU -> owner id
		claim := func(owner string, pos, size int) {
			for ru := pos; ru < pos+size; ru++ {
				if ru < 1 || ru > r.HeightU {
					continue // reported by the "does not fit" check
				}
				if occupied[ru] != "" {
					add("rack %q: RU %d holds more than one item (%s and %s)", r.Name, ru, occupied[ru], owner)
				} else {
					occupied[ru] = owner
				}
			}
		}

		chassis := map[string]model.Chassis{}
		for _, c := range r.Chassis {
			if _, dup := chassis[c.ID]; dup {
				add("rack %q: duplicate chassis id %q", r.Name, c.ID)
			}
			chassis[c.ID] = c
			if c.SizeU < 1 || c.Columns < 1 {
				add("chassis %q: sizeU and columns must be at least 1", c.Name)
			}
			if c.PositionU < 1 || c.PositionU+c.SizeU-1 > r.HeightU {
				add("chassis %q does not fit in rack %q", c.Name, r.Name)
			}
			claim(c.ID, c.PositionU, c.SizeU)
		}

		cells := map[string]map[[2]int]string{} // chassis id -> (col,row) -> node name
		for _, n := range r.Nodes {
			if _, dup := nodeIDs[n.ID]; dup {
				add("duplicate node id %q", n.ID)
			}
			nodeIDs[n.ID] = n.Type
			if n.Type != "server" && n.Type != "switch" {
				add("node %q: type must be \"server\" or \"switch\"", n.Name)
			}
			if n.RackID != r.ID {
				add("node %q: rackId %q does not match its rack %q", n.Name, n.RackID, r.ID)
			}
			if n.EnvID != "" && !envs[n.EnvID] {
				add("node %q: unknown environment %q", n.Name, n.EnvID)
			}
			if n.TeamID != "" && !teams[n.TeamID] {
				add("node %q: unknown team %q", n.Name, n.TeamID)
			}

			if n.ChassisID == "" {
				if n.PositionU == nil {
					add("node %q: standalone node needs positionU", n.Name)
					continue
				}
				size := 1
				if n.SizeU != nil {
					size = *n.SizeU
				}
				if size < 1 || *n.PositionU < 1 || *n.PositionU+size-1 > r.HeightU {
					add("node %q does not fit in rack %q", n.Name, r.Name)
				}
				claim(n.ID, *n.PositionU, size)
				continue
			}

			c, ok := chassis[n.ChassisID]
			if !ok {
				add("node %q: unknown chassis %q in rack %q", n.Name, n.ChassisID, r.Name)
				continue
			}
			pl := n.Placement
			if pl == nil {
				add("node %q is in chassis %q but has no placement", n.Name, c.Name)
				continue
			}
			if pl.Col < 1 || pl.Row < 1 || pl.ColSpan < 1 || pl.RowSpan < 1 ||
				pl.Col+pl.ColSpan-1 > c.Columns || pl.Row+pl.RowSpan-1 > c.SizeU {
				add("node %q placement is outside chassis %q", n.Name, c.Name)
				continue
			}
			if cells[c.ID] == nil {
				cells[c.ID] = map[[2]int]string{}
			}
			for col := pl.Col; col < pl.Col+pl.ColSpan; col++ {
				for row := pl.Row; row < pl.Row+pl.RowSpan; row++ {
					if other, taken := cells[c.ID][[2]int{col, row}]; taken {
						add("nodes %q and %q are stacked in the same RU of chassis %q", n.Name, other, c.Name)
					} else {
						cells[c.ID][[2]int{col, row}] = n.Name
					}
				}
			}
		}
	}

	vmIDs := map[string]bool{}
	for _, v := range b.VMs {
		if vmIDs[v.ID] {
			add("duplicate vm id %q", v.ID)
		}
		vmIDs[v.ID] = true
		if nodeIDs[v.HostID] != "server" {
			add("vm %q: host %q is not a known server", v.Name, v.HostID)
		}
		if v.EnvID != "" && !envs[v.EnvID] {
			add("vm %q: unknown environment %q", v.Name, v.EnvID)
		}
	}
	return p
}

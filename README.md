# MBAM - Maps by Any Means

A hex-grid map editor and campaign manager for the [VBAM (Victory by Any Means)](https://vbam.com/) tabletop game. Build star system maps, generate galaxies, and run full multi-player campaigns — all in a single portable app that runs in your browser.

---

## Features

### Map Maker

- **Hex-grid canvas** with pan, zoom, and fit-to-map controls
- **System editing** — place systems by double-clicking empty hexes; set type (homeworld/major/minor/unimportant), star type, planet type, traits, and attributes
- **Jump lanes** — shift-click two adjacent systems to connect them; supports major, minor, restricted, and unexplored lane types
- **Team colors** — assign colors to systems for scenario setup
- **Procedural map generation** — generate maps ring-by-ring using VBAM dice tables, with a full log of every roll
- **Preset maps** — load blank templates, standard maps (small/medium/large/huge), or scenario maps from the core rulebook
- **Custom name lists** — import JSON name lists for random system naming, with duplicate prevention
- **Map capture** — copy the full map or a custom clip region to the clipboard as a PNG
- **Import/Export** — save and load maps as JSON
- **Undo/Redo** — full 50-state history with Ctrl+Z / Ctrl+Y

### Campaign Manager

Run a complete VBAM campaign from the same app. Each turn steps through a structured sequence of phases with dedicated tools for each.

#### Empire Setup
- **Empire Creation** — define empire traits (advantages and disadvantages) and build a unit roster with a fully editable stats table
- **Campaign Setup Wizard** — configure players, map, rules flags (fog of war, raider mechanics, tech progression, etc.), and starting galaxy state

#### Turn Phases

| Phase | What happens |
|---|---|
| **Economic** | Review system income; apply blockade and disruption halving; track EP and SP totals |
| **Turn Orders** | Enter fleet deployment, movement, construction, investment, and diplomatic orders per player; checkboxes to track completion |
| **Movement** | Move fleets across the map; convoy and trade route warnings fire automatically |
| **Combat** | Resolve encounters system by system (see Combat below) |
| **Supply** | BFS route tracing per player; mark units out-of-supply or crippled |
| **Diplomacy** | Set relations (8 levels: War → Alliance); manage cooldowns |
| **End of Turn** | Morale checks; increment turn counter; snapshot history |

#### Fleet Management
- Full fleet manager for each player — named fleets with system assignments, move tracking, and unit status badges (crippled, out-of-supply, captured, exhausted, mothballed)
- **CM (Campaign Manager) fleets** — independent and neutral factions with their own mobile fleets and per-system garrison pools
- Drag units between fleets and system buckets
- **Unit transfer** — move units between players (e.g. captured or gifted units), with automatic template propagation to the receiving empire
- **Add Units** — add constructed units to any system for any player or CM faction; construction orders sidebar tracks what was ordered

#### Combat
- **Encounter detection** — automatically identifies contested systems from fleet positions
- **Combat Scenario flow** — 11-phase sequence: setup → flagship designation → task force assignment → combat rounds → resolution
- **Task forces** — assign units to one or more task forces per side; allied players (MutualDefense/Alliance) can join as additional task forces
- **CM/Independent units** — fully participate in scenarios as their own faction
- **Resolution** — apply results: destroy units, apply crippled flags, transfer captured units (with template copying) to the capturing player's empire

#### Supply
- BFS supply route tracing through owned and allied systems
- Blockade and opposition detection
- Per-unit toggles for out-of-supply and crippled status

#### Trade Routes
- Visual trade route manager with map pick mode
- Convoy assignment and route validity tracking
- Automatic warnings when enemy fleets threaten an active route

#### Tech Progression
- Tech levels E → 1 → 2 → 3 → 4 → 5 → A
- Tech pool investment and upgrade tracking per empire

#### History
- Full turn history browser with a timeline sidebar
- Phase-by-phase diffs: unit changes, EP/SP, system ownership, diplomacy shifts, fleet movements, trade routes, tech upgrades, system attribute changes
- Revert to any prior snapshot

#### Other
- **Fog of War** — intel snapshots per player; stale fleet indicators for unscouted systems
- **Systems Overview** — sortable table of all systems by owner with clipboard export
- **Raider checks** — automatic raider encounter rolls for independent systems based on population, convoy presence, and trade route coverage
- **Autosave** — campaign state saves to localStorage automatically between phases

---

## Controls

| Action | Input |
|---|---|
| Pan | Click and drag |
| Zoom | Scroll wheel |
| Add system | Double-click an empty hex |
| Add jump lane | Shift+click two adjacent systems |
| Select | Click a system or jump lane |
| Deselect | Escape or click empty space |
| Delete selected | Delete key |
| Undo / Redo | Ctrl+Z / Ctrl+Y |

---

## Getting Started

Double-click `MBAM.exe` to launch. The app will open automatically in your default browser. A small console window will appear — keep it open while using the app, and close it (or press Ctrl+C) when you're done.

No installation required — just the single .exe file.

---

## Custom Name Lists

Import custom name lists for random system naming. A name list is a JSON file containing a flat array of strings:

```json
["Coruscant", "Tatooine", "Naboo", "Endor", "Hoth", "Dagobah"]
```

Go to **Import > Name List** in the toolbar and select your `.json` file. Once loaded, click the dice button next to a system's name in the property panel to assign a random name from the list. Names already in use on the map won't be repeated unless **Allow Duplicates** is checked in Settings.

---

## Development

### Running locally

```bash
cd react
npm install
npm run dev
```

Opens at http://localhost:5173.

### Building the standalone executable

Build a portable Windows .exe that serves the app locally (no Node.js required on the target machine).

From **cmd** or **PowerShell**:

```
cd build-tools
build-exe.bat
```

From **Git Bash**:

```bash
cd build-tools
bash build-exe.sh
```

This produces `build-tools/MBAM.exe`. Double-click it to launch — it starts a local server and opens your default browser automatically.

**Requires:** [Node.js](https://nodejs.org/) and [Go](https://go.dev/) on the build machine.

---

## Project Structure

```
react/           React app (TypeScript + Vite + Tailwind)
build-tools/     Standalone exe build (Go static file server)
```

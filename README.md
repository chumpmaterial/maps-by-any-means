# MBAM - Maps by Any Means

A hex-grid map editor for the VBAM (Victory by Any Means) tabletop game. Create, edit, and generate star system maps with jump lanes, system properties, and team colors — all in the browser.

## Features

- **Hex-grid canvas** with pan, zoom, and fit-to-map controls
- **System editing** — place systems by double-clicking empty hexes, set type (homeworld/major/minor/unimportant), star type, planet type, traits, and attributes
- **Jump lanes** — shift-click two adjacent systems to connect them; supports major, minor, restricted, and unexplored lane types
- **Team colors** — assign colors to systems for scenario map setup
- **Procedural map generation** — generate maps ring-by-ring using VBAM dice tables, with a log of every roll
- **Preset maps** — load blank templates, standard maps, or scenario maps from the core VBAM rulebook
- **Custom name lists** — import JSON name lists for random system naming
- **Import/Export** — save and load maps as JSON files
- **Undo/Redo** — full 50-state history with Ctrl+Z / Ctrl+Y

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

Select a system or jump lane to edit its properties in the right-side panel.

## Getting Started

Double-click `MBAM.exe` to launch. The app will open automatically in your default browser. A small console window will appear — keep it open while using the app, and close it (or press Ctrl+C) when you're done.

No installation required — just the single .exe file.

## Custom Name Lists

You can import custom name lists for random system naming. A name list is a JSON file containing a flat array of strings:

```json
["Coruscant", "Tatooine", "Naboo", "Endor", "Hoth", "Dagobah"]
```

To use a name list, go to **Import > Name List** in the toolbar and select your `.json` file. Once loaded, click the dice button next to a system's name in the property panel to assign a random name from the list. Names already in use on the map won't be repeated unless 'Allow Duplicates' is checked in the Settings menu.

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

## Project Structure

```
react/           React app (TypeScript + Vite + Tailwind)
build-tools/     Standalone exe build (Go static file server)
```

## Roadmap

- **Game tracking** — manage and track VBAM game state directly within MBAM

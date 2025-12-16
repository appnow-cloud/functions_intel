# Functions Graph 3D

This folder contains a paired system:

1) A Python static-analysis pass that extracts function and data relationships.
2) A browser-based 3D visualization that renders those relationships as an interactive graph.

The Python side produces structured intelligence.
The HTML/JavaScript side visualizes it.

They are intentionally decoupled.

---

## Overview

The workflow is:

1) Run the Python analyzer (`py_intel.py`) on a codebase.
2) The analyzer emits `function_intel.json`.
3) Open the HTML canvas app in this folder.
4) The app loads `function_intel.json` and builds a live 3D graph.

No server, database, or build step is required.
A simple static file server is enough.

---

## Python: `py_intel.py`

`py_intel.py` is a standalone static-analysis tool.

It parses Python source code and extracts:

- Functions and their relationships
- Call graphs
- Inputs and arguments
- Local variables
- Writes / mutation targets
- Return values
- Global variables
- Constants

The script outputs a single file:

```
function_intel.json
```

This JSON file is the contract between analysis and visualization.

Important properties:
- The Python script runs independently.
- It does not depend on the HTML app.
- You can regenerate `function_intel.json` at any time.
- The visualizer will reflect changes immediately on reload.

---

## Data Contract: `function_intel.json`

`function_intel.json` is the only required input for the 3D viewer.

It contains:

- A list of functions
- Call edges between functions
- Runtime and static metadata
- Variable and constant references

The viewer assumes this file exists at the project root (same folder as `index.html`).

If the file name or path changes, update the loader in the JavaScript toolkit.

---

## HTML / Canvas App

The HTML app is a pure client-side visualization.

Key characteristics:
- Uses Three.js
- Runs entirely in the browser
- No frameworks, no bundlers
- ES module–based

It renders:
- Function nodes as spheres
- Call relationships as edges
- Runtime flow as animated highlights
- Data points (variables/constants) as cube nodes

Physics-based layout keeps related elements close while avoiding collapse.

---

## Folder Structure

Typical layout:

```
/functions-graph-3d/
  ├─ index.html
  ├─ fg3d.js
  ├─ function_intel.json
  ├─ py_intel.py
  └─ README.md
```

- `py_intel.py` is executed separately.
- `function_intel.json` is generated output.
- `index.html` is the entry point for visualization.
- `fg3d.js` contains the Functions Graph 3D toolkit.

---

## Running the Viewer

Because ES modules are used, the app must be served over HTTP.

From this folder:

```
python3 -m http.server
```

Then open:

```
http://localhost:8000/index.html
```

The app will automatically load `function_intel.json`.

---

## Design Philosophy

This system treats code as a spatial object.

Functions are structural anchors.
Data points orbit the functions that touch them.
Runtime execution becomes motion.

By separating analysis from visualization:
- The Python side stays simple and testable.
- The visualization stays fast and expressive.
- Either side can evolve without breaking the other.

This folder is intentionally self-contained.

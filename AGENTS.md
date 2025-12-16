# AGENTS.md

## Codex Refactor Prompts — Functions Graph 3D

### Task A — Split HTML and JavaScript (Toolkit Refactor)

You are Codex Agent working in an Xcode project folder that currently has `index.html` with a large inline
`<script type="module">` block that implements the Functions Graph 3D viewer (Three.js).

Goal: Split the JavaScript into a standalone toolkit module, then update `index.html` to import it.

Rules:
- Do not change behavior unless required by the split.
- Keep formatting consistent with existing JS style:
  - braces on new lines
  - 2-space indentation
- Use ES modules.
- Keep Three.js importmap in HTML (or move carefully if needed, but keep working).
- Do not add build tooling. No bundlers. Keep it runnable via `python3 -m http.server`.
- Output a patch, but include the phrase "don't apply" at the top of your response.

Steps:
1) Create a new file named `fg3d.js` in the same folder as `index.html`.

2) Move all code from the current `<script type="module">` block into `fg3d.js`, except:
   - Keep only a minimal bootstrap in HTML if required.

3) In `fg3d.js`, expose a small toolkit API:
   - `export function bootFunctionsGraph3D(options)`
     - `options.root`: DOM element to attach renderer to (default `document.body`)
     - `options.dataUrl`: URL for `function_intel.json` (default `"function_intel.json"`)
     - `options.onError`: optional error callback

4) Update `index.html`:
   - Remove the old inline module script entirely.
   - Add a new `<script type="module">` that imports and calls the toolkit:
     - `import { bootFunctionsGraph3D } from "./fg3d.js";`
     - `bootFunctionsGraph3D({ });`

5) Ensure relative URL resolution still works for `function_intel.json` when served over `http.server`.

6) After refactor, behavior must remain identical:
   - Domains, 3D view, list view, minimap, runtime stepping, modals all continue to work.

---

### Task B — Data Points as Cube Nodes with Labels

You are Codex Agent. Refactor the Functions Graph 3D viewer to visualize "data points"
(variables and constants) as small purple cube nodes in the same 3D model space.

Rules:
- Keep existing function nodes (spheres) and edges (cylinders) working.
- ES modules only. No build tools.
- Keep performance reasonable.
- Match existing code style.
- Output a patch, but include the phrase "don't apply" at the top of your response.

Data sources (from `function_intel.json`):
- `globals.global_vars`
- `globals.constants`
- Per-function:
  - `inputs.args`
  - `locals.local_vars`
  - `writes.targets`
  - `returns.returns`

Normalization rules:
- `obj.attr` → `obj`
- `arr[i]` → `arr`
- `meta['x']` → `meta`

Classification labels:
- Input
- Local
- Writes
- Returns
- Global
- Constant

A data point may have multiple labels.

Visual requirements:
- Render data points as small purple cubes.
- Hover state uses lighter purple.
- Add 3D text labels near each cube:
  - Variable name
  - Compact tags (e.g. `Input,Local` or `Global`)
- Labels must face the camera (billboard sprites).
- Scale labels gently with camera distance.

Physics requirements:
- Spring attraction between a data cube and each function node that references it.
- Mild data-data repulsion to avoid stacking.
- Function-function forces remain unchanged.

Interaction requirements:
- Clicking a data cube opens an info view showing:
  - Name
  - Labels
  - Referencing functions (deduped, with counts if available)
- Reuse existing modal UI if possible.
- Minimap renders data cubes as tiny purple points.

Implementation outline:
1) Build a `dataGraph` at boot:
   - `dataNodes`: `{ id, name, labels:Set, refs:[fnNode], x/y/z, vx/vy/vz, mesh, labelSprite }`
   - `dataLinks`: `{ v:dataNode, f:fnNode, w:number, kind:string }`

2) Label rendering:
   - Use `THREE.Sprite` + `CanvasTexture`.
   - DPR-aware canvas text for sharpness.
   - Update sprite position every frame relative to cube.

3) Weighting:
   - Writes and Inputs pull stronger than Local.
   - Globals and Constants pull weaker to avoid collapse.

4) Organization:
   - Keep data-node logic close to `start3D`.
   - Add helpers for normalization and classification.

This document defines the canonical Codex prompts for large structural and visualization changes
in the Functions Graph 3D system.

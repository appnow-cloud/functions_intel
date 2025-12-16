/*
{
  "globals": {
    "imports": [
      "string"
    ],
    "global_vars": [
      "string"
    ],
    "constants": [
      "string"
    ]
  },
  "functions": [
    {
      "function_name": "string",
      "start_line": 0,
      "line_count": 0,
      "end_line": 0,
      "desc": "string",
      "invokes": {
        "total": 0,
        "invoke_list": [
          {
            "line": 0,
            "context": "single",
            "callee": "string",
            "args_preview": "string"
          },
          {
            "line": 0,
            "context": "loop",
            "loop_header_preview": "string",
            "callee": "string",
            "args_preview": "string"
          }
        ]
      },
      "inputs": {
        "args": [
          "string"
        ]
      },
      "locals": {
        "local_vars": [
          "string"
        ],
        "local_functions": [
          "string"
        ]
      },
      "writes": {
        "none": true,
        "targets": [
          "string"
        ]
      },
      "returns": {
        "none": true,
        "returns": [
          "string"
        ]
      }
    }
  ]
}
*/
import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
let DATA = null;

function buildGraph(data)
{
  const funcs = data.functions || [];

  // Nodes by function name
  const nodes = [];
  const nodeByName = Object.create(null);

  for (let i = 0; i < funcs.length; i++)
  {
    const f = funcs[i];
    const name = f.function_name || ("fn_" + i);

    const start = (typeof f.start_line === "number") ? f.start_line : 0;
    const end = (typeof f.end_line === "number")
      ? f.end_line
      : ((typeof f.line_count === "number") ? (start + f.line_count - 1) : 0);

    const n = {
      id: name,
      name: name,
      start_line: start,
      end_line: end,
      out_calls: 0,
      in_calls: 0,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0,
      vz: 0,
      r: 6,
      mesh: null
    };

    nodes.push(n);
    nodeByName[name] = n;
  }

  // Caller lookup by callsite line number
  const spans = nodes.slice().sort(function(a, b)
  {
    if (a.start_line !== b.start_line) return a.start_line - b.start_line;
    return a.end_line - b.end_line;
  });

  function findCallerByLine(line)
  {
    if (typeof line !== "number") return null;

    let lo = 0;
    let hi = spans.length - 1;
    let bestIdx = -1;

    while (lo <= hi)
    {
      const mid = (lo + hi) >> 1;
      const s = spans[mid].start_line;

      if (s <= line)
      {
        bestIdx = mid;
        lo = mid + 1;
      }
      else
      {
        hi = mid - 1;
      }
    }

    if (bestIdx < 0) return null;

    let best = null;
    for (let i = bestIdx; i >= 0; i--)
    {
      const n = spans[i];
      if (n.start_line > line) continue;
      if (n.end_line < line) break;

      if (!best) best = n;
      else
      {
        const bestSize = best.end_line - best.start_line;
        const nSize = n.end_line - n.start_line;
        if (nSize < bestSize) best = n;
      }
    }

    return best;
  }

  const edges = [];
  const edgeByKey = Object.create(null);
  let unresolvedCalls = 0;

  for (let i = 0; i < funcs.length; i++)
  {
    const f = funcs[i];
    const inv = (f.invokes && f.invokes.invoke_list) ? f.invokes.invoke_list : [];

    for (let k = 0; k < inv.length; k++)
    {
      const call = inv[k];
      const calleeName = call.callee;
      const calleeNode = calleeName ? nodeByName[calleeName] : null;

      if (!calleeNode)
      {
        unresolvedCalls++;
        continue;
      }

      const callerNode = findCallerByLine(call.line);
      if (!callerNode)
      {
        unresolvedCalls++;
        continue;
      }

      const key = callerNode.id + "->" + calleeNode.id;
      let e = edgeByKey[key];
      if (!e)
      {
        e = {
          s: callerNode,
          t: calleeNode,
          count: 0
        };
        edgeByKey[key] = e;
        edges.push(e);
      }

      e.count++;
      callerNode.out_calls++;
      calleeNode.in_calls++;
    }
  }

  for (let i = 0; i < nodes.length; i++)
  {
    const n = nodes[i];
    const calls = n.out_calls + n.in_calls;
    n.r = 3.5 + Math.sqrt(Math.max(0, calls)) * 1.6;
  }

  return {
    nodes: nodes,
    edges: edges,
    meta: {
      unresolved_calls: unresolvedCalls
    }
  };
}

function start3D(graph, options)
{
  const root = (options && options.root) ? options.root : document.body;

  function getRootSize()
  {
    if (root === document.body)
    {
      return { w: window.innerWidth, h: window.innerHeight };
    }

    const rect = root.getBoundingClientRect();
    return {
      w: Math.max(1, Math.floor(rect.width)),
      h: Math.max(1, Math.floor(rect.height))
    };
  }

  const hudLeft = document.getElementById("hud_left");
  const hudCenter = document.getElementById("hud_center");
  const hudRight = document.getElementById("hud_right");
  const hudVars = document.getElementById("hud_vars");
  const hudVarsWrap = document.getElementById("hud_vars_wrap");
  const hudVarsMiniCanvas = document.getElementById("hud_vars_minimap_canvas");
  const hudVarsMiniCtx = hudVarsMiniCanvas ? hudVarsMiniCanvas.getContext("2d") : null;
  const mmCanvas = document.getElementById("minimap_canvas");
  const mmCtx = mmCanvas ? mmCanvas.getContext("2d") : null;

  function resizeVarsMinimap()
  {
    if (!hudVarsMiniCanvas || !hudVars) return;

    // Match the visible list height; keep backing store in device pixels.
    const cssH = Math.max(1, hudVars.clientHeight);
    const dpr = window.devicePixelRatio || 1;

    hudVarsMiniCanvas.width = Math.floor(26 * dpr);
    hudVarsMiniCanvas.height = Math.floor(cssH * dpr);

    // Ensure CSS size stays consistent with the lane.
    hudVarsMiniCanvas.style.width = "26px";
    hudVarsMiniCanvas.style.height = cssH + "px";

    if (hudVarsMiniCtx) hudVarsMiniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const domainFunctions = document.getElementById("domain_functions");
  const domainRuntime = document.getElementById("domain_runtime");
  const view3d = document.getElementById("view_3d");
  const viewList = document.getElementById("view_list");
  const listPanel = document.getElementById("listpanel");
  const runtimePanel = document.getElementById("runtimepanel");
  const listEl = document.getElementById("list");
  const listMeta = document.getElementById("listmeta");
  const searchEl = document.getElementById("search");
  const rtControls = document.getElementById("runtime_controls");
  const rtPrev = document.getElementById("rt_prev");
  const rtPlay = document.getElementById("rt_play");
  const rtNext = document.getElementById("rt_next");
  const rtStepLabel = document.getElementById("rt_step");
  const rtSpeed = document.getElementById("rt_speed");
  const rtInfo = document.getElementById("rt_info");
  const rtStepsEl = document.getElementById("rt_steps");
  const rtMainLabel = document.getElementById("rt_main_label");
  const rtShowInactiveEl = document.getElementById("rt_show_inactive");
  const rtShowArgNodesEl = document.getElementById("rt_show_arg_nodes");
  
  const fnModalBackdrop = document.getElementById("fn_modal_backdrop");
  const fnModalTitle = document.getElementById("fn_modal_title");
  const fnModalBody = document.getElementById("fn_modal_body");
  const fnModalClose = document.getElementById("fn_modal_close");
  const fnModalBtnShow3d = document.getElementById("fn_modal_btn_show3d");
  const fnModalBtnSetMain = document.getElementById("fn_modal_btn_setmain");
  const fnModalBtnResetRt = document.getElementById("fn_modal_btn_resetrt");

  const varModalBackdrop = document.getElementById("var_modal_backdrop");
  const varModalTitle = document.getElementById("var_modal_title");
  const varModalBody = document.getElementById("var_modal_body");
  const varModalClose = document.getElementById("var_modal_close");

  let fnModalCurrentName = "";

  let domainMode = "functions";
  let viewMode = "3d";

  const scene = new THREE.Scene();

  // Dev hook: temporary fog disable.
  // Toggle in DevTools: window.__FG_NO_FOG = true|false
  // Default is ON (fog disabled) for this patch.
  if (typeof window !== "undefined" && window.__FG_NO_FOG == null)
  {
    window.__FG_NO_FOG = true;
  }
  scene.fog = new THREE.Fog(0x0b0f14, 800, 2600);

  function updateFog()
  {

    // Dev hook: temporary fog disable (reversible, part A).
    // Toggle in DevTools: window.__FG_NO_FOG = true|false
    // When disabling fog, we cache the previous fog so it can be restored.
    if (typeof window !== "undefined")
    {
      // Cache slot lives on window so it survives hot reloads.
      if (window.__FG_FOG_SAVED == null) window.__FG_FOG_SAVED = null;

      if (window.__FG_NO_FOG)
      {
        if (scene)
        {
          // Save existing fog exactly once while we disable.
          if (!window.__FG_FOG_SAVED && scene.fog)
          {
            const f = scene.fog;
            window.__FG_FOG_SAVED = {
              kind: (f && f.isFogExp2) ? "exp2" : "linear",
              color: (f && f.color) ? f.color.getHex() : 0x000000,
              near: (typeof f.near === "number") ? f.near : 1,
              far: (typeof f.far === "number") ? f.far : 2000,
              density: (typeof f.density === "number") ? f.density : 0.002
            };
          }

          // Disable fog.
          if (scene.fog) scene.fog = null;
        }
        return;
      }
    }

    // Dev hook restore (part B).
    // If fog was disabled and user turns it back on, restore what we cached.
    if (typeof window !== "undefined" && !window.__FG_NO_FOG)
    {
      if (scene && !scene.fog && window.__FG_FOG_SAVED)
      {
        const s = window.__FG_FOG_SAVED;
        if (s.kind === "exp2")
        {
          scene.fog = new THREE.FogExp2(s.color, s.density);
        }
        else
        {
          scene.fog = new THREE.Fog(s.color, s.near, s.far);
        }

        // Clear cache after restore so later updates behave normally.
        window.__FG_FOG_SAVED = null;
      }
    }
    const d = camera.position.distanceTo(controls.target);
    const near = Math.max(320, d * 0.55);
    const far = Math.max(near + 500, d * 1.85);
    scene.fog.near = near;
    scene.fog.far = far;
  }

  const camera = new THREE.PerspectiveCamera(
    60,
    getRootSize().w / getRootSize().h,
    0.1,
    10000
  );
  camera.position.set(0, 0, 900);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const initialSize = getRootSize();
  renderer.setSize(initialSize.w, initialSize.h);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  root.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;

  const lightA = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(lightA);

  const lightB = new THREE.DirectionalLight(0xffffff, 1.2);
  lightB.position.set(1, 1, 1);
  scene.add(lightB);

  // Fill light to reduce harsh falloff
  const lightC = new THREE.DirectionalLight(0xffffff, 0.6);
  lightC.position.set(-1, -0.6, -0.8);
  scene.add(lightC);

  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x4fb3ff });
  const hoverMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff });
  const selMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const rtActiveMat = new THREE.MeshStandardMaterial({ color: 0xffd54f });
  const rtCalleeMat = new THREE.MeshStandardMaterial({ color: 0xff8a65 });

  // Runtime/3D: signature argument nodes (unique by name)
  // These come ONLY from static `inputs.args`.
  const argNodes = []; // { name, owners, x,y,z,vx,vy,vz,r,mesh,target,_scale }
  const argNodeByName = Object.create(null);

  // Runtime/3D: runtime/callsite token nodes (unique by name)
  // These come ONLY from callsite `args_preview` lexical tokens.
  // Patch 6 (Future Hook): token nodes may later be value-bound strictly by runtime evidence.
  // No value inference or visualization is allowed in this patch series.
  const tokenNodes = []; // { name, owners, x,y,z,vx,vy,vz,r,mesh,target,_scale,value }
  const tokenNodeByName = Object.create(null);

  // One toggle controls showing BOTH args + tokens (still separate visuals).
  let rtShowArgNodes = true;

  // Visual type separation:
  // - signature args: purple, normal size
  // - runtime tokens: teal, 0.8x size (smaller than purple cubes)
  const argMat = new THREE.MeshStandardMaterial({ color: 0xb400ff });
  const tokenMat = new THREE.MeshStandardMaterial({ color: 0x00c2c7 });
  // Patch update: teal token cubes should be smaller than purple args.
  const TOKEN_SCALE = 0.80;

  function makeLabelSprite(text, opts)
  {
    const o = opts || {};
    const fontSize = o.fontSize || 18;
    const padX = o.padX || 10;
    const padY = o.padY || 6;
    const bg = (o.bg != null) ? o.bg : "rgba(0,0,0,0.65)";
    const fg = o.fg || "#ffffff";
    const radius = o.radius || 8;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const font = fontSize + "px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.font = font;

    const s = String(text || "");
    const tw = Math.ceil(ctx.measureText(s).width);
    const w = tw + padX * 2;
    const h = fontSize + padY * 2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;

    function rr(x, y, ww, hh, r)
    {
      const rr = Math.min(r, ww * 0.5, hh * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + ww, y, x + ww, y + hh, rr);
      ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
      ctx.arcTo(x, y + hh, x, y, rr);
      ctx.arcTo(x, y, x + ww, y, rr);
      ctx.closePath();
    }

    rr(0, 0, w, h, radius);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    ctx.fillText(s, padX, h * 0.5);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);

    // World scale: tune to your scene size
    const worldScale = o.worldScale || 0.55;
    spr.scale.set(w * worldScale, h * worldScale, 1);

    // Store base scale so we can dynamically scale labels with zoom.
    spr.userData = spr.userData || {};
    spr.userData.baseScale = {
      x: spr.scale.x,
      y: spr.scale.y,
      z: spr.scale.z
    };

    return spr;
  }

  // Force runtime highlight node materials to be fully opaque.
  // (If a shared material ever becomes transparent/low-alpha, all nodes using it will look "dim".)
  rtActiveMat.transparent = false;
  rtActiveMat.opacity = 1;
  rtCalleeMat.transparent = false;
  rtCalleeMat.opacity = 1;

  const meshes = [];
  for (let i = 0; i < graph.nodes.length; i++)
  {
    const n = graph.nodes[i];
    const geo = new THREE.SphereGeometry(n.r, 16, 12);
    const mesh = new THREE.Mesh(geo, nodeMat);
    mesh.userData.baseScale = 1;
    mesh.position.set(n.x, n.y, n.z);
    mesh.userData.node = n;
    n.mesh = mesh;
    meshes.push(mesh);
    scene.add(mesh);

    const fnLabel = makeLabelSprite(n.name, {
      fontSize: 18,
      worldScale: 0.55,
      bg: "rgba(11,15,20,0.78)",
      fg: "#ffffff",
      radius: 10
    });
    fnLabel.position.set(0, n.r + 10, 0);
    mesh.add(fnLabel);
    mesh.userData.labelSprite = fnLabel;
  }


  const nodeById = Object.create(null);
  for (let i = 0; i < graph.nodes.length; i++)
  {
    nodeById[graph.nodes[i].id] = graph.nodes[i];
  }

  function pickMainNode()
  {
    let best = null;
    for (let i = 0; i < graph.nodes.length; i++)
    {
      const n = graph.nodes[i];
      if (!best) best = n;
      else if (n.out_calls > best.out_calls) best = n;
      else if (n.out_calls === best.out_calls)
      {
        const nt = n.in_calls + n.out_calls;
        const bt = best.in_calls + best.out_calls;
        if (nt > bt) best = n;
      }
    }
    return best;
  }

  const listModel = graph.nodes.slice().sort(function(a, b)
  {
    // Most connected first
    const ca = (a.in_calls + a.out_calls);
    const cb = (b.in_calls + b.out_calls);
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name);
  });

  // Fat edges: cylinders between nodes (radius scales with edge weight)
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x8aa1b1, transparent: true, opacity: 0.55 });
  const edgeMeshes = [];

  function edgeRadius(w)
  {
    const ww = (typeof w === "number") ? w : 1;
    return 0.25 + Math.min(2.6, ww * 0.28);
  }

  function edgeOpacity(w)
  {
    const ww = (typeof w === "number") ? w : 1;
    return 0.18 + Math.min(0.70, ww * 0.06);
  }

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const qa = new THREE.Quaternion();

  function buildEdgeMeshes()
  {
    for (let i = 0; i < graph.edges.length; i++)
    {
      const e = graph.edges[i];
      const r = edgeRadius(e.count);

      // Placeholder height; we scale Y each frame to match actual length
      const geo = new THREE.CylinderGeometry(r, r, 1, 10, 1, true);
      const mat = edgeMat.clone();
      mat.opacity = edgeOpacity(e.count);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.edge = e;
      e.mesh = mesh;
      edgeMeshes.push(mesh);
      scene.add(mesh);
    }
  }

  function updateEdgeMeshes()
  {
    for (let i = 0; i < graph.edges.length; i++)
    {
      const e = graph.edges[i];
      const m = e.mesh;
      if (!m) continue;

      const ax = e.s.x;
      const ay = e.s.y;
      const az = e.s.z;
      const bx = e.t.x;
      const by = e.t.y;
      const bz = e.t.z;

      dir.set(bx - ax, by - ay, bz - az);
      const len = dir.length();
      if (len < 0.0001) continue;

      mid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
      m.position.copy(mid);

      // Orient cylinder's Y axis to the direction
      dir.normalize();
      qa.setFromUnitVectors(up, dir);
      m.quaternion.copy(qa);

      // CylinderGeometry height is 1; scale Y to actual length
      m.scale.set(1, len, 1);
    }
  }

  buildEdgeMeshes();

  // Edge adjacency: quickly compute the number of connections between two nodes
  const edgeCountByPair = Object.create(null);
  for (let i = 0; i < graph.edges.length; i++)
  {
    const e = graph.edges[i];
    const k1 = e.s.id + "->" + e.t.id;
    edgeCountByPair[k1] = e.count || 1;
  }

  // Build runtime call steps by inverting the existing invoke_list callsites.
  // invoke_list lives on the CALLEE; invoke.line points at the CALLSITE in the caller.
  const outgoingByCaller = Object.create(null);
  const funcByName = Object.create(null);
  for (let i = 0; i < (DATA.functions || []).length; i++)
  {
    const f = DATA.functions[i];
    if (f && f.function_name) funcByName[f.function_name] = f;
  }

  // Build unique argument nodes from static function inputs
  (function buildArgNodes()
  {
    const funcs = (DATA && Array.isArray(DATA.functions)) ? DATA.functions : [];
    for (let i = 0; i < funcs.length; i++)
    {
      const f = funcs[i];
      const fnName = f ? f.function_name : "";
      const args = (f && f.inputs && Array.isArray(f.inputs.args)) ? f.inputs.args : [];
      if (!fnName || !args.length) continue;

      for (let k = 0; k < args.length; k++)
      {
        const nm = String(args[k] || "");
        if (!nm) continue;

        let an = argNodeByName[nm];
        if (!an)
        {
          an = {
            name: nm,
            owners: Object.create(null),
            x: (Math.random() - 0.5) * 200,
            y: (Math.random() - 0.5) * 200,
            z: (Math.random() - 0.5) * 200,
            vx: 0,
            vy: 0,
            vz: 0,
            r: 4.0,
            mesh: null,
            target: { x: 0, y: 0, z: 0 },
            _scale: 1.0
          };
          argNodeByName[nm] = an;
          argNodes.push(an);
        }

        an.owners[fnName] = true;
      }
    }

    // Also build runtime token nodes from callsite args_preview so we can show
    function extractCallsiteNames(argsPreview)
    {
      const out = [];
      const s = String(argsPreview || "");
      if (!s) return out;

      const toks = s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];

      const stop = {
        "true":1,"false":1,"none":1,"null":1,
        "and":1,"or":1,"not":1,"in":1,"is":1,
        "for":1,"while":1,"if":1,"else":1,"elif":1,
        "return":1,"break":1,"continue":1,
        "int":1,"float":1,"str":1,"list":1,"dict":1,"set":1,"tuple":1,
        "min":1,"max":1,"abs":1,"len":1,"range":1,"print":1
      };

      for (let i = 0; i < toks.length; i++)
      {
        const t = toks[i];
        const tl = t.toLowerCase();
        if (stop[tl]) continue;
        if (t.length <= 1) continue;
        out.push(t);
      }

      return out;
    }

    // Helper to find caller node by line (for arg nodes), decoupled from spansForCaller/findCallerNodeByLine
    function findCallerNodeByLineFromGraph(line)
    {
      if (typeof line !== "number") return null;

      const spans = graph.nodes.slice().sort(function(a, b)
      {
        if (a.start_line !== b.start_line) return a.start_line - b.start_line;
        return a.end_line - b.end_line;
      });

      let lo = 0;
      let hi = spans.length - 1;
      let bestIdx = -1;

      while (lo <= hi)
      {
        const mid = (lo + hi) >> 1;
        const s = spans[mid].start_line;
        if (s <= line)
        {
          bestIdx = mid;
          lo = mid + 1;
        }
        else hi = mid - 1;
      }

      if (bestIdx < 0) return null;

      let best = null;
      for (let i = bestIdx; i >= 0; i--)
      {
        const n = spans[i];
        if (n.start_line > line) continue;
        if (n.end_line < line) break;

        if (!best) best = n;
        else
        {
          const bestSize = best.end_line - best.start_line;
          const nSize = n.end_line - n.start_line;
          if (nSize < bestSize) best = n;
        }
      }

      return best;
    }

    // Harvest caller-side names from invoke_list args_preview.
    for (let i = 0; i < funcs.length; i++)
    {
      const calleeFn = funcs[i];
      const inv = (calleeFn && calleeFn.invokes && Array.isArray(calleeFn.invokes.invoke_list))
        ? calleeFn.invokes.invoke_list
        : [];

      for (let k = 0; k < inv.length; k++)
      {
        const call = inv[k];
        const callerNode = findCallerNodeByLineFromGraph(call.line);
        const callerName = callerNode ? callerNode.id : "";
        if (!callerName) continue;

        const names = extractCallsiteNames(call.args_preview);
        for (let j = 0; j < names.length; j++)
        {
          const nm = String(names[j] || "");
          if (!nm) continue;

          // Non-destructive classification (structural only):
          // If a name exists as a signature arg, it must NEVER become a token.
          if (argNodeByName[nm])
          {
            continue;
          }

          let tn = tokenNodeByName[nm];
          if (!tn)
          {
            tn = {
              name: nm,
              owners: Object.create(null),
              x: (Math.random() - 0.5) * 200,
              y: (Math.random() - 0.5) * 200,
              z: (Math.random() - 0.5) * 200,
              vx: 0,
              vy: 0,
              vz: 0,
              r: 4.0,
              mesh: null,
              target: { x: 0, y: 0, z: 0 },
              _scale: 1.0,

              // Patch 6 (Future Hook): value binding is a future capability.
              // This placeholder must remain null/empty unless runtime evidence explicitly supplies it.
              value: {
                kind: null,        // e.g. "scalar" | "array" | "image" (future)
                source: null,      // e.g. "runtime" (future)
                step_index: null,  // which runtime step first bound this value (future)
                preview: null      // short string preview only (future)
              }
            };
            tokenNodeByName[nm] = tn;
            tokenNodes.push(tn);
          }

          tn.owners[callerName] = true;
        }
      }
    }
  })();

  // Create meshes for signature argument nodes (purple cubes)
  for (let i = 0; i < argNodes.length; i++)
  {
    const a = argNodes[i];
    const s = 6;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mesh = new THREE.Mesh(geo, argMat);
    mesh.userData.argNode = a;
    mesh.position.set(a.x, a.y, a.z);
    mesh.visible = false; // only visible in Runtime/3D when enabled
    a.mesh = mesh;
    scene.add(mesh);

    const argLabel = makeLabelSprite(a.name, {
      fontSize: 16,
      worldScale: 0.45,
      bg: "rgba(0,0,0,0.70)",
      fg: "#ffffff",
      radius: 10
    });
    argLabel.position.set(0, 10, 0);
    mesh.add(argLabel);
    mesh.userData.labelSprite = argLabel;
  }

  // Create meshes for runtime/callsite token nodes (teal cubes, 1.4x larger)
  for (let i = 0; i < tokenNodes.length; i++)
  {
    const t = tokenNodes[i];
    const s = 6 * TOKEN_SCALE;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mesh = new THREE.Mesh(geo, tokenMat);
    mesh.userData.tokenNode = t;
    mesh.position.set(t.x, t.y, t.z);
    mesh.visible = false; // only visible in Runtime/3D when enabled
    t.mesh = mesh;
    scene.add(mesh);

    const tokLabel = makeLabelSprite(t.name, {
      fontSize: 16,
      worldScale: 0.45,
      bg: "rgba(0,0,0,0.70)",
      fg: "#ffffff",
      radius: 10
    });
    tokLabel.position.set(0, 10, 0);
    mesh.add(tokLabel);
    mesh.userData.labelSprite = tokLabel;
  }

  // --- data links: line segments from arg/token cubes to owning function nodes ---
  const argLinks = [];   // { a: argNode, n: functionNode }
  const tokenLinks = []; // { t: tokenNode, n: functionNode }

  for (let i = 0; i < argNodes.length; i++)
  {
    const a = argNodes[i];
    for (const fn in a.owners)
    {
      const n = nodeById[fn];
      if (!n) continue;
      argLinks.push({ a: a, n: n });
    }
  }

  for (let i = 0; i < tokenNodes.length; i++)
  {
    const t = tokenNodes[i];
    for (const fn in t.owners)
    {
      const n = nodeById[fn];
      if (!n) continue;
      tokenLinks.push({ t: t, n: n });
    }
  }

  let argLinkLine = null;
  let argLinkPos = null;

  let tokenLinkLine = null;
  let tokenLinkPos = null;

  if (argLinks.length)
  {
    argLinkPos = new Float32Array(argLinks.length * 2 * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(argLinkPos, 3));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.LineBasicMaterial({
      color: 0xb400ff,
      transparent: true,
      opacity: 0.25
    });

    argLinkLine = new THREE.LineSegments(geo, mat);
    argLinkLine.visible = false;
    scene.add(argLinkLine);
  }

  if (tokenLinks.length)
  {
    tokenLinkPos = new Float32Array(tokenLinks.length * 2 * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(tokenLinkPos, 3));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.LineBasicMaterial({
      color: 0x00c2c7,
      transparent: true,
      opacity: 0.22
    });

    tokenLinkLine = new THREE.LineSegments(geo, mat);
    tokenLinkLine.visible = false;
    scene.add(tokenLinkLine);
  }

  function updateArgLinkLines()
  {
    if (argLinkLine && argLinkPos)
    {
      for (let i = 0; i < argLinks.length; i++)
      {
        const L = argLinks[i];
        const a = L.a;
        const n = L.n;

        const o = i * 6;
        argLinkPos[o + 0] = a.x;
        argLinkPos[o + 1] = a.y;
        argLinkPos[o + 2] = a.z;

        argLinkPos[o + 3] = n.x;
        argLinkPos[o + 4] = n.y;
        argLinkPos[o + 5] = n.z;
      }

      argLinkLine.geometry.attributes.position.needsUpdate = true;
    }

    if (tokenLinkLine && tokenLinkPos)
    {
      for (let i = 0; i < tokenLinks.length; i++)
      {
        const L = tokenLinks[i];
        const t = L.t;
        const n = L.n;

        const o = i * 6;
        tokenLinkPos[o + 0] = t.x;
        tokenLinkPos[o + 1] = t.y;
        tokenLinkPos[o + 2] = t.z;

        tokenLinkPos[o + 3] = n.x;
        tokenLinkPos[o + 4] = n.y;
        tokenLinkPos[o + 5] = n.z;
      }

      tokenLinkLine.geometry.attributes.position.needsUpdate = true;
    }
  }

  // Runtime: track "touched" data names as we step (heuristic).
  const touched = Object.create(null); // name -> { count, first_line, last_step, order }
  let touchOrder = 0;
  let touchedThisStep = Object.create(null);
  let freezeTouchCounts = false;
  let rtShowInactiveVars = true;

  function resetTouched()
  {
    for (const k in touched) delete touched[k];
    if (hudVars) hudVars.innerHTML = "";
    const hudVarsMini = document.getElementById("hud_vars_minimap");
    if (hudVarsMini) hudVarsMini.style.display = "none";
    touchedThisStep = Object.create(null);
    touchOrder = 0;
    freezeTouchCounts = false;
  }

  function addTouch(name, line, kind)
  {
    if (!name) return;

    if (!touched[name])
    {
      touched[name] = {
        count: 0,
        first_line: line,
        last_step: rtIndex,
        order: touchOrder++,
        kinds: Object.create(null)
      };
    }

    if (kind) touched[name].kinds[kind] = true;

    if (!freezeTouchCounts) touched[name].count++;
    touched[name].last_step = rtIndex;
    if (!touched[name].first_line) touched[name].first_line = line;

    touchedThisStep[name] = (touchedThisStep[name] || 0) + 1;
  }

  function extractNamesFromArgs(argsPreview)
  {
    const out = [];
    const s = String(argsPreview || "");
    if (!s) return out;

    // Grab identifier-ish tokens.
    const toks = s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];

    // Filter obvious noise / keywords / common builtins.
    const stop = {
      "true":1,"false":1,"none":1,"null":1,
      "and":1,"or":1,"not":1,"in":1,"is":1,
      "for":1,"while":1,"if":1,"else":1,"elif":1,
      "return":1,"break":1,"continue":1,
      "int":1,"float":1,"str":1,"list":1,"dict":1,"set":1,"tuple":1,
      "min":1,"max":1,"abs":1,"len":1,"range":1,"print":1
    };

    for (let i = 0; i < toks.length; i++)
    {
      const t = toks[i];
      const tl = t.toLowerCase();
      if (stop[tl]) continue;
      if (t.length <= 1) continue;
      out.push(t);
    }

    return out;
  }

  function normalizeTouchedName(s)
  {
    const str = String(s || "");
    if (!str) return "";

    // Return the first identifier-ish token from any string.
    // Examples:
    //   buckets_phys[q] -> buckets_phys
    //   meta['x']       -> meta
    //   obj.attr        -> obj
    const m = str.match(/[A-Za-z_][A-Za-z0-9_]*/);
    return m ? m[0] : "";
  }

  function touchFromStep(step)
  {
    if (!step) return;
    touchedThisStep = Object.create(null);

    const calleeFn = funcByName[step.callee];


    // 1) Callee inputs (var-ish)
    if (calleeFn && calleeFn.inputs && Array.isArray(calleeFn.inputs.args))
    {
      const args = calleeFn.inputs.args;
      for (let i = 0; i < args.length; i++) addTouch(args[i], step.line, "input");
    }

    // 2) Callee locals (var-ish)
    if (calleeFn && calleeFn.locals && Array.isArray(calleeFn.locals.local_vars))
    {
      const lvars = calleeFn.locals.local_vars;
      for (let i = 0; i < lvars.length; i++) addTouch(lvars[i], step.line, "local");
    }

    // 3) Names seen in args preview (existing behavior)
    const names = extractNamesFromArgs(step.args_preview);
    for (let i = 0; i < names.length; i++)
    {
      const nm = names[i];
      if (!nm) continue;

      // Patch 5 (Structural Truth Rule):
      // Do not infer meaning/type from name matches.
      // Only mark what the JSON structurally declares or the runtime/callsite reveals.
      // Patch 2 stays in force: signature args remain args.
      if (argNodeByName && argNodeByName[nm])
      {
        addTouch(nm, step.line, "input");
      }
      else
      {
        addTouch(nm, step.line, "token");
      }
    }

    // 4) Writes targets (normalize to base identifier)
    if (calleeFn && calleeFn.writes && calleeFn.writes.none === false)
    {
      const targets = Array.isArray(calleeFn.writes.targets) ? calleeFn.writes.targets : [];
      for (let i = 0; i < targets.length; i++)
      {
        const base = normalizeTouchedName(targets[i]);
        if (base) addTouch(base, step.line, "output");
      }
    }

    // 5) Returns (normalize to base identifier)
    if (calleeFn && calleeFn.returns && calleeFn.returns.none === false)
    {
      const rets = Array.isArray(calleeFn.returns.returns) ? calleeFn.returns.returns : [];
      for (let i = 0; i < rets.length; i++)
      {
        const base = normalizeTouchedName(rets[i]);
        if (base) addTouch(base, step.line, "output");
      }
    }
  }

  function renderTouchedHud()
  {
    if (!hudVars) return;

    function pickKindLabel(kinds)
    {
      const ks = kinds || Object.create(null);
      const order = ["input", "local", "output", "token"];
      for (let i = 0; i < order.length; i++)
      {
        if (ks[order[i]]) return order[i];
      }
      return "token";
    }

    function kindText(k)
    {
      if (k === "input") return "input";
      if (k === "local") return "local";
      if (k === "output") return "output";
      return "token";
    }

    const items = [];

    if (rtShowInactiveVars)
    {
      for (const k in touched)
      {
        if (k.indexOf("[") !== -1) continue;
        if (k.indexOf(".") !== -1) continue;
        if (k.indexOf("(") !== -1) continue;

        items.push({
          name: k,
          count: touched[k].count,
          first_line: touched[k].first_line,
          last_step: touched[k].last_step,
          order: touched[k].order,
          step_count: (touchedThisStep[k] || 0),
          kinds: (touched[k].kinds || Object.create(null)),
          kind: pickKindLabel(touched[k].kinds)
        });
      }

      // Stable order: keep boxes once shown, do not evict.
      items.sort(function(a, b)
      {
        return a.order - b.order;
      });
    }
    else
    {
      for (const k in touchedThisStep)
      {
        if (k.indexOf("[") !== -1) continue;
        if (k.indexOf(".") !== -1) continue;
        if (k.indexOf("(") !== -1) continue;

        const info = touched[k];
        const order = info ? info.order : 999999;
        const first_line = info ? info.first_line : 0;
        const last_step = info ? info.last_step : 0;
        const count = info ? info.count : 0;
        const stepCnt = (touchedThisStep[k] || 0);
        const kinds = info ? (info.kinds || Object.create(null)) : Object.create(null);
        items.push({
          name: k,
          count: count,
          first_line: first_line,
          last_step: last_step,
          order: order,
          step_count: stepCnt,
          kinds: kinds,
          kind: pickKindLabel(kinds)
        });
      }

      // Active-only mode: sort by per-step touch density (desc), then first-seen order.
      items.sort(function(a, b)
      {
        if (b.step_count !== a.step_count) return b.step_count - a.step_count;
        return a.order - b.order;
      });
    }
    const hudVarsMini = document.getElementById("hud_vars_minimap");
    if (hudVarsMini)
    {
      if (!rtShowInactiveVars) hudVarsMini.style.display = "none";
      else hudVarsMini.style.display = items.length ? "block" : "none";
    }

    const parts = [];
    for (let i = 0; i < items.length; i++)
    {
      const it = items[i];
      const isActive = ((touchedThisStep[it.name] || 0) > 0);

      const finished = (freezeTouchCounts && !rtPlaying && rtSteps.length && rtIndex >= rtSteps.length - 1);

      const cls = finished
        ? ("varbox" + (isActive ? " active" : ""))
        : ("varbox " + (isActive ? "active" : "dim"));

      // Render the header with kind pill
      parts.push(
        '<div class="' + cls + '">' +
          '<div class="varhead">' +
            '<div class="varname">' + escapeHtml(it.name) + '</div>' +
            '<div class="varmeta_right">' +
              '<span class="varkind varkind-' + escapeHtml(it.kind) + '">' + escapeHtml(kindText(it.kind)) + '</span>' +
              '<div class="varbadge">' + (rtShowInactiveVars ? it.count : it.step_count) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="varmeta">first line: ' + it.first_line + '</div>' +
        '</div>'
      );
    }

    hudVars.innerHTML = parts.join("");

    // Auto-scroll to keep the most-dense active var in view each step.
    // We pick the touched name with the highest per-step touch count.
    let bestName = "";
    let bestCnt = 0;
    for (const k in touchedThisStep)
    {
      const c = touchedThisStep[k] || 0;
      if (c > bestCnt)
      {
        bestCnt = c;
        bestName = k;
      }
    }

    if (bestName)
    {
      // Query the specific box by matching rendered name text.
      // (List is rebuilt each step; keep it simple and robust.)
      const boxes = hudVars.querySelectorAll('.varbox');
      let target = null;
      for (let i = 0; i < boxes.length; i++)
      {
        const nmEl = boxes[i].querySelector('.varname');
        if (!nmEl) continue;
        if (nmEl.textContent === bestName)
        {
          target = boxes[i];
          break;
        }
      }

      if (target)
      {
        requestAnimationFrame(function()
        {
          target.scrollIntoView({ block: "center", inline: "nearest" });
        });
      }
    }

    if (rtShowInactiveVars)
    {
      resizeVarsMinimap();
      drawVarsMinimap(items);
    }
  }

  function drawVarsMinimap(items)
  {
    if (!hudVarsMiniCtx || !hudVarsMiniCanvas) return;

    const W = 26;
    const H = hudVars.clientHeight;

    hudVarsMiniCtx.clearRect(0, 0, 26, H);

    const n = items.length;
    if (!n) return;

    // Stretch bars from top to bottom, distributing remainder pixels to top bars
    const gap = 2;
    const inner = Math.max(1, H - (n - 1) * gap);
    const barH = Math.max(2, Math.floor(inner / n));
    let rem = Math.max(0, inner - (barH * n));
    const y0 = 0;

    let yPrev = y0;
    for (let i = 0; i < n; i++)
    {
      const it = items[i];
      const isActive = ((touchedThisStep[it.name] || 0) > 0);

      hudVarsMiniCtx.globalAlpha = isActive ? 0.95 : 0.22;
      hudVarsMiniCtx.fillStyle = isActive ? "#ffffff" : "#cfd8dc";

      const extra = (rem > 0) ? 1 : 0;
      if (rem > 0) rem--;

      // Accumulate top-down so the stack fills the lane.
      const y = (i === 0) ? y0 : (yPrev + gap);
      const h = barH + extra;
      hudVarsMiniCtx.fillRect(4, y, W - 8, h);
      yPrev = y + h;
    }

    const sh = hudVars.scrollHeight;
    const ch = hudVars.clientHeight;
    const st = hudVars.scrollTop;

    if (sh > 0 && ch > 0)
    {
      const denom = Math.max(1, (sh - ch));
      const fracTop = st / denom;
      const fracH = ch / Math.max(1, sh);

      // Keep the viewport box fully inside the canvas, accounting for stroke width.
      const pad = 1;
      const innerH = Math.max(1, H - pad * 2);
      const innerW = Math.max(1, W - pad * 2);

      const vh = Math.max(12, Math.min(innerH, Math.floor(fracH * innerH)));
      const vy = pad + Math.max(0, Math.min(innerH - vh, Math.floor(fracTop * (innerH - vh))));

      hudVarsMiniCtx.globalAlpha = 0.70;
      hudVarsMiniCtx.strokeStyle = "#4fb3ff";
      hudVarsMiniCtx.lineWidth = 2;
      hudVarsMiniCtx.strokeRect(pad, vy, innerW, vh);
    }

    hudVarsMiniCtx.globalAlpha = 1;
  }

  const spansForCaller = graph.nodes.slice().sort(function(a, b)
  {
    if (a.start_line !== b.start_line) return a.start_line - b.start_line;
    return a.end_line - b.end_line;
  });

  function findCallerNodeByLine(line)
  {
    // Reuse the same approach as buildGraph, but scoped here for runtime.
    if (typeof line !== "number") return null;

    let lo = 0;
    let hi = spansForCaller.length - 1;
    let bestIdx = -1;

    while (lo <= hi)
    {
      const mid = (lo + hi) >> 1;
      const s = spansForCaller[mid].start_line;
      if (s <= line)
      {
        bestIdx = mid;
        lo = mid + 1;
      }
      else hi = mid - 1;
    }

    if (bestIdx < 0) return null;

    let best = null;
    for (let i = bestIdx; i >= 0; i--)
    {
      const n = spansForCaller[i];
      if (n.start_line > line) continue;
      if (n.end_line < line) break;

      if (!best) best = n;
      else
      {
        const bestSize = best.end_line - best.start_line;
        const nSize = n.end_line - n.start_line;
        if (nSize < bestSize) best = n;
      }
    }

    return best;
  }

  function addOutgoingStep(callerNode, calleeName, call)
  {
    if (!callerNode || !calleeName) return;
    const list = outgoingByCaller[callerNode.id] || [];
    list.push({
      caller: callerNode.id,
      callee: calleeName,
      line: (typeof call.line === "number") ? call.line : 0,
      context: call.context || "single",
      loop_header_preview: call.loop_header_preview || "",
      args_preview: call.args_preview || ""
    });
    outgoingByCaller[callerNode.id] = list;
  }

  for (let i = 0; i < (DATA.functions || []).length; i++)
  {
    const f = DATA.functions[i];
    const inv = (f.invokes && f.invokes.invoke_list) ? f.invokes.invoke_list : [];
    const callee = f.function_name;

    for (let k = 0; k < inv.length; k++)
    {
      const call = inv[k];
      const callerNode = findCallerNodeByLine(call.line);
      addOutgoingStep(callerNode, callee, call);
    }
  }

  for (const k in outgoingByCaller)
  {
    outgoingByCaller[k].sort(function(a, b)
    {
      return a.line - b.line;
    });
  }


  // Picking
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hoverNode = null;
  let selectedNode = null;
  let hoverEdge = null;
  let selectedEdge = null;

  // Runtime/3D label visibility (driven by Show inactive vars)
  let lastLabelMode = null;
  let lastLabelCaller = "";
  let lastLabelCallee = "";

  function syncRuntimeLabelVisibility(step)
  {
    if (!(domainMode === "runtime" && viewMode === "3d")) return;

    const activeOnly = !rtShowInactiveVars;
    const callerId = step ? String(step.caller || "") : "";
    const calleeId = step ? String(step.callee || "") : "";

    if (lastLabelMode === activeOnly &&
        lastLabelCaller === callerId &&
        lastLabelCallee === calleeId)
    {
      return;
    }

    lastLabelMode = activeOnly;
    lastLabelCaller = callerId;
    lastLabelCallee = calleeId;

    // Function node labels
    for (let i = 0; i < graph.nodes.length; i++)
    {
      const n = graph.nodes[i];
      if (!n || !n.mesh) continue;
      const spr = n.mesh.userData ? n.mesh.userData.labelSprite : null;
      if (!spr) continue;

      if (!activeOnly) spr.visible = true;
      else spr.visible = (n.id === callerId || n.id === calleeId);
    }

    // Arg cube labels
    for (let i = 0; i < argNodes.length; i++)
    {
      const a = argNodes[i];
      if (!a || !a.mesh) continue;
      const spr = a.mesh.userData ? a.mesh.userData.labelSprite : null;
      if (!spr) continue;

      // In active-only mode, hide cubes that do not belong to the active caller/callee.
      // This keeps the 3D scene readable (functions stay visible).
      if (a.mesh)
      {
        if (!rtShowArgNodes) a.mesh.visible = false;
        else if (!activeOnly) a.mesh.visible = true;
        else
        {
          const ownedByCallee = !!(calleeId && a.owners && a.owners[calleeId]);
          const ownedByCaller = !!(callerId && a.owners && a.owners[callerId]);
          a.mesh.visible = (ownedByCallee || ownedByCaller);
        }
      }

      if (!activeOnly)
      {
        spr.visible = true;
      }
      else
      {
        const ownedByCallee = !!(calleeId && a.owners && a.owners[calleeId]);
        const ownedByCaller = !!(callerId && a.owners && a.owners[callerId]);
        spr.visible = (ownedByCallee || ownedByCaller);
      }
    }

    // Token cube labels (Patch 3: Active Step Label Guarantee)
    for (let i = 0; i < tokenNodes.length; i++)
    {
      const t = tokenNodes[i];
      if (!t || !t.mesh) continue;
      const spr = t.mesh.userData ? t.mesh.userData.labelSprite : null;
      if (!spr) continue;

      if (t.mesh)
      {
        if (!rtShowArgNodes) t.mesh.visible = false;
        else if (!activeOnly) t.mesh.visible = true;
        else
        {
          const touchedNow = !!(touchedThisStep && touchedThisStep[t.name]);
          const ownedByCallee = !!(calleeId && t.owners && t.owners[calleeId]);
          const ownedByCaller = !!(callerId && t.owners && t.owners[callerId]);
          t.mesh.visible = (touchedNow && (ownedByCallee || ownedByCaller));
        }
      }

      if (!activeOnly)
      {
        spr.visible = true;
      }
      else
      {
        // In active-only mode, ensure any token touched on the CURRENT step
        // shows its label, but only within the current caller/callee context.
        const touchedNow = !!(touchedThisStep && touchedThisStep[t.name]);
        const ownedByCallee = !!(calleeId && t.owners && t.owners[calleeId]);
        const ownedByCaller = !!(callerId && t.owners && t.owners[callerId]);
        spr.visible = (touchedNow && (ownedByCallee || ownedByCaller));
      }
    }
  }

  function setHover(n)
  {
    if (hoverNode === n) return;
    if (hoverNode && hoverNode.mesh)
    {
      if (selectedNode === hoverNode) hoverNode.mesh.material = selMat;
      else hoverNode.mesh.material = nodeMat;
    }
    hoverNode = n;
    if (hoverNode && hoverNode.mesh)
    {
      if (selectedNode === hoverNode) hoverNode.mesh.material = selMat;
      else hoverNode.mesh.material = hoverMat;
    }
  }

  function setSelected(n)
  {
    if (selectedNode && selectedNode.mesh)
    {
      selectedNode.mesh.material = nodeMat;
    }
    selectedNode = n;
    if (selectedNode && selectedNode.mesh)
    {
      selectedNode.mesh.material = selMat;
    }
  }

  function clearRuntimeHighlight()
  {
    for (let i = 0; i < graph.nodes.length; i++)
    {
      const n = graph.nodes[i];
      if (!n.mesh) continue;

      // Preserve hover/selection visuals when in Functions domain.
      if (selectedNode === n) n.mesh.material = selMat;
      else if (hoverNode === n) n.mesh.material = hoverMat;
      else n.mesh.material = nodeMat;

      if (n.mesh.userData && typeof n.mesh.userData.baseScale === "number")
      {
        const bs = n.mesh.userData.baseScale;
        n.mesh.scale.set(bs, bs, bs);
      }
    }

    for (let i = 0; i < graph.edges.length; i++)
    {
      const e = graph.edges[i];
      if (!e.mesh) continue;
      if (e.mesh.userData)
      {
        if (e.mesh.userData.baseOpacity != null)
        {
          e.mesh.material.opacity = e.mesh.userData.baseOpacity;
        }
        if (e.mesh.userData.baseColor != null && e.mesh.material && e.mesh.material.color)
        {
          e.mesh.material.color.setHex(e.mesh.userData.baseColor);
        }
      }
    }
  }

  function applyRuntimeHighlight(step)
  {
    if (!step) return;

    const caller = nodeById[step.caller];
    const callee = nodeById[step.callee];

    if (caller && caller.mesh)
    {
      caller.mesh.material = rtActiveMat;
      if (caller.mesh.material)
      {
        caller.mesh.material.transparent = false;
        caller.mesh.material.opacity = 1;
      }
    }

    if (callee && callee.mesh)
    {
      callee.mesh.material = rtCalleeMat;
      if (callee.mesh.material)
      {
        callee.mesh.material.transparent = false;
        callee.mesh.material.opacity = 1;
      }
    }

    // Edge highlight if present
    for (let i = 0; i < graph.edges.length; i++)
    {
      const e = graph.edges[i];
      if (e.s.id === step.caller && e.t.id === step.callee)
      {
        if (e.mesh)
        {
          if (e.mesh.userData && e.mesh.userData.baseOpacity == null)
          {
            e.mesh.userData.baseOpacity = e.mesh.material.opacity;
          }
          if (e.mesh.userData && e.mesh.userData.baseColor == null && e.mesh.material && e.mesh.material.color)
          {
            e.mesh.userData.baseColor = e.mesh.material.color.getHex();
          }

          // Blink: make ONLY the active runtime edge bright.
          const pulse = 0.5 + (Math.sin(rtPulseT) * 0.5);
          if (e.mesh.material && e.mesh.material.color)
          {
            e.mesh.material.color.setHex(0xffffff);
          }
          e.mesh.material.transparent = true;
          e.mesh.material.opacity = Math.min(0.995, (e.mesh.userData.baseOpacity || 0.55) + 0.25 + pulse * 0.35);
        }
        break;
      }
    }
  }
  // Runtime playback (logic trace) state
  let rtMain = null;
  let rtMainOverrideName = "";
  let rtSteps = [];
  let rtIndex = 0;
  let rtPlaying = false;
  let rtAccum = 0;
  let rtPulseT = 0;
  let rtAutoPlayedOnce = false;
  let rtActiveSide = "caller";

  function buildRuntimeSteps()
  {
    // Sync runtime var-filter flag from UI
    rtShowInactiveVars = rtShowInactiveEl ? !!rtShowInactiveEl.checked : true;
    // Sync arg-nodes flag from UI
    rtShowArgNodes = rtShowArgNodesEl ? !!rtShowArgNodesEl.checked : true;
    if (rtMainOverrideName && nodeById[rtMainOverrideName])
    {
      rtMain = nodeById[rtMainOverrideName];
    }
    else
    {
      rtMain = pickMainNode();
    }
    resetTouched();

    // Expand a deterministic call trace by recursively following callees.
    // This is a logic playback (not real execution). We use line order within each function.
    const maxDepth = 3;
    const maxSteps = 2500;

    function expandTrace(fnName, depth, stackSet)
    {
      if (!fnName) return [];
      if (depth > maxDepth) return [];
      if (stackSet[fnName]) return [];

      const steps = [];
      const calls = outgoingByCaller[fnName] || [];
      if (!calls.length) return steps;

      stackSet[fnName] = true;

      for (let i = 0; i < calls.length; i++)
      {
        const c = calls[i];
        steps.push({
          kind: "call",
          caller: c.caller,
          callee: c.callee,
          line: c.line,
          context: c.context,
          loop_header_preview: c.loop_header_preview,
          args_preview: c.args_preview,
          depth: depth
        });

        // Dive into callee
        const nextStack = Object.create(null);
        for (const k in stackSet) nextStack[k] = true;
        const sub = expandTrace(c.callee, depth + 1, nextStack);
        for (let k = 0; k < sub.length; k++) steps.push(sub[k]);

        if (steps.length >= maxSteps) break;
      }

      return steps;
    }

    rtSteps = (rtMain) ? expandTrace(rtMain.id, 0, Object.create(null)) : [];
    rtIndex = 0;
    rtPlaying = false;
    rtAccum = 0;
    rtAutoPlayedOnce = false;
    freezeTouchCounts = false;

    if (rtInfo)
    {
      if (!rtMain) rtInfo.textContent = "No functions available.";
      else
      {
        rtInfo.textContent = "Main: " + rtMain.id + "  (lines " + rtMain.start_line + "-" + rtMain.end_line + ")";
      }
    }

    // P4: Set the rt main label text when runtime steps build
    if (rtMainLabel)
    {
      if (!rtMain) rtMainLabel.textContent = "";
      else rtMainLabel.textContent = "Main: " + rtMain.id + "  (" + rtMain.start_line + "-" + rtMain.end_line + ")";
    }

    // After setting rtMainLabel, keep override and label consistent
    if (rtMainOverrideName && rtMain && rtMain.id !== rtMainOverrideName)
    {
      rtMainOverrideName = "";
    }

    renderRuntimeList();
    updateRuntimeControls();
  }

  function updateRuntimeControls()
  {
    if (!rtStepLabel) return;
    const total = rtSteps.length;
    const idxHuman = total ? (rtIndex + 1) : 0;
    rtStepLabel.textContent = idxHuman + " / " + total;
    rtPlay.textContent = rtPlaying ? "Pause" : "Play";
  }

  function renderRuntimeList()
  {
    if (!rtStepsEl) return;

    const parts = [];
    for (let i = 0; i < rtSteps.length; i++)
    {
      const s = rtSteps[i];
      const cls = (i === rtIndex) ? "rtrow active" : "rtrow";
      const indent = Math.max(0, (s.depth || 0)) * 14;
      const txt = "CALL " + s.callee + "(" + (s.args_preview || "") + ")";
      parts.push(
        '<div class="' + cls + '" data-rt="' + i + '">' +
          '<div class="ln">line ' + s.line + '</div>' +
          '<div class="txt" style="padding-left:' + indent + 'px">' + escapeHtml(txt) + '</div>' +
        '</div>'
      );
    }

    if (!parts.length)
    {
      parts.push('<div style="opacity:0.85">No steps found for main function. (No callsites resolved.)</div>');
    }

    rtStepsEl.innerHTML = parts.join("");
  }

  function clampRtIndex()
  {
    if (rtIndex < 0) rtIndex = 0;
    if (rtIndex > rtSteps.length - 1) rtIndex = Math.max(0, rtSteps.length - 1);
  }

  function setRtIndex(i)
  {
    rtIndex = i;
    clampRtIndex();
    touchFromStep(rtSteps[rtIndex]);
    renderTouchedHud();
    syncRuntimeLabelVisibility(rtSteps[rtIndex]);
    renderRuntimeList();
    updateRuntimeControls();
    rtAccum = 0.9 * 0.75;
    rtActiveSide = "callee";
  }

  function stepRt(delta)
  {
    if (!rtSteps.length) return;
    const n = rtSteps.length;
    rtIndex += delta;

    // Wrap instead of clamping.
    if (rtIndex < 0) rtIndex = n - 1;
    if (rtIndex >= n) rtIndex = 0;

    // If we ever complete a full run (hit the end), freeze counts on subsequent loops.
    if (n && rtIndex === 0 && delta > 0) freezeTouchCounts = true;

    touchFromStep(rtSteps[rtIndex]);
    renderTouchedHud();
    syncRuntimeLabelVisibility(rtSteps[rtIndex]);
    renderRuntimeList();
    updateRuntimeControls();
    rtAccum = 0.9 * 0.75;
    rtActiveSide = "callee";
  }

  function fmtNode(n)
  {
    if (!n) return "";
    const a = [];
    a.push(n.name);
    a.push("lines: " + n.start_line + "-" + n.end_line);
    a.push("calls out: " + n.out_calls + " | calls in: " + n.in_calls);
    return a.join("\n");
  }

  // ---- Minimap helpers ----

  function minimapBounds(nodes)
  {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < nodes.length; i++)
    {
      const n = nodes[i];
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    if (!isFinite(minX) || !isFinite(minY))
    {
      minX = -1; maxX = 1; minY = -1; maxY = 1;
    }

    // pad
    const padX = (maxX - minX) * 0.08 + 10;
    const padY = (maxY - minY) * 0.08 + 10;

    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY
    };
  }

  function drawMinimap()
  {
    if (!mmCtx) return;

    const W = mmCanvas.width;
    const H = mmCanvas.height;

    mmCtx.clearRect(0, 0, W, H);

    const b = minimapBounds(graph.nodes);
    const sx = (W - 12) / Math.max(1, (b.maxX - b.minX));
    const sy = (H - 12) / Math.max(1, (b.maxY - b.minY));

    function px(x)
    {
      return 6 + (x - b.minX) * sx;
    }

    function py(y)
    {
      // canvas y is down
      return 6 + (b.maxY - y) * sy;
    }

    // faint edges
    mmCtx.globalAlpha = 0.20;
    mmCtx.strokeStyle = "#8aa1b1";
    mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    for (let i = 0; i < graph.edges.length; i++)
    {
      const e = graph.edges[i];
      mmCtx.moveTo(px(e.s.x), py(e.s.y));
      mmCtx.lineTo(px(e.t.x), py(e.t.y));
    }
    mmCtx.stroke();

    // determine active nodes for runtime
    let activeCaller = null;
    let activeCallee = null;
    if (domainMode === "runtime" && viewMode === "3d" && rtSteps.length)
    {
      const st = rtSteps[rtIndex];
      activeCaller = st ? st.caller : null;
      activeCallee = st ? st.callee : null;
    }

    // nodes
    for (let i = 0; i < graph.nodes.length; i++)
    {
      const n = graph.nodes[i];
      const x = px(n.x);
      const y = py(n.y);

      let fill = "#4fb3ff";
      let a = 0.55;

      if (selectedNode === n) { fill = "#ffffff"; a = 0.95; }
      else if (hoverNode === n) { fill = "#cfe8ff"; a = 0.95; }

      if (activeCaller && n.id === activeCaller) { fill = "#ffd54f"; a = 0.98; }
      if (activeCallee && n.id === activeCallee) { fill = "#ff8a65"; a = 0.98; }

      mmCtx.globalAlpha = a;
      mmCtx.fillStyle = fill;

      const r = Math.max(1.4, Math.min(4.0, n.r * 0.18));
      mmCtx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    mmCtx.globalAlpha = 1;
  }

  function updateHUD()
  {
    if (viewMode !== "3d")
    {
      if (domainMode === "runtime")
      {
        hudLeft.textContent = "Runtime / List. No runtime data loaded yet.";
      }
      else
      {
        hudLeft.textContent = "Functions / List. Search and click a function to focus it in 3D.";
      }
      hudCenter.textContent = "";
      hudRight.textContent = "";
      return;
    }

    if (domainMode === "runtime")
    {
      if (!rtSteps.length)
      {
        hudLeft.textContent = "Runtime / 3D. No steps found.";
        hudCenter.textContent = "";
        hudRight.textContent = "";
        return;
      }

      const st = rtSteps[rtIndex];
      const caller = st ? nodeById[st.caller] : null;
      const callee = st ? nodeById[st.callee] : null;

      // During playback we "swap focus" halfway through a step; keep HUD aligned with the active focus.
      const activeLeft = (rtActiveSide === "callee") ? callee : caller;
      const passiveRight = (rtActiveSide === "callee") ? caller : callee;

      hudLeft.textContent = fmtNode(activeLeft);
      hudRight.textContent = fmtNode(passiveRight);

      const total = rtSteps.length;
      const idxHuman = total ? (rtIndex + 1) : 0;
      const varCount = Object.keys(touched).length;

      // Patch 2: Show Runtime/3D prompt when no vars built yet
      if (!varCount && !rtPlaying)
      {
        hudCenter.textContent = "Play runtime to build vars.";
        return;
      }

      if (freezeTouchCounts && !rtPlaying && rtIndex >= total - 1)
      {
        hudCenter.textContent = "Finished. Play again. Total vars: " + varCount;
      }
      else
      {
        const mid = [];
        mid.push("Step " + idxHuman + " / " + total);
        mid.push("line " + (st ? st.line : 0));
        if (st && st.args_preview) mid.push("args: " + st.args_preview);
        mid.push("vars: " + varCount);
        hudCenter.textContent = mid.join("\n");
      }

      return;
    }

    // Default text
    if (!hoverNode && !selectedNode && !hoverEdge && !selectedEdge)
    {
      hudLeft.textContent = "Drag to orbit. Scroll to zoom. Click a node or edge.";
      hudCenter.textContent = "";
      hudRight.textContent = "";
      return;
    }

    // Prefer a selected edge over node hover
    const e = selectedEdge || hoverEdge;
    if (e)
    {
      hudLeft.textContent = fmtNode(e.s);
      hudRight.textContent = fmtNode(e.t);

      const c = (typeof e.count === "number") ? e.count : 1;
      const mid = [];
      mid.push("connections");
      mid.push(String(c));
      mid.push("edges: " + graph.edges.length);
      mid.push("unresolved: " + graph.meta.unresolved_calls);
      hudCenter.textContent = mid.join("\n");
      return;
    }

    // Otherwise show a single node (hover or selected) on the left
    const n = hoverNode || selectedNode;
    hudLeft.textContent = fmtNode(n);
    hudCenter.textContent = "";
    hudRight.textContent = "";
  }

  function applyUIState()
  {
    const isList = (viewMode === "list");

    domainFunctions.classList.toggle("active", domainMode === "functions");
    domainRuntime.classList.toggle("active", domainMode === "runtime");
    view3d.classList.toggle("active", viewMode === "3d");
    viewList.classList.toggle("active", isList);

    // Panels: listpanel is for List view in Functions domain.
    // runtimepanel is for List view in Runtime domain (placeholder until data exists).
    listPanel.style.display = (domainMode === "functions" && isList) ? "block" : "none";
    runtimePanel.style.display = (domainMode === "runtime" && isList) ? "block" : "none";

    // Search only visible in List view and only useful in Functions domain
    searchEl.style.display = (domainMode === "functions" && isList) ? "block" : "none";

    rtControls.style.display = (domainMode === "runtime" && viewMode === "3d") ? "flex" : "none";
    if (hudVarsWrap) hudVarsWrap.style.display = (domainMode === "runtime" && viewMode === "3d") ? "flex" : "none";
    // P5: show the label only in Runtime / 3D
    if (rtMainLabel)
    {
      rtMainLabel.style.display = (domainMode === "runtime" && viewMode === "3d") ? "block" : "none";
    }
    if (domainMode === "runtime" && viewMode === "3d")
    {
      const hudVarsMini = document.getElementById("hud_vars_minimap");
      const varCount = Object.keys(touched || {}).length;
      if (hudVarsMini)
      {
        if (!rtShowInactiveVars) hudVarsMini.style.display = "none";
        else hudVarsMini.style.display = varCount ? "block" : "none";
      }

      // If we already have vars from a prior run, render them immediately on entry.
      if (varCount) renderTouchedHud();
      else if (hudVars) hudVars.innerHTML = "";

      if (rtShowInactiveVars) resizeVarsMinimap();

      // Show/hide signature args + runtime tokens in Runtime/3D
      rtShowArgNodes = rtShowArgNodesEl ? !!rtShowArgNodesEl.checked : rtShowArgNodes;
      for (let i = 0; i < argNodes.length; i++)
      {
        const m = argNodes[i].mesh;
        if (m) m.visible = rtShowArgNodes;
      }
      for (let i = 0; i < tokenNodes.length; i++)
      {
        const m = tokenNodes[i].mesh;
        if (m) m.visible = rtShowArgNodes;
      }

      if (argLinkLine) argLinkLine.visible = rtShowArgNodes;
      if (tokenLinkLine) tokenLinkLine.visible = rtShowArgNodes;
    }


    // Orbit controls only enabled in 3D view (either domain)
    controls.enabled = (viewMode === "3d");

    if (domainMode === "functions" && isList) renderList();

    // If we leave Runtime/3D, stop playback.
    if (!(domainMode === "runtime" && viewMode === "3d"))
    {
      rtPlaying = false;
      rtAccum = 0;
    }

    if (!(domainMode === "runtime" && viewMode === "3d"))
    {
      clearRuntimeHighlight();
      // Do not clear hudVars here; we want vars to persist across domain switches.
      // Vars are cleared by resetTouched() when runtime data is rebuilt.
      const hudVarsMini = document.getElementById("hud_vars_minimap");
      if (hudVarsMini) hudVarsMini.style.display = "none";

      // Reset runtime label cache so we resync on next entry
      lastLabelMode = null;
      lastLabelCaller = "";
      lastLabelCallee = "";

      // Hide and reset signature args + runtime tokens when not in Runtime/3D
      for (let i = 0; i < argNodes.length; i++)
      {
        const a = argNodes[i];
        if (a.mesh)
        {
          a.mesh.visible = false;
          a._scale = 1.0;
          a.mesh.scale.set(1, 1, 1);
          a.mesh.material.color.setHex(0xb400ff);
        }
      }

      for (let i = 0; i < tokenNodes.length; i++)
      {
        const t = tokenNodes[i];
        if (t.mesh)
        {
          t.mesh.visible = false;
          t._scale = 1.0;
          t.mesh.scale.set(1, 1, 1);
          t.mesh.material.color.setHex(0x00c2c7);
        }
      }

      if (argLinkLine) argLinkLine.visible = false;
      if (tokenLinkLine) tokenLinkLine.visible = false;
    }

    // Ensure highlight state matches current mode.
    // (handled above)

    updateHUD();
  }

  function setDomain(mode)
  {
    domainMode = mode;
    applyUIState();
  }

  function setView(mode)
  {
    viewMode = mode;
    applyUIState();
  }

  function buildFnModalHtml(fnName)
  {
    const f = funcByName[fnName] || null;
    const n = nodeById[fnName] || null;

    function kv(k, v)
    {
      return '<div class="kv"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + v + '</div></div>';
    }

    function fmtArr(a)
    {
      if (!a || !a.length) return '<span style="opacity:0.75">none</span>';

      const parts = [];
      for (let i = 0; i < a.length; i++)
      {
        const nm = String(a[i] || "");
        if (!nm) continue;
        parts.push(
          '<span class="varlink" data-var="' + escapeHtml(nm) + '">' +
            escapeHtml(nm) +
          '</span>'
        );
      }

      return '<span class="mono">' + parts.join(", ") + '</span>';
    }

    const parts = [];

    if (n)
    {
      parts.push(kv("Runtime main", escapeHtml((rtMainOverrideName === fnName) ? "override" : ((rtMain && rtMain.id === fnName) ? "auto" : "no"))));
      parts.push(kv("Lines", escapeHtml(String(n.start_line) + "-" + String(n.end_line))));
      parts.push(kv("Calls", escapeHtml("in " + n.in_calls + " out " + n.out_calls + " total " + (n.in_calls + n.out_calls))));
    }

    if (f)
    {
      if (f.desc)
      {
        parts.push(kv("Desc", '<span>' + escapeHtml(String(f.desc)) + '</span>'));
      }

      const args = (f.inputs && Array.isArray(f.inputs.args)) ? f.inputs.args : [];
      parts.push(kv("Inputs", fmtArr(args)));

      const lvars = (f.locals && Array.isArray(f.locals.local_vars)) ? f.locals.local_vars : [];
      parts.push(kv("Locals", fmtArr(lvars)));

      const lfuncs = (f.locals && Array.isArray(f.locals.local_functions)) ? f.locals.local_functions : [];
      parts.push(kv("Local funcs", fmtArr(lfuncs)));

      const inv = (f.invokes && Array.isArray(f.invokes.invoke_list)) ? f.invokes.invoke_list : [];
      const totalInv = (f.invokes && typeof f.invokes.total === "number") ? f.invokes.total : inv.length;
      parts.push(kv("Invokes", escapeHtml(String(totalInv))));

      if (inv.length)
      {
        const maxShow = 8;
        const lines = [];
        for (let i = 0; i < inv.length && i < maxShow; i++)
        {
          const c = inv[i];
          const ln = (typeof c.line === "number") ? c.line : 0;
          const callee = c.callee || "";
          const ap = c.args_preview || "";
          lines.push("line " + ln + "  " + callee + "(" + ap + ")");
        }
        if (inv.length > maxShow) lines.push("… +" + (inv.length - maxShow) + " more");
        parts.push(kv("Callsites", '<div class="mono">' + escapeHtml(lines.join("\n")) + '</div>'));
      }
    }
    else
    {
      parts.push('<div style="opacity:0.85">No intel found for this function.</div>');
    }

    return parts.join("");
  }
  function buildVarModalHtml(varName)
  {
    const name = String(varName || "");
    const info = touched && name ? touched[name] : null;

    function kv(k, v)
    {
      return '<div class="kv"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + v + '</div></div>';
    }

    const parts = [];
    parts.push(kv("Name", '<span class="mono">' + escapeHtml(name) + '</span>'));

    if (info)
    {
      parts.push(kv("Runtime touches", '<span class="mono">' + escapeHtml(String(info.count || 0)) + '</span>'));
      parts.push(kv("First line", '<span class="mono">' + escapeHtml(String(info.first_line || 0)) + '</span>'));
      parts.push(kv("Last step", '<span class="mono">' + escapeHtml(String(info.last_step || 0)) + '</span>'));
    }
    else
    {
      parts.push(kv("Runtime touches", '<span style="opacity:0.75">no runtime data yet</span>'));
    }

    // Show which functions declare/use this name in the static intel.
    const hits = [];
    for (let i = 0; i < (DATA.functions || []).length; i++)
    {
      const f = DATA.functions[i];
      const fn = f ? f.function_name : "";
      if (!fn) continue;

      const inArgs = (f.inputs && Array.isArray(f.inputs.args)) ? (f.inputs.args.indexOf(name) !== -1) : false;
      const inLocals = (f.locals && Array.isArray(f.locals.local_vars)) ? (f.locals.local_vars.indexOf(name) !== -1) : false;
      const inWrites = (f.writes && Array.isArray(f.writes.targets)) ? (f.writes.targets.indexOf(name) !== -1) : false;
      const inReturns = (f.returns && Array.isArray(f.returns.returns)) ? (f.returns.returns.indexOf(name) !== -1) : false;

      if (inArgs || inLocals || inWrites || inReturns)
      {
        const tags = [];
        if (inArgs) tags.push("input");
        if (inLocals) tags.push("local");
        if (inWrites) tags.push("writes");
        if (inReturns) tags.push("returns");
        hits.push(fn + " (" + tags.join(", ") + ")");
      }
    }

    if (hits.length)
    {
      const maxShow = 14;
      const show = hits.slice(0, maxShow);
      const lines = show.map(function(x) { return "- " + x; }).join("\n");
      const extra = (hits.length > maxShow) ? ("\n… +" + (hits.length - maxShow) + " more") : "";
      parts.push(kv("Static intel", '<div class="mono">' + escapeHtml(lines + extra) + '</div>'));
    }

    return parts.join("");
  }

  function openVarModal(varName)
  {
    if (!varModalBackdrop) return;
    const name = String(varName || "");

    if (varModalTitle) varModalTitle.textContent = name ? ("Var: " + name) : "Variable";
    if (varModalBody) varModalBody.innerHTML = buildVarModalHtml(name);

    varModalBackdrop.style.display = "flex";
  }

  function closeVarModal()
  {
    if (!varModalBackdrop) return;
    varModalBackdrop.style.display = "none";
  }

  function openFnModal(fnName)
  {
    if (!fnModalBackdrop) return;
    fnModalCurrentName = String(fnName || "");

    if (fnModalTitle) fnModalTitle.textContent = fnModalCurrentName || "Function";
    if (fnModalBody) fnModalBody.innerHTML = buildFnModalHtml(fnModalCurrentName);

    fnModalBackdrop.style.display = "flex";
  }

  function closeFnModal()
  {
    if (!fnModalBackdrop) return;
    fnModalBackdrop.style.display = "none";
    fnModalCurrentName = "";
  }

  if (fnModalClose)
  {
    fnModalClose.addEventListener("click", function()
    {
      closeFnModal();
    });
  }

  if (varModalClose)
  {
    varModalClose.addEventListener("click", function()
    {
      closeVarModal();
    });
  }

  if (fnModalBackdrop)
  {
    fnModalBackdrop.addEventListener("click", function(ev)
    {
      if (ev.target === fnModalBackdrop) closeFnModal();
    });
  }

  if (varModalBackdrop)
  {
    varModalBackdrop.addEventListener("click", function(ev)
    {
      if (ev.target === varModalBackdrop) closeVarModal();
    });
  }

  window.addEventListener("keydown", function(ev)
  {
    if (ev.key === "Escape")
    {
      if (varModalBackdrop && varModalBackdrop.style.display !== "none") closeVarModal();
      else if (fnModalBackdrop && fnModalBackdrop.style.display !== "none") closeFnModal();
    }
  });

  if (fnModalBody)
  {
    fnModalBody.addEventListener("click", function(ev)
    {
      const t = ev.target;
      const el = t && t.closest ? t.closest(".varlink") : null;
      if (!el) return;
      const nm = el.getAttribute("data-var") || "";
      if (!nm) return;
      openVarModal(nm);
    });
  }

  if (fnModalBtnShow3d)
  {
    fnModalBtnShow3d.addEventListener("click", function()
    {
      const name = fnModalCurrentName;
      closeFnModal();
      const n = name ? nodeById[name] : null;
      if (!n) return;
      setDomain("functions");
      setView("3d");
      focusNode(n);
    });
  }

  // Modal buttons for Set Main and Reset Runtime
  if (fnModalBtnSetMain)
  {
    fnModalBtnSetMain.addEventListener("click", function()
    {
      const name = fnModalCurrentName;
      closeFnModal();
      if (!name) return;
      rtMainOverrideName = name;
      buildRuntimeSteps();
      updateHUD();
    });
  }

  if (fnModalBtnResetRt)
  {
    fnModalBtnResetRt.addEventListener("click", function()
    {
      closeFnModal();
      buildRuntimeSteps();
      updateHUD();
    });
  }

  function renderList()
  {
    const q = String(searchEl.value || "").trim().toLowerCase();
    let shown = 0;

    const parts = [];
    for (let i = 0; i < listModel.length; i++)
    {
      const n = listModel[i];
      if (q)
      {
        const hay = (n.name || "").toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }

      const total = (n.in_calls + n.out_calls);
      parts.push(
        '<div class="row" data-id="' + n.id + '">' +
          '<div class="name">' + escapeHtml(n.name) + '</div>' +
          '<div class="muted">' + n.start_line + '-' + n.end_line + '</div>' +
          '<div class="muted">in ' + n.in_calls + ' out ' + n.out_calls + '</div>' +
          '<div class="muted">total ' + total + '</div>' +
        '</div>'
      );
      shown++;
    }

    listEl.innerHTML = parts.join("");
    listMeta.textContent = shown + " / " + listModel.length + " shown";
  }

  function escapeHtml(s)
  {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function focusNode(n)
  {
    if (!n) return;

    selectedEdge = null;
    setSelected(n);

    // Move the orbit target and camera near the node
    controls.target.set(n.x, n.y, n.z);
    const v = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);
    const t = new THREE.Vector3(n.x, n.y, n.z);
    const dir = v.sub(controls.target);
    if (dir.length() < 0.001) dir.set(0, 0, 900);
    dir.setLength(700);
    camera.position.set(t.x + dir.x, t.y + dir.y, t.z + dir.z);

    updateHUD();
  }

  domainFunctions.addEventListener("click", function()
  {
    setDomain("functions");
  });

  domainRuntime.addEventListener("click", function()
  {
    setDomain("runtime");
  });

  view3d.addEventListener("click", function()
  {
    setView("3d");
  });

  viewList.addEventListener("click", function()
  {
    setView("list");
  });

  searchEl.addEventListener("input", function()
  {
    if (viewMode === "list") renderList();
  });

  if (hudVars)
  {
    hudVars.addEventListener("scroll", function()
    {
      if (!rtShowInactiveVars) return;

      const items = [];
      for (const k in touched) items.push({ name: k, order: touched[k].order });
      items.sort(function(a, b) { return a.order - b.order; });
      drawVarsMinimap(items);
    });
  }

  listEl.addEventListener("click", function(ev)
  {
    const t = ev.target;
    const row = t && t.closest ? t.closest(".row") : null;
    if (!row) return;
    const id = row.getAttribute("data-id");
    if (!id) return;
    openFnModal(id);
  });

  rtPrev.addEventListener("click", function()
  {
    rtPlaying = false;
    stepRt(-1);
  });

  rtNext.addEventListener("click", function()
  {
    rtPlaying = false;
    stepRt(1);
  });

  if (rtShowInactiveEl)
  {
    rtShowInactiveEl.addEventListener("change", function()
    {
      rtShowInactiveVars = !!rtShowInactiveEl.checked;
      renderTouchedHud();

      // Also apply to 3D labels immediately (Runtime/3D only)
      if (domainMode === "runtime" && viewMode === "3d")
      {
        const st = (rtSteps && rtSteps.length) ? rtSteps[rtIndex] : null;
        syncRuntimeLabelVisibility(st);
      }
    });
  }


  if (rtShowArgNodesEl)
  {
    rtShowArgNodesEl.addEventListener("change", function()
    {
      rtShowArgNodes = !!rtShowArgNodesEl.checked;
      applyUIState();
    });
  }

  // Hide HUD checkbox (toggles a body class; CSS handles the actual hiding).
  const hudHideEl = document.getElementById("hud_hide");

  function setHudHidden(hidden)
  {
    if (typeof document === "undefined" || !document.body) return;
    if (hidden) document.body.classList.add("hud_hidden");
    else document.body.classList.remove("hud_hidden");
  }

  // Default: HUD visible.
  setHudHidden(false);

  if (hudHideEl)
  {
    hudHideEl.addEventListener("change", function()
    {
      setHudHidden(!!hudHideEl.checked);
    });
  }

  rtPlay.addEventListener("click", function()
  {
    const atEnd = (rtSteps.length && rtIndex >= rtSteps.length - 1);

    // If we're at the end and user hits Play, restart.
    if (!rtPlaying && atEnd)
    {
      rtIndex = 0;
      rtAccum = 0;
      // Replay the animation without changing counts.
      freezeTouchCounts = true;
      touchFromStep(rtSteps[rtIndex]);
      renderTouchedHud();
      renderRuntimeList();
    }

    const wasPlaying = rtPlaying;
    rtPlaying = !rtPlaying;

    // If we just started playing and no vars exist yet, seed the first step now.
    if (!wasPlaying && rtPlaying)
    {
      const varCount = Object.keys(touched).length;
      if (!varCount && rtSteps.length)
      {
        freezeTouchCounts = false;
        rtAccum = 0;
        touchFromStep(rtSteps[rtIndex]);
        renderTouchedHud();
        renderRuntimeList();
      }
    }

    updateRuntimeControls();
  });

  rtStepsEl.addEventListener("click", function(ev)
  {
    const t = ev.target;
    const row = t && t.closest ? t.closest(".rtrow") : null;
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-rt"), 10);
    if (!isNaN(idx))
    {
      rtPlaying = false;
      setRtIndex(idx);
    }
  });

  renderer.domElement.addEventListener("mousemove", function(ev)
  {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -(((ev.clientY - r.top) / r.height) * 2 - 1);

    raycaster.setFromCamera(mouse, camera);
    const hitNodes = raycaster.intersectObjects(meshes, false);
    const hitEdges = raycaster.intersectObjects(edgeMeshes, false);

    if (hitNodes && hitNodes.length)
    {
      const n = hitNodes[0].object.userData.node;
      setHover(n);
    }
    else
    {
      setHover(null);
    }

    // Track hovered edge (closest hit)
    if (hitEdges && hitEdges.length)
    {
      hoverEdge = hitEdges[0].object.userData.edge;
    }
    else
    {
      hoverEdge = null;
    }

    updateHUD();
  });

  renderer.domElement.addEventListener("click", function()
  {
    if (hoverEdge)
    {
      selectedEdge = hoverEdge;
      // Also select both endpoints for context
      setSelected(null);
    }
    else
    {
      selectedEdge = null;
      if (hoverNode) setSelected(hoverNode);
      else setSelected(null);
    }
    updateHUD();
  });

  window.addEventListener("resize", function()
  {
    const size = getRootSize();
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    renderer.setSize(size.w, size.h);
    if (rtShowInactiveVars) resizeVarsMinimap();
  });

  // 3D force simulation
  function tick()
  {
    const nodes = graph.nodes;
    const edges = graph.edges;

    const repulsion = 14000;
    const springK = 0.0022;
    const springLen = 160;
    const damping = 0.86;

    // Runtime pinning for active teal tokens
    const pinK = 0.020;
    const pinDamping = 0.70;

    let activeCallerId = "";
    let activeCalleeId = "";
    let pinEnabled = false;

    const pinMid = new THREE.Vector3();
    const pinTmp = new THREE.Vector3();

    if (domainMode === "runtime" && viewMode === "3d" && rtShowArgNodes && rtSteps && rtSteps.length)
    {
      const st = rtSteps[rtIndex];
      activeCallerId = st ? String(st.caller || "") : "";
      activeCalleeId = st ? String(st.callee || "") : "";

      const callerNode = nodeById[activeCallerId];
      const calleeNode = nodeById[activeCalleeId];

      if (callerNode && calleeNode)
      {
        pinMid.set(
          (callerNode.x + calleeNode.x) * 0.5,
          (callerNode.y + calleeNode.y) * 0.5,
          (callerNode.z + calleeNode.z) * 0.5
        );
        pinEnabled = true;
      }
      else if (calleeNode)
      {
        pinMid.set(calleeNode.x, calleeNode.y, calleeNode.z);
        pinEnabled = true;
      }
    }

    const dataNodes = argNodes.concat(tokenNodes);

    const activeToken = Object.create(null);

    if (pinEnabled && touchedThisStep)
    {
      for (let i = 0; i < tokenNodes.length; i++)
      {
        const t = tokenNodes[i];
        if (!t) continue;

        if (!touchedThisStep[t.name]) continue;

        const ownedByCaller = !!(t.owners && activeCallerId && t.owners[activeCallerId]);
        const ownedByCallee = !!(t.owners && activeCalleeId && t.owners[activeCalleeId]);
        if (!(ownedByCaller || ownedByCallee)) continue;

        activeToken[t.name] = true;

        if (!t._pinOff)
        {
          t._pinOff = {
            x: (Math.random() - 0.5) * 90,
            y: (Math.random() - 0.5) * 90,
            z: (Math.random() - 0.5) * 90
          };
        }

        t._pinTarget = {
          x: pinMid.x + t._pinOff.x,
          y: pinMid.y + t._pinOff.y,
          z: pinMid.z + t._pinOff.z
        };
      }
    }

    // pairwise repulsion
    for (let i = 0; i < nodes.length; i++)
    {
      for (let j = i + 1; j < nodes.length; j++)
      {
        const a = nodes[i];
        const b = nodes[j];

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;

        let d2 = dx*dx + dy*dy + dz*dz + 0.01;
        const f = repulsion / d2;
        const invD = 1 / Math.sqrt(d2);

        dx *= invD;
        dy *= invD;
        dz *= invD;

        a.vx += dx * f;
        a.vy += dy * f;
        a.vz += dz * f;

        b.vx -= dx * f;
        b.vy -= dy * f;
        b.vz -= dz * f;
      }
    }

    // springs
    for (let i = 0; i < edges.length; i++)
    {
      const e = edges[i];
      const a = e.s;
      const b = e.t;
      const w = (typeof e.count === "number") ? e.count : 1;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dz = b.z - a.z;

      const d = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001;
      const stretch = d - springLen;
      const f = stretch * springK * Math.min(6.0, 1.0 + w * 0.25);

      dx /= d;
      dy /= d;
      dz /= d;

      a.vx += dx * f;
      a.vy += dy * f;
      a.vz += dz * f;

      b.vx -= dx * f;
      b.vy -= dy * f;
      b.vz -= dz * f;
    }

    // --- argument node forces (Runtime/3D only, when enabled) ---
    if (domainMode === "runtime" && viewMode === "3d" && rtShowArgNodes && dataNodes.length)
    {
      // 1) target = centroid of owning functions + per-name offset (spreads labels)
      function hash01(str)
      {
        // Deterministic 0..1 hash
        const s = String(str || "");
        let h = 2166136261;
        for (let i = 0; i < s.length; i++)
        {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        // Convert to 0..1
        return ((h >>> 0) % 100000) / 100000;
      }

      const baseRing = 34;
      const ringJitter = 16;
      const yBand = 16;

      for (let i = 0; i < dataNodes.length; i++)
      {
        const a = dataNodes[i];
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let cnt = 0;

        for (const fn in a.owners)
        {
          const n = nodeById[fn];
          if (!n) continue;
          cx += n.x;
          cy += n.y;
          cz += n.z;
          cnt++;
        }

        if (cnt > 0)
        {
          cx /= cnt;
          cy /= cnt;
          cz /= cnt;
        }

        // Spread args/tokens around a ring to reduce label overlap.
        const h0 = hash01(a.name);
        const h1 = hash01(a.name + ":b");
        const ang = h0 * Math.PI * 2;
        const rr = baseRing + h1 * ringJitter + Math.min(22, cnt * 6);
        const ox = Math.cos(ang) * rr;
        const oz = Math.sin(ang) * rr;
        const oy = (h1 - 0.5) * yBand;

        a.target.x = cx + ox;
        a.target.y = cy + 12 + oy;
        a.target.z = cz + oz;
      }

      // 2) pull toward target
      const argSpringK = 0.006;
      const argDamp = 0.84;
      const argMaxV = 7.0;
      for (let i = 0; i < dataNodes.length; i++)
      {
        const a = dataNodes[i];
        a.vx += (a.target.x - a.x) * argSpringK;
        a.vy += (a.target.y - a.y) * argSpringK;
        a.vz += (a.target.z - a.z) * argSpringK;

        a.vx *= argDamp;
        a.vy *= argDamp;
        a.vz *= argDamp;

        // Clamp velocity so collisions don't cause popping/jitter
        if (a.vx > argMaxV) a.vx = argMaxV;
        if (a.vx < -argMaxV) a.vx = -argMaxV;
        if (a.vy > argMaxV) a.vy = argMaxV;
        if (a.vy < -argMaxV) a.vy = -argMaxV;
        if (a.vz > argMaxV) a.vz = argMaxV;
        if (a.vz < -argMaxV) a.vz = -argMaxV;

        // Pin active teal tokens near the active runtime call.
        if (pinEnabled && a && a.name && activeToken[a.name] && a._pinTarget)
        {
          pinTmp.set(a._pinTarget.x - a.x, a._pinTarget.y - a.y, a._pinTarget.z - a.z);
          a.vx += pinTmp.x * pinK;
          a.vy += pinTmp.y * pinK;
          a.vz += pinTmp.z * pinK;

          // Extra damping to kill jitter while pinned.
          a.vx *= pinDamping;
          a.vy *= pinDamping;
          a.vz *= pinDamping;
        }
      }

      // 3) repel from function nodes
      const argRepel = 900;
      for (let i = 0; i < dataNodes.length; i++)
      {
        const a = dataNodes[i];
        for (let j = 0; j < nodes.length; j++)
        {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dz = a.z - b.z;

          const minD = (a.r + b.r + 8);
          const d2 = dx*dx + dy*dy + dz*dz + 0.01;
          const d = Math.sqrt(d2);
          if (d > minD) continue;

          const f = argRepel / Math.max(1, d2);
          const invD = 1 / Math.max(0.0001, d);
          dx *= invD;
          dy *= invD;
          dz *= invD;

          a.vx += dx * f;
          a.vy += dy * f;
          a.vz += dz * f;
        }
      }

      // 4) repel from other data nodes (label spacing)
      const argArgRepel = 1400;
      for (let i = 0; i < dataNodes.length; i++)
      {
        for (let j = i + 1; j < dataNodes.length; j++)
        {
          const a = dataNodes[i];
          const b = dataNodes[j];

          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dz = a.z - b.z;

          const minD = 26; // spacing target for label readability
          const d2 = dx*dx + dy*dy + dz*dz + 0.01;
          const d = Math.sqrt(d2);
          if (d > minD) continue;

          const overlap = (minD - d);
          const f = (argArgRepel * (overlap / minD)) / Math.max(1, d2);
          const invD = 1 / Math.max(0.0001, d);
          dx *= invD;
          dy *= invD;
          dz *= invD;

          a.vx += dx * f;
          a.vy += dy * f;
          a.vz += dz * f;

          b.vx -= dx * f;
          b.vy -= dy * f;
          b.vz -= dz * f;
        }
      }

      // 5) pulse data nodes when owning function is active
      const step = rtSteps && rtSteps[rtIndex];
      const activeFn = step ? step.callee : "";

      for (let i = 0; i < dataNodes.length; i++)
      {
        const a = dataNodes[i];
        const isActive = !!(activeFn && a.owners[activeFn]);

        const isToken = !!(a.mesh && a.mesh.userData && a.mesh.userData.tokenNode);
        const baseScale = isToken ? TOKEN_SCALE : 1.0;
        const activeScale = isToken ? (TOKEN_SCALE * 1.20) : 1.35;

        const targetScale = isActive ? activeScale : baseScale;
        a._scale += (targetScale - a._scale) * 0.18;

        if (a.mesh)
        {
          a.mesh.scale.set(a._scale, a._scale, a._scale);
          if (isToken)
          {
            if (isActive) a.mesh.material.color.setHex(0x3fffff);
            else a.mesh.material.color.setHex(0x00c2c7);
          }
          else
          {
            if (isActive) a.mesh.material.color.setHex(0xff3dff);
            else a.mesh.material.color.setHex(0xb400ff);
          }
        }
      }
    }

    // integrate
    for (let i = 0; i < nodes.length; i++)
    {
      const n = nodes[i];

      n.vx *= damping;
      n.vy *= damping;
      n.vz *= damping;

      n.x += n.vx;
      n.y += n.vy;
      n.z += n.vz;

      if (n.mesh)
      {
        n.mesh.position.set(n.x, n.y, n.z);
      }
    }

    // integrate signature args + runtime tokens
    if (domainMode === "runtime" && viewMode === "3d" && rtShowArgNodes && (argNodes.length || tokenNodes.length))
    {
      const dataNodes = argNodes.concat(tokenNodes);
      for (let i = 0; i < dataNodes.length; i++)
      {
        const a = dataNodes[i];
        a.x += a.vx;
        a.y += a.vy;
        a.z += a.vz;
        if (a.mesh) a.mesh.position.set(a.x, a.y, a.z);
      }
    }

    updateEdgeMeshes();
  }

    // Keep labels readable across zoom levels.
    // Sprites are sized in world units, so we scale them based on camera distance.
    function updateLabelScales()
    {
      const d = camera.position.distanceTo(controls.target);

      // When zoomed in (small d) labels shrink; when zoomed out they grow.
      // Enforce a hard maximum so labels never get huge.
      const kRaw = d / 900;
      const k = Math.max(0.28, Math.min(0.72, kRaw));

      // Clamp ALL labels to the same max world-size so no label can dominate.
      // This clamps by the larger of (width,height) in world units.
      const LABEL_MAX_WORLD = 150;

      function applySpriteScale(spr)
      {
        if (!spr || !spr.userData || !spr.userData.baseScale) return;
        const bs = spr.userData.baseScale;

        let sx = bs.x * k;
        let sy = bs.y * k;

        const m = Math.max(sx, sy);
        if (m > LABEL_MAX_WORLD)
        {
          const f = LABEL_MAX_WORLD / m;
          sx *= f;
          sy *= f;
        }

        spr.scale.set(sx, sy, bs.z);
      }

      // Function node labels
      for (let i = 0; i < graph.nodes.length; i++)
      {
        const n = graph.nodes[i];
        if (!n || !n.mesh) continue;
        const spr = n.mesh.userData ? n.mesh.userData.labelSprite : null;
        applySpriteScale(spr);
      }

      // Arg cube labels
      for (let i = 0; i < argNodes.length; i++)
      {
        const a = argNodes[i];
        if (!a || !a.mesh) continue;
        const spr = a.mesh.userData ? a.mesh.userData.labelSprite : null;
        applySpriteScale(spr);
      }

      // Token cube labels
      for (let i = 0; i < tokenNodes.length; i++)
      {
        const t = tokenNodes[i];
        if (!t || !t.mesh) continue;
        const spr = t.mesh.userData ? t.mesh.userData.labelSprite : null;
        applySpriteScale(spr);
      }
    }

    function frame()
    {
      // Runtime playback tick (no real timing; just steady stepping)
      if (domainMode === "runtime" && viewMode === "3d" && rtSteps.length)
      {
        const spd = parseFloat(rtSpeed.value || "1") || 1;
        const dt = 1 / 60;

        if (rtPlaying)
        {
          rtAccum += dt * spd;
          if (rtAccum >= 0.9)
          {
            rtAccum = 0;

            // Loop forever until paused.
            if (rtIndex < rtSteps.length - 1)
            {
              rtIndex++;
            }
            else
            {
              // Wrapped to the first step after completing a full pass.
              rtIndex = 0;
              freezeTouchCounts = true;
            }

            touchFromStep(rtSteps[rtIndex]);
            renderTouchedHud();
            renderRuntimeList();
            updateRuntimeControls();
          }
        }

        // Visualize the current step in 3D (two-phase): caller -> callee
        const stepSpan = 0.9;
        const phase01 = Math.max(0, Math.min(1, rtAccum / stepSpan));
        const focusCallee = (phase01 >= 0.5);

        rtActiveSide = focusCallee ? "callee" : "caller";

        rtPulseT += dt * 6.0 * spd;
        clearRuntimeHighlight();
        const st = rtSteps[rtIndex];

        syncRuntimeLabelVisibility(st);
        // Base highlight (also bumps edge opacity)
        applyRuntimeHighlight(st);

        // Swap emphasis halfway through: callee becomes the "active" focus
        const caller = nodeById[st.caller];
        const callee = nodeById[st.callee];

        if (focusCallee)
        {
          if (caller && caller.mesh) caller.mesh.material = rtCalleeMat;
          if (callee && callee.mesh) callee.mesh.material = rtActiveMat;

          if (callee && callee.mesh)
          {
            const s = 1.0 + (Math.sin(rtPulseT) * 0.08);
            callee.mesh.scale.set(s, s, s);
          }
        }
        else
        {
          if (caller && caller.mesh)
          {
            const s = 1.0 + (Math.sin(rtPulseT) * 0.08);
            caller.mesh.scale.set(s, s, s);
          }
        }

        // Keep HUD synced with the per-frame focus (caller vs callee).
        updateHUD();
      }

      drawMinimap();
      tick();

      if (domainMode === "runtime" && viewMode === "3d" && rtShowArgNodes)
      {
        updateArgLinkLines();
      }

      controls.update();
      updateFog();
      updateLabelScales();
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }

  buildRuntimeSteps();
  updateEdgeMeshes();
  applyUIState();
  if (rtShowInactiveVars) resizeVarsMinimap();
  frame();
}

function boot(json, options)
{
  DATA = json;
  const g = buildGraph(DATA);
  start3D(g, options || {});
}

function showLoadError(err, attemptedUrl)
{
  const hud = document.getElementById("hud_left");
  const here = String(window.location.href);
  const lines = [];
  const target = attemptedUrl || "function_intel.json";
  lines.push("Could not load " + target);
  lines.push("page: " + here);
  if (attemptedUrl) lines.push("attempted: " + attemptedUrl);
  lines.push("error: " + String(err));
  lines.push("");
  lines.push("Run a local server from this folder:");
  lines.push("python3 -m http.server 8080");
  lines.push("Then open: http://localhost:8080/index.html");
  hud.textContent = lines.join("\n");
  const hudCenter = document.getElementById("hud_center");
  const hudRight = document.getElementById("hud_right");
  if (hudCenter) hudCenter.textContent = "";
  if (hudRight) hudRight.textContent = "";
  const listPanel = document.getElementById("listpanel");
  if (listPanel) listPanel.style.display = "none";
  const runtimePanel = document.getElementById("runtimepanel");
  if (runtimePanel) runtimePanel.style.display = "none";
}

export function bootFunctionsGraph3D(options)
{
  const opts = options || {};
  const root = opts.root || document.body;
  const dataUrl = opts.dataUrl || "function_intel.json";
  const onError = (typeof opts.onError === "function") ? opts.onError : null;

  const url = new URL(dataUrl, window.location.href).toString();
  fetch(url, { cache: "no-store" })
    .then(r =>
    {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
      return r.json();
    })
    .then(j => boot(j, { root: root }))
    .catch(err =>
    {
      if (onError) onError(err);
      else showLoadError(err, url);
    });
}

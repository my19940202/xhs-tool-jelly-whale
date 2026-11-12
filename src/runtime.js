import * as THREE from 'three-whale';
import { buildSimMesh, buildRenderMesh, embed } from './geometry.js';
import { SoftBody } from './physics.js';
import { Renderer, DYN } from './renderer.js';
import { PALETTES, BG_ON, vnorm } from './palette.js';

export async function mountWhale(container, options) {
  const abort = new AbortController();
  const on = (el, event, handler, extra = {}) => el.addEventListener(event, handler, { ...extra, signal: abort.signal });
  const root = document.createElement('div');
  root.className = 'jelly-whale';
  root.innerHTML = `<style>
    .jelly-whale { container:jelly-whale / inline-size;position:absolute;inset:0;background:#e2dfda;color:#393b3b;font:12px ui-monospace,monospace;overflow:hidden }
    .jelly-whale canvas { position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none }
    .jelly-whale canvas[data-cursor=grab] { cursor:grab } .jelly-whale canvas[data-cursor=grabbing] {cursor:grabbing}
    .jelly-whale .whale-caption {position:absolute;top:20px;left:22px;pointer-events:none;letter-spacing:.14em;font-size:10px;color:#73736d}
    .jelly-whale .whale-panel {position:absolute;bottom:14px;left:14px;right:14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:14px;padding:14px;background:#eeece6e8;border:1px solid #c5c2b8;border-radius:3px}
    .jelly-whale button {padding:7px 11px;border:1px solid #aaa99f;background:transparent;border-radius:2px;font:inherit;cursor:pointer;min-height:34px}
    .jelly-whale button[aria-checked=true] {outline:2px solid #555b63;outline-offset:2px}
    .jelly-whale label {display:grid;gap:4px;font-size:10px;letter-spacing:.08em}
    .jelly-whale input {width:100px;accent-color:#387ed4}
    .jelly-whale .whale-colours {display:flex;gap:7px}
    .jelly-whale .whale-colours button {width:26px;min-height:26px;padding:0;border-radius:50%;background:var(--colour)}
    .jelly-whale .whale-status {position:absolute;top:20px;right:22px;letter-spacing:.08em;font-size:10px;color:#73736d}
    .jelly-whale .whale-help {flex-basis:100%;text-align:center;color:#73736d;font-size:10px}
    .jelly-whale .whale-fallback {position:absolute;inset:20px;display:grid;place-content:center;text-align:center;background:#e2dfda;z-index:2}
    @container jelly-whale (max-width:600px) {.jelly-whale .whale-panel {gap:10px;padding:10px}.jelly-whale .whale-caption {max-width:55%;line-height:1.7}.jelly-whale .whale-help {line-height:1.5}}
  </style>
  <canvas aria-label="Soft jelly whale. Drag to stretch, hold and scroll to twist, drag the background to orbit." role="img"></canvas>
  <span class="whale-caption">果冻蓝鲸 · 拖动鲸鱼或背景</span><span class="whale-status" role="status">INITIALISING</span>
  <div class="whale-panel" aria-label="Whale controls">
    <div class="whale-colours" role="radiogroup" aria-label="Colour"><button type="button" role="radio" aria-label="Ocean" data-colour="ocean" style="--colour:#3a8ef0"></button><button type="button" role="radio" aria-label="Arctic" data-colour="arctic" style="--colour:#5fcaf2"></button><button type="button" role="radio" aria-label="Twilight" data-colour="twilight" style="--colour:#6a6cf0"></button></div>
    <label>硬度 <input aria-label="Firmness" data-firm type="range" min="0" max="100" value="50"></label>
    <label>阻尼 <input aria-label="Damping" data-damp type="range" min="0" max="100" value="40"></label>
    <button type="button" data-reset>重置</button>
    <span class="whale-help">拖动鲸鱼拉伸 · 拖动背景旋转 · 双指缩放</span>
  </div>`;
  container.appendChild(root);
  const canvas = root.querySelector('canvas'), panel = root.querySelector('.whale-panel'), status = root.querySelector('.whale-status');
  const simMesh = buildSimMesh(0.12), renderMesh = buildRenderMesh();
  const sim = new SoftBody(simMesh, { firmness: 0.5, damping: options.reducedMotion ? 0.65 : 0.4 });
  const nV = renderMesh.rest.length / 3, emb = embed(simMesh.rest, simMesh.tets, renderMesh.rest);
  let renderer;
  try { renderer = await Renderer.create(canvas, { mesh: renderMesh, simEdges: sim.edges, nParticles: sim.n }); }
  catch (error) {
    abort.abort();
    const fallback = document.createElement('div'); fallback.className = 'whale-fallback';
    fallback.textContent = '当前设备暂不支持所需的 WebGL 2，请换一台设备试试。';
    root.append(fallback); panel.querySelectorAll('button,input').forEach(el => el.disabled = true);
    status.textContent = 'WEBGL UNAVAILABLE';
    console.error('Jelly whale renderer:', error);
    return { start() {}, pause() {}, resume() {}, reset() {}, resize() {}, destroy() { root.remove(); } };
  }
  try {
  const skinIdx = new Uint32Array(nV * 4), skinW = emb.w;
  for (let v = 0; v < nV; v++) for (let k = 0; k < 4; k++) skinIdx[4*v+k] = simMesh.tets[4*emb.tetOf[v]+k];
  const dyn = renderer.dyn, D = DYN, index = renderMesh.index;
  const bodyTriEnd = renderMesh.body.count, coreFirst = renderMesh.core.first, coreEnd = coreFirst + renderMesh.core.count;
  for (let v = renderMesh.bodyVertCount; v < nV; v++) for (let k = 0; k < 4; k++) dyn[D*v+6+k] = renderMesh.ctr[4*v+k];
  const nsm = new Float32Array(nV * 3);
  function skin() {
    for (let v = 0; v < nV; v++) {
      const o = D*v;
      for (let axis = 0; axis < 3; axis++) {
        let p = 0;
        for (let k = 0; k < 4; k++) p += sim.x[3*skinIdx[4*v+k]+axis] * skinW[4*v+k];
        dyn[o+axis] = p; dyn[o+3+axis] = 0;
      }
    }
    for (let t = 0; t < index.length; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      dyn[a + 3] += nx; dyn[a + 4] += ny; dyn[a + 5] += nz;
      dyn[b + 3] += nx; dyn[b + 4] += ny; dyn[b + 5] += nz;
      dyn[c + 3] += nx; dyn[c + 4] += ny; dyn[c + 5] += nz;
    }
    for (let o = 0; o < dyn.length; o += D) {
      const l = Math.hypot(dyn[o + 3], dyn[o + 4], dyn[o + 5]) || 1;
      dyn[o + 3] /= l; dyn[o + 4] /= l; dyn[o + 5] /= l;
    }
    // one smoothing pass over the jelly's surface and the milky layer: the lattice deforms piecewise-linearly,
    // and without this the studio's reflections pick out every kink between tetrahedra
    nsm.fill(0);
    const smooth = (t0, t1) => {
      for (let t = t0; t < t1; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2];
        const A = D * a, B = D * b, C = D * c;
        const sx = dyn[A + 3] + dyn[B + 3] + dyn[C + 3], sy = dyn[A + 4] + dyn[B + 4] + dyn[C + 4], sz = dyn[A + 5] + dyn[B + 5] + dyn[C + 5];
        nsm[3 * a] += sx; nsm[3 * a + 1] += sy; nsm[3 * a + 2] += sz;
        nsm[3 * b] += sx; nsm[3 * b + 1] += sy; nsm[3 * b + 2] += sz;
        nsm[3 * c] += sx; nsm[3 * c + 1] += sy; nsm[3 * c + 2] += sz;
      }
    };
    smooth(0, bodyTriEnd); smooth(coreFirst, coreEnd);
    for (let v = 0; v < nV; v++) {
      const k = 3 * v, l = Math.hypot(nsm[k], nsm[k + 1], nsm[k + 2]);
      if (l > 1e-9) { dyn[D * v + 3] = nsm[k] / l; dyn[D * v + 4] = nsm[k + 1] / l; dyn[D * v + 5] = nsm[k + 2] / l; }
    }
  }


  const camera = renderer.camera, vp = new THREE.Matrix4(), ivp = new THREE.Matrix4();
  const state = { az: 0.62, el: 0.36, zoom: 1, time: 0, dark: 0, paused: false };
  const drag = { mode: null, id: -1, second: null, plane: null, twist: 0, twist0: 0, lastX: 0, lastY: 0 };
  const cam = { viewProj: null, view: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1] };
  const target = [0.16, 0.36, 0.0];
  const FOV = 27 * Math.PI / 180;
  function safeRect() {
    const r = {width:canvas.clientWidth,height:canvas.clientHeight};
    const panelHeight = 0;
    return { x: 14, y: 10, w: Math.max(1, r.width - 28), h: Math.max(1, r.height - panelHeight - 38) };
  }
  // the camera eases after the whale if it is thrown or dragged far from home (never while holding it)
  const home = target.slice();
  const restC = sim.centroid();
  function followWhale(dt) {
    if (drag.mode === 'grab') return;
    const c = sim.centroid();
    const k = 1 - Math.exp(-dt * 1.4);
    const gx = home[0] + (c[0] - restC[0]) * 0.7, gz = home[2] + (c[2] - restC[2]) * 0.7;
    target[0] += (gx - target[0]) * k; target[2] += (gz - target[2]) * k;
  }
  function updateCamera() {
    const W = renderer.w, H = renderer.h;
    const cr = {width:canvas.clientWidth,height:canvas.clientHeight};
    const r = safeRect();
    const aspect = W / H;
    const hf = r.h / cr.height, wf = r.w / cr.width;
    // fit the whale, flukes and flippers and all
    const st = canvas.clientWidth < 600;
    // fit the long body closely: the whale should fill the stage
    const Rh = st ? 1.74 : 1.3, Rv = st ? 0.9 : 0.72;
    const t2 = Math.tan(FOV / 2);
    const dist = Math.max(Rv / (t2 * 0.9 * hf), Rh / (t2 * 0.92 * aspect * wf)) * state.zoom;
    const ce = Math.cos(state.el);
    const eye = [target[0] + dist * Math.sin(state.az) * ce, target[1] + dist * Math.sin(state.el), target[2] + dist * Math.cos(state.az) * ce];
    camera.fov = FOV * 180 / Math.PI; camera.aspect = aspect; camera.near = 0.1; camera.far = 80;
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // lens shift so the target lands at the centre of the safe rect
    const cx = (r.x + r.w / 2) / cr.width, cy = (r.y + r.h / 2) / cr.height;
    const pe = camera.projectionMatrix.elements;
    pe[8] -= (cx * 2 - 1); pe[9] -= -(cy * 2 - 1);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ivp.copy(vp).invert();
    cam.view = camera.matrixWorldInverse.elements; cam.viewProj = vp.elements; cam.invViewProj = ivp.elements;
    cam.pos = eye;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); cam.fwd = f.map(v => v / fl);
  }

  // light rig: key from behind and above the tail (so the flukes and flippers glow toward the camera)
  const keyDir = vnorm([-0.45, 0.86, -0.36]);
  const light = { dir: keyDir, intensity: 2.3, at: [0, 0.3, 0] };
  function updateLight() {
    // shadow and height maps are centred on the whale itself so they never lose it
    const c = sim.centroid();
    light.at = [c[0], 0.3, c[2]];
    light.intensity = 2.3 * (1 - 0.86 * state.dark);
  }

  function rayFrom(clientX, clientY) {
    const r = {left:0,top:0,width:canvas.clientWidth,height:canvas.clientHeight};
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const m = cam.invViewProj;
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d);
    return { o: a, d: d.map(v => v / l) };
  }
  // nearest hit on the whale's surface: distance along the ray (or Infinity)
  function pickT(ray) {
    let best = Infinity;
    const { o, d } = ray;
    for (let t = 0; t < bodyTriEnd; t += 3) {
      const a = D * index[t], b = D * index[t + 1], c = D * index[t + 2];
      const e1x = dyn[b] - dyn[a], e1y = dyn[b + 1] - dyn[a + 1], e1z = dyn[b + 2] - dyn[a + 2];
      const e2x = dyn[c] - dyn[a], e2y = dyn[c + 1] - dyn[a + 1], e2z = dyn[c + 2] - dyn[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - dyn[a], ty = o[1] - dyn[a + 1], tz = o[2] - dyn[a + 2];
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) best = tt;
    }
    return best;
  }
  function pick(ray) { const t = pickT(ray); return t < Infinity ? [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t] : null; }
  function pickNear(clientX, clientY, maxPx) {
    const r = {left:0,top:0,width:canvas.clientWidth,height:canvas.clientHeight}, M = cam.viewProj, x = sim.x;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2];
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      const sx = r.left + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * r.width;
      const sy = r.top + (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * r.height;
      const dd = (sx - clientX) ** 2 + (sy - clientY) ** 2 - w * 1e-3; // prefer nearer particles on ties
      if (dd < bd) { bd = dd; best = i; }
    }
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]];
  }

  function rotMat(axis, ang) {
    const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function dragTarget(clientX, clientY) {
    const ray = rayFrom(clientX, clientY);
    const { p, n } = drag.plane;
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    // keep the grab within a generous but finite reach, and above the floor
    const dx = q[0] - target[0], dz = q[2] - target[2], lim = 3.4, dl = Math.hypot(dx, dz);
    if (dl > lim) { q[0] = target[0] + dx / dl * lim; q[2] = target[2] + dz / dl * lim; }
    q[1] = Math.min(Math.max(q[1], 0.02), 3.2);
    return q;
  }

  function applyDrag(x, y) { const p = dragTarget(x, y); if (p) sim.moveGrab(p, rotMat(cam.fwd, drag.twist)); }
  const touches = new Map();
  let pinch = null;
  function endDrag() {
    touches.clear(); pinch = null;
    sim.endGrab(); drag.mode = null; drag.second = null; drag.id = -1; canvas.dataset.cursor = '';
    for (const id of captured) { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); }
    captured.clear();
  }
  const captured = new Set();
  function capture(id) { try { canvas.setPointerCapture(id); captured.add(id); } catch { /* synthetic input */ } }
  function localPoint(e) { const r=canvas.getBoundingClientRect(); return window.innerHeight > window.innerWidth ? {x:e.clientY-r.top,y:r.right-e.clientX} : {x:e.clientX-r.left,y:e.clientY-r.top}; }
  on(canvas, 'pointerdown', e => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: localPoint(e).x, y: localPoint(e).y });
      if (drag.mode === 'orbit' && touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: state.zoom };
        capture(e.pointerId); return;
      }
    }
    if (drag.mode === 'grab' && e.pointerId !== drag.id && e.pointerType === 'touch') {
      drag.second = { id: e.pointerId, x: localPoint(e).x, y: localPoint(e).y };
      drag.twist0 = drag.twist - Math.atan2(localPoint(e).y-drag.lastY,localPoint(e).x-drag.lastX); capture(e.pointerId); return;
    }
    if (drag.mode || e.button > 0) return;
    e.preventDefault(); capture(e.pointerId);
    drag.id = e.pointerId; drag.lastX = localPoint(e).x; drag.lastY = localPoint(e).y;
    const ray = rayFrom(localPoint(e).x,localPoint(e).y), hit = state.paused ? null : (pick(ray) || pickNear(localPoint(e).x,localPoint(e).y,e.pointerType === 'touch' ? 34 : 18));
    if (hit) { drag.mode = 'grab'; drag.twist = 0; drag.plane = { p:hit,n:cam.fwd.slice() }; sim.beginGrab(hit,0.36); }
    else drag.mode = 'orbit';
    canvas.dataset.cursor = 'grabbing';
  });
  on(canvas, 'pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: localPoint(e).x, y: localPoint(e).y });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      state.zoom = Math.max(0.6, Math.min(1.7, pinch.zoom * pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
      draw(); return;
    }
    if (drag.second?.id === e.pointerId) {
      drag.twist = Math.max(-1.3,Math.min(1.3,drag.twist0+Math.atan2(localPoint(e).y-drag.lastY,localPoint(e).x-drag.lastX)));
      applyDrag(drag.lastX,drag.lastY); return;
    }
    if (drag.id !== e.pointerId || !drag.mode) {
      if (!drag.mode) canvas.dataset.cursor = !state.paused && pick(rayFrom(localPoint(e).x,localPoint(e).y)) ? 'grab' : '';
      return;
    }
    const dx=localPoint(e).x-drag.lastX,dy=localPoint(e).y-drag.lastY; drag.lastX=localPoint(e).x;drag.lastY=localPoint(e).y;
    if (drag.mode === 'orbit') { state.az -= dx*0.006;state.el=Math.max(0.12,Math.min(1.3,state.el+dy*0.005)); }
    else applyDrag(localPoint(e).x,localPoint(e).y);
    if (!running || state.paused) draw();
  });
  const release = e => {
    captured.delete(e.pointerId);
    touches.delete(e.pointerId);
    if (pinch) {
      pinch = null;
      const remaining = [...touches.entries()][0];
      if (remaining) { drag.id = remaining[0]; drag.lastX = remaining[1].x; drag.lastY = remaining[1].y; }
      else endDrag();
      return;
    }
    if (drag.second?.id === e.pointerId) { drag.second=null;return; }
    if (drag.id === e.pointerId) endDrag();
  };
  on(canvas,'pointerup',release);on(canvas,'pointercancel',release);on(canvas,'lostpointercapture',release);
  on(canvas,'wheel',e => {
    e.preventDefault();
    const delta=e.deltaY*(e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    if(drag.mode === 'grab') {drag.twist=Math.max(-1.3,Math.min(1.3,drag.twist+delta*0.004));applyDrag(drag.lastX,drag.lastY);}
    else state.zoom=Math.max(0.6,Math.min(1.7,state.zoom*Math.exp(delta*0.001)));
    if (!running || state.paused) draw();
  },{passive:false});
  const resetView=()=>{state.az=0.62;state.el=0.36;state.zoom=1;target.splice(0,3,...home);draw();};
  on(canvas,'dblclick',resetView);
  let palette='ocean';
  for (const button of root.querySelectorAll('[data-colour]')) {
    button.setAttribute('aria-checked',String(button.dataset.colour===palette));
    on(button,'click',()=>{palette=button.dataset.colour; for(const b of root.querySelectorAll('[data-colour]')) b.setAttribute('aria-checked',String(b===button));draw();});
  }
  const firm=root.querySelector('[data-firm]'),damp=root.querySelector('[data-damp]');
  damp.value=String(Math.round(sim.damping*100));
  on(firm,'input',()=>{sim.firmness=Number(firm.value)/100;});on(damp,'input',()=>{sim.damping=Number(damp.value)/100;});
  on(root.querySelector('[data-reset]'),'click',()=>reset());
  function resize() {
    const rect={width:canvas.clientWidth,height:canvas.clientHeight};
    const dpr=Math.min(options.pixelRatio||1,options.quality==='low'?1:options.quality==='medium'?1.5:2);
    renderer.resize(rect.width*dpr,rect.height*dpr,rect.width,rect.height,dpr);draw();
  }
  let running=false,disposed=false,raf=0,last=0,acc=0,stepAvg=4,frames=0,seconds=0,fps=0,renderCount=0;
  function draw() {
    if (disposed || renderer.lost) return;
    skin();updateCamera();updateLight();
    renderer.setUniforms(cam,light,PALETTES[palette],{time:state.time,exposure:1,meshAlpha:0,bg:BG_ON,dark:0,glowP:[0,0,0,0],glowC:[0,0,0]});
    renderer.uploadGeometry(sim.x,false);renderer.draw(false);renderCount++;
  }
  function frame(now) {
    if(!running||disposed)return;
    const dt=Math.min((now-last)/1000,0.1);last=now;
    if(!state.paused) {
      acc+=dt;let steps=0;
      while(acc>=sim.stepDt&&steps<3) {const t=performance.now();sim.step();stepAvg+=(performance.now()-t-stepAvg)*0.05;acc-=sim.stepDt;steps++;}
      if(steps===3)acc=Math.min(acc,sim.stepDt);
      if(stepAvg>11&&sim.substeps>7&&state.time>2)sim.substeps=7;
      state.time+=dt;
    }
    followWhale(dt);draw();frames++;seconds+=dt;
    if(seconds>=1){fps=frames/seconds;frames=0;seconds=0;}
    raf=requestAnimationFrame(frame);
  }
  function start() {if(running||disposed||renderer.lost||state.paused)return;running=true;last=performance.now();raf=requestAnimationFrame(frame);}
  function pause() {running=false;cancelAnimationFrame(raf);endDrag();acc=0;}
  function reset() {endDrag();sim.reset(options.reducedMotion?0:1.2);acc=0;state.time=0;resetView();}
  renderer.onLost=()=>{pause();status.textContent='WEBGL CONTEXT LOST';};
  renderer.onRestored=()=>{status.textContent=state.paused?'在线摸鱼':'在线摸鱼';resize();if(wanted)start();};
  const observer=new ResizeObserver(resize);observer.observe(root);
  let wanted=false;
  sim.reset(options.reducedMotion?0:1.2);resize();status.textContent='在线摸鱼';
  return {
    start(){wanted=true;start();},pause(){wanted=false;pause();},resume(){wanted=true;start();},reset,resize,
    diagnostics(){return {particles:sim.n,tetrahedra:sim.nT,volume:sim.volumeRatio(),strain:sim.meanStrain(),fps,stepMs:stepAvg,substeps:sim.substeps,renderCount,running,zoom:state.zoom,grabbing:sim.grabbing,paused:state.paused};},
    destroy(){if(disposed)return;pause();disposed=true;abort.abort();observer.disconnect();renderer.dispose();root.remove();},
  };
  } catch (error) {
    abort.abort();renderer.dispose();root.remove();throw error;
  }

}

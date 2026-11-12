// Adapted from the public Blue Whale Jelly artifact. See SOURCE.md.
// ===== geometry.js =====
// ─────────────────────────────────────────────────────────────
//  Geometry: a blue whale cast in jelly, resting on its belly.
//  A signed distance field gives the body — a long, slender
//  section swept along the spine, the head broad and flat (a U
//  seen from above) with a long mouth line curving up to the eye,
//  a splash guard in front of twin blowholes, short narrow
//  flippers, a tiny dorsal fin far back, broad triangular flukes.
//  The throat is a pouch of clear jelly over a thin milky floor:
//  it balloons when the whale gulps, and fills with krill that is
//  then carried back to the stomach. Inside: a milky belly, rows
//  of licorice baleen hanging inside the upper jaw, bubbles.
//  A snapped hex lattice (5 tets per cell) for the simulation,
//  surface-nets render surfaces for the clear jelly and the milky
//  layer, and the barycentric embedding that ties every vertex to
//  a tetrahedron.
// ─────────────────────────────────────────────────────────────

// rest frame: the whale's length runs along x (flukes at −x, snout at +x), belly on the floor (y = 0), z across
const SHAPE = {
  x0: -1.46, x1: 1.62,       // the swept body, from the tail stock to the tip of the snout
  capT: 0.07, capS: 0.2,     // over these lengths the section closes, at the tail and round the broad snout
  floorK: 0.16,              // the fillet where the belly is pressed flat on the floor
  skin: 0.012,               // the milky layer sits this far under the surface
  blow: { x: 1.0, z: 0.034, a: 0.042, b: 0.016, c: 0.013 },    // twin blowholes, side by side
  guard: { x: 1.1, a: 0.1, b: 0.03, c: 0.055 },                 // the splash guard in front of them
  eye: { x: 0.9, a: 0.032, c: 0.025 },
  flip: { root: [0.6, 0.13, 0.27], dir: [-0.46, -0.26, 0.86], len: 0.4, r1: 0.07, r2: 0.022, th: 0.026 },
  fluke: { s0: [-1.46, 0.04], s1: [-1.76, 0.7], r1: 0.15, r2: 0.035, notch: [-1.76, 0.065] },
  dorsal: { x0: -0.8, x1: -0.94, h: 0.08, r1: 0.06, r2: 0.018, th: 0.024 },
  pouch: { x0: 0.26, x1: 1.55 },   // the throat: from the navel to the chin
};

// the body's outline along its length: x, the top of the back, the bottom of the belly, the half-width
// (authored slender, then scaled up in girth: a well-fed, chunky jelly)
const GIRTH = 1.38;
const PROFILE = [
  [-1.46, 0.11, 0.02, 0.045],
  [-1.25, 0.17, 0.0, 0.075],
  [-1.0, 0.25, -0.02, 0.12],
  [-0.7, 0.33, -0.035, 0.17],
  [-0.4, 0.4, -0.05, 0.21],
  [-0.1, 0.44, -0.06, 0.24],
  [0.2, 0.455, -0.065, 0.255],
  [0.5, 0.45, -0.065, 0.262],
  [0.8, 0.42, -0.06, 0.258],
  [1.05, 0.375, -0.05, 0.245],
  [1.3, 0.32, -0.035, 0.222],
  [1.5, 0.265, -0.02, 0.19],
  [1.62, 0.23, -0.01, 0.165],
].map(([x, t, b, w]) => [x, t * GIRTH, b * GIRTH, w * GIRTH]);

// seeded PRNG so the specimen is identical on each load
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// monotone cubic through the profile's knots (Fritsch–Carlson), one column at a time
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp01((x - xs[i]) / h), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// the mouth line along the side of the head: low at the snout, curving up toward the eye
const MOUTH_X0 = 0.9;
const mouthY = x => GIRTH * (0.09 + 0.05 * (SHAPE.x1 - x) / 0.65 + 0.032 * sstep(1.12, 0.92, x));
// the line between the clear jelly above and the milky layer below: it waves along the flank, sinks away along the
// tail stock, and in the throat thins to a milky floor under the clear pouch
function interfaceY(x, yc, ry) {
  let yb = yc - 0.3 * ry + 0.022 * Math.sin(6.0 * x + 0.8) + 0.009 * Math.sin(14.7 * x + 2.1);
  yb -= sstep(-0.5, -1.0, x) * 1.3 * ry;
  return yb + (0.04 - yb) * sstep(0.18, 0.42, x);
}
// how boxy the section is: round along the body, a little squarer (flat-topped, broad) at the head
const powAt = x => 2 + 0.45 * sstep(0.8, 1.35, x);

// the swept section, tabulated along x: centre height, half-height, half-width, and the milky line
const AXN = 1024;
const AX = (() => {
  const xs = PROFILE.map(p => p[0]);
  const top = monotone(xs, PROFILE.map(p => p[1])), bot = monotone(xs, PROFILE.map(p => p[2])), wid = monotone(xs, PROFILE.map(p => p[3]));
  const S = SHAPE, out = new Float32Array(AXN * 4);
  for (let i = 0; i < AXN; i++) {
    const x = S.x0 + (S.x1 - S.x0) * i / (AXN - 1);
    const T = top(x), B = bot(x);
    let f = 1;
    if (x < S.x0 + S.capT) f = Math.sqrt(Math.max(0, 1 - ((S.x0 + S.capT - x) / S.capT) ** 2));
    if (x > S.x1 - S.capS) f = Math.sqrt(Math.max(0, 1 - ((x - (S.x1 - S.capS)) / S.capS) ** 2));
    const yc = (T + B) / 2, ry = Math.max(0.004, (T - B) / 2 * f), rz = Math.max(0.004, wid(x) * f);
    out[4 * i] = yc; out[4 * i + 1] = ry; out[4 * i + 2] = rz; out[4 * i + 3] = interfaceY(x, yc, (T - B) / 2);
  }
  return out;
})();
function axisAt(x) {
  const S = SHAPE, f = clamp01((x - S.x0) / (S.x1 - S.x0)) * (AXN - 1), i = Math.min(AXN - 2, Math.floor(f)), t = f - i;
  return [0, 1, 2, 3].map(k => AX[4 * i + k] + (AX[4 * i + 4 + k] - AX[4 * i + k]) * t);
}
const topAt = x => { const a = axisAt(x); return a[0] + a[1]; };

// iq's uneven capsule in 2D: a circle of radius r1 at the origin joined by tangent lines to one of radius r2 at (0, h)
function sdUnevenCapsule(px, py, r1, r2, h) {
  px = Math.abs(px);
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b), k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * h) return Math.hypot(px, py - h) - r2;
  return a * px + b * py - r1;
}
// a 2D outline given thickness 2·th, its edges rounded with radius rr
function extrude(d2, t, th, rr) {
  const wx = d2 + rr, wy = Math.abs(t) - th + rr;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - rr;
}
function sdEllipsoid(px, py, pz, a, b, c) {
  const k0 = Math.hypot(px / a, py / b, pz / c);
  if (k0 < 1) return (k0 - 1) * Math.min(a, b, c);
  const k1 = Math.hypot(px / (a * a), py / (b * b), pz / (c * c));
  return k0 * (k0 - 1) / k1;
}

// ── the parts (z ≥ 0: the whale is mirrored across its midline) ──
function bodyRaw(x, y, z) {
  const S = SHAPE, xc = Math.min(Math.max(x, S.x0), S.x1);
  const A = axisAt(xc), ry = A[1], rz = A[2], p = powAt(xc);
  const u = Math.abs(y - A[0]) / ry, v = Math.abs(z) / rz;
  const k0 = Math.pow(Math.pow(u, p) + Math.pow(v, p), 1 / p);
  const kq = Math.pow(Math.max(k0, 1e-6), 1 - p);
  const g = Math.hypot(kq * Math.pow(u, p - 1) / ry, kq * Math.pow(v, p - 1) / rz);
  let d = (k0 - 1) / Math.max(g, 1e-6);
  if (k0 < 1) d = Math.max(d, (k0 - 1) * Math.min(ry, rz));
  const ex = x - xc;
  return ex !== 0 ? Math.hypot(Math.max(d, 0), ex) : d;
}
const FLIP = (() => {
  const F = SHAPE.flip, l = Math.hypot(...F.dir), D = F.dir.map(v => v / l);
  let C = [D[2], 0, -D[0]]; const cl = Math.hypot(...C); C = C.map(v => v / cl);
  const T = [D[1] * C[2] - D[2] * C[1], D[2] * C[0] - D[0] * C[2], D[0] * C[1] - D[1] * C[0]];
  return { D, C, T };
})();
// a short, narrow, pointed flipper
function flipperSD(x, y, z) {
  const F = SHAPE.flip, { D, C, T } = FLIP;
  const px = x - F.root[0], py = y - F.root[1], pz = z - F.root[2];
  const s = px * D[0] + py * D[1] + pz * D[2];
  let c = px * C[0] + py * C[1] + pz * C[2];
  const t = px * T[0] + py * T[1] + pz * T[2];
  const u = clamp01(s / F.len);
  c -= 0.014 * Math.sin(Math.PI * u);
  const d2 = sdUnevenCapsule(c, s, F.r1, F.r2, F.len);
  return extrude(d2, t, F.th * (1 - 0.4 * u), 0.017);
}
const FLUKE = (() => {
  const F = SHAPE.fluke, vx = F.s1[0] - F.s0[0], vz = F.s1[1] - F.s0[1], L = Math.hypot(vx, vz);
  return { L, u: [vx / L, vz / L], v: [vz / L, -vx / L] };
})();
// broad triangular flukes, a straight trailing edge, a small notch
function flukeSD(x, y, z) {
  const F = SHAPE.fluke, { L, u, v } = FLUKE;
  const px = x - F.s0[0], pz = z - F.s0[1];
  const s = px * u[0] + pz * u[1];
  let c = px * v[0] + pz * v[1];
  const tt = clamp01(s / L);
  c -= 0.014 * Math.sin(Math.PI * tt) - 0.03 * tt * tt;
  let d2 = sdUnevenCapsule(c, s, F.r1, F.r2, L);
  d2 = smax(d2, F.notch[1] - Math.hypot(x - F.notch[0], z), 0.03);
  const hf = 0.046 - 0.024 * tt, yf = hf + 0.003 + 0.05 * tt * tt;
  return extrude(d2, y - yf, hf, 0.018);
}
const DORSAL = (() => {
  const F = SHAPE.dorsal;
  const b0 = [F.x0, topAt(F.x0) - 0.05], b1 = [F.x1, topAt(F.x1) + F.h];
  const vx = b1[0] - b0[0], vy = b1[1] - b0[1], L = Math.hypot(vx, vy);
  return { b0, L, u: [vx / L, vy / L] };
})();
// the tiny dorsal fin, far back
function dorsalSD(x, y, z) {
  const F = SHAPE.dorsal, { b0, L, u } = DORSAL;
  const px = x - b0[0], py = y - b0[1];
  const s = px * u[0] + py * u[1], c = px * u[1] - py * u[0];
  const d2 = sdUnevenCapsule(c, s, F.r1, F.r2, L);
  return extrude(d2, z, F.th * (1 - 0.3 * clamp01(s / L)), 0.02);
}
// the twin blowholes and the ridge of the splash guard in front of them
const BLOW = [SHAPE.blow.x, topAt(SHAPE.blow.x) - 0.003, SHAPE.blow.z];
const GUARD = [SHAPE.guard.x, topAt(SHAPE.guard.x) - 0.012, 0];

function bodyFlat(x, y, z) { return smax(bodyRaw(x, y, z), -y, SHAPE.floorK); }
function whaleSD(x, y, z) {
  z = Math.abs(z);
  let d = bodyFlat(x, y, z);
  const G = SHAPE.guard, B = SHAPE.blow;
  d = smin(d, sdEllipsoid(x - GUARD[0], y - GUARD[1], z, G.a, G.b, G.c), 0.03);
  d = smax(d, -sdEllipsoid(x - BLOW[0], y - BLOW[1], z - BLOW[2], B.a, B.b, B.c), 0.014);
  d = smin(d, flipperSD(x, y, z), 0.05);
  d = smin(d, flukeSD(x, y, z), 0.075);
  d = smin(d, dorsalSD(x, y, z), 0.06);
  return Math.max(d, -y);
}
// the milky layer: the belly drawn in by the skin below the wavy line (a thin floor under the throat)
function coreSD(x, y, z) {
  z = Math.abs(z);
  return smax(bodyFlat(x, y, z) + SHAPE.skin, y - axisAt(x)[3], 0.02);
}
// which part a rest-space point belongs to: 3 a fin, 2 the skin, 1 the clear jelly, 0 the milky layer
function partOf(x, y, z) {
  const az = Math.abs(z);
  const fin = Math.min(flipperSD(x, y, az), flukeSD(x, y, az), dorsalSD(x, y, az));
  if (fin < bodyFlat(x, y, az) - 0.01 && fin < 0.03) return 3;
  if (-whaleSD(x, y, z) < 0.06) return 2;
  return coreSD(x, y, z) < 0 ? 0 : 1;
}
// the throat pouch: how much a rest-space point belongs to it (the lower half of the body from the navel to the chin)
function pouchW(x, y) {
  const P = SHAPE.pouch, A = axisAt(x);
  const wx = sstep(P.x0, P.x0 + 0.32, x) * (1 - sstep(P.x1 - 0.22, P.x1, x));
  const lim = Math.min(A[0] + 0.12 * A[1], x > MOUTH_X0 - 0.1 ? mouthY(Math.max(x, MOUTH_X0)) - 0.01 : 9);
  return wx * sstep(lim, lim - 0.12, y);
}
function sdGrad(sd, x, y, z, e = 1e-3) {
  const gx = sd(x + e, y, z) - sd(x - e, y, z), gy = sd(x, y + e, z) - sd(x, y - e, z), gz = sd(x, y, z + e) - sd(x, y, z - e);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * e)];
}
// Newton steps onto the zero set
function project(sd, p, iters = 4) {
  for (let it = 0; it < iters; it++) {
    const d = sd(p[0], p[1], p[2]);
    if (Math.abs(d) < 1e-5) break;
    const g = sdGrad(sd, p[0], p[1], p[2]);
    const s = d / Math.max(0.3, g[3]);
    p[0] -= g[0] * s; p[1] -= g[1] * s; p[2] -= g[2] * s;
  }
  return p;
}

// ── surface nets: one vertex per sign-changing cell, projected onto the surface ──
function surfaceNets(sd, box, s) {
  const x0 = box[0] - s, y0 = box[1] - s, z0 = box[2] - s;
  const nx = Math.ceil((box[3] - box[0]) / s) + 3, ny = Math.ceil((box[4] - box[1]) / s) + 3, nz = Math.ceil((box[5] - box[2]) / s) + 3;
  const nxy = nx * ny;
  const val = new Float32Array(nxy * nz);
  for (let k = 0; k < nz; k++) { const z = z0 + k * s; for (let j = 0; j < ny; j++) { const y = y0 + j * s, o = nx * j + nxy * k; for (let i = 0; i < nx; i++) val[o + i] = sd(x0 + i * s, y, z); } }
  const cellV = new Int32Array(nxy * nz).fill(-1);
  const pos = [], nrm = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const off = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k;
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[base + off[c]]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      ax += (a & 1) + (((b & 1) - (a & 1)) * t); ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); az += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    const p = project(sd, [x0 + (i + ax / n) * s, y0 + (j + ay / n) * s, z0 + (k + az / n) * s], 3);
    const g = sdGrad(sd, p[0], p[1], p[2]);
    cellV[base] = pos.length / 3;
    pos.push(p[0], p[1], p[2]); nrm.push(g[0], g[1], g[2]);
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const dAC = (pos[3 * a] - pos[3 * c]) ** 2 + (pos[3 * a + 1] - pos[3 * c + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * c + 2]) ** 2;
    const dBD = (pos[3 * b] - pos[3 * d]) ** 2 + (pos[3 * b + 1] - pos[3 * d + 1]) ** 2 + (pos[3 * b + 2] - pos[3 * d + 2]) ** 2;
    if (dAC < dBD) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const base = i + nx * j + nxy * k, in0 = val[base] < 0;
    if (in0 !== (val[base + 1] < 0)) quad(cellV[base - nx - nxy], cellV[base - nxy], cellV[base], cellV[base - nx]);
    if (in0 !== (val[base + nx] < 0)) quad(cellV[base - 1 - nxy], cellV[base - 1], cellV[base], cellV[base - nxy]);
    if (in0 !== (val[base + nxy] < 0)) quad(cellV[base - 1 - nx], cellV[base - nx], cellV[base], cellV[base - 1]);
  }
  return { pos, nrm, idx };
}

// ── simulation lattice: hex cells, 5 tets each, boundary nodes snapped onto the surface ──
// a node layer lands exactly on the floor (y = 0), so the footprint stays flat
function buildSimMesh(h = 0.12) {
  const sd = whaleSD;
  const hh = [h, h * 0.85, h];
  const ext = [[-1.84, 1.7], [-0.9, 0.9]];
  const n = [Math.ceil((ext[0][1] - ext[0][0]) / hh[0]), Math.ceil(0.72 / hh[1]), Math.ceil((ext[1][1] - ext[1][0]) / hh[2])];
  const o = [(ext[0][0] + ext[0][1]) / 2 - n[0] * hh[0] / 2, 0, -n[2] * hh[2] / 2];
  const S = [n[0] + 1, n[1] + 1, n[2] + 1];
  const nodeAt = (i, j, k) => [o[0] + i * hh[0], o[1] + j * hh[1], o[2] + k * hh[2]];
  const hm = Math.min(...hh);
  const keep = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const x = o[0] + (i + 0.5) * hh[0], y = o[1] + (j + 0.5) * hh[1], z = o[2] + (k + 0.5) * hh[2];
    // generous, so the thin fins and flukes keep a connected run of cells
    if (sd(x, y, z) < 0.4 * hm) keep[i + n[0] * (j + n[1] * k)] = 1;
  }
  const kept = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && keep[i + n[0] * (j + n[1] * k)] === 1;
  const nodeId = new Int32Array(S[0] * S[1] * S[2]).fill(-1);
  const rest = [], boundary = [];
  const nid = (i, j, k) => {
    const key = i + S[0] * (j + S[1] * k);
    if (nodeId[key] >= 0) return nodeId[key];
    const p = nodeAt(i, j, k);
    nodeId[key] = rest.length / 3;
    rest.push(p[0], p[1], p[2]);
    let all = true;
    for (let a = 0; a < 8; a++) if (!kept(i - 1 + (a & 1), j - 1 + ((a >> 1) & 1), k - 1 + ((a >> 2) & 1))) { all = false; break; }
    boundary.push(all ? 0 : 1);
    return nodeId[key];
  };
  const tets = [];
  const T0 = [[0, 1, 3, 5], [0, 3, 2, 6], [0, 5, 4, 6], [3, 5, 6, 7], [0, 3, 5, 6]];
  const T1 = [[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (!kept(i, j, k)) continue;
    const cn = [];
    for (let a = 0; a < 8; a++) cn.push(nid(i + (a & 1), j + ((a >> 1) & 1), k + ((a >> 2) & 1)));
    for (const t of ((i + j + k) & 1 ? T1 : T0)) tets.push(cn[t[0]], cn[t[1]], cn[t[2]], cn[t[3]]);
  }
  const nN = rest.length / 3;
  const R = new Float64Array(rest);
  const volOf = (P, t) => tetVolume(P, tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  for (let t = 0; t < tets.length / 4; t++) if (volOf(R, t) < 0) { const q = tets[4 * t + 2]; tets[4 * t + 2] = tets[4 * t + 3]; tets[4 * t + 3] = q; }
  const v0 = hh[0] * hh[1] * hh[2] / 6;
  // snap boundary nodes onto the surface (in or out), then back off wherever that would crush a tet
  const snapped = new Float64Array(nN * 3);
  for (let i = 0; i < nN; i++) {
    const p = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    if (boundary[i] && p[1] > 1e-6 && sd(p[0], p[1], p[2]) > -0.95 * hm) project(sd, p, 6);
    if (boundary[i] && p[1] <= 1e-6) {                    // floor nodes slide along the floor only
      const q = [p[0], 0.002, p[2]]; project((x, y, z) => whaleSD(x, 0.002, z), q, 6); p[0] = q[0]; p[2] = q[2]; p[1] = 0;
    }
    snapped.set(p, 3 * i);
  }
  const P = new Float64Array(snapped);
  const blend = new Float32Array(nN).fill(1);
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let t = 0; t < tets.length / 4; t++) {
      if (volOf(P, t) > 0.12 * v0) continue;
      bad++;
      for (let q = 0; q < 4; q++) {
        const v = tets[4 * t + q];
        if (!boundary[v] || blend[v] <= 0) continue;
        blend[v] = Math.max(0, blend[v] - 0.34);
        for (let k = 0; k < 3; k++) P[3 * v + k] = R[3 * v + k] + (snapped[3 * v + k] - R[3 * v + k]) * blend[v];
      }
    }
    if (!bad) break;
  }
  const keepT = [];
  for (let t = 0; t < tets.length / 4; t++) if (volOf(P, t) > 0.03 * v0) keepT.push(tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  // drop nodes no surviving tet uses
  const used = new Int32Array(nN).fill(-1); let nu = 0;
  for (const v of keepT) if (used[v] < 0) used[v] = nu++;
  const restOut = new Float32Array(nu * 3);
  for (let i = 0; i < nN; i++) if (used[i] >= 0) restOut.set([P[3 * i], P[3 * i + 1], P[3 * i + 2]], 3 * used[i]);
  const tetsOut = new Uint32Array(keepT.map(v => used[v]));
  const region = new Uint8Array(nu);
  for (let i = 0; i < nu; i++) region[i] = partOf(restOut[3 * i], restOut[3 * i + 1], restOut[3 * i + 2]);
  return { rest: restOut, tets: tetsOut, region, h: hh };
}

function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// a point on the outer surface: straight down from above at (x, z), or straight out from the midline at (x, y)
function surfaceDown(x, z) { let lo = -0.01, hi = 1.0; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (whaleSD(x, m, z) < 0) lo = m; else hi = m; } return [x, lo, z]; }
function surfaceOut(x, y) { let lo = 0, hi = 1.3; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (whaleSD(x, y, m) < 0) lo = m; else hi = m; } return [x, y, lo]; }

// the eye (z > 0 side; mirrored for the other): a small bead on the side of the head, just over the corner of the mouth
const EYE = (() => {
  const S = SHAPE, x = S.eye.x, y = mouthY(MOUTH_X0) + 0.032;
  const s = surfaceOut(x, y), g = sdGrad(whaleSD, s[0], s[1], s[2]);
  const w = [g[0], g[1], g[2]];
  let u = [1 - w[0] * w[0], -w[0] * w[1], -w[0] * w[2]]; { const l = Math.hypot(...u); u = u.map(q => q / l); }
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const p = [s[0] - w[0] * S.eye.c * 0.35, s[1] - w[1] * S.eye.c * 0.35, s[2] - w[2] * S.eye.c * 0.35];
  return { p, u, v, w };
})();

// the baleen: rows of thin licorice plates hanging inside the upper jaw, just over the mouth line, on both sides
const BALEEN = (() => {
  const out = [], n = 18;
  for (let i = 0; i < n; i++) {
    const x = 1.0 + i * (1.5 - 1.0) / (n - 1), ym = mouthY(x);
    const half = surfaceOut(x, ym + 0.03)[2];
    out.push({ p: [x, ym + 0.044, Math.max(0.04, half - 0.1)], h: 0.04 - 0.01 * (i / (n - 1)), w: 0.028 });
  }
  return out;
})();

// ── render mesh ──
// material ids: 0 body (clear jelly), 1 a drop of the spout, 2 eye, 3 the milky layer, 4 bubble, 5 baleen, 6 krill

function buildRenderMesh() {
  const S = SHAPE;
  const nets = surfaceNets(whaleSD, [-1.82, -0.02, -0.86, 1.68, 0.7, 0.86], 0.021);
  const pos = nets.pos.slice(), nrm = nets.nrm.slice(), mat = new Array(pos.length / 3).fill(0), idx = nets.idx.slice();
  const ctr = new Array(pos.length / 3 * 4).fill(0);
  const add = (x, y, z, m, nx, ny, nz, c = null) => { pos.push(x, y, z); nrm.push(nx, ny, nz); mat.push(m); ctr.push(...(c || [0, 0, 0, 0])); return pos.length / 3 - 1; };
  const bodyIndexCount = idx.length, bodyVertCount = pos.length / 3;
  const propStart = idx.length;

  // ── the milky layer: its own surface, under the skin ──
  const core = surfaceNets(coreSD, [-1.3, -0.02, -0.44, 1.62, 0.5, 0.44], 0.02);
  const cv0 = pos.length / 3;
  for (let v = 0; v < core.pos.length / 3; v++) add(core.pos[3 * v], core.pos[3 * v + 1], core.pos[3 * v + 2], 3, core.nrm[3 * v], core.nrm[3 * v + 1], core.nrm[3 * v + 2]);
  for (const i of core.idx) idx.push(cv0 + i);
  const coreRange = { first: propStart, count: idx.length - propStart };

  // a little ellipsoid of rings × segs, in a frame (u, w, v) about p, semi-axes (a along u, c along w, b along v)
  const ovoid = (p, u, w, v, a, b, c, m, rings, segs, cv) => {
    const base = pos.length / 3;
    const local = (t, ph) => [-Math.cos(t) * a, Math.cos(ph) * Math.sin(t) * c, Math.sin(ph) * Math.sin(t) * b];
    const toW = q => [p[0] + u[0] * q[0] + w[0] * q[1] + v[0] * q[2], p[1] + u[1] * q[0] + w[1] * q[1] + v[1] * q[2], p[2] + u[2] * q[0] + w[2] * q[1] + v[2] * q[2]];
    const vtx = q => {
      const P = toW(q);
      const nq = [q[0] / (a * a), q[1] / (c * c), q[2] / (b * b)], n = toW(nq).map((x, k) => x - p[k]); const l = Math.hypot(...n) || 1;
      return add(P[0], P[1], P[2], m, n[0] / l, n[1] / l, n[2] / l, cv);
    };
    const top = vtx(local(0, 0));
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) vtx(local(Math.PI * i / rings, 2 * Math.PI * j / segs + (i & 1) * Math.PI / segs));
    const bot = vtx(local(Math.PI, 0));
    const ring = i => base + 1 + (i - 1) * segs;
    for (let j = 0; j < segs; j++) idx.push(top, ring(1) + j, ring(1) + (j + 1) % segs);
    for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
      const p0 = ring(i) + j, p1 = ring(i) + (j + 1) % segs, p2 = ring(i + 1) + j, p3 = ring(i + 1) + (j + 1) % segs;
      idx.push(p0, p2, p3, p0, p3, p1);
    }
    for (let j = 0; j < segs; j++) idx.push(ring(rings - 1) + j, bot, ring(rings - 1) + (j + 1) % segs);
    return { v0: base, nv: pos.length / 3 - base };
  };

  // ── the eyes ──
  for (const sgn of [1, -1]) {
    const m = q => [q[0], q[1], q[2] * sgn];
    ovoid(m(EYE.p), m(EYE.u), m(EYE.w), m(EYE.v), S.eye.a, S.eye.a * 0.86, S.eye.c, 2, 8, 14, [...m(EYE.p), S.eye.a]);
  }
  // ── the baleen: flat plates across the jaw, each a thin disc in the y–z plane ──
  for (const sgn of [1, -1]) for (const B of BALEEN) {
    const p = [B.p[0], B.p[1], B.p[2] * sgn];
    ovoid(p, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.0042, B.w, B.h, 5, 4, 10, [...p, B.h]);
  }

  // ── bubbles trapped in the clear jelly as it set (most of them small), kept out of the throat ──
  const R = rng(5858), bubbles = [];
  let tries = 0;
  while (bubbles.length < 28 && tries++ < 30000) {
    const x = -1.1 + R() * 2.5, y = 0.05 + R() * 0.58, z = (R() - 0.5) * 0.7;
    const r = 0.008 + 0.02 * Math.pow(R(), 2.2);
    if (whaleSD(x, y, z) > -(0.035 + r) || y < axisAt(x)[3] + 0.03 + r) continue;
    if (pouchW(x, y) > 0.02 || (x > 0.95 && y < mouthY(Math.min(x, 1.6)) + 0.08)) continue;
    if (x > -0.35 && x < 0.3 && y < axisAt(x)[0] + 0.12 * axisAt(x)[1] + r) continue;     // the stomach
    if (bubbles.some(b => Math.hypot(b[0] - x, b[1] - y, b[2] - z) < b[3] + r + 0.02)) continue;
    bubbles.push([x, y, z, r]);
  }
  for (const b of bubbles) ovoid([b[0], b[1], b[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1], b[3], b[3], b[3] * 0.92, 4, b[3] > 0.015 ? 5 : 4, b[3] > 0.015 ? 9 : 6, b);

  const propCount = idx.length - propStart;

  // make every triangle's winding agree with its analytic outward normal (CCW = front)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b1 = idx[i + 1], c = idx[i + 2];
    const e1 = [pos[3 * b1] - pos[3 * a], pos[3 * b1 + 1] - pos[3 * a + 1], pos[3 * b1 + 2] - pos[3 * a + 2]];
    const e2 = [pos[3 * c] - pos[3 * a], pos[3 * c + 1] - pos[3 * a + 1], pos[3 * c + 2] - pos[3 * a + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let d = 0;
    for (const v of [a, b1, c]) d += fn[0] * nrm[3 * v] + fn[1] * nrm[3 * v + 1] + fn[2] * nrm[3 * v + 2];
    if (d < 0) { idx[i + 1] = c; idx[i + 2] = b1; }
  }

  return {
    rest: new Float32Array(pos), restNormal: new Float32Array(nrm), mat: new Float32Array(mat), ctr: new Float32Array(ctr),
    index: new Uint32Array(idx),
    body: { first: 0, count: bodyIndexCount },
    core: coreRange,
    seeds: { first: propStart, count: propCount },
    bodyVertCount,
    bubbleCount: bubbles.length, baleenCount: BALEEN.length * 2,
  };
}
// ── barycentric embedding of points into tets (nearest tet when a point lies outside) ──
// `skip` = [first, count] of vertices to leave out
function embed(simRest, tets, verts, skip = [0, 0]) {
  const nT = tets.length / 4, nV = verts.length / 3;
  const cell = 0.25;
  const grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
    for (const v of id) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c]); }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++)
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++)
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k); let l = grid.get(K); if (!l) grid.set(K, l = []); l.push(t);
        }
    const a = id[0], m = [];
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const id2 = 1 / det;
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * id2;
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * id2;
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * id2;
  }
  const tetOf = new Uint32Array(nV);
  const w = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    if (v >= skip[0] && v < skip[0] + skip[1]) continue;
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    let best = -1, bestScore = -Infinity, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    const tryT = t => {
      const a = tets[4 * t];
      const dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2], I = 9 * t;
      const q1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz;
      const q2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz;
      const q3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz;
      const q0 = 1 - q1 - q2 - q3;
      const s = Math.min(q0, q1, q2, q3);
      if (s > bestScore) { bestScore = s; best = t; b0 = q0; b1 = q1; b2 = q2; b3 = q3; }
    };
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let r = 0; r <= 4; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const l = grid.get(key(i, j, k)); if (l) for (const t of l) tryT(t);
      }
      if (bestScore >= -1e-4 || (r >= 1 && best >= 0 && bestScore > -0.45)) break;
    }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t);
    tetOf[v] = best; w[4 * v] = b0; w[4 * v + 1] = b1; w[4 * v + 2] = b2; w[4 * v + 3] = b3;
  }
  return { tetOf, w };
}


export { SHAPE, GIRTH, PROFILE, rng, smax, smin, clamp01, sstep, monotone, MOUTH_X0, mouthY, interfaceY, powAt, AXN, AX, axisAt, topAt, sdUnevenCapsule, extrude, sdEllipsoid, bodyRaw, FLIP, flipperSD, FLUKE, flukeSD, DORSAL, dorsalSD, BLOW, GUARD, bodyFlat, whaleSD, coreSD, partOf, pouchW, sdGrad, project, surfaceNets, buildSimMesh, tetVolume, surfaceDown, surfaceOut, EYE, BALEEN, buildRenderMesh, embed };

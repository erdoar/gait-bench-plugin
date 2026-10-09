// terrain.mjs — the ground as a polygon grid: a height field built from features Claude reasons out, meshed as a fine
// grid around the action and a coarse grid out to the horizon, rasterised per frame with flat-shaded facets and an
// optional wire grid draped over it. Pure JavaScript with no imports, so the viewer page can inline it.

const RAD = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (c, fb) => {
  if (Array.isArray(c) && c.length >= 3) return c.slice(0, 3);
  if (typeof c === 'string') { let h = c.trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((x) => x + x).join(''); if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  return fb;
};
function h2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy); const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w; }
function fbm(x, y) { let s = 0, amp = 0.5, n = 0; for (let i = 0; i < 4; i++) { s += amp * vn(x, y); n += amp; x *= 2.03; y *= 2.03; amp *= 0.5; } return s / n; }

/** Distance from p to a polyline, and the signed side (+ toward `toward` when given, else left of travel). */
function lineDist(p, line, toward) {
  let best = Infinity, side = 1;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2, 0, 1), qx = a[0] + t * dx, qz = a[1] + t * dz;
    const d = Math.hypot(p[0] - qx, p[1] - qz);
    if (d < best) {
      best = d;
      const cr = dx * (p[1] - a[1]) - dz * (p[0] - a[0]);
      const ref = toward ? dx * (toward[1] - a[1]) - dz * (toward[0] - a[0]) : 1;
      side = Math.sign(cr) === Math.sign(ref) || cr === 0 ? 1 : -1;
    }
  }
  return { d: best, s: best * side };
}
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export const TERRAIN_KINDS = ['step', 'ridge', 'mound', 'slope', 'area'];

/** Problems with a terrain block, as short sentences (empty when it is fine). */
export function terrainProblems(t) {
  const out = [];
  if (!t || typeof t !== 'object') return out;
  for (const f of t.features ?? []) {
    if (!TERRAIN_KINDS.includes(f.kind)) { out.push(`terrain feature kind must be one of ${TERRAIN_KINDS.join(', ')}`); continue; }
    if ((f.kind === 'step' || f.kind === 'ridge') && !(Array.isArray(f.line) && f.line.length >= 2)) out.push(`a ${f.kind} needs line: [[x, z], [x, z], …]`);
    if (f.kind === 'mound' && !(Array.isArray(f.at) && f.radius_m > 0)) out.push('a mound needs at: [x, z] and radius_m');
    if (f.kind === 'area' && !(Array.isArray(f.poly) && f.poly.length >= 3)) out.push('an area needs poly: [[x, z], …] with at least 3 corners');
  }
  return out;
}

/** The terrain for a scene, built once and cached on it; null when the scene has none. */
export function terrainOf(scene) {
  if (!scene?.terrain) return null;
  if (!scene.__terrain) Object.defineProperty(scene, '__terrain', { value: makeTerrain(scene), enumerable: false });
  return scene.__terrain;
}

export function makeTerrain(scene) {
  const T = scene.terrain, g = scene.ground ?? {};
  const feats = (T.features ?? []).filter((f) => TERRAIN_KINDS.includes(f.kind)).map((f) => ({ ...f, col: f.colour ? hex(f.colour, null) : null }));
  // where the person is: the poses' ground points (the terrain centres on them, and noise stays off the ground they cover)
  const path = (scene.poses ?? []).filter((p) => Array.isArray(p?.at)).map((p) => [p.at[0], p.at[1]]);
  const centre = T.centre ?? (path.length ? path.reduce((a, p) => [a[0] + p[0] / path.length, a[1] + p[1] / path.length], [0, 0]) : [0, 4]);
  const flatR = T.flat_under_path_m ?? 1.2;
  const noise = T.noise ?? null;

  /** Height and the material weights of each feature at (x, z). */
  function sample(x, z) {
    const p = [x, z];
    let h = 0; const w = new Array(feats.length).fill(0);
    feats.forEach((f, i) => {
      const H = f.height_m ?? 0;
      if (f.kind === 'step') { const { s } = lineDist(p, f.line, f.toward); const k = sstep(0, f.width_m ?? 4, s); h += H * k; w[i] = sstep(-0.2, 0.6, s); }
      else if (f.kind === 'ridge') { const { d } = lineDist(p, f.line); const k = 1 - sstep(0, f.width_m ?? 3, d); h += H * k; w[i] = k > 0.02 ? sstep(0.02, 0.2, k) : 0; }
      else if (f.kind === 'mound') { const d = Math.hypot(x - f.at[0], z - f.at[1]), k = 0.5 + 0.5 * Math.cos(Math.PI * clamp(d / f.radius_m, 0, 1)); h += H * k; w[i] = 1 - sstep(0.85 * f.radius_m, f.radius_m, d); }
      else if (f.kind === 'slope') { const a = (f.toward_deg ?? 0) * RAD; h += Math.tan((f.grade_deg ?? 0) * RAD) * ((x - centre[0]) * Math.sin(a) + (z - centre[1]) * Math.cos(a)); }
      else if (f.kind === 'area') { const ins = inPoly(p, f.poly); const e = f.edge_m ?? 0.4; let d = Infinity; for (let j = 0; j < f.poly.length; j++) d = Math.min(d, lineDist(p, [f.poly[j], f.poly[(j + 1) % f.poly.length]]).d); const k = ins ? sstep(0, e, d) : 0; h += H * k; w[i] = k; }
    });
    if (noise && noise.amp_m) {
      let n = (fbm(x / (noise.scale_m ?? 4), z / (noise.scale_m ?? 4)) - 0.5) * 2 * noise.amp_m;
      if (path.length >= 2 && flatR > 0) n *= sstep(flatR, 2 * flatR, lineDist(p, path).d);
      h += n;
    }
    return { h, w };
  }
  const height = (x, z) => sample(x, z).h;

  // ---- the mesh: a fine grid around the action, a coarse ring out to the horizon ----
  const near = { size: T.near?.size_m ?? 40, cell: T.near?.cell_m ?? 0.5 }, far = { half: T.extent_m ?? 300, cell: T.far_cell_m ?? 6 };
  const verts = [], tris = [];
  function grid(x0, z0, nx, nz, cell, skip) {
    const base = verts.length / 3, idx = (i, j) => base + j * (nx + 1) + i;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * cell, z = z0 + j * cell; verts.push(x, height(x, z), z); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (skip && skip(x0 + i * cell, z0 + j * cell, cell)) continue;
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
      tris.push(a, c, b, b, c, d);
    }
  }
  const nN = Math.round(near.size / near.cell), nx0 = centre[0] - (nN * near.cell) / 2, nz0 = centre[1] - (nN * near.cell) / 2, nx1 = nx0 + nN * near.cell, nz1 = nz0 + nN * near.cell;
  grid(nx0, nz0, nN, nN, near.cell, null);
  const nF = Math.round((2 * far.half) / far.cell), fx0 = centre[0] - far.half, fz0 = centre[1] - far.half;
  grid(fx0, fz0, nF, nF, far.cell, (x, z, c) => x >= nx0 - 1e-6 && x + c <= nx1 + 1e-6 && z >= nz0 - 1e-6 && z + c <= nz1 + 1e-6);
  const V = new Float32Array(verts), I = new Uint32Array(tris), nTri = I.length / 3;
  const N = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; N[3 * t] = nx / l; N[3 * t + 1] = ny / l; N[3 * t + 2] = nz / l;
  }

  // ---- materials ----
  const base = hex(g.colour, [139, 141, 134]), pcol = g.patches ? hex(g.patches.colour, [235, 238, 240]) : null;
  const pSize = g.patches?.size_m ?? 0.5, pCover = clamp(g.patches?.cover ?? 0.3, 0, 1), baseShine = clamp(g.shine ?? 0, 0, 1);
  /** Colour, shine and patch weight at a ground point seen with a footprint of fp metres per pixel. */
  function material(x, z, fp) {
    const { w } = sample(x, z);
    let col = base, shine = baseShine, m = 0;
    if (pcol) { const raw = sstep(1 - pCover - 0.04, 1 - pCover + 0.04, fbm(x / pSize, z / pSize)); m = raw + (pCover - raw) * clamp((fp / pSize - 0.1) / 0.5, 0, 1); }
    let cov = 0;
    feats.forEach((f, i) => { if (!f.col || w[i] <= 0) return; const k = w[i] * (0.85 + 0.3 * vn(x * 0.7 + i * 13, z * 0.7)); const kk = clamp(k, 0, 1); col = [col[0] + (f.col[0] - col[0]) * kk, col[1] + (f.col[1] - col[1]) * kk, col[2] + (f.col[2] - col[2]) * kk]; shine += ((f.shine ?? 0) - shine) * kk; cov = Math.max(cov, kk); });
    return { col, shine, patch: m * (1 - cov), pcol };
  }

  // ---- the wire grid draped over the terrain ----
  const G = T.grid ?? {}, gridOn = G.show !== false, every = G.every_m ?? 1, gcol = hex(G.colour, [255, 255, 255]), gop = clamp(G.opacity ?? 0.35, 0, 1), gfade = G.fade_m ?? 60, gwid = G.width_px ?? 1.2;
  const coarse = G.coarse_every_m ?? 10, micro = G.micro_every_m ?? 0, microFade = G.micro_fade_m ?? 4;
  /** How much grid line covers the pixel at ground point (x, z), with footprint fp metres per pixel at distance d. */
  function gridAlpha(x, z, fp, d) {
    if (!gridOn) return 0;
    const line = (e, wpx) => { const hw = Math.max(fp * wpx * 0.5, 1e-4); const fx = Math.abs(x / e - Math.round(x / e)) * e, fz = Math.abs(z / e - Math.round(z / e)) * e; return Math.max(clamp(1 - (fx - hw) / fp, 0, 1), clamp(1 - (fz - hw) / fp, 0, 1)); };
    const fine = fp < every / 3 ? line(every, gwid) * (1 - sstep(gfade * 0.6, gfade, d)) : 0;
    const big = coarse > 0 && fp < coarse / 3 ? line(coarse, gwid * 1.6) * (1 - sstep(gfade * 3, gfade * 6, d)) : 0;
    const mic = micro > 0 && fp < micro / 2.5 ? 0.55 * line(micro, gwid * 0.7) * (1 - sstep(microFade * 0.5, microFade, d)) : 0;
    return gop * Math.max(fine, big, mic);
  }

  // ---- per-frame raster: view depth and facet normal per pixel ----
  let depth = null, nrmIdx = null, cx = null;
  function raster(cam) {
    const W = cam.width, H = cam.height, n = W * H;
    if (!depth || depth.length !== n) { depth = new Float32Array(n); nrmIdx = new Int32Array(n); }
    depth.fill(Infinity); nrmIdx.fill(-1);
    const nv = V.length / 3; if (!cx || cx.length !== nv * 3) cx = new Float32Array(nv * 3);
    const { eye, right, up, fwd, f } = cam;
    for (let i = 0; i < nv; i++) {
      const dx = V[3 * i] - eye[0], dy = V[3 * i + 1] - eye[1], dz = V[3 * i + 2] - eye[2];
      cx[3 * i] = dx * right[0] + dy * right[1] + dz * right[2]; cx[3 * i + 1] = dx * up[0] + dy * up[1] + dz * up[2]; cx[3 * i + 2] = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    }
    const NEAR = 0.05, poly = [], clipd = [];
    for (let t = 0; t < nTri; t++) {
      poly.length = 0;
      for (let k = 0; k < 3; k++) { const j = I[3 * t + k] * 3; poly.push([cx[j], cx[j + 1], cx[j + 2]]); }
      if (poly[0][2] < NEAR && poly[1][2] < NEAR && poly[2][2] < NEAR) continue;
      let P = poly;
      if (P[0][2] < NEAR || P[1][2] < NEAR || P[2][2] < NEAR) { // clip against the near plane
        clipd.length = 0;
        for (let k = 0; k < P.length; k++) {
          const A = P[k], B = P[(k + 1) % P.length], ia = A[2] >= NEAR, ib = B[2] >= NEAR;
          if (ia) clipd.push(A);
          if (ia !== ib) { const u = (NEAR - A[2]) / (B[2] - A[2]); clipd.push([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, NEAR]); }
        }
        P = clipd.slice();
      }
      const S = P.map((q) => [cam.cx + (f * q[0]) / q[2], cam.cy - (f * q[1]) / q[2], 1 / q[2]]);
      for (let k = 1; k + 1 < S.length; k++) fillTri(S[0], S[k], S[k + 1], t, W, H);
    }
    return { depth, nrmIdx };
  }
  function fillTri(a, b, c, t, W, H) {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) return;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-12) return;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let w0 = (b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px), w1 = (c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px), w2 = (a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px);
        if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const A = Math.abs(area), iz = (w0 * a[2] + w1 * b[2] + w2 * c[2]) / A, Z = 1 / iz, j = y * W + x;
        if (Z < depth[j]) { depth[j] = Z; nrmIdx[j] = t; }
      }
    }
  }
  const normal = (t) => [N[3 * t], N[3 * t + 1], N[3 * t + 2]];
  const stats = { vertices: V.length / 3, triangles: nTri, near_cell_m: near.cell, near_size_m: near.size, far_cell_m: far.cell, extent_m: far.half };
  return { height, material, gridAlpha, gridColour: gcol, raster, normal, stats, centre };
}

// world.mjs — the solid set around the subject. Within world.radius_m of the action the scene is built as real
// geometry (tree stands placed one tree at a time on the terrain, props stood on the ground), so it holds together
// when the view orbits; beyond that radius the far bands form a ring fixed to the world, not to the camera. Pure
// JavaScript with no imports, so the viewer page can inline it.

const RAD = Math.PI / 180;
const hashW = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** What a stand can be: the trees of a winter wood, mostly. */
export const STAND_KINDS = ['pine', 'spruce', 'birch', 'bare', 'shrub'];
const DEFAULTS = {
  pine: { height_m: 18, spacing_m: 3.5, trunk: '#6e4a3a', crown: '#2e3b2a' }, // Scots pine: tall reddish trunk, crown at the top
  spruce: { height_m: 12, spacing_m: 3, trunk: '#4a3a2e', crown: '#24332a' }, // a cone of dark branches to the ground
  birch: { height_m: 14, spacing_m: 3, trunk: '#dcd8cf', crown: '#6d5a55' }, // white trunk, purple-grey twigs
  bare: { height_m: 12, spacing_m: 4, trunk: '#5e534a', crown: '#6a5d54' }, // a leafless broadleaf
  shrub: { height_m: 1.5, spacing_m: 2, trunk: '#4d4237', crown: '#4b5a3f' },
};

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPts = (p) => Array.isArray(p) && p.length >= 2 && p.every((q) => Array.isArray(q) && isNum(q[0]) && isNum(q[1]));

/** Problems with a scene's world block, as short sentences. */
export function worldProblems(raw) {
  const w = raw?.world;
  if (w == null) return [];
  const out = [];
  if (typeof w !== 'object') return ['world must be an object: {radius_m, centre, stands}'];
  if (w.radius_m != null && !(isNum(w.radius_m) && w.radius_m >= 4 && w.radius_m <= 60)) out.push('world.radius_m must be 4–60');
  if (w.centre != null && !(Array.isArray(w.centre) && isNum(w.centre[0]) && isNum(w.centre[1]))) out.push('world.centre must be [x, z]');
  for (const s of w.stands ?? []) {
    if (!STAND_KINDS.includes(s?.kind)) { out.push(`each world.stands entry needs kind (${STAND_KINDS.join(', ')})`); break; }
    if (!(s.area && isPts(s.area) && s.area.length >= 3) && !(s.line && isPts(s.line))) { out.push('each world stand needs area (three or more [x, z] points) or line ([x, z] points, with width_m)'); break; }
    if (s.spacing_m != null && !(isNum(s.spacing_m) && s.spacing_m >= 0.8)) { out.push('world stand spacing_m must be at least 0.8'); break; }
  }
  return out;
}

/** The world's centre: given, or the middle of the walk. */
export function worldCentre(scene) {
  const w = scene.world, p = scene.activity?.path ?? [];
  if (w?.centre) return w.centre;
  if (!p.length) return [0, 4];
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}

const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)); return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz); };
const polyDist = (p, line) => { let d = Infinity; for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(p, line[i - 1], line[i])); return d; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const hexW = (c, fb) => { let h = typeof c === 'string' ? c.trim().replace(/^#/, '') : ''; if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((x) => x + x).join(''); return /^[0-9a-f]{6}$/i.test(h) ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : fb; };

/** Where each tree of each stand stands: [{kind, x, z, h, lean, seed, stand}], inside the radius and off the path. */
export function worldTrees(scene) {
  const w = scene.world;
  if (!w) return [];
  const C = worldCentre(scene), R = w.radius_m ?? 15, path = scene.activity?.path ?? [], out = [];
  (w.stands ?? []).forEach((s, si) => {
    const D = DEFAULTS[s.kind], sp = s.spacing_m ?? D.spacing_m, H = s.height_m ?? D.height_m;
    const pts = s.area ?? s.line, half = (s.width_m ?? 4) / 2;
    const inside = s.area ? (p) => inPoly(p, s.area) : (p) => polyDist(p, s.line) <= half;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    if (!s.area) { x0 -= half; x1 += half; z0 -= half; z1 += half; }
    x0 = Math.max(x0, C[0] - R); x1 = Math.min(x1, C[0] + R); z0 = Math.max(z0, C[1] - R); z1 = Math.min(z1, C[1] + R);
    for (let gx = Math.floor(x0 / sp); gx * sp <= x1; gx++) for (let gz = Math.floor(z0 / sp); gz * sp <= z1; gz++) {
      // one tree per cell, jittered within it, a few cells left empty: a wood, not an orchard
      const a = hashW(gx + 31 * si, gz), b = hashW(gz - 17 * si, gx + 5), keep = hashW(gx * 3 + si, gz * 7);
      if (keep < (s.gaps ?? 0.2)) continue;
      const p = [(gx + 0.15 + 0.7 * a) * sp, (gz + 0.15 + 0.7 * b) * sp];
      if (!inside(p) || Math.hypot(p[0] - C[0], p[1] - C[1]) > R) continue;
      if (path.length >= 2 && polyDist(p, path) < (s.clear_m ?? 1.2)) continue;
      out.push({ kind: s.kind, x: p[0], z: p[1], h: H * (0.8 + 0.4 * hashW(gx, gz + 11 * si)), lean: (hashW(gz, gx - si) - 0.5) * 2 * (s.lean_deg ?? 3) * RAD, az: hashW(gx + 7, gz - 3) * 2 * Math.PI, seed: gx * 131 + gz * 17 + si, stand: s });
    }
  });
  return out;
}

/**
 * Whether (x, z) lies in a wood (a stand of trees, not shrubs, inside the world's radius): the trunks there hide the
 * ground beyond, so the visible ground ends where a wood starts. Null when the scene has no stands.
 */
export function inWood(scene) {
  const w = scene.world, stands = (w?.stands ?? []).filter((s) => s.kind !== 'shrub');
  if (!stands.length) return null;
  const C = worldCentre(scene), R = w.radius_m ?? 15;
  return (x, z) => {
    if (Math.hypot(x - C[0], z - C[1]) > R) return false;
    const p = [x, z];
    return stands.some((s) => (s.area ? inPoly(p, s.area) : polyDist(p, s.line) <= (s.width_m ?? 4) / 2));
  };
}

const CACHE = new WeakMap();
/**
 * The world's trees as the renderer's capsules ({A, B, rA, rB, col, sphere?}), each stood on the ground at
 * height(x, z). Built once per scene.
 */
export function worldParts(scene, height = () => 0) {
  if (!scene.world) return [];
  const hit = CACHE.get(scene);
  if (hit) return hit;
  const out = [];
  for (const t of worldTrees(scene)) {
    const D = DEFAULTS[t.kind], trunk = hexW(t.stand.trunk_colour, hexW(D.trunk)), crown = hexW(t.stand.crown_colour, hexW(D.crown));
    const y0 = height(t.x, t.z), h = t.h, lx = Math.sin(t.az) * Math.sin(t.lean), lz = Math.cos(t.az) * Math.sin(t.lean);
    const at = (f) => [t.x + lx * h * f, y0 + h * f, t.z + lz * h * f];
    const rnd = (k) => hashW(t.seed, k);
    if (t.kind === 'pine') {
      const r = 0.0075 * h;
      out.push({ A: at(-0.02), B: at(0.82), rA: r, rB: r * 0.55, col: trunk });
      for (let k = 0; k < 4; k++) { const c = at(0.7 + 0.07 * k); c[0] += (rnd(k) - 0.5) * 0.12 * h; c[2] += (rnd(k + 9) - 0.5) * 0.12 * h; const cr = (0.11 - 0.015 * k) * h; out.push({ A: c, B: c, rA: cr, rB: cr, col: crown, sphere: true }); }
    } else if (t.kind === 'spruce') {
      out.push({ A: at(-0.02), B: at(0.98), rA: 0.012 * h, rB: 0.004 * h, col: trunk });
      for (let k = 0; k < 6; k++) { const f = 0.12 + 0.14 * k, c = at(f), cr = (0.2 - 0.03 * k) * h; out.push({ A: c, B: c, rA: cr, rB: cr, col: crown, sphere: true }); }
    } else if (t.kind === 'birch' || t.kind === 'bare') {
      const r = (t.kind === 'birch' ? 0.009 : 0.014) * h;
      out.push({ A: at(-0.02), B: at(0.92), rA: r, rB: r * 0.4, col: trunk });
      for (let k = 0; k < 7; k++) {
        const f = 0.4 + 0.075 * k, a = rnd(k) * 2 * Math.PI, l = h * (0.18 + 0.12 * rnd(k + 20)), s0 = at(f);
        out.push({ A: s0, B: [s0[0] + Math.sin(a) * l * 0.65, s0[1] + l * 0.75, s0[2] + Math.cos(a) * l * 0.65], rA: r * 0.35, rB: r * 0.1, col: crown });
      }
    } else if (t.kind === 'shrub') {
      for (let k = 0; k < 2; k++) { const c = at(0.35 + 0.25 * k); c[0] += (rnd(k) - 0.5) * 0.4 * h; const cr = (0.45 - 0.12 * k) * h; out.push({ A: c, B: c, rA: cr, rB: cr, col: crown, sphere: true }); }
    }
  }
  CACHE.set(scene, out);
  return out;
}

/**
 * Along a ray from the eye (horizontal direction dx, dz, unit), how far to the ring of radius R round the world's
 * centre, and the azimuth of the point it meets there (degrees clockwise from +z, from the centre). The eye is inside.
 */
export function ringHit(eye, dx, dz, C, R) {
  const fx = eye[0] - C[0], fz = eye[2] - C[1], b = fx * dx + fz * dz, c = fx * fx + fz * fz - R * R;
  const t = -b + Math.sqrt(Math.max(0, b * b - c));
  const hx = fx + dx * t, hz = fz + dz * t;
  return { t, az: Math.atan2(hx, hz) / RAD };
}

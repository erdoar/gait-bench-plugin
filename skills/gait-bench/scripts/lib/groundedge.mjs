// groundedge.mjs — the terrain's fix cycle. Claude traces where the ground ends in a few frames (the top of a bank
// against the trees, a path's far edge, the horizon) as `ground_edges`, on the sheet's 0–1000 grid. This finds where
// the rendered ground ends along the same columns, says how far off it is, and tries the few things that move it
// (the camera's roll, height and aim, each terrain feature's height and width) one at a time, to say which single
// change would bring the two lines together. It fits Claude's own reading of the frames, not the pixels.

import { cameraTrack } from './scene.mjs';
import { makeTerrain } from './terrain.mjs';
import { inWood } from './world.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** The scenery bands that stand on the ground (trees, buildings, hills, a bank or a wall) and hide what lies beyond. */
export const groundStops = (scene) => (scene.far ?? []).filter((b) => Number.isFinite(b.distance_m)).map((b) => ({ from: b.from_deg ?? 0, span: ((((b.to_deg - b.from_deg) % 360) + 360) % 360) || 360, d: b.distance_m }));

/**
 * The topmost pixel row in column u that shows ground, or null when the column shows none. The ground is the scene's
 * terrain (or the flat plane), out to maxD metres, or to the nearest scenery band in that direction (the ground ends
 * where a tree line or a building starts). Found by bisection on the row: above the edge a ray misses the ground,
 * below it hits.
 */
export function edgeRow(height, cam, u, maxD = 300, stops = [], wood = null) {
  const hits = (v) => {
    const d = cam.ray(u, v), e = cam.eye, hz = Math.hypot(d[0], d[2]) || 1e-9, az = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
    let lim = maxD;
    for (const b of stops) if ((((az - b.from) % 360) + 360) % 360 <= b.span) lim = Math.min(lim, b.d);
    for (let t = 0.3; t * hz < lim; t *= 1.03) { const x = e[0] + d[0] * t, y = e[1] + d[1] * t, z = e[2] + d[2] * t; if (y <= height(x, z)) return true; if (wood && wood(x, z)) return false; }
    // the last step: the ground at the band's foot
    const t = lim / hz, x = e[0] + d[0] * t, y = e[1] + d[1] * t, z = e[2] + d[2] * t;
    return y <= height(x, z);
  };
  if (hits(0)) return 0;
  if (!hits(cam.height - 1)) return null;
  let lo = 0, hi = cam.height - 1;
  for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (hits(m)) hi = m; else lo = m; }
  return hi;
}

// the seen line's y at grid x, or null outside its span
const lineAt = (line, x) => {
  const p = [...line].sort((a, b) => a[0] - b[0]);
  if (x < p[0][0] || x > p[p.length - 1][0]) return null;
  for (let i = 1; i < p.length; i++) if (x <= p[i][0]) { const a = p[i - 1], b = p[i], u = (x - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * u; }
  return p[p.length - 1][1];
};

/** Rendered minus seen, in grid units, at a dozen columns along each traced edge: [{t, x, seen, rendered, d}]. */
export function edgeResiduals(scene, frames) {
  const edges = scene.ground_edges ?? [];
  if (!edges.length) return [];
  const { width: W, height: H } = scene.output;
  const cams = cameraTrack(scene, frames), T = scene.terrain ? makeTerrain(scene) : null, height = T ? T.height : () => 0;
  const maxD = scene.terrain?.extent_m ?? 300, stops = groundStops(scene), wood = inWood(scene), out = [];
  for (const e of edges) {
    const i = frames.reduce((b, f, k) => (Math.abs(f.t - e.t) < Math.abs(frames[b].t - e.t) ? k : b), 0);
    const xs = e.line.map((p) => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    for (let k = 0; k <= 11; k++) {
      const x = x0 + ((x1 - x0) * k) / 11, seen = lineAt(e.line, x), v = edgeRow(height, cams[i], (x / 1000) * W, maxD, stops, wood);
      const rendered = v == null ? 1000 : (v / H) * 1000;
      out.push({ t: e.t, x: Math.round(x), seen: Math.round(seen), rendered: Math.round(rendered), d: rendered - seen });
    }
  }
  return out;
}

const rms = (r) => Math.sqrt(r.reduce((s, q) => s + q.d * q.d, 0) / Math.max(1, r.length));
// the tilt of a set of residuals across the frame: grid units of error per grid unit across
const tilt = (r) => { const n = r.length, mx = r.reduce((s, q) => s + q.x, 0) / n, md = r.reduce((s, q) => s + q.d, 0) / n; let a = 0, b = 0; for (const q of r) { a += (q.x - mx) * (q.d - md); b += (q.x - mx) ** 2; } return { offset: md, slope: b ? a / b : 0 }; };

/**
 * The things that move the ground's edge, each as a way to make a variant of the scene. What is known is held: the
 * scene's `hold` list (knob names, or their start: "camera" holds every camera knob), and camera.level holds the roll.
 */
function knobs(scene) {
  const c = scene.camera, held = [...(scene.hold ?? []), ...(c.level ? ['camera.roll_deg'] : [])];
  return allKnobs(scene).filter((k) => !held.some((h) => k.name === h || k.name.startsWith(`${h}.`) || k.name.startsWith(`${h}[`) || k.name.startsWith(`${h} `)));
}
function allKnobs(scene) {
  const c = scene.camera, list = [
    { name: 'camera.roll_deg', step: 1, now: c.roll_deg ?? 0, set: (s, v) => ({ ...s, camera: { ...s.camera, roll_deg: v } }) },
    { name: 'camera.height_m', step: 0.1, now: c.height_m, min: 0.1, set: (s, v) => ({ ...s, camera: { ...s.camera, height_m: v, path: s.camera.path.map((p) => (p.height_m != null ? { ...p, height_m: p.height_m + v - c.height_m } : p)) } }) },
  ];
  if (c.aim === 'figure' && !isNum(c.pitch_deg)) list.push({ name: 'camera.aim_offset[1]', step: 0.02, now: c.aim_offset?.[1] ?? 0, set: (s, v) => ({ ...s, camera: { ...s.camera, aim_offset: [s.camera.aim_offset?.[0] ?? 0, v] } }) });
  (scene.terrain?.features ?? []).forEach((f, i) => {
    const feat = (s, k, v) => ({ ...s, terrain: { ...s.terrain, features: s.terrain.features.map((g, j) => (j === i ? { ...g, [k]: v } : g)) } });
    if (isNum(f.height_m)) list.push({ name: `terrain.features[${i}].height_m (${f.kind})`, step: Math.max(0.1, 0.15 * Math.abs(f.height_m)), now: f.height_m, set: (s, v) => feat(s, 'height_m', v) });
    if (isNum(f.width_m)) list.push({ name: `terrain.features[${i}].width_m (${f.kind})`, step: Math.max(0.2, 0.2 * f.width_m), now: f.width_m, min: 0.2, set: (s, v) => feat(s, 'width_m', v) });
    // a bank or ridge moved sideways: toward its high side (a step's `toward`), or across its line
    if ((f.kind === 'step' || f.kind === 'ridge') && Array.isArray(f.line) && f.line.length >= 2) {
      const a = f.line[0], b = f.line[f.line.length - 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let u = f.kind === 'step' && Array.isArray(f.toward) ? [f.toward[0] - m[0], f.toward[1] - m[1]] : [-(b[1] - a[1]), b[0] - a[0]];
      const L = Math.hypot(u[0], u[1]) || 1; u = [u[0] / L, u[1] / L];
      list.push({ name: `terrain.features[${i}].line (${f.kind}, moved toward ${f.kind === 'step' ? 'its high side' : 'its left'} in m)`, step: 0.3, now: 0, set: (s, v) => ({ ...s, terrain: { ...s.terrain, features: s.terrain.features.map((g, j) => (j === i ? { ...g, line: g.line.map((q) => [q[0] + u[0] * v, q[1] + u[1] * v]), ...(Array.isArray(g.toward) ? { toward: [g.toward[0] + u[0] * v, g.toward[1] + u[1] * v] } : {}) } : g)) } }) });
    }
    if (f.kind === 'slope' && isNum(f.grade_deg)) list.push({ name: `terrain.features[${i}].grade_deg (slope)`, step: 1, now: f.grade_deg, set: (s, v) => feat(s, 'grade_deg', v) });
  });
  return list;
}

/**
 * How well the rendered ground's edge follows the traced one, and the single changes that would bring them together:
 * { rms, offset, tilt_deg, rows, tries: [{name, from, to, rms, framing}] } sorted best first, or null with no
 * ground_edges. Each change is solved for on the straight line through two trial renders, then checked once.
 * framing(scene), when given, returns the figure's misfit against the observed boxes ([{d}] in grid units): it is
 * fitted together with the edge, so a change that fixes the ground by moving the figure off its boxes scores worse.
 */
export function groundEdgeReport(scene, frames, framing = () => []) {
  const all = (s) => { const e = edgeResiduals(s, frames); return { e, all: [...e, ...framing(s)] }; };
  const r0 = all(scene);
  if (!r0.e.length) return null;
  const base = rms(r0.all), { offset, slope } = tilt(r0.e), { width: W, height: H } = scene.output;
  const tries = [];
  for (const k of knobs(scene)) {
    const r1 = all(k.set(scene, k.now + k.step)).all;
    let jd = 0, jj = 0;
    for (let i = 0; i < r0.all.length; i++) { const j = (r1[i].d - r0.all[i].d) / k.step; jd += j * r0.all[i].d; jj += j * j; }
    if (jj < 1e-9) continue;
    let to = k.now - jd / jj;
    to = Math.max(k.min ?? -Infinity, Math.min(k.now + 20 * k.step, Math.max(k.now - 20 * k.step, to)));
    const r = all(k.set(scene, to));
    if (rms(r.all) < base - 5) tries.push({ name: k.name, from: Math.round(k.now * 100) / 100, to: Math.round(to * 100) / 100, rms: Math.round(rms(r.e)), framing: Math.round(rms(r.all.slice(r.e.length))), score: rms(r.all) });
  }
  tries.sort((a, b) => a.score - b.score);
  return { rms: Math.round(rms(r0.e)), framing: Math.round(rms(r0.all.slice(r0.e.length))), offset: Math.round(offset), tilt_deg: Math.round((Math.atan((slope * H) / W) * 180) / Math.PI * 10) / 10, rows: r0.e, tries };
}

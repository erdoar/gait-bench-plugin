// posefit.mjs — the movement's fix cycle, as groundedge.mjs is the terrain's. Claude marks a few joints in key
// frames (`observed_joints`: hands, elbows, knees, ankles, hips, head, on the sheet's 0–1000 grid, named by the
// person's own left and right). This projects the figure's joints at the same times, says which are off and by how
// much, and tries the activity's few big levers one at a time (the stance width, the balance demand, the knees,
// the toe-out, the step timing, where the path runs) to say which single change brings the figure to the marks.
// It fits Claude's own reading of the frames, not the pixels.

import { cameraTrack } from './scene.mjs';
import { animate, balanceOf, bodyDims } from './walker.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Rendered minus marked, per joint, in grid units: [{t, joint, seen, rendered, dx, dy}]. */
export function poseResiduals(scene, motion) {
  const marks = scene.observed_joints ?? [];
  if (!marks.length) return [];
  const { width: W, height: H } = scene.output, cams = cameraTrack(scene, motion.frames), fr = motion.frames, out = [];
  for (const m of marks) {
    const i = fr.reduce((b, f, k) => (Math.abs(f.t - m.t) < Math.abs(fr[b].t - m.t) ? k : b), 0);
    for (const [j, seen] of Object.entries(m.joints)) {
      const n = fr[i].nodes[j];
      if (!n) continue;
      const p = cams[i].project(n), r = [(p[0] / W) * 1000, (p[1] / H) * 1000];
      out.push({ t: m.t, joint: j, seen, rendered: r.map(Math.round), dx: r[0] - seen[0], dy: r[1] - seen[1] });
    }
  }
  return out;
}

const rms = (r) => Math.sqrt(r.reduce((s, q) => s + q.dx * q.dx + q.dy * q.dy, 0) / Math.max(1, r.length));

/** The activity's big levers, each a way to make a variant of the scene. The scene's `hold` list is respected. */
function knobs(scene) {
  const a = scene.activity, D = bodyDims(scene.figure), B = balanceOf(scene, D).demand;
  const act = (s, patch) => ({ ...s, activity: { ...s.activity, ...patch } });
  const p0 = a.path[0], p1 = a.path[a.path.length - 1], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, side = [-(p1[1] - p0[1]) / L, (p1[0] - p0[0]) / L];
  const list = [
    { name: 'activity.step_width_m', step: 0.04, now: a.step_width_m ?? 0.08, min: -0.04, max: 0.6, set: (s, v) => act(s, { step_width_m: v }) },
    { name: 'activity.balance', step: 0.1, now: B, min: 0, max: 1, set: (s, v) => act(s, { balance: v }) },
    { name: 'activity.knees_in', step: 0.1, now: a.knees_in ?? (B > 0.3 ? 0.45 * B : 0), min: 0, max: 1, set: (s, v) => act(s, { knees_in: v }) },
    { name: 'activity.knee_bend_deg', step: 5, now: a.knee_bend_deg ?? (B > 0.3 ? 24 * B : 0), min: 0, max: 45, set: (s, v) => act(s, { knee_bend_deg: v }) },
    { name: 'activity.toe_out_deg', step: 4, now: a.toe_out_deg ?? (B > 0.3 ? 6 + 14 * B : 6), min: -10, max: 35, set: (s, v) => act(s, { toe_out_deg: v }) },
    { name: 'activity.step_offset_s', step: 0.06, now: isNum(a.step_offset_s) ? a.step_offset_s : -0.2 * (120 / a.cadence_spm), set: (s, v) => act(s, { step_offset_s: v }) },
    ...['left', 'right'].map((sd) => ({ name: `activity.arm_raise_deg.${sd}`, step: 6, now: a.arm_raise_deg?.[sd] ?? 0, min: -40, max: 70, set: (s, v) => act(s, { arm_raise_deg: { ...(s.activity.arm_raise_deg ?? {}), [sd]: v } }) })),
    { name: 'activity.path (moved to her left, m)', step: 0.1, now: 0, set: (s, v) => act(s, { path: s.activity.path.map((q) => [q[0] + side[0] * v, q[1] + side[1] * v]) }) },
  ];
  const held = scene.hold ?? [];
  return list.filter((k) => !held.some((h) => k.name === h || k.name.startsWith(`${h}.`) || k.name.startsWith(`${h} `)));
}

/**
 * How well the figure's joints follow the marked ones, and the single changes that would bring them closest:
 * { rms, worst: [{joint, t, off}], rows, tries: [{name, from, to, rms}] }, or null with no observed_joints.
 */
export function poseReport(scene, motion) {
  const r0 = poseResiduals(scene, motion);
  if (!r0.length) return null;
  const base = rms(r0), tries = [];
  const resid = (s) => poseResiduals(s, animate(s));
  for (const k of knobs(scene)) {
    const r1 = resid(k.set(scene, k.now + k.step));
    let jd = 0, jj = 0;
    for (let i = 0; i < r0.length; i++) { const jx = (r1[i].dx - r0[i].dx) / k.step, jy = (r1[i].dy - r0[i].dy) / k.step; jd += jx * r0[i].dx + jy * r0[i].dy; jj += jx * jx + jy * jy; }
    if (jj < 1e-9) continue;
    let to = k.now - jd / jj;
    to = Math.max(k.min ?? -Infinity, Math.min(k.max ?? Infinity, Math.max(k.now - 12 * k.step, Math.min(k.now + 12 * k.step, to))));
    const r = rms(resid(k.set(scene, to)));
    if (r < base - 3) tries.push({ name: k.name, from: Math.round(k.now * 100) / 100, to: Math.round(to * 100) / 100, rms: Math.round(r) });
  }
  tries.sort((a, b) => a.rms - b.rms);
  const worst = [...r0].sort((a, b) => Math.hypot(b.dx, b.dy) - Math.hypot(a.dx, a.dy)).slice(0, 3).map((q) => ({ joint: q.joint, t: q.t, off: Math.round(Math.hypot(q.dx, q.dy)) }));
  return { rms: Math.round(base), worst, rows: r0, tries };
}

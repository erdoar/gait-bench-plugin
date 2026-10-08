// scene.mjs — the scene Claude reasons out from the footage (gaitbench.scene.v1): defaults, checks, paths and the camera.
// Pure JavaScript with no Node APIs, so the viewer page can inline it.
// World: metres, y up, the ground at y = 0. At t = 0 the camera stands at x = 0, z = 0 looking along +z, and +x is to its right.
// Azimuths are degrees clockwise from +z (90 = the camera's starting right).

import { terrainOf, terrainProblems } from './terrain.mjs';
import { fillShoe } from './shoeshapes.mjs';
import { physicsProblems } from './physics.mjs';
import { worldProblems } from './world.mjs';

export const SCENE_SCHEMA = 'gaitbench.scene.v1';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const RAD = Math.PI / 180;
export const vec = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

/** '#rrggbb', '#rgb' or [r, g, b] (0–255) as [r, g, b]; the fallback when it can't be read. */
export function rgb(c, fallback = [128, 128, 128]) {
  if (Array.isArray(c) && c.length >= 3 && c.every((x) => Number.isFinite(x))) return c.slice(0, 3).map((x) => clamp(x, 0, 255));
  if (typeof c === 'string') {
    let h = c.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((x) => x + x).join('');
    if (/^[0-9a-f]{6}$/i.test(h)) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return fallback;
}

/** Phone lenses by their field of view across the frame's long side. */
export const LENSES = { main: 67, ultrawide: 106, '2x': 38, '3x': 26, '5x': 16 };
export const ACTIVITIES = ['walk', 'stand'];
export const STYLES = { normal: 1, catwalk: 1, careful: 1 };
export const POSE_JOINTS = ['head', 'neck', 'shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r', 'hand_l', 'hand_r', 'hip_l', 'hip_r', 'knee_l', 'knee_r', 'ankle_l', 'ankle_r', 'toe_l', 'toe_r'];

/** Problems with a scene's observed_joints, as short sentences. */
export function poseProblems(raw) {
  const o = raw?.observed_joints;
  if (o == null) return [];
  if (!Array.isArray(o)) return ['observed_joints must be a list of {t, joints: {name: [x, y]}} on the 0–1000 grid'];
  for (const e of o) {
    if (!isNum(e?.t) || !e.joints || typeof e.joints !== 'object') return ['each observed_joints entry needs t and joints: {name: [x, y]}'];
    for (const [k, p] of Object.entries(e.joints)) {
      if (!POSE_JOINTS.includes(k)) return [`observed_joints names are ${POSE_JOINTS.join(', ')} (the person's own left and right): not "${k}"`];
      if (!(Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) return [`observed joint ${k} at ${e.t} s must be [x, y]`];
    }
  }
  return [];
}


export const ARM_POSES = ['swing', 'hang', 'bag', 'hip', 'hair', 'phone', 'balance', 'catch'];
export const FAR_KINDS = ['trees', 'bare_trees', 'buildings', 'hills', 'bank', 'wall'];
export const PROP_KINDS = ['pole', 'lamp', 'tree', 'bare_tree', 'box'];
/** How sure Claude is of a section, and what it rests on: categorical, never a number (nothing here is calibrated). */
export const CONFIDENCE = ['unknown', 'weak', 'moderate', 'strong'];
export const BASIS = ['seen', 'inferred', 'assumed'];
export const SECTIONS = ['camera', 'figure', 'activity', 'ground', 'terrain', 'sky', 'sun'];
/** How the scene is drawn: as reasoned, as neutral clay, or clay with the contacts picked out (references for video models). */
export const LOOKS = ['scene', 'clay', 'contact'];

const DEFAULTS = {
  ground: { colour: '#8b8d86', patches: null, shine: 0 },
  sky: { zenith: '#4a86d0', horizon: '#d6e2ec', haze_m: 2500 },
  sun: { azimuth_deg: 160, elevation_deg: 35 },
  figure: {
    stature_m: 1.7, build: 'average', hair: 'short',
    footwear: { heel_cm: 2.5, platform_cm: 1 },
    colours: { skin: '#d9b08c', hair: '#2a2018', top: '#6a7f99', bottom: '#2d3440', shoes: '#222222', bag: '#3a1e1e' },
  },
  activity: { kind: 'walk', speed_mps: 1.2, cadence_spm: 108, step_width_m: 0.08, style: 'normal', arm_swing: 1, start_foot: 'right', arms: { left: 'swing', right: 'swing' }, gestures: [] },
  camera: { lens: 'main', height_m: 1.4, aim: 'figure', aim_offset: [0, 0], lag_s: 0.25, shake: 0.3 },
};

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const merge = (base, over) => {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] ? merge(base[k], over[k]) : over[k];
  return out;
};

/**
 * Fill in defaults and check a scene. Returns { scene, problems, notes }: problems make the scene unusable,
 * notes are assumptions the defaults made (say them to the user).
 */
export function normaliseScene(raw) {
  const problems = [], notes = [];
  if (!raw || typeof raw !== 'object') return { scene: null, problems: ['the scene is not a JSON object'], notes };
  if (raw.schema && raw.schema !== SCENE_SCHEMA) problems.push(`schema is "${raw.schema}", expected "${SCENE_SCHEMA}"`);
  const s = { schema: SCENE_SCHEMA, id: raw.id ?? 'scene', source: raw.source ?? null };
  // a named shoe shape fills in its typical heel, platform and shaft before the plain shoe's defaults would
  const rawFw = raw.figure?.footwear && typeof raw.figure.footwear === 'object' ? { ...raw.figure.footwear } : null;
  if (rawFw) problems.push(...fillShoe(rawFw));
  problems.push(...physicsProblems(raw));
  problems.push(...worldProblems(raw));
  problems.push(...poseProblems(raw));
  if (raw.sun?.strength != null && !(isNum(raw.sun.strength) && raw.sun.strength >= 0 && raw.sun.strength <= 1)) problems.push('sun.strength must be 0–1 (0.2–0.3 under full cloud)');
  for (const k of ['ground', 'sky', 'sun', 'figure', 'activity', 'camera']) {
    if (raw[k] == null && k !== 'sky' && k !== 'sun') notes.push(`no ${k} given: defaults used`);
    s[k] = merge(DEFAULTS[k], k === 'figure' && rawFw ? { ...raw.figure, footwear: rawFw } : raw[k] ?? {});
  }
  s.far = Array.isArray(raw.far) ? raw.far : [];
  s.props = Array.isArray(raw.props) ? raw.props : [];
  // the solid set round the subject: tree stands as geometry within radius_m, the far bands a ring beyond it
  s.world = raw.world && typeof raw.world === 'object' ? raw.world : null;
  s.observed = Array.isArray(raw.observed) ? raw.observed : [];
  // where the ground ends in a few frames, traced on the sheet's grid: check fits the terrain and camera to it
  s.ground_edges = Array.isArray(raw.ground_edges) ? raw.ground_edges : [];
  // what is known and must not be fitted (knob names, or their start: "camera" holds them all)
  // joints marked in key frames (the person's own left and right): check fits the movement to them
  s.observed_joints = Array.isArray(raw.observed_joints) ? raw.observed_joints : [];
  s.hold = Array.isArray(raw.hold) ? raw.hold.filter((x) => typeof x === 'string') : [];
  if (s.camera.level) s.camera.roll_deg = 0; // a camera known to be level
  s.terrain = raw.terrain && typeof raw.terrain === 'object' ? raw.terrain : null;
  problems.push(...terrainProblems(s.terrain));

  const src = s.source ?? {};
  const out = raw.output ?? {};
  s.output = {
    width: Math.round(out.width ?? src.width ?? 1280), height: Math.round(out.height ?? src.height ?? 720),
    fps: out.fps ?? src.fps ?? 25,
  };
  s.output.width -= s.output.width % 2; s.output.height -= s.output.height % 2;
  s.duration_s = raw.duration_s ?? src.duration_s ?? 6;
  if (!isNum(s.duration_s) || s.duration_s <= 0 || s.duration_s > 30) problems.push('duration_s must be between 0 and 30 s');
  if (!(s.output.width >= 64 && s.output.height >= 64 && s.output.width <= 3840 && s.output.height <= 3840)) problems.push('output size must be 64–3840 px each way');
  if (!(s.output.fps > 0 && s.output.fps <= 60)) problems.push('output fps must be 1–60');

  const f = s.figure;
  if (!isNum(f.stature_m) || f.stature_m < 1.0 || f.stature_m > 2.2) problems.push('figure.stature_m must be 1.0–2.2 m');
  if (!['slim', 'average', 'broad'].includes(f.build)) problems.push('figure.build must be slim, average or broad');
  if (!['none', 'short', 'long', 'bun'].includes(f.hair)) problems.push('figure.hair must be none, short, long or bun');
  if (f.bottom_length != null && !['shorts', 'knee', 'full'].includes(f.bottom_length)) problems.push('figure.bottom_length must be shorts, knee or full');
  if (f.top_length != null && !['crop', 'full'].includes(f.top_length)) problems.push('figure.top_length must be crop or full');
  const fw = f.footwear;
  if (!isNum(fw.heel_cm) || fw.heel_cm < 0 || fw.heel_cm > 25) problems.push('figure.footwear.heel_cm must be 0–25');
  if (!isNum(fw.platform_cm) || fw.platform_cm < 0 || fw.platform_cm > 12) problems.push('figure.footwear.platform_cm must be 0–12');
  if (isNum(fw.heel_cm) && isNum(fw.platform_cm) && fw.platform_cm > fw.heel_cm) problems.push('figure.footwear: the platform cannot be thicker than the heel is high');

  const a = s.activity;
  if (!ACTIVITIES.includes(a.kind)) problems.push(`activity.kind must be one of ${ACTIVITIES.join(', ')}`);
  if (!STYLES[a.style]) problems.push(`activity.style must be one of ${Object.keys(STYLES).join(', ')}`);
  if (!Array.isArray(a.path) || !a.path.length || !a.path.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) {
    if (a.path == null) { a.path = [[0, 4], [0, 4 + a.speed_mps * s.duration_s]]; notes.push('no activity.path: the figure walks straight away from the camera from 4 m'); }
    else problems.push('activity.path must be a list of [x, z] points in metres');
  }
  if (a.kind === 'walk') {
    if (!isNum(a.speed_mps) || a.speed_mps < 0.2 || a.speed_mps > 2.5) problems.push('activity.speed_mps must be 0.2–2.5 for a walk');
    if (!isNum(a.cadence_spm) || a.cadence_spm < 30 || a.cadence_spm > 150) problems.push('activity.cadence_spm must be 30–150 steps a minute');
    if (Array.isArray(a.path) && a.path.length < 2) problems.push('a walk needs at least two path points');
  }
  if (a.engine != null && !['kinematic', 'sim'].includes(a.engine)) problems.push('activity.engine must be kinematic or sim');
  if (a.knee_bend_deg != null && !(isNum(a.knee_bend_deg) && a.knee_bend_deg >= 0 && a.knee_bend_deg <= 45)) problems.push('activity.knee_bend_deg must be 0–45');
  if (a.arm_raise_deg != null && !(typeof a.arm_raise_deg === 'object' && ['left', 'right'].every((k) => a.arm_raise_deg[k] == null || (isNum(a.arm_raise_deg[k]) && a.arm_raise_deg[k] >= -40 && a.arm_raise_deg[k] <= 70)))) problems.push('activity.arm_raise_deg is {left, right}, each -40–70');
  if (a.toe_out_deg != null && !(isNum(a.toe_out_deg) && a.toe_out_deg >= -10 && a.toe_out_deg <= 35)) problems.push('activity.toe_out_deg must be -10–35');
  for (const side of ['left', 'right']) if (!ARM_POSES.includes(a.arms?.[side])) problems.push(`activity.arms.${side} must be one of ${ARM_POSES.join(', ')}`);
  for (const g of a.gestures ?? []) {
    if (!isNum(g.from_s) || !isNum(g.to_s) || g.to_s <= g.from_s || !['left', 'right'].includes(g.arm) || !ARM_POSES.includes(g.pose)) {
      problems.push('each activity.gestures entry needs from_s < to_s, arm (left/right) and a pose'); break;
    }
  }

  const c = s.camera;
  if (c.hfov_deg == null) {
    const L = LENSES[c.lens];
    if (!L) problems.push(`camera.lens must be one of ${Object.keys(LENSES).join(', ')}, or give camera.hfov_deg`);
    else {
      // lenses are rated across the long side; hfov_deg is across the frame's width
      const { width: W, height: H } = s.output;
      c.hfov_deg = H > W ? 2 * Math.atan(Math.tan((L * RAD) / 2) * (W / H)) / RAD : L;
    }
  }
  if (!(c.hfov_deg > 5 && c.hfov_deg < 150)) problems.push('camera.hfov_deg must be 5–150');
  if (!isNum(c.height_m) || c.height_m < 0.1 || c.height_m > 30) problems.push('camera.height_m must be 0.1–30 m');
  if (!Array.isArray(c.path) || !c.path.length) c.path = [{ t: 0, at: [0, 0] }];
  if (!c.path.every((k) => isNum(k.t) && Array.isArray(k.at) && isNum(k.at[0]) && isNum(k.at[1]))) problems.push('camera.path entries need t and at: [x, z]');
  c.path = [...c.path].sort((p, q) => p.t - q.t);
  if (c.aim !== 'figure' && !(c.aim && isNum(c.aim.yaw_deg))) problems.push('camera.aim must be "figure" or {yaw_deg, pitch_deg}');

  for (const b of s.far) {
    if (!FAR_KINDS.includes(b.kind) || !isNum(b.from_deg) || !isNum(b.to_deg) || !isNum(b.distance_m) || !isNum(b.height_m) || b.distance_m <= 0) {
      problems.push(`each far entry needs kind (${FAR_KINDS.join(', ')}), from_deg, to_deg, distance_m and height_m`); break;
    }
  }
  for (const p of s.props) {
    if (!PROP_KINDS.includes(p.kind) || !Array.isArray(p.at) || !isNum(p.at[0]) || !isNum(p.at[1])) {
      problems.push(`each prop needs kind (${PROP_KINDS.join(', ')}) and at: [x, z]`); break;
    }
  }
  if (raw.ground_edges != null && !(Array.isArray(raw.ground_edges) && raw.ground_edges.every((e) => isNum(e?.t) && Array.isArray(e.line) && e.line.length >= 2 && e.line.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))))) problems.push('each ground_edges entry needs t and line: two or more [x, y] points on the 0–1000 grid');
  for (const o of s.observed) {
    if (!isNum(o.t) || !Array.isArray(o.box) || o.box.length !== 4 || !o.box.every(isNum)) { problems.push('each observed entry needs t and box: [x0, y0, x1, y1] on the 0–1000 grid'); break; }
    if (o.foot != null && !['left', 'right'].includes(o.foot)) { problems.push('an observed shoe box takes foot: left or right'); break; }
  }

  // evidence: per section, how sure and on what basis (seen in the frames, inferred from what was seen, or assumed)
  for (const k of SECTIONS) {
    const sec = k === 'terrain' ? s.terrain : s[k];
    if (!sec) continue;
    if (sec.confidence != null && !CONFIDENCE.includes(sec.confidence)) problems.push(`${k}.confidence must be one of ${CONFIDENCE.join(', ')}`);
    if (sec.basis != null && !BASIS.includes(sec.basis)) problems.push(`${k}.basis must be one of ${BASIS.join(', ')}`);
  }
  // contacts read off the frames: when a foot lands (and lifts), as evidence to hold the walk against
  s.contacts = Array.isArray(raw.contacts) ? raw.contacts : [];
  for (const c of s.contacts) {
    if (!['left', 'right'].includes(c.foot) || !isNum(c.on_s) || (c.off_s != null && !(isNum(c.off_s) && c.off_s > c.on_s)) || (c.kind != null && !['plant', 'slide'].includes(c.kind))) {
      problems.push('each contacts entry needs foot (left/right) and on_s, optionally off_s (after on_s) and kind (plant/slide)'); break;
    }
  }
  // what else the footage could mean, where Claude chose between readings
  // what the render cannot show of what was seen, said plainly (it goes into the summary as it is)
  s.differs = Array.isArray(raw.differs) ? raw.differs.filter((x) => typeof x === 'string' && x.trim()) : [];
  s.alternatives = Array.isArray(raw.alternatives) ? raw.alternatives.filter((x) => x && typeof x.about === 'string' && typeof x.instead === 'string') : [];
  s.look = raw.look ?? 'scene';
  if (!LOOKS.includes(s.look)) problems.push(`look must be one of ${LOOKS.join(', ')}`);
  else if (s.look !== 'scene') clay(s);
  return { scene: s, problems, notes };
}

/** Neutral clay: the same geometry in greys, so a reference shows form, footing and timing rather than looks. */
function clay(s) {
  const G = '#9c9b96', F = '#c9c6bf', D = '#77756f';
  s.ground = { ...s.ground, colour: G, patches: null, shine: 0 };
  s.sky = { ...s.sky, zenith: '#d7d9db', horizon: '#eeefef', haze_m: Math.max(800, s.sky.haze_m ?? 2500) };
  // a low or backlighting sun turns clay into a silhouette: lift it, keeping its direction, so the form reads
  s.sun = { ...s.sun, elevation_deg: Math.max(40, s.sun.elevation_deg ?? 40) };
  s.far = s.far.map((b) => ({ ...b, colour: '#b4b4b0' }));
  s.props = s.props.map((p) => ({ ...p, colour: '#a9a8a3' }));
  if (s.world) s.world = { ...s.world, stands: (s.world.stands ?? []).map((t) => ({ ...t, trunk_colour: '#a9a8a3', crown_colour: '#b9b8b3' })) };
  if (s.terrain) s.terrain = { ...s.terrain, features: (s.terrain.features ?? []).map((f) => ({ ...f, colour: undefined, shine: 0 })), grid: { ...(s.terrain.grid ?? {}), colour: '#ffffff', opacity: Math.min(0.25, s.terrain.grid?.opacity ?? 0.2) } };
  const c = s.figure.colours ?? {};
  s.figure = { ...s.figure, colours: { ...Object.fromEntries(Object.keys(c).map((k) => [k, F])), skin: F, hair: D, top: F, bottom: F, legs: F, shoes: D, sole: D, heel: D, bag: D }, gloss: {}, footwear: { ...s.figure.footwear, colours: 'scene' } };
}

// ---------- paths ----------

/**
 * A smooth path through [x, z] points (Catmull-Rom), by arc length. at(s) gives the point and unit direction;
 * beyond either end it carries straight on.
 */
export function makePath(points) {
  const P = points.length === 1 ? [points[0], [points[0][0], points[0][1] + 1e-3]] : points;
  const pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(P[P.length - 1]);
  const S = [0];
  for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = S[S.length - 1];
  const dirAt = (i) => { const a = pts[Math.max(0, i)], b = pts[Math.min(pts.length - 1, i + 1)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const d0 = dirAt(0), d1 = dirAt(pts.length - 2);
  function at(s) {
    if (s <= 0) return { p: [pts[0][0] + d0[0] * s, pts[0][1] + d0[1] * s], dir: d0 };
    if (s >= length) { const e = pts[pts.length - 1]; return { p: [e[0] + d1[0] * (s - length), e[1] + d1[1] * (s - length)], dir: d1 }; }
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const u = (s - S[lo]) / (S[hi] - S[lo] || 1), a = pts[lo], b = pts[hi];
    const da = dirAt(lo - 1), db = dirAt(lo);
    const dx = da[0] + (db[0] - da[0]) * u, dz = da[1] + (db[1] - da[1]) * u, l = Math.hypot(dx, dz) || 1;
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: [dx / l, dz / l] };
  }
  return { length, at };
}

// ---------- camera ----------

/** A pinhole camera: yaw turns right (clockwise from +z), pitch looks down, roll tips the picture clockwise. */
export function makeCamera({ eye, yaw = 0, pitch = 0, roll = 0, hfovDeg, width, height }) {
  const y = yaw * RAD, p = pitch * RAD, r = roll * RAD;
  const fwd = [Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)];
  const right0 = [Math.cos(y), 0, -Math.sin(y)], up0 = vec.cross(fwd, right0);
  const right = vec.add(vec.mul(right0, Math.cos(r)), vec.mul(up0, Math.sin(r)));
  const up = vec.sub(vec.mul(up0, Math.cos(r)), vec.mul(right0, Math.sin(r)));
  const f = width / 2 / Math.tan((hfovDeg * RAD) / 2), cx = width / 2, cy = height / 2;
  return {
    eye, fwd, right, up, f, cx, cy, width, height, yaw, pitch, roll,
    /** [u, v, depth] of a world point; depth <= 0 is behind the camera. */
    project(q) {
      const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
      const Z = vec.dot(d, fwd);
      return [cx + (f * vec.dot(d, right)) / Z, cy - (f * vec.dot(d, up)) / Z, Z];
    },
    /** Unit world ray through pixel (u, v). */
    ray(u, v) {
      const a = (u - cx) / f, b = (cy - v) / f;
      return vec.norm([fwd[0] + a * right[0] + b * up[0], fwd[1] + a * right[1] + b * up[1], fwd[2] + a * right[2] + b * up[2]]);
    },
  };
}

// smooth deterministic wobble in [-1, 1] for hand-held shake
const wobble = (t, seed) => (Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.1 + seed * 2.3) * 0.3 + Math.sin(t * 7.3 + seed * 0.7) * 0.2);

/** Where the camera is at time t, linear between path keys. */
function cameraAt(path, t) {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (t <= path[i].t) {
      const a = path[i - 1], b = path[i], u = (t - a.t) / (b.t - a.t || 1);
      return { at: [a.at[0] + (b.at[0] - a.at[0]) * u, a.at[1] + (b.at[1] - a.at[1]) * u], height_m: a.height_m != null && b.height_m != null ? a.height_m + (b.height_m - a.height_m) * u : a.height_m ?? b.height_m };
    }
  }
  return path[path.length - 1];
}

/**
 * The camera for every frame. With aim "figure" the operator keeps the figure in frame: the aim point follows the
 * figure's waist (at aim_height_m) with a lag, and aim_offset places it off-centre (fractions of the frame, + = right, down).
 * The camera's own movement between path keys is smoothed over about 0.4 s.
 */
export function cameraTrack(scene, frames) {
  const c = scene.camera, { width, height, fps } = scene.output;
  const H = scene.figure.stature_m, aimH = c.aim_height_m ?? 0.55 * H + (scene.figure.footwear.heel_cm + scene.figure.footwear.platform_cm) / 200;
  const raw = frames.map((fr) => cameraAt(c.path, fr.t));
  const win = Math.max(0, Math.round(0.2 * fps));
  const pos = raw.map((_, i) => {
    let x = 0, z = 0, h = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(raw.length - 1, i + win); j++) { x += raw[j].at[0]; z += raw[j].at[1]; h += raw[j].height_m ?? c.height_m; n++; }
    const Tg = terrainOf(scene), gx = x / n, gz = z / n;
    return [gx, h / n + (Tg ? Tg.height(gx, gz) : 0), gz];
  });
  const f = width / 2 / Math.tan((c.hfov_deg * RAD) / 2);
  const k = c.lag_s > 0 ? 1 - Math.exp(-1 / (fps * c.lag_s)) : 1;
  let target = null;
  return frames.map((fr, i) => {
    const w = fr.nodes.waist, Tg = terrainOf(scene), goal = [w[0], aimH + (Tg ? Tg.height(w[0], w[2]) : 0), w[2]];
    target = target ? vec.lerp(target, goal, k) : goal;
    const eye = pos[i];
    let yaw, pitch;
    if (c.aim === 'figure') {
      const d = vec.sub(target, eye);
      yaw = Math.atan2(d[0], d[2]) / RAD - Math.atan2((c.aim_offset?.[0] ?? 0) * width, f) / RAD;
      pitch = Math.atan2(-d[1], Math.hypot(d[0], d[2])) / RAD - Math.atan2((c.aim_offset?.[1] ?? 0) * height, f) / RAD;
      if (isNum(c.pitch_deg)) pitch = c.pitch_deg;
    } else { yaw = c.aim.yaw_deg; pitch = c.aim.pitch_deg ?? 0; }
    const sh = c.shake ?? 0;
    return makeCamera({
      eye, yaw: yaw + sh * 0.6 * wobble(fr.t, 1), pitch: pitch + sh * 0.5 * wobble(fr.t, 2), roll: (c.roll_deg ?? 0) + sh * 0.8 * wobble(fr.t, 3),
      hfovDeg: c.hfov_deg, width, height,
    });
  });
}

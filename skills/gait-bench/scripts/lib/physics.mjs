// physics.mjs — friction under the feet, and the cap/sim mix. Ported from the owner's ice-walk simulation
// (dev/reference/ice-walk-sim): the same friction test and slide model, run on Gait Bench's own walker instead of a
// free-running one, so the capture (cap) keeps the path and the timing while the physics (sim) says where the ground
// could not have held a foot. Pure JavaScript with no imports, so the viewer page can inline it.

const G = 9.81;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Typical static friction of a shoe sole on each surface (published ranges, middle values; a judgement, not a
 * measurement). Kinetic friction is taken as 0.75 × static, as in the sim.
 */
export const SURFACES = { dry: 0.6, wet: 0.4, grass: 0.35, snow: 0.3, ice: 0.15, wet_ice: 0.07, black_ice: 0.05 };

/** The ground's static friction: ground.friction if given, else from ground.surface, else dry. */
export function surfaceMu(scene) {
  const g = scene.ground ?? {};
  if (Number.isFinite(g.friction)) return clamp(g.friction, 0.02, 1.2);
  return SURFACES[g.surface] ?? SURFACES.dry;
}

/** Problems with the physics fields of a scene, as short sentences. */
export function physicsProblems(raw) {
  const out = [], g = raw?.ground ?? {}, a = raw?.activity ?? {};
  if (g.surface != null && !(g.surface in SURFACES)) out.push(`ground.surface must be one of ${Object.keys(SURFACES).join(', ')}`);
  if (g.friction != null && !(Number.isFinite(g.friction) && g.friction > 0 && g.friction <= 1.2)) out.push('ground.friction must be between 0 and 1.2');
  if (a.mix != null && !(Number.isFinite(a.mix) && a.mix >= 0 && a.mix <= 1)) out.push('activity.mix must be between 0 (cap) and 1 (sim)');
  return out;
}

/**
 * How a careful person walks on this friction, from the sim's caution model: shorter steps and a slightly higher
 * cadence as the ground gets slipperier (about 25 cm and 100 steps/min on moderate ice). Above about 0.45 nothing
 * changes. Returns { step_m, cadence_spm } or null when the ground is grippy.
 */
export function carefulGait(mu) {
  if (mu >= 0.45) return null;
  const sl = clamp((0.5 - mu) / 0.46, 0, 1);
  return { step_m: clamp(0.12 + 0.9 * mu, 0.14, 0.5), cadence_spm: 108 - 8 * sl };
}

// segment masses (Winter), the same table the walker balances with
const MASS = [['head', 'neck', 0.081], ['neck', 'waist', 0.497], ['hip_l', 'knee_l', 0.1], ['hip_r', 'knee_r', 0.1], ['knee_l', 'ankle_l', 0.0465], ['knee_r', 'ankle_r', 0.0465], ['ankle_l', 'toe_l', 0.0145], ['ankle_r', 'toe_r', 0.0145], ['shoulder_l', 'elbow_l', 0.028], ['shoulder_r', 'elbow_r', 0.028], ['elbow_l', 'hand_l', 0.022], ['elbow_r', 'hand_r', 0.022]];
const com = (n) => { const c = [0, 0, 0]; let m = 0; for (const [p, q, w] of MASS) { if (!n[p] || !n[q]) continue; for (let k = 0; k < 3; k++) c[k] += (w * (n[p][k] + n[q][k])) / 2; m += w; } return c.map((x) => x / (m || 1)); };

/**
 * The friction each planted foot needs, frame by frame: the ground has to supply the body's horizontal acceleration,
 * so the ratio needed is |a_horizontal| / (g + a_vertical), shared between the feet by how near each is to the
 * centre of mass. A foot whose need exceeds the ground's static friction while carrying over a quarter of the weight
 * would break loose (the sim's test). frames must be close together (60 per second) for the accelerations to mean
 * anything. Returns { mu, need: [{t, walk_t, r, feet: {l, r}}], events: [{foot, from_s, to_s, walk_from, walk_to,
 * peak, load, dir}] } where dir is the horizontal direction the foot would slide, as [x, z].
 */
export function frictionDemand(frames, mu) {
  const N = frames.length, C0 = frames.map((f) => com(f.nodes)), need = [], events = [];
  if (N < 5) return { mu, need, events };
  const dt = (frames[N - 1].t - frames[0].t) / (N - 1) || 1 / 60;
  // the centre of mass smoothed over about 40 ms (a kinematic walker can jump a centimetre or two in one frame, where
  // a scripted slip hands back; that is a drawing artefact, not a force on the ground)
  const sg = 0.04 / dt, rad = Math.ceil(2.5 * sg), wts = Array.from({ length: 2 * rad + 1 }, (_, k) => Math.exp(-((k - rad) ** 2) / (2 * sg * sg)));
  const C = C0.map((_, i) => { const c = [0, 0, 0]; let s = 0; for (let k = -rad; k <= rad; k++) { const j = Math.min(N - 1, Math.max(0, i + k)), w = wts[k + rad]; for (let q = 0; q < 3; q++) c[q] += w * C0[j][q]; s += w; } return c.map((x) => x / s); });
  const acc = (i, k) => { const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2), m = (a + b) >> 1; return ((C[b][k] - C[m][k]) / ((b - m) * dt) - (C[m][k] - C[a][k]) / ((m - a) * dt)) / (((b - a) / 2) * dt); };
  // the walker hands over from one step to the next within a frame, which shows as a one-frame jolt in the
  // acceleration; a slip takes longer than that, so the need is taken as the median over about a tenth of a second
  // a body barely held up (falling through a dip) asks nothing of the ground's friction
  const edge = rad + 2; // the smoothing runs out of frames at the clip's ends, so those few are not judged
  const raw = frames.map((_, i) => { if (i < edge || i > N - 1 - edge) return 0; const up = G + acc(i, 1); return up < 0.5 * G ? 0 : Math.hypot(acc(i, 0), acc(i, 2)) / up; });
  const half = Math.max(1, Math.round(0.05 / dt));
  const med = (i) => { const w = raw.slice(Math.max(2, i - half), Math.min(N - 2, i + half + 1)).sort((p, q) => p - q); return w[w.length >> 1] ?? 0; };
  const open = { l: null, r: null };
  for (let i = 2; i < N - 2; i++) {
    const f = frames[i], r = med(i);
    const stance = ['l', 'r'].filter((s) => f.contact?.[s] === 'stance');
    const dist = (s) => Math.hypot(f.nodes[`ankle_${s}`][0] - C[i][0], f.nodes[`ankle_${s}`][2] - C[i][2]);
    const feet = {};
    if (stance.length === 1) feet[stance[0]] = 1;
    else if (stance.length === 2) { const dl = dist('l'), dr = dist('r'); feet.l = dr / (dl + dr || 1); feet.r = dl / (dl + dr || 1); }
    need.push({ t: f.t, walk_t: f.walk_t ?? f.t, r, feet });
    for (const s of ['l', 'r']) {
      const load = feet[s] ?? 0, slips = load > 0.25 && r > mu;
      if (slips) {
        // the foot is pushed away from the centre of mass: forward at heel strike, backward at push-off
        const d = [f.nodes[`ankle_${s}`][0] - C[i][0], f.nodes[`ankle_${s}`][2] - C[i][2]];
        if (!open[s]) open[s] = { foot: s === 'l' ? 'left' : 'right', from_s: f.t, walk_from: f.walk_t ?? f.t, peak: r, load, dir: d };
        else if (r > open[s].peak) { open[s].peak = r; open[s].load = load; open[s].dir = d; }
        open[s].to_s = f.t; open[s].walk_to = f.walk_t ?? f.t;
      } else if (open[s]) { events.push(open[s]); open[s] = null; }
    }
  }
  for (const s of ['l', 'r']) if (open[s]) events.push(open[s]);
  return { mu, need, events };
}

/**
 * The sim's slide: a foot that breaks loose is driven out at load·g·(r − μk)·5 for about 0.15 s before it re-grips
 * (the gain of 5 is the sim's tuning). Returns the slide distance in metres, at most 0.35.
 */
export function slideDistance(peak, load, mu) {
  const mk = 0.75 * mu, a = load * G * Math.max(0, peak - mk) * 5, t = 0.15;
  return clamp(0.5 * a * t * t, 0, 0.35);
}

/**
 * The cap/sim mix. mix 0 is the capture as reasoned; above 0 the walk is pulled toward a careful gait for the
 * ground (only ever shorter and slower), and skids are added where the ground cannot hold a planted foot, their size
 * scaled by the mix. Slips already in the scene (read off the footage) are kept and never doubled.
 * animate(scene) is the walker; it is passed in so this module has no imports.
 * Returns { scene, added: [slips], gait: {from, to} | null }.
 */
export function hybridise(scene, animate) {
  const a = scene.activity, m = clamp(a.mix ?? 0, 0, 1);
  if (!(m > 0) || a.kind !== 'walk') return { scene, added: [], gait: null };
  const mu = surfaceMu(scene), want = carefulGait(mu);
  let act = { ...a };
  let gait = null;
  if (want) {
    const T = 120 / a.cadence_spm, L = (a.speed_mps * T) / 2;
    const L2 = Math.min(L, L + (want.step_m - L) * m), cad = a.cadence_spm + (Math.max(a.cadence_spm, want.cadence_spm) - a.cadence_spm) * m;
    if (L2 < L - 1e-4 || cad > a.cadence_spm + 1e-4) {
      act = { ...act, cadence_spm: Math.round(cad * 10) / 10, speed_mps: Math.round(((2 * L2) / (120 / cad)) * 1000) / 1000 };
      gait = { from: { step_m: L, cadence_spm: a.cadence_spm, speed_mps: a.speed_mps }, to: { step_m: L2, cadence_spm: act.cadence_spm, speed_mps: act.speed_mps } };
    }
  }
  // find where the (gait-adjusted) walk asks more of the ground than it has, at 60 frames a second
  const probe = { ...scene, activity: act, output: { ...scene.output, fps: 60 } };
  const { events } = frictionDemand(animate(probe).frames, mu);
  const own = a.slips ?? [], added = [];
  for (const e of events) {
    if (own.some((q) => /^l/i.test(String(q.foot)) === (e.foot === 'left') && q.from_s < e.walk_to + 0.2 && q.to_s > e.walk_from - 0.2)) continue;
    const d = slideDistance(e.peak, e.load, mu) * m;
    if (d < 0.01) continue;
    added.push({ foot: e.foot, kind: 'skid', from_s: round3(e.walk_from), to_s: round3(Math.max(e.walk_from + 0.12, Math.min(e.walk_to, e.walk_from + 0.3))), distance_m: round3(d), world_dir: e.dir, auto: true, need: round3(e.peak) });
  }
  return { scene: { ...scene, activity: { ...act, slips: [...own, ...added] } }, added, gait };
}
const round3 = (x) => Math.round(x * 1000) / 1000;

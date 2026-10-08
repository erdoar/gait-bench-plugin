// walker.mjs — a plausible figure doing what the scene says: a procedural walk along the activity path, or standing.
// Built from body proportions (Winter's segment ratios) and the footwear's geometry, so a planted foot stays put,
// legs never stretch and the body rides over the stance foot. It aims at a believable walk, not a measured one.
// Pure JavaScript with no Node APIs, so the viewer page can inline it.
import { vec, makePath } from './scene.mjs';
import { terrainOf } from './terrain.mjs';
import { prepareShoe } from './shoemesh.mjs';
import { hybridise, surfaceMu } from './physics.mjs';
import { simulate } from './simwalker.mjs';

const RAD = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (w) => { w = clamp(w, 0, 1); return w * w * w * (10 - 15 * w + 6 * w * w); }; // minimum jerk
const { add, sub, mul, dot, norm, len, lerp } = vec;

/** Body and shoe dimensions in metres from the figure description. */
export function bodyDims(figure) {
  const H = figure.stature_m, b = { slim: 0.92, average: 1, broad: 1.1 }[figure.build] ?? 1;
  const MSH = figure.footwear.mesh ? prepareShoe(figure.footwear.mesh, figure.footwear) : null;
  const footLen = MSH ? MSH.footLen : 0.152 * H, Lhb = MSH ? MSH.Lhb : 0.72 * footLen; // amplify only changes how a shoe is drawn
  const heel = figure.footwear.heel_cm / 100, plat = Math.min(figure.footwear.platform_cm / 100, heel);
  const pitch = Math.asin(clamp((heel - plat) / Lhb, 0, Math.sin(50 * RAD))); // the shoe's built-in toe-down pitch
  return {
    H, build: b, footLen, Lhb, heel, plat, pitch,
    thigh: 0.24 * H, shank: 0.245 * H, ankleUp: 0.039 * H, hipW: 0.1 * H * b, shoulderW: 0.2 * H * b,
    trunk: 0.298 * H, headUp: 0.1 * H, headR: 0.06 * H, upperArm: 0.186 * H, forearm: 0.146 * H, hand: 0.108 * H,
  };
}

/**
 * The foot in its shoe as one rigid body. `ball` is the sole at the ball of the foot (the top of any platform),
 * `d` the unit [x, z] direction the foot points, `psi` the toe-down pitch. Heel spike and platform hang below.
 */
export function footPose(D, ball, d, psi) {
  const fwd = [d[0] * Math.cos(psi), -Math.sin(psi), d[1] * Math.cos(psi)];
  const up = [d[0] * Math.sin(psi), Math.cos(psi), d[1] * Math.sin(psi)];
  const r = psi - D.pitch, vert = [d[0] * Math.sin(r), Math.cos(r), d[1] * Math.sin(r)]; // the shoe's own vertical
  const heelSole = sub(ball, mul(fwd, D.Lhb));
  const tp = Math.max(-0.2, psi - D.pitch), tf = [d[0] * Math.cos(tp), -Math.sin(tp), d[1] * Math.cos(tp)];
  const toeSole = add(ball, mul(tf, 0.28 * D.footLen));
  const heelLen = D.Lhb * Math.sin(D.pitch) + D.plat;
  // In a heel the pitch is taken mostly by the arch and forefoot: the heel bone stays steeper-set under the ankle, so
  // the ankle sits 6–7 cm above the heel seat rather than being tipped down with the whole foot.
  const pr = rearPitch(D.pitch) + (psi - D.pitch);
  const fR = [d[0] * Math.cos(pr), -Math.sin(pr), d[1] * Math.cos(pr)], uR = [d[0] * Math.sin(pr), Math.cos(pr), d[1] * Math.sin(pr)];
  const p = {
    ankle: add(add(heelSole, mul(fR, 0.2 * D.footLen)), mul(uR, D.ankleUp + 0.01)),
    heel: add(heelSole, mul(up, 0.02)), ball: add(ball, mul(up, 0.015)), toe: add(toeSole, mul(up, 0.012)),
    heelSole, heelTip: sub(heelSole, mul(vert, heelLen)), platBall: sub(ball, mul(vert, D.plat)), platToe: sub(toeSole, mul(vert, D.plat)),
  };
  p.lowest = Math.min(p.heelTip[1], p.platBall[1], p.platToe[1], p.heelSole[1]);
  return p;
}
const rearPitch = (pitch) => Math.min(pitch, 8 * RAD) + 0.3 * Math.max(0, pitch - 8 * RAD);
const shiftFoot = (p, dy) => { const o = {}; for (const k of Object.keys(p)) o[k] = k === 'lowest' ? p[k] + dy : [p[k][0], p[k][1] + dy, p[k][2]]; return o; };
const moveFoot = (p, m) => { const o = {}; for (const k of Object.keys(p)) o[k] = k === 'lowest' ? p[k] + m[1] : add(p[k], m); return o; };

/** Knee from hip and ankle: two-bone IK bending toward `bend`. */
export function solveKnee(hip, ankle, a, b, bend) {
  const Dv = sub(ankle, hip), d = clamp(len(Dv), 1e-4, a + b - 1e-4), u = norm(Dv);
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const k = norm(sub(bend, mul(u, dot(bend, u))));
  return add(hip, add(mul(u, x), mul(k, h)));
}

const STYLE = {
  // knee: how much of the leg's length the stance leg may use (0.996 is all but straight)
  normal: { bob: 0.065, rot: 4, ob: 4, lean: 3, arm: 18, lift: 0.05, knee: 0.996, kneeMid: 10, beta: 0.62, toeOut: 6, bulge: 0 },
  catwalk: { bob: 0.055, rot: 7, ob: 7, lean: 1, arm: 12, lift: 0.05, knee: 0.996, kneeMid: 8, beta: 0.62, toeOut: 2, bulge: 0.035 },
  careful: { bob: 0.045, rot: 3, ob: 2, lean: 6, arm: 8, lift: 0.035, knee: 0.99, kneeMid: 14, beta: 0.68, toeOut: 8, bulge: 0 },
};
const azOf = (d) => Math.atan2(d[0], d[1]);
const dirOf = (az) => [Math.sin(az), Math.cos(az)];
const leftOf = (az) => [-Math.cos(az), 0, Math.sin(az)];
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Animate the scene's figure. Returns { frames: [{ t, nodes, shoe, contact }], dims, steps, stats, notes }.
 * nodes holds the 22 joints (head is the head's centre) plus hand_l / hand_r; shoe holds each shoe's spike and platform points.
 */
export function animate(scene) {
  // engine "sim": a walker that balances (simwalker.mjs): feet go where balance needs them, slips come from the ground
  if (scene.activity?.engine === 'sim' && (scene.activity.kind === 'walk')) return simulate(scene, { bodyDims, footPose, solveKnee, balanceOf, reference: (sc) => animate({ ...sc, activity: { ...sc.activity, engine: 'kinematic', mix: 0, slips: [] } }) });
  // the cap/sim mix: above 0, the physics adjusts the walk and adds the skids the ground could not prevent
  if (!(scene.activity?.mix > 0)) return paced(scene);
  const h = hybridise(scene, (sc) => paced({ ...sc, activity: { ...sc.activity, mix: 0 } }));
  const out = paced(h.scene);
  return { ...out, hybrid: { added: h.added, gait: h.gait } };
}
function twistAt(k, t) {
  if (!Array.isArray(k) || !k.length) return 0;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const u = (t - k[i - 1][0]) / ((k[i][0] - k[i - 1][0]) || 1), e = u * u * (3 - 2 * u); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * e; }
  return k[k.length - 1][1];
}
function paced(scene) {
  const k = scene.activity?.pace;
  if (!Array.isArray(k) || !k.length || scene.activity.kind !== 'walk') return animateFlat(scene);
  const fps = scene.output.fps, N = Math.max(2, Math.round(scene.duration_s * fps));
  const tau = [0];
  for (let i = 1; i < N; i++) tau.push(tau[i - 1] + Math.max(0, twistAt(k, (i - 0.5) / fps)) / fps);
  const base = animateFlat({ ...scene, duration_s: tau[N - 1] + 3 / fps });
  const mix3 = (a, b, u) => { if (Array.isArray(a) && a.length === 3 && typeof a[0] === 'number') return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    if (a && typeof a === 'object') { const o = {}; for (const key of Object.keys(a)) o[key] = b && key in b ? mix3(a[key], b[key], u) : a[key]; return o; }
    return typeof a === 'number' && typeof b === 'number' ? a + (b - a) * u : (u < 0.5 ? a : b); };
  const frames = tau.map((tt, i) => {
    const x = tt * fps, j = Math.min(Math.floor(x), base.frames.length - 2), u = Math.min(1, x - j);
    const f = mix3(base.frames[j], base.frames[j + 1], u);
    return { ...f, t: i / fps, walk_t: tt };
  });
  return { ...base, frames, notes: [...(base.notes ?? []), `pace keyframes: ${round2(tau[N - 1])} s of walking in ${round2((N - 1) / fps)} s`] };
}
const round2 = (x) => Math.round(x * 100) / 100;
/**
 * How much the body must balance with its hips and arms, 0–1, and why. Standing, the ankles do most of the work:
 * they shift the pressure under the foot to keep the body over it. On high heels there is no heel to press, on ice
 * there is no grip to press against, and on a cross-slope the foot is already tilted; then the hips and arms take
 * over (arms out raise the body's inertia and swing against a fall), the base widens and the knees bend. The scene
 * can set activity.balance (0–1) instead, or 0 to switch it off.
 */
export function balanceOf(scene, D) {
  const a = scene.activity;
  if (Number.isFinite(a.balance)) return { demand: clamp(a.balance, 0, 1), why: 'as set' };
  if (a.kind !== 'walk' && a.kind !== 'stand') return { demand: 0, why: '' };
  const heel = clamp((D.heel - 0.04) / 0.11, 0, 1), mu = surfaceMu(scene), slip = clamp((0.45 - mu) / 0.3, 0, 1);
  const TR = terrainOf(scene), p = a.path?.[0] ?? [0, 4], q = a.path?.[a.path.length - 1] ?? p;
  let slope = 0;
  if (TR) { // the cross-slope along the walk: the ground's tilt across the direction of travel, at a few points
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ax = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
    for (let k = 0; k <= 4; k++) { const x = p[0] + ((q[0] - p[0]) * k) / 4, z = p[1] + ((q[1] - p[1]) * k) / 4, e = 0.2; slope = Math.max(slope, Math.abs(Math.atan((TR.height(x + ax[0] * e, z + ax[1] * e) - TR.height(x - ax[0] * e, z - ax[1] * e)) / (2 * e)))); }
  }
  const tilt = clamp(slope / (25 * RAD), 0, 1);
  // the ankles' share of the work, lost to each cause in turn; heels alone on dry ground need little else
  const demand = clamp(1 - (1 - 0.2 * heel) * (1 - 0.75 * slip) * (1 - 0.4 * tilt) * (1 - 0.5 * heel * slip), 0, 1);
  const why = [heel > 0.3 ? `${Math.round(D.heel * 100)} cm heels` : '', slip > 0.2 ? `μ ${Math.round(mu * 100) / 100}` : '', tilt > 0.2 ? `a ${Math.round(slope / RAD)}° cross-slope` : ''].filter(Boolean).join(', ');
  return { demand: Math.round(demand * 100) / 100, why };
}

function animateFlat(scene) {
  const D = bodyDims(scene.figure), a = scene.activity, fps = scene.output.fps;
  const N = Math.max(2, Math.round(scene.duration_s * fps));
  const st = { ...STYLE[a.style] ?? STYLE.normal };
  st.knee -= 0.003 * clamp((D.heel - D.plat) / 0.1, 0, 1.5); // high heels keep the knees a touch softer
  // balance: where the ankles can't keep the body over the feet, the hips and arms must (see balanceOf)
  const bal = balanceOf(scene, D), B = bal.demand;
  st.lean += 6 * B; // the trunk forward, over the feet
  if (Number.isFinite(a.toe_out_deg)) st.toeOut = a.toe_out_deg; // feet turned out as seen (a splayed, careful stance)
  else if (B > 0.3) st.toeOut = Math.max(st.toeOut, 6 + 14 * B);
  const kneeBend = a.knee_bend_deg ?? (B > 0.3 ? 24 * B : 0);
  if (kneeBend > 0) { // a stance leg seen bent is never let reach further than the knee bent that much allows
    const k = kneeBend * RAD;
    st.knee = Math.min(st.knee, Math.sqrt(D.thigh ** 2 + D.shank ** 2 + 2 * D.thigh * D.shank * Math.cos(k)) / (D.thigh + D.shank));
  }
  const walking = a.kind === 'walk';
  const v = walking ? a.speed_mps : 0, T = walking ? 120 / a.cadence_spm : 4, L = (v * T) / 2, beta = st.beta;
  const path = makePath(a.path);
  const legR = st.knee * (D.thigh + D.shank);
  // the ground: each foot rests on its own patch, tilted to it
  const TR = terrainOf(scene), gh = (x, z) => (TR ? TR.height(x, z) : 0);
  const normalAt = (x, z) => { const e = 0.05; return norm([-(gh(x + e, z) - gh(x - e, z)) / (2 * e), 1, -(gh(x, z + e) - gh(x, z - e)) / (2 * e)]); };
  function onGround(p, lift) {
    let q = p;
    if (TR) {
      // tilt the shoe with the ground under it (an ankle rolls about 20° at most), turning about where it touches
      const n = normalAt(p.platBall[0], p.platBall[2]), axis = vec.cross([0, 1, 0], n), sa = len(axis);
      if (sa > 1e-6) {
        const th = Math.min(Math.asin(clamp(sa, 0, 1)), 20 * RAD), k = mul(axis, 1 / sa), o = p.platBall;
        const rot = (v) => { const r = sub(v, o), c = Math.cos(th), sn = Math.sin(th); return add(o, add(add(mul(r, c), mul(vec.cross(k, r), sn)), mul(k, dot(k, r) * (1 - c)))); };
        q = {}; for (const key of Object.keys(p)) q[key] = key === 'lowest' ? p[key] : rot(p[key]);
      }
    }
    // then rest it on the ground: the sole point that is lowest above its own patch of ground touches it
    let gap = Infinity;
    for (const key of ['heelTip', 'platBall', 'platToe', 'heelSole']) gap = Math.min(gap, q[key][1] - gh(q[key][0], q[key][2]));
    return shiftFoot(q, -gap + lift);
  }
  // the body as an inverted pendulum over each stance foot: it slows onto the foot and speeds up off it, so the point
  // the ground has to push through (the ZMP) stays under the foot
  const Ts = T / 2, hc = 0.55 * D.H + 0.7 * D.heel, om = Math.sqrt(9.81 / hc);
  const phiMax = Math.max(8, Math.min(35, 48 - D.pitch / RAD)) * RAD, phiLand = (D.heel - D.plat > 0.05 ? -2 : -5) * RAD;
  const notes = [];
  const first = a.start_foot === 'left' ? 'l' : 'r', other = first === 'l' ? 'r' : 'l';
  // the body passes over the middle of the foot a little before the middle of its stance (about a quarter of the stride
  // after the heel lands, as in real gait), which keeps the leading leg from reaching far ahead at heel strike
  const flat0 = footPose(D, [0, D.plat, 0], [0, 1], D.pitch), cOff = (flat0.heelTip[2] + flat0.platToe[2]) / 2 + 0.05 * v * T; // support centre, ahead of the ball (−: behind)
  // step width: the sideways gap between the feet. A catwalk lands each foot on the midline or just past it; more than
  // a few centimetres past would cross the legs into an X, which people don't walk in, so it is limited here
  // balancing widens the base: the feet land further apart (unless the scene's own width is wider still)
  const stepW = Math.max(-0.04, a.step_width_m ?? 0.08, B > 0.3 ? 0.08 + 0.16 * B : -Infinity);
  if (B > 0.3) notes.push(`balance ${Math.round(B * 100) / 100} (${bal.why}): arms out, trunk forward, a wider, turned-out stance on bent knees turned in`);
  if ((a.step_width_m ?? 0) < -0.04) notes.push(`step_width_m ${a.step_width_m} would cross the legs: limited to -0.04 m. Feet seen apart (side by side) mean a positive width`);

  // footfalls: alternate feet every half stride, placed so the body passes over each foot at mid-stance
  const strikes = { l: [], r: [] }, tOff = Number.isFinite(a.step_offset_s) ? a.step_offset_s : -0.2 * T;
  if (walking) {
    for (let k = -4; tOff + (k * T) / 2 < scene.duration_s + 2 * T; k++) {
      const t = tOff + (k * T) / 2, side = (k & 1) === 0 ? first : other, sg = side === 'l' ? 1 : -1;
      const at = path.at(v * (t + (beta * T) / 2) - cOff), az = azOf(at.dir), lf = leftOf(az);
      const lat = (sg * stepW) / 2;
      strikes[side].push({ t, side, x: at.p[0] + lf[0] * lat, z: at.p[1] + lf[2] * lat, az: az - sg * st.toeOut * RAD });
    }
  } else {
    const p0 = a.path[0], az = a.facing_deg != null ? a.facing_deg * RAD : Math.atan2(-p0[0], -p0[1]); // default: facing the camera
    const lf = leftOf(az), w = Math.max(0.1, a.step_width_m ?? 0.12) / 2;
    for (const [side, sg] of [['l', 1], ['r', -1]]) {
      const fa = az - sg * st.toeOut * RAD, back = 0.1 * D.footLen; // ball a little ahead of the standing point
      strikes[side].push({ t: -1e9, side, x: p0[0] + lf[0] * w * sg + Math.sin(fa) * back, z: p0[1] + lf[2] * w * sg + Math.cos(fa) * back, az: fa }, { t: 1e9, side, x: 0, z: 0, az: fa });
    }
  }
  const tR0 = walking ? strikes.r.find((s) => s.t >= tOff)?.t ?? 0 : 0;
  const shTs = Math.sinh(om * Ts / 2);
  const along = (t) => {
    if (!walking) return 0;
    const k = Math.round((t - tOff - (beta * T) / 2) / Ts), m = tOff + k * Ts + (beta * T) / 2;
    return v * m + (v * Ts / 2) * Math.sinh(om * (t - m)) / shTs;
  };
  // side to side: the centre of mass moves toward where each stance foot actually is (across the midline, in a
  // catwalk) just far enough that the ZMP lands under it; a catwalk's hip swing is tilt and turn, not travel
  const OmL = Math.PI / Ts, swayA = walking ? (stepW / 2) / (1 + OmL * OmL * hc / 9.81) : 0;

  function footAtBase(side, t) {
    const list = strikes[side];
    let i = 0; while (i < list.length - 2 && list[i + 1].t <= t) i++;
    const s0 = list[i], s1 = list[i + 1], u = t - s0.t;
    let ball, az, phi, lift = 0, stance = true, ws = null;
    if (!walking || u < beta * T) {
      const w = walking ? u / (beta * T) : 0.3; ws = w;
      phi = w < 0.12 ? phiLand * (1 - ease(w / 0.12)) : w > 0.55 ? phiMax * ease((w - 0.55) / 0.45) : 0;
      ball = [s0.x, gh(s0.x, s0.z) + D.plat, s0.z]; az = s0.az;
    } else {
      stance = false;
      const w = (u - beta * T) / ((1 - beta) * T), e = ease(Math.pow(w, 0.75)), sg = side === 'l' ? 1 : -1;
      az = angLerp(s0.az, s1.az, e);
      const lf = leftOf(az), bulge = st.bulge * Math.sin(Math.PI * w) * sg;
      const bx = s0.x + (s1.x - s0.x) * e + lf[0] * bulge, bz = s0.z + (s1.z - s0.z) * e + lf[2] * bulge;
      ball = [bx, gh(bx, bz) + D.plat, bz];
      phi = phiMax + (phiLand - phiMax) * ease(clamp(w * 1.25, 0, 1));
      lift = st.lift * Math.sin(Math.PI * Math.pow(w, 0.85));
      ws = -w; // negative: progress through swing
    }
    const p = footPose(D, ball, dirOf(az), D.pitch + phi);
    return { pose: onGround(p, lift), stance, az, ball, phi, w: ws };
  }
  // slips: a glide keeps a swinging foot on the ground as it slides to its next placement (plus distance_m);
  // a skid slides a planted foot (backward by default) and the offset is carried until the foot next lifts.
  const slips = (a.slips ?? []).map((q) => ({ ...q, side: /^l/i.test(String(q.foot ?? '')) ? 'l' : 'r' }));
  // recovering from a slip: the body catches itself. The trunk folds forward, the pelvis drops onto bent knees, the
  // arms fly up and out, and the other foot's next step lands early and wide to put a base back under the body. Each
  // slip's response rises over 0.15 s, holds to just after the slide and fades over 0.6 s, scaled by how far the
  // foot went (slips.recover: false switches it off for one slip).
  const rescue = slips.filter((q) => q.recover !== false && q.kind !== 'glide').map((q) => ({ ...q, sev: clamp((q.distance_m ?? 0.1) / 0.2, 0.3, 1) }));
  const recovAt = (t) => { let r = 0, side = null; for (const q of rescue) { const up = clamp((t - q.from_s) / 0.15, 0, 1), down = 1 - clamp((t - q.to_s - 0.2) / 0.6, 0, 1), v = q.sev * Math.min(up, down) * (t >= q.from_s ? 1 : 0); if (v > r) { r = v; side = q.side; } } return { r, side }; };
  const recov = (t) => recovAt(t).r;
  for (const q of rescue) {
    const o = q.side === 'l' ? 'r' : 'l', k = strikes[o].findIndex((s) => s.t > q.from_s && s.t < q.from_s + 1.0);
    if (k < 0) continue;
    const s = strikes[o][k], out = mul(leftOf(s.az), o === 'l' ? 1 : -1), fw = dirOf(s.az);
    strikes[o][k] = { ...s, t: Math.max(q.from_s + 0.12, s.t - 0.08 * q.sev), x: s.x + out[0] * 0.1 * q.sev + fw[0] * 0.08 * q.sev, z: s.z + out[2] * 0.1 * q.sev + fw[1] * 0.08 * q.sev };
  }
  if (rescue.length) notes.push(`${rescue.length} slip${rescue.length > 1 ? 's' : ''} recovered: trunk forward, arms up and out, a catching step`);
  function liftoffAfter(side, t) {
    const list = strikes[side]; let i = 0; while (i < list.length - 2 && list[i + 1].t <= t) i++;
    let lo = list[i].t + beta * T, nx = list[i + 1].t;
    if (lo < t) { lo = list[i + 1].t + beta * T; nx = list[i + 2] ? list[i + 2].t : lo + T; }
    return [lo, nx];
  }
  function footAt(side, t) {
    const f = footAtBase(side, t);
    if (!slips.length) return f;
    let ox = 0, oz = 0, glide = null, active = null;
    for (const q of slips) {
      if (q.side !== side || t < q.from_s) continue;
      const qa = q.world_dir ? azOf(q.world_dir) : f.az + (q.dir_deg ?? (q.kind === 'skid' ? 180 : 0)) * RAD, dv = dirOf(qa), d = q.distance_m ?? 0;
      let k;
      if (t <= q.to_s) { k = ease((t - q.from_s) / Math.max(1e-3, q.to_s - q.from_s)); active = q; if (q.kind === 'glide') glide = q; }
      else { const [lo, nx] = liftoffAfter(side, q.to_s); k = t < lo ? 1 : t >= nx ? 0 : 1 - ease((t - lo) / Math.max(1e-3, nx - lo)); }
      ox += dv[0] * d * k; oz += dv[1] * d * k;
    }
    if (!active && !ox && !oz) return f;
    let pose;
    if (glide) { const gx = f.ball[0] + ox, gz = f.ball[2] + oz; pose = onGround(footPose(D, [gx, gh(gx, gz) + D.plat, gz], dirOf(f.az), D.pitch), 0); }
    else { pose = moveFoot(f.pose, [ox, 0, oz]); if (TR) pose = onGround(pose, f.stance ? 0 : Math.max(0, f.pose.heelTip[1] - gh(f.pose.heelTip[0], f.pose.heelTip[2]))); }
    const out = { ...f, pose, stance: f.stance || !!glide, slide: !!active };
    if (active) { const f0 = footAtBase(side, active.from_s); out.slideFrom = [f0.ball[0], gh(f0.ball[0], f0.ball[2]) + 0.004, f0.ball[2]]; }
    return out;
  }

  // the whole body for a given correction of the pelvis's ground position (corr[i] = [dx, dz])
  function build(corr, final) {
    // first pass: everything but the pelvis height
    const raw = [];
    for (let i = 0; i < N; i++) {
      const t = i / fps;
      const phR = walking ? ((((t - tR0) / T) % 1) + 1) % 1 : t / 5;
      const at = path.at(along(t)), az = azOf(at.dir);
      const swayPh = Math.cos(2 * Math.PI * (phR - beta / 2));
      const lat = walking ? -swayA * swayPh : 0.01 * Math.sin(2 * Math.PI * phR);
      const lf = leftOf(az);
      const base = walking ? [at.p[0] + lf[0] * lat + corr[i][0], 0, at.p[1] + lf[2] * lat + corr[i][1]] : (() => { const fl = (strikes.l[0].x + strikes.r[0].x) / 2, fz = (strikes.l[0].z + strikes.r[0].z) / 2; return [fl + lf[0] * lat - Math.sin(strikes.l[0].az) * 0.02, 0, fz + lf[2] * lat - Math.cos(strikes.l[0].az) * 0.02]; })();
      const faceAz = walking ? az : (strikes.l[0].az + strikes.r[0].az) / 2;
      const rho = walking ? st.rot * RAD * Math.cos(2 * Math.PI * phR) : 0;
      const ob = walking ? st.ob * RAD * swayPh : 2 * RAD * Math.sin(2 * Math.PI * phR);
      raw.push({ t, phR, faceAz, rho, ob, base, feet: { l: footAt('l', t), r: footAt('r', t) } });
    }

    // pelvis height: as high as the stance legs reach (knees kept soft), then smoothed and clamped again
    const hipOffset = (fr, side) => {
      const sg = side === 'l' ? 1 : -1, lf = leftOf(fr.faceAz - fr.rho);
      return [lf[0] * sg * D.hipW / 2, -sg * Math.sin(fr.ob) * D.hipW / 2, lf[2] * sg * D.hipW / 2];
    };
    let short = 0;
    const reach = raw.map((fr) => {
      let y = Infinity;
      for (const side of ['l', 'r']) {
        const f = fr.feet[side];
        // a foot near push-off rolls onto its toes as far as its leg needs, so it doesn't hold the hips down
        if (!f.stance || (walking && f.w != null && f.w > 0.7 && !f.slide && fr.feet[side === 'l' ? 'r' : 'l'].stance)) continue;
        const o = hipOffset(fr, side), an = f.pose.ankle;
        const dxz = Math.hypot(fr.base[0] + o[0] - an[0], fr.base[2] + o[2] - an[2]);
        if (dxz > legR) short++;
        y = Math.min(y, an[1] - o[1] + Math.sqrt(Math.max(0, legR * legR - dxz * dxz)));
      }
      return y;
    });
    const flat = footPose(D, [0, D.plat, 0], [0, 1], D.pitch), standY = flat.ankle[1] - flat.lowest + legR * 0.998;
    // heights below are taken relative to the ground under the stance feet, so slopes and steps carry the body with them
    const gref = raw.map((fr) => {
      let g = 0, n = 0;
      for (const side of ['l', 'r']) if (fr.feet[side].stance) { const b = fr.feet[side].pose.platBall; g += gh(b[0], b[2]); n++; }
      return n ? g / n : gh(fr.base[0], fr.base[2]);
    });
    const gwin = Math.max(1, Math.round(0.15 * fps));
    const gs = gref.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - gwin); j <= Math.min(N - 1, i + gwin); j++) { s += gref[j]; n++; } return s / n; });
    for (let i = 0; i < N; i++) if (!Number.isFinite(reach[i])) reach[i] = i ? reach[i - 1] : gs[i] + standY;
    const rel = reach.map((y, i) => y - gs[i]);
    // a straight-legged walk would dip far between steps; real walkers flex the stance knee instead, so the rise
    // above the lowest point of each step is capped at a few centimetres
    const half = Math.max(1, Math.round((T / 2) * fps)), bobMax = st.bob;
    // mid-stance knee flexion sets the top of each rise: about 15° in an ordinary stride, less in short slow steps (the
    // loading knee bends less at low speed), a little more in high heels
    // knee_bend_deg: a walker seen to keep the knees bent (a crouched, braced walk on ice) never straightens past it
    const km = Math.max(st.kneeMid * clamp(L / (0.4 * D.H), 0.5, 1.2) + 5 * clamp((D.heel - D.plat) / 0.12, 0, 1), kneeBend) * RAD;
    const softY = flat.ankle[1] - flat.lowest + Math.sqrt(D.thigh ** 2 + D.shank ** 2 + 2 * D.thigh * D.shank * Math.cos(km));
    const capped = rel.map((y, i) => {
      let lo = Infinity;
      for (let j = Math.max(0, i - half); j <= Math.min(N - 1, i + half); j++) lo = Math.min(lo, rel[j]);
      return Math.min(y, softY, lo + bobMax);
    });
    // a smooth height the legs can always reach: the lower envelope of parabolas hung under every frame's limit (so the
    // body never drops faster than about 3 m/s² would allow), then smoothed and kept under the limit, a few times
    const lim = capped.map((y, i) => Math.min(y + gs[i], reach[i])), kc = 1.6, dt = 1 / fps;
    let pelY = lim.map((_, i) => { let y = Infinity; for (let j = 0; j < N; j++) y = Math.min(y, lim[j] + kc * ((i - j) * dt) ** 2); return y; });
    const sw = Math.max(1, Math.round(0.08 * fps));
    for (let pass = 0; pass < 4; pass++) {
      pelY = pelY.map((_, i) => { let s2 = 0, n = 0; for (let j = Math.max(0, i - sw); j <= Math.min(N - 1, i + sw); j++) { s2 += pelY[j]; n++; } return Math.min(s2 / n, lim[i]); });
    }
    if (final && short > 0) notes.push(`steps are long for these legs in ${short} frame-feet: the body dips to reach (shorten the step or slow down)`);

    // second pass: the whole body
    const upW = [0, 1, 0];
    const frames = raw.map((fr, i) => {
      const Rv = recov(fr.t), C = [fr.base[0], pelY[i] - 0.06 * (D.H / 1.7) * Rv, fr.base[2]];
      const hip_l = add(C, hipOffset(fr, 'l')), hip_r = add(C, hipOffset(fr, 'r'));
      const tw = twistAt(a.twist, fr.t) * RAD, pelAz = fr.faceAz - fr.rho, shAz = fr.faceAz + 0.7 * fr.rho + tw;
      const pf = dirOf(pelAz), f3 = [pf[0], 0, pf[1]];
      const lean = (st.lean + 20 * Rv) * RAD, trunkDir = norm(add(mul(upW, Math.cos(lean)), mul(f3, Math.sin(lean))));
      const nodes = { hip_l, hip_r, waist: add(C, mul(trunkDir, 0.04 * D.H)), spine: add(C, mul(trunkDir, 0.5 * D.trunk)) };
      const SC = add(C, mul(trunkDir, D.trunk));
      nodes.neck = add(C, mul(trunkDir, D.trunk + 0.012 * D.H));
      const shL = leftOf(shAz), sf = dirOf(shAz), shF = [sf[0], 0, sf[1]];
      nodes.shoulder_l = add(SC, mul(shL, D.shoulderW / 2));
      nodes.shoulder_r = add(SC, mul(shL, -D.shoulderW / 2));
      const headAz = fr.faceAz + 1.25 * tw + (a.head_turn_deg ?? 0) * RAD, hf = dirOf(headAz);
      const look = 0.12 + 0.35 * Math.max(B, Rv); // balancing, the head bows to watch the feet
      nodes.head = add(nodes.neck, mul(norm([hf[0] * look, 1, hf[1] * look]), D.headUp));
      const shoe = {}, contact = {};
      for (const side of ['l', 'r']) {
        const f = fr.feet[side];
        let p = f.pose;
        const hip = side === 'l' ? hip_l : hip_r;
        // a swinging foot the leg can't reach is pulled in (the stance foot is always reachable: the pelvis was set by it)
        const Lmax = (D.thigh + D.shank) * 0.999;
        // knee flexion through the gait cycle (Perry): straight-ish through stance, bending from heel-off to about 35°
        // at toe-off and about 60° early in swing, then opening out to land
        const kneeTo = (k) => Math.sqrt(D.thigh ** 2 + D.shank ** 2 + 2 * D.thigh * D.shank * Math.cos(k));
        const swingK = (w) => 62 * RAD * Math.pow(Math.sin(Math.PI * (0.22 + 0.78 * w)), 1.2);
        const Lpush = walking && f.stance && f.w != null && f.w > 0.7 ? Math.min(Lmax, kneeTo(swingK(0) * ((f.w - 0.7) / 0.3) ** 2)) : Lmax;
        if (f.stance && f.w != null && !f.slide && len(sub(p.ankle, hip)) > Lpush) {
          // push-off: roll the planted foot further onto its toes (about the ball) until the leg reaches it
          let lo2 = 0, hi2 = Math.max(0, 70 * RAD - D.pitch - f.phi);
          for (let k = 0; k < 18; k++) { const mid = (lo2 + hi2) / 2, q = onGround(footPose(D, f.ball, dirOf(f.az), D.pitch + f.phi + mid), 0); if (len(sub(q.ankle, hip)) > Lpush) lo2 = mid; else hi2 = mid; }
          p = onGround(footPose(D, f.ball, dirOf(f.az), D.pitch + f.phi + hi2), 0);
        }
        if (walking && !f.stance && f.w != null && f.w < 0) {
          // swing: a foot left behind the hips rides up on the bent knee instead of trailing on a straight leg
          const dMax = kneeTo(swingK(-f.w)), an = p.ankle;
          const dxz = Math.hypot(an[0] - hip[0], an[2] - hip[2]);
          if (len(sub(an, hip)) > dMax && dxz < dMax) p = moveFoot(p, [0, hip[1] - Math.sqrt(dMax * dMax - dxz * dxz) - an[1], 0]);
        }
        const gap = len(sub(p.ankle, hip)) - Lmax;
        if (gap > 0) p = moveFoot(p, mul(norm(sub(hip, p.ankle)), gap));
        const fd = dirOf(f.az);
        // the knees point where the foot points; balancing on a wide base, they turn in over the feet (valgus)
        const kin = a.knees_in ?? (B > 0.3 ? 0.45 * B : 0), inw = mul(leftOf(f.az), side === 'l' ? -1 : 1);
        nodes[`knee_${side}`] = solveKnee(hip, p.ankle, D.thigh, D.shank, norm([fd[0] + kin * inw[0], 0.15, fd[1] + kin * inw[2]]));
        for (const k of ['ankle', 'heel', 'ball', 'toe']) nodes[`${k}_${side}`] = p[k];
        shoe[side] = { heelSole: p.heelSole, heelTip: p.heelTip, platBall: p.platBall, platToe: p.platToe, ...(f.slideFrom ? { slideFrom: f.slideFrom } : {}) };
        contact[side] = f.slide ? 'slide' : f.stance ? 'stance' : 'swing';
      }
      for (const side of ['l', 'r']) Object.assign(nodes, armPose(side, fr, nodes, { D, st, a, shF, shL, beta, walking, B, Rv, Rside: recovAt(fr.t).side }));
      return { t: fr.t, nodes, shoe, contact, facing_deg: fr.faceAz / RAD, head_deg: headAz / RAD };
    });

    return frames;
  }

  // The pelvis follows the pendulum, but swinging legs and arms move the whole body's centre of mass off it. Measure
  // that offset and move the pelvis against it, so the centre of mass itself rides the pendulum path .
  const MASS = [['head', 'neck', 0.081], ['neck', 'waist', 0.497], ['hip_l', 'knee_l', 0.1], ['hip_r', 'knee_r', 0.1], ['knee_l', 'ankle_l', 0.0465], ['knee_r', 'ankle_r', 0.0465], ['ankle_l', 'toe_l', 0.0145], ['ankle_r', 'toe_r', 0.0145], ['shoulder_l', 'elbow_l', 0.028], ['shoulder_r', 'elbow_r', 0.028], ['elbow_l', 'hand_l', 0.022], ['elbow_r', 'hand_r', 0.022]];
  const comOf = (n) => { let x = 0, z = 0, m = 0; for (const [p, q, w] of MASS) { x += w * (n[p][0] + n[q][0]) / 2; z += w * (n[p][2] + n[q][2]) / 2; m += w; } return [x / m, z / m]; };
  let corr = Array.from({ length: N }, () => [0, 0]), frames = build(corr, false);
  if (walking) {
    // the pendulum path is where the uncorrected pelvis goes; the correction is solved by fixed-point iteration (moving
    // the pelvis moves most, not all, of the body, so a few rounds are needed)
    const target = frames.map((f) => [f.nodes.waist[0], f.nodes.waist[2]]);
    const its = 4;
    for (let it = 0; it < its; it++) {
      const err = frames.map((f, i) => { const c = comOf(f.nodes); return [c[0] - target[i][0], c[1] - target[i][1]]; });
      corr = corr.map((c, i) => [c[0] - 1.15 * err[i][0], c[1] - 1.15 * err[i][1]]);
      frames = build(corr, it === its - 1);
    }
  }

  const steps = [...strikes.l, ...strikes.r].filter((s) => s.t >= 0 && s.t <= scene.duration_s).sort((p, q) => p.t - q.t);
  return {
    frames, dims: D, steps, notes,
    stats: { step_length_m: L, stride_s: T, speed_mps: v, path_length_m: path.length, distance_m: v * scene.duration_s },
  };
}

// ---------- arms ----------
function armPose(side, fr, nodes, { D, st, a, shF, shL, beta, walking, B = 0, Rv = 0, Rside = null }) {
  const sg = side === 'l' ? 1 : -1, S = nodes[`shoulder_${side}`], out = mul(shL, sg), down = [0, -1, 0];
  const pose = (name) => {
    const A = st.arm * (a.arm_swing ?? 1);
    const swing = walking ? sg * A * Math.cos(2 * Math.PI * fr.phR) : 0; // the left arm leads when the right foot lands
    // balance: held out to the side for balance (on ice, a beam), a little forward, elbows soft, rocking with the steps
    const rock = walking ? Math.sin(2 * Math.PI * fr.phR) * (0.6 + 0.8 * B) : 0; // more balancing, more counter-swing
    const simple = { swing: [swing, 7, 12 + 14 * Math.max(0, swing / (A || 1))], hang: [0.25 * swing, 6, 10], bag: [0.15 * swing, 10, 8], balance: [22 + 4 * sg * rock, 46 + 8 * sg * rock, 38], catch: [32, 82, 24], catch_high: [25, 118, 18], catch_low: [18, 58, 32] }[name]; // catch: flung up and out
    if (simple) {
      // arm_raise_deg {left, right}: an arm held higher (or lower) than the pose's own, as seen
      const raise = ['balance', 'catch', 'catch_high', 'catch_low'].includes(name) ? (a.arm_raise_deg?.[side === 'l' ? 'left' : 'right'] ?? 0) : 0;
      const [al, ab, el] = [simple[0], simple[1] + raise, simple[2]].map((x) => x * RAD);
      let u = norm(add(mul(down, Math.cos(al)), mul(shF, Math.sin(al))));
      u = norm(add(mul(u, Math.cos(ab)), mul(out, Math.sin(ab))));
      const perp = norm(sub(shF, mul(u, dot(shF, u))));
      const fd = norm(add(mul(u, Math.cos(el)), mul(perp, Math.sin(el))));
      const elbow = add(S, mul(u, D.upperArm));
      return { elbow, wrist: add(elbow, mul(fd, D.forearm)) };
    }
    const hip = nodes[`hip_${side}`], head = nodes.head;
    const [target, bend] = {
      hip: [add(add(hip, mul(out, 0.07)), [0, 0.06, 0]), add(out, mul(shF, -0.6))],
      hair: [add(add(head, mul(out, D.headR + 0.03)), add([0, 0.01, 0], mul(shF, -0.03))), add(out, [0, -0.3, 0])],
      phone: [add(add(nodes.neck, mul(shF, 0.32)), add([0, -0.2, 0], mul(out, 0.04))), add(out, [0, -1, 0])],
    }[name];
    const elbow = solveKnee(S, target, D.upperArm, D.forearm, norm(bend));
    return { elbow, wrist: add(elbow, mul(norm(sub(target, elbow)), D.forearm)) };
  };
  const armName = a.arms?.[side === 'l' ? 'left' : 'right'] ?? 'swing';
  let p = pose(armName);
  // swinging arms come up and out as the balance demand rises (an explicit pose is the scene's own reading, and kept)
  const wb = armName === 'swing' ? Math.max(0, Math.min(1, (B - 0.4) / 0.3)) : 0;
  const blend = (q, w) => { const S0 = nodes[`shoulder_${side}`], elbow = add(S0, mul(norm(sub(lerp(p.elbow, q.elbow, w), S0)), D.upperArm)); return { elbow, wrist: add(elbow, mul(norm(sub(lerp(p.wrist, q.wrist, w), elbow)), D.forearm)) }; };
  if (wb > 0) { const q = pose('balance'), elbow = add(nodes[`shoulder_${side}`], mul(norm(sub(lerp(p.elbow, q.elbow, wb), nodes[`shoulder_${side}`])), D.upperArm)); p = { elbow, wrist: add(elbow, mul(norm(sub(lerp(p.wrist, q.wrist, wb), elbow)), D.forearm)) }; }
  // a slip: the arms go up and out to catch the fall, the one on the slipping foot's side highest (it reaches the way
  // the foot went, to bring the body back over it)
  if (Rv > 0) p = blend(pose(Rside == null ? 'catch' : Rside === side ? 'catch_high' : 'catch_low'), Rv);
  for (const g of a.gestures ?? []) {
    if (g.arm !== (side === 'l' ? 'left' : 'right')) continue;
    const w = ease((fr.t - g.from_s) / 0.35) * ease((g.to_s - fr.t) / 0.35);
    if (w <= 0) continue;
    const q = pose(g.pose);
    const elbow = add(S, mul(norm(sub(lerp(p.elbow, q.elbow, w), S)), D.upperArm));
    const wrist = add(elbow, mul(norm(sub(lerp(p.wrist, q.wrist, w), elbow)), D.forearm));
    p = { elbow, wrist };
  }
  const hand = add(p.wrist, mul(norm(sub(p.wrist, p.elbow)), 0.75 * D.hand));
  return { [`elbow_${side}`]: p.elbow, [`wrist_${side}`]: p.wrist, [`hand_${side}`]: hand };
}

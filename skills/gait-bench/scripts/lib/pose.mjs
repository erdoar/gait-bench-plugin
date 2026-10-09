// pose.mjs — plays the poses Claude wrote. Claude looks at the footage and sets the body at key moments: where the
// person stands and faces, how the trunk and head are tipped, where each foot is and whether it is lifted or sliding,
// how each arm is held and where a hand presses on the ground. This only blends between those keys and solves the
// limbs to reach where Claude put the feet and hands. It decides nothing about how a person moves: a walk, a scramble,
// a fall or lying still are all just poses. Pure JavaScript with no Node APIs, so the viewer page can inline it.
import { vec } from './scene.mjs';
import { terrainOf } from './terrain.mjs';
import { prepareShoe } from './shoemesh.mjs';

const RAD = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (w) => { w = clamp(w, 0, 1); return w * w * (3 - 2 * w); };
const { add, sub, mul, dot, norm, len, cross } = vec;
const dirOf = (az) => [Math.sin(az), Math.cos(az)];
const leftOf = (az) => [-Math.cos(az), 0, Math.sin(az)];

/** Body and shoe dimensions in metres from the figure description (Winter's segment ratios). */
export function bodyDims(figure) {
  const H = figure.stature_m, b = { slim: 0.92, average: 1, broad: 1.1 }[figure.build] ?? 1;
  const MSH = figure.footwear.mesh ? prepareShoe(figure.footwear.mesh, figure.footwear) : null;
  const footLen = MSH ? MSH.footLen : 0.152 * H, Lhb = MSH ? MSH.Lhb : 0.72 * footLen;
  const heel = figure.footwear.heel_cm / 100, plat = Math.min(figure.footwear.platform_cm / 100, heel);
  const pitch = Math.asin(clamp((heel - plat) / Lhb, 0, Math.sin(50 * RAD))); // the shoe's built-in toe-down pitch
  return {
    H, build: b, footLen, Lhb, heel, plat, pitch,
    thigh: 0.24 * H, shank: 0.245 * H, ankleUp: 0.039 * H, hipW: 0.1 * H * b, shoulderW: 0.2 * H * b,
    trunk: 0.298 * H, headUp: 0.1 * H, headR: 0.06 * H, upperArm: 0.186 * H, forearm: 0.146 * H, hand: 0.108 * H,
  };
}

/** The foot in its shoe as one rigid body: `ball` is the sole at the ball, `d` the [x, z] way it points, `psi` its toe-down pitch. */
export function footPose(D, ball, d, psi) {
  const fwd = [d[0] * Math.cos(psi), -Math.sin(psi), d[1] * Math.cos(psi)];
  const up = [d[0] * Math.sin(psi), Math.cos(psi), d[1] * Math.sin(psi)];
  const r = psi - D.pitch, vert = [d[0] * Math.sin(r), Math.cos(r), d[1] * Math.sin(r)];
  const heelSole = sub(ball, mul(fwd, D.Lhb));
  const tp = Math.max(-0.2, psi - D.pitch), tf = [d[0] * Math.cos(tp), -Math.sin(tp), d[1] * Math.cos(tp)];
  const toeSole = add(ball, mul(tf, 0.28 * D.footLen));
  const heelLen = D.Lhb * Math.sin(D.pitch) + D.plat;
  // in a heel the arch and forefoot take the pitch: the heel bone stays steeper under the ankle
  const pr = Math.min(D.pitch, 8 * RAD) + 0.3 * Math.max(0, D.pitch - 8 * RAD) + (psi - D.pitch);
  const fR = [d[0] * Math.cos(pr), -Math.sin(pr), d[1] * Math.cos(pr)], uR = [d[0] * Math.sin(pr), Math.cos(pr), d[1] * Math.sin(pr)];
  return {
    ankle: add(add(heelSole, mul(fR, 0.2 * D.footLen)), mul(uR, D.ankleUp + 0.01)),
    heel: add(heelSole, mul(up, 0.02)), ball: add(ball, mul(up, 0.015)), toe: add(toeSole, mul(up, 0.012)),
    heelSole, heelTip: sub(heelSole, mul(vert, heelLen)), platBall: sub(ball, mul(vert, D.plat)), platToe: sub(toeSole, mul(vert, D.plat)),
  };
}
const moveFoot = (p, m) => { const o = {}; for (const k of Object.keys(p)) o[k] = add(p[k], m); return o; };

/** Middle joint (knee, elbow) from the two ends: two-bone IK bending toward `bend`. */
export function solveKnee(hip, ankle, a, b, bend) {
  const Dv = sub(ankle, hip), d = clamp(len(Dv), 1e-4, a + b - 1e-4), u = norm(Dv);
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  let k = sub(bend, mul(u, dot(bend, u)));
  if (len(k) < 1e-6) k = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return add(hip, add(mul(u, x), mul(norm(k), h)));
}

// ---------- keyframe channels ----------
/** Each value Claude gave, by name: 'at', 'trunk.pitch_deg', 'feet.left.at', … → [{t, v, key}] in time order. */
function channels(poses) {
  const ch = {};
  const put = (name, t, v, key) => { (ch[name] ??= []).push({ t, v, key }); };
  const walk = (o, pre, t, key) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === 't' || k === 'note') continue;
      const name = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, name, t, key);
      else put(name, t, v, key);
    }
  };
  poses.forEach((p, i) => walk(p, '', p.t, i));
  // a foot is on the ground in every pose that places it, unless that pose lifts it
  for (const side of ['left', 'right']) {
    const l = poses.map((p, i) => (p.feet?.[side] ? { t: p.t, v: typeof p.feet[side].lift_m === 'number' ? p.feet[side].lift_m : 0, key: i } : null)).filter(Boolean);
    if (l.length) ch[`feet.${side}.lift_m`] = l; else delete ch[`feet.${side}.lift_m`];
  }
  for (const list of Object.values(ch)) list.sort((p, q) => p.t - q.t);
  return ch;
}
const isArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'number');
const lerpV = (a, b, u) => (isArr(a) ? a.map((x, i) => x + (b[i] - x) * u) : a + (b - a) * u);
/** Catmull-Rom through the keys (smooth travel and turning); held before the first and after the last. */
function smooth(list, t) {
  if (!list?.length) return undefined;
  if (t <= list[0].t) return list[0].v;
  const n = list.length;
  if (t >= list[n - 1].t) return list[n - 1].v;
  let i = 0; while (list[i + 1].t < t) i++;
  const p0 = list[Math.max(0, i - 1)], p1 = list[i], p2 = list[i + 1], p3 = list[Math.min(n - 1, i + 2)];
  const u = (t - p1.t) / (p2.t - p1.t || 1), u2 = u * u, u3 = u2 * u;
  // tangents scaled to uneven key spacing, so a long hold next to a quick move doesn't overshoot
  const m = (a, b, c, ta, tc) => (tc > ta ? (isArr(a) ? c.map((x, k) => (x - a[k]) / (tc - ta)) : (c - a) / (tc - ta)) : (isArr(a) ? a.map(() => 0) : 0));
  const dt = p2.t - p1.t, m1 = m(p0.v, p1.v, p2.v, p0.t, p2.t), m2 = m(p1.v, p2.v, p3.v, p1.t, p3.t);
  const h = (a, b, ma, mb) => (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * dt * ma + (-2 * u3 + 3 * u2) * b + (u3 - u2) * dt * mb;
  return isArr(p1.v) ? p1.v.map((x, k) => h(x, p2.v[k], m1[k], m2[k])) : h(p1.v, p2.v, m1, m2);
}
/** Eased from key to key with no overshoot (a foot stays put, then moves, then stays put). */
function stepwise(list, t) {
  if (!list?.length) return undefined;
  if (t <= list[0].t) return list[0].v;
  const n = list.length;
  if (t >= list[n - 1].t) return list[n - 1].v;
  let i = 0; while (list[i + 1].t < t) i++;
  return lerpV(list[i].v, list[i + 1].v, ease((t - list[i].t) / (list[i + 1].t - list[i].t || 1)));
}
/** The keys either side of t in a channel. */
function around(list, t) {
  if (!list?.length) return [null, null];
  let a = null, b = null;
  for (const k of list) { if (k.t <= t) a = k; else { b = k; break; } }
  return [a, b];
}
/** Angles are unwrapped so a turn from 350° to 10° goes the short way. */
function unwrap(list) {
  if (!list) return list;
  const out = []; let prev = null;
  for (const k of list) { let v = k.v; if (prev != null) v = prev + ((((v - prev) % 360) + 540) % 360) - 180; out.push({ ...k, v }); prev = v; }
  return out;
}

/** Defaults for anything no key gives: a person standing upright, arms relaxed, feet under the hips. */
const REST = { trunk: { pitch_deg: 3, roll_deg: 0, twist_deg: 0 }, head: { pitch_deg: 8, turn_deg: 0 }, arms: { raise_deg: 8, out_deg: 15, elbow_deg: 15 }, feet: { out_deg: 8, pitch_deg: 0, lift_m: 0 } };

/**
 * Play the scene's poses. Returns { frames: [{ t, nodes, shoe, contact, facing_deg, head_deg }], dims, notes, reach }:
 * nodes are the joints in world metres (the head is the head's centre), contact says for each foot whether it is
 * planted, sliding or in the air, and for each hand and knee whether it is on the ground. reach lists the moments a
 * limb could not reach where a pose put its foot or hand (the pose is then not physically possible as written).
 */
export function playPoses(scene) {
  const D = bodyDims(scene.figure), fps = scene.output.fps, N = Math.max(2, Math.round(scene.duration_s * fps));
  const poses = scene.poses?.length ? scene.poses : [{ t: 0, at: [0, 4], facing_deg: 180 }];
  const C = channels(poses);
  for (const k of ['facing_deg']) C[k] = unwrap(C[k]);
  const TR = terrainOf(scene), gh = (x, z) => (TR ? TR.height(x, z) : 0);
  const normalAt = (x, z) => { const e = 0.05; return norm([-(gh(x + e, z) - gh(x - e, z)) / (2 * e), 1, -(gh(x, z + e) - gh(x, z - e)) / (2 * e)]); };
  const PL = C.pelvis_m, PV = PL?.filter((k) => typeof k.v === 'number');
  if (PV && !PV.length) delete C.pelvis_m;
  const legLen = D.thigh + D.shank, notes = [], reach = [], keyTimes = [...new Set(poses.map((p) => p.t))].sort((a, b) => a - b);
  // a value is relaxed (its default) until the pose before the first one that sets it, then eases into it
  const num = (name, t, dflt) => {
    const list = C[name]?.filter((k) => typeof k.v === 'number');
    if (!list?.length) return dflt;
    if (t < list[0].t) {
      const prev = keyTimes.filter((k) => k < list[0].t).pop();
      if (prev == null) return list[0].v;
      return t <= prev ? dflt : dflt + (list[0].v - dflt) * ease((t - prev) / (list[0].t - prev));
    }
    return smooth(list, t);
  };
  const stand0 = footPose(D, [0, D.plat, 0], [0, 1], D.pitch), ankleRest = stand0.ankle[1];
  if (!C['feet.left.at'] || !C['feet.right.at']) notes.push('a foot has no position in any pose: it is kept under the hip and moves with the body');

  // a foot resting on its own patch of ground, tilted with it (an ankle rolls about 20° at most), lifted by `lift`
  function onGround(p, lift) {
    let q = p;
    if (TR) {
      const n = normalAt(p.platBall[0], p.platBall[2]), axis = cross([0, 1, 0], n), sa = len(axis);
      if (sa > 1e-6) {
        const th = Math.min(Math.asin(clamp(sa, 0, 1)), 20 * RAD), k = mul(axis, 1 / sa), o = p.platBall;
        const rot = (v) => { const r = sub(v, o), c = Math.cos(th), s = Math.sin(th); return add(o, add(add(mul(r, c), mul(cross(k, r), s)), mul(k, dot(k, r) * (1 - c)))); };
        q = {}; for (const key of Object.keys(p)) q[key] = rot(p[key]);
      }
    }
    let gap = Infinity;
    for (const key of ['heelTip', 'platBall', 'platToe', 'heelSole']) gap = Math.min(gap, q[key][1] - gh(q[key][0], q[key][2]));
    return moveFoot(q, [0, -gap + lift, 0]);
  }

  // a foot: where Claude put it, stepping in an arc between keys unless the later key says it slides there
  function foot(side, t, body) {
    const name = side === 'l' ? 'left' : 'right', sg = side === 'l' ? 1 : -1;
    const atList = C[`feet.${name}.at`];
    let at, moving = false, sliding = false, arc = 0, slideFrom = null;
    if (atList) {
      at = stepwise(atList, t);
      const [a, b] = around(atList, t);
      if (a && b) {
        const dist = Math.hypot(b.v[0] - a.v[0], b.v[1] - a.v[1]), u = (t - a.t) / (b.t - a.t || 1);
        moving = dist > 0.02 && u > 0 && u < 1;
        sliding = moving && poses[b.key]?.feet?.[name]?.slide === true;
        if (moving && !sliding && !C[`feet.${name}.lift_m`]?.some((k) => k.t > a.t && k.t < b.t)) arc = clamp(0.25 * dist + 0.04, 0.05, 0.15) * Math.sin(Math.PI * u);
        if (sliding) slideFrom = [a.v[0], gh(a.v[0], a.v[1]) + 0.004, a.v[1]];
      }
    } else {
      const lf = leftOf(body.az), f = dirOf(body.az);
      at = [body.at[0] + lf[0] * sg * 0.1 + f[0] * 0.06, body.at[1] + lf[2] * sg * 0.1 + f[1] * 0.06];
    }
    const lift = Math.max(0, num(`feet.${name}.lift_m`, t, REST.feet.lift_m)) + arc;
    const out = num(`feet.${name}.out_deg`, t, REST.feet.out_deg), pitch = num(`feet.${name}.pitch_deg`, t, REST.feet.pitch_deg);
    const az = body.az - sg * out * RAD;
    const p = onGround(footPose(D, [at[0], gh(at[0], at[1]) + D.plat, at[1]], dirOf(az), D.pitch + pitch * RAD), lift);
    return { pose: p, az, lift, contact: lift > 0.015 ? 'swing' : sliding ? 'slide' : 'stance', slideFrom };
  }

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    const at = smooth(C.at, t) ?? [0, 4], az = num('facing_deg', t, 180) * RAD;
    const f = dirOf(az), fwd = [f[0], 0, f[1]], lf = leftOf(az), up = [0, 1, 0];
    const body = { at, az };
    const feet = { l: foot('l', t, body), r: foot('r', t, body) };
    const g0 = gh(at[0], at[1]);
    // the pelvis: as Claude set it, or (if no pose gives it) as high as the planted legs reach with soft knees
    let pelvisY;
    const hipAt = (y, sd) => add([at[0], y, at[1]], mul(lf, (sd === 'l' ? 1 : -1) * D.hipW / 2));
    // auto: as high as the planted legs reach with soft knees (where no pose sets pelvis_m)
    {
      pelvisY = Infinity;
      for (const sd of ['l', 'r']) {
        if (feet[sd].contact === 'swing') continue;
        const an = feet[sd].pose.ankle, h = hipAt(0, sd), dxz = Math.hypot(h[0] - an[0], h[2] - an[2]), L = 0.985 * legLen;
        pelvisY = Math.min(pelvisY, an[1] + Math.sqrt(Math.max(0, L * L - dxz * dxz)));
      }
      if (!Number.isFinite(pelvisY)) pelvisY = g0 + ankleRest + 0.97 * legLen;
    }
    // set: pelvis_m holds from the pose that gives it until a later pose sets it again, or sets "auto" to hand the
    // height back to the legs; into the first one it eases from auto over the stretch from the pose before
    if (PV?.length) {
      let w;
      if (t < PL[0].t) { const prev = keyTimes.filter((k) => k < PL[0].t).pop(); w = PL[0].v === 'auto' ? 0 : prev == null ? 1 : ease((t - prev) / (PL[0].t - prev)); }
      else w = stepwise(PL.map((k) => ({ t: k.t, v: k.v === 'auto' ? 0 : 1 })), t);
      if (w > 0) pelvisY += (g0 + smooth(PV, t) - pelvisY) * w;
    }
    const P = [at[0], pelvisY, at[1]];
    const hip_l = hipAt(pelvisY, 'l'), hip_r = hipAt(pelvisY, 'r');
    // the trunk: pitched forward, rolled to her left, the shoulders twisted to her left
    const pitch = num('trunk.pitch_deg', t, REST.trunk.pitch_deg) * RAD, roll = num('trunk.roll_deg', t, 0) * RAD, twist = num('trunk.twist_deg', t, 0) * RAD;
    let T = add(mul(up, Math.cos(pitch)), mul(fwd, Math.sin(pitch)));
    T = norm(add(mul(T, Math.cos(roll)), mul(lf, Math.sin(roll))));
    const Ft0 = norm(sub(add(mul(fwd, Math.cos(pitch)), mul(up, -Math.sin(pitch))), mul(T, dot(add(mul(fwd, Math.cos(pitch)), mul(up, -Math.sin(pitch))), T))));
    const Lt0 = norm(cross(Ft0, T));
    const Fs = norm(add(mul(Ft0, Math.cos(twist)), mul(Lt0, Math.sin(twist)))), Ls = norm(sub(mul(Lt0, Math.cos(twist)), mul(Ft0, Math.sin(twist))));
    const nodes = { hip_l, hip_r, waist: add(P, mul(T, 0.04 * D.H)), spine: add(P, mul(T, 0.5 * D.trunk)) };
    const SC = add(P, mul(T, D.trunk));
    nodes.neck = add(P, mul(T, D.trunk + 0.012 * D.H));
    nodes.shoulder_l = add(SC, mul(Ls, D.shoulderW / 2));
    nodes.shoulder_r = add(SC, mul(Ls, -D.shoulderW / 2));
    const hp = num('head.pitch_deg', t, REST.head.pitch_deg) * RAD, ht = num('head.turn_deg', t, 0) * RAD;
    nodes.head = add(nodes.neck, mul(norm(add(mul(T, Math.cos(hp * 0.6)), mul(Fs, Math.sin(hp * 0.6)))), D.headUp));
    const face0 = add(mul(Fs, Math.cos(ht)), mul(Ls, Math.sin(ht))), face = norm(sub(mul(face0, Math.cos(hp)), mul(T, Math.sin(hp))));
    const shoe = {}, contact = {};
    // legs: the knee solved between the hip and where the foot is; a leg too short for its foot pulls the foot up
    for (const sd of ['l', 'r']) {
      const ft = feet[sd], hip = sd === 'l' ? hip_l : hip_r;
      let p = ft.pose;
      const gap = len(sub(p.ankle, hip)) - 0.999 * legLen;
      if (gap > 0.005) { p = moveFoot(p, mul(norm(sub(hip, p.ankle)), gap)); if (ft.contact !== 'swing') reach.push({ t, limb: `${sd === 'l' ? 'left' : 'right'} leg`, short_m: Math.round(gap * 100) / 100 }); }
      const fd = dirOf(ft.az);
      nodes[`knee_${sd}`] = solveKnee(hip, p.ankle, D.thigh, D.shank, norm([fd[0], 0.15, fd[1]]));
      for (const k of ['ankle', 'heel', 'ball', 'toe']) nodes[`${k}_${sd}`] = p[k];
      shoe[sd] = { heelSole: p.heelSole, heelTip: p.heelTip, platBall: p.platBall, platToe: p.platToe, ...(ft.slideFrom && ft.contact === 'slide' ? { slideFrom: ft.slideFrom } : {}) };
      contact[sd] = gap > 0.03 && ft.contact !== 'swing' ? 'swing' : ft.contact;
      const kn = nodes[`knee_${sd}`];
      contact[`knee_${sd}`] = kn[1] - gh(kn[0], kn[2]) < 0.08 ? 'ground' : 'air'; // the joint's centre sits about 5 cm up when kneeling
    }
    // arms: held as Claude set them; a hand put on the ground is reached for with the elbow out and back
    for (const sd of ['l', 'r']) {
      const name = sd === 'l' ? 'left' : 'right', sg = sd === 'l' ? 1 : -1, S = nodes[`shoulder_${sd}`];
      const raise = num(`arms.${name}.raise_deg`, t, REST.arms.raise_deg) * RAD, out = num(`arms.${name}.out_deg`, t, REST.arms.out_deg) * RAD, el = num(`arms.${name}.elbow_deg`, t, REST.arms.elbow_deg) * RAD;
      const dirH = add(mul(Fs, Math.cos(out)), mul(Ls, sg * Math.sin(out)));
      const upper = norm(add(mul(T, -Math.cos(raise)), mul(dirH, Math.sin(raise))));
      let perp = sub(Fs, mul(upper, dot(Fs, upper)));
      if (len(perp) < 0.2) perp = sub(T, mul(upper, dot(T, upper)));
      perp = norm(perp);
      let elbow = add(S, mul(upper, D.upperArm)), wrist = add(elbow, mul(norm(add(mul(upper, Math.cos(el)), mul(perp, Math.sin(el)))), D.forearm));
      let hand = add(wrist, mul(norm(sub(wrist, elbow)), 0.75 * D.hand));
      // hands.<side>.on: [x, z] pressed on the ground; keys that hold the arm without it lift the hand away again
      const onList = C[`hands.${name}.on`];
      let w = 0;
      if (onList) {
        const marks = [...onList.map((k) => ({ t: k.t, v: 1 })), ...Object.entries(C).filter(([k]) => k.startsWith(`arms.${name}.`)).flatMap(([, l]) => l.filter((k) => !poses[k.key]?.hands?.[name]?.on).map((k) => ({ t: k.t, v: 0 })))].sort((p, q) => p.t - q.t);
        w = stepwise(marks, t);
        if (w > 0) {
          const on = stepwise(onList, t), gp = [on[0], gh(on[0], on[1]) + 0.045, on[1]];
          const target = add(mul(wrist, 1 - w), mul(gp, w)), d = len(sub(target, S)), maxR = 0.995 * (D.upperArm + D.forearm);
          const wt = d > maxR ? add(S, mul(norm(sub(target, S)), maxR)) : target;
          if (d > maxR && w > 0.9) reach.push({ t, limb: `${name} arm`, short_m: Math.round((d - maxR) * 100) / 100 });
          elbow = solveKnee(S, wt, D.upperArm, D.forearm, norm(add(add(mul(Fs, -0.5), mul(Ls, sg * 0.8)), mul(T, 0.2))));
          wrist = wt;
          const flat = norm([Fs[0], 0, Fs[2]].map((x, k) => x + 1e-6 * k)), drop = norm(sub(wrist, elbow));
          hand = add(wrist, mul(norm(add(mul(drop, 1 - w), mul(flat, w))), 0.75 * D.hand));
        }
      }
      nodes[`elbow_${sd}`] = elbow; nodes[`wrist_${sd}`] = wrist; nodes[`hand_${sd}`] = hand;
      contact[`hand_${sd}`] = hand[1] - gh(hand[0], hand[2]) < 0.08 ? 'ground' : 'air';
    }
    frames.push({ t, nodes, shoe, contact, facing_deg: az / RAD, head_deg: Math.atan2(face[0], face[2]) / RAD });
  }
  // say each unreachable limb once per stretch, not once per frame
  const spans = [];
  for (const r of reach) { const s = spans.find((q) => q.limb === r.limb && r.t - q.to <= 1.5 / fps); if (s) { s.to = r.t; s.short_m = Math.max(s.short_m, r.short_m); } else spans.push({ limb: r.limb, from: r.t, to: r.t, short_m: r.short_m }); }
  return { frames, dims: D, notes, reach: spans.map((s) => ({ ...s, from: Math.round(s.from * 100) / 100, to: Math.round(s.to * 100) / 100 })) };
}

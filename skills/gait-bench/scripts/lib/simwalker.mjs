// simwalker.mjs — a walker that balances. Ported from the owner's ice-walk simulation (dev/reference/ice-walk-sim,
// sim.js) and fitted to Gait Bench's figure, footwear, terrain and scenes. The kinematic walker (walker.mjs) plants
// each foot on a schedule and carries the body along a steady stroll; this one moves the body as an inverted pendulum
// over its feet and puts each foot where balance needs it (the capture point), so stepping, sway, slips and the
// scramble to recover come from the physics, not from a timer:
//   - the body (centre of mass at hip height) accelerates away from the centre of pressure under the loaded feet;
//   - each foot moves its centre of pressure toward where the body is heading, but only within the shoe: a high heel
//     leaves a short, narrow patch to press, so less of the balancing can be done at the ankle;
//   - a foot breaks loose when the friction the body asks of it exceeds the ground's, shoots out, and re-grips when it
//     slows; meanwhile the body gets only kinetic friction, and the hips drop as the legs split;
//   - caution rises after a slip and ebbs back, setting the stride; a small random sway; a reaction delay before a
//     quick catching step; arms and trunk respond to how far the body is off balance (the "alarm").
// The reasoned scene steers it: the path sets the heading, the cap/sim mix blends the scene's speed and cadence with
// the cautious walker's own, and slips read off the footage are started as real slides. Deterministic per scene.
// Pure JavaScript; the walker's own pieces (body sizes, the foot in its shoe, the knee) are passed in.

import { vec, makePath } from './scene.mjs';
import { terrainOf } from './terrain.mjs';
import { surfaceMu } from './physics.mjs';

const { add, sub, mul, dot, norm, len } = vec;
const G = 9.81, RAD = Math.PI / 180;
// arm poses as the sim's angles (radians): forward swing, abduction, elbow flexion
const ARM_ANGLES = { hang: [0.02, 0.1, 0.15], swing: [0.05, 0.12, 0.25], bag: [0, 0.18, 0.15], hip: [-0.1, 0.55, 1.5], balance: [0.38, 0.8, 0.66], catch: [0.56, 1.43, 0.42] };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), ss = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const dirOf = (az) => [Math.sin(az), Math.cos(az)];
const leftOf = (az) => [-Math.cos(az), 0, Math.sin(az)];
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seedOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * The scene's walk, simulated. helpers = { bodyDims, footPose, solveKnee, balanceOf } from walker.mjs.
 * Returns the walker's motion format: { frames, dims, steps, notes, stats, sim: {slips, catches, minMargin} }.
 */
export function simulate(scene, helpers) {
  const { bodyDims, footPose, solveKnee, balanceOf, reference } = helpers;
  const D = bodyDims(scene.figure), a = scene.activity, fps = scene.output.fps;
  const N = Math.max(2, Math.round(scene.duration_s * fps)), dt = 1 / 240, sub_ = Math.max(1, Math.round(1 / fps / dt));
  const mix = clamp(a.mix ?? 1, 0, 1), rnd = mulberry32(seedOf(scene.id ?? 'scene') ^ 0x9e3779b9);
  const TR = terrainOf(scene), gh = (x, z) => (TR ? TR.height(x, z) : 0);
  const normalAt = (x, z) => { const e = 0.05; return norm([-(gh(x + e, z) - gh(x - e, z)) / (2 * e), 1, -(gh(x, z + e) - gh(x, z - e)) / (2 * e)]); };
  const L = D.thigh + D.shank, k = L / 0.9; // the sim's lengths were for 0.9 m legs: scaled to this person
  const flat0 = footPose(D, [0, D.plat, 0], [0, 1], D.pitch), ankleH = flat0.ankle[1] - flat0.lowest, a0 = flat0.ankle[2];
  const hipW = D.hipW / 2;
  // the ground's grip: the surface's friction, varied ±30% from place to place (value noise, fixed per scene)
  const mu0 = surfaceMu(scene), NG = 24, ng = Array.from({ length: NG * NG }, () => rnd());
  const vn = (x, z) => { const gx = x / 0.7, gz = z / 0.7, i0 = Math.floor(gx), j0 = Math.floor(gz), fx = ss(gx - i0), fz = ss(gz - j0), g = (i, j) => ng[(((j % NG) + NG) % NG) * NG + (((i % NG) + NG) % NG)]; return (g(i0, j0) * (1 - fx) + g(i0 + 1, j0) * fx) * (1 - fz) + (g(i0, j0 + 1) * (1 - fx) + g(i0 + 1, j0 + 1) * fx) * fz; };
  // cap trusts the footage, sim the ground: where nothing was seen to slip, the grip evidently held, so below mix 1
  // a foot needs more than the surface's own friction to break loose by itself (seen slips still happen in full)
  const trust = 1 + 3 * (1 - mix);
  const muAt = (x, z) => mu0 * (0.7 + 0.6 * vn(x, z)) * trust;
  const sl = clamp(1 - (mu0 - 0.04) / 0.46, 0, 1); // the sim's slipperiness, from the ground's friction
  // how much of the balancing the shoe leaves to the ankle: a heel shrinks the patch the pressure can move in
  const heelness = clamp((D.heel - 0.03) / 0.12, 0, 1), copF = [-0.05 * k * (1 - 0.5 * heelness), 0.12 * k * (1 - 0.35 * heelness)], copL = 0.04 * k * (1 - 0.6 * heelness);
  const B = balanceOf(scene, D).demand; // arms held out at rest when the ankles can't balance (heels, ice, a slope)

  // the reasoned path steers; the scene's speed and cadence are the "cap" gait, the cautious walker's the "sim" gait
  const path = makePath(a.path), capV = a.speed_mps, capT = 60 / a.cadence_spm;
  const pathAt = (x, z) => { // the nearest point on the path, its heading, and how far left of it (x, z) is
    let best = null;
    for (let i = 1; i < a.path.length; i++) {
      const p = a.path[i - 1], q = a.path[i], dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz || 1e-9;
      const u = clamp(((x - p[0]) * dx + (z - p[1]) * dz) / L2, 0, 1), px = p[0] + u * dx, pz = p[1] + u * dz, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) { const az = Math.atan2(dx, dz), lf = leftOf(az); best = { d, az, left: (x - px) * lf[0] + (z - pz) * lf[2], end: i === a.path.length - 1 && u >= 1 }; }
    }
    return best;
  };
  const start = path.at(0), az0 = Math.atan2(start.dir[0], start.dir[1]);
  // where the reasoned walk puts the body (the kinematic walker's waist), to draw the body toward below mix 1
  const ref = reference ? reference(scene).frames.map((f) => ({ t: f.t, p: [f.nodes.waist[0], f.nodes.waist[2]] })) : null;
  const refAt = (t) => { if (!ref) return null; const x = clamp(t * fps, 0, ref.length - 1), i = Math.min(ref.length - 2, Math.floor(x)), u = x - i; return [ref[i].p[0] + (ref[i + 1].p[0] - ref[i].p[0]) * u, ref[i].p[1] + (ref[i + 1].p[1] - ref[i].p[1]) * u]; };
  const refVel = (t) => { const a1 = refAt(t - 0.25), b1 = refAt(t + 0.25); return a1 && [(b1[0] - a1[0]) / 0.5, (b1[1] - a1[1]) / 0.5]; };

  // state
  const S = { C: [a.path[0][0], a.path[0][1]], V: [start.dir[0] * capV, start.dir[1] * capV], hipY: ankleH + 0.95 * L, az: az0, caution: clamp(0.4 + 0.4 * sl + 0.3 * heelness * sl, 0, 1), alarm: 0, nx: 0, nz: 0, gp: 'double', gt: 0, Ts: 0.5, Td: 0.15, from: 1, to: 0, st: 0, sw: 1, slips: 0, catches: 0, time: 0, minMargin: Infinity, assisted: 0, A: 0 };
  const P = { pitch: 0.1, roll: 0, aPL: 0.1, aAL: 0.3, elL: 0.4, aPR: 0.1, aAR: 0.3, elR: 0.4, hp: 0.2 }, Pv = Object.fromEntries(Object.keys(P).map((x) => [x, 0]));
  const spring = (keys, T, kk, z) => { const d = 2 * Math.sqrt(kk) * z; for (const key of keys) { Pv[key] += (kk * (T[key] - P[key]) - d * Pv[key]) * dt; P[key] += Pv[key] * dt; } };
  const first = a.start_foot === 'left' ? 0 : 1; // feet[0] is the left (side +1), feet[1] the right
  const mkFoot = (side, along) => { const lf = leftOf(az0), x = S.C[0] + lf[0] * side * (hipW + 0.01) + start.dir[0] * along, z = S.C[1] + lf[2] * side * (hipW + 0.01) + start.dir[1] * along; return { x, z, side, planted: true, slide: false, vx: 0, vz: 0, sx: x, sz: z, tx: x, tz: z, az: az0, lift: 0 }; };
  const F = [mkFoot(1, first === 0 ? 0.08 * k : -0.08 * k), mkFoot(-1, first === 1 ? 0.08 * k : -0.08 * k)];
  S.from = first === 0 ? 1 : 0; S.to = first; // weight moving onto the leading foot
  const toeOut = (Number.isFinite(a.toe_out_deg) ? a.toe_out_deg : 6 + 14 * (B > 0.3 ? B : 0)) * RAD;

  // slips read off the footage: started as real slides of that foot, the physics does the rest
  const forced = (a.slips ?? []).filter((q) => q.kind !== 'glide').map((q) => ({ ...q, i: /^l/i.test(String(q.foot)) ? 0 : 1, done: false }));
  const frame = () => { const d = dirOf(S.az), l = leftOf(S.az); return { fx: d[0], fz: d[1], lx: l[0], lz: l[2] }; };
  const loads = () => { const ld = [0, 0]; if (S.gp === 'single') ld[S.st] = 1; else { const u = ss(S.gt / S.Td); ld[S.from] = 1 - u; ld[S.to] = u; } return ld; };
  const support = (load, fr) => {
    let sx = 0, sz = 0, ws = 0; const cops = [];
    const w = Math.sqrt(G / (S.hipY - ankleH * 0.5)), off = clamp((S.bxn || 0) + 0.12 * ((S.vd || 0) - (S.V[0] * fr.fx + S.V[1] * fr.fz)), 0, 0.1 * k);
    for (let i = 0; i < 2; i++) {
      const f = F[i];
      if (!f.planted || load[i] <= 0.001) { cops.push(null); continue; }
      const dx = S.C[0] + S.V[0] / w - fr.fx * off - f.x, dz = S.C[1] + S.V[1] / w - fr.fz * off - f.z;
      const df = clamp(dx * fr.fx + dz * fr.fz, copF[0], copF[1]), dl = clamp(dx * fr.lx + dz * fr.lz, -copL, copL);
      const c = [f.x + fr.fx * df + fr.lx * dl, f.z + fr.fz * df + fr.lz * dl];
      cops.push(c); sx += c[0] * load[i]; sz += c[1] * load[i]; ws += load[i];
    }
    return { cops, sx: sx / (ws || 1), sz: sz / (ws || 1) };
  };

  function step() {
    S.time += dt;
    const c = S.caution, fr = frame();
    S.caution += (0.05 + 0.3 * sl + 0.55 * heelness * sl - S.caution) * dt * 0.08; // in high heels on slippery ground, caution never ebbs far S.caution = clamp(S.caution, 0, 1);
    // the gait: the cautious walker's (stride from perceived grip) blended with the scene's own by the mix
    const muP = mu0 * (1.3 - 0.6 * c), rT = muP * 0.5;
    const simTs = 0.36 + 0.24 * c, simTd = 0.08 + 0.1 * c, simLen = clamp(0.1 + 3.2 * rT, 0.1, 0.48) * k;
    const capLen = (capV * capT * 2) / 2, Ts = capT * 0.8 + (simTs - capT * 0.8) * mix, Td = capT * 0.2 + (simTd - capT * 0.2) * mix;
    const stepLen = capLen + (simLen - capLen) * mix, vd = (S.vd = stepLen / (Ts + Td));
    const h = S.hipY - ankleH * 0.5, w = Math.sqrt(G / h);
    S.bxn = stepLen / (Math.exp(w * (Ts + Td)) - 1);
    // a slip seen in the footage: that foot breaks loose now, along the way it was seen to go
    for (const q of forced) {
      if (q.done || S.time < q.from_s) continue;
      q.done = true; const f = F[q.i];
      if (!f.planted) continue;
      const qa = q.world_dir ? Math.atan2(q.world_dir[0], q.world_dir[1]) : S.az + (q.dir_deg ?? 180) * RAD, dv = dirOf(qa), v0 = (2 * (q.distance_m ?? 0.15)) / Math.max(0.15, (q.to_s ?? q.from_s + 0.3) - q.from_s);
      f.slide = true; f.counted = false; f.slideT = S.time; f.vx = dv[0] * v0; f.vz = dv[1] * v0; S.slips++; S.caution = Math.min(1, S.caution + 0.35);
    }
    const load = loads(), sup = support(load, fr);
    let ax = 0, az = 0, minReach = 9, maxSlide = 0;
    for (let i = 0; i < 2; i++) {
      const f = F[i], cp = sup.cops[i];
      if (!cp) continue;
      const dx = S.C[0] - cp[0], dz = S.C[1] - cp[1], d = Math.hypot(dx, dz) + 1e-6, ms = muAt(f.x, f.z), mk = 0.75 * ms;
      // the friction the foot must find: the body's push (CoM off the centre of pressure), plus, on a slope, holding
      // against gravity along it (tan of the slope, uphill): a cross-slope alone asks 0.32 at 18°
      const e = 0.08, gx = (gh(f.x + e, f.z) - gh(f.x - e, f.z)) / (2 * e), gz = (gh(f.x, f.z + e) - gh(f.x, f.z - e)) / (2 * e);
      const qx = dx / h + gx, qz = dz / h + gz, r = Math.hypot(qx, qz) + 1e-9;
      if (!f.slide && r > ms && load[i] > 0.25) { f.slide = true; f.counted = false; f.slideT = S.time; S.caution = Math.min(1, S.caution + 0.08); }
      let sc = 1;
      if (f.slide) {
        sc = Math.min(1, mk / Math.max(r, d / h + 1e-9));
        const push = load[i] * G * (r - mk) * 5, ux = -qx / r, uz = -qz / r; // away from the body, and downhill
        if (push > 0) { f.vx += ux * push * dt; f.vz += uz * push * dt; }
        const sp = Math.hypot(f.vx, f.vz), dec = (push < 0 ? -push : 0) + mk * G * 0.15;
        if (sp > 0) { const ns = Math.max(0, sp - dec * dt); f.vx *= ns / sp; f.vz *= ns / sp; }
        f.x += f.vx * dt; f.z += f.vz * dt; maxSlide = Math.max(maxSlide, sp);
        if (!f.counted && sp > 0.2) { f.counted = true; S.slips++; S.caution = Math.min(1, S.caution + 0.35); }
        if (sp < 0.025 && r < ms) { f.slide = false; f.vx = f.vz = 0; }
      }
      ax += (load[i] * G / h) * dx * sc; az += (load[i] * G / h) * dz * sc;
      const fd = Math.hypot(S.C[0] - f.x, S.C[1] - f.z);
      if (load[i] > 0.15) minReach = Math.min(minReach, ankleH + Math.sqrt(Math.max(0, (L * 0.995) ** 2 - fd * fd)));
    }
    // steering: turn toward the path, and back onto it (the scene's path is where she was seen to go)
    const pa = pathAt(S.C[0], S.C[1]);
    if (pa) {
      let dAz = pa.az + clamp(0.9 * pa.left, -0.5, 0.5) - S.az; // left of the path: turn right (toward +az)
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      S.az += dAz * Math.min(1, dt * 1.2);
      if (pa.end) S.stop = true;
    }
    // postural sway: a little random acceleration, as in standing still
    S.nx = S.nx * (1 - dt * 2.5) + (rnd() - 0.5) * Math.sqrt(dt) * 0.8; S.nz = S.nz * (1 - dt * 2.5) + (rnd() - 0.5) * Math.sqrt(dt) * 0.8;
    // drawn toward the reasoned walk (where and when she was seen), the more the lower the mix
    const rp = refAt(S.time), rv = refVel(S.time), kt = (1 - mix) * 9, kv = (1 - mix) * 6;
    if (rp) { ax += kt * (rp[0] - S.C[0]) + kv * (rv[0] - S.V[0]); az += kt * (rp[1] - S.C[1]) + kv * (rv[1] - S.V[1]); }
    S.V[0] += (ax + S.nx) * dt; S.V[1] += (az + S.nz) * dt; S.C[0] += S.V[0] * dt; S.C[1] += S.V[1] * dt;
    const bob = S.gp === 'double' ? 1 : Math.sin(Math.PI * clamp(S.gt / S.Ts, 0, 1));
    const Hn = ankleH + L * (0.985 - 0.065 * c - 0.016 * (1 - bob) - 0.05 * B);
    S.hipY = Math.min(S.hipY + (Hn - S.hipY) * Math.min(1, dt * 10), minReach);

    if (S.gp === 'single') {
      const sw = F[S.sw], st = F[S.st]; S.gt += dt;
      if (st.slide && S.time - st.slideT > 0.15) S.Ts = Math.min(S.Ts, S.gt + 0.15); // reaction: a quick step to catch the slide
      { const ex = S.C[0] + S.V[0] / w - st.x, ez = S.C[1] + S.V[1] / w - st.z, ef = ex * fr.fx + ez * fr.fz, el = Math.abs(ex * fr.lx + ez * fr.lz); if ((ef > 0.14 * k + stepLen || el > 0.09 * k) && S.gt > 0.08 && S.Ts > S.gt + 0.12) { if (S.Ts - S.gt - 0.12 > 0.1) S.catches++; S.Ts = S.gt + 0.12; } } // counted when it cuts the step clearly short
      const u = Math.min(1, S.gt / S.Ts);
      if (u < 0.85) { // aim the swinging foot at the capture point at touchdown, plus the steady-state offsets
        const tRem = Math.max(0, S.Ts - S.gt), cp = sup.cops[S.st] || [st.x, st.z];
        const e0 = Math.exp(w * (tRem + Td * 0.6)), xx = S.C[0] + S.V[0] / w, xz = S.C[1] + S.V[1] / w;
        const dx_ = cp[0] + (xx - cp[0]) * e0, dz_ = cp[1] + (xz - cp[1]) * e0;
        const eT = Math.exp(w * (Ts + Td)), Wd = (0.17 + 0.08 * c + 0.1 * B) * k + Math.max(0, (a.step_width_m ?? 0) - 0.17 * k) * (1 - mix);
        const bx = stepLen / (eT - 1) - clamp(0.2 * (S.V[0] * fr.fx + S.V[1] * fr.fz - vd), -0.05, 0.08), bw = Wd / (eT + 1);
        let tx = dx_ - fr.fx * bx + fr.lx * sw.side * (bw + 0.03 * k), tz = dz_ - fr.fz * bx + fr.lz * sw.side * (bw + 0.03 * k);
        let ex = tx - st.x, ez = tz - st.z; const lat = (ex * fr.lx + ez * fr.lz) * sw.side;
        if (lat < 0.1 * k) { tx += fr.lx * sw.side * (0.1 * k - lat); tz += fr.lz * sw.side * (0.1 * k - lat); }
        ex = tx - st.x; ez = tz - st.z; const dd = Math.hypot(ex, ez); if (dd > 0.62 * k) { tx = st.x + (ex / dd) * 0.62 * k; tz = st.z + (ez / dd) * 0.62 * k; }
        sw.tx = tx; sw.tz = tz; sw.taz = S.az - sw.side * toeOut;
      }
      const kk = ss(u); sw.x = sw.sx + (sw.tx - sw.sx) * kk; sw.z = sw.sz + (sw.tz - sw.sz) * kk; sw.az = sw.saz + (((sw.taz ?? sw.saz) - sw.saz) * kk); sw.lift = (0.03 + 0.035 * (1 - c)) * k * Math.sin(Math.PI * u);
      if (u >= 1) { sw.planted = true; sw.lift = 0; sw.slide = false; sw.vx = sw.vz = 0; S.gp = 'double'; S.gt = 0; S.from = S.st; S.to = S.sw; S.Td = Td; }
    } else {
      S.gt += dt;
      if (S.gt >= S.Td && !S.stop) { S.st = S.to; S.sw = S.from; const f = F[S.sw]; f.planted = false; f.slide = false; f.vx = f.vz = 0; f.sx = f.x; f.sz = f.z; f.saz = f.az; f.tx = f.x; f.tz = f.z; S.gp = 'single'; S.gt = 0; S.Ts = Ts; }
    }
    // a person seen not to fall is held up: past the edge of the base, the body is drawn back over it (noted)
    const ld = loads(), sup2 = support(ld, fr), dSup = Math.hypot(S.C[0] - sup2.sx, S.C[1] - sup2.sz);
    S.minMargin = Math.min(S.minMargin, 0.42 * k - dSup);
    if (dSup > 0.38 * k) { const pull = (dSup - 0.38 * k) / dSup; S.C[0] -= (S.C[0] - sup2.sx) * pull; S.C[1] -= (S.C[1] - sup2.sz) * pull; S.V[0] *= 0.9; S.V[1] *= 0.9; S.assisted += dt; }
    if (S.hipY < ankleH + 0.62 * L) { S.hipY = ankleH + 0.62 * L; S.assisted += dt; }
    // the upper body: arms and trunk answer how far the body is off balance (the alarm), arms out at rest by B
    const ex = S.C[0] + S.V[0] / w - sup2.sx, ez = S.C[1] + S.V[1] / w - sup2.sz, efw = ex * fr.fx + ez * fr.fz, elt = ex * fr.lx + ez * fr.lz, em = Math.hypot(efw, elt) + 1e-6;
    const at = clamp((em - 0.07 * k) / (0.18 * k), 0, 1) + Math.min(1, maxSlide * 1.5);
    S.alarm += (at - S.alarm) * Math.min(1, dt * (at > S.alarm ? 14 : 1.6));
    const A = Math.min(1.3, S.alarm), j = S.time;
    const legOff = ((F[0].x - S.C[0]) * fr.fx + (F[0].z - S.C[1]) * fr.fz) - ((F[1].x - S.C[0]) * fr.fx + (F[1].z - S.C[1]) * fr.fz);
    const swing = clamp(legOff * 1.6, -0.5, 0.5) * (1 - Math.min(1, A)) * (1 - 0.6 * B), back = efw < 0 ? 1 : 0;
    const raiseL = (a.arm_raise_deg?.left ?? 0) * RAD, raiseR = (a.arm_raise_deg?.right ?? 0) * RAD;
    const T = {
      pitch: clamp(0.08 + 0.14 * c + 0.1 * B - 1.3 * clamp(efw, -0.3, 0.3), -0.45, 0.75), roll: clamp(-1.3 * elt, -0.5, 0.5),
      aAL: 0.2 + 0.35 * c + 0.45 * B + raiseL + 1.0 * A + 0.6 * A * Math.max(0, elt / em) + 0.25 * A * Math.sin(j * 9.3),
      aAR: 0.2 + 0.35 * c + 0.45 * B + raiseR + 1.0 * A + 0.6 * A * Math.max(0, -elt / em) + 0.25 * A * Math.sin(j * 8.1 + 2),
      aPL: -swing + A * (back ? 1.2 : -0.5) + 0.5 * A * Math.sin(j * 10.7), aPR: swing + A * (back ? 1.2 : -0.5) + 0.5 * A * Math.sin(j * 11.9 + 1),
      elL: 0.35 + 0.3 * c + A * (0.35 + 0.35 * Math.sin(j * 13)), elR: 0.35 + 0.3 * c + A * (0.35 + 0.35 * Math.sin(j * 12 + 1)),
      hp: 0.15 + 0.3 * c + 0.3 * B - 0.8 * P.pitch,
    };
    // timed arm gestures read off the footage (hands by the hips, out for balance…) steer the arms while they last
    for (const g of a.gestures ?? []) {
      const pz = ARM_ANGLES[g.pose]; if (!pz) continue;
      const wg = ss((S.time - g.from_s) / 0.35) * ss((g.to_s - S.time) / 0.35); if (wg <= 0) continue;
      const sd = g.arm === 'left' ? 'L' : 'R';
      T[`aP${sd}`] += (pz[0] - T[`aP${sd}`]) * wg; T[`aA${sd}`] += (pz[1] - T[`aA${sd}`]) * wg; T[`el${sd}`] += (pz[2] - T[`el${sd}`]) * wg;
    }
    spring(['aPL', 'aAL', 'elL', 'aPR', 'aAR', 'elR'], T, 95, 0.4); spring(['pitch', 'roll'], T, 140, 0.65); spring(['hp'], T, 160, 0.8);
    S.maxSlide = maxSlide; S.A = A;
  }

  // the figure for this moment: feet in their shoes on the ground, legs by IK, trunk, head and arms from the angles
  function placeFoot(f) {
    const d = dirOf(f.az), ball = [f.x - d[0] * a0, 0, f.z - d[1] * a0];
    let p = footPose(D, ball, d, D.pitch);
    if (TR) {
      const n = normalAt(p.platBall[0], p.platBall[2]), axis = vec.cross([0, 1, 0], n), sa = len(axis);
      if (sa > 1e-6) { const th = Math.min(Math.asin(clamp(sa, 0, 1)), 20 * RAD), kx = mul(axis, 1 / sa), o = p.platBall; const rot = (v) => { const r = sub(v, o), cc = Math.cos(th), sn = Math.sin(th); return add(o, add(add(mul(r, cc), mul(vec.cross(kx, r), sn)), mul(kx, dot(kx, r) * (1 - cc)))); }; const q = {}; for (const key of Object.keys(p)) q[key] = key === 'lowest' ? p[key] : rot(p[key]); p = q; }
    }
    let gap = Infinity;
    for (const key of ['heelTip', 'platBall', 'platToe', 'heelSole']) gap = Math.min(gap, p[key][1] - gh(p[key][0], p[key][2]));
    const o = {}; for (const key of Object.keys(p)) o[key] = key === 'lowest' ? p[key] - gap + f.lift : [p[key][0], p[key][1] - gap + f.lift, p[key][2]];
    return o;
  }
  const kin = a.knees_in ?? (B > 0.3 ? 0.45 * B : 0);
  function snapshot(t) {
    const fr = frame(), fwd = [fr.fx, 0, fr.fz], left = leftOf(S.az), g0 = (gh(F[0].x, F[0].z) + gh(F[1].x, F[1].z)) / 2;
    const C = [S.C[0], g0 + S.hipY, S.C[1]], up = [0, 1, 0];
    const legOff = ((F[0].x - S.C[0]) * fr.fx + (F[0].z - S.C[1]) * fr.fz) - ((F[1].x - S.C[0]) * fr.fx + (F[1].z - S.C[1]) * fr.fz);
    const rot = clamp(-0.25 * legOff, -0.12, 0.12), pl = [left[0] * Math.cos(rot) + fwd[0] * Math.sin(rot), 0, left[2] * Math.cos(rot) + fwd[2] * Math.sin(rot)];
    const hip_l = add(C, mul(pl, hipW)), hip_r = add(C, mul(pl, -hipW));
    const trunkDir = norm(add(add(mul(up, Math.cos(P.pitch)), mul(fwd, Math.sin(P.pitch))), mul(left, Math.sin(P.roll))));
    const nodes = { hip_l, hip_r, waist: add(C, mul(trunkDir, 0.04 * D.H)), spine: add(C, mul(trunkDir, 0.5 * D.trunk)) };
    const SC = add(C, mul(trunkDir, D.trunk));
    nodes.neck = add(C, mul(trunkDir, D.trunk + 0.012 * D.H));
    nodes.shoulder_l = add(SC, mul(left, D.shoulderW / 2)); nodes.shoulder_r = add(SC, mul(left, -D.shoulderW / 2));
    const hn = P.pitch + P.hp * 0.6; nodes.head = add(nodes.neck, mul(norm(add(mul(up, Math.cos(hn)), mul(fwd, Math.sin(hn)))), D.headUp));
    const shoe = {}, contact = {};
    for (const [i, side] of [[0, 'l'], [1, 'r']]) {
      const f = F[i], p = placeFoot(f), hip = side === 'l' ? hip_l : hip_r, fd = dirOf(f.az), inw = mul(leftOf(f.az), side === 'l' ? -1 : 1);
      let ank = p.ankle; const gap = len(sub(ank, hip)) - (L - 1e-3);
      if (gap > 0) ank = add(ank, mul(norm(sub(hip, ank)), gap)); // never a stretched leg: the foot is drawn up instead
      nodes[`knee_${side}`] = solveKnee(hip, ank, D.thigh, D.shank, norm([fd[0] + kin * inw[0], 0.15, fd[1] + kin * inw[2]]));
      for (const key of ['ankle', 'heel', 'ball', 'toe']) nodes[`${key}_${side}`] = key === 'ankle' ? ank : p[key];
      shoe[side] = { heelSole: p.heelSole, heelTip: p.heelTip, platBall: p.platBall, platToe: p.platToe };
      if (f.slide) shoe[side].slideFrom = [f.slideX ?? f.x, gh(f.x, f.z) + 0.004, f.slideZ ?? f.z];
      contact[side] = f.slide ? 'slide' : f.planted ? 'stance' : 'swing';
    }
    for (const [side, sg] of [['l', 1], ['r', -1]]) {
      const S0 = nodes[`shoulder_${side}`], out = mul(left, sg), ap = side === 'l' ? P.aPL : P.aPR, ab = side === 'l' ? P.aAL : P.aAR, el = side === 'l' ? P.elL : P.elR;
      let u = norm(add(mul([0, -1, 0], Math.cos(ap)), mul(fwd, Math.sin(ap))));
      u = norm(add(mul(u, Math.cos(ab)), mul(out, Math.sin(ab))));
      const perp = norm(sub(fwd, mul(u, dot(fwd, u)))), fdir = norm(add(mul(u, Math.cos(el)), mul(perp, Math.sin(el))));
      const elbow = add(S0, mul(u, D.upperArm)), wrist = add(elbow, mul(fdir, D.forearm));
      nodes[`elbow_${side}`] = elbow; nodes[`wrist_${side}`] = wrist; nodes[`hand_${side}`] = add(wrist, mul(fdir, 0.75 * D.hand));
    }
    return { t, nodes, shoe, contact, facing_deg: S.az / RAD, head_deg: S.az / RAD, alarm: Math.round(S.A * 100) / 100 };
  }

  const frames = [];
  let walked = 0, prev = [...S.C];
  for (let i = 0; i < N; i++) {
    if (i > 0) for (let s = 0; s < sub_; s++) {
      const was = F.map((f) => f.slide);
      step();
      F.forEach((f, q) => { if (f.slide && !was[q]) { f.slideX = f.x; f.slideZ = f.z; } });
    }
    walked += Math.hypot(S.C[0] - prev[0], S.C[1] - prev[1]); prev = [...S.C];
    frames.push(snapshot(i / fps));
  }
  const notes = [`simulated walk (balance demand ${B}, caution from μ ${Math.round(mu0 * 100) / 100}): ${S.slips} slip${S.slips === 1 ? '' : 's'}, ${S.catches} quick catching step${S.catches === 1 ? '' : 's'}`];
  if (S.assisted > 0.05) notes.push(`the body left its base for ${Math.round(S.assisted * 100) / 100} s and was held up (a fall the footage doesn't show): slow the walk, shorten the steps or raise the grip`);
  const avgStep = stepLenOf(frames);
  return { frames, dims: D, steps: [], notes, stats: { step_length_m: avgStep, distance_m: Math.round(walked * 100) / 100, path_length_m: Math.round(path.length * 100) / 100 }, sim: { slips: S.slips, catches: S.catches, assisted_s: Math.round(S.assisted * 100) / 100 } };
}

// the mean distance between successive footfalls, from the frames
function stepLenOf(frames) {
  const lands = [];
  for (let i = 1; i < frames.length; i++) for (const s of ['l', 'r']) if (frames[i].contact[s] === 'stance' && frames[i - 1].contact[s] === 'swing') lands.push(frames[i].nodes[`ankle_${s}`]);
  if (lands.length < 2) return 0;
  let d = 0; for (let i = 1; i < lands.length; i++) d += Math.hypot(lands[i][0] - lands[i - 1][0], lands[i][2] - lands[i - 1][2]);
  return Math.round((d / (lands.length - 1)) * 100) / 100;
}

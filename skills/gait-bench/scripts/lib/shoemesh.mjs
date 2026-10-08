// Library shoes (walkscene.shoe.v1) for the Gait Bench renderer: decode, zone-scale to the scene's measurements,
// pose rigidly on the walker's foot (bending at the ball), and rasterise with a z-buffer and supersampling.
// The geometry comes from real reference photos or licensed models (see the shoe-library skill); nothing here
// invents shape: zone scaling only stretches the traced heel, platform and toe box to the footage's measurements.

const ZONE_HEEL = 3, ZONE_TOE = 1, ZONE_SKIN = 4; // skin: the real foot inside an open shoe
const sstepM = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function bytes(s) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b); }
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** The packed mesh as typed arrays: V metres (x forward, y up, z lateral, a right shoe), F, C rgb, Z zone ids. */
export function decodeShoe(model) {
  const m = model.mesh, vi = new Int16Array(bytes(m['v_int16_0.1mm']).buffer);
  const V = new Float32Array(vi.length); for (let i = 0; i < vi.length; i++) V[i] = vi[i] / 10000;
  const F = m.f_uint16 ? Uint32Array.from(new Uint16Array(bytes(m.f_uint16).buffer)) : new Uint32Array(bytes(m.f_uint32).buffer);
  return { V, F, C: bytes(m.c_rgb8), Z: bytes(m.zone_u8) };
}

const PREP = new WeakMap();
/**
 * Zone scaling: the traced shoe stretched to the scene's measurements. length_cm (default: the shoe's own length)
 * scales it uniformly; heel_cm stretches the heel spike and lifts the rear; platform_cm stretches the platform and
 * lifts the forefoot; the arch between shears smoothly. amplify (default 1) thickens the heel spike and deepens the
 * toe box to make the category read in small figures, without changing heights or contacts.
 */
export function prepareShoe(model, fw = {}) {
  const key = model, hit = PREP.get(key);
  const sig = JSON.stringify([fw.length_cm, fw.heel_cm, fw.platform_cm, fw.amplify, fw.heel_clear]);
  if (hit && hit.sig === sig) return hit;
  const { V: V0, F, C, Z } = decodeShoe(model), lm = model.landmarks;
  const k = fw.length_cm ? fw.length_cm / 100 / model.length_m : 1;
  const xs = lm.seat[0] * k, ys = lm.seat[1] * k, xb = lm.ball_contact[0] * k, p0 = model.platform_m * k;
  const ht = fw.heel_cm != null ? fw.heel_cm / 100 : ys, pt = Math.min(fw.platform_cm != null ? fw.platform_cm / 100 : p0, ht);
  const A = fw.amplify ?? 1, a2 = Math.sqrt(A);
  const base = (x) => (x <= xs ? ys : x >= xb ? p0 : ys + (p0 - ys) * (x - xs) / (xb - xs));      // the bottom line, as traced
  const goal = (x) => (x <= xs ? ht : x >= xb ? pt : ht + (pt - ht) * (x - xs) / (xb - xs));      // ... and as wanted
  const V = new Float32Array(V0.length);
  // the heel spike's axis, for amplify: tip to seat, at the mean lateral position of the heel zone
  let hz = 0, hn = 0;
  for (let i = 0; i < Z.length; i++) if (Z[i] === ZONE_HEEL) { hz += V0[i * 3 + 2] * k; hn++; }
  hz = hn ? hz / hn : 0;
  const xt = lm.heel_tip[0] * k;
  for (let i = 0; i < Z.length; i++) {
    let x = V0[i * 3] * k, y = V0[i * 3 + 1] * k, z = V0[i * 3 + 2] * k;
    if (Z[i] === ZONE_HEEL) {
      const ax = xt + (xs - xt) * Math.min(1, y / Math.max(ys, 1e-6));
      x = ax + (x - ax) * A; z = hz + (z - hz) * A;
      y = y * (ht / Math.max(ys, 1e-6));
    } else {
      const b = base(x), g = goal(x);
      y = y < b ? y * (g / Math.max(b, 1e-6)) : y + (g - b);
      if (Z[i] === ZONE_TOE && A !== 1) y = pt + (y - pt) * a2;
    }
    V[i * 3] = x; V[i * 3 + 1] = y; V[i * 3 + 2] = z;
  }
  const Lhb = Math.hypot(xb - xs, ht - pt);
  const out = {
    sig, V, F, C, Z, n: Z.length, clear: !!(fw.heel_clear ?? model.heel_clear), clearTint: !!fw.heel_clear && !model.heel_clear,
    seat: [xs, ht], ball: [xb, 0], toe: [lm.toe_contact[0] * k, 0], heelTip: [xt, 0], length: model.length_m * k,
    // the foot inside: its heel bone sits against the back of the heel counter (half a centimetre of padding) and the
    // back of the heel to the first metatarsal head is about 0.72 of foot length
    heel: ht, plat: pt, Lhb, footLen: Math.hypot(xb - ((lm.heel_back?.[0] ?? lm.seat[0] - 0.03) + 0.005) * k, ht - pt) / 0.72, category: model.category,
  };
  PREP.set(key, out);
  return out;
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * World vertices for one foot. The shoe's seat goes on the walker's heelSole and its seat-to-ball line along
 * heelSole-to-platBall; the forefoot bends about the ball contact to follow platBall-to-platToe, unless the platform is
 * thicker than 2.5 cm (a rigid block). Left feet mirror z.
 * right = the figure's right, e.g. hip_r - hip_l.
 */
export function poseShoe(P, sh, sd, right, out) {
  const e1 = norm3(sub3(sh.platBall, sh.heelSole));
  let r = sub3(right, e1.map((c) => c * dot3(right, e1))); r = norm3(r);
  let up = norm3(cross3(r, e1)); if (up[1] < 0) up = up.map((c) => -c);
  const zw = sd === 'r' ? r : r.map((c) => -c);
  const [xs, ys] = P.seat, [xb] = P.ball;
  let m1 = [xb - xs, -ys]; const ml = Math.hypot(m1[0], m1[1]) || 1; m1 = [m1[0] / ml, m1[1] / ml];
  let m2 = [-m1[1], m1[0]]; if (m2[1] < 0) m2 = [-m2[0], -m2[1]];
  const tw = sub3(sh.platToe, sh.platBall), phiW = Math.atan2(dot3(tw, up), dot3(tw, e1));
  const tm = [P.toe[0] - xb, 0], phiM = Math.atan2(tm[0] * m2[0] + tm[1] * m2[1], tm[0] * m1[0] + tm[1] * m1[1]);
  const phi = P.plat > 0.025 ? 0 : phiW - phiM, pa = (xb - xs) * m1[0] - ys * m1[1], pb = (xb - xs) * m2[0] - ys * m2[1];
  const band = 0.02, V = P.V, O = sh.heelSole;
  out = out ?? new Float32Array(V.length);
  for (let i = 0; i < P.n; i++) {
    const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    let a = (x - xs) * m1[0] + (y - ys) * m1[1], b = (x - xs) * m2[0] + (y - ys) * m2[1];
    const w = sstepM(xb - band, xb + band, x);
    if (w > 0 && phi !== 0) {
      const t = phi * w, c = Math.cos(t), s = Math.sin(t), da = a - pa, db = b - pb;
      a = pa + da * c - db * s; b = pb + da * s + db * c;
    }
    out[i * 3] = O[0] + e1[0] * a + up[0] * b + zw[0] * z;
    out[i * 3 + 1] = O[1] + e1[1] * a + up[1] * b + zw[1] * z;
    out[i * 3 + 2] = O[2] + e1[2] * a + up[2] * b + zw[2] * z;
  }
  return out;
}

/**
 * Per-triangle colour after lighting (same model as the capsules: ambient 0.42, sun 0.7, a little rim, specular from
 * gloss) and alpha. base: 'photo' uses the traced colours; otherwise {upper, toebox, sole, heel} rgb arrays.
 */
export function shadeTris(P, W, eye, sun, sunShadow, opt = {}) {
  const F = P.F, nt = F.length / 3, col = new Float32Array(nt * 3), alpha = new Float32Array(nt);
  const gloss = opt.gloss ?? 0.2, zc = opt.zoneColours;
  // smooth shading: each triangle lit by the mean of its corners' area-weighted normals
  const VN = new Float32Array(W.length);
  for (let t = 0; t < nt; t++) {
    const i0 = F[t * 3] * 3, i1 = F[t * 3 + 1] * 3, i2 = F[t * 3 + 2] * 3;
    const ux = W[i1] - W[i0], uy = W[i1 + 1] - W[i0 + 1], uz = W[i1 + 2] - W[i0 + 2], vx = W[i2] - W[i0], vy = W[i2 + 1] - W[i0 + 1], vz = W[i2 + 2] - W[i0 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) { VN[i] += nx; VN[i + 1] += ny; VN[i + 2] += nz; }
  }
  for (let t = 0; t < nt; t++) {
    const i0 = F[t * 3], i1 = F[t * 3 + 1], i2 = F[t * 3 + 2];
    const A = [W[i0 * 3], W[i0 * 3 + 1], W[i0 * 3 + 2]], B = [W[i1 * 3], W[i1 * 3 + 1], W[i1 * 3 + 2]], Cc = [W[i2 * 3], W[i2 * 3 + 1], W[i2 * 3 + 2]];
    let n = norm3([0, 1, 2].map((c) => VN[i0 * 3 + c] + VN[i1 * 3 + c] + VN[i2 * 3 + c]));
    const cen = [(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3, (A[2] + B[2] + Cc[2]) / 3], v = norm3(sub3(eye, cen));
    if (dot3(n, v) < 0) n = n.map((c) => -c);
    const zone = P.Z[i0], heel = zone === ZONE_HEEL && P.Z[i1] === ZONE_HEEL && P.Z[i2] === ZONE_HEEL;
    const g = heel && P.clear ? 0.95 : gloss;
    const diff = Math.max(0, dot3(n, sun)), facing = dot3(n, v);
    const h = norm3([sun[0] + v[0], sun[1] + v[1], sun[2] + v[2]]);
    const spec = g ? g * Math.pow(Math.max(0, dot3(n, h)), 24) * 255 : 0;
    const kk = 0.42 + 0.7 * diff * sunShadow + 0.08 * (1 - facing);
    for (let c = 0; c < 3; c++) {
      const base = zone === ZONE_SKIN ? (opt.skin ?? [217, 176, 140])[c] : zc ? zc[zone][c] : heel && P.clearTint ? [205, 218, 228][c] : (P.C[i0 * 3 + c] + P.C[i1 * 3 + c] + P.C[i2 * 3 + c]) / 3;
      col[t * 3 + c] = Math.min(255, base * kk + spec);
    }
    alpha[t] = heel && P.clear ? 0.6 : 1;
  }
  return { col, alpha };
}

/** Fill a screen triangle (no anti-aliasing): plot(x, y). */
export function fillTri2d(Wd, Ht, x0, y0, x1, y1, x2, y2, plot) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(Wd - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(Ht - 1, Math.ceil(Math.max(y0, y1, y2)));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area, w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area, w2 = 1 - w0 - w1;
    if (w0 >= 0 && w1 >= 0 && w2 >= 0) plot(x, y);
  }
}

/**
 * Rasterise projected triangles into an RGBA buffer, z-buffered and supersampled inside their own box, then
 * composite: opaque triangles first, see-through ones (a clear heel) blended on top where nearer.
 * S: Float32Array of [u, v, depth] per vertex. opt.mask(x, y) limits the pixels; opt.fade scales coverage.
 */
export function rasterMesh(buf, Wd, Ht, S, F, col, alpha, opt = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < S.length; i += 3) {
    if (S[i + 2] < 0.05) return;
    x0 = Math.min(x0, S[i]); x1 = Math.max(x1, S[i]); y0 = Math.min(y0, S[i + 1]); y1 = Math.max(y1, S[i + 1]);
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(Wd - 1, Math.ceil(x1)); y1 = Math.min(Ht - 1, Math.ceil(y1));
  if (x0 > x1 || y0 > y1) return;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ss = Math.max(1, Math.min(opt.ss ?? 3, Math.floor(Math.sqrt(250000 / (bw * bh)))));
  const W2 = bw * ss, H2 = bh * ss, N = W2 * H2;
  const Zb = new Float32Array(N).fill(Infinity), Cb = new Float32Array(N * 3), Tb = new Float32Array(N * 4);
  const nt = F.length / 3;
  for (const pass of [0, 1]) {
    for (let t = 0; t < nt; t++) {
      const see = alpha[t] < 1; if (see !== (pass === 1)) continue;
      const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
      const ax = (S[a] - x0) * ss, ay = (S[a + 1] - y0) * ss, bx = (S[b] - x0) * ss, by = (S[b + 1] - y0) * ss, cx = (S[c] - x0) * ss, cy = (S[c + 1] - y0) * ss;
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-9) continue;
      const za = S[a + 2], zb = S[b + 2], zc = S[c + 2];
      const mnx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), mxx = Math.min(W2 - 1, Math.ceil(Math.max(ax, bx, cx)));
      const mny = Math.max(0, Math.floor(Math.min(ay, by, cy))), mxy = Math.min(H2 - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area, w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * za + w1 * zb + w2 * zc, j = y * W2 + x;
        if (z >= Zb[j]) continue;
        if (!see) { Zb[j] = z; Cb[j * 3] = col[t * 3]; Cb[j * 3 + 1] = col[t * 3 + 1]; Cb[j * 3 + 2] = col[t * 3 + 2]; }
        else { const al = alpha[t], k = j * 4; Tb[k] += (col[t * 3] - Tb[k]) * al; Tb[k + 1] += (col[t * 3 + 1] - Tb[k + 1]) * al; Tb[k + 2] += (col[t * 3 + 2] - Tb[k + 2]) * al; Tb[k + 3] = 1 - (1 - Tb[k + 3]) * (1 - al); }
      }
    }
  }
  const fade = opt.fade ?? 1, inv = 1 / (ss * ss);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = x0 + x, Y = y0 + y;
    if (opt.mask && !opt.mask(X, Y)) continue;
    let n = 0, r = 0, g = 0, b = 0, tr = 0, tg = 0, tb = 0, ta = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const j = (y * ss + sy) * W2 + x * ss + sx;
      if (Zb[j] < Infinity) { n++; r += Cb[j * 3]; g += Cb[j * 3 + 1]; b += Cb[j * 3 + 2]; }
      const k = j * 4; if (Tb[k + 3] > 0) { ta += Tb[k + 3]; tr += Tb[k] * Tb[k + 3]; tg += Tb[k + 1] * Tb[k + 3]; tb += Tb[k + 2] * Tb[k + 3]; }
    }
    const o = (Y * Wd + X) * 4;
    if (n) { const cov = n * inv * fade, tint = opt.tint ?? 1; buf[o] += (r / n * tint - buf[o]) * cov; buf[o + 1] += (g / n * tint - buf[o + 1]) * cov; buf[o + 2] += (b / n * tint - buf[o + 2]) * cov; }
    if (ta > 0) { const cov = ta * inv * fade; buf[o] += (tr / ta - buf[o]) * cov; buf[o + 1] += (tg / ta - buf[o + 1]) * cov; buf[o + 2] += (tb / ta - buf[o + 2]) * cov; }
  }
}

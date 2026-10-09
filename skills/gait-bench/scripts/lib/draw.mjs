// draw.mjs — one renderer for the video and the viewer page: sky, ground, far scenery, props and the figure, lit by the sun.
// Everything is drawn from the scene description; nothing comes from the footage. Pure JavaScript with no Node APIs.
import { vec, rgb } from './scene.mjs';
import { terrainOf } from './terrain.mjs';
import { prepareShoe, poseShoe, shadeTris, rasterMesh, fillTri2d } from './shoemesh.mjs';

const RAD = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const { add, sub, mul, dot, norm } = vec;

// ---------- noise ----------
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
function fbm(x, y, oct = 3) { let s = 0, amp = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += amp * vnoise(x, y); n += amp; x *= 2.03; y *= 2.03; amp *= 0.5; } return s / n; }

// ---------- far scenery: bands around the horizon ----------
function bandProfile(b, x) { // x: metres along the band
  switch (b.kind) {
    case 'buildings': { const w = b.width_m ?? 25, i = Math.floor(x / w); return hash2(i, 11) < (b.gaps ?? 0.3) ? 0.12 * hash2(i, 5) : 0.4 + 0.6 * hash2(i, 3); }
    case 'hills': return 0.45 + 0.55 * fbm(x / (b.height_m * 6), 5.5, 4);
    default: return 0.92 + 0.08 * vnoise(x / 3, 2.2); // bank, wall
  }
}

/** How much of a tree line covers the point x metres along it, y metres up. */
function treeAlpha(b, x, y, leafy) {
  const sp = b.spacing_m ?? 5, cell = Math.floor(x / sp);
  let a = y < 1.2 ? 0.45 * vnoise(x * 1.5, y * 3) * (1 - y / 1.2) : 0; // undergrowth
  for (let k = cell - 1; k <= cell + 1; k++) {
    const tx = (k + 0.15 + 0.7 * hash2(k, 1)) * sp, th = b.height_m * (0.6 + 0.4 * hash2(k, 2)), dx = x - tx;
    const trunk = 0.05 + 0.2 * Math.max(0, 1 - y / (0.8 * th));
    if (y < 0.8 * th && Math.abs(dx) < trunk) a = Math.max(a, 0.95);
    const cy = th * (leafy ? 0.62 : 0.6), q = (dx / (th * (leafy ? 0.38 : 0.26))) ** 2 + ((y - cy) / (th * 0.42)) ** 2;
    if (q < 1) a = Math.max(a, leafy ? (q < 0.8 ? 1 : 5 * (1 - q)) : (0.12 + 0.55 * vnoise(x * 9, y * 1.2) * vnoise(x * 3.1 + 7, y * 2)) * (1 - q * 0.5));
  }
  return clamp(a, 0, 1);
}

/** A renderer for one scene. render(frame, cam, buf) fills buf (RGBA, cam.width × cam.height). */
export function makeRenderer(scene, dims) {
  const sky = { zen: rgb(scene.sky.zenith), hor: rgb(scene.sky.horizon), haze: scene.sky.haze_m ?? 2500 };
  const el = clamp(scene.sun.elevation_deg, 3, 89) * RAD, saz = scene.sun.azimuth_deg * RAD;
  const sun = [Math.sin(saz) * Math.cos(el), Math.sin(el), Math.cos(saz) * Math.cos(el)];
  // low sun: long but softer shadows; sun.strength below 1 for haze or overcast (0.2–0.3 under full cloud)
  const sunShadow = clamp(Math.sin(el) * 2.2, 0.35, 1) * clamp(scene.sun.strength ?? 1, 0, 1);
  const g = scene.ground, gcol = rgb(g.colour), pcol = g.patches ? rgb(g.patches.colour, [235, 238, 240]) : null;
  const pSize = g.patches?.size_m ?? 0.5, pCover = clamp(g.patches?.cover ?? 0.3, 0, 1), shine = clamp(g.shine ?? 0, 0, 1);
  const bands = scene.far.map((b) => {
    const span = ((((b.to_deg - b.from_deg) % 360) + 360) % 360) || 360;
    return { ...b, span, col: rgb(b.colour, { trees: [70, 90, 60], bare_trees: [110, 95, 85], buildings: [150, 160, 172], hills: [110, 125, 120], bank: [150, 130, 100], wall: [160, 155, 150] }[b.kind]) };
  }).sort((p, q) => p.distance_m - q.distance_m);
  const fig = figureLook(scene, dims);
  const TR = terrainOf(scene);

  function skyColour(r) {
    const e = Math.asin(clamp(r[1], -1, 1));
    let c = mix(sky.hor, sky.zen, Math.pow(clamp(e / 0.6, 0, 1), 0.7));
    const cs = dot(r, sun);
    if (cs > 0) { const glow = Math.pow(cs, 300) * 0.7 + Math.pow(cs, 12) * 0.12; c = mix(c, [255, 244, 222], clamp(glow, 0, 1)); }
    return c;
  }

  function background(cam, buf, isGround) {
    const { width: W, height: H, eye } = cam;
    const TRr = TR ? TR.raster(cam) : null;
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        const r = cam.ray(u + 0.5, v + 0.5), i = v * W + u;
        const hz = Math.hypot(r[0], r[2]) || 1e-9;
        const zT = TRr ? TRr.depth[v * W + u] : Infinity;
        const tG = zT < Infinity ? zT / Math.max(1e-6, dot(r, cam.fwd)) : (r[1] < -1e-6 ? -eye[1] / r[1] : Infinity), dG = tG * hz;
        let c = null, veil = null; isGround[i] = 0;
        if (bands.length) {
          const az0 = Math.atan2(r[0], r[2]) / RAD, e = Math.atan2(r[1], hz);
          for (const b of bands) {
            const bd = b.distance_m, az = az0; // a backdrop at its distance from the eye, standing on the terrain there
            const base = TR ? TR.height(eye[0] + (r[0] / hz) * bd, eye[2] + (r[2] / hz) * bd) : 0;
            if (dG < bd) break; // the ground in front hides this band and every farther one
            const d = (((az - b.from_deg) % 360) + 360) % 360;
            if (d > b.span) continue;
            const x = az * RAD * b.distance_m, fade = b.span >= 360 ? 1 : sstep(0, 2, Math.min(d, b.span - d));
            if (b.kind === 'trees' || b.kind === 'bare_trees') {
              // single trees you can see between: a trunk, a crown, and sky through the twigs of bare ones
              const y = eye[1] + Math.tan(e) * bd - base;
              if (y > b.height_m || y < 0) continue;
              const al = fade * treeAlpha(b, x, y, b.kind === 'trees');
              if (al <= 0.01) continue;
              const tc = mix(mul(b.col, 0.85 + 0.3 * vnoise(x * 3, y * 3)), sky.hor, 1 - Math.exp(-bd / sky.haze));
              (veil ??= []).push([tc, al]);
              if (al >= 0.99) { c = tc; break; }
              continue;
            }
            const prof = bandProfile(b, x) * fade;
            const top = Math.atan2(base + b.height_m * prof - eye[1], bd), bot = Math.atan2(base - eye[1], bd);
            if (e > top) continue;
            const hgt = clamp((e - bot) / Math.max(1e-6, top - bot), 0, 1); // 0 at its foot, 1 at its top
            if (b.kind === 'buildings') { const win = (Math.floor(x / 2.2) + Math.floor(hgt * b.height_m / 3)) & 1; c = mul(b.col, (0.88 + 0.2 * hash2(Math.floor(x / (b.width_m ?? 25)), 7)) * (win ? 0.96 : 1.02)); }
            else c = mul(b.col, 0.82 + 0.3 * vnoise(x / 2, hgt * 4) + 0.08 * hgt);
            c = mix(c, sky.hor, 1 - Math.exp(-bd / sky.haze));
            break;
          }
        }
        if (!c && tG < Infinity) {
          const p = add(eye, mul(r, tG));
          if (TR) {
            const ti = TRr.nrmIdx[i], nv = ti >= 0 ? TR.normal(ti) : [0, 1, 0];
            const fp = tG / (cam.f * Math.max(Math.abs(dot(r, nv)), 0.02)); // the pixel's footprint on the ground, in metres
            const M = TR.material(p[0], p[2], fp);
            c = mix(M.col, M.pcol ?? M.col, M.patch);
            c = mul(c, 0.82 + 0.25 * sun[1] + 0.9 * (dot(nv, sun) - sun[1]) + 0.06 * (vnoise(p[0] * 1.3, p[2] * 1.3) - 0.5));
            if (M.shine > 0) {
              const dn = 2 * dot(r, nv), refl = norm([r[0] - dn * nv[0], Math.abs(r[1] - dn * nv[1]), r[2] - dn * nv[2]]);
              c = mix(c, skyColour(refl), M.shine * 0.35 * (1 - M.patch));
              const sp = Math.pow(Math.max(0, dot(refl, sun)), 40) * M.shine * (1 - M.patch);
              c = mix(c, [255, 250, 240], clamp(sp, 0, 1));
            }
            const ga = TR.gridAlpha(p[0], p[2], fp, dG);
            if (ga > 0) c = mix(c, TR.gridColour, ga);
            c = mix(c, sky.hor, 1 - Math.exp(-dG / (sky.haze / 5)));
            isGround[i] = 1;
          } else {
          let m = 0;
          if (pcol) {
            const fp = tG / (cam.f * Math.max(-r[1], 1e-3)); // the pixel's footprint on the ground, in metres
            const raw = sstep(1 - pCover - 0.04, 1 - pCover + 0.04, fbm(p[0] / pSize, p[2] / pSize));
            m = raw + (pCover - raw) * clamp((fp / pSize - 0.1) / 0.5, 0, 1);
          }
          c = mix(gcol, pcol ?? gcol, m);
          c = mul(c, 0.82 + 0.25 * sun[1] + 0.06 * (vnoise(p[0] * 1.3, p[2] * 1.3) - 0.5));
          if (shine > 0) {
            const refl = [r[0], -r[1], r[2]];
            c = mix(c, skyColour(refl), shine * 0.35 * (1 - m));
            const sp = Math.pow(Math.max(0, dot(refl, sun)), 40) * shine * (1 - m);
            c = mix(c, [255, 250, 240], clamp(sp, 0, 1));
          }
          c = mix(c, sky.hor, 1 - Math.exp(-dG / (sky.haze / 5)));
          isGround[i] = 1;
          }
        }
        if (!c) c = skyColour(r);
        if (veil) for (let q = veil.length - 1; q >= 0; q--) c = mix(c, veil[q][0], veil[q][1]);
        const k = i * 4;
        buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255;
      }
    }
  }

  let shadowBuf = null, groundBuf = null, bgKey = null, bgBuf = null, bgGround = null;
  return {
    sun,
    render(frame, cam, buf) {
      const n = cam.width * cam.height;
      if (!shadowBuf || shadowBuf.length !== n) { shadowBuf = new Float32Array(n); groundBuf = new Uint8Array(n); }
      // the sky, ground and scenery depend only on the camera: a camera that stays put draws them once
      const key = [cam.width, cam.height, ...cam.eye, cam.yaw, cam.pitch, cam.roll, cam.f].join(',');
      if (bgKey === key && bgBuf.length === buf.length) { buf.set(bgBuf); groundBuf.set(bgGround); }
      else { background(cam, buf, groundBuf); bgKey = key; bgBuf = Uint8ClampedArray.from(buf); bgGround = Uint8Array.from(groundBuf); }
      const hgt = TR ? TR.height : () => 0;
      const items = [...fig.parts(frame), ...propParts(scene, hgt)];
      // library shoes: posed once per frame, then shadowed, reflected and drawn in the painter's order like the capsules
      const FWm = scene.figure.footwear, meshP = FWm.mesh ? prepareShoe(FWm.mesh, FWm) : null;
      let zcol = null;
      if (meshP && meshP.category === 'barefoot') { const sk = rgb(scene.figure.colours?.skin, [217, 176, 140]); zcol = [sk, sk, sk, sk]; } // a real foot, in the figure's skin
      else if (meshP && FWm.colours === 'scene') { const C = scene.figure.colours ?? {}, sc = rgb(C.shoes, [34, 34, 34]); zcol = [sc, sc, rgb(C.sole, sc), rgb(C.heel, [205, 218, 228])]; }
      const projAll = (Wv, mirror) => {
        const S = new Float32Array(Wv.length);
        for (let i = 0; i < Wv.length; i += 3) {
          let y = Wv[i + 1];
          if (mirror) { const g0 = TR ? TR.height(Wv[i], Wv[i + 2]) : 0; y = 2 * g0 - y; }
          const p = cam.project([Wv[i], y, Wv[i + 2]]); S[i] = p[0]; S[i + 1] = p[1]; S[i + 2] = p[2];
        }
        return S;
      };
      const meshShade = (it) => (it.shade ??= shadeTris(meshP, it.W, cam.eye, sun, sunShadow, { gloss: scene.figure.gloss?.shoes ?? 0.2, zoneColours: zcol, skin: rgb(scene.figure.colours?.skin, [217, 176, 140]) }));
      const meshShadow = (it) => {
        const Wv = it.W, F = meshP.F, S = new Float32Array(Wv.length);
        for (let i = 0; i < Wv.length; i += 3) { const p = cam.project(onGround([Wv[i], Wv[i + 1], Wv[i + 2]], sun, TR)); S[i] = p[0]; S[i + 1] = p[1]; S[i + 2] = p[2]; }
        for (let t = 0; t < F.length; t += 3) {
          const a = F[t] * 3, b = F[t + 1] * 3, c = F[t + 2] * 3;
          if (S[a + 2] < 0.05 || S[b + 2] < 0.05 || S[c + 2] < 0.05 || (meshP.clear && meshP.Z[F[t]] === 3)) continue;
          fillTri2d(cam.width, cam.height, S[a], S[a + 1], S[b], S[b + 1], S[c], S[c + 1], (x, y) => { const j = y * cam.width + x; if (groundBuf[j]) shadowBuf[j] = 1; });
        }
      };
      if (meshP) for (const it of items) if (it.mesh) it.W = poseShoe(meshP, it.sh, it.sd, it.right);
      // shadows: every capsule flattened onto the ground along the sun
      shadowBuf.fill(0);
      for (const it of items) {
        if (it.mesh) { meshShadow(it); continue; }
        if (it.noShadow) continue;
        const A = onGround(it.A, sun, TR), B = onGround(it.B, sun, TR);
        const pa = cam.project(A), pb = cam.project(B);
        if (pa[2] < 0.05 || pb[2] < 0.05) continue;
        capsule2d(cam.width, cam.height, pa[0], pa[1], (cam.f * it.rA) / pa[2], pb[0], pb[1], (cam.f * it.rB) / pb[2], (x, y, cov) => {
          const j = y * cam.width + x; if (groundBuf[j] && cov > shadowBuf[j]) shadowBuf[j] = cov;
        });
      }
      // contact prints: the ground darkens where a planted platform and heel tip press on it
      const gh = (x, z) => (TR ? TR.height(x, z) : 0), onG = (P) => [P[0], gh(P[0], P[2]) + 0.004, P[2]];
      for (const sd of ['l', 'r']) {
        const sh = frame.shoe?.[sd]; if (!sh || !sh.platBall) continue;
        const low = Math.min(sh.platBall[1], sh.platToe[1], sh.heelTip[1]) - gh(sh.platBall[0], sh.platBall[2]);
        const kc = clamp(1 - low / 0.025, 0, 1); if (kc <= 0) continue;
        const marks = [[sh.platBall, sh.platToe, 0.03], [sh.heelTip, sh.heelTip, 0.01]];
        if (sh.slideFrom) marks.push([sh.slideFrom, sh.platBall, 0.018]);
        for (const [A, B, r] of marks) {
          const pa = cam.project(onG(A)), pb = cam.project(onG(B));
          if (pa[2] < 0.05 || pb[2] < 0.05) continue;
          capsule2d(cam.width, cam.height, pa[0], pa[1], (cam.f * r) / pa[2], pb[0], pb[1], (cam.f * r) / pb[2], (x, y, cov) => {
            const j = y * cam.width + x; if (groundBuf[j]) shadowBuf[j] = Math.max(shadowBuf[j], 0.95 * kc * cov);
          });
        }
      }
      for (let j = 0; j < n; j++) {
        const s = shadowBuf[j];
        if (s > 0) { const k = j * 4, d = 1 - 0.55 * sunShadow * s; buf[k] *= d; buf[k + 1] *= d; buf[k + 2] *= d * 1.04; }
      }
      // the contact look: each sole on the ground is picked out in colour (blue planted, orange sliding)
      if (scene.look === 'contact') {
        for (const sd of ['l', 'r']) {
          const sh = frame.shoe?.[sd], kind = frame.contact?.[sd]; if (!sh || !sh.platBall || kind === 'swing') continue;
          const col = kind === 'slide' ? [232, 128, 36] : [47, 111, 214];
          const marks = [[sh.heelTip, sh.platBall, 0.022], [sh.platBall, sh.platToe, 0.034], [sh.heelTip, sh.heelTip, 0.016]];
          if (sh.slideFrom) marks.push([sh.slideFrom, sh.platBall, 0.02]);
          for (const [A, B, r] of marks) {
            const pa = cam.project(onG(A)), pb = cam.project(onG(B));
            if (pa[2] < 0.05 || pb[2] < 0.05) continue;
            capsule2d(cam.width, cam.height, pa[0], pa[1], (cam.f * r) / pa[2], pb[0], pb[1], (cam.f * r) / pb[2], (x, y, cov) => {
              const j = y * cam.width + x; if (!groundBuf[j]) return; const k = j * 4, w = 0.85 * cov;
              buf[k] += (col[0] - buf[k]) * w; buf[k + 1] += (col[1] - buf[k + 1]) * w; buf[k + 2] += (col[2] - buf[k + 2]) * w;
            });
          }
        }
      }
      // reflections: glossy ground mirrors the figure, strongest at the soles and fading with height
      const shineG = clamp(scene.ground.shine ?? 0, 0, 1);
      if (shineG > 0 && scene.ground.reflect !== false) {
        for (const it of items) {
          if (it.mesh) { const sh = meshShade(it); rasterMesh(buf, cam.width, cam.height, projAll(it.W, true), meshP.F, sh.col, sh.alpha, { mask: (x, y) => groundBuf[y * cam.width + x], fade: 0.55 * shineG, tint: 0.5, ss: 1 }); continue; }
          const gA = gh(it.A[0], it.A[2]), gB = gh(it.B[0], it.B[2]);
          const fade = Math.exp(-Math.max(0, Math.min(it.A[1] - gA, it.B[1] - gB)) / 0.45); if (fade < 0.03) continue;
          const pa = cam.project([it.A[0], 2 * gA - it.A[1], it.A[2]]), pb = cam.project([it.B[0], 2 * gB - it.B[1], it.B[2]]);
          if (pa[2] < 0.05 || pb[2] < 0.05) continue;
          const a = 0.55 * shineG * fade * (it.alpha ?? 1), c = it.col;
          capsule2d(cam.width, cam.height, pa[0], pa[1], (cam.f * it.rA) / pa[2], pb[0], pb[1], (cam.f * it.rB) / pb[2], (x, y, cov) => {
            const j = y * cam.width + x; if (!groundBuf[j]) return; const k = j * 4, w = cov * a;
            buf[k] += (c[0] * 0.5 - buf[k]) * w; buf[k + 1] += (c[1] * 0.5 - buf[k + 1]) * w; buf[k + 2] += (c[2] * 0.55 - buf[k + 2]) * w;
          });
        }
      }
      // capsules far to near
      const L = [dot(sun, cam.right), dot(sun, cam.up), -dot(sun, cam.fwd)]; // the sun in the picture: x right, y up, z toward the viewer
      const drawn = items.map((it) => { const k = it.sortAs ?? it; return { it, depth: dot(sub(k.sphere ? k.A : mul(add(k.A, k.B), 0.5), cam.eye), cam.fwd) - (it.sortAs ? 0.001 : it.bias ?? 0) }; }).sort((p, q) => q.depth - p.depth);
      for (const { it } of drawn) {
        if (it.mesh) { const sh = meshShade(it); rasterMesh(buf, cam.width, cam.height, projAll(it.W, false), meshP.F, sh.col, sh.alpha); continue; }
        const pa = cam.project(it.A), pb = cam.project(it.B);
        if (pa[2] < 0.05 || pb[2] < 0.05) continue;
        const col = it.col, gloss = it.gloss ?? 0, al = it.alpha ?? 1;
        capsule2d(cam.width, cam.height, pa[0], pa[1], (cam.f * it.rA) / pa[2], pb[0], pb[1], (cam.f * it.rB) / pb[2], (x, y, cov, qx, qy, s) => {
          const nz = s, diff = Math.max(0, qx * L[0] + qy * L[1] + nz * L[2]);
          let k = 0.42 + 0.7 * diff * sunShadow + 0.08 * (1 - nz);
          const spec = gloss ? gloss * Math.pow(Math.max(0, qx * L[0] * 0.5 + qy * L[1] * 0.5 + nz * (1 + L[2]) * 0.5), 18) * 255 : 0;
          const j = (y * cam.width + x) * 4;
          buf[j] += (Math.min(255, col[0] * k + spec) - buf[j]) * cov * al;
          buf[j + 1] += (Math.min(255, col[1] * k + spec) - buf[j + 1]) * cov * al;
          buf[j + 2] += (Math.min(255, col[2] * k + spec) - buf[j + 2]) * cov * al;
        });
      }
      return buf;
    },
  };
}

const onGround = (P, sun, TR) => { const h0 = TR ? TR.height(P[0], P[2]) : 0; const k = Math.max(0, P[1] - h0) / Math.max(sun[1], 0.12); const x = P[0] - sun[0] * k, z = P[2] - sun[2] * k; return [x, TR ? TR.height(x, z) + 0.004 : 0.002, z]; };

/**
 * An anti-aliased tapered capsule in screen space. plot(x, y, coverage, qx, qy, s) gets the pixel, how much of it the
 * capsule covers, the unit offset from the axis (x right, y up) and s, how far the surface faces the viewer (1 on the axis).
 */
function capsule2d(W, H, x0, y0, r0, x1, y1, r1, plot) {
  r0 = Math.max(r0, 0.35); r1 = Math.max(r1, 0.35);
  const minX = Math.max(0, Math.floor(Math.min(x0 - r0, x1 - r1)) - 1), maxX = Math.min(W - 1, Math.ceil(Math.max(x0 + r0, x1 + r1)) + 1);
  const minY = Math.max(0, Math.floor(Math.min(y0 - r0, y1 - r1)) - 1), maxY = Math.min(H - 1, Math.ceil(Math.max(y0 + r0, y1 + r1)) + 1);
  if (minX > maxX || minY > maxY) return;
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0;
      const t = clamp((px * dx + py * dy) / L2, 0, 1), qx = px - t * dx, qy = py - t * dy;
      const d = Math.hypot(qx, qy), r = r0 + (r1 - r0) * t, cov = clamp(r - d + 0.5, 0, 1);
      if (cov <= 0) continue;
      const nx = qx / r, ny = -qy / r;
      plot(x, y, cov, nx, ny, Math.sqrt(clamp(1 - nx * nx - ny * ny, 0, 1)));
    }
  }
}

// ---------- the figure ----------
function meshShoeParts(F, s, sh, n, sd, col, cap) {
  const out = [], cat = F.footwear.mesh.category ?? 'pump', ank = n[`ankle_${sd}`];
  // a shoe without the real foot inside gets a capsule instep over its opening
  if (!F.footwear.mesh.foot_inside && ['pump', 'sandal', 'mule', 'flat', 'slingback', 'mary_jane'].includes(cat)) out.push(cap(ank, add(ank, mul(sub(n[`ball_${sd}`], ank), 0.6)), 0.026 * s, 0.022 * s, col.skin, { bias: 0.03 }));
  out.push({ mesh: true, sd, sh, right: sub(n.hip_r, n.hip_l), A: sh.heelTip, B: sh.platToe, rA: 0.03, rB: 0.03, col: col.shoes, bias: 0.015 });
  return out;
}

export function figureLook(scene, D) {
  const F = scene.figure, C = F.colours ?? {}, s = D.H / 1.7, b = D.build;
  const col = {
    skin: rgb(C.skin, [217, 176, 140]), hair: rgb(C.hair, [42, 32, 24]), top: rgb(C.top, [106, 127, 153]),
    bottom: rgb(C.bottom, [45, 52, 64]), shoes: rgb(C.shoes, [34, 34, 34]), bag: rgb(C.bag, [58, 30, 30]),
  };
  col.legs = rgb(C.legs, col.bottom);
  col.heel = rgb(C.heel, [205, 218, 228]); col.sole = rgb(C.sole, col.shoes);
  col.soleSet = C.sole != null;
  const gloss = F.gloss ?? {}, sleeves = F.sleeves ?? 'short';
  const bagSide = F.bag === 'left' ? 'l' : F.bag === 'right' ? 'r' : null; // figure.bag: a bag carried in that hand
  const cap = (A, B, rA, rB, c, extra) => ({ A, B, rA, rB, col: c, ...extra });
  return {
    parts(fr) {
      const n = fr.nodes, P = [];
      const g = (k) => gloss[k] ?? 0;
      const face = [Math.sin((fr.head_deg ?? fr.facing_deg) * RAD), 0, Math.cos((fr.head_deg ?? fr.facing_deg) * RAD)];
      for (const sd of ['l', 'r']) {
        const sh = fr.shoe[sd];
        // bottom_length: full trousers (the default), cut at the knee, or shorts with bare or stockinged thighs below
        if (F.bottom_length === 'shorts') {
          const cut = add(n[`hip_${sd}`], mul(sub(n[`knee_${sd}`], n[`hip_${sd}`]), 0.28));
          P.push(cap(n[`hip_${sd}`], cut, 0.076 * s * b, 0.07 * s * b, col.bottom, { gloss: g('bottom') }));
          P.push(cap(cut, n[`knee_${sd}`], 0.066 * s * b, 0.05 * s * b, col.legs, { gloss: g('legs') }));
        } else P.push(cap(n[`hip_${sd}`], n[`knee_${sd}`], 0.074 * s * b, 0.05 * s * b, col.bottom, { gloss: g('bottom') }));
        P.push(cap(n[`knee_${sd}`], n[`ankle_${sd}`], 0.05 * s * b, 0.032 * s, col.legs, { gloss: g('legs') ?? g('bottom') }));
        if (F.footwear.mesh) P.push(...meshShoeParts(F, s, sh, n, sd, col, cap));
        else {
        P.push(cap(sh.heelSole, n[`ball_${sd}`], 0.034 * s, 0.03 * s, col.shoes, { gloss: g('shoes') }));
        P.push(cap(n[`ball_${sd}`], n[`toe_${sd}`], 0.03 * s, 0.024 * s, col.shoes, { gloss: g('shoes') }));
        if (D.heel - D.plat > 0.04) P.push(cap(sh.heelSole, sh.heelTip, 0.008, 0.005, col.shoes, { gloss: g('shoes') }));
        else P.push(cap(sh.heelSole, sh.heelTip, 0.026 * s, 0.024 * s, col.shoes));
        if (D.plat > 0.015) P.push(cap(mul(add(n[`ball_${sd}`], sh.platBall), 0.5), mul(add(n[`toe_${sd}`], sh.platToe), 0.5), D.plat / 2 + 0.012, D.plat / 2 + 0.008, col.shoes, { gloss: g('shoes') }));
        }
      }
      // trunk: three upright capsules side by side give a flat, wide torso from any side
      const lU = norm(sub(n.shoulder_l, n.shoulder_r)), lH = norm(sub(n.hip_l, n.hip_r)), w = s * b;
      const hipMid = mul(add(n.hip_l, n.hip_r), 0.5), shMid = mul(add(n.shoulder_l, n.shoulder_r), 0.5);
      P.push(cap(add(hipMid, mul(lH, 0.045 * w)), add(hipMid, mul(lH, -0.045 * w)), 0.1 * w, 0.1 * w, col.bottom, { gloss: g('bottom') }));
      P.push(cap(hipMid, n.waist, 0.1 * w, 0.095 * w, col.bottom, { gloss: g('bottom') }));
      // top_length crop: bare midriff from the waistband to about a third of the way up the chest
      const crop = F.top_length === 'crop', tb = crop ? add(n.waist, mul(sub(shMid, n.waist), 0.38)) : n.waist;
      if (crop) P.push(cap(n.waist, tb, 0.088 * w, 0.085 * w, col.skin));
      for (const sg of [1, -1]) {
        P.push(cap(add(tb, mul(lH, sg * 0.04 * w)), add(sub(shMid, [0, 0.05 * s, 0]), mul(lU, sg * 0.085 * w)), 0.075 * w, 0.07 * w, col.top));
      }
      P.push(cap(tb, sub(shMid, [0, 0.03 * s, 0]), 0.08 * w, 0.085 * w, col.top));
      P.push(cap(n.shoulder_l, n.shoulder_r, 0.05 * w, 0.05 * w, col.top));
      // head: an upright capsule (taller than wide), on a short neck
      const back = mul(face, -1), hr = 0.074 * s, hh = 0.035 * s;
      const crown = add(n.head, [0, hh, 0]), chin = add(n.head, [0, -hh, 0]);
      P.push(cap(shMid, chin, 0.045 * s, 0.04 * s, col.skin));
      P.push(cap(chin, crown, hr * 0.92, hr, col.skin));
      if (F.hair !== 'none') {
        const hc = add(n.head, add(mul(back, 0.016 * s), [0, 0.012 * s, 0]));
        P.push(cap(add(hc, [0, -hh * 0.6, 0]), add(hc, [0, hh, 0]), hr * 1.05, hr * 1.06, col.hair, { gloss: g('hair') }));
        if (F.hair === 'long') {
          for (const sg of [1, -1]) {
            const side = mul(lU, sg * 0.045 * s);
            P.push(cap(add(add(n.head, mul(back, 0.03 * s)), side), add(add(add(n.spine, mul(back, 0.085 * s)), [0, 0.08 * s, 0]), mul(side, 1.4)), 0.07 * s, 0.06 * s, col.hair, { gloss: g('hair') }));
          }
        }
        if (F.hair === 'bun') { const bc = add(add(n.head, mul(back, 0.09 * s)), [0, 0.04 * s, 0]); P.push(cap(bc, bc, 0.045 * s, 0.045 * s, col.hair, { sphere: true })); }
      }
      for (const sd of ['l', 'r']) {
        const S = n[`shoulder_${sd}`], E = n[`elbow_${sd}`], Wr = n[`wrist_${sd}`], Hd = n[`hand_${sd}`];
        P.push(cap(S, E, 0.043 * s * b, 0.036 * s, sleeves === 'long' ? col.top : col.skin));
        if (sleeves === 'short') P.push(cap(S, add(S, mul(sub(E, S), 0.42)), 0.047 * s * b, 0.044 * s * b, col.top));
        P.push(cap(E, Wr, 0.035 * s, 0.026 * s, sleeves === 'long' ? col.top : col.skin));
        P.push(cap(Wr, Hd, 0.026 * s, 0.02 * s, col.skin));
        if (sd === bagSide) {
          const c = add(Hd, [0, -0.13 * s, 0]), along = norm([face[0], 0, face[2]]);
          P.push(cap(Hd, c, 0.007, 0.007, col.bag, { noShadow: true }));
          P.push(cap(add(c, mul(along, -0.07 * s)), add(c, mul(along, 0.07 * s)), 0.075 * s, 0.075 * s, col.bag, { gloss: g('bag') }));
        }
      }
      return P;
    },
  };
}

// ---------- props ----------
export function propParts(scene, ground = () => 0) {
  const out = [];
  for (const p of scene.props) {
    const start = out.length;
    const [x, z] = p.at, g0 = ground(x, z), h = p.height_m ?? { pole: 8, lamp: 5, tree: 7, bare_tree: 8, box: 1 }[p.kind], w = p.width_m;
    const c = rgb(p.colour, { pole: [110, 110, 112], lamp: [70, 72, 76], tree: [70, 95, 55], bare_tree: [95, 80, 70], box: [140, 140, 140] }[p.kind]);
    if (p.kind === 'pole' || p.kind === 'lamp') {
      const r = (w ?? 0.16) / 2;
      out.push({ A: [x, 0, z], B: [x, h, z], rA: r, rB: r * 0.7, col: c });
      if (p.kind === 'lamp') out.push({ A: [x, h, z], B: [x + 0.6, h + 0.05, z], rA: 0.06, rB: 0.1, col: c });
    } else if (p.kind === 'tree' || p.kind === 'bare_tree') {
      const r = (w ?? 0.3) / 2, trunk = [95, 78, 62];
      out.push({ A: [x, 0, z], B: [x, h * (p.kind === 'tree' ? 0.5 : 0.85), z], rA: r, rB: r * 0.6, col: p.kind === 'tree' ? trunk : c });
      if (p.kind === 'tree') { const cc = [x, h * 0.68, z]; out.push({ A: cc, B: cc, rA: h * 0.3, rB: h * 0.3, col: c, sphere: true }); }
      else for (let i = 0; i < 6; i++) {
        const a = hash2(i, Math.round(x * 10 + z)) * 2 * Math.PI, y0 = h * (0.35 + 0.08 * i), l = h * (0.25 + 0.1 * hash2(i, 3));
        out.push({ A: [x, y0, z], B: [x + Math.sin(a) * l * 0.6, y0 + l * 0.8, z + Math.cos(a) * l * 0.6], rA: r * 0.45, rB: r * 0.15, col: c });
      }
    } else if (p.kind === 'box') { // a rounded block: a fat capsule along its length
      const d = p.depth_m ?? 1, wid = w ?? 2, a = (p.yaw_deg ?? 0) * RAD, r = Math.min(d, h) / 2;
      const ux = Math.sin(a + Math.PI / 2) * (wid / 2 - r), uz = Math.cos(a + Math.PI / 2) * (wid / 2 - r);
      out.push({ A: [x - ux, r, z - uz], B: [x + ux, r, z + uz], rA: r, rB: r, col: c });
    }
    // stood on the ground where it is, not at sea level
    for (let k = start; k < out.length; k++) { const q = out[k]; q.A = [q.A[0], q.A[1] + g0, q.A[2]]; q.B = [q.B[0], q.B[1] + g0, q.B[2]]; }
  }
  return out;
}

/** The figure's box in the picture, [x0, y0, x1, y1] in pixels, from its parts. */
export function figureBox(scene, dims, frame, cam) {
  const parts = figureLook(scene, dims).parts(frame);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of parts) for (const [P, r] of [[it.A, it.rA], [it.B, it.rB]]) {
    const p = cam.project(P);
    if (p[2] <= 0.05) continue;
    const rp = (cam.f * r) / p[2];
    x0 = Math.min(x0, p[0] - rp); x1 = Math.max(x1, p[0] + rp); y0 = Math.min(y0, p[1] - rp); y1 = Math.max(y1, p[1] + rp);
  }
  return [x0, y0, x1, y1];
}

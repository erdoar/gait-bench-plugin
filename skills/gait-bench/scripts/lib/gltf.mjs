// gltf.mjs — the scene as an animated 3D file (glTF 2.0 binary, .glb): the figure as the renderer draws it (each part a
// capsule that moves with the poses), the real shoes on the feet, the terrain and the props. No camera: whoever opens
// the file chooses the view. Pure JavaScript with no Node APIs, so the studio page can make the file too.
import { vec, rgb } from './scene.mjs';
import { terrainOf } from './terrain.mjs';
import { prepareShoe } from './shoemesh.mjs';
import { figureLook, propParts } from './draw.mjs';

const { add, sub, mul, dot, norm, len, cross } = vec;

/** A capsule along +y from 0 to L: radius r0 at the bottom, r1 at the top, with round ends. */
function capsuleMesh(L, r0, r1, seg = 12, ring = 4) {
  const P = [], N = [], I = [], rows = [];
  // the profile: the bottom cap, the side, the top cap (as [y, radius, ny])
  for (let k = 0; k <= ring; k++) { const a = -Math.PI / 2 + (k / ring) * (Math.PI / 2); rows.push([Math.sin(a) * r0, Math.cos(a) * r0, Math.sin(a)]); }
  for (let k = 0; k <= ring; k++) { const a = (k / ring) * (Math.PI / 2); rows.push([L + Math.sin(a) * r1, Math.cos(a) * r1, Math.sin(a)]); }
  for (const [y, r, ny] of rows) {
    const nr = Math.sqrt(Math.max(0, 1 - ny * ny));
    for (let i = 0; i <= seg; i++) { const t = (i / seg) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); P.push(r * c, y, r * s); N.push(nr * c, ny, nr * s); }
  }
  const W = seg + 1;
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < seg; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; I.push(a, c, b, b, c, d); }
  return { P, N, I };
}

/** The rotation taking +y onto unit d, as a quaternion [x, y, z, w]. */
function yTo(d) {
  if (d[1] < -0.999999) return [1, 0, 0, 0];
  const q = [d[2], 0, -d[0], 1 + d[1]], l = Math.hypot(...q);
  return q.map((x) => x / l);
}
/** A rotation matrix (columns X, Y, Z) as a quaternion. */
function matQuat(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const l = Math.hypot(...q); return q.map((x) => x / l);
}
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/**
 * The scene and its played poses as a .glb file (Uint8Array). motion is what playPoses returned for the scene.
 * Units are metres, y up, as in the scene; one animation, "action", runs the length of the clip.
 */
export function exportGLB(scene, motion) {
  const json = { asset: { version: '2.0', generator: 'Gait Bench' }, scene: 0, scenes: [{ name: scene.id, nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = []; let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); if (pad) chunks.push(new Uint8Array(pad)); offset += bytes.length + pad;
    return json.bufferViews.length - 1;
  };
  const accessor = (typed, type, comp, count, extra = {}, target) => { json.accessors.push({ bufferView: push(typed, target), componentType: comp, count, type, ...extra }); return json.accessors.length - 1; };
  const vec3 = (arr, target = 34962) => {
    const f = Float32Array.from(arr), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < f.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], f[i + k]); mx[k] = Math.max(mx[k], f[i + k]); }
    return accessor(f, 'VEC3', 5126, f.length / 3, { min: mn, max: mx }, target);
  };
  const mats = new Map();
  const material = (col, extra = {}) => {
    const key = `${col.join(',')}|${JSON.stringify(extra)}`;
    if (!mats.has(key)) { json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...col.map(toLinear), 1], metallicFactor: 0, roughnessFactor: 0.8 }, ...extra }); mats.set(key, json.materials.length - 1); }
    return mats.get(key);
  };
  const mesh = (name, m, mat, colours) => {
    const attributes = { POSITION: vec3(m.P), NORMAL: vec3(m.N) };
    if (colours) attributes.COLOR_0 = accessor(Float32Array.from(colours), 'VEC3', 5126, colours.length / 3, {}, 34962);
    const big = m.P.length / 3 > 65535, idx = big ? Uint32Array.from(m.I) : Uint16Array.from(m.I);
    json.meshes.push({ name, primitives: [{ attributes, indices: accessor(idx, 'SCALAR', big ? 5125 : 5123, idx.length, {}, 34963), material: mat }] });
    return json.meshes.length - 1;
  };
  const node = (n) => { json.nodes.push(n); json.scenes[0].nodes.push(json.nodes.length - 1); return json.nodes.length - 1; };

  // ---- the ground: the terrain near the person, or a flat plane ----
  const TR = terrainOf(scene), g = scene.ground ?? {};
  {
    const T = scene.terrain ?? {}, size = Math.min(60, T.near?.size_m ?? 30), cell = Math.max(0.2, T.near?.cell_m ?? 0.5), n = Math.round(size / cell);
    const c0 = TR?.centre ?? (scene.poses?.[0]?.at ?? [0, 4]), P = [], N = [], C = [], I = [], base = rgb(g.colour, [139, 141, 134]);
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = c0[0] - size / 2 + i * cell, z = c0[1] - size / 2 + j * cell, y = TR ? TR.height(x, z) : 0;
      P.push(x, y, z);
      const e = 0.05, nn = TR ? norm([-(TR.height(x + e, z) - TR.height(x - e, z)) / (2 * e), 1, -(TR.height(x, z + e) - TR.height(x, z - e)) / (2 * e)]) : [0, 1, 0]; N.push(...nn);
      let col = base;
      if (TR) { const m = TR.material(x, z, cell); col = m.pcol ? m.col.map((v, k) => v + (m.pcol[k] - v) * m.patch) : m.col; }
      C.push(...col.map(toLinear));
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    node({ name: 'ground', mesh: mesh('ground', { P, N, I }, material([255, 255, 255]), C) });
  }
  // ---- props ----
  propParts(scene, TR ? TR.height : () => 0).forEach((it, k) => {
    const d = sub(it.B, it.A), L = len(d);
    node({ name: `prop-${k}`, mesh: mesh(`prop-${k}`, capsuleMesh(L, it.rA, it.rB), material(it.col)), translation: it.A, rotation: L > 1e-6 ? yTo(mul(d, 1 / L)) : [0, 0, 0, 1] });
  });

  // ---- the figure: every part the renderer draws, moving frame by frame ----
  const look = figureLook(scene, motion.dims), F = motion.frames, nF = F.length;
  const parts = F.map((fr) => look.parts(fr));
  const times = Float32Array.from(F.map((fr) => fr.t)), input = accessor(times, 'SCALAR', 5126, nF, { min: [times[0]], max: [times[nF - 1]] });
  const channels = [], samplers = [];
  const animate = (nodeIx, path, data, type) => {
    const out = accessor(Float32Array.from(data), type, 5126, nF);
    samplers.push({ input, output: out, interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: nodeIx, path } });
  };
  const figure = { name: 'figure', children: [] };
  const fIx = node(figure);
  const child = (n) => { json.nodes.push(n); figure.children.push(json.nodes.length - 1); return json.nodes.length - 1; };
  const FW = scene.figure.footwear, P0 = FW.mesh ? prepareShoe(FW.mesh, FW) : null;
  parts[0].forEach((it0, k) => {
    if (it0.mesh) {
      // a real shoe: its mesh in the shoe's own frame (left mirrored), carried by the foot
      if (!P0) return;
      const [xs, ys] = P0.seat, [xb] = P0.ball;
      let m1 = [xb - xs, -ys]; const ml = Math.hypot(m1[0], m1[1]) || 1; m1 = [m1[0] / ml, m1[1] / ml];
      let m2 = [-m1[1], m1[0]]; if (m2[1] < 0) m2 = [-m2[0], -m2[1]];
      const mir = it0.sd === 'l' ? -1 : 1, V = P0.V, P = [], C = [], I = [];
      for (let i = 0; i < P0.n; i++) { const x = V[i * 3] - xs, y = V[i * 3 + 1] - ys; P.push(x * m1[0] + y * m1[1], x * m2[0] + y * m2[1], mir * V[i * 3 + 2]); C.push(toLinear(P0.C[i * 3]), toLinear(P0.C[i * 3 + 1]), toLinear(P0.C[i * 3 + 2])); }
      for (let t = 0; t < P0.F.length; t += 3) mir < 0 ? I.push(P0.F[t], P0.F[t + 2], P0.F[t + 1]) : I.push(P0.F[t], P0.F[t + 1], P0.F[t + 2]);
      // normals from the faces
      const Nn = new Float32Array(P.length);
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], n = cross(u, v);
        for (const q of [a, b, c]) { Nn[q] += n[0]; Nn[q + 1] += n[1]; Nn[q + 2] += n[2]; }
      }
      for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
      const ix = child({ name: `shoe-${it0.sd}`, mesh: mesh(`shoe-${it0.sd}`, { P, N: Array.from(Nn), I }, material([255, 255, 255], { doubleSided: true }), C) });
      const T = [], R = []; let prev = null;
      for (const ps of parts) {
        const it = ps[k], e1 = norm(sub(it.sh.platBall, it.sh.heelSole));
        let r = norm(sub(it.right, mul(e1, dot(it.right, e1)))), up = norm(cross(r, e1));
        if (up[1] < 0) { up = mul(up, -1); r = mul(r, -1); }
        let q = matQuat(e1, up, r); if (prev && dot(prev, q) < 0) q = q.map((x) => -x); prev = q;
        T.push(...it.sh.heelSole); R.push(...q);
      }
      animate(ix, 'translation', T, 'VEC3'); animate(ix, 'rotation', R, 'VEC4');
      return;
    }
    // a capsule part: made at its first length, moved, turned and stretched along its axis to follow the figure
    const L0 = Math.max(1e-4, len(sub(it0.B, it0.A)));
    const ix = child({ name: `part-${k}`, mesh: mesh(`part-${k}`, capsuleMesh(L0, it0.rA, it0.rB), material(it0.col)) });
    const T = [], R = [], S = []; let prev = null;
    for (const ps of parts) {
      const it = ps[k], d = sub(it.B, it.A), L = len(d);
      let q = L > 1e-6 ? yTo(mul(d, 1 / L)) : [0, 0, 0, 1]; if (prev && dot(prev, q) < 0) q = q.map((x) => -x); prev = q;
      T.push(...it.A); R.push(...q); S.push(1, L0 > 1e-3 ? L / L0 : 1, 1);
    }
    animate(ix, 'translation', T, 'VEC3'); animate(ix, 'rotation', R, 'VEC4'); animate(ix, 'scale', S, 'VEC3');
  });
  void fIx;
  json.animations = [{ name: 'action', channels, samplers }];

  // ---- the binary container ----
  json.buffers[0].byteLength = offset;
  const enc = new TextEncoder(), js = enc.encode(JSON.stringify(json)), jpad = (4 - (js.length % 4)) % 4;
  const total = 12 + 8 + js.length + jpad + 8 + offset, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20); for (let i = 0; i < jpad; i++) out[20 + js.length + i] = 0x20;
  let o = 20 + js.length + jpad;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

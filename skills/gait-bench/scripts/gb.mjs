#!/usr/bin/env node
// gb.mjs — Gait Bench 1.2: Claude reasons a basic scene out of a video, and a plausible figure acts it out.
//   look VIDEO     a gridded frame sheet and a scene.json to fill in
//   check SCENE    builds the figure and the camera, and compares them with what Claude saw
//   render SCENE   MP4 (or a still) from the reasoned camera, optionally beside the original
//   view SCENE     a self-contained page to play and orbit the scene
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, basename, extname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { tools, requireFfmpeg, hasX264, probe, gridFrame, tileImages, encode, writeStill } from './lib/media.mjs';
import { SCENE_SCHEMA, SECTIONS, normaliseScene, cameraTrack } from './lib/scene.mjs';
import { animate, balanceOf } from './lib/walker.mjs';
import { makeRenderer, figureBox } from './lib/draw.mjs';
import { prepareShoe, poseShoe } from './lib/shoemesh.mjs';
import { groundEdgeReport, edgeRow, groundStops } from './lib/groundedge.mjs';
import { makeTerrain } from './lib/terrain.mjs';
import { inWood } from './lib/world.mjs';
import { poseReport } from './lib/posefit.mjs';
import { SHOE_SHAPES, shapeModel, shapeName } from './lib/shoeshapes.mjs';
import { surfaceMu, frictionDemand, carefulGait } from './lib/physics.mjs';

export const VERSION = '1.8.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, k = 2) => Math.round(x * 10 ** k) / 10 ** k;
const die = (msg) => { console.error(`gb: ${msg}`); process.exit(1); };

const HELP = `Gait Bench ${VERSION}: a reasoned scene with a plausible figure acting out the video

  setup                           check Node and ffmpeg
  look VIDEO [--out DIR]          frame sheet (sheet.jpg) plus DIR/scene.json to fill in; reports the real frame rate
  check SCENE [--json]            build the figure and camera; compare with the boxes in "observed" and the landings
                                  in "contacts"; list each section's evidence and the alternatives
  describe SCENE                  the summary for the chat, written from the scene's own values, so what you say and
                                  what the render shows can't drift apart
  render SCENE [--still T] [--compare] [--look clay|contact] [--out FILE]
                                  MP4 from the reasoned camera (or one PNG at T s); --compare puts the original beside it.
                                  --look clay draws it in neutral greys, contact also marks each planted (blue) and
                                  sliding (orange) sole: references for video models. A still marks the traced
                                  ground edges (green), the rendered edge (magenta) and the boxes (yellow); --no-marks leaves them off
  studio [SCENE] [--video FILE] [--original ASSET] [--capture ID] [--clip NAME] [--out FILE]
                                  the Gait Bench Studio panel for the Claude app (an artifact): the example scene
                                  until a capture exists, then the result with preview and save. --video names the
                                  rendered MP4, published beside the page as captures/ID.mp4; a .history.json is
                                  written for the studio's list of earlier captures. --original is the asset id of
                                  the clip in the studio's storage; it plays in the Original panel
  version [--check]               the plugin's version; --check compares it with the one on gait.nulytica.com
  shoes                           the shoe shapes figure.footwear.style can name (references/shoes.md)
  view SCENE [--no-video] [--artifact] [--out FILE]
                                  one HTML page: the original beside the reconstruction, synced; pop-out window,
                                  fullscreen, orbit (--no-video leaves the clip out; it can be dropped in later).
                                  --artifact writes it for a Claude artifact: no clip inside, and a Clip area that
                                  can send the next clip to Claude for a new capture
  help

The scene format and how to reason it out: references/scene.md`;

// ---------- look ----------
/** How many frames actually differ from the one before: phone and social-media exports often pad 15 fps to 25 or 30. */
function uniqueFrames(video, p) {
  const { ffmpeg } = requireFfmpeg();
  const w = 32, h = Math.max(2, Math.round((32 * p.height) / p.width / 2) * 2);
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const buf = r.stdout, n = Math.floor(buf.length / (w * h)), diff = [];
  for (let i = 1; i < n; i++) {
    let d = 0;
    for (let j = 0; j < w * h; j++) d += Math.abs(buf[i * w * h + j] - buf[(i - 1) * w * h + j]);
    diff.push(d / (w * h));
  }
  // a padded frame repeats the one before almost exactly; a smooth, slow clip (a tracking shot, generated video)
  // changes little between frames but never repeats, so the test is against the clip's own motion, not a fixed level
  const q75 = [...diff].sort((p, q) => p - q)[Math.floor(diff.length * 0.75)] ?? 0, still = Math.max(0.04, 0.15 * q75);
  return { frames: n, unique: (n ? 1 : 0) + diff.filter((d) => d > still).length };
}

function cmdLook(pos, opt) {
  const video = pos[0] && resolve(pos[0]);
  if (!video) die('look needs a video');
  const p = probe(video);
  const dir = resolve(opt.out ?? join(dirname(video), `${basename(video, extname(video))}-gb`));
  mkdirSync(dir, { recursive: true });
  const n = Number(opt.n ?? 8), files = [], times = [];
  for (let i = 0; i < n; i++) {
    const t = round((p.duration * (i + 0.5)) / n, 2);
    files.push(gridFrame(video, t, join(dir, `S${i}.jpg`), { long: 480, label: `S${i} ${t.toFixed(2)}s` }));
    times.push(t);
  }
  const sheet = tileImages(files, join(dir, 'sheet.jpg'), 4, 480);
  const u = uniqueFrames(video, p);
  const realFps = u && p.duration > 0 ? u.unique / p.duration : p.fps;
  const padded = u && u.unique < u.frames * 0.85;
  const scenePath = join(dir, 'scene.json'), isNew = !existsSync(scenePath);
  if (isNew) writeFileSync(scenePath, JSON.stringify(skeleton(video, p, padded ? round(realFps, 1) : p.fps), null, 2) + '\n');
  console.log(`${basename(video)}: ${p.width}×${p.height}, ${round(p.duration)} s at ${round(p.fps)} fps`);
  if (padded) console.log(`  only ${u.unique} of ${u.frames} frames differ: about ${round(realFps, 1)} fps padded to ${round(p.fps)}, so the render runs at ${round(realFps, 1)} fps`);
  console.log(`  sheet: ${sheet}  (S0–S${n - 1} at ${times.join(', ')} s, gridded 0–1000)`);
  console.log(`  scene: ${scenePath}${isNew ? ' (new)' : ' (kept as it was)'}`);
  console.log('next ▸ view the sheet, reason out the scene (references/scene.md), fill in scene.json, then `check` it');
}

function skeleton(video, p, fps) {
  return {
    schema: SCENE_SCHEMA, id: basename(video, extname(video)).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    source: { video, width: p.width, height: p.height, fps, duration_s: round(p.duration, 2) },
    ground: { colour: '#8b8d86', patches: null, shine: 0, confidence: 'unknown', basis: 'assumed', why: '' },
    sky: { zenith: '#4a86d0', horizon: '#d6e2ec', why: '' },
    sun: { azimuth_deg: 160, elevation_deg: 35, why: '' },
    far: [], props: [],
    figure: { stature_m: 1.7, build: 'average', hair: 'short', sleeves: 'short', footwear: { heel_cm: 2.5, platform_cm: 1 }, colours: { skin: '#d9b08c', hair: '#2a2018', top: '#6a7f99', bottom: '#2d3440', shoes: '#222222' }, confidence: 'unknown', basis: 'assumed', why: '' },
    activity: { kind: 'walk', path: [[0, 4], [0, 10]], speed_mps: 1.2, cadence_spm: 108, step_width_m: 0.08, style: 'normal', arms: { left: 'swing', right: 'swing' }, gestures: [], confidence: 'unknown', basis: 'assumed', why: '' },
    camera: { lens: 'main', height_m: 1.4, path: [{ t: 0, at: [0, 0] }], aim: 'figure', aim_offset: [0, 0], shake: 0.3, confidence: 'unknown', basis: 'assumed', why: '' },
    observed: [], contacts: [], alternatives: [],
  };
}

// ---------- build ----------
/** Where footwear.model ids are looked up, after a shoes/ folder beside the scene: the plugin's own shoes, then any
 * folders in GB_SHOE_LIBS (separated by the platform's path separator), then the walk-scene shoe library's session folder. */
const SHOE_LIBS = [join(HERE, '..', 'shoes'), ...(process.env.GB_SHOE_LIBS ?? '').split(delimiter).filter(Boolean), '/home/claude/shoe-library'];
/** footwear.model: a library shoe id, or a model.json path relative to the scene. The mesh is attached as footwear.mesh. */
const sizeNotes = [];
function withModels(raw, file) {
  const fw = raw?.figure?.footwear;
  // a named shape is drawn with the real model nearest to it, at the shape's typical heel unless the scene gives one
  const real = shapeModel(fw);
  if (real) {
    const sh = SHOE_SHAPES[shapeName(fw)];
    fw.model = real.model;
    if (fw.heel_cm == null) fw.heel_cm = sh.heel_cm;
    if (fw.platform_cm == null) fw.platform_cm = Math.min(sh.platform_cm, fw.heel_cm);
    sizeNotes.push(`footwear.style "${fw.style}" is drawn with the real model "${real.model}"${real.near ? ` (${real.near})` : ''}`);
  }
  if (!fw || typeof fw.model !== 'string') return raw;
  const here = dirname(resolve(file));
  const cands = fw.model.endsWith('.json') ? [resolve(here, fw.model)] : [join(here, 'shoes', fw.model, 'model.json'), ...SHOE_LIBS.map((d) => join(d, fw.model, 'model.json'))];
  const p = cands.find((c) => existsSync(c));
  if (!p) die(`footwear.model "${fw.model}" not found; looked in:\n  ${cands.join('\n  ')}`);
  const m = JSON.parse(readFileSync(p, 'utf8'));
  if (m.format !== 'walkscene.shoe.v1') die(`${p} is not a walkscene.shoe.v1 model`);
  // a traced shoe is the size of the pair that was photographed; unless the scene gives a length, it is sized to the
  // wearer, so the foot inside it is about 0.152 × stature long (Winter)
  if (!fw.length_cm) {
    const H = raw.figure.stature_m ?? 1.7, want = 0.152 * H;
    let k = 1;
    for (let it = 0; it < 4; it++) {
      const fwk = { ...fw, length_cm: m.length_m * 100 * k };
      if (fwk.heel_cm == null) fwk.heel_cm = m.heel_m * k * 100;
      if (fwk.platform_cm == null) fwk.platform_cm = m.platform_m * k * 100;
      k *= want / prepareShoe(m, fwk).footLen;
    }
    fw.length_cm = Math.round(m.length_m * k * 1000) / 10;
    sizeNotes.push(`footwear.length_cm set to ${fw.length_cm} cm, so "${fw.model}" fits a ${H} m wearer (the model is ${Math.round(m.length_m * 1000) / 10} cm)`);
  }
  const k = fw.length_cm / 100 / m.length_m;
  fw.mesh = m;
  if (fw.heel_cm == null) fw.heel_cm = Math.round(m.heel_m * k * 1000) / 10;
  if (fw.platform_cm == null) fw.platform_cm = Math.round(m.platform_m * k * 1000) / 10;
  if (fw.heel_clear == null) fw.heel_clear = m.heel_clear;
  return raw;
}

export function load(file, { look } = {}) {
  if (!file) die('give a scene.json');
  let raw;
  try { raw = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (e) { die(`can't read ${file}: ${e.message}`); }
  sizeNotes.length = 0;
  if (look) raw.look = look;
  withModels(raw, file);
  const { scene, problems, notes } = normaliseScene(raw);
  if (problems.length) die(`the scene has problems:\n  - ${problems.join('\n  - ')}`);
  const motion = animate(scene), cams = cameraTrack(scene, motion.frames);
  return { scene, motion, cams, notes: [...sizeNotes, ...notes, ...motion.notes], file: resolve(file) };
}
const nearest = (frames, t) => frames.reduce((b, f, i) => (Math.abs(f.t - t) < Math.abs(frames[b].t - t) ? i : b), 0);

/** Plausibility of the walk and the framing, and a comparison with the boxes Claude read off the sheet. */
export function report({ scene, motion, cams }) {
  const out = { walk: {}, camera: {}, observed: [], advice: [], hints: [] };
  const a = scene.activity, H = scene.figure.stature_m, { width: W, height: Hh } = scene.output;
  if (a.kind === 'walk') {
    const L = motion.stats.step_length_m, rel = L / H;
    out.walk = { step_length_m: round(L), step_per_stature: round(rel), speed_mps: a.speed_mps, cadence_spm: a.cadence_spm, distance_m: round(motion.stats.distance_m), path_length_m: round(motion.stats.path_length_m) };
    const heels = scene.figure.footwear.heel_cm >= 7;
    if (rel > (heels ? 0.42 : 0.5)) out.advice.push(`steps of ${round(L)} m are long for a ${H} m figure${heels ? ' in high heels' : ''}: lower the speed or raise the cadence`);
    if ((a.step_width_m ?? 0) < -0.04) out.advice.push(`step_width_m is ${a.step_width_m}: a negative width puts each foot past the midline, so the legs cross. If the feet are seen apart, use a positive width (e.g. ${Math.abs(a.step_width_m)})`);
    if (rel < 0.15) out.advice.push(`steps of ${round(L)} m are very short: raise the speed or lower the cadence`);
    if (motion.stats.distance_m > motion.stats.path_length_m + 0.5) out.advice.push(`the figure walks ${round(motion.stats.distance_m)} m but the path is ${round(motion.stats.path_length_m)} m: it carries straight on past the end`);
  }
  const fl = motion.dims.footLen, want = 0.152 * H;
  if (Math.abs(fl / want - 1) > 0.08) out.advice.push(`the shoe fits a foot ${round(fl * 100)} cm long, but a ${H} m person's foot is about ${round(want * 100)} cm: set footwear.length_cm so the shoe matches the wearer (or leave it out and the library shoe is sized for you)`);
  const dist = motion.frames.map((f, i) => Math.hypot(f.nodes.waist[0] - cams[i].eye[0], f.nodes.waist[2] - cams[i].eye[2]));
  const sorted = [...dist].sort((p, q) => p - q);
  let outside = 0;
  const boxes = motion.frames.map((f, i) => { const b = figureBox(scene, motion.dims, f, cams[i]); const m = 0.03; if (b[0] < -m * W || b[2] > (1 + m) * W || b[1] < -m * Hh || b[3] > (1 + m) * Hh) outside++; return b; });
  const share = (b) => round((b[3] - b[1]) / Hh);
  out.camera = {
    hfov_deg: round(scene.camera.hfov_deg, 1), distance_m: { min: round(sorted[0]), median: round(sorted[sorted.length >> 1]), max: round(sorted[sorted.length - 1]) },
    figure_height_in_frame: { start: share(boxes[0]), middle: share(boxes[boxes.length >> 1]), end: share(boxes[boxes.length - 1]) },
    turned_deg: round(cams[cams.length - 1].yaw - cams[0].yaw, 1),
    frames_cut_off: outside,
  };
  const seenCut = scene.observed.some((o) => !o.foot && (o.box[1] <= 5 || o.box[3] >= 995 || o.box[0] <= 5 || o.box[2] >= 995));
  if (outside > motion.frames.length * 0.2 && !seenCut) out.advice.push(`the figure is partly out of frame (by more than 3%) in ${outside} of ${motion.frames.length} frames`);
  for (const o of scene.observed.filter((x) => !x.foot)) {
    const i = nearest(motion.frames, o.t), b = boxes[i], g = (x, s) => Math.round((x / s) * 1000);
    // the frame cuts both boxes alike: a person whose head is out of frame is compared with the figure cut the same way
    const r = [g(b[0], W), g(b[1], Hh), g(b[2], W), g(b[3], Hh)].map((x) => Math.max(0, Math.min(1000, x)));
    const cutTop = o.box[1] <= 5, cutBottom = o.box[3] >= 995;
    // cut at the top or bottom, the box's height says where the frame edge falls, not how big the person is: then only
    // the uncut edge is compared (the feet line, usually), and size is left to the shoe boxes
    const ratio = cutTop || cutBottom ? null : (r[3] - r[1]) / Math.max(1, o.box[3] - o.box[1]);
    const dx = (r[0] + r[2]) / 2 - (o.box[0] + o.box[2]) / 2;
    const dy = cutTop && !cutBottom ? r[3] - o.box[3] : cutBottom && !cutTop ? r[1] - o.box[1] : (r[1] + r[3]) / 2 - (o.box[1] + o.box[3]) / 2;
    out.observed.push({ t: o.t, seen: o.box, rendered: r, size_ratio: ratio == null ? null : round(ratio), centre_shift: [Math.round(dx), Math.round(dy)], ...(ratio == null ? { cut: cutTop ? (cutBottom ? 'top and bottom' : 'top') : 'bottom' } : {}) });
    if (ratio == null) out.hints.push(`at ${o.t} s the person is cut off at the ${cutTop ? (cutBottom ? 'top and bottom' : 'top') : 'bottom'} of the frame, so size is not compared there${cutTop && !cutBottom ? ' (only the feet line is)' : ''}: add a shoe box (observed {t, foot, box}) to check the scale`);
    else if (Math.abs(ratio - 1) > 0.15) out.advice.push(`at ${o.t} s the figure is ${Math.round(Math.abs(ratio - 1) * 100)}% too ${ratio > 1 ? 'big' : 'small'}: it would match with the camera about ${round(dist[i] * ratio, 1)} m from the figure instead of ${round(dist[i], 1)} m (or with another lens)`);
    if (Math.abs(dx) > 80) out.advice.push(`at ${o.t} s the figure sits ${Math.abs(Math.round(dx))} grid units too far ${dx > 0 ? 'right' : 'left'}: move the path or the camera, or change aim_offset x by about ${round(-dx / 1000, 2)}`);
    if (Math.abs(dy) > 80) out.advice.push(`at ${o.t} s the figure sits ${Math.abs(Math.round(dy))} grid units too ${dy > 0 ? 'low' : 'high'}: change the camera height or pitch, or aim_offset y by about ${round(-dy / 1000, 2)}`);
  }
  footScaleReport(scene, motion, cams, boxes, out);
  frictionReport(scene, motion, out);
  contactsReport(scene, motion, out);
  evidenceReport(scene, out);
  syncReport(scene, out, motion.dims);
  groundReport(scene, motion, out);
  if (scene.observed_joints.length) {
    const g = out.pose = poseReport(scene, motion);
    if (g && g.rms > 40) {
      const best = g.tries.slice(0, 3).map((k) => `${k.name} ${k.from} → ${k.to} (joints off by ${k.rms})`).join('; ');
      out.advice.push(`the figure's joints are off the marked ones by about ${g.rms} grid units (worst: ${g.worst.map((w) => `${w.joint} at ${w.t} s by ${w.off}`).join(', ')})${best ? `: the single changes that bring them closest: ${best}. Make the one the footage supports, then check again` : ': no single lever helps; the pose itself is wrong there (a gesture, a slip, a pause)'}`);
    }
  }
  return out;
}

/**
 * Is the foot human-sized for this person? First by proportion (the foot inside the shoe is about 0.152 × stature,
 * people run 0.135–0.165; Winter), then against the footage: a shoe box read off a frame, compared with the figure in
 * the same frame, gives this subject's shoe-to-height proportion whatever the camera distance.
 */
function footScaleReport(scene, motion, cams, boxes, out) {
  const H = scene.figure.stature_m, fw = scene.figure.footwear, D = motion.dims, fl = D.footLen;
  const shoeLen = fw.mesh ? (fw.length_cm ?? fw.mesh.length_m * 100) / 100 : fl + 0.015;
  const f = out.foot = { foot_length_cm: round(fl * 100, 1), foot_per_stature: round(fl / H, 3), shoe_length_cm: round(shoeLen * 100, 1), toe_room_cm: round((shoeLen - fl) * 100, 1), heel_per_foot: round(D.heel / fl, 2), seen: [] };
  if (f.foot_per_stature < 0.135 || f.foot_per_stature > 0.165) out.advice.push(`the foot is ${f.foot_per_stature} × stature (${f.foot_length_cm} cm for ${H} m); human feet run 0.135–0.165 × stature: check the stature, or set footwear.length_cm`);
  if (fw.mesh && (f.toe_room_cm < -0.5 || f.toe_room_cm > 8)) out.advice.push(`the shoe is ${f.toe_room_cm} cm longer than the foot inside it; shoes run 0.5–6 cm longer (more for long pointed toes): the shoe or the length is wrong`);
  if (f.heel_per_foot > 0.75) out.advice.push(`a ${round(D.heel * 100, 1)} cm heel is ${f.heel_per_foot} × the foot's length: no one can stand in that; lower heel_cm`);
  else if (f.heel_per_foot > 0.6) out.hints.push(`a ${round(D.heel * 100, 1)} cm heel is ${f.heel_per_foot} × the foot's length: extreme (platform stilettos reach this); be sure the footage shows it`);
  const W = scene.output.width, Hh = scene.output.height, diag = (b) => Math.hypot((b[2] - b[0]) * W / 1000, (b[3] - b[1]) * Hh / 1000);
  const P = fw.mesh ? prepareShoe(fw.mesh, fw) : null;
  for (const o of scene.observed.filter((x) => x.foot)) {
    const i = nearest(motion.frames, o.t), fr = motion.frames[i], sd = o.foot === 'left' ? 'l' : 'r', cam = cams[i];
    const pts = [];
    if (P) { const Wv = poseShoe(P, fr.shoe[sd], sd, vecSub(fr.nodes.hip_r, fr.nodes.hip_l)); for (let k = 0; k < Wv.length; k += 3) pts.push([Wv[k], Wv[k + 1], Wv[k + 2]]); }
    else pts.push(...['heelTip', 'heelSole', 'platBall', 'platToe'].map((k) => fr.shoe[sd][k]), fr.nodes[`ankle_${sd}`], fr.nodes[`toe_${sd}`]);
    const pr = pts.map((p) => cam.project(p)).filter((p) => p[2] > 0.05);
    if (!pr.length) continue;
    const rb = [Math.min(...pr.map((p) => p[0])), Math.min(...pr.map((p) => p[1])), Math.max(...pr.map((p) => p[0])), Math.max(...pr.map((p) => p[1]))];
    const seenFig = scene.observed.filter((x) => !x.foot).sort((a, b) => Math.abs(a.t - o.t) - Math.abs(b.t - o.t))[0];
    const figSeen = seenFig && Math.abs(seenFig.t - o.t) <= 0.5 && seenFig.box[1] > 5 && seenFig.box[3] < 995 ? (seenFig.box[3] - seenFig.box[1]) * Hh / 1000 : null;
    const figRend = boxes[i][3] - boxes[i][1];
    const rendRel = Math.hypot(rb[2] - rb[0], rb[3] - rb[1]) / figRend, seenRel = figSeen ? diag(o.box) / figSeen : null;
    const size = diag(o.box) / Math.max(1, Math.hypot(rb[2] - rb[0], rb[3] - rb[1]));
    const row = { t: o.t, foot: o.foot, size_ratio: round(size), shoe_per_figure_seen: seenRel && round(seenRel, 3), shoe_per_figure_rendered: round(rendRel, 3) };
    f.seen.push(row);
    if (seenRel) {
      const k = seenRel / rendRel;
      if (Math.abs(k - 1) > 0.2) out.advice.push(`at ${o.t} s the ${o.foot} shoe is ${Math.round(Math.abs(k - 1) * 100)}% ${k > 1 ? 'bigger' : 'smaller'} for the person's height than rendered: if the stature is right, footwear.length_cm about ${round(shoeLen * 100 * k, 1)}; if the foot looks ordinary, the stature (${H} m) is probably off. A shoe box is rough: give its toe-to-heel extent in a frame where the foot is side-on`);
    } else if (Math.abs(size - 1) > 0.25) out.hints.push(`at ${o.t} s the ${o.foot} shoe is ${size > 1 ? 'larger' : 'smaller'} on screen than rendered (×${round(size)}); add a whole-figure box near that time (not cut off by the frame) to tell foot size from camera distance`);
  }
}
const vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Friction under the feet (lib/physics.mjs, from the ice-walk sim): does the walk ask more of the ground than it
 * has? Run on the walk as it will be drawn (after any cap/sim mix), at 60 frames a second.
 */
function frictionReport(scene, motion, out) {
  if (scene.activity.kind !== 'walk') return;
  const mu = surfaceMu(scene), m = scene.activity.mix ?? 0;
  const fine = animate({ ...scene, output: { ...scene.output, fps: 60 } });
  const d = frictionDemand(fine.frames, mu), peak = d.need.reduce((p, q) => Math.max(p, q.r), 0);
  const known = [...(scene.activity.slips ?? []), ...(fine.hybrid?.added ?? [])];
  const unexplained = d.events.filter((e) => !known.some((q) => /^l/i.test(String(q.foot)) === (e.foot === 'left') && q.from_s < e.walk_to + 0.2 && q.to_s > e.walk_from - 0.2));
  const careful = carefulGait(mu), T = 120 / scene.activity.cadence_spm;
  out.friction = { surface: scene.ground.surface ?? (Number.isFinite(scene.ground.friction) ? 'given' : 'dry (assumed)'), mu: round(mu, 2), peak_need: round(peak, 2), would_slip: d.events.length, unexplained: unexplained.length, mix: m, careful: careful && { step_m: round(careful.step_m), cadence_spm: round(careful.cadence_spm, 0) }, step_m: round((scene.activity.speed_mps * T) / 2), hybrid: motion.hybrid ?? null };
  if (!(m > 0) && unexplained.length) {
    out.advice.push(`${unexplained.length} planted step${unexplained.length > 1 ? 's need' : ' needs'} more grip than ${out.friction.surface} gives (up to ${out.friction.peak_need} against μ ${out.friction.mu})${careful ? `; careful walkers there take about ${round(careful.step_m)} m steps at ${round(careful.cadence_spm, 0)}/min (these are ${out.friction.step_m} m)` : ''}: add the slips you see, shorten the steps, or let the physics in with activity.mix`);
  }
  if (!scene.ground.surface && !Number.isFinite(scene.ground.friction)) out.hints.push('ground.surface is not given (dry, wet, grass, snow, ice, wet_ice, black_ice): friction is taken as dry');
}

/** Landings and lifts as the walker makes them, per side, read off the frames (so pauses and slips are included). */
export function footEvents(frames) {
  const ev = { left: { on: [], off: [] }, right: { on: [], off: [] } };
  for (const [side, k] of [['left', 'l'], ['right', 'r']]) {
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].contact[k] !== 'swing', b = frames[i].contact[k] !== 'swing';
      if (!a && b) ev[side].on.push(frames[i].t);
      if (a && !b) ev[side].off.push(frames[i].t);
    }
  }
  return ev;
}

/** step_offset_s as the walker uses it (its default is a fifth of a stride before 0). */
const offsetNow = (scene, motion) => scene.activity.step_offset_s ?? -0.2 * motion.stats.stride_s;

/** The contacts Claude read off the frames against the walker's own: signed timing error (+: the walker is late). */
function contactsReport(scene, motion, out) {
  if (!scene.contacts.length) return;
  const ev = footEvents(motion.frames), dt = 1 / scene.output.fps, rows = [];
  const near = (list, t) => (list.length ? list.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b)) : null);
  for (const c of scene.contacts) {
    const on = near(ev[c.foot].on, c.on_s), off = c.off_s != null ? near(ev[c.foot].off, c.off_s) : null;
    rows.push({ foot: c.foot, on_s: c.on_s, walker_on_s: on, on_err_s: on == null ? null : round(on - c.on_s), off_s: c.off_s ?? null, walker_off_s: off, off_err_s: off == null || c.off_s == null ? null : round(off - c.off_s) });
  }
  const errs = rows.filter((r) => r.on_err_s != null).map((r) => r.on_err_s);
  const abs = errs.map(Math.abs).sort((p, q) => p - q), mean = errs.reduce((p, q) => p + q, 0) / Math.max(1, errs.length);
  out.contacts = { events: rows, landing_error_s: errs.length ? { median: round(abs[abs.length >> 1]), max: round(abs[abs.length - 1]), mean_signed: round(mean) } : null, frame_s: round(dt, 3) };
  const missing = rows.filter((r) => r.walker_on_s == null).length;
  if (missing) out.advice.push(`${missing} observed landing${missing > 1 ? 's have' : ' has'} no walker landing on that foot: the figure may be standing, or the foot is wrong`);
  if (!errs.length) return;
  const spread = Math.sqrt(errs.reduce((p, q) => p + (q - mean) ** 2, 0) / errs.length);
  if (abs[abs.length - 1] > 0.12 && Math.abs(mean) > 0.06 && spread < 0.08) {
    out.advice.push(`the walker lands ${round(Math.abs(mean))} s ${mean > 0 ? 'late' : 'early'} on average: shift activity.step_offset_s to about ${round(offsetNow(scene, motion) - mean)} s (now ${round(offsetNow(scene, motion))})`);
  } else if (abs[abs.length - 1] > 0.12) {
    // the other foot fits better? then start_foot is the wrong way round
    const swapped = scene.contacts.map((c) => near(ev[c.foot === 'left' ? 'right' : 'left'].on, c.on_s)).map((t, i) => (t == null ? Infinity : Math.abs(t - scene.contacts[i].on_s)));
    const sw = [...swapped].sort((p, q) => p - q)[swapped.length >> 1];
    if (sw < abs[abs.length >> 1] * 0.6) out.advice.push(`the landings fit the other foot better: try activity.start_foot "${scene.activity.start_foot === 'left' ? 'right' : 'left'}"`);
    else out.advice.push(`landings are off by up to ${abs[abs.length - 1]} s and not by a steady amount: check the cadence (now ${scene.activity.cadence_spm} steps/min) against the time between observed landings`);
  }
  const offs = rows.filter((r) => r.off_err_s != null && Math.abs(r.off_err_s) > 0.15);
  if (offs.length) out.advice.push(`${offs.length} lift${offs.length > 1 ? 's' : ''} differ by more than 0.15 s: the stance is ${offs[0].off_err_s > 0 ? 'longer' : 'shorter'} than seen (a slower walk holds the foot down longer)`);
}

/** How sure each section is, and what else the footage could mean. Weak or unknown sections are named, never hidden. */
function evidenceReport(scene, out) {
  out.evidence = {};
  for (const k of SECTIONS) {
    const sec = scene[k];
    if (!sec || (sec.confidence == null && sec.basis == null)) continue;
    out.evidence[k] = { confidence: sec.confidence ?? null, basis: sec.basis ?? null };
  }
  out.alternatives = scene.alternatives;
  const weak = Object.entries(out.evidence).filter(([, e]) => e.confidence === 'weak' || e.confidence === 'unknown').map(([k]) => k);
  if (weak.length && !scene.alternatives.length) out.advice.push(`${weak.join(', ')} ${weak.length > 1 ? 'are' : 'is'} weak or unknown: list what else the footage could show in "alternatives"`);
  if (!Object.keys(out.evidence).length) out.hints.push('no section says how sure it is: add confidence (unknown/weak/moderate/strong) and basis (seen/inferred/assumed) at least to figure, activity, camera and ground');
}

/**
 * Does the scene hold what its own words say? Each section's "why" is read for things the scene can show (arms held
 * out, bent knees, turned-out feet, a rolled or moving camera, slips, pauses); where the words say it and the fields
 * don't, the render will contradict the description. Alternatives are other readings and are not held to this; and a
 * thing listed in "differs" (what the render can't show) is excused.
 */
const SYNC = [
  { section: 'activity', says: /\barms?\b[^.;]{0,40}\b(out|wide|spread|outstretched|raised)\b|\b(outstretched|spread) arms\b|\bfor balance\b/i, holds: (s, B) => B >= 0.7 || [s.activity.arms.left, s.activity.arms.right, ...(s.activity.gestures ?? []).map((g) => g.pose)].includes('balance'), fix: 'arms held out: set activity.arms to "balance" (or a balance gesture over the seconds they are out)' },
  { section: 'activity', says: /\bknees?\b[^.;]{0,20}\b(bent|flexed|soft)\b|\b(bent|flexed) knees?\b|\bcrouch|\bbraced\b|\bsquat/i, holds: (s, B) => B > 0.4 || (s.activity.knee_bend_deg ?? 0) >= 10, fix: 'bent knees: set activity.knee_bend_deg (about 15–30)' },
  { section: 'activity', says: /\b(toes?|feet)\b[^.;]{0,20}\b(turned out|out-?turned|splay)|\bsplay(ed|s)?\b|\bduck-?footed\b/i, holds: (s, B) => B > 0.4 || (s.activity.toe_out_deg ?? 0) >= 12 || (s.activity.step_width_m ?? 0) >= 0.15, fix: 'feet turned out or splayed: set activity.toe_out_deg (about 15–25) and a wider step_width_m' },
  { section: 'activity', says: /\b(slips?|slipp(ed|ing)|skids?|skidd(ed|ing)|slides?|slid)\b/i, not: /\b(no|never|without|doesn't|does not|didn't)\b[^.;]{0,25}\b(slip|skid|slide)/i, holds: (s) => (s.activity.slips ?? []).length > 0 || (s.activity.mix ?? 0) > 0, fix: 'a slip is described: add it to activity.slips, or raise activity.mix so the physics adds skids' },
  { section: 'activity', says: /\b(pauses?|paused|stops?|stopped|stands? still|halts?)\b/i, not: /\b(never|doesn't|does not|without)\b[^.;]{0,15}\b(pause|stop)/i, holds: (s) => (s.activity.pace ?? []).length > 0 || s.activity.kind !== 'walk', fix: 'a pause is described: add activity.pace keyframes' },
  { section: 'camera', says: /\b(rolled|tilted|canted|dutch)\b|\broll(s|ed)?\b[^.;]{0,20}\d+\s*°/i, holds: (s) => Math.abs(s.camera.roll_deg ?? 0) >= 3, fix: 'a tilted picture is described: set camera.roll_deg' },
  { section: 'camera', says: /\b(backs? away|backing|walks? backwards|tracking|tracks|dolly|follows? (her|him|them) (along|down)|moves? with)\b/i, holds: (s) => (s.camera.path ?? []).length > 1, fix: 'a moving camera is described: give camera.path two or more points' },
];
function syncReport(scene, out, dims) {
  out.sync = [];
  const B = scene.activity.kind === 'walk' || scene.activity.kind === 'stand' ? balanceOf(scene, dims).demand : 0; // what the balance layer already shows
  const excused = (scene.differs ?? []).join(' ');
  for (const r of SYNC) {
    const why = String(scene[r.section]?.why ?? '');
    if (!r.says.test(why) || (r.not && r.not.test(why)) || r.holds(scene, B)) continue;
    if (r.says.test(excused)) continue; // said to be beyond the render
    const said = why.match(r.says)[0];
    out.sync.push({ section: r.section, said, fix: r.fix });
    out.advice.push(`${r.section}.why says "${said}" but the scene doesn't show it (${r.fix}), or list it in "differs" if the render can't`);
  }
}

/**
 * The summary for the chat, written from the scene itself so the words and the render can't drift apart: each
 * section's values and how sure it is, then its reasons, the other readings, and what the render doesn't show.
 */
export function describe(b, r) {
  const s = b.scene, a = s.activity, f = s.figure, fw = f.footwear, c = s.camera, out = [];
  const ev = (k) => { const e = s[k]; const t = [e?.confidence, e?.basis].filter(Boolean).join(', '); return t ? ` (${t})` : ''; };
  const why = (k) => (s[k]?.why ? ` ${String(s[k].why).trim()}` : '');
  const d = r.camera.distance_m, moves = (c.path ?? []).length > 1;
  out.push(`- **Camera**${ev('camera')}: about ${Math.round(r.camera.hfov_deg)}° across, ${d.min === d.max ? d.median : `${d.min}–${d.max}`} m from the figure, ${round(c.height_m, 2)} m up${Math.abs(c.roll_deg ?? 0) >= 1 ? `, rolled ${Math.round(c.roll_deg)}°` : ''}, ${moves ? 'moving' : 'standing'}${c.shake ? ' and hand-held' : ''}.${why('camera')}`);
  const shoe = fw.model ? `the ${String(fw.model).replace(/-/g, ' ')} shoe` : fw.style ? `${String(fw.style).replace(/_/g, ' ')} shoes` : 'plain shoes';
  out.push(`- **Figure**${ev('figure')}: ${f.stature_m} m, ${f.build}, in ${shoe} with a ${fw.heel_cm} cm heel on a ${fw.platform_cm} cm platform.${why('figure')}`);
  if (a.kind === 'walk') {
    const arms = a.arms.left === a.arms.right ? `arms ${a.arms.left}` : `left arm ${a.arms.left}, right arm ${a.arms.right}`;
    const g = (a.gestures ?? []).map((x) => `${x.arm} arm ${x.pose} ${x.from_s}–${x.to_s} s`).join(', ');
    const extra = [a.knee_bend_deg ? `knees bent about ${a.knee_bend_deg}°` : '', a.toe_out_deg != null ? `feet turned out ${a.toe_out_deg}°` : '', (a.slips ?? []).length ? `${a.slips.length} slip${a.slips.length > 1 ? 's' : ''}` : '', (a.pace ?? []).length ? 'with pauses' : ''].filter(Boolean).join(', ');
    const bal = balanceOf(s, b.motion.dims);
    out.push(`- **Walk**${ev('activity')}: ${a.style}, ${a.speed_mps} m/s at ${a.cadence_spm} steps a minute (${r.walk.step_length_m} m steps), feet ${a.step_width_m} m apart; ${arms}${g ? `, ${g}` : ''}${extra ? `; ${extra}` : ''}${bal.demand > 0.3 ? `; balancing with hips and arms (demand ${bal.demand}: ${bal.why})` : ''}${(a.mix ?? 0) > 0 ? `; cap/sim mix ${a.mix}` : ''}.${why('activity')}`);
  } else out.push(`- **Standing**${ev('activity')}.${why('activity')}`);
  out.push(`- **Ground**${ev('ground')}: ${s.ground.surface ?? 'dry'}${r.friction ? ` (friction about ${r.friction.mu})` : ''}.${why('ground')}`);
  const lines = [`**Main guesses** (nothing is measured; every value is a judgement from looking):`, ...out];
  if (s.alternatives.length) lines.push('', '**Other readings:**', ...s.alternatives.map((x) => `- ${x.about}: ${x.instead}${x.because ? ` (${x.because})` : ''}`));
  if (s.differs.length) lines.push('', '**What differs from the video:**', ...s.differs.map((x) => `- ${x}`));
  if (r.sync?.length) lines.push('', '**Not yet in the scene** (fix before sending):', ...r.sync.map((x) => `- ${x.section}: "${x.said}": ${x.fix}`));
  return lines.join('\n');
}
function cmdDescribe(pos) { const b = load(pos[0]); console.log(describe(b, report(b))); }

/**
 * The terrain's fix cycle: the rendered ground's edge against the edges traced in ground_edges, and the single change
 * (camera roll, height or aim; a terrain feature's height, width or grade) that would bring them closest.
 */
function groundReport(scene, motion, out) {
  if (!scene.ground_edges.length) { if (scene.terrain || Math.abs(scene.camera.roll_deg ?? 0) > 0) out.hints.push('no ground_edges: trace where the ground ends in two or three frames (a bank\'s top against the trees, the horizon) and check will fit the terrain and camera to them'); return; }
  // the figure's fit to its boxes, so a change that fixes the ground by moving the figure off them scores worse
  const framing = (sc) => {
    const cams2 = cameraTrack(sc, motion.frames), { width: W, height: Hh } = sc.output, out2 = [];
    for (const o of sc.observed.filter((x) => !x.foot)) {
      const i = nearest(motion.frames, o.t), b = figureBox(sc, motion.dims, motion.frames[i], cams2[i]), r = [(b[0] / W) * 1000, (b[1] / Hh) * 1000, (b[2] / W) * 1000, (b[3] / Hh) * 1000];
      out2.push({ d: (r[0] + r[2]) / 2 - (o.box[0] + o.box[2]) / 2 });
      if (o.box[3] < 995) out2.push({ d: r[3] - o.box[3] });
      if (o.box[1] > 5) out2.push({ d: r[1] - o.box[1] });
    }
    return out2;
  };
  const g = out.ground = groundEdgeReport(scene, motion.frames, framing);
  if (!g || g.rms <= 40) return;
  const best = g.tries.slice(0, 3).map((k) => `${k.name} ${k.from} → ${k.to} (edge off by ${k.rms}, figure by ${k.framing})`).join('; ');
  out.advice.push(`the ground's edge is off by about ${g.rms} grid units (${g.offset > 0 ? 'rendered lower' : 'rendered higher'} by ${Math.abs(g.offset)} on average, tilted ${g.tilt_deg}° against what was traced)${best ? `: the single changes that bring it closest: ${best}. Make the one the footage supports, then check again` : ': no single change helps; the terrain\'s shape is wrong (add or move a feature)'}`);
}

function cmdCheck(pos, opt) {
  const b = load(pos[0]), r = report(b);
  if (opt.json) { console.log(JSON.stringify({ notes: b.notes, ...r }, null, 2)); return; }
  const s = b.scene, w = r.walk, c = r.camera;
  console.log(`${s.id}: ${s.duration_s} s at ${s.output.fps} fps, ${s.output.width}×${s.output.height}`);
  console.log(`  figure  ${s.figure.stature_m} m, ${s.figure.build}, heel ${s.figure.footwear.heel_cm} cm on a ${s.figure.footwear.platform_cm} cm platform`);
  if (s.activity.kind === 'walk') console.log(`  walk    ${w.speed_mps} m/s at ${w.cadence_spm} steps/min: steps ${w.step_length_m} m (${w.step_per_stature} × stature), ${w.distance_m} m in all along a ${w.path_length_m} m path`);
  else console.log('  stand');
  console.log(`  camera  ${c.hfov_deg}° across, ${c.distance_m.min}–${c.distance_m.max} m from the figure (median ${c.distance_m.median}), turns ${c.turned_deg}°`);
  console.log(`          the figure fills ${c.figure_height_in_frame.start} / ${c.figure_height_in_frame.middle} / ${c.figure_height_in_frame.end} of the frame height (start / middle / end)`);
  const ft = r.foot;
  console.log(`  foot    ${ft.foot_length_cm} cm (${ft.foot_per_stature} × stature; people 0.135–0.165) in a ${ft.shoe_length_cm} cm ${s.figure.footwear.model ?? s.figure.footwear.style ?? 'plain'} shoe, toe room ${ft.toe_room_cm} cm, heel ${ft.heel_per_foot} × foot`);
  const fx = r.friction;
  if (fx) {
    console.log(`  ground  ${fx.surface}, friction μ ${fx.mu}: the walk needs up to ${fx.peak_need}; ${fx.would_slip} planted step${fx.would_slip === 1 ? '' : 's'} over it${fx.would_slip ? ` (${fx.unexplained} without a slip in the scene)` : ''}`);
    console.log(`  mix     ${fx.mix} (0 cap, 1 sim)${fx.careful ? `; a careful walker here: ${fx.careful.step_m} m steps at ${fx.careful.cadence_spm}/min` : ''}`);
    const h = fx.hybrid;
    if (h?.gait) console.log(`          the sim shortened the steps ${round(h.gait.from.step_m)} → ${round(h.gait.to.step_m)} m at ${h.gait.to.cadence_spm}/min (${h.gait.to.speed_mps} m/s)`);
    if (h?.added?.length) console.log(`          the sim added ${h.added.length} skid${h.added.length > 1 ? 's' : ''}: ${h.added.map((q) => `${q.foot} ${q.from_s} s ${Math.round(q.distance_m * 100)} cm`).join(', ')}`);
  }
  for (const x of ft.seen) console.log(`  shoe seen at ${x.t} s (${x.foot}): ${x.shoe_per_figure_seen != null ? `${x.shoe_per_figure_seen} of the figure's height seen, ${x.shoe_per_figure_rendered} rendered` : `×${x.size_ratio} the rendered size on screen`}`);
  if (r.pose) console.log(`  joints: off by ${r.pose.rms} grid units across ${s.observed_joints.length} marked frame${s.observed_joints.length > 1 ? 's' : ''} (worst ${r.pose.worst.map((w) => `${w.joint} ${w.off}`).join(', ')})`);
  if (r.ground) console.log(`  ground edge: off by ${r.ground.rms} grid units (mean ${r.ground.offset}, tilt ${r.ground.tilt_deg}°) along ${s.ground_edges.length} traced edge${s.ground_edges.length > 1 ? 's' : ''}; the figure off its boxes by ${r.ground.framing}`);
  for (const o of r.observed) console.log(`  seen at ${o.t} s: box ${o.seen.join(',')}  rendered ${o.rendered.join(',')}  ${o.size_ratio == null ? `cut at the ${o.cut}` : `size ×${o.size_ratio}`}, shift ${o.centre_shift.join(',')}`);
  const C = r.contacts;
  if (C) {
    for (const e of C.events) console.log(`  contact ${e.foot.padEnd(5)} seen ${e.on_s}${e.off_s != null ? `–${e.off_s}` : ''} s  walker ${e.walker_on_s ?? '–'}${e.walker_off_s != null ? `–${e.walker_off_s}` : ''} s  (${e.on_err_s == null ? 'no landing' : `${e.on_err_s > 0 ? '+' : ''}${e.on_err_s} s`})`);
    if (C.landing_error_s) console.log(`          landing error median ${C.landing_error_s.median} s, max ${C.landing_error_s.max} s, mean ${C.landing_error_s.mean_signed > 0 ? '+' : ''}${C.landing_error_s.mean_signed} s (one frame is ${C.frame_s} s)`);
  }
  for (const [k, e] of Object.entries(r.evidence)) console.log(`  evidence ${k.padEnd(8)} ${e.confidence ?? '?'}${e.basis ? `, ${e.basis}` : ''}`);
  for (const x of r.alternatives) console.log(`  or: ${x.about}: ${x.instead}${x.because ? ` (${x.because})` : ''}`);
  for (const n of b.notes) console.log(`  note: ${n}`);
  for (const a of r.advice) console.log(`  ! ${a}`);
  for (const h of r.hints) console.log(`  hint: ${h}`);
  if (!r.advice.length) console.log(`  ✓ plausible${s.observed.length ? ', and it matches what was seen' : ' (add "observed" boxes to compare with the video)'}`);
  console.log('next ▸ render --still T --compare at an observed time, then render --compare');
}

// ---------- render ----------
function sourceVideo(scene, file) {
  const v = scene.source?.video;
  if (!v) return null;
  const p = resolve(dirname(file), v);
  return existsSync(p) ? p : null;
}

/**
 * On a still, what was traced off the footage near that time, so a glance shows what is off: the ground's edge as
 * traced (green) and as rendered (magenta), and the figure boxes (yellow). --no-marks leaves them out.
 */
function markStill(img, scene, cam, t, frameNodes) {
  const { width: W, height: H } = scene.output;
  const put = (x, y, c) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } };
  const seg = (a, b, c) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 0; k <= n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c); };
  const px = (p) => [(p[0] / 1000) * W, (p[1] / 1000) * H];
  const near = (o) => Math.abs(o.t - t) <= 0.5;
  const edges = scene.ground_edges.filter(near);
  if (edges.length) {
    const T = scene.terrain ? makeTerrain(scene) : null, h = T ? T.height : () => 0, stops = groundStops(scene), wood = inWood(scene);
    let prev = null;
    for (let u = 0; u <= W; u += 4) { const v = edgeRow(h, cam, u, scene.terrain?.extent_m ?? 300, stops, wood); const p = v == null ? null : [u, v]; if (p && prev) seg(prev, p, [230, 40, 200]); prev = p; }
    for (const e of edges) { const pts = [...e.line].sort((a, b) => a[0] - b[0]).map(px); for (let k = 1; k < pts.length; k++) seg(pts[k - 1], pts[k], [40, 220, 60]); }
  }
  // marked joints (cyan) and the figure's (red), joined
  for (const m of scene.observed_joints.filter((x) => Math.abs(x.t - t) <= 0.05)) {
    for (const [j, seen] of Object.entries(m.joints)) {
      const n = frameNodes?.[j]; const s0 = px(seen);
      if (n) { const p = cam.project(n); if (p[2] > 0) { seg(s0, [p[0], p[1]], [255, 255, 255]); for (let k = -3; k <= 3; k++) { put(p[0] + k, p[1], [230, 40, 40]); put(p[0], p[1] + k, [230, 40, 40]); } } }
      for (let k = -3; k <= 3; k++) { put(s0[0] + k, s0[1], [40, 220, 230]); put(s0[0], s0[1] + k, [40, 220, 230]); }
    }
  }
  for (const o of scene.observed.filter((x) => near(x) && !x.foot)) {
    const [x0, y0] = px(o.box), [x1, y1] = px([o.box[2], o.box[3]]);
    seg([x0, y0], [x1, y0], [240, 210, 40]); seg([x1, y0], [x1, y1], [240, 210, 40]); seg([x1, y1], [x0, y1], [240, 210, 40]); seg([x0, y1], [x0, y0], [240, 210, 40]);
  }
}

async function cmdRender(pos, opt) {
  const b = load(pos[0], { look: opt.look }), { scene, motion, cams } = b, { width: W, height: H, fps } = scene.output;
  const R = makeRenderer(scene, motion.dims), buf = new Uint8ClampedArray(W * H * 4);
  const rgbOf = (i) => {
    R.render(motion.frames[i], cams[i], buf);
    const o = Buffer.alloc(W * H * 3);
    for (let j = 0, k = 0; j < buf.length; j += 4, k += 3) { o[k] = buf[j]; o[k + 1] = buf[j + 1]; o[k + 2] = buf[j + 2]; }
    return o;
  };
  const base = join(dirname(b.file), scene.id + (scene.look !== 'scene' ? `-${scene.look}` : ''));
  const src = opt.compare ? sourceVideo(scene, b.file) : null;
  if (opt.compare && !src) die('--compare needs source.video in the scene to point at the video');
  const { ffmpeg } = requireFfmpeg();
  const ff = (args, what) => { const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status !== 0) die(`${what} failed: ${String(r.stderr).slice(0, 300)}`); };
  if (opt.still != null) {
    const t = Number(opt.still), i = nearest(motion.frames, t), out = resolve(opt.out ?? `${base}-${t.toFixed(2)}s.png`);
    const img = rgbOf(i);
    if (!opt['no-marks']) markStill(img, scene, cams[i], t, motion.frames[i].nodes);
    writeStill(img, W, H, out);
    console.log(out);
    if (src) {
      const cmp = out.replace(/\.png$/, '-compare.png');
      ff(['-ss', String(t), '-i', src, '-i', out, '-filter_complex', `[0]scale=-2:${H}[a];[a][1]hstack=2`, '-frames:v', '1', cmp], 'the comparison still');
      console.log(cmp);
    }
    return;
  }
  if (!hasX264()) die('this ffmpeg has no H.264 encoder (libx264); install a full ffmpeg');
  let out = resolve(opt.out ?? `${base}.mp4`); const t0 = Date.now();
  if (scene.source?.video && out === resolve(dirname(b.file), scene.source.video)) { out = out.replace(/\.mp4$/, '-render.mp4'); console.log(`(the scene id matches the source video's name: writing ${out} instead)`); }
  await encode(out, W, H, fps, (i) => (i < motion.frames.length ? rgbOf(i) : null));
  console.log(`${out}  (${motion.frames.length} frames in ${round((Date.now() - t0) / 1000, 1)} s)`);
  if (src) {
    const cmp = out.replace(/\.mp4$/, '-compare.mp4');
    ff(['-i', src, '-i', out, '-filter_complex', `[0]fps=${fps},scale=-2:${H},setpts=PTS-STARTPTS[a];[1]setpts=PTS-STARTPTS[b];[a][b]hstack=2:shortest=1`, '-r', String(fps), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', cmp], 'the comparison video');
    console.log(cmp);
  }
}

// ---------- view ----------
/** The modules the viewer page inlines, in dependency order. */
export const VIEW_MODULES = ['shoeshapes', 'shoemesh', 'terrain', 'physics', 'world', 'scene', 'simwalker', 'walker', 'draw'];

/** The plugin's own modules inlined as plain scripts: each in its own scope, imports turned into lookups. */
export function inlineModules(names) {
  return names.map((name) => {
    let src = readFileSync(join(HERE, 'lib', `${name}.mjs`), 'utf8');
    src = src.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.mjs';$/gm, (_, ids, mod) => `const {${ids}} = M_${mod};`);
    const exported = [...src.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map((m) => m[1]);
    src = src.replace(/^export /gm, '');
    return `const M_${name} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
  }).join('\n');
}

const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
const MAX_EMBED = 40 * 1024 * 1024;

function cmdStudio(pos, opt) {
  const example = !pos[0];
  // each capture's video gets its own published path, so earlier captures keep theirs when the studio is republished
  const capture = example ? null : String(opt.capture ?? `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`).replace(/[^\w-]/g, '');
  // the original clip, when it is in the studio's private storage (sent with Capture, or uploaded there): its asset id
  const oid = String(opt.original ?? '').replace(/^\/_blob\//, '');
  if (opt.original && !/^[0-9a-f]{32}$/.test(oid)) die('--original takes the asset id of the clip in the studio\'s storage (32 hex characters, or /_blob/<id>)');
  return cmdView([pos[0] ?? join(HERE, '..', 'references', 'example.scene.json')], { ...opt, artifact: true, studio: { example, capture, video: opt.video ? `captures/${capture}.mp4` : null, original: opt.original ? `/_blob/${oid}` : null, clip: opt.clip ?? null } });
}

function cmdView(pos, opt) {
  const b = load(pos[0]);
  const raw = JSON.parse(readFileSync(b.file, 'utf8'));
  withModels(raw, b.file);
  // the original clip goes inside the page (so the page plays both), unless --no-video; its path never does
  let video = null;
  const src = sourceVideo(b.scene, b.file);
  const art = !!opt.artifact;
  if (src && !opt['no-video'] && !art) {
    const size = statSync(src).size, type = VIDEO_TYPES[extname(src).toLowerCase()];
    if (!type) console.log(`(the original is ${extname(src)}: not embedded; drop it into the page to compare)`);
    else if (size > MAX_EMBED) console.log(`(the original is ${Math.round(size / 1048576)} MB: not embedded; drop it into the page to compare)`);
    else video = `data:${type};base64,${readFileSync(src).toString('base64')}`;
  }
  if (raw.source) delete raw.source.video;
  const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');
  const tpl = readFileSync(join(HERE, 'lib', 'viewer.html'), 'utf8');
  const html = tpl.replace('/*MODULES*/', () => inlineModules(VIEW_MODULES).replace(/<\/script/gi, '<\\/script'))
    .replace('/*SCENE*/null', () => json(raw))
    .replace('/*VIDEO*/null', () => json(video))
    .replace('/*CAPTURE*/false', () => String(art))
    .replace('/*STUDIO*/null', () => json(art ? (opt.studio ?? { example: false, video: null }) : null))
    .replace("/*GBVERSION*/'dev'", () => json(VERSION))
    .replace(/__TITLE__/g, () => (art ? 'Gait Bench Studio' : `${b.scene.id} · Gait Bench`));
  // an artifact is given its own document shell when it is published, so it gets the page's content only (title first)
  const page = art ? html.replace(/^[\s\S]*?<\/head>\s*<body>\s*/, (head) => head.match(/<title>[\s\S]*?<\/title>/)[0] + '\n' + head.match(/<style id="gb-style">[\s\S]*?<\/style>/)[0] + '\n').replace(/\s*<\/body>\s*<\/html>\s*$/, '\n') : html;
  const out = resolve(opt.out ?? (opt.studio ? join(process.cwd(), 'gait-bench-studio.html') : join(dirname(b.file), `${b.scene.id}.${art ? 'artifact' : 'viewer'}.html`)));
  writeFileSync(out, page);
  if (opt.studio) {
    const S = opt.studio;
    console.log(`${out}\npublish it with the Artifact tool: capabilities {"db": {}, "assets": {}, "downloads": true}${S.video ? `, files {"${S.video}": "${resolve(opt.video)}"}` : ''}`);
    if (!S.example) {
      // the history row for this capture, for the ArtifactData tool (collection "history", doc_id = capture, file_path = this file)
      const name = b.scene.id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const lean = JSON.parse(JSON.stringify(raw)); if (lean.figure?.footwear?.mesh && JSON.stringify(lean.figure.footwear.mesh).length > 400000) delete lean.figure.footwear.mesh; // the real shoe travels with the capture unless it is very large
      const hist = { name, scene_id: b.scene.id, scene: JSON.stringify(lean), video: S.video, original: S.original, clip: opt.clip ?? null, at: Date.now() };
      const hf = out.replace(/\.html?$/, '') + '.history.json';
      writeFileSync(hf, JSON.stringify(hist));
      console.log(`then write ${hf} to the studio's database: collection "history", doc_id "${S.capture}"`);
    }
    return;
  }
  console.log(`${out}${video ? '  (the original clip is inside: keep the page private)' : ''}`);
}

// where the latest version is published: the public release repo on GitHub first (updated with every release), then the site
export const LATEST = ['https://raw.githubusercontent.com/erdoar/gait-bench-plugin/main/.claude-plugin/marketplace.json', 'https://gait.nulytica.com/marketplace.json'];
/** The plugin's version; --check compares it with the latest published one (the only network call, and only when asked). */
async function cmdVersion(pos, opt) {
  console.log(`Gait Bench ${VERSION}`);
  if (!opt.check) return;
  try {
    let latest = null, why = 'no version in marketplace.json';
    for (const url of LATEST) { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); latest = (await r.json())?.plugins?.[0]?.version; if (latest) break; } catch (e) { why = e.message; } }
    if (!latest) throw new Error(why);
    const p = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0), cmp = (a, b) => { const [x, y] = [p(a), p(b)]; for (let k = 0; k < 3; k++) if ((x[k] ?? 0) !== (y[k] ?? 0)) return (x[k] ?? 0) - (y[k] ?? 0); return 0; };
    const c = cmp(latest, VERSION);
    console.log(c > 0 ? `${latest} is out: run /plugin marketplace update (or download it from https://gait.nulytica.com)` : c < 0 ? `up to date (newer than the published ${latest})` : 'up to date');
  } catch (e) { console.log(`could not check: ${e.message}. The latest version is shown at https://gait.nulytica.com`); }
}

function cmdShoes() {
  let group = null;
  for (const [name, sh] of Object.entries(SHOE_SHAPES)) {
    if (sh.group !== group) { group = sh.group; console.log(`\n${group}`); }
    const real = shapeModel({ style: name });
    console.log(`  ${name.padEnd(18)} ${sh.says}  [${sh.heel_cm}/${sh.platform_cm}${sh.shaft_cm ? `/${sh.shaft_cm}` : ''} cm] → ${real ? `${real.model}${real.near ? ' (nearest)' : ''}` : 'capsule'}`);
  }
  console.log('\nfigure.footwear.style takes any of these; override parts with upper, toe, heel, sole, fit, straps, laces, shaft_cm (references/shoes.md)');
}

function cmdSetup() {
  const t = tools(), major = Number(process.versions.node.split('.')[0]);
  console.log(`Gait Bench ${VERSION}`);
  console.log(`  node ${process.versions.node} ${major >= 18 ? '✓' : '✗ (18 or later needed)'}`);
  console.log(`  ffmpeg ${t.ffmpeg ? `✓ ${t.ffmpeg}` : '✗ not found: install ffmpeg, or `pip install imageio-ffmpeg`'}`);
  if (t.ffmpeg) console.log(`  H.264 encoder ${hasX264() ? '✓' : '✗ (MP4 output needs libx264)'}`);
  if (major < 18 || !t.ffmpeg) process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2), { pos, opt } = parseArgs(rest);
  const run = { setup: cmdSetup, version: cmdVersion, shoes: cmdShoes, look: cmdLook, check: cmdCheck, describe: cmdDescribe, render: cmdRender, view: cmdView, studio: cmdStudio }[cmd];
  if (!run || opt.help) { console.log(HELP); process.exit(run || cmd === 'help' || !cmd ? 0 : 1); }
  Promise.resolve(run(pos, opt)).catch((e) => die(e.message));
}

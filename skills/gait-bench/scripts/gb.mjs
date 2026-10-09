#!/usr/bin/env node
// gb.mjs — Gait Bench 2: Claude looks at a video and writes the scene, the person's poses included; this draws it.
//   look VIDEO     a gridded frame sheet and a scene.json to fill in
//   check SCENE    loads the scene and says what can't be drawn as written (nothing else is judged here)
//   render SCENE   a comparison sheet, a still or an MP4 from the reasoned camera, optionally beside the original
//   view SCENE     a self-contained page to play and orbit the scene
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, basename, extname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { tools, requireFfmpeg, hasX264, probe, gridFrame, tileImages, encode, writeStill } from './lib/media.mjs';
import { SCENE_SCHEMA, SECTIONS, normaliseScene, cameraTrack } from './lib/scene.mjs';
import { playPoses } from './lib/pose.mjs';
import { makeRenderer, figureBox } from './lib/draw.mjs';
import { prepareShoe } from './lib/shoemesh.mjs';
import { exportGLB } from './lib/gltf.mjs';

export const VERSION = '2.0.1';
const HERE = dirname(fileURLToPath(import.meta.url));
const round = (x, k = 2) => Math.round(x * 10 ** k) / 10 ** k;
const die = (msg) => { console.error(`gb: ${msg}`); process.exit(1); };

const HELP = `Gait Bench ${VERSION}: the scene Claude reasons out of a video, drawn

  setup                           check Node and ffmpeg
  look VIDEO [--n 8] [--at T,T,…] [--out DIR]
                                  frame sheet (sheet.jpg, gridded 0–1000) plus DIR/scene.json to fill in; --at picks
                                  the times (a close look at a moment); reports the real frame rate
  check SCENE                     what can't be drawn as written: format problems, and limbs too short to reach where a
                                  pose put a foot or hand. It does not judge the movement: that is yours, by eye
  render SCENE --sheet [--at T,T,…] [--out FILE]
                                  the original and the render side by side at the pose times (or --at): look at it,
                                  fix the poses, render again
  render SCENE [--still T] [--compare] [--look clay|contact] [--out FILE]
                                  MP4 from the reasoned camera (or one PNG at T s); --compare puts the original beside
                                  it. --look clay draws neutral greys, contact also marks soles planted (blue) and
                                  sliding (orange): references for video models
  export SCENE [--out FILE.glb]   the figure and its surroundings as an animated 3D file (glTF): open it in Blender or
                                  any glTF viewer and choose the camera there
  view SCENE [--no-video] [--out FILE]
                                  one HTML page: the original beside the reconstruction, synced; orbit, pop-out
  studio [SCENE] [--video FILE] [--original ASSET] [--clip NAME] [--capture ID] [--out FILE]
                                  the Gait Bench Studio panel (an artifact): the player and the Capture button
  shoes                           the real shoe models figure.footwear.model can name
  version [--check]               the plugin's version; --check compares it with the latest release
  help

How to reason a scene out: references/scene.md`;

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
  let video = pos[0] && resolve(pos[0]);
  if (!video) die('look needs a video');
  const dir = resolve(opt.out ?? join(dirname(video), `${basename(video, extname(video))}-gb`));
  mkdirSync(dir, { recursive: true });
  let p;
  try { p = probe(video); } catch (e) {
    // a clip recorded in a browser (the studio shrinks big clips that way) stores no duration: re-save it as it is, once
    if (!/duration/.test(e.message)) throw e;
    const fixed = join(dir, `${basename(video, extname(video))}.mkv`), { ffmpeg } = requireFfmpeg();
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-c', 'copy', '-an', fixed]);
    if (r.status !== 0) die(`could not re-save ${basename(video)}: ${String(r.stderr).slice(0, 200)}`);
    console.log(`(${basename(video)} stores no duration, as browser recordings don't: re-saved as ${fixed})`);
    video = fixed; p = probe(video);
  }
  const at = opt.at ? String(opt.at).split(',').map(Number).filter((x) => Number.isFinite(x) && x >= 0) : null;
  const n = at ? at.length : Number(opt.n ?? 8), files = [], times = [];
  for (let i = 0; i < n; i++) {
    const t = at ? at[i] : round((p.duration * (i + 0.5)) / n, 2);
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
  console.log('next ▸ look at the sheet, reason out the scene and the poses (references/scene.md), fill in scene.json, `check` it, then `render --sheet`');
}

function skeleton(video, p, fps) {
  return {
    schema: SCENE_SCHEMA, id: basename(video, extname(video)).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    source: { video, width: p.width, height: p.height, fps, duration_s: round(p.duration, 2) },
    action: { why: '', confidence: 'unknown', basis: 'assumed' },
    ground: { colour: '#8b8d86', patches: null, shine: 0, surface: 'dry', confidence: 'unknown', basis: 'assumed', why: '' },
    sky: { zenith: '#4a86d0', horizon: '#d6e2ec', why: '' },
    sun: { azimuth_deg: 160, elevation_deg: 35, why: '' },
    far: [], props: [],
    figure: { stature_m: 1.7, build: 'average', hair: 'short', sleeves: 'short', footwear: { model: 'casual-trainer' }, colours: { skin: '#d9b08c', hair: '#2a2018', top: '#6a7f99', bottom: '#2d3440', shoes: '#222222' }, confidence: 'unknown', basis: 'assumed', why: '' },
    poses: [
      { t: 0, at: [0, 4], facing_deg: 180, feet: { left: { at: [-0.1, 4.05] }, right: { at: [0.1, 4.05] } } },
    ],
    camera: { lens: 'main', height_m: 1.4, path: [{ t: 0, at: [0, 0] }], aim: 'figure', aim_offset: [0, 0], shake: 0.3, confidence: 'unknown', basis: 'assumed', why: '' },
    alternatives: [], differs: [],
  };
}

// ---------- build ----------
/** Where footwear.model ids are looked up, after a shoes/ folder beside the scene: the plugin's own shoes, then any
 * folders in GB_SHOE_LIBS (separated by the platform's path separator), then the walk-scene shoe library's session folder. */
const SHOE_LIBS = [join(HERE, '..', 'shoes'), ...(process.env.GB_SHOE_LIBS ?? '').split(delimiter).filter(Boolean), '/home/claude/shoe-library'];
/** footwear.model: a library shoe id, or a model.json path relative to the scene. The mesh is attached as footwear.mesh. */
const sizeNotes = [];
function withModels(raw, file) {
  if (raw && typeof raw === 'object') { raw.figure ??= {}; raw.figure.footwear ??= {}; }
  const fw = raw?.figure?.footwear;
  if (!fw || fw.style) return raw;
  if (typeof fw.model !== 'string') { fw.model = 'casual-trainer'; sizeNotes.push('no footwear.model: drawn in plain trainers (casual-trainer)'); }
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
  const motion = playPoses(scene), cams = cameraTrack(scene, motion.frames);
  return { scene, motion, cams, notes: [...sizeNotes, ...notes, ...motion.notes], file: resolve(file) };
}
const nearest = (frames, t) => frames.reduce((b, f, i) => (Math.abs(f.t - t) < Math.abs(frames[b].t - t) ? i : b), 0);

/**
 * What can't be drawn as written, and the facts Claude needs to judge the rest by eye: limbs too short for where a pose
 * put them, how much of the frame the figure fills, and each section's evidence. It never judges the movement.
 */
export function report({ scene, motion, cams }) {
  const { width: W, height: H } = scene.output, out = { reach: motion.reach, framing: {}, poses: [], evidence: {}, alternatives: scene.alternatives, differs: scene.differs };
  let outside = 0;
  const boxes = motion.frames.map((f, i) => { const b = figureBox(scene, motion.dims, f, cams[i]); if (b[0] < -0.03 * W || b[2] > 1.03 * W || b[1] < -0.03 * H || b[3] > 1.03 * H) outside++; return b; });
  const dist = motion.frames.map((f, i) => Math.hypot(f.nodes.waist[0] - cams[i].eye[0], f.nodes.waist[2] - cams[i].eye[2])).sort((p, q) => p - q);
  out.framing = { distance_m: { min: round(dist[0]), max: round(dist[dist.length - 1]) }, frames_cut_off: outside, of: motion.frames.length };
  for (const p of scene.poses) {
    const i = nearest(motion.frames, p.t), f = motion.frames[i], b = boxes[i], g = (x, s) => Math.max(0, Math.min(1000, Math.round((x / s) * 1000)));
    const on = Object.entries(f.contact).filter(([, v]) => v === 'stance' || v === 'slide' || v === 'ground').map(([k, v]) => `${k.replace(/_?([lr])$/, (m, c) => (c === 'l' ? ' left' : ' right')).replace(/^ /, 'foot ')}${v === 'slide' ? ' (sliding)' : ''}`.trim());
    out.poses.push({ t: p.t, box: [g(b[0], W), g(b[1], H), g(b[2], W), g(b[3], H)], on_ground: on, note: p.note ?? null });
  }
  for (const k of SECTIONS) { const sec = scene[k]; if (sec && (sec.confidence != null || sec.basis != null)) out.evidence[k] = { confidence: sec.confidence ?? null, basis: sec.basis ?? null }; }
  return out;
}

function cmdCheck(pos, opt) {
  const b = load(pos[0]), r = report(b), s = b.scene;
  if (opt.json) { console.log(JSON.stringify({ notes: b.notes, ...r }, null, 2)); return; }
  console.log(`${s.id}: ${s.duration_s} s at ${s.output.fps} fps, ${s.output.width}×${s.output.height}, ${s.poses.length} pose${s.poses.length === 1 ? '' : 's'}`);
  console.log(`  figure  ${s.figure.stature_m} m, ${s.figure.build}, ${s.figure.footwear.model} (heel ${s.figure.footwear.heel_cm} cm, platform ${s.figure.footwear.platform_cm} cm)`);
  console.log(`  camera  ${round(s.camera.hfov_deg, 1)}° across, ${r.framing.distance_m.min}–${r.framing.distance_m.max} m from the figure; the figure is partly out of frame in ${r.framing.frames_cut_off} of ${r.framing.of} frames`);
  for (const p of r.poses) console.log(`  ${String(p.t).padStart(6)} s  box ${p.box.join(',')}  on the ground: ${p.on_ground.join(', ') || 'nothing'}${p.note ? `  · ${p.note}` : ''}`);
  for (const [k, e] of Object.entries(r.evidence)) console.log(`  evidence ${k.padEnd(8)} ${e.confidence ?? '?'}${e.basis ? `, ${e.basis}` : ''}`);
  for (const x of r.alternatives) console.log(`  or: ${x.about}: ${x.instead}${x.because ? ` (${x.because})` : ''}`);
  for (const x of r.differs) console.log(`  differs: ${x}`);
  for (const n of b.notes) console.log(`  note: ${n}`);
  for (const x of r.reach) console.log(`  ! the ${x.limb} can't reach where the pose puts it at ${x.from === x.to ? `${x.from} s` : `${x.from}–${x.to} s`} (short by ${Math.round(x.short_m * 100)} cm): lower the pelvis, bend the trunk, or move the foot or hand`);
  console.log('next ▸ render --sheet, and compare each pair by eye: posture, where the feet and hands are, what touches the ground');
}

// ---------- render ----------
function sourceVideo(scene, file) {
  const v = scene.source?.video;
  if (!v) return null;
  const p = resolve(dirname(file), v);
  return existsSync(p) ? p : null;
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
  if (opt.sheet) {
    // the original and the render at the same moments, one pair per row: the whole check is looking at this
    const srcV = sourceVideo(scene, b.file);
    if (!srcV) die('--sheet needs source.video in the scene to point at the video');
    let times = opt.at ? String(opt.at).split(',').map(Number).filter(Number.isFinite) : scene.poses.map((p) => p.t);
    if (times.length > 8) times = Array.from({ length: 8 }, (_, k) => times[Math.round((k * (times.length - 1)) / 7)]);
    if (!times.length) times = [0, scene.duration_s / 2];
    const out = resolve(opt.out ?? `${base}-sheet.jpg`), tmp = [];
    const rows = times.map((t, k) => {
      const i = nearest(motion.frames, t), png = `${base}-sheet-${k}.png`, pair = `${base}-sheet-${k}.jpg`;
      writeStill(rgbOf(i), W, H, png);
      ff(['-ss', String(t), '-i', srcV, '-i', png, '-filter_complex', `[0]scale=-2:${H},drawbox=x=0:y=0:w=150:h=34:color=black@0.7:t=fill[a];[a][1]hstack=2,scale=1200:-2`, '-frames:v', '1', '-q:v', '3', pair], 'a pair');
      tmp.push(png, pair);
      return { t, pair };
    });
    const ins = rows.flatMap((r) => ['-i', r.pair]);
    ff([...ins, '-filter_complex', rows.length > 1 ? `${rows.map((_, k) => `[${k}]`).join('')}vstack=${rows.length}` : '[0]copy', '-frames:v', '1', '-q:v', '3', out], 'the sheet');
    for (const f of tmp) try { unlinkSync(f); } catch {}
    console.log(`${out}  (original left, render right; rows at ${times.map((t) => `${t} s`).join(', ')})`);
    return;
  }
  if (opt.still != null) {
    const t = Number(opt.still), i = nearest(motion.frames, t), out = resolve(opt.out ?? `${base}-${t.toFixed(2)}s.png`);
    const img = rgbOf(i);
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
export const VIEW_MODULES = ['shoemesh', 'terrain', 'scene', 'pose', 'draw', 'gltf', 'webm'];

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
    console.log(`${out}\npublish it with the Artifact tool: capabilities {"db": {}, "assets": {}, "downloads": true, "comments": {}}${S.video ? `, files {"${S.video}": "${resolve(opt.video)}"}` : ''}`);
    return;
  }
  console.log(`${out}${video ? '  (the original clip is inside: keep the page private)' : ''}`);
}

// where the latest version is published: the public release repo on GitHub first (updated with every release), then the site
export const RELEASES = 'https://github.com/erdoar/gait-bench-plugin';
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
    console.log(c > 0 ? `${latest} is out: run /plugin marketplace update (releases: ${RELEASES})` : c < 0 ? `up to date (newer than the published ${latest}; releases: ${RELEASES})` : `up to date (releases: ${RELEASES})`);
  } catch (e) { console.log(`could not check: ${e.message}. The latest version is at ${RELEASES}`); }
}

function cmdExport(pos, opt) {
  const b = load(pos[0]), out = resolve(opt.out ?? join(dirname(b.file), `${b.scene.id}.glb`));
  const glb = exportGLB(b.scene, b.motion);
  writeFileSync(out, glb);
  console.log(`${out}  (${round(glb.length / 1048576, 1)} MB, ${b.motion.frames.length} frames over ${b.scene.duration_s} s; no camera: choose the view where you open it)`);
}

function cmdShoes() {
  const dir = join(HERE, '..', 'shoes');
  for (const id of readdirSync(dir).filter((d) => existsSync(join(dir, d, 'model.json'))).sort()) {
    const m = JSON.parse(readFileSync(join(dir, id, 'model.json'), 'utf8'));
    console.log(`  ${id.padEnd(30)} ${m.category ?? ''}  heel ${round(m.heel_m * 100, 1)} cm, platform ${round(m.platform_m * 100, 1)} cm, ${round(m.length_m * 100, 1)} cm long`);
  }
  console.log('\nfigure.footwear.model takes any of these; set heel_cm and platform_cm as seen (references/shoes.md)');
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
  const run = { setup: cmdSetup, version: cmdVersion, shoes: cmdShoes, look: cmdLook, check: cmdCheck, render: cmdRender, export: cmdExport, view: cmdView, studio: cmdStudio }[cmd];
  if (!run || opt.help) { console.log(HELP); process.exit(run || cmd === 'help' || !cmd ? 0 : 1); }
  Promise.resolve(run(pos, opt)).catch((e) => die(e.message));
}

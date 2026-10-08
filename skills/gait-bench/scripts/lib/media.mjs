// media.mjs — ffmpeg helpers: find tools, probe, grab gridded frames, tile them, encode video.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: opts.encoding ?? 'utf8', maxBuffer: 1 << 30, ...opts });
const works = (cmd, args = ['-version']) => { try { return run(cmd, args).status === 0; } catch { return false; } };
const QUIET = ['-hide_banner', '-loglevel', 'error', '-y'];
/** A path as ffmpeg filter options want it: forward slashes, colons escaped. */
const filterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');

let FF = null;
/** Locate ffmpeg (and ffprobe if present). Order: $GB_FFMPEG, PATH, Python's imageio-ffmpeg. */
export function tools() {
  if (FF) return FF;
  let ffmpeg = null, ffprobe = null;
  if (process.env.GB_FFMPEG && works(process.env.GB_FFMPEG)) ffmpeg = process.env.GB_FFMPEG;
  else if (works('ffmpeg')) ffmpeg = 'ffmpeg';
  else {
    for (const py of ['python3', 'python']) {
      const r = (() => { try { return run(py, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']); } catch { return null; } })();
      if (r?.status === 0 && works(r.stdout.trim())) { ffmpeg = r.stdout.trim(); break; }
    }
  }
  if (process.env.GB_FFPROBE && works(process.env.GB_FFPROBE)) ffprobe = process.env.GB_FFPROBE;
  else if (works('ffprobe')) ffprobe = 'ffprobe';
  FF = { ffmpeg, ffprobe };
  return FF;
}
export function requireFfmpeg() {
  const t = tools();
  if (!t.ffmpeg) throw new Error('ffmpeg not found. Install it (macOS: `brew install ffmpeg`; Debian/Ubuntu: `sudo apt install ffmpeg`; Windows: `winget install ffmpeg`) or run `pip install imageio-ffmpeg`, then try again.');
  return t;
}

const FONT_CANDIDATES = [
  process.env.GB_FONT,
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf',
].filter(Boolean);
export const findFont = () => FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
const LISTS = {};
/** ffmpeg's -filters or -encoders listing (cached). */
const listing = (what) => (LISTS[what] ??= run(requireFfmpeg().ffmpeg, ['-hide_banner', what]).stdout ?? '');
const hasDrawtext = () => /\sdrawtext\s/.test(listing('-filters'));
/** Whether this ffmpeg can write H.264 (needed for every MP4 the plugin makes). */
export const hasX264 = () => !!tools().ffmpeg && /libx264/.test(listing('-encoders'));

/** Width, height (as displayed, rotation applied), duration, fps, has audio. */
export function probe(video) {
  const { ffmpeg, ffprobe } = requireFfmpeg();
  if (!existsSync(video)) throw new Error(`no such file: ${video}`);
  let w, h, dur, fps, rFps = null, rot = 0, audio = false, codec = '', tags = {};
  if (ffprobe) {
    const r = run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]);
    if (r.status !== 0) throw new Error(`ffprobe could not read ${video}: ${r.stderr.slice(0, 300)}`);
    const j = JSON.parse(r.stdout);
    const vs = j.streams.find((s) => s.codec_type === 'video');
    if (!vs) throw new Error('no video stream');
    w = vs.width; h = vs.height; codec = vs.codec_name;
    const rate = (x) => { const [a, b] = String(x || '').split('/').map(Number); return b ? a / b : a; };
    fps = rate(vs.avg_frame_rate) || rate(vs.r_frame_rate) || 30;
    rFps = rate(vs.r_frame_rate) || null;
    dur = Number(vs.duration ?? j.format?.duration);
    if (!Number.isFinite(dur)) dur = Number(j.format?.duration);
    tags = { ...(j.format?.tags ?? {}), ...(vs.tags ?? {}) };
    rot = Number(vs.tags?.rotate ?? 0) || Number((vs.side_data_list || []).find((d) => d.rotation != null)?.rotation ?? 0);
    audio = j.streams.some((s) => s.codec_type === 'audio');
  } else {
    const r = run(ffmpeg, ['-hide_banner', '-i', video]);
    const e = r.stderr;
    const m = e.match(/Video: (\w+).*?, (\d{2,5})x(\d{2,5})/);
    if (!m) throw new Error(`ffmpeg could not read ${video}`);
    codec = m[1]; w = Number(m[2]); h = Number(m[3]);
    const d = e.match(/Duration: (\d+):(\d+):([\d.]+)/); dur = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : NaN;
    const f = e.match(/([\d.]+) fps/); fps = f ? Number(f[1]) : 30;
    const tb = e.match(/([\d.]+)k? tbr/); rFps = tb && !/k tbr/.test(tb[0]) ? Number(tb[1]) : null;
    for (const m of e.matchAll(/^\s+([\w.-]+)\s*:\s*(.+)$/gm)) tags[m[1]] = m[2].trim();
    const ro = e.match(/rotate\s*:\s*(-?\d+)/) || e.match(/rotation of (-?[\d.]+) degrees/); rot = ro ? Number(ro[1]) : 0;
    audio = /Audio:/.test(e);
  }
  if (Math.abs(Math.round(rot / 90)) % 2 === 1) [w, h] = [h, w];
  if (!(dur > 0)) throw new Error(`could not read the duration of ${video}; re-save it as an ordinary MP4 (for example \`ffmpeg -i IN -c:v libx264 OUT.mp4\`) and try again`);
  return { file: video, width: w, height: h, duration: dur, fps, r_fps: rFps, rotation: rot, audio, codec, capture_fps: captureFps(tags), playback_intent: tags['com.apple.quicktime.full-frame-rate-playback-intent'] ?? null };
}

/** Capture frame rate a phone wrote into the file's tags (Android slow motion: com.android.capture.fps), or null. */
function captureFps(tags) {
  for (const [k, v] of Object.entries(tags)) if (/capture[._-]?fps/i.test(k) && Number(v) > 0) return Number(v);
  return null;
}

/**
 * One frame at time t, optionally cropped to {x0,y0,w,h} (display pixels), scaled so the long side is
 * `long`, with a 10×10 grid labelled 0–1000 and a frame label. Written as JPEG to `out`.
 */
export function gridFrame(video, t, out, { crop, long = 1000, label, grid = true, fine = false } = {}) {
  const { ffmpeg } = requireFfmpeg();
  const vf = [];
  if (crop) vf.push(`crop=${Math.max(8, Math.round(crop.w))}:${Math.max(8, Math.round(crop.h))}:${Math.max(0, Math.round(crop.x0))}:${Math.max(0, Math.round(crop.y0))}`);
  vf.push(`scale='if(gt(iw,ih),${long},-2)':'if(gt(iw,ih),-2,${long})'`);
  const font = findFont(), text = font && hasDrawtext() ? filterPath(font) : null;
  if (grid) {
    const n = fine ? 20 : 10;
    vf.push(`drawgrid=w=iw/${n}:h=ih/${n}:t=1:c=cyan@${fine ? 0.35 : 0.45}`);
    if (text) {
      const step = fine ? 2 : 1;
      for (let k = step; k < n; k += step) {
        const v = Math.round((k / n) * 1000);
        vf.push(`drawtext=fontfile='${text}':text='${v}':x=w*${k}/${n}+3:y=3:fontsize=13:fontcolor=0x80f4ff:borderw=2:bordercolor=black`);
        vf.push(`drawtext=fontfile='${text}':text='${v}':x=3:y=h*${k}/${n}+3:fontsize=13:fontcolor=0x80f4ff:borderw=2:bordercolor=black`);
      }
    }
  }
  if (label && text) vf.push(`drawtext=fontfile='${text}':text='${label}':x=w-tw-8:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=5`);
  const r = run(ffmpeg, [...QUIET, '-ss', String(Math.max(0, t)), '-i', video, '-frames:v', '1', '-vf', vf.join(','), '-q:v', '3', out]);
  if (r.status !== 0 || !existsSync(out)) throw new Error(`frame at ${t}s failed: ${r.stderr.slice(0, 400)}`);
  return out;
}

/** Write one rgb24 frame (a Buffer, w×h) as a still image; the format follows `out`'s extension. */
export function writeStill(rgb, w, h, out) {
  const { ffmpeg } = requireFfmpeg();
  const r = run(ffmpeg, [...QUIET, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-', '-frames:v', '1', out], { input: rgb, encoding: 'buffer' });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return out;
}

/** Stream RGB frames into an H.264 MP4. `next(i)` returns a Buffer (rgb24) or null to stop. */
export async function encode(out, width, height, fps, next) {
  const { ffmpeg } = requireFfmpeg();
  const p = spawn(ffmpeg, [...QUIET, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res) => p.on('close', res));
  for (let i = 0; ; i++) {
    const buf = next(i);
    if (!buf) break;
    if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
  }
  p.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`encoding failed: ${err.slice(0, 400)}`);
  return out;
}

/** Tile images (same size) into a grid of `cols` columns; missing cells are left blank. */
export function tileImages(files, out, cols = 2, cell = 520) {
  const { ffmpeg } = requireFfmpeg();
  const rows = Math.ceil(files.length / cols);
  const ins = files.flatMap((f) => ['-i', f]);
  const n = files.length;
  const scale = files.map((_, i) => `[${i}]scale=${cell}:${cell}:force_original_aspect_ratio=decrease,pad=${cell}:${cell}:(ow-iw)/2:(oh-ih)/2:color=white[v${i}]`);
  const pads = [];
  for (let i = n; i < rows * cols; i++) pads.push(`color=c=white:s=${cell}x${cell}:d=1[v${i}]`);
  const layout = Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * (cell + 6)}_${Math.floor(i / cols) * (cell + 6)}`).join('|');
  const stack = rows * cols === 1 ? `[v0]copy[o]` : `${Array.from({ length: rows * cols }, (_, i) => `[v${i}]`).join('')}xstack=inputs=${rows * cols}:layout=${layout}:fill=white[o]`;
  const r = run(ffmpeg, [...QUIET, ...ins, '-filter_complex', [...scale, ...pads, stack].join(';'), '-map', '[o]', '-frames:v', '1', '-q:v', '3', out]);
  if (r.status !== 0) throw new Error(`tiling failed: ${String(r.stderr).slice(0, 300)}`);
  return out;
}

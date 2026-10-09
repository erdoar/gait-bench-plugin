// webm.mjs — packs encoded VP8/VP9 video frames into a WebM file, so the studio can save a video rendered frame by frame
// from the viewer's own camera (the browser's VideoEncoder makes the frames; this only writes the container).
// Pure JavaScript with no Node APIs.

const enc = new TextEncoder();
const uint = (n) => { const b = []; do { b.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0); return b; };
const size = (n) => { const b = [0x01]; for (let k = 6; k >= 0; k--) b.push(Math.floor(n / 2 ** (8 * k)) & 0xff); return b; }; // 8-byte size
const idBytes = (id) => uint(id);
const flat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const el = (id, body) => { const b = body instanceof Uint8Array ? body : Array.isArray(body) ? Uint8Array.from(body) : body; return flat([Uint8Array.from(idBytes(id)), Uint8Array.from(size(b.length)), b]); };
const u = (id, n) => el(id, uint(n));
const s = (id, str) => el(id, enc.encode(str));
const f64 = (id, x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return el(id, b); };

/**
 * A WebM writer for one video track. add(data, timestamp_us, key) for each encoded frame in order (keyframes start new
 * clusters), then done(duration_s) returns the file as a Uint8Array.
 */
export function makeWebM({ width, height, codec = 'V_VP8' }) {
  const clusters = []; let cur = null;
  const close = () => { if (cur) clusters.push(el(0x1f43b675, flat([u(0xe7, cur.tc), ...cur.blocks]))); cur = null; };
  return {
    add(data, tsUs, key) {
      const ms = Math.round(tsUs / 1000);
      if (key || !cur || ms - cur.tc > 30000) { close(); cur = { tc: ms, blocks: [] }; }
      const rel = ms - cur.tc, head = Uint8Array.from([0x81, (rel >> 8) & 0xff, rel & 0xff, key ? 0x80 : 0x00]);
      cur.blocks.push(el(0xa3, flat([head, data instanceof Uint8Array ? data : new Uint8Array(data)])));
    },
    done(durationS) {
      close();
      const ebml = el(0x1a45dfa3, flat([u(0x4286, 1), u(0x42f7, 1), u(0x42f2, 4), u(0x42f3, 8), s(0x4282, 'webm'), u(0x4287, 2), u(0x4285, 2)]));
      const info = el(0x1549a966, flat([u(0x2ad7b1, 1000000), s(0x4d80, 'Gait Bench'), s(0x5741, 'Gait Bench'), f64(0x4489, durationS * 1000)]));
      const tracks = el(0x1654ae6b, el(0xae, flat([u(0xd7, 1), u(0x73c5, 1), u(0x83, 1), s(0x86, codec), el(0xe0, flat([u(0xb0, width), u(0xba, height)]))])));
      return flat([ebml, el(0x18538067, flat([info, tracks, ...clusters]))]);
    },
  };
}

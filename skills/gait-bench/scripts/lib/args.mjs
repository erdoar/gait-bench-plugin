// args.mjs — the command line of gb.mjs: `--key value`, `--key=value` and bare `--flag` options.

/** Options that never take a value, so `--compare scene.json` cannot swallow the scene as its value. */
export const FLAGS = new Set(['compare', 'json', 'help', 'no-video', 'check', 'no-marks']);
/** Options that may be given more than once; they always come back as an array. */
export const MULTI = new Set([]);

/**
 * Split argv into positional arguments and options. `--key=value` splits on the FIRST `=` only
 * (`--out=a=b.mp4` is out = "a=b.mp4"); `--key value` takes the next argument unless the key is a
 * flag or the next argument is another option; a repeated non-MULTI option keeps its last value.
 */
export function parseArgs(argv) {
  const pos = [], opt = {};
  const set = (k, v) => {
    if (MULTI.has(k)) (opt[k] ??= []).push(v);
    else opt[k] = v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') || a === '--') { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (eq >= 0) set(k, a.slice(eq + 1));
    else if (!FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) set(k, argv[++i]);
    else set(k, true);
  }
  return { pos, opt };
}

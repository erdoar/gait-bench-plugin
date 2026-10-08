// shoeshapes.mjs — the catalogue of capsule shoe shapes (footwear.style). Each shape is a preset of a few parts the
// renderer knows how to draw: the upper, the toe, the heel, the sole, a shaft up the leg and any straps. Any part can be
// overridden in the scene (footwear.toe, footwear.heel, …), and heel_cm / platform_cm / shaft_cm left out of the scene
// come from the shape's typical values. Pure JavaScript with no imports, so the viewer page can inline it.

/** What each part may be. */
export const SHOE_PARTS = {
  // closed: covers the instep (oxford, trainer, boot); open: bare instep over a court-shoe opening; backless: a closed
  // front with no heel cup (mule, clog); strappy: bare foot held by straps; thong: a toe post and a V strap; band: one
  // wide strap over the forefoot (slide); sock: a soft knit over the whole foot; none: bare foot
  upper: ['closed', 'open', 'backless', 'strappy', 'thong', 'band', 'sock', 'none'],
  toe: ['round', 'almond', 'pointed', 'square', 'open'],
  // flat: a low heel pad; block: a thick straight heel; stiletto: a thin spike; kitten: a short thin heel, set forward;
  // cone: wide at the top, narrow at the ground; wedge: one block from the heel to the ball; cuban: a stacked, slightly
  // tapered heel (riding and cowboy boots)
  heel: ['flat', 'block', 'stiletto', 'kitten', 'cone', 'wedge', 'cuban'],
  // thin: a slim leather sole; normal; chunky: a deep sole (trainers, platforms); lug: a deep sole with a cleated edge;
  // crepe: a pale rubber sole; none: no sole (barefoot, socks)
  sole: ['none', 'thin', 'normal', 'chunky', 'lug', 'crepe'],
  fit: ['fitted', 'loose', 'slouch'],
  straps: ['ankle', 'instep', 'back', 'toe', 'cross', 'shin'],
};

const S = (group, says, parts, typical) => ({ group, says, ...parts, ...typical });
/** The shapes, by name: group, a line saying what it is, its parts and its typical heel, platform and shaft (cm). */
export const SHOE_SHAPES = {
  // no shoe
  barefoot: S('none', 'bare feet', { upper: 'none', toe: 'open', heel: 'flat', sole: 'none' }, { heel_cm: 0, platform_cm: 0 }),
  socks: S('none', 'socks or tights only', { upper: 'sock', toe: 'round', heel: 'flat', sole: 'none' }, { heel_cm: 0, platform_cm: 0 }),
  // flats and casual
  ballet_flat: S('flat', 'ballet flat: low-cut, bare instep, thin sole', { upper: 'open', toe: 'round', heel: 'flat', sole: 'thin' }, { heel_cm: 1, platform_cm: 0.5 }),
  loafer: S('flat', 'loafer: slip-on, covered instep, low stacked heel', { upper: 'closed', toe: 'round', heel: 'block', sole: 'normal' }, { heel_cm: 2.5, platform_cm: 1 }),
  moccasin: S('flat', 'moccasin or driving shoe: soft, very thin sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'thin' }, { heel_cm: 1, platform_cm: 0.5 }),
  boat_shoe: S('flat', 'boat shoe: laced moccasin on a pale sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'crepe', laces: true }, { heel_cm: 2, platform_cm: 1 }),
  oxford: S('flat', 'oxford or derby: laced leather shoe', { upper: 'closed', toe: 'almond', heel: 'block', sole: 'thin', laces: true }, { heel_cm: 3, platform_cm: 1 }),
  brogue: S('flat', 'brogue: laced, with a rounder wing-tip toe', { upper: 'closed', toe: 'round', heel: 'block', sole: 'normal', laces: true }, { heel_cm: 3, platform_cm: 1.2 }),
  monk: S('flat', 'monk strap: buckled across the instep', { upper: 'closed', toe: 'almond', heel: 'block', sole: 'thin', straps: ['instep'] }, { heel_cm: 3, platform_cm: 1 }),
  espadrille: S('flat', 'espadrille: canvas on a pale rope sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'crepe' }, { heel_cm: 2, platform_cm: 1.5 }),
  plimsoll: S('flat', 'plimsoll or canvas slip-on: thin rubber sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'crepe', laces: true }, { heel_cm: 1.5, platform_cm: 1 }),
  // trainers
  trainer: S('trainer', 'trainer or sneaker: padded upper, thick sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', laces: true }, { heel_cm: 3, platform_cm: 1.5 }),
  running: S('trainer', 'running shoe: light upper, thicker under the heel', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', laces: true }, { heel_cm: 3.5, platform_cm: 2.5 }),
  high_top: S('trainer', 'high-top trainer: covers the ankle', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'crepe', laces: true }, { heel_cm: 3, platform_cm: 1.5, shaft_cm: 12 }),
  skate: S('trainer', 'skate shoe: wide, padded, flat sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', laces: true }, { heel_cm: 2.5, platform_cm: 2 }),
  chunky_trainer: S('trainer', 'chunky or "dad" trainer: very deep sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', laces: true }, { heel_cm: 5, platform_cm: 3.5 }),
  platform_trainer: S('trainer', 'platform trainer: flat platform all along', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', laces: true }, { heel_cm: 6, platform_cm: 5 }),
  // sandals
  sandal: S('sandal', 'flat sandal: straps over a thin sole', { upper: 'strappy', toe: 'open', heel: 'flat', sole: 'thin', straps: ['toe', 'ankle'] }, { heel_cm: 1, platform_cm: 0.8 }),
  flip_flop: S('sandal', 'flip-flop: toe post and V strap', { upper: 'thong', toe: 'open', heel: 'flat', sole: 'normal' }, { heel_cm: 1.5, platform_cm: 1.5 }),
  slide: S('sandal', 'slide or pool slider: one wide band, backless', { upper: 'band', toe: 'open', heel: 'flat', sole: 'chunky' }, { heel_cm: 2.5, platform_cm: 2 }),
  sport_sandal: S('sandal', 'sport sandal: webbing straps on a deep sole', { upper: 'strappy', toe: 'open', heel: 'flat', sole: 'lug', straps: ['toe', 'instep', 'ankle'] }, { heel_cm: 3, platform_cm: 2 }),
  gladiator: S('sandal', 'gladiator: straps up the shin', { upper: 'strappy', toe: 'open', heel: 'flat', sole: 'thin', straps: ['toe', 'cross', 'ankle', 'shin'] }, { heel_cm: 1, platform_cm: 0.8, shaft_cm: 25 }),
  heeled_sandal: S('sandal', 'heeled sandal: straps on a stiletto', { upper: 'strappy', toe: 'open', heel: 'stiletto', sole: 'thin', straps: ['toe', 'ankle'] }, { heel_cm: 10, platform_cm: 0.5 }),
  block_sandal: S('sandal', 'block-heel sandal', { upper: 'strappy', toe: 'open', heel: 'block', sole: 'thin', straps: ['toe', 'ankle'] }, { heel_cm: 7, platform_cm: 0.5 }),
  platform_sandal: S('sandal', 'platform sandal: straps on a deep platform and high heel', { upper: 'strappy', toe: 'open', heel: 'block', sole: 'chunky', straps: ['toe', 'ankle'] }, { heel_cm: 14, platform_cm: 4 }),
  wedge_sandal: S('sandal', 'wedge sandal: straps on a wedge', { upper: 'strappy', toe: 'open', heel: 'wedge', sole: 'crepe', straps: ['toe', 'ankle'] }, { heel_cm: 9, platform_cm: 2 }),
  // mules and clogs
  mule: S('mule', 'flat mule: closed front, open back', { upper: 'backless', toe: 'almond', heel: 'flat', sole: 'thin' }, { heel_cm: 1.5, platform_cm: 0.5 }),
  heeled_mule: S('mule', 'heeled mule', { upper: 'backless', toe: 'pointed', heel: 'block', sole: 'thin' }, { heel_cm: 7, platform_cm: 0.5 }),
  clog: S('mule', 'clog: rounded closed front on a thick wooden or rubber sole', { upper: 'backless', toe: 'round', heel: 'block', sole: 'chunky' }, { heel_cm: 5, platform_cm: 3 }),
  // heels
  pump: S('heel', 'court shoe or pump: bare instep, heel cup', { upper: 'open', toe: 'round', heel: 'stiletto', sole: 'thin' }, { heel_cm: 9, platform_cm: 0.5 }),
  stiletto: S('heel', 'pointed stiletto pump', { upper: 'open', toe: 'pointed', heel: 'stiletto', sole: 'thin' }, { heel_cm: 10, platform_cm: 0.5 }),
  kitten_heel: S('heel', 'kitten heel: short thin heel', { upper: 'open', toe: 'pointed', heel: 'kitten', sole: 'thin' }, { heel_cm: 4, platform_cm: 0.5 }),
  block_heel: S('heel', 'block-heel court shoe', { upper: 'open', toe: 'almond', heel: 'block', sole: 'thin' }, { heel_cm: 7, platform_cm: 0.5 }),
  cone_heel: S('heel', 'cone heel: tapers to a small tip', { upper: 'open', toe: 'almond', heel: 'cone', sole: 'thin' }, { heel_cm: 7, platform_cm: 0.5 }),
  platform_pump: S('heel', 'platform pump: very high stiletto on a platform', { upper: 'open', toe: 'round', heel: 'stiletto', sole: 'chunky' }, { heel_cm: 15, platform_cm: 4.5 }),
  peep_toe: S('heel', 'peep-toe pump', { upper: 'open', toe: 'open', heel: 'stiletto', sole: 'thin' }, { heel_cm: 10, platform_cm: 1 }),
  slingback: S('heel', 'slingback: a strap round the back of the heel instead of a cup', { upper: 'backless', toe: 'pointed', heel: 'kitten', sole: 'thin', straps: ['back'] }, { heel_cm: 6, platform_cm: 0.5 }),
  mary_jane: S('heel', 'Mary Jane: strap across the instep', { upper: 'open', toe: 'round', heel: 'block', sole: 'normal', straps: ['instep'] }, { heel_cm: 5, platform_cm: 1 }),
  ankle_strap: S('heel', 'ankle-strap heel', { upper: 'open', toe: 'pointed', heel: 'stiletto', sole: 'thin', straps: ['ankle'] }, { heel_cm: 10, platform_cm: 0.5 }),
  wedge: S('heel', 'closed wedge', { upper: 'open', toe: 'round', heel: 'wedge', sole: 'normal' }, { heel_cm: 8, platform_cm: 1.5 }),
  // boots
  boot: S('boot', 'heeled ankle boot (the 1.x boot)', { upper: 'closed', toe: 'round', heel: 'stiletto', sole: 'thin', fit: 'fitted' }, { heel_cm: 10, platform_cm: 1, shaft_cm: 20 }),
  ankle_boot: S('boot', 'flat ankle boot', { upper: 'closed', toe: 'round', heel: 'block', sole: 'normal', fit: 'fitted' }, { heel_cm: 3, platform_cm: 1, shaft_cm: 15 }),
  chelsea: S('boot', 'Chelsea boot: elastic sides, low block heel', { upper: 'closed', toe: 'almond', heel: 'block', sole: 'normal', fit: 'fitted' }, { heel_cm: 3, platform_cm: 1.2, shaft_cm: 15 }),
  heeled_ankle_boot: S('boot', 'heeled ankle boot on a block heel', { upper: 'closed', toe: 'pointed', heel: 'block', sole: 'thin', fit: 'fitted' }, { heel_cm: 8, platform_cm: 0.8, shaft_cm: 16 }),
  combat: S('boot', 'combat boot: laced, on a deep cleated sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'lug', laces: true, fit: 'fitted' }, { heel_cm: 4, platform_cm: 2.5, shaft_cm: 20 }),
  hiking: S('boot', 'hiking boot: padded, laced, cleated sole', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'lug', laces: true, fit: 'loose' }, { heel_cm: 4, platform_cm: 2.5, shaft_cm: 16 }),
  work_boot: S('boot', 'work boot: square, heavy, laced', { upper: 'closed', toe: 'square', heel: 'block', sole: 'lug', laces: true, fit: 'loose' }, { heel_cm: 4, platform_cm: 2.5, shaft_cm: 18 }),
  platform_boot: S('boot', 'platform boot: deep platform and heel', { upper: 'closed', toe: 'round', heel: 'block', sole: 'chunky', fit: 'fitted' }, { heel_cm: 15, platform_cm: 5, shaft_cm: 20 }),
  cowboy: S('boot', 'cowboy or western boot: pointed toe, cuban heel', { upper: 'closed', toe: 'pointed', heel: 'cuban', sole: 'thin', fit: 'loose' }, { heel_cm: 5, platform_cm: 1, shaft_cm: 30 }),
  mid_calf_boot: S('boot', 'mid-calf boot', { upper: 'closed', toe: 'round', heel: 'block', sole: 'normal', fit: 'fitted' }, { heel_cm: 5, platform_cm: 1, shaft_cm: 30 }),
  knee_boot: S('boot', 'knee-high boot', { upper: 'closed', toe: 'almond', heel: 'block', sole: 'thin', fit: 'fitted' }, { heel_cm: 6, platform_cm: 1, shaft_cm: 42 }),
  heeled_knee_boot: S('boot', 'knee-high stiletto boot', { upper: 'closed', toe: 'pointed', heel: 'stiletto', sole: 'thin', fit: 'fitted' }, { heel_cm: 10, platform_cm: 0.8, shaft_cm: 42 }),
  riding: S('boot', 'riding boot: tall, fitted, low heel', { upper: 'closed', toe: 'round', heel: 'cuban', sole: 'thin', fit: 'fitted' }, { heel_cm: 3, platform_cm: 1, shaft_cm: 44 }),
  slouch_boot: S('boot', 'slouch boot: loose, gathered shaft', { upper: 'closed', toe: 'round', heel: 'block', sole: 'normal', fit: 'slouch' }, { heel_cm: 5, platform_cm: 1, shaft_cm: 35 }),
  over_knee: S('boot', 'over-the-knee boot', { upper: 'closed', toe: 'pointed', heel: 'block', sole: 'thin', fit: 'fitted' }, { heel_cm: 8, platform_cm: 1, shaft_cm: 58 }),
  thigh_high: S('boot', 'thigh-high boot', { upper: 'closed', toe: 'pointed', heel: 'stiletto', sole: 'thin', fit: 'fitted' }, { heel_cm: 11, platform_cm: 1, shaft_cm: 70 }),
  wellington: S('boot', 'wellington or rain boot: wide rubber shaft', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'lug', fit: 'loose' }, { heel_cm: 3, platform_cm: 1.5, shaft_cm: 38 }),
  snow_boot: S('boot', 'snow or sheepskin boot: wide, soft, round', { upper: 'closed', toe: 'round', heel: 'flat', sole: 'chunky', fit: 'loose' }, { heel_cm: 3, platform_cm: 2, shaft_cm: 24 }),
};

/**
 * The real model each shape is drawn with (skills/gait-bench/shoes/, MakeHuman CC0/CC-BY models fitted to a real foot,
 * and one shoe traced from photos). Where the library has no shoe of that kind, the nearest real one is raised to the
 * shape's typical heel and the scene is told so (`near`). Capsules are drawn only for socks, or with footwear.capsule.
 */
export const SHAPE_MODELS = {
  barefoot: 'barefoot', ballet_flat: 'black-ballet-flat', loafer: ['black-leather-derby', 'no slip-on leather loafer in the library'], moccasin: ['canvas-slip-on', 'no moccasin in the library'],
  boat_shoe: ['brown-leather-oxford', 'no boat shoe in the library'], oxford: 'men-oxford', brogue: 'brown-leather-oxford', monk: 'men-monk-strap',
  espadrille: ['canvas-slip-on', 'no rope sole in the library'], plimsoll: ['canvas-slip-on', 'no plimsoll in the library'],
  trainer: 'casual-trainer', running: 'white-running-trainer', high_top: 'white-high-top-trainer', skate: 'yellow-retro-trainer',
  chunky_trainer: ['dark-running-shoe', 'no chunky sole in the library: the sole is raised'], platform_trainer: ['dark-running-shoe', 'no platform trainer in the library: the sole is raised'],
  sandal: 'strappy-flat-sandal', flip_flop: 'flip-flop', slide: ['flip-flop', 'no slide in the library'], sport_sandal: ['strappy-flat-sandal', 'no sport sandal in the library'],
  gladiator: 'gladiator-sandal', heeled_sandal: ['strappy-flat-sandal', 'no heeled sandal in the library: a flat sandal raised to the heel'],
  block_sandal: ['strappy-flat-sandal', 'no heeled sandal in the library: a flat sandal raised to the heel'], platform_sandal: ['strappy-flat-sandal', 'no platform sandal in the library: a flat sandal raised'],
  wedge_sandal: ['strappy-flat-sandal', 'no wedge sandal in the library: a flat sandal raised'],
  mule: ['pointed-flat', 'no mule in the library: a closed flat'], heeled_mule: ['black-suede-platform-gold-16', 'no mule in the library: a court shoe'], clog: ['canvas-slip-on', 'no clog in the library'],
  pump: 'black-suede-platform-gold-16', stiletto: 'black-suede-platform-gold-16', kitten_heel: 'black-suede-platform-gold-16', block_heel: ['black-suede-platform-gold-16', 'a stiletto court shoe: no block-heel court in the library'],
  cone_heel: ['black-suede-platform-gold-16', 'a stiletto court shoe: no cone heel in the library'], platform_pump: 'black-suede-platform-gold-16', peep_toe: ['black-suede-platform-gold-16', 'a closed-toe court shoe'],
  slingback: ['black-suede-platform-gold-16', 'a court shoe: no slingback in the library'], mary_jane: 'mary-jane', ankle_strap: ['black-suede-platform-gold-16', 'a court shoe without the strap'],
  wedge: ['black-suede-platform-gold-16', 'a court shoe: no closed wedge in the library'],
  boot: 'block-heel-ankle-boot', ankle_boot: 'black-leather-ankle-boot', chelsea: 'black-leather-ankle-boot', heeled_ankle_boot: 'stiletto-ankle-bootie',
  combat: 'men-biker-boot', hiking: ['winter-boot', 'no hiking boot in the library'], work_boot: ['men-biker-boot', 'no work boot in the library'], platform_boot: 'platform-gogo-boot',
  cowboy: ['brown-leather-boot', 'no cowboy boot in the library'], mid_calf_boot: 'tight-leather-boot', knee_boot: 'riding-boot', heeled_knee_boot: 'heeled-knee-boot',
  riding: 'riding-boot', slouch_boot: 'slouch-over-knee-boot', over_knee: 'slouch-over-knee-boot', thigh_high: ['knee-high-stiletto-boot', 'the tallest heeled boot in the library'],
  wellington: 'rain-boot', snow_boot: 'winter-boot',
};
/** The real model for a footwear block's style, and a note when it is only the nearest: { model, near } or null. */
export function shapeModel(fw) {
  if (!fw || fw.capsule || fw.model) return null;
  const m = SHAPE_MODELS[shapeName(fw)];
  if (!m) return null;
  return Array.isArray(m) ? { model: m[0], near: m[1] } : { model: m, near: null };
}

/** The 1.x style names stay valid. */
export const SHOE_ALIASES = { court: 'pump', sneaker: 'trainer', heel: 'pump', flat: 'ballet_flat', derby: 'oxford', thong: 'flip_flop', sheepskin: 'snow_boot', rain_boot: 'wellington', western: 'cowboy' };

/** The shape a footwear block asks for (aliases resolved), or null for the plain shoe. */
export function shapeName(fw) {
  const st = fw?.style;
  if (st == null) return null;
  return SHOE_SHAPES[st] ? st : SHOE_ALIASES[st] ?? st;
}

/** The parts to draw: the named shape with the scene's overrides on top; null for the plain shoe or a library mesh. */
export function shoeShape(fw) {
  const name = shapeName(fw);
  if (!name || !SHOE_SHAPES[name]) return null;
  const sh = SHOE_SHAPES[name], out = { name };
  for (const k of ['upper', 'toe', 'heel', 'sole', 'fit']) out[k] = fw[k] ?? sh[k] ?? (k === 'fit' ? 'fitted' : null);
  out.straps = Array.isArray(fw.straps) ? fw.straps : sh.straps ?? [];
  out.laces = fw.laces ?? sh.laces ?? false;
  out.shaft_cm = fw.shaft_cm ?? fw.boot_height_cm ?? sh.shaft_cm ?? 0;
  return out;
}

/** Fill a raw footwear block's missing heel, platform and shaft from its shape, and list what is wrong with it. */
export function fillShoe(fw) {
  const problems = [];
  if (!fw || typeof fw !== 'object' || fw.style == null || fw.model) return problems;
  const name = shapeName(fw), sh = SHOE_SHAPES[name];
  if (!sh) { problems.push(`figure.footwear.style "${fw.style}" is not a known shape: see references/shoes.md (e.g. ${['trainer', 'oxford', 'pump', 'ankle_boot', 'knee_boot', 'sandal'].join(', ')})`); return problems; }
  if (fw.heel_cm == null) fw.heel_cm = sh.heel_cm;
  if (fw.platform_cm == null) fw.platform_cm = Math.min(sh.platform_cm, fw.heel_cm);
  for (const k of ['upper', 'toe', 'heel', 'sole', 'fit']) if (fw[k] != null && !SHOE_PARTS[k].includes(fw[k])) problems.push(`figure.footwear.${k} must be one of ${SHOE_PARTS[k].join(', ')}`);
  if (fw.straps != null && !(Array.isArray(fw.straps) && fw.straps.every((x) => SHOE_PARTS.straps.includes(x)))) problems.push(`figure.footwear.straps lists any of ${SHOE_PARTS.straps.join(', ')}`);
  const shaft = fw.shaft_cm ?? fw.boot_height_cm;
  if (shaft != null && !(shaft >= 0 && shaft <= 90)) problems.push('figure.footwear.shaft_cm must be 0–90');
  return problems;
}

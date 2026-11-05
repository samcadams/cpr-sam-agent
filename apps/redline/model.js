/*
 * REDLINE: street racing on the phone (OutRun / Road Rash style). Pure game logic here, in fixed steps;
 * the phone draws it in pseudo-3D (apps/redline/draw.js) and runs it (apps/redline/page.js).
 *
 * Two modes:
 *   Quick Race   a random short sprint (about 45–90 s) in a random district against a small AI pack. No board;
 *                "run it again" replays the same seed against your own last run as a ghost, and a course
 *                you liked can be nominated for the GM's track builder.
 *   Set Tracks   the GM's tracks (circuits with laps, or long sprints), generated from a seed, with a
 *                board per track (best total time and best lap) and ghosts: each character's best run.
 *
 * A track is a seed record (trackSpec); buildTrack turns it into segments the same way every time.
 * Circuits are drawn as a closed blob first (a wobbly, star-shaped loop), so the minimap is the real
 * shape; sprints are a walk of straights and bends that never doubles back. Hills ride on top as waves. The
 * GM can redraw either through control points instead (layoutShape).
 *
 * Units: metres and seconds. A race's distance (`total`) runs from the start line (the grid is behind it,
 * so negative); `s` is metres along the track's own geometry (0 to `track.len`). `x` is metres across the
 * road, right positive; the road is ±ROAD wide, then a shoulder, then a wall. Curvature `k` (1/m) is
 * positive where the road bends right.
 *
 * World settings (all small): "redline" (the GM's switches, configOf), "redlineTracks" (the GM's
 * tracks and players' nominations), "redlineBoard" (each track's runs). Ghosts are host files in the
 * world's cpr-sam-agent/redline/ folder; what each character has seen of each track is the app table
 * redlineSeen (keyed by actor).
 */

/* ---------------- Tuning ---------------- */

/** Physics steps per second: races play the same at any frame rate. */
export const STEP = 1 / 120;
/** Metres per track segment. */
export const SEG = 6;
/** Half the road's width, the shoulder past it, and the wall. */
export const ROAD = 7;
export const WALL = ROAD + 4;
/** The road's four lanes (their centres). */
export const LANES = [-5.25, -1.75, 1.75, 5.25];
/** Straight track before the start line and after a sprint's finish. */
export const START = 72;
export const RUNOUT = 90;

export const PHYSICS = {
  steer: 12, // m/s across the road at full grip and speed
  centri: 0.4, // how hard a bend pushes you out (× v² × k): the sharp bends need a lift or the brakes
  drift: 0.35, // of a bend's push you feel while the grip holds it (a lean on the keys, not a fight)
  slide: 1, // all of the push past the grip slides you wide (flat out through the sharpest bends still finds the wall)…
  scrub: 16, // …and the most m/s² the sliding tyres scrub off (overcooking a bend costs speed, not the wall)
  brake: 32, // m/s²
  coast: 4, // m/s² slowing off the throttle (the AI's lift)
  offTop: 0.5, // of top speed, off the road
  offDrag: 22, // m/s² when faster than that off the road
  wallDrag: 2.6, // of the speed lost per second along the wall
  wallHard: 7, // m/s across into the wall: faster is a crash, not a scrape
  bump: 0.4, // seconds between two knocks from the same thing
  recover: 3, // seconds after a wreck: back to the middle of the road and up to speed, hands off
  grace: 0.8, // seconds after that nothing hits you
  mend: 2, // damage mended a second…
  mendAfter: 5, // …after this many seconds without a knock
  punchCool: 0.6,
  punchReach: 2.8, // metres to the side a punch or kick reaches
  windup: 0.5, // seconds a ganger's (or a rival's, or a cruiser's) swing shows before it lands
  shoveDamp: 7, // how fast a shove across the road dies away (per second)
  air: 0.13, // seconds in the air per 10 m/s off a ramp
  countdown: 3 // seconds of red lights
};

/** Hitboxes are this much of a ride's drawn size (across, along): a near miss is a miss. */
const HIT = { w: 0.8, len: 0.75 };

/**
 * Ride classes: top speed (m/s), acceleration, grip (steering and how much a bend pushes), toughness
 * (damage taken is divided by it), width, length, and whether it's a bike (bikes fight, cars ram).
 */
export const CLASSES = {
  roadbike: { name: "Roadbike", bike: true, top: 58, accel: 16, grip: 1.05, tough: 1.15, mass: 1, w: 0.9, len: 2.2, blurb: "Nimble, fights from the saddle" },
  compact: { name: "Compact", bike: false, top: 54, accel: 13, grip: 1.12, tough: 1.6, mass: 3.5, w: 1.8, len: 4, blurb: "Slow, sticky, rams like a brick" },
  sport: { name: "Sport", bike: false, top: 64, accel: 14, grip: 1.0, tough: 1.2, mass: 3, w: 1.9, len: 4.4, blurb: "Fast and balanced, rams" },
  superbike: { name: "Superbike", bike: true, top: 70, accel: 19, grip: 0.86, tough: 0.9, mass: 1, w: 0.9, len: 2.3, blurb: "Fastest, twitchy, fragile" }
};
export const CLASS_IDS = Object.keys(CLASSES);
/** The fastest top speed of any class (for plausible times). */
export const FASTEST = Math.max(...Object.values(CLASSES).map(c => c.top));

/** Hazard families (the GM picks per track, from the district's). `zone`: an area, not a thing to hit. */
export const HAZARDS = {
  traffic: { name: "Traffic" },
  pothole: { name: "Potholes" },
  wreck: { name: "Burning wrecks" },
  gang: { name: "Gangers who fight" },
  checkpoint: { name: "NCPD checkpoints" },
  convoy: { name: "Nomad convoys" },
  sand: { name: "Sandstorms", zone: true },
  flood: { name: "Floods" },
  roadblock: { name: "Maelstrom roadblocks" },
  ramp: { name: "Ramps" }
};

/**
 * Districts: their families (and how often each turns up), the look of their circuits (`stretch` across,
 * `wiggle`: how twisty), hills (metres), traffic (how much), and how much of it is semis.
 */
export const DISTRICTS = {
  combat: {
    name: "Combat Zone", blurb: "Gangers who fight, wrecks, darkness", dark: true,
    families: { pothole: 3, wreck: 3, gang: 2, traffic: 1 }, wiggle: 0.34, stretch: 1.1, hills: 13, traffic: 1, semis: 0.1
  },
  corpo: {
    name: "Corporate Center", blurb: "Traffic, NCPD checkpoints, tight turns",
    families: { traffic: 3, checkpoint: 3 }, wiggle: 0.42, stretch: 1, hills: 10, traffic: 1.7, tight: true, semis: 0.1
  },
  badlands: {
    name: "Badlands highway", blurb: "Straights, Nomad convoys, potholes, sandstorms",
    families: { pothole: 2, convoy: 2, sand: 1, traffic: 1 }, wiggle: 0.22, stretch: 2.1, hills: 30, traffic: 0.9, semis: 0.4
  },
  pacifica: {
    name: "Pacifica / Glen", blurb: "Floods, Maelstrom roadblocks, ramps",
    families: { flood: 3, roadblock: 2, ramp: 2, traffic: 1 }, wiggle: 0.3, stretch: 1.3, hills: 20, traffic: 1, semis: 0.2
  }
};
export const DISTRICT_IDS = Object.keys(DISTRICTS);

/** The sharpest bend (1/m) a track may have, by difficulty (1–3). */
const KMAX = [0, 1 / 70, 1 / 46, 1 / 32];
/** Metres between hazards, by difficulty. */
const HAZARD_EVERY = [0, 300, 210, 150];
/** The AI pack's pace (of their class's top speed), by difficulty. */
const AI_PACE = [0, 0.865, 0.93, 0.97];
/** How far past the grip the AI takes a bend (past it is a slide wide and some scrubbed speed, which the road soaks up). */
export const AI_GRIP = 2.25;
/** Hazards that block (crash into them); the rest slow you or launch you. */
const BLOCKS = new Set(["wreck", "fire", "checkpoint", "roadblock"]);

/** Fog of war: a track's sections, revealed to a character as they drive them. */
export const SECTIONS = 20;

/** How long a Quick Race's sprint is (metres), and the GM's choices for Set Tracks. */
export const QUICK_LEN = [2600, 4600];
export const LAP_LEN = { min: 1800, max: 5000, default: 3200 };
export const SPRINT_LEN = { min: 3000, max: 14000, default: 7000 };
export const LAPS = { min: 1, max: 6, default: 3 };

/** The racers in a pack (besides the player): Quick Race, Set Track. */
export const PACK = { quick: 4, set: 5 };

/* ---------------- The GM's switches ---------------- */

/** Drive skill: off, or a Drive Land Vehicle roll picks your grid slot. */
export const DRIVE_MODES = { off: "Off", grid: "Grid roll" };

export const REDLINE_DEFAULTS = { fighting: true, heat: true, drive: "grid", paused: false };

/** The GM's switches (the world setting "redline"), with defaults filled in. */
export function configOf(saved = {}) {
  const bool = (k) => (typeof saved?.[k] === "boolean" ? saved[k] : REDLINE_DEFAULTS[k]);
  return {
    fighting: bool("fighting"),
    heat: bool("heat"),
    paused: bool("paused"),
    drive: Object.hasOwn(DRIVE_MODES, saved?.drive) ? saved.drive : REDLINE_DEFAULTS.drive
  };
}

/* ---------------- Randomness ---------------- */

/** A seeded random source: () => [0, 1). The same seed always gives the same numbers. */
export function seeded(seed) {
  let a = Math.floor(Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new seed. */
export const newSeed = (rand = Math.random) => Math.floor(rand() * 2 ** 31);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------------- Track specs ---------------- */

/** A district's own families, all on. */
export const defaultFamilies = district => Object.fromEntries(Object.keys(DISTRICTS[district]?.families ?? {}).map(f => [f, true]));

/**
 * A track's seed record, with every field checked and filled in:
 * { id, name, district, kind: "circuit" | "sprint", laps, length (metres: a lap, or the sprint), difficulty
 * (1–3), families: { [family]: bool }, seed, status: "draft" | "live" | "retired", ts, from? (a nomination),
 * points? (the GM's own layout: control points in metres, see layoutPoints; without them the seed draws it) }
 */
export function trackSpec(spec = {}) {
  const district = Object.hasOwn(DISTRICTS, spec.district) ? spec.district : "combat";
  const kind = spec.kind === "sprint" ? "sprint" : "circuit";
  const range = kind === "circuit" ? LAP_LEN : SPRINT_LEN;
  const own = DISTRICTS[district].families;
  const families = Object.fromEntries(Object.keys(own).map(f => [f, typeof spec.families?.[f] === "boolean" ? spec.families[f] : true]));
  const points = layoutPoints(spec.points, kind);
  return {
    id: String(spec.id ?? ""),
    name: String(spec.name ?? "").slice(0, 40),
    district,
    kind,
    laps: kind === "circuit" ? clamp(Math.round(Number(spec.laps) || LAPS.default), LAPS.min, LAPS.max) : 1,
    length: clamp(Math.round(Number(spec.length) || range.default), range.min, range.max),
    difficulty: clamp(Math.round(Number(spec.difficulty) || 2), 1, 3),
    families,
    seed: Math.floor(Number(spec.seed) || 0) >>> 0,
    status: ["draft", "live", "retired"].includes(spec.status) ? spec.status : "draft",
    ts: Number(spec.ts) || 0,
    ...(spec.from ? { from: String(spec.from).slice(0, 60) } : {}),
    ...(points ? { points } : {})
  };
}

/** Most control points in a layout, and how far out they may go (metres). */
export const LAYOUT = { min: { circuit: 4, sprint: 3 }, max: 120, reach: 20000 };

/** A layout's control points checked ([[x, y]] in whole metres, x right, y up), or null. */
export function layoutPoints(list, kind) {
  if (!Array.isArray(list) || list.length < LAYOUT.min[kind] || list.length > LAYOUT.max) return null;
  const out = [];
  for (const p of list) {
    const [x, y] = [Number(p?.[0]), Number(p?.[1])];
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > LAYOUT.reach || Math.abs(y) > LAYOUT.reach) return null;
    out.push([Math.round(x), Math.round(y)]);
  }
  return out;
}

/** A Quick Race: a random short sprint in a random district (`seed` picks everything). */
export function quickSpec(seed) {
  const rand = seeded(seed ^ 0x51ed);
  const district = pick(rand, DISTRICT_IDS);
  return trackSpec({
    id: `quick-${seed}`, name: `${DISTRICTS[district].name} sprint`, district, kind: "sprint",
    length: Math.round(lerp(QUICK_LEN[0], QUICK_LEN[1], rand()) / 100) * 100,
    difficulty: 1 + Math.floor(rand() * 3), seed, status: "live"
  });
}

/** Made-up track names (the GM can rename). */
const NAME_A = ["Neon", "Chrome", "Redline", "Glass", "Static", "Rust", "Night", "Ghost", "Blackwall", "Kabuki", "Smog", "Arasaka", "Grid", "Zero", "Afterlife"];
const NAME_B = ["Loop", "Run", "Mile", "Spiral", "Ring", "Dash", "Circuit", "Gauntlet", "Strip", "Burn", "Sprint", "Drift", "Line"];
export const trackName = (seed) => {
  const rand = seeded(seed ^ 0xa11ce);
  return `${pick(rand, NAME_A)} ${pick(rand, NAME_B)}`;
};

/* ---------------- Building a track ---------------- */

/**
 * The track for a spec, built the same way every time: { spec, n (segments), len (metres), segs: [{ k, y }]
 * (curvature and height at each segment's start), map: [[x, y]] (the minimap, one point per segment, metres),
 * closed, hazards: [{ id, kind, s, len, x0, x1 }], zones: [{ kind, s0, s1 }], finish (race metres) }.
 */
export function buildTrack(input) {
  const spec = trackSpec(input);
  const rand = seeded(spec.seed);
  const d = DISTRICTS[spec.district];
  const closed = spec.kind === "circuit";
  // The seed's own shape is always drawn (so the hills and hazards come out the same); the GM's layout, if
  // there is one, replaces it.
  const generated = closed ? circuitShape(rand, d, spec) : sprintShape(rand, d, spec);
  const shape = spec.points ? layoutShape(spec.points, closed, kmaxOf(spec)) : { ...generated, origin: { x: 0, y: 0, h: 0 } };
  const n = shape.k.length;
  const len = n * SEG;
  const heights = closed ? circuitHills(rand, d, spec, len) : sprintHills(rand, d, spec, len);
  const segs = shape.k.map((k, i) => ({ k, y: heights(i * SEG) }));
  const track = { spec, n, len, segs, closed, map: mapOf(shape.k, closed), origin: shape.origin, eased: shape.eased ?? [], hazards: [], zones: [] };
  track.finish = closed ? spec.laps * len : len - START - RUNOUT;
  placeHazards(track, rand, d, spec);
  return track;
}

/** The sharpest bend a spec's track may have (1/m). */
export const kmaxOf = spec => KMAX[spec.difficulty] * (DISTRICTS[spec.district]?.tight ? 1.15 : 1);

/**
 * A closed loop: a wobbly circle (a few harmonics, kept star-shaped so it never crosses itself), stretched
 * for the district, scaled to the lap length and cut into segments; then its bends, eased, made no sharper
 * than the difficulty allows (by calming the wobble). Starts on its straightest stretch.
 */
function circuitShape(rand, d, spec) {
  const kmax = kmaxOf(spec);
  const harm = [2, 3, 4, 5, 6].map(m => ({ m, a: (rand() * 2 - 1) / m ** (d.tight ? 0.5 : 0.85), p: rand() * Math.PI * 2 }));
  const mirror = rand() < 0.5 ? -1 : 1;
  const total = harm.reduce((sum, h) => sum + Math.abs(h.a), 0) || 1;
  let amp = d.wiggle;
  let k = null;
  for (let tries = 0; tries < 20; tries++) {
    k = loopCurvature(harm.map(h => ({ ...h, a: (h.a / total) * amp })), d.stretch, spec.length, mirror);
    if (Math.max(...k.map(Math.abs)) <= kmax) break;
    amp *= 0.82;
  }
  // Start where the track is straightest over the next 150 m.
  const n = k.length;
  const span = Math.round(150 / SEG);
  let best = 0;
  let bestSum = Infinity;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -Math.round(START / SEG); j < span; j++) sum += Math.abs(k[(i + j + n) % n]);
    if (sum < bestSum) [best, bestSum] = [i, sum];
  }
  return { k: [...k.slice(best), ...k.slice(0, best)] };
}

/** Curvature per segment of a closed blob r(θ) = 1 + Σ a cos(mθ + p), stretched in x, `length` metres around. */
function loopCurvature(harm, stretch, length, mirror) {
  const M = 2048;
  const pts = [];
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2;
    const r = 1 + harm.reduce((sum, h) => sum + h.a * Math.cos(h.m * t + h.p), 0);
    pts.push([r * Math.cos(t) * stretch, r * Math.sin(t) * mirror]);
  }
  // Arc length, then resample at equal spacing.
  const cum = [0];
  for (let i = 1; i <= M; i++) {
    const [a, b] = [pts[i - 1], pts[i % M]];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const raw = cum[M];
  const n = Math.max(60, Math.round(length / SEG));
  const at = s => {
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
    const [a, b] = [pts[lo], pts[(lo + 1) % M]];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
  };
  const res = Array.from({ length: n }, (_, i) => at((i / n) * raw));
  const heading = res.map((p, i) => {
    const q = res[(i + 1) % n];
    return Math.atan2(q[0] - p[0], q[1] - p[1]);
  });
  const k = heading.map((h, i) => wrapAngle(heading[(i + 1) % n] - h) / SEG);
  // Smooth (a few passes of a small kernel), keeping the total turn.
  let out = k;
  for (let pass = 0; pass < 3; pass++) out = out.map((_, i) => (out[(i - 2 + n) % n] + 2 * out[(i - 1 + n) % n] + 3 * out[i] + 2 * out[(i + 1) % n] + out[(i + 2) % n]) / 9);
  return out;
}

/** How far a sprint may turn from its way (radians): under a right angle, so a route never doubles back over itself. */
const HEAD_MAX = 1.35;

/**
 * A sprint: a straight start, then straights, bends and S-bends picked for the district, easing in and out
 * of each bend; a straight run-out at the end. It never turns more than HEAD_MAX from the way it set off,
 * so it always gains ground that way and can't cross itself (it's a route, not a knot).
 */
function sprintShape(rand, d, spec) {
  const kmax = kmaxOf(spec);
  const piece = (count, curve = 0, ease = 0) => Array.from({ length: count }, (_, i) => {
    const f = ease ? Math.min(1, Math.min(i + 0.5, count - i - 0.5) / Math.max(1, count * ease)) : 1;
    return curve * smooth(clamp(f, 0, 1));
  });
  const fits = (from, list) => {
    let h = from;
    for (const v of list) if (Math.abs((h += v * SEG)) > HEAD_MAX) return false;
    return true;
  };
  const k = piece(Math.round((START + 60) / SEG));
  let heading = 0;
  const target = spec.length - RUNOUT;
  const straightK = d.stretch > 1.5 ? 2.2 : d.tight ? 0.6 : 1;
  while (k.length * SEG < target) {
    const roll = rand();
    let add;
    if (roll < 0.3) add = piece(Math.round((lerp(60, 200, rand()) * straightK) / SEG));
    else {
      const sharp = lerp(0.35, 1, rand() ** 0.7) * kmax;
      const angle = lerp(0.35, 1.5, rand());
      // The easing takes about a quarter off the turn.
      const segs = Math.max(4, Math.round(angle / (sharp * SEG * 0.75)));
      const bend = dir => (roll < 0.75 ? piece(segs, dir * sharp, 0.3) : [...piece(Math.round(segs * 0.6), dir * sharp, 0.35), ...piece(Math.round(segs * 0.6), -dir * sharp, 0.35)]);
      // Back toward the way when it's wandered off; either way, only a bend that keeps to it.
      const dir = heading > 0.5 ? -1 : heading < -0.5 ? 1 : rand() < 0.5 ? -1 : 1;
      add = [bend(dir), bend(-dir)].find(list => fits(heading, list)) ?? piece(Math.round(80 / SEG));
    }
    k.push(...add);
    heading += add.reduce((sum, v) => sum + v * SEG, 0);
  }
  k.push(...piece(Math.round(RUNOUT / SEG) + 6));
  return { k };
}

/** The steepest a hill may be. */
const SLOPE = 0.13;

/** Rolling hills around a loop (whole waves, so it closes). */
function circuitHills(rand, d, spec, len) {
  const waves = [1, 2, 3, 4, 6].map(m => ({ m, a: d.hills * lerp(0.3, 1, rand()) / Math.sqrt(m), p: rand() * Math.PI * 2 }));
  const slope = waves.reduce((sum, w) => sum + (w.a * w.m * Math.PI * 2) / len, 0);
  const scale = slope > SLOPE ? SLOPE / slope : 1;
  return s => waves.reduce((sum, w) => sum + w.a * scale * Math.sin((w.m * Math.PI * 2 * s) / len + w.p), 0);
}

/** Hills along a sprint: crests and dips, flat at the start and the finish. */
function sprintHills(rand, d, spec, len) {
  const waves = [0, 1, 2].map(i => ({ l: lerp([700, 380, 240][i], [1800, 900, 520][i], rand()), a: d.hills * lerp(0.4, 1, rand()) * [1, 0.7, 0.4][i], p: rand() * Math.PI * 2 }));
  const slope = waves.reduce((sum, w) => sum + (w.a * Math.PI * 2) / w.l, 0);
  const scale = slope > SLOPE ? SLOPE / slope : 1;
  const flat = 220;
  return s => {
    const edge = smooth(clamp(Math.min(s - START, len - RUNOUT - s) / flat, 0, 1));
    return edge * waves.reduce((sum, w) => sum + w.a * scale * (Math.sin((Math.PI * 2 * s) / w.l + w.p) - Math.sin(w.p)), 0);
  };
}

/** The minimap: the track as points (metres), from its bends. A circuit's small drift is spread out so it closes. */
function mapOf(k, closed) {
  let h = 0;
  let x = 0;
  let y = 0;
  const pts = [];
  const n = k.length;
  const turn = k.reduce((sum, v) => sum + v * SEG, 0);
  const fix = closed ? (Math.sign(turn || 1) * Math.PI * 2 - turn) / n : 0;
  for (let i = 0; i < n; i++) {
    pts.push([x, y]);
    h += k[i] * SEG + fix;
    x += Math.sin(h) * SEG;
    y += Math.cos(h) * SEG;
  }
  if (closed) {
    const [dx, dy] = [x - pts[0][0], y - pts[0][1]];
    pts.forEach((p, i) => {
      p[0] -= (dx * i) / n;
      p[1] -= (dy * i) / n;
    });
  }
  return pts.map(([px, py]) => [Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
}

/* ---------------- The GM's own layouts ---------------- */

/**
 * A layout drawn through control points (the GM's track editor, apps/redline/editor.js): a smooth curve through
 * them (closed for a circuit), cut into segments; bends sharper than the difficulty allows are eased out into
 * longer ones (`eased`: the segments that were). `origin`: where the first segment sits and which way it
 * heads, so the built map lines up with the points.
 */
export function layoutShape(points, closed, kmax) {
  const dense = splinePoints(points, closed);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum.at(-1) || 1;
  const n = Math.max(closed ? 60 : 30, Math.round(total / SEG));
  let j = 0;
  const at = s => {
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    return [lerp(dense[j][0], dense[j + 1][0], f), lerp(dense[j][1], dense[j + 1][1], f)];
  };
  // Closed: n points round the loop (the last wraps to the first); open: n + 1 points end to end.
  const res = Array.from({ length: closed ? n : n + 1 }, (_, i) => at((i / n) * total));
  const heading = Array.from({ length: n }, (_, i) => {
    const [p, q] = [res[i], res[(i + 1) % res.length]];
    return Math.atan2(q[0] - p[0], q[1] - p[1]);
  });
  let k = heading.map((h, i) => (i + 1 < n || closed ? wrapAngle(heading[(i + 1) % n] - h) / SEG : 0));
  for (let pass = 0; pass < 2; pass++) {
    k = k.map((_, i) => {
      const nb = d => k[closed ? (i + d + n) % n : clamp(i + d, 0, n - 1)];
      return (nb(-1) + 2 * k[i] + nb(1)) / 4;
    });
  }
  const eased = easeBends(k, kmax, closed);
  return { k, eased, origin: { x: res[0][0], y: res[0][1], h: heading[0] } };
}

/** Bends sharper than `kmax` spread into their neighbours (the same total turn, over longer). Returns the indices eased. */
function easeBends(k, kmax, closed) {
  const n = k.length;
  const eased = new Set();
  for (let pass = 0; pass < 4000; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const over = Math.abs(k[i]) - kmax;
      if (over <= 1e-9) continue;
      moved = true;
      eased.add(i);
      const extra = Math.sign(k[i]) * over;
      k[i] -= extra;
      const left = closed ? (i - 1 + n) % n : i - 1;
      const right = closed ? (i + 1) % n : i + 1;
      const sides = [left, right].filter(x => x >= 0 && x < n);
      for (const x of sides) k[x] += extra / sides.length;
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) k[i] = clamp(k[i], -kmax, kmax);
  return [...eased].sort((a, b) => a - b);
}

/** A smooth curve through the points (centripetal Catmull-Rom), as many small steps. */
function splinePoints(points, closed) {
  const n = points.length;
  const get = i => (closed ? points[(i + n) % n] : i < 0 ? mirrorEnd(points[0], points[1]) : i >= n ? mirrorEnd(points[n - 1], points[n - 2]) : points[i]);
  const out = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
    const steps = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
  }
  out.push(closed ? [...points[0]] : [...points[n - 1]]);
  return out;
}

const mirrorEnd = (end, next) => [2 * end[0] - next[0], 2 * end[1] - next[1]];

function catmull(p0, p1, p2, p3, t) {
  const knot = (a, b) => Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const mixP = (a, b, ta, tb) => [0, 1].map(c => ((tb - u) / (tb - ta)) * a[c] + ((u - ta) / (tb - ta)) * b[c]);
  const a1 = mixP(p0, p1, 0, t1);
  const a2 = mixP(p1, p2, t1, t2);
  const a3 = mixP(p2, p3, t2, t3);
  const b1 = mixP(a1, a2, 0, t2);
  const b2 = mixP(a2, a3, t1, t3);
  return mixP(b1, b2, t1, t2);
}

/** A track's map placed where its layout's points are (metres, x right, y up). */
export function placedMap(track) {
  const { x, y, h } = track.origin ?? { x: 0, y: 0, h: 0 };
  const [c, s] = [Math.cos(h), Math.sin(h)];
  return track.map.map(([px, py]) => [x + px * c + py * s, y - px * s + py * c]);
}

/** Control points to start editing a track from: its map, every so often. */
export function pointsFrom(track) {
  const map = placedMap(track);
  const n = map.length;
  const count = clamp(Math.round(track.len / 160), track.closed ? 8 : 4, 60);
  const out = Array.from({ length: count }, (_, i) => map[Math.floor((i / count) * n)]);
  if (!track.closed) out.push(map[n - 1]);
  return out.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

/** Where a layout crosses itself (metres): the points the editor marks. */
export function crossings(map, closed) {
  const out = [];
  const n = map.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [a, b] = [map[i], map[(i + 1) % n]];
    for (let j = i + 2; j < segs; j++) {
      if (closed && i === 0 && j === segs - 1) continue;
      const [c, d] = [map[j], map[(j + 1) % n]];
      const hit = cross(a, b, c, d);
      if (hit && !out.some(o => Math.hypot(o[0] - hit[0], o[1] - hit[1]) < 20)) out.push(hit);
    }
  }
  return out;
}

function cross(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}

/** The bend at a point along the track (metres; wraps on a circuit). */
export function curveAt(track, s) {
  return track.segs[segIndex(track, s)].k;
}

/** The segment a point along the track is in. */
export function segIndex(track, s) {
  const i = Math.floor(s / SEG);
  return track.closed ? ((i % track.n) + track.n) % track.n : clamp(i, 0, track.n - 1);
}

/** The road's height at a point along the track (between segments' heights). */
export function heightAt(track, s) {
  const i = Math.floor(s / SEG);
  const f = s / SEG - i;
  const a = track.segs[segIndex(track, i * SEG)].y;
  const b = track.segs[segIndex(track, (i + 1) * SEG)].y;
  return lerp(a, b, f);
}

/** Where along the track a race distance is. */
export function trackPos(track, total) {
  const s = START + total;
  return track.closed ? ((s % track.len) + track.len) % track.len : s;
}

/** Which fog-of-war section a point along the track is in. */
export const sectionOf = (track, s) => clamp(Math.floor((s / track.len) * SECTIONS), 0, SECTIONS - 1);

/* ---------------- Hazards ---------------- */

/**
 * Hazards along the track, every so often by difficulty, picked by the district's weights from the families
 * the spec allows. Each leaves a way through at least GAP wide (tests check it). Things that block don't
 * go on sharp bends. Traffic, convoys and gangers move: they're made per race (newRace).
 */
export const GAP = 4.5;

function placeHazards(track, rand, d, spec) {
  const families = Object.entries(d.families).filter(([f]) => spec.families[f] && !["traffic", "convoy", "gang"].includes(f));
  if (!families.length) return;
  const weight = families.reduce((sum, [, w]) => sum + w, 0);
  const choose = () => {
    let r = rand() * weight;
    for (const [f, w] of families) if ((r -= w) < 0) return f;
    return families[0][0];
  };
  const end = track.closed ? track.len - 120 : track.len - RUNOUT - 140;
  let id = 0;
  // Room between two things that block, to get from one gap to the next.
  let lastBlock = -Infinity;
  const BLOCK_GAP = 130;
  const add = h => track.hazards.push({ id: `h${id++}`, ...h });
  for (let s = START + 220; s < end; s += HAZARD_EVERY[spec.difficulty] * lerp(0.6, 1.4, rand())) {
    const family = choose();
    // The sharpest bend on the way in, and just past.
    let k = 0;
    for (let a = -60; a <= 12; a += SEG) k = Math.max(k, Math.abs(curveAt(track, s + a)));
    const lane = Math.floor(rand() * 4);
    if (family === "pothole") {
      const count = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const x = LANES[(lane + i * 2) % 4] + (rand() - 0.5);
        add({ kind: "pothole", s: s + i * 7, len: 2.2, x0: x - 1, x1: x + 1 });
      }
    } else if (family === "wreck") {
      if (k > KMAX[1] || s - lastBlock < BLOCK_GAP) continue;
      lastBlock = s;
      add({ kind: "wreck", s, len: 4.4, x0: LANES[lane] - 1.05, x1: LANES[lane] + 1.05 });
    } else if (family === "checkpoint" || family === "roadblock") {
      if (k > KMAX[1] * 0.8 || s - lastBlock < BLOCK_GAP) continue;
      lastBlock = s;
      const width = family === "checkpoint" ? 6.5 : GAP + 0.7;
      const g0 = lerp(-ROAD, ROAD - width, rand());
      if (g0 > -ROAD + 0.5) add({ kind: family, s, len: 1.6, x0: -WALL, x1: g0 });
      if (g0 + width < ROAD - 0.5) add({ kind: family, s, len: 1.6, x0: g0 + width, x1: WALL });
    } else if (family === "flood") {
      const half = rand() < 0.5;
      const left = rand() < 0.5;
      add({ kind: "flood", s, len: lerp(24, 44, rand()), x0: half && !left ? 0 : -ROAD, x1: half && left ? 0 : ROAD });
    } else if (family === "ramp") {
      add({ kind: "ramp", s, len: 6, x0: LANES[lane] - 2, x1: LANES[lane] + 2 });
    } else if (family === "sand") {
      track.zones.push({ kind: "sand", s0: s, s1: Math.min(end, s + lerp(180, 320, rand())) });
    }
  }
  track.hazards.sort((a, b) => a.s - b.s);
}

/** Whether a hazard blocks (crash into it) rather than slows or launches. */
export const blocks = h => BLOCKS.has(h.kind);

/** The hazards under a stretch of track [s0, s1] (wrapping on a circuit). */
export function hazardsNear(track, list, s0, s1) {
  if (!track.closed) return list.filter(h => h.s < s1 && h.s + h.len > s0);
  const L = track.len;
  return list.filter(h => {
    for (const shift of [-L, 0, L]) if (h.s + shift < s1 && h.s + shift + h.len > s0) return true;
    return false;
  });
}

/** Whether a point along the track is in a zone of a kind (a sandstorm). */
export const inZone = (track, s, kind) => track.zones.some(z => z.kind === kind && s >= z.s0 && s <= z.s1);

/* ---------------- A race ---------------- */

/** The AI's names and their rides. */
const RIVALS = [
  ["Razorback", "superbike"], ["Neon Vixen", "sport"], ["Chooh2 Charlie", "compact"], ["Kabuki Kid", "roadbike"],
  ["Lady Steel", "sport"], ["Gutterball", "compact"], ["Mantis", "superbike"], ["Rook", "roadbike"],
  ["Static Sally", "sport"], ["Big Ignis", "compact"], ["Tyger Lilly", "roadbike"], ["Halfpipe", "superbike"]
];

/**
 * Traffic's kinds: size, speed (m/s), toughness, weight (how hard it shoves and is shoved), and what the race
 * thinks of them (civilians bring Heat; gangers fight; NCPD chase).
 */
export const TRAFFIC = {
  car: { w: 1.9, len: 4.3, v: [22, 32], hp: 60, mass: 3, civ: true },
  taxi: { w: 1.9, len: 4.5, v: [24, 30], hp: 60, mass: 3, civ: true },
  van: { w: 2.3, len: 6.5, v: [20, 27], hp: 140, mass: 6, civ: true },
  semi: { w: 2.6, len: 15, v: [22, 27], hp: Infinity, mass: 20, civ: true },
  truck: { w: 2.6, len: 12, v: [26, 31], hp: Infinity, mass: 15, civ: true },
  gang: { w: 0.9, len: 2.2, v: [36, 44], hp: 40, mass: 1, bike: true, fights: true },
  cop: { w: 2, len: 4.6, v: [0, 0], hp: 120, mass: 3.5, cop: true }
};

/** The grid: slot 0 is pole. Two by two, behind the start line. */
export const gridPos = slot => ({ total: -(6 + Math.floor(slot / 2) * 9), x: slot % 2 ? 2.6 : -2.6 });

/**
 * The grid slot a Drive Land Vehicle check earns (0 = pole), out of `slots`; with no roll (Drive skill off,
 * or a Quick Race), the middle of the pack.
 */
export function gridSlot(roll, slots) {
  if (!Number.isFinite(roll)) return Math.floor((slots - 1) / 2);
  const dv = [24, 21, 18, 15, 12, 9];
  const i = dv.findIndex(v => roll >= v);
  return Math.min(slots - 1, i < 0 ? dv.length : i);
}

/**
 * A new race on a built track. Options: cls (the player's ride class), slot (grid slot, 0 = pole), config
 * (configOf), pack (number of AI racers; 0 for none), ghosts ([decoded ghosts] raced against), traffic
 * (false: none), rand (in-race randomness; seeded from the track by default, so a replay starts the same).
 */
export function newRace(track, { cls = "sport", slot = null, config = configOf(), pack = PACK.set, ghosts = [], traffic = true, rand = null } = {}) {
  const spec = track.spec;
  const rnd = rand ?? seeded(spec.seed ^ 0x7ace);
  const slots = pack + 1;
  const mySlot = slot === null ? Math.floor((slots - 1) / 2) : clamp(slot, 0, slots - 1);
  const c = CLASSES[cls] ?? CLASSES.sport;
  const me = gridPos(mySlot);
  const g = {
    track, config, cls, rand: rnd,
    t: -PHYSICS.countdown, // the clock: negative during the lights
    p: { total: me.total, x: me.x, v: 0, vx: 0, lat: 0, hp: 100, wreck: 0, grace: 0, air: 0, punch: 0, punchSide: 0, steer: 0, slot: mySlot, cls, c },
    racers: [],
    traffic: [],
    fires: [],
    ghosts,
    heat: 0, heatT: 0, heatFloor: 0, heatMarks: 0,
    lap: 0, lapStart: 0, laps: [],
    wrecks: 0, // things the player wrecked
    crashes: 0, // times the player wrecked
    seen: new Set(),
    rec: [], recT: 0,
    finished: false, over: false,
    events: []
  };
  // The pack, in the other slots.
  const pace = AI_PACE[spec.difficulty];
  const names = [...RIVALS].sort(() => rnd() - 0.5);
  let s = 0;
  for (let i = 0; i < pack; i++) {
    if (s === mySlot) s++;
    const [name, rc] = names[i % names.length];
    const pos = gridPos(s++);
    const rcls = CLASSES[rc];
    g.racers.push({
      id: `r${i}`, name, cls: rc, c: rcls, total: pos.total, x: pos.x, v: 0, vx: 0, lat: 0, hp: 100,
      pace: pace * lerp(0.96, 1.02, rnd()), prefer: LANES[Math.floor(rnd() * 4)], out: false, done: null,
      // How keen they are to fight (rivals on bikes swing, cars sideswipe), and not straight away.
      aggro: rnd(), atk: null, atkCool: 4 + rnd() * 6
    });
  }
  if (traffic) spawnTraffic(g, rnd);
  return g;
}

/** Traffic (cars, taxis, box vans, semis; and convoys and gangers) spread along the track for this race. */
function spawnTraffic(g, rnd) {
  const { track } = g;
  const spec = track.spec;
  const d = DISTRICTS[spec.district];
  const span = track.closed ? track.len : g.track.finish;
  const per = span / 1000;
  const from = 260;
  const add = (kind, total, x) => {
    const t = TRAFFIC[kind];
    // Not on top of another in the same lane.
    for (let tries = 0; tries < 4 && g.traffic.some(o => o.lane === x && Math.abs(o.total - total) < (o.len + t.len) / 2 + 12); tries++) total += 30;
    const v = lerp(t.v[0], t.v[1], rnd());
    g.traffic.push({ id: `t${g.traffic.length}`, kind, total, x, v, cruise: v, vx: 0, lat: 0, hp: t.hp, w: t.w, len: t.len, lane: x, atk: null, atkCool: 2 + rnd() * 2 });
  };
  if (spec.families.traffic) {
    for (let i = 0, n = Math.round(per * 4.5 * d.traffic * (0.8 + spec.difficulty * 0.15)); i < n; i++) {
      const r = rnd();
      const kind = r < (d.semis ?? 0.1) ? "semi" : r < (d.semis ?? 0.1) + 0.22 ? "van" : spec.district === "corpo" && rnd() < 0.35 ? "taxi" : "car";
      add(kind, from + rnd() * (span - from - 200), pick(rnd, LANES));
    }
  }
  if (spec.families.convoy) {
    for (let i = 0, n = Math.max(1, Math.round(per * 0.6)); i < n; i++) {
      const at = from + rnd() * (span - from - 300);
      const lane = pick(rnd, LANES);
      for (let j = 0; j < 3; j++) add("truck", at + j * 16, lane);
    }
  }
  if (spec.families.gang) {
    for (let i = 0, n = Math.round(per * 1.6); i < n; i++) add("gang", from + rnd() * (span - from - 200), pick(rnd, LANES));
  }
  // A convoy rolls together.
  for (const t of g.traffic) if (t.kind === "truck") t.v = t.cruise = 28;
}

/** Note something the phone should hear about (sounds, flashes): drained by the page each frame. */
const emit = (g, type, data = {}) => g.events.push({ type, ...data });

/** Advance a race by `dt` real seconds (in fixed steps). `input`: { steer: −1..1, brake, punch: −1 | 0 | 1 }. */
export function advance(g, dt, input = {}) {
  g.acc = (g.acc ?? 0) + Math.min(dt, 0.25);
  let first = true;
  while (g.acc >= STEP && !g.over) {
    g.acc -= STEP;
    step(g, STEP, first ? input : { ...input, punch: 0 });
    first = false;
  }
}

/** One fixed step. */
export function step(g, dt, input = {}) {
  if (g.over) return;
  const before = g.t;
  g.t += dt;
  if (before < 0) {
    // The lights: a beep each second, then go.
    if (Math.ceil(before) !== Math.ceil(g.t) || (before < 0 && g.t >= 0)) emit(g, g.t >= 0 ? "go" : "light", { n: -Math.floor(before) });
    if (g.t < 0) return;
  }
  movePlayer(g, dt, input);
  for (const r of g.racers) moveRacer(g, r, dt);
  moveTraffic(g, dt);
  contacts(g, dt);
  heat(g, dt);
  record(g, dt);
  laps(g);
}

/** How the road treats a ride at x: on it, on the shoulder (slow), or into the wall. */
const offRoad = x => Math.abs(x) > ROAD;

/** A bend's push at x across the road: tighter (harder to hold) on the inside. */
const bendAt = (k, x) => k / Math.max(0.6, 1 - x * k);

/**
 * A bend's push out (m/s across) on a ride at x, and how far past its grip it is (0 while the grip holds). The
 * grip soaks up most of it: only a drift is felt and the steering keeps its say; past the grip the rest slides
 * the ride wide (and scrubs speed, in lateral()).
 */
function bendPush(e, c, k) {
  const raw = (e.v * e.v * Math.abs(bendAt(k, e.x)) * PHYSICS.centri) / c.grip;
  const hold = PHYSICS.steer * c.grip;
  const over = Math.max(0, raw - hold);
  return { push: Math.sign(k) * (Math.min(raw, hold) * PHYSICS.drift + over * PHYSICS.slide), over: over / hold };
}

/**
 * How much ground along the track a step at x gains: more on a bend's inside, less on its outside. The racing
 * line: cut the bends (and hold them) and you're quicker.
 */
export const lineGain = (k, x) => clamp(1 / (1 - x * k), 0.85, 1.2);

/** Accelerate toward a target speed, the class's way. */
function drive(e, c, dt, target, braking) {
  if (braking) e.v = Math.max(0, e.v - PHYSICS.brake * dt);
  else if (e.v < target) e.v = Math.min(target, e.v + c.accel * (1 - (e.v / c.top) ** 2) * dt + 0.2 * dt);
  else e.v = Math.max(target, e.v - PHYSICS.coast * dt);
  if (offRoad(e.x) && e.v > c.top * PHYSICS.offTop) e.v = Math.max(c.top * PHYSICS.offTop, e.v - PHYSICS.offDrag * dt);
}

/**
 * Across the road: the steering, against a bend's push, plus any shove (it dies away). The wall stops you
 * there. Notes how fast the ride moved across (`lat`, for rams). Returns how fast it met the wall (m/s across:
 * 0 when it isn't there).
 */
function lateral(e, c, steer, k, dt) {
  const grip = c.grip * (offRoad(e.x) ? 0.75 : 1);
  const sv = PHYSICS.steer * grip * (0.35 + 0.65 * Math.min(1, e.v / 20));
  e.vx = (e.vx ?? 0) * Math.exp(-PHYSICS.shoveDamp * dt);
  const before = e.x;
  const { push, over } = bendPush(e, c, k);
  if (over > 0) e.v = Math.max(0, e.v - Math.min(PHYSICS.scrub, PHYSICS.scrub * over) * dt);
  const across = steer * sv - push + e.vx;
  e.x += across * dt;
  let wall = 0;
  if (Math.abs(e.x) > WALL - c.w / 2) {
    e.x = Math.sign(e.x) * (WALL - c.w / 2);
    e.vx = 0;
    wall = Math.max(0.01, Math.abs(across));
  }
  e.lat = (e.x - before) / dt;
  return wall;
}

/** The player's ride for a step. */
function movePlayer(g, dt, input) {
  const p = g.p;
  const c = p.c;
  if (g.finished) {
    // Rolling down after the line, on autopilot.
    p.v = Math.max(0, p.v - 10 * dt);
    p.total += p.v * dt;
    return;
  }
  p.grace = Math.max(0, p.grace - dt);
  if (p.wreck > 0) return recover(g, dt);
  // Patched up as you go: after a few clean seconds the damage slowly comes back.
  if (g.t - (p.hurtT ?? -Infinity) > PHYSICS.mendAfter) p.hp = Math.min(100, p.hp + PHYSICS.mend * dt);
  const s = trackPos(g.track, p.total);
  const k = curveAt(g.track, s);
  const water = hazardsNear(g.track, g.track.hazards, s - 1, s + 1).some(h => h.kind === "flood" && p.x > h.x0 && p.x < h.x1);
  const top = c.top * (water ? 0.62 : 1);
  if (p.air > 0) {
    p.air -= dt;
    p.lat = 0;
    if (p.air <= 0) emit(g, "land");
    p.total += p.v * dt;
  } else {
    drive(p, c, dt, top, !!input.brake);
    p.steer = clamp(Number(input.steer) || 0, -1, 1);
    const wall = lateral(p, c, p.steer, k, dt);
    if (wall && p.v > 10) {
      if (!p.onWall && wall > PHYSICS.wallHard) {
        // Into the barrier too fast (a bend taken too quick): a crash.
        const hard = p.v;
        p.v *= 0.4;
        p.vx = -Math.sign(p.x) * 4;
        hurt(g, p, 6 + hard * 0.25, "wall");
        emit(g, "crash", { kind: "wall" });
      } else {
        p.v *= 1 - PHYSICS.wallDrag * dt;
        if (bumped(p, "wall", g.t)) {
          hurt(g, p, 2 + p.v * 0.05, "wall");
          emit(g, "scrape");
        }
      }
    }
    p.onWall = !!wall;
    p.total += p.v * dt * lineGain(k, p.x);
  }
  // Punch or kick (bikes, with fighting on).
  p.punch = Math.max(0, p.punch - dt);
  if (input.punch && c.bike && g.config.fighting && p.punch <= 0 && p.air <= 0) {
    p.punch = PHYSICS.punchCool;
    p.punchSide = Math.sign(input.punch);
    punch(g, p.punchSide);
  }
  if (p.air <= 0 && p.grace <= 0 && p.wreck <= 0) hitHazards(g, p, c, s);
  seeSection(g);
}

const seeSection = g => g.seen.add(sectionOf(g.track, trackPos(g.track, g.p.total)));

/**
 * Wrecked: hands off for PHYSICS.recover seconds, still rolling. Eased back to a clear line near the middle
 * of the road and built back up to speed, the ride patched up; nothing hits you until a moment after.
 */
function recover(g, dt) {
  const p = g.p;
  const c = p.c;
  p.wreck = Math.max(0, p.wreck - dt);
  const k = 1 - p.wreck / PHYSICS.recover;
  p.v = c.top * lerp(0.3, 0.62, smooth(k));
  p.x = lerp(p.wreckX, p.backX, smooth(Math.min(1, k * 2)));
  Object.assign(p, { vx: 0, lat: 0, steer: 0, air: 0 });
  p.hp = Math.max(p.hp, Math.round(70 * smooth(k)));
  p.total += p.v * dt;
  seeSection(g);
  if (p.wreck <= 0) {
    p.grace = PHYSICS.grace;
    emit(g, "respawn");
  }
}

/** Where to put the player back after a wreck: the middle of the road, or the nearest line clear of what blocks just past where they'll take over. */
function clearLine(g) {
  const p = g.p;
  const s = trackPos(g.track, p.total);
  const reach = p.c.top * 0.47 * PHYSICS.recover;
  const near = hazardsNear(g.track, [...g.track.hazards, ...g.fires], s + reach * 0.6, s + reach + 60).filter(blocks);
  const half = p.c.w / 2 + 0.4;
  return [0, -1.75, 1.75, -3.5, 3.5, -5.25, 5.25].find(x => !near.some(h => x + half > h.x0 && x - half < h.x1)) ?? 0;
}

/** One knock per thing per PHYSICS.bump: true when this one counts. */
function bumped(e, key, t) {
  e.bumps ??= {};
  if ((e.bumps[key] ?? -1) > t) return false;
  e.bumps[key] = t + PHYSICS.bump;
  return true;
}

/** Damage to the player (or a racer, or traffic); the player wrecks at 0 (and can't be hurt while getting going again). */
function hurt(g, e, amount, why) {
  if (e === g.p) {
    if (e.wreck > 0 || e.grace > 0) return;
    e.hp -= amount / e.c.tough;
    e.hurtT = g.t;
    emit(g, "hurt", { amount, why });
    if (e.hp <= 0) {
      e.hp = 0;
      e.wreck = PHYSICS.recover;
      e.wreckX = e.x;
      e.backX = clearLine(g);
      e.punch = 0;
      g.crashes++;
      emit(g, "wreck", { why });
    }
    return;
  }
  if (!Number.isFinite(e.hp)) return;
  e.hp -= amount / (e.c?.tough ?? 1);
  if (e.hp <= 0 && !e.out) wreckOut(g, e, why);
}

/** A racer, ganger, cop or car wrecked: out of the race, burning where it stopped. */
function wreckOut(g, e, why) {
  e.out = true;
  e.hp = 0;
  e.v = 0;
  e.atk = null;
  const s = trackPos(g.track, e.total);
  const w = (e.c?.w ?? e.w ?? 1.9) / 2 + 0.15;
  g.fires.push({ id: `f${g.fires.length}`, kind: "fire", s: s - 1.7, len: 3.4, x0: e.x - w, x1: e.x + w, of: e.id, bike: !!(e.c?.bike ?? TRAFFIC[e.kind]?.bike) });
  if (why === "player") {
    g.wrecks++;
    if (e.kind === "cop" || TRAFFIC[e.kind]?.civ) addHeat(g, e.kind === "cop" ? 1 : 0.5);
  }
  emit(g, "wrecked", { id: e.id, name: e.name ?? null, kind: e.kind ?? "racer", by: why });
}

/** Static hazards, and burning wrecks, under the player. */
function hitHazards(g, p, c, s) {
  const half = (c.len * HIT.len) / 2;
  const hw = (c.w * HIT.w) / 2;
  for (const h of hazardsNear(g.track, [...g.track.hazards, ...g.fires], s - half, s + half)) {
    if (p.x + hw <= h.x0 || p.x - hw >= h.x1) continue;
    if (h.kind === "pothole") {
      if (!bumped(p, h.id, g.t)) continue;
      p.v *= 0.86;
      hurt(g, p, c.bike ? 7 : 5, "pothole");
      emit(g, "pothole");
    } else if (h.kind === "ramp") {
      if (p.air > 0 || p.v < 12) continue;
      p.air = (PHYSICS.air * p.v) / 10;
      emit(g, "ramp");
    } else if (blocks(h)) {
      if (!bumped(p, h.id, g.t)) continue;
      const hard = p.v;
      p.v *= 0.2;
      // Knocked aside, toward the nearer edge of it.
      p.vx = (p.x < (h.x0 + h.x1) / 2 ? -1 : 1) * 9;
      hurt(g, p, 12 + hard * 0.55, h.kind);
      emit(g, "crash", { kind: h.kind });
      if (h.kind === "checkpoint") addHeat(g, 2);
    }
  }
}

/** A punch or kick to one side: the nearest rider or car there takes it (and a swing it was winding up is spoiled). */
function punch(g, side) {
  const p = g.p;
  const near = [...g.racers, ...g.traffic].filter(e => !e.out && Math.abs(e.total - p.total) < 2.4);
  const target = near
    .map(e => ({ e, dx: (e.x - p.x) * side }))
    .filter(({ dx }) => dx > 0.4 && dx < PHYSICS.punchReach)
    .sort((a, b) => a.dx - b.dx)[0]?.e;
  emit(g, "punch", { side, hit: !!target });
  if (!target) return;
  const bike = target.c?.bike ?? TRAFFIC[target.kind]?.bike;
  target.vx = (target.vx ?? 0) + side * (bike ? 5 : 2);
  target.v *= bike ? 0.93 : 0.98;
  if (target.atk?.phase === "wind") {
    target.atk = null;
    target.atkCool = 1.2;
  }
  hurt(g, target, bike ? 22 : 7, "player");
  emit(g, "landed", { id: target.id, side });
  if (target.kind && TRAFFIC[target.kind]?.civ) addHeat(g, 0.25);
}

/**
 * A swing at the player by a ganger or a rival on a bike (a punch, a chain), or a swerve by a rival's car or a
 * cruiser (a sideswipe). First a windup the player can see (the page draws it, and a punch spoils it), then it
 * lands only if they're still in reach: steer away or brake and it misses. Then a rest before the next.
 */
function attack(g, e, dt, { bike, damage, rest }) {
  const p = g.p;
  e.atkCool = Math.max(0, (e.atkCool ?? 0) - dt);
  const dz = e.total - p.total;
  const dx = p.x - e.x;
  const able = g.config.fighting && p.wreck <= 0 && p.grace <= 0 && p.air <= 0 && !g.finished && !e.out;
  if (e.atk) {
    e.atk.t -= dt;
    if (!able) {
      e.atk = null;
      return;
    }
    if (e.atk.phase === "wind" && e.atk.t <= 0) {
      const side = e.atk.side;
      e.atk = { phase: "swing", t: bike ? 0.22 : 0.4, side };
      e.atkCool = rest();
      if (!bike) {
        // A swerve into you: the contact does the damage.
        e.vx = (e.vx ?? 0) + side * 7;
        return;
      }
      if (Math.abs(dz) < 2.4 && Math.abs(dx) < PHYSICS.punchReach && Math.sign(dx) === side) {
        hurt(g, p, damage, e.kind ?? "rival");
        p.vx += side * 3.5;
        emit(g, "punched", { side: -side, by: e.name ?? null });
      } else emit(g, "dodged", { id: e.id });
    } else if (e.atk.phase === "swing" && e.atk.t <= 0) e.atk = null;
    return;
  }
  if (!able || e.atkCool > 0) return;
  if (Math.abs(dz) < 2.2 && Math.abs(dx) > 0.5 && Math.abs(dx) < (bike ? PHYSICS.punchReach : 3.8)) {
    e.atk = { phase: "wind", t: PHYSICS.windup * (bike ? 1 : 1.3), side: Math.sign(dx) };
    emit(g, "windup", { id: e.id, side: -Math.sign(dx) });
  }
}

/** The AI (and the autopilot): where to steer and how fast to go. Returns { steer, target, brake }. */
export function aiInput(g, e, c) {
  const { track } = g;
  const s = trackPos(track, e.total);
  // What's ahead: only up to the first thing that blocks (and what's beside it): the next barrier's gap can wait.
  const look = Math.max(40, e.v * 1.6);
  // (From a ride's length back: until it's past, it's still beside you.)
  const near = hazardsNear(track, [...track.hazards, ...g.fires], s - c.len, s + look).filter(h => h.kind !== "flood" || e.v > 30);
  const wall = near.filter(blocks).map(h => (h.s < s - track.len / 2 ? h.s + track.len : h.s)).sort((a, b) => a - b)[0];
  const ahead = wall === undefined ? near : near.filter(h => (h.s < s - track.len / 2 ? h.s + track.len : h.s) <= wall + 12);
  // Slow for the bends ahead, with room to brake: what the grip holds, and a little more (the road's width
  // soaks up a drift) unless something's in the way to drift into.
  const grip = wall === undefined ? AI_GRIP : 1;
  let target = c.top * (e.pace ?? 1);
  const kAt = a => (Math.abs(curveAt(track, s + a)) + Math.abs(curveAt(track, s + a + SEG)) + Math.abs(curveAt(track, s + a + 2 * SEG)) + Math.abs(curveAt(track, s + a + 3 * SEG))) / 4;
  for (let a = 0; a <= 180; a += SEG) {
    const k = kAt(a);
    if (k < 1e-5) continue;
    const hold = Math.sqrt((PHYSICS.steer * c.grip * c.grip * grip) / (k * PHYSICS.centri));
    target = Math.min(target, Math.sqrt(hold * hold + 2 * PHYSICS.brake * 0.6 * a));
  }
  // Pick a line: the inside of the next bend (the racing line), or the preferred lane; not into something.
  const movers = [g.p, ...g.racers, ...g.traffic].filter(o => o !== e && !o.out && o.total > e.total && o.total - e.total < look && (o.v ?? 0) < e.v - 1);
  const blocked = x => {
    const half = c.w / 2 + 0.5;
    if (ahead.some(h => h.kind !== "ramp" && x + half > h.x0 && x - half < h.x1)) return true;
    return movers.some(o => Math.abs(o.x - x) < half + (o.c?.w ?? o.w ?? 1.9) / 2);
  };
  const bend = curveAt(track, s + 30);
  let want = Math.abs(bend) > 1 / 400 ? Math.sign(bend) * 3.5 : (e.prefer ?? 0);
  if (blocked(e.lineX ?? want) || blocked(want)) {
    // A barrier's gap: aim for the middle of it (a bend may push you off the edge of a lane).
    const gaps = [];
    let from = -ROAD;
    for (const [a, b] of ahead.filter(blocks).map(h => [h.x0, h.x1]).sort((p, q) => p[0] - q[0])) {
      if (a - from > c.w + 0.6) gaps.push((from + a) / 2);
      from = Math.max(from, b);
    }
    if (ROAD - from > c.w + 0.6) gaps.push((from + ROAD) / 2);
    const options = [...gaps, ...(gaps.length ? [] : [...LANES, -3.5, 0, 3.5])].filter(x => !blocked(x));
    if (options.length) want = options.reduce((a, b) => (Math.abs(b - e.x) < Math.abs(a - e.x) ? b : a));
  }
  e.lineX = want;
  // Steer toward it, leaning into the bend (as the bend pushes out).
  const k = curveAt(track, s);
  const sv = PHYSICS.steer * c.grip * (0.35 + 0.65 * Math.min(1, e.v / 20));
  const lean = bendPush(e, c, k).push / Math.max(1, sv);
  const steer = clamp((want - e.x) * 0.5 + lean, -1, 1);
  // Not getting over to the line in time for what's ahead (or sliding to the edge on full lock): brake.
  const gap = Math.abs(want - e.x);
  const progress = (e.lat ?? 0) * Math.sign(want - e.x);
  const late = wall !== undefined && gap > 0.6 && e.v > 15 && gap / Math.max(0.1, progress) > ((wall - s) / Math.max(1, e.v)) * 0.85;
  const sliding = Math.abs(steer) >= 1 && gap > 0.8 && progress < 2.5 && e.v > 20 && Math.abs(e.x) > ROAD - 1.5;
  return { steer, target, brake: e.v > target + 3 || late || sliding };
}

/** The autopilot's input for the player (the GM's fly-through, and tests): the AI's driving. */
export function autopilot(g) {
  const p = g.p;
  p.pace ??= 1;
  p.prefer ??= 0;
  const { steer, brake } = aiInput(g, p, p.c);
  return { steer, brake };
}

/** An AI racer's step. */
function moveRacer(g, r, dt) {
  if (r.out) return;
  if (r.done !== null) {
    r.v = Math.max(0, r.v - 10 * dt);
    r.total += r.v * dt;
    return;
  }
  const c = r.c;
  const p = g.p;
  const { steer, target, brake } = aiInput(g, r, c);
  // A rubber band: they ease off when far ahead and push when far behind (never past their top)…
  const lead = r.total - p.total;
  let want = Math.min(c.top, target * (lead > 120 ? 0.95 : lead < -150 ? 1.03 : 1));
  // …and close by they hang about, easing off just ahead and pushing just behind: someone to fight.
  if (Math.abs(lead) < 45 && p.wreck <= 0 && !g.finished) want = Math.min(target, lerp(want, p.v + (lead > 0 ? 1.5 : 4), 0.5));
  drive(r, c, dt, want, brake);
  const s = trackPos(g.track, r.total);
  const k = curveAt(g.track, s);
  lateral(r, c, steer, k, dt);
  r.total += r.v * dt * lineGain(k, r.x);
  if (c.bike || r.aggro > 0.55) attack(g, r, dt, { bike: c.bike, damage: 5, rest: () => 3 + g.rand() * 3 });
  // Hazards hurt them too (they mostly steer round).
  for (const h of hazardsNear(g.track, [...g.track.hazards, ...g.fires.filter(f => f.of !== r.id)], s - c.len / 2, s + c.len / 2)) {
    if (r.x + c.w / 2 <= h.x0 || r.x - c.w / 2 >= h.x1 || !bumped(r, h.id, g.t)) continue;
    if (blocks(h)) {
      r.v *= 0.3;
      hurt(g, r, 20, "hazard");
    } else if (h.kind === "pothole") r.v *= 0.9;
  }
  if (r.total >= g.track.finish) {
    r.done = g.t;
    emit(g, "rival-finish", { id: r.id });
  }
}

/** Traffic, convoys, gangers and NCPD for a step. On a circuit they loop round with the player. */
function moveTraffic(g, dt) {
  const { track, p } = g;
  for (const t of g.traffic) {
    if (t.out) continue;
    if (t.kind === "cop") {
      chase(g, t, dt);
      continue;
    }
    // Keep to the lane (traffic leans into bends perfectly), after any shove.
    t.vx *= Math.exp(-PHYSICS.shoveDamp * dt);
    const before = t.x;
    t.x = clamp(t.x + clamp(t.lane - t.x, -3 * dt, 3 * dt) + t.vx * dt, -WALL + t.w / 2, WALL - t.w / 2);
    t.lat = (t.x - before) / dt;
    if (t.kind === "gang") gangInput(g, t, dt);
    else {
      // Stuck behind something slower in the lane: follow it.
      const front = g.traffic.find(o => o !== t && !o.out && o.kind !== "cop" && o.total > t.total && o.total - t.total < (o.len + t.len) / 2 + 10 && Math.abs(o.x - t.x) < (o.w + t.w) / 2);
      t.v = front ? Math.min(t.cruise, front.v) : t.v + clamp(t.cruise - t.v, -4 * dt, 3 * dt);
    }
    t.total += t.v * dt;
    if (track.closed) {
      // Keep each within half a lap of the player, so it's met again lap after lap.
      while (t.total - p.total > track.len / 2) t.total -= track.len;
      while (p.total - t.total > track.len / 2) t.total += track.len;
    }
  }
}

/** A ganger rides up beside the player, keeps pace, and swings (with fighting on). */
function gangInput(g, t, dt) {
  const p = g.p;
  const dz = t.total - p.total;
  if (Math.abs(dz) < 45 && g.config.fighting && p.wreck <= 0 && !g.finished) {
    t.lane = clamp(p.x + (t.x < p.x ? -1.9 : 1.9), -ROAD + 0.6, ROAD - 0.6);
    t.v = clamp(p.v - clamp(dz * 0.8, -8, 8), 18, 52);
  }
  attack(g, t, dt, { bike: true, damage: 6, rest: () => 1.8 + g.rand() * 1.4 });
}

/**
 * NCPD: run the player down (they're quicker than any ride), pull alongside, keep pace, and sideswipe now and
 * then; drop back when the Heat's gone.
 */
function chase(g, t, dt) {
  const p = g.p;
  const c = (t.c ??= { ...TRAFFIC.cop, top: Math.max(60, p.c.top * 1.22), accel: 24, grip: 1.4, tough: 1.2 });
  const want = g.heat >= 2 && !g.finished;
  const dz = p.total - t.total;
  const target = !want ? Math.max(0, p.v - 15) : dz > 8 ? c.top : Math.max(0, p.v + clamp(dz * 0.8, -6, 6));
  drive(t, c, dt, target, t.v > target + 6);
  const s = trackPos(g.track, t.total);
  const k = curveAt(g.track, s);
  // Beside the player, not on top of them: the swerve is the ram.
  const aim = clamp(t.x < p.x ? p.x - 2.9 : p.x + 2.9, -ROAD + 1, ROAD - 1);
  const sv = PHYSICS.steer * c.grip;
  const lean = bendPush(t, c, k).push / sv;
  lateral(t, c, clamp((aim - t.x) * 0.4 + lean, -1, 1), k, dt);
  t.total += t.v * dt * lineGain(k, t.x);
  if (want) attack(g, t, dt, { bike: false, damage: 0, rest: () => 2.2 + g.rand() * 1.8 });
  if (!want && dz > 260) t.out = t.gone = true;
}

/**
 * Bumping into racers and traffic. Side by side: pushed apart, then shoved (harder the faster you closed, the
 * heavier one shoving the lighter); with fighting on, a ram does damage the same way. Nose to tail: the one
 * behind is checked. Hitboxes are a little smaller than the rides look (HIT).
 */
function contacts(g) {
  const p = g.p;
  if (p.wreck > 0 || p.grace > 0 || p.air > 0 || g.finished) return;
  const c = p.c;
  const nearest = x => LANES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  for (const e of [...g.racers, ...g.traffic]) {
    if (e.out) continue;
    const ec = e.c ?? TRAFFIC[e.kind];
    const dz = e.total - p.total;
    const dx = e.x - p.x;
    const reachW = ((c.w + ec.w) / 2) * HIT.w;
    const reachL = ((c.len + ec.len) / 2) * HIT.len;
    if (Math.abs(dz) >= reachL || Math.abs(dx) >= reachW) continue;
    const civ = TRAFFIC[e.kind]?.civ;
    const [mp, me] = [c.mass, ec.mass ?? 3];
    const heavy = me / (mp + me);
    const rel = Math.abs(p.v - e.v);
    let hard = false;
    if (Math.abs(dx) / reachW > 0.5) {
      const dir = Math.sign(dx || 1);
      const overlap = reachW - Math.abs(dx);
      e.x += dir * overlap * (1 - heavy);
      p.x -= dir * overlap * heavy;
      if (!bumped(p, e.id, g.t)) continue;
      const closing = Math.max(0, ((p.lat ?? 0) - (e.lat ?? 0)) * dir);
      const shove = 2.5 + closing * 0.9;
      e.vx = (e.vx ?? 0) + dir * shove * 2 * (1 - heavy);
      p.vx = (p.vx ?? 0) - dir * shove * 2 * heavy;
      if (e.lane !== undefined && e.kind !== "gang") e.lane = nearest(e.x + dir * shove * 0.3);
      hard = closing > 4;
      if (g.config.fighting) {
        hurt(g, e, (3 + closing * 2.2) * Math.sqrt(mp / me), "player");
        hurt(g, p, (2 + closing * 1.2) * Math.sqrt(me / mp), e.kind === "cop" ? "cop" : "ram");
      }
      emit(g, "ram", { side: dir, civ: !!civ, hard, cop: e.kind === "cop" });
    } else if (dz > 0) {
      // Into the back of them.
      const overlap = reachL - dz;
      p.total -= overlap * heavy;
      e.total += overlap * (1 - heavy);
      if (!bumped(p, e.id, g.t)) continue;
      p.v = Math.max(0, Math.min(p.v, e.v) - 2);
      e.v += rel * 0.4 * (1 - heavy);
      hard = rel > 10;
      if (g.config.fighting) {
        hurt(g, e, (4 + rel * 0.5) * Math.sqrt(mp / me), "player");
        hurt(g, p, (3 + rel * 0.35) * Math.sqrt(me / mp), "rear");
      }
      emit(g, "bump", { hard });
    } else {
      // They ran into the player.
      if (!bumped(p, e.id, g.t)) continue;
      e.v = Math.max(0, Math.min(e.v, p.v) - 2);
      p.v += rel * 0.3 * heavy;
      if (g.config.fighting) hurt(g, p, (3 + rel * 0.3) * Math.sqrt(me / mp), "rear");
      emit(g, "bump", { hard: rel > 10 });
    }
    if (civ && (hard || rel > 8)) addHeat(g, 0.5);
  }
}

/** Heat: NCPD's attention, from ramming civilians and crashing checkpoints; cools off with time. */
function addHeat(g, by) {
  if (!g.config.heat || g.finished) return;
  const before = Math.floor(g.heat);
  g.heat = Math.min(5, g.heat + by);
  g.heatT = 0;
  if (Math.floor(g.heat) > before) emit(g, "heat", { heat: Math.floor(g.heat) });
}

/**
 * Heat cools by a star every 20 s of keeping clean, but not below what the race itself has drawn (raceHeat);
 * cruisers come at 2 stars (two at 4).
 */
function heat(g, dt) {
  if (!g.config.heat) return;
  raceHeat(g);
  g.heatT += dt;
  if (g.heat > g.heatFloor && g.heatT > 20) {
    g.heat = Math.max(g.heatFloor, g.heat - 1);
    g.heatT = 0;
    emit(g, "cool", { heat: Math.floor(g.heat) });
  }
  const want = g.finished ? 0 : g.heat >= 4 ? 2 : g.heat >= 2 ? 1 : 0;
  const cops = g.traffic.filter(t => t.kind === "cop" && !t.out);
  if (cops.length < want) {
    const p = g.p;
    const t = TRAFFIC.cop;
    g.traffic.push({ id: `c${g.traffic.length}`, kind: "cop", total: p.total - 45 - cops.length * 10, x: p.x > 0 ? -3.5 : 3.5, v: p.v, vx: 0, lat: 0, hp: t.hp, w: t.w, len: t.len, atk: null, atkCool: 3 });
    emit(g, "siren");
  }
}

/** A street race draws NCPD by itself: a star after each lap of a circuit, or at 30% and 65% of a sprint. */
function raceHeat(g) {
  if (g.finished || g.t <= 0) return;
  const { track, p } = g;
  const marks = track.closed ? Math.floor(Math.max(0, p.total) / track.len) : [0.3, 0.65].filter(f => p.total >= f * track.finish).length;
  while (g.heatMarks < marks) {
    g.heatMarks++;
    g.heatFloor = Math.min(5, g.heatFloor + 1);
    addHeat(g, 1);
  }
}

/** Where ghosts are kept, under the Agent's data folder (apps/redline/host.js writes them, anyone reads them). */
export const GHOST_DIR = "redline";
export const ghostFile = (trackId, actorId) => `${GHOST_DIR}/${String(trackId).replace(/[^\w-]/g, "_")}-${String(actorId).replace(/[^\w-]/g, "_")}.json`;

/** The ghost recording: where the player is, ten times a second. */
export const GHOST_HZ = 10;

function record(g) {
  while (g.recT <= g.t + 1e-9 && !g.finished) {
    g.rec.push([g.p.total, g.p.x]);
    g.recT += 1 / GHOST_HZ;
  }
}

/** Laps and the finish. */
function laps(g) {
  const { track, p } = g;
  if (g.finished) return;
  if (track.closed) {
    const lap = Math.floor(p.total / track.len);
    if (lap > g.lap && p.total > 0) {
      g.laps.push(g.t - g.lapStart);
      g.lapStart = g.t;
      g.lap = lap;
      if (lap < track.spec.laps) emit(g, "lap", { lap: lap + 1, time: g.laps.at(-1) });
    }
  }
  if (p.total >= track.finish) {
    g.finished = true;
    g.time = g.t;
    if (!track.closed) g.laps = [g.t];
    g.place = position(g);
    emit(g, "finish", { time: g.time, place: g.place });
  }
}

/** The player's place among the AI that are still in it, and the ghosts. */
export function position(g) {
  const p = g.p;
  let ahead = 0;
  for (const r of g.racers) {
    if (r.out) continue;
    if (r.done !== null ? r.done <= g.t : r.total > p.total) ahead++;
  }
  for (const gh of g.ghosts) if (ghostAt(gh, g.t).total > p.total) ahead++;
  return ahead + 1;
}

/** The field's size (AI still in it, ghosts and the player). */
export const fieldSize = g => g.racers.filter(r => !r.out).length + g.ghosts.length + 1;

/** The best lap so far (circuits), or null. */
export const bestLap = g => (g.track.closed && g.laps.length ? Math.min(...g.laps) : null);

/** The lap the player is on (1-based, capped at the last). */
export const lapOf = g => Math.min(g.track.spec.laps, Math.max(1, Math.floor(Math.max(0, g.p.total) / g.track.len) + 1));

/* ---------------- Ghosts ---------------- */

/**
 * A ghost as kept (a host file): { v: 1, hz, cls, slot, time, d: [distance deltas, decimetres], x: [decimetres
 * across, as deltas] }: a few KB for a few minutes.
 */
export function encodeGhost(g) {
  const d = [];
  const x = [];
  let pd = 0;
  let px = 0;
  for (const [total, across] of g.rec) {
    const dd = Math.round(total * 10);
    const xx = Math.round(across * 10);
    d.push(dd - pd);
    x.push(xx - px);
    pd = dd;
    px = xx;
  }
  return { v: 1, hz: GHOST_HZ, cls: g.cls, slot: g.p.slot, time: Math.round((g.time ?? g.t) * 1000), d, x };
}

/** A kept ghost back to samples: { cls, slot, time (s), samples: [[total, x]] }, or null if it's broken. */
export function decodeGhost(data, label = "") {
  if (!data || data.v !== 1 || !Array.isArray(data.d) || !Array.isArray(data.x) || data.d.length !== data.x.length || !data.d.length) return null;
  let d = 0;
  let x = 0;
  const samples = data.d.map((dd, i) => {
    d += Number(dd) || 0;
    x += Number(data.x[i]) || 0;
    return [d / 10, x / 10];
  });
  return { label, cls: Object.hasOwn(CLASSES, data.cls) ? data.cls : "sport", slot: data.slot ?? 0, time: (Number(data.time) || 0) / 1000, hz: data.hz || GHOST_HZ, samples };
}

/** A ghost's place at race time t: { total, x, done }. */
export function ghostAt(gh, t) {
  const i = Math.max(0, t) * gh.hz;
  const n = gh.samples.length;
  if (i >= n - 1) return { total: gh.samples[n - 1][0], x: gh.samples[n - 1][1], done: true };
  const a = gh.samples[Math.floor(i)];
  const b = gh.samples[Math.floor(i) + 1];
  const f = i - Math.floor(i);
  return { total: lerp(a[0], b[0], f), x: lerp(a[1], b[1], f), done: false };
}

/** When a ghost reached a race distance (seconds), or null if it never did. */
export function ghostTimeAt(gh, total) {
  const s = gh.samples;
  if (!s.length || total > s[s.length - 1][0]) return null;
  let lo = 0;
  let hi = s.length - 1;
  if (total <= s[0][0]) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] < total) lo = mid;
    else hi = mid;
  }
  const f = (total - s[lo][0]) / (s[hi][0] - s[lo][0] || 1);
  return (lo + f) / gh.hz;
}

/** The split against a ghost at the player's distance: seconds behind (+) or ahead (−), or null. */
export function deltaTo(g, gh) {
  if (!gh || g.t <= 0 || g.p.total <= 0) return null;
  const at = ghostTimeAt(gh, g.p.total);
  return at === null ? null : g.t - at;
}

/* ---------------- The board ---------------- */

/**
 * The board is the world setting "redlineBoard": { [trackId]: [{ id, actorId, who, tag, cls, total (ms),
 * lap (ms, best lap; circuits), slot (grid slot, or null), ts, ghost (ts of the ghost file) }] }:
 * each character's best total time per track, and their best lap from any run.
 */
export const BOARD_SIZE = 10;

/** Faster first, then earlier. */
export const better = (a, b) => a.total - b.total || a.ts - b.ts;

/** Add a run: a character keeps their best time (and their best lap from any run). Returns the new list. */
export function addRun(runs, entry) {
  const list = runs ?? [];
  const old = list.find(r => r.actorId === entry.actorId);
  if (!old) return [...list, entry];
  const lap = [old.lap, entry.lap].filter(Number.isFinite);
  const bestLapMs = lap.length ? Math.min(...lap) : null;
  const next = entry.total < old.total ? { ...entry, lap: bestLapMs } : { ...old, lap: bestLapMs };
  return list.map(r => (r === old ? next : r));
}

/** The board as shown: the top runs, with ranks, and which holds the best lap. */
export function topRuns(runs, n = BOARD_SIZE) {
  const list = [...(runs ?? [])].sort(better).slice(0, n);
  const laps = list.map(r => r.lap).filter(Number.isFinite);
  const fastest = laps.length ? Math.min(...laps) : null;
  return list.map((r, i) => ({ ...r, rank: i + 1, fastestLap: fastest !== null && r.lap === fastest }));
}

/** Where a time would land on the board: its rank, or 0 when it isn't the character's best. */
export function runRank(runs, actorId, total) {
  const mine = (runs ?? []).find(r => r.actorId === actorId);
  if (mine && mine.total <= total) return 0;
  return (runs ?? []).filter(r => r.actorId !== actorId && r.total <= total).length + 1;
}

/**
 * Whether a run's numbers are believable for a track: no faster than the fastest ride flat out (with a
 * little slack), laps that add up, and a ghost as long as the run.
 */
export function plausible(track, { total, laps = [], samples = 0 }) {
  const t = total / 1000;
  const flat = track.finish / (FASTEST * 1.08);
  if (!(t >= flat) || t > 3600) return false;
  if (track.closed) {
    if (laps.length !== track.spec.laps) return false;
    if (laps.some(l => !(l / 1000 >= (track.len / (FASTEST * 1.08)) * 0.95))) return false;
    // The grid starts behind the line, so the laps sum to the total.
    if (Math.abs(laps.reduce((a, b) => a + b, 0) - total) > 50) return false;
  }
  return !samples || Math.abs(samples - t * GHOST_HZ) <= GHOST_HZ * 2;
}

/* ---------------- Time and text ---------------- */

/** A time as m:ss.cc (seconds in; hundredths cut, not rounded, so a time reads the same everywhere). */
export function clock(seconds) {
  if (!Number.isFinite(seconds)) return "-:--.--";
  const cs = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const rest = cs - m * 6000;
  return `${m}:${String(Math.floor(rest / 100)).padStart(2, "0")}.${String(rest % 100).padStart(2, "0")}`;
}

/** A split as +1.23 / −0.45. */
export const split = d => (d === null || !Number.isFinite(d) ? "" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`);

/** An ordinal: 1st, 2nd, 3rd… */
export const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** Speed as shown (km/h). */
export const kmh = v => Math.round(v * 3.6);

/** Fog of war: a set of sections as a number (a bit per section), and back. */
export const seenMask = set => [...set].reduce((m, i) => m | (1 << i), 0);
export const seenHas = (mask, i) => !!((Number(mask) || 0) & (1 << i));

/** How a race ended, in a line. */
export function finishLine(g) {
  if (!g.finished) return "Pulled over.";
  const place = g.place ?? position(g);
  if (place === 1) return pick(Math.random, ["Checkered flag. Nobody touched you.", "First across. Night City noticed.", "P1. Smoke and neon."]);
  return `${ordinal(place)} across the line.`;
}

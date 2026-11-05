/*
 * NCART Runner: an endless runner on the phone. The runner sprints along an elevated NCART line at
 * night, three lanes wide, dodging roadblocks, signs, wrecks, trains, drones and gang gunfire, and
 * grabbing data shards. Pure game logic here, in fixed steps (the phone draws it in pseudo-3D,
 * apps/ncart/page.js). Every run is random.
 *
 * The leaderboard is the world setting "ncartBoard", written by the host:
 *   { scores: [{ id, name, who?, actorId?, shards, dist (shown metres), ts, fake? }] }
 * ranked by shards (distance breaks ties), each character's best only. The GM's options are the world
 * setting "ncart" (configOf): which obstacle families and power-ups appear.
 *
 * Units: z is metres along the track (the runner's own z is `dist`), lanes are 0 (left) to 2 (right),
 * heights are metres above the track. The game's metres are generous (a runner at 22 m/s): what players
 * see, and what the board keeps, is SHOWN of them (shownDist), which reads like a fast runner.
 */

/* ---------------- Tuning ---------------- */

/** Physics steps per second: runs play the same at any frame rate. */
export const STEP = 1 / 120;

export const PHYSICS = {
  gravity: 30, // m/s²
  jump: 9.5, // vertical speed of a jump (peak ≈ 1.5 m)
  boostJump: 14.5, // with the Jump Booster (peak ≈ 3.5 m: onto train roofs)
  slam: -22, // Slide pressed in mid-air
  slideTime: 0.6, // seconds
  laneTime: 0.14, // seconds for one lane change
  height: 1.8, // standing
  slideHeight: 0.8,
  halfDepth: 0.4, // the runner's half-length along the track
  reach: 0.62, // how close (in lanes) the runner's centre and an obstacle's are for them to touch
  stepUp: 0.35, // a ledge this low is stepped onto, not run into
  roof: 3.2, // a train's roof
  trainSpeed: 12, // an oncoming train's own speed (m/s), on top of the runner's
  trainWake: 90, // an oncoming train starts moving (headlights on, horn) when the runner is this far from it
  slideCool: 0.25, // seconds after a slide before the next
  tunnel: 4.4, // a tunnel's ceiling
  ahead: 170, // the track is laid this far ahead of the runner
  behind: 12 // and kept this far behind (for drawing)
};

/** The speed curve (m/s): start, +step every `every` metres, up to cap. */
export const SPEED = { start: 22, step: 0.5, every: 250, cap: 30 };

/** What players see of the game's metres (distance, speed, the board). */
export const SHOWN = 0.35;
export const shownDist = dist => Math.floor(Math.max(0, dist) * SHOWN);
/** Speed as shown, in km/h. */
export const shownSpeed = ms => Math.round(ms * 3.6 * SHOWN);

/** Seconds a run takes to get up to speed (from RAMP_FROM of it), as the runner breaks into a sprint. */
export const RAMP = 2.6;
const RAMP_FROM = 0.15;

/** The runner's speed at a distance (before power-ups). `curve`: SPEED (tests use steady ones). */
export const speedAt = (dist, curve = SPEED) => Math.min(curve.cap, curve.start + Math.floor(Math.max(0, dist) / curve.every) * curve.step);

/** The speed step at a distance: 0 at the start, one more at each "SPEED UP" (until the cap). */
export const speedLevel = (dist, curve = SPEED) => (curve.step ? Math.min(Math.ceil((curve.cap - curve.start) / curve.step), Math.floor(Math.max(0, dist) / curve.every)) : 0);

/** Obstacle families: the GM can switch each off. */
export const FAMILIES = {
  roadblock: "Police roadblocks",
  overhead: "Overhead signs and cables",
  wreck: "AV wreckage",
  parked: "Parked trains",
  oncoming: "Oncoming trains",
  drone: "Drones",
  gunfire: "Maelstrom and Booster gunfire",
  tunnel: "Tunnels"
};

/**
 * Power-ups (arcade: the same for everyone, nothing to do with the character's own chrome). `time`:
 * seconds it lasts (0: until used), `weight`: how often it turns up, `from`: not before this many metres,
 * `tag`: its two letters on the track.
 */
export const POWERS = {
  sandevistan: { name: "Sandevistan", tag: "SV", time: 6, weight: 1, from: 800, blurb: "Bullet time" },
  kerenzikov: { name: "Kerenzikov", tag: "KZ", time: 10, weight: 1, blurb: "Auto-dodge one crash" },
  armor: { name: "Subdermal Armor", tag: "AR", time: 0, weight: 1, blurb: "Shrug off one crash" },
  booster: { name: "Jump Booster", tag: "JB", time: 10, weight: 1, blurb: "Huge jumps" },
  skate: { name: "Skate Foot", tag: "SF", time: 8, weight: 1, blurb: "Sprint through roadblocks" },
  magnet: { name: "Neural Link", tag: "NL", time: 10, weight: 1, blurb: "Pull in shards" },
  optics: { name: "TeleOptics", tag: "TO", time: 12, weight: 1, blurb: "See trouble early" },
  spike: { name: "Data Spike", tag: "DS", time: 10, weight: 0.3, blurb: "Double shards" }
};

const SANDY_SCALE = 0.7; // the world's speed in bullet time
const SKATE_SCALE = 1.35;
const GRACE = 0.6; // seconds of not crashing after a shield or a dodge
const POWER_EVERY = [220, 380]; // metres between power-ups, at random in this range
const POWER_FROM = 120;

/** The GM's defaults: everything on. */
export const NCART_DEFAULTS = {
  families: Object.fromEntries(Object.keys(FAMILIES).map(k => [k, true])),
  powers: Object.fromEntries(Object.keys(POWERS).map(k => [k, true]))
};

/** The GM's options (the world setting "ncart"), with defaults filled in and unknown keys dropped. */
export function configOf(saved = {}) {
  const pick = (defaults, given) => Object.fromEntries(Object.keys(defaults).map(k => [k, typeof given?.[k] === "boolean" ? given[k] : defaults[k]]));
  return {
    families: pick(NCART_DEFAULTS.families, saved?.families),
    powers: pick(NCART_DEFAULTS.powers, saved?.powers)
  };
}

/* ---------------- Obstacles ---------------- */

/**
 * What each obstacle is, as a box: from `bottom` to `top` metres up, `len` metres long (a chunk can
 * give its own). Nothing stands on a train's roof (a test checks it). `platform`: it can be stood on. `low`:
 * Skate Foot smashes through it. `slope`: a ramp, rising from 0 to `top` along its length.
 */
export const KINDS = {
  roadblock: { family: "roadblock", bottom: 0, top: 1.0, len: 0.8, platform: true, low: true },
  sign: { family: "overhead", bottom: 1.1, top: 2.8, len: 0.5, platform: true },
  cable: { family: "overhead", bottom: 1.15, top: 2.3, len: 0.4 }, // two runs: the low one, and one above it
  wreck: { family: "wreck", bottom: 0, top: 2.6, len: 4, platform: true },
  ramp: { family: "wreck", bottom: 0, top: PHYSICS.roof, len: 8, platform: true, slope: true },
  parked: { family: "parked", bottom: 0, top: PHYSICS.roof, len: 30, platform: true },
  oncoming: { family: "oncoming", bottom: 0, top: PHYSICS.roof, len: 24, platform: true },
  droneHigh: { family: "drone", bottom: 1.1, top: 1.9, len: 0.8 },
  droneLow: { family: "drone", bottom: 0.15, top: 0.95, len: 0.8 },
  gunLow: { family: "gunfire", bottom: 0, top: 0.95, len: 0.6, wide: true },
  gunHigh: { family: "gunfire", bottom: 1.1, top: 1.9, len: 0.6, wide: true }
};

/**
 * The hand-made chunks, chained at random. Each leaves a way through from any lane (tests check it),
 * and `from` keeps the harder ones back until the run has gone that far (metres).
 *   items:  [{ kind, lane, z, len?, to? }]: `to` (drones) drifts between `lane` and `to`; gunfire
 *           ("wide") fills every lane
 *   tunnel: [z0, z1]: the line runs through a tunnel there (a ceiling at PHYSICS.tunnel, and dark)
 *   shards: [{ lane, z, n, gap?, y?, arc? }]: n shards from z, `gap` metres apart (2.5), `y` up (0.9);
 *           `arc` lifts them in a jump's curve that high at the middle
 *   power:  [lane, z]: where a power-up may sit
 */
export const CHUNKS = [
  { id: "open", len: 28, items: [], shards: [{ lane: 1, z: 2, n: 10 }], power: [1, 27] },
  { id: "zigzag", len: 32, items: [], shards: [{ lane: 0, z: 2, n: 4 }, { lane: 1, z: 12, n: 4 }, { lane: 2, z: 22, n: 4 }], power: [2, 31] },
  {
    id: "roadblock", len: 18,
    items: [{ kind: "roadblock", lane: 1, z: 8 }],
    shards: [{ lane: 1, z: 3, n: 6, gap: 2.2, arc: 1.4 }, { lane: 0, z: 4, n: 4 }], power: [2, 8]
  },
  {
    id: "roadblock-two", len: 20,
    items: [{ kind: "roadblock", lane: 0, z: 8 }, { kind: "roadblock", lane: 1, z: 8 }],
    shards: [{ lane: 2, z: 2, n: 7 }], power: [0, 17]
  },
  {
    id: "roadblock-wall", len: 20, from: 300,
    items: [0, 1, 2].map(lane => ({ kind: "roadblock", lane, z: 9 })),
    shards: [{ lane: 1, z: 4, n: 6, gap: 2.2, arc: 1.5 }], power: [1, 18]
  },
  {
    id: "sign", len: 18,
    items: [{ kind: "sign", lane: 0, z: 8 }, { kind: "sign", lane: 1, z: 8 }],
    shards: [{ lane: 1, z: 7, n: 3, y: 0.4, gap: 1.6 }, { lane: 2, z: 2, n: 6 }]
  },
  {
    id: "cables", len: 20, from: 400,
    items: [0, 1, 2].map(lane => ({ kind: "cable", lane, z: 9 })),
    shards: [{ lane: 0, z: 7, n: 4, y: 0.4, gap: 1.6 }, { lane: 2, z: 7, n: 4, y: 0.4, gap: 1.6 }]
  },
  {
    id: "sign-block", len: 30, from: 600,
    items: [{ kind: "sign", lane: 0, z: 6 }, { kind: "sign", lane: 1, z: 6 }, { kind: "roadblock", lane: 1, z: 20 }, { kind: "roadblock", lane: 2, z: 20 }],
    shards: [{ lane: 2, z: 2, n: 3 }, { lane: 0, z: 17, n: 4 }]
  },
  {
    id: "wreck-pair", len: 18,
    items: [{ kind: "wreck", lane: 0, z: 6 }, { kind: "wreck", lane: 2, z: 6 }],
    shards: [{ lane: 1, z: 2, n: 7 }], power: [1, 17]
  },
  {
    id: "wreck-weave", len: 36, from: 500,
    items: [{ kind: "wreck", lane: 0, z: 4 }, { kind: "wreck", lane: 1, z: 4 }, { kind: "wreck", lane: 1, z: 22 }, { kind: "wreck", lane: 2, z: 22 }],
    shards: [{ lane: 2, z: 0, n: 4 }, { lane: 1, z: 13, n: 3 }, { lane: 0, z: 18, n: 6 }]
  },
  {
    id: "parked", len: 34,
    items: [{ kind: "parked", lane: 0, z: 4, len: 28 }],
    shards: [{ lane: 1, z: 4, n: 11 }], power: [2, 24]
  },
  {
    id: "ramp-roof", len: 50, from: 150,
    items: [{ kind: "ramp", lane: 1, z: 4 }, { kind: "parked", lane: 1, z: 12, len: 34 }, { kind: "parked", lane: 2, z: 8, len: 30 }],
    shards: [{ lane: 1, z: 14, n: 12, y: PHYSICS.roof + 0.9 }, { lane: 0, z: 6, n: 5 }], power: [1, 44]
  },
  {
    id: "two-trains", len: 52, from: 400,
    items: [{ kind: "ramp", lane: 0, z: 2 }, { kind: "parked", lane: 0, z: 10, len: 40 }, { kind: "parked", lane: 2, z: 8, len: 42 }, { kind: "roadblock", lane: 1, z: 24 }],
    shards: [{ lane: 0, z: 12, n: 12, y: PHYSICS.roof + 0.9 }, { lane: 1, z: 19, n: 6, gap: 2.2, arc: 1.5 }]
  },
  {
    id: "oncoming", len: 104, from: 250,
    items: [{ kind: "oncoming", lane: 0, z: 80 }, { kind: "roadblock", lane: 2, z: 40 }],
    shards: [{ lane: 1, z: 10, n: 16, gap: 3 }]
  },
  {
    id: "oncoming-two", len: 104, from: 900,
    items: [{ kind: "oncoming", lane: 0, z: 80 }, { kind: "oncoming", lane: 2, z: 80 }, { kind: "roadblock", lane: 1, z: 50 }],
    shards: [{ lane: 1, z: 30, n: 8, gap: 2.5 }, { lane: 1, z: 45, n: 6, gap: 2.2, arc: 1.5 }]
  },
  {
    id: "drones", len: 18, from: 150,
    items: [{ kind: "droneHigh", lane: 1, z: 8 }, { kind: "droneLow", lane: 0, z: 8 }, { kind: "roadblock", lane: 2, z: 8 }],
    shards: [{ lane: 0, z: 3, n: 6, gap: 2.2, arc: 1.5 }], power: [1, 17]
  },
  {
    id: "drones-drift", len: 32, from: 1000,
    items: [{ kind: "droneLow", lane: 0, to: 1, z: 8 }, { kind: "droneHigh", lane: 2, to: 1, z: 24 }],
    shards: [{ lane: 2, z: 2, n: 6 }, { lane: 0, z: 18, n: 6 }]
  },
  {
    id: "gunfire", len: 34, from: 1500,
    items: [{ kind: "gunLow", lane: 1, z: 8 }, { kind: "gunHigh", lane: 1, z: 26 }],
    shards: [{ lane: 1, z: 3, n: 6, gap: 2.2, arc: 1.5 }, { lane: 1, z: 25, n: 3, y: 0.4, gap: 1.6 }], power: [0, 33]
  },
  {
    id: "mixed", len: 40, from: 800,
    items: [{ kind: "roadblock", lane: 0, z: 4 }, { kind: "sign", lane: 1, z: 4 }, { kind: "wreck", lane: 2, z: 2 }, { kind: "parked", lane: 1, z: 16, len: 22 }],
    shards: [{ lane: 1, z: 0, n: 2 }, { lane: 0, z: 16, n: 8 }]
  },
  {
    id: "rooftops", group: "rooftops", len: 72, from: 400,
    items: [{ kind: "ramp", lane: 1, z: 2 }, { kind: "parked", lane: 1, z: 10, len: 26 }, { kind: "parked", lane: 1, z: 42, len: 28 }],
    shards: [
      { lane: 1, z: 12, n: 9, y: PHYSICS.roof + 0.9 }, { lane: 1, z: 34, n: 5, gap: 2, y: PHYSICS.roof + 0.9, arc: 1.4 },
      { lane: 1, z: 46, n: 9, y: PHYSICS.roof + 0.9 }, { lane: 0, z: 20, n: 5 }
    ],
    power: [1, 66]
  },
  // Variations on "rooftops" (one group: picked as often as one chunk). Mirroring puts "side" on either side.
  {
    id: "rooftops-single", group: "rooftops", len: 44, from: 400,
    items: [{ kind: "ramp", lane: 1, z: 2 }, { kind: "parked", lane: 1, z: 10, len: 26 }],
    shards: [{ lane: 1, z: 12, n: 9, y: PHYSICS.roof + 0.9 }, { lane: 0, z: 20, n: 5 }],
    power: [1, 40]
  },
  {
    id: "rooftops-side", group: "rooftops", len: 64, from: 400,
    items: [{ kind: "ramp", lane: 1, z: 2 }, { kind: "parked", lane: 1, z: 10, len: 26 }, { kind: "parked", lane: 2, z: 30, len: 30 }],
    shards: [{ lane: 1, z: 12, n: 8, y: PHYSICS.roof + 0.9 }, { lane: 2, z: 34, n: 9, y: PHYSICS.roof + 0.9 }, { lane: 0, z: 20, n: 5 }],
    power: [2, 58]
  },
  {
    id: "rooftops-both", group: "rooftops", len: 64, from: 400,
    items: [
      { kind: "ramp", lane: 1, z: 2 }, { kind: "parked", lane: 1, z: 10, len: 26 },
      { kind: "parked", lane: 0, z: 30, len: 30 }, { kind: "parked", lane: 2, z: 30, len: 30 }
    ],
    shards: [{ lane: 1, z: 12, n: 8, y: PHYSICS.roof + 0.9 }, { lane: 0, z: 34, n: 9, y: PHYSICS.roof + 0.9 }, { lane: 1, z: 40, n: 6 }],
    power: [2, 58]
  },
  {
    id: "roof-hop", len: 92, from: 700,
    items: [
      { kind: "ramp", lane: 0, z: 2 }, { kind: "parked", lane: 0, z: 10, len: 30 }, { kind: "parked", lane: 1, z: 34, len: 30 },
      { kind: "parked", lane: 2, z: 58, len: 30 }
    ],
    shards: [{ lane: 0, z: 14, n: 7, y: PHYSICS.roof + 0.9 }, { lane: 1, z: 40, n: 4, y: PHYSICS.roof + 0.9 }, { lane: 2, z: 66, n: 8, y: PHYSICS.roof + 0.9 }]
  },
  {
    id: "long-roof", len: 60, from: 900,
    items: [{ kind: "ramp", lane: 2, z: 2 }, { kind: "parked", lane: 2, z: 10, len: 46 }, { kind: "wreck", lane: 1, z: 30 }],
    shards: [{ lane: 2, z: 12, n: 6, y: PHYSICS.roof + 0.9 }, { lane: 2, z: 24, n: 6, gap: 2.2, y: PHYSICS.roof + 0.9, arc: 1.4 }, { lane: 0, z: 10, n: 8 }]
  },
  {
    id: "tunnel", len: 90, from: 600, tunnel: [4, 86],
    items: [
      { kind: "roadblock", lane: 1, z: 20 }, { kind: "droneHigh", lane: 0, z: 34 }, { kind: "roadblock", lane: 2, z: 34 },
      { kind: "wreck", lane: 1, z: 50 }, { kind: "droneLow", lane: 0, z: 66 }, { kind: "sign", lane: 2, z: 66 }
    ],
    shards: [{ lane: 0, z: 10, n: 6 }, { lane: 2, z: 42, n: 6 }, { lane: 1, z: 62, n: 8 }]
  },
  {
    id: "tunnel-train", len: 116, from: 1200, tunnel: [4, 112],
    items: [{ kind: "oncoming", lane: 1, z: 90 }, { kind: "roadblock", lane: 0, z: 40 }, { kind: "roadblock", lane: 2, z: 60 }],
    shards: [{ lane: 0, z: 10, n: 8 }, { lane: 2, z: 30, n: 8 }]
  }
];

/** A chunk's obstacle families (a tunnel counts as one). */
export const chunkFamilies = chunk => [...new Set([...chunk.items.map(i => KINDS[i.kind].family), ...(chunk.tunnel ? ["tunnel"] : [])])];

/** The group a chunk is a variation of (its own id when it has none). */
export const groupOf = chunk => chunk.group ?? chunk.id;

/** The chunks that may come next: far enough in, and none of their families switched off. */
export const chunksFor = (dist, families = NCART_DEFAULTS.families) => CHUNKS.filter(c => (c.from ?? 0) <= dist && chunkFamilies(c).every(f => families[f] !== false));

/** Metres of open track between chunks, at a speed (more when faster, to land and get to a lane). */
export const chunkGap = speed => Math.max(8, speed * 0.4);

/* ---------------- A run ---------------- */

/**
 * A new run. `config`: configOf(...). `rand`: () => [0, 1). `chunks`: lay only these, in order (tests;
 * then no power-ups either).
 */
export function newGame(config = configOf(), rand = Math.random, { chunks = null, lane = 1 } = {}) {
  return {
    config, curve: SPEED, rand, fixed: chunks ? [...chunks] : null,
    t: 0, wt: 0, dist: 0, shards: 0, level: 0, ramp: RAMP,
    lane, x: lane, queued: null, y: 0, vy: 0, ground: 0, slide: 0, slideCool: 0, air: false,
    obstacles: [], pickups: [], tunnels: [], laid: 18, nextPower: POWER_FROM,
    powers: {}, grace: 0, over: false, events: [], started: false, paused: false, acc: 0, pending: {}
  };
}

/** How far into the starting sprint a run is: RAMP_FROM at the start, 1 once up to speed (eased). */
export function rampOf(g) {
  const k = g.ramp ? Math.min(1, g.t / g.ramp) : 1;
  return RAMP_FROM + (1 - RAMP_FROM) * (1 - (1 - k) ** 2);
}

/** The runner's speed now (m/s): the curve, the starting sprint, Skate Foot. Bullet time slows the world, not this. */
export const runSpeed = g => speedAt(g.dist, g.curve) * rampOf(g) * (g.powers.skate ? SKATE_SCALE : 1);

/** How fast the world goes by (1 normally, slower in bullet time). */
export const worldScale = g => (g.powers.sandevistan ? SANDY_SCALE : 1);

/** Whether a power-up is running. */
export const hasPower = (g, id) => !!g.powers[id];

/**
 * Advance a run by a frame's worth of time (at most a quarter second, after a stall), in fixed steps;
 * time left over carries to the next frame. `input`: what the player pressed since the last frame
 * (see step); it waits for the next step if this frame is too short for one.
 */
export function advance(g, dt, input = {}) {
  g.acc = (g.acc ?? 0) + Math.min(Math.max(dt, 0), 0.25);
  const p = (g.pending ??= {});
  for (const k of ["left", "right"]) if (input[k]) p[k] = (p[k] ?? 0) + Number(input[k]);
  for (const k of ["jump", "slide"]) if (input[k]) p[k] = true;
  while (g.acc >= STEP && !g.over && !g.paused) {
    g.acc -= STEP;
    step(g, STEP, g.pending);
    g.pending = {};
  }
  return g;
}

/** Note something the phone should hear about (sounds, flashes): drained by the page each frame. */
const emit = (g, type, data = {}) => g.events.push({ type, ...data });

/** Whether an obstacle's box covers a lane (drifting drones: where it is now). */
function inLane(o, x) {
  return o.wide || Math.abs(o.x - x) < PHYSICS.reach;
}

/** An obstacle's top at a point along the track (ramps rise). */
const topAt = (o, z) => (o.slope ? o.top * Math.min(1, Math.max(0, (z - o.z) / o.len)) : o.top);

/** Whether the runner (at lane position `x`, `y` up, `h` tall, around z) touches an obstacle. */
function touches(g, o, x = g.x, y = g.y) {
  if (o.broken || !inLane(o, x)) return false;
  if (o.z > g.dist + PHYSICS.halfDepth || o.z + o.len < g.dist - PHYSICS.halfDepth) return false;
  const h = g.slide > 0 ? PHYSICS.slideHeight : PHYSICS.height;
  const top = o.slope ? topAt(o, g.dist + PHYSICS.halfDepth) : o.top;
  if (o.platform && y >= top - PHYSICS.stepUp) return false; // on it, or stepping up onto it
  return y + h > o.bottom && y < top;
}

/** The track's height under the runner at lane position x: the highest platform they're on. */
function groundAt(g, x = g.x) {
  let ground = 0;
  for (const o of g.obstacles) {
    if (!o.platform || o.broken || !inLane(o, x)) continue;
    if (o.z > g.dist + PHYSICS.halfDepth || o.z + o.len < g.dist - PHYSICS.halfDepth) continue;
    const top = o.slope ? topAt(o, g.dist + PHYSICS.halfDepth) : o.top;
    if (g.y >= top - PHYSICS.stepUp - 0.01) ground = Math.max(ground, top);
  }
  return ground;
}

/** Whether moving into lane `to` now would run into the side of something. */
const blockedSide = (g, to) => to < 0 || to > 2 || g.obstacles.some(o => touches(g, o, to));

/** Start a lane change (or queue one, while changing). */
function changeLane(g, by) {
  if (g.lane !== g.x) {
    g.queued = by;
    return;
  }
  const to = g.lane + by;
  if (blockedSide(g, to)) return emit(g, "bump", { side: by });
  g.lane = to;
  emit(g, "lane", { lane: to });
}

/**
 * Advance a run by `dt` seconds of real time, with what the player pressed (`left`/`right`: how many
 * lane changes, up to two; `jump`, `slide`: pressed). Mutates and returns it.
 * The world moves at worldScale (bullet time); the runner's own moves (lanes, jumps) never slow.
 */
export function step(g, dt, input = {}) {
  if (g.over || g.paused) return g;
  dt = Math.min(dt, 0.05);
  g.t += dt;
  g.started = true;

  // Power-ups wear off (in real time).
  for (const [id, left] of Object.entries(g.powers)) {
    if (POWERS[id].time === 0) continue;
    if (left - dt <= 0) {
      delete g.powers[id];
      emit(g, "powerEnd", { id });
    } else g.powers[id] = left - dt;
  }
  g.grace = Math.max(0, g.grace - dt);

  // Forward.
  const before = g.dist;
  const scale = worldScale(g);
  g.wt += dt * scale;
  g.dist += runSpeed(g) * scale * dt;
  const level = speedLevel(g.dist, g.curve);
  if (level > g.level) {
    g.level = level;
    emit(g, "speedup", { level });
  }

  // Controls.
  for (let i = 0; i < Math.min(2, Number(input.left) || 0); i++) changeLane(g, -1);
  for (let i = 0; i < Math.min(2, Number(input.right) || 0); i++) changeLane(g, 1);
  if (input.jump && !g.air) {
    g.vy = g.powers.booster ? PHYSICS.boostJump : PHYSICS.jump;
    g.air = true;
    g.slide = 0;
    emit(g, "jump");
  }
  if (input.slide) {
    if (g.air) {
      g.vy = Math.min(g.vy, PHYSICS.slam);
      g.slideOnLanding = true;
    } else if (g.slide <= 0 && g.slideCool <= 0) {
      // One slide at a time, and a breath between (no holding a slide by mashing).
      g.slide = PHYSICS.slideTime;
      emit(g, "slide");
    }
  }
  if (g.slide > 0 && g.slide - dt <= 0) g.slideCool = PHYSICS.slideCool;
  else g.slideCool = Math.max(0, g.slideCool - dt);
  g.slide = Math.max(0, g.slide - dt);

  // Sideways, at a fixed rate.
  if (g.x !== g.lane) {
    const d = g.lane - g.x;
    const move = dt / PHYSICS.laneTime;
    g.x = Math.abs(d) <= move ? g.lane : g.x + Math.sign(d) * move;
    if (g.x === g.lane && g.queued !== null) {
      const by = g.queued;
      g.queued = null;
      changeLane(g, by);
    }
  }

  // The world: oncoming trains roll, drones drift.
  for (const o of g.obstacles) {
    if (o.kind === "oncoming") {
      if (!o.moving && o.z - g.dist <= PHYSICS.trainWake) o.moving = true;
      if (o.moving) o.z -= PHYSICS.trainSpeed * scale * dt;
    }
    if (o.to !== undefined) o.x = o.lane + (o.to - o.lane) * (0.5 - 0.5 * Math.cos(g.wt * 2.2 + o.phase));
  }
  layTrack(g);

  // Up and down.
  if (g.air || g.y > g.ground) {
    g.vy -= PHYSICS.gravity * dt;
    g.y += g.vy * dt;
    g.air = true;
  }
  g.ground = groundAt(g);
  if (g.y <= g.ground) {
    if (g.air) {
      if (g.slideOnLanding) {
        g.slide = PHYSICS.slideTime;
        emit(g, "slide");
      }
      emit(g, "land");
    }
    g.y = g.ground;
    g.vy = 0;
    g.air = false;
    g.slideOnLanding = false;
  } else if (!g.air) g.air = true; // ran off a roof

  // A tunnel's ceiling: a jump stops at it; standing tall under it (on a roof, at the tunnel mouth) is a crash.
  const ceiling = ceilingAt(g);
  const height = g.slide > 0 ? PHYSICS.slideHeight : PHYSICS.height;
  if (ceiling !== null && g.y + height > ceiling) {
    if (g.air && g.y > g.ground) {
      g.y = Math.max(g.ground, ceiling - height);
      g.vy = Math.min(g.vy, 0);
    } else if (g.grace <= 0) {
      g.over = "tunnel";
      emit(g, "crash", { kind: "tunnel" });
      return g;
    }
  }

  crashes(g);
  collect(g, before);
  warnings(g);

  // Drop what's behind.
  g.obstacles = g.obstacles.filter(o => o.z + o.len > g.dist - PHYSICS.behind);
  g.pickups = g.pickups.filter(p => !p.got && p.z > g.dist - PHYSICS.behind);
  g.tunnels = g.tunnels.filter(t => t.z1 > g.dist - PHYSICS.behind);
  return g;
}

/** The ceiling over the runner (a tunnel's), or null in the open. */
export function ceilingAt(g) {
  return g.tunnels.some(t => g.dist + PHYSICS.halfDepth >= t.z0 && g.dist - PHYSICS.halfDepth <= t.z1) ? PHYSICS.tunnel : null;
}

/** Whether a point along the track is inside a tunnel. */
export const inTunnel = (g, z) => g.tunnels.some(t => z >= t.z0 && z <= t.z1);

/** The runner hit something: a shield or Kerenzikov may save them; otherwise the run is over. */
function crashes(g) {
  if (g.grace > 0) return;
  for (const o of g.obstacles) {
    if (!touches(g, o)) continue;
    if (g.powers.skate && KINDS[o.kind].low) {
      o.broken = true;
      emit(g, "smash", { kind: o.kind });
      continue;
    }
    if (g.powers.kerenzikov) {
      // Into the clearest lane next door; failing that, the shield's (or nothing's) turn.
      const to = [g.lane - 1, g.lane + 1].filter(l => l >= 0 && l <= 2 && !g.obstacles.some(b => touches(g, b, l))).sort((a, b) => clearAhead(g, b) - clearAhead(g, a))[0];
      if (to !== undefined) {
        delete g.powers.kerenzikov;
        g.lane = to;
        g.x = to;
        g.queued = null;
        g.grace = GRACE;
        emit(g, "dodge", { lane: to });
        emit(g, "powerEnd", { id: "kerenzikov" });
        return;
      }
    }
    if (g.powers.armor) {
      delete g.powers.armor;
      o.broken = true;
      g.grace = GRACE;
      emit(g, "shield", { kind: o.kind });
      emit(g, "powerEnd", { id: "armor" });
      return;
    }
    g.over = o.kind;
    emit(g, "crash", { kind: o.kind });
    return;
  }
}

/** How much open track there is ahead in a lane (for Kerenzikov's dodge). */
function clearAhead(g, lane) {
  const next = g.obstacles.filter(o => !o.broken && inLane(o, lane) && o.z + o.len > g.dist).map(o => o.z - g.dist);
  return next.length ? Math.min(...next) : Infinity;
}

/** Shards and power-ups the runner passed through (or the magnet pulled in) since `before`. */
function collect(g, before) {
  const h = g.slide > 0 ? PHYSICS.slideHeight : PHYSICS.height;
  const magnet = !!g.powers.magnet;
  for (const p of g.pickups) {
    if (p.got) continue;
    const near = p.z <= g.dist + PHYSICS.halfDepth + 0.3 && p.z >= before - PHYSICS.halfDepth - 0.3;
    const pulled = magnet && p.shard && p.z - g.dist < 12 && p.z > g.dist - 1 && p.y < 5;
    const hit = near && Math.abs(p.lane - g.x) < 0.6 && p.y >= g.y - 0.4 && p.y <= g.y + h + 0.4;
    if (!hit && !pulled) continue;
    p.got = true;
    if (p.shard) {
      const n = g.powers.spike ? 2 : 1;
      g.shards += n;
      emit(g, "shard", { n, pulled: pulled && !hit });
    } else {
      g.powers[p.power] = POWERS[p.power].time || true;
      emit(g, "power", { id: p.power });
      if (p.power === "booster") boosterLine(g);
    }
  }
}

/** The Jump Booster's high line of shards down the middle lane, for as long as it lasts. */
function boosterLine(g) {
  const len = runSpeed(g) * POWERS.booster.time * 0.9;
  for (let z = g.dist + 14; z < g.dist + len; z += 3) g.pickups.push({ shard: true, lane: 1, z, y: 3.3 });
}

/** An oncoming train's horn: as it sets off (its headlights come on over the crest), and as it passes. */
function warnings(g) {
  for (const o of g.obstacles) {
    if (o.kind !== "oncoming" || !o.moving) continue;
    if (!o.warned) {
      o.warned = true;
      emit(g, "warn", { lane: o.lane });
    }
    // Roaring past: its horn again, falling away.
    if (!o.passed && o.z < g.dist) {
      o.passed = true;
      emit(g, "pass", { lane: o.lane });
    }
  }
}

/* ---------------- Laying the track ---------------- */

/** Lay chunks until the track reaches PHYSICS.ahead past the runner. */
function layTrack(g) {
  while (g.laid < g.dist + PHYSICS.ahead) {
    const chunk = nextChunk(g);
    if (!chunk) {
      g.laid = Infinity; // a test's chunks have run out: open track from here
      return;
    }
    placeChunk(g, chunk, g.laid);
    g.laid += chunk.len + chunkGap(speedAt(g.laid, g.curve) * SKATE_SCALE);
  }
}

function nextChunk(g) {
  if (g.fixed) return g.fixed.shift() ?? null;
  const chunk = pickChunk(chunksFor(g.laid, g.config.families), g.lastChunk, g.rand);
  g.lastChunk = groupOf(chunk);
  return chunk;
}

/** One of these chunks: a group (a chunk is its own group), then one of its variations; not the `last` group again, when there's a choice. */
export function pickChunk(list, last, rand) {
  const groups = [...new Set(list.map(groupOf))];
  const pool = groups.length > 1 ? groups.filter(id => id !== last) : groups;
  const group = pool[Math.floor(rand() * pool.length)];
  const variants = list.filter(c => groupOf(c) === group);
  return variants[Math.floor(rand() * variants.length)];
}

/** Put a chunk on the track at z0, mirrored left-for-right half the time. */
export function placeChunk(g, chunk, z0, mirror = !g.fixed && g.rand() < 0.5) {
  const lane = l => (mirror ? 2 - l : l);
  for (const item of chunk.items) {
    const kind = KINDS[item.kind];
    const o = { kind: item.kind, ...kind, lane: lane(item.lane), z: z0 + item.z, len: item.len ?? kind.len };
    o.x = o.lane;
    if (item.to !== undefined) Object.assign(o, { to: lane(item.to), phase: g.rand() * Math.PI * 2 });
    g.obstacles.push(o);
  }
  if (chunk.tunnel) g.tunnels.push({ z0: z0 + chunk.tunnel[0], z1: z0 + chunk.tunnel[1] });
  for (const s of chunk.shards) {
    const gap = s.gap ?? 2.5;
    for (let i = 0; i < s.n; i++) {
      const arc = s.arc ? s.arc * Math.sin(Math.PI * (i + 0.5) / s.n) : 0;
      g.pickups.push({ shard: true, lane: lane(s.lane), z: z0 + s.z + i * gap, y: (s.y ?? 0.9) + arc });
    }
  }
  // A power-up, now and then.
  if (chunk.power && !g.fixed && z0 >= g.nextPower) {
    const id = pickPower(g, z0);
    if (id) {
      g.pickups.push({ power: id, lane: lane(chunk.power[0]), z: z0 + chunk.power[1], y: 1 });
      g.nextPower = z0 + POWER_EVERY[0] + g.rand() * (POWER_EVERY[1] - POWER_EVERY[0]);
    }
  }
  // Nothing floats inside a train or a wreck: up onto its top.
  for (const p of g.pickups) {
    const o = insideOf(g.obstacles, p);
    if (o) p.y = topAt(o, p.z) + (p.shard ? 0.9 : 1);
  }
}

/** The obstacle a pickup sits inside, if any. */
export function insideOf(obstacles, p) {
  return obstacles.find(o => !o.wide && o.lane === p.lane && p.z >= o.z - 0.5 && p.z <= o.z + o.len + 0.5 && p.y > o.bottom - 0.2 && p.y < topAt(o, p.z) + 0.3) ?? null;
}

/** A random power-up from those the GM allows (and that may turn up this far in, `at`), by weight (null if none). */
export function pickPower(g, at = Infinity) {
  const ids = Object.keys(POWERS).filter(id => g.config.powers[id] !== false && (POWERS[id].from ?? 0) <= at);
  const total = ids.reduce((sum, id) => sum + POWERS[id].weight, 0);
  let r = g.rand() * total;
  for (const id of ids) {
    r -= POWERS[id].weight;
    if (r < 0) return id;
  }
  return ids.at(-1) ?? null;
}

/* ---------------- Crashes ---------------- */

/** How a run can end, by what ended it. */
export const DEATHS = {
  roadblock: ["Ate an NCPD roadblock.", "Tackled by a barricade. NCPD says thanks."],
  sign: ["Read the sign. With your face.", "Kiroshi ad, meet forehead."],
  cable: ["Clotheslined by a cable run.", "Strung up on the power line."],
  wreck: ["Ran into a burning AV. It was already having a bad day.", "Totalled by a total wreck."],
  ramp: ["Tripped up the ramp."],
  parked: ["Kissed a parked NCART car.", "The train wasn't moving. You were."],
  oncoming: ["Flattened by the 22:40 to Heywood.", "Met the express. Head on.", "Should've listened to the horn."],
  droneHigh: ["Decapitated by a delivery drone.", "A drone took your head off. And your shards."],
  droneLow: ["Tripped over a drone. Embarrassing.", "Kneecapped by a surveillance drone."],
  gunLow: ["Maelstrom shot your legs out.", "Booster gunfire, ankle height."],
  gunHigh: ["Caught a Maelstrom burst.", "The Boosters got their shot."],
  tunnel: ["Rode the roof into the tunnel mouth.", "Low bridge. Very low."]
};

/** A line for how a run ended (`pick`: [0, 1), which of the kind's lines). */
export function deathLine(kind, pick = 0) {
  const lines = DEATHS[kind] ?? ["Wiped out."];
  return lines[Math.floor(pick * lines.length) % lines.length];
}

/* ---------------- Leaderboard ---------------- */

export const BOARD_SIZE = 10;
export const MAX_SHARDS = 99999;
export const MAX_DIST = 999999;

/** Order: more shards first, then further, then earlier. */
export const better = (a, b) => b.shards - a.shards || b.dist - a.dist || a.ts - b.ts;

/**
 * Whether a run's numbers are believable (`dist`: shown metres, as on the board): at most 1.5 shards per
 * game metre run (three lanes of the densest lines, doubled by Data Spike, rounded up), plus a little.
 */
export const plausible = (shards, dist) => shards >= 0 && dist >= 0 && shards <= MAX_SHARDS && dist <= MAX_DIST && shards <= (dist / SHOWN) * 1.5 + 20;

/** Add a score: a character keeps only their best; a fake name is its own entry. Returns the new list. */
export function addScore(scores, entry) {
  const list = [...(scores ?? [])];
  if (entry.actorId) {
    const i = list.findIndex(s => s.actorId === entry.actorId);
    if (i >= 0) {
      if (better(list[i], entry) <= 0) return list;
      list.splice(i, 1);
    }
  }
  list.push(entry);
  return list.sort(better).slice(0, 50);
}

/** The board as shown: the top entries, with ranks. */
export const topScores = (scores, n = BOARD_SIZE) => [...(scores ?? [])].sort(better).slice(0, n).map((s, i) => ({ ...s, rank: i + 1 }));

/** Where a run would land on the shown board: its rank, or 0 when it isn't the character's best or doesn't make it. */
export function boardRank(scores, actorId, shards, dist, ts = Date.now()) {
  const mark = { actorId, shards, dist, ts };
  const i = addScore(scores, mark).indexOf(mark);
  return i >= 0 && i < BOARD_SIZE ? i + 1 : 0;
}

/** Made-up arcade initials (the line's regulars). */
const HANDLES = [
  "ACE", "NEO", "RAT", "GNK", "ZAP", "VEX", "ZED", "JAX", "KIT", "DOC", "RIP", "FOX", "NIX", "RAZ", "TYG", "VOO", "HEX",
  "BIT", "SKY", "MOX", "AFK", "CHR", "DIV", "NCP", "RUN", "RLS", "TRN", "VAL", "WTZ", "MAX", "DED", "ZIG", "KAT", "JUN"
];

/** Made-up entries for the board: [{ name, shards, dist }]. */
export function randomEntries(n, rand = Math.random, taken = []) {
  const names = HANDLES.filter(h => !taken.includes(h));
  const out = [];
  for (let i = 0; i < n && names.length; i++) {
    const [name] = names.splice(Math.floor(rand() * names.length), 1);
    const dist = Math.round(100 + rand() ** 2 * 1200);
    out.push({ name, dist, shards: Math.round((dist / SHOWN) * (0.12 + rand() * 0.12)) });
  }
  return out;
}

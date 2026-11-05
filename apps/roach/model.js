/*
 * Roach Race: the Cyberpunk 2077 arcade cabinet on the Agent. A side-scroller: Roach gallops right,
 * one button jumps; a second press in the air jumps again; a third "glitches" Roach straight back to
 * the ground, untouchable for a moment (then it needs a few seconds to recharge). Fences, barriers,
 * walls and pits on the ground; crows and griffons in the air, which mostly miss a horse on the
 * ground (a diving crow doesn't). Apples are +20; a carrot makes Roach run on two legs and score
 * three times as fast for a while (carrots chain). Stages 1-1 to 1-4 bring the hazards in one by one,
 * then the course loops (2-1, 3-1, …), faster each stage. One life.
 *
 * Pure game logic here (drawing: apps/roach/draw.js; the page: apps/roach/page.js). The course is
 * built from hand-made chunks; tests/roach.test.js proves each one can be cleared at every speed, with
 * jumps and double jumps only (the glitch is a spare), starting from the ground and landing again
 * before the next.
 *
 * Money and the board: no skill roll; a day pass (the GM's price, 20eb by default)
 * bought through BangMe!, good until in-world midnight; one all-time board (best per character,
 * arcade initials from Flappy Chrome); cosmetic "Steeds" bought once per character, never better
 * than Roach. The GM's settings are the world setting "roach" (roachConfig); the board is "roachBoard"
 * ({ scores: [{ id, name, who?, actorId?, score, dist, ts, fake? }] }); each character's passes and
 * steeds are the host's table "roachRiders" ({ [actorId]: Rider }, see riderOf).
 */

import { addScore as addBest, boardRank as rankOf, topScores as topOf } from "../pigeon/model.js";

/** The playfield, in game units: always this size, however big the canvas (it's scaled to fit). */
export const FIELD = { w: 288, h: 400, ground: 300 };

/** Physics steps per second: runs play the same at any frame rate. */
export const STEP = 1 / 120;

export const PHYSICS = {
  gravity: 1500, // units/s²
  jump: 520, // upward speed of a jump
  double: 440, // ... and of the second jump, in the air
  horse: { x: 52, w: 34, h: 26 }, // Roach's box: left edge on screen, size (the drawing is a little bigger)
  glitchCooldown: 4, // seconds before the glitch works again
  glitchSafe: 0.5, // untouchable this long after a glitch
  speed: 150, // units/s at 1-1
  perStage: 10, // faster each stage
  maxSpeed: 290,
  stageLen: 2400, // units a stage lasts
  scoreRate: 1 / 12, // points a unit run
  carrotRate: 3, // ... times this on two legs
  apple: 20,
  carrotTime: 6, // seconds on two legs a carrot gives
  carrotMax: 15, // ... chained, at most this long
  fall: 40 // this far down a pit is the end
};

/** Seconds between jumping and landing (a single jump): how long the gap after a chunk must give. */
const AIR = (2 * PHYSICS.jump) / PHYSICS.gravity;

/** Units between chunks at a speed: room to land, then to jump again. */
export const chunkGap = speed => Math.round(speed * (AIR + 0.35) + 24);

/** The speed at a stage (0 = 1-1). */
export const speedAt = stage => Math.min(PHYSICS.maxSpeed, PHYSICS.speed + stage * PHYSICS.perStage);

/** Every speed a run goes through, slowest first. */
export const SPEEDS = (() => {
  const out = [];
  for (let s = 0; speedAt(s) < PHYSICS.maxSpeed; s++) out.push(speedAt(s));
  return [...out, PHYSICS.maxSpeed];
})();

/** The stage a distance is in (0, 1, 2…), and its label ("1-1"… "1-4", then "2-1"…). */
export const stageAt = dist => Math.floor(Math.max(0, dist) / PHYSICS.stageLen);
export const stageLabel = stage => `${Math.floor(stage / 4) + 1}-${(stage % 4) + 1}`;

/** Which hazards a stage has: 1-1 the ground only, 1-2 crows and pits, 1-3 griffons and walls, 1-4 swooping griffons; every loop after, all. */
export const partOf = stage => Math.min(3, stage);

/**
 * What can be on the course. Ground hazards: `w` wide, `h` tall. Pits: `w` per item. Flyers: `alt`
 * (their bottom, above the ground), or `alt: [from, to]` sliding between `d: [from, to]` units ahead of
 * Roach (a dive, a swoop); `pace`: how much faster than the ground they come. Pickups float at the item's alt.
 */
export const KINDS = {
  fence: { ground: true, w: 12, h: 20, name: "a fence" },
  rail: { ground: true, w: 40, h: 16, name: "a rail fence" },
  barrier: { ground: true, w: 14, h: 36, name: "a barrier" },
  wall: { ground: true, w: 16, h: 54, name: "a wall" },
  pit: { pit: true, name: "a pit" },
  crow: { flyer: true, w: 22, h: 12, alt: 44, pace: 40, name: "a crow" },
  diver: { flyer: true, w: 22, h: 12, alt: [66, 6], d: [190, 100], pace: 40, name: "a diving crow" },
  griffon: { flyer: true, w: 40, h: 22, alt: 34, pace: 25, name: "a griffon" },
  swoop: { flyer: true, w: 40, h: 22, alt: [130, 32], d: [250, 60], pace: 25, name: "a griffon" },
  apple: { pickup: true, w: 12, h: 12 },
  carrot: { pickup: true, w: 16, h: 10 }
};

/**
 * The course's chunks: items [kind, x, alt or pit width], x from the chunk's start. `from`: the first
 * part (partOf) it turns up in. Apples sit where a good jump takes Roach anyway, and all of a chunk's
 * apples can be taken together (the orchard is an arc one jump rides through at any speed).
 */
export const CHUNKS = [
  // 1-1: fences and barriers.
  { id: "fence", from: 0, items: [["fence", 0], ["apple", 0, 56]] },
  { id: "barrier", from: 0, items: [["barrier", 0], ["apple", 2, 76]] },
  { id: "fences", from: 0, items: [["fence", 0], ["fence", 140]] },
  { id: "rail", from: 0, items: [["rail", 0], ["apple", 14, 60]] },
  { id: "step", from: 0, items: [["fence", 0], ["barrier", 170]] },
  { id: "orchard", from: 0, items: [["apple", 0, 80], ["apple", 24, 92], ["apple", 48, 80]] },
  // 1-2: crows and pits.
  { id: "crow", from: 1, items: [["crow", 0]] },
  { id: "diver", from: 1, items: [["diver", 0]] },
  { id: "pit", from: 1, items: [["pit", 0, 60], ["apple", 24, 70]] },
  { id: "wide-pit", from: 1, items: [["pit", 0, 90]] },
  { id: "fence-crow", from: 1, items: [["fence", 0], ["crow", 220]] },
  { id: "pit-fence", from: 1, items: [["pit", 0, 60], ["fence", 210]] },
  // 1-3: griffons and walls.
  { id: "griffon", from: 2, items: [["griffon", 0], ["apple", 70, 8]] },
  { id: "wall", from: 2, items: [["wall", 0], ["apple", 2, 110]] },
  { id: "fence-griffon", from: 2, items: [["fence", 0], ["griffon", 260]] },
  { id: "crows", from: 2, items: [["crow", 0], ["diver", 240]] },
  { id: "barrier-pit", from: 2, items: [["barrier", 0], ["pit", 190, 64]] },
  // 1-4: swooping griffons.
  { id: "swoop", from: 3, items: [["swoop", 0]] },
  { id: "pit-swoop", from: 3, items: [["pit", 0, 70], ["swoop", 260]] },
  { id: "gauntlet", from: 3, items: [["barrier", 0], ["pit", 190, 60], ["fence", 400]] }
];

/** The chunks a stage may use. */
export const chunksFor = stage => CHUNKS.filter(c => c.from <= partOf(stage));

/** A chunk's items placed at x0: [{ kind, x, w, h, alt, … }]. */
export function placeChunk(chunk, x0) {
  return chunk.items.map(([kind, x, extra]) => {
    const k = KINDS[kind];
    const item = { kind, x: x0 + x, w: k.pit ? extra : k.w, h: k.h ?? 0 };
    if (k.pickup) item.alt = extra ?? 8;
    if (k.flyer) Object.assign(item, Array.isArray(k.alt) ? { alt0: k.alt[0], alt1: k.alt[1], d0: k.d[0], d1: k.d[1] } : { alt0: k.alt, alt1: k.alt, d0: 0, d1: 0 }, { pace: k.pace });
    return item;
  });
}

/** A chunk's length: to the far edge of its last hazard or pickup. */
export const chunkLen = chunk => Math.max(...placeChunk(chunk, 0).map(i => i.x + i.w));

/**
 * Where a flyer is, for Roach at world x `hx` going `speed`: it comes `pace` faster than the ground, but
 * always meets Roach where it was placed (so a chunk stays a chunk). Returns { x, alt } (world x, bottom).
 */
export function flyerAt(item, hx, speed) {
  const x = hx + (item.x - hx) * (1 + item.pace / speed);
  const d = x - hx;
  const k = item.d0 === item.d1 ? 1 : Math.min(1, Math.max(0, (item.d0 - d) / (item.d0 - item.d1)));
  return { x, alt: item.alt0 + (item.alt1 - item.alt0) * k };
}

/** A new run. `rand`: () => [0, 1). `chunks`: a fixed course (tests), else random. */
export function newGame(rand = Math.random, { chunks = null } = {}) {
  return {
    rand, fixed: chunks ? [...chunks] : null,
    t: 0, dist: 0, score: 0, apples: 0, carrots: 0, stage: 0,
    y: 0, vy: 0, jumps: 0, falling: false, safe: 0, glitchCd: 0, carrot: 0,
    items: [], next: 220, over: false, events: [], paused: false, acc: 0, pending: false
  };
}

/** Roach's world x (the box's left edge). */
export const horseX = g => g.dist + PHYSICS.horse.x;

/** The speed now. */
export const runSpeed = g => speedAt(g.stage);

/** Note something the phone should hear about (sounds, flashes): drained by the page each frame. */
const emit = (g, type, data = {}) => g.events.push({ type, ...data });

/**
 * Advance a run by a frame's worth of time (at most a quarter second, after a stall), in fixed steps;
 * time left over carries to the next frame. `press`: the button went down since the last frame.
 */
export function advance(g, dt, press = false) {
  g.acc += Math.min(Math.max(dt, 0), 0.25);
  if (press) g.pending = true;
  while (g.acc >= STEP && !g.over && !g.paused) {
    g.acc -= STEP;
    step(g, STEP, g.pending);
    g.pending = false;
  }
  return g;
}

/** The button: jump from the ground, jump again in the air, then glitch down (when it's charged). */
export function press(g) {
  if (g.falling) return;
  if (g.jumps === 0 && g.y <= 0) {
    g.vy = PHYSICS.jump;
    g.jumps = 1;
    emit(g, "jump");
  } else if (g.jumps <= 1) {
    g.vy = PHYSICS.double;
    g.jumps = 2;
    emit(g, "double");
  } else if (g.glitchCd <= 0) {
    g.y = 0;
    g.vy = 0;
    g.jumps = 0;
    g.safe = PHYSICS.glitchSafe;
    g.glitchCd = PHYSICS.glitchCooldown;
    emit(g, "glitch");
  }
}

/** Whether Roach's middle is over a pit now. */
const overPit = (g, hx = horseX(g)) => g.items.some(i => i.kind === "pit" && hx + PHYSICS.horse.w / 2 > i.x + 4 && hx + PHYSICS.horse.w / 2 < i.x + i.w - 4);

/** The hazard Roach touches now, if any. */
export function hit(g, speed = runSpeed(g)) {
  const hx = horseX(g);
  const { w, h } = PHYSICS.horse;
  for (const i of g.items) {
    const k = KINDS[i.kind];
    if (k.ground) {
      if (i.x < hx + w && i.x + i.w > hx && g.y < i.h) return i;
    } else if (k.flyer) {
      const f = flyerAt(i, hx, speed);
      if (f.x < hx + w && f.x + i.w > hx && g.y < f.alt + i.h && g.y + h > f.alt) return i;
    }
  }
  return null;
}

/** Roach's moves for `dt` seconds, with or without a press (the part tests/roach.test.js searches). */
export function move(g, dt, pressed = false) {
  if (pressed) press(g);
  const speed = runSpeed(g);
  g.dist += speed * dt;
  g.safe = Math.max(0, g.safe - dt);
  g.glitchCd = Math.max(0, g.glitchCd - dt);
  if (g.falling || g.y > 0 || g.vy > 0) {
    g.vy -= PHYSICS.gravity * dt;
    g.y += g.vy * dt;
    if (g.y <= 0 && !g.falling) {
      if (overPit(g) && g.safe <= 0) g.falling = true;
      else {
        g.y = 0;
        g.vy = 0;
        if (g.jumps) emit(g, "land");
        g.jumps = 0;
      }
    }
  } else if (overPit(g) && g.safe <= 0) {
    g.falling = true;
    g.vy = Math.min(g.vy, 0);
  }
  if (g.falling) {
    if (g.y < -PHYSICS.fall) return end(g, "pit");
    return g;
  }
  if (g.safe <= 0) {
    const what = hit(g, speed);
    if (what) return end(g, what.kind);
  }
  return g;
}

function end(g, kind) {
  g.over = kind;
  emit(g, "crash", { kind });
  return g;
}

/** Advance a run by `dt` seconds with or without a press. Mutates and returns it. */
export function step(g, dt, pressed = false) {
  if (g.over || g.paused) return g;
  g.t += dt;
  const before = g.dist;
  move(g, dt, pressed);
  if (g.over) return g;
  const speed = runSpeed(g);
  const two = g.carrot > 0;
  g.score += (g.dist - before) * PHYSICS.scoreRate * (two ? PHYSICS.carrotRate : 1);
  if (two) {
    g.carrot = Math.max(0, g.carrot - dt);
    if (!g.carrot) emit(g, "fours");
  }
  pickups(g);
  const stage = stageAt(g.dist);
  if (stage !== g.stage) {
    g.stage = stage;
    emit(g, "stage", { stage, label: stageLabel(stage) });
  }
  // Lay the course ahead, and drop what's behind.
  while (g.next < g.dist + FIELD.w + 320) lay(g);
  g.items = g.items.filter(i => (KINDS[i.kind].flyer ? flyerAt(i, horseX(g), speed).x : i.x) + i.w > g.dist - 60 && !i.taken);
  return g;
}

/** Apples and carrots Roach runs through. */
function pickups(g) {
  const hx = horseX(g);
  const { w, h } = PHYSICS.horse;
  for (const i of g.items) {
    if (!KINDS[i.kind].pickup || i.taken) continue;
    if (i.x < hx + w && i.x + i.w > hx && g.y < i.alt + i.h && g.y + h > i.alt) {
      i.taken = true;
      if (i.kind === "apple") {
        g.score += PHYSICS.apple;
        g.apples++;
        emit(g, "apple");
      } else {
        g.carrots++;
        const was = g.carrot;
        g.carrot = Math.min(PHYSICS.carrotMax, g.carrot + PHYSICS.carrotTime);
        emit(g, "carrot", { chain: was > 0 });
      }
    }
  }
}

/** The next chunk (and, now and then, a carrot in the gap after it). */
function lay(g) {
  const stage = stageAt(g.next);
  const list = chunksFor(stage);
  const chunk = g.fixed ? g.fixed.shift() : list[Math.floor(g.rand() * list.length)];
  if (!chunk) {
    g.next = Infinity;
    return;
  }
  g.items.push(...placeChunk(chunk, g.next));
  const end = g.next + chunkLen(chunk);
  const gap = chunkGap(speedAt(stage));
  if (!g.fixed && stage >= 1 && g.rand() < 0.08) g.items.push(...placeChunk({ items: [["carrot", 0, 10]] }, end + gap / 2 - 8));
  g.next = end + gap;
}

/* ---------------- How a run ends ---------------- */

export const DEATHS = {
  fence: ["Roach clipped the fence.", "Over the fence. Almost."],
  rail: ["Tangled in the rails."],
  barrier: ["Straight into the barrier."],
  wall: ["The wall won."],
  pit: ["Into the pit. Roach will be fine. Somehow."],
  crow: ["A crow in the face."],
  diver: ["The crow dove. Roach didn't."],
  griffon: ["Griffon. Bad luck, bad timing."],
  swoop: ["Snatched by a griffon."],
  quit: ["Rode off the course."]
};

export function deathLine(kind, pick = 0) {
  const lines = DEATHS[kind] ?? ["Roach went down."];
  return lines[Math.min(lines.length - 1, Math.floor(pick * lines.length))];
}

/* ---------------- Steeds and the GM's settings ---------------- */

/**
 * The steeds (the starter list): how each is drawn (apps/roach/draw.js) and its default
 * price. `sale`: "buy" (in the stable), "gift" (the GM gives it), "hidden" (not listed). Roach is free.
 */
export const STEEDS = {
  roach: { name: "Roach", price: 0, sale: "buy", coat: "#7a4a2a", mane: "#2a1a10", eye: "#111" },
  chromed: { name: "Chromed Roach", price: 50, sale: "buy", coat: "#9aa6b8", mane: "#3a4250", eye: "#00e5ff", chrome: true },
  nightmare: { name: "Kiroshi-eyed Night Mare", price: 100, sale: "buy", coat: "#1d1a24", mane: "#5b1a8a", eye: "#ff2a6d", glow: true },
  warhorse: { name: "Militech Warhorse", price: 100, sale: "buy", coat: "#4a5a3a", mane: "#1d2418", eye: "#f5d300", armor: true },
  unicorn: { name: "Neon Unicorn", price: 200, sale: "buy", coat: "#f2e6ff", mane: "#ff4fd8", eye: "#00f0ff", horn: true, glow: true },
  samurai: { name: "Samurai Tour Pony", price: 500, sale: "buy", coat: "#eae2d0", mane: "#c8102e", eye: "#111", samurai: true },
  gold: { name: "Gold Roach", price: 0, sale: "gift", coat: "#d4a017", mane: "#7a5a00", eye: "#fff6c0", chrome: true, gold: true }
};

export const SALES = { buy: "In the stable", gift: "GM gift only", hidden: "Hidden" };

export const ROACH_DEFAULTS = {
  price: 20, // eb, a day pass
  freePlay: false,
  out: false, // "Out of order": nobody plays
  record: 3354, // the House Record; 0: none
  prize: "a Roach Whisperer jacket",
  steeds: {} // { [id]: { name?, price?, sale? } } over STEEDS
};

/** The GM's settings (the world setting "roach"), over the defaults. */
export function configOf(saved = {}) {
  const s = saved ?? {};
  const num = (v, d, max) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(max, Math.max(0, Math.floor(Number(v)))) : d);
  return {
    price: num(s.price, ROACH_DEFAULTS.price, 99999),
    freePlay: !!s.freePlay,
    out: !!s.out,
    record: num(s.record, ROACH_DEFAULTS.record, 999999),
    prize: typeof s.prize === "string" ? s.prize : ROACH_DEFAULTS.prize,
    steeds: steedsOf(s.steeds)
  };
}

/** The steeds with the GM's changes: { [id]: { id, name, price, sale, …look } }. Roach is always free and buyable. */
export function steedsOf(saved = {}) {
  return Object.fromEntries(Object.entries(STEEDS).map(([id, base]) => {
    const s = saved?.[id] ?? {};
    const price = id === "roach" ? 0 : Number.isFinite(Number(s.price)) && s.price !== "" && s.price !== null ? Math.min(99999, Math.max(0, Math.floor(Number(s.price)))) : base.price;
    const sale = id === "roach" ? "buy" : s.sale in SALES ? s.sale : base.sale;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : base.name;
    return [id, { ...base, id, name, price, sale }];
  }));
}

/* ---------------- Riders: passes and steeds ---------------- */

/**
 * A character's row in "roachRiders": { pass: the in-world day it's good for (dayOf), paid (eb, for a
 * refund), steeds: [ids owned], steed: the one ridden, record: null | "pending" | "awarded" | "declined" }.
 */
export function riderOf(riders, actorId) {
  const r = riders?.[actorId] ?? {};
  const steeds = [...new Set(["roach", ...(Array.isArray(r.steeds) ? r.steeds : [])])].filter(id => STEEDS[id]);
  return {
    pass: typeof r.pass === "string" ? r.pass : null,
    paid: Number(r.paid) || 0,
    steeds,
    steed: steeds.includes(r.steed) ? r.steed : "roach",
    record: r.record ?? null
  };
}

/** Whether a character may play today: the cabinet works, and free play or a pass for `today`. */
export const canPlay = (rider, cfg, today) => !cfg.out && (cfg.freePlay || (!!rider.pass && rider.pass === today));

/* ---------------- Leaderboard ---------------- */

export const BOARD_SIZE = 10;
export const MAX_SCORE = 999999;

/** Add a score: a character keeps only their best; a fake name is its own entry. Returns the new list. */
export const addScore = addBest;

/** The board as shown: the top entries, with ranks. */
export const topScores = (scores, n = BOARD_SIZE) => topOf(scores, n);

/** Where a score would land on the board (0: not their best, or not in the top BOARD_SIZE). */
export const boardRank = rankOf;

/** Whether a score is believable for the distance run: points, plus every apple a run could reach. */
export const plausible = (score, dist) =>
  score >= 0 && dist >= 0 && score <= MAX_SCORE && score <= dist * PHYSICS.scoreRate * PHYSICS.carrotRate + (dist / 40) * PHYSICS.apple + 60;

/** Made-up entries for the board: [{ name, score, dist }]. */
export function randomEntries(n, rand = Math.random, taken = []) {
  const names = HANDLES.filter(h => !taken.includes(h));
  const out = [];
  for (let i = 0; i < n && names.length; i++) {
    const [name] = names.splice(Math.floor(rand() * names.length), 1);
    const dist = Math.round(4000 + rand() ** 2 * 30000);
    out.push({ name, score: Math.round(dist * PHYSICS.scoreRate * (1.1 + rand() * 0.4)), dist });
  }
  return out;
}

const HANDLES = ["GRT", "CIR", "YEN", "JAS", "TRS", "ZOL", "DND", "VES", "KRW", "WLF", "BRD", "PLT", "SKL", "NOV", "KMH", "RCH", "GWN", "HRS", "APL", "CRT"];

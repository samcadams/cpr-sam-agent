/*
 * Flappy Chrome: a flappy game on the phone. A chromed Night City pigeon flaps between smog stacks;
 * from a few points in, Maelstrom gunfire streaks across too. Pure game logic here (the phone draws
 * it, apps/pigeon/page.js); the leaderboard is the world setting "pigeonBoard", written by the
 * host: { scores: [{ id, name, who?, actorId?, score, ts, fake? }] }, each character's best only. A
 * character's `name` is the three initials they entered (`who`: the character, for the GM).
 *
 * A run gets harder as it scores: the city speeds up (towards a cap), openings shrink and vary more, and
 * Maelstrom's gunfire comes more often, in patterns (bursts, aimed shots, sweeps, walls, a weaving drone).
 * Every pattern warns first, and while one is on the stacks ahead open wider. Between runs each character carries Maelstrom Heat (0-5,
 * the world setting "pigeonHeat": { [actorId]: { heat, ts } }), raised by good runs and only lowered by
 * the GM: it unlocks the patterns early and makes them come more often.
 */

/** The playfield, in game units: always this size, however big the canvas (it's scaled to fit). */
export const FIELD = { w: 288, h: 400, ground: 372 };

/** Where the pigeon hovers before the first flap (high, leaving room for the board below). */
const hoverY = f => f.h * 0.15;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const PHYSICS = {
  gravity: 1100, // units/s²
  flap: -330, // vertical speed after a flap
  maxFall: 520,
  speed: 120, // how fast the city scrolls, at the start
  maxSpeed: 168, // ... and what it eases towards (see speedAt)
  speedRamp: 45, // points to get about two thirds of the way there
  stackWidth: 46,
  spacing: 186, // units between stacks (so they come more often as the city speeds up)
  gap: 118, // opening between a stack's halves, at the start
  minGap: 92,
  climb: 140, // how far up (units/s) a gap's middle may move from the last: the pigeon must make it
  bird: { x: 72, r: 11 },
  // Gunfire: from this score, a pattern every few seconds (see PATTERNS).
  gunFrom: 5,
  gunEvery: 3.2,
  gunFastest: 1.6,
  cooldown: 1.5, // at least this long after a pattern's last shot has gone
  warn: 0.6, // a pattern's warning, before it fires
  bulletSpeed: 260, // on top of the city's speed
  laserPace: 0.85, // shots cross the screen at this share of (city speed + their own)
  opening: 80 // units/s a stack ahead opens wider by when a pattern starts
};

/** Openings vary around gapAt(score) by ± GAP.spread, plus GAP.per a point (up to GAP.cap points). */
export const GAP = { spread: 8, per: 0.4, cap: 60, low: 84, high: 150 };

/** Maelstrom's patterns: from a score, or from a character's Heat. `relief`: how much wider the stacks ahead open meanwhile. */
export const PATTERNS = {
  tracer: { score: 5, heat: 0, relief: 0 },
  burst: { score: 15, heat: 1, relief: 24 },
  aimed: { score: 25, heat: 2, relief: 24 },
  sweep: { score: 35, heat: 3, relief: 32 },
  wall: { score: 50, heat: 4, relief: 32 },
  drone: { score: 70, heat: 5, relief: 24 }
};

/** Maelstrom Heat: a character's run scoring at least HEAT.at[n] raises them to n + 1. */
export const HEAT = { max: 5, at: [10, 25, 40, 60, 80] };

/** The Heat a run's score earns. */
export const heatFor = score => HEAT.at.filter(n => score >= n).length;

/** A character's Heat in the "pigeonHeat" setting. */
export const heatOf = (heat, actorId) => clamp(Math.floor(Number(heat?.[actorId]?.heat) || 0), 0, HEAT.max);

/** The setting after a run: their Heat raised to what the score earns, or null if that's no higher. */
export function raiseHeat(heat, actorId, score, ts = Date.now()) {
  const next = heatFor(score);
  if (!actorId || next <= heatOf(heat, actorId)) return null;
  return { ...heat, [actorId]: { heat: next, ts } };
}

/** The setting with a character's Heat set to `n` (0 drops them). */
export function setHeat(heat, actorId, n, ts = Date.now()) {
  const out = { ...heat };
  n = clamp(Math.floor(Number(n) || 0), 0, HEAT.max);
  if (n) out[actorId] = { heat: n, ts };
  else delete out[actorId];
  return out;
}

/** A new run. `rand`: () => [0, 1). `field`: fieldFor() (FIELD by default). `heat`: the character's Maelstrom Heat. */
export function newGame(rand = Math.random, field = FIELD, heat = 0) {
  return {
    ...field, y: hoverY(field), vy: 0, t: 0, dist: 0, speed: PHYSICS.speed, score: 0, heat: clamp(heat, 0, HEAT.max),
    stacks: [], bullets: [], pattern: null, nextStack: 0.9, nextGun: PHYSICS.gunEvery, lastMid: null, lastTight: false,
    shots: 0, over: false, started: false, rand
  };
}

/** The opening shrinks a little every few points. */
export const gapAt = score => Math.max(PHYSICS.minGap, PHYSICS.gap - Math.floor(score / 5) * 4);

/** How far openings vary either way at a score. */
export const gapSpread = score => GAP.spread + GAP.per * Math.min(score, GAP.cap);

/** The city's speed: up a little with every point, easing towards PHYSICS.maxSpeed. */
export const speedAt = score => PHYSICS.speed + (PHYSICS.maxSpeed - PHYSICS.speed) * (1 - Math.exp(-score / PHYSICS.speedRamp));

/** Seconds between patterns, before the ±30% jitter. */
export const gunEvery = (score, heat = 0) => Math.max(PHYSICS.gunFastest, PHYSICS.gunEvery - 0.02 * score - 0.15 * heat);

/** The patterns Maelstrom may use (gunfire starts at PHYSICS.gunFrom whatever the Heat). */
export const patternsFor = (score, heat = 0) => (score < PHYSICS.gunFrom ? [] : Object.keys(PATTERNS).filter(k => score >= PATTERNS[k].score || heat >= PATTERNS[k].heat));

/** Physics steps per second: runs play the same at any frame rate. */
export const STEP = 1 / 120;

/**
 * Advance a run by a frame's worth of time (at most a quarter second, after a stall), in fixed steps.
 * Time left over carries to the next frame, and a flap waits for the next step: a frame shorter than
 * a step (above 120 Hz) runs none. Mutates and returns it.
 */
export function advance(g, dt, flap = false) {
  g.acc = (g.acc ?? 0) + Math.min(Math.max(dt, 0), 0.25);
  if (flap) g.pending = true;
  // (The epsilon keeps float drift from leaving a whole step behind.)
  while (g.acc >= STEP - 1e-9 && !g.over) {
    g.acc -= STEP;
    step(g, STEP, !!g.pending);
    g.pending = false;
  }
  return g;
}

/** The next stack's opening: varied, never two tight ones in a row, wider while a pattern is on. */
function nextGap(g) {
  const base = gapAt(g.score);
  const spread = gapSpread(g.score);
  const lo = g.lastTight ? 0 : -spread;
  const gap = clamp(Math.round(base + lo + g.rand() * (spread - lo)), GAP.low, GAP.high);
  g.lastTight = gap < base - spread / 2;
  return gap + (g.pattern?.relief ?? 0);
}

function spawnStack(g) {
  const gap = nextGap(g);
  const low = 40;
  const high = g.ground - 40 - gap;
  let top = low + g.rand() * (high - low);
  // Not so far above the last opening that the pigeon can't climb to it in time.
  if (g.lastMid !== null) top = Math.max(top, g.lastMid - PHYSICS.climb * (PHYSICS.spacing / g.speed) - gap / 2);
  top = clamp(top, low, high);
  g.lastMid = top + gap / 2;
  g.stacks.push({ x: g.w + 4, top, gap, passed: false, relief: !!g.pattern?.relief });
}

/** The shots of a pattern: when (seconds from its start) and where. */
function shotsFor(kind, g) {
  const { warn } = PHYSICS;
  const y = (lo, hi) => lo + g.rand() * (hi - lo);
  switch (kind) {
    case "burst": {
      const mid = y(70, g.ground - 70);
      return [0, -38, 38].map((dy, i) => ({ at: warn + i * 0.3, y: mid + dy }));
    }
    case "aimed":
      return [{ at: warn + 0.5, aimed: true }];
    case "sweep": {
      const dir = g.rand() < 0.5 ? 1 : -1;
      const from = dir > 0 ? y(36, g.ground - 216) : y(216, g.ground - 36);
      return [0, 1, 2, 3, 4].map(i => ({ at: warn + i * 0.15, y: from + dir * i * 45 }));
    }
    case "wall":
      return [{ at: warn, wall: true }];
    case "drone":
      return [{ at: warn, y: y(90, g.ground - 90), drone: true }];
    default:
      return [{ at: warn, y: y(30, g.ground - 30) }];
  }
}

/** Where a wall's opening goes: the middle of the gap the pigeon will be in (or about to be) when it arrives. */
function wallHole(g) {
  const { x, r } = PHYSICS.bird;
  const ahead = (g.w + 10 - x) / ((g.speed + PHYSICS.bulletSpeed) * PHYSICS.laserPace);
  const at = g.stacks.map(s => ({ s, x: s.x - g.speed * ahead })).filter(o => o.x + PHYSICS.stackWidth > x - r - 17);
  const near = at.find(o => o.x < x + r + 17) ?? at.sort((a, b) => a.x - b.x)[0];
  return near ? near.s.top + near.s.gap / 2 : clamp(g.y, 60, g.ground - 60);
}

/** A shot's bullets. Each remembers its pattern (`p`), so the pattern lasts until they've gone. */
function fire(g, p, shot) {
  const b = { x: g.w + 10, v: PHYSICS.bulletSpeed, p: p?.id ?? null };
  if (shot.wall) {
    const hole = wallHole(g);
    const out = [];
    for (let y = 14; y < g.ground - 6; y += 26) if (Math.abs(y - hole) >= 48) out.push({ ...b, y });
    return out;
  }
  if (shot.aimed) return [{ ...b, y: p.aimY }];
  if (shot.drone) return [{ ...b, v: 120, y: shot.y, y0: shot.y, amp: 45, t: 0 }];
  return [{ ...b, y: clamp(shot.y, 16, g.ground - 16) }];
}

/**
 * A pattern's start opens every stack the pigeon has still to pass, so the ones it's in when the shots
 * arrive are wide too, not just those that come after. They open over the warning (see step).
 */
function widen(g, by) {
  for (const s of g.stacks) {
    if (s.passed || s.relief) continue;
    Object.assign(s, { relief: true, base: { top: s.top, gap: s.gap }, wide: by, open: 0 });
  }
}

/** Maelstrom: one pattern at a time, a warning first, a breather after. */
function gunfire(g, dt) {
  const p = g.pattern;
  if (p) {
    p.t += dt;
    // An aimed shot's laser follows the pigeon through the warning, then holds.
    if (p.kind === "aimed" && p.t < PHYSICS.warn) p.aimY = clamp(g.y, 16, g.ground - 16);
    while (p.shots.length && p.shots[0].at <= p.t) g.bullets.push(...fire(g, p, p.shots.shift()));
    if (!p.shots.length && !g.bullets.some(b => b.p === p.id)) {
      g.pattern = null;
      g.nextGun = Math.max(PHYSICS.cooldown, p.every - p.t);
    }
    return;
  }
  const kinds = patternsFor(g.score, g.heat);
  if (!kinds.length) return;
  g.nextGun -= dt;
  if (g.nextGun > 0) return;
  const every = gunEvery(g.score, g.heat) * (0.7 + g.rand() * 0.6);
  const specials = kinds.filter(k => k !== "tracer");
  const kind = specials.length && g.rand() >= 0.4 ? specials[Math.floor(g.rand() * specials.length)] : "tracer";
  if (PATTERNS[kind].relief) widen(g, PATTERNS[kind].relief);
  g.pattern = { id: ++g.shots, kind, t: 0, every, relief: PATTERNS[kind].relief, shots: shotsFor(kind, g), aimY: g.y };
}

/**
 * Advance a run by `dt` seconds (`flap`: the player tapped since the last step). Mutates and returns it.
 * Until the first flap the pigeon hovers.
 */
export function step(g, dt, flap = false) {
  if (g.over) return g;
  dt = Math.min(dt, 0.05);
  if (flap) {
    g.started = true;
    g.vy = PHYSICS.flap;
  }
  g.t += dt;
  if (!g.started) {
    g.y = hoverY(g) + Math.sin(g.t * 4) * 6;
    return g;
  }
  g.vy = Math.min(PHYSICS.maxFall, g.vy + PHYSICS.gravity * dt);
  g.y += g.vy * dt;
  g.speed = speedAt(g.score);
  g.dist += g.speed * dt;

  // Smog stacks: a top and a bottom half with an opening between.
  g.nextStack -= dt;
  if (g.nextStack <= 0) {
    g.nextStack += PHYSICS.spacing / g.speed;
    spawnStack(g);
  }
  for (const s of g.stacks) {
    s.x -= g.speed * dt;
    if (s.base && s.open < s.wide) {
      s.open = Math.min(s.wide, s.open + PHYSICS.opening * dt);
      s.gap = s.base.gap + s.open;
      s.top = clamp(s.base.top - s.open / 2, 40, g.ground - 40 - s.gap);
    }
  }
  g.stacks = g.stacks.filter(s => s.x > -PHYSICS.stackWidth - 4);

  // Maelstrom gunfire, from the right.
  gunfire(g, dt);
  for (const b of g.bullets) {
    b.x -= (g.speed + b.v) * PHYSICS.laserPace * dt;
    if (b.amp) {
      b.t += dt;
      b.y = b.y0 + Math.sin(b.t * 3) * b.amp;
    }
  }
  g.bullets = g.bullets.filter(b => b.x > -20);

  const { x, r } = PHYSICS.bird;
  for (const s of g.stacks) {
    if (!s.passed && s.x + PHYSICS.stackWidth < x - r) {
      s.passed = true;
      g.score++;
    }
    const overlapsX = x + r > s.x && x - r < s.x + PHYSICS.stackWidth;
    if (overlapsX && (g.y - r < s.top || g.y + r > s.top + s.gap)) g.over = "stack";
  }
  for (const b of g.bullets) if (Math.abs(b.x - x) < r + 6 && Math.abs(b.y - g.y) < r + 2) g.over = "shot";
  if (g.y + r >= g.ground) {
    g.y = g.ground - r;
    g.over = "ground";
  }
  if (g.y - r < 0) {
    g.y = r;
    g.vy = 0;
  }
  return g;
}

/* ---------------- Leaderboard ---------------- */

export const BOARD_SIZE = 10;
export const MAX_SCORE = 999;

/** Add a score: a character keeps only their best; a fake name is its own entry. Returns the new list. */
export function addScore(scores, entry) {
  const list = [...(scores ?? [])];
  if (entry.actorId) {
    const i = list.findIndex(s => s.actorId === entry.actorId);
    if (i >= 0) {
      if (list[i].score >= entry.score) return list;
      list.splice(i, 1);
    }
  }
  list.push(entry);
  return list.sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, 50);
}

/** The board as shown: the top entries, with ranks. */
export const topScores = (scores, n = BOARD_SIZE) => [...(scores ?? [])].sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, n).map((s, i) => ({ ...s, rank: i + 1 }));

/**
 * Where a score would land on the shown board: its rank, or 0 when it isn't the character's new best or
 * doesn't make the top BOARD_SIZE. Making the board is when the arcade asks for initials.
 */
export function boardRank(scores, actorId, score, ts = Date.now()) {
  const mark = { actorId, score, ts };
  const i = addScore(scores, mark).indexOf(mark);
  return i >= 0 && i < BOARD_SIZE ? i + 1 : 0;
}

/* ---------------- Initials, arcade style ---------------- */

/** What a slot cycles through. */
export const INITIAL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const validInitials = s => typeof s === "string" && new RegExp(`^[${INITIAL_CHARS}]{3}$`).test(s);

/** Initials from a name: the words' first letters, filled from the last word ("Claude Solo" → CSO). */
export function defaultInitials(name) {
  const words = String(name ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return "AAA";
  let out = words.slice(0, 3).map(w => w[0]).join("");
  const last = words[Math.min(words.length, 3) - 1];
  for (const ch of last.slice(1)) if (out.length < 3) out += ch;
  return out.padEnd(3, "A");
}

/** A slot's character `by` steps along INITIAL_CHARS (wrapping). */
export function cycleInitial(ch, by) {
  const n = INITIAL_CHARS.length;
  const i = Math.max(0, INITIAL_CHARS.indexOf(ch));
  return INITIAL_CHARS[(((i + by) % n) + n) % n];
}

/** Made-up arcade initials (the street's regulars). */
const HANDLES = [
  "ACE", "NEO", "RAT", "GNK", "ZAP", "BOZ", "VEX", "ZED", "JAX", "KIT", "DOC", "RIP", "FOX", "NIX", "RAZ", "TYG", "VOO", "HEX",
  "BIT", "SKY", "MOX", "AFK", "LOL", "CHR", "DIV", "NCP", "WAT", "PAC", "SAM", "DED", "OWO", "ZIG", "MAX", "FLY", "COO", "BRD"
];

/** Made-up entries for the board: [{ name, score }]. */
export function randomEntries(n, rand = Math.random, taken = []) {
  const names = HANDLES.filter(h => !taken.includes(h));
  const out = [];
  for (let i = 0; i < n && names.length; i++) {
    const [name] = names.splice(Math.floor(rand() * names.length), 1);
    out.push({ name, score: Math.round(3 + rand() ** 2 * 55) });
  }
  return out;
}

/*
 * BREACH: Breach Protocol from Cyberpunk 2077, on the Agent (the screen) with a cyberdeck (doing the work).
 *
 * The GM sets up Breach Points (DV, grid size, daemons: each a name, a sequence length and the outcome the GM
 * wrote for it). A character either gets one sent by the GM, or asks for one that's near them (the GM approves).
 * Then the sheet's own Backdoor roll (the cyberdeck's Interface ability): under the DV is locked out, no grid at
 * all; over it, how far over sizes the buffer, and Interface rank sets the time. The grid comes from a seed the
 * host makes, and the host checks every pick. The timer runs in real time from the first pick, as in 2077.
 * Whatever gets uploaded goes to the GM on a chat card; nothing applies itself. "Just roll it" settles a
 * successful breach without playing the grid. Practice grids are for anyone (no deck, no stakes), any time, even in combat.
 *
 * The rules of the grid, as 2077's:
 *  - the first pick is from the top row; then picks alternate: the column of the last pick, then its row, ...
 *  - a cell can be picked once; each pick goes into the buffer
 *  - a daemon is uploaded when its sequence appears, in order and unbroken, anywhere in the buffer
 *  - it ends when the buffer is full, the time runs out, every daemon is uploaded or out of reach, nothing on
 *    the line is left to pick, or the runner jacks out
 *
 * Fair grids: the daemons' sequences are laid end to end along a hidden path that follows those rules from the
 * top row, so all of them fit in a buffer as long as all their sequences, and the first daemon (the GM's main
 * one) always fits in the smallest buffer.
 *
 * Breach Point (app table breachPoints, owner "listed"):
 *   { id, name, dv, size, daemons: [{ id, name, len }], effects: { [daemonId]: text } (the GM's only),
 *     everyone, actorIds: [], anchor?, range?, single, used, ts }
 * Breach (app table breaches, owner "actorId"):
 *   { id, actorId, pointId, name, dv, size, daemons, via: "gm"|"ask",
 *     status: "asked"|"approved"|"denied"|"locked"|"ready"|"running"|"done",
 *     roll?: { total, detail }, buffer?, timeMs?, seed?, startedAt?, pausedAt?, pausedMs?, picks: [cell],
 *     result?: { uploaded: [daemonId], failed: [daemonId], why, mode: "grid"|"roll" }, ts, time, date }
 */

/** The codes in the matrix, as 2077's. */
export const SYMBOLS = ["1C", "55", "7A", "BD", "E9", "FF"];
/** Grid sizes the GM can pick (5 × 5 to 7 × 7). */
export const SIZES = [5, 6, 7];
/** A daemon's sequence length. */
export const DAEMON_LEN = { min: 2, max: 4, default: 3 };
/** Daemons on one Breach Point. */
export const MAX_DAEMONS = 4;
/** Buffer slots. */
export const BUFFER = { min: 4, max: 8 };
/** A practice grid: no stakes, fixed size. */
export const PRACTICE = { size: 6, buffer: 6, seconds: 45, lens: [2, 3, 4] };
/** Picks still counted this long after the time ran out (the trip to the host). */
export const GRACE_MS = 1500;

/** Starting points for the GM's daemons (RED's Net Actions); the GM rewrites the outcome. */
export const DAEMON_PRESETS = {
  backdoor: { name: "Backdoor", len: 2, effect: "Opens the password, door or lock behind this point." },
  control: { name: "Control", len: 3, effect: "Takes over a camera, turret or drone here until the runner lets go." },
  eyedee: { name: "Eye-Dee", len: 3, effect: "Reveals a file (hand it over as a journal or a note on their phone)." },
  paydata: { name: "Paydata", len: 4, effect: "Eddies for the runner (pay them through BangMe!)." },
  virus: { name: "Virus", len: 4, effect: "Leaves a Virus behind (say what it does)." },
  datamine: { name: "Datamine", len: 3, effect: "Free text: what the runner digs up." }
};

/** Why a breach ended, as the runner reads it. */
export const ENDINGS = {
  buffer: "Buffer full",
  time: "Breach time ran out",
  all: "Every daemon uploaded",
  out: "Nothing left in reach",
  stuck: "No codes left on the line",
  jackout: "Jacked out",
  gm: "Cut off",
  roll: "Settled on the roll"
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback);

/** A seeded random generator (mulberry32): the same seed, the same grid, on every client and the host. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Buffer slots for beating the DV by `margin`: 4, one more for every 2 over, 8 at most. */
export const bufferFor = margin => clamp(BUFFER.min + Math.floor(Math.max(0, int(margin)) / 2), BUFFER.min, BUFFER.max);

/** Breach time for an Interface rank: 20 seconds, 5 more a rank (rank 10: 70 s). */
export const secondsFor = rank => 20 + 5 * clamp(int(rank), 0, 10);

/** A grid size the GM may pick. */
export const cleanSize = size => (SIZES.includes(int(size)) ? int(size) : 6);
export const cleanLen = len => clamp(int(len, DAEMON_LEN.default), DAEMON_LEN.min, DAEMON_LEN.max);

/* ---------------- The grid ---------------- */

/** Row and column of a cell index. */
export const rowOf = (grid, cell) => Math.floor(cell / grid.size);
export const colOf = (grid, cell) => cell % grid.size;

/**
 * The line the next pick comes from, after `picks`: { row } or { col }. The first is the top row; then the
 * column of the last pick, then its row, and so on.
 */
export function lineAfter(grid, picks) {
  if (!picks.length) return { row: 0 };
  const last = picks.at(-1);
  return picks.length % 2 ? { col: colOf(grid, last) } : { row: rowOf(grid, last) };
}

const onLine = (grid, line, cell) => ("row" in line ? rowOf(grid, cell) === line.row : colOf(grid, cell) === line.col);

/** The cells that may be picked next. */
export function openCells(grid, picks) {
  const line = lineAfter(grid, picks);
  const used = new Set(picks);
  const out = [];
  for (let cell = 0; cell < grid.size * grid.size; cell++) if (!used.has(cell) && onLine(grid, line, cell)) out.push(cell);
  return out;
}

export const canPick = (grid, picks, cell, buffer) =>
  Number.isInteger(cell) && picks.length < buffer && !picks.includes(cell) && cell >= 0 && cell < grid.size * grid.size && onLine(grid, lineAfter(grid, picks), cell);

/**
 * A random path that follows the picking rules from the top row, `length` cells long, no cell twice.
 * Tries again (with the same generator) when it walks into a corner; null if it never finds one.
 */
function randomPath(size, length, rand) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = { size };
    const path = [];
    while (path.length < length) {
      const options = openCells(grid, path);
      if (!options.length) break;
      path.push(options[Math.floor(rand() * options.length)]);
    }
    if (path.length === length) return path;
  }
  return null;
}

/**
 * Build a grid from its seed: { size, cells: [symbol], daemons: [[symbol]], path }. `lens`: each daemon's
 * sequence length, the GM's order (the first is the main one). The same arguments always build the same grid.
 */
export function buildGrid({ seed, size, lens }) {
  size = cleanSize(size);
  lens = (lens ?? []).map(cleanLen).slice(0, MAX_DAEMONS);
  const rand = seeded(seed);
  const pick = () => SYMBOLS[Math.floor(rand() * SYMBOLS.length)];
  const daemons = lens.map(len => Array.from({ length: len }, pick));
  const cells = Array.from({ length: size * size }, pick);
  const solution = daemons.flat();
  const path = randomPath(size, solution.length, rand) ?? [];
  path.forEach((cell, i) => (cells[cell] = solution[i]));
  return { size, cells, daemons, path };
}

/** The codes in the buffer. */
export const bufferCodes = (grid, picks) => picks.map(cell => grid.cells[cell]);

/** Does `seq` appear, in order and unbroken, in `codes`? */
function contains(codes, seq) {
  outer: for (let i = 0; i + seq.length <= codes.length; i++) {
    for (let j = 0; j < seq.length; j++) if (codes[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

/** How much of `seq` the end of `codes` already holds (0 to seq.length − 1). */
function progressOf(codes, seq) {
  for (let k = Math.min(seq.length - 1, codes.length); k > 0; k--) {
    let ok = true;
    for (let j = 0; j < k && ok; j++) ok = codes[codes.length - k + j] === seq[j];
    if (ok) return k;
  }
  return 0;
}

/**
 * Each daemon now: [{ state: "done"|"open"|"failed", progress }]. progress: how many of its codes the end of the
 * buffer already holds (it lights up as it fills). Failed: the buffer has no room left to finish it.
 */
export function daemonStates(grid, picks, buffer) {
  const codes = bufferCodes(grid, picks);
  const room = buffer - picks.length;
  return grid.daemons.map(seq => {
    if (contains(codes, seq)) return { state: "done", progress: seq.length };
    const progress = progressOf(codes, seq);
    return { state: seq.length - progress > room ? "failed" : "open", progress };
  });
}

/** Is the breach over on the grid? Returns why ("buffer", "all", "out", "stuck"), or null while it goes on. */
export function gridEnd(grid, picks, buffer) {
  const states = daemonStates(grid, picks, buffer);
  if (states.every(s => s.state === "done")) return "all";
  if (picks.length >= buffer) return "buffer";
  if (states.every(s => s.state !== "open")) return "out";
  if (!openCells(grid, picks).length) return "stuck";
  return null;
}

/**
 * What a run uploaded: { uploaded: [daemon index], failed: [daemon index] }. Played or not, every daemon is
 * one or the other at the end.
 */
export function outcome(grid, picks, buffer) {
  const states = daemonStates(grid, picks, buffer);
  const uploaded = [];
  const failed = [];
  states.forEach((s, i) => (s.state === "done" ? uploaded : failed).push(i));
  return { uploaded, failed };
}

/**
 * "Just roll it": the daemons a plain run gets without playing, the GM's order while their sequences fit the
 * buffer end to end (the grid always has that path). The first daemon always fits.
 */
export function rollOutcome(lens, buffer) {
  const uploaded = [];
  const failed = [];
  let used = 0;
  lens.forEach((len, i) => {
    if (uploaded.length === i && used + len <= buffer) {
      used += len;
      uploaded.push(i);
    } else failed.push(i);
  });
  return { uploaded, failed };
}

/* ---------------- The clock ---------------- */

/**
 * Milliseconds left on a run at `now` (server time). Before the first pick the time hasn't started; a pause
 * stops it. The GM's extra time and trace spikes are already in `timeMs`.
 */
export function timeLeft(run, now) {
  if (!run?.timeMs) return 0;
  if (!run.startedAt) return run.timeMs;
  const end = run.pausedAt ?? now;
  return Math.max(0, run.timeMs - (end - run.startedAt - (run.pausedMs ?? 0)));
}

/** "0:42" from milliseconds. */
export function clockText(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------------- Breach Points ---------------- */

/** A Breach Point as the GM saved it, made safe: names, numbers in range, effects only for its daemons. */
export function cleanPoint(point, { clean = s => String(s ?? "").trim(), randomID } = {}) {
  const daemons = (Array.isArray(point?.daemons) ? point.daemons : []).slice(0, MAX_DAEMONS).map(d => ({
    id: String(d?.id || randomID()), name: clean(d?.name, 40) || "Daemon", len: cleanLen(d?.len)
  }));
  const effects = Object.fromEntries(daemons.map(d => [d.id, clean(point?.effects?.[d.id], 600)]));
  return {
    id: String(point?.id || randomID()),
    name: clean(point?.name, 60) || "Breach Point",
    dv: clamp(int(point?.dv, 13), 0, 40),
    size: cleanSize(point?.size),
    daemons: daemons.length ? daemons : [{ id: randomID(), name: "Backdoor", len: 2 }],
    effects,
    everyone: point?.everyone !== false,
    actorIds: Array.isArray(point?.actorIds) ? point.actorIds.map(String).slice(0, 50) : [],
    anchor: point?.anchor ?? null,
    range: point?.range > 0 ? Math.min(1000, Number(point.range)) : null,
    single: !!point?.single,
    used: !!point?.used,
    ts: Number(point?.ts) || Date.now()
  };
}

/** May this character see a Breach Point in their list? */
export const pointFor = (point, actorId) => !!point && !point.used && (point.everyone || point.actorIds?.includes(actorId));

/** The statuses of a breach that's still going (one at a time per character). */
export const ACTIVE = new Set(["asked", "approved", "ready", "running"]);

/* ---------------- The character ---------------- */

/** The character's equipped cyberdeck, or null. */
export const cyberdeckOf = actor => [...(actor?.items ?? [])].find(i => i.type === "cyberdeck" && i.system?.equipped === "equipped") ?? null;

/** The character's net role (Netrunner) item, if it has a rank. */
export function netRoleOf(actor) {
  const id = actor?.system?.roleInfo?.activeNetRole;
  const role = [...(actor?.items ?? [])].find(i => i.type === "role" && i.id === id);
  return role && int(role.system?.rank) > 0 ? role : null;
}

/** Interface rank (0 without a net role). */
export const interfaceRank = actor => int(netRoleOf(actor)?.system?.rank);

/** Can this character run a real breach? { ok, why }. A cyberdeck, equipped, and Interface. */
export function canBreach(actor) {
  if (!cyberdeckOf(actor)) return { ok: false, why: "You need an equipped cyberdeck to breach. The Agent is only the screen." };
  if (!netRoleOf(actor)) return { ok: false, why: "You need Interface (a Netrunner role rank) to breach for real. Practice grids are open to anyone." };
  return { ok: true, why: "" };
}

/** A practice grid: a fresh seed, three daemons, fixed buffer and time. */
export function practiceRun(seed = newSeed()) {
  return {
    practice: true, seed, size: PRACTICE.size, buffer: PRACTICE.buffer, timeMs: PRACTICE.seconds * 1000,
    daemons: PRACTICE.lens.map((len, i) => ({ id: `p${i}`, name: ["Datamine V1", "Datamine V2", "Datamine V3"][i], len })),
    picks: [], status: "ready", startedAt: null, pausedAt: null, pausedMs: 0
  };
}

/** A run's grid (cached per seed by the caller if it likes; building is cheap). */
export const gridOf = run => buildGrid({ seed: run.seed, size: run.size, lens: run.daemons.map(d => d.len) });

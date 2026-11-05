/*
 * Digital Gladiator (Segotari, 20eb; Black Chrome p. 12): build a Gladiator in the app, challenge another Agent, fight
 * one encounter to the death. The loser's Agent is fried; an Internal Agent loser also takes the Brain Injury.
 * This file: the Gladiator build and its rules (Complete Package, CP:R p. 78; Solo Combat Awareness, p. 145).
 * The duel itself is battle.js. Gear and skills come from the CPR system's compendiums at runtime (catalogue.js),
 * so this file only knows their shapes.
 *
 * Build (host table gladiators, one per character):
 *   { actorId, name, look: { colour, frame }, stats: { int, ref, ... }, skills: { [skill name]: level },
 *     awareness: { deflection, fumble, initiative, precision, spot, threat }, gear: [GearEntry], updatedAt }
 * GearEntry: { uuid, name, kind: weapon|armor|cyberware|ammo|item, price, qty, explosive?, humanity?,
 *   weapon?: { skill, damage, rof, magazine, dv, autofire, ranged, type, ammo },
 *   armor?: { body, head, penalty }, ammo?: { type, rounds }, effect?: "speedheal"|"stim" }
 */

import { tokenDistance } from "../bangme/model.js";

export const GLADIATOR = "gladiator";
export const FROM = "Digital Gladiator";
export const PUBLISHER = "Segotari";

export const STATS = ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"];
export const STAT_POINTS = 62;
export const STAT_MIN = 2;
export const STAT_MAX = 8;
export const SKILL_POINTS = 86;
export const SKILL_MAX = 6;
export const BASIC_MIN = 2;
export const BUDGET = 2550;
/** Solo, Rank 4: Combat Awareness points. */
export const AWARENESS_POINTS = 4;

/**
 * Combat Awareness abilities: points per level, highest level. Fumble Recovery is all or nothing (4 points).
 * Threat Detection only helps Perception, which the arena never rolls: it's there so a build can be true to the book.
 */
export const AWARENESS = {
  deflection: { label: "Damage Deflection", cost: 2, max: 5 },
  fumble: { label: "Fumble Recovery", cost: 4, max: 1 },
  initiative: { label: "Initiative Reaction", cost: 1, max: 10 },
  precision: { label: "Precision Attack", cost: 3, max: 3 },
  spot: { label: "Spot Weakness", cost: 1, max: 10 },
  threat: { label: "Threat Detection", cost: 1, max: 10 }
};

/** The fighter shapes the arena draws, and the colours a player can pick. */
export const FRAMES = ["street", "heavy", "blade", "runner"];
export const COLOURS = ["#ff3c6e", "#29e3ff", "#ffd23f", "#8cff4a", "#c86bff", "#ff8c32"];

/** Weapon types that are explosives (Black Chrome: "except explosives"). */
const EXPLOSIVE_TYPES = new Set(["grenadeLauncher", "rocketLauncher"]);
const EXPLOSIVE_NAME = /grenade|rocket|explosive|missile|mine\b|c-?6|demolition/i;

/** Is this gear an explosive? Grenades, grenade and rocket launchers, explosive ammo. */
export const isExplosive = gear => !!gear.explosive || EXPLOSIVE_TYPES.has(gear.weapon?.type) || EXPLOSIVE_NAME.test(gear.name ?? "");

export const emptyBuild = actorId => ({
  actorId,
  name: "",
  look: { colour: COLOURS[0], frame: FRAMES[0] },
  stats: Object.fromEntries(STATS.map(s => [s, STAT_MIN])),
  skills: {},
  awareness: Object.fromEntries(Object.keys(AWARENESS).map(k => [k, 0])),
  gear: []
});

const num = v => Math.max(0, Math.floor(Number(v) || 0));

/** STAT points spent. */
export const statPoints = build => STATS.reduce((sum, s) => sum + num(build.stats?.[s]), 0);

/** Skill points spent: (x2) skills cost 2 per level. `skills` = the system's skill list: [{ name, x2, basic }]. */
export function skillPoints(build, skills) {
  const x2 = new Set(skills.filter(s => s.x2).map(s => s.name));
  return Object.entries(build.skills ?? {}).reduce((sum, [name, level]) => sum + num(level) * (x2.has(name) ? 2 : 1), 0);
}

export const awarenessPoints = build => Object.entries(AWARENESS).reduce((sum, [k, a]) => sum + num(build.awareness?.[k]) * a.cost, 0);

export const gearCost = build => (build.gear ?? []).reduce((sum, g) => sum + num(g.price) * Math.max(1, num(g.qty)), 0);

export const humanityLoss = build => (build.gear ?? []).reduce((sum, g) => sum + num(g.humanity) * Math.max(1, num(g.qty)), 0);

/** HP, wound threshold, Death Save and Humanity (CP:R pp. 79-80). */
export function derived(build) {
  const stat = s => num(build.stats?.[s]);
  const hp = 10 + 5 * Math.ceil((stat("body") + stat("will")) / 2);
  return { hp, serious: Math.ceil(hp / 2), deathSave: stat("body"), humanity: stat("emp") * 10 - humanityLoss(build) };
}

/** Everything left to spend, for the builder's counters. */
export const budgets = (build, skills) => ({
  stats: STAT_POINTS - statPoints(build),
  skills: SKILL_POINTS - skillPoints(build, skills),
  awareness: AWARENESS_POINTS - awarenessPoints(build),
  eb: BUDGET - gearCost(build)
});

/**
 * What's wrong with a build, as sentences for the player; empty = a legal Gladiator. Spending less than the budgets is
 * allowed (it's only weaker). `skills` = the system's skill list: [{ name, x2, basic }].
 */
export function gladiatorProblems(build, skills) {
  const problems = [];
  if (!String(build.name ?? "").trim()) problems.push("Give your Gladiator a name.");
  for (const s of STATS) {
    const v = Number(build.stats?.[s]);
    if (!(v >= STAT_MIN && v <= STAT_MAX)) problems.push(`${s.toUpperCase()} must be ${STAT_MIN} to ${STAT_MAX}.`);
  }
  if (statPoints(build) > STAT_POINTS) problems.push(`${statPoints(build)} STAT points spent; the limit is ${STAT_POINTS}.`);
  const known = new Set(skills.map(s => s.name));
  for (const [name, level] of Object.entries(build.skills ?? {})) {
    if (!known.has(name)) problems.push(`Unknown skill: ${name}.`);
    else if (num(level) > SKILL_MAX) problems.push(`${name} can't be above ${SKILL_MAX}.`);
  }
  for (const s of skills.filter(k => k.basic)) {
    if (num(build.skills?.[s.name]) < BASIC_MIN) problems.push(`${s.name} must be at least ${BASIC_MIN}.`);
  }
  if (skillPoints(build, skills) > SKILL_POINTS) problems.push(`${skillPoints(build, skills)} skill points spent; the limit is ${SKILL_POINTS}.`);
  for (const [k, a] of Object.entries(AWARENESS)) {
    if (num(build.awareness?.[k]) > a.max) problems.push(`${a.label} can't be above ${a.max}.`);
  }
  if (awarenessPoints(build) > AWARENESS_POINTS) problems.push(`${awarenessPoints(build)} Combat Awareness points spent; a Rank 4 Solo has ${AWARENESS_POINTS}.`);
  for (const g of (build.gear ?? []).filter(isExplosive)) problems.push(`No explosives: ${g.name}.`);
  if (gearCost(build) > BUDGET) problems.push(`${gearCost(build)}eb of gear; the budget is ${BUDGET}eb.`);
  if ((build.gear ?? []).filter(g => g.armor?.body > 0 && g.kind === "armor").length > 1) problems.push("Only one body armor.");
  if ((build.gear ?? []).filter(g => g.armor?.head > 0 && g.kind === "armor").length > 1) problems.push("Only one head armor.");
  if (derived(build).humanity <= 0) problems.push("Humanity must stay above 0: less cyberware, or more EMP.");
  return problems;
}

/** A build trimmed to what the host keeps: no stray fields, numbers as numbers. */
export function cleanBuild(build, actorId) {
  const base = emptyBuild(actorId);
  return {
    actorId,
    name: String(build?.name ?? "").trim().slice(0, 40),
    look: {
      colour: COLOURS.includes(build?.look?.colour) ? build.look.colour : base.look.colour,
      frame: FRAMES.includes(build?.look?.frame) ? build.look.frame : base.look.frame
    },
    stats: Object.fromEntries(STATS.map(s => [s, num(build?.stats?.[s]) || STAT_MIN])),
    skills: Object.fromEntries(Object.entries(build?.skills ?? {}).map(([k, v]) => [String(k), num(v)]).filter(([, v]) => v > 0)),
    awareness: Object.fromEntries(Object.keys(AWARENESS).map(k => [k, num(build?.awareness?.[k])])),
    gear: (Array.isArray(build?.gear) ? build.gear : []).slice(0, 40).map(g => ({ ...g, qty: Math.max(1, num(g.qty)), price: num(g.price) }))
  };
}

/*
 * Matches (host table gladiatorMatches, seen by everyone so nearby phones can watch):
 *   { id, everyone, status, mode, a: Side, b: Side, ts, winner?, loser?, how?, battle?, draw: [actorId], doneAt? }
 * Side: { actorId, userId, name (the Gladiator's), wager }. `a` challenged `b`.
 * status: pending (b hasn't answered) → declined | withdrawn, or accepted (both wagers held; the GM picks the mode)
 *   → live (mode gm: the GM declares; mode play: the duel) → done (winner, loser, how: gm|kill|concede) | off (called
 *   off: wagers back, nothing fried). `a`'s wager is held when the challenge is sent, `b`'s when they accept.
 */

export const MATCH_STATUS = {
  pending: "Waiting for an answer", accepted: "Waiting for the GM", live: "Live", done: "Over",
  declined: "Declined", withdrawn: "Withdrawn", off: "Called off"
};
export const OPEN_STATUSES = new Set(["pending", "accepted", "live"]);
export const SETTLE_MODES = { ask: "Ask each match", gm: "Always GM choice", play: "Always gameplay" };
/** Finished matches kept. */
export const KEEP_MATCHES = 20;
export const MAX_WAGER = 1_000_000;

/** A character's matches, newest first. */
export const matchesOf = (matches, actorId) => Object.values(matches ?? {})
  .filter(m => m.a.actorId === actorId || m.b.actorId === actorId).sort((x, y) => y.ts - x.ts);

/** The match a character is in right now (pending, accepted or live), or null. */
export const openMatchOf = (matches, actorId) => matchesOf(matches, actorId).find(m => OPEN_STATUSES.has(m.status)) ?? null;

/** Which side a character is on: "a", "b" or null. */
export const sideOf = (match, actorId) => match.a.actorId === actorId ? "a" : match.b.actorId === actorId ? "b" : null;

/** Everything held for a match: both wagers once accepted, the challenger's before. */
export const potOf = match => match.a.wager + (match.status === "pending" ? 0 : match.b.wager);

/** A wager as a whole, non-negative number of eb, or null if it isn't one. */
export function wagerOf(value) {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= MAX_WAGER ? n : null;
}

/**
 * Why a challenge can't be sent, or null. `builds`: the gladiators table; `wealth`: the challenger's eb, null when they
 * have no wallet (then the wager moves no money, as everywhere in the module).
 */
export function challengeProblem({ actorId, opponentId, opponentName, builds, matches, wager, wealth }) {
  if (!opponentId || opponentId === actorId) return "Pick someone to challenge.";
  const mine = builds?.[actorId];
  if (!mine) return "Build your Gladiator first.";
  if (mine.problems?.length) return `Your Gladiator can't fight yet: ${mine.problems[0]}`;
  const theirs = builds?.[opponentId];
  if (!theirs || theirs.problems?.length) return `${opponentName} has no Gladiator ready to fight.`;
  if (openMatchOf(matches, actorId)) return "You're already in a match.";
  if (openMatchOf(matches, opponentId)) return `${opponentName} is already in a match.`;
  if (wagerOf(wager) === null) return "The wager has to be a whole number of eb.";
  if (wealth !== null && wealth < wager) return "You can't cover that wager.";
  return null;
}

/** How near (m/yd, the scene's units) a character's token has to be to a duelist's to watch the duel. */
export const SPECTATE_RANGE = 20;

/**
 * Can a character watch a duel? Their token and either duelist's token on `scene` (a scene, or plain
 * { grid, tokens }), within SPECTATE_RANGE. `watcher`: an actorId; `duelists`: the two sides' actorIds.
 */
export function canWatch({ watcher, duelists, scene }) {
  const tokens = id => scene?.tokens?.filter(t => t.actorId === id) ?? [];
  const mine = tokens(watcher);
  return duelists.some(id => tokens(id).some(t => mine.some(m => tokenDistance(m, t, scene) <= SPECTATE_RANGE)));
}

/** Finished matches beyond the newest KEEP_MATCHES: their ids, to drop. */
export const oldMatches = matches => Object.values(matches ?? {}).filter(m => !OPEN_STATUSES.has(m.status))
  .sort((x, y) => y.ts - x.ts).slice(KEEP_MATCHES).map(m => m.id);

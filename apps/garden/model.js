import { MODULE_ID } from "../../scripts/config.js";
import { agentTimestamp, worldClock } from "../../scripts/util/agentTime.js";
import { emptyWriter, REACTION_MOODS } from "./writer.js";

/*
 * The Garden (Ziggurat; All About Agents p. 8): "Grants the user access to Garden content. Users with
 * Garden accounts can also comment, post, and edit their own content." Everyone can read it; posting
 * takes an account (a "Garden Patch"). Its accounts are its own list, not anyone's contacts, so the GM
 * can fill the city with people and news networks.
 *
 * Kept by the host in its own files (see model/storage.js):
 * {
 *   accounts: { [id]: { id, handle, name, avatar, bio, kind, verified, followers, mood?, actorId?, npc? } }
 *     kind: see KINDS. actorId: a player's character's own account. npc: an NPC name, for the GM.
 *   posts: { [id]: Post }
 *   queue: [{ id, accountId, text, image, tier, rep?, wt, realAt?, stir? }]   posts waiting to go out (GM) at Garden time wt
 *     (or real ms realAt, whichever comes first: Stir's chatter); rep as on posts
 *   paused: wt|null                                           when the queue was paused (Garden time)
 *   clock: { mode, wt, ts }   the Garden clock last seen by the host (see syncGardenClock)
 *   writer, happenings, seeds, seen; account.writer, account.corp: the writer's side, GM-only (apps/garden/writer.js)
 *   dating: {
 *     profiles: { [id]: { id, accountId?, actorId?, handle, name, avatar, age, prompts: [3], npc? } }
 *     sparks: { [id]: { id, actorId, profileId, status, ts, date?: { where, when } } }
 *       status: "searching" (the Algorithm) → "suggested" (the GM picked someone) → "matched" | "passed";
 *       matched → "invited" (asked out) → "accepted" | "declined"
 *   }
 * }
 * Post: { id, accountId, text, image, ts, wt, tier, reach, likes, grafts, replies: [{ id, accountId, text, ts, wt, auto? }],
 *   likedBy: [accountId], graftedBy: [accountId], rep?: [{ actorId, delta, reason }] (one per character),
 *   eng: { likes, grafts, replies, mix } (where the counts are heading; see engagement()) }
 * Likes are "sprouts" and shares are "grafts".
 * Times: `wt` is Garden time (gardenNow(), seconds), when it happened in the story: the feed sorts and
 * dates by it. `ts` is the real time (ms) it went up: growth on real minutes and the monthly files.
 */

export const emptyGarden = () => ({
  accounts: {}, posts: {}, queue: [], paused: null, clock: null, dating: { profiles: {}, sparks: {} },
  // The writer's side (apps/garden/writer.js), GM-only.
  writer: emptyWriter(), happenings: {}, seeds: {}, seen: {}
});

/* -------------------------------------------- */
/*  The Garden clock                             */
/* -------------------------------------------- */

/**
 * The Garden runs on the phones' clock: world time (`game.time.worldTime`, moved by Simple Calendar
 * or SmallTime) when the clock follows the world, else the real clock. "world" or "real".
 */
export const gardenClockMode = () => (worldClock() ? "world" : "real");

/** Garden "now", in seconds: world time, or real seconds since 1970. */
export const gardenNow = (mode = gardenClockMode()) => (mode === "world" ? Number(game.time?.worldTime) || 0 : Date.now() / 1000);

/** How long a post needs in Garden time compared with real time: a tier's peak × 10 in-game minutes. */
export const WORLD_PACE = 10;

/**
 * Bring a Garden's times onto the clock: posts, replies and queue items from before the Garden clock
 * get a `wt` (as old as they really are; queued ones as far ahead), and when the clock changes mode
 * (Simple Calendar switched on or off, Control's clock source) every time moves so the newest stays
 * where it was. Returns whether anything changed (save then).
 */
export function syncGardenClock(garden, mode, now, nowMs = Date.now()) {
  let changed = false;
  const last = garden.clock;
  // The old queue and pause were real ms.
  if (!last) {
    for (const q of garden.queue ?? []) if (q.wt === undefined && Number.isFinite(q.at)) [q.wt, changed] = [now + (q.at - nowMs) / 1000, true];
    if (garden.paused > 1e11) {
      garden.paused = now - (nowMs - garden.paused) / 1000;
      changed = true;
    }
  }
  for (const q of garden.queue ?? []) {
    if (!("at" in q)) continue;
    delete q.at;
    changed = true;
  }
  for (const post of Object.values(garden.posts ?? {})) {
    const back = item => {
      if (item.wt === undefined) [item.wt, changed] = [now - (nowMs - (Number(item.ts) || nowMs)) / 1000, true];
    };
    back(post);
    for (const r of post.replies ?? []) back(r);
  }
  if (last && last.mode !== mode) {
    // Where the old clock is now: the real one has run on since; world time stood where it was last seen.
    const before = last.mode === "real" ? last.wt + (nowMs - last.ts) / 1000 : last.wt;
    shiftGarden(garden, now - before);
    changed = true;
  }
  garden.clock = { mode, wt: now, ts: nowMs };
  return changed;
}

/** Move every Garden time by `seconds`. */
export function shiftGarden(garden, seconds) {
  for (const post of Object.values(garden.posts ?? {})) {
    post.wt += seconds;
    for (const r of post.replies ?? []) r.wt += seconds;
  }
  for (const q of garden.queue ?? []) q.wt += seconds;
  if (garden.paused) garden.paused += seconds;
}

/**
 * How far along a post is (0–1): whichever is further, its Garden age (peak × WORLD_PACE in-game
 * minutes) or the real minutes since it went up (so posts grow at the table while the clock stands
 * still).
 */
export function postGrowth(post, now, nowMs = Date.now()) {
  const peak = post.eng?.peak ?? 5;
  const world = growth((now - post.wt) / 60 / WORLD_PACE, peak);
  const real = growth((nowMs - post.ts) / 60_000, peak);
  return Math.max(world, real);
}

/** Whether a post has stopped growing on both clocks (the host stops ticking it). */
export function postSettled(post, now, nowMs = Date.now()) {
  const live = liveMinutes(post.eng?.peak) + 1;
  return (nowMs - post.ts) / 60_000 > live && (now - post.wt) / 60 / WORLD_PACE > live;
}

/**
 * When an automatic reply happened: at the point in the post's life where it had grown to
 * `fraction` (on Garden time), but never after `now`.
 */
export function replyTime(post, fraction, now) {
  const peak = post.eng?.peak ?? 5;
  const k = peak / 2.5;
  const start = 1 / (1 + Math.exp(peak / k));
  const f = Math.min(0.98, Math.max(0, fraction));
  const level = start + f * (1 - start);
  const minutes = Math.max(0, peak - k * Math.log(1 / level - 1));
  return Math.min(now, post.wt + minutes * 60 * WORLD_PACE);
}

/** Newest first: by Garden time, then by when they really went up. */
export const byNewest = (a, b) => b.wt - a.wt || b.ts - a.ts;

/** "3h", "2d" style length of a span in seconds. */
export function spanLabel(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${s % 3600 >= 60 ? ` ${Math.floor((s % 3600) / 60)}m` : ""}`;
  return `${Math.floor(s / 86400)}d${s % 86400 >= 3600 ? ` ${Math.floor((s % 86400) / 3600)}h` : ""}`;
}

/**
 * A Garden time as the phones' clock shows it: "Spring, Day 7, 21:40" (the year only when it isn't
 * this year's); "Day 14, 21:40" when the clock has no date (SmallTime).
 */
export function gardenWhen(wt, now = gardenNow()) {
  const at = agentTimestamp(wt);
  if (!at.date) return `Day ${Math.floor(wt / 86400)}, ${at.time}`;
  const year = d => d?.slice(d.lastIndexOf(", ") + 2);
  const cur = agentTimestamp(now).date;
  const date = cur && year(cur) === year(at.date) ? at.date.slice(0, at.date.lastIndexOf(", ")) : at.date;
  return `${date}, ${at.time}`;
}

/** A post's or reply's age: "now", "40m", "3h"; from a day on, its in-world date. */
export function gardenAgo(wt, now = gardenNow()) {
  const s = now - wt;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return gardenWhen(wt, now);
}

/** A queued post's time: "Spring, Day 15, 08:10 · in 3h". */
export function queueWhen(wt, now = gardenNow(), paused = null) {
  const when = gardenWhen(wt, now);
  if (paused) return `${when} · paused`;
  return wt <= now ? `${when} · due` : `${when} · in ${spanLabel(wt - now)}`;
}

export const KINDS = {
  citizen: "Citizen",
  news: "News",
  corp: "Corporation",
  gang: "Gang",
  fixer: "Fixer",
  celebrity: "Celebrity",
  pc: "Edgerunner",
  crew: "Crew"
};

/**
 * Outcome types: how far a post travels and how fast. The GM edits them (Garden → Control), and can
 * add their own. reach: × the author's followers who see it; replies: [fewest, most] from citizens;
 * peak: real minutes until it's halfway to its final numbers (mostly done by twice that; on Garden
 * time ten times as long, see postGrowth); weight: how
 * often a random post gets it.
 */
export const DEFAULT_TIERS = {
  flop: { name: "Flop", reach: 0.05, replies: [0, 1], peak: 3, weight: 2 },
  normal: { name: "Normal", reach: 0.2, replies: [1, 3], peak: 5, weight: 4 },
  hot: { name: "Hot", reach: 0.6, replies: [3, 6], peak: 6, weight: 2 },
  viral: { name: "Viral", reach: 2, replies: [6, 12], peak: 8, weight: 1 },
  explosive: { name: "Explosive", reach: 6, replies: [10, 20], peak: 10, weight: 1 }
};

/**
 * The GM's Garden settings (world setting "gardenConfig"): { tiers, files, mergeNews, dating } over
 * the defaults. files: list key → the GM's own text file for it (see LIST_FILES). mergeNews: news
 * networks' posts are in the Feed, with no News tab. dating: The Garden Dating is on (the default).
 */
export function gardenConfig() {
  const saved = game.settings.get(MODULE_ID, "gardenConfig") ?? {};
  const tiers = saved.tiers && Object.keys(saved.tiers).length ? saved.tiers : DEFAULT_TIERS;
  return {
    tiers: foundry.utils.deepClone(tiers), files: { ...(saved.files ?? {}) },
    mergeNews: !!saved.mergeNews, dating: saved.dating !== false
  };
}

export const gardenTiers = () => gardenConfig().tiers;

/** A random outcome, by weight. */
export function randomTier(tiers = gardenTiers(), rand = Math.random) {
  const weights = Object.fromEntries(Object.entries(tiers).map(([id, t]) => [id, Math.max(0, Number(t.weight) || 0)]));
  return pickWeighted(weights, rand);
}

/**
 * Where a post's numbers are heading: reach is the author's followers times the tier (at least a
 * few people see anything), likes a share of that, grafts fewer, replies from the tier's range.
 */
export function engagement(followers, tier, rand = Math.random, tiers = gardenTiers()) {
  const t = tiers[tier] ?? Object.values(tiers)[0] ?? DEFAULT_TIERS.normal;
  const reach = Math.max(12, Math.round((followers || 50) * t.reach * (0.7 + rand() * 0.6)));
  const [lo, hi] = t.replies;
  return {
    reach,
    likes: Math.round(reach * (0.08 + rand() * 0.07)),
    grafts: Math.round(reach * (0.01 + rand() * 0.02)),
    replies: lo + Math.floor(rand() * (hi - lo + 1)),
    peak: Math.max(0.5, Number(t.peak) || 5)
  };
}

/**
 * How far along a post is (0–1) after `minutes`: quick at first, then slowing (a logistic curve),
 * halfway at `peak` minutes.
 */
export function growth(minutes, peak = 5) {
  if (minutes <= 0) return 0;
  const k = peak / 2.5;
  const g = 1 / (1 + Math.exp(-(minutes - peak) / k));
  const start = 1 / (1 + Math.exp(peak / k));
  return Math.min(1, (g - start) / (1 - start));
}

/** For the GM: what an outcome means in play. */
export function tierSummary(t) {
  const sprouts = Math.round(1000 * t.reach * 0.115);
  return `~${sprouts.toLocaleString()} sprouts per 1,000 followers · ${t.replies[0]}–${t.replies[1]} replies · mostly within ${Math.round(t.peak * 2)} min`;
}

/** Minutes a post keeps gaining (the host stops ticking it after this): four times its peak. */
export const liveMinutes = peak => Math.max(10, (peak ?? 5) * 4);

/**
 * Followers a character's Patch has, from the sheet's Reputation (0–10): the Garden follows the
 * street's opinion of them.
 */
const REP_FOLLOWERS = [40, 150, 400, 900, 2000, 5000, 12000, 30000, 80000, 200000, 500000];
/** A post's Reputation events, one per character (older posts kept a single one). */
export const repsOf = item => (Array.isArray(item?.rep) ? item.rep : item?.rep ? [item.rep] : []);

export const followersForRep = rep => REP_FOLLOWERS[Math.max(0, Math.min(10, Math.floor(Number(rep) || 0)))];

export const reputationOf = actor => Number(actor?.system?.reputation?.value ?? 0) || 0;

/** "@chromekitty_nc" from any name. */
export function handleFrom(name) {
  const slug = String(name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `@${slug.slice(0, 24) || "user"}`;
}

export const cleanHandle = handle => handleFrom(String(handle ?? "").replace(/^@/, ""));

/* -------------------------------------------- */
/*  Random people                                */
/* -------------------------------------------- */

/** The moods of random citizens (their bios and replies). "pr" replies are corporations answering. */
/** A dating spark that's a match ("invited", "accepted", "declined": from before matches were texted). */
export const MATCHED = ["matched", "invited", "accepted", "declined"];

export const MOODS = ["hype", "hater", "bot", "conspiracy", "lurker"];

/**
 * An account's attitude: the mood its automatic replies come in. Any NPC account with one joins in
 * replying to posts (random citizens get one when they're made); without one, it never replies on
 * its own. The GM sets it on the account.
 */
export const ATTITUDES = { hype: "Hype", hater: "Hater", bot: "Bot", conspiracy: "Conspiracy", lurker: "Lurker", pr: "Corporate PR" };
const cap = w => w[0].toUpperCase() + w.slice(1);

/**
 * Everything the Garden makes up comes from text files, one entry per line ("#" lines are notes):
 * names, handles, bios and replies by mood, dating prompts, and who replies to what. The defaults are
 * in the module (data/garden/); the GM can point any of them at their own file (Garden → Control),
 * saved in gardenConfig.files. key → [file name, label].
 */
export const LIST_FILES = {
  firstNames: ["first-names", "First names"],
  firstNamesF: ["first-names-female", "First names (woman's face)"],
  firstNamesM: ["first-names-male", "First names (man's face)"],
  lastNames: ["last-names", "Last names"],
  handleStarts: ["handle-starts", "Handles: first part"],
  handleEnds: ["handle-ends", "Handles: second part"],
  handlePlaces: ["handle-places", "Handles: after the _"],
  ...Object.fromEntries(MOODS.map(m => [`bio${cap(m)}`, [`bios-${m}`, `Bios: ${m}`]])),
  ...Object.fromEntries([...MOODS, "pr"].map(m => [`reply${cap(m)}`, [`replies-${m}`, `Replies: ${m}`]])),
  ...Object.fromEntries(REACTION_MOODS.map(m => [`reactions${cap(m)}`, [`reactions-${m}`, `Stir reactions: ${m}`]])),
  prompts: ["dating-prompts", "Dating prompts"],
  mixes: ["who-replies", "Who replies to what"]
};

/** The built-in file for a list. */
export const defaultListPath = key => `modules/${MODULE_ID}/data/garden/${LIST_FILES[key][0]}.txt`;

/** A list file's text → its entries. */
export const parseList = text => String(text ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));

let LISTS = {};

/** Read every list (the GM's file where there is one, else the built-in one). Used by the host and GMs. */
export async function loadGardenLists() {
  const files = gardenConfig().files;
  const read = async path => {
    const response = await fetch(`${foundry.utils.getRoute(path)}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseList(await response.text());
  };
  const out = {};
  for (const key of Object.keys(LIST_FILES)) {
    try {
      out[key] = await read(files[key] || defaultListPath(key));
    } catch (err) {
      console.warn(`${MODULE_ID} | Garden list ${key}: couldn't read ${files[key] || defaultListPath(key)}`, err);
      out[key] = files[key] ? await read(defaultListPath(key)).catch(() => []) : [];
    }
  }
  LISTS = out;
  return out;
}

/** Set the lists directly (tests). */
export const setGardenLists = lists => (LISTS = lists);

/** The lists as loaded (empty ones until loadGardenLists has run). */
export const gardenLists = () => LISTS;

const pick = (list, rand = Math.random) => list[Math.floor(rand() * list.length)];

function pickWeighted(weights, rand = Math.random) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [key, w] of Object.entries(weights)) if ((r -= w) < 0) return key;
  return Object.keys(weights)[0];
}

/**
 * Who replies to what: lines "kind: mood weight, mood weight" → { kind: { mood: weight } }.
 * "default" is any kind without its own line.
 */
export function parseMixes(lines) {
  const out = {};
  for (const line of lines ?? []) {
    const [kind, rest] = String(line).split(":");
    if (!rest) continue;
    const weights = {};
    for (const part of rest.split(",")) {
      const [mood, w] = part.trim().split(/\s+/);
      if (mood && Number(w) > 0) weights[mood.toLowerCase()] = Number(w);
    }
    if (Object.keys(weights).length) out[kind.trim().toLowerCase()] = weights;
  }
  return out;
}

export function replyMix(kind, lists = gardenLists()) {
  const mixes = parseMixes(lists.mixes);
  return mixes[kind] ?? mixes.default ?? { hype: 1, lurker: 1 };
}

/** A reply line in a mood. */
/**
 * A citizen's reply in their mood. `used`: lines already in the thread, which aren't said again; null
 * when their mood has nothing new left to say there.
 */
export function replyLine(mood, rand = Math.random, lists = gardenLists(), used = []) {
  const list = lists[`reply${cap(mood)}`]?.length ? lists[`reply${cap(mood)}`] : lists.replyLurker?.length ? lists.replyLurker : ["👀"];
  const fresh = list.filter(line => !used.includes(line));
  return fresh.length ? pick(fresh, rand) : null;
}

/** Pick a mood from a mix, e.g. replyMix("corp"). */
export const pickMood = (mix, rand = Math.random) => pickWeighted(mix, rand);

/**
 * The gender of a picture from the module's own citizen pool (assets/garden-avatars/citizens/NN.ext):
 * "f", "m", or null for anything else (the GM's own pictures), which has no gender data.
 */
export function avatarGender(path) {
  const n = /garden-avatars\/citizens\/(\d+)\.[a-z]+$/i.exec(String(path ?? ""))?.[1];
  if (!n) return null;
  const num = Number(n);
  if (num >= 1 && num <= 20) return "f";
  if (num >= 21 && num <= 36) return "m";
  if (num >= 37 && num <= 39) return "f";
  if (num === 40) return "m";
  return null;
}

/** A random citizen: a street handle and a real name, a mood and a bio. `avatars`: pictures to pick from. */
export function randomCitizen(avatars = [], rand = Math.random, lists = gardenLists()) {
  const mood = pick(MOODS, rand);
  const part = (list, fallback) => (list?.length ? pick(list, rand) : fallback);
  const avatar = avatars.length ? pick(avatars, rand) : null;
  const gendered = { f: lists.firstNamesF, m: lists.firstNamesM }[avatarGender(avatar)];
  const name = `${part(gendered?.length ? gendered : lists.firstNames, "Someone")} ${part(lists.lastNames, "")}`.trim();
  const handle = `@${part(lists.handleStarts, "user")}${part(lists.handleEnds, String(Math.floor(rand() * 1e4)))}_${part(lists.handlePlaces, "nc")}`;
  return {
    handle,
    name,
    avatar,
    bio: part(lists[`bio${cap(mood)}`], ""),
    kind: "citizen",
    mood,
    verified: false,
    followers: Math.round(20 + rand() * rand() * 3000)
  };
}

/** Three different dating prompts. */
export function randomPrompts(rand = Math.random, lists = gardenLists()) {
  const list = [...(lists.prompts ?? [])];
  return [0, 1, 2].map(() => list.splice(Math.floor(rand() * list.length), 1)[0]).filter(Boolean);
}

/** The accounts a new Garden starts with: news networks and the platform itself. The GM can edit them. */
export const SEED_ACCOUNTS = [
  { handle: "@network54", name: "Network 54", kind: "news", verified: true, followers: 4200000, bio: "News. Weather. Traffic. Tragedy. 24/7." },
  { handle: "@wns", name: "WNS · World News Service", kind: "news", verified: true, followers: 9800000, bio: "The world, as it happens." },
  { handle: "@ncpd_alerts", name: "NCPD Alerts", kind: "news", verified: true, followers: 610000, bio: "Official alerts from the Night City Police Department. Not monitored." },
  { handle: "@ziggurat_trends", name: "Ziggurat Trends", kind: "corp", verified: true, followers: 2500000, bio: "What Night City is talking about. 🌱 Grow your Patch." }
];

/* -------------------------------------------- */
/*  What players see                             */
/* -------------------------------------------- */

const PLAYER_POSTS = 100;

/**
 * The Garden as a user sees it: GMs everything; players no queue or citizens' moods, and of the
 * dating side only NPC profiles, their own, and their own sparks.
 */
export function gardenFor(user, garden) {
  if (user.isGM) return garden;
  const owns = actorId => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");
  // "npc" stays: it's who Message reaches (the GM set it for that).
  const accounts = Object.fromEntries(Object.entries(garden.accounts).map(([id, a]) => [id, { ...a, mood: undefined, writer: undefined, corp: undefined }]));
  const profiles = Object.fromEntries(Object.entries(garden.dating.profiles).filter(([, p]) => !p.actorId || owns(p.actorId)));
  const sparks = Object.fromEntries(Object.entries(garden.dating.sparks).filter(([, s]) => owns(s.actorId)));
  // The newest posts are enough for a phone (it's pushed often, while posts are growing).
  const posts = Object.fromEntries(Object.values(garden.posts).sort(byNewest).slice(0, PLAYER_POSTS).map(p => [p.id, p]));
  return { accounts, posts, queue: [], paused: null, clock: garden.clock, dating: { profiles, sparks }, writer: emptyWriter(), happenings: {}, seeds: {}, seen: {} };
}

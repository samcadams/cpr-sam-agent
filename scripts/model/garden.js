import { MODULE_ID } from "../config.js";

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
 *   queue: [{ id, accountId, text, image, tier, rep?, at (real ms) }]   posts waiting to go out (GM); rep as on posts
 *   paused: ms|null                                                     when the queue was paused
 *   dating: {
 *     profiles: { [id]: { id, accountId?, actorId?, handle, name, avatar, age, prompts: [3], npc? } }
 *     sparks: { [id]: { id, actorId, profileId, status, ts, date?: { where, when } } }
 *       status: "searching" (the Algorithm) → "suggested" (the GM picked someone) → "matched" | "passed";
 *       matched → "invited" (asked out) → "accepted" | "declined"
 *   }
 * }
 * Post: { id, accountId, text, image, ts, tier, reach, likes, grafts, replies: [{ id, accountId, text, ts }],
 *   likedBy: [accountId], graftedBy: [accountId], rep?: [{ actorId, delta, reason }] (one per character),
 *   eng: { likes, grafts, replies, mix } (where the counts are heading; see engagement()) }
 * Likes are "sprouts" and shares are "grafts".
 */

export const emptyGarden = () => ({ accounts: {}, posts: {}, queue: [], paused: null, dating: { profiles: {}, sparks: {} } });

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
 * peak: minutes until it's halfway to its final numbers (mostly done by twice that); weight: how
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
  lastNames: ["last-names", "Last names"],
  handleStarts: ["handle-starts", "Handles: first part"],
  handleEnds: ["handle-ends", "Handles: second part"],
  handlePlaces: ["handle-places", "Handles: after the _"],
  ...Object.fromEntries(MOODS.map(m => [`bio${cap(m)}`, [`bios-${m}`, `Bios: ${m}`]])),
  ...Object.fromEntries([...MOODS, "pr"].map(m => [`reply${cap(m)}`, [`replies-${m}`, `Replies: ${m}`]])),
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

/** A random citizen: a street handle and a real name, a mood and a bio. `avatars`: pictures to pick from. */
export function randomCitizen(avatars = [], rand = Math.random, lists = gardenLists()) {
  const mood = pick(MOODS, rand);
  const part = (list, fallback) => (list?.length ? pick(list, rand) : fallback);
  const name = `${part(lists.firstNames, "Someone")} ${part(lists.lastNames, "")}`.trim();
  const handle = `@${part(lists.handleStarts, "user")}${part(lists.handleEnds, String(Math.floor(rand() * 1e4)))}_${part(lists.handlePlaces, "nc")}`;
  return {
    handle,
    name,
    avatar: avatars.length ? pick(avatars, rand) : null,
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
  const accounts = Object.fromEntries(Object.entries(garden.accounts).map(([id, a]) => [id, { ...a, mood: undefined }]));
  const profiles = Object.fromEntries(Object.entries(garden.dating.profiles).filter(([, p]) => !p.actorId || owns(p.actorId)));
  const sparks = Object.fromEntries(Object.entries(garden.dating.sparks).filter(([, s]) => owns(s.actorId)));
  // The newest posts are enough for a phone (it's pushed often, while posts are growing).
  const posts = Object.fromEntries(Object.values(garden.posts).sort((a, b) => b.ts - a.ts).slice(0, PLAYER_POSTS).map(p => [p.id, p]));
  return { accounts, posts, queue: [], paused: null, dating: { profiles, sparks } };
}

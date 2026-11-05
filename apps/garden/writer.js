/*
 * The Garden's writer side (plan: handoff GARDEN-LIFE-PROPOSAL-2026-10-22 §3–8): what the garden-writer
 * skill reads, and what the GM sets up for it. Plain data and rules, unit-tested in Node.
 *
 * Kept in the Garden's data (garden.json), GM-only (gardenFor leaves it all out for players):
 *   account.writer: WriterProfile          any account that posts (cast, corps, news, gangs...)
 *   account.corp:   { tier, face, assets, relations: [{ actorId, kind, note }], calendar: [{ id, wt, what }] }
 *   garden.writer:  { pcs: { [actorId]: WriterProfile }, ignore: [actorId], formats: [Format], feeds: { [app]: Feed }, mix }
 *     ignore: players' characters the GM took off the writer's list (test actors...): not in the
 *     Writer tab, the pack or Log an event's Who (writerCharacters)
 *   garden.happenings: { [id]: Happening }   what the GM logged ("Log an event")
 *   garden.seeds:      { [id]: Seed }        what the GM wants the city to start talking about
 *   garden.seen:       { [actorId]: { wt, ts } }   when each character last opened the Garden
 *
 * WriterProfile: { keywords, voice, agenda, reacts, cadence, avoid, ties, arc, lines }
 *   The GM types keywords; the skill fills voice, agenda, reacts (and the GM edits). arc and lines are the
 *   cast's: their storyline in a line, and their own auto-replies (the tick uses them first).
 * Happening: { id, wt, ts, place, what, who: [actorId], heat, public, keywords, direction, stage }
 * Seed: { id, ts, what, keywords, obvious, by: wt|null, sources: [accountId], stage }
 * Format: { id, accountId, when, what }   a recurring post the skill fills ("daily 07:00", "weekly Thu 20:00", "after violent nights")
 * Feed: { on, keywords, accounts: [accountId] }   an app whose facts go into the writer pack
 */

export const CADENCES = { daily: "Daily", often: "Often", sometimes: "Sometimes", rarely: "Rarely", "when-relevant": "When relevant" };
export const HEATS = { small: "Small", local: "Local", big: "Big", citywide: "Citywide" };
export const STAGES = { new: "New", developing: "Developing", cooling: "Cooling", closed: "Closed" };
export const SEED_STAGES = { new: "New", planted: "Planted", done: "Done" };
export const OBVIOUS = { subtle: "Subtle", clear: "Clear" };
export const CORP_TIERS = { megacorp: "Megacorp", local: "Local" };
export const RELATIONS = { employer: "Employer", rival: "Rival", client: "Client", target: "Target" };
/** The plan's mix: City, Close to home, About them (percent). */
export const DEFAULT_MIX = { city: 45, close: 35, about: 20 };

/** The apps whose facts can go into the writer pack (Garden → Writer → Feeds). */
export const FEED_APPS = {
  weather: "Weather",
  ncpd: "NCPD",
  roach: "Roach Race",
  market: "Great River",
  cbk: "CBK",
  trauma: "Trauma Team",
  cabb: "Combat Cabb"
};

/** Stir: how many reactions a happening's heat gets [fewest, most]. */
export const STIR_COUNT = { small: [1, 2], local: [3, 5], big: [5, 8], citywide: [8, 12] };

export const emptyWriter = () => ({ pcs: {}, ignore: [], formats: [], feeds: {}, mix: { ...DEFAULT_MIX } });

/**
 * The characters the writer works with: the players' characters (owned by or assigned to a player)
 * but the ones the GM took off the list (garden.writer.ignore). `actors`: [{ id, ... }].
 */
export function writerCharacters(actors, writer) {
  const ignore = new Set(writer?.ignore ?? []);
  return [...actors].filter(a => !ignore.has(a.id));
}

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const text = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);

/** "watson, Kabuki,  noodles" or a list → ["watson", "kabuki", "noodles"] (lowercase, unique, at most `max`). */
export function keywordList(value, max = 30) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]/);
  const out = [];
  for (const part of parts) {
    const k = str(part, 40).toLowerCase().replace(/^#/, "");
    if (k && !out.includes(k)) out.push(k);
  }
  return out.slice(0, max);
}

/** Lines of text → list (one per line, empty ones dropped). */
export const lineList = (value, max = 40, len = 200) =>
  (Array.isArray(value) ? value : String(value ?? "").split(/\r?\n|\s\|\s/)).map(l => str(l, len)).filter(Boolean).slice(0, max);

/** A writer profile from anything (the GM's form, the skill's changes); unknown fields dropped. */
export function cleanProfile(p = {}) {
  return {
    keywords: keywordList(p.keywords),
    voice: text(p.voice, 600),
    agenda: text(p.agenda, 600),
    reacts: keywordList(p.reacts),
    cadence: p.cadence in CADENCES ? p.cadence : "sometimes",
    avoid: text(p.avoid, 400),
    ties: keywordList(p.ties),
    arc: text(p.arc, 300),
    lines: lineList(p.lines, 30, 200)
  };
}

/** Whether a profile has anything in it. */
export const hasProfile = p => !!p && (p.keywords?.length || p.voice || p.agenda || p.arc || p.lines?.length || p.reacts?.length);

/**
 * A corporation's extra fields. `actorIds` (name or id → actor id) resolves relations' characters;
 * calendar entries keep their Garden time (wt).
 */
export function cleanCorp(c = {}, resolveActor = id => id) {
  const relations = (Array.isArray(c.relations) ? c.relations : [])
    .map(r => ({ actorId: resolveActor(r.actorId ?? r.actor), kind: r.kind in RELATIONS ? r.kind : "client", note: str(r.note, 200) }))
    .filter(r => r.actorId).slice(0, 20);
  const calendar = (Array.isArray(c.calendar) ? c.calendar : [])
    .map(e => ({ id: e.id || randomId(), wt: Number(e.wt), what: str(e.what, 200) }))
    .filter(e => Number.isFinite(e.wt) && e.what).sort((a, b) => a.wt - b.wt).slice(0, 30);
  return { tier: c.tier in CORP_TIERS ? c.tier : "local", face: str(c.face, 200), assets: keywordList(c.assets), relations, calendar };
}

const randomId = () => Math.random().toString(36).slice(2, 12);

/* ---------------- Times typed as spans ("+4d 2h", "-3h", "90m") ---------------- */

/** "+1d4h20m", "4d 2h", "-3h", "90m", "2h30" → seconds (null if it doesn't parse). */
export function parseSpan(value) {
  const s = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const m = /^([+-]?)((?:\d+(?:\.\d+)?[dhm])+|\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  if (/^\d/.test(m[2]) && !/[dhm]/.test(m[2])) return sign * Number(m[2]) * 60; // bare number: minutes
  let total = 0;
  for (const [, n, unit] of m[2].matchAll(/(\d+(?:\.\d+)?)([dhm])/g)) total += Number(n) * { d: 86400, h: 3600, m: 60 }[unit];
  return sign * total;
}

/** Seconds → "+4d2h", "-3h", "+0m" (whole minutes). */
export function spanText(seconds) {
  const sign = seconds < 0 ? "-" : "+";
  let s = Math.round(Math.abs(seconds) / 60);
  const d = Math.floor(s / 1440);
  s -= d * 1440;
  const h = Math.floor(s / 60);
  const m = s - h * 60;
  return `${sign}${d ? `${d}d` : ""}${h ? `${h}h` : ""}${m || (!d && !h) ? `${m}m` : ""}`;
}

/* ---------------- Formats ---------------- */

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * A format's "when": "daily 07:00", "weekly thu 20:00", "after violent nights" → { every, day?, time? },
 * or null if it doesn't read.
 */
export function parseWhen(value) {
  const s = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (/^after violent nights?$/.test(s)) return { every: "violent" };
  const time = t => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? t.padStart(5, "0") : null);
  let m = /^daily (\S+)$/.exec(s);
  if (m && time(m[1])) return { every: "daily", time: time(m[1]) };
  m = /^weekly (\w+) (\S+)$/.exec(s);
  const day = m && WEEKDAYS.find(d => m[1].startsWith(d));
  if (day && time(m[2])) return { every: "weekly", day, time: time(m[2]) };
  return null;
}

/** A when back as text: "daily 07:00", "weekly Thu 20:00", "after violent nights". */
export function whenText(when) {
  if (!when) return "";
  if (when.every === "violent") return "after violent nights";
  if (when.every === "daily") return `daily ${when.time}`;
  return `weekly ${when.day[0].toUpperCase()}${when.day.slice(1)} ${when.time}`;
}

export function cleanFormat(f = {}, accounts = {}) {
  const when = parseWhen(f.when);
  if (!when || !accounts[f.accountId]) return null;
  return { id: f.id || randomId(), accountId: f.accountId, when: whenText(when), what: str(f.what, 300) };
}

/* ---------------- Happenings and seeds ---------------- */

export function cleanHappening(h = {}, { now, actorIds = () => true } = {}) {
  const what = str(h.what, 200);
  if (!what) return null;
  return {
    id: h.id || randomId(),
    wt: Number.isFinite(Number(h.wt)) && h.wt !== null && h.wt !== "" ? Number(h.wt) : now,
    ts: Number(h.ts) || Date.now(),
    place: str(h.place, 80),
    what,
    who: (Array.isArray(h.who) ? h.who : []).filter(id => actorIds(id)).slice(0, 12),
    heat: h.heat in HEATS ? h.heat : "local",
    public: h.public !== false,
    keywords: keywordList(h.keywords, 12),
    direction: text(h.direction, 400),
    stage: h.stage in STAGES ? h.stage : "new"
  };
}

export function cleanSeed(s = {}, { accounts = {} } = {}) {
  const what = str(s.what, 200);
  if (!what) return null;
  const by = Number(s.by);
  return {
    id: s.id || randomId(),
    ts: Number(s.ts) || Date.now(),
    what,
    keywords: keywordList(s.keywords, 12),
    obvious: s.obvious in OBVIOUS ? s.obvious : "subtle",
    by: s.by !== null && s.by !== "" && s.by !== undefined && Number.isFinite(by) ? by : null,
    sources: (Array.isArray(s.sources) ? s.sources : []).filter(id => accounts[id]).slice(0, 8),
    stage: s.stage in SEED_STAGES ? s.stage : "new"
  };
}

/* ---------------- Keywords: suggestions and matches ---------------- */

const STOP = new Set(("the a an and or but of in on at to for from with by as is was were be been it its this that these those there their they them " +
  "he she his her him we our you your i me my who what when where why how not no yes into onto over under after before about just than then " +
  "some any all one two three out up down off again got get gets have has had do does did will would can could should may might").split(" "));

/** Words worth keeping from a line: lowercase, 3+ letters, no filler. */
export const wordsOf = value => (String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).map(w => w.replace(/'s$/, "")).filter(w => !STOP.has(w));

/**
 * Keywords for a happening or seed: the place, the characters involved, then words of the text the
 * Garden already knows (someone's keywords), then the rest of the text's words. `known`: every
 * keyword in use; `names`: the characters'. At most `max`.
 */
export function suggestKeywords({ what = "", place = "", names = [], known = [] }, max = 8) {
  const out = [];
  const add = k => {
    k = str(k, 40).toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  };
  if (place) add(place);
  for (const n of names) add(n);
  const knownSet = new Set(known.map(k => k.toLowerCase()));
  const lower = String(what).toLowerCase();
  // Known keywords first, phrases too ("tyger claws").
  for (const k of knownSet) if (k.length > 2 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) add(k);
  for (const w of wordsOf(what)) add(w);
  return out.slice(0, max);
}

/** Every keyword the Garden knows: accounts' profiles (keywords and reacts), corps' assets, PCs'. */
export function knownKeywords(garden) {
  const out = new Set();
  for (const a of Object.values(garden.accounts ?? {})) {
    for (const k of [...(a.writer?.keywords ?? []), ...(a.writer?.reacts ?? []), ...(a.corp?.assets ?? [])]) out.add(k);
  }
  for (const p of Object.values(garden.writer?.pcs ?? {})) for (const k of p.keywords ?? []) out.add(k);
  return [...out];
}

/** How well a set of keywords fits an account: shared keywords and reacts (a phrase inside a keyword counts too). */
export function fitScore(keywords, account) {
  const mine = [...(account.writer?.keywords ?? []), ...(account.writer?.reacts ?? []), ...(account.corp?.assets ?? [])];
  if (!mine.length || !keywords.length) return 0;
  let score = 0;
  for (const k of keywords) {
    if (mine.includes(k)) score += 2;
    else if (mine.some(m => m.includes(k) || k.includes(m))) score += 1;
  }
  return score;
}

/** The accounts whose keywords fit, best first: [{ account, score }] (characters' own accounts left out). */
export function matchAccounts(keywords, accounts) {
  return Object.values(accounts).filter(a => !a.actorId).map(account => ({ account, score: fitScore(keywords, account) }))
    .filter(m => m.score > 0).sort((a, b) => b.score - a.score || a.account.handle.localeCompare(b.account.handle));
}

/** The accounts Stir picks first for these keywords, best first (no characters' accounts, no "pc" kind). */
export const stirFits = (keywords, accounts) => matchAccounts(keywords, accounts).map(m => m.account).filter(a => a.kind !== "pc");

/**
 * What Stir would do with these keywords (typed, as in the pop-up's field) and heat, for the GM to see
 * before saving: { fits: [handle] (at most as many as reactions), more (fitting accounts left over),
 * min, max (reactions by heat), text }. Same matching as stirPlan.
 */
export function stirPreview(keywords, accounts, heat = "local") {
  const [min, max] = STIR_COUNT[heat] ?? STIR_COUNT.local;
  const all = stirFits(keywordList(keywords, 12), accounts);
  const fits = all.slice(0, max).map(a => (String(a.handle).startsWith("@") ? a.handle : `@${a.handle}`));
  const n = fits.length;
  const text = !n
    ? "No account reacts to these words; Stir will use random citizens."
    : `Would stir: ${fits.join(", ")} (${n} account${n === 1 ? "" : "s"})${n < max ? `, then random citizens, ${min}–${max} reactions in all` : ""}.`;
  return { fits, more: all.length - n, min, max, text };
}

/**
 * The keywords the GM can pick from: every known keyword with the accounts it would stir (handles,
 * best first), the ones that stir someone first. [{ keyword, handles }]
 */
export function keywordChips(garden) {
  const accounts = garden.accounts ?? {};
  return knownKeywords(garden).map(keyword => ({ keyword, handles: stirFits([keyword], accounts).map(a => a.handle) }))
    .sort((a, b) => (b.handles.length > 0) - (a.handles.length > 0) || a.keyword.localeCompare(b.keyword));
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The known keywords that apply to an event or seed, from its context: what the GM typed, the place,
 * the scene's and its journal's names, and the profile keywords of the characters who were there.
 * Whole words (or phrases), any case. The place comes first (it's always one), then the known
 * keywords in the order they appear. `known`: knownKeywords(garden). At most `max`.
 */
export function contextKeywords({ what = "", place = "", context = [], pcKeywords: theirs = [] } = {}, known = [], max = 12) {
  const out = [];
  const add = k => {
    k = str(k, 40).toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  };
  if (place) add(place);
  const text = [what, place, ...context, ...theirs].map(s => String(s ?? "").toLowerCase()).join(" \n ");
  const found = [];
  for (const k of new Set(known.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 1))) {
    const m = new RegExp(`(^|[^a-z0-9])${escRe(k)}(?=$|[^a-z0-9])`).exec(text);
    if (m) found.push([m.index, k]);
  }
  for (const [, k] of found.sort((a, b) => a[0] - b[0] || b[1].length - a[1].length)) add(k);
  return out.slice(0, max);
}

/* ---------------- Stir ---------------- */

/** The reactions word lists, one per mood: reactions-<mood>.txt (with {place} and {thing}). */
export const REACTION_MOODS = ["hype", "hater", "bot", "conspiracy", "lurker"];

/** A reaction line with its blanks filled; lines needing a place are skipped when there's none. */
export function fillReaction(line, { place, thing }) {
  if (!place && line.includes("{place}")) return null;
  return line.replaceAll("{place}", place || "").replaceAll("{thing}", thing || "that").replace(/\s+/g, " ").trim();
}

/**
 * Stir now: instant chatter about a happening from the word lists. Who: accounts whose keywords fit
 * (best first, each once), then random citizens. How many: by heat. When: spread over the next
 * in-game hour (and the next real minutes, so it happens at the table while the clock stands still).
 * Returns [{ accountId|null (a random citizen), text, delay (in-game seconds), realDelay (ms) }].
 * `lists`: { reactions<Mood>: [...] }; `citizens`: accounts that can speak up at random.
 */
export function stirPlan(happening, { accounts, citizens, lists, rand = Math.random, thing = null }) {
  const [lo, hi] = STIR_COUNT[happening.heat] ?? STIR_COUNT.local;
  const count = lo + Math.floor(rand() * (hi - lo + 1));
  const fits = stirFits(happening.keywords, accounts);
  const pool = [...citizens];
  const used = new Set();
  const plan = [];
  const fill = { place: happening.place, thing: thing || happening.keywords.find(k => k !== happening.place?.toLowerCase()) || null };
  for (let i = 0; i < count; i++) {
    const account = fits[i] ?? (pool.length ? pool.splice(Math.floor(rand() * pool.length), 1)[0] : null);
    const mood = account?.mood && REACTION_MOODS.includes(account.mood) ? account.mood : REACTION_MOODS[Math.floor(rand() * REACTION_MOODS.length)];
    const own = (account?.writer?.lines ?? []).filter(l => l.includes("{place}") || l.includes("{thing}"));
    const list = [...own, ...(lists[`reactions${mood[0].toUpperCase()}${mood.slice(1)}`] ?? [])];
    const lines = list.map(l => fillReaction(l, fill)).filter(l => l && !used.has(l));
    if (!lines.length) continue;
    const line = lines[Math.floor(rand() * lines.length)];
    used.add(line);
    const f = (i + rand()) / count;
    plan.push({ accountId: account?.id ?? null, text: line, delay: Math.round(f * 3600), realDelay: Math.round(f * 4 * 60_000) });
  }
  return plan;
}

/* ---------------- Characters' profiles ---------------- */

/**
 * Keywords to start a character's profile from: their role, their HQ (cpr-hq), their cyberware's
 * names. `info`: { role, hq, cyberware: [names] } read from the actor by the caller.
 */
export const pcKeywords = ({ role, hq, cyberware = [] } = {}) => keywordList([role, hq, ...cyberware].filter(Boolean), 20);

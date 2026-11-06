import { inFolder, pageText, plainText } from "../alex/model.js";
import { newBlock, newSheet, OUTLETS, sheetText, summary } from "./render.js";

/*
 * DataPool (app id "screamsheet"): the Agent crawls the Data Pool for screamsheets about
 * its owner (their name, Garden handle, aliases, crew) and the terms they add, and brings back clippings
 * the GM approved. *
 * Every clipping has a depth, the DV a crawl needs to reach it (DEPTHS). The passive crawl (once per
 * in-world day and whenever the GM publishes) brings Headlines (DV 0) that match. A deep crawl is a
 * Library Search roll (with the Agent's bonus): every published, matching clipping up to the total, which the GM
 * confirms or changes ("the roll decides how much you find, the GM decides what's there").
 * Reach: "public" clippings reach anyone whose watchlist matches; "subjects" ones only their subjects and
 * the subjects' crews. A clipping about a crewmate matches the crew's name (players see clippings
 * about other crew PCs when the crew is on their watchlist).
 *
 * Tables (apps/screamsheet/app.js):
 *   screamClips (monthly, "listed")  { id, ts, status: "draft"|"scheduled"|"published", sheet, subjects: [actorId],
 *     tags: [..], dv, reach, spin, rep: [{ actorId, delta, reason }], source: { kind, ref, label }, title, notes,
 *     at (world time, scheduled), date/time (the world date it went out), pub (when, real time),
 *     everyone (a Front Page headline), actorIds (the characters who pulled it) }
 *   screamCrawls (keyed by actorId) { extra: [terms], aliases: [..], muted: [auto terms switched off], read: { clipId: 1 },
 *     day (last passive crawl's world day), last (its time), deep: { total, detail, status, ts, n }, found (GM only) }
 *     plus the desk's own row, "_desk": { day, garden (newest Garden post seen), rep: { actorId: { n, value } }, journal: [entry ids made into drafts] }
 */

export const DESK = "_desk";

export const DEPTHS = {
  0: { name: "Headline", hint: "On every kiosk. The daily crawl finds it." },
  13: { name: "Buried", hint: "Page 6, a comment thread, a blotter line." },
  15: { name: "Deep", hint: "A scrubbed article, an archive mirror, a board that's been taken down." },
  17: { name: "Ghost", hint: "Someone's working hard to keep it off the Pool." }
};
export const DVS = Object.keys(DEPTHS).map(Number);

/** The depth a DV falls in (17 and up are Ghosts). */
export const depthOf = dv => DEPTHS[[...DVS].reverse().find(d => (Number(dv) || 0) >= d) ?? 0];

export const SPINS = { accurate: "Accurate", sensational: "Sensational", corp: "Corp-friendly", hit: "Hit piece" };

export const REACHES = { public: "Everyone", subjects: "Subjects and their crew" };

export const SOURCES = { gm: "Desk", claude: "Claude", rep: "Reputation event", garden: "The Garden", journal: "Journal", api: "Macro" };

export const JOURNAL_FOLDER = "Screamsheets";

/** Lower case, words only, padded with spaces so a term matches whole words. */
export const norm = s => ` ${String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9@]+/g, " ").trim()} `;

const listOf = (v, max = 40) => (Array.isArray(v) ? v : String(v ?? "").split(","))
  .map(s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, max);

/** A list of terms without repeats (any case). */
export function uniqueTerms(list, max = 40) {
  const seen = new Set();
  return listOf(list, 1000).filter(t => {
    const k = norm(t);
    if (k.trim().length < 2 || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, max);
}

/**
 * A character's watchlist: [{ term, kind, auto, muted }]. Automatic (a tap mutes them): name, Garden
 * handle (and its name without the @), crews (HQ names). Added by the player in "Look for something"
 * (a tap drops them): aliases and other terms.
 */
export function watchTerms({ name, handle = null, crews = [], aliases = [], extra = [], muted = [] }) {
  const off = new Set(listOf(muted, 200).map(norm));
  const out = [];
  const add = (term, kind, auto) => {
    term = String(term ?? "").trim();
    if (term.replace(/^@/, "").length < 2 || out.some(t => norm(t.term) === norm(term))) return;
    out.push({ term, kind, auto, muted: auto && off.has(norm(term)) });
  };
  add(name, "name", true);
  if (handle) add(handle, "handle", true);
  for (const c of crews) add(c, "crew", true);
  for (const a of uniqueTerms(aliases)) add(a, "alias", false);
  for (const e of uniqueTerms(extra)) add(e, "extra", false);
  return out;
}

/** The terms a crawl searches for. */
export const activeTerms = list => list.filter(t => !t.muted).map(t => t.term);

/**
 * What a crawl reads on a clipping: the sheet's text, its tags, its subjects' names and their crews.
 * ctx: { names: { actorId: name }, crews: { actorId: [crew names] } }
 */
export function clipHaystack(clip, ctx = {}) {
  const subjects = clip.subjects ?? [];
  return norm([
    sheetText(clip.sheet), ...(clip.tags ?? []),
    ...subjects.map(id => ctx.names?.[id]), ...subjects.flatMap(id => ctx.crews?.[id] ?? [])
  ].filter(Boolean).join("\n"));
}

/** Does the clipping mention this character, or one of their terms? */
export function matches(clip, actorId, terms, ctx = {}) {
  if ((clip.subjects ?? []).includes(actorId)) return true;
  const hay = clipHaystack(clip, ctx);
  return terms.some(t => {
    const n = norm(t);
    if (n.trim().length < 2) return false;
    // "@handle" also matches the handle without its @ in a sheet's text.
    return hay.includes(n) || (n.startsWith(" @") && hay.includes(` ${n.slice(2)}`));
  });
}

/** May this character's crawl reach it at all? ctx.mates: { actorId: [crewmates' ids] } */
export function canReach(clip, actorId, ctx = {}) {
  if (clip.status !== "published") return false;
  if (clip.reach !== "subjects") return true;
  const subjects = clip.subjects ?? [];
  return subjects.includes(actorId) || subjects.some(id => (ctx.mates?.[actorId] ?? []).includes(id));
}

/**
 * The clippings a crawl brings back: published, reachable, matching, not pulled yet, and no deeper than
 * `total` (0: the passive crawl, Headlines only). Newest first.
 */
export function surfaced(clips, actorId, terms, total = 0, ctx = {}) {
  return Object.values(clips ?? {})
    .filter(c => c && !(c.actorIds ?? []).includes(actorId) && (Number(c.dv) || 0) <= total && canReach(c, actorId, ctx) && matches(c, actorId, terms, ctx))
    .sort((a, b) => (b.pub ?? b.ts ?? 0) - (a.pub ?? a.ts ?? 0));
}

/** Who sees a clipping (table "listed" rows): everyone for a public Headline, else those who pulled it. */
export const isFrontPage = clip => clip.status === "published" && clip.reach !== "subjects" && !(Number(clip.dv) > 0);

/* -------------------------------------------- */
/*  Clippings                                   */
/* -------------------------------------------- */

const clampDv = dv => Math.max(0, Math.min(30, Math.floor(Number(dv) || 0)));

/** A clipping's own fields from what the GM (or a macro) sent; the sheet is cleaned separately. */
export function clipFields(raw = {}, actorExists = () => true) {
  const subjects = [...new Set(Array.isArray(raw.subjects) ? raw.subjects : [])].filter(id => typeof id === "string" && actorExists(id)).slice(0, 20);
  const rep = (Array.isArray(raw.rep) ? raw.rep : [])
    .map(r => ({ actorId: r?.actorId, delta: Math.max(-10, Math.min(10, Math.trunc(Number(r?.delta) || 0))), reason: String(r?.reason ?? "").slice(0, 120) }))
    .filter(r => r.delta && subjects.includes(r.actorId));
  return {
    subjects,
    tags: uniqueTerms(raw.tags, 20),
    dv: clampDv(raw.dv),
    reach: raw.reach === "subjects" ? "subjects" : "public",
    spin: raw.spin in SPINS ? raw.spin : "accurate",
    rep,
    title: String(raw.title ?? "").slice(0, 120),
    notes: String(raw.notes ?? "").slice(0, 2000)
  };
}

/** The list row the phone and the desk draw for a clipping. */
export function clipRow(clip) {
  const s = summary(clip.sheet);
  const depth = depthOf(clip.dv);
  return { id: clip.id, ...s, outletKey: clip.sheet?.outlet, dv: Number(clip.dv) || 0, depth: depth.name, date: clip.date ?? "", time: clip.time ?? "" };
}

/** A sheet from plain text: a headline, an optional byline, the text as paragraphs. */
export function plainSheet({ outlet = "street", headline, byline = "", text = "", image = "" }) {
  const blocks = [newBlock("headline", { text: String(headline ?? "").slice(0, 300) })];
  if (byline) blocks.push(newBlock("byline", { author: byline, dateline: "Night City" }));
  if (image) blocks.push(newBlock("image", { src: image, caption: "", place: "inline" }));
  const body = String(text ?? "").trim();
  if (body) blocks.push(newBlock("paragraph", { text: body }));
  return newSheet(OUTLETS[outlet] ? outlet : "street", blocks);
}

/** How deep a Reputation event's story is: bigger events are on every kiosk. */
export const repDepth = delta => (Math.abs(delta) >= 3 ? 0 : Math.abs(delta) === 2 ? 13 : 15);

/** A suggested clipping for a Reputation event on a character's sheet (made automatically). */
export function repSuggestion({ actorId, name, delta, reason }) {
  const up = delta > 0;
  const headline = up ? `WHO'S ${String(name).toUpperCase()}?` : `${String(name).toUpperCase()}: FALLEN STAR?`;
  const text = reason
    ? `${up ? "Eyewitnesses describe" : "Word on the street:"} ${reason.replace(/\.$/, "")}. ${up ? "The name's going round the kiosks." : "Not everyone's impressed."}`
    : `${up ? "The name's going round the kiosks." : "Nobody's buying the story anymore."}`;
  return {
    sheet: plainSheet({ outlet: "street", headline, byline: "Street desk", text }),
    subjects: [actorId], tags: [], dv: repDepth(delta), reach: "public", spin: "sensational", rep: [],
    title: `Rep ${up ? "+" : ""}${delta}: ${name}`, notes: reason ? `Reputation event: ${reason}` : "Reputation event",
    source: { kind: "rep", ref: actorId, label: `${name} ${up ? "+" : ""}${delta}` }
  };
}

/** The Garden tiers whose posts get picked up as news. */
export const PICKUP_TIERS = new Set(["viral", "explosive"]);

/** An "As seen on The Garden" pickup of a viral post. */
export function gardenSuggestion(post, account) {
  const subjects = [account?.actorId, ...(Array.isArray(post.rep) ? post.rep : post.rep ? [post.rep] : []).map(r => r?.actorId)].filter(Boolean);
  const quote = String(post.text ?? "").trim();
  return {
    sheet: plainSheet({
      outlet: "board", headline: `AS SEEN ON THE GARDEN: ${account?.handle ?? "a post"} goes ${post.tier === "explosive" ? "nuclear" : "viral"}`,
      byline: "reposted by poolrat_77", text: `${quote}\n\nEveryone's grafting it. Thoughts?`, image: post.image ?? ""
    }),
    subjects: [...new Set(subjects)], tags: [account?.handle].filter(Boolean), dv: 0, reach: "public", spin: "sensational", rep: [],
    title: `Garden pickup: ${account?.handle ?? ""}`, notes: "",
    source: { kind: "garden", ref: post.id, label: account?.handle ?? "The Garden" }
  };
}

/* -------------------------------------------- */
/*  Journal entries as a source                 */
/* -------------------------------------------- */

const LINE = /^[ \t]*screamsheet[ \t]*:(.*)$\n?/gim;

/**
 * "Screamsheet: n54, DV 13, subjects: Name, Name" (or tags: a, b). Everything after "subjects:"/"tags:"
 * up to the other one is that list; the outlet is any key or label of OUTLETS.
 */
export function parseLine(line) {
  const out = { outlet: null, dv: 0, subjects: [], tags: [] };
  let rest = String(line ?? "");
  for (const key of ["subjects", "tags"]) {
    const m = new RegExp(`\\b${key}\\s*:\\s*(.*?)(?=\\b(?:subjects|tags)\\s*:|$)`, "i").exec(rest);
    if (m) {
      out[key] = listOf(m[1].replace(/[;,]\s*$/, ""));
      rest = rest.replace(m[0], "");
    }
  }
  for (const part of rest.split(",").map(p => p.trim()).filter(Boolean)) {
    const dv = /^dv\s*(\d+)$/i.exec(part);
    if (dv) out.dv = clampDv(dv[1]);
    else {
      const p = norm(part);
      const key = Object.keys(OUTLETS).find(k => norm(k) === p || norm(OUTLETS[k].label) === p || norm(OUTLETS[k].name) === p);
      if (key) out.outlet = key;
    }
  }
  return out;
}

/**
 * Journal entries prepared as screamsheets: in a "Screamsheets" folder (subfolders too), or with a
 * "Screamsheet:" line. [{ id, name, outlet, dv, subjects: [names], tags, text }] (secret blocks dropped,
 * the line left out).
 */
export function screamsheetPool(entries = game.journal ?? []) {
  const out = [];
  for (const entry of entries) {
    const pages = [...(entry.pages ?? [])].filter(p => p.type === "text");
    const lines = pages.flatMap(p => [...plainText(p.text?.content).matchAll(LINE)].map(m => m[1]));
    if (!lines.length && !inFolder(entry, JOURNAL_FOLDER)) continue;
    const meta = parseLine(lines[0] ?? "");
    const text = pages.map(p => pageText(p.text?.content, "drop").replace(LINE, "").trim()).filter(Boolean).join("\n\n");
    out.push({ id: entry.id, name: entry.name, ...meta, outlet: meta.outlet ?? "wns", text });
  }
  return out;
}

/** A draft from a journal entry: its name is the headline, its text the body. `findActor(name)` → id. */
export function journalDraft(item, findActor = () => null) {
  return {
    sheet: plainSheet({ outlet: item.outlet, headline: item.name, byline: "Staff", text: item.text }),
    subjects: item.subjects.map(findActor).filter(Boolean), tags: item.tags, dv: item.dv, reach: "public", spin: "accurate", rep: [],
    title: item.name, notes: "", source: { kind: "journal", ref: item.id, label: item.name }
  };
}

import { MODULE_ID } from "../../scripts/config.js";
/*
 * Ask Alex Anything (Ziggurat, free, preinstalled; All About Agents p. 7): "Allows a user to search
 * for and display data from the local CitiNet." The question goes to the GM, who answers as Alex, or
 * asks for a Library Search roll first (an Agent gives a bonus, +2 by default). Until then the player sees "Alex is
 * crawling the Pool…"; "No results" only when the GM says so.
 * The Data Pool: Journal entries in a "Data Pool" folder (subfolders too), or anywhere with a line
 * "Data Pool Keywords: a, b, c". A question that mentions one's name or keyword lists it on the GM
 * Phone, and the GM picks which (if any) to answer from: never automatic, so a roll can come first.
 * The GM can also have Claude draft the answer (see apps/alex/ai.js) from:
 *   the Data Pool: what anyone can find, sent with every draft;
 *   "Locations": the GM's reference (subfolders too). Alex tells only what's public about a place.
 * In both, secret blocks are marked so the draft can say what it drew from them.
 */

/** An example Data Pool entry (the GM Phone's "Create an example" button). */
export const EXAMPLE_ENTRY = {
  name: "Afterlife",
  text: "<p>Data Pool Keywords: merc bar, rogue, solo bar</p>"
    + "<p>The Afterlife: a bar in a former morgue in Watson, where edgerunners drink and fixers hire. Drinks are named for mercs who died famous.</p>"
    + "<p>Owner: Rogue. Open late. No gunfights inside.</p>"
    + "<section class=\"secret\"><p>GM only: Rogue keeps a file on every merc who drinks there.</p></section>"
};

/** A setting's number, or `fallback` where it isn't registered (Node tests). */
const bonusSetting = (key, fallback) => {
  const value = Number(game.settings.get(MODULE_ID, key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

/** What an Agent adds to Library Search (the GM's world setting "agentLibraryBonus"; the book's +2). */
export const agentBonus = () => bonusSetting("agentLibraryBonus", 2);

/**
 * Big SAAI (All About Agents p. 7, 100eb, Ziggurat): an App Store add-on (apps/pool/model.js ADDONS) that adds to the
 * Agent's Library Search bonus (the book: +3 instead of +2, i.e. +1 on top). It also reports on the
 * user to Ziggurat: their questions are badged on the GM Phone.
 */
export const BIG_SAAI = "bigsaai";
/** What Big SAAI adds on top of the Agent's bonus (the GM's world setting "bigSaaiBonus"; the book's +1). */
export const bigSaaiBonus = () => bonusSetting("bigSaaiBonus", 1);
export const DATA_POOL_FOLDER = "Data Pool";
export const LOCATIONS_FOLDER = "Locations";

/** Strip a journal page's HTML down to text. */
export const plainText = html => String(html ?? "").replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

/** Foundry's secret blocks: <section class="secret">…</section> ("secret revealed" once shown to players). */
const SECRET = /<section\b[^>]*class="([^"]*\bsecret\b[^"]*)"[^>]*>([\s\S]*?)<\/section>/gi;

/**
 * A page's text with its unrevealed secret blocks left out ("drop") or wrapped in
 * [GM SECRET]…[/GM SECRET] ("mark"). Revealed ones are ordinary text.
 */
export function pageText(html, secrets = "drop") {
  const out = String(html ?? "").replace(SECRET, (_, cls, inner) => {
    if (/\brevealed\b/.test(cls)) return inner;
    return secrets === "mark" ? `<p>[GM SECRET]</p>${inner}<p>[/GM SECRET]</p>` : "";
  });
  return plainText(out);
}

/** Is the entry in a folder named `name`, or in one of its subfolders? */
export function inFolder(entry, name) {
  for (let f = entry?.folder; f; f = f.folder) if (f.name === name) return true;
  return false;
}

const KEYWORDS = /^[ \t]*data pool keywords[ \t]*:(.*)$\n?/gim;

const entryText = (entry, secrets) => [...(entry.pages ?? [])].filter(p => p.type === "text").map(p => pageText(p.text?.content, secrets).replace(KEYWORDS, "").trim()).filter(Boolean).join("\n\n");

/** An entry's "Data Pool Keywords: a, b, c" lines (secret ones too), lower case; null without one. */
function keywordsOf(entry) {
  const lines = [...(entry.pages ?? [])].filter(p => p.type === "text").flatMap(p => [...plainText(p.text?.content).matchAll(KEYWORDS)]);
  if (!lines.length) return null;
  return lines.flatMap(m => m[1].split(",")).map(k => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * The Data Pool: [{ id, name, keywords, text }] from entries in the "Data Pool" folder or with a "Data
 * Pool Keywords" line. `text` leaves out the keywords line and the unrevealed secret blocks ("drop",
 * what a player may be sent) or marks them ("mark", for Claude). `entries`: JournalEntry documents
 * (defaults to game.journal).
 */
export function dataPool(entries = game.journal ?? [], { secrets = "drop" } = {}) {
  const out = [];
  for (const entry of entries) {
    const keywords = keywordsOf(entry);
    if (!keywords && !inFolder(entry, DATA_POOL_FOLDER)) continue;
    const text = entryText(entry, secrets);
    if (text) out.push({ id: entry.id, name: entry.name, keywords: keywords ?? [], text });
  }
  return out;
}

/**
 * The Data Pool entries a question mentions (its name, "The" optional, or a keyword: whole words),
 * most hits first: [{ ...entry, hits }]. The GM picks from these; none answers on its own.
 */
export function poolMatches(question, pool) {
  const q = norm(question);
  const found = [];
  for (const entry of pool) {
    const terms = [entry.name, ...entry.keywords].map(k => norm(k).replace(/^ the /, " ")).filter(k => k.trim().length > 2);
    const hits = [...new Set(terms.filter(k => q.includes(k)).map(k => k.trim()))];
    if (hits.length) found.push({ ...entry, hits });
  }
  return found.sort((a, b) => b.hits.length - a.hits.length);
}

/** Locations, the GM's reference: [{ id, name, area, text }] with secrets marked. `area`: the subfolder it's in. */
export function locations(entries = game.journal ?? []) {
  return [...entries].filter(e => inFolder(e, LOCATIONS_FOLDER)).map(e => ({
    id: e.id,
    name: e.name,
    area: e.folder?.name !== LOCATIONS_FOLDER ? e.folder?.name ?? "" : "",
    text: entryText(e, "mark")
  }));
}

const norm = s => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * Locations named in some text (the question, the GM's direction): whole words, longest names
 * first, "The" optional. At most `max`.
 */
export function namedLocations(text, list, max = 3) {
  const t = norm(text);
  const hits = [];
  for (const loc of [...list].sort((a, b) => b.name.length - a.name.length)) {
    const name = norm(loc.name).replace(/^ the /, " ");
    if (name.trim().length < 3 || !t.includes(name)) continue;
    if (hits.some(h => norm(h.name).includes(name))) continue; // "Afterlife" inside "Afterlife Annex"
    hits.push(loc);
    if (hits.length >= max) break;
  }
  return hits;
}

/** The location a name refers to (Claude's lookups): exact, then without "The", then the closest containing one. */
export function findLocation(name, list) {
  const n = norm(name).replace(/^ the /, " ");
  return list.find(l => norm(l.name) === norm(name))
    ?? list.find(l => norm(l.name).replace(/^ the /, " ") === n)
    ?? list.find(l => norm(l.name).includes(n) || n.includes(norm(l.name).replace(/^ the /, " ")))
    ?? null;
}

/**
 * The mods the phone adds to a sheet's Library Search roll (`mods`: the roll's own, from the sheet's effects): the
 * Agent's bonus unless an effect already gives it, and Big SAAI's unless its effect is on the sheet. `app` names
 * the app in the source ("Ask Alex Anything", "DataPool").
 */
export function agentMods(mods, bigSaai, app) {
  const has = re => mods.some(m => re.test(m.source ?? ""));
  const out = [];
  if (!has(/agent/i)) out.push({ id: `${MODULE_ID}-agent`, value: agentBonus(), source: `Agent (${app})` });
  if (bigSaai && !has(/big saai/i)) out.push({ id: `${MODULE_ID}-bigsaai`, value: bigSaaiBonus(), source: "Big SAAI" });
  return out;
}

/** The sheet's Library Search: INT + skill level + the Agent's bonus (and Big SAAI's with it). */
export function librarySearchBase(actor, bigSaai = false) {
  const int = Number(actor?.system?.stats?.int?.value ?? 0) || 0;
  const skill = [...(actor?.items ?? [])].find(i => i.type === "skill" && /^library search$/i.test(i.name));
  const level = Number(skill?.system?.level ?? 0) || 0;
  const bonus = agentBonus() + (bigSaai ? bigSaaiBonus() : 0);
  return { int, level, bonus, bigSaai: !!bigSaai, total: int + level + bonus };
}

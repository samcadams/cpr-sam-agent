import { MODULE_ID } from "../../scripts/config.js";
import { clean } from "../../scripts/util/text.js";

/*
 * NCPD Crime Database (NCPD, 500eb, Black Chrome p. 13). The player snaps someone (a token
 * they can see, or a picture) and sends it to NCPD; the public record comes back within the hour.
 *   - Always a roll (the book has none): a usable shot is Photography/Film vs DV 13. The GM
 *     can change the DV, oppose it with the subject's own skill (Acting: CPR has no Disguise), or ask for a
 *     new shot with another skill. A failed shot still takes the hour and comes back "Inconclusive: image
 *     quality" (the GM can override). The roll gets the photo a match, not the record.
 *   - On world time, but the GM releases it: the GM Phone is told when the hour is nearly up and when it's
 *     up, and "Deliver now" works at any time.
 *   - The record is the GM's: a card of picks (charges, dispositions, sentences, issuers) so it's quick
 *     to fill. Records are kept in an archive the GM can search (host table "ncpdRecords", GM only), each
 *     optionally linked to an actor, so a later lookup of the same actor or name starts from it. A bounty can become a Job.
 *   - NCPD gets the photo and its metadata (the book), so the GM can mark that NCPD flags the lookup.
 *
 * Lookup row (host table "ncpdLookups", owner actorId; `subject` and `gm` only GMs see):
 *   { id, num, actorId, ts, time, date, img, seen (the name the player saw, or ""), caption,
 *     at, due (world time, seconds), skill, dv, roll?: { total, detail }, ask?: { skill, dv } (a new shot asked for),
 *     status: "pending"|"delivered", result?: { kind, reason?, record?, at },
 *     subject?: { actorId, name, tokenId?, sceneId? }, gm: { opposed?: { skill, total, detail }, warned?, due?, flagged? } }
 * Record: { name, aliases[], match, affiliation, cautions[], priors[{ charge, year, disposition, sentence }],
 *     warrants[{ charge, issuer, issued }], bounties[{ amount, issuer, reason, terms }], notes }
 * The archive (host table "ncpdRecords"[id], GM only): a record standing on its own, optionally linked
 * to an actor: { id, ...record, actorId: string|null, updated }. Older rows were keyed by actorId.
 */

export const NCPD = "ncpd";
export const FROM = "NCPD Crime Database";

/**
 * The GM's settings (world setting "ncpd"). `nightCityOnly`: NCPD only answers in Night City (Black Chrome
 * p. 13); a scene is in Night City by its flag (flags.cpr-sam-agent.nightCity), or `nightCityDefault`
 * when it has none (true, so existing worlds keep working).
 */
export const NCPD_DEFAULTS = { minutes: 60, warn: 10, skill: "Photography/Film", dv: 13, nightCityOnly: true, nightCityDefault: true };

export function ncpdConfig(raw = game.settings.get(MODULE_ID, NCPD) ?? {}) {
  const num = (v, d, min, max) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(min, Math.min(max, Math.floor(Number(v)))) : d);
  return {
    minutes: num(raw.minutes, NCPD_DEFAULTS.minutes, 0, 24 * 60),
    warn: num(raw.warn, NCPD_DEFAULTS.warn, 0, 120),
    skill: clean(raw.skill, 60) || NCPD_DEFAULTS.skill,
    dv: num(raw.dv, NCPD_DEFAULTS.dv, 1, 40),
    nightCityOnly: typeof raw.nightCityOnly === "boolean" ? raw.nightCityOnly : NCPD_DEFAULTS.nightCityOnly,
    nightCityDefault: typeof raw.nightCityDefault === "boolean" ? raw.nightCityDefault : NCPD_DEFAULTS.nightCityDefault
  };
}

/** Is this scene in Night City (by its flag, else the GM's default)? */
export function sceneInNightCity(scene, config = ncpdConfig()) {
  const flag = scene?.flags?.[MODULE_ID]?.nightCity;
  return typeof flag === "boolean" ? flag : config.nightCityDefault;
}

/** Does NCPD answer from this scene? Always, unless the GM made it Night City only. */
export const ncpdReachable = (scene, config = ncpdConfig()) => !config.nightCityOnly || sceneInNightCity(scene, config);

export const NO_UPLINK = "No NCPD uplink outside Night City.";

/* ---------------- The GM's picks ---------------- */

/** Charges (the GM may type any other). */
export const CHARGES = [
  "Assault", "Aggravated assault", "Armed robbery", "Arson", "Attempted murder", "Bribery of an officer", "Burglary",
  "Carjacking", "Corporate espionage", "Cyberpsychotic episode", "Data theft", "Disturbing the peace", "Drug possession",
  "Drug trafficking", "Extortion", "Fraud", "Gang activity", "Grand theft auto", "Illegal cyberware", "Illegal netrunning",
  "Kidnapping", "Manslaughter", "Murder", "Organ trafficking", "Possession of an unregistered weapon", "Public intoxication",
  "Racketeering", "Resisting arrest", "Smuggling", "Solicitation", "Theft", "Trespassing in a corporate zone",
  "Vandalism", "Vehicular homicide", "Weapons trafficking", "XBD trafficking"
];

/** How a prior ended. */
export const DISPOSITIONS = ["Convicted", "Pled guilty", "Acquitted", "Dismissed", "Charges dropped", "Released without charge", "Pending trial", "Escaped custody"];

/** Sentences (the GM may type any other). */
export const SENTENCES = [
  "Fine", "Community service", "Probation", "Suspended sentence", "Time served", "30 days", "6 months", "1 year", "2 years",
  "5 years", "10 years", "25 years", "Life", "Mandatory therapy", "Cyberware confiscated", "Corporate work program", "Released on bail"
];

/** Who issues warrants and bounties (the GM may type any other). */
export const ISSUERS = [
  "NCPD", "NCPD Psycho Squad", "Night City Council", "Militech", "Biotechnica", "Petrochem", "Zhirafa", "Continental Brands",
  "Rocklin Augmentics", "Trauma Team International", "Ziggurat", "Private party"
];

export const TERMS = ["Alive", "Dead or alive"];
export const MATCHES = ["Positive", "Probable", "Partial"];
export const CAUTIONS = ["Armed and dangerous", "Heavily chromed", "Cyberpsychosis risk", "Known netrunner", "Gang affiliated", "On parole", "Corporate protected", "Do not approach"];

/** What a lookup can come back as. */
export const RESULTS = { record: "Record", none: "No record", inconclusive: "Inconclusive" };
export const REASONS = ["Image quality", "Face not visible", "Subject's face is obscured", "Records sealed", "Database timeout"];

/** Skills the GM can ask for or oppose with, and their STAT (the host rolls these without a skill item). */
export const SKILL_STATS = {
  "Photography/Film": "tech", "Perception": "int", "Acting": "cool", "Conceal/Reveal Object": "int", "Human Perception": "emp",
  "Library Search": "int", "Stealth": "dex"
};
export const OPPOSE_SKILL = "Acting";

/* ---------------- Rows ---------------- */

const LIMIT = { list: 12, text: 100, notes: 2000, aliases: 8 };
const str = (v, max = LIMIT.text) => clean(v, max);
const rows = (list, fn) => (Array.isArray(list) ? list.slice(0, LIMIT.list).map(fn).filter(Boolean) : []);

/** A request number as NCPD prints it: "NCPD-482193". */
export const lookupNumber = (rand = Math.random) => `NCPD-${String(Math.floor(rand() * 900_000) + 100_000)}`;

export const emptyRecord = (name = "") => ({ name: str(name), aliases: [], match: "Positive", affiliation: "", cautions: [], priors: [], warrants: [], bounties: [], notes: "" });

/** A record from anyone (the GM's form): trimmed and bounded. The picks are suggestions: the GM may type anything. */
export function cleanRecord(raw = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  const aliases = (Array.isArray(raw.aliases) ? raw.aliases : String(raw.aliases ?? "").split(","))
    .map(a => str(a, 60)).filter(Boolean).slice(0, LIMIT.aliases);
  return {
    name: str(raw.name),
    aliases,
    match: str(raw.match, 30) || "Positive",
    affiliation: str(raw.affiliation),
    cautions: [...new Set(Array.isArray(raw.cautions) ? raw.cautions.map(c => str(c, 40)).filter(Boolean) : [])].slice(0, LIMIT.list),
    priors: rows(raw.priors, p => p?.charge && { charge: str(p.charge), year: str(p.year, 12), disposition: str(p.disposition, 40) || "Convicted", sentence: str(p.sentence, 60) }),
    warrants: rows(raw.warrants, w => w?.charge && { charge: str(w.charge), issuer: str(w.issuer, 60) || "NCPD", issued: str(w.issued, 20) }),
    bounties: rows(raw.bounties, b => {
      const amount = Math.max(0, Math.min(10_000_000, Math.floor(Number(b?.amount) || 0)));
      return amount > 0 && { amount, issuer: str(b.issuer, 60) || "NCPD", reason: str(b.reason), terms: str(b.terms, 30) || "Dead or alive" };
    }),
    notes: str(raw.notes, LIMIT.notes)
  };
}

/** A result from the GM: { kind, reason?, record? }. */
export function cleanResult(raw = {}) {
  const kind = raw?.kind in RESULTS ? raw.kind : "none";
  if (kind === "record") return { kind, record: cleanRecord(raw.record) };
  if (kind === "inconclusive") return { kind, reason: str(raw.reason, 60) || REASONS[0] };
  return { kind };
}

/** Was the shot usable? null while there's no roll. Opposed: beat the subject (ties go to the defender). */
export function shotUsable(lookup) {
  const total = lookup?.roll?.total;
  if (!Number.isFinite(total)) return null;
  const opposed = lookup.gm?.opposed;
  return opposed ? total > opposed.total : total >= lookup.dv;
}

/** Seconds of world time until the results are due (negative once overdue). */
export const dueIn = (lookup, now = game.time.worldTime) => (lookup.due ?? now) - now;

/** "results within 42 min", for the player. */
export function etaLabel(seconds) {
  if (seconds <= 0) return "results any minute now";
  const min = Math.ceil(seconds / 60);
  if (min < 60) return `results within ${min} min`;
  const h = Math.floor(min / 60);
  return `results within ${h} hr${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** One line about a record: "2 priors · 1 warrant · bounty 5,000eb". */
export function recordSummary(record, money = n => `${n}eb`) {
  if (!record) return "";
  const n = (count, one) => (count ? `${count} ${one}${count === 1 ? "" : "s"}` : null);
  const bounty = record.bounties.reduce((sum, b) => sum + b.amount, 0);
  return [n(record.priors.length, "prior"), n(record.warrants.length, "active warrant"), bounty ? `bounty ${money(bounty)}` : null].filter(Boolean).join(" · ") || "Clean record";
}

/** Warrants or bounties: the record is stamped WANTED. */
export const isWanted = record => record.warrants.length > 0 || record.bounties.length > 0;

/** A bounty as a Job (hidden until the GM shows it). */
export function bountyJob(record, bounty, img, money = n => `${n}eb`) {
  const wanted = record.name || "Unknown subject";
  const lines = [
    `${bounty.issuer} bounty on ${wanted}${record.aliases.length ? ` (a.k.a. ${record.aliases.join(", ")})` : ""}: ${money(bounty.amount)}, ${bounty.terms.toLowerCase()}.`,
    bounty.reason ? `Wanted for: ${bounty.reason}.` : "",
    record.warrants.length ? `Active warrants: ${record.warrants.map(w => w.charge).join(", ")}.` : "",
    record.cautions.length ? `Caution: ${record.cautions.join(", ")}.` : "",
    "From an NCPD Crime Database lookup."
  ];
  return { name: `Bounty: ${wanted}`, description: lines.filter(Boolean).join("\n"), img: img || null, status: "available", hidden: true };
}

/** The sheet's numbers for a skill: STAT + level (the host's roll when the actor has no skill item). */
export function skillBase(actor, skill) {
  const item = [...(actor?.items ?? [])].find(i => i.type === "skill" && i.name.toLowerCase() === String(skill).toLowerCase());
  const stat = item?.system?.stat ?? SKILL_STATS[skill] ?? "int";
  const value = Number(actor?.system?.stats?.[stat]?.value ?? 0) || 0;
  const level = Number(item?.system?.level ?? 0) || 0;
  return { stat, value, level, total: value + level };
}

/* ---------------- The archive ---------------- */

const lower = v => String(v ?? "").trim().toLowerCase();

/** Archive rows matching a search (name, alias or affiliation, case-insensitive substring), by name. */
export function searchRecords(records, query = "") {
  const q = lower(query);
  return Object.values(records ?? {})
    .filter(r => !q || [r.name, r.affiliation, ...(r.aliases ?? [])].some(v => lower(v).includes(q)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/** The archive row for a subject: linked to this actor, else this exact name or alias. */
export function findRecord(records, { actorId, name } = {}) {
  const rows = Object.values(records ?? {});
  const n = lower(name);
  return (actorId && rows.find(r => r.actorId === actorId))
    || (n && (rows.find(r => lower(r.name) === n) ?? rows.find(r => (r.aliases ?? []).some(a => lower(a) === n))))
    || null;
}

/** Older rows (keyed by their actor's id, no `id`) as archive rows. Returns how many moved. */
export function migrateRecords(records, newId) {
  let moved = 0;
  for (const [key, row] of Object.entries(records ?? {})) {
    if (row?.id === key) continue;
    delete records[key];
    const id = newId();
    records[id] = { ...row, id, actorId: row?.actorId ?? key };
    moved++;
  }
  return moved;
}

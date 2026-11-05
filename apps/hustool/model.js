import { MODULE_ID } from "../../scripts/config.js";
import { clean } from "../../scripts/util/text.js";

/*
 * HusTool (20eb, All About Agents p. 8, No/Brainer).
 * Gigs only come out of downtime; nothing here runs on world time.
 *   - The GM decides which errands exist (world setting "hustool", seeded with the book's three and a few more):
 *     an errand can be tied to a district (flavor, and which encounter table trouble draws from), to hours of
 *     the day, or need a vehicle (offered only to a character carrying a vehicle item).
 *   - When a cpr-hq round settles, each hour of "hustool" blocks banks perHour hustles, each an errand fitting that
 *     hour and the character's vehicle. What's still open expires when the next round settles.
 *   - PAY ME spends a hustle: the next one becomes the errand the character is on, one at a time. Done rolls 1d10 (no
 *     skill or stat: nothing for the sheet's dialog to add), whispered to the player and the GMs: a 1 goes sour (no
 *     pay), a 10 pays but brings trouble (the GM gets a card: roll on the Encounter Table for the area and time of day,
 *     CP:R p. 417), anything else pays. Bail spends it with no roll and no pay. Complete all does a day's hustles at once.
 *   - Pay goes straight into BangMe! (ledger kind "hustool"), dated on the downtime day; at most one trouble card per
 *     character per downtime day (later 10s pay with a flavor line).
 *
 * Gig row (host table "hustoolGigs", owner actorId; id roundId-actorId, so a round never makes them twice):
 *   { id, roundId, actorId, ts, days: [{ day, date, errands: [{ id, errandId, text, district, hour, time,
 *     status: "open"|"running"|"rolling"|"paid"|"sour"|"trouble"|"skipped"|"expired", roll?, pay?, flavor? }] }],
 *     gm: { troubleDays: { [day]: { id, actorId, text, district, hour, time, onDay, gm: { trouble, hour } } } } }
 */

export const HUSTOOL = "hustool";
export const FROM = "HusTool";
export const PUBLISHER = "No/Brainer";

/** The book's three errands, then a few more. Hours as [from, to) on a 24-hour clock. */
export const DEFAULT_ERRANDS = [
  { id: "takeout", text: "Deliver takeout" },
  { id: "sofa", text: "Carry a sofa up the stairs" },
  { id: "drive", text: "Drive someone a short distance", vehicle: true },
  { id: "package", text: "Courier a sealed package" },
  { id: "dog", text: "Walk a client's dog", district: "Watson", from: 6, to: 22 },
  { id: "queue", text: "Queue for a ripperdoc appointment", from: 8, to: 20 },
  { id: "drone", text: "Return a rental drone" }
].map(e => ({ district: "", from: null, to: null, vehicle: false, on: true, ...e }));

export const HUSTOOL_DEFAULTS = { pay: 10, trouble: true, perHour: 2 };

/** Why an errand went sour (a 1). */
export const SOUR = [
  "The customer wasn't there.",
  "The restaurant was closed.",
  "Wrong address. Nobody's heard of them.",
  "The client cancelled halfway through.",
  "Someone else got there first."
];

const hour = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(23, Math.floor(Number(v)))));
const num = (v, d, min, max) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(min, Math.min(max, Math.floor(Number(v)))) : d);

/** One errand of the GM's list, cleaned. */
export function cleanErrand(e = {}) {
  return {
    id: clean(e.id, 40) || foundry.utils.randomID(),
    text: clean(e.text, 120),
    district: clean(e.district, 60),
    from: hour(e.from),
    to: hour(e.to),
    vehicle: !!e.vehicle,
    on: e.on !== false
  };
}

/** The GM's settings (world setting "hustool"), filled in. The errand list is the defaults until the GM edits it. */
export function hustoolConfig(raw = game.settings.get(MODULE_ID, HUSTOOL) ?? {}) {
  return {
    pay: num(raw.pay, HUSTOOL_DEFAULTS.pay, 0, 1000),
    trouble: typeof raw.trouble === "boolean" ? raw.trouble : HUSTOOL_DEFAULTS.trouble,
    perHour: num(raw.perHour, HUSTOOL_DEFAULTS.perHour, 1, 10),
    errands: (Array.isArray(raw.errands) ? raw.errands : DEFAULT_ERRANDS).map(cleanErrand).filter(e => e.text)
  };
}

/** Is the hour inside [from, to)? Wraps past midnight (22 to 4); no hours = any time; an unknown hour passes. */
export function inHours(e, h) {
  if (e.from === null || e.to === null || e.from === e.to || h === null) return true;
  return e.from < e.to ? h >= e.from && h < e.to : h >= e.from || h < e.to;
}

/** The errands on offer at this hour: switched on, in their hours, and needing a vehicle only if they have one. */
export const errandsFor = (errands, { hour: h = null, vehicle = false } = {}) => errands.filter(e => e.on && inHours(e, h) && (!e.vehicle || vehicle));

/** Does the character carry a vehicle (CPR's vehicle item)? */
export const hasVehicle = actor => !!actor?.items?.some?.(i => i.type === "vehicle");

/** What a d10 means: 1 sour, 10 trouble (when the GM has it on; else paid), anything else paid. */
export const outcomeOf = (roll, { trouble = true } = {}) => (roll === 1 ? "sour" : roll === 10 && trouble ? "trouble" : "paid");

/** The CP:R encounter table's time of day for an hour. */
export function timeOfDay(h) {
  if (h === null || h === undefined) return null;
  return h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/**
 * The world's encounter table for trouble, by name: one with "encounter" and the time of day in its name,
 * the errand's district too if one has it; else null (the GM rolls on CP:R p. 417).
 */
export function encounterTable(tables, { district = "", hour: h = null } = {}) {
  const tod = timeOfDay(h);
  if (!tod) return null;
  const named = [...tables].filter(t => /encounter/i.test(t.name) && t.name.toLowerCase().includes(tod));
  return (district && named.find(t => t.name.toLowerCase().includes(district.toLowerCase()))) || named[0] || null;
}

/** A settled round's gig hours per day: [{ day, hours }], counted hour by hour since a block can cross midnight. */
export function gigHours({ blocks = [], days }) {
  const out = new Map();
  for (const b of blocks) {
    if (b.activity !== HUSTOOL) continue;
    for (let h = b.start; h < b.start + b.length; h++) {
      const day = Math.floor(h / 24);
      if (day < 0 || day >= days) continue;
      if (!out.has(day)) out.set(day, []);
      out.get(day).push(h % 24);
    }
  }
  return [...out].sort(([a], [b]) => a - b).map(([day, hours]) => ({ day, hours: hours.sort((a, b) => a - b) }));
}

/**
 * The errands a settled round's gig hours become. `stamp(day, hour, minute)` is that moment's { time, date }. An hour
 * no errand fits (the GM's hours, no vehicle) gives none.
 */
export function gigDays(entry, { errands, perHour }, { vehicle = false, stamp }) {
  return gigHours(entry).map(({ day, hours }) => ({
    day,
    date: stamp(day, hours[0], 0).date,
    errands: hours.flatMap(hour => {
      const offered = errandsFor(errands, { hour, vehicle });
      if (!offered.length) return [];
      return Array.from({ length: perHour }, (_, i) => {
        const e = offered[Math.floor(Math.random() * offered.length)];
        return { id: foundry.utils.randomID(), errandId: e.id, text: e.text, district: e.district, hour, time: stamp(day, hour, Math.floor((i * 60) / perHour)).time, status: "open" };
      });
    })
  })).filter(d => d.errands.length);
}

/** A later 10 on a downtime day: it pays, and this is all that happens. */
export const closeCall = errand => (errand.district ? `Close call on the ${errand.district} run.` : "Close call on that one.");

/** A character's latest gig row (earlier rounds have nothing left to resolve). */
export const latestGigs = (rows, actorId) => Object.values(rows ?? {}).filter(r => r.actorId === actorId).sort((a, b) => b.ts - a.ts)[0] ?? null;

const errandsIn = row => (row?.days ?? []).flatMap(d => d.errands);

/** A gig row's hustles still banked. */
export const hustlesIn = row => errandsIn(row).filter(e => e.status === "open");

/** The hustle a gig row's character is on, if any. */
export const runningIn = row => errandsIn(row).find(e => e.status === "running") ?? null;

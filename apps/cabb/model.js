import { MODULE_ID } from "../../scripts/config.js";
import { simpleCalendar } from "../../scripts/util/agentTime.js";
import { mapKmPerPx, mapReady, mapRows, rowSeenBy, rowShared } from "../map/model.js";

/*
 * Combat Cabb: armored taxis, booked from the phone. Alerts only: the cab is dispatched, is here (the
 * fare is charged through BangMe then) and waits, leaves when the GM says so, and has arrived. The GM
 * moves the tokens.
 *
 * Where to: the Map app's pins the player sees (apps/map, its own Night City: everyone's, or those listing
 * one of their characters), each with its Combat Zone or Hot Zone (the pin's `zone`), or, when the GM picks "No
 * map", Night City's districts (DISTRICTS, which the GM can edit), with no map. Pickup is where the GM says the
 * crew is: the crew's GPS spot (`crew`, set on the Map: anywhere, or snapped to a pin; a pin can also be linked to
 * a scene, and activating that scene puts the crew there), or a place picked on the GM Phone. Until the GM sets
 * one, players pick their own pickup.
 *
 * Fare: flag fall + per mile, times the zone multiplier into a Combat Zone or the Hot Zone.
 * Distance: by road, when the Map has its road network traced (apps/map/route.js, apps/map/model.js
 * ownCabbRoad); otherwise straight between the two places, plus 10–40% for the streets (steady for a trip on a
 * given day, so asking again doesn't fish for a cheaper quote).
 *
 * The GM's settings are the world setting "cabb", merged over CABB_DEFAULTS.
 * Ride (apps.rides[id]): { id, actorId, from: { id, name }, to: { id, name }, mi, km, fare, zone, road (by road),
 *   status: "enroute"|"waiting" (here, paid, until the GM says it leaves)|"riding"|"arrived"|"cancelled"|"declined",
 *   eta (ms: pickup), arrive (ms; null while riding: no timer, it arrives when the GM says),
 *   tripMs, cab (a cab number), ts, time, credit ({ lifestyle, key }: free, from the Lifestyle) | null, fullFare }
 *
 * Lifestyle ride credit (Black Chrome p. 130): with cpr-hq, a rulebook Lifestyle includes free
 * taxis (cpr-hq api.lifestyle.of → perks.taxi { per: day|week|month, anywhere }): Kibble one a month, Generic Prepak
 * one a week, Good Prepak one a day, all with neither end in a Combat Zone or the Hot Zone; Fresh Food one a day
 * anywhere. The fare is 0 and the ride says so. Used credits: apps.rideCredits[actorId] = { actorId, key (the
 * period), rideId, ts }, taken at booking and given back when the ride is cancelled. Without cpr-hq: no credit.
 */

export const CABB_DEFAULTS = {
  flagFall: 20,
  perMile: 16,
  zoneMult: 2,
  zonePickup: false, // the multiplier also when picked up in a zone ("into" is the rule)
  etaMin: 10, // seconds (real) until the cab is here
  etaMax: 180,
  secPerKm: 20, // real seconds of trip per km
  tripMin: 15,
  tripMax: 300,
  tripTimer: true, // off: a ride arrives when the GM says (or at a time the GM sets for that ride)
  sceneId: null, // null: the Map's places (an older NAV scene id counts the same); "none": the city list, no map
  partyAt: null, // a place id: where the party is (without the crew's spot)
  zones: {}, // pins' zones { pinId: "combat"|"hot" }, moved onto the Map's pins once (apps/map/host.js)
  districts: null, // the GM's own city list (null: DISTRICTS)
  crew: null, // where the crew is on the Map: { x, y (Map px), noteId (snapped to that pin) | null, ts }
  links: {} // pins linked to scenes { pinId: sceneId }, moved onto the Map's pins once (apps/map/host.js)
};

export const ZONES = { combat: "Combat Zone", hot: "Hot Zone" };

/**
 * Night City's 25 districts (the Map's traced districts, apps/map: the NAV map's district pins), in km from the
 * NAV map's north-west corner, so fares match the map's distances. For worlds without a NAV scene ("No map"):
 * Cabb then has no map, only these. The GM can move, add and remove places (GM Phone → Combat Cabb).
 */
export const DISTRICTS = [
  { id: "charter-hill", name: "Charter Hill", x: 11.8, y: 8.8 },
  { id: "downtown", name: "Downtown", x: 5.0, y: 11.2 },
  { id: "executive-zone", name: "Executive Zone", x: 11.8, y: 10.2 },
  { id: "heywood-docks", name: "Heywood Docks", x: 11.2, y: 13.0 },
  { id: "heywood-industrial-zone", name: "Heywood Industrial Zone", x: 9.9, y: 14.6 },
  { id: "kabuki", name: "Kabuki", x: 8.5, y: 7.6 },
  { id: "little-china", name: "Little China", x: 9.8, y: 12.0 },
  { id: "little-europe", name: "Little Europe", x: 5.9, y: 10.2 },
  { id: "new-westbrook", name: "New Westbrook", x: 10.7, y: 7.9 },
  { id: "norcal-military-base", name: "NorCal Military Base", x: 6.6, y: 6.1 },
  { id: "north-heywood", name: "North Heywood", x: 12.4, y: 13.9 },
  { id: "old-combat-zone", name: "Old Combat Zone", x: 8.6, y: 13.9, zone: "combat" },
  { id: "old-japantown", name: "Old Japantown", x: 8.6, y: 12.7 },
  { id: "pacifica-playground", name: "Pacifica Playground", x: 5.4, y: 16.6, zone: "combat" },
  { id: "port-of-night-city", name: "Port of Night City", x: 4.3, y: 13.8 },
  { id: "rancho-coronado", name: "Rancho Coronado", x: 7.8, y: 17.8 },
  { id: "reclamation-zone", name: "Reclamation Zone", x: 5.7, y: 14.4 },
  { id: "santo-domingo", name: "Santo Domingo", x: 11.5, y: 15.9 },
  { id: "south-night-city", name: "South Night City", x: 5.4, y: 12.9, zone: "combat" },
  { id: "the-glen", name: "The Glen", x: 7.1, y: 13.1 },
  { id: "the-hot-zone", name: "The Hot Zone", x: 7.7, y: 11.5, zone: "hot" },
  { id: "the-outskirts", name: "The Outskirts", x: 2.4, y: 9.8 },
  { id: "university-district", name: "University District", x: 5.2, y: 12.2 },
  { id: "upper-marina", name: "Upper Marina", x: 8.8, y: 10.2 },
  { id: "watson-development", name: "Watson Development", x: 7.0, y: 7.8 }
];

export function cabbConfig() {
  const saved = game.settings.get(MODULE_ID, "cabb") ?? {};
  return { ...CABB_DEFAULTS, ...saved, zones: { ...(saved.zones ?? {}) }, links: { ...(saved.links ?? {}) } };
}

/** Scene grid units → km. */
const UNIT_KM = { km: 1, kilometer: 1, kilometers: 1, m: 0.001, meter: 0.001, meters: 0.001, mi: 1.609344, mile: 1.609344, miles: 1.609344, ft: 0.0003048, feet: 0.0003048, yd: 0.0009144, yds: 0.0009144, yard: 0.0009144, yards: 0.0009144 };
export const unitKm = units => UNIT_KM[String(units ?? "").trim().toLowerCase().replace(/\.$/, "")] ?? 0.001;

/** The NAV scene: the GM's choice, or the scene named "NAV". */
export function navScene(cfg = cabbConfig()) {
  if (cfg.sceneId) return game.scenes.get(cfg.sceneId) ?? null;
  return game.scenes.find(s => /^nav\b|\bnav$/i.test(s.name.trim())) ?? null;
}

/** A Map Note's name. */
export const pinName = note => String(note.text || note.entry?.name || note.page?.name || "").trim() || "Pin";

export const isPartyPin = note => !!note.getFlag?.(MODULE_ID, "cabbParty") || !!note.flags?.[MODULE_ID]?.cabbParty;

/** Pin Cushion's "GM only" and "not revealed yet": players never see these pins on the scene. */
export function pinHidden(note) {
  const pc = note.flags?.["pin-cushion"] ?? {};
  return String(pc.showOnlyToGM) === "true" || (!!pc.usePinIsRevealed && pc.pinIsRevealed === false);
}

/**
 * Whether a user sees a pin, as on the scene: Pin Cushion's GM-only pins are the GM's; otherwise Foundry's
 * rule (Note#isVisible), at least Limited on its page or entry (a pin with neither: everyone).
 */
export function pinVisibleTo(note, user) {
  if (user?.isGM) return true;
  if (pinHidden(note)) return false;
  return (note.page ?? note.entry)?.testUserPermission?.(user, "LIMITED") ?? true;
}

/** Whether some player sees a pin (what the GM's list and map show). */
export const pinForPlayers = note => game.users.some(u => !u.isGM && pinVisibleTo(note, u));

/** km per scene pixel. */
export const kmPerPx = scene => (Number(scene.grid.distance) || 1) * unitKm(scene.grid.units) / (Number(scene.grid.size) || 100);

/**
 * Cabb's map: the Map app's Night City, unless the GM chose "No map" or the Map has no map yet: { k (km per
 * Map px), rows (the Map's pins this client has) }, or null (the city list).
 */
export function cabbMap(cfg = cabbConfig()) {
  if (cfg.sceneId === "none" || !mapReady()) return null;
  return { k: mapKmPerPx(), rows: mapRows() };
}

/**
 * Where a cab can go: [{ id, name, x, y (km), zone, noteId }]. The Map's pins `user` sees (a GM: those some player
 * sees), ids "note:<pinId>" (as rides have kept them since the NAV scene), or the city list.
 */
export function cabbPlaces(cfg = cabbConfig(), map = cabbMap(cfg), user = game.user) {
  if (map) {
    const seen = user && !user.isGM ? row => rowSeenBy(row, user) : rowShared;
    return Object.values(map.rows).filter(seen).map(r => ({
      id: `note:${r.id}`, name: String(r.name || "").trim() || "Pin", x: r.x * map.k, y: r.y * map.k, zone: r.zone ?? null, noteId: r.id
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return (cfg.districts ?? DISTRICTS).map(d => ({ ...d, id: `d:${d.id}`, zone: d.zone ?? null }));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest place to a point. */
export const nearest = (places, p) => places.reduce((best, q) => (!best || dist(q, p) < dist(best, p) ? q : best), null);

/**
 * Where the party is: the crew's GPS spot on the Map (at its pin, or "near" the closest place, in its zone), or
 * the place the GM picked. Null: the GM hasn't said (players pick their own pickup).
 */
export function partyPickup(cfg = cabbConfig(), map = cabbMap(cfg), places = cabbPlaces(cfg, map)) {
  const crew = map && cfg.crew && !cfg.crew.sceneId ? cfg.crew : null;
  if (crew) {
    const at = { x: crew.x * map.k, y: crew.y * map.k };
    // Snapped to a pin this user sees: at it; anywhere else: near the closest place.
    const pinned = crew.noteId ? places.find(p => p.noteId === crew.noteId) : null;
    const near = pinned ?? nearest(places, at);
    return { id: "party", name: pinned ? pinned.name : near ? `near ${near.name}` : "the crew's spot", ...at, zone: near?.zone ?? null, crew: true };
  }
  return places.find(p => p.id === cfg.partyAt) ?? null;
}

/** 0 → 1, steady for the same input. */
export function hash01(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export const KM_PER_MILE = 1.609344;

/**
 * A trip's distance and fare: { mi, km, fare, zone, road }. `roadMiles`: the distance by road, when known;
 * else straight plus the streets, `day` a number for the day (the streets add the same 10–40% to a trip
 * all day).
 */
export function quote(from, to, cfg = CABB_DEFAULTS, day = 0, roadMiles = null) {
  const road = Number.isFinite(roadMiles) && roadMiles > 0;
  const streets = 1.1 + hash01(`${from.id}|${to.id}|${day}`) * 0.3;
  const mi = Math.max(0.3, Math.round((road ? roadMiles : (dist(from, to) * streets) / KM_PER_MILE) * 10) / 10);
  const zone = to.zone || (cfg.zonePickup && from.zone) || null;
  const perMile = num(cfg.perMile, CABB_DEFAULTS.perMile);
  const fare = Math.round((Number(cfg.flagFall) + perMile * mi) * (zone ? Number(cfg.zoneMult) || 1 : 1));
  return { mi, km: Math.round(mi * KM_PER_MILE * 10) / 10, fare: Math.max(0, fare), zone, road };
}

/** A ride's miles (rides from before fares went by the mile have only km). */
export const rideMiles = ride => ride.mi ?? Math.round((ride.km / KM_PER_MILE) * 10) / 10;

/** A GM's number, or the default when it isn't one. */
const num = (v, fallback) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : fallback);

/** Real ms until the cab is there (random between the GM's min and max). */
export const pickupMs = (cfg = CABB_DEFAULTS, rand = Math.random) => {
  const lo = num(cfg.etaMin, CABB_DEFAULTS.etaMin);
  const hi = Math.max(lo, num(cfg.etaMax, CABB_DEFAULTS.etaMax));
  return Math.round((lo + rand() * (hi - lo)) * 1000);
};

/** Real ms the trip takes. */
export const tripMs = (km, cfg = CABB_DEFAULTS) => {
  const lo = num(cfg.tripMin, CABB_DEFAULTS.tripMin);
  const hi = Math.max(lo, num(cfg.tripMax, CABB_DEFAULTS.tripMax));
  return Math.round(Math.min(hi, Math.max(lo, km * num(cfg.secPerKm, CABB_DEFAULTS.secPerKm))) * 1000);
};

/** A GM's "in how many minutes" for a ride: ms, or null for no timer (blank, 0 or nonsense). At most a day. */
export const gmDelayMs = minutes => {
  const n = Number(minutes);
  return minutes !== null && minutes !== "" && Number.isFinite(n) && n > 0 ? Math.round(Math.min(n, 1440) * 60_000) : null;
};

/** Today's number, for quotes: world days. */
export const cabbDay = () => Math.floor((game.time?.worldTime ?? 0) / 86400);

export const OPEN_RIDE = new Set(["enroute", "waiting", "riding"]);

/** cpr-hq's taxi perk for a character: { name (the Lifestyle), per, anywhere }, or null (no cpr-hq, no perk). */
export function lifestyleTaxi(actor) {
  const hq = game.modules.get("cpr-hq");
  if (!hq?.active || !actor) return null;
  try {
    const life = hq.api?.lifestyle?.of?.(actor);
    return life?.perks?.taxi ? { name: life.name, ...life.perks.taxi } : null;
  } catch (err) {
    console.warn("cpr-sam-agent | cpr-hq Lifestyle lookup failed", err);
    return null;
  }
}

/** The credit period: "day:N", "week:N" (world days), "month:<Simple Calendar year-month>" or "month:N" (30 days). */
export function creditPeriod(per, seconds, calMonth = null) {
  const day = Math.floor((Number(seconds) || 0) / 86400);
  if (per === "day") return `day:${day}`;
  if (per === "week") return `week:${Math.floor(day / 7)}`;
  return calMonth ? `month:${calMonth}` : `month:${Math.floor(day / 30)}`;
}

/** Simple Calendar's year and month ("2045-2"), or null. */
function calendarMonth() {
  const sc = simpleCalendar();
  if (!sc) return null;
  try {
    const d = sc.timestampToDate(sc.timestamp());
    return `${d.year}-${d.month}`;
  } catch {
    return null;
  }
}

/**
 * A trip against a taxi perk: { lifestyle, per, key, ok, why: null|"used"|"zone" }, or null without a perk.
 * `used`: the character's apps.rideCredits row. Pure; rideCredit reads the world.
 */
export function creditFor(taxi, from, to, key, used = null) {
  if (!taxi) return null;
  const why = !taxi.anywhere && (from?.zone || to?.zone) ? "zone" : used?.key === key ? "used" : null;
  return { lifestyle: taxi.name, per: taxi.per, key, ok: !why, why };
}

/** A character's free ride for this trip, from their Lifestyle (see creditFor), or null. */
export function rideCredit(actor, from, to, credits = {}) {
  const taxi = lifestyleTaxi(actor);
  if (!taxi) return null;
  return creditFor(taxi, from, to, creditPeriod(taxi.per, game.time?.worldTime ?? 0, calendarMonth()), credits?.[actor.id]);
}

/** The line a ride's credit shows. */
export const creditLabel = c => `Covered by your ${c.lifestyle} Lifestyle`;

/** A cab number for the alerts ("Cabb 7-41"). */
export const cabNumber = (rand = Math.random) => `${1 + Math.floor(rand() * 9)}-${String(Math.floor(rand() * 100)).padStart(2, "0")}`;

/** A place as the GM wrote it, in range. */
export function cleanDistrict(d = {}) {
  const num = v => Math.round(Math.min(500, Math.max(-500, Number(v) || 0)) * 10) / 10;
  const name = String(d.name ?? "").trim().slice(0, 60) || "Place";
  return {
    id: String(d.id ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || foundry.utils.randomID(),
    name, x: num(d.x), y: num(d.y), zone: ZONES[d.zone] ? d.zone : null
  };
}

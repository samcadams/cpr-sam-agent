import { APP_IDS, APP_MANIFEST } from "../../scripts/apps/manifest.js";
import { MODULE_ID } from "../../scripts/config.js";
import { contentArt } from "../../scripts/model/content.js";
import { feature } from "../../scripts/model/features.js";
import { formatMoney } from "../../scripts/model/money.js";
import { bigSaaiBonus } from "../alex/model.js";
import { MONTH } from "../trauma/model.js";

/*
 * App Store (id "pool"; Ziggurat's app store, the proposal's "Ziggurat Pool"). While it's switched on (Control), a character's phone shows only the apps
 * installed on it; with it off, every app switched on in Control is on every phone, as before. Three layers:
 *   1. the world switch (Control, features.app_<id>): the app exists at all;
 *   2. the catalogue (world setting "pool", the GM's App Store page): price model, where it's offered,
 *      preinstalled or not;
 *   3. the installs (host table "installs", keyed by actorId): what's on this character's Agent.
 *
 * Catalogue entry (pool.apps[id], over CATALOGUE_DEFAULTS):
 *   { price, model: "free"|"once"|"monthly", offer: "store"|"fixer"|"hidden", preinstalled, publisher }
 *   offer:  store: listed in the store; fixer: never listed, only sideloaded (a Fixer's app package in a
 *           conversation, apps/pool/host.js); hidden: only the GM gives it.
 * Listings (pool.listings): flavor-only cards for apps that don't exist ("Coming soon"):
 *   [{ id, name, icon, img?, publisher, blurb, note }]   img: a full-colour picture tile, instead of icon
 * DEFAULT_LISTINGS (Black Chrome's apps not built yet) come first; the GM removing one adds its id to
 * pool.removedListings.
 * Switching the store on installs nothing: every character starts with only the preinstalled apps and gets
 * the rest from the store. (Rows with source "legacy" come from an earlier build that
 * kept existing phones' apps; they still count as installed.)
 *
 * Install row (installs[actorId][appId]):
 *   { source: "legacy"|"store"|"sideload"|"gm", at (ms), paid (eb, what was paid for it),
 *     removed?: true (uninstalled; a bought app reinstalls free), revoked?: reason (the GM took it),
 *     sub?: { status: "active"|"lapsed"|"cancelled", price, since, paidThrough (world time), sponsor? } }
 * Preinstalled apps have no row until something changes (the GM revokes one); they can't be uninstalled.
 *
 * Subscriptions (model "monthly"): nothing is charged by itself. Without another module, subscribing pays
 * the first month and the GM sends the monthly bill from the App Store's GM page; with one (CPR HQ, API
 * subscriptions.handOffBilling) subscribing charges nothing and the apps go on that module's bill.
 * A lapsed subscription keeps the app installed, locked behind "Renew".
 */

export const POOL = "pool";

export const MODELS = { free: "Free", once: "One-time", monthly: "Monthly" };
export const OFFERS = { store: "In the App Store", fixer: "Fixer only", hidden: "GM only" };
export const SOURCES = { legacy: "Had it already", store: "App Store", sideload: "Sideloaded", gm: "Given by the GM", cbk: "Bought through CBK" };

/** Reasons the GM's revoke offers (any text will do). */
export const REVOKE_REASONS = ["Bricked by a virus", "Confiscated", "License revoked by the publisher", "Removed"];

const ZIGGURAT = "Ziggurat";

/**
 * Defaults per app (the GM changes any of them). The free Ziggurat apps come preinstalled;
 * everything else is downloaded. Prices from All About Agents where it gives one
 * (BangMe! 10eb, WatchBox 50eb); the rest are free downloads until the GM prices them.
 */
export const CATALOGUE_DEFAULTS = {
  agent: { publisher: ZIGGURAT, preinstalled: true },
  garden: { publisher: ZIGGURAT, preinstalled: true },
  alex: { publisher: ZIGGURAT, preinstalled: true },
  screamsheet: { publisher: ZIGGURAT, preinstalled: true },
  notes: { publisher: ZIGGURAT, preinstalled: true },
  calendar: { publisher: ZIGGURAT, preinstalled: true },
  weather: { publisher: ZIGGURAT, preinstalled: true },
  pool: { publisher: ZIGGURAT, preinstalled: true },
  bangme: { publisher: "Eurobank", price: 10, model: "once" },
  market: { publisher: ZIGGURAT },
  trauma: { publisher: "Trauma Team International" },
  watchbox: { publisher: "No/Brainer", price: 50, model: "once" },
  cabb: { publisher: "Combat Cabb" },
  map: { publisher: ZIGGURAT },
  pigeon: {},
  ncart: { publisher: "NCART" },
  redline: { publisher: "NC Games LLC" },
  roach: { publisher: "NC Games LLC" },
  breach: { publisher: "Unspecified" },
  achieve: { publisher: "Mr. Amaze" },
  gacha: { publisher: "Mr. Amaze" },
  // All About Agents p. 8: 20eb (Everyday), once (the 2026-10-11 correction: not per day).
  hustool: { publisher: "No/Brainer", price: 20, model: "once" },
  // Black Chrome p. 13: 500eb (Expensive), bought on the CitiNet: in the store.
  ncpd: { publisher: "NCPD", price: 500, model: "once" },
  // All About Agents p. 7: 100eb, sold from Ask Alex's banner.
  bigsaai: { publisher: ZIGGURAT, price: 100, model: "once", offer: "hidden" },
  // Black Chrome p. 13: 100eb (Premium).
  fortify: { publisher: "SecSystems", price: 100, model: "once" },
  // Black Chrome p. 12: 20eb (Everyday).
  gladiator: { publisher: "Segotari", price: 20, model: "once" },
  // Going Quiet pp. 6-7: no publisher named.
  handscan: { publisher: "Unspecified", price: 20, model: "once" },
  retinascan: { publisher: "Unspecified", price: 50, model: "once" }
};

/**
 * Add-ons: catalogue entries that are not apps (no manifest app, no home tile). Each improves its `parent` app and
 * is bought there; the install row and the GM's grant/revoke work as for apps. `effect`: an Active Effect the host
 * keeps on the character while they have it (situational, on by default, so the roll dialog can switch it off).
 */
export const ADDONS = {
  // Big SAAI: on top of the Agent's own Library Search bonus (the GM's number, apps/alex/model.js bigSaaiBonus).
  bigsaai: { name: "Big SAAI", parent: "alex", effect: { key: "bonuses.librarySearch", value: bigSaaiBonus } }
};
export const ADDON_IDS = Object.keys(ADDONS);

/** The Active Effect an add-on puts on the character (null if it has none), flagged `cpr-sam-agent.addon`. */
export function addonEffect(id) {
  const addon = ADDONS[id];
  if (!addon?.effect) return null;
  const { key } = addon.effect;
  // A number, or a function giving the GM's current one.
  const value = typeof addon.effect.value === "function" ? addon.effect.value() : addon.effect.value;
  return {
    name: addon.name,
    img: "icons/svg/upgrade.svg",
    description: `<p>${addon.name}: +${value}, situational (untick it in the roll dialog when it doesn't apply).</p><p><em>An Agent add-on, managed by the App Store: it goes when the GM revokes it.</em></p>`,
    changes: [{ key, mode: 2, value: String(value) }], // 2: ADD
    // The CPR system's flags: a skill mod, situational and on by default.
    flags: { [MODULE_ID]: { addon: id }, "cyberpunk-red-core": { changes: { cats: { 0: "skill" }, situational: { 0: { isSituational: true, onByDefault: true } } } } }
  };
}

const BLANK = { price: 0, model: "free", offer: "store", preinstalled: false, publisher: "" };

/**
 * Black Chrome's apps (pp. 12-14) that aren't built yet (the NCPD Crime Database, 4Tify and Digital Gladiator are apps now, apps/ncpd/, apps/fortify/, apps/gladiator/), teased in the store with their own icons
 * Prices are the book's; ids stay put so the GM's removals stick.
 */
// A listing's `art` picture from the content folder (model/content.js), when it has one; else its icon.
const BC_ICON = ({ art, ...l }) => {
  const img = contentArt(`apps/${art}.webp`);
  return img ? { ...l, img } : l;
};
export const DEFAULT_LISTINGS = [
  { id: "bc-citydb", name: "Ziggurat City Database", art: "ziggurat-city-database", publisher: ZIGGURAT, blurb: "Know a city's neighbourhoods and communities like a local. 100eb per city.", note: "Coming soon" }
].map(l => ({ icon: "fas fa-mobile-screen", ...l }));

/** The GM's catalogue, filled in: { apps: { [id]: Entry }, listings: [Listing] }. */
export function poolConfig(raw = game.settings.get(MODULE_ID, "pool")) {
  const saved = raw ?? {};
  const apps = Object.fromEntries([...APP_IDS, ...ADDON_IDS].map(id => {
    const entry = { ...BLANK, ...CATALOGUE_DEFAULTS[id], ...(saved.apps?.[id] ?? {}) };
    entry.price = Math.max(0, Math.floor(Number(entry.price) || 0));
    if (!(entry.model in MODELS)) entry.model = "free";
    if (!(entry.offer in OFFERS)) entry.offer = "store";
    if (entry.model === "free") entry.price = 0;
    // The App Store is always there (it's how everything else gets on the phone).
    if (id === POOL) Object.assign(entry, { preinstalled: true, model: "free", price: 0, offer: "hidden" });
    // An add-on is bought once, inside its app.
    if (ADDONS[id]) Object.assign(entry, { preinstalled: false, model: entry.price ? "once" : "free", offer: "hidden", addon: ADDONS[id].parent });
    return [id, entry];
  }));
  const removed = new Set(Array.isArray(saved.removedListings) ? saved.removedListings : []);
  const listings = [...DEFAULT_LISTINGS.filter(l => !removed.has(l.id)).map(BC_ICON), ...(Array.isArray(saved.listings) ? saved.listings : [])]
    .filter(l => l?.id && l.name);
  return { apps, listings };
}

/** Is the App Store switched on (so phones show only what's installed)? */
export const poolOn = () => !!feature(`app_${POOL}`);

/** "Free", "10eb", "50eb/mo". */
export function priceLabel(entry) {
  if (!entry || entry.model === "free" || !entry.price) return "Free";
  return entry.model === "monthly" ? `${formatMoney(entry.price)}/mo` : formatMoney(entry.price);
}

/** A character's rows: { [appId]: Row }. */
export const rowsOf = (installs, actorId) => installs?.[actorId] ?? {};

/** Is this app on the character's Agent (installed and not taken away)? Lapsed ones are still installed. */
export function isInstalled(installs, actorId, id, cfg = poolConfig()) {
  if (!(id in APP_MANIFEST)) return false;
  if (id === POOL) return true;
  const row = rowsOf(installs, actorId)[id];
  if (row?.revoked) return false;
  if (cfg.apps[id]?.preinstalled) return true;
  return !!row && !row.removed;
}

/** Does the character have this add-on (bought or given, not revoked)? With the App Store on or off. */
export function hasAddon(installs, actorId, id) {
  const row = rowsOf(installs, actorId)[id];
  return !!ADDONS[id] && !!row && !row.removed && !row.revoked;
}

/** Every app installed on a character's Agent (whether or not the GM has it switched on). */
export function installedSet(installs, actorId, cfg = poolConfig()) {
  return new Set(APP_IDS.filter(id => isInstalled(installs, actorId, id, cfg)));
}

/** Locked behind "Renew": installed, a monthly app, and its subscription lapsed. */
export function isLapsed(installs, actorId, id, cfg = poolConfig()) {
  const row = rowsOf(installs, actorId)[id];
  return cfg.apps[id]?.model === "monthly" && row?.sub?.status === "lapsed" && isInstalled(installs, actorId, id, cfg);
}

/** Did the character buy (or get) it before, so it reinstalls without paying again? Once-paid apps only. */
export function owned(row, entry) {
  if (!row || row.revoked) return false;
  if (entry.model === "monthly") return false;
  return true; // any row: paid for it, or it was given (legacy, the GM, a sideload)
}

/**
 * What the player can do with an app in the store: "open" (installed), "renew" (lapsed), "get"
 * (free, or owned before), "buy" (one-time price), "subscribe" (monthly).
 */
export function storeAction(installs, actorId, id, cfg = poolConfig()) {
  const entry = cfg.apps[id];
  const row = rowsOf(installs, actorId)[id];
  if (isLapsed(installs, actorId, id, cfg)) return "renew";
  if (isInstalled(installs, actorId, id, cfg)) return "open";
  if (entry.model === "monthly" && entry.price) return "subscribe";
  if (entry.model === "once" && entry.price && !owned(row, entry)) return "buy";
  return "get";
}

/** Apps that only work with another module (HusTool's hustles are CPR HQ's downtime): sold only while it's active. */
export const NEEDS_MODULE = { hustool: "cpr-hq" };

/** Is it for sale in the store (offered there, and any module it needs is active)? */
export const inStore = (id, entry) => entry.offer === "store" && (!NEEDS_MODULE[id] || !!game.modules.get(NEEDS_MODULE[id])?.active);

/**
 * Apps the store lists for a character: switched on, and for sale in the store, installed, or theirs from
 * before (an uninstalled Fixer-only or GM-given app, so it can be reinstalled).
 */
export function storeApps(installs, actorId, cfg = poolConfig(), on = id => feature(`app_${id}`)) {
  const listed = id => inStore(id, cfg.apps[id]) || isInstalled(installs, actorId, id, cfg) || owned(rowsOf(installs, actorId)[id], cfg.apps[id]);
  return APP_IDS.filter(id => id !== POOL && on(id) && listed(id));
}

/**
 * A character's subscriptions (not cancelled, and the app still monthly: one the GM made free or
 * one-time stops billing): [{ app, price, status, since, paidThrough, sponsor }].
 */
export function subscriptionsOf(installs, actorId, cfg = poolConfig()) {
  return Object.entries(rowsOf(installs, actorId))
    .filter(([id, row]) => row.sub && row.sub.status !== "cancelled" && !row.revoked && !row.removed && cfg.apps[id]?.model === "monthly")
    .map(([app, row]) => ({ app, ...row.sub, price: Number(row.sub.price) || 0, sponsor: row.sub.sponsor ?? null }));
}

/** What a month of a character's subscriptions costs: active ones nobody else pays for. */
export const monthlyTotal = subs => subs.filter(s => s.status === "active" && !s.sponsor).reduce((n, s) => n + s.price, 0);

/** Subscriptions whose month ran out (world time), for the GM's bill reminder. Not while another module bills them. */
export const isDue = (sub, now = game.time.worldTime) => sub.status === "active" && !sub.sponsor && (sub.paidThrough ?? 0) <= now;

/** The next month after a payment: from when it ran out, or from now if that's long gone. */
export const nextPaidThrough = (sub, now = game.time.worldTime) => Math.max(sub?.paidThrough ?? 0, now) + MONTH;

/**
 * Another module that bills subscriptions instead of the Agent (API subscriptions.handOffBilling), e.g.
 * "CPR HQ" with its Lifestyle bill; null when the GM bills them from the App Store. Set on each client every
 * session, like Trauma Team's (apps/trauma/model.js).
 */
let billedBy = null;
export const subsBilledBy = () => billedBy;
export function setSubsBilledBy(name) {
  billedBy = name ? String(name).trim().slice(0, 40) || null : null;
}

/** A character's subscriptions as other modules see them (API subscriptions.state). */
export function subscriptionState(installs, actorId, cfg = poolConfig()) {
  const names = id => APP_MANIFEST[id]?.name ?? id;
  const items = subscriptionsOf(installs, actorId, cfg).map(s => ({ ...s, name: names(s.app) }));
  return { items, total: monthlyTotal(items), billedBy };
}

/** A listing the GM typed in, tidied: { id, name, icon, img?, publisher, blurb, note }. */
export function cleanListing(raw, id = raw?.id) {
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const name = str(raw?.name, 40);
  if (!name) return null;
  const icon = /^fa[srlbd]? fa-[a-z0-9-]+$/.test(str(raw?.icon, 60)) ? str(raw.icon, 60) : "fas fa-mobile-screen";
  // A picture: an image path under Data (a FilePicker path), nothing that could leave the server.
  const img = /^[\w\-./ %]+\.(webp|png|jpe?g|gif|svg|avif)$/i.test(str(raw?.img, 200)) && !str(raw.img, 200).includes("..") ? str(raw.img, 200) : null;
  return { id: str(id, 32) || null, name, icon, ...(img ? { img } : {}), publisher: str(raw?.publisher, 40), blurb: str(raw?.blurb, 160), note: str(raw?.note, 40) || "Coming soon" };
}

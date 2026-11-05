import { MODULE_ID } from "../../scripts/config.js";
import { clampQty, boughtItems, hashOf, itemPrice, linesTotal, listPrice as markedUp, loadCatalogue, MAX_QTY, packLabel, publicPack, itemPacks, INDEX_FIELDS } from "../../scripts/model/shop.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";

// The shop helpers this model has always offered (now in scripts/model/shop.js).
export { clampQty, hashOf, INDEX_FIELDS, itemPrice, linesTotal, MAX_QTY, packLabel, publicPack };

/*
 * Great River (id "market"; "NC Market" until 2026-10-21): Ziggurat's pilot store (Black Chrome p. 156).
 * Customers order and pay over the CitiNet and a Transporter drone delivers within an hour, to parts of the
 * rebuilding city only. Players browse world items and Item compendiums within the GM's price limits, fill a
 * cart and send it as an order (as many orders as they like, unless the GM caps them). The GM approves or
 * denies each order on the GM Phone; approving charges them through BangMe! and sends the drone, which puts
 * the items in the character's gear when it lands (or at once, with instant delivery).
 *
 * Pricing (setup "pricing"): "cap", the canon store: stores only carry things of 100eb (Premium) or less
 * (Black Chrome p. 156), the rest is a Fixer's business. "fee": no such cap, but every order pays a delivery
 * fee (deliveryFee eb + deliveryPct % of the items). The GM's own lowest/highest prices apply in both.
 *
 * Delivery (setup "delivery"): "drone": an approved order is "shipping" for etaMin..etaMax minutes, then the
 * host's clock (apps/market/host.js _tickMarket) delivers it when that much world time **or** real time has
 * gone by, whichever comes first (a GM who never moves the clock still gets deliveries). The GM can deliver
 * at once. "instant": approving puts the items in the gear at once, as NC Market did.
 *
 * Setup (world setting "market", over MARKET_DEFAULTS; the GM's Setup tab):
 *   { worldItems, worldFolder ("" = every world item), packs (collection ids; null = every Item compendium),
 *     pricing ("cap"|"fee"), deliveryFee, deliveryPct, delivery ("drone"|"instant"), etaMin, etaMax (minutes),
 *     types, minPrice, maxPrice (0 = no limit), ignoreBlankPrice, markup (%), maxPending (per character,
 *     0 = no limit), allowOverBudget, featured, deals (how many of each a day; 0 = none), dealOff (the
 *     biggest discount, %), reroll (bumped by the GM to draw the day's picks again),
 *     blocked: { [uuid]: "hide" (not listed) | "off" (listed as unavailable) } }
 *   Blank price = system.price.market missing or 0. Ignore blank price on (default): not offered. Off: offered
 *   as "price on request", outside the limits; the GM sets the price before approving.
 *   The limits apply to the list price (market price × markup ÷ 100, rounded up).
 *
 * The day's picks (dailyPicks): Featured items and Hot Deals (10 % to dealOff % off, in steps of 5), drawn
 * anew each in-world day (the phones' date: Simple Calendar, or whatever the GM's clock follows). Nothing
 * is stored: every client ranks each item by a hash of (day, reroll, uuid), so the host charges the same
 * deal price the player saw. Drawn only from what every player can see (world items, compendiums with
 * Observer for players), so players with the same view agree with the host.
 *
 * Orders (host table "orders", owner actorId, one row per order):
 *   { id, actorId, userId, status: pending|shipping|approved (delivered)|denied|cancelled, ts, time, date, note,
 *     lines: [{ uuid, name, img, type, price (null = price on request), qty, off? (Hot Deal %), was? (list price) }],
 *     fee (delivery fee), total (lines + fee), decidedAt?, gmNote?,
 *     drone?: { minutes, world (world time it lands), real (ms it lands) }, deliveredAt? }
 */

export const MARKET = "market";

/** The store's name everywhere players see it (the app's default name; the GM can rename the app in Control). */
export const STORE_NAME = "Great River";

export const STATUS = { pending: "Pending", shipping: "Drone en route", approved: "Delivered", denied: "Denied", cancelled: "Cancelled" };

/** Black Chrome p. 156: stores carry things of 100eb (Premium) or less. */
export const STORE_CAP = 100;

export const PRICING = { cap: "Canon store: 100eb (Premium) and under", fee: "No cap, with a delivery fee" };
export const DELIVERY = { drone: "Transporter drone, within the hour", instant: "Instant (in the gear on approval)" };

/** Item types on sale by default: what a character carries, not roles, skills, injuries or NET architectures. */
export const DEFAULT_TYPES = ["ammo", "armor", "clothing", "cyberdeck", "cyberware", "drug", "gear", "itemUpgrade", "program", "vehicle", "weapon"];

export const MARKET_DEFAULTS = Object.freeze({
  pricing: "cap",
  deliveryFee: 20,
  deliveryPct: 10,
  delivery: "drone",
  etaMin: 20,
  etaMax: 60,
  worldItems: true,
  worldFolder: "",
  packs: null,
  types: DEFAULT_TYPES,
  minPrice: 0,
  maxPrice: 0,
  ignoreBlankPrice: true,
  markup: 100,
  maxPending: 0,
  allowOverBudget: false,
  featured: 4,
  deals: 5,
  dealOff: 30,
  reroll: 0,
  blocked: {}
});

/** What the GM can do to one item: hide it, or list it as unavailable. */
export const BLOCKS = { hide: "Hidden", off: "Unavailable" };

const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== "" && value !== null ? Math.max(0, Number(value)) : fallback);

/** A setup object with every field present and sane. */
export function cleanConfig(raw = {}) {
  const c = { ...MARKET_DEFAULTS, ...(raw ?? {}) };
  const etaMin = Math.min(240, Math.max(1, Math.floor(num(c.etaMin, 20)) || 1));
  return {
    pricing: c.pricing in PRICING ? c.pricing : "cap",
    deliveryFee: Math.floor(num(c.deliveryFee, 20)),
    deliveryPct: Math.min(100, Math.floor(num(c.deliveryPct, 10))),
    delivery: c.delivery in DELIVERY ? c.delivery : "drone",
    etaMin,
    etaMax: Math.min(240, Math.max(etaMin, Math.floor(num(c.etaMax, 60)))),
    worldItems: !!c.worldItems,
    worldFolder: typeof c.worldFolder === "string" ? c.worldFolder : "",
    packs: Array.isArray(c.packs) ? c.packs.filter(p => typeof p === "string") : null,
    types: Array.isArray(c.types) ? c.types.filter(t => typeof t === "string") : [...DEFAULT_TYPES],
    minPrice: Math.floor(num(c.minPrice, 0)),
    maxPrice: Math.floor(num(c.maxPrice, 0)),
    ignoreBlankPrice: !!c.ignoreBlankPrice,
    markup: Math.floor(num(c.markup, 100)) || 100,
    maxPending: Math.floor(num(c.maxPending, 0)),
    allowOverBudget: !!c.allowOverBudget,
    featured: Math.min(12, Math.floor(num(c.featured, 4))),
    deals: Math.min(12, Math.floor(num(c.deals, 5))),
    dealOff: Math.min(90, Math.max(10, Math.floor(num(c.dealOff, 30)))),
    reroll: Math.floor(num(c.reroll, 0)),
    blocked: Object.fromEntries(Object.entries(c.blocked && typeof c.blocked === "object" ? c.blocked : {}).filter(([, how]) => how in BLOCKS))
  };
}

export const marketConfig = () => cleanConfig(game.settings.get(MODULE_ID, MARKET));

/** What the market charges for a market price: × markup ÷ 100, rounded up. */
export const listPrice = (base, config) => markedUp(base, config.markup);

/** The highest list price on sale (0 = no limit): the GM's own, and with canon pricing at most STORE_CAP. */
export function highestPrice(config) {
  if (config.pricing !== "cap") return config.maxPrice;
  return config.maxPrice > 0 ? Math.min(config.maxPrice, STORE_CAP) : STORE_CAP;
}

/** Whether a catalogue entry is on sale under the setup's types and price limits. */
export function inStock(entry, config) {
  if (!config.types.includes(entry.type)) return false;
  if (config.blocked?.[entry.uuid] === "hide") return false;
  if (entry.price == null) return !config.ignoreBlankPrice;
  if (entry.price < config.minPrice) return false;
  const max = highestPrice(config);
  return !(max > 0 && entry.price > max);
}

/** The delivery fee for items worth `items` eb: none at canon pricing; else the flat fee + a share. */
export function deliveryFee(items, config) {
  if (config.pricing !== "fee" || items <= 0) return 0;
  return config.deliveryFee + Math.ceil((items * config.deliveryPct) / 100);
}

/** An order's total: its lines (price on request counts 0) + the delivery fee. */
export const orderTotal = (lines, config) => {
  const items = linesTotal(lines);
  return { items, fee: deliveryFee(items, config), total: items + deliveryFee(items, config) };
};

/** How many minutes a drone takes, between etaMin and etaMax (rand: 0..1). */
export const droneMinutes = (config, rand = Math.random()) => config.etaMin + Math.floor(rand * (config.etaMax - config.etaMin + 1));

/** A drone sent now for `minutes`: when it lands, in world time and real time. */
export const droneFor = (minutes, worldTime, now) => ({ minutes, world: worldTime + minutes * 60, real: now + minutes * 60_000 });

/** Has the drone landed: that much world time or real time has gone by, whichever comes first. */
export const droneLanded = (drone, worldTime, now) => !!drone && (worldTime >= drone.world || now >= drone.real);

/** 0..1: how far the drone is (the further of world time and real time). */
export function droneProgress(drone, worldTime, now) {
  if (!drone) return 0;
  const span = drone.minutes * 60;
  const world = 1 - (drone.world - worldTime) / span;
  const real = 1 - (drone.real - now) / (span * 1000);
  return Math.min(1, Math.max(0, world, real));
}

/** Today in the phones' world: the Agent's date ("Spring, Day 7, 2045"), or the world-time day without one. */
export const dayKey = () => agentTimestamp().date ?? `day ${Math.floor((game.time?.worldTime ?? 0) / 86400)}`;

/**
 * The day's picks from on-sale entries ({ uuid, price, disabled? }): `featured` (uuids) and `deals`
 * (uuid → % off; priced entries only). Unavailable entries are never picked. An entry's rank depends only
 * on (day, reroll, uuid), not on which other entries are there.
 */
export function dailyPicks(entries, config, day) {
  const seed = `${day}|${config.reroll}|`;
  const ranked = entries.filter(e => !e.disabled).map(e => ({ e, score: hashOf(seed + e.uuid) }))
    .sort((a, b) => a.score - b.score || (a.e.uuid < b.e.uuid ? -1 : 1));
  const featured = ranked.slice(0, config.featured).map(r => r.e.uuid);
  const steps = Math.floor((config.dealOff - 10) / 5) + 1;
  const deals = new Map();
  for (const { e } of ranked.slice(config.featured)) {
    if (deals.size >= config.deals) break;
    if (e.price != null) deals.set(e.uuid, 10 + 5 * (hashOf(`${seed}deal|${e.uuid}`) % steps));
  }
  return { featured, deals };
}

/** A list price with `off` % taken off, rounded up (never free). */
export const dealPrice = (price, off) => Math.max(1, Math.ceil((price * (100 - off)) / 100));

/**
 * What's on sale today, priced: entries with `disabled` (the GM made it unavailable), `featured`, and for
 * Hot Deals `off` and `was` (the list price; `price` is the deal price). Hidden entries are left out
 * unless `withHidden` (then marked `hidden`).
 */
export function priceToday(entries, config, day, { withHidden = false } = {}) {
  const shown = entries.filter(e => inStock(e, config) || (withHidden && inStock(e, { ...config, blocked: {} })))
    .map(e => ({ ...e, hidden: config.blocked[e.uuid] === "hide", disabled: !!config.blocked[e.uuid] }));
  const { featured, deals } = dailyPicks(shown.filter(e => e.public !== false && !e.hidden), config, day);
  const top = new Set(featured);
  const out = shown.map(e => {
    const off = deals.get(e.uuid);
    return off ? { ...e, off, was: e.price, price: dealPrice(e.price, off), featured: false } : { ...e, featured: top.has(e.uuid) };
  });
  const byUuid = new Map(out.map(e => [e.uuid, e]));
  return { entries: out, byUuid, featured: featured.map(u => byUuid.get(u)), deals: [...deals.keys()].map(u => byUuid.get(u)) };
}

/** A character's orders, newest first. */
export const ordersOf = (orders, actorId) => Object.values(orders ?? {}).filter(o => o.actorId === actorId).sort((a, b) => b.ts - a.ts);

export const pendingOf = (orders, actorId) => ordersOf(orders, actorId).filter(o => o.status === "pending");

/** Eddies a character has promised to their pending orders. */
export const committedOf = (orders, actorId) => pendingOf(orders, actorId).reduce((sum, o) => sum + (o.total ?? 0), 0);

/** Every pending order, oldest first (the GM's queue). */
export const queueOf = orders => Object.values(orders ?? {}).filter(o => o.status === "pending").sort((a, b) => a.ts - b.ts);

/** Every order a drone is carrying, the first to land first. */
export const shippingOf = orders => Object.values(orders ?? {}).filter(o => o.status === "shipping").sort((a, b) => (a.drone?.real ?? 0) - (b.drone?.real ?? 0));

/**
 * Why an order can't be placed, or null. `wealth` null = no wallet (never over budget).
 * @param {{ lines, config, wealth, committed, pending }} order
 */
export function orderProblem({ lines, config, wealth, committed = 0, pending = 0 }) {
  if (!lines.length) return "Your cart is empty.";
  if (config.maxPending > 0 && pending >= config.maxPending) return `You already have ${pending} order${pending === 1 ? "" : "s"} waiting. Cancel one or wait for it.`;
  const { total } = orderTotal(lines, config);
  if (!config.allowOverBudget && wealth !== null && total + committed > wealth) return "That's more than you can spend: your balance minus your orders waiting.";
  return null;
}

/** Item data for `qty` of one item ordered here (flags.cpr-sam-agent.market; see shop.js boughtItems). */
export const orderedItems = (source, qty, flag) => boughtItems(source, qty, flag, "market");

/* ---------------- The catalogue (Foundry only) ---------------- */

/** Item compendiums the setup sells from. */
export const sourcePacks = config => itemPacks(config.packs);

let cache = null;
let version = 0;

/** Forget the catalogue (a world item or the setup changed). */
export function invalidateCatalogue() {
  cache = null;
  version++;
}

/** Goes up each time the catalogue is forgotten, so a phone knows its copy is stale. */
export const catalogueVersion = () => version;

async function build(config) {
  const { entries, skipped } = await loadCatalogue(config);
  return { entries: entries.map(({ base, ...e }) => ({ ...e, price: listPrice(base, config) })), skipped };
}

/** Everything the setup's sources hold, priced: { entries, skipped (compendiums this client can't see) }. */
export function catalogue(config = marketConfig()) {
  const key = JSON.stringify([config.worldItems, config.worldFolder, config.packs, config.markup]);
  if (cache?.key !== key) cache = { key, promise: build(config) };
  return cache.promise;
}

/**
 * Only what's on sale today (priceToday): { entries, byUuid, featured, deals, skipped }. `gm`: the GM's
 * Shop tab, i.e. what players see (public sources only) plus the hidden items.
 */
export async function stock(config = marketConfig(), { gm = false, day = dayKey() } = {}) {
  const { entries, skipped } = await catalogue(config);
  return { ...priceToday(gm ? entries.filter(e => e.public) : entries, config, day, { withHidden: gm }), skipped };
}

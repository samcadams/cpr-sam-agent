import { MODULE_ID } from "../../scripts/config.js";
import { APP_MANIFEST } from "../../scripts/apps/manifest.js";
import { formatMoney, priceTierKey } from "../../scripts/model/money.js";
import { PRESETS } from "./presets.js";

/*
 * CBK ("Cee Book"), Black Chrome's Night Market companion app (pp. 6-8). A Fixer builds a database of listings
 * and pushes GO LIVE; customers at the Night Market open CBK, find the database, browse it by category or
 * search, and tap BUY NOW!!! from anywhere in the market. They pick the item up later at its booth by showing
 * the receipt on their Agent. Few Fixers refund.
 *
 * On our phone: a market is "in range" whenever the GM has it live (no scene or anchor).
 * Buying charges at once (BangMe!) and writes a receipt; the item goes in the gear only when the character
 * shows the receipt at the booth (Pick up), which works only while that market is still live. The GM can hand
 * a receipt over or refund it from the GM Phone. The Fixer broadcasts to every phone while the market is live:
 * flash sales (a real discount for N minutes), raid warnings (over the whole phone screen), policy
 * reminders, the next market date. Apps have no booth: BUY NOW!!! installs them through the App Store
 * (source "cbk"). An invite-only market shows only to characters holding an invite; a Super Luxury listing
 * can go to auction; Rex's game wins one character a one-time discount. Later (not built): PC Fixers.
 *
 * Setup (world setting "cbk"): { markets: [Market] }
 *   Market:  { id, letter, name, fixer, where, rules, live, booths: { "1": "Cyberfingers" }, listings: [Listing],
 *              broadcasts: [Broadcast] (newest first, at most MAX_BROADCASTS),
 *              access: { mode: "open"|"invite", passcode }, fixerContact (a contact's name; "" = no
 *              Message the Fixer), game ("rex" = Rex's game on its listings; "" = none) }
 *   Broadcast: { id, kind (BROADCAST_KINDS key), text, ts, until? (ms; a flash sale's or raid's end), pct? (flash),
 *              target? ({ listingId } | { category }, flash), by? ("NCPD" | "hostiles", raid) }
 *   Listing: { id, uuid (null = no item found: a plain gear item by that name is handed over), name, img, type,
 *              corp, category (CATEGORIES key), sub, booths: ["A1"], price, stock (null = as many as they like),
 *              hidden?, app? (an app id: installed on BUY NOW!!!, category "apps", no booths, no stock) }
 * Receipts (host table "receipts", owner actorId): { id, actorId, userId, marketId, market, letter, listingId,
 *   uuid, name, img, booths, price, ts, time, date, status: paid|picked|refunded, doneAt? }
 * Stock left (host table "cbkStock", everyone sees it): { "<marketId>:<listingId>": { id, marketId, listingId,
 *   stock, base, everyone } }. Only the host writes it (buys, refunds, the GM's stock edits as a request), so a
 *   sale and a GM edit can't overwrite each other. A listing's `stock` in the setting is what the GM set it to;
 *   a row wins over it while the setting still says `base` (the value the row started from), so re-saving a
 *   stale copy keeps the sales, and a new value written to the setting by hand (a macro) counts again. A
 *   listing with stock null (as many as they like) ignores its row.
 * Invites held (host table "cbkInvites", owner actorId): { "<actorId>:<marketId>": { id, actorId, marketId, at, via:
 *   "passcode" } }. A carried item flagged flags.cpr-sam-agent.cbkInvite = marketId also lets its holder in, so giving
 *   or stealing it moves the access.
 * Auctions (host table "cbkAuctions", everyone sees it; the host only, like the stock): { "<marketId>:<listingId>":
 *   { id, marketId, listingId, market, name, status: open|sold|closed, reserve, bids: [{ actorId, userId, amount, ts }]
 *   (lowest first), everyone } }. Only the high bid is held: its money left the bidder's wallet and goes back when
 *   they're outbid, or the auction is cancelled or the market closes. Sold! keeps it and writes the receipt.
 * Rex's game (host table "cbkDeals", owner actorId): { "<marketId>:<listingId>:<actorId>": { id, actorId, userId,
 *   marketId, listingId, name, status: pending|won|lost|used, pct?, ts } }, dropped when the market closes (so one
 *   play per listing per character per opening; an unused discount goes with it).
 */

export const CBK = "cbk";

/** The book's category screen (p. 10), in its order and colours. */
export const CATEGORIES = {
  cyberware: { label: "Cyberware", color: "#f6a01a" },
  fashion: { label: "Fashion and Armor", color: "#e8197d" },
  gear: { label: "General Goods", color: "#2f8fd6" },
  frames: { label: "Linear Frames", color: "#7c72b8" },
  vehicles: { label: "Vehicles", color: "#7d7d33" },
  weapons: { label: "Weapons", color: "#111111" },
  apps: { label: "Apps", color: "#0f8f8a" }
};

/** What a Fixer can push to every phone at the market (Black Chrome p. 7). */
export const BROADCAST_KINDS = {
  flash: { label: "Flash sale", icon: "fa-bolt" },
  raid: { label: "Raid warning", icon: "fa-person-military-pointing" },
  policy: { label: "Policy reminder", icon: "fa-scale-balanced" },
  date: { label: "Next market date", icon: "fa-calendar-day" }
};
export const RAIDERS = { NCPD: "NCPD raid", hostiles: "Hostiles" };
export const MAX_BROADCASTS = 20;

/** Ways to hold an invite: typed from a message, or a carried item. */
export const INVITE_ROUTES = { passcode: "Passcode", card: "Signed playing card", courier: "Courier invitation" };
/** Rex's game: the discount a win gives. */
export const REX_PCT = 20;
/** Auctions: the smallest raise is 10% of the last bid, or this. */
export const MIN_RAISE = 100;

export const RECEIPT_STATUS = { paid: "Ready for pick-up", picked: "Picked up", refunded: "Refunded" };

const str = (v, n) => String(v ?? "").trim().slice(0, n);
const int = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(0, Math.floor(Number(v))) : fallback);
const BOOTH = /^[A-Z]\d{1,2}$/;

/** Booth codes from what the GM typed: "c1 / E3" → ["C1", "E3"]. */
export const parseBooths = text => [...new Set(String(text ?? "").toUpperCase().match(/[A-Z]\d{1,2}/g) ?? [])].slice(0, 6);

/** The category an item goes under when the GM adds it by hand (presets carry the book's own). */
export function categoryOf(type, name = "") {
  if (/linear frame/i.test(name)) return "frames";
  if (type === "cyberware") return "cyberware";
  if (type === "armor" || type === "clothing") return "fashion";
  if (type === "vehicle") return "vehicles";
  if (type === "weapon" || type === "ammo") return "weapons";
  return "gear";
}

export function cleanListing(raw) {
  const name = str(raw?.name, 80);
  if (!name) return null;
  const stock = raw?.stock === null || raw?.stock === undefined || raw?.stock === "" ? null : int(raw.stock, 0);
  // An app: no item, no booth, no stock; BUY NOW!!! installs it.
  if (raw.app in APP_MANIFEST) {
    return { id: str(raw.id, 24) || null, uuid: null, name, img: null, type: "app", corp: str(raw.corp, 60), category: "apps", sub: str(raw.sub, 40), booths: [], price: int(raw.price, 0), stock: null, hidden: !!raw.hidden, app: raw.app };
  }
  return {
    id: str(raw.id, 24) || null,
    uuid: typeof raw.uuid === "string" && raw.uuid ? raw.uuid : null,
    name, img: typeof raw.img === "string" ? raw.img : null, type: str(raw.type, 30) || "gear",
    corp: str(raw.corp, 60), category: raw.category in CATEGORIES ? raw.category : "gear", sub: str(raw.sub, 40),
    booths: (Array.isArray(raw.booths) ? raw.booths : parseBooths(raw.booths)).filter(b => BOOTH.test(b)),
    price: int(raw.price, 0), stock, hidden: !!raw.hidden
  };
}

export function cleanBroadcast(raw) {
  if (!(raw?.kind in BROADCAST_KINDS)) return null;
  const b = { id: str(raw.id, 24) || null, kind: raw.kind, text: str(raw.text, 300), ts: Number(raw.ts) || 0 };
  if (!b.id || !b.ts) return null;
  if (Number.isFinite(Number(raw.until)) && raw.until) b.until = Number(raw.until);
  if (b.kind === "flash") {
    b.pct = Math.min(90, Math.max(1, int(raw.pct, 10)));
    if (typeof raw.target?.listingId === "string") b.target = { listingId: str(raw.target.listingId, 24) };
    else if (raw.target?.category in CATEGORIES) b.target = { category: raw.target.category };
    else return null;
  }
  if (b.kind === "raid") b.by = raw.by in RAIDERS ? raw.by : "NCPD";
  return b;
}

/** Who may enter a market: everyone unless the GM makes it invite-only. */
export function cleanAccess(raw) {
  return raw?.mode === "invite" ? { mode: "invite", passcode: str(raw.passcode, 40) } : { mode: "open", passcode: str(raw?.passcode, 40) };
}

export function cleanMarket(raw) {
  const name = str(raw?.name, 60);
  if (!name) return null;
  const letter = /^[A-Z]$/.test(raw.letter) ? raw.letter : "";
  const booths = Object.fromEntries(Object.entries(raw.booths && typeof raw.booths === "object" ? raw.booths : {})
    .filter(([k]) => /^\d{1,2}$/.test(k)).map(([k, v]) => [k, str(v, 40)]));
  return {
    id: str(raw.id, 24) || null, letter, name, fixer: str(raw.fixer, 60), where: str(raw.where, 120), rules: str(raw.rules, 300),
    access: cleanAccess(raw.access), fixerContact: str(raw.fixerContact, 60), game: raw.game === "rex" ? "rex" : "",
    live: !!raw.live, booths, listings: (Array.isArray(raw.listings) ? raw.listings : []).map(cleanListing).filter(Boolean),
    broadcasts: (Array.isArray(raw.broadcasts) ? raw.broadcasts : []).map(cleanBroadcast).filter(Boolean).sort((a, b) => b.ts - a.ts).slice(0, MAX_BROADCASTS)
  };
}

export const cleanConfig = raw => ({ markets: (Array.isArray(raw?.markets) ? raw.markets : []).map(cleanMarket).filter(m => m?.id) });

/** The markets, with each listing's stock left from the host table `stock` (store.apps.cbkStock). */
export const cbkConfig = stock => withStock(cleanConfig(game.settings.get(MODULE_ID, CBK)), stock);

export const stockKey = (marketId, listingId) => `${marketId}:${listingId}`;

/** Put the stock left (table "cbkStock") on a clean config's listings. */
export function withStock(config, stock) {
  for (const m of config.markets) {
    for (const l of m.listings) {
      const row = stock?.[stockKey(m.id, l.id)];
      if (l.stock !== null && row?.base === l.stock && Number.isFinite(row.stock)) l.stock = int(row.stock, l.stock);
    }
  }
  return config;
}

/** The markets broadcasting right now (the GM pushed GO LIVE). */
export const liveMarkets = config => config.markets.filter(m => m.live);

export const marketOf = (config, id) => config.markets.find(m => m.id === id) ?? null;

export const listingOf = (market, id) => market?.listings.find(l => l.id === id) ?? null;

/** What a customer sees: listings not hidden. */
export const shownListings = market => (market?.listings ?? []).filter(l => !l.hidden);

export const soldOut = listing => listing.stock !== null && listing.stock <= 0;

/** "Pick-up or Browse at Booth C1/E3". */
export const boothLine = booths => (booths?.length ? `Pick-up or Browse at Booth ${booths.join("/")}` : "Ask the Fixer where to pick it up");

/** A booth's name on the market's map legend ("C3" → "Cyberware"), or "". */
export const boothName = (market, code) => market?.booths?.[String(code).slice(1)] ?? "";

/** Is this broadcast still running (a flash sale or raid before its end; the others always are)? */
export const broadcastOn = (b, now = Date.now()) => !b.until || b.until > now;

/** The flash sale on a listing right now (the biggest discount wins, no stacking), or null. */
export function flashOf(market, listing, now = Date.now()) {
  if (!market?.live || !listing) return null;
  return (market.broadcasts ?? []).filter(b => b.kind === "flash" && broadcastOn(b, now)
    && (b.target.listingId ? b.target.listingId === listing.id : b.target.category === listing.category))
    .reduce((best, b) => (!best || b.pct > best.pct ? b : best), null);
}

/** What a listing costs right now: its flash sale or the character's own discount off (the bigger one, no stacking). */
export function priceNow(market, listing, now = Date.now(), dealPct = 0) {
  const pct = Math.max(flashOf(market, listing, now)?.pct ?? 0, dealPct);
  return pct ? Math.round(listing.price * (100 - pct) / 100) : listing.price;
}

/** An Agent alert's `ref.type` when it carries a broadcast (with `marketId`, `broadcastId`). */
export const BROADCAST_REF = "cbk-broadcast";

/** This character's broadcasts waiting to be shown on the phone, newest first: not dismissed, and still running. */
export function pendingBroadcasts(alerts, actorId, config, now = Date.now()) {
  return Object.values(alerts ?? {}).flatMap(alert => {
    if (alert.actorId !== actorId || alert.cleared || alert.ref?.type !== BROADCAST_REF) return [];
    const market = marketOf(config, alert.ref.marketId);
    const broadcast = market?.live ? market.broadcasts.find(b => b.id === alert.ref.broadcastId) : null;
    return broadcast && broadcastOn(broadcast, now) ? [{ alert, broadcast }] : [];
  }).sort((a, b) => b.alert.ts - a.alert.ts);
}

/** Who may push a market's broadcasts: the GM for now (a PC Fixer is planned). */
export const canBroadcast = (user, market) => !!user?.isGM && !!market;

/** The line every phone gets for a broadcast. */
export function broadcastText(b, market) {
  const what = b.kind === "flash" ? (b.target.listingId ? listingOf(market, b.target.listingId)?.name ?? "a listing" : CATEGORIES[b.target.category].label) : "";
  const mins = b.until ? Math.max(1, Math.round((b.until - b.ts) / 60000)) : 0;
  const head = {
    flash: `Flash sale: ${b.pct}% off ${what}${mins ? ` for ${mins} minutes` : ""}!`,
    raid: `${b.by === "hostiles" ? "Hostiles" : "NCPD raid"} incoming!`,
    policy: "Policy reminder:",
    date: "Next market:"
  }[b.kind];
  return [head, b.text].filter(Boolean).join(" ");
}

/**
 * Why this purchase can't happen, or null. `wealth` null = no wallet (never short).
 * @param {{ market, listing, wealth, now? }} buy
 */
export function buyProblem({ market, listing, wealth, now = Date.now(), dealPct = 0, auction = null }) {
  if (!market?.live) return "That Night Market isn't broadcasting any more.";
  if (!listing || listing.hidden) return "That listing is gone.";
  if (soldOut(listing)) return `${listing.name} is sold out.`;
  if (auction?.status === "open") return `${listing.name} is up for auction.`;
  if (wealth !== null && wealth < priceNow(market, listing, now, dealPct)) return `You can't afford ${listing.name}.`;
  return null;
}

/** Why a receipt can't be picked up now, or null: only paid receipts, only while their market is live. */
export function pickupProblem(receipt, config) {
  if (!receipt || receipt.status !== "paid") return "That receipt has already been used.";
  if (!marketOf(config, receipt.marketId)?.live) return `${receipt.market} is closed. Pick it up the next time it opens.`;
  return null;
}

/** A character's receipts, newest first. */
export const receiptsOf = (receipts, actorId) => Object.values(receipts ?? {}).filter(r => r.actorId === actorId).sort((a, b) => b.ts - a.ts);

/** Short receipt code, the same on every client: "CBK-1A2B3C". */
export const receiptCode = id => `CBK-${String(id).slice(-6).toUpperCase()}`;

/* ---------------- Invites ---------------- */

export const inviteKey = (actorId, marketId) => `${actorId}:${marketId}`;

/** A courier invitation's name; the fallback when the flag is gone (a card has only its flag: the name is the same for every market). */
export const courierName = market => `Courier Invitation: ${market.name}`;

/** Is this carried item an invite to the market? By its flag first, by a courier invitation's name otherwise. */
const opensMarket = (item, market) => {
  const flag = item.flags?.[MODULE_ID]?.cbkInvite;
  return flag ? flag === market.id : item.name === courierName(market);
};

/** Does the character hold an invite to the market (the host's table, or an item they carry)? */
export const holdsInvite = (market, actor, invites) => !!actor && (!!invites?.[inviteKey(actor.id, market.id)] || [...(actor.items ?? [])].some(i => opensMarket(i, market)));

/** May the character enter this market (live or not)? */
export const canEnter = (market, actor, invites) => market?.access?.mode !== "invite" || holdsInvite(market, actor, invites);

/** The live markets the character can enter. */
export const shownMarkets = (config, actor, invites) => liveMarkets(config).filter(m => canEnter(m, actor, invites));

/** Invite-only markets the character holds an invite to, offline for now: "Upcoming", the Fixer's name and no listings. */
export const upcomingMarkets = (config, actor, invites) => config.markets.filter(m => !m.live && m.access.mode === "invite" && holdsInvite(m, actor, invites));

/** Why this passcode doesn't open the market, or null. Case and spaces at the ends don't count; no lockout. */
export function passcodeProblem(market, code) {
  if (!market) return "That Night Market is gone.";
  const want = market.access.passcode.toLowerCase();
  return want && String(code ?? "").trim().toLowerCase() === want ? null : "Wrong code.";
}

/* ---------------- Auctions ---------------- */

/** Only Super Luxury items go to auction; an app is never a lot. */
export const auctionable = listing => !!listing && !listing.app && priceTierKey(listing.price) === "superLuxury";

/** The open auction on a listing, or null (`auctions`: table cbkAuctions). */
export function auctionOf(auctions, marketId, listingId) {
  const row = auctions?.[stockKey(marketId, listingId)];
  return row?.status === "open" ? row : null;
}

/** The high bid, or null. */
export const highBid = auction => auction?.bids.at(-1) ?? null;

/** The least the next bid can be: the reserve (or the minimum raise) first, then 10% or MIN_RAISE over the high bid. */
export function minBid(auction) {
  const high = highBid(auction);
  return high ? high.amount + Math.max(Math.ceil(high.amount / 10), MIN_RAISE) : Math.max(auction?.reserve ?? 0, MIN_RAISE);
}

/** Bidders by number, in the order they first bid, so nobody sees who they're bidding against: { actorId: "Bidder 1" }. */
export function bidderLabels(auction) {
  const ids = [...new Set((auction?.bids ?? []).map(b => b.actorId))];
  return Object.fromEntries(ids.map((id, i) => [id, `Bidder ${i + 1}`]));
}

/**
 * Why this bid can't be taken, or null. `wealth` null = no wallet (never short); the bidder's own hold, when they're
 * raising themselves, counts as theirs.
 * @param {{ market, listing, auction, amount, wealth, actorId }} bid
 */
export function bidProblem({ market, listing, auction, amount, wealth, actorId }) {
  if (!market?.live) return "That Night Market isn't broadcasting any more.";
  if (!auction || !listing) return "That auction is over.";
  if (!Number.isInteger(amount) || amount < minBid(auction)) return `The next bid is at least ${formatMoney(minBid(auction))}.`;
  const high = highBid(auction);
  const held = high?.actorId === actorId ? high.amount : 0;
  if (wealth !== null && wealth + held < amount) return `You can't cover a bid of ${formatMoney(amount)}.`;
  return null;
}

/* ---------------- Rex's game ---------------- */

export const dealKey = (marketId, listingId, actorId) => `${marketId}:${listingId}:${actorId}`;

/** The character's discount on a listing, in percent: only a win not yet spent. */
export function dealPctOf(deals, marketId, listingId, actorId) {
  const row = deals?.[dealKey(marketId, listingId, actorId)];
  return row?.status === "won" ? row.pct : 0;
}

const CARD_NAMES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"];
const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const drawCard = rng => {
  const n = Math.floor(rng() * 52);
  return { rank: n % 13, name: `${CARD_NAMES[n % 13]} of ${SUITS[Math.floor(n / 13)]}` };
};

/**
 * Rex's game: a coin flip (heads wins) or a card each (high card wins, a tie is the house's).
 * Returns { won, line }, `line` being what happened in words.
 */
export function playRex(how, rng = Math.random) {
  if (how === "card") {
    const [theirs, rex] = [drawCard(rng), drawCard(rng)];
    return { won: theirs.rank > rex.rank, line: `Drew the ${theirs.name} against Rex's ${rex.name}` };
  }
  const won = rng() < 0.5;
  return { won, line: `The coin came up ${won ? "heads" : "tails"}` };
}

/* ---------------- Presets ---------------- */

/** The six Black Chrome markets: [{ letter, name, count }] for the GM's "New market" list. */
export const presetList = () => PRESETS.map(p => ({ letter: p.letter, name: p.name, count: p.listings.length }));

/**
 * A market from a Black Chrome preset. `find(name)` turns a listing's name into a catalogue entry
 * ({ uuid, name, img, type, base }) or null; unmatched listings keep only their name.
 */
export function marketFromPreset(letter, find, newId) {
  const p = PRESETS.find(x => x.letter === letter);
  if (!p) return null;
  const listings = p.listings.map(([name, corp, category, sub, booths, price]) => {
    const hit = find(name);
    return cleanListing({ id: newId(), uuid: hit?.uuid ?? null, name: hit?.name ?? name, img: hit?.img ?? null, type: hit?.type ?? "gear", corp, category, sub, booths, price: price || hit?.base || 0, stock: null });
  });
  return cleanMarket({ id: newId(), letter: p.letter, name: p.name, fixer: p.fixer, booths: p.booths, live: false, listings });
}

/** Black Chrome's compendiums first when a preset name matches more than one item. */
export const preferredPacks = packs => packs.filter(p => /black.?chrome/i.test(`${p.collection} ${p.metadata?.label ?? ""} ${p.folder?.name ?? ""}`)).map(p => p.collection);

import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { formatMoney, hasWallet, priceTier } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import {
  BLOCKS, catalogue, catalogueVersion, clampQty, committedOf, dayKey, DEFAULT_TYPES, DELIVERY, droneProgress, highestPrice, MARKET, MARKET_DEFAULTS, marketConfig, MAX_QTY, orderProblem,
  ordersOf, orderTotal, packLabel, pendingOf, PRICING, queueOf, shippingOf, STATUS, stock, STORE_CAP, STORE_NAME
} from "./model.js";
import { approveOrder, denyOrder } from "./commands.js";

/*
 * Phone page: Great River (NC Market until 2026-10-21; see apps/market/model.js, apps/market/host.js). Players: Shop (the day's
 * Featured items and Hot Deals carousel, then search, type, sort, 40 rows at a time), Cart (quantities, a
 * note, Order) and Orders (status, Cancel, Re-order). The GM Phone: the queue (set prices, a note, Approve
 * or Deny; drones in the air, Deliver now), the Shop as players see it (hide an item or make it unavailable; draw the day's picks again),
 * the history, and the Setup (sources, item types, price limits incl. "ignore blank price", markup, order
 * rules, how many picks a day).
 * Methods, click actions (data-action), inputs and dropdowns are installed onto AgentPhone.
 */

const TABS = { shop: "Shop", cart: "Cart", orders: "Orders" };
const GM_TABS = { queue: "Orders", shop: "Shop", history: "History", setup: "Setup" };
/** The GM's Shop tab filter. */
const SHOWS = { "": "Everything", blocked: "Hidden or unavailable", picks: "Today's picks" };
const SORTS = { name: "Name", low: "Price: low to high", high: "Price: high to low", type: "Type" };
const PAGE = 40;

const typeLabel = type => game.i18n.localize(CONFIG.Item.typeLabels?.[type] ?? type);
const priceLabel = price => (price == null ? "Price on request" : formatMoney(price));
const saveConfig = change => patchSetting(MARKET, c => change(Object.assign(c, { ...MARKET_DEFAULTS, ...c })));
const linesView = lines => lines.map((l, index) => ({ ...l, index, priceLabel: priceLabel(l.price), unpriced: l.price == null }));

/** A drone in the air: how far it is, and a bar that keeps filling between redraws (real time). */
function droneView(order) {
  if (order.status !== "shipping" || !order.drone) return null;
  const now = Date.now();
  const done = droneProgress(order.drone, game.time.worldTime, now);
  const left = Math.max(1, Math.ceil(order.drone.minutes * (1 - done)));
  const ms = order.drone.minutes * 60_000;
  return { left, minutes: order.drone.minutes, ms, elapsed: Math.round(done * ms) };
}

/* ---------------- Click actions ---------------- */

export const actions = {
  "market-tab"({ tab }) {
    this.marketTab = tab;
    this.render();
  },
  "market-more"() {
    this.marketLimit = (this.marketLimit ?? PAGE) + PAGE;
    this.render();
  },
  "market-add"({ uuid }, event) {
    const entry = this._marketStock?.byUuid?.get(uuid);
    if (!entry || entry.disabled) return;
    const cart = this._marketCart();
    const line = cart.get(uuid) ?? { uuid, name: entry.name, img: entry.img, price: entry.price, qty: 0 };
    line.qty = clampQty(line.qty + (event?.shiftKey ? 5 : 1));
    cart.set(uuid, line);
    this.render();
  },
  "market-qty"({ uuid, step }) {
    const line = this._marketCart().get(uuid);
    if (!line) return;
    const qty = line.qty + Number(step);
    if (qty < 1) this._marketCart().delete(uuid);
    else line.qty = clampQty(qty);
    this.render();
  },
  "market-drop"({ uuid }) {
    this._marketCart().delete(uuid);
    this.render();
  },
  "market-clear"() {
    this._marketCart().clear();
    this.render();
  },
  "market-order"() {
    const actorId = this.context()?.actorId;
    const lines = [...this._marketCart().values()].map(({ uuid, name, qty }) => ({ uuid, name, qty }));
    if (!actorId || !lines.length) return;
    if (!store.request("market-order", { actorId, lines, note: this.marketNote ?? "" })) return;
    this._marketCart().clear();
    this.marketNote = "";
    this.marketTab = "orders";
    this.render();
  },
  "market-cancel"({ orderId }) {
    store.request("market-cancel", { actorId: this.context()?.actorId, orderId });
  },
  /** An old order back in the cart, at today's names and prices; what's no longer on sale is left out. */
  async "market-reorder"({ orderId }) {
    const order = store.apps.orders?.[orderId];
    if (!order) return;
    const loaded = await this._marketStockLoaded();
    const cart = this._marketCart();
    const missing = [];
    for (const line of order.lines) {
      // The same item, or one with its name and type (a world item made again, a compendium rebuilt).
      const entry = loaded.byUuid.get(line.uuid) ?? loaded.entries.find(e => e.name === line.name && e.type === line.type);
      if (!entry || entry.disabled) {
        missing.push(line.name);
        continue;
      }
      const have = cart.get(entry.uuid);
      cart.set(entry.uuid, { uuid: entry.uuid, name: entry.name, img: entry.img, price: entry.price, qty: clampQty((have?.qty ?? 0) + line.qty) });
    }
    if (missing.length) ui.notifications.warn(`No longer on sale: ${missing.join(", ")}.`);
    this.marketTab = "cart";
    this.render();
  },
  /** Hot Deals carousel: the next or previous deal, or one by its dot. */
  "market-deal"({ step, index }) {
    const count = this._marketStock?.deals?.length ?? 0;
    if (!count) return;
    const at = index !== undefined ? Number(index) : (this.marketDeal ?? 0) + Number(step);
    this.marketDeal = ((at % count) + count) % count;
    this.render();
  },
  "market-open"({ uuid }) {
    fromUuid(uuid).then(doc => doc?.sheet?.render(true, { editable: false }));
  },

  /** GM: approve with the prices typed in; asks first if the character can't pay. */
  "market-approve"({ orderId }) {
    const order = store.apps.orders?.[orderId];
    const card = this.element[0].querySelector(`[data-market-order="${orderId}"]`);
    if (!order || !card) return;
    const prices = order.lines.map((l, i) => {
      const value = card.querySelector(`input[name=marketPrice][data-index="${i}"]`)?.value ?? "";
      return value === "" ? null : Number(value);
    });
    approveOrder(orderId, { prices, gmNote: card.querySelector("input[name=marketNote]")?.value ?? "" });
  },
  "market-deny"({ orderId }) {
    denyOrder(orderId, this.element[0].querySelector(`[data-market-order="${orderId}"] input[name=marketNote]`)?.value ?? "");
  },
  "market-remove"({ orderId }) {
    store.request("market-remove", { orderId });
  },
  /** GM: the drone lands now. */
  "market-deliver"({ orderId }) {
    store.request("market-deliver", { orderId });
  },
  /** GM Shop: hide an item, or list it as unavailable (tap again to put it back on sale). */
  "market-block"({ uuid, how }) {
    if (!(how in BLOCKS)) return;
    saveConfig(c => {
      c.blocked = { ...(c.blocked ?? {}) };
      if (c.blocked[uuid] === how) delete c.blocked[uuid];
      else c.blocked[uuid] = how;
    });
  },
  /** GM Shop: everything hidden or unavailable back on sale. */
  "market-unblock-all"() {
    saveConfig(c => (c.blocked = {}));
  },
  /** GM Shop: draw today's Featured items and Hot Deals again. */
  "market-reroll"() {
    saveConfig(c => (c.reroll = (Number(c.reroll) || 0) + 1));
  },
  /** GM Setup: one item type or compendium on or off; every compendium on or off. */
  "market-type"({ type }) {
    saveConfig(c => (c.types = c.types.includes(type) ? c.types.filter(t => t !== type) : [...c.types, type]));
  },
  "market-pack"({ pack }) {
    const all = game.packs.filter(p => p.documentName === "Item").map(p => p.collection);
    saveConfig(c => {
      const on = new Set(c.packs ?? all);
      if (on.has(pack)) on.delete(pack);
      else on.add(pack);
      c.packs = on.size === all.length ? null : [...on];
    });
  },
  "market-packs-all"() {
    saveConfig(c => (c.packs = c.packs === null ? [] : null));
  },
  "market-reset"() {
    Dialog.confirm({ title: `${STORE_NAME} setup`, content: `<p>Put the ${STORE_NAME} setup back to its defaults?</p>`, yes: () => patchSetting(MARKET, c => {
      for (const key of Object.keys(c)) delete c[key];
      Object.assign(c, { ...MARKET_DEFAULTS, types: [...DEFAULT_TYPES] });
    }) });
  }
};

export const inputs = {
  "input[name=marketSearch]": {
    input(event) {
      this.marketSearch = event.currentTarget.value;
      this.marketLimit = PAGE;
      this.render();
    }
  },
  "input[name=marketQty]": {
    change(event) {
      const line = this._marketCart().get(event.currentTarget.dataset.uuid);
      if (!line) return;
      line.qty = clampQty(event.currentTarget.value);
      this.render();
    }
  },
  "textarea[name=marketCartNote]": {
    input(event) {
      this.marketNote = event.currentTarget.value;
    }
  },
  "input[data-market-setting]": {
    change(event) {
      const el = event.currentTarget;
      const key = el.dataset.marketSetting;
      return saveConfig(c => (c[key] = el.type === "checkbox" ? el.checked : Math.max(0, Math.floor(Number(el.value) || 0))));
    }
  }
};

export const dropdowns = {
  marketType(value) {
    this.marketType = value;
    this.marketLimit = PAGE;
    this.render();
  },
  marketSort(value) {
    this.marketSort = value;
    this.render();
  },
  marketShow(value) {
    this.marketShow = value;
    this.marketLimit = PAGE;
    this.render();
  },
  marketFolder(value) {
    saveConfig(c => (c.worldFolder = value));
  },
  marketPricing(value) {
    if (value in PRICING) saveConfig(c => (c.pricing = value));
  },
  marketDelivery(value) {
    if (value in DELIVERY) saveConfig(c => (c.delivery = value));
  }
};

/* ---------------- The page ---------------- */

const byName = (a, b) => a.name.localeCompare(b.name);
const SORT_BY = {
  name: byName,
  low: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || byName(a, b),
  high: (a, b) => (b.price ?? -1) - (a.price ?? -1) || byName(a, b),
  type: (a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)) || byName(a, b)
};

/** One item as the page shows it (a shop row, a Featured tile, a Hot Deal). */
const itemView = (e, cart) => ({
  ...e, typeLabel: typeLabel(e.type), priceLabel: priceLabel(e.price), tier: priceTier(e.price), wasLabel: e.was ? formatMoney(e.was) : null,
  inCart: cart?.get(e.uuid)?.qty ?? 0, unavailable: e.disabled && !e.hidden, blockLabel: e.hidden ? BLOCKS.hide : e.disabled ? BLOCKS.off : null
});

/** The store's terms, for its banner and the cart: the price cap, the delivery fee, how it's delivered. */
function storeInfo(config) {
  const max = highestPrice(config);
  return {
    name: STORE_NAME,
    capped: config.pricing === "cap",
    cap: max > 0 ? formatMoney(max) : null,
    fee: config.pricing === "fee" ? `${formatMoney(config.deliveryFee)}${config.deliveryPct ? ` + ${config.deliveryPct}%` : ""}` : null,
    drone: config.delivery === "drone",
    eta: config.etaMax
  };
}

export const methods = {
  /** This phone's cart: uuid → { uuid, name, img, price, qty }. */
  _marketCart() {
    return (this._marketCartMap ??= new Map());
  },

  /**
   * Today's stock for the current setup (model.js `stock`): loaded once, then the page redraws. Null while
   * loading. `mode`: "player", "gm" (the GM's Shop: what players see, plus hidden items) or "all" (Setup).
   */
  _marketStockFor(config, mode = "player") {
    const key = `${JSON.stringify(config)}|${mode}|${dayKey()}|${catalogueVersion()}`;
    if (this._marketStock?.key === key && this._marketStock.ready) return this._marketStock;
    if (this._marketStock?.key !== key) {
      const loading = { key, ready: false };
      this._marketStock = loading;
      loading.promise = (mode === "all" ? catalogue(config) : stock(config, { gm: mode === "gm" })).then(found => {
        Object.assign(loading, { featured: [], deals: [], byUuid: new Map(found.entries.map(e => [e.uuid, e])), ...found, ready: true });
        // refresh, not render: a draw already under way would drop a plain render (the catalogue is often cached).
        if (this._marketStock === loading) this.refresh({ market: true });
        return loading;
      });
    }
    return null;
  },

  /** The player's stock, once loaded. */
  async _marketStockLoaded() {
    return this._marketStockFor(marketConfig()) ?? this._marketStock.promise;
  },

  /** The shop list (search, type, sort, paged), the day's picks, for the player's Shop or the GM's. */
  _marketShopData(loaded, cart, gm) {
    const query = (this.marketSearch ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const type = this.marketType ?? "";
    const sort = this.marketSort in SORTS ? this.marketSort : "name";
    const show = gm && this.marketShow in SHOWS ? this.marketShow : "";
    const types = [...new Set(loaded.entries.map(e => e.type))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
    const rows = loaded.entries.filter(e => (!type || e.type === type)
      && (show !== "blocked" || e.disabled) && (show !== "picks" || e.featured || e.off)
      && query.every(q => `${e.name} ${typeLabel(e.type)} ${e.sourceLabel}`.toLowerCase().includes(q)));
    rows.sort(SORT_BY[sort]);
    const limit = this.marketLimit ?? PAGE;
    const browsing = !query.length && !type && !show;
    const deals = loaded.deals.filter(Boolean);
    const at = Math.min(this.marketDeal ?? 0, Math.max(0, deals.length - 1));
    return {
      search: this.marketSearch ?? "",
      typePick: dropdown("marketType", [{ value: "", label: "All types", selected: !type }, ...types.map(t => ({ value: t, label: typeLabel(t), selected: t === type }))], { title: "Item type" }),
      sortPick: dropdown("marketSort", Object.entries(SORTS).map(([value, label]) => ({ value, label, selected: value === sort })), { title: "Sort" }),
      showPick: gm ? dropdown("marketShow", Object.entries(SHOWS).map(([value, label]) => ({ value, label, selected: value === show })), { title: "Show", cls: "agent-wide" }) : null,
      blockedCount: gm ? loaded.entries.filter(e => e.disabled).length : 0,
      featured: browsing ? loaded.featured.filter(Boolean).map(e => itemView(e, cart)) : [],
      deal: browsing && deals.length ? { ...itemView(deals[at], cart), at: at + 1, count: deals.length, many: deals.length > 1, dots: deals.map((d, i) => ({ index: i, active: i === at, name: d.name })) } : null,
      found: rows.length,
      more: rows.length > limit,
      rows: rows.slice(0, limit).map(e => itemView(e, cart))
    };
  },

  marketData(ctx) {
    const gm = ctx.perspective === "gm";
    const config = marketConfig();
    const bar = appBar(MARKET, { owner: gm ? null : ctx.subject.name });
    if (gm) return { gm, bar, ...this._marketGmData(config) };

    const actor = ctx.subject.actor;
    const orders = store.apps.orders ?? {};
    const mine = ordersOf(orders, ctx.actorId);
    const tab = this.marketTab in TABS ? this.marketTab : "shop";
    const cart = this._marketCart();
    const loaded = this._marketStockFor(config);
    // The cart follows today's stock: prices (Hot Deals come and go), and what went off sale leaves it.
    if (loaded) {
      for (const [uuid, line] of cart) {
        const entry = loaded.byUuid.get(uuid);
        if (!entry || entry.disabled) cart.delete(uuid);
        else Object.assign(line, { name: entry.name, img: entry.img, price: entry.price, off: entry.off, was: entry.was });
      }
    }
    const cartLines = [...cart.values()];
    const count = cartLines.reduce((n, l) => n + l.qty, 0);
    const wealth = hasWallet(actor) ? actor.system.wealth.value : null;
    const committed = committedOf(orders, ctx.actorId);
    const pendingCount = pendingOf(orders, ctx.actorId).length;
    const problem = orderProblem({ lines: cartLines, config, wealth, committed, pending: pendingCount });
    const { items, fee, total } = orderTotal(cartLines, config);

    const data = {
      gm, bar, offline: !!ctx.noSignal, loading: !loaded, store: storeInfo(config),
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === tab, count: id === "cart" ? count : id === "orders" ? pendingCount : 0 })),
      tab: { [tab]: true },
      balance: wealth === null ? null : formatMoney(wealth),
      committed: committed ? formatMoney(committed) : null,
      available: wealth === null ? null : formatMoney(wealth - committed)
    };

    if (tab === "shop" && loaded) Object.assign(data, this._marketShopData(loaded, cart, false));
    if (tab === "cart") {
      Object.assign(data, {
        cart: cartLines.map(l => ({ ...l, priceLabel: priceLabel(l.price), wasLabel: l.was ? formatMoney(l.was) : null, lineTotal: l.price == null ? "?" : formatMoney(l.price * l.qty), atMax: l.qty >= MAX_QTY, max: MAX_QTY })),
        items: formatMoney(items),
        fee: fee ? formatMoney(fee) : null,
        total: formatMoney(total),
        onRequest: cartLines.some(l => l.price == null),
        problem: cartLines.length ? problem : null,
        canOrder: cartLines.length > 0 && !problem && !ctx.noSignal,
        note: this.marketNote ?? ""
      });
    }
    if (tab === "orders") data.orders = mine.map(o => ({ ...o, statusLabel: STATUS[o.status], pending: o.status === "pending", totalLabel: formatMoney(o.total), feeLabel: o.fee ? formatMoney(o.fee) : null, lines: linesView(o.lines), drone: droneView(o) }));
    return data;
  },

  /** The GM's queue, shop, history and setup. */
  _marketGmData(config) {
    const orders = store.apps.orders ?? {};
    const tab = this.marketTab in GM_TABS ? this.marketTab : "queue";
    const queue = queueOf(orders);
    const view = o => {
      const actor = game.actors.get(o.actorId);
      const wealth = hasWallet(actor) ? actor.system.wealth.value : null;
      return {
        ...o, actorName: actor ? displayName(actor) : "(deleted)", userName: game.users.get(o.userId)?.name ?? "",
        statusLabel: STATUS[o.status], pending: o.status === "pending", totalLabel: formatMoney(o.total), feeLabel: o.fee ? formatMoney(o.fee) : null, lines: linesView(o.lines), drone: droneView(o),
        balance: wealth === null ? "no account" : formatMoney(wealth), short: wealth !== null && o.status === "pending" && wealth < o.total
      };
    };
    const data = {
      tabs: Object.entries(GM_TABS).map(([id, label]) => ({ id, label, active: id === tab, count: id === "queue" ? queue.length : 0 })),
      tab: { [tab]: true },
      store: storeInfo(config)
    };
    if (tab === "queue") {
      data.queue = queue.map(view);
      data.shipping = shippingOf(orders).map(view);
    }
    if (tab === "shop") {
      const loaded = this._marketStockFor(config, "gm");
      data.loading = !loaded;
      if (loaded) Object.assign(data, this._marketShopData(loaded, null, true), { day: dayKey() });
    }
    if (tab === "history") data.history = Object.values(orders).filter(o => !["pending", "shipping"].includes(o.status)).sort((a, b) => (b.decidedAt ?? b.ts) - (a.decidedAt ?? a.ts)).slice(0, 60).map(view);
    if (tab === "setup") {
      const loaded = this._marketStockFor(config, "all");
      const inStockCount = loaded ? loaded.entries.filter(e => config.types.includes(e.type)).length : null;
      const allTypes = (game.documentTypes?.Item ?? DEFAULT_TYPES).filter(t => t !== "base");
      const folders = game.folders.filter(f => f.type === "Item");
      data.setup = {
        ...config,
        cap: STORE_CAP,
        feeMode: config.pricing === "fee",
        droneMode: config.delivery === "drone",
        pricingPick: dropdown("marketPricing", Object.entries(PRICING).map(([value, label]) => ({ value, label, selected: value === config.pricing })), { title: "Pricing", cls: "agent-wide" }),
        deliveryPick: dropdown("marketDelivery", Object.entries(DELIVERY).map(([value, label]) => ({ value, label, selected: value === config.delivery })), { title: "Delivery", cls: "agent-wide" }),
        types: allTypes.map(t => ({ type: t, label: typeLabel(t), on: config.types.includes(t) })).sort((a, b) => a.label.localeCompare(b.label)),
        packs: game.packs.filter(p => p.documentName === "Item").map(p => ({
          collection: p.collection, label: packLabel(p), on: config.packs == null || config.packs.includes(p.collection),
          hidden: (p.ownership?.PLAYER ?? "OBSERVER") === "NONE"
        })),
        allPacks: config.packs == null,
        folderPick: dropdown("marketFolder", [{ value: "", label: "All world items", selected: !config.worldFolder },
          ...folders.map(f => ({ value: f.id, label: [...f.ancestors].reverse().map(a => a.name).concat(f.name).join(" / "), selected: f.id === config.worldFolder }))], { title: "World items from", cls: "agent-wide", search: folders.length > 8 }),
        sourceCount: inStockCount
      };
    }
    return data;
  }
};

export const phone = {
  /** Tapping Great River again: back to the shop's first page. */
  retap(app) {
    if (app !== MARKET) return;
    this.marketTab = null;
    this.marketLimit = PAGE;
    this.marketSearch = "";
    this.marketType = "";
    this.marketShow = "";
  }
};

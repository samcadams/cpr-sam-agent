import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { noSignalSince } from "../../scripts/model/features.js";
import { formatMoney, hasWallet, MAX_AMOUNT } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { clean } from "../../scripts/util/text.js";
import {
  clampQty, committedOf, droneFor, droneLanded, droneMinutes, MARKET, marketConfig, orderedItems, orderProblem, orderTotal, pendingOf, shippingOf, stock, STORE_NAME
} from "./model.js";

/*
 * Host: Great River (see apps/market/model.js). Players place and cancel orders; the GM approves (paid
 * through BangMe!; a Transporter drone then brings the items to the character's gear) or denies them.
 * Orders are the table "orders". Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "market-order": "_onMarketOrder",
  "market-cancel": "_onMarketCancel",
  "market-approve": gm("_onMarketApprove"),
  "market-deny": gm("_onMarketDeny"),
  "market-remove": gm("_onMarketRemove"),
  "market-deliver": gm("_onMarketDeliver")
};

const FROM = STORE_NAME;
const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");
const itemsText = lines => lines.map(l => `${l.qty}× ${l.name}`).join(", ");

export const methods = {
  /** A player's own character, with their Agent on them and a signal. */
  _marketActor(user, actorId) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor)) return null;
    if (noSignalSince(actorId)) {
      this._alertNow(actorId, { kind: "system", from: FROM, app: MARKET, text: `No CitiNet connection: ${STORE_NAME} can't take your order.` });
      return null;
    }
    return canUsePhone(actor) ? actor : null;
  },

  /** Place an order. Prices and names come from the host's own catalogue; every line must be on sale. */
  async _onMarketOrder(user, { actorId, lines, note }) {
    const actor = this._marketActor(user, actorId);
    if (!actor || !Array.isArray(lines)) return;
    const config = marketConfig();
    // Today's prices (Hot Deals included): the player's phone draws the same picks.
    const { byUuid } = await stock(config);
    const clean_ = [];
    for (const line of lines.slice(0, 50)) {
      const entry = byUuid.get(line?.uuid);
      if (!entry || entry.disabled) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: MARKET, text: `${clean(line?.name, 80) || "An item in your cart"} isn't on sale any more.` });
      const deal = entry.off ? { off: entry.off, was: entry.was } : {};
      clean_.push({ uuid: entry.uuid, name: entry.name, img: entry.img, type: entry.type, price: entry.price, qty: clampQty(line.qty), ...deal });
    }
    const wealth = hasWallet(actor) ? actor.system.wealth.value : null;
    const problem = orderProblem({ lines: clean_, config, wealth, committed: committedOf(this.apps.orders, actor.id), pending: pendingOf(this.apps.orders, actor.id).length });
    if (problem) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: MARKET, text: problem });

    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    const { fee, total } = orderTotal(clean_, config);
    this.apps.orders[id] = { id, actorId: actor.id, userId: user.id, status: "pending", ts: Date.now(), time, date, note: clean(note, 300), lines: clean_, fee, total };
    const priced = clean_.some(l => l.price == null) ? `${formatMoney(total)} + price on request` : formatMoney(total);
    this._gmCard({ id: `market:${id}`, open: { app: MARKET }, title: FROM, body: `${displayName(actor)} ordered ${itemsText(clean_)} (${priced}${fee ? `, ${formatMoney(fee)} delivery` : ""}). Approve it in ${STORE_NAME} on the GM Phone.`, icon: "fa-water" });
    this._pushApps([this._alert(actor.id, { kind: "money", from: FROM, app: MARKET, text: `Order placed: ${itemsText(clean_)}. Waiting for approval.` })]);
  },

  _onMarketCancel(user, { actorId, orderId }) {
    const order = this.apps.orders[orderId];
    const actor = game.actors.get(actorId);
    if (!order || order.actorId !== actorId || order.status !== "pending" || !owns(user, actor)) return;
    this.apps.orders[orderId] = { ...order, status: "cancelled", decidedAt: Date.now() };
    this._gmCard({ id: `market:${orderId}`, open: { app: MARKET }, title: FROM, body: `${displayName(actor)} cancelled their order of ${itemsText(order.lines)}.`, icon: "fa-water" });
    this._pushApps();
  },

  /**
   * GM: approve an order. `prices` (by line) overrides the listed prices, and every line needs one.
   * Without `force`, a character who can't pay isn't charged and nothing ships; the GM Phone asks first.
   */
  async _onMarketApprove(user, { orderId, prices, gmNote, force }) {
    const order = this.apps.orders[orderId];
    const actor = game.actors.get(order?.actorId);
    if (!order || order.status !== "pending" || !actor) return;
    const lines = order.lines.map((l, i) => {
      const p = Array.isArray(prices) ? prices[i] : null;
      const price = p === null || p === undefined || p === "" || !Number.isFinite(Number(p)) ? l.price : Math.min(MAX_AMOUNT, Math.max(0, Math.round(Number(p))));
      // A price the GM changed isn't the Hot Deal any more.
      const { off, was, ...line } = l;
      return price === l.price ? l : { ...line, price };
    });
    const unpriced = lines.find(l => l.price == null);
    if (unpriced) return this._gmCard({ id: `market-err:${orderId}`, open: { app: MARKET }, title: FROM, body: `Set a price for ${unpriced.name} before approving.`, icon: "fa-triangle-exclamation" });
    const config = marketConfig();
    const { fee, total } = orderTotal(lines, config);
    const wallet = hasWallet(actor);
    if (wallet && !force && actor.system.wealth.value < total) {
      return this._gmCard({ id: `market-err:${orderId}`, open: { app: MARKET }, title: FROM, body: `${displayName(actor)} has ${formatMoney(actor.system.wealth.value)}, not ${formatMoney(total)}. Nothing was charged.`, icon: "fa-triangle-exclamation" });
    }
    // Find every item before charging, so nobody pays for something that's gone.
    const items = await this._marketItems({ ...order, id: orderId, lines });
    if (typeof items === "string") return this._gmCard({ id: `market-err:${orderId}`, open: { app: MARKET }, title: FROM, body: `${items} no longer exists. Deny the order or ask them to order again.`, icon: "fa-triangle-exclamation" });
    // Taken off the queue first, so a second click can't ship it twice.
    const drone = config.delivery === "drone" ? droneFor(droneMinutes(config), game.time.worldTime, Date.now()) : null;
    this.apps.orders[orderId] = { ...order, lines, fee, total, status: drone ? "shipping" : "approved", decidedAt: Date.now(), gmNote: clean(gmNote, 300), ...(drone ? { drone } : {}) };
    const memo = itemsText(lines);
    if (wallet && total > 0 && !(await this._marketCharge(actor, total, `${FROM}: ${memo}`, force))) {
      this.apps.orders[orderId] = order;
      return this._gmCard({ id: `market-err:${orderId}`, open: { app: MARKET }, title: FROM, body: `${displayName(actor)} couldn't pay ${formatMoney(total)}. The order is still waiting.`, icon: "fa-triangle-exclamation" });
    }
    if (wallet && total > 0) this._ledger(actor.id, -total, memo, "market", FROM);
    this._gmCardDone([`market:${orderId}`, `market-err:${orderId}`]);
    const note = this.apps.orders[orderId].gmNote;
    const charged = `${wallet && total ? ` Charged ${formatMoney(total)}.` : ""}${note ? ` "${note}"` : ""}`;
    if (drone) {
      return this._pushApps([this._alert(actor.id, {
        kind: "money", from: FROM, app: MARKET,
        text: `Order approved: a Transporter drone is bringing ${memo}. It lands within ${drone.minutes} minutes.${charged}`
      })]);
    }
    if (!(await this._marketHandOver(actor, orderId, items, charged))) {
      this.apps.orders[orderId] = order;
      this._pushApps();
    }
  },

  /** The items an order puts in the gear, or the name of the first one that no longer exists. */
  async _marketItems(order) {
    const items = [];
    for (const line of order.lines) {
      const source = await fromUuid(line.uuid).catch(() => null);
      if (source?.documentName !== "Item") return line.name;
      items.push(...orderedItems(source, line.qty, { orderId: order.id, price: line.price }));
    }
    return items;
  },

  /**
   * Put an order's items in the gear and mark it delivered. If that fails the character is refunded and
   * false comes back (the caller decides what the order becomes).
   */
  async _marketHandOver(actor, orderId, items, extra = "") {
    const order = this.apps.orders[orderId];
    const memo = itemsText(order.lines);
    const made = await actor.createEmbeddedDocuments("Item", items).catch(err => {
      console.error(`${MODULE_ID} | ${STORE_NAME} couldn't give ${actor.name} their order`, err);
      return null;
    });
    if (!made?.length) {
      if (hasWallet(actor) && order.total > 0) {
        await this._transfer(null, actor, order.total, `${FROM}: refund`);
        this._ledger(actor.id, order.total, `Refund: ${memo}`, "market", FROM);
      }
      this._gmCard({ id: `market-err:${orderId}`, open: { app: MARKET }, title: FROM, body: `Couldn't put ${memo} in ${displayName(actor)}'s gear. They were refunded.`, icon: "fa-triangle-exclamation" });
      return false;
    }
    this.apps.orders[orderId] = { ...order, status: "approved", deliveredAt: Date.now() };
    const how = order.drone ? "Your Great River drone dropped off" : "Order approved:";
    this._pushApps([this._alert(actor.id, { kind: "money", from: FROM, app: MARKET, text: `${how} ${memo}. ${made.length === 1 ? "It's" : "They're"} in your gear.${extra}` })]);
    return true;
  },

  /** A drone lands: its order's items go in the gear (refunded and marked denied if they can't). */
  async _marketDeliver(orderId) {
    const order = this.apps.orders[orderId];
    if (order?.status !== "shipping") return;
    const actor = game.actors.get(order.actorId);
    const items = actor ? await this._marketItems(order) : "The character";
    if (typeof items !== "string" && (await this._marketHandOver(actor, orderId, items))) return;
    // Lost in transit: refunded by the hand-over, or here when the items are gone.
    if (typeof items === "string" && actor && hasWallet(actor) && order.total > 0) {
      await this._transfer(null, actor, order.total, `${FROM}: refund`);
      this._ledger(actor.id, order.total, `Refund: ${itemsText(order.lines)}`, "market", FROM);
    }
    this.apps.orders[orderId] = { ...order, status: "denied", gmNote: "The drone couldn't deliver. You were refunded." };
    if (actor) this._pushApps([this._alert(actor.id, { kind: "money", from: FROM, app: MARKET, text: `Delivery failed: ${itemsText(order.lines)}. You were refunded.` })]);
    else this._pushApps();
  },

  /** The host's clock: drones whose time is up land. */
  async _tickMarket() {
    const now = Date.now();
    for (const order of shippingOf(this.apps.orders)) {
      if (droneLanded(order.drone, game.time.worldTime, now)) await this._marketDeliver(order.id);
    }
  },

  /** GM: land a drone now. */
  _onMarketDeliver(user, { orderId }) {
    return this._marketDeliver(orderId);
  },

  /** Charge an order: through BangMe! (declined if they can't pay), or with `force` into the red. */
  async _marketCharge(actor, amount, reason, force) {
    if (!force || actor.system.wealth.value >= amount) return this._transfer(actor, null, amount, reason);
    if (typeof actor.deltaLedgerProperty === "function") await actor.deltaLedgerProperty("wealth", -amount, reason);
    else await actor.update({ "system.wealth.value": actor.system.wealth.value - amount });
    return true;
  },

  _onMarketDeny(user, { orderId, gmNote }) {
    const order = this.apps.orders[orderId];
    if (!order || order.status !== "pending") return;
    const note = clean(gmNote, 300);
    this.apps.orders[orderId] = { ...order, status: "denied", decidedAt: Date.now(), gmNote: note };
    this._gmCardDone([`market:${orderId}`, `market-err:${orderId}`]);
    this._pushApps([this._alert(order.actorId, { kind: "money", from: FROM, app: MARKET, text: `Order denied: ${itemsText(order.lines)}.${note ? ` "${note}"` : ""}` })]);
  },

  /** GM: drop a finished order from the lists. */
  _onMarketRemove(user, { orderId }) {
    if (["pending", "shipping"].includes(this.apps.orders[orderId]?.status)) return;
    delete this.apps.orders[orderId];
    this._pushApps();
  }
};

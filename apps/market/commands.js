import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { esc } from "../../scripts/util/text.js";
import { marketConfig, orderTotal, STORE_NAME } from "./model.js";

/*
 * Great River's GM commands, shared by the GM Phone (page.js) and the Director (director.js).
 */

/**
 * GM: approve an order. `prices` holds one entry per line (null: its listed price). Asks first if the
 * character can't pay. Returns false if it didn't go out.
 */
export async function approveOrder(orderId, { prices = [], gmNote = "" } = {}) {
  const order = store.apps.orders?.[orderId];
  if (!order) return false;
  const missing = order.lines.find((l, i) => (prices[i] ?? l.price) == null);
  if (missing) {
    ui.notifications.warn(`Set a price for ${missing.name} first.`);
    return false;
  }
  const { total } = orderTotal(order.lines.map((l, i) => ({ ...l, price: prices[i] ?? l.price })), marketConfig());
  const actor = game.actors.get(order.actorId);
  let force = false;
  if (hasWallet(actor) && actor.system.wealth.value < total) {
    force = await Dialog.confirm({
      title: `${STORE_NAME}: not enough eddies`,
      content: `<p>${esc(displayName(actor))} has ${formatMoney(actor.system.wealth.value)}, and this order is ${formatMoney(total)}.</p><p>Approve it anyway? Their balance goes below zero.</p>`,
      defaultYes: false
    });
    if (!force) return false;
  }
  return store.request("market-approve", { orderId, prices, gmNote, force });
}

/** GM: deny an order, with a note to the character. */
export function denyOrder(orderId, gmNote = "") {
  return store.request("market-deny", { orderId, gmNote });
}

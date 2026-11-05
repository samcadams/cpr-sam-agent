import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { approveOrder, denyOrder } from "./commands.js";
import { queueOf, STORE_NAME } from "./model.js";

/*
 * Great River in the GM Director (scripts/ui/director/): its pending orders in the Dashboard's
 * approvals. Approve takes the listed prices; an order with a line on request is priced in Economy → Great River.
 */

/** Pending orders, oldest first, as approval rows (see ui/director/views/dashboard.js). */
export function approvals() {
  return queueOf(store.apps.orders).map(order => {
    const actor = game.actors.get(order.actorId);
    const unpriced = order.lines.some(l => l.price == null);
    const lines = order.lines.map(l => `${l.qty > 1 ? `${l.qty}× ` : ""}${l.name}${l.price == null ? " (price on request)" : ""}`).join(", ");
    return {
      key: order.id,
      ts: order.ts,
      source: STORE_NAME,
      title: `${actor ? displayName(actor) : "?"}: ${order.total ? formatMoney(order.total) : "order"}`,
      detail: order.note ? `${lines}. “${order.note}”` : lines,
      actions: [
        unpriced
          ? { action: "goto", label: "Set prices", primary: true, title: "A line is on request: price it in Economy → Great River", data: { tab: "economy", economyApp: "market", marketTab: "queue" } }
          : { action: "market-approve", label: "Approve", title: "Approve at the listed prices" },
        { action: "market-deny", label: "Deny" }
      ]
    };
  });
}

/** Director controls (data-director), given the control's data- attributes. */
export const actions = {
  "market-approve"({ key }) {
    approveOrder(key);
  },
  "market-deny"({ key }) {
    denyOrder(key);
  }
};

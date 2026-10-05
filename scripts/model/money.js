/*
 * Eurobucks on messages: { kind: "send"|"request", amount, status, escrow? }
 *   send:    "sent" (held for the receiver) → "transferred" | "cancelled"
 *   request: "pending" → "paid" (held for the requester) → "transferred", or "declined" | "cancelled"
 * Money leaves the payer as soon as it's sent or paid and is held (escrow: true) until the receiver
 * presses Transfer. A receiver with no wallet can't hold anything: the payment goes straight to
 * "transferred" and the money disappears.
 */

import { MODULE_ID } from "../config.js";

/**
 * How eurobucks are written: a prefix and a suffix the GM sets in Control (world setting "appearance",
 * "money"). Either may be blank, e.g. prefix "" and suffix "eb" for "500eb".
 */
export const MONEY_DEFAULTS = { prefix: "§", suffix: "" };

export function moneyStyle() {
  const saved = game.settings.get(MODULE_ID, "appearance")?.money ?? {};
  return { prefix: saved.prefix ?? MONEY_DEFAULTS.prefix, suffix: saved.suffix ?? MONEY_DEFAULTS.suffix };
}

/** The currency's name for labels, e.g. "Amount (§)". */
export const currencyLabel = () => {
  const { prefix, suffix } = moneyStyle();
  return (prefix || suffix).trim() || "eb";
};
export const MAX_AMOUNT = 10_000_000;

/** Characters with a CPR wallet (the "wealth" ledger). */
export const hasWallet = actor => foundry.utils.hasProperty(actor?.system ?? {}, "wealth.value");

export function formatMoney(amount) {
  const { prefix, suffix } = moneyStyle();
  return `${prefix}${Number(amount).toLocaleString()}${suffix}`;
}

/** Money line for previews and cards, from the viewer's point of view. */
export function moneyLabel(money, mine) {
  const amount = formatMoney(money.amount);
  if (money.kind === "send") return mine ? `Sent ${amount}` : `Received ${amount}`;
  return mine ? `Requested ${amount}` : `Requests ${amount}`;
}

/** Funds have left the payer and are waiting for the receiver to transfer them. */
export const isHeld = money =>
  !!money.escrow && (money.kind === "send" ? money.status === "sent" : money.status === "paid");

/**
 * Money card for a message, from one phone's point of view.
 * "mine" = this phone wrote the message (sent the money, or made the request).
 */
export function moneyCard(message, mine, canAct) {
  const money = message.money;
  if (!money) return null;
  const { kind, status } = money;
  const receiving = kind === "send" ? !mine : mine; // this phone is owed the funds
  const pendingRequest = kind === "request" && status === "pending";
  const held = isHeld(money);

  let statusLabel = { pending: "Pending", declined: "Declined", cancelled: "Cancelled", transferred: "Transferred" }[status] ?? "";
  if (held) statusLabel = receiving ? "Ready to transfer" : "Awaiting transfer";
  else if (status === "paid") statusLabel = "Paid";

  return {
    label: moneyLabel(money, mine),
    status: held ? "held" : status,
    statusLabel,
    incoming: receiving,
    canPay: pendingRequest && !mine && canAct,
    canTransfer: held && receiving && canAct,
    canCancel: canAct && mine && (pendingRequest || (kind === "send" && held))
  };
}

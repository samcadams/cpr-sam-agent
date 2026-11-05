import { gm } from "../../scripts/host/validate.js";
import { BANG_RANGE_M, bangTargets, boughtItemData, canReachPayPoint, goodsOf, payPoints } from "./model.js";
import { isInstalled, POOL, poolOn } from "../pool/model.js";
import { agentType } from "../../scripts/model/agent.js";
import { MODULE_ID } from "../../scripts/config.js";
import { formatMoney, hasWallet, MAX_AMOUNT } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: BangMe! (see apps/bangme/model.js). Bangs between characters close by, pay points, invoices and the
 * GM's adjustments. Money in conversations stays in host/money.js.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "bang-offer": "_onBangOffer",
  "paypoint-pay": "_onPayPoint",
  "invoice-send": "_onInvoiceSend",
  "invoice-respond": "_onInvoiceRespond",
  "ledger-adjust": gm("_onLedgerAdjust")
};

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

/** What a character without BangMe! hears about an invoice. */
const NO_BANGME = "Someone is trying to invoice us. We should install BangMe! from the app store.";

export const methods = {
  /**
   * Record a movement outside conversations in a character's ledger (saved with the next push). `when` ({ time, date })
   * dates the row on another day (HusTool's downtime errands); `ts` stays real time, since the ledger sorts by it.
   */
  _ledger(actorId, amount, memo, kind, withName = "", when = null) {
    const id = foundry.utils.randomID();
    const { time, date } = when ?? agentTimestamp();
    this.apps.ledger[id] = { id, actorId, amount, memo: clean(memo, 120), kind, party: withName, ts: Date.now(), time, date };
    return id;
  },

  /**
   * A Bang: pay someone within 20 m. The other side has to accept (both "agree on an amount");
   * a character without a player accepts at once, and the GM hears about it.
   */
  _onBangOffer(user, { actorId, targetId, amount, memo }) {
    const payer = game.actors.get(actorId);
    const target = game.actors.get(targetId);
    amount = Math.floor(Number(amount));
    if (!payer || !target || !owns(user, payer) || user.isGM || !this._citinet(payer, "bangme")) return;
    if (!(amount > 0 && amount <= MAX_AMOUNT) || !hasWallet(payer) || !hasWallet(target)) return;
    if (!bangTargets(payer).some(t => t.actor.id === target.id)) {
      return this._alertNow(payer.id, { kind: "money", text: `${displayName(target)} is out of range (BangMe! reaches ${BANG_RANGE_M} m).` });
    }
    if (payer.system.wealth.value < amount) return this._alertNow(payer.id, { kind: "money", text: `Not enough in your account to Bang ${formatMoney(amount)}.` });
    memo = clean(memo, 120);
    const offer = { type: "bang", from: payer.id, to: target.id, amount, memo };
    const hasPlayer = game.users.some(u => !u.isGM && target.testUserPermission(u, "OWNER"));
    if (!hasPlayer) return this._settleBang(offer, true);
    const text = `${displayName(payer)} wants to Bang you ${formatMoney(amount)}${memo ? `: "${memo}"` : "."}`;
    const id = this._alert(target.id, { kind: "money", text, choices: ["Accept", "Decline"], ref: offer });
    const sent = this._alert(payer.id, { kind: "money", text: `Waiting for ${displayName(target)} to accept ${formatMoney(amount)}.` });
    this._pushApps([id, sent]);
  },

  /** The receiver's answer to a Bang (apps/agent/host.js ANSWERS). */
  _answerBang(alert, choice) {
    const offer = alert.ref;
    if (choice !== "Accept") {
      return this._alert(offer.from, { kind: "money", text: `${displayName(game.actors.get(offer.to))} declined your Bang of ${formatMoney(offer.amount)}.` });
    }
    return this._settleBang(offer, false);
  },

  async _settleBang(offer, npc) {
    const payer = game.actors.get(offer.from);
    const target = game.actors.get(offer.to);
    if (!payer || !target) return;
    const ok = await this._transfer(payer, target, offer.amount, `BangMe! ${displayName(payer)} → ${displayName(target)}`);
    const amount = formatMoney(offer.amount);
    if (!ok) {
      const ids = [this._alert(payer.id, { kind: "money", text: `Your Bang to ${displayName(target)} bounced: not enough in your account.` })];
      if (!npc) ids.push(this._alert(target.id, { kind: "money", text: `Bang from ${displayName(payer)} didn't go through.` }));
      this._pushApps(ids);
      return;
    }
    this._ledger(payer.id, -offer.amount, offer.memo || "Bang", "bang", displayName(target));
    this._ledger(target.id, offer.amount, offer.memo || "Bang", "bang", displayName(payer));
    const ids = [this._alert(payer.id, { kind: "money", text: `BANG! ${amount} sent to ${displayName(target)}.` })];
    if (!npc) ids.push(this._alert(target.id, { kind: "money", text: `BANG! ${amount} from ${displayName(payer)}.`, ref: { type: "bang-in" } }));
    else this._gmCard({ title: "BangMe!", body: `${displayName(payer)} Banged ${displayName(target)} ${amount}${offer.memo ? `: "${offer.memo}"` : ""}`, icon: "fa-burst" });
    this._pushApps(ids);
  },

  /**
   * Paying a pay point (a merchant the GM set up): an item from its price list, one of its goods (a
   * copy of the Item goes in the character's gear), or an amount. Anchored ones only from close by.
   */
  async _onPayPoint(user, { actorId, pointId, item, good, amount }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !this._citinet(actor, "bangme")) return;
    const point = payPoints().find(p => p.id === pointId);
    if (!point?.open) return this._alertNow(actor.id, { kind: "money", text: `${point?.name ?? "That pay point"} isn't taking payments right now.` });
    if (!canReachPayPoint(point, actor)) return this._alertNow(actor.id, { kind: "money", text: `You're too far from ${point.name} to pay.` });
    const chosen = Number.isInteger(good) ? goodsOf(point)[good] : Number.isInteger(item) ? point.items[item] : null;
    const price = chosen ? chosen.amount : Math.floor(Number(amount));
    if (!(price > 0 && price <= MAX_AMOUNT)) return this._alertNow(actor.id, { kind: "money", text: `${point.name} couldn't take that payment.` });
    const memo = chosen?.label ?? chosen?.name ?? "Payment";
    // Goods: find the template before charging, so nobody pays for something that's gone.
    const source = Number.isInteger(good) && chosen ? await fromUuid(chosen.uuid).catch(() => null) : null;
    if (Number.isInteger(good) && source?.documentName !== "Item") {
      return this._alertNow(actor.id, { kind: "money", text: `${point.name} is out of ${chosen?.name ?? "that"}.` });
    }
    const data = source ? boughtItemData(source, point.name) : null;
    if (!(await this._transfer(actor, null, price, `BangMe! ${point.name}: ${memo}`))) {
      return this._alertNow(actor.id, { kind: "money", text: `Declined at ${point.name}: not enough in your account.` });
    }
    if (source) {
      const made = await actor.createEmbeddedDocuments("Item", [data]).catch(err => {
        console.error(`${MODULE_ID} | couldn't give ${actor.name} ${source.name}`, err);
        return null;
      });
      if (!made?.length) {
        await this._transfer(null, actor, price, `BangMe! ${point.name}: refund`);
        return this._alertNow(actor.id, { kind: "money", text: `${point.name} couldn't hand over ${source.name}. Your money was refunded.` });
      }
    }
    this._ledger(actor.id, -price, memo, "paypoint", point.name);
    this._gmCard({ title: `Paid at ${point.name}`, body: `${displayName(actor)}: ${memo}, ${formatMoney(price)}${source ? " (added to their gear)" : ""}`, icon: "fa-cash-register" });
    this._pushApps([this._alert(actor.id, { kind: "money", text: `Paid ${formatMoney(price)} at ${point.name} (${memo}).${source ? ` ${source.name} is in your gear.` : ""}` })]);
  },

  /** Is BangMe! on this character's Agent? With the App Store off, every phone has it. */
  _hasBangMe(actor) {
    return !poolOn() || isInstalled(this.apps.installs, actor.id, "bangme");
  },

  /**
   * An invoice: a bill to anyone with an Agent, at any distance. A player bills as their character, to another
   * character or to the GM (targetId "gm"); the GM bills a character under any name. It stays pending until
   * the payer answers, so someone without BangMe! can pay it once they've installed it.
   */
  _onInvoiceSend(user, { actorId, targetId, fromName, amount, memo, tag }) {
    amount = Math.floor(Number(amount));
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return;
    const issuer = user.isGM ? null : game.actors.get(actorId);
    if (!user.isGM && (!issuer || !owns(user, issuer) || !hasWallet(issuer) || !this._hasBangMe(issuer) || !this._citinet(issuer, "bangme"))) return;
    const toGM = !user.isGM && targetId === "gm";
    const target = toGM ? null : game.actors.get(targetId);
    if (!toGM && (!target || target.id === issuer?.id || !hasWallet(target) || !agentType(target))) return;

    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    const name = issuer ? displayName(issuer) : clean(fromName, 60) || "Unknown";
    memo = clean(memo, 120);
    this.apps.invoices[id] = {
      id, actorIds: [issuer?.id, target?.id].filter(Boolean), fromActor: issuer?.id ?? null, fromName: name,
      toActor: target?.id ?? null, toName: target ? displayName(target) : "GM", amount, memo, status: "pending", ts: Date.now(), time, date
    };
    tag = user.isGM ? clean(tag, 100) : "";
    if (tag) this.apps.invoices[id].tag = tag; // a macro's own label for it (api.js money.invoice)
    const text = `${name} invoiced you ${formatMoney(amount)}${memo ? `: "${memo}"` : "."}`;
    const alerts = [];
    if (toGM) {
      this._gmCard({
        id: `invoice:${id}`, title: "BangMe! invoice", body: text, icon: "fa-file-invoice-dollar", open: { app: "bangme" },
        actions: [
          { label: "Pay", icon: "fa-money-bill-wave", request: "invoice-respond", data: { invoiceId: id, action: "pay" } },
          { label: "Decline", icon: "fa-xmark", request: "invoice-respond", data: { invoiceId: id, action: "decline" } }
        ]
      });
    } else if (this._hasBangMe(target)) {
      alerts.push(this._alert(target.id, { kind: "money", text, choices: ["Pay", "Decline"], ref: { type: "invoice", invoiceId: id } }));
    } else {
      alerts.push(this._alert(target.id, { kind: "system", app: POOL, text: NO_BANGME }));
    }
    if (issuer) alerts.push(this._alert(issuer.id, { kind: "money", text: `Invoice for ${formatMoney(amount)} sent to ${this.apps.invoices[id].toName}.` }));
    this._pushApps(alerts);
  },

  /** Pay, decline or cancel, from BangMe! or a GM card's buttons. */
  async _onInvoiceRespond(user, { invoiceId, action }) {
    this._pushApps(await this._respondInvoice(user, invoiceId, action));
  },

  /** The payer's answer on their Agent alert (apps/agent/host.js ANSWERS). */
  _answerInvoice(alert, choice, user) {
    return this._respondInvoice(user, alert.ref.invoiceId, choice === "Pay" ? "pay" : "decline");
  },

  /** Returns the ids of the alerts it made. An invoice that couldn't be paid stays pending. */
  async _respondInvoice(user, invoiceId, action) {
    const invoice = this.apps.invoices[invoiceId];
    if (invoice?.status !== "pending") return [];
    const payer = game.actors.get(invoice.toActor);
    const issuer = game.actors.get(invoice.fromActor);
    // The GM stands in for whichever side has no character.
    const may = (actor, id) => (id ? owns(user, actor) : user.isGM);
    const amount = formatMoney(invoice.amount);
    const toIssuer = text => issuer
      ? [this._alert(issuer.id, { kind: "money", text })]
      : (this._gmCard({ title: "BangMe! invoice", body: text, icon: "fa-file-invoice-dollar", open: { app: "bangme" } }), []);
    const toPayer = text => (payer && this._hasBangMe(payer) ? [this._alert(payer.id, { kind: "money", text })] : []);

    let status;
    let alerts;
    if (action === "pay" && may(payer, invoice.toActor)) {
      if (payer && !this._hasBangMe(payer)) return [this._alert(payer.id, { kind: "system", app: POOL, text: NO_BANGME })];
      if (payer && !this._citinet(payer, "bangme")) return [];
      const reason = `BangMe! invoice: ${invoice.fromName} → ${invoice.toName}`;
      if (!(await this._transfer(payer, issuer, invoice.amount, reason))) {
        return [this._alert(payer.id, { kind: "money", text: `Not enough in your account to pay ${invoice.fromName} ${amount}. The invoice is still in BangMe!.` })];
      }
      const memo = invoice.memo || "Invoice";
      if (payer) this._ledger(payer.id, -invoice.amount, memo, "invoice", invoice.fromName);
      if (issuer) this._ledger(issuer.id, invoice.amount, memo, "invoice", invoice.toName);
      status = "paid";
      alerts = [
        ...(payer ? [this._alert(payer.id, { kind: "money", text: `Paid ${invoice.fromName} ${amount}.` })] : []),
        ...(issuer
          ? [this._alert(issuer.id, { kind: "money", text: `${invoice.toName} paid your invoice: ${amount}.`, ref: { type: "bang-in" } })]
          : toIssuer(`${invoice.toName} paid your invoice from ${invoice.fromName}: ${amount}.`))
      ];
    } else if (action === "decline" && may(payer, invoice.toActor)) {
      status = "declined";
      alerts = toIssuer(`${invoice.toName} declined your invoice for ${amount}.`);
    } else if (action === "cancel" && may(issuer, invoice.fromActor)) {
      status = "cancelled";
      alerts = toPayer(`${invoice.fromName} cancelled their invoice for ${amount}.`);
    } else {
      return [];
    }
    invoice.status = status;
    // The question is settled wherever it was still being asked.
    const answer = { pay: "Pay", decline: "Decline", cancel: "Cancelled" }[action];
    for (const alert of Object.values(this.apps.alerts)) {
      if (alert.ref?.type === "invoice" && alert.ref.invoiceId === invoiceId && !alert.answer) alert.answer = answer;
    }
    this._gmCardDone(`invoice:${invoiceId}`);
    Hooks.callAll(`${MODULE_ID}.invoiceSettled`, { invoiceId, status, actorId: invoice.toActor, amount: invoice.amount, memo: invoice.memo, tag: invoice.tag ?? null, userId: user.id });
    return alerts;
  },

  /** GM: put money on or take it off a sheet, with a line in the ledger ("Eurobank reversal"). */
  async _onLedgerAdjust(user, { actorId, amount, memo }) {
    const actor = game.actors.get(actorId);
    amount = Math.trunc(Number(amount));
    if (!actor || !hasWallet(actor) || !amount || Math.abs(amount) > MAX_AMOUNT) return;
    memo = clean(memo, 120) || "Eurobank adjustment";
    const ok = amount > 0 ? await this._transfer(null, actor, amount, memo) : await this._transfer(actor, null, -amount, memo);
    if (!ok) return ui.notifications.warn(`${displayName(actor)} doesn't have ${formatMoney(-amount)}.`);
    this._ledger(actor.id, amount, memo, "adjust", "Eurobank");
    this._pushApps([this._alert(actor.id, { kind: "money", text: `${amount > 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}: ${memo}` })]);
  }
};

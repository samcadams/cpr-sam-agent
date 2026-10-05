import { gm } from "./validate.js";
import { canUsePhone } from "../model/agent.js";
import { BANG_RANGE_M, bangTargets, payPoints } from "../model/bangme.js";
import { formatMoney, hasWallet, MAX_AMOUNT } from "../model/money.js";
import { displayName } from "../model/threads.js";
import { agentTimestamp } from "../util/agentTime.js";
import { clean } from "../util/text.js";

/*
 * Host: BangMe! (see model/bangme.js). Bangs between characters close by, pay points, and the GM's
 * adjustments. Money in conversations stays in host/money.js.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "bang-offer": "_onBangOffer",
  "paypoint-pay": "_onPayPoint",
  "ledger-adjust": gm("_onLedgerAdjust")
};

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  /** Record a movement outside conversations in a character's ledger (saved with the next push). */
  _ledger(actorId, amount, memo, kind, withName = "") {
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
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
    if (!payer || !target || !owns(user, payer) || user.isGM || !canUsePhone(payer)) return;
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

  /** The receiver's answer to a Bang (host/agent.js ANSWERS). */
  _answerBang(alert, choice) {
    const offer = alert.ref;
    if (choice !== "Accept") {
      this._alert(offer.from, { kind: "money", text: `${displayName(game.actors.get(offer.to))} declined your Bang of ${formatMoney(offer.amount)}.` });
      return;
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
      this._alertNow(payer.id, { kind: "money", text: `Your Bang to ${displayName(target)} bounced: not enough in your account.` });
      return;
    }
    this._ledger(payer.id, -offer.amount, offer.memo || "Bang", "bang", displayName(target));
    this._ledger(target.id, offer.amount, offer.memo || "Bang", "bang", displayName(payer));
    const ids = [this._alert(payer.id, { kind: "money", text: `BANG! ${amount} sent to ${displayName(target)}.` })];
    if (!npc) ids.push(this._alert(target.id, { kind: "money", text: `BANG! ${amount} from ${displayName(payer)}.`, ref: { type: "bang-in" } }));
    else this._gmCard({ title: "BangMe!", body: `${displayName(payer)} Banged ${displayName(target)} ${amount}${offer.memo ? `: "${offer.memo}"` : ""}`, icon: "fa-burst" });
    this._pushApps(ids);
  },

  /** Paying a pay point (a merchant the GM set up): an item from its list, or an amount. */
  async _onPayPoint(user, { actorId, pointId, item, amount }) {
    const actor = game.actors.get(actorId);
    const point = payPoints().find(p => p.id === pointId && p.open);
    if (!actor || !point || user.isGM || !owns(user, actor) || !canUsePhone(actor)) return;
    const chosen = Number.isInteger(item) ? point.items[item] : null;
    const price = chosen ? chosen.amount : Math.floor(Number(amount));
    if (!(price > 0 && price <= MAX_AMOUNT)) return;
    const memo = chosen?.label ?? "Payment";
    if (!(await this._transfer(actor, null, price, `BangMe! ${point.name}: ${memo}`))) {
      return this._alertNow(actor.id, { kind: "money", text: `Declined at ${point.name}: not enough in your account.` });
    }
    this._ledger(actor.id, -price, memo, "paypoint", point.name);
    this._gmCard({ title: `Paid at ${point.name}`, body: `${displayName(actor)}: ${memo}, ${formatMoney(price)}`, icon: "fa-cash-register" });
    this._pushApps([this._alert(actor.id, { kind: "money", text: `Paid ${formatMoney(price)} at ${point.name} (${memo}).` })]);
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
    this._pushApps();
  }
};

import { findContact, getContacts } from "../model/contacts.js";
import { commsOn } from "../model/features.js";
import { formatMoney, hasWallet, isHeld, MAX_AMOUNT } from "../model/money.js";
import { otherSide, sideFor } from "../model/permissions.js";
import { getService } from "../model/services.js";
import { isDirect, isService } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: sending, requesting and transferring eurobucks. See model/money.js for the states.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "money-send": "_onMoneySend",
  "money-respond": "_onMoneyRespond"
};

export const methods = {
  /** The sheet whose wallet a side uses, or null (money appears/vanishes). */
  _sideActor(thread, side) {
    if (side === "pc") return game.actors.get(thread.actorId) ?? null;
    if (isService(thread)) return null;
    const linkedId = thread.contactActorId
      ?? findContact(getContacts(game.actors.get(thread.actorId)), thread.contact)?.actorId;
    return linkedId ? game.actors.get(linkedId) ?? null : null;
  },

  /** Move money between wallets; a missing wallet is simply skipped. False if the payer can't afford it. */
  async _transfer(from, to, amount, reason) {
    from = hasWallet(from) ? from : null;
    to = hasWallet(to) ? to : null;
    if (from && from.system.wealth.value < amount) return false;
    const apply = async (actor, delta) => {
      if (typeof actor.deltaLedgerProperty === "function") return actor.deltaLedgerProperty("wealth", delta, reason);
      return actor.update({ "system.wealth.value": actor.system.wealth.value + delta });
    };
    if (from) await apply(from, -amount);
    if (to) await apply(to, amount);
    return true;
  },

  /** Resolve the direct/service thread a money request is about (creating it if needed). */
  async _moneyThread(user, msg) {
    if (msg.serviceId) {
      // Services bill players (the GM sends or requests); players only pay what they're asked for.
      if (!user.isGM) return null;
      const actor = game.actors.get(msg.actorId);
      const service = getService(msg.serviceId);
      return actor && service ? this._serviceThread(actor, service) : null;
    }
    if (user.isGM) return this._gmDirect(msg);
    const found = this._playerDirect(user, msg);
    return found ? found.thread ?? this._getOrCreate(found.actor, found.contact, found.entry) : null;
  },

  /** Post into a direct thread (mirrored for PC-to-PC) or a service thread. */
  _postMoney(thread, message, notify = true) {
    if (isDirect(thread)) return this._postDirect(thread, message, notify);
    thread.messages.push(message);
    this.save();
    this._push(thread, notify);
  },

  /**
   * Money is two-step. Sending (or paying a request) takes the funds from the payer straight away
   * and holds them (escrow: true); the receiver presses Transfer to deposit them. A receiver with no
   * wallet can't hold anything, so the money simply disappears and the payment completes at once.
   */
  async _onMoneySend(user, msg) {
    const amount = Math.floor(Number(msg.amount));
    const kind = msg.kind === "request" ? "request" : "send";
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return;
    const thread = await this._moneyThread(user, msg);
    if (!thread) return;
    const side = sideFor(user, thread);
    if (!side) return;

    let money = { kind, amount, status: "pending" };
    if (kind === "send") {
      const other = otherSide(thread, side);
      const reason = `Agent transfer to ${this._partyName(thread, other)}`;
      if (!(await this._transfer(this._sideActor(thread, side), null, amount, reason))) {
        // Can't afford it: don't leave behind a conversation this created.
        if (!thread.messages.length) this.threads.delete(thread.id);
        return;
      }
      const held = hasWallet(this._sideActor(thread, other));
      money = { kind, amount, status: held ? "sent" : "transferred", escrow: held };
    }

    const message = this._message(side, clean(msg.note, 200), { userId: user.id, money });
    thread.lastRead[user.isGM ? "gm" : "owner"] = message.ts;
    this._postMoney(thread, message);
  },

  async _onMoneyRespond(user, { threadId, messageId, action }) {
    const thread = this.threads.get(threadId);
    const message = thread?.messages.find(m => m.id === messageId);
    const money = message?.money;
    if (!money) return;
    // Communications off: only BangMe!'s Transfer of money already held (conversations are out of reach).
    if (!commsOn() && action !== "transfer") return;
    const side = sideFor(user, thread);
    const payer = money.kind === "send" ? message.from : otherSide(thread, message.from);
    const receiver = otherSide(thread, payer);
    const name = s => this._partyName(thread, s);
    const amount = formatMoney(money.amount);

    let status;
    let text;
    let escrow = money.escrow;
    if (action === "pay") {
      // Payer answers a request: funds leave their wallet and wait for the requester.
      if (money.kind !== "request" || money.status !== "pending" || side !== payer) return;
      const reason = `Agent payment to ${name(receiver)}`;
      if (!(await this._transfer(this._sideActor(thread, payer), null, money.amount, reason))) return;
      escrow = hasWallet(this._sideActor(thread, receiver));
      status = escrow ? "paid" : "transferred";
      text = `${name(payer)} paid ${amount}`;
    } else if (action === "decline") {
      if (money.kind !== "request" || money.status !== "pending" || side !== payer) return;
      status = "declined";
      text = `${name(payer)} declined the request`;
    } else if (action === "cancel") {
      if (money.kind === "request") {
        // The requester withdraws an unpaid request.
        if (money.status !== "pending" || side !== message.from) return;
        text = "Payment request cancelled";
      } else {
        // The sender pulls back money that hasn't been transferred yet: refund it.
        if (money.status !== "sent" || !money.escrow || side !== payer) return;
        await this._transfer(null, this._sideActor(thread, payer), money.amount, `Agent transfer to ${name(receiver)} cancelled`);
        text = `${name(payer)} cancelled the transfer`;
      }
      status = "cancelled";
    } else if (action === "transfer") {
      // The receiver deposits held funds.
      if (!isHeld(money) || side !== receiver) return;
      await this._transfer(null, this._sideActor(thread, receiver), money.amount, `Agent transfer from ${name(payer)}`);
      status = "transferred";
      text = `${name(receiver)} transferred ${amount}`;
    } else {
      return;
    }

    const update = m => {
      m.money.status = status;
      m.money.escrow = escrow;
    };
    update(message);
    // PC-to-PC: keep the other player's copy in step.
    const mirror = isDirect(thread) && message.pairId ? this._mirror(thread, false) : null;
    const twin = mirror?.messages.find(m => m.pairId === message.pairId);
    if (twin?.money) update(twin);

    // _postDirect pushes the mirror too, so the twin's new status goes out with it.
    // "Transferred" arrives alongside the money sound, so it doesn't also play the text tone.
    const quiet = action === "transfer";
    this._postMoney(thread, this._message(side, text, { system: true, alert: true, moneyNotice: true, quiet, userId: user.id }));
  }
};

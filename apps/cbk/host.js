import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { canUsePhone, isPlayerCharacter } from "../../scripts/model/agent.js";
import { feature, noSignalSince } from "../../scripts/model/features.js";
import { appFeature } from "../../scripts/model/apps.js";
import { isInstalled, rowsOf } from "../pool/model.js";
import { formatMoney, hasWallet, priceTierKey } from "../../scripts/model/money.js";
import { boughtItems } from "../../scripts/model/shop.js";
import { findContact, getContacts, playerCharacters, setContacts } from "../../scripts/model/contacts.js";
import { actorAvatar, displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { clean, esc } from "../../scripts/util/text.js";
import {
  auctionable, auctionOf, bidProblem, boothLine, BROADCAST_KINDS, broadcastText, buyProblem, canBroadcast, canEnter, CBK, cbkConfig, courierName, dealKey, dealPctOf, highBid, inviteKey,
  listingOf, marketOf, passcodeProblem, pickupProblem, playRex, priceNow, receiptCode, REX_PCT, stockKey, BROADCAST_REF
} from "./model.js";

/*
 * Host: CBK (see apps/cbk/model.js). Players buy (charged at once, a receipt written, the listing's stock
 * taken down) and pick up at the booth (the item goes in their gear, only while the market is live). The GM
 * hands a receipt over or refunds it. Receipts are the table "receipts"; the markets are the world setting
 * "cbk" (the GM's); the stock left is the table "cbkStock", written only here, so sales and the GM's edits
 * can't race. The Fixer's broadcasts are saved on the market by the GM Phone; the host only
 * delivers them as alerts. Invites gate who may enter a market; auctions and Rex's game are
 * host tables too. Requests run one at a time (host/core.js), so a bid or a Sold! can't race another.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "cbk-buy": "_onCbkBuy",
  "cbk-pickup": "_onCbkPickup",
  "cbk-handover": gm("_onCbkHandover"),
  "cbk-restock": gm("_onCbkRestock"),
  "cbk-refund": gm("_onCbkRefund"),
  "cbk-broadcast": gm("_onCbkBroadcast"),
  "cbk-broadcast-end": gm("_onCbkBroadcastEnd"),
  "cbk-live": gm("_onCbkLive"),
  "cbk-invite-accept": "_onCbkInviteAccept",
  "cbk-invite-send": gm("_onCbkInviteSend"),
  "cbk-invite-give": gm("_onCbkInviteGive"),
  "cbk-message-fixer": "_onCbkMessageFixer",
  "cbk-bid": "_onCbkBid",
  "cbk-auction-start": gm("_onCbkAuctionStart"),
  "cbk-auction-sold": gm("_onCbkAuctionSold"),
  "cbk-auction-cancel": gm("_onCbkAuctionCancel"),
  "cbk-rex-play": "_onCbkRexPlay",
  "cbk-rex-resolve": gm("_onCbkRexResolve")
};

const FROM = "CBK";
const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  /** A player's own character, with their Agent on them and a signal (CBK needs the market's broadcast). */
  _cbkActor(user, actorId) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor)) return null;
    if (noSignalSince(actorId)) {
      this._alertNow(actorId, { kind: "system", from: FROM, app: CBK, text: "Searching for database… No CitiNet connection." });
      return null;
    }
    return canUsePhone(actor) ? actor : null;
  },

  /** BUY NOW!!!: charge the listing's price (less a flash sale), write a receipt, take one off the stock. */
  async _onCbkBuy(user, { actorId, marketId, listingId, price: shown }) {
    const actor = this._cbkActor(user, actorId);
    if (!actor) return;
    const config = cbkConfig(this.apps.cbkStock);
    const market = marketOf(config, marketId);
    const listing = listingOf(market, listingId);
    const wallet = hasWallet(actor);
    // An invite-only market the character holds no invite to doesn't exist for them.
    if (market && !canEnter(market, actor, this.apps.cbkInvites)) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: "That listing is gone." });
    const dealPct = dealPctOf(this.apps.cbkDeals, marketId, listingId, actor.id);
    const problem = buyProblem({ market, listing, wealth: wallet ? actor.system.wealth.value : null, dealPct, auction: auctionOf(this.apps.cbkAuctions, marketId, listingId) });
    if (problem) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: problem });
    const price = priceNow(market, listing, Date.now(), dealPct);
    // The flash sale ended between the player's confirm and here: they agreed to another price.
    if (Number.isFinite(shown) && shown !== price) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: `${listing.name} is ${formatMoney(price)} now. Nothing was charged.` });
    if (listing.app && rowsOf(this.apps.installs, actor.id)[listing.app]?.revoked) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: `${listing.name} was taken off your Agent. Ask your GM.` });
    if (listing.app && !feature(appFeature(listing.app))) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: `${listing.name} doesn't run on Agents here.` });
    if (listing.app && isInstalled(this.apps.installs, actor.id, listing.app)) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: `${listing.name} is already on your Agent.` });
    // Take it off the shelf first, so two buyers can't both get the last one.
    this._cbkStock(marketId, listingId, -1);
    if (wallet && price > 0 && !(await this._transfer(actor, null, price, `CBK ${market.name}: ${listing.name}`))) {
      this._cbkStock(marketId, listingId, 1);
      return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: `Payment declined for ${listing.name}.` });
    }
    if (wallet && price > 0) this._ledger(actor.id, -price, listing.name, "cbk", market.name);
    // Rex's discount is spent, when it's what made the price (a bigger flash sale leaves it for later).
    if (dealPct && price < priceNow(market, listing)) {
      const key = dealKey(marketId, listingId, actor.id);
      this.apps.cbkDeals[key] = { ...this.apps.cbkDeals[key], status: "used" };
    }
    await this._cbkSale(actor, user.id, market, listing, price);
  },

  /** A paid sale (BUY NOW!!!, or Sold! at an auction): the receipt, the GM's card, the alert and the Achieve!. */
  async _cbkSale(actor, userId, market, listing, price) {
    const marketId = market.id;
    const listingId = listing.id;
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    this.apps.receipts[id] = {
      id, actorId: actor.id, userId, marketId, market: market.name, letter: market.letter, fixer: market.fixer, listingId,
      uuid: listing.uuid, name: listing.name, img: listing.img, type: listing.type, booths: listing.booths, price,
      ts: Date.now(), time, date, status: "paid"
    };
    // An app: no booth, it installs now through the App Store; the receipt stays for a refund.
    if (listing.app) {
      Object.assign(this.apps.receipts[id], { app: listing.app, status: "picked", doneAt: Date.now() });
      this._poolInstallFrom(actor.id, listing.app, { source: "cbk", paid: price, quiet: true });
    }
    this._gmCard({
      id: `cbk:${id}`, title: `CBK: ${market.name}`, icon: "fa-receipt", open: { app: CBK },
      body: `${esc(displayName(actor))} bought ${esc(listing.name)} for ${formatMoney(price)} (receipt ${receiptCode(id)}${listing.app ? ", installed" : `, ${esc(boothLine(listing.booths))}`}).`,
      actions: listing.app ? [] : [{ label: "Hand over", icon: "fa-hand-holding", request: "cbk-handover", data: { receiptId: id } }]
    });
    const where = listing.app ? "It's on your Agent." : `${boothLine(listing.booths)}: show receipt ${receiptCode(id)}.`;
    this._pushApps([this._alert(actor.id, { kind: "money", from: FROM, app: CBK, text: `Bought ${listing.name} for ${formatMoney(price)}. ${where}` })]);

    // Achieve!'s "Investment": a Luxury or Super Luxury item from a Night Market.
    if (["luxury", "superLuxury"].includes(priceTierKey(price))) {
      await this._achieveEarn(actor.id, "investment", `Bought ${listing.name} for ${formatMoney(price)} at ${market.name}.`);
    }
  },

  /** Change a listing's stock left by `delta` (unlimited stock stays unlimited). Sent with the next _pushApps. */
  _cbkStock(marketId, listingId, delta) {
    const listing = listingOf(marketOf(cbkConfig(this.apps.cbkStock), marketId), listingId);
    if (listing && listing.stock !== null) this._cbkSetStock(marketId, listingId, Math.max(0, listing.stock + delta));
  },

  /**
   * Set a listing's stock left (null: drop the row, the setting's value counts again). `base` is the
   * setting's value now (see model.js): the GM Phone saves the setting before it asks for a restock.
   */
  _cbkSetStock(marketId, listingId, stock) {
    const id = stockKey(marketId, listingId);
    if (stock === null) return delete this.apps.cbkStock[id];
    const base = listingOf(marketOf(cbkConfig(), marketId), listingId)?.stock ?? null;
    this.apps.cbkStock[id] = { id, marketId, listingId, stock, base, everyone: true };
  },

  /** GM: set a listing's stock left from the GM Phone (the GM's client saves the setting's value itself). */
  _onCbkRestock(user, { marketId, listingId, stock }) {
    if (typeof marketId !== "string" || typeof listingId !== "string") return;
    const n = stock === null ? null : Math.floor(Number(stock));
    if (n !== null && !(Number.isFinite(n) && n >= 0)) return;
    this._cbkSetStock(marketId, listingId, n);
    this._pushApps();
  },

  /** Show the receipt at the booth: the item goes in the gear (only while the market is live). */
  async _onCbkPickup(user, { actorId, receiptId }) {
    const actor = game.actors.get(actorId);
    const receipt = this.apps.receipts[receiptId];
    if (!actor || !owns(user, actor) || receipt?.actorId !== actorId || !canUsePhone(actor)) return;
    const problem = pickupProblem(receipt, cbkConfig());
    if (problem) return this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text: problem });
    await this._cbkHandOver(actor, receiptId);
  },

  /** Put a receipt's item in the gear and mark it picked up. Returns whether it worked. */
  async _cbkHandOver(actor, receiptId, by = "") {
    const receipt = this.apps.receipts[receiptId];
    if (receipt?.status !== "paid") return false;
    // Marked first, so a second tap can't hand it over twice.
    this.apps.receipts[receiptId] = { ...receipt, status: "picked", doneAt: Date.now() };
    const source = receipt.uuid ? await fromUuid(receipt.uuid).catch(() => null) : null;
    const flag = { receipt: receiptId, market: receipt.market, price: receipt.price };
    const items = source?.documentName === "Item"
      ? boughtItems(source, 1, flag, "cbk")
      : [{ name: receipt.name, type: "gear", img: receipt.img || undefined, system: { description: { value: `<p>Bought at ${esc(receipt.market)} through CBK. Ask your GM for its stats.</p>` } }, flags: { [MODULE_ID]: { cbk: flag } } }];
    const made = await actor.createEmbeddedDocuments("Item", items).catch(err => {
      console.error(`${MODULE_ID} | CBK couldn't give ${actor.name} ${receipt.name}`, err);
      return null;
    });
    if (!made?.length) {
      this.apps.receipts[receiptId] = receipt;
      this._gmCard({ id: `cbk-err:${receiptId}`, open: { app: CBK }, title: FROM, body: `Couldn't put ${esc(receipt.name)} in ${esc(displayName(actor))}'s gear. The receipt is still good.`, icon: "fa-triangle-exclamation" });
      this._pushApps();
      return false;
    }
    this._gmCardDone([`cbk:${receiptId}`, `cbk-err:${receiptId}`]);
    this._pushApps([this._alert(actor.id, { kind: "money", from: receipt.fixer || FROM, app: CBK, text: `${by || `Booth ${receipt.booths?.[0] ?? "?"}`}: here's your ${receipt.name}. It's in your gear.` })]);
    return true;
  },

  /** GM: hand a receipt's item over (the Fixer brings it to them). */
  async _onCbkHandover(user, { receiptId }) {
    const receipt = this.apps.receipts[receiptId];
    const actor = game.actors.get(receipt?.actorId);
    if (actor) await this._cbkHandOver(actor, receiptId, receipt.fixer || receipt.market);
  },

  /** GM: deliver a broadcast the GM Phone just saved on a live market to every phone with a signal. */
  _onCbkBroadcast(user, { marketId, broadcastId }) {
    const market = marketOf(cbkConfig(), marketId);
    const b = market?.broadcasts.find(x => x.id === broadcastId);
    if (!b || !market.live || !canBroadcast(user, market)) return;
    this._cbkTell(market, { flash: "event", raid: "raid", policy: "reminder", date: "event" }[b.kind], broadcastText(b, market), { type: BROADCAST_REF, marketId, broadcastId });
  },

  /** GM: a flash sale or raid warning ended early (the GM Phone set its end to now): tell the phones. */
  _onCbkBroadcastEnd(user, { marketId, broadcastId }) {
    const market = marketOf(cbkConfig(), marketId);
    const b = market?.broadcasts.find(x => x.id === broadcastId);
    if (!b || !market.live || !canBroadcast(user, market) || !["flash", "raid"].includes(b.kind)) return;
    this._cbkTell(market, "system", b.kind === "raid" ? "All clear." : `${BROADCAST_KINDS.flash.label} over.`);
  },

  /**
   * GM: a market went live or closed (the GM Phone saved it): tell the phones. Closing ends its
   * auctions (every hold back) and Rex's plays, so the next opening deals again.
   */
  async _onCbkLive(user, { marketId, live }) {
    const market = marketOf(cbkConfig(), marketId);
    if (!market || market.live !== !!live) return;
    if (!live) {
      for (const row of Object.values(this.apps.cbkAuctions)) {
        if (row.marketId === marketId && row.status === "open") await this._cbkAuctionClose(row, "The market closed");
      }
      for (const row of Object.values(this.apps.cbkDeals)) {
        if (row.marketId === marketId) {
          delete this.apps.cbkDeals[row.id];
          this._gmCardDone(`cbk-rex:${row.id}`);
        }
      }
    }
    this._cbkTell(market, live ? "event" : "system", live ? "Now live. Open CBK to browse." : "Closed. See you next time.");
  },

  /* Invites */

  /** GM: a passcode invite in a conversation, from `contact` (the market's Fixer contact unless the GM says otherwise). */
  async _onCbkInviteSend(user, { actorId, marketId, contact, note }) {
    const market = marketOf(cbkConfig(), marketId);
    if (!game.actors.get(actorId) || !market?.access.passcode) return;
    const thread = await this._gmDirect({ actorId, contact: clean(contact, 60) || market.fixerContact || market.fixer || "Fixer" });
    if (!thread) return;
    const text = clean(note, 200) || `You're invited to ${market.name}. The code: ${market.access.passcode}`;
    const message = this._message("contact", text, { userId: user.id, cbk: { marketId, market: market.name, status: "offered" } });
    thread.lastRead.gm = message.ts;
    this._postDirect(thread, message);
  },

  /** A player types the code into an invite they were sent. A wrong one is only told so; they can try again. */
  _onCbkInviteAccept(user, { threadId, messageId, code }) {
    const thread = this.threads.get(threadId);
    const message = thread?.messages.find(m => m.id === messageId);
    const actor = game.actors.get(thread?.actorId);
    if (message?.cbk?.status !== "offered" || user.isGM || !owns(user, actor) || !canUsePhone(actor)) return;
    const market = marketOf(cbkConfig(), message.cbk.marketId);
    const problem = passcodeProblem(market, code);
    if (problem) return this._alertNow(actor.id, { kind: "warning", from: thread.contact, app: CBK, text: problem });
    message.cbk.status = "accepted";
    const id = inviteKey(actor.id, market.id);
    this.apps.cbkInvites[id] = { id, actorId: actor.id, marketId: market.id, at: Date.now(), via: "passcode" };
    this.save();
    this._push(thread);
    this._pushApps([this._alert(actor.id, { kind: "system", from: thread.contact, app: CBK, text: `You're on the list for ${market.name}.` })]);
  },

  /** GM: hand a character a card or a courier invitation: a plain gear item carrying the invite, so it can change hands. */
  async _onCbkInviteGive(user, { actorId, marketId, via }) {
    const actor = game.actors.get(actorId);
    const market = marketOf(cbkConfig(), marketId);
    if (!actor || !market || !["card", "courier"].includes(via)) return;
    const name = via === "card" ? "Signed Playing Card" : courierName(market);
    const value = `<p>An invitation to ${esc(market.name)}${market.fixer ? `, from ${esc(market.fixer)}` : ""}. Whoever carries it gets in.</p>`;
    await actor.createEmbeddedDocuments("Item", [{ name, type: "gear", system: { description: { value } }, flags: { [MODULE_ID]: { cbkInvite: market.id } } }]);
    this._pushApps([this._alert(actor.id, { kind: "system", from: market.fixer || FROM, app: CBK, text: `You've got a ${name} for ${market.name}. It's in your gear.` })]);
  },

  /* Message the Fixer */

  /** A player asks to write to the market's Fixer: the contact goes on their phone (their page opens the conversation). */
  async _onCbkMessageFixer(user, { actorId, marketId }) {
    const actor = this._cbkActor(user, actorId);
    const market = marketOf(cbkConfig(), marketId);
    if (!actor || !market?.live || !market.fixerContact || !canEnter(market, actor, this.apps.cbkInvites)) return;
    const name = market.fixerContact;
    if (findContact(getContacts(actor), name)) return;
    const sheet = game.actors.find(a => !isPlayerCharacter(a) && displayName(a).toLowerCase() === name.toLowerCase());
    await (sheet ? setContacts(actor, [...getContacts(actor), { name, img: actorAvatar(sheet), actorId: sheet.id }]) : this._ensureContact(actor, name, null));
  },

  /* Mister K's auction */

  /** GM: open the bidding on a Super Luxury listing of a live market. */
  _onCbkAuctionStart(user, { marketId, listingId, reserve }) {
    const market = marketOf(cbkConfig(this.apps.cbkStock), marketId);
    const listing = listingOf(market, listingId);
    if (!market?.live || !auctionable(listing) || listing.stock === 0 || auctionOf(this.apps.cbkAuctions, marketId, listingId)) return;
    const id = stockKey(marketId, listingId);
    this.apps.cbkAuctions[id] = { id, marketId, listingId, market: market.name, name: listing.name, status: "open", reserve: Math.max(0, Math.floor(Number(reserve) || 0)), bids: [], everyone: true };
    this._cbkTell(market, "event", `Auction open: ${listing.name}. Bid in CBK.`);
  },

  /** A bid: the money is held at once; the bid it beats gets its money back at once. */
  async _onCbkBid(user, { actorId, marketId, listingId, amount }) {
    const actor = this._cbkActor(user, actorId);
    if (!actor) return;
    const market = marketOf(cbkConfig(this.apps.cbkStock), marketId);
    const auction = auctionOf(this.apps.cbkAuctions, marketId, listingId);
    const wallet = hasWallet(actor);
    amount = Number(amount);
    const refuse = text => this._alertNow(actor.id, { kind: "warning", from: FROM, app: CBK, text });
    if (market && !canEnter(market, actor, this.apps.cbkInvites)) return refuse("That auction is over.");
    const problem = bidProblem({ market, listing: listingOf(market, listingId), auction, amount, wealth: wallet ? actor.system.wealth.value : null, actorId: actor.id });
    if (problem) return refuse(problem);
    const high = highBid(auction);
    const mine = high?.actorId === actor.id;
    // Raising your own bid only takes the difference.
    const take = mine ? amount - high.amount : amount;
    if (wallet && !(await this._transfer(actor, null, take, `CBK ${market.name}: bid on ${auction.name}`))) return refuse(`Payment declined for ${auction.name}.`);
    if (wallet) this._ledger(actor.id, -take, `Bid held: ${auction.name}`, "cbk", market.name);
    auction.bids.push({ actorId: actor.id, userId: user.id, amount, ts: Date.now() });
    const alerts = [this._alert(actor.id, { kind: "money", from: FROM, app: CBK, text: `You're the high bidder on ${auction.name} at ${formatMoney(amount)}. It's held until the hammer falls.` })];
    if (high && !mine) {
      await this._cbkRelease(high, auction);
      alerts.push(this._alert(high.actorId, { kind: "money", from: FROM, app: CBK, text: `Outbid on ${auction.name}. Your ${formatMoney(high.amount)} is back.` }));
    }
    this._pushApps(alerts);
  },

  /** A held bid goes back to its bidder. */
  async _cbkRelease(bid, auction) {
    const actor = game.actors.get(bid.actorId);
    if (!hasWallet(actor)) return;
    await this._transfer(null, actor, bid.amount, `CBK ${auction.market}: bid on ${auction.name} back`);
    this._ledger(actor.id, bid.amount, `Bid back: ${auction.name}`, "cbk", auction.market);
  },

  /** End an auction with nobody winning: the hold goes back, and the high bidder is told why. */
  async _cbkAuctionClose(auction, why) {
    auction.status = "closed";
    const high = highBid(auction);
    if (!high) return this._pushApps();
    await this._cbkRelease(high, auction);
    this._pushApps([this._alert(high.actorId, { kind: "money", from: FROM, app: CBK, text: `${why}: the auction for ${auction.name} is off. Your ${formatMoney(high.amount)} is back.` })]);
  },

  /** GM: the hammer falls: the high bidder pays what's held and gets a receipt for the booth, as for a buy. */
  async _onCbkAuctionSold(user, { marketId, listingId }) {
    const auction = auctionOf(this.apps.cbkAuctions, marketId, listingId);
    const high = highBid(auction);
    if (!high) return;
    const market = marketOf(cbkConfig(this.apps.cbkStock), marketId);
    const listing = listingOf(market, listingId);
    const actor = game.actors.get(high.actorId);
    if (!market || !listing || !actor) return this._cbkAuctionClose(auction, "The lot is gone");
    auction.status = "sold";
    this._cbkStock(marketId, listingId, -1);
    this._cbkTell(market, "event", `Sold! ${listing.name} went for ${formatMoney(high.amount)}.`);
    await this._cbkSale(actor, high.userId, market, listing, high.amount);
  },

  /** GM: call the auction off. */
  async _onCbkAuctionCancel(user, { marketId, listingId }) {
    const auction = auctionOf(this.apps.cbkAuctions, marketId, listingId);
    if (auction) await this._cbkAuctionClose(auction, "Called off");
  },

  /* Rex's game */

  /** A player asks to play for a listing: one play per listing per character per opening. The GM resolves it. */
  _onCbkRexPlay(user, { actorId, marketId, listingId }) {
    const actor = this._cbkActor(user, actorId);
    if (!actor) return;
    const market = marketOf(cbkConfig(this.apps.cbkStock), marketId);
    const listing = listingOf(market, listingId);
    const refuse = text => this._alertNow(actor.id, { kind: "warning", from: market?.fixer || FROM, app: CBK, text });
    if (!market?.live || market.game !== "rex" || !listing || listing.hidden || !canEnter(market, actor, this.apps.cbkInvites)) return refuse("That game is over.");
    const id = dealKey(marketId, listingId, actor.id);
    if (this.apps.cbkDeals[id]) return refuse(`You've already played for ${listing.name} this market.`);
    this.apps.cbkDeals[id] = { id, actorId: actor.id, userId: user.id, marketId, listingId, name: listing.name, status: "pending", ts: Date.now() };
    this._gmCard({
      id: `cbk-rex:${id}`, title: `CBK: ${market.name}`, icon: "fa-dice", open: { app: CBK },
      body: `${esc(displayName(actor))} plays Rex's game for ${esc(listing.name)}.`,
      actions: [
        { label: "Coin flip", icon: "fa-coins", request: "cbk-rex-resolve", data: { dealId: id, how: "coin" } },
        { label: "Card draw", icon: "fa-diamond", request: "cbk-rex-resolve", data: { dealId: id, how: "card" } }
      ]
    });
    this._pushApps([this._alert(actor.id, { kind: "system", from: market.fixer || FROM, app: CBK, text: `Let's play for ${listing.name}. The favour's on you.` })]);
  },

  /** GM: flip the coin or draw the cards: a win is a one-time discount, a loss changes nothing. The table sees it. */
  async _onCbkRexResolve(user, { dealId, how }) {
    const deal = this.apps.cbkDeals[dealId];
    if (deal?.status !== "pending" || !["coin", "card"].includes(how)) return;
    const actor = game.actors.get(deal.actorId);
    const market = marketOf(cbkConfig(), deal.marketId);
    const { won, line } = playRex(how);
    this.apps.cbkDeals[dealId] = { ...deal, status: won ? "won" : "lost", ...(won ? { pct: REX_PCT } : {}) };
    this._gmCardDone(`cbk-rex:${dealId}`);
    const who = actor ? displayName(actor) : "Someone";
    const result = won ? `${REX_PCT}% off ${deal.name}, one time.` : `no discount on ${deal.name}.`;
    await ChatMessage.create({
      speaker: { alias: market?.fixer || FROM },
      content: `<div class="agent-cbk-chat"><b>Rex's game</b><p>${esc(who)}: ${esc(line)}: ${esc(won ? "a win" : "a loss")}, ${esc(result)}</p></div>`
    });
    this._pushApps([this._alert(deal.actorId, { kind: "event", from: market?.fixer || FROM, app: CBK, text: `${line}. ${won ? `You won: ${result}` : `You lost: ${result}`}` })]);
  },

  /** An alert from a market's Fixer to every character with an Agent and a signal ("in range" = live). */
  _cbkTell(market, kind, text, ref = null) {
    const ids = playerCharacters().filter(a => canUsePhone(a) && canEnter(market, a, this.apps.cbkInvites)).map(a => this._alert(a.id, { kind, from: market.fixer || FROM, app: CBK, text: `${market.name}: ${text}`, ref }));
    this._pushApps(ids.filter(Boolean));
  },

  /** GM: refund a receipt nobody picked up (the stock goes back on the shelf), or an app (it's uninstalled). */
  async _onCbkRefund(user, { receiptId }) {
    const receipt = this.apps.receipts[receiptId];
    if (receipt?.status !== "paid" && !(receipt?.app && receipt.status === "picked")) return;
    // Revoked with a refund in the App Store already: no second refund.
    if (receipt.app && rowsOf(this.apps.installs, receipt.actorId)[receipt.app]?.revoked) return;
    const actor = game.actors.get(receipt.actorId);
    this.apps.receipts[receiptId] = { ...receipt, status: "refunded", doneAt: Date.now() };
    this._gmCardDone([`cbk:${receiptId}`, `cbk-err:${receiptId}`]);
    if (actor && hasWallet(actor) && receipt.price > 0) {
      await this._transfer(null, actor, receipt.price, `CBK ${receipt.market}: refund`);
      this._ledger(actor.id, receipt.price, `Refund: ${receipt.name}`, "cbk", receipt.market);
    }
    this._cbkStock(receipt.marketId, receipt.listingId, 1);
    // An app: uninstalled, and the row goes, so the App Store doesn't count it as theirs to reinstall free.
    if (receipt.app) {
      const rows = { ...rowsOf(this.apps.installs, receipt.actorId) };
      delete rows[receipt.app];
      this.apps.installs[receipt.actorId] = rows;
    }
    this._pushApps(actor ? [this._alert(actor.id, { kind: "money", from: receipt.fixer || FROM, app: CBK, text: `Refunded ${formatMoney(receipt.price)} for ${receipt.name}. Lucky you: few Fixers do that.` })] : []);
  }
};

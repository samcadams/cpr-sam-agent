import { showBroadcast } from "./broadcasts.js";
import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { contentArt } from "../../scripts/model/content.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { APPS } from "../../scripts/model/apps.js";
import { formatMoney, hasWallet, priceTier } from "../../scripts/model/money.js";
import { POOL, poolConfig } from "../pool/model.js";
import { findByName, itemPacks, loadCatalogue, typeLabel } from "../../scripts/model/shop.js";
import { displayName, knownNpcs } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { esc } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";
import {
  auctionable, auctionOf, bidderLabels, boothLine, boothName, BROADCAST_KINDS, MAX_BROADCASTS, broadcastOn, broadcastText, CATEGORIES, CBK, cbkConfig, categoryOf, cleanBroadcast, cleanListing, dealKey, dealPctOf, flashOf,
  highBid, INVITE_ROUTES, listingOf, marketFromPreset, marketOf, minBid, parseBooths, preferredPacks, presetList, priceNow, RAIDERS, RECEIPT_STATUS, receiptCode, receiptsOf, shownListings, shownMarkets, soldOut, upcomingMarkets
} from "./model.js";

/*
 * Phone page: CBK (see apps/cbk/model.js, apps/cbk/host.js), drawn like Black Chrome's catalogue screens
 * (pp. 10-14): a red bar with the CBK logo and Search, the category tiles, "other categories" chips, a
 * breadcrumb, listing cards with BUY NOW!!! and the booth line, a grey bar at the bottom (back, receipts,
 * next). Players: "Searching for database…" until the GM has a market live; the market's listings; their
 * receipts (Pick up at the booth); the market's Alerts (the Fixer's broadcasts). The GM Phone: Markets (GO
 * LIVE, new from a Black Chrome preset, the broadcast composer on a live market), the chosen market's details
 * and listings (booth, price, stock, hide; add any item), and every receipt (hand over, refund). Also: invites, Message the Fixer, Mister K's auction, Rex's game.
 */

/** The catalogue's pictures from the content folder (model/content.js); none: a glyph (tiles), a plain wordmark (the logo). */
const IMG = name => contentArt(`cbk/${name}.webp`);
const WORDMARK = `modules/${MODULE_ID}/images/wordmark-cbk.svg`;
const GM_TABS = { markets: "Markets", listings: "Listings", receipts: "Receipts" };
const SEARCH_MAX = 60;
const FLASH_MINUTES = 10;
/** The views a player leaves when they browse somewhere else. */
const NO_PANELS = { cbkReceipts: false, cbkAlerts: false };

const saveConfig = change => patchSetting(CBK, c => {
  c.markets = Array.isArray(c.markets) ? c.markets : [];
  change(c);
});
const saveMarket = (id, change) => saveConfig(c => {
  const m = c.markets.find(x => x.id === id);
  if (m) change(m);
});
const saveListing = (marketId, id, change) => saveMarket(marketId, m => {
  const l = m.listings?.find(x => x.id === id);
  if (l) change(l);
});

/** GM: call off a market's open auctions (or one listing's), before it goes: the host gives the held money back. */
const endAuctions = (marketId, listingId = null) => {
  for (const row of Object.values(store.apps.cbkAuctions ?? {})) {
    if (row.status === "open" && row.marketId === marketId && (!listingId || row.listingId === listingId)) store.request("cbk-auction-cancel", { marketId, listingId: row.listingId });
  }
};

/** An item's description as plain text, for the listing card's sales pitch (loaded once per item). */
const pitches = new Map();
function pitchOf(uuid, done) {
  if (!uuid) return "";
  if (!pitches.has(uuid)) {
    pitches.set(uuid, null);
    fromUuid(uuid).then(doc => {
      const html = doc?.system?.description?.value ?? "";
      const div = document.createElement("div");
      div.innerHTML = html;
      pitches.set(uuid, div.textContent.replace(/\s+/g, " ").trim().slice(0, 900));
      done();
    }).catch(() => pitches.set(uuid, ""));
  }
  return pitches.get(uuid);
}

/* ---------------- Click actions ---------------- */

export const actions = {
  /** Player: connect to one of the databases found. */
  "cbk-connect"({ market }) {
    Object.assign(this, { cbkMarket: market, cbkCat: null, cbkListing: null, cbkSearch: "", ...NO_PANELS });
    this.render();
  },
  "cbk-cat"({ cat }) {
    Object.assign(this, { cbkCat: cat in CATEGORIES ? cat : null, cbkListing: null, cbkSearch: "", ...NO_PANELS });
    this.render();
  },
  "cbk-open"({ listing }) {
    Object.assign(this, { cbkListing: listing, ...NO_PANELS });
    this.render();
  },
  /** The bottom bar's back arrow: listing → list → categories → (several live) the database list. */
  "cbk-back"() {
    if (this.cbkReceipts || this.cbkAlerts) Object.assign(this, NO_PANELS);
    else if (this.cbkListing) this.cbkListing = null;
    else if (this.cbkCat || this.cbkSearch) Object.assign(this, { cbkCat: null, cbkSearch: "" });
    else this.cbkMarket = null;
    this.render();
  },
  /** The bottom bar's forward arrow: the next listing in the list. */
  "cbk-next"({ listing }) {
    if (listing) this.cbkListing = listing;
    this.render();
  },
  "cbk-receipts"() {
    Object.assign(this, { cbkReceipts: !this.cbkReceipts, cbkAlerts: false });
    this.render();
  },
  /** The market's Alerts: what its Fixer broadcast, newest first. */
  "cbk-alerts"() {
    Object.assign(this, { cbkAlerts: !this.cbkAlerts, cbkReceipts: false });
    this.render();
  },
  async "cbk-buy"({ market, listing }) {
    const actorId = this.context()?.actorId;
    const m = marketOf(cbkConfig(store.apps.cbkStock), market);
    const l = listingOf(m, listing);
    if (!actorId || !l) return;
    const price = priceNow(m, l, Date.now(), dealPctOf(store.apps.cbkDeals, market, listing, actorId));
    const ok = await Dialog.confirm({
      title: "CBK: Buy Now!!!",
      content: `<p>Buy <b>${esc(l.name)}</b> for ${formatMoney(price)}?</p><p>${l.app ? "It installs on your Agent right away." : `${esc(boothLine(l.booths))} by showing the receipt on your Agent.`} Few Fixers offer refunds.</p>`,
      defaultYes: true
    });
    if (ok) store.request("cbk-buy", { actorId, marketId: market, listingId: listing, price });
  },
  /** Player: type the code into an invite in a conversation. */
  "cbk-invite-accept"({ messageId }) {
    const thread = this.view ? this.resolveDirect() : null;
    const code = this.element.find(`[data-cbk-code="${messageId}"]`).val();
    if (thread) store.request("cbk-invite-accept", { threadId: thread.id, messageId, code });
  },
  /** Player: the conversation with the market's Fixer, "Re: <market>" typed in and nothing sent. */
  "cbk-message-fixer"({ market }) {
    const actor = this.context()?.subject?.actor;
    const m = marketOf(cbkConfig(), market);
    if (!m?.fixerContact || !actor) return;
    if (!canUsePhone(actor)) return ui.notifications.warn("CBK: no signal.");
    store.request("cbk-message-fixer", { actorId: actor.id, marketId: market });
    this.composeTo(actor.id, m.fixerContact, `Re: ${m.name}`);
  },
  /** Player: bid on a lot; the money is held as soon as the host takes it. */
  async "cbk-bid"({ market, listing }) {
    const actorId = this.context()?.actorId;
    const auction = auctionOf(store.apps.cbkAuctions, market, listing);
    if (!actorId || !auction) return;
    const amount = Math.max(Math.floor(Number(this.cbkBids?.[listing]) || 0), minBid(auction));
    const ok = await Dialog.confirm({
      title: "CBK: Bid",
      content: `<p>Bid <b>${formatMoney(amount)}</b> on <b>${esc(auction.name)}</b>?</p><p>It's held from your account until you're outbid or the hammer falls.</p>`,
      defaultYes: true
    });
    if (ok) store.request("cbk-bid", { actorId, marketId: market, listingId: listing, amount });
  },
  /** Player: ask for Rex's game on this listing; the GM deals. */
  "cbk-rex-play"({ market, listing }) {
    store.request("cbk-rex-play", { actorId: this.context()?.actorId, marketId: market, listingId: listing });
  },
  "cbk-pickup"({ receipt }) {
    store.request("cbk-pickup", { actorId: this.context()?.actorId, receiptId: receipt });
  },
  "cbk-item"({ uuid }) {
    fromUuid(uuid).then(doc => doc?.sheet?.render(true, { editable: false }));
  },

  /* GM */
  "cbk-gm-tab"({ tab }) {
    this.cbkGmTab = tab;
    this.render();
  },
  "cbk-edit"({ market }) {
    Object.assign(this, { cbkEdit: market, cbkGmTab: "listings" });
    this.render();
  },
  /** GM: GO LIVE / go offline; then the host tells the phones. */
  async "cbk-live"({ market }) {
    let live = null;
    await saveMarket(market, m => (live = m.live = !m.live));
    if (live !== null) store.request("cbk-live", { marketId: market, live });
  },
  "cbk-delete"({ market }) {
    const m = marketOf(cbkConfig(store.apps.cbkStock), market);
    if (!m) return;
    Dialog.confirm({ title: "CBK", content: `<p>Delete ${esc(m.name)} and its ${m.listings.length} listings? Receipts stay.</p>`, yes: () => {
      endAuctions(market);
      saveConfig(c => (c.markets = c.markets.filter(x => x.id !== market)));
    } });
  },
  /** GM: a passcode invite in a conversation, or a card or courier invitation in a character's gear. */
  "cbk-invite"({ market, send }) {
    const m = marketOf(cbkConfig(), market);
    if (!m) return;
    const byPasscode = send === "true";
    if (byPasscode && !m.access.passcode) return ui.notifications.warn("CBK: give the market a passcode first (Listings tab).");
    const pcs = playerCharacters().map(a => `<option value="${a.id}">${esc(displayName(a))}</option>`).join("");
    const routes = ["card", "courier"].map(id => `<option value="${id}">${INVITE_ROUTES[id]}</option>`).join("");
    new Dialog({
      title: `CBK: invite to ${m.name}`,
      content: `<form class="agent-dialog">
        <div class="form-group"><label>Character</label><select name="actor">${pcs}</select></div>
        ${byPasscode
    ? `<div class="form-group"><label>From</label><input type="text" name="contact" maxlength="60" value="${esc(m.fixerContact || m.fixer || "Fixer")}"></div>
        <div class="form-group"><label>Note</label><input type="text" name="note" maxlength="200" placeholder="${esc(`You're invited to ${m.name}. The code: ${m.access.passcode}`)}"></div>`
    : `<div class="form-group"><label>What</label><select name="via">${routes}</select></div>`}
      </form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-envelope"></i>', label: byPasscode ? "Send invite" : "Give invite",
          callback: html => {
            const form = html[0].querySelector("form");
            if (byPasscode) store.request("cbk-invite-send", { actorId: form.actor.value, marketId: market, contact: form.contact.value, note: form.note.value });
            else store.request("cbk-invite-give", { actorId: form.actor.value, marketId: market, via: form.via.value });
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  },
  /** GM: open the bidding on a Super Luxury listing. */
  "cbk-auction-start"({ market, listing }) {
    const l = listingOf(marketOf(cbkConfig(), market), listing);
    if (!l) return;
    new Dialog({
      title: "CBK: auction",
      content: `<form class="agent-dialog"><p>Put <b>${esc(l.name)}</b> up for auction? BUY NOW!!! is off while the bidding is open.</p>
        <div class="form-group"><label>Reserve (eb)</label><input type="number" name="reserve" min="0" step="1" value="${l.price}"></div></form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-gavel"></i>', label: "Start auction",
          callback: html => store.request("cbk-auction-start", { marketId: market, listingId: listing, reserve: Number(html[0].querySelector("form").reserve.value) || 0 })
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  },
  "cbk-auction-sold"({ market, listing }) {
    const auction = auctionOf(store.apps.cbkAuctions, market, listing);
    const high = highBid(auction);
    if (!high) return;
    Dialog.confirm({ title: "CBK: Sold!", content: `<p>${esc(auction.name)} to ${esc(displayName(game.actors.get(high.actorId)) || "them")} for ${formatMoney(high.amount)}?</p>`, yes: () => store.request("cbk-auction-sold", { marketId: market, listingId: listing }) });
  },
  "cbk-auction-cancel"({ market, listing }) {
    const auction = auctionOf(store.apps.cbkAuctions, market, listing);
    if (!auction) return;
    Dialog.confirm({ title: "CBK: cancel auction", content: `<p>Call off the auction for ${esc(auction.name)}? The held bid goes back.</p>`, yes: () => store.request("cbk-auction-cancel", { marketId: market, listingId: listing }) });
  },
  "cbk-hide"({ market, listing }) {
    saveListing(market, listing, l => (l.hidden = !l.hidden));
  },
  "cbk-remove"({ market, listing }) {
    endAuctions(market, listing);
    saveMarket(market, m => (m.listings = m.listings.filter(l => l.id !== listing)));
  },
  /** GM: add a catalogue item to the market being edited. */
  "cbk-add"({ uuid }) {
    const e = this._cbkCatalogue?.entries?.find(x => x.uuid === uuid);
    if (!e || !this.cbkEdit) return;
    const listing = cleanListing({ id: foundry.utils.randomID(), uuid: e.uuid, name: e.name, img: e.img, type: e.type, category: categoryOf(e.type, e.name), price: e.base ?? 0, booths: [], stock: null });
    saveMarket(this.cbkEdit, m => (m.listings = [...(m.listings ?? []), listing]));
  },
  /** GM: pick a broadcast kind to write on a market (again: close the composer). */
  "cbk-compose"({ market, kind }) {
    const open = this.cbkCompose?.market === market && this.cbkCompose?.kind === kind;
    this.cbkCompose = open || !(kind in BROADCAST_KINDS) ? null : { market, kind, text: "", pct: 20, mins: FLASH_MINUTES, target: "", by: "NCPD" };
    this.render();
  },
  /** GM: save the broadcast on the market, then the host sends it to every phone there. */
  async "cbk-broadcast"({ market }) {
    const c = this.cbkCompose;
    if (c?.market !== market) return;
    const now = Date.now();
    const [type, key] = String(c.target).split(":");
    const b = cleanBroadcast({
      id: foundry.utils.randomID(), kind: c.kind, text: c.text, ts: now, pct: c.pct, by: c.by,
      until: c.kind === "flash" ? now + Math.min(240, Math.max(1, Math.floor(Number(c.mins) || FLASH_MINUTES))) * 60000 : null,
      target: type === "l" ? { listingId: key } : type === "c" ? { category: key } : null
    });
    if (!b) return ui.notifications.warn("CBK: pick what the flash sale is on.");
    if (!b.text && (b.kind === "policy" || b.kind === "date")) return ui.notifications.warn(`CBK: write the ${BROADCAST_KINDS[b.kind].label.toLowerCase()} first.`);
    await saveMarket(market, m => (m.broadcasts = [b, ...(Array.isArray(m.broadcasts) ? m.broadcasts : [])].slice(0, MAX_BROADCASTS)));
    store.request("cbk-broadcast", { marketId: market, broadcastId: b.id });
    this.cbkCompose = null;
    this.render();
  },
  /** GM: end a flash sale or raid warning now. */
  async "cbk-broadcast-end"({ market, broadcast }) {
    await saveMarket(market, m => {
      const b = m.broadcasts?.find(x => x.id === broadcast);
      if (b) b.until = Date.now();
    });
    store.request("cbk-broadcast-end", { marketId: market, broadcastId: broadcast });
  },
  "cbk-handover"({ receipt }) {
    store.request("cbk-handover", { receiptId: receipt });
  },
  "cbk-refund"({ receipt }) {
    const r = store.apps.receipts?.[receipt];
    if (!r) return;
    Dialog.confirm({ title: "CBK: refund", content: `<p>Refund ${formatMoney(r.price)} to ${esc(displayName(game.actors.get(r.actorId)) || "them")} for ${esc(r.name)}?</p>`, yes: () => store.request("cbk-refund", { receiptId: receipt }) });
  }
};

export const inputs = {
  "input[name=cbkSearch]": {
    input(event) {
      Object.assign(this, { cbkSearch: event.currentTarget.value, cbkListing: null, ...NO_PANELS });
      this.render();
    }
  },
  /** GM: a market's own field (name, fixer, where, rules). */
  "[data-cbk-market]": {
    change(event) {
      const el = event.currentTarget;
      saveMarket(el.dataset.cbkMarket, m => (m[el.dataset.field] = el.value));
    }
  },
  /** GM: invite-only and Rex's game, a market's switches. */
  "input[data-cbk-switch]": {
    change(event) {
      const { checked, dataset: { cbkSwitch, field } } = event.currentTarget;
      saveMarket(cbkSwitch, m => {
        if (field === "invite") m.access = { ...m.access, mode: checked ? "invite" : "open" };
        else m.game = checked ? "rex" : "";
      });
    }
  },
  /** GM: an invite-only market's passcode. */
  "input[data-cbk-passcode]": {
    change(event) {
      const el = event.currentTarget;
      saveMarket(el.dataset.cbkPasscode, m => (m.access = { ...m.access, passcode: el.value }));
    }
  },
  /** Player: the bid typed on a lot (kept until BID). */
  "input[data-cbk-bid]": {
    input(event) {
      this.cbkBids = { ...this.cbkBids, [event.currentTarget.dataset.cbkBid]: event.currentTarget.value };
    }
  },
  /** GM: a listing's booth, price or stock. */
  "input[data-cbk-listing]": {
    async change(event) {
      const el = event.currentTarget;
      const field = el.dataset.field;
      const value = field === "booths" ? parseBooths(el.value) : field === "stock" && el.value.trim() === "" ? null : Math.max(0, Math.floor(Number(el.value) || 0));
      const { market, cbkListing } = el.dataset;
      await saveListing(market, cbkListing, l => (l[field] = value));
      // The stock left is the host's (table cbkStock): it sets it once the setting is saved, so a sale can't be overwritten.
      if (field === "stock") store.request("cbk-restock", { marketId: market, listingId: cbkListing, stock: value });
    }
  },
  /** GM: the broadcast composer's text, discount and minutes (kept until Send). */
  "[data-cbk-compose]": {
    input(event) {
      if (this.cbkCompose) this.cbkCompose[event.currentTarget.dataset.cbkCompose] = event.currentTarget.value;
    }
  },
  "input[name=cbkAddSearch]": {
    input(event) {
      this.cbkAddSearch = event.currentTarget.value;
      this.render();
    }
  }
};

export const dropdowns = {
  /** GM: a new market, blank or from one of Black Chrome's six. */
  async cbkNew(value) {
    if (!value) return;
    const newId = () => foundry.utils.randomID();
    let market;
    if (value === "blank") market = { id: newId(), letter: "", name: "New Night Market", fixer: "", where: "", rules: "", live: false, booths: {}, listings: [] };
    else {
      ui.notifications.info("CBK: matching the market's listings to your items…");
      const { entries } = await loadCatalogue({ worldItems: true, packs: null });
      const prefer = preferredPacks(itemPacks());
      market = marketFromPreset(value, name => findByName(entries, name, { prefer }), newId);
      const missing = market.listings.filter(l => !l.uuid).length;
      if (missing) ui.notifications.warn(`CBK: ${missing} of ${market.listings.length} listings have no matching item (a plain gear item is handed over for those).`);
    }
    await saveConfig(c => c.markets.push(market));
    Object.assign(this, { cbkEdit: market.id, cbkGmTab: "listings" });
    this.render();
  },
  /** GM: what a flash sale is on ("l:<listingId>" or "c:<category>"). */
  cbkBcTarget(value) {
    if (this.cbkCompose) this.cbkCompose.target = value;
    this.render();
  },
  /** GM: who a raid warning is about. */
  cbkBcBy(value) {
    if (this.cbkCompose) this.cbkCompose.by = value in RAIDERS ? value : "NCPD";
    this.render();
  },
  /** GM: list an app: BUY NOW!!! installs it; it starts at the App Store's price. */
  cbkAddApp(value) {
    if (!(value in APPS) || !this.cbkEdit) return;
    const listing = cleanListing({ id: foundry.utils.randomID(), app: value, name: APPS[value].name, price: poolConfig().apps[value]?.price ?? 0 });
    saveMarket(this.cbkEdit, m => (m.listings = [...(m.listings ?? []), listing]));
  },
  /** GM: who Message the Fixer writes to. */
  cbkFixerContact(value) {
    if (this.cbkEdit) saveMarket(this.cbkEdit, m => (m.fixerContact = value));
  },
  /** GM: which market the Listings tab edits. */
  cbkEditPick(value) {
    this.cbkEdit = value;
    this.render();
  }
};

/* ---------------- The page ---------------- */

const listingView = (l, market, dealPct = 0) => {
  const flash = flashOf(market, l);
  const sale = Math.max(flash?.pct ?? 0, dealPct);
  return {
    ...l, priceLabel: formatMoney(priceNow(market, l, Date.now(), dealPct)), tier: priceTier(l.price), soldOut: soldOut(l),
    inAuction: !!auctionOf(store.apps.cbkAuctions, market.id, l.id),
    boothLine: l.app ? "Installs on your Agent through the App Store" : boothLine(l.booths), appIcon: l.app ? APPS[l.app]?.icon : null,
    was: sale ? formatMoney(l.price) : null, sale, rexDeal: dealPct > (flash?.pct ?? 0),
  catLabel: CATEGORIES[l.category]?.label ?? "", color: CATEGORIES[l.category]?.color, typeLabel: typeLabel(l.type),
    boothNames: l.booths.map(b => boothName(market, b)).filter(Boolean).join(", ")
  };
};

/** A broadcast as a row: its kind, the line the phones got, when, and whether it's still on. */
const broadcastView = (b, market) => ({
  ...b, label: BROADCAST_KINDS[b.kind].label, icon: BROADCAST_KINDS[b.kind].icon, line: broadcastText(b, market),
  when: new Date(b.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  on: broadcastOn(b), endable: (b.kind === "flash" || b.kind === "raid") && broadcastOn(b)
});

const chips = active => Object.entries(CATEGORIES).filter(([id]) => id !== active).map(([id, c]) => ({ id, label: c.label, color: c.color }));

export const methods = {
  cbkData(ctx) {
    const config = cbkConfig(store.apps.cbkStock);
    const bar = appBar(CBK, { owner: ctx.perspective === "gm" ? null : ctx.subject.name });
    if (ctx.perspective === "gm") return { gm: true, bar, ...this._cbkGmData(config) };

    const actor = game.actors.get(ctx.actorId);
    const invites = store.apps.cbkInvites;
    const live = shownMarkets(config, actor, invites);
    const upcoming = upcomingMarkets(config, actor, invites).map(m => ({ id: m.id, letter: m.letter, name: m.name, fixer: m.fixer }));
    const receipts = receiptsOf(store.apps.receipts, ctx.actorId);
    const waiting = receipts.filter(r => r.status === "paid").length;
    const data = { gm: false, bar, logo: IMG("logo") ?? WORDMARK, waiting, offline: !!ctx.noSignal };
    if (this.cbkReceipts) {
      return { ...data, view: { receipts: true }, crumb: "Receipts", receipts: receipts.slice(0, 40).map(r => ({
        ...r, code: receiptCode(r.id), priceLabel: formatMoney(r.price), boothLine: boothLine(r.booths), statusLabel: RECEIPT_STATUS[r.status],
        paid: r.status === "paid", open: r.status === "paid" && !!marketOf(config, r.marketId)?.live
      })) };
    }
    if (ctx.noSignal || !live.length) {
      // The database is gone: the next one found starts at its categories, not where this one was left.
      Object.assign(this, { cbkMarket: null, cbkCat: null, cbkListing: null, cbkSearch: "" });
      return { ...data, upcoming, view: { searching: true } };
    }
    let market = live.find(m => m.id === this.cbkMarket) ?? (live.length === 1 ? live[0] : null);
    if (!market) return { ...data, upcoming, view: { databases: true }, databases: live.map(m => ({ id: m.id, letter: m.letter, name: m.name, fixer: m.fixer, count: shownListings(m).length })) };
    this.cbkMarket = market.id;
    this._cbkWake([market]);
    data.alertCount = market.broadcasts.filter(b => broadcastOn(b)).length;
    if (this.cbkAlerts) {
      const head = { market: { id: market.id, letter: market.letter, name: market.name, fixer: market.fixer, fixerContact: market.fixerContact } };
      return { ...data, ...head, view: { alerts: true }, crumb: "Alerts", alerts: market.broadcasts.map(b => broadcastView(b, market)) };
    }

    const shown = shownListings(market);
    const query = (this.cbkSearch ?? "").trim().toLowerCase();
    const cat = this.cbkCat in CATEGORIES ? this.cbkCat : null;
    const dealOf = l => dealPctOf(store.apps.cbkDeals, market.id, l.id, ctx.actorId);
    const head = { market: { id: market.id, letter: market.letter, name: market.name, fixer: market.fixer, where: market.where, rules: market.rules }, search: this.cbkSearch ?? "" };
    const listing = listingOf(market, this.cbkListing);
    if (listing && !listing.hidden) {
      const list = this._cbkList(shown, cat, query);
      const at = list.findIndex(l => l.id === listing.id);
      const wealth = hasWallet(ctx.subject.actor) ? ctx.subject.actor.system.wealth.value : null;
      const pitch = pitchOf(listing.uuid, () => this.refresh({ cbk: true }));
      const dealPct = dealOf(listing);
      const auction = this._cbkAuctionView(market, listing, ctx.actorId, wealth);
      const deal = store.apps.cbkDeals?.[dealKey(market.id, listing.id, ctx.actorId)];
      return {
        ...data, ...head, view: { listing: true }, chips: chips(listing.category),
        crumb: [CATEGORIES[listing.category]?.label, listing.sub].filter(Boolean).join(" > "),
        listing: {
          ...listingView(listing, market, dealPct), pitch, loading: pitch === null, short: wealth !== null && wealth < priceNow(market, listing, Date.now(), dealPct), auction,
          rex: market.game === "rex" && !auction && !soldOut(listing) ? { canPlay: !deal, pending: deal?.status === "pending", lost: deal?.status === "lost", used: deal?.status === "used" } : null
        },
        next: list[at + 1]?.id ?? null
      };
    }
    if (cat || query) {
      const list = this._cbkList(shown, cat, query);
      return {
        ...data, ...head, view: { list: true }, chips: chips(cat),
        crumb: query ? `Search: "${this.cbkSearch.trim()}"` : CATEGORIES[cat].label,
        rows: list.slice(0, SEARCH_MAX).map(l => listingView(l, market, dealOf(l))), found: list.length
      };
    }
    const tiles = Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, color: c.color, img: id === "apps" ? null : IMG(id), count: shown.filter(l => l.category === id).length }));
    return { ...data, ...head, upcoming, view: { home: true }, tiles };
  },

  /** A lot's bidding as this character sees it: other bidders by number only. */
  _cbkAuctionView(market, listing, actorId, wealth) {
    const auction = auctionOf(store.apps.cbkAuctions, market.id, listing.id);
    if (!auction) return null;
    const high = highBid(auction);
    const mine = high?.actorId === actorId;
    const min = minBid(auction);
    const typed = Math.floor(Number(this.cbkBids?.[listing.id]) || 0);
    return {
      highLabel: high ? formatMoney(high.amount) : null, bidder: high ? bidderLabels(auction)[high.actorId] : null, mine,
      minLabel: formatMoney(min), min, value: Math.max(typed, min), count: auction.bids.length,
      short: wealth !== null && wealth + (mine ? high.amount : 0) < min
    };
  },

  /** Redraw when the next flash sale ends, so its price goes back on time. */
  _cbkWake(markets) {
    const now = Date.now();
    const next = Math.min(...markets.flatMap(m => m.broadcasts.filter(b => b.until > now).map(b => b.until)));
    clearTimeout(this._cbkTimer);
    if (Number.isFinite(next)) this._cbkTimer = setTimeout(() => this.refresh({ cbk: true }), Math.min(next - now + 50, 2 ** 31 - 1));
  },

  /** A market's listings in a category or matching a search, by subcategory then name. */
  _cbkList(shown, cat, query) {
    const words = query.split(/\s+/).filter(Boolean);
    return shown.filter(l => (!cat || l.category === cat) && words.every(w => `${l.name} ${l.corp} ${l.sub} ${CATEGORIES[l.category]?.label}`.toLowerCase().includes(w)))
      .sort((a, b) => (cat ? 0 : a.category.localeCompare(b.category)) || a.sub.localeCompare(b.sub) || a.name.localeCompare(b.name));
  },

  /** The GM's markets, the listings of the one being edited, and the receipts. */
  _cbkGmData(config) {
    const tab = this.cbkGmTab in GM_TABS ? this.cbkGmTab : "markets";
    const receipts = Object.values(store.apps.receipts ?? {});
    const paid = receipts.filter(r => r.status === "paid");
    const data = {
      tabs: Object.entries(GM_TABS).map(([id, label]) => ({ id, label, active: id === tab, count: id === "receipts" ? paid.length : 0 })),
      tab: { [tab]: true }
    };
    if (tab === "markets") {
      this._cbkWake(config.markets);
      data.markets = config.markets.map(m => ({
        ...m, count: m.listings.length, hidden: m.listings.filter(l => l.hidden).length, waiting: paid.filter(r => r.marketId === m.id).length,
        kinds: Object.entries(BROADCAST_KINDS).map(([id, k]) => ({ id, ...k, active: this.cbkCompose?.market === m.id && this.cbkCompose.kind === id })),
        compose: this._cbkComposer(m), sent: m.broadcasts.slice(0, 5).map(b => broadcastView(b, m)), inviteOnly: m.access.mode === "invite",
        auctions: m.listings.map(l => auctionOf(store.apps.cbkAuctions, m.id, l.id)).filter(Boolean).map(a => this._cbkGmAuction(a))
      }));
      data.newPick = dropdown("cbkNew", [{ value: "", label: "New market…", selected: true }, ...presetList().map(p => ({ value: p.letter, label: `${p.letter}: ${p.name} (${p.count})` })), { value: "blank", label: "Blank market" }], { title: "New market", cls: "agent-wide" });
    }
    if (tab === "listings") {
      const market = marketOf(config, this.cbkEdit) ?? config.markets[0] ?? null;
      this.cbkEdit = market?.id ?? null;
      data.editPick = config.markets.length ? dropdown("cbkEditPick", config.markets.map(m => ({ value: m.id, label: `${m.letter ? `${m.letter}: ` : ""}${m.name}`, selected: m.id === market?.id })), { title: "Market", cls: "agent-wide" }) : null;
      if (market) {
        data.market = { ...market, inviteOnly: market.access.mode === "invite", rex: market.game === "rex" };
        data.listings = market.listings.map(l => {
          const view = listingView(l, market);
          return { ...view, boothText: l.booths.join("/"), stockText: l.stock ?? "", missing: !l.uuid && !l.app, canAuction: market.live && auctionable(l) && !view.inAuction && !view.soldOut };
        });
        const contacts = [...new Set([market.fixer, market.fixerContact, ...knownNpcs().map(n => n.name)].filter(Boolean))].sort();
        data.fixerPick = dropdown("cbkFixerContact", [{ value: "", label: "No Fixer contact (no Message the Fixer)", selected: !market.fixerContact }, ...contacts.map(value => ({ value, label: value, selected: value === market.fixerContact }))], { title: "Fixer contact", cls: "agent-wide", search: true });
        data.appPick = dropdown("cbkAddApp", [{ value: "", label: "Add an app…", selected: true }, ...Object.entries(APPS).filter(([id]) => id !== POOL && id !== CBK && !poolConfig().apps[id]?.preinstalled).map(([value, a]) => ({ value, label: a.name }))], { title: "Sell an app", cls: "agent-wide", search: true });
        const q = (this.cbkAddSearch ?? "").trim().toLowerCase();
        data.addSearch = this.cbkAddSearch ?? "";
        if (q.length >= 2) {
          const cat = this._cbkCatalogueLoaded();
          data.addLoading = !cat;
          if (cat) data.addRows = cat.entries.filter(e => e.name?.toLowerCase().includes(q) && !["role", "skill", "criticalInjury", "netarch"].includes(e.type)).slice(0, 8)
            .map(e => ({ ...e, typeLabel: typeLabel(e.type), priceLabel: e.base ? formatMoney(e.base) : "no price" }));
        }
      }
    }
    if (tab === "receipts") {
      const view = r => ({ ...r, code: receiptCode(r.id), actorName: displayName(game.actors.get(r.actorId)) || "(deleted)", priceLabel: formatMoney(r.price), boothLine: boothLine(r.booths), statusLabel: r.app && r.status === "picked" ? "Installed" : RECEIPT_STATUS[r.status], paid: r.status === "paid", refundable: r.status === "paid" || (!!r.app && r.status === "picked") });
      data.paid = paid.sort((a, b) => a.ts - b.ts).map(view);
      data.done = receipts.filter(r => r.status !== "paid").sort((a, b) => (b.doneAt ?? b.ts) - (a.doneAt ?? a.ts)).slice(0, 40).map(view);
    }
    return data;
  },

  /** An open auction on the GM's page: the bids, newest first, with who really bid. */
  _cbkGmAuction(auction) {
    const labels = bidderLabels(auction);
    return {
      ...auction, reserveLabel: auction.reserve ? formatMoney(auction.reserve) : "",
      rows: auction.bids.toReversed().map(b => ({ label: labels[b.actorId], who: displayName(game.actors.get(b.actorId)) || "(deleted)", amount: formatMoney(b.amount) }))
    };
  },

  /** The broadcast composer open on this market, or null. */
  _cbkComposer(market) {
    const c = this.cbkCompose;
    if (c?.market !== market.id || !market.live) return null;
    const view = { ...c, [c.kind]: true, label: BROADCAST_KINDS[c.kind].label };
    if (c.kind === "flash") {
      view.targetPick = dropdown("cbkBcTarget", [
        { value: "", label: "On…", selected: !c.target },
        ...Object.entries(CATEGORIES).map(([id, cat]) => ({ value: `c:${id}`, label: `All ${cat.label}`, color: cat.color, selected: c.target === `c:${id}` })),
        ...shownListings(market).map(l => ({ value: `l:${l.id}`, label: `${l.name} (${formatMoney(l.price)})`, selected: c.target === `l:${l.id}` }))
      ], { title: "Flash sale on", cls: "agent-wide", search: true });
    }
    if (c.kind === "raid") view.byPick = dropdown("cbkBcBy", Object.entries(RAIDERS).map(([value, label]) => ({ value, label, selected: c.by === value })), { title: "Who's coming", cls: "agent-wide" });
    return view;
  },

  /** Every item the GM could list (loaded once, then the page redraws). */
  _cbkCatalogueLoaded() {
    if (this._cbkCatalogue?.ready) return this._cbkCatalogue;
    if (!this._cbkCatalogue) {
      this._cbkCatalogue = { ready: false };
      loadCatalogue({ worldItems: true, packs: null }).then(found => {
        Object.assign(this._cbkCatalogue, found, { ready: true });
        this.refresh({ cbk: true });
      });
    }
    return null;
  }
};

export const phone = {
  /** A broadcast waiting to be shown (broadcasts.js). */
  render() {
    showBroadcast(this);
  },
  /** Tapping CBK again: back to the categories. */
  retap(app) {
    if (app !== CBK) return;
    Object.assign(this, { cbkCat: null, cbkListing: null, cbkSearch: "", ...NO_PANELS });
  }
};

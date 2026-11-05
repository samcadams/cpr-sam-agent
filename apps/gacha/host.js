import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { cleanImg, collectibles, duplicates, FAV_MAX, formatCreds, gachaConfig, gachaData, nextPity, OLD_WEIGHTS, pullCollectible, RARITIES, saleValue } from "./model.js";
import { giveItems } from "../../scripts/model/items.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { esc } from "../../scripts/util/text.js";

/*
 * Host: Gacha (see apps/gacha/model.js). A player buys zCreds with eddies (one in five purchases fails, and
 * keeps the eddies), spends them on a pull and gets a collectible; shows it off in chat, offers it to
 * another character (an Agent alert they accept), pins it, or sells a duplicate back. The GM can make a
 * Legendary real, and set a character's zCreds. (Mystery Boxes are Achieve!'s: apps/achieve/host.js.)
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "gacha-buy": "_onGachaBuy",
  "gacha-pull": "_onGachaPull",
  "gacha-sell": "_onGachaSell",
  "gacha-fav": "_onGachaFav",
  "gacha-creds": gm("_onGachaCreds"),
  "gacha-show": "_onGachaShow",
  "gacha-trade": "_onGachaTrade",
  "gacha-real": gm("_onGachaReal"),
  "gacha-remove": gm("_onGachaRemove")
};

const CAPSULES = "Mr. Amaze's Capsules";

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  /** The shelves, as a copy to change. */
  _gachaDraft() {
    return foundry.utils.deepClone(gachaData(this.apps));
  },

  /** Save the shelves, pity counters, zCreds and favourites, and send them. */
  _gachaSave({ shelves, pity, creds, favs }, alerts = []) {
    this.apps.gachaShelves = shelves;
    this.apps.gachaPity = pity;
    this.apps.gachaCreds = creds;
    this.apps.gachaFavs = favs;
    this._pushApps(alerts);
  },

  /** A player's own character, with their phone on them. */
  _gachaActor(user, actorId) {
    const actor = game.actors.get(actorId);
    return actor && !user.isGM && owns(user, actor) && this._citinet(actor, "gacha") ? actor : null;
  },

  /**
   * Older worlds kept the shelves in the world setting "gacha": move them into the host's table once
   * (apps/manifest.js `load`), then empty the setting once the files are written. The boxes there were
   * crews' (crew achievements are dropped too): those go.
   */
  async _gachaLoad() {
    await this._gachaWeightsLoad();
    const old = game.settings.get(MODULE_ID, "gacha") ?? {};
    const has = table => Object.keys(table ?? {}).length > 0;
    if (!has(old.boxes) && !has(old.shelves)) return;
    if (has(old.shelves) && !has(this.apps.gachaShelves)) {
      this.apps.gachaShelves = foundry.utils.deepClone(old.shelves);
      await this._queueWrite(() => this._write());
      console.log(`${MODULE_ID} | Moved Gacha's shelves from the world setting to the data folder`);
    }
    await game.settings.set(MODULE_ID, "gacha", { boxes: {}, shelves: {} });
  },

  /**
   * The weights were out of 100 before 1.2, and are per mille now: a weight the GM saved that was the
   * old default takes the new one; one they changed is scaled up (x10). Once (`perMille`).
   */
  async _gachaWeightsLoad() {
    const saved = game.settings.get(MODULE_ID, "gachaConfig") ?? {};
    if (saved.perMille) return;
    if (saved.weights) {
      const weights = {};
      for (const [k, v] of Object.entries(saved.weights)) if (Number(v) !== OLD_WEIGHTS[k]) weights[k] = Number(v) * 10;
      await game.settings.set(MODULE_ID, "gachaConfig", { ...saved, weights, perMille: true });
      console.log(`${MODULE_ID} | Gacha's weights are per mille now: moved the saved ones`);
    } else if (Object.keys(saved).length) await game.settings.set(MODULE_ID, "gachaConfig", { ...saved, perMille: true });
  },

  /* ---------------- Capsules ---------------- */

  /** Buy a bundle of zCreds with eddies. One in five (the GM's `failChance`) fails: the eddies go anyway. */
  async _onGachaBuy(user, { actorId, bundle }) {
    const actor = this._gachaActor(user, actorId);
    const cfg = gachaConfig();
    const b = cfg.bundles[Number(bundle)];
    if (!actor || !b) return;
    const eb = Math.max(0, Math.floor(Number(b.eb) || 0));
    const zc = Math.max(0, Math.floor(Number(b.zc) || 0));
    if (eb && hasWallet(actor)) {
      if (!(await this._transfer(actor, null, eb, `${CAPSULES}: ${formatCreds(zc)}`))) {
        return this._alertNow(actor.id, { kind: "money", from: CAPSULES, text: `Declined: ${formatCreds(zc)} is ${formatMoney(eb)}.` });
      }
      this._ledger(actor.id, -eb, `zCreds: ${formatCreds(zc)}`, "gacha", CAPSULES);
    }
    if (Math.random() * 100 < Number(cfg.failChance)) {
      this._pushApps();
      return this._alertNow(actor.id, {
        kind: "money", from: CAPSULES,
        text: `Transaction failed. Your payment of ${formatMoney(eb)} has been processed. Thank you for choosing zCreds! (No refunds. See Terms §44.7b.)`
      });
    }
    const data = this._gachaDraft();
    data.creds[actor.id] = (Number(data.creds[actor.id]) || 0) + zc;
    this._gachaSave(data);
    this._alertNow(actor.id, { kind: "money", from: CAPSULES, text: `+${formatCreds(zc)}. You have ${formatCreds(data.creds[actor.id])}.` });
  },

  async _onGachaPull(user, { actorId }) {
    const actor = this._gachaActor(user, actorId);
    if (!actor) return;
    const cfg = gachaConfig();
    const cost = Math.max(0, Math.floor(Number(cfg.pullCost) || 0));
    const have = Number(gachaData(this.apps).creds[actor.id]) || 0;
    if (have < cost) {
      return this._alertNow(actor.id, { kind: "money", from: CAPSULES, text: `A pull is ${formatCreds(cost)}; you have ${formatCreds(have)}. Top up?` });
    }
    const pity = gachaData(this.apps).pity[actor.id] ?? {};
    const c = pullCollectible(cfg, Math.random, pity);
    if (!c) return;
    const data = this._gachaDraft();
    const pull = { id: foundry.utils.randomID(), cid: c.id, name: c.name, rarity: c.rarity, icon: c.icon, img: c.img, ts: Date.now(), real: null };
    (data.shelves[actor.id] ??= []).push(pull);
    data.pity[actor.id] = nextPity(pity, c.rarity);
    data.creds[actor.id] = have - cost;
    this._gachaSave(data);
    if (c.rarity === "legendary") {
      this._gmCard({
        id: `gacha-pull:${pull.id}`, title: "Gacha: LEGENDARY", icon: "fa-star", open: { app: "gacha" },
        body: `${displayName(actor)} pulled a Legendary ${c.name}! Open Gacha to make it a real item.`
      });
    }
  },

  /** Sell duplicates back: one copy (`cid`), or every duplicate on the shelf (no `cid`). */
  _onGachaSell(user, { actorId, cid }) {
    const actor = this._gachaActor(user, actorId);
    if (!actor) return;
    const data = this._gachaDraft();
    const shelf = data.shelves[actor.id] ?? [];
    const dupes = duplicates(shelf);
    const sold = cid ? dupes.filter(p => p.cid === cid).slice(0, 1) : dupes;
    if (!sold.length) return;
    const zc = saleValue(shelf, sold, gachaConfig().sell);
    const ids = new Set(sold.map(p => p.id));
    data.shelves[actor.id] = shelf.filter(p => !ids.has(p.id));
    data.creds[actor.id] = (Number(data.creds[actor.id]) || 0) + zc;
    this._gachaSave(data);
    const what = sold.length === 1 ? `your spare ${sold[0].name}` : `${sold.length} duplicates`;
    this._alertNow(actor.id, { kind: "money", from: CAPSULES, text: `Sold ${what} for ${formatCreds(zc)}. A generous offer.` });
  },

  /** Pin a collectible to the top of the shelf, or unpin it (FAV_MAX at most). */
  _onGachaFav(user, { actorId, cid }) {
    const actor = this._gachaActor(user, actorId);
    const data = this._gachaDraft();
    const shelf = data.shelves[actorId] ?? [];
    if (!actor || !shelf.some(p => p.cid === cid)) return;
    // Pins of collectibles no longer on the shelf (given away, sold) drop off here.
    const favs = (data.favs[actor.id] ?? []).filter(id => shelf.some(p => p.cid === id));
    if (favs.includes(cid)) data.favs[actor.id] = favs.filter(id => id !== cid);
    else if (favs.length >= FAV_MAX) return this._alertNow(actor.id, { kind: "event", from: CAPSULES, text: `${FAV_MAX} favourites at most: unpin one first.` });
    else data.favs[actor.id] = [...favs, cid];
    this._gachaSave(data);
  },

  /** GM: set a character's zCreds. */
  _onGachaCreds(user, { actorId, amount }) {
    if (!game.actors.get(actorId)) return;
    const data = this._gachaDraft();
    const before = data.creds[actorId] ?? 0;
    data.creds[actorId] = Math.max(0, Math.floor(Number(amount) || 0));
    const id = data.creds[actorId] !== before
      ? this._alert(actorId, { kind: "money", from: CAPSULES, text: `Your zCreds balance is now ${formatCreds(data.creds[actorId])}.` })
      : null;
    this._gachaSave(data, [id]);
  },

  /** Show a collectible off in chat. */
  async _onGachaShow(user, { actorId, pullId }) {
    const actor = game.actors.get(actorId);
    const pull = gachaData(this.apps).shelves?.[actorId]?.find(p => p.id === pullId);
    if (!actor || !owns(user, actor) || !pull) return;
    const r = RARITIES[pull.rarity] ?? RARITIES.common;
    const img = cleanImg(pull.img || collectibles().find(c => c.id === pull.cid)?.img);
    const art = img ? `<img src="${esc(img)}" alt="">` : `<i class="fas ${esc(pull.icon)}"></i>`;
    const content = `<div class="ctp-gacha-chat" style="--rarity: ${r.color}">${art}<div><small>${esc(r.name)}</small><b>${esc(pull.name)}</b><span>${esc(displayName(actor))} shows it off.</span></div></div>`;
    await ChatMessage.create({ speaker: { alias: displayName(actor) }, content });
  },

  /** Offer a collectible to another character: they accept on their Agent. */
  _onGachaTrade(user, { actorId, pullId, toId }) {
    const actor = game.actors.get(actorId);
    const to = game.actors.get(toId);
    const pull = gachaData(this.apps).shelves?.[actorId]?.find(p => p.id === pullId);
    if (!actor || !to || actor === to || user.isGM || !owns(user, actor) || !pull) return;
    if (!game.users.some(u => !u.isGM && to.testUserPermission(u, "OWNER"))) return;
    const r = RARITIES[pull.rarity]?.name ?? "";
    const id = this._alert(to.id, {
      kind: "event", from: CAPSULES, text: `${displayName(actor)} wants to give you their ${r} ${pull.name}.`,
      choices: ["Accept", "Decline"], ref: { type: "gacha-trade", from: actor.id, to: to.id, pullId }
    });
    const sent = this._alert(actor.id, { kind: "event", from: CAPSULES, text: `Offered your ${pull.name} to ${displayName(to)}.` });
    this._pushApps([id, sent]);
  },

  /** The answer to a trade offer (apps/agent/host.js ANSWERS). */
  async _answerGachaTrade(alert, choice) {
    const { from, to, pullId } = alert.ref;
    const data = this._gachaDraft();
    const list = data.shelves[from] ?? [];
    const i = list.findIndex(p => p.id === pullId);
    const giver = game.actors.get(from);
    const taker = game.actors.get(to);
    if (!giver || !taker) return;
    if (i < 0) return this._alert(to, { kind: "event", from: CAPSULES, text: `${displayName(giver)} doesn't have that collectible any more.` });
    if (choice !== "Accept") return this._alert(from, { kind: "event", from: CAPSULES, text: `${displayName(taker)} declined your ${list[i].name}.` });
    const [pull] = list.splice(i, 1);
    (data.shelves[to] ??= []).push({ ...pull, ts: Date.now(), from });
    this._gachaSave(data);
    return this._alert(from, { kind: "event", from: CAPSULES, text: `${displayName(taker)} took your ${pull.name}.` });
  },

  /** GM: make a collectible a real item on the character's sheet (a Legendary, usually). */
  async _onGachaReal(user, { actorId, pullId, uuid }) {
    const actor = game.actors.get(actorId);
    const data = this._gachaDraft();
    const pull = data.shelves[actorId]?.find(p => p.id === pullId);
    if (!actor || !pull || !uuid) return;
    // A curated reward whose item has since gone is still given, as a plain item by that name.
    const reward = gachaConfig().legendaryRewards.find(r => r.uuid === uuid);
    const [name] = await giveItems(actor, [{ uuid, qty: 1, name: reward?.name ?? "" }], `From a Legendary ${pull.name}.`);
    pull.real = { name };
    this._gachaSave(data);
    this._alertNow(actor.id, { kind: "event", from: CAPSULES, text: `Your Legendary ${pull.name} came with something real: ${name}. It's on your sheet.` });
  },

  _onGachaRemove(user, { actorId, pullId }) {
    const data = this._gachaDraft();
    const list = data.shelves[actorId];
    const pull = list?.find(p => p.id === pullId);
    if (!pull) return;
    data.shelves[actorId] = list.filter(p => p.id !== pullId);
    const id = this._alert(actorId, { kind: "event", from: CAPSULES, text: `Your ${pull.name} was taken off your shelf.` });
    return this._gachaSave(data, [id]);
  }
};

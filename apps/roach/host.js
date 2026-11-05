import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { defaultInitials, validInitials } from "../pigeon/model.js";
import { addScore, configOf, plausible, randomEntries, riderOf } from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentDay } from "../../scripts/util/agentTime.js";
import { BLIPS } from "../../scripts/util/audio.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: Roach Race (see apps/roach/model.js). Day passes and steeds are paid through BangMe! (declined: no
 * pass, no steed); each character's passes and steeds are the table "roachRiders". The board is the world
 * setting "roachBoard": players send their score at the end of a run, each character keeps their best.
 * Beating the House Record (once per character) sends the GM a card; the GM decides on the prize, nothing
 * is given automatically. The GM grants, revokes and refunds passes, gives steeds, and manages the board.
 * A run's jumps, apples and crash are heard, quietly, around the player's token.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "roach-pass": "_onRoachPass",
  "roach-steed": "_onRoachSteed",
  "roach-score": "_onRoachScore",
  "roach-sound": "_onRoachSound",
  "roach-grant": gm("_onRoachGrant"),
  "roach-gift": gm("_onRoachGift"),
  "roach-record": gm("_onRoachRecord"),
  "roach-fake": gm("_onRoachFake"),
  "roach-fill": gm("_onRoachFill"),
  "roach-remove": gm("_onRoachRemove"),
  "roach-reset": gm("_onRoachReset")
};

const FROM = "Roach Race";
const ICON = "fa-horse-head";

/** The sounds a run may play in the world (the rest stay on the phone). */
const WORLD_SOUNDS = new Set(["jump", "point", "power", "hit"]);

const board = () => game.settings.get(MODULE_ID, "roachBoard")?.scores ?? [];
const save = scores => game.settings.set(MODULE_ID, "roachBoard", { scores });
const entry = data => ({ id: foundry.utils.randomID(), ts: Date.now(), ...data });
const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  /** A player's own character, with their phone on them. */
  _roachActor(user, actorId) {
    const actor = game.actors.get(actorId);
    return actor && !user.isGM && owns(user, actor) && canUsePhone(actor) ? actor : null;
  },

  /** Change a character's row (`change` gets a copy) and send it. */
  _roachRider(actorId, change, alerts = []) {
    const rider = { ...(this.apps.roachRiders[actorId] ?? {}), ...riderOf(this.apps.roachRiders, actorId) };
    change(rider);
    this.apps.roachRiders[actorId] = rider;
    this._pushApps(alerts.filter(Boolean));
    return rider;
  },

  /** Buy a day pass: good until in-world midnight. */
  async _onRoachPass(user, { actorId }) {
    const actor = this._roachActor(user, actorId);
    if (!actor) return;
    const cfg = configOf(game.settings.get(MODULE_ID, "roach"));
    const today = agentDay();
    if (cfg.out) return this._alertNow(actor.id, { kind: "event", from: FROM, app: "roach", text: "The cabinet is out of order." });
    if (riderOf(this.apps.roachRiders, actorId).pass === today) return;
    const price = hasWallet(actor) ? cfg.price : 0;
    if (price) {
      if (!(await this._transfer(actor, null, price, `${FROM}: day pass`))) {
        return this._alertNow(actor.id, { kind: "money", from: FROM, app: "roach", text: `Declined: a day pass is ${formatMoney(price)}.` });
      }
      this._ledger(actor.id, -price, "Day pass", "roach", FROM);
    }
    const id = this._alert(actor.id, { kind: "money", from: FROM, app: "roach", text: `Day pass${price ? `, ${formatMoney(price)}` : ""}. Ride as much as you like until midnight.` });
    this._roachRider(actorId, r => Object.assign(r, { pass: today, paid: price }), [id]);
  },

  /** Ride a steed the character owns, or buy one from the stable (then ride it). */
  async _onRoachSteed(user, { actorId, steedId }) {
    const actor = this._roachActor(user, actorId);
    const cfg = configOf(game.settings.get(MODULE_ID, "roach"));
    const steed = cfg.steeds[steedId];
    if (!actor || !steed) return;
    const rider = riderOf(this.apps.roachRiders, actorId);
    if (rider.steeds.includes(steedId)) return this._roachRider(actorId, r => (r.steed = steedId));
    if (steed.sale !== "buy") return;
    const price = hasWallet(actor) ? steed.price : 0;
    if (price) {
      if (!(await this._transfer(actor, null, price, `${FROM}: ${steed.name}`))) {
        return this._alertNow(actor.id, { kind: "money", from: FROM, app: "roach", text: `Declined: ${steed.name} is ${formatMoney(price)}.` });
      }
      this._ledger(actor.id, -price, `Steed: ${steed.name}`, "roach", FROM);
    }
    const id = this._alert(actor.id, { kind: "money", from: FROM, app: "roach", text: `${steed.name} is in your stable${price ? ` (${formatMoney(price)})` : ""}.` });
    this._roachRider(actorId, r => {
      r.steeds = [...new Set([...r.steeds, steedId])];
      r.steed = steedId;
    }, [id]);
  },

  /** A game sound around the player's token, as Flappy Chrome's (apps/pigeon/host.js). */
  _onRoachSound(user, { actorId, kind }) {
    const actor = game.actors.get(actorId);
    if (!actor || !WORLD_SOUNDS.has(kind) || !Object.hasOwn(BLIPS, kind) || !owns(user, actor)) return;
    const radius = Math.max(3, game.settings.get(MODULE_ID, "ringRadius") * 0.4);
    this._worldSound({ actorId }, null, { loop: false, blip: kind, radius, volume: 1 / 3 });
  },

  async _onRoachScore(user, { actorId, score, dist, initials }) {
    const actor = game.actors.get(actorId);
    score = Math.floor(Number(score));
    dist = Math.floor(Number(dist));
    if (!actor || user.isGM || !owns(user, actor) || !(score > 0) || !plausible(score, dist)) return;
    const before = board();
    const who = displayName(actor);
    const was = before.find(s => s.actorId === actorId)?.name;
    const name = validInitials(initials) ? initials : validInitials(was) ? was : defaultInitials(who);
    const made = entry({ name, who, actorId, score, dist });
    const next = addScore(before, made);
    if (next.includes(made)) {
      await save(next);
      this._lostTop(before[0], next[0], { from: "Roach Race", app: "roach" });
    }
    const cfg = configOf(game.settings.get(MODULE_ID, "roach"));
    if (cfg.record && score > cfg.record && !riderOf(this.apps.roachRiders, actorId).record) this._roachBeatRecord(actor, score, cfg);
  },

  /** The House Record fell: the GM's card (award the prize or not); the player hears the owner was told. */
  _roachBeatRecord(actor, score, cfg) {
    const who = displayName(actor);
    this._gmCard({
      id: `roach:${actor.id}`, title: `${FROM}: House Record`, icon: ICON, open: { app: "roach" },
      body: `${who} scored ${score.toLocaleString()}, beating the House Record of ${cfg.record.toLocaleString()}.${cfg.prize ? ` Prize: ${cfg.prize}.` : ""} Nothing is given until you award it.`,
      actions: [
        { label: "Award", icon: "fa-trophy", request: "roach-record", data: { actorId: actor.id, award: true } },
        { label: "No prize", icon: "fa-ban", request: "roach-record", data: { actorId: actor.id, award: false } }
      ]
    });
    const id = this._alert(actor.id, { kind: "event", from: FROM, app: "roach", text: `NEW HOUSE RECORD: ${score.toLocaleString()}! The arcade's owner has been told.` });
    this._roachRider(actor.id, r => (r.record = "pending"), [id]);
  },

  /** GM: award the House Record's prize, or not. Once per character either way. */
  _onRoachRecord(user, { actorId, award }) {
    const actor = game.actors.get(actorId);
    if (!actor || riderOf(this.apps.roachRiders, actorId).record !== "pending") return;
    const cfg = configOf(game.settings.get(MODULE_ID, "roach"));
    const id = this._alert(actorId, award
      ? { kind: "event", from: FROM, app: "roach", text: `House Record confirmed.${cfg.prize ? ` Your prize: ${cfg.prize}.` : ""}` }
      : { kind: "event", from: FROM, app: "roach", text: "The House Record stands, no prize this time." });
    this._roachRider(actorId, r => (r.record = award ? "awarded" : "declined"), [id]);
  },

  /**
   * GM: give a character today's pass (`on`), or take it away; `refund` pays back what they paid for it
   * (with a line in their ledger).
   */
  async _onRoachGrant(user, { actorId, on, refund }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const rider = riderOf(this.apps.roachRiders, actorId);
    if (on) {
      const id = this._alert(actorId, { kind: "event", from: FROM, app: "roach", text: "A day pass, on the house. Ride until midnight." });
      return this._roachRider(actorId, r => Object.assign(r, { pass: agentDay(), paid: 0 }), [id]);
    }
    let id = null;
    if (refund && rider.paid > 0 && hasWallet(actor)) {
      await this._transfer(null, actor, rider.paid, `${FROM}: day pass refund`);
      this._ledger(actorId, rider.paid, "Day pass refund", "roach", FROM);
      id = this._alert(actorId, { kind: "money", from: FROM, app: "roach", text: `Day pass refunded: ${formatMoney(rider.paid)}.` });
    } else if (rider.pass) id = this._alert(actorId, { kind: "event", from: FROM, app: "roach", text: "Your day pass was taken back." });
    this._roachRider(actorId, r => Object.assign(r, { pass: null, paid: 0 }), [id]);
  },

  /** GM: give a character a steed (any, gift-only ones too), or take one back (`take`). */
  _onRoachGift(user, { actorId, steedId, take }) {
    const cfg = configOf(game.settings.get(MODULE_ID, "roach"));
    const steed = cfg.steeds[steedId];
    if (!game.actors.get(actorId) || !steed || steedId === "roach") return;
    const had = riderOf(this.apps.roachRiders, actorId).steeds?.includes(steedId);
    const id = !take ? this._alert(actorId, { kind: "event", from: FROM, app: "roach", text: `A gift: ${steed.name} is in your stable.` })
      : had ? this._alert(actorId, { kind: "event", from: FROM, app: "roach", text: `${steed.name} was taken back from your stable.` }) : null;
    this._roachRider(actorId, r => {
      r.steeds = take ? r.steeds.filter(s => s !== steedId) : [...new Set([...r.steeds, steedId])];
      if (take && r.steed === steedId) r.steed = "roach";
    }, [id]);
  },

  async _onRoachFake(user, { name, score }) {
    name = clean(name, 24);
    score = Math.floor(Number(score));
    if (!name || !(score >= 0) || score > 999999) return;
    await save(addScore(board(), entry({ name, score, dist: 0, fake: true })));
  },

  async _onRoachFill(user, { count }) {
    let scores = board();
    for (const e of randomEntries(Math.min(10, Math.max(1, Math.floor(Number(count) || 5))), Math.random, scores.map(s => s.name))) {
      scores = addScore(scores, entry({ ...e, fake: true }));
    }
    await save(scores);
  },

  async _onRoachRemove(user, { id }) {
    await save(board().filter(s => s.id !== id));
  },

  async _onRoachReset() {
    await save([]);
  }
};

import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { achieveConfig, achievementList, earnedData, TRADES } from "./model.js";
import { canUsePhone, isPlayerCharacter } from "../../scripts/model/agent.js";
import { feature } from "../../scripts/model/features.js";
import { boxContents, boxesData, boxName } from "./boxes.js";
import { giveItems } from "../../scripts/model/items.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { rollCard } from "../../scripts/util/cpr-roll.js";
import { clean, esc } from "../../scripts/util/text.js";

/*
 * Host: Achieve! (see apps/achieve/model.js). The GM awards an achievement to one or more characters (and a
 * note), takes one back, or trades one in (a reroll, or a Mystery Box). Players ask to trade one in;
 * the GM gets a card. Players show one their character earned off in chat. What each character earned is the host's table "earned" (sent to the players
 * who own them): every client celebrates a new one there (apps/achieve/popup.js).
 * Mystery Boxes (apps/achieve/boxes.js): given to a character (an achievement traded in, or the GM), rolled on
 * the Table of Mystery; they open it (1d6), and the GM confirms what lands on their sheet.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "achieve-award": gm("_onAchieveAward"),
  "achieve-revoke": gm("_onAchieveRevoke"),
  "achieve-trade": gm("_onAchieveTrade"),
  "achieve-ask": "_onAchieveAsk",
  "achieve-show": "_onAchieveShow",
  "achieve-box-give": gm("_onBoxGive"),
  "achieve-box-open": "_onBoxOpen",
  "achieve-box-confirm": gm("_onBoxConfirm"),
  "achieve-box-delete": gm("_onBoxDelete")
};

const FROM = "M.R.A.M.A.Z.E.";
const AMAZE = "Mr. Amaze";

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

/** The character and the achievement, when both are real (and it's on in this game). */
function lookup(actorId, id) {
  const cfg = achieveConfig();
  const actor = game.actors.get(actorId);
  const ach = achievementList(cfg).find(a => a.id === id && !a.disabled);
  return actor && isPlayerCharacter(actor) && ach ? { actor, ach, cfg } : null;
}

export const methods = {
  /** What characters earned, as a copy to change. */
  _achieveDraft() {
    return foundry.utils.deepClone(earnedData(this.apps));
  },

  /** Save what characters earned, and send it. */
  _achieveSave(earned, alerts = []) {
    this.apps.earned = earned;
    this._pushApps(alerts.filter(Boolean));
  },

  /**
   * Achievements used to be earned by crews: older worlds kept them in the world setting
   * "achievements", then in this table by crew. Those are dropped (once; apps/manifest.js `load`):
   * anything not kept under a character goes. Mystery Boxes used to be Gacha's ("gachaBoxes"): a
   * character's move here, a crew's go.
   */
  async _achieveLoad() {
    let changed = false;
    const earned = this.apps.earned ?? {};
    const crews = Object.keys(earned).filter(key => !game.actors.get(key));
    for (const key of crews) delete earned[key];
    if (crews.length) console.log(`${MODULE_ID} | Dropped Achieve!'s crew achievements: achievements are earned by characters now`);
    // Boxes were Gacha's: a character's move here, a crew's go. (Once moved, the old files are left empty.)
    const old = Object.values(this.apps.gachaBoxes ?? {});
    delete this.apps.gachaBoxes;
    if (old.length) {
      this.apps.boxes ??= {};
      for (const box of old) if (box.actorId) this.apps.boxes[box.id] = box;
      changed = true;
      console.log(`${MODULE_ID} | Moved Mystery Boxes from Gacha to Achieve! (crews' boxes are dropped)`);
    }
    if (crews.length || changed) await this._queueWrite(() => this._write());
    if (Object.keys(game.settings.get(MODULE_ID, "achievements")?.crews ?? {}).length) {
      await game.settings.set(MODULE_ID, "achievements", { crews: {} });
    }
  },

  /** GM: these characters earned it (once each). `note`: how. */
  async _onAchieveAward(user, { actorIds, id, note }) {
    const earned = this._achieveDraft();
    const { date, time } = agentTimestamp();
    const ts = Date.now();
    const got = [];
    let ach, cfg;
    for (const actorId of Array.isArray(actorIds) ? [...new Set(actorIds)] : []) {
      const found = lookup(actorId, id);
      if (!found || earned[actorId]?.[id]) continue;
      ({ ach, cfg } = found);
      // Awarded together, they share one time: celebrated together (apps/achieve/popup.js).
      (earned[actorId] ??= {})[id] = { note: clean(note, 300), ts, date, time, spent: null };
      got.push(found.actor);
    }
    if (!got.length) return;
    // Kept in the center and the Agent's log; not popped up, since the badge (popup.js) already celebrates it.
    for (const actor of got) this._alert(actor.id, { kind: "event", from: FROM, text: `Achievement unlocked: ${ach.name}.` });
    this._achieveSave(earned);
    if (cfg.chat) await this._achieveChat(ach, `${esc(got.map(displayName).join(", "))} unlocked <b>${esc(ach.name)}</b>.`, note);
    for (const actor of got) Hooks.callAll(`${MODULE_ID}.achievementEarned`, { actorId: actor.id, id, note: clean(note, 300) });
  },

  /**
   * Another app saw a character earn one (CBK's Luxury buys: "Investment"): awarded as if the GM did it,
   * while Achieve! is on in this game. Once each, like the GM's awards.
   */
  async _achieveEarn(actorId, id, note) {
    if (feature("app_achieve")) await this._onAchieveAward(null, { actorIds: [actorId], id, note });
  },

  async _onAchieveRevoke(user, { actorId, id }) {
    const earned = this._achieveDraft();
    if (!earned[actorId]?.[id]) return;
    delete earned[actorId][id];
    const name = lookup(actorId, id)?.ach.name ?? "An achievement";
    this._achieveSave(earned, [this._alert(actorId, { kind: "event", from: FROM, text: `${name} was taken back.` })]);
  },

  /** GM: trade one in: a reroll, or a Mystery Box for that character. */
  async _onAchieveTrade(user, { actorId, id, kind }) {
    const found = lookup(actorId, id);
    if (!found || !TRADES[kind]) return;
    const { actor, ach, cfg } = found;
    const earned = this._achieveDraft();
    const e = earned[actor.id]?.[id];
    if (!e || e.spent) return;
    e.spent = { kind, ts: Date.now() };
    const alerts = [];
    // A Mystery Box turns up for them (the Mystery Boxes tab); a reroll, they're told.
    if (kind === "box") e.spent.boxId = await this._giveBox(actor.id, ach.name, alerts);
    else alerts.push(this._alert(actor.id, { kind: "event", from: FROM, text: `Reroll granted for ${ach.name}.` }));
    this._achieveSave(earned, alerts);
    if (cfg.chat) await this._achieveChat(ach, `${esc(displayName(actor))} traded in <b>${esc(ach.name)}</b> for ${kind === "box" ? "a Mystery Box" : "a reroll"}.`, TRADES[kind].text);
    // The GM did it: the player's ask (if any) is settled, no card about the GM's own click.
    this._gmCardDone(`achieve:${actor.id}:${id}`);
    Hooks.callAll(`${MODULE_ID}.achievementTraded`, { actorId: actor.id, id, kind });
  },

  /** A player asks to trade one of their character's in: the GM decides. */
  _onAchieveAsk(user, { actorId, id, kind }) {
    const found = lookup(actorId, id);
    if (!found || user.isGM || !found.actor.testUserPermission(user, "OWNER") || !TRADES[kind]) return;
    const { actor, ach } = found;
    const e = earnedData(this.apps)[actor.id]?.[id];
    if (!e || e.spent) return;
    const what = kind === "box" ? "a Mystery Box" : "a reroll";
    this._gmCard({
      id: `achieve:${actor.id}:${id}`, title: "Achieve!", img: ach.img, open: { app: "achieve" },
      body: `${displayName(actor)} wants to trade in ${ach.name} for ${what}.`,
      actions: [{ label: `Trade for ${TRADES[kind].name}`, icon: TRADES[kind].icon, request: "achieve-trade", data: { actorId: actor.id, id, kind } }]
    });
    this._alertNow(actor.id, { kind: "event", from: FROM, text: `Asked your GM to trade in ${ach.name} for ${what}.` });
  },

  /* ---------------- Mystery Boxes ---------------- */

  /** The boxes, as a copy to change. */
  _boxesDraft() {
    return foundry.utils.deepClone(boxesData(this.apps));
  },

  /** Save the boxes, and send them. */
  _boxesSave(boxes) {
    this.apps.boxes = boxes;
    this._pushApps();
  },

  /** Roll dice (to chat on CPR's roll card, when the GM has that on): the total. */
  async _boxRoll(formula, title, speaker = { alias: AMAZE }) {
    if (typeof Roll === "undefined") return 1 + Math.floor(Math.random() * Number(formula.split("d")[1]));
    return rollCard(formula, title, { speaker, chat: achieveConfig().chat });
  },

  /**
   * A Mystery Box for a character: the Table of Mystery says which. Returns its id. `source`: where it
   * came from (an achievement's name). `alerts`: the caller sends the alert with its own push.
   */
  async _giveBox(actorId, source = "", alerts = null) {
    const actor = game.actors.get(actorId);
    if (!actor || !isPlayerCharacter(actor)) return null;
    const table = await this._boxRoll("1d10", `The Table of Mystery: ${displayName(actor)}'s Mystery Box`);
    const boxes = this._boxesDraft();
    const id = foundry.utils.randomID();
    boxes[id] = { id, actorId: actor.id, table, status: "sealed", source: clean(source, 80), roll: null, openedBy: null, contents: [], ts: Date.now() };
    this.apps.boxes = boxes;
    const alert = this._alert(actor.id, { kind: "event", from: AMAZE, text: `A Mystery Box has appeared within 10 m of you: ${boxName(table).toLowerCase()}. Nobody saw it arrive.` });
    if (alerts) alerts.push(alert);
    else this._pushApps([alert]);
    return id;
  },

  async _onBoxGive(user, { actorId, source }) {
    await this._giveBox(actorId, source || "A gift from the GM");
  },

  /** Its character opens a box (an Action): 1d6 on its table; the GM confirms. */
  async _onBoxOpen(user, { actorId, boxId }) {
    const actor = game.actors.get(actorId);
    const box = boxesData(this.apps)[boxId];
    if (!actor || user.isGM || !owns(user, actor) || !canUsePhone(actor) || box?.status !== "sealed" || box.actorId !== actor.id) return;
    const roll = await this._boxRoll("1d6", `${displayName(actor)} opens ${boxName(box.table).toLowerCase()}`, { alias: displayName(actor) });
    const found = boxContents(box.table, roll);
    const boxes = this._boxesDraft();
    Object.assign(boxes[boxId], {
      status: "opening", roll, openedBy: actor.id,
      contents: (found?.items ?? []).map(i => ({ ...i, uuid: null })), text: found?.text ?? "Something", loaded: !!found?.loaded
    });
    this._boxesSave(boxes);
    const note = found?.loaded ? " Comes fully loaded: your pick of ammunition." : "";
    this._gmCard({
      id: `box:${boxId}`, title: "Mystery Box", icon: "fa-box-open", open: { app: "achieve" },
      body: `${displayName(actor)} opened ${boxName(box.table).toLowerCase()}: ${found?.text ?? "?"}.${note}`,
      actions: [{ label: "Give it", icon: "fa-gift", request: "achieve-box-confirm", data: { boxId } }]
    });
    this._alertNow(actor.id, { kind: "event", from: AMAZE, text: `Inside the box: ${found?.text ?? "something"}! Your GM is handing it over.` });
  },

  /** GM: the box's contents land on the opener's sheet (`contents` replaces what the table said). */
  async _onBoxConfirm(user, { boxId, contents }) {
    const box = boxesData(this.apps)[boxId];
    const actor = game.actors.get(box?.openedBy);
    if (!actor || box.status !== "opening") return;
    const items = Array.isArray(contents) ? contents.map(c => ({ name: clean(c.name, 100), uuid: c.uuid || null, qty: Math.min(99, Math.max(1, Math.floor(Number(c.qty) || 1))) })).filter(c => c.name || c.uuid) : box.contents;
    const given = await giveItems(actor, items, `From ${boxName(box.table).toLowerCase()} (Mr. Amaze's Mystery Box).`);
    const boxes = this._boxesDraft();
    Object.assign(boxes[boxId], { status: "open", contents: items, given });
    this._boxesSave(boxes);
    this._gmCard({ id: `box:${boxId}`, title: "Mystery Box", icon: "fa-box-open", body: `Given to ${displayName(actor)}: ${given.join(", ")}.` });
    this._alertNow(actor.id, { kind: "event", from: AMAZE, text: `${given.join(", ")}: on your sheet now. A-MAAAAAA-ZING!` });
  },

  _onBoxDelete(user, { boxId }) {
    const boxes = this._boxesDraft();
    if (!boxes[boxId]) return;
    delete boxes[boxId];
    this._boxesSave(boxes);
  },

  /** A player shows off one their character earned, in chat (whatever the GM's "announce" switch says). */
  async _onAchieveShow(user, { actorId, id }) {
    const found = lookup(actorId, id);
    if (!found || user.isGM || !owns(user, found.actor)) return;
    const { actor, ach } = found;
    const earned = earnedData(this.apps)[actor.id]?.[id];
    if (!earned) return;
    // Secret ones are shown off too: once earned, it's theirs to show.
    const name = displayName(actor);
    const when = [earned.date, earned.time].filter(Boolean).join(" ");
    await this._achieveChat(ach, `${esc(name)} shows off <b>${esc(ach.name)}</b>.`, `${ach.text}${when ? ` Earned ${when}.` : ""}`, name);
  },

  _achieveChat(ach, line, note, alias = FROM) {
    const content = `<div class="ctp-achieve-chat"><img src="${esc(ach.img)}" alt=""><div><b class="ctp-achieve-chat-title">Achievement</b><p>${line}</p>${note ? `<p class="ctp-achieve-chat-note">${esc(note)}</p>` : ""}</div></div>`;
    return ChatMessage.create({ speaker: { alias }, content });
  }
};

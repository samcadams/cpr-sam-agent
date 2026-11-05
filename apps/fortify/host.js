import { gm } from "../../scripts/host/validate.js";
import { feature } from "../../scripts/model/features.js";
import { displayName } from "../../scripts/model/threads.js";
import { rollCard } from "../../scripts/util/cpr-roll.js";
import { isInstalled, isLapsed, poolOn } from "../pool/model.js";
import { FORTIFY, FROM, isLive, marksOf, newMark } from "./model.js";

/*
 * Host: 4Tify (see apps/fortify/model.js). Scans on world time, the mark they leave, its +1d6 and the GM's void.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "fortify-scan": "_onFortifyScan",
  "fortify-use": "_onFortifyUse",
  "fortify-void": gm("_onFortifyVoid")
};

/** Used and voided marks kept per character. */
const MAX_OLD_MARKS = 20;

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

const card = (title, body, extra = {}) => ({ title, body, icon: "fa-shield-halved", open: { app: FORTIFY }, ...extra });

export const methods = {
  /** Marks saved before every row went to everyone: without the field, only GMs would get them. */
  _fortifyLoad() {
    const old = Object.values(this.apps.fortifyMarks).filter(m => !m.everyone);
    for (const mark of old) mark.everyone = true;
    if (old.length) this.save();
  },

  _hasFortify(actorId) {
    if (!poolOn()) return !!feature(`app_${FORTIFY}`);
    return isInstalled(this.apps.installs, actorId, FORTIFY) && !isLapsed(this.apps.installs, actorId, FORTIFY);
  },

  /** A scan starts, one at a time per character: they have to stay put for all of it. The GM gets a card, to void it if there isn't time. */
  _onFortifyScan(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !this._hasFortify(actorId)) return;
    const mine = marksOf(this.apps.fortifyMarks, actorId);
    if (mine.some(m => m.status === "scanning")) return;
    const mark = newMark({ id: foundry.utils.randomID(), actorId, now: game.time.worldTime });
    this.apps.fortifyMarks[mark.id] = mark;
    for (const old of mine.filter(m => !isLive(m)).slice(MAX_OLD_MARKS)) delete this.apps.fortifyMarks[old.id];
    this._gmCard(card(`4Tify scan: ${displayName(actor)}`, "Scanning their surroundings for 5 minutes. Void it if they don't have the time.", {
      id: `fortify:${mark.id}`, actions: [{ label: "Void", icon: "fa-ban", request: "fortify-void", data: { id: mark.id } }]
    }));
    this._pushApps();
  },

  /** Use mark: spent first, so a second click finds nothing; then the d6 on a chat card. */
  async _onFortifyUse(user, { id }) {
    const mark = this.apps.fortifyMarks[id];
    const actor = game.actors.get(mark?.actorId);
    if (mark?.status !== "ready" || !owns(user, actor) || user.isGM) return;
    mark.status = "used";
    this._pushApps();
    mark.total = await rollCard("1d6", "4Tify: +1d6 damage", { speaker: ChatMessage.getSpeaker({ actor }), flavor: "Next damage against the cover they scanned" });
    this._pushApps();
  },

  /** GM: "they moved the cargo container". The player is told. */
  _onFortifyVoid(user, { id }) {
    const mark = this.apps.fortifyMarks[id];
    if (!mark || !isLive(mark)) return;
    mark.status = "void";
    this._gmCardDone(`fortify:${id}`);
    this._pushApps([this._alert(mark.actorId, { kind: "event", from: FROM, app: FORTIFY, text: "The GM voided your mark." })]);
  },

  /** Scans that have run their 5 minutes become marks; while one is running, phones redraw as world time moves, for the progress ring. */
  _tickFortify() {
    const now = game.time.worldTime;
    const alerts = [];
    let scanning = false;
    for (const mark of Object.values(this.apps.fortifyMarks ?? {})) {
      if (mark.status !== "scanning") continue;
      if (mark.dueAt > now) {
        scanning = true;
        continue;
      }
      mark.status = "ready";
      this._gmCardDone(`fortify:${mark.id}`);
      alerts.push(this._alert(mark.actorId, { kind: "event", from: FROM, app: FORTIFY, text: "Scan done. +1d6 on your next damage against the cover you scanned." }));
    }
    const moved = scanning && now !== this._fortifyDrawnAt;
    if (moved) this._fortifyDrawnAt = now;
    if (alerts.length || moved) this._pushApps(alerts);
  }
};

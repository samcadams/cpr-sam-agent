import { gm } from "./validate.js";
import { MODULE_ID } from "../config.js";
import { getPhoneSettings, isPlayerCharacter } from "../model/agent.js";
import { ALERT_KINDS, hasBiomonitor, vitalsOf, WOUND_LABELS } from "../model/apps.js";
import { displayName } from "../model/threads.js";
import { agentTimestamp } from "../util/agentTime.js";
import { clean } from "../util/text.js";

/*
 * Host: the Agent's notifications ("alerts", see model/apps.js). The GM sends them from the GM
 * Phone's Agent app (SAAI alerts); other apps send them too (money, Trauma Team, the Garden), and a
 * linked Biomonitor sends biometrics. An alert can offer answers; answering one may do something
 * (its `ref`, handled by the app that sent it: ANSWERS below).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "alert-send": gm("_onAlertSend"),
  "alert-answer": "_onAlertAnswer",
  "alert-dismiss": "_onAlertDismiss"
};

/** Kept per character (older ones drop off). */
const MAX_ALERTS = 60;

/** ref.type → the host method that acts on the answer: (alert, choice, user). */
const ANSWERS = {
  bang: "_answerBang",
  "tt-offer": "_answerTraumaOffer"
};

const owns = (user, actorId) => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");

export const methods = {
  /**
   * Add an alert for a character (not sent yet: push with _pushApps([id])). Returns its id. Alerts pop
   * up even with the Agent app switched off; the app is only where they're kept.
   */
  _alert(actorId, { kind = "system", text, from = null, choices = [], ref = null, tag = null }) {
    if (!game.actors.get(actorId)) return null;
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    this.apps.alerts[id] = {
      id, actorId, kind: kind in ALERT_KINDS ? kind : "system",
      text: clean(text, 500), from, choices: choices.map(c => clean(c, 40)).filter(Boolean).slice(0, 3),
      answer: null, ref, ts: Date.now(), time, date
    };
    if (tag) this.apps.alerts[id].tag = tag; // a macro's own label for it (api.js alert)
    const mine = Object.values(this.apps.alerts).filter(a => a.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_ALERTS))) delete this.apps.alerts[old.id];
    return id;
  },

  /** Add and send at once. */
  _alertNow(actorId, alert) {
    const id = this._alert(actorId, alert);
    if (id) this._pushApps([id]);
    return id;
  },

  /** GM: an SAAI alert to one or more characters, in their own Agent's voice. */
  _onAlertSend(user, { actorIds, kind, text, choices, tag }) {
    text = clean(text, 500);
    if (!text || !Array.isArray(actorIds)) return;
    const list = Array.isArray(choices) ? choices : String(choices ?? "").split(",");
    tag = clean(tag, 100) || null;
    const ids = actorIds.filter(id => game.actors.get(id)).map(id => this._alert(id, { kind, text, choices: list.map(c => String(c).trim()), tag }));
    this._pushApps(ids.filter(Boolean));
  },

  async _onAlertAnswer(user, { alertId, choice }) {
    const alert = this.apps.alerts[alertId];
    if (!alert || alert.answer || !alert.choices.includes(choice)) return;
    if (!user.isGM && !owns(user, alert.actorId)) return;
    alert.answer = choice;
    alert.answeredAt = Date.now();
    const handler = ANSWERS[alert.ref?.type];
    if (handler) await this[handler](alert, choice, user);
    else {
      // A GM's SAAI alert: tell the GM what the player chose.
      const actor = game.actors.get(alert.actorId);
      this._gmCard({ title: `${displayName(actor)} answered their Agent`, body: `"${alert.text}" → ${choice}`, icon: "fa-robot" });
    }
    this._pushApps();
    // For macros (API.md), on the host GM's client.
    Hooks.callAll(`${MODULE_ID}.alertAnswered`, {
      alertId: alert.id, actorId: alert.actorId, choice, text: alert.text, tag: alert.tag ?? null, userId: user.id
    });
  },

  /** Players clear alerts from their Agent's log. */
  _onAlertDismiss(user, { alertId }) {
    const alert = this.apps.alerts[alertId];
    if (!alert || (!user.isGM && !owns(user, alert.actorId))) return;
    delete this.apps.alerts[alertId];
    this._pushApps();
  },

  /* ---------------- Health: biometrics, and what Trauma Team does about it ---------------- */

  /** Remember everyone's health, so a change can be compared with what it was. */
  _rememberVitals() {
    this._vitals = new Map(game.actors.filter(isPlayerCharacter).map(a => [a.id, vitalsOf(a)]));
  },

  /** A character's HP changed (main.js, updateActor). */
  _onHealth(actor) {
    if (!isPlayerCharacter(actor)) return;
    this._vitals ??= new Map();
    const before = this._vitals.get(actor.id) ?? null;
    const now = vitalsOf(actor);
    this._vitals.set(actor.id, now);
    if (!before || !now) return;
    const worse = { null: 0, serious: 1, mortal: 2 };
    const ids = [];
    if (worse[now.state] > worse[before.state] && hasBiomonitor(actor) && getPhoneSettings(actor).biometrics !== false) {
      const line = now.state === "mortal"
        ? "Vital signs critical. You're Mortally Wounded. Stabilise now."
        : "Heart rate spiking. You're Seriously Wounded.";
      ids.push(this._alert(actor.id, { kind: "biometric", text: line }));
    }
    ids.push(...this._traumaHealth(actor, before, now));
    if (ids.some(Boolean)) this._pushApps(ids.filter(Boolean));
  },

  /** Notes for the GM about a wound state, for cards. */
  _woundText(v) {
    return v ? `HP ${v.hp}/${v.max}${v.state ? ` · ${WOUND_LABELS[v.state]}` : ""}` : "No vitals";
  }
};

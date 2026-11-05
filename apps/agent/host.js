import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { agentType, getPhoneSettings, isPlayerCharacter } from "../../scripts/model/agent.js";
import { ALERT_KINDS, hasBiomonitor, vitalsOf, WOUND_LABELS } from "../../scripts/model/apps.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { feature, noSignalSince } from "../../scripts/model/features.js";
import { clean, esc } from "../../scripts/util/text.js";

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
  "alert-dismiss": "_onAlertDismiss",
  "alert-clear": "_onAlertClear",
  "gm-card-clear": gm("_onGmCardClear"),
  "agent-shown": "_onAgentShown"
};

/** Kept per character (older ones drop off). */
const MAX_ALERTS = 60;

/** ref.type → the host method that acts on the answer: (alert, choice, user). */
const ANSWERS = {
  bang: "_answerBang",
  invoice: "_answerInvoice",
  "tt-offer": "_answerTraumaOffer",
  "gacha-trade": "_answerGachaTrade"
};

const owns = (user, actorId) => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");

export const methods = {
  /**
   * A player took out (`open`) or put away their carried Agent: say so in chat (Control's "agentChat").
   * Not an Internal Agent. Whispered to the GMs if Control says so. The line names no token (Foundry
   * would pan to it); each screen it reaches draws the bubble itself, without panning (ui/agentShown.js).
   */
  async _onAgentShown(user, { actorId, open }) {
    const actor = game.actors.get(actorId);
    if (!feature("agentChat") || !actor || user.isGM || !actor.testUserPermission(user, "OWNER") || agentType(actor) !== "agent") return;
    const last = (this._agentShown ??= {});
    if (last[actor.id] === !!open) return;
    last[actor.id] = !!open;
    const name = displayName(actor);
    const content = `<div class="ctp-agent-chat"><i class="fas ${open ? "fa-mobile-screen-button" : "fa-mobile"}"></i><span>${esc(name)} ${open ? "takes out" : "puts away"} their Agent.</span></div>`;
    const whisper = feature("agentChatWhisper") ? ChatMessage.getWhisperRecipients("GM").map(u => u.id) : [];
    await ChatMessage.create({
      speaker: { alias: name }, content, whisper, style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
      flags: { [MODULE_ID]: { agentShown: { actorId: actor.id, open: !!open } } }
    });
  },

  /**
   * Add an alert for a character (not sent yet: push with _pushApps([id])). Returns its id. Alerts pop
   * up even with the Agent app switched off; the app is only where they're kept.
   */
  _alert(actorId, { kind = "system", text, from = null, app = null, choices = [], ref = null, tag = null }) {
    if (!game.actors.get(actorId)) return null;
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    this.apps.alerts[id] = {
      id, actorId, kind: kind in ALERT_KINDS ? kind : "system",
      text: clean(text, 500), from, choices: choices.map(c => clean(c, 40)).filter(Boolean).slice(0, 3),
      answer: null, ref, ts: Date.now(), time, date
    };
    if (tag) this.apps.alerts[id].tag = tag; // a macro's own label for it (api.js alert)
    if (app) this.apps.alerts[id].app = app; // the app it came from, when the sender doesn't say (model/apps.js alertApp)
    const mine = Object.values(this.apps.alerts).filter(a => a.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_ALERTS))) delete this.apps.alerts[old.id];
    return id;
  },

  /**
   * CitiNet apps (manifest `citinet`): may this character use one now? Without an Agent, no (silently); without
   * a signal, no, and their Agent says so, the same in every app (audit C6). Run it last in a check.
   */
  _citinet(actor, app, from = null) {
    if (!actor || !agentType(actor)) return false;
    if (!noSignalSince(actor.id)) return true;
    this._alertNow(actor.id, { kind: "system", from, app, text: "No CitiNet connection." });
    return false;
  },

  /** Add and send at once. */
  _alertNow(actorId, alert) {
    const id = this._alert(actorId, alert);
    if (id) this._pushApps([id]);
    return id;
  },

  /**
   * Leaderboards (Flappy Chrome, NCART Runner, Roach Race, REDLINE): whoever held #1 (`was`, a board entry)
   * hears that another character (`now`) took it. Losing #1 only.
   */
  _lostTop(was, now, { from, app, where = "" }) {
    const actor = game.actors.get(was?.actorId);
    if (!actor || !now?.actorId || now.actorId === actor.id || !agentType(actor)) return;
    this._alertNow(actor.id, { kind: "event", from, app, text: `${now.who ?? "Someone"} took your #1 spot${where ? ` on ${where}` : ""}.` });
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
    // A handler returns the ids of the alerts it made (one, a list or none), sent with this push.
    const made = handler ? await this[handler](alert, choice, user) : null;
    if (!handler) {
      // A GM's SAAI alert: tell the GM what the player chose.
      const actor = game.actors.get(alert.actorId);
      this._gmCard({ title: `${displayName(actor)} answered their Agent`, body: `"${alert.text}" → ${choice}`, icon: "fa-robot", open: { app: "agent" } });
    }
    this._pushApps([made].flat().filter(Boolean));
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

  /** Cleared from the notification center: still in the Agent app's log, gone from the center. */
  _onAlertClear(user, { alertIds }) {
    if (!Array.isArray(alertIds)) return;
    for (const id of alertIds) {
      const alert = this.apps.alerts[id];
      if (alert && (user.isGM || owns(user, alert.actorId))) alert.cleared = true;
    }
    this._pushApps();
  },

  /** GM: cards cleared from the GM Phone's notification center (gone for every GM). */
  _onGmCardClear(user, { cardIds }) {
    this._gmCardDone(cardIds);
  },

  /** Host: drop GM cards by id (the thing they asked about was settled elsewhere), for every GM. */
  _gmCardDone(cardIds) {
    if (!Array.isArray(cardIds)) cardIds = [cardIds];
    const gone = cardIds.filter(id => id in this.apps.gmCards);
    if (!gone.length) return;
    for (const id of gone) delete this.apps.gmCards[id];
    this.save();
    this._send(game.users.filter(u => u.isGM && u.active && u !== game.user).map(u => u.id), { type: "gm-card", clear: gone });
    this._changed({ apps: true });
    if (game.user.isGM) Hooks.callAll(`${MODULE_ID}.gmCardGone`, gone);
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

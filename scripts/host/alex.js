import { cleanImage, gm } from "./validate.js";
import { canUsePhone } from "../model/agent.js";
import { dataPool, instantAnswer, librarySearchBase } from "../model/alex.js";
import { displayName } from "../model/threads.js";
import { agentTimestamp } from "../util/agentTime.js";
import { clean } from "../util/text.js";

/*
 * Host: Ask Alex Anything (see model/alex.js). Questions, the GM's answers, rolls and "no results".
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "alex-ask": "_onAlexAsk",
  "alex-roll": "_onAlexRoll",
  "alex-clear": "_onAlexClear",
  "alex-answer": gm("_onAlexAnswer"),
  "alex-need-roll": gm("_onAlexNeedRoll"),
  "alex-none": gm("_onAlexNone")
};

/** Searches kept per character. */
const MAX_QUERIES = 40;

export const methods = {
  _onAlexAsk(user, { actorId, text }) {
    const actor = game.actors.get(actorId);
    text = clean(text, 300);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !canUsePhone(actor) || !text) return;
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    const query = { id, actorId, text, status: "crawling", ts: Date.now(), time, date };
    const hit = instantAnswer(text, dataPool());
    if (hit) Object.assign(query, { status: "answered", instant: true, answer: { text: clean(hit.text, 2000), source: hit.name, ts: Date.now() } });
    this.apps.queries[id] = query;
    const mine = Object.values(this.apps.queries).filter(q => q.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_QUERIES))) delete this.apps.queries[old.id];
    this._gmCard({
      title: `Ask Alex: ${displayName(actor)}`,
      body: hit ? `"${text}" (answered from the Data Pool: ${hit.name})` : `"${text}" · Library Search +2`,
      icon: "fa-magnifying-glass",
      open: hit ? null : { app: "alex" }
    });
    this._pushApps();
  },

  _onAlexAnswer(user, { queryId, text, image }) {
    const q = this.apps.queries[queryId];
    text = clean(text, 2000);
    image = cleanImage(image, user);
    if (!q || (!text && !image)) return;
    q.status = "answered";
    q.answer = { text, image, ts: Date.now() };
    this._pushApps([this._alexAlert(q, `Alex found something: "${clean(text, 80) || "a picture"}"`)]);
  },

  _onAlexNone(user, { queryId }) {
    const q = this.apps.queries[queryId];
    if (!q) return;
    q.status = "none";
    this._pushApps([this._alexAlert(q, `No results in the local Pool for "${clean(q.text, 60)}".`)]);
  },

  /** The player hears from Alex (a notification that opens the app). */
  _alexAlert(q, text) {
    return this._alert(q.actorId, { kind: "alex", from: "Ask Alex Anything", text });
  },

  /** GM: Alex needs a Library Search roll first (the DV the GM sets). */
  _onAlexNeedRoll(user, { queryId, dv }) {
    const q = this.apps.queries[queryId];
    if (!q || q.status === "answered") return;
    q.status = "roll";
    q.dv = Math.max(0, Math.min(40, Math.floor(Number(dv) || 13)));
    this._pushApps([this._alexAlert(q, `Alex needs your help filtering the Pool: Library Search, DV ${q.dv}.`)]);
  },

  /**
   * The player's Library Search: 1d10 + INT + Library Search + 2 for the Agent. A 10 adds another d10
   * and a 1 takes one away (Cyberpunk RED's critical rolls). Rolled here so it can't be faked; it goes
   * to chat, and the GM sees it on the query.
   */
  async _onAlexRoll(user, { queryId }) {
    const q = this.apps.queries[queryId];
    const actor = game.actors.get(q?.actorId);
    if (!q || q.status !== "roll" || q.roll || !actor?.testUserPermission(user, "OWNER")) return;
    const base = librarySearchBase(actor);
    const d10 = async () => (await new Roll("1d10").evaluate()).total;
    const die = await d10();
    const extra = die === 10 ? await d10() : die === 1 ? -(await d10()) : 0;
    const total = die + extra + base.total;
    const detail = `${die}${extra ? ` ${extra > 0 ? "+" : "−"} ${Math.abs(extra)}` : ""} + ${base.int} INT + ${base.level} skill + ${base.bonus} Agent`;
    q.roll = { total, detail, success: total >= q.dv };
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `Library Search (Ask Alex Anything), DV ${q.dv}`,
      content: `<p><strong>${total}</strong> <small>(${detail})</small></p>`
    });
    this._gmCard({ title: `Ask Alex: ${displayName(actor)} rolled ${total}`, body: `DV ${q.dv}: ${q.roll.success ? "success" : "failure"}. "${q.text}"`, icon: "fa-dice-d10", open: { app: "alex" } });
    this._pushApps();
  },

  /** Players clear their search history. */
  _onAlexClear(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor?.testUserPermission(user, "OWNER")) return;
    for (const q of Object.values(this.apps.queries)) if (q.actorId === actorId && q.status !== "crawling" && q.status !== "roll") delete this.apps.queries[q.id];
    this._pushApps();
  }
};

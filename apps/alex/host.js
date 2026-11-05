import { cleanImage, gm } from "../../scripts/host/validate.js";
import { agentMods, BIG_SAAI, librarySearchBase } from "./model.js";
import { hasAddon, poolConfig, rowsOf } from "../pool/model.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { skillRollCard } from "../../scripts/util/cpr-roll.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: Ask Alex Anything (see apps/alex/model.js). Questions, the GM's answers, rolls and "no results".
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "alex-ask": "_onAlexAsk",
  "alex-roll": "_onAlexRoll",
  "alex-clear": "_onAlexClear",
  "alex-saai-buy": "_onAlexSaaiBuy",
  "alex-answer": gm("_onAlexAnswer"),
  "alex-need-roll": gm("_onAlexNeedRoll"),
  "alex-none": gm("_onAlexNone")
};

/** Searches kept per character. */
const MAX_QUERIES = 40;

/** Alex's answer is one bubble that grows (texts split instead): room for a whole Data Pool entry or a long draft. */
const MAX_ANSWER = 8000;

/** A question: a long paragraph or two. */
const MAX_QUESTION = 2000;

/** Big SAAI buys in flight (a double tap must not pay twice). */
const buying = new Set();

export const methods = {
  /** Has this character Big SAAI (an App Store add-on row: apps/pool/model.js)? */
  _alexSaai(actorId) {
    return hasAddon(this.apps.installs, actorId, BIG_SAAI);
  },

  _onAlexAsk(user, { actorId, text }) {
    const actor = game.actors.get(actorId);
    text = clean(text, MAX_QUESTION);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !text || !this._citinet(actor, "alex")) return;
    const id = foundry.utils.randomID();
    const { time, date } = agentTimestamp();
    // Big SAAI's "priority crawl": badged and first in the GM's queue (and Ziggurat is listening).
    const priority = this._alexSaai(actorId);
    const query = { id, actorId, text, status: "crawling", ts: Date.now(), time, date, ...(priority ? { priority } : {}) };
    this.apps.queries[id] = query;
    const mine = Object.values(this.apps.queries).filter(q => q.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_QUERIES))) delete this.apps.queries[old.id];
    this._gmCard({
      id: `alex:${id}`,
      title: `Ask Alex: ${displayName(actor)}${priority ? " (Big SAAI)" : ""}`,
      body: `"${text}" · Library Search +${librarySearchBase(actor, priority).bonus}`,
      icon: "fa-magnifying-glass",
      open: { app: "alex" }
    });
    this._pushApps();
  },

  _onAlexAnswer(user, { queryId, text, image }) {
    const q = this.apps.queries[queryId];
    text = clean(text, MAX_ANSWER);
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
    this._gmCardDone(`alex:${q.id}`); // the GM acted on it
    return this._alert(q.actorId, { kind: "alex", from: "Ask Alex Anything", text, ref: { type: "alex-query", queryId: q.id } });
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
   * The player's Library Search. Normally rolled on their client with the character sheet's own roll
   * (dialog, Luck, the system's roll card; see apps/alex/page.js), which reports `total`,
   * `detail` and the roll card's `messageId`: taken only if that player just posted that card.
   * Without a Library Search skill item, rolled here: 1d10 + INT + Library Search + 2 for the Agent (+1 Big SAAI),
   * a 10 adds another d10 and a 1 takes one away (Cyberpunk RED's critical rolls).
   */
  async _onAlexRoll(user, { queryId, total, detail, messageId }) {
    const q = this.apps.queries[queryId];
    const actor = game.actors.get(q?.actorId);
    if (!q || q.status !== "roll" || q.roll || !actor?.testUserPermission(user, "OWNER")) return;
    if (messageId !== undefined) {
      total = Math.floor(Number(total));
      // The card may reach the host a moment after the request.
      let card = game.messages.get(messageId);
      if (!card) card = await new Promise(r => setTimeout(() => r(game.messages.get(messageId)), 1500));
      const fresh = card && (card.author ?? card.user)?.id === user.id && Date.now() - (card.timestamp ?? 0) < 120_000;
      if (!fresh || !Number.isFinite(total) || total < -20 || total > 80) return;
      q.roll = { total, detail: clean(detail, 200), success: total >= q.dv };
      this._gmCard({ id: `alex:${q.id}`, title: `Ask Alex: ${displayName(actor)} rolled ${total}`, body: `DV ${q.dv}: ${q.roll.success ? "success" : "failure"}. "${q.text}"`, icon: "fa-dice-d10", open: { app: "alex" } });
      return this._pushApps();
    }
    const base = librarySearchBase(actor, this._alexSaai(actor.id));
    const rolled = await skillRollCard(
      { skill: "Library Search", stat: "int", statValue: base.int, level: base.level, mods: agentMods([], base.bigSaai, "Ask Alex Anything") },
      { speaker: ChatMessage.getSpeaker({ actor }), flavor: `Library Search (Ask Alex Anything), DV ${q.dv}`, rollMode: "publicroll" }
    );
    const extra = rolled.crit;
    total = rolled.total;
    detail = `${rolled.die}${extra ? ` ${extra > 0 ? "+" : "−"} ${Math.abs(extra)}` : ""} + ${base.int} INT + ${base.level} skill + ${base.bonus} Agent${base.bigSaai ? " + Big SAAI" : ""}`;
    q.roll = { total, detail, success: total >= q.dv };
    this._gmCard({ id: `alex:${q.id}`, title: `Ask Alex: ${displayName(actor)} rolled ${total}`, body: `DV ${q.dv}: ${q.roll.success ? "success" : "failure"}. "${q.text}"`, icon: "fa-dice-d10", open: { app: "alex" } });
    this._pushApps();
  },

  /**
   * A player buys Big SAAI from Ask Alex's banner: the catalogue price through BangMe! (ledger kind "pool"), then an
   * App Store install row (with the App Store on or off), which also puts the sheet's +1 on them (apps/pool/host.js).
   */
  async _onAlexSaaiBuy(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || buying.has(actorId)) return;
    const row = rowsOf(this.apps.installs, actorId)[BIG_SAAI];
    if (row?.revoked || this._alexSaai(actorId) || !this._citinet(actor, "alex", "Ziggurat")) return;
    const { price } = poolConfig().apps[BIG_SAAI];
    buying.add(actorId);
    try {
      if (!(await this._poolCharge(actor, price, "Big SAAI", BIG_SAAI))) return;
      const paid = hasWallet(actor) ? price : 0;
      const id = this._alert(actorId, { kind: paid ? "money" : "system", from: "Ziggurat", app: "alex", text: `SAAI upgraded${paid ? ` (${formatMoney(paid)})` : ""}. Thank you for choosing Ziggurat.` });
      this._poolRow(actorId, BIG_SAAI, r => {
        Object.assign(r, { source: "store", at: Date.now(), paid });
        delete r.removed;
      }, [id]);
    } finally {
      buying.delete(actorId);
    }
  },

  /** Players clear their search history. */
  _onAlexClear(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor?.testUserPermission(user, "OWNER")) return;
    for (const q of Object.values(this.apps.queries)) if (q.actorId === actorId && q.status !== "crawling" && q.status !== "roll") delete this.apps.queries[q.id];
    this._pushApps();
  }
};

import { cleanImage, gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { skillRollCard } from "../../scripts/util/cpr-roll.js";
import { clean } from "../../scripts/util/text.js";
import { cleanRecord, cleanResult, dueIn, findRecord, FROM, lookupNumber, migrateRecords, ncpdConfig, ncpdReachable, NO_UPLINK, OPPOSE_SKILL, recordSummary, shotUsable, skillBase } from "./model.js";

/*
 * Host: NCPD Crime Database (see apps/ncpd/model.js). Lookups, their rolls, the GM's record and its
 * delivery, the saved records, and the clock that tells the GM when results are due.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "ncpd-submit": "_onNcpdSubmit",
  "ncpd-roll": "_onNcpdRoll",
  "ncpd-clear": "_onNcpdClear",
  "ncpd-dv": gm("_onNcpdDv"),
  "ncpd-oppose": gm("_onNcpdOppose"),
  "ncpd-ask": gm("_onNcpdAsk"),
  "ncpd-link": gm("_onNcpdLink"),
  "ncpd-deliver": gm("_onNcpdDeliver"),
  "ncpd-flag": gm("_onNcpdFlag"),
  "ncpd-delete": gm("_onNcpdDelete"),
  "ncpd-forget": gm("_onNcpdForget"),
  "ncpd-record-save": gm("_onNcpdRecordSave")
};

/** Lookups kept per character. */
const MAX_LOOKUPS = 30;

/** The shutter around the player's token, quietly like the games' sounds (apps/pigeon/host.js). */
const SHUTTER_RADIUS = () => Math.max(3, game.settings.get(MODULE_ID, "ringRadius") * 0.4);

const card = (title, body, extra = {}) => ({ title, body, icon: "fa-building-shield", open: { app: "ncpd" }, ...extra });

export const methods = {
  /** Once loaded: archive rows from before the archive had ids (keyed by their actor's id) get ids of their own. */
  async _ncpdLoad() {
    const moved = migrateRecords(this.apps.ncpdRecords ??= {}, () => foundry.utils.randomID());
    if (!moved) return;
    console.log(`${MODULE_ID} | NCPD: ${moved} saved record(s) moved into the archive`);
    await this._queueWrite(() => this._write());
  },

  /**
   * A player sends a photo: a token they could see (its picture; the GM gets the actor behind it) or a
   * picture. `roll`: the sheet's roll, rolled on their client ({ total, detail, messageId }); without it
   * (no skill item on the sheet) the host rolls.
   */
  async _onNcpdSubmit(user, { actorId, tokenId, sceneId, image, seen, caption, roll }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !this._citinet(actor, "ncpd")) return;
    const token = tokenId ? game.scenes.get(sceneId)?.tokens.get(tokenId) : null;
    const img = token ? token.texture?.src ?? null : cleanImage(image, user);
    if (!img) return;
    const config = ncpdConfig();
    // Night City only: the token's scene, or for a picture the scene the player is viewing.
    if (!ncpdReachable(token ? token.parent : game.scenes.get(user.viewedScene), config)) {
      return this._pushApps([this._alert(actorId, { kind: "ncpd", from: FROM, text: NO_UPLINK })]);
    }
    const { time, date } = agentTimestamp();
    const now = game.time.worldTime;
    const lookup = {
      id: foundry.utils.randomID(), num: lookupNumber(), actorId, ts: Date.now(), time, date,
      img, seen: clean(seen, 60), caption: clean(caption, 300),
      at: now, due: now + config.minutes * 60, skill: config.skill, dv: config.dv, status: "pending", gm: {}
    };
    if (token) {
      if (token.actorId === actorId) return; // a selfie
      lookup.subject = { actorId: token.actorId ?? null, name: token.name, tokenId: token.id, sceneId };
    }
    this.apps.ncpdLookups[lookup.id] = lookup;
    const mine = Object.values(this.apps.ncpdLookups).filter(l => l.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_LOOKUPS))) delete this.apps.ncpdLookups[old.id];
    this._ncpdShutter(actorId);
    await this._ncpdTakeRoll(user, actor, lookup, roll ?? {});
    this._gmCard(card(`NCPD lookup: ${displayName(actor)}`, `${lookup.num}${lookup.subject ? ` · ${lookup.subject.name}` : ""}${lookup.caption ? `: "${lookup.caption}"` : ""}. ${this._ncpdRollLine(lookup)}`, { img, id: `ncpd:${lookup.id}` }));
    this._pushApps();
  },

  /** The camera's shutter, heard around the player's token (silenced and internal Agents stay quiet). */
  _ncpdShutter(actorId) {
    this._worldSound({ actorId }, null, { loop: false, blip: "shutter", radius: SHUTTER_RADIUS(), volume: 1 / 3 });
  },

  /** The player's new shot, after the GM asked for one. */
  async _onNcpdRoll(user, { id, roll }) {
    const lookup = this.apps.ncpdLookups[id];
    const actor = game.actors.get(lookup?.actorId);
    if (!lookup?.ask || lookup.status !== "pending" || !actor?.testUserPermission(user, "OWNER")) return;
    Object.assign(lookup, { skill: lookup.ask.skill, dv: lookup.ask.dv });
    delete lookup.ask;
    delete lookup.gm.opposed;
    this._ncpdShutter(lookup.actorId);
    await this._ncpdTakeRoll(user, actor, lookup, roll ?? {});
    this._gmCard(card(`NCPD lookup: ${displayName(actor)} took a new shot`, `${lookup.num}. ${this._ncpdRollLine(lookup)}`, { id: `ncpd:${lookup.id}` }));
    this._pushApps();
  },

  /**
   * The roll, from the player's roll card (taken only if that player just posted that card), or
   * rolled here: 1d10 + STAT + skill, a 10 adds another d10 and a 1 takes one away.
   */
  async _ncpdTakeRoll(user, actor, lookup, { total, detail, messageId }) {
    if (messageId) {
      total = Math.floor(Number(total));
      let found = game.messages.get(messageId);
      if (!found) found = await new Promise(r => setTimeout(() => r(game.messages.get(messageId)), 1500));
      const fresh = found && (found.author ?? found.user)?.id === user.id && Date.now() - (found.timestamp ?? 0) < 120_000;
      if (fresh && Number.isFinite(total) && total > -20 && total < 80) return (lookup.roll = { total, detail: clean(detail, 200) });
    }
    lookup.roll = await this._ncpdHostRoll(actor, lookup.skill, `${lookup.skill} (NCPD Crime Database), DV ${lookup.dv}`);
  },

  /** A skill roll made by the host, on CPR's skill roll card (whispered to the GMs when `whisper`). */
  async _ncpdHostRoll(actor, skill, flavor, whisper = false) {
    const base = skillBase(actor, skill);
    const { total, die, crit: extra } = await skillRollCard(
      { skill, stat: base.stat, statValue: base.value, level: base.level },
      { speaker: ChatMessage.getSpeaker({ actor }), flavor, rollMode: whisper ? "gmroll" : "publicroll" }
    );
    const detail = `${die}${extra ? ` ${extra > 0 ? "+" : "−"} ${Math.abs(extra)}` : ""} + ${base.value} ${base.stat.toUpperCase()} + ${base.level} skill`;
    return { total, detail };
  },

  _ncpdRollLine(lookup) {
    const usable = shotUsable(lookup);
    const against = lookup.gm?.opposed ? `${lookup.gm.opposed.skill} ${lookup.gm.opposed.total}` : `DV ${lookup.dv}`;
    return `${lookup.skill} ${lookup.roll?.total ?? "?"} vs ${against}: ${usable ? "usable shot" : "unusable shot"}.`;
  },

  /** GM: the shot's DV (drops an opposed roll). */
  _onNcpdDv(user, { id, dv }) {
    const lookup = this.apps.ncpdLookups[id];
    if (!lookup || lookup.status !== "pending") return;
    lookup.dv = Math.max(1, Math.min(40, Math.floor(Number(dv) || 13)));
    delete lookup.gm.opposed;
    this._pushApps();
  },

  /** GM: the subject resists the shot with their own skill (Acting by default), rolled here, whispered. */
  async _onNcpdOppose(user, { id, skill }) {
    const lookup = this.apps.ncpdLookups[id];
    const subject = game.actors.get(lookup?.subject?.actorId);
    if (!lookup || lookup.status !== "pending" || !subject) return;
    skill = clean(skill, 60) || OPPOSE_SKILL;
    lookup.gm.opposed = { skill, ...(await this._ncpdHostRoll(subject, skill, `${skill} against ${lookup.num}'s photo (NCPD Crime Database)`, true)) };
    this._pushApps();
  },

  /** GM: ask for a new shot, with this skill and DV (a snap shot: Perception). */
  _onNcpdAsk(user, { id, skill, dv }) {
    const lookup = this.apps.ncpdLookups[id];
    if (!lookup || lookup.status !== "pending") return;
    lookup.ask = { skill: clean(skill, 60) || ncpdConfig().skill, dv: Math.max(1, Math.min(40, Math.floor(Number(dv) || 13))) };
    this._pushApps([this._alert(lookup.actorId, { kind: "ncpd", from: FROM, text: `${lookup.num}: NCPD needs a better image. ${lookup.ask.skill}, DV ${lookup.ask.dv}.` })]);
  },

  /** GM: who's in the picture (an actor, or nobody). */
  _onNcpdLink(user, { id, actorId }) {
    const lookup = this.apps.ncpdLookups[id];
    if (!lookup) return;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actorId && !actor) return;
    if (actor) lookup.subject = { ...lookup.subject, actorId: actor.id, name: lookup.subject?.name ?? actor.name };
    else if (lookup.subject) lookup.subject.actorId = null;
    this._pushApps();
  },

  /**
   * GM: release the results (whenever: the hour is a guide). `save`: keep the record in the archive for
   * later lookups (into `recordId` if the card started from it, else the subject's or same-named record,
   * else a new one). `flagged`: NCPD noticed who's asking (the GM's plot hook; the player isn't told).
   */
  _onNcpdDeliver(user, { id, result, save, flagged, recordId }) {
    const lookup = this.apps.ncpdLookups[id];
    if (!lookup || lookup.status !== "pending") return;
    result = cleanResult(result);
    lookup.result = { ...result, at: Date.now() };
    lookup.status = "delivered";
    delete lookup.ask;
    lookup.gm.flagged = !!flagged;
    this._gmCardDone(`ncpd:${lookup.id}`);
    if (save && result.kind === "record") {
      const actorId = game.actors.get(lookup.subject?.actorId)?.id ?? null;
      const records = this.apps.ncpdRecords;
      const row = records[recordId] ?? findRecord(records, { actorId, name: result.record.name });
      this._ncpdKeep(result.record, row?.id, row?.actorId || actorId);
    }
    const text = result.kind === "record"
      ? `${lookup.num}: record found. ${result.record.name || "Unnamed"}: ${recordSummary(result.record, formatMoney)}.`
      : result.kind === "none" ? `${lookup.num}: no record found.` : `${lookup.num}: inconclusive (${result.reason.toLowerCase()}).`;
    if (flagged) this._ncpdFlagCard(lookup);
    this._pushApps([this._alert(lookup.actorId, { kind: "ncpd", from: FROM, text })]);
  },

  _ncpdFlagCard(lookup) {
    this._gmCard(card("NCPD flagged a lookup", `${lookup.num} by ${displayName(game.actors.get(lookup.actorId))}: NCPD has the photo and its metadata.`));
  },

  /** GM: flag (or unflag) a delivered lookup after the fact. The player isn't told. */
  _onNcpdFlag(user, { id, flagged }) {
    const lookup = this.apps.ncpdLookups[id];
    if (!lookup || lookup.status !== "delivered" || !!lookup.gm.flagged === !!flagged) return;
    lookup.gm.flagged = !!flagged;
    if (flagged) this._ncpdFlagCard(lookup);
    this._pushApps();
  },

  _onNcpdDelete(user, { id }) {
    if (!this.apps.ncpdLookups[id]) return;
    delete this.apps.ncpdLookups[id];
    this._pushApps();
  },

  /** An archive row, new (no `id`) or replaced. Returns it. */
  _ncpdKeep(record, id, actorId) {
    id ||= foundry.utils.randomID();
    return (this.apps.ncpdRecords[id] = { ...cleanRecord(record), id, actorId: actorId || null, updated: Date.now() });
  },

  /** GM: a record in the Archive, new or edited, optionally linked to an actor (`actorId`: "" unlinks). */
  _onNcpdRecordSave(user, { id, record, actorId }) {
    if (id && !this.apps.ncpdRecords[id]) return;
    if (actorId && !game.actors.get(actorId)) return;
    if (!cleanRecord(record).name) return;
    this._ncpdKeep(record, id, actorId);
    this._pushApps();
  },

  /** GM: delete a record from the archive. */
  _onNcpdForget(user, { id }) {
    if (!this.apps.ncpdRecords[id]) return;
    delete this.apps.ncpdRecords[id];
    this._pushApps();
  },

  /** Players clear their delivered lookups. */
  _onNcpdClear(user, { actorId }) {
    if (!game.actors.get(actorId)?.testUserPermission(user, "OWNER")) return;
    for (const l of Object.values(this.apps.ncpdLookups)) if (l.actorId === actorId && l.status === "delivered") delete this.apps.ncpdLookups[l.id];
    this._pushApps();
  },

  /** The clock (world time): tell the GM when results are nearly due, and when they're due. Nothing is sent by itself. */
  _tickNcpd() {
    const { warn } = ncpdConfig();
    let changed = false;
    for (const lookup of Object.values(this.apps.ncpdLookups ?? {})) {
      if (lookup.status !== "pending") continue;
      const left = dueIn(lookup);
      const who = displayName(game.actors.get(lookup.actorId));
      if (left <= 0 && !lookup.gm.due) {
        lookup.gm.due = lookup.gm.warned = true;
        this._gmCard(card(`NCPD results due: ${who}`, `${lookup.num}'s hour is up. Fill in the record and deliver it.`, { id: `ncpd:${lookup.id}` }));
        changed = true;
      } else if (left > 0 && warn && left <= warn * 60 && !lookup.gm.warned) {
        lookup.gm.warned = true;
        this._gmCard(card(`NCPD results soon: ${who}`, `${lookup.num} is due in ${Math.ceil(left / 60)} min.`, { id: `ncpd:${lookup.id}` }));
        changed = true;
      }
    }
    if (changed) this._pushApps();
  }
};

import { gm } from "../../scripts/host/validate.js";
import { agentsOf, agentType } from "../../scripts/model/agent.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { skillRollCard } from "../../scripts/util/cpr-roll.js";
import { clean } from "../../scripts/util/text.js";
import {
  bioConfig, bioSkillBase, canAddRound, cleanLabel, copiesOf, hasMicroVideo, KINDS, METHODS, NEEDS_MICROVIDEO, originalOf, pipCounts,
  recordFromScan, retinaAllowed, roundStatus, scanDone, scanNeed, scanSkill, SIDES
} from "./model.js";

/*
 * Host: Handprint Scanner and Retina Scanner (see apps/handscan/model.js). Scans and their rounds (the roll from
 * the player's roll card, never the client's word), the GM's confirm/void/noticed, the vault, stale marks.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "bio-start": "_onBioStart",
  "bio-round": "_onBioRound",
  "bio-cancel": "_onBioCancel",
  "bio-rename": "_onBioRename",
  "bio-delete": "_onBioDelete",
  "bio-confirm": gm("_onBioConfirm"),
  "bio-void": gm("_onBioVoid"),
  "bio-notice": gm("_onBioNotice"),
  "bio-link": gm("_onBioLink"),
  "bio-stale": gm("_onBioStale"),
  "bio-unstale": gm("_onBioUnstale")
};

/** Scans kept in progress per character, and rounds a scan takes at most (failed ones count; then start again). */
const MAX_SCANS = 20;
const MAX_PIPS = 40;

const scannerName = kind => `${KINDS[kind].name} Scanner`;
const card = (scan, title, body, extra = {}) => ({ title, body, icon: KINDS[scan.kind].icon, open: { app: KINDS[scan.kind].app }, ...extra });
const ownedBy = (row, user) => !!row && (user.isGM || !!game.actors.get(row.actorId)?.testUserPermission(user, "OWNER"));

export const methods = {
  /**
   * A player starts a scan: of a token on the scene (the GM gets the actor behind it) or someone not on the map
   * (a label only). `id`: the client's id for it, so the phone can open it at once.
   */
  _onBioStart(user, { id, actorId, kind, method, side, label, tokenId, sceneId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !agentType(actor)) return;
    if (!(kind in KINDS) || !(method in METHODS) || (kind === "retina" && method !== "direct")) return;
    const config = bioConfig();
    if (kind === "retina" && !retinaAllowed(agentsOf(actor), hasMicroVideo(actor, config.microVideo[actor.id]))) {
      return this._pushApps([this._alert(actorId, { kind: "system", from: scannerName(kind), app: KINDS[kind].app, text: NEEDS_MICROVIDEO })]);
    }
    const token = method === "direct" && tokenId ? game.scenes.get(sceneId)?.tokens.get(tokenId) : null;
    if (token?.actorId === actorId) return; // their own hand or eye
    if (typeof id !== "string" || !/^[A-Za-z0-9]{16}$/.test(id) || this.apps.bioScans[id]) id = foundry.utils.randomID();
    const scan = {
      id, actorId, kind, method, label: cleanLabel(label) || token?.name || "Unknown",
      ...(kind === "hand" ? { side: side in SIDES ? side : "right" } : {}),
      subjectActorId: token?.actorId ?? null, tokenName: token ? clean(token.name, 80) : "", sceneId: token?.parent.id ?? user.viewedScene ?? null,
      need: scanNeed(kind, method, config), skill: scanSkill(method), dv: config.dv,
      ts: Date.now(), at: game.time.worldTime, pips: []
    };
    this.apps.bioScans[id] = scan;
    const mine = Object.values(this.apps.bioScans).filter(s => s.actorId === actorId).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SCANS))) delete this.apps.bioScans[old.id];
    this._pushApps();
  },

  /** A round: the player's roll (`roll`, from their roll card), or `auto` (the target can't move: the GM decides). */
  async _onBioRound(user, { id, roll, auto }) {
    const scan = this.apps.bioScans[id];
    const actor = game.actors.get(scan?.actorId);
    if (!scan || user.isGM || !actor?.testUserPermission(user, "OWNER") || !canAddRound(scan) || scan.pips.length >= MAX_PIPS) return;
    auto = !!auto;
    if (auto && scan.method !== "direct") return; // a print can't be "automatic"
    const pip = { ts: Date.now(), at: game.time.worldTime, ...(auto ? { auto } : { roll: await this._bioTakeRoll(user, actor, scan, roll ?? {}) }) };
    // The scan may have been cancelled, or filled, while the roll was taken.
    if (this.apps.bioScans[id] !== scan || !canAddRound(scan)) return;
    pip.status = roundStatus({ total: pip.roll?.total, auto }, scan.dv, bioConfig().confirm);
    scan.pips.push(pip);
    if (pip.status === "pending") this._bioRoundCard(scan, scan.pips.length - 1);
    else if (scanDone(scan)) return this._bioFinish(scan);
    this._pushApps();
  },

  /** The GM's card for a round waiting for them: Confirm, Void, They notice. */
  _bioRoundCard(scan, index) {
    const pip = scan.pips[index];
    const who = displayName(game.actors.get(scan.actorId));
    const subject = game.actors.get(scan.subjectActorId)?.name ?? scan.label;
    const what = scan.method === "direct" ? (scan.kind === "hand" ? `${subject}'s ${scan.side} hand` : `${subject}'s eye`) : `a print (${scan.label})`;
    const { ok, pending } = pipCounts(scan);
    const line = pip.auto ? "the target can't move (automatic)" : `${scan.skill} ${pip.roll?.total ?? "?"} vs DV ${scan.dv}`;
    const data = { id: scan.id, index };
    this._gmCard(card(scan, `${scannerName(scan.kind)}: ${who}`, `${who} scans ${what}, round ${ok + pending}/${scan.need}: ${line}.`, {
      id: `bio:${scan.id}:${index}`,
      actions: [
        { label: "Confirm", icon: "fa-check", request: "bio-confirm", data },
        { label: "Void", icon: "fa-xmark", request: "bio-void", data },
        { label: "They notice", icon: "fa-eye", request: "bio-notice", data: { id: scan.id, noticed: true } }
      ]
    }));
  },

  /**
   * The roll, from the player's roll card (taken only if that player just posted that card, as NCPD does), or
   * rolled here on CPR's skill card: the sheet has no such skill item.
   */
  async _bioTakeRoll(user, actor, scan, { total, detail, messageId }) {
    if (messageId) {
      total = Math.floor(Number(total));
      let found = game.messages.get(messageId);
      if (!found) found = await new Promise(r => setTimeout(() => r(game.messages.get(messageId)), 1500));
      const fresh = found && (found.author ?? found.user)?.id === user.id && Date.now() - (found.timestamp ?? 0) < 120_000;
      if (fresh && Number.isFinite(total) && total > -20 && total < 80) return { total, detail: clean(detail, 200) };
    }
    const base = bioSkillBase(actor, scan.skill);
    const { total: rolled, die, crit } = await skillRollCard(
      { skill: scan.skill, stat: base.stat, statValue: base.value, level: base.level },
      { speaker: ChatMessage.getSpeaker({ actor }), flavor: `${scan.skill} (${scannerName(scan.kind)}), DV ${scan.dv}`, rollMode: "publicroll" }
    );
    return { total: rolled, detail: `${die}${crit ? ` ${crit > 0 ? "+" : "−"} ${Math.abs(crit)}` : ""} + ${base.value} ${base.stat.toUpperCase()} + ${base.level} skill` };
  },

  /** The last round is in: the record goes into the vault. */
  _bioFinish(scan) {
    const id = foundry.utils.randomID();
    const record = recordFromScan(scan, { id, takenAt: game.time.worldTime, date: agentTimestamp().date, scene: game.scenes.get(scan.sceneId)?.name ?? "" });
    if (scan.noticed) record.noticed = true;
    this.apps.bioRecords[id] = record;
    delete this.apps.bioScans[scan.id];
    this._gmCardDone(scan.pips.map((p, i) => `bio:${scan.id}:${i}`));
    this._pushApps([this._alert(scan.actorId, { kind: "system", from: scannerName(scan.kind), app: KINDS[scan.kind].app, text: `Biometric record saved: ${record.label}.` })]);
  },

  /** GM: a waiting round counts. The last one finishes the scan. */
  _onBioConfirm(user, { id, index }) {
    const scan = this.apps.bioScans[id];
    const pip = scan?.pips[index];
    if (pip?.status !== "pending") return;
    pip.status = "ok";
    this._gmCardDone(`bio:${id}:${index}`);
    if (scanDone(scan)) return this._bioFinish(scan);
    this._pushApps();
  },

  /** GM: a waiting round doesn't count (the target pulled away, it wasn't really an Action...). */
  _onBioVoid(user, { id, index }) {
    const scan = this.apps.bioScans[id];
    const pip = scan?.pips[index];
    if (pip?.status !== "pending") return;
    pip.status = "void";
    this._gmCardDone(`bio:${id}:${index}`);
    this._pushApps([this._alert(scan.actorId, { kind: "system", from: scannerName(scan.kind), app: KINDS[scan.kind].app, text: `${scan.label}: that round didn't count.` })]);
  },

  /** GM: the subject noticed the scan (GM-only; the GM plays it out). The round itself still waits for them. */
  _onBioNotice(user, { id, noticed }) {
    const row = this.apps.bioScans[id] ?? this.apps.bioRecords[id];
    if (!row) return;
    row.noticed = !!noticed;
    this._pushApps();
  },

  /** GM: who a scan or record is of (an actor, or nobody: `actorId` ""). A record's copies follow. */
  _onBioLink(user, { id, actorId }) {
    if (actorId && !game.actors.get(actorId)) return;
    const scan = this.apps.bioScans[id];
    const record = this.apps.bioRecords[id];
    if (scan) scan.subjectActorId = actorId || null;
    else if (record) for (const r of copiesOf(originalOf(record, this.apps.bioRecords), this.apps.bioRecords)) r.subjectActorId = actorId || null;
    else return;
    this._pushApps();
  },

  /** GM: the lock was re-keyed. Marks the original, so every copy is stale too. Players aren't told. */
  _onBioStale(user, { id, reason }) {
    const record = this.apps.bioRecords[id];
    if (!record) return;
    originalOf(record, this.apps.bioRecords).stale = { reason: clean(reason, 200), at: Date.now() };
    this._pushApps();
  },

  _onBioUnstale(user, { id }) {
    const record = this.apps.bioRecords[id];
    if (!record) return;
    const original = originalOf(record, this.apps.bioRecords);
    delete original.stale;
    delete record.stale;
    this._pushApps();
  },

  /** The player (or a GM) stops a scan in progress. */
  _onBioCancel(user, { id }) {
    const scan = this.apps.bioScans[id];
    if (!ownedBy(scan, user)) return;
    delete this.apps.bioScans[id];
    this._gmCardDone(scan.pips.map((p, i) => `bio:${id}:${i}`));
    this._pushApps();
  },

  _onBioRename(user, { id, label }) {
    const row = this.apps.bioRecords[id] ?? this.apps.bioScans[id];
    label = cleanLabel(label);
    if (!ownedBy(row, user) || !label) return;
    row.label = label;
    this._pushApps();
  },

  _onBioDelete(user, { id }) {
    if (!ownedBy(this.apps.bioRecords[id], user)) return;
    delete this.apps.bioRecords[id];
    this._pushApps();
  }
};

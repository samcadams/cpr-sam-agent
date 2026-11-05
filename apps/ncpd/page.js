import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { attachPhotoDialog } from "../../scripts/ui/dialogs/forms.js";
import { canSendImages } from "../../scripts/model/features.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { MODULE_ID } from "../../scripts/config.js";
import { playBlip } from "../../scripts/util/audio.js";
import { ago } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";
import {
  bountyJob, CAUTIONS, CHARGES, cleanRecord, DISPOSITIONS, dueIn, emptyRecord, etaLabel, findRecord, isWanted, ISSUERS, MATCHES, NCPD, ncpdConfig, NCPD_DEFAULTS, OPPOSE_SKILL,
  ncpdReachable, NO_UPLINK, REASONS, recordSummary, RESULTS, sceneInNightCity, searchRecords, SENTENCES, shotUsable, SKILL_STATS, TERMS
} from "./model.js";
import { openRecord } from "./reader.js";

/*
 * Phone page: NCPD Crime Database (see apps/ncpd/model.js). Players: their lookups (pending with the
 * time left, or the record, which opens as a printed file: reader.js), and "New records request": pick someone in sight (or a picture), a
 * caption, Submit, which rolls the shot with the sheet's own roll. The GM Phone: each pending lookup
 * (photo, who it is, the roll and the DV/oppose/new-shot controls, the record card to fill, Deliver),
 * the last delivered, the records Archive (search, edit, new), and the setup. The GM's record drafts stay on this phone.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** Empty rows for the record card's lists. */
const BLANK_ROWS = {
  priors: () => ({ charge: "", year: "", disposition: "Convicted", sentence: "" }),
  warrants: () => ({ charge: "", issuer: "NCPD", issued: "" }),
  bounties: () => ({ amount: 0, issuer: "NCPD", reason: "", terms: "Dead or alive" })
};

/** The camera's shutter, at this user's phone volume (the host plays it quietly around the token too). */
function shutter() {
  const volume = Number(game.settings.get(MODULE_ID, "volume") ?? 0.5);
  playBlip("shutter", volume);
  setTimeout(() => playBlip("shutter-close", volume), 70);
}

/**
 * A skill roll with the character sheet's own roll (dialog, Luck, the system's roll card). Returns
 * { total, detail, messageId }, null if they closed the dialog, or {} without the skill item (the host rolls).
 */
async function sheetRoll(actor, name) {
  const skill = actor?.items.find(i => i.type === "skill" && i.name.toLowerCase() === name.toLowerCase());
  if (!skill?.createRoll) return {};
  const roll = skill.createRoll("skill", actor);
  if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, skill))) return null;
  await roll.roll();
  if (Number.isInteger(roll.luck) && roll.luck > 0) {
    const luck = actor.system.stats.luck.value;
    await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
  }
  const token = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id && t.controlled) ?? null;
  roll.entityData = { actor: actor.id, token: token?.document.isLinked === false ? token.id : null };
  const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
  const card = await CPRChat.RenderRollCard(roll);
  const crit = roll.criticalRoll ? ` ${roll.wasCritFail() ? "−" : "+"} ${roll.criticalRoll}` : "";
  const mods = roll.totalMods();
  const detail = `${roll.initialRoll}${crit} + ${roll.statValue} ${skill.system.stat?.toUpperCase() ?? ""} + ${roll.skillValue} skill${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)} mods` : ""}${roll.luck > 0 ? ` + ${roll.luck} Luck` : ""}`;
  return { total: roll.resultTotal, detail, messageId: card?.id ?? null };
}

/** Who a player can photograph: the tokens they can see on the scene, but not their own. Names only where they'd see them. */
function inSight(actorId) {
  const modes = CONST.TOKEN_DISPLAY_MODES;
  return (canvas?.tokens?.placeables ?? [])
    .filter(t => t.visible && !t.document.hidden && t.document.actorId !== actorId && t.document.texture?.src)
    .map(t => {
      const named = t.isOwner || [modes.HOVER, modes.ALWAYS].includes(t.document.displayName);
      return { tokenId: t.id, sceneId: t.scene.id, img: t.document.texture.src, name: named ? t.document.name : "", targeted: t.isTargeted };
    });
}

/** The record form's aliases (an array, or the GM's text while typing) and caution chips. */
const aliasText = aliases => (Array.isArray(aliases) ? aliases.join(", ") : aliases);
const cautionChips = on => CAUTIONS.map(c => ({ name: c, on: on.includes(c) }));

/** A delivered record's row in the player's list. */
function recordView(record) {
  return {
    ...record,
    aliasesText: record.aliases.join(", "),
    summary: recordSummary(record, formatMoney),
    wanted: isWanted(record)
  };
}

export const actions = {
  "ncpd-open"({ id }) {
    openRecord(id, { actorId: store.apps.ncpdLookups?.[id]?.actorId ?? null, phone: this });
  },
  "ncpd-new"() {
    this.ncpdNew = { pick: inSight(this.context()?.actorId).find(t => t.targeted) ?? null, caption: "" };
    this.render();
  },
  "ncpd-back"() {
    this.ncpdNew = null;
    this.render();
  },
  "ncpd-pick"({ tokenId }) {
    const pick = inSight(this.context()?.actorId).find(t => t.tokenId === tokenId);
    if (this.ncpdNew && pick) this.ncpdNew.pick = pick;
    this.render();
  },
  async "ncpd-picture"() {
    const image = await attachPhotoDialog();
    if (!image || !this.ncpdNew) return;
    this.ncpdNew.pick = { image, img: image, name: "" };
    this.render();
  },
  /** Submit: the shot's roll first (the sheet's roll), then the request. */
  async "ncpd-submit"() {
    const actor = this.context()?.subject?.actor;
    const pick = this.ncpdNew?.pick;
    if (!actor || !pick) return ui.notifications.warn("Pick who to look up first.");
    if (!ncpdReachable(pick.sceneId ? game.scenes.get(pick.sceneId) : canvas?.scene)) return ui.notifications.warn(NO_UPLINK);
    if (this.ncpdRolling) return;
    this.ncpdRolling = true;
    try {
      const roll = await sheetRoll(actor, ncpdConfig().skill);
      if (!roll) return;
      const sent = store.request("ncpd-submit", {
        actorId: actor.id, tokenId: pick.tokenId ?? null, sceneId: pick.sceneId ?? null, image: pick.image ?? null,
        seen: pick.name, caption: this.ncpdNew?.caption ?? "", roll: roll.total === undefined ? null : roll
      });
      if (sent) {
        shutter();
        this.ncpdNew = null;
      }
      this.render();
    } finally {
      this.ncpdRolling = false;
    }
  },
  /** The new shot the GM asked for. */
  async "ncpd-roll"({ id }) {
    const lookup = store.apps.ncpdLookups[id];
    const actor = game.actors.get(lookup?.actorId);
    if (!lookup?.ask || !actor || this.ncpdRolling) return;
    this.ncpdRolling = true;
    try {
      const roll = await sheetRoll(actor, lookup.ask.skill);
      if (roll && store.request("ncpd-roll", { id, roll: roll.total === undefined ? null : roll })) shutter();
    } finally {
      this.ncpdRolling = false;
    }
  },
  "ncpd-clear"() {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("ncpd-clear", { actorId });
  },

  /* GM */
  "ncpd-dv"({ id }) {
    const dv = Number(this.element[0].querySelector(`input[name=ncpdDv][data-id="${id}"]`)?.value);
    store.request("ncpd-dv", { id, dv });
  },
  "ncpd-oppose"({ id }) {
    const skill = this.element[0].querySelector(`input[name=ncpdOppose][data-id="${id}"]`)?.value;
    store.request("ncpd-oppose", { id, skill });
  },
  "ncpd-ask"({ id }) {
    const root = this.element[0];
    const skill = root.querySelector(`input[name=ncpdAskSkill][data-id="${id}"]`)?.value;
    const dv = Number(root.querySelector(`input[name=ncpdAskDv][data-id="${id}"]`)?.value);
    store.request("ncpd-ask", { id, skill, dv });
  },
  "ncpd-row-add"({ id, list }) {
    const draft = this._ncpdDraft(id);
    if (!draft || !BLANK_ROWS[list]) return;
    draft.record[list].push(BLANK_ROWS[list]());
    this.render();
  },
  "ncpd-row-remove"({ id, list, index }) {
    this._ncpdDraft(id)?.record[list]?.splice(Number(index), 1);
    this.render();
  },
  /** GM: start the card from an archived record (someone else's, e.g. a disguise that matched): by name or alias, else the first hit. */
  "ncpd-use-saved"({ id }) {
    const query = this.element[0].querySelector(`input[name=ncpdSaved][data-id="${id}"]`)?.value ?? "";
    const records = store.apps.ncpdRecords ?? {};
    const saved = query.trim() ? findRecord(records, { name: query }) ?? searchRecords(records, query)[0] : null;
    const draft = this._ncpdDraft(id);
    if (!draft) return;
    if (!saved) return ui.notifications.warn("No record on file matches that.");
    Object.assign(draft, { kind: "record", record: cleanRecord(foundry.utils.deepClone(saved)), recordId: saved.id, save: true });
    this.render();
  },
  /** GM: a bounty as a hidden Job (the GM shows it when the players take it up). */
  "ncpd-job"({ id, index }) {
    const draft = this._ncpdDraft(id);
    const record = cleanRecord(draft?.record);
    const bounty = cleanRecord({ bounties: [draft?.record.bounties[Number(index)]] }).bounties[0];
    if (!bounty) return ui.notifications.warn("Give the bounty an amount first.");
    store.request("quest-save", { quest: bountyJob(record, bounty, store.apps.ncpdLookups[id]?.img, formatMoney) });
    ui.notifications.info(`Added a hidden job: Bounty: ${record.name || "Unknown subject"}.`);
  },
  "ncpd-link"({ id }) {
    const name = this.element[0].querySelector(`input[name=ncpdLink][data-id="${id}"]`)?.value.trim();
    const actor = name ? game.actors.getName(name) : null;
    if (name && !actor) return ui.notifications.warn(`No actor named "${name}".`);
    store.request("ncpd-link", { id, actorId: actor?.id ?? null });
    // A fresh card for the newly linked subject.
    delete this.ncpdDrafts?.[id];
  },
  "ncpd-open-actor"({ actorId }) {
    game.actors.get(actorId)?.sheet.render(true);
  },
  "ncpd-deliver"({ id }) {
    const draft = this._ncpdDraft(id);
    if (!draft) return;
    const record = cleanRecord(draft.record);
    if (draft.kind === "record" && !record.name) return ui.notifications.warn("Give the record a name first.");
    store.request("ncpd-deliver", { id, result: { kind: draft.kind, reason: draft.reason, record }, save: draft.save, flagged: draft.flagged, recordId: draft.recordId ?? null });
    delete this.ncpdDrafts[id];
  },
  "ncpd-flag"({ id }) {
    const lookup = store.apps.ncpdLookups[id];
    if (lookup) store.request("ncpd-flag", { id, flagged: !lookup.gm?.flagged });
  },
  async "ncpd-delete"({ id }) {
    const ok = await Dialog.confirm({ title: "NCPD Crime Database", content: "<p>Delete this lookup? The player loses it too.</p>" });
    if (ok) store.request("ncpd-delete", { id });
  },
  async "ncpd-forget"({ id }) {
    const ok = await Dialog.confirm({ title: "NCPD Crime Database", content: "<p>Delete this record from the archive?</p>" });
    if (!ok) return;
    store.request("ncpd-forget", { id });
    if (this.ncpdArchive?.editing === id) this.ncpdArchive.editing = this.ncpdArchive.draft = null;
    this.render();
  },

  /* GM: the Archive. Its open record is the draft "archive". */
  "ncpd-archive-new"() {
    this.ncpdArchive = { ...this.ncpdArchive, editing: "new", draft: { record: emptyRecord(), actor: "" } };
    this.render();
  },
  "ncpd-archive-open"({ id }) {
    const saved = store.apps.ncpdRecords?.[id];
    if (!saved) return;
    const draft = { record: cleanRecord(foundry.utils.deepClone(saved)), actor: game.actors.get(saved.actorId)?.name ?? "" };
    this.ncpdArchive = { ...this.ncpdArchive, editing: id, draft };
    this.render();
  },
  "ncpd-archive-save"() {
    const { editing, draft } = this.ncpdArchive ?? {};
    if (!draft) return;
    const record = cleanRecord(draft.record);
    if (!record.name) return ui.notifications.warn("Give the record a name first.");
    const name = String(draft.actor ?? "").trim();
    const actor = name ? game.actors.getName(name) : null;
    if (name && !actor) return ui.notifications.warn(`No actor named "${name}".`);
    store.request("ncpd-record-save", { id: editing === "new" ? null : editing, record, actorId: actor?.id ?? "" });
    this.ncpdArchive.editing = this.ncpdArchive.draft = null;
    this.render();
  },
  "ncpd-archive-cancel"() {
    if (this.ncpdArchive) this.ncpdArchive.editing = this.ncpdArchive.draft = null;
    this.render();
  }
};

export const inputs = {
  "[name=ncpdArchiveActor]": {
    input(event) {
      if (this.ncpdArchive?.draft) this.ncpdArchive.draft.actor = event.currentTarget.value;
    }
  },
  "[name=ncpdCaption]": {
    input(event) {
      if (this.ncpdNew) this.ncpdNew.caption = event.currentTarget.value;
    }
  },
  /** The GM's record card: data-field is a path in the draft ("kind", "record.priors.0.charge", ...). */
  "[data-ncpd-field]": {
    "input change"(event) {
      const el = event.currentTarget;
      const draft = this._ncpdDraft(el.dataset.id);
      if (!draft) return;
      const path = el.dataset.ncpdField;
      if (el.dataset.caution !== undefined) {
        const set = new Set(draft.record.cautions);
        el.checked ? set.add(el.dataset.caution) : set.delete(el.dataset.caution);
        draft.record.cautions = [...set];
      } else foundry.utils.setProperty(draft, path, el.type === "checkbox" ? el.checked : el.value);
      // Switching the result shows another part of the card.
      if (path === "kind" && event.type === "change") this.render();
    }
  },
  "input[name=ncpdSearch]": {
    input(event) {
      this.ncpdArchive = { ...this.ncpdArchive, query: event.currentTarget.value };
      this.render();
    }
  },
  "[data-ncpd-setting]": {
    change(event) {
      const el = event.currentTarget;
      patchSetting(NCPD, c => Object.assign(c, { [el.dataset.ncpdSetting]: el.type === "checkbox" ? el.checked : el.value }));
    }
  },
  /** GM: is the scene being viewed in Night City (its flag). */
  "[name=ncpdNightCity]": {
    async change(event) {
      await canvas?.scene?.setFlag(MODULE_ID, "nightCity", event.currentTarget.checked);
      this.render();
    }
  }
};

export const methods = {
  /** The GM's draft for a lookup: from the subject's saved record, or a blank card; inconclusive after a bad shot. */
  _ncpdDraft(id) {
    if (id === "archive") return this.ncpdArchive?.draft ?? null;
    const lookup = store.apps.ncpdLookups[id];
    if (!lookup) return null;
    const drafts = (this.ncpdDrafts ??= {});
    if (!drafts[id]) {
      const subject = lookup.subject?.actorId ? game.actors.get(lookup.subject.actorId) : null;
      const saved = findRecord(store.apps.ncpdRecords, { actorId: subject?.id, name: lookup.subject?.name });
      drafts[id] = {
        kind: shotUsable(lookup) === false ? "inconclusive" : "record",
        reason: REASONS[0],
        record: saved ? cleanRecord(foundry.utils.deepClone(saved)) : emptyRecord(subject?.name ?? lookup.subject?.name ?? ""),
        fromSaved: !!saved,
        recordId: saved?.id ?? null,
        save: !!subject || !!saved,
        flagged: false
      };
    }
    return drafts[id];
  },

  ncpdData(ctx) {
    const config = ncpdConfig();
    const lookups = Object.values(store.apps.ncpdLookups ?? {}).sort((a, b) => b.ts - a.ts);
    const row = l => ({
      ...l,
      ago: ago(l.ts),
      pending: l.status === "pending",
      eta: etaLabel(dueIn(l)),
      record: l.result?.kind === "record" ? recordView(l.result.record) : null,
      none: l.result?.kind === "none",
      inconclusive: l.result?.kind === "inconclusive"
    });
    if (ctx.perspective === "gm") {
      const records = store.apps.ncpdRecords ?? {};
      const card = r => ({
        id: r.id, name: r.name || "?", aliasesText: r.aliases?.join(", ") ?? "", affiliation: r.affiliation,
        actor: r.actorId ? game.actors.get(r.actorId)?.name ?? "(actor gone)" : "", summary: recordSummary(r, formatMoney)
      });
      const saved = searchRecords(records).map(card);
      const archive = this.ncpdArchive ?? {};
      const open = archive.draft ? {
        isNew: archive.editing === "new",
        actor: archive.draft.actor,
        record: { ...archive.draft.record, aliasesText: aliasText(archive.draft.record.aliases), cautions: cautionChips(archive.draft.record.cautions) }
      } : null;
      return {
        gm: true,
        bar: appBar("ncpd"),
        pending: lookups.filter(l => l.status === "pending").reverse().map(l => {
          const draft = this._ncpdDraft(l.id);
          const subject = l.subject?.actorId ? game.actors.get(l.subject.actorId) : null;
          const left = dueIn(l);
          const usable = shotUsable(l);
          return {
            ...row(l),
            who: displayName(game.actors.get(l.actorId)),
            subject: subject ? { id: subject.id, name: subject.name, token: l.subject.name } : null,
            tokenName: l.subject?.name ?? "",
            dueLabel: left > 0 ? `due in ${Math.ceil(left / 60)} min` : `due ${Math.ceil(-left / 60)} min ago`,
            overdue: left <= 0,
            usable, unusable: usable === false,
            opposed: l.gm?.opposed ?? null,
            draft: {
              ...draft,
              isRecord: draft.kind === "record",
              isInconclusive: draft.kind === "inconclusive",
              record: { ...draft.record, aliasesText: aliasText(draft.record.aliases), cautions: cautionChips(draft.record.cautions) }
            },
            hasSaved: saved.length > 0
          };
        }),
        delivered: lookups.filter(l => l.status === "delivered").slice(0, 10).map(l => ({
          ...row(l), who: displayName(game.actors.get(l.actorId)), flagged: !!l.gm?.flagged,
          line: l.result.kind === "record" ? `${l.result.record.name}: ${recordSummary(l.result.record, formatMoney)}` : l.result.kind === "none" ? "No record" : `Inconclusive (${l.result.reason})`
        })),
        saved,
        archive: { query: archive.query ?? "", results: searchRecords(records, archive.query).map(card), open },
        picks: {
          charges: CHARGES, dispositions: DISPOSITIONS, sentences: SENTENCES, issuers: ISSUERS, terms: TERMS, matches: MATCHES,
          results: Object.entries(RESULTS).map(([value, label]) => ({ value, label })), reasons: REASONS,
          skills: Object.keys(SKILL_STATS), oppose: OPPOSE_SKILL,
          actors: game.actors.filter(a => a.type !== "container").map(a => a.name).sort()
        },
        config: { ...config, defaults: NCPD_DEFAULTS },
        scene: canvas?.scene ? { name: canvas.scene.name, nightCity: sceneInNightCity(canvas.scene, config) } : null,
        open: this.sectionsOpen()
      };
    }
    const mine = lookups.filter(l => l.actorId === ctx.actorId).map(row);
    const draft = this.ncpdNew;
    return {
      bar: appBar("ncpd", { owner: ctx.subject.name }),
      online: this.online,
      lookups: mine,
      canClear: mine.some(l => !l.pending),
      skill: config.skill, dv: config.dv, hours: config.minutes >= 60 ? `${Math.round(config.minutes / 60)} hr` : `${config.minutes} min`,
      snap: draft ? {
        caption: draft.caption,
        pick: draft.pick,
        tokens: inSight(ctx.actorId).map(t => ({ ...t, picked: t.tokenId === draft.pick?.tokenId })),
        pictures: canSendImages(game.user)
      } : null
    };
  }
};

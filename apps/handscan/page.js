import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { agentsOf } from "../../scripts/model/agent.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { ago } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";
import {
  BIOSCAN, BIOSCAN_DEFAULTS, bioConfig, canAddRound, hasMicroVideo, KINDS, kindOfApp, METHODS, NEEDS_MICROVIDEO, originalOf, pipCounts,
  pipView, recordLine, retinaAllowed, scanNeed, scanSkill, SIDES, staleOf
} from "./model.js";

/*
 * Phone page: Handprint Scanner and Retina Scanner (see apps/handscan/model.js); `this.app` says which. Players:
 * Scan (pick someone in sight or not on the map, the hand, a label), Lift a print (Handprint), the scan screen
 * (pips, one button per round: the sheet's own Brawling or Criminology roll, or "Target can't move"), scans in
 * progress and the vault. The GM Phone, in either app: rounds waiting for the GM, scans in progress, the records
 * by subject (stale marks) and the setup.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

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

/**
 * Who a player could scan: the tokens they can see on the scene, not their own; names only where they'd see
 * them. `far`: not next to the player's token (Melee Range; a note, not a block: maps aren't always accurate).
 */
function inSight(actorId) {
  const modes = CONST.TOKEN_DISPLAY_MODES;
  const tokens = canvas?.tokens?.placeables ?? [];
  const mine = tokens.find(t => t.document.actorId === actorId && t.controlled) ?? tokens.find(t => t.document.actorId === actorId);
  const far = t => {
    if (!mine) return false;
    const path = canvas.grid.measurePath([mine.center, t.center]);
    return Number.isFinite(path.spaces) ? path.spaces > 1 : path.distance > canvas.grid.distance;
  };
  return tokens
    .filter(t => t.visible && !t.document.hidden && t.document.actorId !== actorId && t.document.texture?.src)
    .map(t => {
      const named = t.isOwner || [modes.HOVER, modes.ALWAYS].includes(t.document.displayName);
      return { tokenId: t.id, sceneId: t.scene.id, img: t.document.texture.src, name: named ? t.document.name : "", far: far(t), targeted: t.isTargeted };
    });
}

/** Is the character in the combat that's running (a round is then their Action). */
const inCombat = actorId => !!game.combat?.started && game.combat.combatants.some(c => c.actorId === actorId);

/** The label a pick starts with: "Kenji, Arasaka lobby" (the token's name and the scene). */
const pickLabel = pick => (pick?.name ? [pick.name, game.scenes.get(pick.sceneId)?.name].filter(Boolean).join(", ") : "");

const scanText = scan => (scan.method === "direct" ? (scan.kind === "hand" ? SIDES[scan.side] ?? "Hand" : "Eye") : METHODS[scan.method]);

function roundsView(scan) {
  const word = { ok: "counted", pending: "waiting for the GM", void: "didn't count", fail: "failed" };
  return scan.pips.map((p, i) => ({ n: i + 1, status: p.status, word: word[p.status], line: p.auto ? "Target couldn't move" : `${scan.skill} ${p.roll?.total ?? "?"}`, detail: p.roll?.detail ?? "" }));
}

export const actions = {
  /** A new scan: `method` direct (a person) or print/partial (Handprint: a surface). */
  "bio-new"({ method }) {
    const kind = kindOfApp(this.app);
    if (!kind) return;
    method = method in METHODS && kind === "hand" ? method : "direct";
    const pick = method === "direct" ? inSight(this.context()?.actorId).find(t => t.targeted) ?? null : null;
    this.bioNew = { kind, method, pick, offMap: false, side: "right", label: pickLabel(pick) };
    this.render();
  },
  "bio-back"() {
    this.bioNew = null;
    this.bioOpen = null;
    this.render();
  },
  "bio-pick"({ tokenId }) {
    const pick = inSight(this.context()?.actorId).find(t => t.tokenId === tokenId);
    if (!this.bioNew || !pick) return;
    // The label follows the pick until the player types their own.
    if (!this.bioNew.typed) this.bioNew.label = pickLabel(pick);
    Object.assign(this.bioNew, { pick, offMap: false });
    this.render();
  },
  "bio-offmap"() {
    if (!this.bioNew) return;
    Object.assign(this.bioNew, { pick: null, offMap: true });
    if (!this.bioNew.typed) this.bioNew.label = "";
    this.render();
  },
  "bio-side"({ side }) {
    if (this.bioNew && side in SIDES) this.bioNew.side = side;
    this.render();
  },
  "bio-method"({ method }) {
    if (this.bioNew && (method === "print" || method === "partial")) this.bioNew.method = method;
    this.render();
  },
  "bio-start"() {
    const actorId = this.context()?.actorId;
    const draft = this.bioNew;
    if (!actorId || !draft) return;
    if (draft.method === "direct" && !draft.pick && !draft.offMap) return ui.notifications.warn("Pick who to scan first.");
    if (!draft.pick && !draft.label.trim()) return ui.notifications.warn("Give the scan a label first.");
    const id = foundry.utils.randomID();
    const sent = store.request("bio-start", {
      id, actorId, kind: draft.kind, method: draft.method, side: draft.side, label: draft.label,
      tokenId: draft.pick?.tokenId ?? null, sceneId: draft.pick?.sceneId ?? null
    });
    if (!sent) return;
    this.bioNew = null;
    this.bioOpen = id;
    this.render();
  },
  "bio-open"({ id }) {
    this.bioOpen = id;
    this.render();
  },
  /** A round: the sheet's own roll (Brawling or Criminology), or `auto` (the target can't move). */
  async "bio-round"({ id, auto }) {
    const scan = store.apps.bioScans?.[id];
    const actor = game.actors.get(scan?.actorId);
    if (!scan || !actor || this.bioRolling) return;
    if (auto) return store.request("bio-round", { id, auto: true });
    this.bioRolling = true;
    try {
      const roll = await sheetRoll(actor, scan.skill);
      if (roll) store.request("bio-round", { id, roll: roll.total === undefined ? null : roll });
    } finally {
      this.bioRolling = false;
    }
  },
  async "bio-cancel"({ id }) {
    const ok = await Dialog.confirm({ title: "Biometrics", content: "<p>Stop this scan? Its rounds are lost.</p>" });
    if (!ok) return;
    store.request("bio-cancel", { id });
    if (this.bioOpen === id) this.bioOpen = null;
  },
  "bio-rename"({ id }) {
    this.bioRenaming = this.bioRenaming === id ? null : id;
    this.render();
  },
  "bio-rename-save"({ id }) {
    const label = this.element[0].querySelector(`input[name=bioRename][data-id="${id}"]`)?.value;
    if (label?.trim()) store.request("bio-rename", { id, label });
    this.bioRenaming = null;
  },
  async "bio-delete"({ id }) {
    const ok = await Dialog.confirm({ title: "Biometrics", content: "<p>Delete this record from your vault?</p>" });
    if (ok) store.request("bio-delete", { id });
  },

  /* GM */
  "bio-confirm"({ id, index }) {
    store.request("bio-confirm", { id, index: Number(index) });
  },
  "bio-void"({ id, index }) {
    store.request("bio-void", { id, index: Number(index) });
  },
  "bio-notice"({ id }) {
    const row = store.apps.bioScans?.[id] ?? store.apps.bioRecords?.[id];
    if (row) store.request("bio-notice", { id, noticed: !row.noticed });
  },
  "bio-link"({ id }) {
    const name = this.element[0].querySelector(`input[name=bioLink][data-id="${id}"]`)?.value.trim();
    const actor = name ? game.actors.getName(name) : null;
    if (name && !actor) return ui.notifications.warn(`No actor named "${name}".`);
    store.request("bio-link", { id, actorId: actor?.id ?? "" });
  },
  "bio-open-actor"({ actorId }) {
    game.actors.get(actorId)?.sheet.render(true);
  },
  "bio-stale"({ id }) {
    const reason = this.element[0].querySelector(`input[name=bioStale][data-id="${id}"]`)?.value ?? "";
    store.request("bio-stale", { id, reason });
  },
  "bio-unstale"({ id }) {
    store.request("bio-unstale", { id });
  },
  /** GM: MicroVideo for a character: detected (no word), has it, hasn't. */
  "bio-mv"({ actorId }) {
    patchSetting(BIOSCAN, c => {
      const mv = (c.microVideo ??= {});
      if (mv[actorId] === undefined) mv[actorId] = true;
      else if (mv[actorId] === true) mv[actorId] = false;
      else delete mv[actorId];
    });
  }
};

export const inputs = {
  "[name=bioLabel]": {
    input(event) {
      if (!this.bioNew) return;
      this.bioNew.label = event.currentTarget.value;
      this.bioNew.typed = true;
    }
  },
  "[data-bio-setting]": {
    change(event) {
      const el = event.currentTarget;
      patchSetting(BIOSCAN, c => Object.assign(c, { [el.dataset.bioSetting]: el.type === "checkbox" ? el.checked : el.value }));
    }
  }
};

export const methods = {
  bioscanData(ctx) {
    const kind = kindOfApp(this.app) ?? "hand";
    const config = bioConfig();
    const scans = Object.values(store.apps.bioScans ?? {}).sort((a, b) => b.ts - a.ts);
    const records = store.apps.bioRecords ?? {};
    const scanRow = s => {
      const { ok, pending } = pipCounts(s);
      return { ...s, kindName: KINDS[s.kind].name, icon: KINDS[s.kind].icon, what: scanText(s), pips: pipView(s), count: `${ok + pending}/${s.need}`, ago: ago(s.pips.at(-1)?.ts ?? s.ts) };
    };
    const recordRow = r => ({ ...r, icon: KINDS[r.kind]?.icon ?? "fa-fingerprint", line: recordLine(r), from: r.from ? displayName(game.actors.get(r.from)) : "" });

    if (ctx.perspective === "gm") {
      const subjectName = row => game.actors.get(row.subjectActorId)?.name ?? null;
      const pendingRounds = scans.flatMap(s => s.pips.map((p, index) => ({ p, index })).filter(({ p }) => p.status === "pending").map(({ p, index }) => ({
        id: s.id, index, who: displayName(game.actors.get(s.actorId)), icon: KINDS[s.kind].icon,
        what: `${s.method === "direct" ? `${subjectName(s) ?? s.label}: ${scanText(s).toLowerCase()}` : `${s.label}: ${scanText(s).toLowerCase()}`}`,
        round: `${pipCounts(s).ok + 1}/${s.need}`,
        line: p.auto ? "Target can't move (automatic)" : `${s.skill} ${p.roll?.total ?? "?"} vs DV ${s.dv}`, detail: p.roll?.detail ?? "", noticed: !!s.noticed
      })));
      // Records by subject: the original and its copies together.
      const groups = new Map();
      for (const r of Object.values(records)) {
        const original = originalOf(r, records);
        const key = original.subjectActorId ? `a:${original.subjectActorId}` : `r:${original.id}`;
        if (!groups.has(key)) groups.set(key, { key, name: subjectName(original) ?? `${original.label} (no actor)`, actorId: game.actors.get(original.subjectActorId)?.id ?? null, records: [] });
        const stale = staleOf(r, records);
        groups.get(key).records.push({
          ...recordRow(r), holder: displayName(game.actors.get(r.actorId)), ago: ago(r.ts), copy: !!r.copyOf, linkName: subjectName(original) ?? "",
          stale: stale ? { reason: stale.reason || "no reason given" } : null, noticed: !!r.noticed
        });
      }
      const characters = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
      return {
        gm: true,
        bar: appBar(this.app),
        pendingRounds,
        scans: scans.map(s => ({ ...scanRow(s), who: displayName(game.actors.get(s.actorId)), subject: subjectName(s), subjectId: s.subjectActorId, method: METHODS[s.method], noticed: !!s.noticed })),
        groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
        config: { ...config, defaults: BIOSCAN_DEFAULTS },
        microVideo: characters.map(a => {
          const word = config.microVideo[a.id];
          const found = hasMicroVideo(a);
          return { id: a.id, name: a.name, label: word === true ? "Has MicroVideo" : word === false ? "No MicroVideo" : `Detected: ${found ? "yes" : "no"}`, set: typeof word === "boolean" };
        }),
        actors: game.actors.filter(a => a.type !== "container").map(a => a.name).sort(),
        open: this.sectionsOpen()
      };
    }

    const actorId = ctx.actorId;
    const actor = ctx.subject?.actor;
    const blocked = kind === "retina" && !retinaAllowed(agentsOf(actor), hasMicroVideo(actor, config.microVideo[actorId])) ? NEEDS_MICROVIDEO : null;
    const mine = scans.filter(s => s.actorId === actorId && s.kind === kind);
    const base = { bar: appBar(this.app, { owner: ctx.subject.name }), kind, isHand: kind === "hand", name: KINDS[kind].name, icon: KINDS[kind].icon, dv: config.dv };
    const draft = this.bioNew?.kind === kind ? this.bioNew : null;
    if (draft) {
      const direct = draft.method === "direct";
      return {
        ...base,
        new: {
          ...draft, direct,
          tokens: direct ? inSight(actorId).map(t => ({ ...t, picked: t.tokenId === draft.pick?.tokenId })) : [],
          far: !!draft.pick?.far,
          sides: kind === "hand" && direct ? Object.entries(SIDES).map(([value, label]) => ({ value, label, on: value === draft.side })) : null,
          methods: direct ? null : ["print", "partial"].map(value => ({ value, label: METHODS[value], on: value === draft.method })),
          need: scanNeed(kind, draft.method, config), skill: scanSkill(draft.method)
        }
      };
    }
    const open = this.bioOpen ? store.apps.bioScans?.[this.bioOpen] : null;
    if (open?.kind === kind) {
      const { pending } = pipCounts(open);
      return {
        ...base,
        scan: { ...scanRow(open), direct: open.method === "direct", canRound: canAddRound(open), waiting: pending > 0, rounds: roundsView(open).reverse(), combat: inCombat(actorId), busy: !!this.bioRolling }
      };
    }
    return {
      ...base,
      blocked,
      scans: mine.map(scanRow),
      records: Object.values(records).filter(r => r.actorId === actorId && r.kind === kind).sort((a, b) => b.ts - a.ts)
        .map(r => ({ ...recordRow(r), renaming: this.bioRenaming === r.id, fresh: Date.now() - r.ts < 4000 }))
    };
  }
};

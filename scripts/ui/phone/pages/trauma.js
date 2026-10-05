import { dropdown } from "./dropdown.js";
import { appBar } from "./home.js";
import { fieldsDialog } from "../../dialogs/forms.js";
import { panToToken } from "../../location.js";
import { hasBiomonitor, vitalsOf, WOUND_LABELS } from "../../../model/apps.js";
import { playerCharacters } from "../../../model/contacts.js";
import { commsOn } from "../../../model/features.js";
import { servicesFor } from "../../../model/services.js";
import { currencyLabel } from "../../../model/money.js";
import { displayName } from "../../../model/threads.js";
import { cleanPlan, covered, execTier, planPrice, traumaConfig, TRIGGERS } from "../../../model/trauma.js";
import { store } from "../../../store.js";
import { patchSetting } from "../../../util/settings.js";
import { esc, formatDuration } from "../../../util/text.js";

/*
 * Phone page: Trauma Team (see model/trauma.js). Players see their plan, subscribe or cancel, link a
 * Biomonitor, and have the panic button. The GM sets the plans (adds, edits and removes them) and
 * rules, gives plans (a corporate plan), and handles the calls: ETA, arrived, closed.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const saveConfig = changes => patchSetting("trauma", c => Object.assign(c, changes));

export const actions = {
  "tt-subscribe"({ tier }) {
    const actor = this.context()?.subject?.actor;
    const plan = traumaConfig().tiers[tier];
    if (!actor || !plan) return;
    Dialog.confirm({
      title: "Trauma Team",
      content: `<p>Subscribe to <strong>${esc(plan.name)}</strong> coverage for ${planPrice(plan)}? The first payment is charged now, through BangMe!.</p><p class="notes">${esc(plan.note)}</p>`,
      yes: () => store.request("tt-subscribe", { actorId: actor.id, tier })
    });
  },
  "tt-cancel"() {
    const actor = this.context()?.subject?.actor;
    if (actor) Dialog.confirm({ title: "Trauma Team", content: "<p>Cancel your coverage?</p>", yes: () => store.request("tt-cancel", { actorId: actor.id }), defaultYes: false });
  },
  "tt-call"() {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("tt-call", { actorId: actor.id });
  },
  async "tt-grant"({ actorId }) {
    const actor = game.actors.get(actorId);
    const cfg = traumaConfig();
    const result = await fieldsDialog({
      title: `Give ${displayName(actor)} coverage`,
      label: "Give",
      fields: [
        { name: "tier", label: "Plan", type: "select", options: Object.entries(cfg.tiers).map(([value, t]) => ({ value, label: t.name })) },
        { name: "sponsor", label: "Paid by", value: "Corporate plan", hint: "Never billed. Shown to the player." }
      ]
    });
    if (result) store.request("tt-grant", { actorId, tier: result.tier, sponsor: result.sponsor });
  },
  "tt-revoke"({ actorId }) {
    store.request("tt-revoke", { actorId });
  },
  "tt-dispatch"({ dispatchId, status, unit }) {
    const eta = Number(this.element[0].querySelector(`input[name=eta][data-dispatch-id="${dispatchId}"]`)?.value);
    store.request("tt-dispatch", { dispatchId, status, eta, unit });
  },
  /** A Trauma Team service (Services manager): its line, where Dispatch can talk to them. */
  "tt-line"({ serviceId }) {
    const ctx = this.context();
    if (!ctx?.actorId) return;
    this.app = "messages";
    this.view = { kind: "service", actorId: ctx.actorId, serviceId };
    this.render();
  },
  "tt-show"({ sceneId, tokenId }) {
    panToToken({ sceneId, tokenId });
  },
  "tt-bill"() {
    Dialog.confirm({ title: "Trauma Team", content: "<p>Bill every paid plan now (\"It's the 1st\")?</p>", yes: () => store.request("tt-bill") });
  },
  /** GM: edit a plan, or (no tier) add one. */
  async "tt-tier-edit"({ tier } = {}) {
    const cfg = traumaConfig();
    const t = cfg.tiers[tier] ?? cleanPlan({ name: "", price: 500, days: 30 });
    const result = await fieldsDialog({
      title: tier ? `Plan: ${t.name}` : "New plan",
      label: tier ? "Save" : "Add",
      fields: [
        { name: "name", label: "Name", value: t.name },
        { name: "price", label: `Price (${currencyLabel()})`, type: "number", value: t.price },
        { name: "days", label: "Billed every (days)", type: "number", value: t.days, hint: "Days of world time. 30 is a month." },
        { name: "execRank", label: "Exec Teamwork rank", type: "number", value: t.execRank ?? "", hint: "With \"Execs get corporate coverage\" on: Execs of this rank or higher get it free. Empty: never." },
        { name: "note", label: "What it covers", type: "textarea", value: t.note }
      ]
    });
    if (!result?.name?.trim()) return;
    const id = tier ?? foundry.utils.randomID();
    await saveConfig({ tiers: { ...cfg.tiers, [id]: cleanPlan(result) } });
    this.render();
  },
  "tt-tier-add"() {
    return actions["tt-tier-edit"].call(this);
  },
  /** GM: remove a plan. Whoever is on it loses their coverage (the host tells them). */
  "tt-tier-remove"({ tier }) {
    const cfg = traumaConfig();
    const plan = cfg.tiers[tier];
    if (!plan) return;
    if (Object.keys(cfg.tiers).length <= 1) return ui.notifications.warn("Keep at least one plan.");
    const on = Object.values(store.apps.subs).filter(s => s.tier === tier && s.status !== "none").length;
    Dialog.confirm({
      title: "Trauma Team",
      content: `<p>Remove the <strong>${esc(plan.name)}</strong> plan?</p>${on ? `<p>${on} character${on === 1 ? " is" : "s are"} on it and will lose their coverage.</p>` : ""}`,
      defaultYes: false,
      yes: async () => {
        const { [tier]: gone, ...tiers } = cfg.tiers;
        await saveConfig({ tiers });
        this.render();
      }
    });
  },
  async "tt-tier-reset"() {
    await saveConfig({ tiers: null });
    this.render();
  }
};

export const dropdowns = {
  async ttTrigger(value) {
    await saveConfig({ trigger: value });
    this.render();
  }
};

export const inputs = {
  "input[data-tt-setting]": {
    async change(event) {
      const key = event.currentTarget.dataset.ttSetting;
      const el = event.currentTarget;
      await saveConfig({ [key]: el.type === "checkbox" ? el.checked : Number(el.value) });
      this.render();
    }
  },
  "input[data-tt-player]": {
    change(event) {
      const actor = this.context()?.subject?.actor;
      if (actor) store.request("tt-settings", { actorId: actor.id, [event.currentTarget.dataset.ttPlayer]: event.currentTarget.checked });
    }
  }
};

export const methods = {
  /** How far off a world-time date is: "in 12 days". */
  _dueIn(nextDue) {
    if (nextDue == null) return null;
    const days = Math.ceil((nextDue - game.time.worldTime) / 86400);
    return days <= 0 ? "due now" : `in ${days} day${days === 1 ? "" : "s"}`;
  },

  /** A combat-round ETA: "2 rounds", "next round", "now". */
  _roundsLeft(d) {
    const combat = game.combats?.get(d.combatId);
    if (!combat) return "any moment";
    const n = d.etaRound - combat.round;
    return n <= 0 ? "arriving" : n === 1 ? "1 round" : `${n} rounds`;
  },

  _dispatchRow(d) {
    const actor = game.actors.get(d.actorId);
    const left = d.eta ? d.eta - Date.now() : null;
    return {
      ...d,
      name: actor ? displayName(actor) : "?",
      tierName: d.tier ? traumaConfig().tiers[d.tier]?.name ?? d.tier : null,
      wound: d.state ? WOUND_LABELS[d.state] : "",
      hpLabel: d.hp !== null ? `HP ${d.hp}/${d.max}` : "",
      statusLabel: d.status === "enroute" && d.landing ? "AV-4 landing: stand clear of the LZ" : { pending: "Calling Dispatch…", enroute: "AV-4 inbound", arrived: "On site", closed: "Closed" }[d.status],
      isPending: d.status === "pending",
      isEnroute: d.status === "enroute",
      countdown: d.status !== "enroute" ? null : d.etaRound ? this._roundsLeft(d) : left > 0 ? formatDuration(left) : null,
      etaAt: d.status === "enroute" && !d.etaRound && left > 0 ? d.eta : null
    };
  },

  traumaData(ctx) {
    const cfg = traumaConfig();
    const dispatches = Object.values(store.apps.dispatches).sort((a, b) => b.ts - a.ts);
    if (ctx.perspective === "gm") {
      return {
        gm: true,
        bar: appBar("trauma"),
        tiers: Object.entries(cfg.tiers).map(([id, t]) => ({
          id, ...t, priceLabel: planPrice(t),
          subscribers: Object.values(store.apps.subs).filter(s => s.tier === id && s.status !== "none").length
        })),
        execRanks: Object.values(cfg.tiers).filter(t => t.execRank).sort((a, b) => a.execRank - b.execRank)
          .map(t => `${t.name} at rank ${t.execRank}`).join(", "),
        trigger: dropdown("ttTrigger", Object.entries(TRIGGERS).map(([value, label]) => ({ value, label, selected: value === cfg.trigger })), { title: "Biomonitor calls when", cls: "agent-wide" }),
        solicit: cfg.solicit,
        allowNoAds: cfg.allowNoAds,
        execAuto: cfg.execAuto,
        eta: cfg.eta,
        inCombat: !!game.combat?.started,
        open: dispatches.filter(d => d.status !== "closed").map(d => this._dispatchRow(d)),
        closed: dispatches.filter(d => d.status === "closed").slice(0, 5).map(d => this._dispatchRow(d)),
        characters: playerCharacters().map(a => {
          const sub = store.apps.subs[a.id];
          const plan = sub?.tier ? cfg.tiers[sub.tier] : null;
          return {
            id: a.id, name: displayName(a),
            coverage: plan ? `${plan.name}${sub.sponsor ? ` · ${sub.sponsor}` : ""}${sub.status === "lapsed" ? " · LAPSED" : ""}` : "None",
            due: plan && !sub.sponsor ? this._dueIn(sub.nextDue) : null,
            has: !!plan,
            exec: execTier(a, cfg.tiers) ? cfg.tiers[execTier(a, cfg.tiers)].name : null,
            biolink: !!sub?.biolink
          };
        })
      };
    }
    const actor = ctx.subject.actor;
    const sub = store.apps.subs[actor.id] ?? null;
    const plan = sub?.tier ? cfg.tiers[sub.tier] : null;
    const v = vitalsOf(actor);
    const open = dispatches.find(d => d.actorId === actor.id && d.status !== "closed");
    return {
      bar: appBar("trauma", { owner: ctx.subject.name }),
      plan: plan ? {
        name: plan.name, note: plan.note, memberId: sub.memberId, sponsor: sub.sponsor, lapsed: sub.status === "lapsed",
        active: covered(sub), price: planPrice(plan), due: sub.sponsor ? null : this._dueIn(sub.nextDue)
      } : null,
      tiers: Object.entries(cfg.tiers).map(([id, t]) => ({ id, ...t, priceLabel: planPrice(t), current: sub?.tier === id && covered(sub) })),
      canCancel: !!plan && !sub.sponsor,
      dispatch: open ? this._dispatchRow(open) : null,
      biomonitor: hasBiomonitor(actor),
      biolink: !!sub?.biolink,
      noAds: cfg.allowNoAds ? { on: !!sub?.noAds } : null,
      line: !commsOn() ? null : servicesFor(actor.id).find(s => /trauma/i.test(s.name))?.id ?? null,
      trigger: TRIGGERS[cfg.trigger],
      vitals: v ? { ...v, stateLabel: v.state ? WOUND_LABELS[v.state] : "Stable" } : null
    };
  }
};

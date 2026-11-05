import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { panToToken } from "../../scripts/ui/location.js";
import { hasBiomonitor, vitalsOf, WOUND_LABELS } from "../../scripts/model/apps.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { commsOn } from "../../scripts/model/features.js";
import { servicesFor } from "../../scripts/model/services.js";
import { currencyLabel } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { cleanPlan, consultBonus, consultLeft, consultPrice, CONSULTS, covered, execTier, medscanCover, offeredTier, planPrice, traumaBilledBy, traumaConfig, TRIGGERS } from "./model.js";
import { contentArt } from "../../scripts/model/content.js";
import { formatMoney } from "../../scripts/model/money.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { esc, formatDuration } from "../../scripts/util/text.js";

/*
 * Phone page: Trauma Team (see apps/trauma/model.js). Players see their plan, subscribe or cancel, link a
 * Biomonitor, and have the panic button. The GM sets the plans (adds, edits and removes them) and
 * rules, gives plans (a corporate plan), and handles the calls: ETA, arrived, closed.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const saveConfig = changes => patchSetting("trauma", c => Object.assign(c, changes));
const saveMedscan = changes => patchSetting("trauma", c => Object.assign(c, { medscan: { ...(c.medscan ?? {}), ...changes } }));

/** The page's two sections: MedScan (bought separately; the page opens on it), and the coverage. */
const TABS = { medscan: "MedScan", coverage: "Coverage" };
/** MedScan's picture from the content folder (model/content.js); none: the app's glyph (medscan.hbs). */
const MS_IMG = () => contentArt("apps/trauma-team-medscan.webp");

export const actions = {
  "tt-tab"({ tab }) {
    if (tab in TABS) this.ttTab = tab;
    this.render();
  },
  "ms-buy"() {
    const actor = this.context()?.subject?.actor;
    const { price } = traumaConfig().medscan;
    if (actor) Dialog.confirm({
      title: "Trauma Team MedScan",
      content: `<p>Buy <strong>MedScan</strong> for ${formatMoney(price)}? Paid now, through BangMe!.</p><p class="notes">Then call a Trauma Team specialist whenever you need one. Each consult is paid when they pick up, unless your plan includes MedScan.</p>`,
      yes: () => store.request("ms-buy", { actorId: actor.id })
    });
  },
  "ms-consult"({ kind }) {
    const actor = this.context()?.subject?.actor;
    const c = CONSULTS[kind];
    if (!actor || !c) return;
    const { price, covered: plan } = consultPrice(kind, store.apps.subs[actor.id]);
    Dialog.confirm({
      title: "Trauma Team MedScan",
      content: `<p>Call a specialist for a <strong>${esc(c.name.toLowerCase())}</strong>? ${plan ? `Covered by your ${esc(plan)} plan.` : `${formatMoney(price)}, charged when they pick up.`}</p><p class="notes">${esc(c.blurb)}</p>`,
      yes: () => store.request("ms-consult", { actorId: actor.id, kind })
    });
  },
  "ms-end"({ actorId }) {
    actorId ??= this.context()?.subject?.actor?.id;
    if (actorId) store.request("ms-end", { actorId });
  },
  "ms-answer"({ actorId, consultId, ok }) {
    store.request("ms-answer", { actorId, consultId, ok: ok === "true" || ok === true });
  },
  "ms-grant"({ actorId, owned }) {
    store.request("ms-grant", { actorId, owned: owned === "true" || owned === true });
  },
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
  /** The panic button. With no active plan (none, or lapsed) it first asks them to pay for one, then calls. */
  async "tt-call"() {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const sub = store.apps.subs[actor.id];
    if (covered(sub)) return store.request("tt-call", { actorId: actor.id });
    const { tiers } = traumaConfig();
    const lapsed = sub?.status === "lapsed" && tiers[sub.tier];
    const billed = traumaBilledBy();
    const result = await fieldsDialog({
      title: "Trauma Team: no coverage",
      label: billed ? "Subscribe and call" : "Pay and call",
      fields: [{
        name: "tier", label: "Plan", type: "select", value: lapsed ? sub.tier : offeredTier(tiers),
        options: Object.entries(tiers).map(([value, t]) => ({ value, label: `${t.name} · ${planPrice(t)}` }))
      }],
      note: `${lapsed ? "Your coverage has lapsed." : "No Trauma Team coverage on file."} ${billed ? `Subscribe now (billed by ${billed})` : "Pay the first period now, through BangMe!,"} and Dispatch takes your call.`
    });
    if (result?.tier in tiers) store.request("tt-subscribe", { actorId: actor.id, tier: result.tier, call: true });
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
        { name: "medscan", label: "MedScan consults included", type: "checkbox", value: t.medscan, hint: "Members who have the MedScan app pay nothing for consults. Canon: Executive." },
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
  "input[data-ms-setting]": {
    async change(event) {
      const el = event.currentTarget;
      await saveMedscan({ [el.dataset.msSetting]: el.type === "checkbox" ? el.checked : Number(el.value) });
      this.render();
    }
  },
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
    if (nextDue == null || traumaBilledBy()) return null;
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

  /** The tab row, and which tab is open. */
  _ttTabs(badges = {}) {
    const tab = this.ttTab in TABS ? this.ttTab : "medscan";
    return {
      tab: { [tab]: true },
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: tab === id, count: badges[id] ?? 0 }))
    };
  },

  /** A consult as the phone shows it. */
  _consultRow(consult) {
    if (!consult) return null;
    const c = CONSULTS[consult.kind];
    return {
      ...consult, name: c?.name ?? consult.kind, icon: c?.icon, bonus: c ? consultBonus(consult.kind) : "", how: c?.how ?? "",
      pending: consult.status === "pending",
      left: consult.status === "active" ? consultLeft(consult, game.time.worldTime) : null,
      paid: consult.covered ? `Covered by ${consult.covered}` : consult.price ? formatMoney(consult.price) : null
    };
  },

  /** MedScan for the GM: prices and switches, who has it, and calls. */
  _medscanGm(cfg) {
    const m = cfg.medscan;
    const rows = playerCharacters().map(a => {
      const row = store.apps.medscan[a.id];
      const plan = medscanCover(store.apps.subs[a.id], cfg);
      return { id: a.id, name: displayName(a), owned: !!row?.owned, gift: row?.source === "gm", covered: plan?.name ?? null, consult: this._consultRow(row?.consult) };
    });
    return {
      ...m, img: MS_IMG(),
      priceLabel: formatMoney(m.price),
      plans: Object.values(cfg.tiers).filter(t => t.medscan).map(t => t.name).join(", "),
      consults: Object.entries(CONSULTS).map(([id, c]) => ({ id, name: c.name, icon: c.icon, price: m[id], hours: c.hours, bonus: consultBonus(id) })),
      characters: rows,
      calls: rows.filter(r => r.consult)
    };
  },

  /** MedScan for a player: the store card until bought, then the consults. */
  _medscanPlayer(ctx, cfg) {
    const actor = ctx.subject.actor;
    const row = store.apps.medscan[actor.id];
    const sub = store.apps.subs[actor.id];
    const plan = medscanCover(sub, cfg);
    const consult = this._consultRow(row?.consult);
    return {
      img: MS_IMG(), owned: !!row?.owned, offline: !!ctx.noSignal,
      priceLabel: formatMoney(cfg.medscan.price),
      covered: plan?.name ?? null,
      unavailable: cfg.medscan.unavailable,
      consult,
      consults: Object.entries(CONSULTS).map(([id, c]) => {
        const p = consultPrice(id, sub, cfg);
        return { id, name: c.name, icon: c.icon, blurb: c.blurb, bonus: consultBonus(id), price: p.covered ? "Covered" : formatMoney(p.price) };
      }),
      history: (row?.history ?? []).map(h => ({ name: CONSULTS[h.kind]?.name ?? h.kind, paid: h.covered ? `Covered by ${h.covered}` : formatMoney(h.price) }))
    };
  },

  traumaData(ctx) {
    const cfg = traumaConfig();
    const dispatches = Object.values(store.apps.dispatches).sort((a, b) => b.ts - a.ts);
    if (ctx.perspective === "gm") {
      const medscan = this._medscanGm(cfg);
      return {
        gm: true,
        bar: appBar("trauma"),
        ...this._ttTabs({ medscan: medscan.calls.filter(c => c.consult.pending).length }),
        medscan,
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
        billedBy: traumaBilledBy(),
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
      ...this._ttTabs(),
      medscan: this._medscanPlayer(ctx, cfg),
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

export const phone = {
  /** Tapping Trauma Team again: back to its first page, MedScan. */
  retap(app) {
    if (app === "trauma") this.ttTab = null;
  }
};

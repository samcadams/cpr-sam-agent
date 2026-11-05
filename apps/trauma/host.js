import { gm } from "../../scripts/host/validate.js";
import { canUsePhone, isPlayerCharacter } from "../../scripts/model/agent.js";
import { hasBiomonitor, vitalsOf, WOUND_LABELS } from "../../scripts/model/apps.js";
import { displayName } from "../../scripts/model/threads.js";
import { billingPeriod, consultBonus, consultEffect, consultPrice, CONSULTS, covered, DAY, DOCTORS, execTier, memberId, offeredTier, periodName, planPrice, traumaBilledBy, traumaConfig } from "./model.js";
import { MODULE_ID } from "../../scripts/config.js";
import { contentArt } from "../../scripts/model/content.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: Trauma Team (see apps/trauma/model.js). Subscriptions paid monthly through BangMe (or given by
 * the GM, e.g. a corporate plan), the panic button, calls placed by a linked Biomonitor, and the
 * GM's dispatch cards.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "tt-subscribe": "_onTraumaSubscribe",
  "tt-cancel": "_onTraumaCancel",
  "tt-settings": "_onTraumaSettings",
  "tt-call": "_onTraumaCall",
  "tt-grant": gm("_onTraumaGrant"),
  "tt-revoke": gm("_onTraumaRevoke"),
  "tt-update": gm("_onTraumaUpdate"),
  "tt-dispatch": gm("_onTraumaDispatch"),
  "tt-bill": gm("_onTraumaBillNow"),
  "ms-buy": "_onMedscanBuy",
  "ms-consult": "_onMedscanConsult",
  "ms-end": "_onMedscanEnd",
  "ms-answer": gm("_onMedscanAnswer"),
  "ms-grant": gm("_onMedscanGrant")
};

const MS_FROM = "Trauma Team MedScan";
/** The consult effect's icon: MedScan's picture from the content folder (model/content.js), or Foundry's own. */
const MS_IMG = () => contentArt("apps/trauma-team-medscan.webp") ?? "icons/svg/heal.svg";

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  _playerTrauma(user, actorId) {
    const actor = game.actors.get(actorId);
    return actor && !user.isGM && owns(user, actor) ? actor : null;
  },

  /** Charge one billing period of coverage. False if they can't pay. */
  async _chargeTrauma(actor, tier) {
    const plan = traumaConfig().tiers[tier];
    if (!plan) return false;
    if (!(await this._transfer(actor, null, plan.price, `Trauma Team ${plan.name}, ${periodName(plan)}`))) return false;
    this._ledger(actor.id, -plan.price, `${plan.name} coverage, ${periodName(plan)}`, "trauma", "Trauma Team International");
    return true;
  },

  /** `call`: the panic button with no coverage: once they've paid, Dispatch takes the call. */
  async _onTraumaSubscribe(user, { actorId, tier, call }) {
    const actor = this._playerTrauma(user, actorId);
    const plan = traumaConfig().tiers[tier];
    if (!actor || !plan || !this._citinet(actor, "trauma")) return;
    if (await this._subscribe(actor, tier) && call) this._pushApps([this._ttDispatch(actor, { auto: false, reason: "Called from their Agent" })].filter(Boolean));
  },

  /** Start or renew a plan, charging the first period. True if it went through. */
  async _subscribe(actor, tier) {
    const plan = traumaConfig().tiers[tier];
    if (!plan) return false;
    const current = this.apps.subs[actor.id];
    if (current?.sponsor) {
      this._alertNow(actor.id, { kind: "trauma", from: "Trauma Team International", text: `You're already covered: ${current.sponsor}.` });
      return false;
    }
    // Billed by another module (e.g. CPR HQ's Lifestyle bill): nothing is charged here.
    const billed = traumaBilledBy();
    if (!billed && !(await this._chargeTrauma(actor, tier))) {
      this._alertNow(actor.id, { kind: "trauma", from: "Trauma Team International", text: `Payment declined. ${plan.name} coverage is ${planPrice(plan)}.` });
      return false;
    }
    this.apps.subs[actor.id] = {
      ...(current ?? {}),
      tier, memberId: current?.memberId ?? memberId(), status: "active", sponsor: null, auto: false,
      since: current?.since ?? game.time.worldTime, nextDue: billed ? null : game.time.worldTime + billingPeriod(plan)
    };
    this._pushApps([this._alert(actor.id, { kind: "trauma", from: "Trauma Team International", text: `Welcome to ${plan.name} coverage. Member ${this.apps.subs[actor.id].memberId}. We'll be there.` })]);
    return true;
  },

  _onTraumaCancel(user, { actorId }) {
    const actor = this._playerTrauma(user, actorId);
    const sub = actor ? this.apps.subs[actor.id] : null;
    if (!sub || sub.sponsor) return;
    delete this.apps.subs[actor.id];
    this._pushApps([this._alert(actor.id, { kind: "trauma", from: "Trauma Team International", text: "Coverage cancelled. We hope you never need us." })]);
  },

  /** A player's switches: the biomonitor link, and no more TT offers. */
  _onTraumaSettings(user, { actorId, biolink, noAds }) {
    const actor = this._playerTrauma(user, actorId);
    if (!actor) return;
    const sub = (this.apps.subs[actor.id] ??= { tier: null, status: "none" });
    if (biolink !== undefined) sub.biolink = !!biolink && hasBiomonitor(actor);
    if (noAds !== undefined) sub.noAds = !!noAds;
    this._pushApps();
  },

  /** GM: give a plan that's never billed (a corporate plan, a favour, a contract). */
  _onTraumaGrant(user, { actorId, tier, sponsor }) {
    const actor = game.actors.get(actorId);
    const plan = traumaConfig().tiers[tier];
    if (!actor || !plan) return;
    const current = this.apps.subs[actor.id] ?? {};
    this.apps.subs[actor.id] = {
      ...current, tier, memberId: current.memberId ?? memberId(), status: "active",
      sponsor: clean(sponsor, 60) || "Sponsored", auto: false, since: current.since ?? game.time.worldTime, nextDue: null
    };
    this._pushApps([this._alert(actor.id, { kind: "trauma", from: "Trauma Team International", text: `${plan.name} coverage activated, courtesy of ${this.apps.subs[actor.id].sponsor}.` })]);
  },

  _onTraumaRevoke(user, { actorId }) {
    const sub = this.apps.subs[actorId];
    if (!sub) return;
    this.apps.subs[actorId] = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
    this._pushApps([this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: "Your coverage has ended." })]);
  },

  /**
   * GM (the API's trauma.update): change any part of a subscription; only what's given changes.
   * status "none" ends it (keeping the player's switches). Active and billed: due a period from now
   * unless `nextDue` says when. Sponsored: never billed. Nothing is charged; `notify` is an Agent alert.
   */
  _onTraumaUpdate(user, { actorId, tier, status, sponsor, nextDue, biolink, noAds, notify }) {
    const actor = game.actors.get(actorId);
    const tiers = traumaConfig().tiers;
    if (!actor || (tier != null && !tiers[tier]) || (status !== undefined && !["active", "lapsed", "none"].includes(status))) return;
    const old = this.apps.subs[actorId];
    let sub = { tier: null, status: "none", ...(old ?? {}) };
    if (tier !== undefined) sub.tier = tier;
    if (status !== undefined) sub.status = status;
    if (sponsor !== undefined) Object.assign(sub, { sponsor: clean(sponsor, 60) || null, auto: false });
    if (biolink !== undefined) sub.biolink = !!biolink && hasBiomonitor(actor);
    if (noAds !== undefined) sub.noAds = !!noAds;
    if (sub.status === "none" || !sub.tier) {
      sub = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
    } else {
      sub.memberId ??= memberId();
      sub.since ??= game.time.worldTime;
      if (sub.sponsor) sub.nextDue = null;
      else if (nextDue != null && Number.isFinite(Number(nextDue))) sub.nextDue = Number(nextDue);
      else if (traumaBilledBy()) sub.nextDue = null;
      else sub.nextDue ??= game.time.worldTime + billingPeriod(tiers[sub.tier]);
    }
    this.apps.subs[actorId] = sub;
    const text = clean(notify, 300);
    this._pushApps(text ? [this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text })] : []);
  },

  /**
   * Execs: the corporate plan their Teamwork rank earns (when the GM has that on). Given and taken
   * away as the rank changes; a plan the GM gave by hand is left alone. Returns the alert id (unsent), or null.
   */
  _applyExecCoverage(actor) {
    if (!traumaConfig().execAuto || !isPlayerCharacter(actor)) return null;
    const tier = execTier(actor);
    const sub = this.apps.subs[actor.id];
    if (sub?.sponsor && !sub.auto) return null;
    const tell = text => this._alert(actor.id, { kind: "trauma", from: "Trauma Team International", text });
    if (tier && (sub?.tier !== tier || !sub.auto)) {
      this.apps.subs[actor.id] = {
        ...(sub ?? {}), tier, memberId: sub?.memberId ?? memberId(), status: "active", sponsor: "Corporate plan (Teamwork)", auto: true,
        since: sub?.since ?? game.time.worldTime, nextDue: null
      };
      return tell(`Corporate plan: ${traumaConfig().tiers[tier]?.name ?? tier} coverage activated (Teamwork).`);
    }
    if (!tier && sub?.auto) {
      this.apps.subs[actor.id] = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
      return tell("Your Teamwork corporate plan has ended.");
    }
    return null;
  },

  /** A role changed: apply and send the corporate plan, with its alert. */
  _pushExecCoverage(actor) {
    const id = this._applyExecCoverage(actor);
    if (id) this._pushApps([id]);
  },

  /**
   * AV-4s whose ETA has come (real time, or their combat's round): the player is told to stand clear of
   * the LZ, and the GM gets a card to mark them arrived. Runs on the clock, on round changes and at
   * the ETA itself.
   */
  _traumaArrivals() {
    const ids = [];
    for (const d of Object.values(this.apps.dispatches)) {
      if (d.status !== "enroute" || d.landing) continue;
      const combat = d.combatId ? game.combats?.get(d.combatId) : null;
      const due = d.combatId ? !combat || combat.round >= d.etaRound : d.eta && Date.now() >= d.eta;
      if (due) ids.push(this._traumaArrive(d));
    }
    if (ids.length) this._pushApps(ids);
  },

  /** The AV-4 is here: returns the player's alert id. */
  _traumaArrive(d) {
    d.landing = true;
    const actor = game.actors.get(d.actorId);
    this._gmCard({
      id: `tt-land:${d.id}`, urgent: true, title: `TRAUMA TEAM: AV-4 arriving`, body: `${displayName(actor)}: the team is landing.`, icon: "fa-helicopter",
      actions: [
        { label: "On site", icon: "fa-truck-medical", request: "tt-dispatch", data: { dispatchId: d.id, status: "arrived" } },
        { label: "Show", icon: "fa-location-crosshairs", pan: { sceneId: d.sceneId, tokenId: d.tokenId } }
      ]
    });
    return this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: "AV-4 arriving. STAND CLEAR OF THE LZ." });
  },

  /* ---------------- Billing (world time) ---------------- */

  async _tickTrauma() {
    this._traumaArrivals();
    const exec = game.actors.filter(isPlayerCharacter).map(a => this._applyExecCoverage(a)).filter(Boolean);
    const ids = [...exec, ...(await this._medscanExpire())];
    let changed = ids.length > 0;
    const { tiers } = traumaConfig();
    for (const [actorId, sub] of Object.entries(this.apps.subs)) {
      if (sub.tier && !tiers[sub.tier]) {
        // The GM removed their plan.
        this.apps.subs[actorId] = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: "Your plan has been discontinued. Your coverage has ended." }));
        changed = true;
        continue;
      }
      if (traumaBilledBy() || sub.status !== "active" || sub.sponsor) continue;
      if (sub.nextDue == null) {
        // Billing handed back by another module: the Agent bills from a period from now.
        sub.nextDue = game.time.worldTime + billingPeriod(tiers[sub.tier]);
        changed = true;
        continue;
      }
      const plan = tiers[sub.tier];
      if (game.time.worldTime < sub.nextDue) {
        // A day before the bill (plans billed less often than daily), once per bill.
        if (plan.days > 1 && sub.warned !== sub.nextDue && sub.nextDue - game.time.worldTime <= DAY) {
          sub.warned = sub.nextDue;
          ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: `Reminder: ${plan.name} coverage, ${planPrice(plan)}, is billed tomorrow.` }));
          changed = true;
        }
        continue;
      }
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      changed = true;
      if (await this._chargeTrauma(actor, sub.tier)) {
        sub.nextDue += billingPeriod(plan);
        const next = plan.days === 1 ? "tomorrow" : `in ${plan.days} days`;
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: `Payment received: ${plan.name} coverage, ${planPrice(plan)}. Next payment ${next}.` }));
      } else {
        sub.status = "lapsed";
        this._gmCard({ id: `tt-lapse:${actorId}`, title: "Trauma Team: plan lapsed", body: `${displayName(actor)} couldn't pay for ${plan.name} coverage. It has lapsed.`, icon: "fa-truck-medical", open: { app: "trauma" } });
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: "Payment failed. Your coverage has lapsed.", choices: ["Pay now", "Later"], ref: { type: "tt-offer", tier: sub.tier } }));
      }
    }
    if (changed) this._pushApps(ids);
  },

  /** GM: "It's the 1st": bill every paid plan now. */
  async _onTraumaBillNow() {
    if (traumaBilledBy()) return; // another module bills
    for (const sub of Object.values(this.apps.subs)) if (sub.status === "active" && !sub.sponsor) sub.nextDue = game.time.worldTime;
    await this._tickTrauma();
  },

  /* ---------------- Calls ---------------- */

  /** The panic button. */
  /** The panic button; or the GM (a macro, api.js) calling for a character. */
  _onTraumaCall(user, { actorId, reason }) {
    const actor = user.isGM ? game.actors.get(actorId) : this._playerTrauma(user, actorId);
    if (!actor || !(user.isGM ? canUsePhone(actor) : this._citinet(actor, "trauma"))) return;
    reason = user.isGM ? clean(reason, 120) || "Called by the GM" : "Called from their Agent";
    // One open call at a time: a second press is answered, not ignored.
    const id = this._ttDispatch(actor, { auto: false, reason })
      ?? this._alert(actor.id, { kind: "trauma", from: "Trauma Team Dispatch", text: "Dispatch already has your call." });
    this._pushApps([id].filter(Boolean));
  },

  /**
   * Open a dispatch for a character and send the GM a card. Returns the alert id for the character,
   * or null (one open call at a time).
   */
  _ttDispatch(actor, { auto, reason }) {
    const open = Object.values(this.apps.dispatches).find(d => d.actorId === actor.id && d.status !== "closed");
    if (open) return null;
    const sub = this.apps.subs[actor.id];
    const v = vitalsOf(actor);
    const token = actor.getActiveTokens?.()[0]?.document ?? game.scenes.active?.tokens.find(t => t.actorId === actor.id) ?? null;
    const id = foundry.utils.randomID();
    const { time } = agentTimestamp();
    const lapsed = sub?.status === "lapsed";
    this.apps.dispatches[id] = {
      id, actorId: actor.id, status: "pending", auto, reason, tier: sub?.tier ?? null, covered: covered(sub), lapsed,
      hp: v?.hp ?? null, max: v?.max ?? null, state: v?.state ?? null,
      sceneId: token?.parent?.id ?? null, tokenId: token?.id ?? null, eta: null, ts: Date.now(), time
    };
    const plan = sub?.tier ? traumaConfig().tiers[sub.tier]?.name : null;
    const coverage = covered(sub) ? `${plan}${sub.sponsor ? ` (${sub.sponsor})` : ""}` : lapsed && plan ? `${plan}, LAPSED` : "No coverage";
    this._gmCard({
      id: `tt:${id}`, urgent: true, title: `TRAUMA TEAM: ${displayName(actor)}`,
      body: `${auto ? "Biomonitor call" : "Panic button"} · ${this._woundText(v)} · ${coverage}`,
      icon: "fa-truck-medical",
      actions: [
        { label: "Dispatch", icon: "fa-truck-medical", request: "tt-dispatch", data: { dispatchId: id, status: "enroute" } },
        { label: "Show", icon: "fa-location-crosshairs", pan: { sceneId: token?.parent?.id, tokenId: token?.id } }
      ]
    });
    const text = !covered(sub)
      ? lapsed ? "Trauma Team Dispatch: coverage lapsed. Upgrade now?" : "Trauma Team Dispatch: no coverage on file. Subscribe now?"
      : auto ? "TRAUMA TEAM NOTIFIED. Your biomonitor called Dispatch. Hold on." : "Trauma Team Dispatch has your call. Stay where you are.";
    const choices = covered(sub) ? [] : ["Subscribe", "Not now"];
    return this._alert(actor.id, { kind: "trauma", from: "Trauma Team Dispatch", text, choices, ref: covered(sub) ? null : { type: "tt-offer", tier: sub?.tier ?? offeredTier() } });
  },

  /**
   * GM: set the ETA (AV-4 inbound), mark the team arrived, or close the call. The ETA is in real
   * minutes, or in combat rounds (unit "rounds", while a combat is running): it counts down as the
   * combat's rounds go by.
   */
  _onTraumaDispatch(user, { dispatchId, status, eta, unit }) {
    const d = this.apps.dispatches[dispatchId];
    if (!d || !["enroute", "arrived", "closed"].includes(status)) return;
    const was = d.status;
    d.status = status;
    const ids = [];
    if (status === "closed" && was !== "closed") ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: "Call closed." }));
    if (status === "enroute") {
      const n = Math.max(0, Number(eta ?? traumaConfig().eta) || 0);
      const combat = unit === "rounds" ? game.combat : null;
      if (combat?.started) {
        Object.assign(d, { eta: null, combatId: combat.id, etaRound: combat.round + n });
        if (n === 0) ids.push(this._traumaArrive(d));
        else ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: `AV-4 inbound. ETA ${n} round${n === 1 ? "" : "s"}.` }));
      } else {
        Object.assign(d, { eta: Date.now() + n * 60_000, combatId: null, etaRound: null });
        // Right on time, rather than at the next tick of the clock.
        // (It doesn't hold the process open: node tests.)
        setTimeout(() => this._enqueue(() => this._traumaArrivals()), n * 60_000 + 50)?.unref?.();
        // ETA 0: the arrival alert follows at once, so no "inbound" before it.
        if (n > 0) ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: `AV-4 inbound. ETA ${n} minute${n === 1 ? "" : "s"}.` }));
      }
    } else if (status === "arrived") {
      ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: "Trauma Team on site." }));
    }
    // Keep the last few closed calls for the GM's log.
    const closed = Object.values(this.apps.dispatches).filter(x => x.status === "closed").sort((a, b) => b.ts - a.ts);
    for (const old of closed.slice(20)) delete this.apps.dispatches[old.id];
    this._pushApps(ids);
  },

  /** The answer to a TT offer ("Subscribe" / "Pay now"). */
  async _answerTraumaOffer(alert, choice) {
    if (!["Subscribe", "Pay now"].includes(choice)) return;
    const actor = game.actors.get(alert.actorId);
    const { tiers } = traumaConfig();
    const tier = tiers[alert.ref.tier] ? alert.ref.tier : offeredTier(tiers);
    if (actor && tier) await this._subscribe(actor, tier);
  },

  /**
   * Health changed (apps/agent/host.js _onHealth): a linked biomonitor may call Trauma Team, and TT may
   * try to sell coverage to someone bleeding without it. Returns alert ids.
   */
  _traumaHealth(actor, before, now) {
    const cfg = traumaConfig();
    const sub = this.apps.subs[actor.id];
    const ids = [];
    const crossed = {
      belowBody: now.body !== null && before.hp >= now.body && now.hp < now.body,
      serious: !before.state && !!now.state,
      mortal: before.state !== "mortal" && now.state === "mortal"
    }[cfg.trigger];
    if (crossed && sub?.biolink && sub.tier && hasBiomonitor(actor)) {
      ids.push(this._ttDispatch(actor, { auto: true, reason: `Biomonitor: ${now.state ? WOUND_LABELS[now.state] : "HP below BODY"}` }));
    }
    const refused = cfg.allowNoAds && sub?.noAds;
    if (cfg.solicit && !covered(sub) && !refused && !before.state && now.state) {
      const tier = offeredTier(cfg.tiers);
      const plan = cfg.tiers[tier];
      if (plan) ids.push(this._alert(actor.id, {
        kind: "trauma", from: "Trauma Team International",
        text: `We noticed you're bleeding. ${plan.name} coverage from ${planPrice(plan)}.`,
        choices: ["Subscribe", "Not now"], ref: { type: "tt-offer", tier }
      }));
    }
    return ids;
  },

  /** A new Critical Injury (main.js, createItem): the biomonitor calls, if that's the trigger. */
  _onCriticalInjury(actor) {
    const sub = this.apps.subs[actor.id];
    if (traumaConfig().trigger !== "critical" || !sub?.biolink || !sub.tier || !hasBiomonitor(actor)) return;
    const id = this._ttDispatch(actor, { auto: true, reason: "Biomonitor: Critical Injury" });
    if (id) this._pushApps([id]);
  },

  /* ---------------- MedScan (model.js) ---------------- */

  /** A player's own character with their Agent on them and a signal (MedScan is on the CitiNet). */
  _medscanActor(user, actorId) {
    const actor = this._playerTrauma(user, actorId);
    return actor && this._citinet(actor, "trauma", MS_FROM) ? actor : null;
  },

  _medscanRow(actorId) {
    return (this.apps.medscan[actorId] ??= { owned: false, consult: null, history: [] });
  },

  /** Charge through BangMe!, with a ledger line; true for free or no wallet. False if declined (they're told). */
  async _medscanCharge(actor, amount, memo) {
    if (!amount || !hasWallet(actor)) return true;
    if (!(await this._transfer(actor, null, amount, `${MS_FROM}: ${memo}`))) {
      this._alertNow(actor.id, { kind: "money", from: MS_FROM, app: "trauma", text: `Payment declined: ${memo} is ${formatMoney(amount)}.` });
      return false;
    }
    this._ledger(actor.id, -amount, memo, "medscan", MS_FROM);
    return true;
  },

  /** Buy the app (once). */
  async _onMedscanBuy(user, { actorId }) {
    const actor = this._medscanActor(user, actorId);
    if (!actor || this.apps.medscan[actorId]?.owned) return;
    const { price } = traumaConfig().medscan;
    if (!(await this._medscanCharge(actor, price, "MedScan app"))) return;
    Object.assign(this._medscanRow(actorId), { owned: true, source: "bought", since: game.time.worldTime });
    this._pushApps([this._alert(actorId, { kind: "trauma", from: MS_FROM, text: "MedScan installed. A Trauma Team specialist is a call away." })]);
  },

  /** GM: give the app (free) or take it away (ending any consult). */
  async _onMedscanGrant(user, { actorId, owned }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const row = this._medscanRow(actorId);
    if (owned) {
      if (row.owned) return;
      Object.assign(row, { owned: true, source: "gm", since: game.time.worldTime });
      return this._pushApps([this._alert(actorId, { kind: "trauma", from: MS_FROM, text: "MedScan installed on your Agent." })]);
    }
    await this._medscanStop(actor);
    row.owned = false;
    this._pushApps([this._alert(actorId, { kind: "trauma", from: MS_FROM, text: "MedScan has been removed from your Agent." })]);
  },

  /**
   * Call a specialist. The GM may answer every call (Connect / Unavailable on a card), or no specialist
   * takes calls at all; otherwise one picks up at once. Paid when the specialist connects.
   */
  async _onMedscanConsult(user, { actorId, kind }) {
    const actor = this._medscanActor(user, actorId);
    const row = this.apps.medscan[actorId];
    if (!actor || !CONSULTS[kind] || !row?.owned || row.consult) return;
    const cfg = traumaConfig();
    if (cfg.medscan.unavailable) {
      return this._alertNow(actorId, { kind: "trauma", from: MS_FROM, text: "All our specialists are busy. Please try again later." });
    }
    const consult = { id: foundry.utils.randomID(), kind, status: "pending", asked: game.time.worldTime };
    row.consult = consult;
    if (!cfg.medscan.live) return this._medscanConnect(actor, consult);
    const { price, covered } = consultPrice(kind, this.apps.subs[actorId], cfg);
    this._gmCard({
      id: `ms:${consult.id}`, title: `MEDSCAN: ${displayName(actor)}`, icon: "fa-user-doctor",
      body: `${CONSULTS[kind].name} · ${covered ? `covered by ${covered}` : formatMoney(price)}`,
      actions: [
        { label: "Connect", icon: "fa-phone", request: "ms-answer", data: { actorId, consultId: consult.id, ok: true } },
        { label: "Unavailable", icon: "fa-phone-slash", request: "ms-answer", data: { actorId, consultId: consult.id, ok: false } }
      ]
    });
    this._pushApps();
  },

  /** GM: a waiting call picked up (paid now), or no specialist free. */
  async _onMedscanAnswer(user, { actorId, consultId, ok }) {
    const actor = game.actors.get(actorId);
    const consult = this.apps.medscan[actorId]?.consult;
    if (!actor || consult?.id !== consultId || consult.status !== "pending") return;
    this._gmCardDone(`ms:${consult.id}`);
    if (ok) return this._medscanConnect(actor, consult);
    this.apps.medscan[actorId].consult = null;
    this._pushApps([this._alert(actorId, { kind: "trauma", from: MS_FROM, text: "No specialist is available right now. You haven't been charged." })]);
  },

  /** A specialist picks up: charge (or the plan covers it), then the +1 goes on the caller's sheet. */
  async _medscanConnect(actor, consult) {
    const row = this.apps.medscan[actor.id];
    const c = CONSULTS[consult.kind];
    const { price, covered } = consultPrice(consult.kind, this.apps.subs[actor.id]);
    if (!(await this._medscanCharge(actor, price, c.name))) {
      row.consult = null;
      return this._pushApps();
    }
    if (covered) this._ledger(actor.id, 0, `${c.name}: covered by ${covered}`, "medscan", MS_FROM);
    const start = game.time.worldTime;
    const doctor = DOCTORS[Math.floor(Math.random() * DOCTORS.length)];
    Object.assign(consult, { status: "active", doctor, start, until: start + c.hours * 3600, price, covered });
    try {
      const [effect] = (await actor.createEmbeddedDocuments?.("ActiveEffect", [{ ...consultEffect(consult.kind, { consultId: consult.id, doctor, start, img: MS_IMG() }), origin: actor.uuid }])) ?? [];
      consult.effectId = effect?.id ?? null;
    } catch (err) {
      console.error(`${MODULE_ID} | MedScan: couldn't add the consult's effect`, err);
    }
    row.history = [{ kind: consult.kind, at: start, price, covered }, ...(row.history ?? [])].slice(0, 5);
    this._pushApps([this._alert(actor.id, {
      kind: "trauma", from: MS_FROM,
      text: `${doctor} is on the line. ${consultBonus(consult.kind)} for ${c.hours === 1 ? "the next hour" : `the next ${c.hours} hours`}: ${c.how}.${covered ? ` Covered by your ${covered} plan.` : ""}`
    })]);
  },

  /** Take a consult's effect off the sheet and clear it. */
  async _medscanStop(actor) {
    const row = this.apps.medscan[actor.id];
    if (!row?.consult) return;
    row.consult = null;
    const ids = [...(actor.effects ?? [])].filter(e => e.flags?.[MODULE_ID]?.medscan).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments?.("ActiveEffect", ids).catch(err => console.error(`${MODULE_ID} | MedScan`, err));
  },

  /** Hang up (the player or the GM). */
  async _onMedscanEnd(user, { actorId }) {
    const actor = user.isGM ? game.actors.get(actorId) : this._playerTrauma(user, actorId);
    const consult = this.apps.medscan[actorId]?.consult;
    if (!actor || !consult) return;
    // Hung up while waiting: the GM's Connect card goes too.
    if (consult.status === "pending") this._gmCardDone(`ms:${consult.id}`);
    await this._medscanStop(actor);
    this._pushApps([this._alert(actorId, { kind: "trauma", from: MS_FROM, text: "Consult ended. Thank you for choosing Trauma Team." })]);
  },

  /** On the clock: consults whose time is up end, and their +1 comes off. Returns alert ids. */
  async _medscanExpire() {
    const ids = [];
    for (const [actorId, row] of Object.entries(this.apps.medscan)) {
      const consult = row?.consult;
      if (consult?.status !== "active" || game.time.worldTime < consult.until) continue;
      const actor = game.actors.get(actorId);
      if (actor) await this._medscanStop(actor);
      else row.consult = null;
      ids.push(this._alert(actorId, { kind: "trauma", from: MS_FROM, text: `${consult.doctor ?? "The specialist"} has left the call. Your ${CONSULTS[consult.kind]?.name.toLowerCase() ?? "consult"} has ended.` }));
    }
    return ids;
  }
};

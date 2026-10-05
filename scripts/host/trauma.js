import { gm } from "./validate.js";
import { canUsePhone, isPlayerCharacter } from "../model/agent.js";
import { hasBiomonitor, vitalsOf, WOUND_LABELS } from "../model/apps.js";
import { displayName } from "../model/threads.js";
import { billingPeriod, covered, execTier, memberId, offeredTier, periodName, planPrice, traumaConfig } from "../model/trauma.js";
import { agentTimestamp } from "../util/agentTime.js";
import { clean } from "../util/text.js";

/*
 * Host: Trauma Team (see model/trauma.js). Subscriptions paid monthly through BangMe (or given by
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
  "tt-dispatch": gm("_onTraumaDispatch"),
  "tt-bill": gm("_onTraumaBillNow")
};

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

  async _onTraumaSubscribe(user, { actorId, tier }) {
    const actor = this._playerTrauma(user, actorId);
    const plan = traumaConfig().tiers[tier];
    if (!actor || !plan || !canUsePhone(actor)) return;
    await this._subscribe(actor, tier);
  },

  async _subscribe(actor, tier) {
    const plan = traumaConfig().tiers[tier];
    if (!plan) return;
    const current = this.apps.subs[actor.id];
    if (current?.sponsor) return this._alertNow(actor.id, { kind: "trauma", from: "Trauma Team International", text: `You're already covered: ${current.sponsor}.` });
    if (!(await this._chargeTrauma(actor, tier))) {
      return this._alertNow(actor.id, { kind: "trauma", from: "Trauma Team International", text: `Payment declined. ${plan.name} coverage is ${planPrice(plan)}.` });
    }
    this.apps.subs[actor.id] = {
      ...(current ?? {}),
      tier, memberId: current?.memberId ?? memberId(), status: "active", sponsor: null, auto: false,
      since: current?.since ?? game.time.worldTime, nextDue: game.time.worldTime + billingPeriod(plan)
    };
    this._pushApps([this._alert(actor.id, { kind: "trauma", from: "Trauma Team International", text: `Welcome to ${plan.name} coverage. Member ${this.apps.subs[actor.id].memberId}. We'll be there.` })]);
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
   * Execs: the corporate plan their Teamwork rank earns (when the GM has that on). Given and taken
   * away as the rank changes; a plan the GM gave by hand is left alone.
   */
  _applyExecCoverage(actor) {
    if (!traumaConfig().execAuto || !isPlayerCharacter(actor)) return false;
    const tier = execTier(actor);
    const sub = this.apps.subs[actor.id];
    if (sub?.sponsor && !sub.auto) return false;
    if (tier && (sub?.tier !== tier || !sub.auto)) {
      this.apps.subs[actor.id] = {
        ...(sub ?? {}), tier, memberId: sub?.memberId ?? memberId(), status: "active", sponsor: "Corporate plan (Teamwork)", auto: true,
        since: sub?.since ?? game.time.worldTime, nextDue: null
      };
      return true;
    }
    if (!tier && sub?.auto) {
      this.apps.subs[actor.id] = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
      return true;
    }
    return false;
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
    let changed = game.actors.filter(isPlayerCharacter).map(a => this._applyExecCoverage(a)).some(Boolean);
    const ids = [];
    const { tiers } = traumaConfig();
    for (const [actorId, sub] of Object.entries(this.apps.subs)) {
      if (sub.tier && !tiers[sub.tier]) {
        // The GM removed their plan.
        this.apps.subs[actorId] = { biolink: sub.biolink, noAds: sub.noAds, tier: null, status: "none" };
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: "Your plan has been discontinued. Your coverage has ended." }));
        changed = true;
        continue;
      }
      if (sub.status !== "active" || sub.sponsor || sub.nextDue == null || game.time.worldTime < sub.nextDue) continue;
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      changed = true;
      const plan = tiers[sub.tier];
      if (await this._chargeTrauma(actor, sub.tier)) {
        sub.nextDue += billingPeriod(plan);
        const next = plan.days === 1 ? "tomorrow" : `in ${plan.days} days`;
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: `Payment received: ${plan.name} coverage, ${planPrice(plan)}. Next payment ${next}.` }));
      } else {
        sub.status = "lapsed";
        ids.push(this._alert(actorId, { kind: "trauma", from: "Trauma Team International", text: "Payment failed. Your coverage has lapsed.", choices: ["Pay now", "Later"], ref: { type: "tt-offer", tier: sub.tier } }));
      }
    }
    if (changed) this._pushApps(ids);
  },

  /** GM: "It's the 1st": bill every paid plan now. */
  async _onTraumaBillNow() {
    for (const sub of Object.values(this.apps.subs)) if (sub.status === "active" && !sub.sponsor) sub.nextDue = game.time.worldTime;
    await this._tickTrauma();
  },

  /* ---------------- Calls ---------------- */

  /** The panic button. */
  /** The panic button; or the GM (a macro, api.js) calling for a character. */
  _onTraumaCall(user, { actorId, reason }) {
    const actor = user.isGM ? game.actors.get(actorId) : this._playerTrauma(user, actorId);
    if (!actor || !canUsePhone(actor)) return;
    reason = user.isGM ? clean(reason, 120) || "Called by the GM" : "Called from their Agent";
    this._pushApps([this._ttDispatch(actor, { auto: false, reason })].filter(Boolean));
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
    d.status = status;
    const ids = [];
    if (status === "enroute") {
      const n = Math.max(0, Number(eta ?? traumaConfig().eta) || 0);
      const combat = unit === "rounds" ? game.combat : null;
      if (combat?.started) {
        Object.assign(d, { eta: null, combatId: combat.id, etaRound: combat.round + n });
        if (n === 0) ids.push(this._traumaArrive(d));
        ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: `AV-4 inbound. ETA ${n} round${n === 1 ? "" : "s"}.` }));
      } else {
        Object.assign(d, { eta: Date.now() + n * 60_000, combatId: null, etaRound: null });
        // Right on time, rather than at the next tick of the clock.
        // (It doesn't hold the process open: node tests.)
        setTimeout(() => this._enqueue(() => this._traumaArrivals()), n * 60_000 + 50)?.unref?.();
        ids.push(this._alert(d.actorId, { kind: "trauma", from: "Trauma Team Dispatch", text: `AV-4 inbound. ETA ${n} minute${n === 1 ? "" : "s"}.` }));
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
   * Health changed (host/agent.js _onHealth): a linked biomonitor may call Trauma Team, and TT may
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
  }
};

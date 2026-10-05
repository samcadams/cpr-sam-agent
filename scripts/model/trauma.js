import { MODULE_ID } from "../config.js";
import { formatMoney } from "./money.js";

/*
 * Trauma Team coverage. The GM's settings are the world setting "trauma" (set in the Trauma Team
 * app on the GM Phone), merged over TRAUMA_DEFAULTS. The GM's plans replace the default ones.
 *
 * Plan (tiers[id]): { name, price, days (billed every this many days of world time), execRank (the Exec
 *   Teamwork rank that earns it as corporate coverage, or null), note (what it covers) }
 *
 * Sub (apps.subs[actorId]): { tier (a plan id), memberId, status: "active"|"lapsed", sponsor: string|null,
 *   auto: bool (given by the Exec rule), since, nextDue (world time, seconds), biolink: bool, noAds: bool }
 *   A sponsored plan (sponsor set: the GM gave it, e.g. a corporate plan) is never billed.
 * Dispatch (apps.dispatches[id]): { id, actorId, status: "pending"|"enroute"|"arrived"|"closed",
 *   auto: bool (the biomonitor called), reason, tier|null, lapsed: bool, hp, max, state, sceneId, tokenId,
 *   eta: real-time ms when the AV-4 arrives, or combatId + etaRound (a round of that combat), ts, time }
 *   When the ETA comes, the player is told to stand clear of the LZ and the GM gets a card.
 */

/**
 * Plans, from the Cyberpunk Wiki's summary of Cyberpunk RED (2045): Silver 500eb a month, surgery
 * charged at hospital rates; Executive 1,000eb a month, surgery included. Execs get Silver at
 * Teamwork rank 6 and Executive at rank 8. The GM can change, add and remove plans.
 */
export const TRAUMA_DEFAULTS = {
  tiers: {
    silver: { name: "Silver", price: 500, days: 30, execRank: 6, note: "Surgery is charged at what a hospital would charge. Decline it and the team does all it can as paramedics, then drops you at a hospital." },
    executive: { name: "Executive", price: 1000, days: 30, execRank: 8, note: "Everything in Silver, and surgery at no extra cost." }
  },
  // What makes a linked biomonitor call on its own: HP below BODY, a wound state, a new Critical
  // Injury, or nothing (the player presses the button).
  trigger: "belowBody",
  solicit: false, // TT texts characters without coverage once they're badly hurt
  allowNoAds: true, // players may turn those offers off
  execAuto: false, // Execs' corporate coverage: the plan their Teamwork rank earns (see execRank)
  eta: 5 // minutes the GM's ETA starts at
};

export const TRIGGERS = {
  belowBody: "HP drops below BODY",
  serious: "Seriously Wounded (below half HP)",
  mortal: "Mortally Wounded (below 1 HP)",
  critical: "A new Critical Injury",
  manual: "Never: only the panic button"
};

const DAY = 86400;

/** A month of world time (30 days): the default billing period. */
export const MONTH = 30 * DAY;

/** A plan as the GM wrote it, with every field in range. */
export function cleanPlan(plan = {}) {
  const rank = Math.floor(Number(plan.execRank));
  return {
    name: String(plan.name ?? "").trim().slice(0, 40) || "Plan",
    price: Math.max(0, Math.floor(Number(plan.price)) || 0),
    days: Math.min(3650, Math.max(1, Math.floor(Number(plan.days)) || 30)),
    execRank: rank >= 1 && rank <= 10 ? rank : null,
    note: String(plan.note ?? "").trim().slice(0, 500)
  };
}

export function traumaConfig() {
  const saved = game.settings.get(MODULE_ID, "trauma") ?? {};
  const tiers = saved.tiers && Object.keys(saved.tiers).length ? saved.tiers : TRAUMA_DEFAULTS.tiers;
  return {
    ...TRAUMA_DEFAULTS,
    ...saved,
    tiers: Object.fromEntries(Object.entries(tiers).map(([id, plan]) => [id, cleanPlan(plan)]))
  };
}

/** How long a plan's billing period is, in world time (seconds). */
export const billingPeriod = plan => (plan?.days ?? 30) * DAY;

/** "500eb/mo", "100eb/wk", "50eb/day", "900eb every 90 days". */
export function planPrice(plan) {
  const per = { 1: "/day", 7: "/wk", 30: "/mo" }[plan.days];
  return per ? `${formatMoney(plan.price)}${per}` : `${formatMoney(plan.price)} every ${plan.days} days`;
}

/** One billing period in words, for the ledger: "one month", "7 days". */
export const periodName = plan => (plan.days === 30 ? "one month" : plan.days === 1 ? "one day" : `${plan.days} days`);

/** The plan offered to people without one (sales offers): the cheapest. */
export function offeredTier(tiers = traumaConfig().tiers) {
  return Object.entries(tiers).sort(([, a], [, b]) => a.price - b.price)[0]?.[0] ?? null;
}

/** A new member number, e.g. "TT-4821-0937". */
export const memberId = () => `TT-${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}-${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;

/**
 * The corporate plan an Exec's Teamwork rank earns: of the plans with an Exec rank, the one with the
 * highest rank they've reached. Null if none. Reads the Cyberpunk RED "role" item named Exec.
 */
export function execTier(actor, tiers = traumaConfig().tiers) {
  const role = [...(actor?.items ?? [])].find(i => i.type === "role" && /^exec/i.test(i.name));
  const rank = Number(role?.system?.rank ?? 0);
  const earned = Object.entries(tiers).filter(([, t]) => t.execRank && t.execRank <= rank);
  return earned.sort(([, a], [, b]) => b.execRank - a.execRank)[0]?.[0] ?? null;
}

/** Covered: an active plan that still exists (the GM may have removed it). */
export const covered = sub => sub?.status === "active" && !!traumaConfig().tiers[sub.tier];

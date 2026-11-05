import { MODULE_ID } from "../../scripts/config.js";
import { formatMoney } from "../../scripts/model/money.js";

/*
 * Trauma Team coverage. The GM's settings are the world setting "trauma" (set in the Trauma Team
 * app on the GM Phone), merged over TRAUMA_DEFAULTS. The GM's plans replace the default ones.
 *
 * Plan (tiers[id]): { name, price, days (billed every this many days of world time), execRank (the Exec
 *   Teamwork rank that earns it as corporate coverage, or null), medscan (MedScan consults included),
 *   note (what it covers) }
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
    silver: { name: "Silver", price: 500, days: 30, execRank: 6, medscan: false, note: "Surgery is charged at what a hospital would charge. Decline it and the team does all it can as paramedics, then drops you at a hospital." },
    executive: { name: "Executive", price: 1000, days: 30, execRank: 8, medscan: true, note: "Everything in Silver, and surgery at no extra cost." }
  },
  // What makes a linked biomonitor call on its own: HP below BODY, a wound state, a new Critical
  // Injury, or nothing (the player presses the button).
  trigger: "belowBody",
  solicit: false, // TT texts characters without coverage once they're badly hurt
  allowNoAds: true, // players may turn those offers off
  execAuto: false, // Execs' corporate coverage: the plan their Teamwork rank earns (see execRank)
  eta: 5, // minutes the GM's ETA starts at
  medscan: {} // MedScan's prices and switches, over MEDSCAN_DEFAULTS
};

export const TRIGGERS = {
  belowBody: "HP drops below BODY",
  serious: "Seriously Wounded (below half HP)",
  mortal: "Mortally Wounded (below 1 HP)",
  critical: "A new Critical Injury",
  manual: "Never: only the panic button"
};

export const DAY = 86400;

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
    medscan: !!plan.medscan,
    note: String(plan.note ?? "").trim().slice(0, 500)
  };
}

export function traumaConfig() {
  const saved = game.settings.get(MODULE_ID, "trauma") ?? {};
  const tiers = saved.tiers && Object.keys(saved.tiers).length ? saved.tiers : TRAUMA_DEFAULTS.tiers;
  return {
    ...TRAUMA_DEFAULTS,
    ...saved,
    // Plans saved before MedScan existed: the default plan of that id says (Executive covers it).
    tiers: Object.fromEntries(Object.entries(tiers).map(([id, plan]) => [id, cleanPlan({ medscan: TRAUMA_DEFAULTS.tiers[id]?.medscan, ...plan })])),
    medscan: cleanMedscan(saved.medscan)
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

/**
 * Another module that bills Trauma Team instead of the Agent (API trauma.handOffBilling), e.g. "CPR HQ"
 * with its Lifestyle bill; null when the Agent bills plans itself. Set on each client every session.
 */
let billedBy = null;
export const traumaBilledBy = () => billedBy;
export function setTraumaBilledBy(name) {
  billedBy = name ? String(name).trim().slice(0, 40) || null : null;
}

/** A plan by id or name (any case), or null. */
export function findPlan(ref, tiers = traumaConfig().tiers) {
  const want = String(ref ?? "").toLowerCase();
  return Object.keys(tiers).find(id => id === ref || tiers[id].name.toLowerCase() === want) ?? null;
}

/**
 * A subscription as other modules see it (API.md: trauma.status and the traumaChanged hook): a copy,
 * with the plan spelled out. status: "none" | "active" | "lapsed".
 */
export function subscriptionInfo(sub) {
  const plan = sub?.tier ? traumaConfig().tiers[sub.tier] : null;
  return {
    status: sub?.status === "active" || sub?.status === "lapsed" ? sub.status : "none",
    covered: covered(sub),
    plan: plan ? { id: sub.tier, ...plan } : null,
    memberId: sub?.memberId ?? null,
    sponsor: sub?.sponsor ?? null,
    auto: !!sub?.auto,
    since: sub?.since ?? null,
    nextDue: sub?.nextDue ?? null,
    biolink: !!sub?.biolink,
    noAds: !!sub?.noAds,
    billedBy
  };
}

/* ---------------- MedScan ---------------- */

/*
 * Trauma Team MedScan (Black Chrome p. 13): a paid section of the Trauma Team app. The app is bought once
 * (20eb); then a remote specialist can be called for a consult, paid per call through BangMe! unless the
 * character's plan includes MedScan (canon: Executive). A consult is a situational +1 on the caller's
 * sheet, as an Active Effect that ends on world time: a roll-dialog checkbox, off by default, for both consults.
 *
 * Config (trauma.medscan): { price (the app), wound, surgery (each consult's price), live (the GM answers
 *   each call: a card with Connect / Unavailable), unavailable (no specialist takes calls) }
 * Row (apps.medscan[actorId]): { owned, source: "bought"|"gm", since (world time), consult: Consult|null,
 *   history: [{ kind, at (world time), price, covered }] (the last few) }
 * Consult: { id, kind, status: "pending"|"active", doctor, asked (world time), start, until (world time),
 *   price, covered (the plan's name, or null), effectId }
 */

export const MEDSCAN_DEFAULTS = { price: 20, wound: 100, surgery: 500, live: false, unavailable: false };

/** The two consults (canon numbers): the skills they help, and for how long (hours of world time). */
export const CONSULTS = {
  wound: {
    name: "Wound consult", icon: "fas fa-kit-medical", hours: 1, bonus: 1, onByDefault: false, how: "tick it in the roll dialog",
    skills: [{ name: "First Aid", key: "bonuses.firstAid", cat: "skill" }, { name: "Paramedic", key: "bonuses.paramedic", cat: "skill" }],
    blurb: "A specialist stays on the line for up to an hour: +1 to First Aid or Paramedic to Stabilize or Quick Fix."
  },
  surgery: {
    // Medtech role abilities: the rollable "Medical Tech Skill" and "Surgery Skill" (plain "Surgery" is only a rank).
    // CPR's role-ability roll dialog shows situational checkboxes too (checked live 2026-10-22).
    name: "Surgical consult", icon: "fas fa-user-doctor", hours: 4, bonus: 1, onByDefault: false, how: "tick it in the roll dialog",
    skills: [{ name: "Medical Tech", key: "bonuses.medicalTechSkill", cat: "role" }, { name: "Surgery", key: "bonuses.surgerySkill", cat: "role" }],
    blurb: "A surgeon guides one treatment, installation, bodysculpt or surgery (up to 4 hours): +1 to Medical Tech or Surgery."
  }
};

/** The specialists who pick up (flavor). */
export const DOCTORS = ["Dr. Amara Okafor", "Dr. Kenji Watanabe", "Dr. Lucia Ferreira", "Dr. Pavel Novak", "Dr. Imani Brooks", "Dr. Rafael Ortiz", "Dr. Mei Lin", "Dr. Hannah Weiss"];

const price = (value, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e6) : fallback;
};

export function cleanMedscan(raw = {}) {
  const m = raw ?? {};
  return {
    price: price(m.price, MEDSCAN_DEFAULTS.price),
    wound: price(m.wound, MEDSCAN_DEFAULTS.wound),
    surgery: price(m.surgery, MEDSCAN_DEFAULTS.surgery),
    live: !!m.live,
    unavailable: !!m.unavailable
  };
}

/** The plan that covers this character's consults (active, with MedScan included), or null. */
export function medscanCover(sub, cfg = traumaConfig()) {
  const plan = covered(sub) ? cfg.tiers[sub.tier] : null;
  return plan?.medscan ? plan : null;
}

/** What a consult costs this character: { price, covered (plan name or null) }. */
export function consultPrice(kind, sub, cfg = traumaConfig()) {
  const plan = medscanCover(sub, cfg);
  return plan ? { price: 0, covered: plan.name } : { price: cfg.medscan[kind] ?? 0, covered: null };
}

/** "+1 First Aid, Paramedic". */
export const consultBonus = kind => `+${CONSULTS[kind].bonus} ${CONSULTS[kind].skills.map(s => s.name).join(", ")}`;

/**
 * The Active Effect a consult puts on the caller's sheet: one situational change per skill (a checkbox
 * in CPR's roll dialog, off by default), lasting the consult's hours of world time.
 */
export function consultEffect(kind, { consultId, doctor, start, img }) {
  const c = CONSULTS[kind];
  return {
    name: `MedScan: ${c.name}`,
    img,
    disabled: false,
    description: `${doctor ?? "A Trauma Team specialist"} on the line. ${c.blurb}`,
    duration: { seconds: c.hours * 3600, startTime: start },
    changes: c.skills.map(s => ({ key: s.key, mode: 2, value: String(c.bonus) })), // 2: ADD
    flags: {
      [MODULE_ID]: { medscan: consultId },
      "cyberpunk-red-core": {
        changes: {
          cats: Object.fromEntries(c.skills.map((s, i) => [String(i), s.cat])),
          situational: Object.fromEntries(c.skills.map((s, i) => [String(i), { isSituational: true, onByDefault: c.onByDefault }]))
        }
      }
    }
  };
}

/** World time left on a consult, in words: "42 min", "3 h 10 min", "ending". */
export function consultLeft(consult, now) {
  const min = Math.ceil(((consult?.until ?? 0) - now) / 60);
  if (min <= 0) return "ending";
  const h = Math.floor(min / 60);
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`;
}

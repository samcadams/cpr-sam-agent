import { MODULE_ID } from "../../scripts/config.js";
import { contentAchievements, contentArt } from "../../scripts/model/content.js";

/*
 * Achieve!: R. Talsorian's "Achievements and Loot Boxes" (Mr. Amaze's M.R.A.M.A.Z.E. Program). Each
 * player character earns each achievement once, as the GM decides (one award can go to several). An
 * earned achievement is a one-time currency: traded in (the GM does it on the GM Phone; players ask)
 * to reroll a d10 or for one of Mr. Amaze's Mystery Boxes.
 *
 * The GM's settings: the world setting "achieve", merged over ACHIEVE_DEFAULTS:
 *   { hidden: [id] (secret until earned), disabled: [id] (not in this game),
 *     custom: [{ id, name, text, img }] (the GM's own), chat: bool (announce in chat) }
 * What characters earned: the host's table "earned" (apps/manifest.js; a player sees their own
 * characters'): { [actorId]: { [id]: Earned } }
 *   (Crews used to earn them; the host drops those, apps/achieve/host.js.)
 *   Earned: { note, ts (one award to several characters shares it), date, time,
 *     spent: null | { kind: "reroll"|"box", ts, boxId? } }
 */

export const ACHIEVE_DEFAULTS = { hidden: [], disabled: [], custom: [], chat: true };

/** A badge without a picture: the content folder's blank.webp, or the module's own plain one. */
export const NEUTRAL_BADGE = `modules/${MODULE_ID}/images/badge-blank.svg`;
export const blankBadge = () => contentArt("achievements/blank.webp") ?? NEUTRAL_BADGE;

/**
 * The content folder's achievements (its achievements.json, in its order; model/content.js), each with
 * its badge from achievements/<id>.webp. None without one: then only the GM's own.
 */
export const achievements = () => contentAchievements().map(a => ({ ...a, img: contentArt(`achievements/${a.id}.webp`) ?? blankBadge() }));

/** What trading one in gets. */
export const TRADES = {
  reroll: { name: "Reroll", icon: "fa-dice-d10", text: "Reroll a single d10 a Player just rolled and keep the higher. Before the GM announces the outcome; never a Death Save." },
  box: { name: "Mystery Box", icon: "fa-box", text: "One of Mr. Amaze's Mystery Boxes, appearing within 10 m of one of the Edgerunners, somewhere none of the Crew is looking." }
};

export function achieveConfig() {
  const saved = game.settings.get(MODULE_ID, "achieve") ?? {};
  return { ...ACHIEVE_DEFAULTS, ...saved };
}

/** A GM's own achievement, in range. */
export function cleanCustom(a = {}) {
  const name = String(a.name ?? "").trim().slice(0, 60) || "Achievement";
  return {
    id: String(a.id ?? "").trim() || `custom-${foundry.utils.randomID(8)}`,
    name,
    text: String(a.text ?? "").trim().slice(0, 400),
    img: String(a.img ?? "").trim() || blankBadge(),
    custom: true
  };
}

/** Every achievement in this game (the content folder's and the GM's), with whether it's hidden or switched off. */
export function achievementList(cfg = achieveConfig()) {
  return [...achievements(), ...(cfg.custom ?? []).map(cleanCustom)].map(a => ({
    ...a, hidden: cfg.hidden.includes(a.id), disabled: cfg.disabled.includes(a.id)
  }));
}

/** What every character earned, from the app data (`store.apps`, or the host's own): { [actorId]: { [id]: Earned } }. */
export const earnedData = apps => apps?.earned ?? {};

/** What a character earned: { [id]: Earned }. */
export const earnedBy = (actorId, all) => all[actorId] ?? {};

/** Earned and not traded in yet. */
export const unspent = earned => Object.entries(earned).filter(([, e]) => !e.spent).map(([id]) => id);

/** Newly earned since `seen` (actorId|id → ts): [{ actorId, id, earned }], for the celebrations. */
export function newlyEarned(all, seen) {
  const out = [];
  for (const [actorId, earned] of Object.entries(all ?? {})) {
    for (const [id, e] of Object.entries(earned ?? {})) {
      if (seen.get(`${actorId}|${id}`) !== e.ts) out.push({ actorId, id, earned: e });
    }
  }
  return out;
}

/** The record to remember what's been celebrated. */
export function seenOf(all) {
  const seen = new Map();
  for (const [actorId, earned] of Object.entries(all ?? {})) for (const [id, e] of Object.entries(earned ?? {})) seen.set(`${actorId}|${id}`, e.ts);
  return seen;
}

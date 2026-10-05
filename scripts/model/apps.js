import { agentType, getPhoneSettings } from "./agent.js";
import { appearance } from "./appearance.js";
import { feature } from "./features.js";
import { MODULE_ID } from "../config.js";

/*
 * The phone's apps beyond Communications (Contacts, Messages, Calls) and Jobs, from R. Talsorian's "All About Agents". Each
 * can be switched off world-wide in Control (model/features.js).
 *
 * Their data lives on the host, saved under apps/ in its data folder (see model/storage.js; the
 * Garden is saved apart, see model/garden.js):
 *   alerts:     { [id]: Alert }       notifications from a character's Agent (see Alert below)
 *   ledger:     { [id]: Entry }       BangMe! movements outside conversations
 *                                      { id, actorId, amount (+/-), memo, kind, party (who with), ts, time, date }
 *   subs:       { [actorId]: Sub }    Trauma Team coverage (see model/trauma.js)
 *   dispatches: { [id]: Dispatch }    Trauma Team calls (see model/trauma.js)
 *   queries:    { [id]: Query }       Ask Alex Anything searches
 *                                      { id, actorId, text, status: "crawling"|"roll"|"answered"|"none",
 *                                        dv?, roll?: { total, detail }, answer?: { text, image }, instant?, ts, time }
 *   watch:      { [actorId]: Watch }  an armed WatchBox (see model/watchbox.js)
 *
 * Alert: { id, actorId, kind, text, from?, choices: [label], answer: null|label, ref?: { type, ... }, ts, time, date }
 *   from: who it's from, if not the Agent itself (e.g. "Trauma Team International")
 *   ref:  what answering it does on the host (e.g. { type: "bang", ... }; see host/agent.js)
 */

export const APPS = {
  agent: { name: "Agent", icon: "fas fa-robot", blurb: "Your Agent's name, personality and what it's told you." },
  garden: { name: "The Garden", icon: "fas fa-seedling", blurb: "Night City's feed, and The Garden Dating." },
  alex: { name: "Ask Alex Anything", icon: "fas fa-magnifying-glass", blurb: "Search the local Data Pool." },
  bangme: { name: "BangMe!", icon: "fas fa-burst", blurb: "Your balance, your ledger, and tap-to-pay." },
  trauma: { name: "Trauma Team", icon: "fas fa-truck-medical", blurb: "Coverage, and the button you hope you never press." },
  watchbox: { name: "WatchBox", icon: "fas fa-eye", blurb: "Leave your Agent in a room and it keeps watch.", noInternal: true }
};

/** Feature switches (model/features.js) for each app. */
export const appFeature = id => `app_${id}`;

/** The apps this phone can open: switched on, and not WatchBox on an Internal Agent. Names and icons as the GM set them. */
export function appsOn(internal = false) {
  const { names, icons } = appearance();
  return Object.entries(APPS)
    .filter(([id, app]) => feature(appFeature(id)) && !(internal && app.noInternal))
    .map(([id, app]) => ({ id, ...app, name: names[id], icon: icons[id] }));
}

/** The built-in apps: [id, icon key]. Settings is players' only, Control the GM Phone's only. */
const CORE = [["contacts", "contacts"], ["messages", "messages"], ["quests", "jobs"], ["settings", "settings"], ["control", "control"]];

/** The built-in apps that make up Communications (with Calls), switched off together. */
export const COMMS_APPS = ["contacts", "messages"];

/** Is this built-in app on this phone? */
function coreOn(id, gm) {
  if (COMMS_APPS.includes(id)) return feature("comms");
  if (id === "quests") return feature("jobs");
  if (id === "settings") return !gm;
  if (id === "control") return gm;
  return true;
}

/**
 * Every app a phone has, in order: the built-in ones (Communications and Jobs while they're on),
 * then the apps. `gm`: the GM Phone (Control instead of Settings).
 */
export function phoneApps({ gm = false, internal = false } = {}) {
  const { names, icons } = appearance();
  const core = CORE
    .filter(([id]) => coreOn(id, gm))
    .map(([id, icon]) => ({ id, name: names[id], icon: icons[icon], core: true }));
  return [...core, ...appsOn(internal)];
}

/** What's on the dock until someone changes it (the Apps button is always there too). */
export const DEFAULT_DOCK = ["contacts", "messages", "quests", "settings", "control"];

/** Most the dock holds, besides the Apps button. */
export const DOCK_MAX = 5;

/** Split a phone's apps between the dock and the home screen: `dock` is the saved choice (app ids). */
export function dockSplit(apps, dock = DEFAULT_DOCK) {
  const chosen = new Set((dock ?? DEFAULT_DOCK).slice(0, DOCK_MAX));
  return { dock: apps.filter(a => chosen.has(a.id)), home: apps.filter(a => !chosen.has(a.id)) };
}

export const emptyApps = () => ({ alerts: {}, ledger: {}, subs: {}, dispatches: {}, queries: {}, watch: {} });

/** Keyed by actorId (the others carry an actorId field). */
const BY_ACTOR = new Set(["subs", "watch"]);

/** What of the app data a user may see: GMs everything, players what belongs to characters they own. */
export function appsFor(user, apps) {
  if (user.isGM) return apps;
  const owns = actorId => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");
  const out = emptyApps();
  for (const [key, table] of Object.entries(apps)) {
    out[key] = Object.fromEntries(Object.entries(table ?? {}).filter(([id, v]) => owns(BY_ACTOR.has(key) ? id : v.actorId)));
  }
  return out;
}

/* -------------------------------------------- */
/*  The Agent: name and personality             */
/* -------------------------------------------- */

/**
 * Personality templates. The DLC prices extra personalities from 10eb (Cheap) to 100eb (Premium):
 * "the sexier the personality, the more expensive it is". The GM sees the choice as a prompt for how
 * the Agent talks.
 */
export const PERSONALITIES = {
  concierge: { name: "Corpo Concierge", price: "Premium, 100eb", voice: "Polished, formal, gently upsells." },
  choom: { name: "Street Choom", price: "Cheap, 10eb", voice: "Slang, loyal, a bit too casual." },
  deadpan: { name: "Deadpan", price: "Everyday, 20eb", voice: "Dry, literal, never impressed." },
  hen: { name: "Mother Hen", price: "Costly, 50eb", voice: "Worried about you. Always." },
  flirt: { name: "Flirt", price: "Premium, 100eb", voice: "Warm, teasing, a little much." },
  custom: { name: "My own", price: "", voice: "" }
};

/** What an Agent's alerts are about (the GM picks one when sending). */
export const ALERT_KINDS = {
  advice: { name: "Advice", icon: "fa-comment-dots" },
  reminder: { name: "Reminder", icon: "fa-bell" },
  event: { name: "Event", icon: "fa-calendar-star" },
  warning: { name: "Warning", icon: "fa-triangle-exclamation" },
  biometric: { name: "Biometric", icon: "fa-heart-pulse" },
  money: { name: "Money", icon: "fa-burst" },
  trauma: { name: "Trauma Team", icon: "fa-truck-medical" },
  garden: { name: "The Garden", icon: "fa-seedling" },
  alex: { name: "Ask Alex Anything", icon: "fa-magnifying-glass" },
  system: { name: "System", icon: "fa-robot" }
};

/** The name a character gave their Agent, or null. */
export function agentName(actor) {
  const name = String(getPhoneSettings(actor).agentName ?? "").trim();
  return name || null;
}

/** How notifications from this character's Agent are signed. */
export function agentLabel(actor) {
  return agentName(actor) ?? (agentType(actor) === "internal" ? "Internal Agent" : "Your Agent");
}

/** The character's personality choice, for the GM: { name, voice }. */
export function personalityOf(actor) {
  const s = getPhoneSettings(actor);
  const p = PERSONALITIES[s.personality] ?? null;
  if (!p) return null;
  const voice = s.personality === "custom" ? String(s.personalityText ?? "").trim() : p.voice;
  return { key: s.personality, name: p.name, price: p.price, voice };
}

/* -------------------------------------------- */
/*  Biomonitor                                   */
/* -------------------------------------------- */

const itemNames = setting =>
  String(game.settings.get(MODULE_ID, setting) ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

/** A Biomonitor on the sheet (installed cyberware, or carried gear), which the Agent can read. */
export function hasBiomonitor(actor) {
  const names = itemNames("biomonitorNames");
  return !!actor?.items && [...actor.items].some(item => {
    if (!names.includes(item.name.trim().toLowerCase())) return false;
    if (item.type === "cyberware") return !!(item.system.isInstalledInActor ?? item.system.isInstalled);
    return item.system?.equipped !== "owned";
  });
}

/** HP, BODY and the wound state from the Cyberpunk RED sheet, or null. */
export function vitalsOf(actor) {
  const hp = actor?.system?.derivedStats?.hp;
  const value = Number(hp?.value);
  const max = Number(hp?.max);
  if (!Number.isFinite(value) || !(max > 0)) return null;
  const body = Number(actor.system.stats?.body?.value);
  const state = value < 1 ? "mortal" : value < max / 2 ? "serious" : null;
  const injury = [...(actor.items ?? [])].filter(i => i.type === "criticalInjury").at(-1)?.name ?? null;
  return { hp: value, max, body: Number.isFinite(body) ? body : null, state, injury };
}

export const WOUND_LABELS = { serious: "Seriously Wounded", mortal: "Mortally Wounded" };

import { agentType, getPhoneSettings } from "./agent.js";
import { appearance } from "./appearance.js";
import { feature } from "./features.js";
import { APP_MANIFEST, APP_TABLES } from "../apps/manifest.js";
import { MODULE_ID } from "../config.js";

/*
 * The phone's apps beyond Communications (Contacts, Messages, Calls) and Jobs, from R. Talsorian's "All About Agents". Each
 * can be switched off world-wide in Control (model/features.js). Each app is described once, in
 * apps/manifest.js.
 *
 * Their data lives on the host, in the tables each app lists in the manifest, saved under apps/ in
 * its data folder (see model/storage.js; the Garden is saved apart, see apps/garden/model.js):
 *   alerts:       { [id]: Alert }        notifications from a character's Agent (see Alert below)
 *   ledger:       { [id]: Entry }        BangMe! movements outside conversations
 *                                         { id, actorId, amount (+/-), memo, kind, party (who with), ts, time, date }
 *   subs:         { [actorId]: Sub }     Trauma Team coverage (see apps/trauma/model.js)
 *   dispatches:   { [id]: Dispatch }     Trauma Team calls (see apps/trauma/model.js)
 *   queries:      { [id]: Query }        Ask Alex Anything searches
 *                                         { id, actorId, text, status: "crawling"|"roll"|"answered"|"none",
 *                                           dv?, roll?: { total, detail }, answer?: { text, image }, ts, time }
 *   watch:        { [actorId]: Watch }   an armed WatchBox (see apps/watchbox/model.js)
 *   rides:        { [id]: Ride }         Combat Cabb rides (see apps/cabb/model.js)
 *   rideCredits:  { [actorId]: Credit } Combat Cabb's Lifestyle free ride used this period (see apps/cabb/model.js)
 *   earned:       { [actorId]: { [achievementId]: Earned } }   Achieve! (see apps/achieve/model.js)
 *   boxes:        { [id]: Box }          Achieve!'s Mystery Boxes (see apps/achieve/boxes.js)
 *   gachaShelves: { [actorId]: [Pull] }  Gacha's shelves (see apps/gacha/model.js)
 *   breachPoints: { [id]: Point }        BREACH's Breach Points (see apps/breach/model.js)
 *   breaches:     { [id]: Breach }       BREACH runs (see apps/breach/model.js)
 *
 * Alert: { id, actorId, kind, text, from?, app?, choices: [label], answer: null|label, ref?: { type, ... }, ts, time, date }
 *   app:  the app it came from, opened from the Agent app (else worked out by alertApp)
 *   from: who it's from, if not the Agent itself (e.g. "Trauma Team International")
 *   ref:  what answering it does on the host (e.g. { type: "bang", ... }; see apps/agent/host.js)
 */

/** The apps: { [id]: { name, icon, blurb, noInternal? } }. */
export const APPS = Object.fromEntries(
  Object.entries(APP_MANIFEST).map(([id, { name, icon, blurb, noInternal }]) => [id, { name, icon, blurb, ...(noInternal ? { noInternal } : {}) }])
);

/** Feature switches (model/features.js) for each app. */
export const appFeature = id => `app_${id}`;

/**
 * The apps this phone can open: switched on, and not WatchBox on an Internal Agent. Names and icons as
 * the GM set them. `installed`: the apps installed on this character's Agent (a Set; apps/pool/model.js), or
 * null for every app (the GM Phone, or the Ziggurat Pool switched off).
 */
export function appsOn(internal = false, installed = null) {
  const { names, icons } = appearance();
  return Object.entries(APPS)
    .filter(([id, app]) => feature(appFeature(id)) && !(internal && app.noInternal) && (!installed || installed.has(id)))
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
export function phoneApps({ gm = false, internal = false, installed = null } = {}) {
  const { names, icons } = appearance();
  const core = CORE
    .filter(([id]) => coreOn(id, gm))
    .map(([id, icon]) => ({ id, name: names[id], icon: icons[icon], core: true }));
  return [...core, ...appsOn(internal, gm ? null : installed)];
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

/**
 * A phone's home screen in its owner's order: the apps in `order` (ids) first, as arranged, then the
 * rest in their usual order (apps added since, or never moved).
 */
export function arrange(apps, order = []) {
  const at = id => {
    const i = (order ?? []).indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return apps.map((app, i) => [app, i]).sort(([a, i], [b, j]) => at(a.id) - at(b.id) || i - j).map(([app]) => app);
}

/** The order after moving `id` to where `before` is (or to the end, without one): every id, saved whole. */
export function moveApp(ids, id, before) {
  const rest = ids.filter(x => x !== id);
  const at = before ? rest.indexOf(before) : -1;
  return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** An app's tile name: its short `homeName` (apps/manifest.js) unless the GM renamed it. */
export const tileName = app => (APP_MANIFEST[app.id]?.homeName && app.name === APP_MANIFEST[app.id].name ? APP_MANIFEST[app.id].homeName : app.name);

/** Every app data table, empty. */
export const emptyApps = () => Object.fromEntries(Object.keys(APP_TABLES).map(name => [name, {}]));

/**
 * What of the app data a user may see: GMs everything; players the rows of characters they own (each
 * table's `owner` in apps/manifest.js).
 */
export function appsFor(user, apps) {
  if (user.isGM) return apps;
  const owns = actorId => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");
  const sees = {
    actorId: (id, row) => owns(row?.actorId),
    key: id => owns(id),
    // Rows for everyone, or for the characters they list (BREACH's Breach Points).
    listed: (id, row) => !!row && (row.everyone || (row.actorIds ?? []).some(owns)),
    // GMs only (the GM's cards from the apps).
    gm: () => false
  };
  const out = emptyApps();
  for (const [key, table] of Object.entries(apps)) {
    const { owner, secret = [] } = APP_TABLES[key] ?? {};
    const may = sees[owner];
    if (!may) continue;
    // Fields only GMs see (e.g. a Breach Point's daemon outcomes) are left out of players' rows.
    const shown = row => (secret.length && row && typeof row === "object" ? Object.fromEntries(Object.entries(row).filter(([k]) => !secret.includes(k))) : row);
    out[key] = Object.fromEntries(Object.entries(table ?? {}).filter(([id, row]) => may(id, row)).map(([id, row]) => [id, shown(row)]));
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
  ncpd: { name: "NCPD", icon: "fa-building-shield" },
  raid: { name: "Raid warning", icon: "fa-person-military-pointing" },
  job: { name: "Jobs", icon: "fa-list-check" },
  contact: { name: "Contacts", icon: "fa-address-book" },
  system: { name: "System", icon: "fa-robot" }
};

/** Who signs which app's alerts, for alerts that don't name their app (see host/*.js FROM constants). */
const ALERT_SENDERS = {
  "Combat Cabb": "cabb",
  "Mr. Amaze's Capsules": "gacha",
  "M.R.A.M.A.Z.E.": "achieve",
  "Mr. Amaze": "achieve"
};

/** Alert kinds that only one app sends. */
const ALERT_KIND_APPS = { trauma: "trauma", garden: "garden", alex: "alex", ncpd: "ncpd", raid: "cbk" };

/** The app an alert came from, or null (the Agent's own, the GM's SAAI alerts, system notices). */
export function alertApp(alert) {
  if (alert.app) return alert.app in APPS ? alert.app : null;
  if (alert.from in ALERT_SENDERS) return ALERT_SENDERS[alert.from];
  if (alert.kind in ALERT_KIND_APPS) return ALERT_KIND_APPS[alert.kind];
  // BangMe! signs nothing; every other app's money alert has a sender.
  if (alert.kind === "money" && !alert.from) return "bangme";
  return null;
}

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

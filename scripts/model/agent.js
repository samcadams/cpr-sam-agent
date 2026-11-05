import { noSignalSince } from "./features.js";
import { MODULE_ID } from "../config.js";

/*
 * Which phone is in hand: the Agent of the selected token (or a player's assigned character).
 */

const names = setting =>
  String(game.settings.get(MODULE_ID, setting) ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

/* -------------------------------------------- */
/*  Phone settings                               */
/* -------------------------------------------- */

export const THEMES = {
  nightcity: "Night City",
  arasaka: "Arasaka",
  militech: "Militech",
  biotechnica: "Biotechnica",
  kangtao: "Kang Tao",
  trauma: "Trauma Team"
};

/**
 * Internal Agents use a retinal-HUD look (square edges, mild translucency) in their own colours.
 * "internal" is the base ice-blue; the rest tint it after the phone themes.
 */
export const INTERNAL_THEME = "internal";
export const INTERNAL_THEMES = {
  internal: "Ice (default)",
  "internal-nightcity": "Night City",
  "internal-arasaka": "Arasaka",
  "internal-militech": "Militech",
  "internal-biotechnica": "Biotechnica",
  "internal-kangtao": "Kang Tao",
  "internal-trauma": "Trauma Team",
  "internal-ghost": "Ghost"
};

/**
 * The phone's looks (see styles/skins/). The markup is the same for every skin, plus a few extras a
 * skin can ask for (see AgentPhone._skinExtras).
 *  palettes: the colour themes (THEMES) apply; the others bring their own colours
 *  dockSide: the app bar can go down the left side instead of along the bottom
 *  hud: a heads-up display for Internal Agents, in the HUD colours (INTERNAL_THEMES) and opacity
 *  vitals: a heart-rate and HP strip from the character sheet
 *  typeOut: new messages type out letter by letter
 *  base: another skin whose styles this one builds on (the window carries both classes)
 * The Agent models are from R. Talsorian's "All About Agents".
 */
export const SKINS = {
  classic: { name: "Neon Agent", blurb: "Chamfered corpo glass in your colour palette.", palettes: true, dockSide: true },
  zetatech: { name: "Zetatech Grade A", blurb: "Unobtrusive. Effective. Rectangular. The corporate grey everyone owns, with one accent colour.", palettes: true },
  yourplay: { name: "Segotari Agent (2019)", blurb: "The original \"Your Play\" toy: a pastel handheld where texts are game dialogue.", palettes: false, typeOut: true },
  dot: { name: "Microtech Dot", blurb: "Pre-war salvage with a CitiNet chip slotted in: glossy 2020 buttons and repair tape.", palettes: false },
  fieldMed: { name: "Field Agent: Med", blurb: "Trauma-kit white and red, with the biomonitor's vitals across the top.", palettes: false, vitals: true },
  fieldTech: { name: "Field Agent: Tech", blurb: "Gunmetal and exposed screws, with a diagnostics readout.", palettes: false },
  burner: { name: "Burner", blurb: "A 2000s brick phone: green LCD, pixel type, softkeys.", palettes: false },
  neuron: { base: "hud", name: "Rocklin Augmentics Neuron", blurb: "No panels at all: text written straight onto the optic nerve, at the edges of your sight.", palettes: true, hud: true }
};

/**
 * The HUD skins (hud: true) always use the HUD colours (INTERNAL_THEMES) and the HUD opacity. An
 * Internal Agent is forced onto the Neuron, unless the player turned that off.
 */
export const INTERNAL_SKIN = "neuron";

/**
 * Skins no longer offered, and the one a phone that used one gets instead. Its saved
 * setting stays as it was until the player picks another.
 */
export const RETIRED_SKINS = {
  zetatechplus: "zetatech",
  double: "yourplay",
  merlyn: "classic",
  fieldConstruction: "fieldTech",
  zine: "dot",
  braindance: "neuron",
  braingen: "neuron",
  pir2: "neuron"
};

/** BrainGen's sponsored content, until the GM writes their own in Control (world setting "brainGenAds"). */
export const DEFAULT_ADS = [
  "Tired of migraines? Upgrade to the EBM PiR2. Reliability you can feel. (Or can't.)",
  "Hungry? Kibble: now in Original, Spicy and Mystery!",
  "This message brought to you by Mediaware. Mediaware: we're already inside.",
  "Trauma Team Silver from 500eb a month. Because you're worth retrieving.",
  "Feeling watched? Get WatchBox by No/Brainer, just 50eb at any Oasis store.",
  "Smash the competition with Smash! The drink of champions and Solos.",
  "Your BrainGen has detected loneliness. The Garden Dating: someone's out there."
];

export function adLines() {
  const lines = String(game.settings.get(MODULE_ID, "brainGenAds") ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  return lines.length ? lines : DEFAULT_ADS;
}

/**
 * Per-phone settings. PCs keep them on the actor (each character's phone is its own);
 * GMs keep one set on their user for the GM Phone.
 */
export function getPhoneSettings(owner) {
  const gm = owner?.documentName === "User";
  return {
    theme: "nightcity", // colour palette
    internalTheme: INTERNAL_THEME, // colour palette of the Internal Agent HUD
    skin: "classic",
    dock: "bottom", // "bottom" | "side" (skins with dockSide)
    freeInternal: false, // Internal Agent: use the chosen skin instead of the HUD
    lockScreen: !gm, // open on the lock screen
    split: true, // wide window: conversations list beside the open conversation
    simTiles: false, // GM Phone: a tile per NPC above the inbox
    quickReplies: [],
    emoji: [], // players: their own reaction keyboard (empty: the GM's set)
    dockApps: null, // apps on the dock (model/apps.js DEFAULT_DOCK when not set); the rest are on the home screen
    homeOrder: [], // the home screen's order as its owner arranged it (app ids; model/apps.js arrange)
    navigation: "dock", // "dock": a dock of apps plus Apps; "home": a home screen of every app and a Home button
    agent: "internal",
    silent: false,
    notify: "toast", // a new text while its conversation isn't open: see NOTIFY_STYLES
    pinned: [],
    cleared: [], // [{ key, ts }]: conversations "deleted" from this phone up to ts (arrays: keys may contain dots)
    ...(owner?.getFlag(MODULE_ID, "phone") ?? {})
  };
}

/**
 * How a phone looks: its skin, colour palette (theme) and where the app bar goes.
 * An Internal Agent is the Neuron HUD in a HUD palette, unless its settings free it.
 */
export function phoneLook(settings, internal = false) {
  const forced = internal && !settings.freeInternal;
  const kept = RETIRED_SKINS[settings.skin] ?? settings.skin;
  const chosen = kept in SKINS ? kept : "classic";
  const skin = forced && !SKINS[chosen].hud ? INTERNAL_SKIN : chosen;
  if (SKINS[skin].hud) {
    const theme = settings.internalTheme in INTERNAL_THEMES ? settings.internalTheme : INTERNAL_THEME;
    return { skin, theme, dockSide: false, hud: true, forced };
  }
  const theme = SKINS[skin].palettes && settings.theme in THEMES ? settings.theme : "nightcity";
  return { skin, theme, dockSide: !!SKINS[skin].dockSide && settings.dock === "side", hud: false, forced: false };
}

/** How a new text shows up when its conversation isn't already open. */
export const NOTIFY_STYLES = {
  toast: "Pop-up notification",
  open: "Open the phone",
  none: "Badge only"
};

/** This phone's notification style (a character's phone, or the GM Phone for a GM's user). */
export function notifyStyle(owner) {
  const style = getPhoneSettings(owner).notify;
  return style in NOTIFY_STYLES ? style : "toast";
}

export function setPhoneSettings(owner, changes) {
  return owner.setFlag(MODULE_ID, "phone", { ...getPhoneSettings(owner), ...changes });
}

/* -------------------------------------------- */
/*  Agents                                       */
/* -------------------------------------------- */

/** Which Agents a character has: an installed Internal Agent and/or a carried/equipped Agent. */
export function agentsOf(actor) {
  const found = { internal: false, agent: false };
  if (!actor) return found;
  const internalNames = names("internalAgentNames");
  const agentNames = names("agentNames");
  for (const item of actor.items) {
    const name = item.name.trim().toLowerCase();
    if (item.type === "cyberware" && internalNames.includes(name)) {
      if (item.system.isInstalledInActor ?? item.system.isInstalled) found.internal = true;
    } else if (agentNames.includes(name)) {
      // Gear left in storage ("owned") doesn't count.
      if (item.system.equipped !== "owned") found.agent = true;
    }
  }
  return found;
}

/**
 * The Agent in use: "internal", "agent", or null. With both, the phone's settings choose
 * (Internal Agent by default).
 */
export function agentType(actor) {
  const { internal, agent } = agentsOf(actor);
  if (internal && agent) return getPhoneSettings(actor).agent === "agent" ? "agent" : "internal";
  return internal ? "internal" : agent ? "agent" : null;
}

/** The Agent item in use (agentType's choice): the Internal Agent cyberware or the gear Agent, or null. */
export function agentItem(actor) {
  const type = agentType(actor);
  if (!type) return null;
  const list = names(type === "internal" ? "internalAgentNames" : "agentNames");
  return actor.items.find(item => list.includes(item.name.trim().toLowerCase()) && (type === "internal"
    ? item.type === "cyberware" && (item.system.isInstalledInActor ?? item.system.isInstalled)
    : item.type !== "cyberware" && item.system.equipped !== "owned")) ?? null;
}

/** Can this character use their phone right now: they have an Agent, and cellular service? */
export function canUsePhone(actor) {
  return !!actor && !!agentType(actor) && !noSignalSince(actor.id);
}

/**
 * Is this phone on silent? Internal Agents have no silent switch: they're already silent to the
 * people around, and the user always hears them in their head.
 */
export function isSilenced(owner) {
  if (owner?.documentName === "Actor" && agentType(owner) === "internal") return false;
  return !!getPhoneSettings(owner).silent;
}

/**
 * A player's character: owned by a player or assigned to one. The actor's type doesn't matter: an
 * unowned "character" sheet is an NPC the GM voices.
 */
export function isPlayerCharacter(actor) {
  return !!actor && actor.type !== "container" && (actor.hasPlayerOwner || game.users.some(u => !u.isGM && u.character?.id === actor.id));
}

/**
 * Wound state from the Cyberpunk RED sheet: "serious" below half HP, "mortal" below 1 HP, else null.
 */
export function woundState(actor) {
  const hp = actor?.system?.derivedStats?.hp;
  const value = Number(hp?.value);
  const max = Number(hp?.max);
  if (!Number.isFinite(value) || !(max > 0)) return null;
  if (value < 1) return "mortal";
  return value < max / 2 ? "serious" : null;
}

/**
 * A player's phone in hand: the Agent of their selected token, else of their assigned character.
 * Null without an Agent, and always for GMs (the GM Phone speaks for every NPC).
 */
export function phoneSubject(user = game.user) {
  if (user.isGM) return null;
  const token = canvas.tokens?.controlled[0] ?? null;
  const actor = token?.actor ?? user.character ?? null;
  if (!actor || !actor.testUserPermission(user, "OWNER")) return null;

  const agent = agentType(actor);
  if (!agent) return null;

  const name = token?.document.name || actor.prototypeToken?.name || actor.name;
  const placed = token ?? actor.getActiveTokens()[0] ?? null;
  return { actor, token: placed, name, agent, key: `pc:${actor.id}:${name}` };
}

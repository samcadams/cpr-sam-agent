import { APP_IDS, APP_MANIFEST } from "../apps/manifest.js";
import { MODULE_ID } from "../config.js";
import { patchSetting } from "../util/settings.js";

/*
 * World-wide switches the GM sets in the GM Phone's Control app (world setting "features").
 * The UI hides what's off, and the host refuses it, so a player can't get around either.
 */

export const FEATURE_DEFAULTS = {
  comms: true, // Communications: Contacts, Messages and Calls, together (see COMMS_REQUESTS)
  jobs: true, // the Jobs app and job notices
  jobsAvailable: true, // players see the "Available" tab (off: only In Progress, Completed, Failed)
  locations: true, // sharing map pins and positions
  images: true, // sending photos (the GM)
  playerImages: false, // players may send photos too (a link, or a file already on the server)
  freeInternal: true, // players may turn off the forced Internal Agent HUD (Settings)
  blood: false, // blood on the screen of a badly hurt character's phone (see ui/phone/pages/blood.js)
  agentChat: false, // chat says when someone takes out or puts away a carried Agent (ui/agentShown.js)
  agentChatWhisper: false, // ...whispered to the GM (and only the GM sees the bubble)
  shareTexts: true, // a few texts from a conversation can be shared to chat (model/share.js)
  // Every app (apps/manifest.js): on, unless the manifest says it starts off.
  ...Object.fromEntries(APP_IDS.map(id => [`app_${id}`, !APP_MANIFEST[id].off]))
};

export function features() {
  return { ...FEATURE_DEFAULTS, ...(game.settings.get(MODULE_ID, "features") ?? {}) };
}

export const feature = name => features()[name];

/** GM: switch one feature on or off. */
export const setFeature = (name, on) => patchSetting("features", f => (f[name] = !!on));

/** Are Communications (Contacts, Messages, Calls) on? */
/**
 * Apps that start off (apps/manifest.js `off`) were on in older versions. A world that already used
 * the module keeps them on; a new one starts with them off. Either way the choice is saved, so this
 * happens once. Apps that never were on (`newApp`) start off in every world; `turnedOn` apps are switched on once. GM only (it saves a world setting). `existing`: the world had this module's settings
 * before this session (see main.js).
 */
export async function settleAppsOff(existing) {
  const saved = game.settings.get(MODULE_ID, "features") ?? {};
  const unset = APP_IDS.filter(id => APP_MANIFEST[id].off && !(`app_${id}` in saved));
  // `turnedOn` apps: switched on once in worlds that saved them off while they started off.
  const flip = APP_IDS.filter(id => APP_MANIFEST[id].turnedOn && !saved[`turnedOn_${id}`]);
  if (!unset.length && !flip.length) return;
  await patchSetting("features", f => {
    unset.forEach(id => (f[`app_${id}`] = existing && !APP_MANIFEST[id].newApp));
    flip.forEach(id => {
      if (f[`app_${id}`] === false) f[`app_${id}`] = true;
      f[`turnedOn_${id}`] = true;
    });
  });
}

export const commsOn = () => !!feature("comms");

/**
 * Requests the host refuses while Communications are off (host/index.js). Ending a call, reading,
 * and money-respond stay: BangMe! still transfers money held from conversations (host/money.js
 * allows only that while Communications are off).
 */
export const COMMS_REQUESTS = new Set([
  "send", "viewed", "reveal", "share-texts",
  "group-create", "group-send", "group-rename", "group-add", "group-remove",
  "service-action", "service-send", "service-reply",
  "react", "money-send", "contact-request", "request-resolve",
  "call-start", "call-answer", "call-add"
]);

/** May this user attach photos? */
export const canSendImages = user => feature("images") && (user.isGM || feature("playerImages"));

/*
 * Cellular service per character (world setting "noSignal": { [actorId]: when it was lost }).
 * Only GMs can change world settings, so players can't switch their own signal back on.
 */

export function noSignalSince(actorId) {
  return (game.settings.get(MODULE_ID, "noSignal") ?? {})[actorId] ?? null;
}

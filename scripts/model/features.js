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
  // The apps (model/apps.js APPS).
  app_agent: true,
  app_garden: true,
  app_alex: true,
  app_bangme: true,
  app_trauma: true,
  app_watchbox: true
};

export function features() {
  return { ...FEATURE_DEFAULTS, ...(game.settings.get(MODULE_ID, "features") ?? {}) };
}

export const feature = name => features()[name];

/** GM: switch one feature on or off. */
export const setFeature = (name, on) => patchSetting("features", f => (f[name] = !!on));

/** Are Communications (Contacts, Messages, Calls) on? */
export const commsOn = () => !!feature("comms");

/**
 * Requests the host refuses while Communications are off (host/index.js). Ending a call, reading,
 * and money-respond stay: BangMe! still transfers money held from conversations (host/money.js
 * allows only that while Communications are off).
 */
export const COMMS_REQUESTS = new Set([
  "send", "viewed", "reveal",
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

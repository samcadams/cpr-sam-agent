import { MODULE_ID } from "../config.js";

/**
 * Play a sound file. "interface" is scaled by Foundry's Interface volume, "environment" by Ambient.
 * @returns {Promise<Sound|undefined>}
 */
export function playSound(src, { volume = 1, loop = false, channel = "interface" } = {}) {
  const helper = foundry.audio?.AudioHelper ?? AudioHelper;
  return helper.play({ src, volume, loop, autoplay: true, channel }, false);
}

/** Play one of the module's sound settings once at this user's phone volume (0 mutes it). */
export function playPhoneSound(setting) {
  const src = game.settings.get(MODULE_ID, setting);
  const volume = game.settings.get(MODULE_ID, "volume");
  if (src && volume) playSound(src, { volume });
}

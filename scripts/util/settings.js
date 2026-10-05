import { MODULE_ID } from "../config.js";

/**
 * Change part of an object-valued world setting (features, appearance, trauma, gardenConfig…):
 * `change` gets a copy to modify; the result is saved. Only GMs can save world settings.
 */
export async function patchSetting(key, change) {
  const value = foundry.utils.deepClone(game.settings.get(MODULE_ID, key) ?? {});
  change(value);
  return game.settings.set(MODULE_ID, key, value);
}

import { MODULE_ID } from "../../scripts/config.js";
import { loadGardenLists } from "./model.js";

/* The Garden's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ refreshPhones }) {
  /** A GM changed the Garden's word list files: read them again. */
  const onGardenConfig = setting => {
    if (setting.key === `${MODULE_ID}.gardenConfig` && game.user.isGM) loadGardenLists().then(() => refreshPhones({ garden: true }));
  };
  for (const hook of ["createSetting", "updateSetting"]) Hooks.on(hook, onGardenConfig);
}

/** On ready, before the store starts: the host makes things up from the word lists (text files), GMs see them. */
export async function ready() {
  if (game.user.isGM) await loadGardenLists();
}

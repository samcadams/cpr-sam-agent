/* The Map's Foundry hooks (main.js installs every app's client.js when the module loads). */

import { MODULE_ID } from "../../scripts/config.js";
import { askJournals } from "./journals.js";

export function install({ store, refreshPhones }) {
  // A world that got the default Night City: a GM is asked about its journals (journals.js), once its pins are in.
  const ask = () => setTimeout(() => askJournals(store), 1500);
  Hooks.once("ready", ask);
  Hooks.on("updateSetting", setting => setting.key === `${MODULE_ID}.mapConfig` && ask());
  // A scene linked to a NAV pin was activated: the crew is there now (host.js).
  Hooks.on("updateScene", (scene, changes) => changes.active && store.isHost && store._mapSceneActivated(scene));
  // The content folder's files changed (the GM added the map/ drop-in): a Map still empty loads it (host.js).
  const onContent = setting => setting.key === `${MODULE_ID}.contentFiles` && store.isHost && store._enqueue(() => store._mapContentChanged());
  for (const hook of ["createSetting", "updateSetting"]) Hooks.on(hook, onContent);
  // Who may see a pin's journal pages changed (or their name or text): the card's preview redraws (the change flag
  // "mapPins", app.js refreshOn). The pins themselves are the Map's own (the table mapPins), not the scene's notes.
  const redraw = foundry.utils.debounce(() => refreshPhones({ mapPins: true }), 60);
  const onShared = (doc, changes) => (changes.ownership || changes.name || changes.text) && redraw();
  for (const hook of ["updateJournalEntry", "updateJournalEntryPage"]) Hooks.on(hook, onShared);
}

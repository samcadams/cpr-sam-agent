/* The Map's Foundry hooks (main.js installs every app's client.js when the module loads). */

import { MODULE_ID } from "../../scripts/config.js";
import { askJournals } from "./journals.js";
import { CREW_PICK } from "./host.js";

export function install({ store, refreshPhones }) {
  // A world that got the default Night City: a GM is asked about its journals (journals.js), once its pins are in.
  const ask = () => setTimeout(() => askJournals(store), 1500);
  Hooks.once("ready", ask);
  Hooks.on("updateSetting", setting => setting.key === `${MODULE_ID}.mapConfig` && ask());
  // A scene linked to a NAV pin was activated: the crew is there now (host.js).
  Hooks.on("updateScene", (scene, changes) => changes.active && store.isHost && store._mapSceneActivated(scene));
  // A scene linked to several pins: the GM's chat card "Where is the crew?" puts the crew at the pin picked (or
  // leaves it), through the host, once (the host rewrites the card with the choice).
  Hooks.on("renderChatMessage", (message, html) => {
    const pick = message.flags?.[MODULE_ID]?.[CREW_PICK];
    if (!pick || !game.user.isGM) return;
    const buttons = [...(html[0] ?? html).querySelectorAll("[data-map-crew-pick]")];
    for (const button of buttons) {
      button.disabled = pick.answer != null;
      button.addEventListener("click", event => {
        event.preventDefault();
        for (const b of buttons) b.disabled = true;
        store.request("map-crew-pick", { messageId: message.id, pinId: button.dataset.mapCrewPick });
      });
    }
  });
  // The content folder's files changed (the GM added the map/ drop-in): a Map still empty loads it (host.js).
  const onContent = setting => setting.key === `${MODULE_ID}.contentFiles` && store.isHost && store._enqueue(() => store._mapContentChanged());
  for (const hook of ["createSetting", "updateSetting"]) Hooks.on(hook, onContent);
  // Who may see a pin's journal pages changed (or their name or text): the card's preview redraws (the change flag
  // "mapPins", app.js refreshOn). The pins themselves are the Map's own (the table mapPins), not the scene's notes.
  const redraw = foundry.utils.debounce(() => refreshPhones({ mapPins: true }), 60);
  const onShared = (doc, changes) => (changes.ownership || changes.name || changes.text) && redraw();
  for (const hook of ["updateJournalEntry", "updateJournalEntryPage"]) Hooks.on(hook, onShared);
}

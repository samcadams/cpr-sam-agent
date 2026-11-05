import { invalidateCatalogue } from "./model.js";

/* NC Market's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ refreshPhones }) {
  // World items are part of the catalogue: phones on NC Market follow them.
  const refresh = foundry.utils.debounce(() => refreshPhones({ market: true }), 300);
  for (const action of ["create", "update", "delete"]) {
    Hooks.on(`${action}Item`, item => {
      if (item.parent || item.pack) return;
      invalidateCatalogue();
      refresh();
    });
  }
}

/** What runs when one of this app's settings (app.js) changes. */
export const onSetting = {
  market: () => invalidateCatalogue()
};

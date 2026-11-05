/* Combat Cabb's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ refreshPhones }) {
  // Combat Cabb's places and the party pin are map pins.
  const refreshCabb = foundry.utils.debounce(() => refreshPhones({ cabb: true }), 250);
  for (const action of ["create", "update", "delete"]) Hooks.on(`${action}Note`, refreshCabb);
}

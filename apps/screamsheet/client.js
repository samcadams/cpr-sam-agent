/*
 * DataPool's Foundry hooks (main.js installs every app's client.js when the module loads).
 * A Reputation event on a character's sheet becomes a suggested clipping on the host
 * automatically; journal entries prepared as screamsheets show on the GM's desk as they change.
 */

export function install({ refreshPhones, store }) {
  Hooks.on("updateActor", (actor, changes) => store.isHost && store._onScreamActor(actor, changes));
  const refreshDesk = foundry.utils.debounce(() => game.user.isGM && refreshPhones({ screamJournal: true }), 300);
  for (const action of ["create", "update", "delete"]) Hooks.on(`${action}JournalEntry`, refreshDesk);
}

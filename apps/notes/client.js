/* Notes' Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ refreshPhones }) {
  // Notes are journal pages: phones on the Notes app follow them.
  const refreshNotes = foundry.utils.debounce(() => refreshPhones({ notes: true }), 150);
  for (const doc of ["JournalEntry", "JournalEntryPage"]) {
    for (const action of ["create", "update", "delete"]) Hooks.on(`${action}${doc}`, refreshNotes);
  }
}

/* Trauma Team's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ store }) {
  // The host watches the world: Critical Injuries and Exec ranks.
  Hooks.on("createItem", item => {
    const actor = item.parent;
    if (!store.isHost || actor?.documentName !== "Actor") return;
    if (item.type === "criticalInjury") store._enqueue(() => store._onCriticalInjury(actor));
    if (item.type === "role") store._enqueue(() => store._pushExecCoverage(actor));
  });
  Hooks.on("updateItem", item => {
    if (store.isHost && item.type === "role" && item.parent?.documentName === "Actor") store._enqueue(() => store._pushExecCoverage(item.parent));
  });
}

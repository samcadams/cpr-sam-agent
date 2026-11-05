/* HusTool's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ store }) {
  // cpr-hq fires this on the settling GM's client, which needn't be the host: the host reads the schedules itself.
  Hooks.on("cpr-hq.downtimeSettled", (round, actors) => store.request("hustool-settled", { roundId: round.id, actorIds: actors.map(a => a.id) }));
}

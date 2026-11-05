/*
 * What every spec can count on, made once per run on the GM client (kept between runs, the test worlds are
 * messy): the lane's player character (whichever character fpw assigned to ClaudePlayerN: `ClaudeN Solo` in
 * hqtesting, a copied real character in livetestingenv; never a name the specs rely on) with an Agent and money, a second PC
 * `ClaudeN Nomad` owned by the same player (for PC-to-PC texts), an NPC sheet `ClaudeN Rogue`, and
 * the switches the specs need left on.
 */

import { gm, pl } from "./lib.mjs";

export async function setup({ lane }) {
  const tag = new Date().toISOString().slice(5, 19).replace(/[-:T]/g, "");
  const ids = await gm.run(async ({ lane }) => {
    const prefix = `Claude${lane} `;
    const player = game.users.getName(`ClaudePlayer${lane}`);
    if (!player) throw new Error(`no ClaudePlayer${lane}`);
    // The player's assigned character (fpw sets it with the lane); older setups: the lane's "Solo".
    const pc = player.character ?? game.actors.getName(`${prefix}Solo`);
    if (!pc) throw new Error(`ClaudePlayer${lane} has no character (fpw assigns one with the lane)`);
    if (!pc.testUserPermission(player, "OWNER")) throw new Error(`ClaudePlayer${lane} doesn't own ${pc.name}`);
    const agent = pc.items.find(i => i.name === "Agent");
    if (!agent) throw new Error(`${pc.name} (the lane's character) has no Agent`);
    if ((pc.system.wealth?.value ?? 0) < 2000) await pc.update({ "system.wealth.value": 5000 });
    // The phone's own settings a spec may have left changed: pop-ups for new texts, not silenced.
    // A character with an Internal Agent too: use the carried one (specs test the phone; the HUD hides some apps).
    await pc.setFlag(MODULE, "phone", { ...(pc.getFlag(MODULE, "phone") ?? {}), notify: "toast", silent: false, agent: "agent" });

    let other = game.actors.getName(`${prefix}Nomad`);
    if (!other) {
      other = await Actor.create({ name: `${prefix}Nomad`, type: "character", ownership: { default: 0, [player.id]: 3 } });
      await other.createEmbeddedDocuments("Item", [agent.toObject()]);
    }
    if ((other.system.wealth?.value ?? 0) < 2000) await other.update({ "system.wealth.value": 5000 });

    let npc = game.actors.getName(`${prefix}Rogue`);
    if (!npc) npc = await Actor.create({ name: `${prefix}Rogue`, type: "mook" });

    // Switches another lane (or Sam) may have left off.
    for (const name of ["comms", "jobs", "jobsAvailable", "locations", "images", "shareTexts"]) {
      if (!api.feature(name)) await api.setFeature(name, true);
    }
    for (const id of [pc.id, other.id]) if (!api.hasSignal(id)) await api.setSignal(id, true);
    // With the App Store on, phones show only installed apps: the lane's characters get every app that's on.
    if (api.pool?.on()) {
      for (const id of [pc.id, other.id]) {
        for (const app of (await appsOn()).filter(a => a !== "pool" && !api.pool.has(id, a))) await api.pool.grant({ actor: id, app });
      }
    }
    return {
      prefix,
      // shown: the name the phones show and key contacts by (displayName: the prototype token's name).
      pc: { id: pc.id, name: pc.name, shown: pc.prototypeToken?.name || pc.name },
      other: { id: other.id, name: other.name, shown: other.prototypeToken?.name || other.name },
      npc: { id: npc.id, name: npc.name },
      player: player.id
    };
  }, { lane });

  // The player's client: logged in (fpw does it on first use), the phone's store synced with the host.
  await pl.run(async () => {
    await until(() => game.ready && store.online, "the player's phone store to sync", 30000);
    return true;
  });
  return { lane, tag, gm, pl, ...ids, contact: `${ids.prefix}Fixer` };
}

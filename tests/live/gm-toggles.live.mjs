/*
 * The GM's toggles (T266), live: CitiNet apps without a signal (blocked or browsable, and the GM's per-app switch),
 * Require carried Agent item, the Library Search bonus, Weather's Blackout option, the Sponsored Cybereye ads switch.
 * Each puts the world setting back afterwards.
 */

import { check, same, test } from "./lib.mjs";

const setWorld = (client, key, value) => client.run(a => game.settings.set(MODULE, a.key, a.value), { key, value });

test("no signal: The Garden says Cannot connect!, Ask Alex stays browsable; switched off, The Garden works", async ({ gm, pl, pc }) => {
  const apps = await pl.run(() => appsOn());
  check(apps.includes("garden") && apps.includes("alex"), "The Garden and Ask Alex are on");
  const saved = await gm.run(() => game.settings.get(MODULE, "citinetApps"));
  try {
    await gm.run(a => api.setSignal(a.pc.id, false), { pc });
    const off = await pl.run(async () => {
      await go("garden");
      await until(() => el(".agent-citinet-block"), "Cannot connect!");
      const garden = { block: text(".agent-citinet-block"), strip: !!el(".agent-citinet-off") };
      await go("alex");
      await until(() => el(".agent-citinet-off"), "the No CitiNet strip");
      return { garden, alex: { block: !!el(".agent-citinet-block"), page: !!el(".agent-alex-thread") } };
    });
    check(/Cannot connect!/.test(off.garden.block) && !off.garden.strip, "The Garden: Cannot connect!, no strip");
    check(!off.alex.block && off.alex.page, "Ask Alex: the strip over its page");

    await setWorld(gm, "citinetApps", { garden: false });
    const works = await pl.run(async () => {
      await go("garden");
      return until(() => !el(".agent-citinet-block") && !el(".agent-citinet-off") && "page", "The Garden without the block");
    });
    same(works, "page", "The Garden doesn't need the CitiNet once the GM says so");
  } finally {
    await setWorld(gm, "citinetApps", saved);
    await gm.run(a => api.setSignal(a.pc.id, true), { pc });
  }
});

test("Require carried Agent item off: a player character without the item has an Agent; on again, not", async ({ gm, prefix, player }) => {
  try {
    const r = await gm.run(async a => {
      const { agentType } = await import("/modules/" + MODULE + "/scripts/model/agent.js");
      const name = a.prefix + "Agentless";
      const actor = game.actors.getName(name) ?? await Actor.create({ name, type: "character", ownership: { [a.player]: 3 } });
      const before = agentType(actor);
      await game.settings.set(MODULE, "requireAgentItem", false);
      const off = agentType(actor);
      await game.settings.set(MODULE, "requireAgentItem", true);
      return { before, off, after: agentType(actor) };
    }, { prefix, player });
    same(r, { before: null, off: "agent", after: null }, "the Agent follows the setting");
  } finally {
    await setWorld(gm, "requireAgentItem", true);
  }
});

test("Library Search bonus: the GM's number is what the phone adds", async ({ gm }) => {
  try {
    const r = await gm.run(async () => {
      const { agentMods, librarySearchBase } = await import("/modules/" + MODULE + "/apps/alex/model.js");
      await game.settings.set(MODULE, "agentLibraryBonus", 4);
      await game.settings.set(MODULE, "bigSaaiBonus", 2);
      return { base: librarySearchBase(null, true).bonus, mods: agentMods([], true, "x").map(m => m.value) };
    });
    same(r, { base: 6, mods: [4, 2] }, "4 for the Agent, 2 for Big SAAI");
  } finally {
    await setWorld(gm, "agentLibraryBonus", 2);
    await setWorld(gm, "bigSaaiBonus", 1);
  }
});

test("Weather Control: the Blackout option saves; Control → Labels: the ads switch saves", async ({ gm }) => {
  const saved = await gm.run(() => game.settings.get(MODULE, "weather"));
  try {
    const r = await gm.run(async () => {
      await go("weather");
      // The options are folded away until opened.
      if (!el('[data-option="blackoutSignal"]')) await tap('[data-action="wx-fold"][data-fold="options"]');
      const box = await until(() => el('[data-option="blackoutSignal"]'), "the Blackout option");
      const was = box.checked;
      box.click();
      await until(() => game.settings.get(MODULE, "weather")?.blackoutSignal === !was, "the option to save");
      await go("control");
      const ads = await until(() => el('[data-world-setting="sponsoredAds"]'), "the ads switch");
      ads.click();
      await until(() => game.settings.get(MODULE, "sponsoredAds") === false, "the ads switch to save");
      return { was, ads: game.settings.get(MODULE, "sponsoredAds") };
    });
    same(r, { was: true, ads: false }, "Blackout on by default; ads switched off");
  } finally {
    await setWorld(gm, "weather", saved);
    await setWorld(gm, "sponsoredAds", true);
  }
});

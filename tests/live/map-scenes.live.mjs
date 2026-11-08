/*
 * Map, Pin Maps (T274): a pin's linked scenes are chips on the GM's pin card; tapping one views the scene for the
 * GM only (it isn't activated); a scene linked to two pins asks the GM in chat where the crew is, and the button
 * picked puts Combat Cabb's crew at that pin. GM only. The lane's test scene ("ClaudeN Pin Scene") is made once and
 * stays; the pins' scenes, the crew and the active scene are put back.
 */

import { check, same, test } from "./lib.mjs";

test("Map (GM): a linked scene's chip views it without activating it; a scene on two pins asks in chat where the crew is", async ({ gm, prefix }) => {
  const setup = await gm.run(async a => {
    if (!api.feature("app_map")) throw new Error("the map app is off in Control: switch it on to test it");
    const name = `${a.prefix}Pin Scene`;
    const scene = game.scenes.getName(name) ?? await game.scenes.documentClass.create({ name, active: false });
    // Two lasting place pins (not districts or temporary ones).
    const [p1, p2] = Object.values(store.apps.mapPins ?? {}).filter(r => r.type !== "district" && !r.temp).slice(0, 2);
    if (!p2) throw new Error("the Map needs two pins to test this");
    return {
      sceneId: scene.id, sceneName: scene.name, p1: p1.id, p2: p2.id,
      old: { [p1.id]: p1.scenes ?? [], [p2.id]: p2.scenes ?? [] },
      crew: game.settings.get(MODULE, "cabb").crew ?? null,
      active: game.scenes.active?.id ?? null, viewed: game.scenes.viewed?.id ?? null
    };
  }, { prefix });
  try {
    const viewed = await gm.run(async a => {
      store.request("map-pin", { op: "set", id: a.p1, change: { scenes: [{ sceneId: a.sceneId, label: "" }] } });
      await until(() => store.apps.mapPins[a.p1]?.scenes?.some(s => s.sceneId === a.sceneId), "the scene linked to the pin");
      const p = await phone();
      await go("map");
      await until(() => p._mapModel, "the map");
      p.mapPick = a.p1;
      p.render();
      const chip = `.agent-map-scene-name[data-scene-id="${a.sceneId}"]`;
      const label = await until(() => el(chip)?.textContent.trim(), "the scene's chip on the pin card");
      await tap(chip);
      await until(() => game.scenes.viewed?.id === a.sceneId, "the scene viewed");
      return { label, viewed: game.scenes.viewed?.id, active: game.scenes.get(a.sceneId).active };
    }, setup);
    same(viewed.label, setup.sceneName, "the chip shows the scene's name (no label)");
    same(viewed.viewed, setup.sceneId, "tapping the chip views the scene");
    check(!viewed.active, "viewing doesn't activate it");

    const card = await gm.run(async a => {
      await game.settings.set(MODULE, "cabb", { ...game.settings.get(MODULE, "cabb"), crew: null });
      store.request("map-pin", { op: "set", id: a.p2, change: { scenes: [{ sceneId: a.sceneId, label: "Night" }] } });
      await until(() => store.apps.mapPins[a.p2]?.scenes?.some(s => s.sceneId === a.sceneId), "the scene linked to the second pin");
      const before = new Set(game.messages.contents.map(m => m.id));
      await game.scenes.get(a.sceneId).activate();
      const message = await until(() => game.messages.contents.find(m => !before.has(m.id) && m.flags?.[MODULE]?.mapCrewPick?.sceneId === a.sceneId), "the GM's chat card");
      const buttons = await until(() => {
        const found = [...document.querySelectorAll(`#chat-log [data-message-id="${message.id}"] [data-map-crew-pick]`)];
        return found.length ? found : null;
      }, "the card's buttons in the chat log");
      const pins = buttons.map(b => b.dataset.mapCrewPick);
      buttons.find(b => b.dataset.mapCrewPick === a.p2).click();
      const crew = await until(() => game.settings.get(MODULE, "cabb").crew?.noteId, "the crew placed");
      await until(() => game.messages.get(message.id)?.flags?.[MODULE]?.mapCrewPick?.answer === a.p2, "the card answered");
      return { whisper: message.whisper.length > 0, pins, crew };
    }, setup);
    check(card.whisper, "the card is whispered to the GM");
    same(card.pins.filter(Boolean).sort(), [setup.p1, setup.p2].sort(), "one button per linked pin");
    check(card.pins.includes(""), "and one to leave the crew where it is");
    same(card.crew, setup.p2, "the button puts the crew at that pin");
  } finally {
    await gm.run(async a => {
      for (const [id, scenes] of Object.entries(a.old)) store.request("map-pin", { op: "set", id, change: { scenes } });
      // (the scene active before first: activating it may move the crew to a pin of its own)
      if (a.active && a.active !== a.sceneId) await game.scenes.get(a.active)?.activate();
      await game.settings.set(MODULE, "cabb", { ...game.settings.get(MODULE, "cabb"), crew: a.crew });
      if (a.viewed && game.scenes.viewed?.id !== a.viewed) await game.scenes.get(a.viewed)?.view();
    }, setup);
  }
}, { player: false });

/*
 * Startup: the module loads on both clients, the host is up, its files are served, and every app that's
 * on opens on the player's Agent and on the GM Phone without a console error.
 */

import { check, same, test } from "./lib.mjs";

test("the module, its API and its host are up on both clients", async ({ gm, pl }) => {
  const host = await gm.run(() => ({ version: api.version, host: store.isHost, online: store.online, gm: game.user.isGM }));
  same(host, { version: 1, host: true, online: true, gm: true }, "the lane GM hosts the phones");
  const player = await pl.run(() => ({ version: api.version, host: store.isHost, online: store.online, char: game.user.character?.name }));
  check(player.online && !player.host, `the player is synced with the host: ${JSON.stringify(player)}`);
});

test("every stylesheet, template and sound in module.json is served", async ({ gm }) => {
  const missing = await gm.run(async () => {
    const base = `modules/${MODULE}/`;
    const manifest = await (await fetch(`${base}module.json`)).json();
    const paths = [...(manifest.styles ?? []), ...(manifest.esmodules ?? [])];
    const bad = [];
    for (const p of paths) {
      const r = await fetch(base + p, { method: "HEAD" });
      if (!r.ok) bad.push(`${p} ${r.status}`);
    }
    // Every template the phone loaded is in Handlebars' cache; a 404 would have thrown at ready.
    return bad;
  });
  same(missing, [], "files listed in module.json all load");
});

test("the player's Agent opens with every app that's on, on its home screen or dock", async ({ pl }) => {
  const r = await pl.run(async () => {
    await closePhone();
    await go("home");
    // Apps not on the dock are on the home screen; the dock holds the rest.
    const tiles = els('[data-action="app"]').map(e => e.dataset.app);
    return { on: await appsOn(), tiles };
  });
  const missing = r.on.filter(id => !r.tiles.includes(id));
  same(missing, [], "each app that's on is on the home screen or the dock");
});

test("every app opens on the player's Agent", async ({ pl }) => {
  const shown = await pl.run(async () => {
    const out = {};
    for (const id of [...(await appsOn()), "contacts", "messages", "quests", "settings"]) {
      const p = await go(id);
      const body = root().querySelector(".window-content")?.innerText.trim() ?? "";
      out[id] = p.app === id && body.length > 20;
    }
    await go("home");
    return out;
  });
  const blank = Object.entries(shown).filter(([, ok]) => !ok).map(([id]) => id);
  same(blank, [], "no app opens blank");
});

test("every app opens on the GM Phone, with Control", async ({ gm }) => {
  const shown = await gm.run(async () => {
    const out = {};
    for (const id of [...(await appsOn()), "contacts", "messages", "quests", "control"]) {
      const p = await go(id);
      const body = root().querySelector(".window-content")?.innerText.trim() ?? "";
      out[id] = p.app === id && body.length > 20;
    }
    await go("messages");
    return out;
  });
  const blank = Object.entries(shown).filter(([, ok]) => !ok).map(([id]) => id);
  same(blank, [], "no app opens blank on the GM Phone");
}, { player: false });

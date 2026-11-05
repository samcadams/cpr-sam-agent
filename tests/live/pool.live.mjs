/*
 * The App Store (id "pool"): uninstalling from On your Agent and reinstalling (free once owned, with the
 * faux download), the store's icons being the home-screen tiles, a subscription from
 * Subscribe to the GM's bill, a lapse (the app locks) and Renew, and a Fixer's sideloaded package paid
 * in a conversation. Everything is put back at the end: the lane's PC keeps every app.
 */

import { check, same, test } from "./lib.mjs";

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });
const has = (c, pc, app) => c.run(a => api.pool.has(a.pc.id, a.app), { pc, app });

/** Gacha's price in the GM's catalogue. */
const gachaPrice = (gm, model, price) => gm.run(async a => {
  const pool = foundry.utils.deepClone(game.settings.get(MODULE, "pool") ?? {});
  pool.apps = { ...pool.apps, gacha: { ...pool.apps?.gacha, model: a.model, price: a.price } };
  await game.settings.set(MODULE, "pool", pool);
}, { model, price });

/** The App Store on, and the app installed (the fixtures do this for every app; a failed spec may have left one off). */
const ready = (gm, pc, app) => gm.run(async a => {
  if (!api.pool.on()) await api.setFeature("app_pool", true);
  if (!api.pool.has(a.pc.id, a.app)) await api.pool.grant({ actor: a.pc.id, app: a.app });
  await until(() => api.pool.has(a.pc.id, a.app), "the app installed");
}, { pc, app });

test("uninstall from On your Agent takes the app off the home screen; Get downloads it back, free", async ({ gm, pl, pc }) => {
  await ready(gm, pc, "roach");
  const layout = await pl.run(async () => {
    // The store's icon is the home screen's tile: same background.
    await go("home");
    const tileBg = getComputedStyle(await until(() => el('.agent-home-app.app-roach .agent-home-icon'), "Roach Race's home tile")).backgroundImage;
    await go("pool");
    await tap('[data-action="pool-tab"][data-tab="featured"]'); // the store remembers its last tab
    const tabs = els('[data-action="pool-tab"]').map(e => e.dataset.tab);
    // On your Agent: Open and the bin on one line, Open its own size (not stretched over the row).
    const row = await until(() => el('.agent-pool-cards.compact [data-action="pool-remove"][data-app="roach"]')?.closest("li"), "Roach Race on your Agent");
    const open = row.querySelector('[data-action="pool-open"]');
    const storeBg = getComputedStyle(row.querySelector(".agent-app-tile.app-roach .agent-home-icon")).backgroundImage;
    const out = { tabs, row: row.offsetWidth, open: open.offsetWidth, rowHeight: row.offsetHeight, sameTile: tileBg === storeBg && tileBg !== "none", rules: els(".agent-pool-rules").length };
    await tap('[data-action="pool-remove"][data-app="roach"]');
    await press(await dialog("App Store"), "Yes");
    await until(() => !api.pool.has(game.user.character.id, "roach"), "Roach Race uninstalled");
    // Featured lists it again, with Get.
    out.featured = !!(await until(() => el('.agent-pool-cards:not(.compact) [data-action="pool-get"][data-app="roach"]'), "Roach Race in Featured"));
    return out;
  });
  same(layout.tabs, ["featured", "subs"], "no Installed tab");
  check(layout.sameTile, "the store's icon is the app's home-screen tile");
  same(layout.rules, 0, "no rules lines on the cards");
  check(layout.open < layout.row / 3, `Open is a small button (${layout.open} of ${layout.row} px)`);
  check(layout.rowHeight < 80, `an On your Agent row is one line, not a column of letters (${layout.rowHeight} px)`);
  check(layout.featured, "Featured shows the app right after it's uninstalled");
  const home = await pl.run(async () => {
    await go("home");
    return els(".agent-home-app").map(e => e.dataset.app);
  });
  check(!home.includes("roach"), "it's gone from the home screen");
  const before = await wealth(gm, pc.id);
  const dl = await pl.run(async () => {
    await go("pool");
    await tap('[data-action="pool-tab"][data-tab="featured"]'); // the store remembers its last tab
    await tap('[data-action="pool-get"][data-app="roach"]');
    // A faux download on the card, still in Featured; then it moves to On your Agent.
    const bar = !!(await until(() => el('.agent-pool-cards:not(.compact) .agent-pool-card.app-roach.downloading .agent-pool-progress'), "the download bar"));
    await until(() => api.pool.has(game.user.character.id, "roach"), "Roach Race back");
    const stillDownloading = !!el('.agent-pool-card.app-roach.downloading');
    await until(() => el('.agent-pool-cards.compact [data-action="pool-open"][data-app="roach"]'), "Roach Race on your Agent after the download", 8000);
    return { bar, stillDownloading };
  });
  check(dl.bar, "Get shows a download bar on the card");
  check(dl.stillDownloading, "the card keeps downloading after the install lands");
  same(await wealth(gm, pc.id), before, "reinstalling costs nothing");
});

test("a subscription: Subscribe pays a month, the GM bills the next, a lapse locks it, Renew opens it", async ({ gm, pl, pc }) => {
  await ready(gm, pc, "gacha");
  await gachaPrice(gm, "monthly", 30);
  // While another module bills subscriptions (CPR HQ's Lifestyle bill took the hand-off), the App Store charges nothing.
  const billedBy = await gm.run(() => api.subscriptions.billedBy());
  const month = billedBy ? 0 : 30;
  try {
    await gm.run(a => until(() => api.pool.has(a.pc.id, "gacha"), "gacha"), { pc });
    // Uninstall (it was a free app), then subscribe from the store.
    await pl.run(async () => {
      await go("pool");
      await tap('[data-action="pool-tab"][data-tab="featured"]'); // the store remembers its last tab
      await tap('[data-action="pool-remove"][data-app="gacha"]');
      await press(await dialog("App Store"), "Yes");
      await until(() => !api.pool.has(game.user.character.id, "gacha"), "Gacha uninstalled");
    });
    const before = await wealth(gm, pc.id);
    await pl.run(async () => {
      await tap('[data-action="pool-get"][data-app="gacha"]');
      await press(await dialog("App Store"), "Yes");
      await until(() => api.subscriptions.state(game.user.character.id).items.some(s => s.app === "gacha" && s.status === "active"), "subscribed");
    });
    same(before - (await wealth(gm, pc.id)), month, billedBy ? `subscribing charges nothing (${billedBy} bills it)` : "the first month is paid on subscribing");

    // The bill is every active subscription (another spec or a GM may have left more than Gacha).
    const total = await gm.run(a => api.subscriptions.state(a.pc.id).total, { pc });
    if (billedBy === "CPR HQ") {
      // HQ's Lifestyle bill has it in its Apps column instead.
      const hq = await gm.run(async a => (await import("/modules/cpr-hq/scripts/lifestyle.mjs")).lifestyleState(game.actors.get(a.pc.id)).appsCharge, { pc });
      same(hq, total, "CPR HQ's Lifestyle bill charges the subscriptions (its Apps column)");
    }
    await gm.run(a => api.subscriptions.bill(a.pc.id, { all: true }), { pc });
    if (billedBy) await new Promise(r => setTimeout(r, 1500));
    const billed = billedBy ? 0 : total;
    await gm.run(a => until(() => game.actors.get(a.pc.id).system.wealth.value === a.before - a.month - a.billed, "the GM's bill"), { pc, before, month, billed });

    await gm.run(a => api.subscriptions.update({ actor: a.pc.id, app: "gacha", status: "lapsed" }), { pc });
    const locked = await pl.run(async () => {
      await until(() => api.subscriptions.state(game.user.character.id).items.some(s => s.app === "gacha" && s.status === "lapsed"), "lapsed");
      await go("gacha");
      return !!(await until(() => el(".agent-pool-lock"), "the lock screen"));
    });
    check(locked, "a lapsed app opens onto its lock screen");
    await pl.run(async () => {
      await tap('[data-action="pool-renew"][data-app="gacha"]');
      await press(await dialog("App Store"), "Yes");
      await until(() => !el(".agent-pool-lock") && api.pool.has(game.user.character.id, "gacha"), "renewed and open");
    });
    same(before - (await wealth(gm, pc.id)), billedBy ? 0 : 60 + total, billedBy ? "Renew charges nothing either" : "Renew pays a month");

    await pl.run(async () => {
      await go("pool");
      await tap('[data-action="pool-tab"][data-tab="subs"]');
      await tap('[data-action="pool-cancel"][data-app="gacha"]');
      await press(await dialog("App Store"), "Yes");
      await until(() => !api.subscriptions.state(game.user.character.id).items.length || !api.subscriptions.state(game.user.character.id).items.some(s => s.app === "gacha"), "cancelled");
    });
    check(!(await has(gm, pc, "gacha")), "cancelling uninstalls it");
  } finally {
    await gachaPrice(gm, "free", 0);
    await ready(gm, pc, "gacha");
  }
});

test("an app installed while on another page drops onto the home screen once", async ({ gm, pl, pc }) => {
  await ready(gm, pc, "roach");
  await gm.run(a => api.pool.revoke({ actor: a.pc.id, app: "roach", reason: "Live spec" }), { pc });
  try {
    const seen = await pl.run(async () => {
      await go("pool");
      await until(() => !api.pool.has(game.user.character.id, "roach"), "Roach Race off the Agent");
      return true;
    });
    check(seen, "the player is on the store page");
    await gm.run(a => api.pool.grant({ actor: a.pc.id, app: "roach" }), { pc });
    const out = await pl.run(async () => {
      await until(() => api.pool.has(game.user.character.id, "roach"), "Roach Race back");
      // Still on the store page: wait for its redraw, which is when the phone notices the install.
      await new Promise(r => setTimeout(r, 500));
      const offHome = !!el(".agent-installing");
      await go("home");
      const first = !!(await until(() => el(".agent-home-app.app-roach"), "the tile")).classList.contains("agent-installing");
      await go("pool");
      await go("home");
      const second = (await until(() => el(".agent-home-app.app-roach"), "the tile")).classList.contains("agent-installing");
      return { offHome, first, second };
    });
    same(out.offHome, false, "nothing to animate on the store page");
    check(out.first, "the tile animates on the next home draw");
    same(out.second, false, "only once");
  } finally {
    await ready(gm, pc, "roach");
  }
});

test("the GM's reset ownership: the purchase is forgotten after the confirm", async ({ gm, pc }) => {
  await ready(gm, pc, "roach");
  try {
    const out = await gm.run(async a => {
      await go("pool");
      await tap(`[data-action="pool-forget"][data-actor-id="${a.pc.id}"][data-app="roach"]`);
      await press(await dialog("App Store"), "Yes");
      await until(() => !api.pool.has(a.pc.id, "roach"), "Roach Race forgotten");
      return true;
    }, { pc });
    check(out, "the button took the app off");
  } finally {
    await ready(gm, pc, "roach");
  }
});

test("a Fixer's app package: paying the request in the conversation installs it", async ({ gm, pl, pc, contact, tag }) => {
  await ready(gm, pc, "breach");
  await gm.run(a => api.pool.revoke({ actor: a.pc.id, app: "breach", reason: `${a.tag} test` }), { pc, tag });
  await gm.run(a => until(() => !api.pool.has(a.pc.id, "breach"), "revoked"), { pc });
  const before = await wealth(gm, pc.id);
  await gm.run(a => api.pool.sideload({ actor: a.pc.id, app: "breach", price: 15, from: a.contact, note: `${a.tag} fresh off the truck` }), { pc, contact, tag });
  await pl.run(async a => {
    const t = await until(() => [...store.threads.values()].find(t => t.contact === a.contact && t.messages.some(m => m.pkg && m.text?.includes(a.tag))), "the package");
    AgentPhone.openThread(t, "token");
    const msg = t.messages.findLast(m => m.pkg);
    await tap(`[data-action="money-pay"][data-message-id="${msg.id}"]`);
    await until(() => api.pool.has(game.user.character.id, "breach"), "sideloaded");
    await until(() => el(".agent-pkg.installed"), "the card says Installed");
  }, { contact, tag });
  same(before - (await wealth(gm, pc.id)), 15, "the package's price is paid");
});

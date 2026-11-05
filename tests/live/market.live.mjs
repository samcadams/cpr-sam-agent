/*
 * Great River (id "market"; NC Market until 2026-10-21): a player orders from the phone, the GM approves it on the GM Phone and the items
 * land in the character's gear, paid through BangMe!; an item without a price is "price on request" and the
 * GM can deny it; the GM's Setup saves a change; with drone delivery and a delivery fee, the order flies and the
 * GM lands it with Deliver now. The setup is put back at the end. The older tests run the store as NC Market
 * was (no cap, no fee, instant delivery: CLASSIC).
 */

import { check, same, test } from "./lib.mjs";

const CLASSIC = { pricing: "fee", deliveryFee: 0, deliveryPct: 0, delivery: "instant" };

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });

/** NC Market on (and installed, with the App Store on), its setup `config`, two world items for sale, and money. */
const ready = (gm, pc, prefix, config = CLASSIC) => gm.run(async a => {
  if (!api.feature("app_market")) await api.setFeature("app_market", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "market")) await api.pool.grant({ actor: a.pc.id, app: "market" });
  await game.settings.set(MODULE, "market", { worldItems: true, ...a.config });
  for (const [name, price] of [[`${a.prefix}Market Stim`, 40], [`${a.prefix}Market Rock`, 0]]) {
    const item = game.items.getName(name);
    if (!item) await CONFIG.Item.documentClass.create({ name, type: "gear", system: { price: { market: price } } });
    else if (item.system.price.market !== price) await item.update({ "system.price.market": price });
  }
  await game.actors.get(a.pc.id).update({ "system.wealth.value": 1000 });
}, { pc, prefix, config, classic: CLASSIC });

/** The player's NC Market: search, add, and order with a note. Returns the new order's id. */
const order = (pl, name, note) => pl.run(async a => {
  const known = new Set(Object.keys(store.apps.orders ?? {}));
  await go("market");
  await tap('[data-action="market-tab"][data-tab="shop"]');
  await until(() => el("input[name=marketSearch]"), "the catalogue", 15000);
  await fill("input[name=marketSearch]", a.name);
  const add = await until(() => els('[data-action="market-add"]').find(b => b.closest("li")?.textContent.includes(a.name)), a.name + " in the list");
  add.click();
  await tap('[data-action="market-tab"][data-tab="cart"]');
  await fill("textarea[name=marketCartNote]", a.note);
  await tap('[data-action="market-order"]');
  const placed = await until(() => Object.values(store.apps.orders ?? {}).find(o => !known.has(o.id) && o.actorId === game.user.character.id), "the order to reach the host");
  return placed.id;
}, { name, note });

test("order on the phone, approve on the GM Phone: the item is in their gear and paid", async ({ gm, pl, pc, prefix }) => {
  await ready(gm, pc, prefix);
  try {
    const before = await wealth(gm, pc.id);
    const id = await order(pl, `${prefix}Market Stim`, "for the run");
    const card = await pl.run(async a => {
      await until(() => el(`[data-market-order="${a.id}"]`), "the order in Orders");
      return text(`[data-market-order="${a.id}"]`);
    }, { id });
    check(/pending/i.test(card) && card.includes("Market Stim") && card.includes("for the run"), `the player sees it waiting (${card})`);

    await gm.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="queue"]');
      await until(() => el(`[data-market-order="${a.id}"]`), "the order in the GM's queue");
      await fill(`[data-market-order="${a.id}"] input[name=marketNote]`, "enjoy");
      await tap(`[data-market-order="${a.id}"] [data-action="market-approve"]`);
      await until(() => store.apps.orders[a.id]?.status === "approved", "approved");
    }, { id });

    same(await wealth(gm, pc.id), before - 40, "charged the list price");
    const got = await gm.run(a => game.actors.get(a.pc.id).items.filter(i => i.name === a.name && i.flags["cpr-sam-agent"]?.market?.orderId === a.id).length, { pc, name: `${prefix}Market Stim`, id });
    same(got, 1, "the item is in their gear, tagged with the order");
    const alert = await pl.run(async a => {
      await until(() => store.apps.orders[a.id]?.status === "approved", "the player's phone hears it");
      await tap('[data-action="market-tab"][data-tab="orders"]');
      return Object.values(store.apps.alerts).filter(x => x.app === "market").sort((x, y) => x.ts - y.ts).at(-1)?.text ?? "";
    }, { id });
    check(/approved/i.test(alert) && alert.includes("enjoy"), `the player is told (${alert})`);
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

test("price on request: offered when blank prices aren't ignored; the GM can deny it", async ({ gm, pl, pc, prefix }) => {
  await ready(gm, pc, prefix, { ...CLASSIC, ignoreBlankPrice: false });
  try {
    const before = await wealth(gm, pc.id);
    const id = await order(pl, `${prefix}Market Rock`, "how much?");
    const row = await gm.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="queue"]');
      await until(() => el(`[data-market-order="${a.id}"]`), "the order in the GM's queue");
      const price = el(`[data-market-order="${a.id}"] input[name=marketPrice]`);
      return { value: price.value, unpriced: price.classList.contains("unpriced") };
    }, { id });
    check(row.unpriced && row.value === "", "the GM sees an empty price to fill in");
    await gm.run(async a => {
      await fill(`[data-market-order="${a.id}"] input[name=marketNote]`, "not for sale");
      await tap(`[data-market-order="${a.id}"] [data-action="market-deny"]`);
      await until(() => store.apps.orders[a.id]?.status === "denied", "denied");
    }, { id });
    same(await wealth(gm, pc.id), before, "nothing charged");
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

test("the GM's Setup: a price limit and an item type save from the phone", async ({ gm, pc, prefix }) => {
  await ready(gm, pc, prefix);
  try {
    const saved = await gm.run(async () => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="setup"]');
      await fill('input[data-market-setting="maxPrice"]', "500");
      await until(() => game.settings.get(MODULE, "market").maxPrice === 500, "the highest price saved");
      await tap('[data-action="market-type"][data-type="drug"]');
      await until(() => !game.settings.get(MODULE, "market").types?.includes("drug"), "drugs off");
      const cfg = game.settings.get(MODULE, "market");
      return { max: cfg.maxPrice, drug: cfg.types.includes("drug"), gear: cfg.types.includes("gear"), chip: !!el('[data-action="market-type"][data-type="drug"]:not(.active)') };
    });
    check(saved.max === 500 && !saved.drug && saved.gear && saved.chip, `saved: ${JSON.stringify(saved)}`);
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

/**
 * A small shop for the round-2 tests: only the lane's "<prefix>Market Shelf" folder of world items (six
 * priced items), no compendiums, and `config`. Returns the items' names.
 */
const shelf = (gm, pc, prefix, config = {}) => gm.run(async a => {
  if (!api.feature("app_market")) await api.setFeature("app_market", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "market")) await api.pool.grant({ actor: a.pc.id, app: "market" });
  const folder = game.folders.find(f => f.type === "Item" && f.name === `${a.prefix}Market Shelf`)
    ?? await Folder.create({ name: `${a.prefix}Market Shelf`, type: "Item" });
  const names = [];
  for (let i = 1; i <= 6; i++) {
    const name = `${a.prefix}Shelf ${i}`;
    names.push(name);
    const item = game.items.getName(name);
    if (!item) await CONFIG.Item.documentClass.create({ name, type: "gear", folder: folder.id, system: { price: { market: 100 * i } } });
    else if (item.system.price.market !== 100 * i) await item.update({ "system.price.market": 100 * i });
  }
  await game.settings.set(MODULE, "market", { worldItems: true, worldFolder: folder.id, packs: [], ...a.classic, ...a.config });
  await game.actors.get(a.pc.id).update({ "system.wealth.value": 5000 });
  return names;
}, { pc, prefix, config, classic: CLASSIC });

/** This client's own view of today's stock (model.js `stock`): featured names, deals [name, price, off, was]. */
const picks = (c, gmView = false) => c.run(async a => {
  const m = await import(`/modules/${MODULE}/apps/market/model.js`);
  const s = await m.stock(m.marketConfig(), { gm: a.gmView });
  return { featured: s.featured.map(e => e.name).sort(), deals: s.deals.map(e => [e.name, e.price, e.off, e.was]) };
}, { gmView });

test("Featured and Hot Deals: the day's picks on the player's shop, the same on the host; a deal is charged at its price", async ({ gm, pl, pc, prefix }) => {
  await shelf(gm, pc, prefix, { featured: 2, deals: 2 });
  try {
    const host = await picks(gm);
    const mine = await picks(pl);
    same(JSON.stringify(mine), JSON.stringify(host), "the player and the host draw the same picks");
    check(host.featured.length === 2 && host.deals.length === 2, `2 featured, 2 deals: ${JSON.stringify(host)}`);
    const shown = await pl.run(async () => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="shop"]');
      await until(() => el("input[name=marketSearch]"), "the shop", 15000);
      await fill("input[name=marketSearch]", "");
      await until(() => el(".agent-market-deal"), "the Hot Deals carousel", 15000);
      const first = text(".agent-market-deal-main b");
      await tap('.agent-market-deal [data-action="market-deal"][data-step="1"]');
      const second = text(".agent-market-deal-main b");
      return { tiles: els(".agent-market-tile b").map(b => b.textContent).sort(), first, second, counter: text(".agent-market-deals .agent-info-label small") };
    });
    same(JSON.stringify(shown.tiles), JSON.stringify(host.featured), "Featured tiles");
    const dealNames = host.deals.map(d => d[0]).sort();
    check(shown.first !== shown.second && shown.counter === "2 of 2"
      && JSON.stringify([shown.first, shown.second].sort()) === JSON.stringify(dealNames),
    `the carousel steps through the day's deals ${JSON.stringify(dealNames)}: ${JSON.stringify(shown)}`);

    const [name, price, off, was] = host.deals.find(d => d[0] === shown.second);
    check(price < was && off >= 10, `a real discount: ${price} < ${was}`);
    const before = await wealth(gm, pc.id);
    const id = await pl.run(async () => {
      const known = new Set(Object.keys(store.apps.orders ?? {}));
      await tap('.agent-market-deal [data-action="market-add"]');
      await tap('[data-action="market-tab"][data-tab="cart"]');
      await tap('[data-action="market-order"]');
      return (await until(() => Object.values(store.apps.orders ?? {}).find(o => !known.has(o.id) && o.actorId === game.user.character.id), "the order")).id;
    });
    const line = await gm.run(a => store.apps.orders[a.id].lines[0], { id });
    check(line.name === name && line.price === price && line.off === off, `ordered at the deal price: ${JSON.stringify(line)}`);
    await gm.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="queue"]');
      await tap(`[data-market-order="${a.id}"] [data-action="market-approve"]`);
      await until(() => store.apps.orders[a.id]?.status === "approved", "approved");
    }, { id });
    same(await wealth(gm, pc.id), before - price, "charged the deal price");
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

test("the GM's Shop: hide an item and make one unavailable; the player's shop follows; all back on sale", async ({ gm, pl, pc, prefix }) => {
  const names = await shelf(gm, pc, prefix, { featured: 0, deals: 0 });
  const [hidden, off] = [names[0], names[1]];
  try {
    await gm.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="shop"]');
      await until(() => el("input[name=marketSearch]"), "the GM's shop", 15000);
      const row = n => els(".agent-market-list li").find(li => li.querySelector("b")?.textContent === n);
      await until(() => row(a.hidden), a.hidden);
      row(a.hidden).querySelector('[data-how="hide"]').click();
      await until(() => game.settings.get(MODULE, "market").blocked?.[game.items.getName(a.hidden).uuid] === "hide", "hidden saved");
      await until(() => row(a.off)?.querySelector('[data-how="off"]'), a.off);
      row(a.off).querySelector('[data-how="off"]').click();
      await until(() => game.settings.get(MODULE, "market").blocked?.[game.items.getName(a.off).uuid] === "off", "unavailable saved");
      await until(() => row(a.hidden)?.querySelector(".agent-market-block")?.textContent === "Hidden", "the GM still sees it, marked");
    }, { hidden, off });
    const seen = await pl.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="shop"]');
      const row = n => els(".agent-market-list li").find(li => li.querySelector("b")?.textContent === n);
      await until(() => el("input[name=marketSearch]"), "the shop", 15000);
      await fill("input[name=marketSearch]", "");
      await until(() => row(a.off)?.classList.contains("unavailable"), "the unavailable item, greyed", 15000);
      return { hidden: !!row(a.hidden), offText: row(a.off).textContent.includes("Unavailable"), offAdd: !!row(a.off).querySelector('[data-action="market-add"]') };
    }, { hidden, off });
    check(!seen.hidden && seen.offText && !seen.offAdd, `player view: ${JSON.stringify(seen)}`);
    const back = await gm.run(async () => {
      await tap('[data-action="market-unblock-all"]');
      await until(() => !Object.keys(game.settings.get(MODULE, "market").blocked ?? {}).length, "all back on sale");
      return true;
    });
    check(back, "all back on sale");
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

test("typed quantity in the cart; Re-order fills the cart again at today's price", async ({ gm, pl, pc, prefix }) => {
  const names = await shelf(gm, pc, prefix, { featured: 0, deals: 0 });
  const name = names[2];
  try {
    const id = await pl.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="shop"]');
      await until(() => el("input[name=marketSearch]"), "the catalogue", 15000);
      await fill("input[name=marketSearch]", a.name);
      (await until(() => els('[data-action="market-add"]').find(b => b.closest("li")?.textContent.includes(a.name)), a.name)).click();
      await tap('[data-action="market-tab"][data-tab="cart"]');
      await fill("input[name=marketQty]", "3");
      await until(() => /900/.test(text(".agent-market-total b") ?? ""), "the total for 3");
      const known = new Set(Object.keys(store.apps.orders ?? {}));
      await tap('[data-action="market-order"]');
      return (await until(() => Object.values(store.apps.orders ?? {}).find(o => !known.has(o.id) && o.actorId === game.user.character.id), "the order")).id;
    }, { name });
    same(await gm.run(a => store.apps.orders[a.id].lines[0].qty, { id }), 3, "three ordered");
    await gm.run(a => game.items.getName(a.name).update({ "system.price.market": 350 }), { name });
    const cart = await pl.run(async a => {
      await tap(`[data-market-order="${a.id}"] [data-action="market-cancel"]`);
      await until(() => store.apps.orders[a.id]?.status === "cancelled", "cancelled");
      await tap(`[data-market-order="${a.id}"] [data-action="market-reorder"]`);
      await until(() => el("input[name=marketQty]"), "the cart");
      return { qty: el("input[name=marketQty]").value, total: text(".agent-market-total b"), tab: !!el('[data-action="market-tab"][data-tab="cart"].active') };
    }, { id });
    check(cart.qty === "3" && cart.tab && /1,?050/.test(cart.total), `re-ordered at the new price: ${JSON.stringify(cart)}`);
  } finally {
    await gm.run(a => game.items.getName(a.name)?.update({ "system.price.market": 300 }), { name });
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

test("Great River: the delivery fee is charged, the drone flies, and Deliver now lands it in the gear", async ({ gm, pl, pc, prefix }) => {
  await ready(gm, pc, prefix, { pricing: "fee", deliveryFee: 20, deliveryPct: 10, delivery: "drone", etaMin: 45, etaMax: 45 });
  try {
    const before = await wealth(gm, pc.id);
    const id = await order(pl, `${prefix}Market Stim`, "drone it");
    const cart = await pl.run(async a => {
      await until(() => el(`[data-market-order="${a.id}"]`), "the order in Orders");
      return text(`[data-market-order="${a.id}"]`) + " | " + text(".agent-gr-banner");
    }, { id });
    check(/Delivery/.test(cart) && /GREAT RIVER/.test(cart), `the order shows its delivery fee under the Great River banner (${cart})`);

    await gm.run(async a => {
      await go("market");
      await tap('[data-action="market-tab"][data-tab="queue"]');
      await until(() => el(`[data-market-order="${a.id}"]`), "the order in the GM's queue");
      await tap(`[data-market-order="${a.id}"] [data-action="market-approve"]`);
      await until(() => store.apps.orders[a.id]?.status === "shipping", "the drone takes off");
    }, { id });
    same(await wealth(gm, pc.id), before - 40 - 24, "charged the item and the fee (20 + 10%)");
    const flying = await pl.run(async a => {
      await until(() => store.apps.orders[a.id]?.status === "shipping", "the player's phone hears it");
      await until(() => el(`[data-market-order="${a.id}"] .agent-gr-drone`), "the drone's track");
      return text(`[data-market-order="${a.id}"]`);
    }, { id });
    check(/Drone en route/i.test(flying) && /min/.test(flying), `the player watches the drone (${flying})`);
    same(await gm.run(a => game.actors.get(a.pc.id).items.filter(i => i.flags["cpr-sam-agent"]?.market?.orderId === a.id).length, { pc, id }), 0, "nothing in the gear yet");

    await gm.run(async a => {
      await until(() => el(`[data-market-order="${a.id}"] [data-action="market-deliver"]`), "Deliver now in Drones in the air");
      await tap(`[data-market-order="${a.id}"] [data-action="market-deliver"]`);
      await until(() => store.apps.orders[a.id]?.status === "approved", "delivered");
    }, { id });
    same(await gm.run(a => game.actors.get(a.pc.id).items.filter(i => i.flags["cpr-sam-agent"]?.market?.orderId === a.id).length, { pc, id }), 1, "the drone dropped it off");
  } finally {
    await gm.run(() => game.settings.set(MODULE, "market", {}));
  }
});

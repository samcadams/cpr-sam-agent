/*
 * CBK (id "cbk"): Black Chrome's Night Market app. The player's CBK searches for a database until the GM
 * pushes GO LIVE; then they browse the book-style categories, open a listing, BUY NOW!!! (charged at once, a
 * receipt, the last one sold out), and get the item only by showing the receipt at the booth. The GM makes a
 * market from one of Black Chrome's presets. The setup is put back at the end.
 */

import { check, same, test } from "./lib.mjs";

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });

/** CBK on (and installed), one offline market with one world item (stock 1), and money. Returns the old setup. */
const ready = (gm, pc, prefix) => gm.run(async a => {
  if (!api.feature("app_cbk")) await api.setFeature("app_cbk", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "cbk")) await api.pool.grant({ actor: a.pc.id, app: "cbk" });
  const name = `${a.prefix}CBK Pistol`;
  const item = game.items.getName(name) ?? await CONFIG.Item.documentClass.create({ name, type: "gear", system: { price: { market: 100 } } });
  const old = game.settings.get(MODULE, "cbk");
  await game.settings.set(MODULE, "cbk", { markets: [{
    id: "claudeLiveMkt01", letter: "C", name: `${a.prefix}Night Market`, fixer: "Molly Anderson", live: false, booths: { 4: "Weapons" },
    listings: [{ id: "claudeLiveLst01", uuid: item.uuid, name, img: item.img, type: "gear", corp: "Nova Arms", category: "weapons", sub: "Firearms", booths: ["C4"], price: 100, stock: 1 }]
  }] });
  // The stock left lives on the host (table cbkStock): drop what an earlier run left of this listing.
  store.request("cbk-restock", { marketId: "claudeLiveMkt01", listingId: "claudeLiveLst01", stock: null });
  await until(() => !store.apps.cbkStock?.["claudeLiveMkt01:claudeLiveLst01"], "the old stock row gone");
  // So does what an earlier run left of its auction, invites and Rex's game (this client is the host).
  for (const table of ["cbkAuctions", "cbkInvites", "cbkDeals"]) {
    for (const row of Object.values(store.apps[table])) if (row.marketId === "claudeLiveMkt01") delete store.apps[table][row.id];
  }
  store._pushApps();
  await game.actors.get(a.pc.id).update({ "system.wealth.value": 1000 });
  return old;
}, { pc, prefix });

test("CBK: searching until GO LIVE, then browse, BUY NOW!!!, sold out, and pick up at the booth", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  try {
    const searching = await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-searching"), "Searching for database");
      return text(".agent-cbk-searching");
    });
    check(/Searching for database/.test(searching), `offline: ${searching}`);

    await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-live"][data-market="claudeLiveMkt01"]');
      await until(() => game.settings.get(MODULE, "cbk").markets[0].live, "the market to go live");
    });

    const before = await wealth(gm, pc.id);
    const card = await pl.run(async a => {
      await until(() => el(".agent-cbk-tiles"), "the categories once the market is live", 10000);
      await tap('.agent-cbk-tile[data-cat="weapons"]');
      await until(() => el('[data-action="cbk-open"][data-listing="claudeLiveLst01"]'), "the listing in Weapons");
      await tap('[data-action="cbk-open"][data-listing="claudeLiveLst01"]');
      await until(() => el(".agent-cbk-buynow"), "BUY NOW!!!");
      const shown = text(".agent-cbk-card");
      await tap(".agent-cbk-buynow");
      await press(await dialog("Buy Now"), "Yes");
      await until(() => Object.values(store.apps.receipts ?? {}).some(r => r.listingId === "claudeLiveLst01" && r.actorId === a.pc.id && r.status === "paid"), "the receipt");
      await until(() => el(".agent-cbk-sold"), "SOLD OUT on the card");
      return shown;
    }, { pc });
    check(/Pick-up or Browse at Booth C4/.test(card) && /Premium/.test(card) && /BUY NOW!!!/.test(card), `the listing reads like the book (${card})`);
    same(await wealth(gm, pc.id), before - 100, "charged at once");
    const inGear = () => gm.run(a => game.actors.get(a.pc.id).items.filter(i => i.flags["cpr-sam-agent"]?.cbk?.receipt).filter(i => i.name.endsWith("CBK Pistol")).length, { pc });
    const had = await inGear();

    const picked = await pl.run(async () => {
      await tap('[data-action="cbk-receipts"]');
      await until(() => el('[data-action="cbk-pickup"]:not([disabled])'), "Show receipt at the booth");
      const receipt = text(".agent-cbk-receipt");
      await tap('[data-action="cbk-pickup"]:not([disabled])');
      await until(() => el(".agent-cbk-receipt.picked"), "picked up");
      return receipt;
    });
    check(/CBK-/.test(picked) && /Booth C4/.test(picked), `the receipt (${picked})`);
    same(await inGear(), had + 1, "the item is in their gear after the pick-up");

    // The GM restocks from Listings; the host sets the stock left, the player's card sells again.
    await gm.run(async () => {
      await tap('[data-action="cbk-gm-tab"][data-tab="listings"]');
      await until(() => el('input[data-cbk-listing="claudeLiveLst01"][data-field="stock"]'), "the stock field");
      await fill('input[data-cbk-listing="claudeLiveLst01"][data-field="stock"]', "2");
      await until(() => store.apps.cbkStock?.["claudeLiveMkt01:claudeLiveLst01"]?.stock === 2, "the host's stock row");
    });
    const restocked = await pl.run(async () => {
      await tap('[data-action="cbk-back"]'); // receipts → the listing card
      await until(() => el(".agent-cbk-stock") && !el(".agent-cbk-sold"), "2 left on the card", 10000);
      return text(".agent-cbk-stock");
    });
    check(/2 left/.test(restocked), `restocked (${restocked})`);
    same(await gm.run(() => game.settings.get(MODULE, "cbk").markets[0].listings[0].stock), 2, "the GM's value is saved in the setting too");
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: with the phone away a broadcast is a notification; the raid waits on the phone until the GM ends it", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  const send = (kind, text) => gm.run(async a => {
    await tap(`[data-action="cbk-compose"][data-market="claudeLiveMkt01"][data-kind="${a.kind}"]`);
    if (a.kind === "raid") await choose("cbkBcBy", "NCPD");
    await fill('[data-cbk-compose="text"]', a.text);
    await tap('[data-action="cbk-broadcast"][data-market="claudeLiveMkt01"]');
    return until(() => game.settings.get(MODULE, "cbk").markets[0].broadcasts?.find(b => b.kind === a.kind), `the ${a.kind} saved`);
  }, { kind, text });
  const away = async () => {
    await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk"), "CBK");
      await closePhone();
    });
  };
  const toast = words => pl.run(a => until(() => [...document.querySelectorAll("#ctp-toasts .ctp-toast")].find(t => t.textContent.includes(a.words))?.className, "the notification", 10000), { words });
  try {
    await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-live"][data-market="claudeLiveMkt01"]');
      await until(() => game.settings.get(MODULE, "cbk").markets[0].live, "the market to go live");
    });
    await away();
    const policy = await send("policy", "Keep it holstered");
    check(!!policy && /ctp-toast-agent/.test(await toast("Keep it holstered")), "a broadcast notifies while the phone is away");
    const raid = await send("raid", "Scatter now");
    check(/kind-raid/.test(await toast("Scatter now")), "the raid notifies too");
    same(await pl.run(() => !!document.querySelector(".agent-cbk-popup")), false, "nothing on the screen but the notification");

    const shown = await pl.run(async () => {
      await go("home");
      const box = await until(() => document.querySelector(".ctp-phone-app .window-content .agent-cbk-popup.raid"), "the raid on the phone, in any app", 10000);
      return box.textContent;
    });
    check(/Scatter now/.test(shown), "the raid is waiting when the phone comes out");

    await gm.run(a => tap(`[data-action="cbk-broadcast-end"][data-broadcast="${a.id}"]`), { id: raid.id });
    await pl.run(() => until(() => !document.querySelector(".agent-cbk-popup"), "the raid gone on All clear", 10000));
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: the GM makes a market from Black Chrome's preset C, matched to the compendiums", async ({ gm, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  try {
    const made = await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await choose("cbkNew", "C");
      const market = await until(() => game.settings.get(MODULE, "cbk").markets.find(m => m.letter === "C" && m.id !== "claudeLiveMkt01"), "the new market", 30000);
      await until(() => el(".agent-cbk-gm-listings li"), "its listings");
      return { name: market.name, count: market.listings.length, matched: market.listings.filter(l => l.uuid).length, live: market.live, rows: els(".agent-cbk-gm-listings li").length };
    });
    check(made.name === "Molly Anderson's Market" && made.count > 20 && !made.live, `preset C (${JSON.stringify(made)})`);
    check(made.matched > made.count / 2, `most listings found an item (${made.matched}/${made.count})`);
    same(made.rows, made.count, "every listing is on the GM's Listings tab");
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: the Fixer's broadcasts: a flash sale charged at BUY NOW, a raid warning on screen, the Alerts tab", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  const send = (kind, steps) => gm.run(async a => {
    await tap(`[data-action="cbk-compose"][data-market="claudeLiveMkt01"][data-kind="${a.kind}"]`);
    if (a.steps.target) await choose("cbkBcTarget", a.steps.target);
    if (a.steps.by) await choose("cbkBcBy", a.steps.by);
    if (a.steps.pct) await fill('[data-cbk-compose="pct"]', a.steps.pct);
    if (a.steps.text) await fill('[data-cbk-compose="text"]', a.steps.text);
    await tap('[data-action="cbk-broadcast"][data-market="claudeLiveMkt01"]');
    return until(() => game.settings.get(MODULE, "cbk").markets[0].broadcasts?.find(b => b.kind === a.kind), `the ${a.kind} saved`);
  }, { kind, steps });
  try {
    await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-live"][data-market="claudeLiveMkt01"]');
      await until(() => game.settings.get(MODULE, "cbk").markets[0].live, "the market to go live");
    });
    const flash = await send("flash", { target: "l:claudeLiveLst01", pct: "50" });
    check(flash.pct === 50 && flash.until > Date.now(), `flash sale saved (${JSON.stringify(flash)})`);

    const before = await wealth(gm, pc.id);
    const card = await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-tiles"), "the categories", 10000);
      // Sent while CBK was closed: the little popup waits for CBK to open.
      const popup = await until(() => document.querySelector(".ctp-phone-app .window-content .agent-cbk-popup.notice"), "the flash sale popup in CBK", 10000);
      if (!/Flash sale/.test(popup.textContent)) throw new Error(`popup says: ${popup.textContent}`);
      popup.click();
      await until(() => !document.querySelector(".agent-cbk-popup"), "the popup dismissed");
      await tap('.agent-cbk-tile[data-cat="weapons"]');
      await tap('[data-action="cbk-open"][data-listing="claudeLiveLst01"]');
      await until(() => el(".agent-cbk-flash"), "FLASH SALE on the card");
      const shown = text(".agent-cbk-card-head");
      await tap(".agent-cbk-buynow");
      await press(await dialog("Buy Now"), "Yes");
      await until(() => el(".agent-cbk-sold"), "bought (sold out)");
      return shown;
    });
    check(/50% off/.test(card) && /100/.test(card) && /50/.test(card), `old price struck, sale price shown (${card})`);
    same(await wealth(gm, pc.id), before - 50, "charged the flash sale price");

    await send("raid", { by: "hostiles", text: "Maelstrom at the gate" });
    const raid = await pl.run(async () => {
      const box = await until(() => document.querySelector(".agent-cbk-popup.raid"), "the raid overlay", 10000);
      const said = box.textContent.replace(/\s+/g, " ").trim();
      // On the phone's screen only.
      const onPhone = !!box.closest(".ctp-phone-app .window-content");
      const small = box.getBoundingClientRect().width < window.innerWidth / 2;
      box.click();
      await until(() => !document.querySelector(".agent-cbk-popup"), "the overlay dismissed");
      return { said, onPhone, small };
    });
    check(/RAID WARNING/.test(raid.said) && /Hostiles incoming! Maelstrom at the gate/.test(raid.said), `raid overlay (${raid.said})`);
    check(raid.onPhone && raid.small, `the raid stays on the phone (${JSON.stringify(raid)})`);

    const dismiss = () => pl.run(async () => {
      const box = await until(() => document.querySelector(".agent-cbk-popup.notice"), "the popup", 10000);
      const said = box.textContent;
      box.click();
      await until(() => !document.querySelector(".agent-cbk-popup"), "the popup dismissed");
      return said;
    });
    await send("policy", { text: "No drawn weapons" });
    check(/No drawn weapons/.test(await dismiss()), "the policy reminder pops up in CBK");
    await send("date", { text: "Next Friday, same place" });
    check(/Next Friday/.test(await dismiss()), "the next market date pops up in CBK");
    const alerts = await pl.run(async () => {
      await tap('[data-action="cbk-alerts"]');
      await until(() => els(".agent-cbk-alerts li").length >= 4, "four alerts");
      return els(".agent-cbk-alerts li").map(li => li.textContent.replace(/\s+/g, " ").trim());
    });
    check(/Next market/.test(alerts[0]) && /Policy reminder/.test(alerts[1]) && /Raid warning/.test(alerts[2]) && /Flash sale/.test(alerts[3]), `Alerts tab, newest first (${alerts.join(" | ")})`);

    // The GM ends the sale early: the price is back.
    await gm.run(async () => {
      const id = game.settings.get(MODULE, "cbk").markets[0].broadcasts.find(b => b.kind === "flash").id;
      await tap(`[data-action="cbk-broadcast-end"][data-broadcast="${id}"]`);
    });
    const after = await pl.run(async () => {
      await tap('[data-action="cbk-alerts"]'); // back to the card
      await until(() => el(".agent-cbk-card") && !el(".agent-cbk-flash"), "the sale gone from the card", 10000);
      return text(".agent-cbk-price");
    });
    check(!/50/.test(after.replace(/100/, "")), `full price again (${after})`);
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: an app sold through CBK installs on BUY NOW, can't be bought twice, and a refund uninstalls it", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  try {
    // WatchBox, taken off the character's Agent first (the row is put back at the end).
    const app = await gm.run(async a => {
      const id = "watchbox";
      if (!api.feature(`app_${id}`)) await api.setFeature(`app_${id}`, true);
      const saved = store.apps.installs?.[a.pc.id]?.[id] ?? null;
      // Uninstalled, not revoked: CBK refuses to sell a revoked app back (this client is the host).
      store._poolRow(a.pc.id, id, r => {
        delete r.revoked;
        r.removed = true;
      });
      await until(() => !api.pool.has(a.pc.id, id), "WatchBox off the Agent");
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-live"][data-market="claudeLiveMkt01"]');
      await tap('[data-action="cbk-gm-tab"][data-tab="listings"]');
      await choose("cbkAddApp", id);
      const l = await until(() => game.settings.get(MODULE, "cbk").markets[0].listings.find(x => x.app === id), "the app listing");
      return { id, listing: l.id, name: l.name, saved };
    }, { pc });

    const buy = () => pl.run(async a => {
      await go("cbk");
      for (let i = 0; i < 4 && !el(".agent-cbk-tiles"); i++) await tap('[data-action="cbk-back"]');
      await until(() => el(".agent-cbk-tiles"), `the categories (${text(".agent-cbk")?.slice(0, 120)}; listings ${JSON.stringify(game.settings.get(MODULE, "cbk").markets?.[0]?.listings.map(l => l.name))})`, 10000);
      await tap('.agent-cbk-tile[data-cat="apps"]');
      await tap(`[data-action="cbk-open"][data-listing="${a.app.listing}"]`);
      await until(() => el(".agent-cbk-buynow"), "BUY NOW!!!");
      const card = text(".agent-cbk-card");
      await tap(".agent-cbk-buynow");
      await press(await dialog("Buy Now"), "Yes");
      return card;
    }, { app });
    const card = await buy();
    check(/Installs on your Agent/.test(card), `no booth on an app (${card})`);
    const row = await gm.run(a => until(() => store.apps.installs?.[a.pc.id]?.[a.app.id]?.source === "cbk" && !store.apps.installs[a.pc.id][a.app.id].removed && store.apps.installs[a.pc.id][a.app.id], "installed from CBK"), { pc, app });
    check(row.source === "cbk", `install row (${JSON.stringify(row)})`);
    const receipts = () => gm.run(a => Object.values(store.apps.receipts).filter(r => r.listingId === a.app.listing && r.actorId === a.pc.id && r.status === "picked").length, { pc, app });
    same(await receipts(), 1, "one receipt");

    await buy();
    const refused = await gm.run(a => until(() => Object.values(store.apps.alerts).filter(x => x.actorId === a.pc.id).sort((x, y) => y.ts - x.ts)[0]?.text.match(/already on your Agent/), "the refusal"), { pc });
    check(!!refused, "double-buy refused");
    same(await receipts(), 1, "still one receipt");

    const gone = await gm.run(async a => {
      const r = Object.values(store.apps.receipts).find(x => x.listingId === a.app.listing && x.actorId === a.pc.id && x.status === "picked");
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="receipts"]');
      await tap(`[data-action="cbk-refund"][data-receipt="${r.id}"]`);
      await press(await dialog("refund"), "Yes");
      return until(() => !api.pool.has(a.pc.id, a.app.id) && store.apps.receipts[r.id].status === "refunded", "uninstalled");
    }, { pc, app });
    check(gone, "refund uninstalls");
    await gm.run(a => {
      // The character's own WatchBox row back as it was (this client is the host).
      store._poolRow(a.pc.id, a.app.id, r => {
        for (const k of Object.keys(r)) delete r[k];
        Object.assign(r, a.app.saved ?? { removed: true });
      });
    }, { pc, app });
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: the GM's page takes the app theme (red bar on black), the player's page stays the book's white", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  // The phone's skin classes swapped in place (no setting written), the computed look read, the classes put back.
  const looks = c => c.run(async () => {
    await go("cbk");
    const phone = await until(() => el(".agent-phone"), "the phone screen");
    const app = phone.closest(".ctp-phone-app");
    const was = app.className;
    const out = {};
    try {
      for (const skin of ["classic", "zetatech", "fieldTech", "dot"]) {
        app.className = was.replace(/\b(theme|skin)-\S+/g, "").trim() + ` theme-default skin-${skin}`;
        const page = el(".agent-cbk");
        out[skin] = {
          gm: page.classList.contains("agent-cbk-gm"),
          screen: getComputedStyle(phone, "::before").backgroundColor,
          tint: getComputedStyle(phone, "::before").backgroundImage,
          bar: el(".agent-app-bar") ? getComputedStyle(el(".agent-app-bar")).backgroundColor : null,
          page: getComputedStyle(page).backgroundColor,
          hero: getComputedStyle(page, "::before").backgroundImage
        };
      }
    } finally {
      app.className = was;
    }
    return out;
  });
  try {
    const g = await looks(gm);
    for (const skin of ["classic", "zetatech", "fieldTech"]) {
      check(g[skin].gm, `the GM sees the GM page (${skin})`);
      same(g[skin].screen, "rgb(18, 12, 12)", `GM page: the app's screen on ${skin}`);
      same(g[skin].bar, "rgb(206, 45, 36)", `GM page: CBK's red toolbar on ${skin}`);
      check(/206, 45, 36/.test(g[skin].hero), `GM page: the red header art on ${skin} (${g[skin].hero})`);
    }
    check(/240, 84, 72/.test(g.dot.tint), `GM page on a light skin: only the tint (${g.dot.tint})`);

    const p = await looks(pl);
    for (const skin of ["classic", "zetatech", "fieldTech", "dot"]) {
      check(!p[skin].gm, `the player sees the player page (${skin})`);
      same(p[skin].page, "rgb(255, 255, 255)", `player page: white on ${skin}`);
      check(p[skin].screen !== "rgb(18, 12, 12)" && !/240, 84, 72/.test(p[skin].tint), `player page: no app screen or tint on ${skin}`);
      check(!/206, 45, 36/.test(p[skin].hero), `player page: no header art on ${skin}`);
    }
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

/* Put these on the test market (the setting), then open the GM's Markets tab. */
const setMarket = (gm, change) => gm.run(async a => {
  const c = foundry.utils.deepClone(game.settings.get(MODULE, "cbk"));
  Object.assign(c.markets[0], a.change);
  await game.settings.set(MODULE, "cbk", c);
}, { change });
/** The GM taps GO LIVE / Go offline. */
const toggleLive = (gm, live) => gm.run(async a => {
  await go("cbk");
  await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
  await tap('[data-action="cbk-live"][data-market="claudeLiveMkt01"]');
  await until(() => game.settings.get(MODULE, "cbk").markets[0].live === a.live, "the market's switch");
}, { live });

test("CBK: an invite-only market: invisible without an invite, Upcoming offline, and passcode, card and courier all open it", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  const mynah = `${prefix}Ms. Mynah`;
  const hidden = () => pl.run(async () => {
    await go("cbk");
    await until(() => el(".agent-cbk-searching"), "searching: the market isn't there", 10000);
    return !el(".agent-cbk-tiles");
  });
  const inside = () => pl.run(async () => {
    await go("cbk");
    return !!(await until(() => el(".agent-cbk-tiles"), "the market's categories", 10000));
  });
  const give = via => gm.run(async a => {
    await go("cbk");
    await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
    await tap('[data-action="cbk-invite"][data-send="false"]');
    const d = await dialog("invite");
    inDialog(d, "[name=actor]", a.pc.id);
    inDialog(d, "[name=via]", a.via);
    await press(d, "Give invite");
    return until(() => game.actors.get(a.pc.id).items.find(i => i.flags[MODULE]?.cbkInvite === "claudeLiveMkt01")?.name, "the invite item");
  }, { pc, via });
  const takeBack = () => gm.run(async a => {
    const actor = game.actors.get(a.pc.id);
    await actor.deleteEmbeddedDocuments("Item", actor.items.filter(i => i.flags[MODULE]?.cbkInvite).map(i => i.id));
  }, { pc });
  try {
    await takeBack();
    await setMarket(gm, { access: { mode: "invite", passcode: "Zchat7" } });
    await toggleLive(gm, true);
    check(await hidden(), "a live invite-only market shows nothing without an invite");
    await pl.run(a => store.request("cbk-buy", { actorId: a.pc.id, marketId: "claudeLiveMkt01", listingId: "claudeLiveLst01" }), { pc });
    await gm.run(a => until(() => Object.values(store.apps.alerts).filter(x => x.actorId === a.pc.id).sort((x, y) => y.ts - x.ts)[0]?.text === "That listing is gone.", "the buy refused"), { pc });

    // Passcode: the GM's Send invite; a wrong code is refused, the right one opens it.
    await gm.run(async a => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-invite"][data-send="true"]');
      const d = await dialog("invite");
      inDialog(d, "[name=actor]", a.pc.id);
      inDialog(d, "[name=contact]", a.mynah);
      await press(d, "Send invite");
    }, { pc, mynah });
    const card = await pl.run(async a => {
      const offered = () => [...store.threads.values()].find(t => t.actorId === a.pc.id && t.contact === a.mynah && t.messages.some(m => m.cbk?.status === "offered"));
      const thread = await until(offered, "the invite in the conversation", 10000);
      AgentPhone.openThread(thread, "token");
      const field = "[data-cbk-code]";
      await until(() => el(field), "the passcode field");
      const said = el(field).closest(".agent-cbk-invite").textContent.replace(/\s+/g, " ").trim(); // the thread keeps earlier runs' cards
      await fill(field, "wrong");
      await tap('[data-action="cbk-invite-accept"]');
      await until(() => Object.values(store.apps.alerts).filter(x => x.actorId === a.pc.id).sort((x, y) => y.ts - x.ts)[0]?.text === "Wrong code.", "the refusal");
      await fill(field, "zchat7");
      await tap('[data-action="cbk-invite-accept"]');
      el(field).blur(); // a held redraw waits for focus to leave the field; a script's click doesn't move it
      await until(() => el(".agent-cbk-invite.accepted"), "accepted");
      return said;
    }, { pc, mynah });
    check(/Night Market/.test(card) && /CBK invite/.test(card), `the invite card (${card})`);
    check(await inside(), "the passcode opens the market");

    // Offline: Upcoming, the Fixer's name, no listings.
    await toggleLive(gm, false);
    const upcoming = await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-upcoming"), "Upcoming", 10000);
      return { text: text(".agent-cbk-upcoming"), tiles: !!el(".agent-cbk-tiles") };
    });
    check(/Night Market/.test(upcoming.text) && /Molly Anderson/.test(upcoming.text) && !upcoming.tiles, `Upcoming (${JSON.stringify(upcoming)})`);
    await toggleLive(gm, true);
    await gm.run(a => {
      delete store.apps.cbkInvites[`${a.pc.id}:claudeLiveMkt01`];
      store._pushApps();
    }, { pc });
    check(await hidden(), "without the passcode row it's gone again");

    // A card, then a courier invitation: access while it's carried.
    same(await give("card"), "Signed Playing Card", "the card");
    check(await inside(), "the card opens the market");
    await takeBack();
    check(await hidden(), "no card, no market");
    check(/^Courier Invitation: /.test(await give("courier")), "the courier invitation");
    check(await inside(), "the courier invitation opens the market");
    await takeBack();
    check(await hidden(), "taken from them: no market");
  } finally {
    await takeBack();
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: Message the Fixer opens the right conversation with Re: typed in and nothing sent; no contact, no button", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  const molly = `${prefix}Fixer Molly`;
  try {
    await toggleLive(gm, true);
    const none = await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-tiles"), "the categories", 10000);
      await tap('[data-action="cbk-alerts"]');
      await until(() => el(".agent-cbk-alerts"), "the Alerts tab");
      return !!el('[data-action="cbk-message-fixer"]');
    });
    same(none, false, "no Fixer contact: no button");

    await setMarket(gm, { fixerContact: molly });
    const before = await gm.run(a => [...store.threads.values()].filter(t => t.actorId === a.pc.id && t.contact === a.molly).reduce((n, t) => n + t.messages.length, 0), { pc, molly });
    const opened = await pl.run(async a => {
      await until(() => el('[data-action="cbk-message-fixer"]'), "the button", 10000);
      const p = await phone();
      await tap('[data-action="cbk-message-fixer"]');
      await until(() => p.app === "messages" && p.view?.contact === a.molly, "the conversation");
      const box = await until(() => el(".agent-compose textarea"), "the compose box");
      await until(() => box.isConnected ? box.value : el(".agent-compose textarea").value, "the typed-in text");
      return { contact: p.view.contact, draft: el(".agent-compose textarea").value };
    }, { molly });
    same(opened.contact, molly, "the market's Fixer");
    check(/^Re: .*Night Market/.test(opened.draft), `Re: the market (${opened.draft})`);
    const on = await gm.run(a => until(() => (game.actors.get(a.pc.id).getFlag(MODULE, "contacts") ?? []).some(c => c.name === a.molly), "the contact on their phone"), { pc, molly });
    check(on, "the contact was added");
    same(await gm.run(a => [...store.threads.values()].filter(t => t.actorId === a.pc.id && t.contact === a.molly).reduce((n, t) => n + t.messages.length, 0), { pc, molly }), before, "nothing was sent");
    // CBK is still on its Alerts panel behind the conversation: leave it at the categories for the next test.
    await pl.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-alerts"]');
    });
  } finally {
    await pl.run(() => closePhone());
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: two characters bid, the holds move, Sold! charges only the winner with a pick-up receipt; Cancel and offline give the hold back", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  // A second character of the same player, to bid against (by request: the page is the first one's).
  const rival = await gm.run(async a => {
    const name = `${a.prefix}CBK Rival`;
    const owner = game.users.find(u => !u.isGM && game.actors.get(a.pc.id).testUserPermission(u, "OWNER") && u.character?.id === a.pc.id)?.id;
    const actor = game.actors.getName(name) ?? await CONFIG.Actor.documentClass.create({ name, type: "character", ownership: { [owner]: 3 } });
    const agent = actor.items.getName("Agent") ?? (await actor.createEmbeddedDocuments("Item", [{ name: "Agent", type: "gear" }]))[0];
    await agent.update({ "system.equipped": "carried" }); // a new item is "owned": in storage, so no phone
    await actor.update({ "system.wealth.value": 30000, [`ownership.${owner}`]: 3 });
    return { id: actor.id };
  }, { pc, prefix });
  const bidAs = (id, amount) => pl.run(a => store.request("cbk-bid", { actorId: a.id, marketId: "claudeLiveMkt01", listingId: "claudeLiveLst01", amount: a.amount }), { id, amount });
  const start = () => gm.run(async () => {
    await go("cbk");
    await tap('[data-action="cbk-gm-tab"][data-tab="listings"]');
    await tap('[data-action="cbk-auction-start"][data-listing="claudeLiveLst01"]');
    const d = await dialog("auction");
    inDialog(d, "[name=reserve]", "5000");
    await press(d, "Start auction");
    await until(() => store.apps.cbkAuctions["claudeLiveMkt01:claudeLiveLst01"]?.status === "open", "the auction open");
  });
  try {
    await gm.run(async a => {
      const c = foundry.utils.deepClone(game.settings.get(MODULE, "cbk"));
      Object.assign(c.markets[0].listings[0], { price: 10000, stock: 3 });
      await game.settings.set(MODULE, "cbk", c);
      await game.actors.get(a.pc.id).update({ "system.wealth.value": 20000 });
      store.request("cbk-restock", { marketId: "claudeLiveMkt01", listingId: "claudeLiveLst01", stock: null });
    }, { pc });
    await toggleLive(gm, true);
    await start();

    // The player's card: reserve as the minimum, then their bid held at once.
    const card = await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-tiles"), "the categories", 10000);
      await tap('.agent-cbk-tile[data-cat="weapons"]');
      await tap('[data-action="cbk-open"][data-listing="claudeLiveLst01"]');
      await until(() => el(".agent-cbk-auction"), "the auction card");
      const shown = text(".agent-cbk-auction");
      const none = !el('[data-action="cbk-buy"]');
      await fill("input[data-cbk-bid]", "6000");
      el("input[data-cbk-bid]").blur();
      await tap('[data-action="cbk-bid"]');
      await press(await dialog("Bid"), "Yes");
      await until(() => /you/i.test(text(".agent-cbk-high")), "you're the high bidder", 10000);
      return { shown, none };
    });
    check(/5,?000/.test(card.shown) && card.none, `reserve shown, BUY NOW!!! off (${JSON.stringify(card)})`);
    same(await wealth(gm, pc.id), 14000, "the first bid is held");

    await bidAs(rival.id, 7000);
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 23000, "the rival's bid held"), rival);
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 20000, "the outbid hold back"), { id: pc.id });
    const shownHigh = await pl.run(() => until(() => /Bidder 2/.test(text(".agent-cbk-high")) && text(".agent-cbk-high"), "the other bidder by number", 10000));
    check(!/Rival/.test(shownHigh), `no name for the other bidder (${shownHigh})`);

    const sold = await gm.run(async a => {
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await until(() => el('[data-action="cbk-auction-sold"]'), "the bid list");
      const list = text(".agent-cbk-gm-auction");
      await tap('[data-action="cbk-auction-sold"]');
      await press(await dialog("Sold"), "Yes");
      const r = await until(() => Object.values(store.apps.receipts).find(x => x.actorId === a.id && x.status === "paid" && x.price === 7000 && x.listingId === "claudeLiveLst01"), "the winner's receipt");
      return { list, code: r.id, status: store.apps.cbkAuctions["claudeLiveMkt01:claudeLiveLst01"].status };
    }, rival);
    check(/Rival/.test(sold.list), `the GM sees who bid (${sold.list})`);
    same(sold.status, "sold", "sold");
    same(await wealth(gm, rival.id), 23000, "the winner paid from the hold, not again");
    same(await wealth(gm, pc.id), 20000, "the loser paid nothing");
    await gm.run(a => {
      store.apps.receipts[a.code].status = "refunded";
      store._pushApps();
    }, { code: sold.code });

    // Cancel gives the hold back.
    await start();
    await bidAs(pc.id, 6000);
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 14000, "held"), { id: pc.id });
    await gm.run(async () => {
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-auction-cancel"]');
      await press(await dialog("cancel auction"), "Yes");
    });
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 20000, "the hold back on Cancel"), { id: pc.id });

    // The market going offline gives it back, and bids are refused after.
    await start();
    await bidAs(pc.id, 6000);
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 14000, "held"), { id: pc.id });
    await toggleLive(gm, false);
    await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === 20000, "the hold back when the market closed"), { id: pc.id });
    await bidAs(pc.id, 9000);
    check(/over|broadcasting/.test(await gm.run(a => until(() => Object.values(store.apps.alerts).filter(x => x.actorId === a.id).sort((x, y) => y.ts - x.ts)[0]?.text.match(/over|broadcasting/)?.[0], "the refusal"), { id: pc.id })), "no bid while offline");
    same(await wealth(gm, pc.id), 20000, "nothing taken");
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

test("CBK: a player plays Rex's game, the GM resolves, a win discounts BUY NOW!!!, a second play is refused", async ({ gm, pl, pc, prefix }) => {
  const old = await ready(gm, pc, prefix);
  const deal = `claudeLiveMkt01:claudeLiveLst01:${pc.id}`;
  try {
    await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="listings"]');
      await until(() => el('[data-cbk-switch][data-field="rex"]'), "the Rex switch");
      el('[data-cbk-switch][data-field="rex"]').click();
      await until(() => game.settings.get(MODULE, "cbk").markets[0].game === "rex", "the switch saved");
    });
    await toggleLive(gm, true);
    await pl.run(async () => {
      await go("cbk");
      await until(() => el(".agent-cbk-tiles"), "the categories", 10000);
      await tap('.agent-cbk-tile[data-cat="weapons"]');
      await tap('[data-action="cbk-open"][data-listing="claudeLiveLst01"]');
      await tap('[data-action="cbk-rex-play"]');
      await until(() => /Rex is dealing/.test(text(".agent-cbk-rex")), "Rex is dealing", 10000);
    });
    const buttons = await gm.run(async a => {
      const card = await until(() => store.apps.gmCards[`cbk-rex:${a.deal}`], "the GM's card");
      const chat = game.messages.size;
      const random = Math.random;
      Math.random = () => 0.1;
      try {
        store.request("cbk-rex-resolve", card.actions[0].data);
        await until(() => store.apps.cbkDeals[a.deal].status === "won", "the win");
      } finally {
        Math.random = random;
      }
      await until(() => game.messages.size > chat, "the chat card");
      return { labels: card.actions.map(x => x.label), said: game.messages.contents.at(-1).content };
    }, { deal });
    same(buttons.labels, ["Coin flip", "Card draw"], "the GM's buttons");
    check(/Rex's game/.test(buttons.said) && /a win/.test(buttons.said), `the chat card (${buttons.said})`);

    const before = await wealth(gm, pc.id);
    const shown = await pl.run(async () => {
      await until(() => el(".agent-cbk-flash"), "REX'S DEAL on the card", 10000);
      const said = text(".agent-cbk-card-head");
      await tap(".agent-cbk-buynow");
      await press(await dialog("Buy Now"), "Yes");
      await until(() => el(".agent-cbk-sold"), "bought", 10000);
      return said;
    });
    check(/REX'S DEAL 20% off/.test(shown), `the card (${shown})`);
    same(await wealth(gm, pc.id), before - 80, "20% off 100");

    await pl.run(a => store.request("cbk-rex-play", { actorId: a.pc.id, marketId: "claudeLiveMkt01", listingId: "claudeLiveLst01" }), { pc });
    const refused = await gm.run(a => until(() => Object.values(store.apps.alerts).filter(x => x.actorId === a.pc.id).sort((x, y) => y.ts - x.ts)[0]?.text.match(/already played/), "the refusal"), { pc });
    check(!!refused, "a second play is refused");
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old ?? {}), { old });
  }
});

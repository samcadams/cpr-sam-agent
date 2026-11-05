/*
 * The phone apps' main flows, both sides: an Agent alert answered, Ask Alex, The Garden, Trauma Team's
 * panic button and dispatch, WatchBox from arming to the alarm, Notes, Calendar, a BangMe! pay point,
 * Gacha, Achieve!, a Combat Cabb booking and
 * Request Combat Cabb from a Map pin. (Each app opening cleanly is in startup; the canvas
 * games are in games.)
 */

import { check, same, test } from "./lib.mjs";

const skipUnless = async (gm, app) => {
  const on = await gm.run(a => api.feature(`app_${a.app}`), { app });
  if (!on) throw new Error(`the ${app} app is off in Control: switch it on to test it`);
};

test("Agent: the GM's alert pops up for the player with answers; their answer comes back with its tag", async ({ gm, pl, pc, tag }) => {
  await pl.run(() => closePhone());
  await gm.run(a => {
    window.__liveAnswer = null;
    Hooks.once("cpr-sam-agent.alertAnswered", ans => (window.__liveAnswer = ans));
    return api.alert({ to: a.pc.id, text: `${a.tag} book the table?`, choices: ["Book it", "Not now"], tag: a.tag });
  }, { pc, tag });
  await pl.run(async a => {
    const toast = await until(() => [...document.querySelectorAll(".ctp-toast-agent")].find(t => t.textContent.includes(a.tag)), "the Agent alert");
    const book = [...toast.querySelectorAll(".ctp-toast-action")].find(b => b.textContent.includes("Book it"));
    book.click();
  }, { tag });
  const ans = await gm.run(() => until(() => window.__liveAnswer, "the answer at the GM"));
  same([ans.choice ?? ans.text, ans.tag], ["Book it", tag], "the GM gets the answer and the alert's tag");
});

test("Ask Alex: the player's question crawls until the GM answers; the answer shows on their Agent", async ({ gm, pl, tag }) => {
  await skipUnless(gm, "alex");
  const question = `${tag} who runs the Afterlife?`;
  await pl.run(async a => {
    await go("alex");
    await fill("[name=alexQuery]", a.question);
    await tap("[data-action=alex-ask]");
    await until(() => /crawling/i.test(root().innerText), "Alex is crawling the Pool");
  }, { question });
  await gm.run(async a => {
    const q = await until(() => Object.values(store.apps.queries).find(q => q.text === a.question), "the question at the host");
    await go("alex");
    const box = await until(() => el(`textarea[data-query-id="${q.id}"]`), "the answer box");
    box.value = `${a.tag} Rogue does.`;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await tap(`[data-action="alex-answer"][data-query-id="${q.id}"]`);
  }, { question, tag });
  const shown = await pl.run(a => until(() => root().innerText.includes(`${a.tag} Rogue does.`), "the answer, word by word", 15000), { tag });
  check(shown, "the player reads Alex's answer");
});

test("The Garden: a GM post as a news account reaches the player's feed; the player posts back", async ({ gm, pl, tag }) => {
  await skipUnless(gm, "garden");
  await gm.run(a => api.garden.post({ as: "@ncpd_alerts", text: `${a.tag} gunfire in Watson` }), { tag });
  const r = await pl.run(async a => {
    await go("garden");
    await until(() => root().innerText.includes(`${a.tag} gunfire`), "the post in the feed", 10000);
    // An account first, if this character has none.
    if (el("[data-action=garden-join]")) {
      await tap("[data-action=garden-join]");
      const d = await until(() => [...document.querySelectorAll(".app.dialog")].at(-1), "the account dialog", 2000).catch(() => null);
      if (d) await press(d, [...d.querySelectorAll(".dialog-button")].at(0)?.textContent.trim() ?? "OK");
      await until(() => el("[name=gardenPost]"), "the composer");
    }
    await fill("[name=gardenPost]", `${a.tag} not it`);
    await tap("[data-action=garden-post]");
    return true;
  }, { tag });
  check(r, "posted");
  const posted = await gm.run(a => until(() => JSON.stringify(store.garden).includes(`${a.tag} not it`), "the player's post at the host"), { tag });
  check(posted, "the host has the player's post");
});

test("Trauma Team: a covered player's panic button reaches the GM; Dispatch shows them a countdown", async ({ gm, pl, pc, prefix }) => {
  await skipUnless(gm, "trauma");
  await gm.run(a => api.trauma.grant({ actor: a.pc.id, plan: "Silver", sponsor: `${a.prefix}Corp` }), { pc, prefix });
  try {
    await pl.run(async () => {
      const p = await go("trauma");
      p.ttTab = null; // as on a fresh phone (the phone shows an app where it was left)
      p.render();
      await until(() => el(".agent-tt-tabs .agent-tab:first-child.active[data-tab=medscan]"), "MedScan, the app's first page");
      await tap("[data-action=tt-tab][data-tab=coverage]");
      await until(() => /silver/i.test(root().innerText), "the plan on the Trauma Team page");
      await tap("[data-action=tt-call]");
      await until(() => /calling dispatch/i.test(root().innerText), "Calling dispatch…");
    });
    const id = await gm.run(async a => {
      const d = await until(() => Object.values(store.apps.dispatches).find(d => d.actorId === a.pc.id && d.status === "pending"), "the dispatch call");
      const card = await until(() => [...document.querySelectorAll(".ctp-toast")].find(t => t.textContent.toLowerCase().includes(a.pc.shown.toLowerCase()) && /panic/i.test(t.textContent)), "the GM's urgent card");
      [...card.querySelectorAll(".ctp-toast-action")].find(b => /dispatch/i.test(b.textContent)).click();
      await until(() => store.apps.dispatches[d.id].status === "enroute", "en route");
      return d.id;
    }, { pc });
    const countdown = await pl.run(() => until(() => /inbound/i.test(root().innerText) && /\d:\d\d/.test(root().innerText), "the countdown"));
    check(countdown, "the player sees the team inbound with a countdown");
    await gm.run(async a => {
      await go("trauma");
      await tap("[data-action=tt-tab][data-tab=coverage]");
      await tap(`[data-action="tt-dispatch"][data-dispatch-id="${a.id}"][data-status="closed"]`);
    }, { id });
  } finally {
    await gm.run(a => api.trauma.revoke(a.pc.id), { pc });
  }
});

test("Trauma Team: with no coverage, the panic button asks them to pay for a plan, then calls", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "trauma");
  await gm.run(async a => {
    await api.trauma.revoke(a.pc.id);
    for (const d of Object.values(store.apps.dispatches)) if (d.actorId === a.pc.id && d.status !== "closed") await store.request("tt-dispatch", { dispatchId: d.id, status: "closed" });
    const actor = game.actors.get(a.pc.id);
    if ((actor.system.wealth?.value ?? 0) < 2000) await actor.update({ "system.wealth.value": 5000 });
  }, { pc });
  try {
    const before = await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc });
    await pl.run(async () => {
      await go("trauma");
      await tap("[data-action=tt-tab][data-tab=coverage]");
      await until(() => /no coverage/i.test(root().innerText), "No coverage");
      await tap("[data-action=tt-call]");
      const d = await dialog("no coverage");
      inDialog(d, "select[name=tier]", "silver");
      await press(d, "call");
      await until(() => /calling dispatch/i.test(root().innerText), "Calling dispatch…");
    });
    const d = await gm.run(a => until(() => Object.values(store.apps.dispatches).find(d => d.actorId === a.pc.id && d.status === "pending")), { pc });
    check(d.covered && d.tier === "silver", "Dispatch has the call, as a Silver member");
    // From the API: importing model.js would load a second copy of it beside the bundle's, never handed billing.
    const billed = await gm.run(() => api.trauma.billedBy());
    same(before - (await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc })), billed ? 0 : 500, billed ? `billed by ${billed}: nothing charged here` : "the first month of Silver paid");
    await gm.run(a => store.request("tt-dispatch", { dispatchId: a.id, status: "closed" }), { id: d.id });
  } finally {
    await gm.run(a => api.trauma.revoke(a.pc.id), { pc });
  }
});

test("WatchBox: arm (confirmed), the GM ends assessing, triggers the alarm; the player disarms in person", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "watchbox");
  await pl.run(async () => {
    await go("watchbox");
    await tap("[data-action=wb-arm]");
    await press(await dialog("WatchBox"), "Yes");
    await until(() => /assessing/i.test(root().innerText), "ASSESSING on the phone");
  });
  try {
    await gm.run(async a => {
      await go("watchbox");
      await tap(`[data-action="wb-skip"][data-actor-id="${a.pc.id}"]`);
      await until(() => api.watchbox.status(a.pc.id) === "armed", "armed");
      await api.watchbox.trigger(a.pc.id);
      await until(() => api.watchbox.status(a.pc.id) === "alarm", "the alarm");
    }, { pc });
    await pl.run(async () => {
      await until(() => /intrusion/i.test(root().innerText), "INTRUSION on the phone");
      await tap("[data-action=wb-disarm]");
    });
    const st = await gm.run(a => until(() => api.watchbox.status(a.pc.id) === "off" && "off", "disarmed"), { pc });
    same(st, "off", "picked up, WatchBox is off");
  } finally {
    await gm.run(a => api.watchbox.status(a.pc.id) !== "off" && store.request("wb-disarm", { actorId: a.pc.id }), { pc });
  }
});

test("Notes: a new note is saved as a page in the character's journal", async ({ gm, pl, prefix, tag }) => {
  await skipUnless(gm, "notes");
  const title = `${prefix}Note ${tag}`;
  await pl.run(async a => {
    await go("notes");
    if (el("[data-action=note-back]")) await tap("[data-action=note-back]"); // left open on a note
    await tap("[data-action=note-new]");
    // The host makes the page first (players can't create journal entries); type once its editor is up.
    await until(() => el("[name=noteTitle]")?.value, "the new note's editor");
    await sleep(500);
    await fill("[name=noteTitle]", a.title);
    await fill("[name=noteText]", "line one\nline two");
    await tap("[data-action=note-save]");
    await until(() => root().innerText.toLowerCase().includes(a.title.toLowerCase()) && el("[data-action=note-edit]"), "the saved note");
  }, { title });
  const html = await gm.run(a => until(() => game.journal.contents.flatMap(j => j.pages.contents).find(p => p.name === a.title)?.text.content, "the journal page"), { title });
  same(html, "<p>line one</p><p>line two</p>", "the page holds the note's lines");
});

test("Notes: a player given the character after its journal was made becomes an owner and can write", async ({ gm, pl, pc, lane }) => {
  await skipUnless(gm, "notes");
  await pl.run(async () => {
    await go("notes");
    if (el("[data-action=note-back]")) await tap("[data-action=note-back]"); // left open on a note
    await until(() => el("[data-action=note-new]"), "the new-note button");
    (await phone())._notesAsked = null; // an earlier run's ask
  });
  const owner = await gm.run(async a => {
    const user = game.users.getName(a.player);
    const entry = game.journal.find(j => j.getFlag("cpr-sam-agent", "notesFor") === a.pc.id);
    await entry.update({ [`ownership.-=${user.id}`]: null });
    return until(() => entry.ownership[user.id], "the host's grant");
  }, { pc, player: `ClaudePlayer${lane}` });
  same(owner, 3, "the player owns the journal again");
  check(await pl.run(() => until(() => el("[data-action=note-new]"), "the new-note button")), "the player can write notes");
});

test("Calendar: a note added on today is a Simple Calendar note the GM can see", async ({ gm, pl, prefix, tag }) => {
  await skipUnless(gm, "calendar");
  const title = `${prefix}Cal ${tag}`;
  await pl.run(async a => {
    await go("calendar");
    await tap("[data-action=cal-today]");
    await tap("[data-action=cal-add]");
    await fill("[name=calTitle]", a.title);
    await tap("[data-action=cal-note-save]");
    await until(() => root().innerText.includes(a.title), "the note under the day");
  }, { title });
  const made = await gm.run(a => until(() => game.journal.getName(a.title), "the Simple Calendar note"), { title });
  check(made, "the host made the note");
});

test("BangMe!: an open pay point is listed; paying for an item debits the sheet; a closed one is hidden", async ({ gm, pl, pc, prefix }) => {
  await skipUnless(gm, "bangme");
  const id = `${prefix.trim().toLowerCase()}kiosk`;
  await gm.run(async a => {
    const points = game.settings.get(MODULE, "payPoints").filter(p => p.id !== a.id);
    points.push({ id: a.id, name: `${a.prefix}Kiosk`, img: "", open: true, items: [{ label: "Coffee", amount: 7 }], goods: [] });
    await game.settings.set(MODULE, "payPoints", points);
  }, { id, prefix });
  const before = await gm.run(a => game.actors.get(a.id).system.wealth.value, { id: pc.id });
  await pl.run(async a => {
    await go("bangme");
    await tap(`[data-action="paypoint-pay"][data-point-id="${a.id}"]`);
    const d = await dialog(`${a.prefix}Kiosk`);
    inDialog(d, "select[name=pick]", "i0");
    await press(d, "Pay");
  }, { id, prefix });
  const after = await gm.run(a => until(() => game.actors.get(a.pc.id).system.wealth.value !== a.before && game.actors.get(a.pc.id).system.wealth.value, "the payment"), { pc, before });
  same(before - after, 7, "the Coffee is paid from the sheet");

  await gm.run(async a => {
    const points = game.settings.get(MODULE, "payPoints").map(p => (p.id === a.id ? { ...p, open: false } : p));
    await game.settings.set(MODULE, "payPoints", points);
  }, { id });
  const hidden = await pl.run(a => until(() => !el(`[data-action="paypoint-pay"][data-point-id="${a.id}"]`), "the closed pay point to go"), { id });
  check(hidden, "a closed pay point isn't offered");
});

test("BangMe!: the GM invoices a player, who pays on BangMe!; the player invoices the GM, who pays; without the app, the Agent says to install it", async ({ gm, pl, pc, prefix }) => {
  await skipUnless(gm, "bangme");
  const wealth = () => gm.run(a => game.actors.get(a.id).system.wealth.value, { id: pc.id });
  const memo = `${prefix}Rent ${Date.now()}`;
  await gm.run(async a => {
    await game.actors.get(a.id).update({ "system.wealth.value": Math.max(game.actors.get(a.id).system.wealth.value, 500) });
    await go("bangme");
    await tap('[data-action="invoice-new"]');
    const d = await dialog("New invoice");
    inDialog(d, "input[name=fromName]", "CPR HQ");
    inDialog(d, "select[name=target]", a.id);
    inDialog(d, "input[name=amount]", "40");
    inDialog(d, "input[name=memo]", a.memo);
    await press(d, "Send");
    await until(() => Object.values(store.apps.invoices).some(i => i.memo === a.memo), "the invoice on the host");
  }, { id: pc.id, memo });
  const before = await wealth();
  const shown = await pl.run(async a => {
    await go("bangme");
    return until(() => [...document.querySelectorAll('[data-action="invoice-answer"][data-answer="pay"]')].find(b => b.closest("li").textContent.includes(a.memo)), "the invoice on the phone") && text(".agent-info");
  }, { memo });
  check(shown.includes("From CPR HQ"), "the player sees who billed them");
  await pl.run(async a => {
    const id = Object.values(store.apps.invoices).find(i => i.memo === a.memo).id;
    await tap(`[data-action="invoice-answer"][data-invoice-id="${id}"][data-answer="pay"]`);
  }, { memo });
  await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value === a.want, "the payment"), { id: pc.id, want: before - 40 });

  const expenses = `${prefix}Expenses ${Date.now()}`;
  await pl.run(async a => {
    await tap('[data-action="invoice-new"]');
    const d = await dialog("New invoice");
    inDialog(d, "select[name=target]", "gm");
    inDialog(d, "input[name=amount]", "15");
    inDialog(d, "input[name=memo]", a.memo);
    await press(d, "Send");
  }, { memo: expenses });
  await gm.run(async a => {
    const invoice = await until(() => Object.values(store.apps.invoices).find(i => i.memo === a.memo), "the player's invoice");
    await until(() => el(`[data-action="invoice-answer"][data-invoice-id="${invoice.id}"][data-answer="pay"]`), "Pay on the GM's BangMe!");
    await tap(`[data-action="invoice-answer"][data-invoice-id="${invoice.id}"][data-answer="pay"]`);
    await until(() => game.actors.get(a.id).system.wealth.value === a.want, "the GM's payment");
  }, { id: pc.id, want: before - 40 + 15, memo: expenses });

  // No BangMe! on the Agent, App Store on: the Agent's notice, and the invoice waits.
  const notice = await gm.run(async a => {
    const features = game.settings.get(MODULE, "features");
    const installs = store.apps.installs[a.id];
    await game.settings.set(MODULE, "features", { ...features, app_pool: true });
    store.apps.installs[a.id] = { ...installs, bangme: { ...installs?.bangme, removed: true } };
    try {
      store.request("invoice-send", { targetId: a.id, fromName: "CPR HQ", amount: 5, memo: a.memo });
      const alert = await until(() => Object.values(store.apps.alerts).find(x => x.actorId === a.id && x.ts > a.since && x.app === "pool"), "the install notice");
      return { text: alert.text, status: Object.values(store.apps.invoices).find(i => i.memo === a.memo).status };
    } finally {
      if (installs) store.apps.installs[a.id] = installs;
      else delete store.apps.installs[a.id];
      store._pushApps();
      await game.settings.set(MODULE, "features", features);
    }
  }, { id: pc.id, memo: `${prefix}Nudge ${Date.now()}`, since: Date.now() - 1000 });
  same(notice.text, "Someone is trying to invoice us. We should install BangMe! from the app store.", "the install notice");
  same(notice.status, "pending", "the invoice waits");
});

test("Gacha: buying zCreds costs eurobucks; a pull puts a capsule on the shelf", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "gacha");
  const before = await gm.run(a => ({ eb: game.actors.get(a.pc.id).system.wealth.value, shelf: (store.apps.gachaShelves?.[a.pc.id] ?? []).length }), { pc });
  await pl.run(async () => {
    await go("gacha");
    const id = game.user.character.id;
    const before = Number(store.apps.gachaCreds?.[id]) || 0;
    // The second bundle covers a pull.
    await tap('[data-action="gacha-buy"][data-bundle="1"]');
    await press(await dialog("Buy zCreds"), "Yes");
    await until(() => (Number(store.apps.gachaCreds?.[id]) || 0) > before, "the zCreds");
    await tap('[data-action="gacha-pull"]');
  });
  const after = await gm.run(a => until(() => {
    const shelf = (store.apps.gachaShelves?.[a.pc.id] ?? []).length;
    return shelf > a.before.shelf && { eb: game.actors.get(a.pc.id).system.wealth.value, shelf };
  }, "the capsule on the shelf", 15000), { pc, before });
  check(after.eb < before.eb, "zCreds are paid for in eurobucks");
  same(after.shelf, before.shelf + 1, "one more on the shelf");
});

test("Gacha: dropped Legendary rewards are what Make it real offers first; with none it asks for any item", async ({ gm, pc, prefix, tag }) => {
  const name = `${prefix}Reward ${tag}`;
  await skipUnless(gm, "gacha");
  const out = await gm.run(async a => {
    const patch = async change => {
      const cfg = foundry.utils.deepClone(game.settings.get(MODULE, "gachaConfig") ?? {});
      change(cfg);
      await game.settings.set(MODULE, "gachaConfig", cfg);
    };
    const pull = (store.apps.gachaShelves?.[a.pc.id] ?? []).find(p => !p.real);
    if (!pull) throw new Error("no pull left on the shelf to make real");
    await CONFIG.Item.documentClass.create({ name: a.name, type: "gear" });
    const item = game.items.getName(a.name);
    const saved = () => game.settings.get(MODULE, "gachaConfig")?.legendaryRewards ?? [];
    const drop = () => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
      el(".agent-gacha-rewards").dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    };
    const makeReal = `[data-action="gacha-real"][data-pull-id="${pull.id}"]`;
    try {
      await patch(cfg => (cfg.legendaryRewards = []));
      await go("gacha");

      // No rewards: the dialog as it always was.
      await tap('[data-action="gacha-tab"][data-tab="shelf"]');
      await tap(makeReal);
      let d = await dialog("Make it real");
      const none = { reward: !!d.querySelector("select[name=reward]"), search: !!d.querySelector("select[name=uuid]") && !d.querySelector("[data-show-if]") };
      await Object.values(ui.windows).find(w => w.element?.[0] === d).close();

      // Dropping an item adds it, once.
      await tap('[data-action="gacha-tab"][data-tab="pull"]');
      drop();
      await until(() => saved().length === 1, "the dropped reward");
      await until(() => els(".agent-gacha-rewards .agent-app-item").length === 1, "the reward on the page");
      drop();
      await sleep(300);
      const count = saved().length;

      // Rewards: they come first, any item stays behind the last option.
      await tap('[data-action="gacha-tab"][data-tab="shelf"]');
      await tap(makeReal);
      d = await dialog("Make it real");
      const options = [...d.querySelectorAll("select[name=reward] option")].map(o => o.textContent);
      const row = d.querySelector('[data-show-if="uuid"]');
      const hidden = row.style.display === "none";
      inDialog(d, "select[name=reward]", "any");
      const shown = row.style.display !== "none";
      inDialog(d, "select[name=reward]", item.uuid);
      await press(d, "Give");
      const real = await until(() => store.apps.gachaShelves[a.pc.id].find(p => p.id === pull.id).real, "the pull made real");
      const onSheet = await until(() => game.actors.get(a.pc.id).items.getName(item.name), "the reward on the sheet");

      // Removing it empties the list.
      await tap('[data-action="gacha-tab"][data-tab="pull"]');
      await tap(`[data-action="gacha-reward-remove"][data-uuid="${item.uuid}"]`);
      await until(() => !saved().length, "the reward removed");
      return { none, count, options, hidden, shown, real: real.name, onSheet: !!onSheet };
    } finally {
      await patch(cfg => delete cfg.legendaryRewards);
    }
  }, { pc, name });
  same(out.none, { reward: false, search: true }, "with no rewards, only the search over every item");
  same(out.count, 1, "the same item isn't added twice");
  same(out.options, [name, "Pick any item…"], "the rewards, then any item");
  check(out.hidden && out.shown, "the search over every item appears only on Pick any item");
  same(out.real, name, "the pull remembers what it became");
  check(out.onSheet, "the reward is on the sheet");
});

test("Gacha duplicates: spares show as a C level on the shelf; selling one lowers it", async ({ gm, pl, pc, prefix, tag }) => {
  await skipUnless(gm, "gacha");
  const cid = `spare-${tag}`;
  const name = `${prefix}Spare ${tag}`;
  await gm.run(a => {
    const data = store._gachaDraft();
    (data.shelves[a.pc.id] ??= []).push(...[0, 1, 2].map(i => ({ id: foundry.utils.randomID(), cid: a.cid, name: a.name, rarity: "common", icon: "fa-cube", img: "", ts: Date.now() + i, real: null })));
    store._gachaSave(data);
  }, { pc, cid, name });
  try {
    const out = await pl.run(async a => {
      const tile = () => els(".agent-gacha-tile").find(t => t.title.includes(a.name));
      await go("gacha");
      await tap('[data-action="gacha-tab"][data-tab="shelf"]');
      await until(tile, "the collectible on the shelf");
      const before = tile().querySelector("b").textContent;
      await tap(`[data-action="gacha-pick"][data-pull-id="${tile().dataset.pullId}"]`);
      const sell = `[data-action="gacha-sell"][data-cid="${a.cid}"]`;
      await until(() => el(sell), "the sell button");
      const label = text(sell);
      await tap(sell);
      await until(() => tile()?.querySelector("b")?.textContent === "C1", "the level to drop");
      return { before, label };
    }, { cid, name });
    same(out.before, "C2", "three copies are C2");
    check(out.label.includes("(to C1)"), `the sell button says what it costs: ${out.label}`);
  } finally {
    await gm.run(a => {
      const data = store._gachaDraft();
      data.shelves[a.pc.id] = data.shelves[a.pc.id].filter(p => p.cid !== a.cid);
      store._gachaSave(data);
    }, { pc, cid });
  }
});

test("Gacha pictures: an old pull takes its collectible's on the shelf and in chat; a pull shows its own in the show and the reveal", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "gacha");
  // An old pull (it stored no picture), and enough to pull a guaranteed Legendary.
  const saved = await gm.run(a => {
    const data = store._gachaDraft();
    const saved = { pity: data.pity[a.pc.id] ?? {}, creds: data.creds[a.pc.id] ?? 0, shelf: (data.shelves[a.pc.id] ?? []).map(p => p.id) };
    (data.shelves[a.pc.id] ??= []).push({ id: foundry.utils.randomID(), cid: "whole-tree", name: "A Whole Tree", rarity: "legendary", icon: "fa-tree", img: "", ts: Date.now(), real: null });
    data.pity[a.pc.id] = { sinceEpic: 0, sinceLegendary: 89 };
    data.creds[a.pc.id] = 160;
    store._gachaSave(data);
    return saved;
  }, { pc });
  try {
    const out = await pl.run(async () => {
      const loaded = async (img, what) => {
        await until(() => img.complete, `${what} to load`);
        return { src: img.getAttribute("src"), width: img.naturalWidth };
      };
      await go("gacha");
      await tap('[data-action="gacha-tab"][data-tab="shelf"]');
      const tile = await until(() => els(".agent-gacha-tile").find(t => t.title.includes("A Whole Tree")), "the old pull on the shelf");
      const onShelf = await loaded(tile.querySelector("img"), "its tile");
      await tap(`[data-action="gacha-pick"][data-pull-id="${tile.dataset.pullId}"]`);
      const picked = await loaded(await until(() => el(".agent-gacha-reveal > img"), "the picked one"), "its card");
      const sent = game.messages.size;
      await tap('[data-action="gacha-show"]');
      const card = await until(() => game.messages.size > sent && [...document.querySelectorAll("#chat-log .ctp-gacha-chat")].at(-1), "the show-off in chat");
      const inChat = await loaded(card.querySelector("img"), "the chat card");
      await tap('[data-action="gacha-tab"][data-tab="pull"]');
      await tap('[data-action="gacha-pull"]');
      const show = await loaded(await until(() => document.querySelector(".ctp-gacha-show .ctp-gs-item > img"), "the picture in the show", 15000), "the show");
      const reveal = await loaded(await until(() => !document.querySelector(".ctp-gacha-show") && el(".agent-gacha-reveal > img"), "the reveal", 15000), "the reveal");
      return { onShelf, picked, inChat, show, reveal };
    });
    const tree = "modules/cpr-sam-agent/images/gacha/whole-tree.webp";
    for (const where of ["onShelf", "picked", "inChat"]) {
      same(out[where].src, tree, `the old pull's picture: ${where}`);
      check(out[where].width > 0, `it loads: ${where}`);
    }
    for (const where of ["show", "reveal"]) {
      check(/images\/gacha\/[\w-]+\.webp$/.test(out[where].src), `the Legendary's picture: ${where}: ${out[where].src}`);
      check(out[where].width > 0, `it loads: ${where}`);
    }
  } finally {
    await gm.run(a => {
      const data = store._gachaDraft();
      data.shelves[a.pc.id] = data.shelves[a.pc.id].filter(p => a.saved.shelf.includes(p.id));
      data.pity[a.pc.id] = a.saved.pity;
      data.creds[a.pc.id] = a.saved.creds;
      store._gachaSave(data);
    }, { pc, saved });
  }
});

test("Achieve!: the GM awards an achievement; the player has it", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "achieve");
  const awarded = await gm.run(async a => {
    await go("achieve");
    await choose("achActor", a.pc.id);
    // One this character hasn't earned yet; if they have them all, take one back first.
    const { achievementList } = await import(`/modules/${MODULE}/apps/achieve/model.js`);
    const earned = store.apps.earned?.[a.pc.id] ?? {};
    const list = achievementList().filter(x => !x.disabled);
    let ach = list.find(x => !earned[x.id]);
    if (!ach) {
      ach = list[0];
      store.request("achieve-revoke", { actorId: a.pc.id, id: ach.id });
      await until(() => !store.apps.earned?.[a.pc.id]?.[ach.id], "the achievement taken back");
    }
    await tap(`[data-action=achieve-open][data-id="${ach.id}"]`);
    await tap(`[data-action=achieve-award][data-id="${ach.id}"]`);
    const d = await dialog("Award");
    for (const box of d.querySelectorAll("input[type=checkbox]")) box.checked = box.name === `pc_${a.pc.id}`;
    await press(d, "Award");
    return ach.id;
  }, { pc });
  check(awarded, "found an achievement to award");
  const has = await pl.run(a => until(() => store.apps.earned?.[a.pc.id]?.[a.awarded], "the award on the player's side"), { pc, awarded });
  check(has, "the player's Achieve! has it");
});

/**
 * A Map pin every player sees, for a spec (the default Map shows players only the district names): the GM adds it
 * through the host near a district's name, and the player's phone has it (just after the host changes, a player's
 * client may still be catching up). Its id; take it away with `unpin`.
 */
const sharedPin = async (gm, pl, prefix) => {
  const id = await gm.run(async a => {
    const rows = Object.values(store.apps.mapPins ?? {});
    const near = rows.find(r => r.type === "district" && r.name === "Watson") ?? rows.find(r => r.type === "district") ?? { x: 5000, y: 5000 };
    const pinId = foundry.utils.randomID(16);
    store.request("map-pin", { op: "add", pin: { id: pinId, name: `${a.prefix}Spec stop`, x: near.x + 300, y: near.y + 250, everyone: true, type: "bar", typeLabel: "Bar" } });
    await until(() => store.apps.mapPins?.[pinId], "the spec's pin");
    return pinId;
  }, { prefix });
  await pl.run(a => until(() => store.apps.mapPins?.[a.id] && "got", "the spec's pin on the player's phone", 20000), { id });
  return id;
};
const unpin = (gm, id) => gm.run(a => store.request("map-pin", { op: "delete", id: a.id }), { id });

/** The player taps a place on Cabb's map and books the trip (confirming the dialog). Returns the dialog's text. */
const bookCabb = pl => pl.run(async () => {
  const p = await go("cabb");
  // A pin on Cabb's map (the Map's NavMap): a tap is a pointer down and up over a pin that shows, not the pickup.
  const nav = await until(() => el(".agent-cabb-navmap .agent-navmap-stage") && el(".agent-cabb-navmap"), "Cabb's map");
  // No trip left from an earlier spec (Request Combat Cabb picks where to): the map then shows every place, so
  // with few shared pins the one to tap isn't off screen.
  if (p.cabbTo) {
    p.cabbTo = null;
    p.render();
    await sleep(400);
  }
  const box = nav.getBoundingClientRect();
  const at = await until(() => els(".agent-cabb-navmap .agent-navmap-pin:not(.big, .crew-here, .cabb-from)").map(pin => {
    const b = pin.querySelector(".agent-navmap-dot").getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const inside = x > box.left + 30 && x < box.right - 40 && y > box.top + 30 && y < box.bottom - 30;
    return inside && document.elementFromPoint(x, y)?.closest(".agent-navmap-pin") === pin ? { x, y } : null;
  }).find(Boolean), "a place to go on the map");
  for (const type of ["pointerdown", "pointerup"]) nav.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, pointerId: 7, isPrimary: true, button: 0 }));
  await until(() => el(".agent-cabb-navmap .agent-navmap-routeline.own"), "the trip drawn on the map");
  await tap("[data-action=cabb-book]");
  const d = await until(() => [...document.querySelectorAll(".app.dialog")].at(-1), "the booking confirm");
  const text = d.innerText;
  await press(d, "Yes");
  return text;
});

test("Combat Cabb: the player books a ride to a place; the GM gets the booking; cancelling ends it", async ({ gm, pl, pc, prefix }) => {
  await skipUnless(gm, "cabb");
  const stop = await sharedPin(gm, pl, prefix);
  try {
    await bookCabb(pl);
    // A ride is live while en route, waiting or riding (then arrived, cancelled or declined).
    const ride = await gm.run(a => until(() => Object.values(store.apps.rides ?? {}).find(r => r.actorId === a.pc.id && ["enroute", "waiting", "riding"].includes(r.status)), "the ride at the host"), { pc });
    check(ride, "the host has the booking");
    await pl.run(async () => {
      await tap("[data-action=cabb-cancel]");
      const d = await until(() => [...document.querySelectorAll(".app.dialog")].at(-1), "the cancel confirm", 2000).catch(() => null);
      if (d) await press(d, "Yes");
    });
    const ended = await gm.run(a => until(() => store.apps.rides[a.id]?.status === "cancelled" && "cancelled", "the ride to be cancelled"), { id: ride.id });
    same(ended, "cancelled", "the ride is cancelled");
  } finally {
    await unpin(gm, stop);
  }
});

test("Combat Cabb: a Fresh Food Lifestyle (cpr-hq) makes the ride free; cancelling gives the credit back", async ({ gm, pl, pc, prefix }) => {
  await skipUnless(gm, "cabb");
  const hq = await gm.run(() => !!game.modules.get("cpr-hq")?.active && !!game.modules.get("cpr-hq").api?.lifestyle?.of);
  if (!hq) throw new Error("cpr-hq (with api.lifestyle.of) isn't active: the Lifestyle credit needs it");
  const before = await gm.run(async a => {
    const actor = game.actors.get(a.pc.id);
    const life = foundry.utils.deepClone(actor.system.lifestyle.lifeStyle);
    const fresh = { description: game.i18n.localize("CPRHQ.Lifestyle.freshFood"), cost: 1500 };
    await actor.update({ "system.lifestyle.lifeStyle.description": fresh.description, "system.lifestyle.lifeStyle.cost": fresh.cost });
    return { life, of: game.modules.get("cpr-hq").api.lifestyle.of(actor) };
  }, { pc });
  same(before.of.perks.taxi, { per: "day", anywhere: true }, "cpr-hq: Fresh Food's taxi perk");
  const stop = await sharedPin(gm, pl, prefix);
  try {
    // A free ride used by an earlier run (or by hand) would block this one: the GM client is the host, so drop it there.
    await gm.run(a => delete store.apps.rideCredits?.[a.pc.id], { pc });
    const dialog = await bookCabb(pl);
    check(/free/i.test(dialog) && /Fresh Food/.test(dialog), `the confirm says it's free: ${dialog}`);
    const ride = await gm.run(a => until(() => Object.values(store.apps.rides ?? {}).find(r => r.actorId === a.pc.id && ["enroute", "waiting", "riding"].includes(r.status)), "the ride at the host"), { pc });
    same([ride.fare, ride.credit?.lifestyle, ride.fullFare > 0], [0, before.of.name, true], "free ride, with the Lifestyle named and the full fare kept");
    const credit = await gm.run(a => until(() => store.apps.rideCredits?.[a.pc.id], "the credit row"), { pc });
    same(credit.rideId, ride.id, "the credit is taken by this ride");
    await pl.run(async () => {
      await tap("[data-action=cabb-cancel]");
      const d = await until(() => [...document.querySelectorAll(".app.dialog")].at(-1), "the cancel confirm", 2000).catch(() => null);
      if (d) await press(d, "Yes");
    });
    const back = await gm.run(a => until(() => store.apps.rides[a.id]?.status === "cancelled" && !store.apps.rideCredits?.[a.pc.id] && "back", "the credit given back"), { id: ride.id, pc });
    same(back, "back", "cancelling gives the credit back");
  } finally {
    await unpin(gm, stop);
    await gm.run(a => game.actors.get(a.pc.id).update({ "system.lifestyle.lifeStyle.description": a.life.description, "system.lifestyle.lifeStyle.cost": a.life.cost }), { pc, life: before.life });
  }
});

test("Map: Request Combat Cabb on a pin's card opens Combat Cabb with the pin as where to", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "map");
  await skipUnless(gm, "cabb");
  const has = await pl.run(a => !api.pool.on() || (api.pool.has(a.pc.id, "map") && api.pool.has(a.pc.id, "cabb")), { pc });
  if (!has) throw new Error("the player's character needs the Map and Combat Cabb installed (App Store) to test this");
  const result = await pl.run(async () => {
    const p = await phone();
    await go("map");
    // A pin Cabb goes to: one of its places, not where the crew already is.
    const crewAt = (await import("/modules/cpr-sam-agent/apps/cabb/model.js")).cabbConfig().crew?.noteId;
    const pin = await until(() => p._mapModel?.pins.find(x => x.id !== crewAt), "a pin on the map");
    p.mapPick = pin.id;
    p.render();
    await tap("[data-action=map-cabb]");
    await until(() => p.app === "cabb" && el("[data-action=cabb-book]"), "Combat Cabb with a fare to book");
    return { pin: pin.id, app: p.app, to: p.cabbTo };
  });
  same(result.app, "cabb", "the phone moved to Combat Cabb");
  same(result.to, `note:${result.pin}`, "where to is the pin");
});

test("Map (GM): the pin card's Cabb zone sets that pin's Combat Cabb zone", async ({ gm }) => {
  await skipUnless(gm, "map");
  await skipUnless(gm, "cabb");
  const result = await gm.run(async () => {
    const p = await phone();
    await go("map");
    await until(() => p._mapModel, "the map");
    // (cabbConfig only reads the world setting, so this copy of the module is fine)
    const { cabbConfig } = await import("/modules/cpr-sam-agent/apps/cabb/model.js");
    if (cabbConfig().sceneId === "none") return { skip: "Combat Cabb is on its city list (No map)" };
    // The zone is the pin's own (the Map's table).
    const zoneOf = id => store.apps.mapPins?.[id]?.zone ?? null;
    const pin = p._mapModel.pins.find(x => !zoneOf(x.id));
    p.mapPick = pin.id;
    p.render();
    await until(() => el('.agent-dropdown[data-name="mapCabbZone"]'), "the Cabb zone dropdown");
    await choose("mapCabbZone", `${pin.id}|hot`);
    const set = await until(() => zoneOf(pin.id), "the zone saved");
    await until(() => el('.agent-dropdown[data-name="mapCabbZone"]'), "the dropdown after the redraw");
    await choose("mapCabbZone", `${pin.id}|`);
    await until(() => !zoneOf(pin.id) && "cleared", "the zone cleared");
    return { set, cleared: !zoneOf(pin.id) };
  });
  if (result.skip) throw new Error(result.skip);
  same(result.set, "hot", "the pin is in the Hot Zone");
  check(result.cleared, "No zone clears it");
});

test("Map (GM): a temporary pin dropped on the GM's Map is on the Map, moves, players see it, and clears", async ({ gm, pl }) => {
  await skipUnless(gm, "map");
  const dropped = await gm.run(async () => {
    const p = await phone();
    await go("map");
    await until(() => p._navMap?.root && p._mapModel, "the map");
    const at = { x: p.mapView.cx, y: p.mapView.cy };
    await p._mapMenuPick("temp", at);
    const id = p.mapPick;
    await until(() => store.apps.mapPins?.[id], "the temporary pin");
    const wanted = Math.round(at.x + 50);
    // As dragging it does (the page's own editor: an import of editor.js would get its own copy of the store).
    p._navMap.onMove(id, { x: at.x + 50, y: at.y });
    await until(() => store.apps.mapPins[id]?.x === wanted, "the pin to move").catch(() => null);
    await until(() => el(".agent-map-temp-clear"), "the temporary pins chip");
    const row = store.apps.mapPins[id];
    return { id, x: row.x, wanted, temp: !!row.temp };
  });
  check(dropped.temp, "it's marked temporary");
  same(dropped.x, dropped.wanted, "it moved on the Map");
  const seen = await pl.run(async a => {
    const p = await phone();
    await go("map");
    return !!(await until(() => store.apps.mapPins?.[a.id] && p._mapModel?.pins.find(x => x.id === a.id), "the pin on the player's map"));
  }, { id: dropped.id });
  check(seen, "the player sees it");
  const left = await gm.run(async a => {
    await tap("[data-action=map-clear-temp]");
    return await until(() => !store.apps.mapPins?.[a.id] && "gone", "the pin to be cleared");
  }, { id: dropped.id });
  same(left, "gone", "cleared");
});

test("Map (GM): the first popup's Populate empty journal pages makes a journal per pin by district and links them", async ({ gm }) => {
  await skipUnless(gm, "map");
  const snap = await gm.run(() => ({
    seeded: game.settings.get("cpr-sam-agent", "mapConfig").seeded?.journals ?? null,
    pages: Object.fromEntries(Object.values(store.apps.mapPins ?? {}).map(p => [p.id, p.page ?? null])),
    folders: game.folders.filter(f => f.type === "JournalEntry").map(f => f.id),
    entries: game.journal.map(e => e.id)
  }));
  try {
    const picked = await gm.run(async () => {
      const pins = Object.values(store.apps.mapPins).filter(p => p.district && !p.temp && p.page).slice(0, 3);
      if (pins.length < 3) throw new Error("the Map needs 3 linked pins with a district");
      store.request("map-pin", { op: "set-many", changes: Object.fromEntries(pins.map(p => [p.id, { page: null }])) });
      await until(() => pins.every(p => !store.apps.mapPins[p.id].page) && "cleared", "the pages cleared");
      const { patchSetting } = await import("/modules/cpr-sam-agent/scripts/util/settings.js");
      await patchSetting("mapConfig", c => {
        c.seeded = { ...c.seeded, journals: "ask" };
      });
      await press(await dialog("Map: journals for its places?"), "Populate empty journal pages");
      await until(() => game.settings.get("cpr-sam-agent", "mapConfig").seeded?.journals === "populated" && "populated", "the answer kept", 20000);
      return pins.map(p => ({ id: p.id, name: p.name, district: p.district }));
    });
    const result = await gm.run(async a => {
      const out = [];
      for (const pin of a.picked) {
        const uuid = await until(() => store.apps.mapPins[pin.id].page, "the pin's new page");
        const page = fromUuidSync(uuid);
        const entry = page?.parent;
        out.push({
          name: page?.name, text: page?.text?.content ?? "", type: page?.type, entry: entry?.name, folder: entry?.folder?.name,
          master: entry?.folder?.folder?.name, top: !entry?.folder?.folder?.folder, own: entry?.ownership?.default
        });
      }
      return out;
    }, { picked });
    for (const [i, pin] of picked.entries()) {
      const r = result[i];
      same([r.name, r.type, r.text, r.entry, r.folder, r.master, r.top, r.own], [pin.name, "text", "", pin.name, pin.district, "Locations", true, 0], `${pin.name}: an empty page in its district's folder`);
    }
  } finally {
    await gm.run(async a => {
      document.querySelectorAll(".app.dialog, .application.dialog").forEach(d => d.querySelector(".header-button.close, [data-action=close]")?.click());
      const { patchSetting } = await import("/modules/cpr-sam-agent/scripts/util/settings.js");
      await game.journal.documentClass.deleteDocuments(game.journal.filter(e => !a.entries.includes(e.id)).map(e => e.id));
      const extra = game.folders.filter(f => f.type === "JournalEntry" && !a.folders.includes(f.id));
      await Folder.deleteDocuments(extra.map(f => f.id));
      const changes = Object.fromEntries(Object.values(store.apps.mapPins ?? {}).filter(p => (p.page ?? null) !== (a.pages[p.id] ?? null)).map(p => [p.id, { page: a.pages[p.id] ?? null }]));
      if (Object.keys(changes).length) store.request("map-pin", { op: "set-many", changes });
      await patchSetting("mapConfig", c => {
        if (c.seeded) c.seeded.journals = a.seeded;
      });
    }, snap);
  }
});

test("Map (GM): a pin for some characters shows only to their players", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "map");
  const id = await gm.run(async () => {
    const p = await phone();
    await go("map");
    await until(() => p._navMap?.root && p._mapModel, "the map");
    await p._mapMenuPick("pin", { x: p.mapView.cx, y: p.mapView.cy });
    const id = p.mapPick;
    await until(() => store.apps.mapPins?.[id] && el('.agent-dropdown[data-name="mapPinSeen"]'), "the new pin's card");
    return id;
  });
  try {
    const ticked = await gm.run(async a => {
      await choose("mapPinSeen", `${a.id}|some`);
      await tap(`input[name=mapPinSeenBy][value="${a.pc.id}"]`);
      return !!(await until(() => store.apps.mapPins[a.id]?.actorIds?.includes(a.pc.id), "the character ticked"));
    }, { id, pc });
    check(ticked, "the lane player's character is ticked");
    const got = await pl.run(a => until(() => store.apps.mapPins?.[a.id] && "got", "the pin in the player's store"), { id });
    same(got, "got", "the player gets the pin");
    await gm.run(async a => {
      await tap(`input[name=mapPinSeenBy][value="${a.pc.id}"]`);
      await until(() => !store.apps.mapPins[a.id]?.actorIds?.length && "unticked", "the character unticked");
    }, { id, pc });
    const gone = await pl.run(a => until(() => !store.apps.mapPins?.[a.id] && "gone", "the pin to leave the player's store"), { id });
    same(gone, "gone", "unticked: the player no longer has it");
  } finally {
    await gm.run(async a => store.request("map-pin", { op: "delete", id: a.id }), { id });
  }
});

test("Map: an Agent alert doesn't redraw the picked pin's card", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "map");
  await pl.run(async () => {
    const p = await phone();
    await go("map");
    const pin = await until(() => p._mapModel?.pins[0], "a pin on the map");
    p.mapPick = pin.id;
    p.render();
    window.__mapCard = await until(() => el(".agent-map-card"), "the card");
  });
  await gm.run(a => api.alert({ to: game.actors.get(a.pc.id), text: "Map live test: an alert" }), { pc });
  const result = await pl.run(async () => {
    await sleep(2000);
    return { same: window.__mapCard === el(".agent-map-card"), there: !!el(".agent-map-card") };
  });
  check(result.there && result.same, "the same card is still there");
});

test("Map: a character's planned route shows on the GM's Map, labelled with their name", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "map");
  const planned = await pl.run(async () => {
    const p = await phone();
    await go("map");
    const pins = await until(() => p._mapModel?.pins.length > 1 && p._mapModel.pins, "two pins");
    const [a, b] = [pins[0], pins.at(-1)];
    // A route left from an earlier run (starting at this pin) would hide "Start here".
    p.mapRoute = null;
    p._mapShareRoute();
    p.mapPick = a.id;
    p.render();
    await tap("[data-action=map-route-from]");
    p.mapPick = b.id;
    p.render();
    await tap("[data-action=map-route-to]");
    return { to: b.name };
  });
  const seen = await gm.run(async a => {
    const p = await phone();
    await go("map");
    return await until(() => {
      p.render();
      return p._mapOthers?.find(r => r.cls === "player" && r.label.includes(a.to))?.label;
    }, "the player's route on the GM's map", 10000);
  }, { to: planned.to });
  check(seen.includes(pc.shown), `labelled with the character (${seen})`);
  // Cleared on the phone: gone from the GM's map.
  await pl.run(() => tap("[data-action=map-route-clear]"));
  const gone = await gm.run(async a => {
    const p = await phone();
    await go("map");
    return await until(() => (p.render(), !p._mapOthers?.some(r => r.cls === "player" && r.label.includes(a.who))) && "gone", "the route to go", 10000);
  }, { who: pc.shown });
  same(gone, "gone", "cleared from the GM's map");
});

test("Map: an inline map of a place opens the Map there", async ({ gm, pl, prefix }) => {
  await skipUnless(gm, "map");
  const stop = await sharedPin(gm, pl, prefix);
  const result = await pl.run(async a => {
    const p = await phone();
    await go("map");
    const pin = await until(() => p._mapModel?.pins.find(x => x.id === a.stop), "the spec's pin");
    await go("home");
    const box = document.createElement("div");
    document.body.append(box);
    const made = api.map.embed(box, { noteId: pin.id, label: pin.name });
    await until(() => box.querySelector(".agent-navmap-tile"), "the inline map's picture");
    box.click();
    await until(() => p.app === "map" && p.mapPick === pin.id && el(".agent-map-card"), "the Map on the pin");
    made.destroy();
    box.remove();
    return { picked: p.mapPick === pin.id, other: api.map.canShow({ sceneId: "not-a-scene", x: 1, y: 1 }) };
  }, { stop }).finally(() => unpin(gm, stop));
  check(result.picked, "the Map opened with the pin picked");
  same(result.other, false, "a place on another scene can't be shown");
});

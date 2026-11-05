/*
 * Notification audit, checked live: alerts made by answering an alert
 * pop up, CBK's GO LIVE reaches the phones and BUY NOW!!! leaves the GM a Hand over card, a phone note's
 * "Remind me", losing #1 on Flappy Chrome, Ask Alex alerts open their question, and CitiNet apps say "No CitiNet
 * connection" without signal. Settings the tests change are put back.
 */

import { check, same, test } from "./lib.mjs";

/** An app on (and installed) for the lane's character. */
const appOn = (gm, pc, app) => gm.run(async a => {
  if (!api.feature(`app_${a.app}`)) await api.setFeature(`app_${a.app}`, true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, a.app)) await api.pool.grant({ actor: a.pc.id, app: a.app });
  return true;
}, { pc, app });

/** Waits on the player's client for an alert to this character matching `re`; returns { id, text, app, ref }. */
const alertOn = (pl, actorId, re) => pl.run(async a => {
  const rx = new RegExp(a.re);
  const found = await until(() => Object.values(store.apps.alerts).find(x => x.actorId === a.actorId && x.ts >= a.since && rx.test(x.text)), `an alert like ${a.re}`, 10000);
  return { id: found.id, text: found.text, app: found.app ?? null, ref: found.ref ?? null };
}, { actorId, re: re.source, since: Date.now() - 60_000 });

test("audit: a declined Bang pops up on the payer's phone (an alert made while answering one)", async ({ gm, pl, pc, other, tag }) => {
  const offerId = await gm.run(a => {
    const id = store._alert(a.other.id, { kind: "money", text: `Bang? ${a.tag}`, choices: ["Accept", "Decline"], ref: { type: "bang", from: a.pc.id, to: a.other.id, amount: 1 } });
    store._pushApps([id]);
    return id;
  }, { pc, other, tag });
  const r = await pl.run(async a => {
    await go("home");
    await until(() => store.apps.alerts[a.offerId], "the offer on the player's client");
    store.request("alert-answer", { alertId: a.offerId, choice: "Decline" });
    const declined = await until(() => Object.values(store.apps.alerts).find(x => x.actorId === a.pc.id && /declined your Bang/.test(x.text) && x.ts > Date.now() - 30_000), "the payer's alert");
    const win = root().closest(".window-app") ?? root();
    const shown = await until(() => [...win.querySelectorAll(".ctp-banners .ctp-toast"), ...document.querySelectorAll("#ctp-toasts .ctp-toast")].find(t => t.textContent.includes("declined your Bang")), "the pop-up", 8000).catch(() => null);
    return { text: declined.text, shown: !!shown };
  }, { offerId, pc });
  check(/declined your Bang/.test(r.text), r.text);
  check(r.shown, "it pops up (banner on the open phone, or beside the phone button)");
});

test("audit: CBK GO LIVE tells the phones; BUY NOW!!! leaves a GM card with Hand over, which clears it", async ({ gm, pl, pc, prefix }) => {
  await appOn(gm, pc, "cbk");
  const old = await gm.run(async a => {
    const name = `${a.prefix}CBK Audit Knife`;
    if (!game.items.getName(name)) await CONFIG.Item.documentClass.create({ name, type: "gear", system: { price: { market: 20 } } });
    // Right after the GM client is promoted, create can resolve before the item is in the world.
    const item = await until(() => game.items.getName(name), "the test item");
    const was = game.settings.get(MODULE, "cbk");
    await game.settings.set(MODULE, "cbk", { markets: [{
      id: "claudeAuditMkt1", letter: "C", name: `${a.prefix}Audit Market`, fixer: "Molly Anderson", live: false, booths: { 4: "Weapons" },
      listings: [{ id: "claudeAuditLst1", uuid: item.uuid, name, img: item.img, type: "gear", corp: "Nova Arms", category: "weapons", sub: "Melee", booths: ["C4"], price: 20, stock: null }]
    }] });
    await game.actors.get(a.pc.id).update({ "system.wealth.value": 1000 });
    return was;
  }, { pc, prefix });
  try {
    await gm.run(async () => {
      await go("cbk");
      await tap('[data-action="cbk-gm-tab"][data-tab="markets"]');
      await tap('[data-action="cbk-live"][data-market="claudeAuditMkt1"]');
      await until(() => game.settings.get(MODULE, "cbk").markets[0].live, "the market to go live");
    });
    const live = await alertOn(pl, pc.id, /Audit Market: Now live/);
    same(live.app, "cbk", "the alert opens CBK");

    const receipt = await pl.run(async a => {
      store.request("cbk-buy", { actorId: a.pc.id, marketId: "claudeAuditMkt1", listingId: "claudeAuditLst1", price: 20 });
      const r = await until(() => Object.values(store.apps.receipts ?? {}).find(x => x.listingId === "claudeAuditLst1" && x.actorId === a.pc.id && x.status === "paid" && x.ts > Date.now() - 30_000), "the receipt");
      return r.id;
    }, { pc });
    const card = await gm.run(async a => {
      const c = await until(() => store.apps.gmCards[`cbk:${a.receipt}`], "the GM card");
      return { open: c.open?.app, actions: c.actions.map(x => x.request) };
    }, { receipt });
    same(card.open, "cbk", "the card opens CBK");
    same(card.actions, ["cbk-handover"], "with a Hand over button");
    const gone = await gm.run(async a => {
      store.request("cbk-handover", { receiptId: a.receipt });
      await until(() => !store.apps.gmCards[`cbk:${a.receipt}`], "the card to clear");
      return true;
    }, { receipt });
    check(gone, "Hand over clears the card");

    await gm.run(async () => {
      await tap('[data-action="cbk-live"][data-market="claudeAuditMkt1"]');
      await until(() => !game.settings.get(MODULE, "cbk").markets[0].live, "the market to close");
    });
    await alertOn(pl, pc.id, /Audit Market: Closed/);
  } finally {
    await gm.run(a => game.settings.set(MODULE, "cbk", a.old), { old });
  }
});

test("audit: a phone note with Remind me alerts its character when it starts", async ({ gm, pl, pc, tag }) => {
  const sc = await gm.run(() => !!game.modules.get("foundryvtt-simple-calendar")?.active);
  if (!sc) throw new Error("Simple Calendar is off in this world: this test needs it");
  await appOn(gm, pc, "calendar");
  const title = `Remind ${tag}`;
  await pl.run(async a => {
    await go("calendar");
    if (!el("[name=calTitle]")) await tap('[data-action="cal-add"]');
    await until(() => el("[name=calRemind]"), "the Remind me box");
    const now = SimpleCalendar.api.timestampToDate(game.time.worldTime + 120);
    const pad = n => String(n).padStart(2, "0");
    el("[name=calTitle]").value = a.title;
    el("[name=calAllDay]").checked = false;
    el("[name=calTime]").value = `${pad(now.hour)}:${pad(now.minute)}`;
    el("[name=calRemind]").checked = true;
    await tap('[data-action="cal-note-save"]');
    return true;
  }, { title });
  const flagged = await gm.run(async a => {
    const entry = await until(() => game.journal.find(e => e.name === a.title), "the note");
    await until(() => entry.flags?.[MODULE]?.remind, "its reminder flag");
    return entry.flags[MODULE].remind.actorId;
  }, { title });
  same(flagged, pc.id, "the reminder is for the character");
  await gm.run(() => game.time.advance(240));
  const alert = await alertOn(pl, pc.id, new RegExp(`Now: ${title}`));
  same(alert.app, "calendar", "it opens the Calendar");
});

test("audit: losing #1 on Flappy Chrome tells whoever held it", async ({ gm, pl, pc, other }) => {
  await appOn(gm, pc, "pigeon");
  const old = await gm.run(async a => {
    const was = game.settings.get(MODULE, "pigeonBoard");
    await game.settings.set(MODULE, "pigeonBoard", { scores: [{ id: foundry.utils.randomID(), name: "AUD", who: a.pc.shown, actorId: a.pc.id, score: 5, ts: Date.now() }] });
    return was;
  }, { pc });
  try {
    await pl.run(a => store.request("pigeon-score", { actorId: a.other.id, score: 9, initials: "AUD" }), { other });
    const alert = await alertOn(pl, pc.id, /took your #1 spot/);
    check(alert.text.includes(other.shown), alert.text);
    same(alert.app, "pigeon", "it opens Flappy Chrome");
  } finally {
    await gm.run(a => game.settings.set(MODULE, "pigeonBoard", a.old ?? { scores: [] }), { old });
  }
});

test("audit: an Ask Alex alert opens the app at its question", async ({ gm, pl, pc, tag }) => {
  await appOn(gm, pc, "alex");
  const question = `Audit question ${tag}`;
  const queryId = await pl.run(async a => {
    store.request("alex-ask", { actorId: a.pc.id, text: a.question });
    return (await until(() => Object.values(store.apps.queries).find(q => q.text === a.question), "the query")).id;
  }, { pc, question });
  await gm.run(a => store.request("alex-none", { queryId: a.queryId }), { queryId });
  const alert = await alertOn(pl, pc.id, /No results in the local Pool/);
  same(alert.ref, { type: "alex-query", queryId }, "the alert points at the question");
  const r = await pl.run(async a => {
    const p = await phone();
    p.openAlert(store.apps.alerts[a.id]);
    const row = await until(() => el(`[data-alex-query="${a.queryId}"]`), "the question on Alex's page");
    await until(() => !p.alexFocus, "the focus used");
    return { app: p.app };
  }, { id: alert.id, queryId });
  same(r.app, "alex", "Ask Alex is open");
});

test("audit: without signal a CitiNet app answers 'No CitiNet connection.'", async ({ gm, pl, pc, tag }) => {
  await appOn(gm, pc, "alex");
  await gm.run(a => api.setSignal(a.pc.id, false), { pc });
  try {
    await pl.run(a => store.request("alex-ask", { actorId: a.pc.id, text: `No signal ${a.tag}` }), { pc, tag });
    const alert = await alertOn(pl, pc.id, /^No CitiNet connection\.$/);
    same(alert.app, "alex", "from Ask Alex");
  } finally {
    await gm.run(a => api.setSignal(a.pc.id, true), { pc });
  }
});

test("the open center doesn't replay its slide-in or jump to the top on a redraw; Clear all empties it in one go", async ({ gm, pl, pc, tag }) => {
  await pl.run(async () => {
    await go("home");
    const p = await phone();
    if (p.shadeOpen) p._shadeSet(false);
    return true;
  });
  // Enough alerts to scroll.
  await gm.run(a => {
    const ids = Array.from({ length: 14 }, (_, i) => store._alert(a.pc.id, { kind: "advice", text: `flash ${a.tag} ${i}` }));
    store._pushApps([]);
    return ids.length;
  }, { pc, tag });
  const r = await pl.run(async a => {
    const p = await phone();
    await until(() => Object.values(store.apps.alerts).filter(x => x.text.startsWith(`flash ${a.tag}`)).length === 14, "the alerts");
    await tap('.agent-statusbar[data-action="shade"]');
    const first = await until(() => el(".agent-shade"), "the center");
    const slid = first.classList.contains("opening");
    const list = el(".agent-shade-list");
    list.scrollTop = 80;
    list.dispatchEvent(new Event("scroll"));
    // Something happens in the Agent while it's open: a redraw.
    p.render();
    await until(() => el(".agent-shade") && el(".agent-shade") !== first, "the redraw");
    const again = el(".agent-shade");
    const replayed = again.classList.contains("opening") || getComputedStyle(again).animationName !== "none";
    const kept = el(".agent-shade-list").scrollTop;

    // Clear all: count the center's redraws until it's empty.
    // Each redraw of the center after the tap: how many of these rows it still shows.
    const draws = [];
    const win = root().closest(".window-app") ?? root();
    const rowsIn = n => [...(n.querySelectorAll?.(".agent-shade-item") ?? [])].filter(e => e.textContent.includes(`flash ${a.tag}`)).length;
    const watch = new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("agent-shade") || n.querySelector?.(".agent-shade")) draws.push(rowsIn(n));
    });
    watch.observe(win, { childList: true, subtree: true });
    await tap('[data-action="shade-clear-all"]');
    await until(() => !els(".agent-shade-item").some(e => e.textContent.includes(`flash ${a.tag}`)), "the center to empty");
    await new Promise(res => setTimeout(res, 1500)); // the host's echoes
    watch.disconnect();
    const left = els(".agent-shade-item").filter(e => e.textContent.includes(`flash ${a.tag}`)).length;
    p._shadeSet(false);
    return { slid, replayed, kept, draws, left };
  }, { tag });
  check(r.slid, "it slides in when pulled down");
  check(!r.replayed, "a redraw while open doesn't replay the slide-in");
  check(r.kept >= 60, `a redraw keeps the scroll (${r.kept})`);
  same(r.left, 0, "Clear all empties it");
  check(r.draws.length >= 1 && r.draws.every(n => n === 0), `every redraw after Clear all is already empty, never row by row (${r.draws.join(", ")})`);
});

test("a GM card's pop-up goes when the card is dealt with elsewhere (on the host, and pushed to another GM)", async ({ gm, tag }) => {
  const r = await gm.run(async a => {
    const up = id => [...document.querySelectorAll("#ctp-toasts .ctp-toast, .ctp-banners .ctp-toast")].filter(t => t.textContent.includes(id) && !t.classList.contains("leaving")).length;
    const card = (id, n) => ({ id, title: id, body: `Round ${n}`, icon: "fa-bell", actions: [{ label: "Go", request: "gm-card-clear", data: { cardIds: [id] } }] });
    const [one, two, other] = ["one", "two", "other"].map(n => `card ${n} ${a.tag}`);
    store._gmCard(card(one, 1));
    store._gmCard(card(two, 2));
    const shown = up(one) + up(two);
    store._gmCardDone(one);
    const afterOne = [up(one), up(two), !!store.apps.gmCards[one]];
    store._gmCardDone(two);
    // What another GM's client gets from the host.
    store._onSocket({ type: "gm-card", card: card(other, 3) }, game.user.id);
    const pushed = up(other);
    store._onSocket({ type: "gm-card", clear: [other] }, game.user.id);
    return { shown, afterOne, afterTwo: up(two), pushed, afterPush: up(other) };
  }, { tag });
  same(r.shown, 2, "both pop up");
  same(r.afterOne, [0, 1, false], "only the settled card's pop-up goes");
  same(r.afterTwo, 0, "and the other when it's settled");
  same(r.pushed, 1, "a pushed card pops up");
  same(r.afterPush, 0, "a pushed clear takes it away");
});

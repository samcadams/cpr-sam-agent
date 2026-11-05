/*
 * The Garden clock (apps/garden/model.js): Garden time is world time while Simple Calendar runs the
 * phones' clock; posts and the queue are dated by it, as Simple Calendar dates that moment (across a
 * month and a year boundary too); moving the clock lets queued posts out, each stamped with its own
 * time; switching the phones' clock to System time puts the Garden on real time without losing its
 * order. GM-only. Moves world time forward and back again, and the clock setting, restoring both.
 */

import { check, same, test } from "./lib.mjs";

const MODEL = "/modules/cpr-sam-agent/apps/garden/model.js";

const needCalendar = gm => gm.run(() => {
  if (!game.modules.get("foundryvtt-simple-calendar")?.active) throw new Error("Simple Calendar is off in this world: these tests need it");
  return true;
});

test("Garden dates are Simple Calendar's dates, across a month and a year boundary", async ({ gm }) => {
  await needCalendar(gm);
  const out = await gm.run(async a => {
    const m = await import(a.MODEL);
    const sc = globalThis.SimpleCalendar.api;
    const now = m.gardenNow();
    const today = sc.timestampToDate(now);
    const pad = n => String(n).padStart(2, "0");
    const expect = (ts, withYear) => {
      const d = sc.timestampToDate(ts);
      // The phones' clock may be 24-hour or 12-hour (SmallTime's setting).
      const times = [`${pad(d.hour)}:${pad(d.minute)}`, `${d.hour % 12 || 12}:${pad(d.minute)} ${d.hour < 12 ? "AM" : "PM"}`];
      return { got: m.gardenWhen(ts, now), month: d.display.monthName, day: String(d.display.day), year: String(d.display.year), times, withYear };
    };
    const yearStart = sc.dateToTimestamp({ year: today.year, month: 0, day: 0, hour: 0, minute: 0, seconds: 0 });
    const monthStart = sc.dateToTimestamp({ year: today.year, month: today.month, day: 0, hour: 0, minute: 0, seconds: 0 });
    return {
      mode: m.gardenClockMode(), worldTime: game.time.worldTime, now,
      cases: [
        expect(now, false),
        expect(monthStart - 1800, false), expect(monthStart + 1800, false), // a month boundary (this year)
        expect(yearStart - 1800, true), expect(yearStart + 1800, false) // last year's last day / this year's first
      ]
    };
  }, { MODEL });
  same(out.mode, "world", "Garden time follows the world while Simple Calendar runs the clock");
  same(out.now, out.worldTime, "Garden now is world time");
  for (const c of out.cases) {
    check(c.got.startsWith(c.month) && c.got.includes(c.day) && c.times.some(t => c.got.endsWith(t)), `Garden date "${c.got}" matches Simple Calendar's ${c.month} ${c.day}, ${c.year} ${c.times[0]}`);
    check(c.got.includes(c.year) === c.withYear, `"${c.got}" shows the year only when it isn't this year's (${c.year})`);
  }
}, { player: false });

test("moving the clock lets queued posts out, backdated to when each was due", async ({ gm, tag }) => {
  await needCalendar(gm);
  const before = await gm.run(async a => {
    const m = await import(a.MODEL);
    const t0 = m.gardenNow();
    await api.garden.post({ as: "@network54", text: `${a.tag} half an hour in`, delay: 30 });
    await api.garden.post({ as: "@network54", text: `${a.tag} ninety minutes in`, delay: 90 });
    const queued = await until(() => {
      const q = store.garden.queue.filter(i => i.text.startsWith(`${a.tag} half`) || i.text.startsWith(`${a.tag} ninety`));
      return q.length === 2 ? q : null;
    }, "both posts in the queue");
    // The Queue tab: Simple Calendar's date for each, and how long until it.
    const p = await go("garden");
    p.gardenTab = "queue";
    p.render();
    await sleep(300);
    const label = [...root().querySelectorAll(".agent-app-item")].find(li => li.textContent.includes(`${a.tag} half`))?.querySelector(".agent-row-time")?.textContent;
    return { t0, queued: queued.map(q => ({ text: q.text, wt: q.wt })), label, expected: m.gardenWhen(queued[0].wt, t0) };
  }, { MODEL, tag });
  same(before.queued.map(q => Math.round(q.wt - before.t0)), [1800, 5400], "queued half an hour and ninety in-game minutes ahead");
  check(before.label === `${before.expected} · in 30m`, `the Queue tab shows the in-world time: "${before.label}"`);

  try {
    // Two hours later: both go out at once, each dated when it was due.
    const after = await gm.run(async a => {
      await game.time.advance(7200);
      const posts = await until(() => {
        const list = Object.values(store.garden.posts).filter(p => [`${a.tag} half an hour in`, `${a.tag} ninety minutes in`].includes(p.text));
        return list.length === 2 ? list : null;
      }, "both posts going out", 15000);
      const p = await go("garden");
      p.gardenTab = "feed";
      p.render();
      await sleep(300);
      const shown = [...root().querySelectorAll(".agent-garden-post, li")].filter(li => li.textContent.includes(a.tag)).map(li => li.querySelector(".agent-row-time")?.textContent);
      return { posts: posts.map(x => ({ text: x.text, wt: x.wt, likes: x.likes })), shown, queueLeft: store.garden.queue.filter(i => i.text.startsWith(`${a.tag} half`) || i.text.startsWith(`${a.tag} ninety`)).length };
    }, { tag });
    const wt = Object.fromEntries(after.posts.map(x => [x.text.replace(`${tag} `, ""), x.wt]));
    same([wt["half an hour in"], wt["ninety minutes in"]], before.queued.map(q => q.wt), "each post is dated when it was due, not when the clock got there");
    same(after.queueLeft, 0, "the queue is empty");
    check(after.shown.includes("1h") && after.shown.includes("30m"), `the feed says how long ago in-game: ${JSON.stringify(after.shown)}`);
  } finally {
    // Back to where the world was (going back deletes nothing).
    await gm.run(() => game.time.advance(-7200));
  }
  const kept = await gm.run(a => Object.values(store.garden.posts).filter(p => [`${a.tag} half an hour in`, `${a.tag} ninety minutes in`].includes(p.text)).length, { tag });
  same(kept, 2, "turning the clock back deletes nothing");
}, { player: false });

test("the phones' clock on System time: the Garden runs on real time, the feed's order kept", async ({ gm, tag }) => {
  await needCalendar(gm);
  const out = await gm.run(async a => {
    const m = await import(a.MODEL);
    const saved = game.settings.get("cpr-sam-agent", "clock") ?? {};
    await api.garden.post({ as: "@network54", text: `${a.tag} before the switch` });
    const mine = () => Object.values(store.garden.posts).find(p => p.text === `${a.tag} before the switch`);
    await until(mine, "the post");
    const r = {};
    // Posts can go out meanwhile (the queue, Stir) and the oldest drop off: compare the ones in both.
    const order = () => Object.values(store.garden.posts).sort(m.byNewest).map(p => p.id);
    const before = order();
    try {
      await game.settings.set("cpr-sam-agent", "clock", { ...saved, source: "system" });
      r.mode = m.gardenClockMode();
      // The host moves every time onto the real clock on its next tick (world time moving is one).
      await game.time.advance(1);
      await until(() => store.garden.clock?.mode === "real" && Math.abs(mine().wt - Date.now() / 1000) < 600, "the Garden on real time", 15000);
      r.realDrift = Math.round(Math.abs(mine().wt - Date.now() / 1000));
      const after = order();
      const both = before.filter(id => after.includes(id));
      r.same = both.join() === after.filter(id => before.includes(id)).join();
      if (!r.same) r.diff = both.map((id, i) => [id, after.filter(x => before.includes(x))[i]]).filter(([x, y]) => x !== y).slice(0, 3)
        .map(([x, y]) => [store.garden.posts[x], store.garden.posts[y]].map(p => ({ text: p.text.slice(0, 30), wt: p.wt, ts: p.ts })));
    } finally {
      await game.settings.set("cpr-sam-agent", "clock", saved);
      await game.time.advance(-1);
    }
    await until(() => store.garden.clock?.mode === "world" && Math.abs(mine().wt - game.time.worldTime) < 600, "the Garden back on world time", 15000);
    r.back = m.gardenClockMode();
    r.worldDrift = Math.round(Math.abs(mine().wt - game.time.worldTime));
    return r;
  }, { MODEL, tag });
  same(out.mode, "real", "System time: the Garden follows the real clock");
  check(out.realDrift < 600, `the post moved onto real time (${out.realDrift}s off)`);
  check(out.same, `every post keeps its place in the feed ${JSON.stringify(out.diff ?? "")}`);
  same(out.back, "world", "back on Simple Calendar");
  check(out.worldDrift < 600, `and back onto world time (${out.worldDrift}s off)`);
}, { player: false });

/* ---------------- The writer side ---------------- */

test("Log an event: the pop-up is prefilled from the scene, suggests keywords, and Stir gets the city talking at the table", async ({ gm, tag }) => {
  const out = await gm.run(async a => {
    api.garden.logEvent(); // the pop-up (resolves when it closes)
    const d = await until(() => document.querySelector(".ctp-garden-writer form"), "the Log an event pop-up");
    const r = { place: d.place.value, scene: game.scenes.active?.navName || game.scenes.active?.name || "" };
    d.what.value = `${a.tag} shootout behind the docks`;
    d.what.dispatchEvent(new Event("input", { bubbles: true }));
    r.keywords = d.keywords.value;
    d.querySelector("[name=heat][value=citywide]").checked = true;
    r.thingHidden = d.querySelector("[data-stir-only]").style.display === "none";
    d.stir.checked = true;
    d.stir.dispatchEvent(new Event("change", { bubbles: true }));
    r.thingShown = d.querySelector("[data-stir-only]").style.display !== "none";
    d.thing.value = "shootout";
    d.closest(".app").querySelector(".dialog-button.save, button[data-button=save]").click();
    const h = await until(() => Object.values(store.garden.happenings ?? {}).find(x => x.what === `${a.tag} shootout behind the docks`), "the event at the host");
    r.happening = { heat: h.heat, stage: h.stage, keywords: h.keywords };
    r.stirred = store.garden.queue.filter(q => q.stir === h.id).length;
    // The clock stands still: the chatter goes out on real minutes anyway.
    const post = await until(() => Object.values(store.garden.posts).find(p => /shootout/.test(p.text) && p.ts > Date.now() - 120_000), "Stir's first post", 75_000);
    r.post = post.text;
    return r;
  }, { tag });
  same(out.place, out.scene, "Where is prefilled with the scene's name");
  check(out.keywords.includes("shootout"), `keywords suggested from the line: "${out.keywords}"`);
  check(out.thingShown && out.thingHidden, "ticking Stir (only then) asks what people call it");
  same([out.happening.heat, out.happening.stage], ["citywide", "new"], "the event is logged as typed, stage new");
  check(out.stirred >= 7, `a citywide Stir queues 8–12 reactions (${out.stirred} left in the queue)`);
  check(!out.post.includes("{"), `the chatter reads right: "${out.post}"`);
}, { player: false });

test("the Writer tab: events move on a stage; a profile set from Accounts shows in the cast", async ({ gm, tag }) => {
  const out = await gm.run(async a => {
    const p = await go("garden");
    p.gardenTab = "accounts";
    p.render();
    const n54 = Object.values(store.garden.accounts).find(x => x.handle === "@network54");
    await tap(`[data-action="garden-writer-edit"][data-account-id="${n54.id}"]`);
    const d = await dialog("Writer: @network54");
    inDialog(d, "[name=keywords]", `${a.tag.toLowerCase()}, watson, headlines`);
    inDialog(d, "[name=lines]", "NEWS AT ELEVEN\nback to you");
    await press(d, "Save");
    await until(() => store.garden.accounts[n54.id].writer?.keywords?.includes("headlines"), "the profile at the host");
    await api.garden.logEvent({ what: `${a.tag} stage test`, heat: "small" });
    const h = await until(() => Object.values(store.garden.happenings).find(x => x.what === `${a.tag} stage test`), "the event");
    p.gardenTab = "writer";
    p.render();
    await sleep(300);
    const r = { cast: !!el(`.agent-garden-writer [data-action="garden-writer-edit"][data-account-id="${n54.id}"]`), listed: root().innerText.includes(`${a.tag} stage test`) };
    await tap(`[data-action="garden-stage"][data-id="${h.id}"]`);
    r.stage = await until(() => store.garden.happenings[h.id].stage !== "new" && store.garden.happenings[h.id].stage, "the stage moving on");
    r.lines = store.garden.accounts[n54.id].writer.lines;
    return r;
  }, { tag });
  check(out.listed, "the event is listed in the Writer tab");
  check(out.cast, "@network54 is in the cast list once it has a profile");
  same(out.stage, "developing", "tapping the stage moves it on");
  same(out.lines, ["NEWS AT ELEVEN", "back to you"], "its own replies are saved, one per line");
}, { player: false });

test("the player opening the Garden is noted for the writer, and they see none of the writer's notes", async ({ gm, pl, pc }) => {
  // A phone tells the host at most every 5 minutes: start from a fresh player client.
  const since = Date.now();
  await pl.reload();
  await pl.run(async () => {
    await until(() => game.ready && store.online, "the player's phone store to sync", 30000);
    await go("garden");
  });
  const out = await gm.run(a => until(() => {
    const s = store.garden.seen?.[a.pc.id];
    return s && s.ts >= a.since - 5000 ? s : null;
  }, "the host noting it", 15000), { pc, since });
  check(out.ts > 0 && Number.isFinite(out.wt), "noted with Garden and real time");
  const leak = await pl.run(() => ({
    happenings: Object.keys(store.garden.happenings ?? {}).length, seen: Object.keys(store.garden.seen ?? {}).length,
    profiles: Object.values(store.garden.accounts).filter(a => a.writer || a.corp).length,
    tab: !!el('[data-action="garden-tab"][data-tab="writer"]')
  }));
  same(leak, { happenings: 0, seen: 0, profiles: 0, tab: false }, "players get no events, profiles, who-looked-when or Writer tab");
});

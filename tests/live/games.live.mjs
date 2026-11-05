/*
 * The canvas games, played for real on the player's Agent with the keyboard and taps: each starts, runs,
 * and ends cleanly (no console errors on the way). Their rules are in the Node tests (tests/*.test.js);
 * how they look and sound is in TESTING.md.
 */

import { check, same, test } from "./lib.mjs";

const skipUnless = async (gm, app) => {
  const on = await gm.run(a => api.feature(`app_${a.app}`), { app });
  if (!on) throw new Error(`the ${app} app is off in Control: switch it on to test it`);
};

/** The REDLINE app on for a test (the world may have it switched off); gives back a function that restores the setting. */
const redlineOn = async gm => {
  const was = await gm.run(() => api.feature("app_redline"));
  if (!was) await gm.run(() => api.setFeature("app_redline", true));
  return () => (was ? undefined : gm.run(() => api.setFeature("app_redline", false)));
};

/** Real key presses in the player's browser. */
const keys = (pl, ...codes) =>
  pl.pw(async (page, codes) => {
    for (const code of codes) {
      await page.keyboard.press(code);
      await page.waitForTimeout(250);
    }
  }, codes);

test("Flappy Chrome: a tap starts a run; left alone it crashes and the run ends", async ({ gm, pl }) => {
  await skipUnless(gm, "pigeon");
  const r = await pl.run(async () => {
    const p = await go("pigeon");
    const canvas = await until(() => el("canvas"), "the game");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    const started = await until(() => p._pigeonRunning, "the run to start", 3000);
    await until(() => p.pigeon?.over, "the crash", 20000);
    return { started, over: p.pigeon.over };
  });
  check(r.started, "the run starts");
  check(r.over, "it ends in a crash");
});

test("NCART Runner: Space starts a run; the train moves on; left alone it crashes", async ({ gm, pl }) => {
  await skipUnless(gm, "ncart");
  await pl.run(async () => {
    await go("ncart");
    await until(() => el("canvas"), "the game");
  });
  await keys(pl, "Space");
  const r = await pl.run(async () => {
    const p = AgentPhone.primary();
    await until(() => p.ncart?.dist > 5, "distance to grow", 5000);
    await until(() => p.ncart?.over, "the crash", 45000);
    return { over: p.ncart.over, dist: Math.round(p.ncart.dist) };
  });
  check(r.over && r.dist > 0, `the run covers ground and ends (${r.over} at ${r.dist} m)`);
});

test("REDLINE: a Quick Race starts; P pauses, X ends it with a result", async ({ gm, pl }) => {
  const restore = await redlineOn(gm);
  try {
    await skipUnless(gm, "redline");
    const started = await pl.run(async () => {
      const p = await go("redline");
      await tap("[data-action=redline-quick]");
      return until(() => p._rlRunning && p._rlSession, "the race to start", 15000);
    });
    check(started, "the race starts");
    await pl.run(() => sleep(3000)); // the lights, then a little driving
    await keys(pl, "KeyP", "KeyX");
    const result = await pl.run(async () => {
      const p = AgentPhone.primary();
      await until(() => !p._rlRunning && p.rlResult, "the race to end");
      return { done: p.rlResult.done, grid: p.rlResult.grid };
    });
    check(result.grid, "the result screen shows how the race went");
  } finally {
    await restore();
  }
});

test("REDLINE: the start menu: keys pick the ride and the course, Enter races it, Done comes back", async ({ gm, pl }) => {
  const restore = await redlineOn(gm);
  try {
    await skipUnless(gm, "redline");
    const before = await pl.run(async () => {
      const p = await go("redline");
      await until(() => el(".agent-redline-menu canvas") && p._rlMenuData, "the start menu");
      // From the main screen, on RACE, in Quick Race.
      p.rlResult = null;
      p.rlTab = "quick";
      Object.assign(p._rlMenu, { screen: "main", focus: "go" });
      p._redlineMenuChanged();
      return { cls: p.rlCls ?? "sport", seed: p._redlineQuickSeed() };
    });
    await pl.pw(page => page.focus(".agent-redline-menu canvas"));
    // RACE → plate → ride: the next ride; → course: a new one; back down to RACE and go.
    await keys(pl, "ArrowUp", "ArrowUp", "ArrowRight", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowDown", "Enter");
    const race = await pl.run(async () => {
      const p = AgentPhone.primary();
      await until(() => p._rlRunning, "the race to start", 15000);
      return { cls: p.redline.cls, seed: p._rlRace.quick };
    });
    check(race.cls !== before.cls, `the ride changed with → (${before.cls} → ${race.cls})`);
    check(race.seed !== before.seed, "→ on the course rolled a new one, and that's the one raced");
    await pl.run(() => sleep(1500));
    await keys(pl, "KeyP", "KeyX");
    const shown = await pl.run(async () => {
      const p = AgentPhone.primary();
      await until(() => !p._rlRunning && p._rlMenu?.screen === "result" && el(".agent-redline-menu canvas"), "the result screen");
      return p._rlMenuData.resultButtons.map(b => b.id);
    });
    same(shown, ["again", "done"], "a race pulled over offers Race again and Done (no Nominate without a finish)");
    await pl.pw(page => page.focus(".agent-redline-menu canvas"));
    await keys(pl, "ArrowRight", "Enter");
    const back = await pl.run(async () => {
      const p = AgentPhone.primary();
      await until(() => p._rlMenu.screen === "main", "the main menu");
      return { result: p.rlResult };
    });
    check(back.result === null, "Done clears the result");
  } finally {
    await restore();
  }
});

test("BREACH: a practice grid takes picks into the buffer; Jack out and Done close it", async ({ gm, pl }) => {
  await skipUnless(gm, "breach");
  const r = await pl.run(async () => {
    const p = await go("breach");
    // A practice left running: jack out, then Done.
    if (p.brPractice && el("[data-action=breach-quit]")) await tap("[data-action=breach-quit]");
    if (p.brPractice) await tap("[data-action=breach-practice-close]");
    await tap("[data-action=breach-practice]");
    const run = await until(() => p.brPractice, "the practice grid");
    const open = () => els(".agent-breach-cell.open");
    hit(await until(() => open()[0], "a cell in the first row"));
    // Picked: the grid redraws with that cell used and the next line open.
    await until(() => p.brPractice.picks.length === 1 && els(".agent-breach-cell.used").length === 1, "the first pick");
    hit(await until(() => open()[0], "a cell in its column"));
    await until(() => p.brPractice.picks.length === 2 && els(".agent-breach-cell.used").length === 2, "the second pick");
    const picks = p.brPractice.picks.length;
    await tap("[data-action=breach-quit]"); // Jack out
    await tap("[data-action=breach-practice-close]"); // Done
    return { picks, size: run.buffer, closed: !p.brPractice };
  });
  same(r.picks, 2, "two picks in the buffer");
  check(r.closed, "practice closes");
});

test("Roach Race: no pass, no ride; a day pass through BangMe!; Space rides and jumps; the crash goes on the board; a steed bought and ridden", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "roach");
  await gm.run(async a => {
    const cfg = game.settings.get(MODULE, "roach") ?? {};
    await game.settings.set(MODULE, "roach", { ...cfg, out: false, freePlay: false, price: 20, steeds: { ...cfg.steeds, chromed: { price: 50, sale: "buy" } } });
    store.request("roach-grant", { actorId: a.pc.id, on: false });
    store.request("roach-gift", { actorId: a.pc.id, steedId: "chromed", take: true });
  }, { pc });
  const locked = await pl.run(async a => {
    await until(() => !store.apps.roachRiders?.[a.pc.id]?.pass, "the pass to be taken back");
    const p = await go("roach");
    const canvas = await until(() => el("canvas.agent-roach-canvas"), "the cabinet");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    await sleep(300);
    return { running: !!p._roachRunning, buy: !!el("[data-action=roach-pass]") };
  }, { pc });
  check(!locked.running && locked.buy, "without a pass the cabinet won't start, and offers a day pass");

  const paid = await pl.run(async a => {
    const before = game.actors.get(a.pc.id).system.wealth.value;
    await tap("[data-action=roach-pass]");
    await press(await dialog("Roach Race"), "Yes");
    await until(() => store.apps.roachRiders?.[a.pc.id]?.pass, "the pass", 8000);
    await until(() => !el("[data-action=roach-pass]"), "the pass to show");
    return before - game.actors.get(a.pc.id).system.wealth.value;
  }, { pc });
  same(paid, 20, "the day pass costs 20eb");

  await keys(pl, "Space");
  const run = await pl.run(async () => {
    const p = AgentPhone.primary();
    await until(() => p._roachRunning && p.roach?.dist > 20, "the run to start", 5000);
    p.roach.pending = true; // the button, as Space in a run
    await until(() => p.roach.y > 0, "a jump", 2000);
    await until(() => p.roach.over, "the crash", 60000);
    await sleep(500);
    if (p._roachEntry) p._roachEntryDone();
    return { over: p.roach.over, score: Math.floor(p.roach.score) };
  });
  check(run.over && run.score > 0, `the run scores and ends (${run.over} at ${run.score})`);
  const best = await pl.run(async a => until(() => (game.settings.get(MODULE, "roachBoard")?.scores ?? []).find(s => s.actorId === a.pc.id)?.score, "the board"), { pc });
  check(best >= run.score, "the run is on the board");

  const steed = await pl.run(async a => {
    await tap("[data-action=roach-stable]");
    await until(() => el("canvas[data-roach-card=chromed]"), "the stable");
    await tap("[data-action=roach-steed][data-id=chromed]");
    await press(await dialog("Steeds"), "Yes");
    await until(() => store.apps.roachRiders?.[a.pc.id]?.steed === "chromed", "riding the new steed", 8000);
    await tap("[data-action=roach-stable]");
    return !!(await until(() => el("canvas.agent-roach-canvas"), "back at the cabinet"));
  }, { pc });
  check(steed, "a steed is bought, ridden, and the cabinet is back");
});

test("Phone icon: keys a game takes (not the phone's window) keep Using Agent on; left alone it goes idle", async ({ gm, pl, pc }) => {
  await skipUnless(gm, "pigeon");
  const idle = await gm.run(() => game.settings.get(MODULE, "phoneStatusIcon") && game.settings.get(MODULE, "phoneIdleSeconds"));
  if (!idle) throw new Error("switch on the phone icon and its idle timeout in the settings to test it");
  await pl.run(async () => {
    await go("pigeon");
    await until(() => el("canvas"), "the game");
    // Keys land on the page, as after a tap on the canvas: the game takes them on the window.
    document.activeElement?.blur?.();
  });
  check(await gm.run(a => until(() => game.actors.get(a.pc.id).statuses.has(`${MODULE}-phone`), "the phone icon", 10000), { pc }), "opening the game puts the icon on");

  // Flap (Space, taken on the window) every 3 s for longer than the idle timeout.
  await pl.pw(async (page, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(3000);
    }
  }, (idle + 10) * 1000);
  const userId = await pl.run(() => game.user.id);
  const playing = await gm.run(a => ({ icon: game.actors.get(a.pc.id).statuses.has(`${MODULE}-phone`), idle: api.monitor.activity()[a.userId]?.report?.idle }), { pc, userId });
  check(playing.icon && playing.idle === false, `still on after ${idle + 10} s of game keys (icon ${playing.icon}, idle ${playing.idle})`);

  const off = await gm.run(async a => until(() => !game.actors.get(a.pc.id).statuses.has(`${MODULE}-phone`), "the icon to go", (a.idle + 20) * 1000), { pc, idle });
  check(off, "left alone, the phone goes idle and the icon comes off");
  await pl.run(() => closePhone());
});

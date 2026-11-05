/*
 * 4Tify (apps/fortify/): buying it in the App Store for 100eb (no coming-soon listing), a scan, its wave, its mark, Use
 * mark's card and the GM's Void with the time left. World time isn't moved (other lanes share it): the host's row is wound forward by rewinding its
 * due time, then the host ticks; the tick itself is unit-tested.
 */

import { check, same, test } from "./lib.mjs";

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });

/** The scan's 5 minutes are up, as far as the host can tell. */
const finishScan = (gm, id) => gm.run(async a => {
  const mark = store.apps.fortifyMarks[a.id];
  mark.dueAt = game.time.worldTime;
  await store._tickFortify();
  await until(() => mark.status === "ready", "the mark at the host");
}, { id });

/** Starts a scan with the button; the new mark's id. */
const startScan = pl => pl.run(async () => {
  const had = new Set(Object.keys(store.apps.fortifyMarks));
  await tap("[data-action=fortify-scan]");
  await until(() => el(".agent-fortify-ring"), "the progress ring");
  return Object.keys(store.apps.fortifyMarks).find(id => !had.has(id));
});

test("4Tify: bought for 100eb, scan, wave, mark, Use mark's +1d6 card, GM's Void; no coming-soon listing", async ({ gm, pl, pc }) => {
  await gm.run(async a => {
    if (!api.feature("app_fortify")) await api.setFeature("app_fortify", true);
    if (!api.pool.on()) await api.setFeature("app_pool", true);
    // A scan left by an earlier run would hold up this one.
    for (const mark of Object.values(store.apps.fortifyMarks)) if (mark.actorId === a.pc.id && mark.status === "scanning") store.request("fortify-void", { id: mark.id });
    // Back to never having owned it (a revoke would refuse the sale; the fixtures may have granted it).
    if (store.apps.installs[a.pc.id]?.fortify) store.request("pool-forget", { actorId: a.pc.id, app: "fortify" });
    await until(() => !store.apps.installs[a.pc.id]?.fortify, "4Tify forgotten");
    const actor = game.actors.get(a.pc.id);
    if (actor.system.wealth.value < 200) await actor.update({ "system.wealth.value": 500 });
  }, { pc });

  const before = await wealth(gm, pc.id);
  const store100 = await pl.run(async () => {
    await until(() => !api.pool.has(game.user.character.id, "fortify"), "the player's copy");
    await go("pool");
    await tap('[data-action="pool-tab"][data-tab="featured"]');
    const get = await until(() => el('[data-action="pool-get"][data-app="fortify"]'), "4Tify in the store");
    const card = get.closest(".agent-pool-card");
    const out = { text: card.innerText, tile: getComputedStyle(card.querySelector(".agent-app-tile.app-fortify .agent-home-icon")).backgroundImage, soon: root().innerText.split("\n").filter(l => /^4Tify$/.test(l.trim())).length };
    await tap('[data-action="pool-get"][data-app="fortify"]');
    await press(await dialog("App Store"), "Yes");
    await until(() => api.pool.has(game.user.character.id, "fortify"), "4Tify bought");
    return out;
  });
  check(/SecSystems/.test(store100.text), `the card names SecSystems (${store100.text})`);
  check(/4tify\.webp/.test(store100.tile), `the store's tile is the full-colour picture (${store100.tile})`);
  same(store100.soon, 1, "listed once: the coming-soon listing is gone");
  same(before - (await wealth(gm, pc.id)), 100, "100eb paid");

  const scanning = await pl.run(async a => {
    await go("fortify");
    await until(() => el(".agent-fortify"), "the page");
    const grade = el(".agent-fortify-grade").textContent.trim();
    const theme = getComputedStyle(el(".agent-phone")).getPropertyValue("--app-rgb").replace(/\s+/g, " ").trim();
    return { grade, theme, label: el("[data-action=fortify-scan]").textContent.trim(), inputs: root().querySelectorAll(".agent-fortify-finder input").length };
  });
  const usedId = await startScan(pl);
  same(scanning.grade, "F", "your own place is an F");
  same(scanning.theme, "255, 140, 50", "the app's theme");
  same([scanning.label, scanning.inputs], ["Scan my surroundings", 0], "one generic button, nothing to enter");
  check(await pl.run(() => !el("[data-action=fortify-scan]")), "no second scan while one runs");

  const waves = () => until(() => canvas.interface.children.find(c => c.name === "fortify-wave"), "a wave", 6000).then(ring => !!ring);
  check(await pl.run(waves), "the scanner sees the wave");
  check(await gm.run(waves), "so does the GM");

  const gmCard = await gm.run(async a => {
    const mark = await until(() => store.apps.fortifyMarks[a.usedId], "the scan at the host");
    await go("fortify");
    const row = await until(() => el(`[data-mark="${mark.id}"]`), "the mark on the GM Phone");
    const button = row.querySelector("[data-action=fortify-void]");
    return {
      status: mark.status, left: mark.dueAt - mark.startedAt, text: row.innerText,
      button: button.getBoundingClientRect().width, main: row.querySelector(".agent-app-item-main").getBoundingClientRect().width
    };
  }, { usedId });
  same([gmCard.status, gmCard.left], ["scanning", 300], "5 minutes of world time");
  check(/\d:\d\d left/.test(gmCard.text), `Void's row shows the exact time left (${gmCard.text})`);
  check(gmCard.button < 100 && gmCard.main > gmCard.button, `Void leaves the row to the text (${gmCard.button}px button, ${gmCard.main}px text)`);

  await finishScan(gm, usedId);
  const used = await pl.run(async a => {
    const row = await until(() => el(`[data-mark="${a.usedId}"] [data-action=fortify-use]`), "Use mark");
    const sent = game.messages.size;
    row.click();
    const msg = await until(() => game.messages.size > sent && game.messages.contents.at(-1), "the chat card");
    await until(() => !el(`[data-mark="${a.usedId}"] [data-action=fortify-use]`), "the mark spent");
    return { flavor: msg.flavor, content: msg.content };
  }, { usedId });
  check(/Next damage/.test(used.flavor), `the card says what it's for (${used.flavor})`);
  check(/1d6/.test(used.content), "the card shows the d6");
  const total = await gm.run(a => until(() => store.apps.fortifyMarks[a.usedId].total, "the d6 at the host"), { usedId });
  check(total >= 1 && total <= 6, `a d6 (${total})`);

  const voidId = await startScan(pl);
  await finishScan(gm, voidId);
  await pl.run(a => until(() => el(`[data-mark="${a.voidId}"] [data-action=fortify-use]`), "the second mark"), { voidId });
  await gm.run(async a => {
    await tap(`[data-mark="${a.voidId}"] [data-action=fortify-void]`);
    await until(() => store.apps.fortifyMarks[a.voidId].status === "void", "voided at the host");
  }, { voidId });
  const voided = await pl.run(async a => {
    await until(() => !el(`[data-mark="${a.voidId}"] [data-action=fortify-use]`), "Use mark gone");
    return el(`[data-mark="${a.voidId}"]`).innerText;
  }, { voidId });
  check(/Voided/i.test(voided), `the player sees it voided (${voided})`);
});

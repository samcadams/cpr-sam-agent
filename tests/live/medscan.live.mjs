/*
 * Trauma Team MedScan, the paid tab of the Trauma Team app: the player buys it, calls a wound consult (a
 * situational +1 on their sheet) and hangs up; with the GM answering calls, the GM connects a surgical
 * consult from its card and ends it from the GM Phone. (World-time expiry is in the unit tests: moving
 * world time here would bill other lanes' characters.)
 */

import { check, same, test } from "./lib.mjs";

/** Start clean: no MedScan, no plan, MedScan's default rules (the GM's other Trauma Team settings kept). */
const fresh = (gm, pc, medscan = {}) => gm.run(async a => {
  await store.request("ms-end", { actorId: a.pc.id });
  await store.request("ms-grant", { actorId: a.pc.id, owned: false });
  await api.trauma.revoke(a.pc.id);
  const cfg = game.settings.get(MODULE, "trauma") ?? {};
  await game.settings.set(MODULE, "trauma", { ...cfg, medscan: a.medscan });
  await until(() => !store.apps.medscan[a.pc.id]?.owned, "MedScan removed");
  const actor = game.actors.get(a.pc.id);
  if ((actor.system.wealth?.value ?? 0) < 2000) await actor.update({ "system.wealth.value": 5000 });
  return true;
}, { pc, medscan });

const effects = (gm, pc) => gm.run(a => game.actors.get(a.pc.id).effects
  .filter(e => e.flags?.[MODULE]?.medscan)
  .map(e => ({ name: e.name, keys: e.changes.map(c => c.key), situational: Object.values(e.flags["cyberpunk-red-core"]?.changes?.situational ?? {}).every(s => s.isSituational) })), { pc });

test("MedScan: the player buys it in Trauma Team, a wound consult puts a situational +1 on their sheet, and they hang up", async ({ gm, pl, pc }) => {
  await fresh(gm, pc);
  const before = await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc });
  await pl.run(async () => {
    await go("trauma");
    await tap("[data-action=tt-tab][data-tab=medscan]");
    await tap("[data-action=ms-buy]");
    await press(await dialog("MedScan"), "Yes");
    await tap("[data-action=ms-consult][data-kind=wound]");
    await press(await dialog("MedScan"), "Yes");
    await until(() => /tick it in the roll dialog/i.test(root().innerText), "the specialist on the line");
  });
  const after = await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc });
  same(before - after, 120, "20eb for the app, 100eb for the consult");
  same(await effects(gm, pc), [{ name: "MedScan: Wound consult", keys: ["bonuses.firstAid", "bonuses.paramedic"], situational: true }], "the +1 is on the sheet, as a roll-dialog checkbox");

  await pl.run(async () => {
    await tap("[data-action=ms-end]");
    await until(() => el("[data-action=ms-consult][data-kind=surgery]"), "the consults again");
  });
  same(await effects(gm, pc), [], "hanging up takes the +1 off");
});

test("MedScan: with the GM answering, an Executive member's surgical consult waits for Connect, is free, and the GM ends it", async ({ gm, pl, pc, prefix }) => {
  await fresh(gm, pc, { live: true });
  await gm.run(async a => {
    await store.request("ms-grant", { actorId: a.pc.id, owned: true });
    await api.trauma.grant({ actor: a.pc.id, plan: "Executive", sponsor: `${a.prefix}Corp` });
  }, { pc, prefix });
  try {
    const before = await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc });
    await pl.run(async () => {
      await go("trauma");
      await tap("[data-action=tt-tab][data-tab=medscan]");
      await until(() => /covered by executive/i.test(root().innerText), "Executive covers it");
      await tap("[data-action=ms-consult][data-kind=surgery]");
      await press(await dialog("MedScan"), "Yes");
      await until(() => /connecting to a specialist/i.test(root().innerText), "waiting for the GM");
    });
    await gm.run(async a => {
      const card = await until(() => [...document.querySelectorAll(".ctp-toast")].find(t => /medscan/i.test(t.textContent) && t.textContent.toLowerCase().includes(a.pc.shown.toLowerCase())), "the GM's MedScan card");
      [...card.querySelectorAll(".ctp-toast-action")].find(b => /connect/i.test(b.textContent)).click();
      await until(() => store.apps.medscan[a.pc.id]?.consult?.status === "active", "connected");
    }, { pc });
    await pl.run(() => until(() => /surgical consult/i.test(root().innerText) && /tick it in the roll dialog/i.test(root().innerText), "the surgeon on the line"));
    same(await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc }), before, "covered: nothing charged");
    same((await effects(gm, pc)).map(e => e.keys), [["bonuses.medicalTechSkill", "bonuses.surgerySkill"]], "+1 Medical Tech and Surgery");
    same(await gm.run(a => game.actors.get(a.pc.id).effects.filter(e => e.flags["cpr-sam-agent"]?.medscan || /MedScan/.test(e.name))
      .flatMap(e => Object.values(e.flags["cyberpunk-red-core"]?.changes?.situational ?? {})).map(s => s.isSituational && !s.onByDefault), { pc }),
    [true, true], "a roll-dialog checkbox, off by default");

    await gm.run(async a => {
      await go("trauma");
      await tap("[data-action=tt-tab][data-tab=medscan]");
      await tap(`[data-action=ms-end][data-actor-id="${a.pc.id}"]`);
      await until(() => !store.apps.medscan[a.pc.id]?.consult, "the consult ended");
    }, { pc });
    check(!(await effects(gm, pc)).length, "the GM's End takes the +1 off");
  } finally {
    await fresh(gm, pc);
  }
});

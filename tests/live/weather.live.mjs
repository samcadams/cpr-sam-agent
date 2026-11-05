/*
 * Weather (id "weather"): the host keeps ten days filled; the GM sets today and schedules a run of days
 * from Weather Control; applying puts the condition's penalty in CPR's roll dialog as an unticked
 * situational option, and Heat Wave adds 2 to an existing armor penalty; a Vial of Poison check shows on
 * the player's phone and a failure's damage is applied from the GM page; Acid Rain ablates worn armor;
 * a Blackout cuts the signal until Clear; the Calendar shows the days' weather.
 */

import { check, same, test } from "./lib.mjs";

/** Weather on (and installed with the App Store on); waits for the host's forecast. Returns today's key. */
const ready = (gm, pc) => gm.run(async a => {
  if (!api.feature("app_weather")) await api.setFeature("app_weather", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "weather")) await api.pool.grant({ actor: a.pc.id, app: "weather" });
  await game.settings.set(MODULE, "weather", {});
  await until(() => store.apps.weather?.now?.today && store.apps.weather[store.apps.weather.now.today], "the forecast", 15000);
  return store.apps.weather.now.today;
}, { pc });

/** GM: set today (or another day) by hand and wait for it. */
const setDay = (gm, key, w) => gm.run(async a => {
  store.request("wx-set", { key: a.key, ...a.w });
  await until(() => store.apps.weather[a.key]?.w.cond === a.w.cond && store.apps.weather[a.key].src === "gm", `${a.w.cond} set`);
}, { key, w });

/** A character with every core skill and a worn armor with a −2 penalty (copied once per lane). */
const tester = (gm, prefix) => gm.run(async a => {
  const name = `${a.prefix}Weather Tester`;
  let actor = game.actors.getName(name);
  if (!actor) {
    const src = game.actors.find(x => x.type === "character" && x.items.filter(i => i.type === "skill").length > 30)?.toObject();
    if (!src) throw new Error("no character with core skills to copy");
    delete src._id;
    // Owned by the lane's player: CPR's tracked-armor hook updates the actor from every client that sees an
    // armor change (docs gotchas.md), and a client that doesn't own it logs a permission error.
    Object.assign(src, { name, effects: [], folder: null, items: src.items.filter(i => i.type === "skill" || i.type === "role"),
      ownership: { default: 0, [game.users.getName(`ClaudePlayer${a.prefix.match(/\d+/)[0]}`).id]: 3 } });
    actor = await Actor.create(src);
  }
  const player = game.users.getName(`ClaudePlayer${a.prefix.match(/\d+/)[0]}`);
  if (!actor.testUserPermission(player, "OWNER")) await actor.update({ ownership: { default: 0, [player.id]: 3 } }, { diff: false, recursive: false });
  if (!actor.items.getName(`${a.prefix}Armorjack`)) {
    await actor.createEmbeddedDocuments("Item", [{ name: `${a.prefix}Armorjack`, type: "armor", system: { equipped: "equipped", isBodyLocation: true, bodyLocation: { sp: 11, ablation: 0 }, penalty: 2 } }]);
  }
  return actor.id;
}, { prefix });

test("ten days on the forecast; scheduling a run of Inversion Smog carries over the next days", async ({ gm, pc }) => {
  await ready(gm, pc);
  const run = await gm.run(async () => {
    await go("weather");
    const keys = els(".agent-wx-tile").map(t => t.dataset.key);
    const target = keys[3];
    await tap(`.agent-wx-tile[data-key="${target}"]`);
    await until(() => el(".agent-wx-tile.picked")?.dataset.key === target, "the day picked on the strip");
    await tap(`[data-action="wx-edit"][data-key="${target}"]`);
    const pick = await until(() => el('[data-action="dropdown-pick"][data-name="wxCond"][data-value="smog"]'), "Inversion Smog in the list");
    pick.click();
    await until(() => el("input[name=wxN]"), "how long");
    await fill("input[name=wxN]", "3");
    await tap("[data-action=wx-save]");
    await until(() => store.apps.weather[target]?.w.cond === "smog", "saved");
    const i = keys.indexOf(target);
    // The host fills the following days after the save: wait for them rather than read the strip mid-update.
    await until(() => keys.slice(i + 1, i + 3).every(k => store.apps.weather[k]?.src === "carry"), "the next two days to carry over");
    return { days: keys.length, run: keys.slice(i, i + 3).map(k => [store.apps.weather[k].w.cond, store.apps.weather[k].src]) };
  });
  same(run.days, 10, "today and nine more days on the strip");
  same(JSON.stringify(run.run), JSON.stringify([["smog", "gm"], ["smog", "carry"], ["smog", "carry"]]), "the run carries over");
});

test("apply: the penalty is an unticked roll-dialog option; Heat Wave makes −2 armor −4; Clear takes it off", async ({ gm, pc, prefix }) => {
  const today = await ready(gm, pc);
  const id = await tester(gm, prefix);
  try {
    await setDay(gm, today, { temp: "cool", cond: "heavyRain" });
    const rain = await gm.run(async a => {
      const actor = game.actors.get(a.id);
      store.request("wx-apply", { actorIds: [a.id] });
      await until(() => actor.effects.some(e => e.flags[MODULE]?.weather?.cond === "heavyRain"), "the effect");
      const skill = actor.items.find(i => i.type === "skill" && i.name === "Perception");
      const roll = skill.createRoll("skill", actor);
      const { default: CPRMod } = await import("/systems/cyberpunk-red-core/modules/rolls/cpr-modifiers.js");
      const sit = CPRMod.getSituationalRollMods(roll, Array.from(actor.allApplicableEffects()), skill, actor);
      return { onRoll: roll.mods.some(m => /weather/i.test(m.source ?? "")), sit: sit.map(m => [m.source, m.value, !!m.onByDefault]) };
    }, { id });
    check(!rain.onRoll, "not on the roll by itself");
    check(rain.sit.some(([s, v, on]) => /Heavy Rain/.test(s) && v === -2 && !on), `offered unticked: ${JSON.stringify(rain.sit)}`);

    await setDay(gm, today, { temp: "warm", cond: "heatWave", n: 1 });
    const heat = await gm.run(async a => {
      const actor = game.actors.get(a.id);
      store.request("wx-apply", { actorIds: [a.id] });
      await until(() => actor.effects.some(e => e.flags[MODULE]?.weather?.cond === "heatWave"), "the heat");
      const during = actor.getArmorPenaltyMods("ref");
      store.request("wx-clear");
      await until(() => !actor.effects.some(e => e.flags[MODULE]?.weather), "cleared");
      return { during, after: actor.getArmorPenaltyMods("ref") };
    }, { id });
    same(heat.during, -4, "Heat Wave: −2 becomes −4");
    same(heat.after, -2, "cleared: back to the armor's own −2");
  } finally {
    await gm.run(() => store.request("wx-clear"));
  }
});

test("a Vial of Poison check: on the player's phone; a failure's damage applied from the GM page", async ({ gm, pl, pc }) => {
  const today = await ready(gm, pc);
  await setDay(gm, today, { temp: "cool", cond: "ashStorm", n: 30 });
  const checkId = await gm.run(async a => {
    const known = new Set(Object.keys(store.apps.wxChecks));
    store.request("wx-hazard", { kind: "poison", actorIds: [a.pc.id] });
    return (await until(() => Object.values(store.apps.wxChecks).find(c => !known.has(c.id) && c.actorId === a.pc.id), "the check")).id;
  }, { pc });
  const seen = await pl.run(async a => {
    await go("weather");
    await until(() => el(`[data-wx-check="${a.checkId}"]`), "the check on the phone");
    return text(`[data-wx-check="${a.checkId}"]`);
  }, { checkId });
  check(/DV13 Resist Torture\/Drugs/.test(seen) && /2d6/.test(seen), `the player sees it: ${seen}`);
  const hp = await gm.run(async a => {
    const actor = game.actors.get(a.pc.id);
    const hp0 = actor.system.derivedStats.hp.value;
    store.request("wx-check-roll", { checkId: a.checkId, total: 5, detail: "live test" });
    await until(() => store.apps.wxChecks[a.checkId].result === "fail", "failed");
    await go("weather");
    await tap(`[data-wx-check="${a.checkId}"] [data-action="wx-check-resolve"][data-apply="true"]`);
    await until(() => store.apps.wxChecks[a.checkId].done, "resolved");
    await until(() => actor.system.derivedStats.hp.value !== hp0, "HP down");
    const res = { hp0, hp1: actor.system.derivedStats.hp.value, damage: store.apps.wxChecks[a.checkId].damage };
    await actor.update({ "system.derivedStats.hp.value": hp0 });
    return res;
  }, { pc, checkId });
  same(hp.hp1, hp.hp0 - hp.damage, "2d6 straight to HP");
  check(hp.damage >= 2 && hp.damage <= 12, `2d6: ${hp.damage}`);
});

test("Acid Rain ablates worn armor; a Blackout cuts the signal until Clear; the Calendar shows the weather", async ({ gm, pl, pc, prefix }) => {
  const today = await ready(gm, pc);
  const id = await tester(gm, prefix);
  try {
    await setDay(gm, today, { temp: "cool", cond: "acidRain", n: 1 });
    const ablation = await gm.run(async a => {
      const armor = game.actors.get(a.id).items.getName(`${a.prefix}Armorjack`);
      const before = armor.system.bodyLocation.ablation;
      store.request("wx-hazard", { kind: "ablate", actorIds: [a.id] });
      await until(() => armor.system.bodyLocation.ablation === before + 1, "1 SP ablated");
      return before + 1;
    }, { id, prefix });
    check(ablation >= 1, "ablated");

    await setDay(gm, today, { temp: "cool", cond: "blackout", n: 1 });
    await gm.run(async a => {
      store.request("wx-apply", { actorIds: [a.pc.id] });
      await until(() => !api.hasSignal(a.pc.id), "no signal");
      store.request("wx-clear");
      await until(() => api.hasSignal(a.pc.id), "signal back");
    }, { pc });

    const cal = await pl.run(async () => {
      if (!game.modules.get("foundryvtt-simple-calendar")?.active) return null;
      await go("calendar");
      await until(() => el(".agent-cal-wx"), "weather on the Calendar");
      return els(".agent-cal-wx").length;
    });
    check(cal === null || cal >= 1, `Calendar weather icons: ${cal}`);
  } finally {
    await gm.run(() => store.request("wx-clear"));
  }
});

test("posting the forecast in The Garden asks first; No posts nothing, Yes posts as Morro Rock Radio", async ({ gm, pc }) => {
  await ready(gm, pc);
  const res = await gm.run(async () => {
    if (!api.feature("app_garden")) return null;
    await go("weather");
    if (!el("[data-action=wx-radio]")) await tap("[data-action=wx-fold][data-fold=options]");
    const answer = async yes => {
      el("[data-action=wx-radio]").click();
      const dlg = await until(() => Object.values(ui.windows).find(w => w.title === "Morro Rock Radio" && w.rendered), "the confirmation");
      [...dlg.element[0].querySelectorAll("button")].find(b => (yes ? /yes/i : /no/i).test(b.textContent)).click();
    };
    const radio = () => Object.values(store.garden.posts).filter(p => store.garden.accounts[p.accountId]?.handle === "@morrorockradio").length;
    const before = radio();
    await answer(false);
    await new Promise(r => setTimeout(r, 1000));
    const afterNo = radio();
    await answer(true);
    await until(() => radio() === before + 1, "the post");
    return { before, afterNo, afterYes: radio() };
  });
  if (res) {
    same(res.afterNo, res.before, "No: nothing posted");
    same(res.afterYes, res.before + 1, "Yes: posted");
  }
});

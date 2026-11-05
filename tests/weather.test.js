import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import {
  armorExtra, carryOver, condName, gearOf, gmFlags, hazardsOf, isProtected, rollDay, rollStrange, rulesCard, setByHand, tempOf, wackyLine, weatherEffect, weatherFlag, weatherOptions
} from "../apps/weather/model.js";
import { weatherArmor } from "../apps/weather/client.js";
import { weatherDays } from "../apps/weather/dates.js";
import { CONDITIONS, STRANGE, TABLES, WACKY, seasonOf } from "../apps/weather/tables.js";

/*
 * Weather (apps/weather): Night City Weather's tables as printed, the rolls, the rules card, the effects
 * (the GM's penalty as a roll-dialog option, the heat's armor penalty, the umbrella's +2), gear, and the
 * host's forecast: ten days filled, a run of Strange Weather days carrying over, wrong forecasts revealed
 * on the day, applying and clearing, and a Blackout's signal.
 */

/** A die that rolls these faces in turn (1-based), as rng() values. */
const dice = (...faces) => {
  const sides = faces.map(([face, n]) => (face - 0.5) / n);
  return () => sides.shift() ?? 0.01;
};

test("the tables are the book's: four seasons of six rows, Strange Weather on a 6", () => {
  assert.equal(TABLES.length, 4);
  for (const t of TABLES) {
    assert.equal(t.length, 6);
    assert.equal(t[5][3], "strange");
  }
  assert.deepEqual(TABLES[0][0], ["cold", 35, 2, "clear"]);
  assert.deepEqual(TABLES[2][5], ["hot", 90, 32, "strange"]);
  assert.deepEqual([0, 1, 2, 4, 5, 7, 8, 10, 11].map(seasonOf), [0, 0, 1, 1, 2, 2, 3, 3, 0]);
  assert.equal(STRANGE.length, 10);
  for (const id of Object.keys(CONDITIONS)) assert.ok(WACKY[id]?.length, `Wacky has a line for ${id}`);
});

test("a day: temperature, then conditions; a 6 rolls Strange Weather and its duration", () => {
  // Summer: temperature 4 (Hot 80), conditions 2 (Clear).
  assert.deepEqual(rollDay(2, dice([4, 6], [2, 6])), { temp: "hot", f: 80, c: 27, cond: "clear" });
  // Winter: temperature 1 (Cold 35), conditions 6 → Strange 8 (Cold Snap, it's cold), 3 days.
  const w = rollDay(0, dice([1, 6], [6, 6], [8, 10], [3, 6]));
  assert.deepEqual(w, { temp: "cold", f: 35, c: 2, cond: "coldSnap", dur: { n: 3, unit: "day", day: 1 } });
  // Strange 8 when it's warm: a Heat Wave. Minutes are 1d6 × 10.
  assert.equal(rollStrange("warm", dice([8, 10], [1, 6])).cond, "heatWave");
  assert.deepEqual(rollStrange("warm", dice([2, 10], [4, 6])).dur, { n: 40, unit: "minute" });
  // Blood Rain rolls its 1d6 kind.
  const blood = rollStrange("cool", dice([4, 10], [2, 6], [5, 6]));
  assert.deepEqual([blood.cond, blood.dur.n, blood.dur.unit, blood.variant], ["bloodRain", 2, "hour", 5]);
});

test("Cold Snap and Heat Wave override the temperature; sleet when it's cold", () => {
  assert.equal(tempOf({ temp: "cool", f: 50, c: 10, cond: "coldSnap" }).label, "Below freezing");
  assert.equal(tempOf({ temp: "warm", f: 70, c: 21, cond: "heatWave" }).temp, "hot");
  assert.equal(condName({ temp: "cold", cond: "lightRain" }), "Light Sleet");
  assert.equal(condName({ temp: "cool", cond: "heavyRain" }), "Heavy Rain");
});

test("a run of days carries over until it's done", () => {
  const w = { temp: "cool", f: 50, c: 10, cond: "smog", dur: { n: 2, unit: "day", day: 1 } };
  assert.deepEqual(carryOver(w).dur, { n: 2, unit: "day", day: 2 });
  assert.equal(carryOver(carryOver(w)), null);
  assert.equal(carryOver({ cond: "ashStorm", dur: { n: 30, unit: "minute" } }), null);
});

test("set by hand: degrees from the table unless given, a given duration kept", () => {
  assert.deepEqual(setByHand({ temp: "hot", cond: "clear" }, 2), { temp: "hot", f: 80, c: 27, cond: "clear" });
  assert.deepEqual(setByHand({ temp: "warm", f: 77, cond: "acidRain", n: 4 }, 1, dice([1, 6])), { temp: "warm", f: 77, c: 25, cond: "acidRain", dur: { n: 4, unit: "hour" } });
});

test("effects: the GM's penalty is a roll-dialog option, off by default", () => {
  const e = weatherEffect({ temp: "cool", cond: "smog" });
  assert.deepEqual(e.changes, [{ key: "bonuses.allActions", mode: 2, value: "-4" }]);
  assert.deepEqual(e.flags["cyberpunk-red-core"].changes.situational["0"], { isSituational: true, onByDefault: false });
  assert.equal(e.flags["cyberpunk-red-core"].changes.cats["0"], "misc");
  assert.equal(weatherEffect({ temp: "cool", cond: "clear" }), null, "nothing to apply");
  assert.equal(weatherEffect({ temp: "warm", cond: "flooding" }), null);
});

test("the heat: Hot +1 and Heat Wave +2 armor penalty, a Hot-Weather Lining takes 1 off", () => {
  assert.equal(armorExtra({ temp: "hot", cond: "clear" }), 1);
  assert.equal(armorExtra({ temp: "warm", cond: "heatWave" }), 2);
  assert.equal(armorExtra({ temp: "warm", cond: "heatWave" }, new Set(["hotLining"])), 1);
  assert.equal(armorExtra({ temp: "hot", cond: "clear" }, new Set(["hotLining"])), 0);
  const e = weatherEffect({ temp: "hot", cond: "lightRain" });
  assert.equal(weatherFlag(e).armor, 1);
  assert.equal(e.changes.length, 1, "the light rain's −1 option; the armor is in the flag");
  // client.js reads it while the effect is on.
  assert.equal(weatherArmor({ effects: [e] }), 1);
  assert.equal(weatherArmor({ effects: [{ ...e, disabled: true }] }), 0);
});

test("gear: carried, equipped or installed, and upgrades; it protects from the right hazards", () => {
  const actor = {
    items: [
      { name: "Umbrella", type: "gear", system: { equipped: "carried" } },
      { name: "Nasal Filters", type: "cyberware", system: { isInstalled: true } },
      { name: "Radiation Suit", type: "gear", system: { equipped: "owned" } },
      { name: "Jacket", type: "clothing", system: { equipped: "equipped", upgrades: [{ name: "Hot-Weather Jacket Lining" }] } }
    ]
  };
  const gear = gearOf(actor);
  assert.deepEqual([...gear].sort(), ["filter", "hotLining", "umbrella"]);
  assert.ok(isProtected({ cond: "acidRain" }, gear));
  assert.ok(isProtected({ cond: "ashStorm" }, gear));
  assert.ok(!isProtected({ cond: "radioactive" }, gear), "the suit is at home");
  assert.ok(isProtected({ cond: "bloodRain", variant: 2 }, gear), "acid Blood Rain: the umbrella negates it");
  assert.ok(!isProtected({ cond: "bloodRain", variant: 5 }, gear), "toxic Blood Rain: only +2 to the check");
  const blood = weatherEffect({ temp: "cool", cond: "bloodRain", variant: 5 }, gear);
  assert.deepEqual(blood.changes.map(c => [c.key, c.value]), [["bonuses.allActions", "-1"], ["bonuses.resistTortureOrDrugs", "2"]]);
  assert.deepEqual(blood.flags["cyberpunk-red-core"].changes.situational["1"], { isSituational: true, onByDefault: true });
});

test("hazards and the rules card follow the condition", () => {
  assert.deepEqual(hazardsOf({ cond: "ashStorm" }), ["poison", "foreign"]);
  assert.deepEqual(hazardsOf({ cond: "thunderstorm" }), ["lightning", "strike"]);
  assert.deepEqual(hazardsOf({ cond: "bloodRain", variant: 1 }), ["ablate"]);
  assert.deepEqual(hazardsOf({ cond: "bloodRain", variant: 6 }), ["biotoxin"]);
  const card = rulesCard({ temp: "hot", f: 90, c: 32, cond: "heavyRain" });
  assert.ok(card.lines.some(l => /armor penalty/.test(l)) && card.lines.some(l => /−2/.test(l)));
  assert.match(wackyLine({ temp: "hot", f: 90, c: 32, cond: "clear" }, "2045-1-1"), /\S/);
});

/* ---------------- The host ---------------- */

let gm;
const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const days = () => weatherDays(10).map(d => d.key);

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"] });
  addActor({ id: "pcB", name: "Jackie", owners: ["alice"] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getWhisperRecipients: () => [{ id: "gm" }] };
  await set("features", { app_weather: true });
  await set("noSignal", {});
});

test("the host fills ten days, keeps them, and turns the day over", async () => {
  await store._weatherSync();
  const keys = days();
  assert.ok(keys.every(k => store.apps.weather[k]?.w), "ten days rolled");
  assert.equal(store.apps.weather.now.today, keys[0]);
  const before = JSON.stringify(store.apps.weather[keys[3]].w);
  await store._weatherSync();
  assert.equal(JSON.stringify(store.apps.weather[keys[3]].w), before, "a second sync rolls nothing again");
  // Off: nothing happens.
  await set("features", { app_weather: false });
  store.apps.weather = {};
  await store._weatherSync();
  assert.deepEqual(store.apps.weather, {});
});

test("a wrong forecast is GM only, and is what happens on the day", async () => {
  await store._weatherSync();
  const [today, tomorrow] = days();
  const row = store.apps.weather[tomorrow];
  row.actual = { temp: "cool", f: 50, c: 10, cond: "heavyRain" };
  const { appsFor } = await import("../scripts/model/apps.js");
  const seen = appsFor(game.users.get("alice"), store.apps).weather;
  assert.ok(seen[tomorrow] && !("actual" in seen[tomorrow]), "the player sees the forecast, not the truth");
  // Pretend tomorrow is today.
  store.apps.weather.now.today = null;
  delete store.apps.weather[today];
  store.apps.weather[today] = { ...row, key: today };
  await store._weatherSync();
  assert.equal(store.apps.weather[today].w.cond, "heavyRain");
  assert.ok(store.apps.weather[today].missed && !store.apps.weather[today].actual);
});

test("the GM sets a run of days ahead: it carries over, and gives the days back when it's shortened", async () => {
  await store._weatherSync();
  const keys = days();
  from(gm, "wx-set", { key: keys[2], temp: "cool", cond: "smog", n: 3 });
  await settle();
  assert.deepEqual([2, 3, 4].map(i => [store.apps.weather[keys[i]].w.cond, store.apps.weather[keys[i]].w.dur.day]), [["smog", 1], ["smog", 2], ["smog", 3]]);
  assert.equal(store.apps.weather[keys[3]].src, "carry");
  from(gm, "wx-set", { key: keys[2], temp: "cool", cond: "smog", n: 1 });
  await settle();
  assert.equal(store.apps.weather[keys[3]].src, "roll", "the old run's days are rolled again");
});

test("apply: effects on the characters, replaced when the weather changes, cleared; a Blackout cuts the signal", async () => {
  await store._weatherSync();
  const today = days()[0];
  from(gm, "wx-set", { key: today, temp: "cool", cond: "heavyRain" });
  await settle();
  from(gm, "wx-apply", { actorIds: ["pcA", "pcB"] });
  await settle();
  const fx = id => [...game.actors.get(id).effects.values()].filter(e => weatherFlag(e));
  assert.deepEqual(fx("pcA").map(e => e.name), ["Weather: Heavy Rain"]);
  assert.deepEqual(store.apps.weather.now.applied.actorIds, ["pcA", "pcB"]);

  // New weather: the old effects go; not applied again without "apply automatically".
  from(gm, "wx-set", { key: today, temp: "cool", cond: "clear" });
  await settle();
  assert.equal(fx("pcA").length, 0);
  assert.equal(store.apps.weather.now.applied, null);

  // Automatically: they follow.
  await set("weather", { autoApply: true });
  from(gm, "wx-set", { key: today, temp: "cool", cond: "smog" });
  await settle();
  from(gm, "wx-apply", { actorIds: ["pcA"] });
  await settle();
  from(gm, "wx-set", { key: today, temp: "cool", cond: "blackout", n: 1 });
  await settle();
  assert.deepEqual(Object.keys(game.settings.get("cpr-sam-agent", "noSignal")), ["pcA"], "the Blackout took pcA offline");
  from(gm, "wx-clear");
  await settle();
  assert.deepEqual(game.settings.get("cpr-sam-agent", "noSignal"), {}, "and Clear gives it back");
});

test("players can't change the weather", async () => {
  await store._weatherSync();
  const today = days()[0];
  const before = JSON.stringify(store.apps.weather[today].w);
  from(game.users.get("alice"), "wx-set", { key: today, temp: "hot", cond: "heatWave" });
  await settle();
  assert.equal(JSON.stringify(store.apps.weather[today].w), before);
});

test("the GM's flags: per-minute damage and Exposure, in chat once per weather, nothing applied", async () => {
  assert.deepEqual(gmFlags({ cond: "clear", temp: "warm" }), []);
  assert.equal(gmFlags({ cond: "acidRain", temp: "warm" }).length, 1);
  assert.match(gmFlags({ cond: "clear", temp: "cold" })[0], /Exposure.*Cold-Weather Jacket Lining/);
  assert.match(gmFlags({ cond: "heatWave", temp: "hot" }).at(-1), /Exposure.*Hot-Weather/);
  assert.equal(gmFlags({ cond: "ashStorm", temp: "warm" }).length, 2, "poison and Foreign Object");

  await store._weatherSync();
  const key = store.apps.weather.now.today;
  store.apps.weather[key].w = setByHand({ cond: "acidRain", temp: "warm" });
  store.apps.weather.now.event = null;
  ChatMessage.created.length = 0;
  await store._weatherSync();
  await store._weatherSync();
  assert.equal(ChatMessage.created.length, 1, "once");
  assert.deepEqual(ChatMessage.created[0].whisper, [{ id: "gm" }]);
  assert.match(ChatMessage.created[0].content, /worn armor loses 1 SP/);
});

test("Morro Rock Radio: its Garden account is made once the Garden is in, verified news with its picture; the post is on by default", async () => {
  assert.equal(weatherOptions({}).radio, true);
  store._radioChecked = false;
  await store._weatherSync();
  assert.ok(!Object.values(store.garden.accounts).length, "not before the Garden is in");
  store._seedGarden();
  store._radioChecked = false;
  await store._weatherSync();
  const accounts = Object.values(store.garden.accounts).filter(a => a.handle === "@morrorockradio");
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].kind, "news");
  assert.equal(accounts[0].verified, true);
  assert.match(accounts[0].avatar, /images\/weather\/morro-rock-radio\.svg$/);
  accounts[0].avatar = null;
  store._radioChecked = false;
  await store._weatherSync();
  assert.match(accounts[0].avatar, /morro-rock-radio/, "set right, not made twice");
  assert.equal(Object.values(store.garden.accounts).filter(a => a.handle === "@morrorockradio").length, 1);
});

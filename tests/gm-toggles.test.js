import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { APP_MANIFEST } from "../scripts/apps/manifest.js";
import { agentsOf, agentType } from "../scripts/model/agent.js";
import { CITINET_APPS, citinetOffline, needsCitinet, setNeedsCitinet } from "../scripts/model/features.js";
import { agentMods, librarySearchBase } from "../apps/alex/model.js";
import { addonEffect } from "../apps/pool/model.js";
import { weatherOptions } from "../apps/weather/model.js";

/*
 * The GM's toggles (T266): Needs CitiNet per app, Require carried Agent item, the Library Search bonuses,
 * a Blackout cutting the signal. Every one defaults to how it was before.
 */

const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);

beforeEach(async () => {
  await store._writing;
  reset();
  const gm = addUser({ id: "gm", isGM: true });
  addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], system: { stats: { int: { value: 6 } } } });
  addActor({ id: "pcB", name: "Jackie", owners: ["alice"], items: [] });
  addActor({ id: "npc", name: "Dex", items: [] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("CitiNet apps: the 14 from the manifest, each browsable or blocked offline; The Garden blocks", () => {
  assert.equal(CITINET_APPS.length, 14);
  for (const id of CITINET_APPS) assert.ok(["browse", "block"].includes(APP_MANIFEST[id].offline), `${id} has an offline mode`);
  assert.equal(citinetOffline("garden"), "block");
  assert.equal(citinetOffline("alex"), "browse");
  assert.equal(citinetOffline("map"), "browse", "not a CitiNet app: the default");
});

test("Needs CitiNet: the manifest's by default; the GM's switch saves only a difference", async () => {
  assert.deepEqual([needsCitinet("garden"), needsCitinet("map")], [true, false]);
  await setNeedsCitinet("garden", false);
  assert.equal(needsCitinet("garden"), false);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "citinetApps"), { garden: false });
  await setNeedsCitinet("garden", true);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "citinetApps"), {}, "back to the default: nothing saved");
});

test("_citinet: without a signal a CitiNet app is refused, unless the GM says it doesn't need it", async () => {
  const actor = game.actors.get("pcA");
  assert.equal(store._citinet(actor, "garden"), true, "with a signal");
  await set("noSignal", { pcA: Date.now() });
  assert.equal(store._citinet(actor, "garden"), false);
  await setNeedsCitinet("garden", false);
  assert.equal(store._citinet(actor, "garden"), true);
  assert.equal(store._citinet(game.actors.get("pcB"), "garden"), false, "still no Agent, no app");
});

test("Require carried Agent item: on, the item counts; off, every player character has an Agent", async () => {
  assert.deepEqual([agentType(game.actors.get("pcA")), agentType(game.actors.get("pcB"))], ["agent", null]);
  await set("requireAgentItem", false);
  assert.equal(agentType(game.actors.get("pcB")), "agent");
  assert.deepEqual(agentsOf(game.actors.get("pcB")), { internal: false, agent: true });
  assert.equal(agentType(game.actors.get("npc")), null, "an NPC still needs the item");
});

test("Library Search bonuses: +2 and +1 by default; the GM's numbers everywhere, the Big SAAI effect too", async () => {
  const actor = game.actors.get("pcA");
  assert.deepEqual([librarySearchBase(actor).bonus, librarySearchBase(actor, true).bonus], [2, 3]);
  await set("agentLibraryBonus", 3);
  await set("bigSaaiBonus", 2);
  assert.deepEqual([librarySearchBase(actor).bonus, librarySearchBase(actor, true).total], [3, 6 + 0 + 5]);
  assert.deepEqual(agentMods([], true, "DataPool").map(m => m.value), [3, 2]);
  assert.equal(addonEffect("bigsaai").changes[0].value, "2");
});

test("Weather: a Blackout cuts the signal by default; the GM's option can say it doesn't", () => {
  assert.equal(weatherOptions({}).blackoutSignal, true);
  assert.equal(weatherOptions({ blackoutSignal: false }).blackoutSignal, false);
  assert.equal(weatherOptions({ blackoutSignal: 0 }).blackoutSignal, false);
});

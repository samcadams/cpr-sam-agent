import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { addonEffect, hasAddon, installedSet, poolConfig, setSubsBilledBy, storeApps } from "../apps/pool/model.js";
import { agentMods, BIG_SAAI, librarySearchBase } from "../apps/alex/model.js";

/*
 * Big SAAI (apps/alex/, an App Store add-on in apps/pool/): +1 on top of the Agent's +2 to Library Search, bought
 * from Ask Alex's banner, kept as an install row whether or not the App Store is on, with a situational effect on
 * the sheet while they have it; the GM's grant and revoke; "priority crawl" questions.
 */

let gm, alice;

const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
  await new Promise(r => setTimeout(r, 10)); // the add-on's effect is written after the row
};
const wealth = id => game.actors.get(id).system.wealth.value;
const saai = id => hasAddon(store.apps.installs, id, BIG_SAAI);
const effects = id => [...game.actors.get(id).effects.values()].filter(e => e.flags?.["cpr-sam-agent"]?.addon === BIG_SAAI);

beforeEach(async () => {
  await store._writing;
  reset();
  setSubsBilledBy(null);
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500, system: { stats: { int: { value: 6 } } } });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("the bonus: +2 from the Agent, +3 with Big SAAI; the phone adds only what the sheet doesn't", () => {
  assert.equal(librarySearchBase(game.actors.get("pcA")).total, 8);
  assert.deepEqual([librarySearchBase(game.actors.get("pcA"), true).bonus, librarySearchBase(null, true).total], [3, 3]);
  assert.deepEqual(agentMods([], false, "Ask Alex Anything").map(m => m.value), [2]);
  assert.deepEqual(agentMods([], true, "DataPool").map(m => [m.value, m.source]), [[2, "Agent (DataPool)"], [1, "Big SAAI"]]);
  // The sheet's Agent effect gives the +2, Big SAAI's effect the +1: never +5.
  assert.deepEqual(agentMods([{ source: "Agent", value: 2 }], true, "x").map(m => m.value), [1]);
  assert.deepEqual(agentMods([{ source: "Internal Agent", value: 2 }, { source: "Big SAAI", value: 1 }], true, "x"), []);
});

test("the catalogue: 100eb, hidden, an Ask Alex add-on; never a store app or a home tile", () => {
  const cfg = poolConfig({ apps: { bigsaai: { offer: "store", model: "monthly", preinstalled: true } } });
  assert.deepEqual([cfg.apps.bigsaai.price, cfg.apps.bigsaai.model, cfg.apps.bigsaai.offer, cfg.apps.bigsaai.preinstalled, cfg.apps.bigsaai.addon], [100, "once", "hidden", false, "alex"]);
  assert.equal(poolConfig({ apps: { bigsaai: { price: 0 } } }).apps.bigsaai.model, "free");
  assert.ok(!storeApps({}, "pcA", cfg, () => true).includes(BIG_SAAI));
  assert.ok(!installedSet({ pcA: { bigsaai: { source: "gm" } } }, "pcA", cfg).has(BIG_SAAI));
  const effect = addonEffect(BIG_SAAI);
  assert.deepEqual(effect.changes, [{ key: "bonuses.librarySearch", mode: 2, value: "1" }]);
  assert.deepEqual(effect.flags["cyberpunk-red-core"].changes.situational[0], { isSituational: true, onByDefault: true });
});

test("hasAddon: bought or given, not revoked or removed, with the App Store on or off", () => {
  assert.equal(hasAddon({ pcA: { bigsaai: { source: "store" } } }, "pcA", BIG_SAAI), true);
  assert.equal(hasAddon({ pcA: { bigsaai: { source: "store", revoked: "Bricked" } } }, "pcA", BIG_SAAI), false);
  assert.equal(hasAddon({ pcA: { bigsaai: { source: "store", removed: true } } }, "pcA", BIG_SAAI), false);
  assert.equal(hasAddon({ pcA: { cabb: { source: "store" } } }, "pcA", "cabb"), false, "only add-ons");
  assert.equal(hasAddon({}, "pcA", BIG_SAAI), false);
});

test("buying from Ask Alex (App Store off): 100eb through BangMe!, a pool ledger line, the sheet's effect; once only", async () => {
  from(alice, "alex-saai-buy", { actorId: "pcA" });
  from(alice, "alex-saai-buy", { actorId: "pcA" }); // a double tap
  await settle();
  assert.ok(saai("pcA"));
  assert.equal(wealth("pcA"), 400, "charged once");
  assert.ok(Object.values(store.apps.ledger).some(e => e.kind === "pool" && e.amount === -100 && /Big SAAI/.test(e.memo ?? e.text ?? "")));
  assert.equal(effects("pcA").length, 1);
  from(alice, "alex-saai-buy", { actorId: "pcA" });
  await settle();
  assert.equal(wealth("pcA"), 400, "owned: not sold again");
});

test("declined: nothing written", async () => {
  game.actors.get("pcA").system.wealth.value = 50;
  from(alice, "alex-saai-buy", { actorId: "pcA" });
  await settle();
  assert.ok(!saai("pcA"));
  assert.equal(effects("pcA").length, 0);
});

test("the GM revokes (effect goes, no buying back) and grants it again", async () => {
  from(alice, "alex-saai-buy", { actorId: "pcA" });
  await settle();
  from(gm, "pool-revoke", { actorId: "pcA", app: BIG_SAAI, reason: "Bricked by a virus", refund: true });
  await settle();
  assert.ok(!saai("pcA"));
  assert.equal(wealth("pcA"), 500, "refunded");
  assert.equal(effects("pcA").length, 0);
  assert.ok(Object.values(store.apps.alerts).some(a => /Big SAAI was removed.*Bricked by a virus/.test(a.text)));
  from(alice, "alex-saai-buy", { actorId: "pcA" });
  await settle();
  assert.ok(!saai("pcA"), "revoked: can't be bought back");
  from(gm, "pool-grant", { actorId: "pcA", app: BIG_SAAI });
  await settle();
  assert.ok(saai("pcA"));
  assert.equal(effects("pcA").length, 1);
  // A player can't uninstall it.
  await set("features", { app_pool: true });
  from(alice, "pool-remove", { actorId: "pcA", app: BIG_SAAI });
  await settle();
  assert.ok(saai("pcA"));
});

test("questions from a Big SAAI owner are priority crawls, and the GM's card says +3", async () => {
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  await settle();
  from(gm, "pool-grant", { actorId: "pcA", app: BIG_SAAI });
  await settle();
  from(alice, "alex-ask", { actorId: "pcA", text: "Where's Rogue?" });
  await settle();
  const qs = Object.values(store.apps.queries).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(qs.map(q => !!q.priority), [false, true]);
  const card = store.apps.gmCards[`alex:${qs[1].id}`];
  assert.match(card.body, /Library Search \+3/);
  assert.match(card.title, /Big SAAI/);
});

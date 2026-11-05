import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsFor, emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { etaLabel, HOME_GRADE, scanPercent, SCAN_SECONDS, weakPoint, WEAK_POINTS } from "../apps/fortify/model.js";
import { CATALOGUE_DEFAULTS, DEFAULT_LISTINGS } from "../apps/pool/model.js";

/*
 * 4Tify (apps/fortify/model.js, apps/fortify/host.js): the store entry, a scan on world time becoming a mark, Use mark's
 * d6, the GM's void, and who may do what. Rolls and chat are faked (the shared stub has neither).
 */

let gm, alice, bob;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const marks = () => Object.values(store.apps.fortifyMarks);
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);
const scan = async () => {
  from(alice, "fortify-scan", { actorId: "pcA" });
  await settle();
  return marks().at(-1);
};
const passTime = async seconds => {
  game.time.worldTime += seconds;
  await store._tickFortify();
  await settle();
};

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 100 });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 100 });
  game.time.worldTime = 1000;
  globalThis.Roll = class { async evaluate() { return { total: 4 }; } };
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getSpeaker: () => ({}) };
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  await game.settings.set("cpr-sam-agent", "features", { app_fortify: true });
});

test("the App Store sells it for 100eb and the coming-soon listing is gone", () => {
  assert.deepEqual(CATALOGUE_DEFAULTS.fortify, { publisher: "SecSystems", price: 100, model: "once" });
  assert.ok(!DEFAULT_LISTINGS.some(l => l.id === "bc-4tify"));
});

test("a scan takes 5 minutes of world time, then the mark is ready and the player is told", async () => {
  const mark = await scan();
  assert.deepEqual([mark.status, mark.startedAt, mark.dueAt], ["scanning", 1000, 1000 + SCAN_SECONDS]);
  assert.ok(gmCards().some(c => c.id === `fortify:${mark.id}` && c.actions[0].request === "fortify-void"), "the GM's card has Void");
  await passTime(SCAN_SECONDS - 1);
  assert.equal(mark.status, "scanning");
  await passTime(1);
  assert.equal(mark.status, "ready");
  assert.match(lastAlert("pcA").text, /Scan done/);
});

test("one scan at a time per character", async () => {
  await scan();
  await scan();
  assert.equal(marks().length, 1);
});

test("a player can't scan for someone else's character, or without the app", async () => {
  from(bob, "fortify-scan", { actorId: "pcA" });
  await game.settings.set("cpr-sam-agent", "features", { app_fortify: false });
  from(alice, "fortify-scan", { actorId: "pcA" });
  await settle();
  assert.equal(marks().length, 0);
});

test("Use mark rolls the d6 once, on a card, and only for a ready mark of your own", async () => {
  const mark = await scan();
  from(alice, "fortify-use", { id: mark.id });
  await settle();
  assert.equal(mark.status, "scanning", "not while scanning");
  await passTime(SCAN_SECONDS);
  from(bob, "fortify-use", { id: mark.id });
  await settle();
  assert.equal(mark.status, "ready", "not someone else's");
  from(alice, "fortify-use", { id: mark.id });
  from(alice, "fortify-use", { id: mark.id });
  await settle();
  await new Promise(r => setTimeout(r));
  assert.deepEqual([mark.status, mark.total], ["used", 4]);
  assert.equal(ChatMessage.created.length, 1);
  assert.match(ChatMessage.created[0].flavor, /Next damage/);
});

test("the GM voids a scan or a ready mark; players can't; a void scan doesn't finish and a void mark can't be used", async () => {
  const scanning = await scan();
  from(alice, "fortify-void", { id: scanning.id });
  await settle();
  assert.equal(scanning.status, "scanning", "players can't void");
  from(gm, "fortify-void", { id: scanning.id });
  await settle();
  assert.equal(scanning.status, "void");
  assert.match(lastAlert("pcA").text, /voided/);
  await passTime(SCAN_SECONDS);
  assert.equal(scanning.status, "void");

  const ready = await scan();
  await passTime(SCAN_SECONDS);
  from(gm, "fortify-void", { id: ready.id });
  from(alice, "fortify-use", { id: ready.id });
  await settle();
  assert.equal(ready.status, "void");
  assert.equal(ChatMessage.created.length, 0);
});

test("every player gets the marks, for the scan wave", async () => {
  const mark = await scan();
  assert.ok(appsFor(alice, store.apps).fortifyMarks[mark.id]);
  assert.ok(appsFor(bob, store.apps).fortifyMarks[mark.id]);
  assert.ok(appsFor(gm, store.apps).fortifyMarks[mark.id]);
});

test("a mark saved without `everyone` reaches its player again once the host loads", async () => {
  const mark = await scan();
  delete mark.everyone;
  assert.deepEqual(appsFor(alice, store.apps).fortifyMarks, {});
  store._fortifyLoad();
  assert.ok(appsFor(alice, store.apps).fortifyMarks[mark.id]);
});

test("old marks are pruned, live ones never", async () => {
  for (let i = 0; i < 25; i++) {
    const mark = await scan();
    mark.status = "used";
    game.time.worldTime += 1;
  }
  const ready = await scan();
  await passTime(SCAN_SECONDS);
  assert.ok(marks().length <= 22);
  assert.ok(store.apps.fortifyMarks[ready.id]);
});

test("the page's helpers: progress, time left, the weak point, the grade", () => {
  const mark = { id: "abc", dueAt: 1300 };
  assert.equal(scanPercent(mark, 1000), 0);
  assert.equal(scanPercent(mark, 1150), 50);
  assert.equal(scanPercent(mark, 2000), 100);
  assert.equal(etaLabel(272), "4:32 left");
  assert.equal(etaLabel(61), "1:01 left");
  assert.equal(etaLabel(9), "0:09 left");
  assert.equal(etaLabel(0), "finishing");
  assert.ok(WEAK_POINTS.includes(weakPoint(mark)));
  assert.equal(weakPoint(mark), weakPoint(mark));
  assert.equal(HOME_GRADE, "F");
});

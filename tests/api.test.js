import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { store } from "../scripts/store.js";
import { api } from "../scripts/api.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";

setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));

/*
 * The macro API (scripts/api.js, API.md), run by the GM on the host: it goes through the same
 * requests the GM Phone sends, so these check the API's arguments and what reaches the host.
 */

let gm, alice;

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500, flags: { contacts: [{ name: "Rogue" }] } });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 1000 });
  addActor({ id: "npcR", name: "Rogue Amendiares", type: "mook", items: [] });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null
  });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const threadWith = (actorId, contact) => store.findThread(actorId, contact);

test("characters by Actor, token, id or name; unknown ones are a clear error", async () => {
  const v = game.actors.get("pcA");
  await api.text({ to: v, from: "Rogue", text: "1" });
  await api.text({ to: { actor: v }, from: "Rogue", text: "2" });
  await api.text({ to: "pcA", from: "Rogue", text: "3" });
  await api.text({ to: "V", from: "Rogue", text: "4" });
  assert.deepEqual(threadWith("pcA", "Rogue").messages.map(m => [m.from, m.text]), [["contact", "1"], ["contact", "2"], ["contact", "3"], ["contact", "4"]]);
  await assert.rejects(api.text({ to: "Nobody", from: "Rogue", text: "hi" }), /Can't find the character "Nobody"/);
  await assert.rejects(api.text({ to: "V", text: "hi" }), /Say who it's from/);
  assert.deepEqual(api.characters(), [{ id: "pcA", name: "V" }, { id: "pcB", name: "Judy" }]);
});

test("players can't use the GM's calls", async () => {
  actAs(alice, gm);
  await assert.rejects(api.text({ to: "V", from: "Rogue", text: "hi" }), /for GMs/);
  await assert.rejects(api.setSignal("V", false), /for GMs/);
  assert.equal(api.hasSignal("V"), true, "reading is for everyone");
});

test("texts from a new name, hidden caller ID, and an NPC's sheet as a contact", async () => {
  await api.text({ to: "V", from: "Mr. Blue", text: "Job for you", hidden: true });
  await api.addContact({ to: ["V", "Judy"], actor: "Rogue Amendiares" });
  await api.text({ to: "Judy", from: game.actors.get("npcR"), text: "Afterlife, 10pm" });
  assert.ok(store.findThread("pcA", "Mr. Blue", true), "hidden");
  const judys = game.actors.get("pcB").getFlag("cpr-sam-agent", "contacts");
  assert.deepEqual(judys.map(c => [c.name, c.actorId]), [["Rogue Amendiares", "npcR"]]);
  assert.equal(threadWith("pcB", "Rogue Amendiares").messages[0].text, "Afterlife, 10pm");
});

test("calls ring the character and can be ended", async () => {
  await api.call({ to: "V", from: "Rogue" });
  assert.equal(store.calls.size, 1);
  assert.equal(await api.endCalls({ to: "Judy" }), 0, "Judy isn't on it");
  assert.equal(await api.endCalls({ to: "V" }), 1);
  assert.equal(store.calls.size, 0);
});

test("Agent alerts carry a tag that comes back with the answer", async () => {
  await api.alert({ to: ["V", "Judy"], text: "Take the stairs?", choices: ["Yes", "No"], tag: "stairs" });
  const alert = Object.values(store.apps.alerts).find(a => a.actorId === "pcA");
  assert.deepEqual(alert.choices, ["Yes", "No"]);
  store._onSocket({ type: "alert-answer", alertId: alert.id, choice: "No" }, alice.id);
  await settle();
  const answered = hooks.find(h => h.hook === "cpr-sam-agent.alertAnswered");
  assert.deepEqual(answered.args[0], { alertId: alert.id, actorId: "pcA", choice: "No", text: "Take the stairs?", tag: "stairs", userId: "alice" });
  await assert.rejects(api.alert({ to: "V", text: "x", kind: "nope" }), /Unknown alert kind/);
});

test("signal and Control's switches", async () => {
  await api.setSignal(["V"], false);
  assert.equal(api.hasSignal("V"), false);
  assert.equal(api.hasSignal("Judy"), true);
  await api.setSignal("V", true);
  assert.equal(api.hasSignal("V"), true);

  assert.equal(api.feature("app_garden"), true);
  await api.setFeature("app_garden", false);
  assert.equal(api.feature("app_garden"), false);
  assert.throws(() => api.feature("teleport"), /Unknown switch/);
});

test("money: bills from a contact or service, and wallet adjustments", async () => {
  await game.settings.set("cpr-sam-agent", "services", [{ id: "tt", name: "Trauma Team", actions: [], chat: false, access: "all" }]);
  await api.money.request({ to: "V", from: "Rogue", amount: 200, note: "Your cut, reversed" });
  await api.money.request({ to: "V", service: "trauma team", amount: 50, note: "Callout fee" });
  assert.equal(threadWith("pcA", "Rogue").messages.at(-1).money.kind, "request");
  assert.equal(store.findServiceThread("pcA", "tt").messages.at(-1).money.amount, 50);
  await api.money.adjust({ actor: "V", amount: -100, memo: "Bribe" });
  assert.equal(game.actors.get("pcA").system.wealth.value, 400);
  await assert.rejects(api.money.send({ to: "V", from: "Rogue", amount: 0 }), /positive/);
  await assert.rejects(api.money.request({ to: "V", service: "NCPD", amount: 5 }), /No service "NCPD"/);
});

test("money: invoices under any name, tagged, and the hook says how they ended", async () => {
  assert.equal(api.money.canInvoice("V"), true);
  await api.money.invoice({ to: "V", from: "CPR HQ", amount: 300, memo: "Rent", tag: "hq:1" });
  await api.money.invoice({ to: "V", from: "CPR HQ", amount: 40, memo: "Other" });
  const [mine] = api.money.invoices({ tag: "hq:1" });
  assert.deepEqual([mine.actorId, mine.from, mine.amount, mine.status], ["pcA", "CPR HQ", 300, "pending"]);
  assert.equal(api.money.invoices().length, 2);
  store._onSocket({ type: "invoice-respond", invoiceId: mine.id, action: "decline" }, "alice");
  await settle();
  const settled = hooks.filter(h => h.hook === "cpr-sam-agent.invoiceSettled").map(h => h.args[0]);
  assert.deepEqual(settled.map(s => [s.invoiceId, s.status, s.actorId, s.amount, s.tag]), [[mine.id, "declined", "pcA", 300, "hq:1"]]);
  assert.equal(api.money.invoices({ tag: "hq:1" })[0].status, "declined");
  await assert.rejects(api.money.invoice({ to: "V", from: "CPR HQ", amount: 0 }), /positive/);
});

test("jobs: saved with an id the macro gets back, offered in a text, then started", async () => {
  const id = await api.jobs.save({ name: "Heist", description: "Rob Arasaka\nBring a friend." });
  assert.equal(store.quests.get(id).name, "Heist");
  assert.equal(store.quests.get(id).hidden, true);
  await api.jobs.offer({ job: "Heist", to: "V", from: "Rogue", text: "Interested?" });
  assert.equal(threadWith("pcA", "Rogue").messages.at(-1).job.questId, id);
  await api.jobs.setStatus(id, "active", { reveal: true });
  assert.deepEqual([store.quests.get(id).status, store.quests.get(id).hidden], ["active", false]);
  await assert.rejects(api.jobs.setStatus(id, "done"), /Unknown status/);
});

test("the Garden: posting as a handle, queueing lines, pausing", async () => {
  await api.garden.post({ as: "@network54", text: "Explosion in Watson", rep: [{ actor: "V", delta: 1, reason: "Watson" }] });
  const post = Object.values(store.garden.posts).find(p => p.text === "Explosion in Watson");
  assert.equal(store.garden.accounts[post.accountId].handle, "@network54");
  assert.deepEqual(post.rep.map(r => [r.actorId, r.delta]), [["pcA", 1]]);
  await api.garden.queue(["first", "@network54 | second"], { every: 2 });
  assert.equal(store.garden.queue.length, 2);
  await api.garden.pause();
  assert.ok(store.garden.paused);
  await api.garden.resume();
  assert.equal(store.garden.paused, null);
  assert.ok(api.garden.accounts().some(a => a.handle === "@network54"));
  await assert.rejects(api.garden.post({ as: "@nobody", text: "x" }), /No Garden account/);
});

test("Trauma Team: plans by name, GM-started calls, and WatchBox needs arming first", async () => {
  await api.trauma.grant({ actor: "V", plan: "executive", sponsor: "Arasaka" });
  assert.equal(api.trauma.covered("V"), true);
  await api.trauma.dispatch("V", { reason: "Flatlined on the roof" });
  const [dispatch] = Object.values(store.apps.dispatches);
  assert.equal(dispatch.actorId, "pcA");
  await api.trauma.revoke("V");
  assert.equal(api.trauma.covered("V"), false);
  await assert.rejects(api.trauma.grant({ actor: "V", plan: "Platinum" }), /No Trauma Team plan "Platinum"/);

  assert.equal(api.watchbox.status("V"), "off");
  await assert.rejects(api.watchbox.trigger("V"), /isn't armed/);
});

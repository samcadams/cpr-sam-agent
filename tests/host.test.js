import { addActor, addScene, addUser, actAs, reset, sent, saved } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import * as core from "../scripts/host/core.js";
import * as messages from "../scripts/host/messages.js";
import * as groups from "../scripts/host/groups.js";
import * as services from "../scripts/host/services.js";
import * as reactions from "../scripts/host/reactions.js";
import * as quests from "../scripts/host/quests.js";
import * as money from "../scripts/host/money.js";
import * as contactRequests from "../scripts/host/contactRequests.js";
import * as maintenance from "../scripts/host/maintenance.js";
import * as calls from "../scripts/host/calls.js";
import * as sounds from "../scripts/host/sounds.js";

/*
 * The store running as the host (the GM's client). Players' requests arrive through _onSocket with
 * the sender id Foundry would attach, exactly as over the wire.
 */

let gm, alice, bob;

beforeEach(async () => {
  await store._writing; // the last test's saves land first
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500, flags: { contacts: [{ name: "Rogue", img: "rogue.png" }, { name: "Judy", actorId: "pcB" }] } });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 1000 });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

/** A player's request, as it arrives over the socket. */
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
/** Wait for the host to finish everything queued so far. */
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing; // and its saves
};
/** Payloads that reached a user. */
const receivedBy = user => sent.filter(s => s.recipients?.includes(user.id)).map(s => s.payload);
const onlyThread = () => {
  assert.equal(store.threads.size, 1);
  return [...store.threads.values()][0];
};

test("every request type is handled by an existing method", () => {
  const features = [core, messages, groups, services, reactions, quests, money, contactRequests, maintenance, calls, sounds];
  const methods = Object.assign({}, ...features.map(f => f.methods));
  const types = features.flatMap(f => Object.entries(f.requests ?? {}));
  assert.equal(types.length, 36);
  for (const [type, handler] of types) {
    const name = typeof handler === "string" ? handler : handler.name;
    assert.equal(typeof methods[name], "function", `${type} → ${name}`);
    assert.equal(typeof store[name], "function", `${name} installed on the store`);
  }
});

test("a player's text is stored, saved and sent only to who can see it", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "Need a ride" });
  await settle();

  const thread = onlyThread();
  assert.equal(thread.contact, "Rogue");
  assert.deepEqual(thread.messages.map(m => [m.from, m.text, m.userId]), [["pc", "Need a ride", "alice"]]);
  assert.ok(saved.data.threads[thread.id], "written to the world file");
  assert.equal(receivedBy(alice).filter(p => p.type === "thread").length, 1);
  assert.equal(receivedBy(bob).length, 0, "bob gets nothing");
  assert.ok(sent.every(s => s.recipients), "nothing is broadcast");
});

test("players can't text numbers they don't have, or blocked ones", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Takemura", text: "hi" });
  from(bob, "send", { actorId: "pcA", contact: "Rogue", text: "not my phone" });
  await settle();
  assert.equal(store.threads.size, 0);

  await game.actors.get("pcA").setFlag("cpr-sam-agent", "contacts", [{ name: "Rogue", blocked: true }]);
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "hi" });
  await settle();
  assert.equal(store.threads.size, 0);
});

test("the sender is who Foundry says, never a field in the message", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "hi" });
  await settle();
  from(alice, "scrub", { userId: "gm" });
  from(alice, "quest-save", { userId: "gm", quest: { name: "Heist", hidden: false } });
  await settle();
  assert.equal(store.threads.size, 1, "scrub ignored");
  assert.equal(store.quests.size, 0, "quest-save ignored");

  // The GM (the host itself) can.
  store.request("quest-save", { quest: { name: "Heist" } });
  await settle();
  assert.equal(store.quests.size, 1);
});

test("players can't push state to other clients", () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "hi" });
  return settle().then(() => {
    store._onSocket({ type: "sync", threads: [], calls: [], requests: [], quests: [] }, "alice");
    store._onSocket({ type: "remove", threadId: onlyThread().id }, "alice");
    assert.equal(store.threads.size, 1);
    store._onSocket({ type: "no-such-request" }, "alice");
    store._onSocket(null, "alice");
    store._onSocket({ type: "send" }, "nobody");
  });
});

test("a hidden caller's name never reaches the player", async () => {
  store.request("send", { actorId: "pcA", contact: "Rogue", hidden: true, text: "We need to talk" });
  await settle();

  const thread = onlyThread();
  assert.equal(thread.hideId, true);
  const toAlice = receivedBy(alice);
  assert.equal(toAlice.length, 1);
  assert.equal(toAlice[0].thread.contact, "Unknown Number");
  assert.ok(!JSON.stringify(toAlice).includes("Rogue"), "no trace of the name");

  // Revealing merges it into the named conversation, which she then sees.
  sent.length = 0;
  store.request("reveal", { threadId: thread.id });
  await settle();
  const named = onlyThread();
  assert.equal(named.hideId, false);
  assert.equal(named.contact, "Rogue");
});

test("a money request paid twice at once is only charged once", async () => {
  const pcA = game.actors.get("pcA");
  const pcB = game.actors.get("pcB");
  from(alice, "money-send", { actorId: "pcA", contact: "Judy", kind: "request", amount: 300, note: "Rent" });
  await settle();

  // PC-to-PC: Judy's phone has a mirrored copy.
  const judys = [...store.threads.values()].find(t => t.actorId === "pcB");
  const request = judys.messages.find(m => m.money);
  assert.equal(request.money.status, "pending");

  from(bob, "money-respond", { threadId: judys.id, messageId: request.id, action: "pay" });
  from(bob, "money-respond", { threadId: judys.id, messageId: request.id, action: "pay" });
  await settle();
  assert.equal(pcB.system.wealth.value, 700, "charged once");
  assert.equal(request.money.status, "paid");

  // Held until V transfers it in; her copy shows the same status.
  const vs = [...store.threads.values()].find(t => t.actorId === "pcA");
  const twin = vs.messages.find(m => m.money);
  assert.equal(twin.money.status, "paid");
  assert.equal(pcA.system.wealth.value, 500);
  from(alice, "money-respond", { threadId: vs.id, messageId: twin.id, action: "transfer" });
  from(alice, "money-respond", { threadId: vs.id, messageId: twin.id, action: "transfer" });
  await settle();
  assert.equal(pcA.system.wealth.value, 800, "deposited once");
  assert.equal(twin.money.status, "transferred");
});

test("sending more than you have is refused", async () => {
  from(alice, "money-send", { actorId: "pcA", contact: "Judy", kind: "send", amount: 501 });
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 500);
  assert.equal(store.threads.size, 0, "no empty conversation left behind");
});

test("a call rings, connects and is logged", async () => {
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  const [call] = store.calls.values();
  assert.deepEqual(call.participants.map(p => [p.key, p.state]), [["a:pca", "joined"].map((x, i) => (i ? x : "a:pcA")), ["n:rogue", "ringing"]]);
  assert.equal(store.myCall(gm).kind, "incoming");

  store.request("call-answer", { callId: call.id, key: "n:rogue" });
  await settle();
  assert.equal(store.myCall(gm).kind, "active");

  from(alice, "call-hangup", { callId: call.id, key: "a:pcA" });
  await settle();
  assert.equal(store.calls.size, 0);
  assert.match(onlyThread().messages.at(-1).text, /^Call · \d+:\d\d$/);
  assert.ok(receivedBy(alice).some(p => p.type === "call-end"));
});

test("group chats reach every member and nobody else", async () => {
  addUser({ id: "carol" });
  from(alice, "group-create", { actorId: "pcA", contacts: ["Judy", "Rogue"], name: "Crew" });
  await settle();
  const group = onlyThread();
  assert.deepEqual(group.members.map(m => m.key), ["a:pcA", "a:pcB", "n:rogue"]);

  from(bob, "group-send", { groupId: group.id, as: "a:pcB", text: "On my way" });
  from(bob, "group-send", { groupId: group.id, as: "a:pcA", text: "impersonating V" });
  await settle();
  assert.deepEqual(group.messages.filter(m => !m.system).map(m => m.text), ["On my way"]);
  assert.ok(receivedBy(alice).some(p => p.type === "thread"));
  assert.equal(receivedBy(game.users.get("carol")).length, 0);

  // Removing bob tells his client to drop it.
  from(alice, "group-remove", { groupId: group.id, actorId: "pcA", key: "a:pcB" });
  await settle();
  assert.ok(receivedBy(bob).some(p => p.type === "remove" && p.threadId === group.id));
});

test("hidden jobs and objectives stay hidden from players", async () => {
  store.request("quest-save", { quest: { name: "Heist", hidden: true } });
  await settle();
  const [quest] = store.quests.values();
  assert.deepEqual(receivedBy(alice).at(-1).quests, []);

  store.request("quest-save", { quest: { id: quest.id, hidden: false } });
  store.request("objective-save", { questId: quest.id, objective: { text: "Get in" } });
  store.request("objective-save", { questId: quest.id, objective: { text: "Secret", hidden: true } });
  await settle();
  const last = receivedBy(alice).at(-1).quests[0];
  assert.deepEqual(last.objectives.map(o => o.text), ["Get in"]);
  assert.ok(receivedBy(alice).some(p => p.notice?.title === "New job"));
});

test("contact requests: player asks, GM approves", async () => {
  from(alice, "contact-request", { actorId: "pcA", name: "Takemura", note: "Met at the parade" });
  await settle();
  const [request] = store.requests.values();
  assert.equal(request.name, "Takemura");
  assert.ok(receivedBy(alice).some(p => p.type === "requests"));

  store.request("request-resolve", { requestId: request.id, approve: true, name: "Goro Takemura" });
  await settle();
  assert.equal(store.requests.size, 0);
  const contacts = game.actors.get("pcA").getFlag("cpr-sam-agent", "contacts");
  assert.ok(contacts.some(c => c.name === "Goro Takemura"));
  assert.ok(receivedBy(alice).some(p => p.notice?.kind === "approved"));
});

test("reactions follow a PC-to-PC message to its mirror", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Judy", text: "Dinner?" });
  await settle();
  const judys = [...store.threads.values()].find(t => t.actorId === "pcB");
  from(bob, "react", { threadId: judys.id, messageId: judys.messages[0].id, emoji: "👍" });
  await settle();
  const vs = [...store.threads.values()].find(t => t.actorId === "pcA");
  assert.deepEqual(judys.messages[0].reactions, { pc: "👍" });
  assert.deepEqual(vs.messages[0].reactions, { contact: "👍" });
});

test("scrub wipes conversations", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "hi" });
  await settle();
  store.request("scrub");
  await settle();
  assert.equal(store.threads.size, 0);
  assert.deepEqual(saved.data.threads, {});
});

test("Clear app data: Messages and Contacts, for one character or everyone", async () => {
  await game.actors.get("pcB").setFlag("cpr-sam-agent", "contacts", [{ name: "Rogue", img: "rogue.png" }]);
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "hi" });
  from(bob, "send", { actorId: "pcB", contact: "Rogue", text: "yo" });
  await settle();
  const pcA = game.actors.get("pcA");
  await pcA.setFlag("cpr-sam-agent", "notes", [{ key: "rogue", text: "fixer" }]);
  await pcA.setFlag("cpr-sam-agent", "aliases", [{ key: "rogue", name: "R" }]);
  assert.ok(pcA.getFlag("cpr-sam-agent", "contacts").length);

  store.request("app-clear", { target: "messages", actorId: "pcA" });
  await settle();
  assert.deepEqual([...store.threads.values()].map(t => t.actorId), ["pcB"], "only V's conversations go");
  assert.ok(pcA.getFlag("cpr-sam-agent", "contacts").length, "Messages leaves contacts");

  store.request("app-clear", { target: "contacts", actorId: "pcA" });
  await settle();
  for (const f of ["contacts", "notes", "aliases"]) assert.deepEqual(pcA.getFlag("cpr-sam-agent", f), [], f);
  assert.ok(game.actors.get("pcB").getFlag("cpr-sam-agent", "contacts").length, "Judy's stay");

  store.request("app-clear", { target: "messages" });
  store.request("app-clear", { target: "contacts" });
  await settle();
  assert.equal(store.threads.size, 0);
  assert.deepEqual(game.actors.get("pcB").getFlag("cpr-sam-agent", "contacts"), []);
});

test("services: players can't start payments, the GM can always bill", async () => {
  await game.settings.set("cpr-sam-agent", "services", [
    { id: "tt", name: "Trauma Team", img: "tt.png", actions: [], callLabel: "", chat: true, access: "all", money: true }
  ]);
  from(alice, "money-send", { actorId: "pcA", serviceId: "tt", kind: "send", amount: 100 });
  from(alice, "money-send", { actorId: "pcA", serviceId: "tt", kind: "request", amount: 100 });
  await settle();
  assert.equal(store.threads.size, 0);
  assert.equal(game.actors.get("pcA").system.wealth.value, 500);

  // Even with the old money flag off, the GM bills and the player pays.
  await game.settings.set("cpr-sam-agent", "services", [
    { id: "tt", name: "Trauma Team", img: "tt.png", actions: [], callLabel: "", chat: true, access: "all" }
  ]);
  store.request("money-send", { actorId: "pcA", serviceId: "tt", kind: "request", amount: 200, note: "Extraction" });
  await settle();
  const thread = onlyThread();
  const bill = thread.messages.find(m => m.money);
  assert.equal(bill.text, "Extraction");
  from(alice, "money-respond", { threadId: thread.id, messageId: bill.id, action: "pay" });
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 300);
  assert.equal(bill.money.status, "transferred", "a service has no wallet, so it completes at once");
});

test("texts-only contacts can't be called by the player, but the GM can call as them", async () => {
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "contacts", [{ name: "Rogue", noCall: true }]);
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  assert.equal(store.calls.size, 0);
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "can I still text?" });
  await settle();
  assert.equal(onlyThread().messages.length, 1);

  store.request("call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  assert.equal(store.calls.size, 1);
  const [call] = store.calls.values();
  store.request("call-hangup", { callId: call.id, key: "n:rogue" });
  await settle();
});

/* ---------------- 1.2.0: GM Control ---------------- */

const setFeatures = values => game.settings.set("cpr-sam-agent", "features", values);
const pin = () => {
  game.scenes.set("s1", { id: "s1", name: "Night City", notes: new Map([["n1", { id: "n1", x: 10, y: 20, text: "Afterlife" }]]) });
  return { sceneId: "s1", noteId: "n1" };
};

test("switching off map pins and photos stops them at the host", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "here", location: pin(), image: "x.png" });
  await settle();
  const first = onlyThread().messages.at(-1);
  assert.equal(first.location.label, "Afterlife");
  assert.equal(first.image, null, "players can't send photos by default");

  await setFeatures({ locations: false });
  store.request("send", { threadId: onlyThread().id, text: "look", location: pin(), image: "y.png" });
  await settle();
  const second = onlyThread().messages.at(-1);
  assert.equal(second.location, null);
  assert.equal(second.image, "y.png", "the GM still can");

  await setFeatures({ images: false });
  store.request("send", { threadId: onlyThread().id, text: "again", image: "z.png" });
  await settle();
  assert.equal(onlyThread().messages.at(-1).image, null);

  await setFeatures({ playerImages: true });
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "pic", image: "me.png" });
  await settle();
  assert.equal(onlyThread().messages.at(-1).image, "me.png");
});

test("jobs switched off, or just the Available tab, is what players get", async () => {
  store.request("quest-save", { quest: { name: "Offer", status: "available", hidden: false } });
  store.request("quest-save", { quest: { name: "Heist", status: "active", hidden: false } });
  await settle();
  const names = () => receivedBy(alice).filter(p => p.type === "quests").at(-1).quests.map(q => q.name).sort();
  assert.deepEqual(names(), ["Heist", "Offer"]);
  assert.ok(receivedBy(alice).some(p => p.notice?.title === "New job"));

  await setFeatures({ jobsAvailable: false });
  store.syncAll();
  assert.deepEqual(receivedBy(alice).filter(p => p.type === "sync").at(-1).quests.map(q => q.name), ["Heist"]);

  await setFeatures({ jobs: false });
  sent.length = 0;
  store.request("quest-save", { quest: { name: "Another", status: "active", hidden: false } });
  await settle();
  const pushed = receivedBy(alice).filter(p => p.type === "quests").at(-1);
  assert.deepEqual(pushed.quests, []);
  assert.equal(pushed.notice, null, "no notice about a job they can't see");
  assert.equal(store.visibleQuests(gm).length, 3, "the GM keeps them all");
});

test("no signal: outgoing refused, calls miss, incoming held until it's back", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "before" });
  await settle();
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: Date.now() });
  store._signalChanged();

  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "can't send" });
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  assert.deepEqual(onlyThread().messages.map(m => m.text), ["before"]);
  assert.equal(store.calls.size, 0);

  // Ringing them fails at once, logged as missed.
  await new Promise(resolve => setTimeout(resolve, 2)); // (after the moment signal was lost)
  store.request("call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  assert.equal(store.calls.size, 0);
  assert.equal(onlyThread().messages.at(-1).text, "Missed call");

  // A text to them is stored but not delivered.
  await new Promise(resolve => setTimeout(resolve, 2));
  sent.length = 0;
  store.request("send", { threadId: onlyThread().id, text: "where are you?" });
  await settle();
  const delivered = receivedBy(alice).filter(p => p.type === "thread").at(-1).thread;
  assert.ok(!delivered.messages.some(m => m.text === "where are you?"));
  assert.equal(receivedBy(alice).filter(p => p.type === "thread").at(-1).notify, false);

  // Signal back: everything arrives, with a notice.
  sent.length = 0;
  await game.settings.set("cpr-sam-agent", "noSignal", {});
  store._signalChanged();
  const synced = receivedBy(alice).find(p => p.type === "sync").threads[0];
  assert.ok(synced.messages.some(m => m.text === "where are you?"));
  // Their Agent tells them (an Agent alert, signed with its name on their phone).
  const pushed = receivedBy(alice).find(p => p.type === "apps" && p.alerts.length);
  const alert = pushed.apps.alerts[pushed.alerts[0]];
  assert.equal(alert.text, "Signal restored. 2 new while you had no signal.", "the missed call and the text");
  assert.equal(alert.kind, "system");
});

test("no signal: no text tone at their token, and no reaction alert", async () => {
  addScene({ tokens: [{ id: "tA", actorId: "pcA", name: "V", x: 0, y: 0 }] });
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "before" });
  await settle();
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: Date.now() });
  store._signalChanged();
  await new Promise(resolve => setTimeout(resolve, 2));

  sent.length = 0;
  store.request("send", { threadId: onlyThread().id, text: "where are you?" });
  await settle();
  assert.ok(!sent.some(s => s.payload.type === "world-sound"), "no tone at V's token");

  sent.length = 0;
  store.request("react", { threadId: onlyThread().id, messageId: onlyThread().messages[0].id, emoji: "👍" });
  await settle();
  const pushed = receivedBy(alice).filter(p => p.type === "thread").at(-1);
  assert.equal(pushed.reaction, null, "the reaction waits for the signal");

  await game.settings.set("cpr-sam-agent", "noSignal", {});
  store._signalChanged();
  sent.length = 0;
  store.request("send", { threadId: onlyThread().id, text: "back?" });
  await settle();
  assert.ok(sent.some(s => s.payload.type === "world-sound"), "the tone is back with the signal");
});

test("wiping a character's phone", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Judy", text: "hey" });
  from(alice, "group-create", { actorId: "pcA", contacts: ["Judy", "Rogue"], name: "Crew" });
  from(alice, "contact-request", { actorId: "pcA", name: "Takemura" });
  await settle();
  assert.equal(store.threads.size, 3); // V's copy, Judy's copy, the group

  store.request("clear-actor", { actorId: "pcA", contacts: true });
  await settle();
  const left = [...store.threads.values()];
  assert.deepEqual(left.map(t => t.type).sort(), ["direct", "group"]);
  assert.equal(left.find(t => t.type === "direct").actorId, "pcB", "Judy keeps her copy");
  const group = left.find(t => t.type === "group");
  assert.ok(!group.members.some(m => m.key === "a:pcA"));
  assert.equal(group.messages.at(-1).text, "V left the group");
  assert.equal(store.requests.size, 0);
  assert.deepEqual(game.actors.get("pcA").getFlag("cpr-sam-agent", "contacts"), []);

  // Players can't do it.
  from(bob, "clear-actor", { actorId: "pcB" });
  await settle();
  assert.equal(store.threads.size, 2);
});

/* ---------------- 1.3.0: job offers ---------------- */

async function hiddenJob() {
  store.request("quest-save", { quest: { name: "Arasaka Heist", description: "Steal the chip.\nDetails later.", hidden: true } });
  await settle();
  return [...store.quests.values()][0];
}

test("a job offered in a text can be read while hidden, and accepting starts it", async () => {
  const quest = await hiddenJob();
  store.request("send", { actorId: "pcA", contact: "Rogue", text: "Got work", job: quest.id });
  await settle();
  const offer = onlyThread().messages.at(-1);
  assert.deepEqual(offer.job, { questId: quest.id, name: "Arasaka Heist", summary: "Steal the chip.", img: null, status: "offered" });
  assert.deepEqual(store.visibleQuests(alice), [], "still hidden from players");

  from(bob, "job-respond", { threadId: onlyThread().id, messageId: offer.id, accept: true });
  await settle();
  assert.equal(offer.job.status, "offered", "not bob's offer to answer");

  sent.length = 0;
  from(alice, "job-respond", { threadId: onlyThread().id, messageId: offer.id, accept: true });
  from(alice, "job-respond", { threadId: onlyThread().id, messageId: offer.id, accept: false });
  await settle();
  assert.equal(offer.job.status, "accepted");
  assert.equal(offer.job.by, "V");
  assert.equal(quest.hidden, false);
  assert.equal(quest.status, "active");
  assert.equal(onlyThread().messages.at(-1).text, 'V accepted the job "Arasaka Heist"');
  assert.equal(onlyThread().messages.filter(m => m.system).length, 1, "the second answer was ignored");
  const pushed = receivedBy(alice).filter(p => p.type === "quests").at(-1);
  assert.deepEqual(pushed.quests.map(q => q.name), ["Arasaka Heist"]);
  assert.equal(pushed.notice.title, "Job started");
});

test("declining leaves the job alone; players can't offer jobs; none while jobs are off", async () => {
  const quest = await hiddenJob();
  store.request("send", { actorId: "pcA", contact: "Rogue", job: quest.id });
  await settle();
  const offer = onlyThread().messages.at(-1);
  from(alice, "job-respond", { threadId: onlyThread().id, messageId: offer.id, accept: false });
  await settle();
  assert.equal(offer.job.status, "declined");
  assert.equal(quest.hidden, true);

  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "for you", job: quest.id });
  await settle();
  assert.equal(onlyThread().messages.at(-1).job, null);

  await setFeatures({ jobs: false });
  store.request("send", { threadId: onlyThread().id, job: quest.id });
  await settle();
  assert.equal(onlyThread().messages.at(-1).text, "for you", "a job-only message with jobs off isn't sent");
});

test("a job offered in a group is answered by a member", async () => {
  from(alice, "group-create", { actorId: "pcA", contacts: ["Judy", "Rogue"], name: "Crew" });
  const quest = await hiddenJob();
  const group = onlyThread();
  store.request("group-send", { groupId: group.id, as: "n:rogue", text: "Job for the crew", job: quest.id });
  await settle();
  const offer = group.messages.at(-1);
  from(bob, "job-respond", { threadId: group.id, messageId: offer.id, accept: true, as: "a:pcA" });
  await settle();
  assert.equal(offer.job.status, "offered", "bob can't answer as V");
  from(bob, "job-respond", { threadId: group.id, messageId: offer.id, accept: true, as: "a:pcB" });
  await settle();
  assert.equal(offer.job.by, "Judy");
  assert.equal(quest.status, "active");
});

/* ---------------- 1.4.0: the GM holds calls per NPC ---------------- */

/** A group of V, Judy, Rogue and Takemura, made by the GM. */
async function crew() {
  store.request("group-create", { pcs: ["pcA", "pcB"], npcs: ["Rogue", "Takemura"], name: "Crew" });
  await settle();
  return onlyThread();
}

test("a player's group call rings each NPC; the GM answers as each, and each leaves on its own", async () => {
  const group = await crew();
  from(alice, "call-start", { groupId: group.id, as: "a:pcA" });
  await settle();
  const [call] = store.calls.values();
  const [role] = store.myCalls(gm);
  assert.deepEqual(role.ringing.map(p => p.name), ["Rogue", "Takemura"]);

  store.request("call-answer", { callId: call.id, key: "n:rogue" });
  store.request("call-answer", { callId: call.id, key: "n:takemura" });
  await settle();
  assert.deepEqual(store.myCalls(gm)[0].joined.map(p => p.name), ["Rogue", "Takemura"]);

  store.request("call-hangup", { callId: call.id, key: "n:takemura" });
  await settle();
  const state = key => call.participants.find(p => p.key === key).state;
  assert.equal(state("n:takemura"), "left");
  assert.equal(state("n:rogue"), "joined", "Rogue is still on");
});

test("an NPC the GM adds to its call joins at once, without taking the call over", async () => {
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  const [call] = store.calls.values();
  store.request("call-answer", { callId: call.id, key: "n:rogue" });
  store.request("call-add", { callId: call.id, key: "n:rogue", npcs: ["Takemura"] });
  await settle();
  assert.equal(call.participants.find(p => p.key === "n:takemura").state, "joined");
  assert.equal(store.myCall(gm).kind, "active", "nothing rings for the GM");
});

test("a group call the GM starts rings only the players", async () => {
  const group = await crew();
  store.request("call-start", { groupId: group.id, as: "n:rogue" });
  await settle();
  const [call] = store.calls.values();
  assert.deepEqual(call.participants.map(p => [p.name, p.state]), [["Rogue", "joined"], ["V", "ringing"], ["Judy", "ringing"]]);
});

test("the GM can end a call for everyone; players can't", async () => {
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  const [call] = store.calls.values();
  from(alice, "call-close", { callId: call.id });
  await settle();
  assert.equal(store.calls.size, 1);

  store.request("call-close", { callId: call.id });
  await settle();
  assert.equal(store.calls.size, 0);
  assert.equal(onlyThread().messages.at(-1).text, "Missed call");
});

test("a player answering a second call hangs up the first", async () => {
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  const [first] = store.calls.values();
  store.request("call-answer", { callId: first.id, key: "n:rogue" });
  // Judy calls V while V is on with Rogue: it still rings.
  await game.actors.get("pcB").setFlag("cpr-sam-agent", "contacts", [{ name: "V", actorId: "pcA" }]);
  from(bob, "call-start", { actorId: "pcB", contact: "V" });
  await settle();
  const second = [...store.calls.values()].find(c => c !== first);
  assert.equal(second.participants.find(p => p.key === "a:pcA").state, "ringing");

  from(alice, "call-answer", { callId: second.id, key: "a:pcA" });
  await settle();
  assert.equal(second.participants.find(p => p.key === "a:pcA").state, "joined");
  assert.ok(!store.calls.has(first.id), "the call with Rogue ended");
});

test("objectives move up and down among their siblings, taking their branches along", async () => {
  store.request("quest-save", { quest: { name: "Heist" } });
  await settle();
  const [quest] = store.quests.values();
  for (const text of ["A", "B", "C"]) store.request("objective-save", { questId: quest.id, objective: { text } });
  await settle();
  const id = text => quest.objectives.find(o => o.text === text).id;
  store.request("objective-save", { questId: quest.id, objective: { text: "B1", parentId: id("B") } });
  await settle();
  const order = () => quest.objectives.filter(o => !o.parentId).map(o => o.text);

  store.request("objective-move", { questId: quest.id, objectiveId: id("C"), dir: -1 });
  await settle();
  assert.deepEqual(order(), ["A", "C", "B"]);
  store.request("objective-move", { questId: quest.id, objectiveId: id("A"), dir: -1 });
  await settle();
  assert.deepEqual(order(), ["A", "C", "B"], "the first can't go further up");
  assert.equal(quest.objectives.find(o => o.text === "B1").parentId, id("B"), "the branch stays under B");

  from(alice, "objective-move", { questId: quest.id, objectiveId: id("B"), dir: -1 });
  await settle();
  assert.deepEqual(order(), ["A", "C", "B"], "players can't");
});

test("an unowned 'character' sheet is an NPC: calling it rings the GM", async () => {
  addActor({ id: "npcChar", name: "Misty", type: "character" });
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "contacts", [{ name: "Misty", actorId: "npcChar" }]);
  from(alice, "call-start", { actorId: "pcA", contact: "Misty" });
  await settle();
  const [call] = store.calls.values();
  assert.equal(call.participants.find(p => p.name === "Misty").key, "n:misty");
  assert.deepEqual(store.myCalls(gm)[0].ringing.map(p => p.name), ["Misty"]);
});

test("photos: players send links or server paths, never other schemes", async () => {
  const { cleanImage } = await import("../scripts/host/validate.js");
  await game.settings.set("cpr-sam-agent", "features", { images: true, playerImages: true });
  assert.equal(cleanImage("https://i.imgur.com/x.png", alice), "https://i.imgur.com/x.png");
  assert.equal(cleanImage("worlds/test-world/agent-photos/1-x.png", alice), "worlds/test-world/agent-photos/1-x.png");
  assert.equal(cleanImage("javascript:alert(1)", alice), null);
  assert.equal(cleanImage("data:image/png;base64,AAAA", alice), null);
  await game.settings.set("cpr-sam-agent", "features", { images: true, playerImages: false });
  assert.equal(cleanImage("https://i.imgur.com/x.png", alice), null);
});

test("Communications off: texts, calls and money in conversations are refused; held money can still be transferred", async () => {
  from(alice, "money-send", { actorId: "pcA", contact: "Judy", kind: "send", amount: 100 });
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  await settle();
  assert.equal(store.calls.size, 1);
  const vs = [...store.threads.values()].find(t => t.actorId === "pcA" && t.contact === "Judy");
  const judys = [...store.threads.values()].find(t => t.actorId === "pcB");
  const held = judys.messages.find(m => m.money);

  await setFeatures({ comms: false });
  await store._enqueue(() => store._endCalls()); // as main.js does when the switch goes off
  await settle();
  assert.equal(store.calls.size, 0, "the call in progress ended");

  const count = vs.messages.length;
  from(alice, "send", { actorId: "pcA", contact: "Judy", text: "Hello?" });
  from(alice, "call-start", { actorId: "pcA", contact: "Rogue" });
  from(alice, "money-send", { actorId: "pcA", contact: "Judy", kind: "send", amount: 50 });
  from(alice, "contact-request", { actorId: "pcA", name: "Goro" });
  await settle();
  assert.equal(vs.messages.length, count, "nothing sent");
  assert.equal(store.calls.size, 0, "no call");
  assert.equal(store.requests.size, 0, "no contact request");
  assert.equal(game.actors.get("pcA").system.wealth.value, 400);

  // BangMe!'s Transfer still deposits money held from a conversation.
  from(bob, "money-respond", { threadId: judys.id, messageId: held.id, action: "transfer" });
  await settle();
  assert.equal(game.actors.get("pcB").system.wealth.value, 1100);
  await setFeatures({});
});

test("sharing texts: a public card built from the stored run, as the sharer's phone shows it", async () => {
  const chats = [];
  globalThis.ChatMessage = { create: async data => chats.push(data) };
  store.request("send", { actorId: "pcA", contact: "Rogue", hidden: true, text: "We need to talk" });
  await settle();
  from(alice, "send", { threadId: onlyThread().id, text: "Who's this?" });
  await settle();
  const thread = onlyThread();
  const [first, second] = thread.messages;

  // Someone who can't see the conversation gets nothing.
  from(bob, "share-texts", { threadId: thread.id, from: first.id, to: second.id });
  await settle();
  assert.equal(chats.length, 0);

  from(alice, "share-texts", { threadId: thread.id, from: first.id, to: second.id, theme: "arasaka" });
  await settle();
  assert.equal(chats.length, 1);
  const card = chats[0];
  assert.ok(!card.whisper?.length, "public");
  assert.equal(card.speaker.alias, "V");
  assert.ok(card.content.includes("theme-arasaka"));
  assert.ok(card.content.includes("Unknown Number") && !card.content.includes("Rogue"), "a hidden caller stays hidden");
  assert.ok(card.content.includes("ctp-ts-msg theirs") && card.content.includes("ctp-ts-msg mine"));

  // The GM sharing a hidden caller's texts doesn't name them either.
  from(gm, "share-texts", { threadId: thread.id, from: first.id, to: first.id, theme: "nope" });
  await settle();
  assert.equal(chats[1].speaker.alias, "Unknown Number");
  assert.ok(chats[1].content.includes("theme-nightcity"), "unknown palettes fall back");

  // Backwards, unknown ids, too many and switched off are refused.
  from(alice, "share-texts", { threadId: thread.id, from: second.id, to: first.id });
  from(alice, "share-texts", { threadId: thread.id, from: "nope", to: first.id });
  await settle();
  for (let i = 0; i < 9; i++) from(alice, "send", { threadId: thread.id, text: `spam ${i}` });
  await settle();
  from(alice, "share-texts", { threadId: thread.id, from: first.id, to: thread.messages.at(-1).id });
  await settle();
  assert.equal(chats.length, 2);
  await game.settings.set("cpr-sam-agent", "features", { shareTexts: false });
  from(alice, "share-texts", { threadId: thread.id, from: first.id, to: second.id });
  await settle();
  assert.equal(chats.length, 2);
});

import { addActor, addUser, actAs, hooks, reset, sent } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import fs from "node:fs";

setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));

/*
 * The host's side of the notification center: the GM's cards are kept, alerts can be cleared
 * from the center, and job news, contact requests and the Garden (replies, Reputation) reach the
 * phones as Agent alerts. The phone's side is in ui.test.js.
 */

let gm, alice, bob;

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], items: ["Agent"] });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], items: ["Agent"] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const receivedBy = user => sent.filter(s => s.recipients?.includes(user.id)).map(s => s.payload);
const alertsOf = actorId => Object.values(store.apps.alerts).filter(a => a.actorId === actorId).sort((a, b) => a.ts - b.ts);
const gmCardHooks = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);

test("GM cards are kept for the center (a repeated id replaces), never sent to players, and only a GM clears them", async () => {
  store._gmCard({ id: "cabb:1", title: "Combat Cabb", body: "Booked" });
  store._gmCard({ id: "cabb:1", title: "Combat Cabb", body: "Arrived" });
  store._gmCard({ title: "Garden", body: "posted" });
  const cards = Object.values(store.apps.gmCards);
  assert.equal(cards.length, 2);
  assert.equal(store.apps.gmCards["cabb:1"].body, "Arrived");
  assert.ok(cards.every(c => c.id && Number.isFinite(c.ts)), "each has an id and a time");
  assert.equal(gmCardHooks().length, 3, "each still pops up");

  store._pushApps();
  assert.deepEqual(receivedBy(alice).find(p => p.type === "apps").apps.gmCards, {}, "players never get them");

  from(alice, "gm-card-clear", { cardIds: ["cabb:1"] });
  await settle();
  assert.ok(store.apps.gmCards["cabb:1"], "a player can't clear them");
  from(gm, "gm-card-clear", { cardIds: ["cabb:1"] });
  await settle();
  assert.equal(store.apps.gmCards["cabb:1"], undefined);

  for (let i = 0; i < 70; i++) store._gmCard({ id: `n${i}`, title: "x" });
  assert.equal(Object.keys(store.apps.gmCards).length, 60, "older ones drop off");
});

test("an alert cleared from the center stays in the Agent's log; only its owner clears it", async () => {
  from(gm, "alert-send", { actorIds: ["pcA"], kind: "advice", text: "Duck." });
  await settle();
  const [alert] = alertsOf("pcA");
  from(bob, "alert-clear", { alertIds: [alert.id] });
  await settle();
  assert.ok(!alert.cleared);
  from(alice, "alert-clear", { alertIds: [alert.id] });
  await settle();
  assert.equal(alert.cleared, true);
  assert.ok(store.apps.alerts[alert.id], "still in the log");
});

test("job news reaches every player character's Agent, pointing at the job", async () => {
  from(gm, "quest-save", { quest: { name: "Totentanz", hidden: false } });
  await settle();
  for (const id of ["pcA", "pcB"]) {
    const [alert] = alertsOf(id);
    assert.equal(alert?.kind, "job", id);
    assert.equal(alert.from, "New job");
    assert.equal(alert.text, "Totentanz");
    assert.ok(store.quests.has(alert.ref.questId));
  }
  const pushed = receivedBy(alice).filter(p => p.type === "apps").at(-1);
  assert.equal(pushed.alerts.length, 1, "it pops up for alice: her character's only");

  from(gm, "quest-save", { quest: { name: "Secret", hidden: true } });
  await settle();
  assert.equal(alertsOf("pcA").length, 1, "nothing about hidden jobs");
});

test("contact requests: the GM gets a card, the player's Agent the answer", async () => {
  from(alice, "contact-request", { actorId: "pcA", name: "Rogue" });
  await settle();
  const card = Object.values(store.apps.gmCards).find(c => c.title === "Contact request");
  assert.match(card?.body ?? "", /V wants Rogue's number/);
  assert.equal(card.open.app, "contacts");

  const [request] = store.requests.values();
  from(gm, "request-resolve", { requestId: request.id, approve: false });
  await settle();
  const [alert] = alertsOf("pcA");
  assert.equal(alert.kind, "contact");
  assert.match(alert.text, /Couldn't get Rogue's number/);
});

test("The Garden: a reply on a character's post and a Reputation event reach them; chatter and their own replies don't", async () => {
  from(alice, "garden-join", { actorId: "pcA" });
  from(bob, "garden-join", { actorId: "pcB" });
  await settle();
  from(alice, "garden-post", { actorId: "pcA", text: "Night City at dawn" });
  await settle();
  const post = Object.values(store.garden.posts).find(p => p.text === "Night City at dawn");
  const before = alertsOf("pcA").length;

  from(alice, "garden-reply", { actorId: "pcA", postId: post.id, text: "thanks all" });
  await settle();
  assert.equal(alertsOf("pcA").length, before, "your own reply: nothing");

  from(bob, "garden-reply", { actorId: "pcB", postId: post.id, text: "gorgeous" });
  await settle();
  const reply = alertsOf("pcA").at(-1);
  assert.equal(reply.kind, "garden");
  assert.match(reply.text, /replied to your post: "gorgeous"/);
  assert.deepEqual(reply.ref, { type: "garden-post", postId: post.id });
  assert.ok(receivedBy(alice).some(p => p.type === "apps" && p.alerts.includes(reply.id)), "it pops up");

  // Chatter (the simulated replies) never alerts.
  const count = alertsOf("pcA").length;
  from(gm, "garden-generate", { count: 10 });
  await settle();
  post.eng = { ...post.eng, replies: 20, peak: 1 };
  post.ts = Date.now() - 60_000;
  await store._tickGarden();
  assert.ok(post.replies.some(r => r.auto), "citizens replied");
  assert.equal(alertsOf("pcA").length, count);

  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  from(gm, "garden-gm-post", { accountId: n54.id, text: "V cleared Totentanz", rep: { actorId: "pcA", delta: 1, reason: "Totentanz" } });
  await settle();
  assert.match(alertsOf("pcA").at(-1).text, /^Reputation \+1: Totentanz/);
});

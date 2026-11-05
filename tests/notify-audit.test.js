import { addActor, addUser, actAs, hooks, reset, sent } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import fs from "node:fs";

setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));

/*
 * The notification audit: alerts made by answer
 * handlers pop up, GM-made changes are told, GM cards are cleared when settled elsewhere, and the
 * new alerts asked for (losing #1, signal lost).
 */

let gm, alice, bob;

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], items: ["Agent"], wealth: 500 });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], items: ["Agent"], wealth: 500 });
  addActor({ id: "pcC", name: "Nobody", owners: [], items: [] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const alertsOf = actorId => Object.values(store.apps.alerts).filter(a => a.actorId === actorId).sort((a, b) => a.ts - b.ts);
/** Alert ids that popped up on this user's phone. */
const popped = user => sent.filter(s => s.recipients?.includes(user.id) && s.payload.type === "apps").flatMap(s => s.payload.alerts);

test("G7/G8/G42: alerts made while answering another alert pop up (Bang declined, Gacha trade gone)", async () => {
  const bang = store._alert("pcB", { kind: "money", text: "Bang?", choices: ["Accept", "Decline"], ref: { type: "bang", from: "pcA", to: "pcB", amount: 10 } });
  from(bob, "alert-answer", { alertId: bang, choice: "Decline" });
  await settle();
  const declined = alertsOf("pcA").find(a => /declined your Bang/.test(a.text));
  assert.ok(declined);
  assert.ok(popped(alice).includes(declined.id), "the payer's phone pops it");

  const trade = store._alert("pcB", { kind: "event", text: "Gift?", choices: ["Accept", "Decline"], ref: { type: "gacha-trade", from: "pcA", to: "pcB", pullId: "gone" } });
  from(bob, "alert-answer", { alertId: trade, choice: "Accept" });
  await settle();
  const gone = alertsOf("pcB").find(a => /doesn't have that collectible/.test(a.text));
  assert.ok(gone && popped(bob).includes(gone.id));
});

test("G9: money the GM puts on or takes off a sheet is told", async () => {
  from(gm, "ledger-adjust", { actorId: "pcA", amount: -50, memo: "Eurobank reversal" });
  await settle();
  const [alert] = alertsOf("pcA");
  assert.equal(alert.kind, "money");
  assert.match(alert.text, /^−.*50.*: Eurobank reversal$/);
  assert.ok(popped(alice).includes(alert.id));
});

test("Q1/G4: a contact request's card goes when the GM answers it in Contacts", async () => {
  from(alice, "contact-request", { actorId: "pcA", name: "Rogue" });
  await settle();
  const [request] = store.requests.values();
  assert.ok(store.apps.gmCards[`contact:${request.id}`]);
  from(gm, "request-resolve", { requestId: request.id, approve: false });
  await settle();
  assert.equal(store.apps.gmCards[`contact:${request.id}`], undefined);
  assert.ok(sent.some(s => s.payload.type === "gm-card" && s.payload.clear?.includes(`contact:${request.id}`)) || !game.users.some(u => u.isGM && u.active && u !== game.user), "other GMs hear");
});

test("a GM card cleared elsewhere tells this client to drop its pop-up, on the host and on other GMs", async () => {
  const gone = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCardGone").map(h => h.args[0]);
  store._gmCard({ id: "t207", title: "Card", actions: [{ label: "Go", request: "x" }] });
  store._gmCard({ id: "t207b", title: "Card" });
  store._gmCardDone(["t207", "never-was"]);
  assert.deepEqual(gone(), [["t207"]], "the host's own pop-up goes; nothing fires for an unknown card");
  store._gmCardDone("t207");
  assert.equal(gone().length, 1, "already gone: no second clear");

  store._onSocket({ type: "gm-card", clear: ["t207b"] }, gm.id);
  assert.equal(store.apps.gmCards.t207b, undefined);
  assert.deepEqual(gone().at(-1), ["t207b"], "another GM's client drops its pop-up too");
  store._onSocket({ type: "gm-card", card: { id: "t207c", title: "New" } }, gm.id);
  assert.equal(gone().length, 2, "a new card clears nothing");
});

test("G1/G2: losing signal is told; a character without an Agent hears nothing either way", async () => {
  store._signalSeen = {};
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: Date.now(), pcC: Date.now() });
  store._signalChanged();
  assert.match(alertsOf("pcA")[0]?.text ?? "", /No signal/);
  assert.equal(alertsOf("pcC").length, 0);
  await game.settings.set("cpr-sam-agent", "noSignal", {});
  store._signalChanged();
  assert.match(alertsOf("pcA").at(-1).text, /Signal restored/);
  assert.equal(alertsOf("pcC").length, 0);
});

test("Q2: whoever held #1 hears another character took it; not for their own new best", () => {
  store._lostTop({ actorId: "pcA", who: "V" }, { actorId: "pcB", who: "Judy" }, { from: "Flappy Chrome", app: "pigeon" });
  store._lostTop({ actorId: "pcB", who: "Judy" }, { actorId: "pcB", who: "Judy" }, { from: "Flappy Chrome", app: "pigeon" });
  store._lostTop({ actorId: "pcA", who: "V" }, { name: "AAA", fake: true }, { from: "Flappy Chrome", app: "pigeon" });
  const [alert] = alertsOf("pcA");
  assert.equal(alertsOf("pcA").length, 1);
  assert.match(alert.text, /Judy took your #1 spot/);
  assert.equal(alert.app, "pigeon");
  assert.equal(alertsOf("pcB").length, 0);
});

test("G31: @mentions are held for the Garden's push and point at the post", async () => {
  from(alice, "garden-join", { actorId: "pcA" });
  from(bob, "garden-join", { actorId: "pcB" });
  await settle();
  const judy = Object.values(store.garden.accounts).find(a => a.actorId === "pcB");
  const before = sent.length;
  from(alice, "garden-post", { actorId: "pcA", text: `Drinks tonight, ${judy.handle}?` });
  await settle();
  const mention = alertsOf("pcB").find(a => /mentioned you/.test(a.text));
  assert.equal(mention.from, "The Garden");
  assert.equal(mention.ref?.type, "garden-post");
  assert.ok(store.garden.posts[mention.ref.postId]);
  assert.equal(sent.slice(before).filter(s => s.recipients?.includes("bob") && s.payload.type === "apps" && s.payload.alerts.includes(mention.id)).length, 1, "one push carries it");
});

test("C6: CitiNet apps refuse without signal with one alert; WatchBox arm too", async () => {
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: Date.now() });
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  from(alice, "wb-arm", { actorId: "pcA" });
  await settle();
  assert.equal(Object.keys(store.apps.queries).length, 0, "nothing asked");
  const refused = alertsOf("pcA").filter(a => a.text === "No CitiNet connection.");
  assert.deepEqual(refused.map(a => a.app), ["alex", "watchbox"]);
  assert.ok(refused.every(a => popped(alice).includes(a.id)));
  assert.equal(store._citinet(game.actors.get("pcC"), "alex"), false, "no Agent: refused, silently");
  assert.equal(alertsOf("pcC").length, 0);
});

test("G29: Ask Alex's alerts point at their question", async () => {
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  await settle();
  const [q] = Object.values(store.apps.queries);
  from(gm, "alex-none", { queryId: q.id });
  await settle();
  const alert = alertsOf("pcA").at(-1);
  assert.deepEqual(alert.ref, { type: "alex-query", queryId: q.id });
  assert.equal(store.apps.gmCards[`alex:${q.id}`], undefined, "the GM's card went when the GM answered");
});

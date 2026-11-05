import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { challengeProblem, emptyBuild, oldMatches, KEEP_MATCHES, wagerOf } from "../apps/gladiator/model.js";

/*
 * Digital Gladiator's matches (apps/gladiator/host.js): a challenge holds the challenger's wager, accepting holds the
 * opponent's, the GM picks the mode, Declare winner pays the pot and fries the loser's Agent item, Call it off gives
 * the wagers back, Repair clears the flag, and Brain Injury is a GM button for Internal Agents.
 */

let gm, alice, bob;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const matches = () => Object.values(store.apps.gladiatorMatches);
const wealth = id => game.actors.get(id).system.wealth.value;
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);

/** An Agent item with Foundry's flag methods. */
function agentItem(name = "Agent") {
  const flags = {};
  const internal = name === "Internal Agent";
  return {
    name, type: internal ? "cyberware" : "gear", system: internal ? { isInstalled: true } : { equipped: "carried" },
    getFlag: (scope, key) => flags[key],
    async setFlag(scope, key, value) { flags[key] = structuredClone(value); },
    async unsetFlag(scope, key) { delete flags[key]; }
  };
}

const legal = (actorId, name) => ({ ...emptyBuild(actorId), name, stats: { ...emptyBuild(actorId).stats, ref: 6, body: 6, will: 6 }, problems: [] });

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 100, items: [agentItem()] });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 100, items: [agentItem("Internal Agent")] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  await game.settings.set("cpr-sam-agent", "features", { app_gladiator: true });
  store.apps.gladiators.pcA = legal("pcA", "Razor");
  store.apps.gladiators.pcB = legal("pcB", "Bolt");
});

const challenge = async (wager = 30) => {
  from(alice, "gladiator-challenge", { actorId: "pcA", opponentId: "pcB", wager });
  await settle();
  return matches().at(-1);
};
const accept = async match => {
  from(bob, "gladiator-answer", { id: match.id, actorId: "pcB", accept: true });
  await settle();
};

test("the challenge rules", () => {
  const builds = { pcA: legal("pcA", "Razor"), pcB: legal("pcB", "Bolt") };
  const base = { actorId: "pcA", opponentId: "pcB", opponentName: "Judy", builds, matches: {}, wager: 10, wealth: 100 };
  assert.equal(challengeProblem(base), null);
  assert.match(challengeProblem({ ...base, opponentId: "pcA" }), /Pick someone/);
  assert.match(challengeProblem({ ...base, builds: { pcB: builds.pcB } }), /Build your Gladiator/);
  assert.match(challengeProblem({ ...base, builds: { ...builds, pcB: { ...builds.pcB, problems: ["x"] } } }), /Judy has no Gladiator ready/);
  assert.match(challengeProblem({ ...base, wealth: 5 }), /can't cover/);
  assert.equal(challengeProblem({ ...base, wealth: null, wager: 1000 }), null, "no wallet: the wager moves no money");
  assert.match(challengeProblem({ ...base, matches: { m: { status: "live", a: { actorId: "pcB" }, b: { actorId: "x" }, ts: 1 } } }), /Judy is already in a match/);
  assert.equal(wagerOf("2.5"), null);
  assert.equal(wagerOf(""), 0);
});

test("only the newest finished matches are kept", () => {
  const all = Object.fromEntries(Array.from({ length: KEEP_MATCHES + 3 }, (_, i) => [`m${i}`, { id: `m${i}`, status: "done", ts: i, a: {}, b: {} }]));
  all.live = { id: "live", status: "live", ts: -1, a: {}, b: {} };
  assert.deepEqual(oldMatches(all).sort(), ["m0", "m1", "m2"]);
});

test("a challenge holds the challenger's wager; declining gives it back", async () => {
  const match = await challenge();
  assert.equal(match.status, "pending");
  assert.equal(wealth("pcA"), 70);
  assert.match(lastAlert("pcB").text, /challenges your Gladiator for \D*30/);
  from(bob, "gladiator-answer", { id: match.id, actorId: "pcB", accept: false });
  await settle();
  assert.equal(match.status, "declined");
  assert.deepEqual([wealth("pcA"), wealth("pcB")], [100, 100]);
});

test("accepting holds the opponent's wager and asks the GM how to settle it", async () => {
  const match = await challenge();
  await accept(match);
  assert.equal(match.status, "accepted");
  assert.equal(wealth("pcB"), 70);
  const card = gmCards().find(c => c.id === `gladiator:${match.id}`);
  assert.deepEqual(card.actions.map(a => [a.request, a.data.mode]), [["gladiator-mode", "gm"], ["gladiator-mode", "play"], ["gladiator-off", undefined]]);
});

test("nobody else can answer, a second challenge is refused, and a poor challenger can't wager", async () => {
  const match = await challenge();
  from(alice, "gladiator-answer", { id: match.id, actorId: "pcB", accept: true });
  await settle();
  assert.equal(match.status, "pending");
  await challenge();
  assert.equal(matches().length, 1);
  assert.match(lastAlert("pcA").text, /already in a match/);
  from(alice, "gladiator-withdraw", { id: match.id, actorId: "pcA" });
  await settle();
  assert.equal(match.status, "withdrawn");
  assert.equal(wealth("pcA"), 100);
  await challenge(500);
  assert.equal(matches().length, 1);
  assert.match(lastAlert("pcA").text, /can't cover/);
});

test("GM choice: Declare winner pays the pot and fries the loser's Internal Agent; Brain Injury is a GM button", async () => {
  const match = await challenge();
  await accept(match);
  from(gm, "gladiator-mode", { id: match.id, mode: "gm" });
  await settle();
  assert.deepEqual([match.status, match.mode], ["live", "gm"]);
  from(gm, "gladiator-declare", { id: match.id, winner: "pcA" });
  await settle();
  assert.deepEqual([match.status, match.winner, match.loser, match.how], ["done", "pcA", "pcB", "gm"]);
  assert.deepEqual([wealth("pcA"), wealth("pcB")], [130, 70]);
  const fried = game.actors.get("pcB").items[0].getFlag("cpr-sam-agent", "fried");
  assert.equal(fried.matchId, match.id);
  assert.equal(fried.internal, true);
  assert.equal(game.actors.get("pcA").items[0].getFlag("cpr-sam-agent", "fried"), undefined);
  const fate = gmCards().find(c => c.id === `gladiator-fate:${match.id}`);
  assert.deepEqual(fate.actions.map(a => a.request), ["gladiator-brain", "gladiator-repair"]);
  from(gm, "gladiator-repair", { actorId: "pcB" });
  await settle();
  assert.equal(game.actors.get("pcB").items[0].getFlag("cpr-sam-agent", "fried"), undefined);
  assert.match(lastAlert("pcB").text, /back online/);
});

test("a gear Agent loser gets no Brain Injury button", async () => {
  const match = await challenge(0);
  await accept(match);
  from(gm, "gladiator-mode", { id: match.id, mode: "gm" });
  from(gm, "gladiator-declare", { id: match.id, winner: "pcB" });
  await settle();
  assert.ok(game.actors.get("pcA").items[0].getFlag("cpr-sam-agent", "fried"));
  assert.deepEqual(gmCards().find(c => c.id === `gladiator-fate:${match.id}`).actions.map(a => a.request), ["gladiator-repair"]);
});

test("Call it off: both wagers back, nothing fried; players can't declare", async () => {
  const match = await challenge();
  await accept(match);
  from(gm, "gladiator-mode", { id: match.id, mode: "gm" });
  from(alice, "gladiator-declare", { id: match.id, winner: "pcA" });
  await settle();
  assert.equal(match.status, "live");
  from(gm, "gladiator-off", { id: match.id });
  await settle();
  assert.equal(match.status, "off");
  assert.deepEqual([wealth("pcA"), wealth("pcB")], [100, 100]);
  assert.equal(game.actors.get("pcB").items[0].getFlag("cpr-sam-agent", "fried"), undefined);
});

test("gameplay: the match goes live with a duel; a Gladiator can't be rebuilt mid-match", async () => {
  game.packs = { get: () => ({ getDocuments: async () => [] }) };
  await game.settings.set("cpr-sam-agent", "gladiatorSettle", "play");
  const match = await challenge();
  await accept(match);
  assert.deepEqual([match.status, match.mode], ["live", "play"]);
  assert.deepEqual(Object.keys(match.battle.fighters).sort(), ["pcA", "pcB"]);
  assert.ok(!gmCards().some(c => c.id === `gladiator:${match.id}`), "the setting skips the GM's question");
  from(alice, "gladiator-save", { actorId: "pcA", build: { name: "Other" } });
  await settle();
  assert.equal(store.apps.gladiators.pcA.name, "Razor");
});

/** A live duel (the settle setting is "play"), and who moves first and second. */
const duel = async (wager = 30) => {
  game.packs = { get: () => ({ getDocuments: async () => [] }) };
  await game.settings.set("cpr-sam-agent", "gladiatorSettle", "play");
  const match = await challenge(wager);
  await accept(match);
  const [first, second] = match.battle.order;
  return { match, first, second, users: { pcA: alice, pcB: bob } };
};

test("the duel: the wrong side is refused, a legal move advances the battle", async () => {
  const { match, first, second, users } = await duel();
  const before = match.battle;
  from(users[second], "gladiator-move", { id: match.id, actorId: second, move: "move:in" });
  from(users[second], "gladiator-move", { id: match.id, actorId: first, move: "move:in" });
  await settle();
  assert.equal(match.battle, before, "not their turn, and not their character");
  assert.match(lastAlert(second).text, /Not your turn/);
  from(users[first], "gladiator-move", { id: match.id, actorId: first, move: "move:in" });
  await settle();
  assert.deepEqual([match.battle.band, match.battle.turn, match.status], [before.band - 1, second, "live"]);
  assert.match(match.battle.log.at(-1).text, /closes in/);
});

test("the duel: conceding loses the match, pays the pot and fries the loser's Agent", async () => {
  const { match, second, users } = await duel();
  from(users[second], "gladiator-move", { id: match.id, actorId: second, move: "concede" });
  await settle();
  const winner = second === "pcA" ? "pcB" : "pcA";
  assert.deepEqual([match.status, match.winner, match.loser, match.how], ["done", winner, second, "concede"]);
  assert.deepEqual([wealth(winner), wealth(second)], [130, 70]);
  assert.ok(game.actors.get(second).items[0].getFlag("cpr-sam-agent", "fried"));
  assert.equal(game.actors.get(winner).items[0].getFlag("cpr-sam-agent", "fried"), undefined);
});

test("the duel: both sides agreeing calls it off; one offer alone doesn't, and can be taken back", async () => {
  const { match } = await duel();
  from(alice, "gladiator-draw", { id: match.id, actorId: "pcA" });
  await settle();
  assert.deepEqual([match.status, match.draw], ["live", ["pcA"]]);
  assert.match(lastAlert("pcB").text, /V offers to call the match off/);
  from(alice, "gladiator-draw", { id: match.id, actorId: "pcA" });
  from(bob, "gladiator-draw", { id: match.id, actorId: "pcB" });
  await settle();
  assert.deepEqual([match.status, match.draw], ["live", ["pcB"]]);
  from(alice, "gladiator-draw", { id: match.id, actorId: "pcA" });
  await settle();
  assert.deepEqual([match.status, match.how], ["off", "draw"]);
  assert.ok(match.doneAt);
  assert.deepEqual([wealth("pcA"), wealth("pcB")], [100, 100]);
  assert.match(lastAlert("pcA").text, /You both agreed to stop. Wagers are back/);
  assert.equal(game.actors.get("pcB").items[0].getFlag("cpr-sam-agent", "fried"), undefined);
});

test("the duel: the GM can still declare the winner", async () => {
  const { match } = await duel();
  from(gm, "gladiator-declare", { id: match.id, winner: "pcB" });
  await settle();
  assert.deepEqual([match.status, match.winner, match.how], ["done", "pcB", "gm"]);
  assert.deepEqual([wealth("pcA"), wealth("pcB")], [70, 130]);
});

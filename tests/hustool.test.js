import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsFor, emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { DEFAULT_ERRANDS, encounterTable, errandsFor, gigHours, hustoolConfig, inHours, outcomeOf, timeOfDay } from "../apps/hustool/model.js";
import { CATALOGUE_DEFAULTS } from "../apps/pool/model.js";
import { LEDGER_KINDS } from "../apps/bangme/model.js";

/*
 * HusTool (apps/hustool/model.js, apps/hustool/host.js): what a d10 means, the hustles a settled round banks, PAY ME
 * spending them, Done and Bail with world time standing still, pay into BangMe!, trouble cards, and what players can't
 * see. These call the host as the GM's hook would; no cpr-hq here, only its history flag. Rolls and chat are faked (the
 * shared stub has neither).
 */

let gm, alice, dice;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);
const wealth = () => game.actors.get("pcA").system.wealth.value;
const setConfig = value => game.settings.set("cpr-sam-agent", "hustool", value);

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 100 });
  dice = [];
  globalThis.Roll = class { constructor() {} async evaluate() { return { total: dice.length ? dice.shift() : 5 }; } };
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getSpeaker: () => ({}) };
  game.tables = [];
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  await setConfig({ errands: [{ id: "e1", text: "Deliver takeout" }] });
  await game.settings.set("cpr-sam-agent", "features", { app_hustool: true });
});

test("errands: hours that wrap past midnight, vehicles, switched off", () => {
  const list = hustoolConfig({ errands: [
    { id: "a", text: "Any time" },
    { id: "n", text: "Night shift", from: 22, to: 4 },
    { id: "d", text: "Day shift", from: "8", to: "18" },
    { id: "v", text: "Drive", vehicle: true },
    { id: "x", text: "Off", on: false },
    { id: "b", text: "" }
  ] }).errands;
  assert.equal(list.length, 5, "an errand without text is dropped");
  const ids = opts => errandsFor(list, opts).map(e => e.id);
  assert.deepEqual(ids({ hour: 23 }), ["a", "n"]);
  assert.deepEqual(ids({ hour: 3, vehicle: true }), ["a", "n", "v"]);
  assert.deepEqual(ids({ hour: 4 }), ["a"], "to is exclusive");
  assert.deepEqual(ids({ hour: 12 }), ["a", "d"]);
  assert.deepEqual(ids({ hour: null }), ["a", "n", "d"], "an unknown hour passes the hours check");
  assert.ok(inHours({ from: 5, to: 5 }, 12), "from = to is any time");
});

test("defaults: the book's errands, 10eb a hustle, 20eb once in the store, a BangMe! ledger kind", () => {
  const config = hustoolConfig({});
  assert.deepEqual([config.pay, config.trouble, config.perHour], [10, true, 2]);
  assert.equal(config.errands.length, DEFAULT_ERRANDS.length);
  assert.ok(config.errands.find(e => e.id === "drive").vehicle);
  assert.deepEqual(CATALOGUE_DEFAULTS.hustool, { publisher: "No/Brainer", price: 20, model: "once" });
  assert.equal(LEDGER_KINDS.hustool, "HusTool");
});

test("outcomes: 1 sour, 2-9 paid, 10 trouble (paid when trouble is off); encounter tables by time of day and district", () => {
  assert.equal(outcomeOf(1), "sour");
  for (let r = 2; r <= 9; r++) assert.equal(outcomeOf(r), "paid");
  assert.equal(outcomeOf(10), "trouble");
  assert.equal(outcomeOf(10, { trouble: false }), "paid");
  assert.deepEqual([0, 6, 12, 18, 23].map(timeOfDay), ["night", "morning", "afternoon", "evening", "evening"]);
  const tables = [{ name: "Encounters: Evening" }, { name: "Watson Encounters (Evening)" }, { name: "Night Market" }];
  assert.equal(encounterTable(tables, { hour: 20 }).name, "Encounters: Evening");
  assert.equal(encounterTable(tables, { hour: 20, district: "Watson" }).name, "Watson Encounters (Evening)");
  assert.equal(encounterTable(tables, { hour: 3 }), null);
});

const DAY = 86400;
const ROUND_START = 1000 * DAY;
const gigs = () => Object.values(store.apps.hustoolGigs);
const history = (roundId, blocks, days = 3) => ({ roundId, start: ROUND_START, days, blocks, status: "approved" });
const block = (start, length, activity = "hustool") => ({ id: `b${start}`, activity, start, length });

/** A character with this history, and the settle request for it. */
async function settled(entries, roundId = entries.at(-1).roundId) {
  const actor = game.actors.get("pcA");
  await actor.setFlag("cpr-hq", "downtimeHistory", entries);
  from(gm, "hustool-settled", { roundId, actorIds: ["pcA"] });
  await settle();
}

const openOf = row => row.days.flatMap(d => d.errands).filter(e => e.status === "open");
const payMe = async () => {
  from(alice, "hustool-payme", { actorId: "pcA" });
  await settle();
};
const gigLedger = () => Object.values(store.apps.ledger).filter(l => l.actorId === "pcA" && l.kind === "hustool");

test("PAY ME needs a banked hustle: none before downtime settles, none once they're spent", async () => {
  await payMe();
  assert.equal(gigs().length, 0, "PAY ME makes nothing by itself");
  await settled([history("r1", [block(12, 1)])]);
  const [row] = gigs();
  const [a, b] = row.days[0].errands;
  await payMe();
  assert.equal(a.status, "running", "the next hustle");
  await payMe();
  assert.equal(b.status, "open", "one at a time");
  from(gm, "hustool-payme", { actorId: "pcA" });
  await settle();
  assert.equal(b.status, "open", "the player's button");
  from(alice, "hustool-gig", { rowId: row.id, errandId: b.id, action: "complete" });
  await settle();
  assert.equal(b.status, "open", "Done only finishes the one they're on");
  from(alice, "hustool-gig", { rowId: row.id, errandId: a.id, action: "complete" });
  await settle();
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: b.id, action: "skip" });
  await settle();
  const statuses = row.days[0].errands.map(e => e.status);
  await payMe();
  assert.deepEqual(row.days[0].errands.map(e => e.status), statuses, "no hustles left, nothing happens");
});

test("Done works at once with world time standing still: a 5 pays 10eb into BangMe!, whispered", async () => {
  await settled([history("r1", [block(12, 1)])]);
  const [row] = gigs();
  const [a] = row.days[0].errands;
  const stopped = game.time.worldTime;
  dice.push(5);
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: a.id, action: "complete" });
  await settle();
  assert.equal(game.time.worldTime, stopped);
  assert.deepEqual([a.status, a.roll, a.pay], ["paid", 5, 10]);
  assert.equal(wealth(), 110);
  const [ledger] = gigLedger();
  assert.deepEqual([ledger.amount, ledger.kind, ledger.memo], [10, "hustool", "Deliver takeout"]);
  assert.deepEqual(ChatMessage.created.at(-1).whisper.sort(), ["alice", "gm"], "the roll is whispered to the player and the GM");
});

test("the next round expires the hustle a character is on, too", async () => {
  const one = history("r1", [block(12, 1)]);
  await settled([one]);
  const [a] = gigs()[0].days[0].errands;
  await payMe();
  assert.equal(a.status, "running");
  await settled([one, history("r2", [block(12, 1)])]);
  assert.equal(a.status, "expired");
});

test("gig hours: counted hour by hour across midnight, per day, only hustool blocks, inside the round", () => {
  const entry = history("r", [block(22, 4), block(30, 1), block(3, 2, "sleep"), block(70, 5)]);
  assert.deepEqual(gigHours(entry), [{ day: 0, hours: [22, 23] }, { day: 1, hours: [0, 1, 6] }, { day: 2, hours: [22, 23] }]);
  assert.deepEqual(gigHours(history("r", [])), []);
});

test("settling: perHour errands per gig hour by day, errands fit the hour and the vehicle, the player is told", async () => {
  await setConfig({ perHour: 3, errands: [
    { id: "any", text: "Any time" }, { id: "night", text: "Night shift", from: 22, to: 4 }, { id: "van", text: "Drive", vehicle: true }
  ] });
  await settled([history("r1", [block(12, 1), block(47, 2)])]);
  const [row] = gigs();
  assert.equal(row.id, "r1-pcA");
  assert.deepEqual(row.days.map(d => [d.day, d.errands.length]), [[0, 3], [1, 3], [2, 3]], "hours 12, 47 (day 1, 23:00) and 48 (day 2, 00:00)");
  const ids = d => new Set(row.days[d].errands.map(e => e.errandId));
  assert.ok(!ids(0).has("night"), "no night errands at noon");
  assert.ok(![...row.days.flatMap(d => d.errands)].some(e => e.errandId === "van"), "no vehicle, no driving");
  assert.ok(row.days.flatMap(d => d.errands).every(e => e.status === "open"));
  assert.match(lastAlert("pcA").text, /9 hustles ready/);
});

test("settling: nothing without HusTool or without gigs; an hour no errand fits gives none", async () => {
  await settled([history("r1", [block(1, 2, "sleep")])]);
  assert.equal(gigs().length, 0, "no gig blocks, no row");
  await setConfig({ errands: [{ id: "d", text: "Day shift", from: 8, to: 18 }] });
  await settled([history("r2", [block(3, 2)])]);
  assert.equal(gigs().length, 0, "at 03:00 only the day shift exists");
  await setConfig({ errands: [{ id: "e1", text: "Deliver takeout" }] });
  await game.settings.set("cpr-sam-agent", "features", { app_hustool: false });
  await settled([history("r3", [block(3, 2)])]);
  assert.equal(gigs().length, 0, "the app is switched off");
  await game.settings.set("cpr-sam-agent", "features", { app_hustool: true, app_pool: true });
  await settled([history("r4", [block(3, 2)])]);
  assert.equal(gigs().length, 0, "App Store on: not installed on this Agent");
  store.apps.installs.pcA = { hustool: { ts: 1 } };
  await settled([history("r5", [block(3, 2)])]);
  assert.equal(gigs().length, 1, "App Store on: installed");
});

test("settling twice makes no second batch and doesn't touch what's resolved; a player can't ask for it", async () => {
  const entry = history("r1", [block(12, 2)]);
  await settled([entry]);
  const [row] = gigs();
  const [first] = openOf(row);
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: first.id, action: "skip" });
  await settle();
  await settled([entry]);
  assert.equal(gigs().length, 1);
  assert.equal(row.days[0].errands.length, 4);
  assert.equal(first.status, "skipped");
  assert.equal(openOf(row).length, 3, "this round's errands don't expire on a repeat");
  from(alice, "hustool-settled", { roundId: "r9", actorIds: ["pcA"] });
  await settle();
  assert.equal(openOf(row).length, 3, "GM only");
});

test("the next round expires what's open, no pay, before making its own", async () => {
  const one = history("r1", [block(12, 1)]);
  await settled([one]);
  const [old] = gigs();
  dice.push(5);
  const [paid, left] = old.days[0].errands;
  await payMe();
  from(alice, "hustool-gig", { rowId: old.id, errandId: paid.id, action: "complete" });
  await settle();
  const before = wealth();
  await settled([one, history("r2", [block(12, 1)])]);
  assert.equal(paid.status, "paid", "what's resolved stays");
  assert.equal(left.status, "expired");
  assert.equal(wealth(), before);
  assert.equal(gigs().length, 2);
  assert.equal(openOf(store.apps.hustoolGigs["r2-pcA"]).length, 2);
  from(alice, "hustool-gig", { rowId: old.id, errandId: left.id, action: "complete" });
  await settle();
  assert.equal(left.status, "expired", "too late");
});

test("Complete pays at once, Skip neither rolls nor pays, a 1 goes sour; BangMe! rows carry the downtime date, ts stays real", async () => {
  await settled([history("r1", [block(30, 2)])]);
  const [row] = gigs();
  const [a, b, c] = row.days[0].errands;
  const startedAt = Date.now();
  dice.push(5, 1);
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: a.id, action: "complete" });
  await settle();
  assert.deepEqual([a.status, a.roll, a.pay], ["paid", 5, 10]);
  assert.equal(wealth(), 110);
  from(alice, "hustool-gig", { rowId: row.id, errandId: a.id, action: "complete" });
  await settle();
  assert.equal(wealth(), 110, "resolved once");
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: b.id, action: "complete" });
  await settle();
  assert.deepEqual([b.status, b.pay], ["sour", 0]);
  assert.ok(b.flavor);
  assert.equal(wealth(), 110);
  const rolled = ChatMessage.created.length;
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: c.id, action: "skip" });
  await settle();
  assert.equal(c.status, "skipped");
  assert.equal(ChatMessage.created.length, rolled, "Skip rolls nothing");
  assert.equal(dice.length, 0);

  const [ledger] = gigLedger();
  assert.equal(gigLedger().length, 1, "only what paid");
  assert.equal(ledger.date, row.days[0].date);
  assert.equal(ledger.time, a.time);
  assert.equal(ledger.date, "Downtime day 2", "the stub's phones aren't on world time");
  assert.equal(a.time, "06:00");
  assert.equal(c.time, "07:00");
  assert.equal(b.time, "06:30");
  assert.ok(ledger.ts >= startedAt, "ts is real time");
});

test("Complete all: one summary card, each errand rolled, a BangMe! row each; other players can't touch it", async () => {
  addUser({ id: "bob" });
  await settled([history("r1", [block(12, 2), block(36, 1)])]);
  const [row] = gigs();
  const [today, tomorrow] = row.days;
  from(game.users.get("bob"), "hustool-gig-day", { rowId: row.id, day: 0 });
  from(game.users.get("bob"), "hustool-gig", { rowId: row.id, errandId: today.errands[0].id, action: "complete" });
  await settle();
  assert.equal(openOf(row).length, 6, "not their character");
  const cards = ChatMessage.created.length;
  dice.push(5, 1, 7, 2);
  from(alice, "hustool-gig-day", { rowId: row.id, day: "0" });
  await settle();
  assert.deepEqual(today.errands.map(e => e.status), ["paid", "sour", "paid", "paid"]);
  assert.equal(wealth(), 130);
  assert.equal(gigLedger().length, 3);
  assert.equal(ChatMessage.created.length, cards + 1, "one card for the day");
  const summary = ChatMessage.created.at(-1);
  assert.match(summary.content, /4 errands, rolled 5, 1, 7, 2\. Paid \D*30/);
  assert.deepEqual([...summary.whisper].sort(), ["alice", "gm"]);
  assert.ok(tomorrow.errands.every(e => e.status === "open"), "the other day waits");
});

test("trouble: one card per character per downtime day, later 10s pay with a flavor line; players never see the gm side", async () => {
  await setConfig({ errands: [{ id: "w", text: "Walk a dog", district: "Watson" }] });
  await settled([history("r1", [block(20, 2), block(44, 1)])]);
  const [row] = gigs();
  const [today, tomorrow] = row.days;
  dice.push(10, 10, 10, 3, 10);
  from(alice, "hustool-gig-day", { rowId: row.id, day: 0 });
  await settle();
  assert.deepEqual(today.errands.map(e => e.status), ["trouble", "paid", "paid", "paid"]);
  assert.match(today.errands[1].flavor, /Close call on the Watson run/);
  assert.equal(today.errands[3].flavor, undefined, "a 3 is just a 3");
  assert.equal(wealth(), 140, "every 10 pays");
  let cards = gmCards().filter(c => c.id?.startsWith("hustool-trouble:"));
  assert.equal(cards.length, 1);
  assert.match(cards[0].body, /Downtime day 1, Watson, evening/);

  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: tomorrow.errands[0].id, action: "complete" });
  dice.push(10);
  await settle();
  assert.equal(tomorrow.errands[0].status, "trouble", "a new day, a new card");
  cards = gmCards().filter(c => c.id?.startsWith("hustool-trouble:"));
  assert.equal(cards.length, 2);

  const seen = appsFor(alice, store.apps).hustoolGigs[row.id];
  assert.equal(seen.gm, undefined, "no gm side for players");
  assert.ok(seen.days.length);
  assert.ok(appsFor(gm, store.apps).hustoolGigs[row.id].gm.troubleDays[0]);

  const { data } = cards[0].actions.find(a => a.label === "Wave off");
  from(alice, "hustool-trouble", data);
  await settle();
  assert.equal(row.gm.troubleDays[0].gm.trouble, "pending", "GM only");
  from(gm, "hustool-trouble", data);
  await settle();
  assert.equal(row.gm.troubleDays[0].gm.trouble, "waved");
  const chats = ChatMessage.created.length;
  from(gm, "hustool-trouble", cards[1].actions.find(a => a.label === "Play it out").data);
  await settle();
  assert.equal(row.gm.troubleDays[1].gm.trouble, "played");
  assert.match(ChatMessage.created.at(-1).content, /Downtime day 2 · Watson · evening, 20:00/);
  assert.equal(ChatMessage.created.length, chats + 1);
});

test("a 10 with trouble off just pays; perHour comes from the setting, 2 by default", async () => {
  assert.equal(hustoolConfig({}).perHour, 2);
  assert.equal(hustoolConfig({ perHour: "4" }).perHour, 4);
  await setConfig({ trouble: false, perHour: 1, errands: [{ id: "e1", text: "Deliver takeout" }] });
  await settled([history("r1", [block(12, 1)])]);
  const [row] = gigs();
  assert.equal(row.days[0].errands.length, 1);
  dice.push(10);
  await payMe();
  from(alice, "hustool-gig", { rowId: row.id, errandId: row.days[0].errands[0].id, action: "complete" });
  await settle();
  assert.deepEqual([row.days[0].errands[0].status, row.days[0].errands[0].pay], ["paid", 10]);
  assert.equal(gmCards().filter(c => c.id?.startsWith("hustool-trouble:")).length, 0);
});

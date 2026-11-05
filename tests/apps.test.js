import { addActor, addScene, addUser, actAs, hooks, reset, saved, sent } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, growth, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import fs from "node:fs";

/** The Garden's built-in word lists, read from data/garden/ as the module would fetch them. */
setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));
import { dataPool, findLocation, locations, namedLocations, pageText, poolMatches } from "../apps/alex/model.js";
import { costOf, draftRequest, runDraft } from "../apps/alex/ai.js";
import { execTier, MONTH, offeredTier, planPrice, traumaConfig } from "../apps/trauma/model.js";
import { setContentAchievements } from "../scripts/model/content.js";

/** Achieve!'s list from a content folder (model/content.js): a few, as achievements.json would give them. */
setContentAchievements([["payday", "Payday"], ["gamer", "Gamer"], ["vip", "VIP"]].map(([id, name]) => ({ id, name, text: "" })));

/*
 * The apps on the host: Agent alerts, BangMe!, Trauma Team, Ask Alex Anything, WatchBox and The
 * Garden. Players' requests arrive through _onSocket with the sender id, as over the wire.
 */

let gm, alice, bob;

beforeEach(async () => {
  await store._writing; // the last test's saves land first
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 1500, items: ["Agent", "Biomonitor"], system: { derivedStats: { hp: { value: 40, max: 40 } }, stats: { body: { value: 6 }, int: { value: 7 } } } });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 1000 });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  store._seedGarden();
  store._rememberVitals();
});

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing; // and its saves
};
const receivedBy = user => sent.filter(s => s.recipients?.includes(user.id)).map(s => s.payload);
const alertsOf = actorId => Object.values(store.apps.alerts).filter(a => a.actorId === actorId).sort((a, b) => a.ts - b.ts);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);

test("the GM's SAAI alert reaches only its character's player, who answers it", async () => {
  from(gm, "alert-send", { actorIds: ["pcA"], kind: "advice", text: "I have a bad feeling.", choices: "Leave, Stay" });
  from(alice, "alert-send", { actorIds: ["pcB"], text: "players can't" });
  await settle();
  const [alert] = alertsOf("pcA");
  assert.deepEqual(alert.choices, ["Leave", "Stay"]);
  assert.equal(alertsOf("pcB").length, 0);
  const pushed = receivedBy(alice).find(p => p.type === "apps");
  assert.deepEqual(pushed.alerts, [alert.id], "it pops up for alice");
  assert.equal(receivedBy(bob).find(p => p.type === "apps").alerts.length, 0, "bob doesn't see it");
  assert.deepEqual(Object.keys(receivedBy(bob).find(p => p.type === "apps").apps.alerts), []);

  from(bob, "alert-answer", { alertId: alert.id, choice: "Leave" });
  from(alice, "alert-answer", { alertId: alert.id, choice: "Maybe" });
  await settle();
  assert.equal(alert.answer, null, "only the owner, only its answers");
  from(alice, "alert-answer", { alertId: alert.id, choice: "Stay" });
  await settle();
  assert.equal(alert.answer, "Stay");
  assert.match(gmCards().at(-1).body, /Stay/, "the GM hears the answer");
  assert.ok(saved.data.apps.alerts[alert.id], "saved in the message file");
});

test("a Biomonitor warns when HP crosses into a wound state", async () => {
  const actor = game.actors.get("pcA");
  actor.system.derivedStats.hp.value = 15;
  store._onHealth(actor);
  assert.match(alertsOf("pcA").at(-1).text, /Seriously Wounded/);
  actor.system.derivedStats.hp.value = 12;
  store._onHealth(actor);
  assert.equal(alertsOf("pcA").length, 1, "only when it gets worse");
});

test("BangMe!: a Bang needs someone within 20 m, and their yes", async () => {
  // 2 m squares: pcB is 6 squares (12 m) away; nobody else near.
  addScene({ tokens: [{ id: "tA", actorId: "pcA", name: "V", x: 0, y: 0 }, { id: "tB", actorId: "pcB", name: "Judy", x: 600, y: 0 }] });
  from(alice, "bang-offer", { actorId: "pcA", targetId: "pcB", amount: 200, memo: "for the ride" });
  await settle();
  const offer = alertsOf("pcB")[0];
  assert.deepEqual(offer.choices, ["Accept", "Decline"]);
  assert.equal(game.actors.get("pcA").system.wealth.value, 1500, "nothing moves until they accept");

  from(bob, "alert-answer", { alertId: offer.id, choice: "Accept" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 1300);
  assert.equal(game.actors.get("pcB").system.wealth.value, 1200);
  const ledger = Object.values(store.apps.ledger);
  assert.deepEqual(ledger.map(e => [e.actorId, e.amount, e.kind]).sort(), [["pcA", -200, "bang"], ["pcB", 200, "bang"]]);

  // Out of range.
  game.scenes.get("s1").tokens.get("tB").x = 2000;
  from(alice, "bang-offer", { actorId: "pcA", targetId: "pcB", amount: 50 });
  await settle();
  assert.match(alertsOf("pcA").at(-1).text, /out of range/);
});

test("BangMe!: invoices between players, at any distance, with the payer's yes", async () => {
  from(alice, "invoice-send", { actorId: "pcA", targetId: "pcB", amount: 200, memo: "the ride" });
  from(bob, "invoice-send", { actorId: "pcA", targetId: "pcB", amount: 999 }); // not Bob's character to bill as
  await settle();
  assert.equal(Object.keys(store.apps.invoices).length, 1);
  const ask = alertsOf("pcB")[0];
  assert.deepEqual(ask.choices, ["Pay", "Decline"]);
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000, "nothing moves until they pay");
  assert.ok(!receivedBy(alice).at(-1).apps.alerts[ask.id], "the alert is the payer's");

  from(alice, "invoice-respond", { invoiceId: ask.ref.invoiceId, action: "pay" }); // only the payer pays
  await settle();
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000);

  from(bob, "alert-answer", { alertId: ask.id, choice: "Pay" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcB").system.wealth.value, 800);
  assert.equal(game.actors.get("pcA").system.wealth.value, 1700);
  assert.deepEqual(Object.values(store.apps.ledger).map(e => [e.actorId, e.amount, e.kind, e.party]).sort(), [["pcA", 200, "invoice", "Judy"], ["pcB", -200, "invoice", "V"]]);

  from(bob, "invoice-respond", { invoiceId: ask.ref.invoiceId, action: "pay" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(game.actors.get("pcB").system.wealth.value, 800, "paid once");
});

test("BangMe!: the GM and players invoice each other", async () => {
  // The GM bills under any name; the money leaves the character and goes nowhere.
  from(gm, "invoice-send", { targetId: "pcA", fromName: "CPR HQ", amount: 100, memo: "Rent" });
  await settle();
  const bill = alertsOf("pcA")[0];
  assert.match(bill.text, /CPR HQ invoiced you/);
  from(alice, "alert-answer", { alertId: bill.id, choice: "Pay" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 1400);

  // A player bills the GM: a card with buttons, and the money appears when the GM pays.
  from(alice, "invoice-send", { actorId: "pcA", targetId: "gm", amount: 50, memo: "Expenses" });
  await settle();
  const card = gmCards().at(-1);
  assert.deepEqual(card.actions.map(a => a.label), ["Pay", "Decline"]);
  from(alice, "invoice-respond", card.actions[0].data); // not theirs to pay
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 1400);
  from(gm, "invoice-respond", card.actions[0].data);
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcA").system.wealth.value, 1450);
  assert.ok(!store.apps.gmCards[card.id], "the card goes when it's settled");

  // A declined one tells the sender and moves nothing; a cancelled one closes the payer's question.
  from(gm, "invoice-send", { targetId: "pcA", fromName: "CPR HQ", amount: 10 });
  await settle();
  const cancel = alertsOf("pcA").find(a => a.ref?.type === "invoice" && !a.answer);
  from(gm, "invoice-respond", { invoiceId: cancel.ref.invoiceId, action: "cancel" });
  await settle();
  assert.equal(store.apps.invoices[cancel.ref.invoiceId].status, "cancelled");
  assert.equal(store.apps.alerts[cancel.id].answer, "Cancelled");
  assert.equal(game.actors.get("pcA").system.wealth.value, 1450);
});

test("BangMe!: no BangMe! on the Agent: told to install it, and the invoice waits", async () => {
  await game.settings.set("cpr-sam-agent", "features", { app_pool: true });
  await game.settings.set("cpr-sam-agent", "pool", { seeded: 1, apps: {} });
  store.apps.installs = { pcA: { bangme: { source: "store" } } };
  from(alice, "invoice-send", { actorId: "pcA", targetId: "pcB", amount: 75 });
  await settle();
  const [notice] = alertsOf("pcB");
  assert.equal(notice.text, "Someone is trying to invoice us. We should install BangMe! from the app store.");
  assert.deepEqual(notice.choices, []);
  assert.equal(notice.app, "pool");
  const invoice = Object.values(store.apps.invoices)[0];
  assert.equal(invoice.status, "pending");

  from(bob, "invoice-respond", { invoiceId: invoice.id, action: "pay" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000, "can't pay without the app");

  store.apps.installs.pcB = { bangme: { source: "store" } };
  from(bob, "invoice-respond", { invoiceId: invoice.id, action: "pay" });
  await settle();
  await new Promise(r => setTimeout(r, 30));
  await settle();
  assert.equal(game.actors.get("pcB").system.wealth.value, 925, "installed: it can be paid");
  assert.equal(game.actors.get("pcA").system.wealth.value, 1575);
});

test("BangMe!: paying at a pay point, and the GM's adjustments", async () => {
  await game.settings.set("cpr-sam-agent", "payPoints", [{ id: "bar", name: "Lizzie's", open: true, items: [{ label: "Beer", amount: 20 }] }, { id: "shut", name: "Closed", open: false, items: [] }]);
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "bar", item: 0 });
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "shut", amount: 10 });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1480);
  from(alice, "ledger-adjust", { actorId: "pcA", amount: 1000 });
  from(gm, "ledger-adjust", { actorId: "pcA", amount: -80, memo: "Eurobank reversal" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1400, "only the GM adjusts");
  assert.deepEqual(Object.values(store.apps.ledger).map(e => e.memo), ["Beer", "Eurobank reversal"]);
});

test("BangMe!: an anchored pay point only takes payment from close by", async () => {
  const scene = addScene({ tokens: [{ id: "tA", actorId: "pcA", name: "V", x: 0, y: 0 }, { id: "tBar", actorId: "npc", name: "Bartender", x: 600, y: 0 }] });
  scene.notes = new Map([["n1", { id: "n1", x: 50, y: 50, text: "Noodle stall" }]]);
  const bar = { id: "bar", name: "Lizzie's", open: true, items: [{ label: "Beer", amount: 20 }], anchor: { kind: "token", sceneId: "s1", id: "tBar" }, range: 10 };
  const stall = { id: "stall", name: "Stall", open: true, items: [{ label: "Noodles", amount: 5 }], anchor: { kind: "note", sceneId: "s1", id: "n1" } };
  await game.settings.set("cpr-sam-agent", "payPoints", [bar, stall]);

  // The bartender is 12 m away: out of a 10 m range. The stall's pin is right here (default 20 m).
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "bar", item: 0 });
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "stall", item: 0 });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1495);
  assert.ok(alertsOf("pcA").some(a => /too far from Lizzie's/.test(a.text)));

  // A wider range, then the bartender's token is deleted (no one can pay there any more).
  await game.settings.set("cpr-sam-agent", "payPoints", [{ ...bar, range: 15 }, stall]);
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "bar", item: 0 });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1475);
  scene.tokens.delete("tBar");
  from(alice, "paypoint-pay", { actorId: "pcA", pointId: "bar", item: 0 });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1475);
});

test("BangMe!: buying goods puts a copy of the Item in the character's gear", async () => {
  const template = { documentName: "Item", name: "Medscanner", toObject: () => ({ _id: "tpl", name: "Medscanner", type: "gear", folder: "f1", sort: 5, ownership: { default: 0 }, system: { price: { market: 100 } } }) };
  globalThis.fromUuid = async uuid => (uuid === "Item.tpl" ? template : null);
  const made = [];
  const actor = game.actors.get("pcA");
  let fail = false;
  actor.createEmbeddedDocuments = async (type, docs) => (fail ? Promise.reject(new Error("nope")) : (made.push(...docs), docs));
  const goods = [{ uuid: "Item.tpl", name: "Medscanner", img: "", amount: 100 }, { uuid: "Item.gone", name: "Ghost", img: "", amount: 50 }];
  await game.settings.set("cpr-sam-agent", "payPoints", [{ id: "doc", name: "Clinic", open: true, items: [], goods }]);
  const pay = good => from(alice, "paypoint-pay", { actorId: "pcA", pointId: "doc", good });
  const wait = async () => {
    await settle();
    await new Promise(r => setTimeout(r, 30));
  };

  pay(0);
  await wait();
  assert.equal(actor.system.wealth.value, 1400);
  assert.equal(made.length, 1);
  assert.deepEqual([made[0]._id, made[0].folder, made[0].sort, made[0].ownership], [undefined, undefined, undefined, undefined]);
  assert.equal(made[0].flags["cpr-sam-agent"].boughtAt, "Clinic");
  assert.deepEqual(Object.values(store.apps.ledger).map(e => [e.memo, e.amount, e.party]), [["Medscanner", -100, "Clinic"]]);

  // A deleted template isn't charged; a failed hand-over is refunded.
  pay(1);
  await wait();
  assert.equal(actor.system.wealth.value, 1400);
  assert.ok(alertsOf("pcA").some(a => /out of Ghost/.test(a.text)));
  fail = true;
  pay(0);
  await wait();
  assert.equal(actor.system.wealth.value, 1400);
  assert.ok(alertsOf("pcA").some(a => /refunded/.test(a.text)));
  delete globalThis.fromUuid;
});

test("Trauma Team: the GM's updates (API trauma.update), and the traumaChanged hook", async () => {
  const changes = () => hooks.filter(h => h.hook === "cpr-sam-agent.traumaChanged").map(h => h.args[0]);
  game.time.worldTime = 1000;
  from(alice, "tt-update", { actorId: "pcA", tier: "silver", status: "active" });
  await settle();
  assert.equal(store.apps.subs.pcA, undefined, "players can't");

  // Sponsored: never billed, nothing charged, an alert only when asked.
  from(gm, "tt-update", { actorId: "pcA", tier: "silver", status: "active", sponsor: "Arasaka", notify: "Courtesy of Arasaka." });
  await settle();
  let sub = store.apps.subs.pcA;
  assert.equal(sub.status, "active");
  assert.equal(sub.nextDue, null);
  assert.ok(sub.memberId);
  assert.equal(game.actors.get("pcA").system.wealth.value, 1500);
  assert.equal(alertsOf("pcA").at(-1).text, "Courtesy of Arasaka.");
  assert.deepEqual(changes().map(c => [c.actorId, c.status, c.plan?.id, c.sponsor, c.covered]), [["pcA", "active", "silver", "Arasaka", true]]);

  // The sponsor drops it: billed from a given day. Then lapsed, then ended (switches kept).
  from(gm, "tt-update", { actorId: "pcA", sponsor: null, nextDue: 5000, noAds: true });
  from(gm, "tt-update", { actorId: "pcA", status: "lapsed" });
  await settle();
  sub = store.apps.subs.pcA;
  assert.deepEqual([sub.sponsor, sub.nextDue, sub.status, sub.noAds], [null, 5000, "lapsed", true]);
  from(gm, "tt-update", { actorId: "pcA", status: "none" });
  from(gm, "tt-update", { actorId: "pcA", tier: "nope" });
  await settle();
  assert.deepEqual(store.apps.subs.pcA, { biolink: undefined, noAds: true, tier: null, status: "none" });
  assert.deepEqual(changes().slice(1).map(c => c.status), ["active", "lapsed", "none"]);
});

test("Trauma Team: another module takes over billing (API trauma.handOffBilling)", async () => {
  const { setTraumaBilledBy } = await import("../apps/trauma/model.js");
  setTraumaBilledBy("CPR HQ");
  try {
    from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver" });
    await settle();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(store.apps.subs.pcA.status, "active");
    assert.equal(store.apps.subs.pcA.nextDue, null);
    assert.equal(game.actors.get("pcA").system.wealth.value, 1500, "nothing charged on subscribing");
    game.time.worldTime = MONTH * 2;
    await store._tickTrauma();
    from(gm, "tt-bill");
    await settle();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(game.actors.get("pcA").system.wealth.value, 1500, "nor monthly");
  } finally {
    setTraumaBilledBy(null);
  }
  // Handed back: billed again from a period on.
  await store._tickTrauma();
  assert.equal(store.apps.subs.pcA.nextDue, MONTH * 3);
});

test("Trauma Team: subscribing pays the first month, and each month after on world time", async () => {
  from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  const sub = store.apps.subs.pcA;
  assert.equal(sub.status, "active");
  assert.equal(game.actors.get("pcA").system.wealth.value, 1000);

  game.time.worldTime = MONTH;
  await store._tickTrauma();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 500);
  game.time.worldTime = MONTH * 2;
  await store._tickTrauma();
  await new Promise(r => setTimeout(r, 20));
  game.time.worldTime = MONTH * 3;
  await store._tickTrauma();
  assert.equal(sub.status, "lapsed", "can't pay: lapsed");
  assert.deepEqual(alertsOf("pcA").at(-1).choices, ["Pay now", "Later"]);
});

test("Trauma Team: the GM gives a corporate plan; a linked Biomonitor calls on its own", async () => {
  from(alice, "tt-grant", { actorId: "pcA", tier: "executive", sponsor: "Arasaka" });
  from(gm, "tt-grant", { actorId: "pcA", tier: "executive", sponsor: "Arasaka" });
  await settle();
  assert.equal(store.apps.subs.pcA.sponsor, "Arasaka");
  game.time.worldTime = MONTH * 5;
  await store._tickTrauma();
  assert.equal(game.actors.get("pcA").system.wealth.value, 1500, "never billed");

  from(alice, "tt-settings", { actorId: "pcA", biolink: true });
  await settle();
  const actor = game.actors.get("pcA");
  actor.system.derivedStats.hp.value = 5; // below BODY 6
  store._onHealth(actor);
  const [dispatch] = Object.values(store.apps.dispatches);
  assert.equal(dispatch.auto, true);
  assert.equal(dispatch.covered, true);
  assert.equal(gmCards().at(-1).urgent, true, "the GM gets an urgent card");
  assert.match(alertsOf("pcA").at(-1).text, /TRAUMA TEAM NOTIFIED/);

  from(gm, "tt-dispatch", { dispatchId: dispatch.id, status: "enroute", eta: 3 });
  await settle();
  assert.ok(dispatch.eta > Date.now());
  assert.match(alertsOf("pcA").at(-1).text, /ETA 3 minutes/);
});

test("MedScan: bought once in the Trauma Team app; a paid wound consult is a situational +1 that ends on world time", async () => {
  const actor = game.actors.get("pcA");
  from(alice, "ms-consult", { actorId: "pcA", kind: "wound" });
  from(bob, "ms-buy", { actorId: "pcA" });
  await settle();
  assert.ok(!store.apps.medscan.pcA?.owned, "no consult without the app; bob can't buy it for alice");

  from(alice, "ms-buy", { actorId: "pcA" });
  await settle();
  assert.equal(store.apps.medscan.pcA.owned, true);
  assert.equal(actor.system.wealth.value, 1480, "20eb");
  from(alice, "ms-buy", { actorId: "pcA" });
  await settle();
  assert.equal(actor.system.wealth.value, 1480, "only once");

  game.time.worldTime = 1000;
  from(alice, "ms-consult", { actorId: "pcA", kind: "wound" });
  await settle();
  const consult = store.apps.medscan.pcA.consult;
  assert.equal(consult.status, "active");
  assert.equal(consult.until, 1000 + 3600, "an hour");
  assert.equal(actor.system.wealth.value, 1380, "100eb");
  const [effect] = actor.effects;
  assert.deepEqual(effect.changes.map(c => [c.key, c.value]), [["bonuses.firstAid", "1"], ["bonuses.paramedic", "1"]]);
  assert.deepEqual(effect.flags["cyberpunk-red-core"].changes.situational["0"], { isSituational: true, onByDefault: false });
  assert.equal(Object.values(effect.flags["cyberpunk-red-core"].changes.situational).length, 2);
  assert.equal(effect.flags["cpr-sam-agent"].medscan, consult.id);
  assert.deepEqual(Object.values(store.apps.ledger).filter(e => e.kind === "medscan").map(e => e.amount), [-20, -100]);

  from(alice, "ms-consult", { actorId: "pcA", kind: "surgery" });
  await settle();
  assert.equal(store.apps.medscan.pcA.consult.id, consult.id, "one consult at a time");

  game.time.worldTime = 1000 + 3600;
  await store._tickTrauma();
  assert.equal(store.apps.medscan.pcA.consult, null);
  assert.equal(actor.effects.size, 0, "the +1 comes off");
  assert.match(alertsOf("pcA").at(-1).text, /has ended/);
  assert.equal(store.apps.medscan.pcA.history[0].price, 100);
});

test("MedScan: Executive covers consults; the GM can answer calls, be unavailable, give and take the app", async () => {
  const actor = game.actors.get("pcA");
  assert.equal(traumaConfig().tiers.executive.medscan, true, "canon: Executive includes MedScan");
  assert.equal(traumaConfig().tiers.silver.medscan, false);
  from(gm, "ms-grant", { actorId: "pcA", owned: true });
  from(gm, "tt-grant", { actorId: "pcA", tier: "executive", sponsor: "Arasaka" });
  await settle();
  assert.equal(store.apps.medscan.pcA.source, "gm");

  await game.settings.set("cpr-sam-agent", "trauma", { medscan: { live: true } });
  from(alice, "ms-consult", { actorId: "pcA", kind: "surgery" });
  await settle();
  const consult = store.apps.medscan.pcA.consult;
  assert.equal(consult.status, "pending");
  assert.equal(gmCards().at(-1).id, `ms:${consult.id}`);
  from(alice, "ms-answer", { actorId: "pcA", consultId: consult.id, ok: true });
  await settle();
  assert.equal(consult.status, "pending", "players can't answer");
  from(gm, "ms-answer", { actorId: "pcA", consultId: consult.id, ok: true });
  await settle();
  assert.equal(consult.status, "active");
  assert.equal(consult.covered, "Executive");
  assert.equal(consult.until - consult.start, 4 * 3600, "four hours");
  assert.equal(actor.system.wealth.value, 1500, "covered: nothing charged");
  assert.deepEqual([...actor.effects][0].changes.map(c => c.key), ["bonuses.medicalTechSkill", "bonuses.surgerySkill"]);
  assert.deepEqual(Object.values([...actor.effects][0].flags["cyberpunk-red-core"].changes.cats), ["role", "role"]);
  assert.ok(Object.values([...actor.effects][0].flags["cyberpunk-red-core"].changes.situational).every(s => s.isSituational && !s.onByDefault), "a roll-dialog checkbox, off by default");

  from(alice, "ms-end", { actorId: "pcA" });
  await settle();
  assert.equal(actor.effects.size, 0);

  // Unavailable: told so, nothing charged. The GM declines a waiting call.
  await game.settings.set("cpr-sam-agent", "trauma", { medscan: { unavailable: true } });
  from(alice, "ms-consult", { actorId: "pcA", kind: "wound" });
  await settle();
  assert.equal(store.apps.medscan.pcA.consult, null);
  await game.settings.set("cpr-sam-agent", "trauma", { medscan: { live: true } });
  from(alice, "ms-consult", { actorId: "pcA", kind: "wound" });
  await settle();
  from(gm, "ms-answer", { actorId: "pcA", consultId: store.apps.medscan.pcA.consult.id, ok: false });
  await settle();
  assert.equal(store.apps.medscan.pcA.consult, null);
  assert.match(alertsOf("pcA").at(-1).text, /haven't been charged/);

  // No signal: no consult. Then the GM takes the app away.
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: 1 });
  from(alice, "ms-consult", { actorId: "pcA", kind: "wound" });
  await settle();
  assert.equal(store.apps.medscan.pcA.consult, null);
  from(gm, "ms-grant", { actorId: "pcA", owned: false });
  await settle();
  assert.equal(store.apps.medscan.pcA.owned, false);
});

test("MedScan: a plan's MedScan switch, and the GM's prices", async () => {
  const { cleanMedscan, consultPrice, consultLeft } = await import("../apps/trauma/model.js");
  assert.deepEqual(cleanMedscan({ price: -5, wound: "75", surgery: "x" }), { price: 20, wound: 75, surgery: 500, live: false, unavailable: false });
  await game.settings.set("cpr-sam-agent", "trauma", { tiers: { gold: { name: "Gold", price: 2000, medscan: true }, silver: { name: "Silver", price: 500 } }, medscan: { wound: 150 } });
  assert.deepEqual(consultPrice("wound", { tier: "gold", status: "active" }), { price: 0, covered: "Gold" });
  assert.deepEqual(consultPrice("wound", { tier: "gold", status: "lapsed" }), { price: 150, covered: null }, "a lapsed plan doesn't cover it");
  assert.deepEqual(consultPrice("surgery", { tier: "silver", status: "active" }), { price: 500, covered: null });
  assert.equal(consultLeft({ until: 3600 + 600 }, 0), "1 h 10 min");
  assert.equal(consultLeft({ until: 100 }, 200), "ending");
});

test("Ask Alex Anything: crawling until the GM answers, rolls, or says no results", async () => {
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  from(bob, "alex-ask", { actorId: "pcA", text: "not mine" });
  await settle();
  const [q] = Object.values(store.apps.queries);
  assert.equal(Object.keys(store.apps.queries).length, 1);
  assert.equal(q.status, "crawling");
  from(alice, "alex-answer", { queryId: q.id, text: "Rogue." });
  await settle();
  assert.equal(q.status, "crawling", "players can't answer");
  from(gm, "alex-need-roll", { queryId: q.id, dv: 15 });
  await settle();
  assert.deepEqual([q.status, q.dv], ["roll", 15]);
  from(gm, "alex-answer", { queryId: q.id, text: "Rogue Amendiares." });
  await settle();
  assert.equal(q.status, "answered");

  from(alice, "alex-ask", { actorId: "pcA", text: "Arasaka's secrets" });
  await settle();
  const q2 = Object.values(store.apps.queries).find(x => x.id !== q.id);
  from(gm, "alex-none", { queryId: q2.id });
  await settle();
  assert.equal(q2.status, "none");
});

test("Ask Alex Anything: questions wait for the GM (no instant answers)", async () => {
  game.journal = [{ name: "Afterlife", folder: { name: "Data Pool" }, pages: [{ type: "text", text: { content: "<p>A bar for mercs.</p>" } }] }];
  from(alice, "alex-ask", { actorId: "pcA", text: "best merc bar? afterlife" });
  await settle();
  const [q] = Object.values(store.apps.queries);
  assert.equal(q.status, "crawling");
});

test("Ask Alex AI: secrets dropped for players, marked for Claude (Data Pool and Locations); revealed ones are plain", () => {
  const html = "<p>Open late.</p><section class=\"secret\" id=\"secret-a\"><p>Rogue's files.</p></section><section class=\"secret revealed\"><p>Known now.</p></section>";
  assert.equal(pageText(html), "Open late.\nKnown now.");
  assert.match(pageText(html, "mark"), /\[GM SECRET\]\nRogue's files.\n\[\/GM SECRET\]/);
  const loc = name => ({ id: name, name, folder: { name: "Watson", folder: { name: "Locations" } }, pages: [{ type: "text", text: { content: html } }] });
  const entries = [
    { name: "Afterlife", folder: { name: "Data Pool" }, pages: [{ type: "text", text: { content: html } }] },
    loc("The Afterlife"), loc("Lizzie's Bar"), { name: "Elsewhere", folder: { name: "Notes" }, pages: [] }
  ];
  assert.deepEqual(dataPool(entries).map(e => e.name), ["Afterlife"]);
  assert.doesNotMatch(dataPool(entries)[0].text, /Rogue's files/);
  assert.match(dataPool(entries, { secrets: "mark" })[0].text, /\[GM SECRET\]\nRogue's files.\n\[\/GM SECRET\]/, "Claude gets them marked, like Locations");
  const locs = locations(entries);
  assert.deepEqual(locs.map(l => [l.name, l.area]), [["The Afterlife", "Watson"], ["Lizzie's Bar", "Watson"]]);
  assert.match(locs[0].text, /\[GM SECRET\]/);
  assert.deepEqual(namedLocations("Who runs afterlife? And lizzie's bar?", locs).map(l => l.name).sort(), ["Lizzie's Bar", "The Afterlife"]);
  assert.deepEqual(namedLocations("afterlifestyle tips", locs), [], "whole words only");
  assert.equal(findLocation("Afterlife", locs)?.name, "The Afterlife");
  assert.equal(findLocation("Lizzies", locs), null);
});

test("Ask Alex: the Data Pool's keywords list the entries a question mentions, for the GM to pick from", () => {
  const page = content => ({ type: "text", text: { content } });
  const entries = [
    { id: "a", name: "The Afterlife", folder: { name: "Data Pool" }, pages: [page("<p>Data Pool Keywords: merc bar, Rogue</p><p>A bar in Watson.</p><section class=\"secret\"><p>Rogue's files.</p></section>")] },
    { id: "b", name: "Rogue Amendiares", folder: { name: "NPCs" }, pages: [page("<p>Data Pool Keywords: rogue, fixer</p><p>Queen of fixers.</p>")] },
    { id: "c", name: "Lizzie's Bar", folder: { name: "Data Pool", folder: null }, pages: [page("<p>BDs.</p>")] },
    { id: "d", name: "Plot notes", folder: { name: "NPCs" }, pages: [page("<p>Keywords: rogue</p><p>Secret plans.</p>")] }
  ];
  const pool = dataPool(entries);
  assert.deepEqual(pool.map(e => e.id), ["a", "b", "c"], "the folder, or a Data Pool Keywords line anywhere (plain Keywords: no)");
  assert.deepEqual(pool[0].keywords, ["merc bar", "rogue"]);
  assert.equal(pool[0].text, "A bar in Watson.", "no keywords line, no secrets");
  assert.deepEqual(poolMatches("Who's the best fixer? Rogue?", pool).map(m => [m.id, m.hits]), [["b", ["rogue", "fixer"]], ["a", ["rogue"]]], "every match, most hits first");
  assert.deepEqual(poolMatches("a merc bar near afterlife", pool).map(m => m.id), ["a"]);
  assert.deepEqual(poolMatches("roguelike games", pool), [], "whole words only");
  assert.deepEqual(poolMatches("lizzie's bar", pool).map(m => m.id), ["c"], "the name counts");
});

test("Ask Alex AI: the request carries rules, canon, the index, direction and named locations", () => {
  const body = draftRequest({
    question: "Who runs the Afterlife?", asker: "V", roll: { total: 20, dv: 15, success: true },
    pool: [{ name: "NCPD", text: "Cops." }], locations: [{ name: "The Afterlife", area: "Watson", text: "A bar." }, { name: "Lizzie's Bar", area: "", text: "BDs." }],
    named: [{ name: "The Afterlife", area: "Watson", text: "A bar." }], direction: "Hint at Rogue.", standing: "Smug.", sentences: 2
  });
  assert.equal(body.model, "claude-haiku-4-5-20251001");
  assert.match(body.system[0].text, /2045/);
  assert.match(body.system[0].text, /at most 2 sentences/);
  assert.match(body.system[1].text, /## NCPD\nCops\./);
  assert.match(body.system[1].text, /- Lizzie's Bar/);
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" });
  const user = body.messages[0].content;
  for (const bit of [/rolled 20 vs DV 15: success \(beat it by 5\+\)/, /standing direction: Smug\./, /this question: Hint at Rogue\./, /## The Afterlife \(Watson\)\nA bar\./, /Question: Who runs the Afterlife\?/]) assert.match(user, bit);
  assert.deepEqual(body.tools.map(t => t.name), ["read_location", "answer"]);
  assert.deepEqual(body.tool_choice, { type: "any" });
  const web = draftRequest({ question: "x", asker: "V", webSearch: true, domains: ["cyberpunk.fandom.com"] });
  assert.deepEqual(web.tools[0], { type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: ["cyberpunk.fandom.com"] });
  assert.equal(web.tool_choice.type, "auto");
});

test("Ask Alex AI: lookups are answered from the Locations, then the answer comes back with its cost", async () => {
  const locs = [{ name: "Lizzie's Bar", area: "Watson", text: "BD bar. [GM SECRET]\nMox safehouse.\n[/GM SECRET]" }];
  const calls = [];
  const replies = [
    { stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 50 }, content: [{ type: "tool_use", id: "t1", name: "read_location", input: { name: "Lizzie's" } }] },
    { stop_reason: "tool_use", usage: { input_tokens: 1200, output_tokens: 100, cache_read_input_tokens: 2000 }, content: [{ type: "tool_use", id: "t2", name: "answer", input: { answer: "Lizzie's: Mox-run BD bar in Watson.", found: true, needs_roll: true, dv: 15, sources: ["Lizzie's Bar"], secrets_used: "Hinted the Mox protect it.", gm_note: "" } }] }
  ];
  const fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    assert.equal(init.headers["x-api-key"], "sk-test");
    assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
    return { ok: true, status: 200, json: async () => replies.shift() };
  };
  const body = draftRequest({ question: "Where's a BD bar?", asker: "V", locations: locs });
  const { result, cost, lookups } = await runDraft(body, { key: "sk-test", locations: locs, fetch });
  assert.deepEqual(lookups, ["Lizzie's Bar"]);
  const back = calls[1].messages.at(-1).content[0];
  assert.equal(back.tool_use_id, "t1");
  assert.match(back.content, /Mox safehouse/, "Claude gets the secrets, marked");
  assert.deepEqual(result, { answer: "Lizzie's: Mox-run BD bar in Watson.", found: true, needsRoll: true, dv: 15, sources: ["Lizzie's Bar"], secretsUsed: "Hinted the Mox protect it.", gmNote: "" });
  assert.ok(Math.abs(cost - (costOf(replies[0] ?? {}) + 2200e-6 + 150 * 5e-6 + 2000 * 0.1e-6)) < 1e-9);
});

test("Ask Alex AI: out of credit and a refused key come back in words", async () => {
  const fail = (status, message) => async () => ({ ok: false, status, json: async () => ({ type: "error", error: { type: "invalid_request_error", message } }) });
  const body = draftRequest({ question: "x", asker: "V" });
  await assert.rejects(runDraft(body, { key: "k", fetch: fail(400, "Your credit balance is too low to access the Anthropic API.") }), /Out of API credit/);
  await assert.rejects(runDraft(body, { key: "k", fetch: fail(401, "invalid x-api-key") }), /key was refused/);
});

test("WatchBox: assessing, armed, the GM's alarm, and disarming in person", async () => {
  const scene = addScene({ tokens: [{ id: "tA", actorId: "pcA", name: "V", x: 0, y: 0 }] });
  from(alice, "wb-arm", { actorId: "pcA" });
  await settle();
  const watch = store.apps.watch.pcA;
  assert.equal(watch.status, "assessing");
  assert.equal(watch.size, 1000, "20 m on a 2 m grid: 10 squares");
  assert.equal(scene.templates.size, 1, "the square is drawn for the GM");

  game.time.worldTime = 301;
  store._tickWatch();
  assert.equal(watch.status, "armed");

  from(alice, "wb-trigger", { actorId: "pcA" });
  await settle();
  assert.equal(watch.status, "armed", "only the GM sets it off");
  from(gm, "wb-trigger", { actorId: "pcA" });
  await settle();
  assert.equal(watch.status, "alarm");
  assert.ok(sent.some(s => s.payload.type === "world-sound" && s.payload.sound.muteFor.length === 0), "everyone near can hear it");

  scene.tokens.get("tA").x = 3000;
  from(alice, "wb-disarm", { actorId: "pcA" });
  await settle();
  assert.ok(store.apps.watch.pcA, "not from across town");
  scene.tokens.get("tA").x = 0;
  from(alice, "wb-disarm", { actorId: "pcA" });
  await settle();
  assert.equal(store.apps.watch.pcA, undefined);
  assert.equal(scene.templates.size, 0);
});

test("The Garden: one-tap accounts, posts that grow, sprouts that toggle", async () => {
  from(alice, "garden-post", { actorId: "pcA", text: "no account yet" });
  from(alice, "garden-join", { actorId: "pcA" });
  await settle();
  const me = Object.values(store.garden.accounts).find(a => a.actorId === "pcA");
  assert.equal(me.handle, "@v");
  assert.equal(Object.keys(store.garden.posts).length, 0, "posting needs an account");

  from(alice, "garden-post", { actorId: "pcA", text: "Hello @judy_nc" });
  await settle();
  const [post] = Object.values(store.garden.posts);
  assert.equal(post.likes, 0);
  from(alice, "garden-like", { actorId: "pcA", postId: post.id });
  await settle();
  assert.deepEqual([post.likes, post.likedBy], [1, [me.id]]);
  from(alice, "garden-like", { actorId: "pcA", postId: post.id });
  await settle();
  assert.equal(post.likes, 0, "a toggle");

  post.ts -= post.eng.peak * 3 * 60_000; // three times its halfway point
  post.eng.likes = 100;
  await store._tickGarden();
  assert.ok(post.likes >= 90, "most of its reach by now");
  assert.ok(growth(1) < growth(5) && growth(5) < growth(15) && growth(30) <= 1);
  assert.ok(growth(5, 10) < growth(5, 3), "a slow outcome grows slower");
  assert.ok(saved.garden.posts[post.id], "saved in its own file");
  assert.equal(receivedBy(alice).filter(p => p.type === "garden").at(-1).garden.queue.length, 0, "players never see the queue");
});

test("The Garden: the GM replies as any NPC or organization, never as a character", async () => {
  from(alice, "garden-join", { actorId: "pcA" });
  from(alice, "garden-post", { actorId: "pcA", text: "anyone up?" });
  await settle();
  const [post] = Object.values(store.garden.posts);
  const me = Object.values(store.garden.accounts).find(a => a.actorId === "pcA");
  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  from(gm, "garden-gm-reply", { accountId: n54.id, postId: post.id, text: `hey ${me.handle}` });
  from(gm, "garden-gm-reply", { accountId: me.id, postId: post.id, text: "not mine to say" });
  from(alice, "garden-gm-reply", { accountId: n54.id, postId: post.id, text: "players can't" });
  await settle();
  const ours = post.replies.filter(r => r.accountId === n54.id || r.accountId === me.id);
  assert.deepEqual(ours.map(r => r.text), [`hey ${me.handle}`]);
  // A reply on her post that also mentions her: one alert, the reply.
  const hers = Object.values(store.apps.alerts).filter(a => a.actorId === "pcA" && a.kind === "garden");
  assert.deepEqual(hers.map(a => a.text), [`@network54 replied to your post: "hey ${me.handle}"`], "the reply reaches the character, once");
});

test("The Garden: the GM deletes NPCs' replies, never a character's", async () => {
  from(alice, "garden-join", { actorId: "pcA" });
  from(alice, "garden-post", { actorId: "pcA", text: "hot take" });
  await settle();
  const [post] = Object.values(store.garden.posts);
  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  from(gm, "garden-gm-reply", { accountId: n54.id, postId: post.id, text: "no" });
  from(alice, "garden-reply", { actorId: "pcA", postId: post.id, text: "yes" });
  await settle();
  const npc = post.replies.find(r => r.text === "no"), pc = post.replies.find(r => r.text === "yes");
  from(alice, "garden-reply-delete", { postId: post.id, replyId: npc.id });
  from(gm, "garden-reply-delete", { postId: post.id, replyId: pc.id });
  await settle();
  assert.ok(post.replies.includes(npc) && post.replies.includes(pc), "players can't, and characters' replies stay");
  from(gm, "garden-reply-delete", { postId: post.id, replyId: npc.id });
  await settle();
  assert.ok(!post.replies.some(r => r.id === npc.id));
});

test("The Garden: citizens never repeat a reply already in the thread; a player's reply mentioning a character alerts them", async () => {
  const { replyLine } = await import("../apps/garden/model.js");
  const lists = { replyHater: ["no", "worse"], replyLurker: ["hm"] };
  assert.equal(replyLine("hater", () => 0, lists, ["no"]), "worse");
  assert.equal(replyLine("hater", () => 0, lists, ["no", "worse"]), null, "nothing new: no reply");
  assert.equal(replyLine("pr", () => 0, lists, []), "hm", "a mood without lines talks like a lurker");

  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  from(alice, "garden-join", { actorId: "pcA" });
  from(gm, "garden-account", { account: { handle: "@judy", name: "Judy", kind: "citizen", followers: 10 } });
  await settle();
  const judy = Object.values(store.garden.accounts).find(a => a.handle === "@judy");
  judy.actorId = "pcB";
  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  from(gm, "garden-gm-post", { accountId: n54.id, text: "Breaking" });
  await settle();
  const [post] = Object.values(store.garden.posts);
  from(alice, "garden-reply", { actorId: "pcA", postId: post.id, text: "ask @judy" });
  await settle();
  assert.ok(Object.values(store.apps.alerts).some(a => a.actorId === "pcB" && /mentioned you/.test(a.text)));

  // A busy thread: forty citizens' replies, none the same.
  from(gm, "garden-generate", { count: 10 });
  await settle();
  post.eng = { ...post.eng, replies: 40, peak: 1 };
  post.ts = Date.now() - 60_000;
  await store._tickGarden();
  const lines = post.replies.filter(r => r.auto).map(r => r.text);
  assert.ok(lines.length > 5);
  assert.equal(new Set(lines).size, lines.length, "no line twice");
});

test("The Garden: the GM's queue goes out on time; a Reputation event reaches the sheet", async () => {
  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  from(gm, "garden-drip", { lines: "First\n@ncpd_alerts | Second | | viral", accountId: n54.id, every: 1, jitter: 0 });
  await settle();
  assert.equal(store.garden.queue.length, 2);
  store.garden.queue[0].wt = Date.now() / 1000 - 1;
  await store._tickGarden();
  assert.deepEqual(Object.values(store.garden.posts).map(p => p.text), ["First"]);
  assert.equal(store.garden.queue[0].tier, "viral");

  const actor = game.actors.get("pcA");
  actor.system.reputation = { value: 2 };
  from(gm, "garden-gm-post", { accountId: n54.id, text: "V cleared Totentanz", rep: { actorId: "pcA", delta: 1, reason: "Totentanz" } });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(actor.system.reputation.value, 3);

  // One post about several characters: each sheet gets its own change; a character twice counts once.
  const judy = game.actors.get("pcB");
  judy.system.reputation = { value: 4 };
  from(gm, "garden-gm-post", { accountId: n54.id, text: "Totentanz, again", rep: [
    { actorId: "pcA", delta: 2, reason: "Totentanz" }, { actorId: "pcB", delta: -1, reason: "Totentanz" }, { actorId: "pcA", delta: 5 }, { actorId: "nobody", delta: 3 }
  ] });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual([actor.system.reputation.value, judy.system.reputation.value], [5, 3]);
  const post = Object.values(store.garden.posts).find(p => p.text === "Totentanz, again");
  assert.deepEqual(post.rep.map(r => r.actorId), ["pcA", "pcB"]);
});

test("The Garden Dating: the Algorithm finds whoever the GM picks, and a spark is a match", async () => {
  from(gm, "dating-profile", { profile: { handle: "@ana", name: "Ana", age: 28, prompts: [] } });
  from(alice, "dating-create", { actorId: "pcA", age: 25, prompts: [] });
  from(alice, "dating-algorithm", { actorId: "pcA" });
  await settle();
  const search = Object.values(store.garden.dating.sparks).find(s => s.status === "searching");
  assert.match(gmCards().at(-1).body, /activated the Algorithm/);
  const ana = Object.values(store.garden.dating.profiles).find(p => p.handle === "@ana");
  from(alice, "dating-suggest", { sparkId: search.id, profileId: ana.id });
  from(gm, "dating-suggest", { sparkId: search.id, profileId: ana.id });
  await settle();
  assert.equal(search.status, "suggested");
  assert.match(alertsOf("pcA").at(-1).text, /The Algorithm found someone: Ana/);
  from(alice, "dating-respond", { actorId: "pcA", sparkId: search.id, spark: true });
  await settle();
  assert.equal(search.status, "matched");

  const contacts = () => (game.actors.get("pcA").getFlag("cpr-sam-agent", "contacts") ?? []).map(c => c.name);
  assert.ok(contacts().includes("Ana"), "the match is one of their contacts");
  assert.equal(search.contact, "Ana");
  assert.ok([...store.threads.values()].some(t => t.actorId === "pcA" && t.contact === "Ana"), "with a conversation the GM can write in");
  assert.ok(store.npcNames().includes("Ana"), "and an NPC to act as");

  // The GM texts as the match like any contact.
  from(gm, "send", { actorId: "pcA", contact: "Ana", text: "drinks?" });
  await settle();
  assert.equal([...store.threads.values()].find(t => t.contact === "Ana").messages.at(-1).text, "drinks?");

  // Deleting the match: only by its player, and the contact goes too.
  from(bob, "dating-unmatch", { actorId: "pcA", sparkId: search.id });
  await settle();
  assert.ok(store.garden.dating.sparks[search.id]);
  from(alice, "dating-unmatch", { actorId: "pcA", sparkId: search.id });
  await settle();
  assert.equal(store.garden.dating.sparks[search.id], undefined);
  assert.ok(!contacts().includes("Ana"));

  // Editing the profile in place keeps it linked (or not) as it was.
  from(alice, "dating-create", { actorId: "pcA", age: 31, prompts: ["a", "b", "c"] });
  await settle();
  const mine = Object.values(store.garden.dating.profiles).find(p => p.actorId === "pcA");
  assert.deepEqual([mine.age, mine.prompts], [31, ["a", "b", "c"]]);
});

test("The Garden: word lists come from text files", async () => {
  const { gardenLists, parseMixes, randomCitizen, replyMix } = await import("../apps/garden/model.js");
  assert.ok(gardenLists().firstNames.length > 10);
  assert.ok(!gardenLists().firstNames.some(n => n.startsWith("#")), "notes are skipped");
  const c = randomCitizen();
  assert.match(c.handle, /^@\w+_\w+$/);
  assert.deepEqual(parseMixes(["corp: hater 4, hype 1", "default: hype 2"]), { corp: { hater: 4, hype: 1 }, default: { hype: 2 } });
  assert.equal(replyMix("corp").hater, 4);
  assert.equal(replyMix("citizen").hype, 4, "kinds without their own weights use default");
});

test("The Garden: @random queues post as a random citizen; outcomes come from the GM's settings", async () => {
  store._onGardenGenerate(gm, { count: 3 });
  await game.settings.set("cpr-sam-agent", "gardenConfig", { tiers: { meh: { name: "Meh", reach: 0.1, replies: [0, 0], peak: 2, weight: 1 } } });
  from(gm, "garden-drip", { lines: "@random | anyone hear that? | | meh", every: 1, jitter: 0 });
  await settle();
  assert.equal(store.garden.queue[0].accountId, "@random");
  assert.equal(store.garden.queue[0].tier, "meh");
  store.garden.queue[0].wt = 0;
  await store._tickGarden();
  const [post] = Object.values(store.garden.posts);
  assert.equal(store.garden.accounts[post.accountId].kind, "citizen");
  assert.equal(post.tier, "meh");
  assert.equal(post.eng.peak, 2);
});

test("The Garden: a queued text file posts as random citizens or new handles, and every queued field can be edited", async () => {
  const before = Object.keys(store.garden.accounts).length;
  from(gm, "garden-drip", {
    lines: "\uFEFFAnyone else hear that?\r\nFire in Watson | worlds/w/fire.webp\n\n@network54 | Breaking | https://x.io/a.png\n@new_kid | first post\n@not a handle, just text",
    accountId: "@random", every: 1, jitter: 0
  });
  await settle();
  const q = store.garden.queue;
  assert.equal(q.length, 5);
  assert.deepEqual(q.map(i => i.accountId === "@random"), [true, true, false, false, true]);
  assert.equal(q[1].image, "worlds/w/fire.webp");
  assert.equal(store.garden.accounts[q[2].accountId].handle, "@network54");
  const kid = store.garden.accounts[q[3].accountId];
  assert.deepEqual([kid.handle, kid.kind], ["@new_kid", "citizen"], "a new handle is a new citizen");
  assert.equal(Object.keys(store.garden.accounts).length, before + 1);
  assert.equal(q[4].text, "@not a handle, just text");
  assert.ok(q.every(i => i.tier === null), "outcomes random");

  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  const id = q[0].id;
  from(gm, "garden-queue", { op: "edit", id, item: { accountId: n54.id, text: "Edited", image: "worlds/w/b.webp", tier: "viral", minutes: 60, rep: { actorId: "pcA", delta: 2, reason: "Watson" } } });
  from(alice, "garden-queue", { op: "edit", id, item: { text: "Player edit" } });
  await settle();
  const edited = store.garden.queue.find(i => i.id === id);
  assert.equal(edited.text, "Edited", "players can't edit the queue");
  assert.deepEqual([edited.accountId, edited.image, edited.tier, edited.rep], [n54.id, "worlds/w/b.webp", "viral", [{ actorId: "pcA", delta: 2, reason: "Watson" }]], "a single event is kept as a list");
  assert.equal(store.garden.queue.at(-1).id, id, "an hour out: now last");

  // "No handle posts as" the composer's account instead: the same lines otherwise.
  from(gm, "garden-drip", { lines: "Mine | worlds/w/m.webp", accountId: n54.id, every: 1, jitter: 0 });
  await settle();
  const mine = store.garden.queue.find(i => i.text === "Mine");
  assert.deepEqual([mine.accountId, mine.image], [n54.id, "worlds/w/m.webp"]);

  // @random with no citizens yet: someone new posts it.
  store.garden.queue[0].wt = 0;
  await store._tickGarden();
  const [post] = Object.values(store.garden.posts);
  assert.equal(store.garden.accounts[post.accountId].kind, "citizen");
});

test("Ask Alex Anything and Trauma Team tell the player when something happens", async () => {
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  await settle();
  const [q] = Object.values(store.apps.queries);
  from(gm, "alex-answer", { queryId: q.id, text: "Rogue." });
  await settle();
  assert.equal(alertsOf("pcA").at(-1).kind, "alex");

  from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  from(gm, "tt-bill");
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(alertsOf("pcA").some(a => /Payment received/.test(a.text)), "billing now works at world time 0 too");

  game.combat = { id: "c1", started: true, round: 3 };
  game.combats = new Map([["c1", game.combat]]);
  store._onTraumaCall(alice, { actorId: "pcA" });
  const d = Object.values(store.apps.dispatches)[0];
  from(gm, "tt-dispatch", { dispatchId: d.id, status: "enroute", eta: 2, unit: "rounds" });
  await settle();
  assert.equal(d.etaRound, 5);
  assert.match(alertsOf("pcA").at(-1).text, /ETA 2 rounds/);
  delete game.combat;
});

test("Trauma Team: the panic button with no coverage pays for a plan first, then calls", async () => {
  game.actors.get("pcA").system.wealth.value = 100;
  from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver", call: true });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(Object.keys(store.apps.dispatches).length, 0, "payment declined: no call");
  assert.match(alertsOf("pcA").at(-1).text, /Payment declined/);

  game.actors.get("pcA").system.wealth.value = 1500;
  from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver", call: true });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  const [d] = Object.values(store.apps.dispatches);
  assert.equal(d?.status, "pending", "Dispatch has the call");
  assert.equal(d.covered, true, "as a paying member");
  assert.match(alertsOf("pcA").at(-1).text, /Dispatch has your call/);
});

test("Control → Clear app data: everyone's, or one character's", async () => {
  from(gm, "alert-send", { actorIds: ["pcA", "pcB"], text: "Heads up" });
  from(alice, "garden-join", { actorId: "pcA" });
  from(bob, "garden-join", { actorId: "pcB" });
  await settle();
  from(alice, "garden-post", { actorId: "pcA", text: "mine" });
  from(bob, "garden-post", { actorId: "pcB", text: "theirs" });
  await settle();

  from(alice, "app-clear", { target: "alerts" });
  await settle();
  assert.equal(Object.keys(store.apps.alerts).length, 2, "GM only");
  from(gm, "app-clear", { target: "alerts", actorId: "pcA" });
  await settle();
  assert.deepEqual(Object.values(store.apps.alerts).map(a => a.actorId), ["pcB"]);

  from(gm, "app-clear", { target: "gardenPosts", actorId: "pcB" });
  await settle();
  assert.deepEqual(Object.values(store.garden.posts).map(p => p.text), ["mine"]);
  from(gm, "app-clear", { target: "gardenPatch" });
  await settle();
  assert.equal(Object.values(store.garden.accounts).some(a => a.actorId), false);
  assert.equal(Object.keys(store.garden.posts).length, 0, "their posts go with them");
  assert.ok(Object.values(store.garden.accounts).some(a => a.handle === "@network54"), "NPC accounts stay");

  from(gm, "app-clear", { target: "gardenQueue", actorId: "pcA" });
  await settle(); // not per character: ignored
});

test("Trauma Team: the GM's own plans replace the defaults, each billed on its own schedule", async () => {
  await game.settings.set("cpr-sam-agent", "trauma", {
    tiers: { basic: { name: "Street Medic", price: 100, days: 7, note: "Stitches." }, gold: { name: "Gold", price: 800, days: 30, execRank: 4 } }
  });
  const { tiers } = traumaConfig();
  assert.deepEqual(Object.keys(tiers), ["basic", "gold"], "Silver and Executive are gone");
  assert.equal(tiers.basic.execRank, null);
  assert.match(planPrice(tiers.basic), /100.*\/wk$/);
  assert.equal(offeredTier(), "basic", "offers are for the cheapest");

  from(alice, "tt-subscribe", { actorId: "pcA", tier: "silver" });
  await settle();
  assert.equal(store.apps.subs.pcA, undefined, "a removed default can't be bought");
  from(alice, "tt-subscribe", { actorId: "pcA", tier: "basic" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1400);
  game.time.worldTime = 7 * 86400;
  await store._tickTrauma();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1300, "a week later");
  assert.match(alertsOf("pcA").at(-1).text, /Next payment in 7 days/);

  const exec = rank => ({ items: [{ type: "role", name: "Exec", system: { rank } }] });
  assert.equal(execTier(exec(3)), null);
  assert.equal(execTier(exec(5)), "gold", "the GM's Exec rank");

  // The GM removes the plan: its subscriber is told, and has no coverage.
  await game.settings.set("cpr-sam-agent", "trauma", { tiers: { gold: tiers.gold } });
  await store._tickTrauma();
  assert.equal(store.apps.subs.pcA.status, "none");
  assert.match(alertsOf("pcA").at(-1).text, /discontinued/);
  game.time.worldTime = 14 * 86400;
  await store._tickTrauma();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcA").system.wealth.value, 1300, "never billed again");
});

test("Ask Alex AI: the GM's own base instructions, and the asker's Agent voicing the answer", () => {
  const own = draftRequest({ question: "x", asker: "V", rules: "Be terse. At most {sentences} sentences.", sentences: 1 });
  assert.equal(own.system[0].text, "Be terse. At most 1 sentences.");
  assert.match(draftRequest({ question: "x", asker: "V", rules: "  " }).system[0].text, /THE YEAR IS 2045/, "blank: the default");
  const voiced = draftRequest({ question: "x", asker: "V", agent: { name: "Delamain", voice: "Polished, formal, gently upsells." } });
  assert.match(voiced.messages[0].content, /through their Agent, "Delamain".*style description only.*"Polished, formal, gently upsells\."/s);
  assert.doesNotMatch(draftRequest({ question: "x", asker: "V", agent: { name: "A", voice: "" } }).messages[0].content, /their Agent/);
});

test("Ask Alex Anything: a sheet roll from the player's client counts only with their fresh roll card", async () => {
  from(alice, "alex-ask", { actorId: "pcA", text: "Who runs the Afterlife?" });
  await settle();
  const [q] = Object.values(store.apps.queries);
  from(gm, "alex-need-roll", { queryId: q.id, dv: 15 });
  await settle();
  game.messages = new Map([
    ["old", { id: "old", author: alice, timestamp: Date.now() - 600_000 }],
    ["bobs", { id: "bobs", author: bob, timestamp: Date.now() }],
    ["card", { id: "card", author: alice, timestamp: Date.now() }]
  ]);
  from(alice, "alex-roll", { queryId: q.id, total: 30, detail: "x", messageId: "old" });
  from(alice, "alex-roll", { queryId: q.id, total: 30, detail: "x", messageId: "bobs" });
  await settle();
  assert.equal(q.roll, undefined, "stale or someone else's card");
  from(alice, "alex-roll", { queryId: q.id, total: 17, detail: "7 + 6 INT + 2 skill + 2 mods", messageId: "card" });
  await settle();
  assert.deepEqual(q.roll, { total: 17, detail: "7 + 6 INT + 2 skill + 2 mods", success: true });
});

test("Notes: plain text to page HTML and back; formatting is noticed; the entry belongs to the character's players", async () => {
  const { hasFormatting, htmlToText, notesEntry, notesEntryData, textToHtml } = await import("../apps/notes/model.js");
  const text = "Meet Rogue <8pm> & bring eb\n\nAfterlife";
  const html = textToHtml(text);
  assert.equal(html, "<p>Meet Rogue &lt;8pm&gt; &amp; bring eb</p><p></p><p>Afterlife</p>");
  assert.equal(htmlToText(html), text);
  assert.equal(hasFormatting(html), false);
  assert.equal(hasFormatting("<p><strong>Bold</strong></p>"), true);
  globalThis.CONST ??= {};
  CONST.DOCUMENT_OWNERSHIP_LEVELS ??= { NONE: 0, OWNER: 3 };
  const actor = game.actors.get("pcA");
  const data = notesEntryData(actor, "fold", [gm, alice, bob]);
  assert.equal(data.name, `${actor.name} Agent Notes`);
  assert.deepEqual(data.ownership, { default: 0, alice: 3 });
  assert.equal(data.flags["cpr-sam-agent"].notesFor, "pcA");
  assert.equal(notesEntry("pcA", [{ getFlag: (m, k) => (k === "notesFor" ? "pcA" : null) }]) !== null, true);
});

test("Calendar: a month's grid, stepping months, and note times", async () => {
  const { dayKey, monthGrid, noteTime, stepMonth } = await import("../apps/calendar/model.js");
  const weeks = monthGrid({ days: 28, firstWeekday: 1, weekLength: 7, date: { year: 2045, month: 1 }, today: "2045-1-2", selected: "2045-1-0", marks: { "2045-1-2": { note: true } } });
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0], null, "February 2045 starts on the second weekday");
  assert.deepEqual([weeks[0][1].day, weeks[0][1].selected], [1, true]);
  assert.deepEqual([weeks[0][3].day, weeks[0][3].today, weeks[0][3].note], [3, true, true]);
  assert.equal(weeks.at(-1).filter(Boolean).at(-1).day, 28);
  assert.deepEqual(stepMonth({ year: 2045, month: 0 }, -1, 12), { year: 2044, month: 11 });
  assert.deepEqual(stepMonth({ year: 2045, month: 11 }, 1, 12), { year: 2046, month: 0 });
  assert.equal(dayKey({ year: 2045, month: 1, day: 3 }), "2045-1-3");
  const at = (h, m) => ({ year: 1, month: 0, day: 0, hour: h, minute: m });
  assert.equal(noteTime({ allDay: true }), "All day");
  assert.equal(noteTime({ startDate: at(13, 30), endDate: at(14, 0) }), "13:30–14:00");
  assert.equal(noteTime({ startDate: at(9, 5), endDate: at(9, 5) }), "09:05");
});

test("Flappy Chrome: hover until the first flap, fall, score through stacks, crash, and the board keeps each character's best", async () => {
  const { addScore, advance, FIELD, gapAt, newGame, PHYSICS, randomEntries, step, STEP, topScores } = await import("../apps/pigeon/model.js");
  // The same second of flight at 30 and at 144 frames per second.
  const slow = newGame(() => 0.5);
  const fast = newGame(() => 0.5);
  advance(slow, 1 / 30, true);
  advance(fast, 1 / 144, true);
  for (let i = 1; i < 30; i++) advance(slow, 1 / 30);
  for (let i = 1; i < 144; i++) advance(fast, 1 / 144);
  assert.ok(Math.abs(slow.y - fast.y) < 3, `${slow.y} vs ${fast.y}`);
  // A second is a second at any refresh rate (a 240 Hz screen once ran the game at double speed),
  // and a flap on a frame too short for a step still lands.
  for (const hz of [60, 144, 165, 240, 360]) {
    const run = newGame(() => 0.5);
    advance(run, 1 / hz, true);
    assert.equal(run.started, hz <= 120 ? true : false, `${hz} Hz: the flap waits for a step`);
    for (let i = 1; i < hz; i++) advance(run, 1 / hz);
    assert.ok(run.started, `${hz} Hz flapped`);
    assert.ok(Math.abs(run.t - 1) <= STEP, `${hz} Hz: ${run.t} s of game in 1 s`);
  }
  const g = newGame(() => 0.5);
  step(g, 0.5);
  assert.equal(g.started, false);
  assert.ok(Math.abs(g.y - FIELD.h * 0.15) <= 6, "hovers");
  step(g, 0.016, true);
  assert.equal(g.vy, PHYSICS.flap + PHYSICS.gravity * 0.016);
  // Keep the pigeon in the middle of each opening: it should score and never crash.
  for (let i = 0; i < 60 * 12 && !g.over; i++) {
    const next = g.stacks.find(s => s.x + PHYSICS.stackWidth > PHYSICS.bird.x - PHYSICS.bird.r);
    g.bullets = [];
    g.y = next ? next.top + next.gap / 2 : FIELD.h / 2;
    g.vy = 0;
    step(g, 1 / 60);
  }
  assert.equal(g.over, false);
  assert.ok(g.score >= 5, `scored ${g.score}`);
  // Let go: it falls to the street.
  for (let i = 0; i < 600 && !g.over; i++) step(g, 1 / 60);
  assert.ok(g.over);
  assert.ok(gapAt(0) > gapAt(40) && gapAt(400) === PHYSICS.minGap);

  let board = addScore([], { id: "a", actorId: "pcA", name: "V", score: 12, ts: 1 });
  board = addScore(board, { id: "b", actorId: "pcA", name: "V", score: 8, ts: 2 });
  assert.deepEqual(board.map(s => s.id), ["a"], "a worse run doesn't replace the best");
  board = addScore(board, { id: "c", actorId: "pcA", name: "V", score: 20, ts: 3 });
  board = addScore(board, { id: "d", name: "n3onRat", score: 15, ts: 4, fake: true });
  assert.deepEqual(topScores(board).map(s => [s.rank, s.name, s.score]), [[1, "V", 20], [2, "n3onRat", 15]]);
  const fakes = randomEntries(5, () => 0.3, ["RAT"]);
  assert.equal(fakes.length, 5);
  assert.ok(fakes.every(f => f.name !== "RAT" && /^[A-Z0-9]{3}$/.test(f.name) && f.score >= 3 && f.score <= 58));
});

test("Flappy Chrome gets harder: speed eases to a cap, openings vary more, Maelstrom's patterns, and wider stacks while they're on", async () => {
  const { FIELD, GAP, gapAt, gapSpread, gunEvery, newGame, PATTERNS, patternsFor, PHYSICS, speedAt, step } = await import("../apps/pigeon/model.js");
  assert.equal(speedAt(0), PHYSICS.speed);
  assert.ok(speedAt(20) > speedAt(10) && speedAt(45) < PHYSICS.maxSpeed && speedAt(999) > PHYSICS.maxSpeed - 0.5 && speedAt(999) <= PHYSICS.maxSpeed);
  assert.deepEqual([gapSpread(0), gapSpread(60), gapSpread(500)], [8, 32, 32]);
  assert.deepEqual([gunEvery(0), gunEvery(999, 5)], [PHYSICS.gunEvery, PHYSICS.gunFastest]);
  assert.deepEqual(patternsFor(4, 5), [], "no gunfire before gunFrom, whatever the Heat");
  assert.deepEqual(patternsFor(5), ["tracer"]);
  assert.deepEqual(patternsFor(5, 5), Object.keys(PATTERNS), "Heat 5 brings every pattern from the first shot");
  assert.deepEqual(patternsFor(50, 1), ["tracer", "burst", "aimed", "sweep", "wall"]);

  // A long run held in each opening (bullets cleared): openings stay in bounds, vary, never tight twice
  // running, and never so far up from the last that the pigeon couldn't climb to it.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = newGame(rand, FIELD, 5);
  step(g, 0.01, true);
  const made = [];
  const known = new WeakSet();
  for (let i = 0; i < 120 * 200 && !g.over; i++) {
    for (const s of g.stacks) if (!known.has(s)) known.add(s) && made.push({ ...s, speed: g.speed });
    const next = g.stacks.find(s => s.x + PHYSICS.stackWidth > PHYSICS.bird.x - PHYSICS.bird.r);
    g.bullets = [];
    g.y = next ? next.top + next.gap / 2 : FIELD.h / 2;
    g.vy = 0;
    step(g, 1 / 120);
  }
  assert.equal(g.over, false);
  assert.ok(g.score > 80, `scored ${g.score}`);
  const plain = made.filter(s => !s.relief);
  assert.ok(made.some(s => s.relief) && plain.length > 20);
  assert.ok(plain.every(s => s.gap >= GAP.low && s.gap <= GAP.high), "plain openings in bounds");
  assert.ok(made.every(s => s.top >= 40 && s.top + s.gap <= FIELD.ground - 40));
  assert.ok(new Set(plain.map(s => s.gap)).size > 8, "openings vary");
  for (let i = 1; i < made.length; i++) {
    const [a, b] = [made[i - 1], made[i]];
    assert.ok(b.top + b.gap / 2 >= a.top + a.gap / 2 - PHYSICS.climb * (PHYSICS.spacing / b.speed) - 0.01, "the pigeon can climb to the next opening");
  }
  assert.ok(g.speed > 160 && g.speed < PHYSICS.maxSpeed);

  // A pattern: a warning, then its shots; new stacks open wider while it's on; a breather after.
  const p = newGame(() => 0.99, FIELD, 0);
  step(p, 0.01, true);
  Object.assign(p, { score: 15, nextGun: 0, y: 200, vy: 0 });
  step(p, 0.01);
  assert.equal(p.pattern?.kind, "burst");
  assert.equal(p.bullets.length, 0, "warned first");
  p.nextStack = 0;
  p.y = 200;
  step(p, 0.01);
  const wide = p.stacks.at(-1);
  assert.ok(wide.relief && wide.gap === Math.min(GAP.high, gapAt(15) + Math.round(-gapSpread(15) + 0.99 * 2 * gapSpread(15))) + PATTERNS.burst.relief);
  for (let i = 0; i < 400 && p.pattern; i++) {
    Object.assign(p, { y: 200, vy: 0, stacks: [] });
    step(p, 1 / 120);
  }
  assert.equal(p.over, false);
  assert.equal(p.pattern, null, "over once its bullets have gone");
  assert.ok(p.nextGun >= PHYSICS.cooldown);

  // The stacks already ahead open too (over the warning), so the one the pigeon's in when the burst
  // reaches it is wide; the burst's shots come 0.3 s apart, at 85% pace.
  const o = newGame(() => 0.99, FIELD, 0);
  step(o, 0.01, true);
  o.stacks = [{ x: 60, top: 150, gap: 100, passed: false }, { x: 160, top: 150, gap: 100, passed: false }, { x: 270, top: 150, gap: 100, passed: false }];
  o.stacks[0].passed = true;
  Object.assign(o, { score: 15, nextGun: 0, y: 200, vy: 0 });
  step(o, 0.01);
  assert.equal(o.pattern?.kind, "burst");
  assert.deepEqual(o.pattern.shots.map(s => +(s.at - PHYSICS.warn).toFixed(2)), [0, 0.3, 0.6]);
  assert.deepEqual(o.stacks.map(s => !!s.relief), [false, true, true], "not the one already passed");
  let inStack = null;
  for (let i = 0; i < 400 && !inStack; i++) {
    Object.assign(o, { y: 200, vy: 0, over: false });
    step(o, 1 / 120);
    if (o.bullets.some(b => b.x <= PHYSICS.bird.x + 20)) inStack = o.stacks.find(s => s.x < PHYSICS.bird.x + 60 && s.x + PHYSICS.stackWidth > PHYSICS.bird.x - 60);
  }
  assert.ok(inStack?.relief && inStack.gap === 100 + PATTERNS.burst.relief && inStack.top === 150 - PATTERNS.burst.relief / 2, "fully open when the shots arrive");
  const shot = { x: 100, y: 50, v: PHYSICS.bulletSpeed, p: null };
  const t = newGame(() => 0.5, FIELD, 0);
  step(t, 0.01, true);
  Object.assign(t, { bullets: [shot], nextGun: 99 });
  step(t, 0.01);
  assert.ok(Math.abs(100 - shot.x - (t.speed + PHYSICS.bulletSpeed) * 0.85 * 0.01) < 1e-9, "lasers at 85% pace");

  // A tracer warns too: a chevron where it will come, then the shot.
  const tr = newGame(() => 0.1, FIELD, 0);
  step(tr, 0.01, true);
  Object.assign(tr, { score: 5, nextGun: 0, y: 200, vy: 0 });
  step(tr, 0.01);
  assert.equal(tr.pattern?.kind, "tracer");
  assert.equal(tr.bullets.length, 0, "warned first");
  assert.ok(tr.pattern.shots[0].y !== undefined && tr.pattern.shots[0].at === PHYSICS.warn);

  // A wall: a column of shots with one opening, in the gap the pigeon will be in when it arrives.
  const w = newGame(() => 0.5, FIELD, 0);
  step(w, 0.01, true);
  w.stacks = [{ x: 140, top: 100, gap: 100, passed: false }];
  w.pattern = { id: 1, kind: "wall", t: 0, every: 3, relief: 32, shots: [{ at: PHYSICS.warn, wall: true }], aimY: 0 };
  for (let i = 0; i < 100 && !w.bullets.length; i++) {
    Object.assign(w, { y: 150, vy: 0 });
    step(w, 1 / 120);
  }
  const ys = w.bullets.map(b => b.y);
  assert.ok(ys.length >= 10 && ys.every(y => Math.abs(y - 150) >= 48));
  assert.ok(ys.some(y => y < 102) && ys.some(y => y > 198), "the rest of the sky is shut");
});

test("Flappy Chrome: Maelstrom Heat rises with good runs, carries over, and the GM cools it down", async () => {
  const { heatFor, heatOf, newGame, raiseHeat, setHeat } = await import("../apps/pigeon/model.js");
  assert.deepEqual([0, 9, 10, 24, 25, 79, 80, 999].map(heatFor), [0, 0, 1, 1, 2, 4, 5, 5]);
  assert.equal(raiseHeat({ pcA: { heat: 2 } }, "pcA", 30), null, "no higher: no change");
  assert.deepEqual(raiseHeat({}, "pcA", 41, 5), { pcA: { heat: 3, ts: 5 } });
  assert.deepEqual(setHeat({ pcA: { heat: 1 } }, "pcA", 0), {});
  assert.equal(heatOf({ pcA: { heat: 9 } }, "pcA"), 5);
  assert.equal(newGame(Math.random, undefined, 3).heat, 3);

  from(alice, "pigeon-score", { actorId: "pcA", score: 27, initials: "VVV" });
  await settle();
  assert.equal(heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcA"), 2);
  from(alice, "pigeon-score", { actorId: "pcA", score: 12, initials: "VVV" });
  from(alice, "pigeon-score", { actorId: "pcB", score: 90 });
  await settle();
  assert.deepEqual(Object.keys(game.settings.get("cpr-sam-agent", "pigeonHeat")), ["pcA"], "a worse run keeps it; not your character, nothing");
  assert.equal(heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcA"), 2);
  from(alice, "pigeon-heat", { actorId: "pcA", by: -1 });
  await settle();
  assert.equal(heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcA"), 2, "only the GM");
  from(gm, "pigeon-heat", { actorId: "pcA", by: -1 });
  from(gm, "pigeon-heat", { actorId: "pcB", by: 1 });
  await settle();
  assert.deepEqual([heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcA"), heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcB")], [1, 1]);
  from(gm, "pigeon-reset", {});
  await settle();
  assert.equal(heatOf(game.settings.get("cpr-sam-agent", "pigeonHeat"), "pcA"), 1, "clearing the board alone keeps Heat");
  from(gm, "pigeon-heat", {});
  await settle();
  assert.deepEqual(game.settings.get("cpr-sam-agent", "pigeonHeat"), {});
  from(gm, "pigeon-heat", { actorId: "pcA", by: 1 });
  from(gm, "pigeon-reset", { heat: true });
  await settle();
  assert.deepEqual([game.settings.get("cpr-sam-agent", "pigeonHeat"), game.settings.get("cpr-sam-agent", "pigeonBoard").scores], [{}, []]);
});

test("Flappy Chrome: a score that makes the board asks for initials, arcade style", async () => {
  const { boardRank, cycleInitial, defaultInitials, validInitials } = await import("../apps/pigeon/model.js");
  const board = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: "AAA", score: 50 - i * 4, ts: i, fake: true }));
  assert.equal(boardRank(board, "pcA", 40, 99), 4, "a tie ranks after the earlier score");
  assert.equal(boardRank(board, "pcA", 5, 99), 0, "off the board: no initials");
  const mine = [...board, { id: "m", actorId: "pcA", name: "CSO", score: 45, ts: 3 }];
  assert.equal(boardRank(mine, "pcA", 30, 99), 0, "not a new best");
  assert.equal(boardRank(mine, "pcA", 60, 99), 1);
  assert.equal(defaultInitials("Claude Solo"), "CSO");
  assert.equal(defaultInitials("Morgan"), "MOR");
  assert.equal(defaultInitials("Johnny 'Silverhand' Mk 2"), "JSM");
  assert.equal(defaultInitials("Ox"), "OXA");
  assert.equal(defaultInitials(""), "AAA");
  assert.deepEqual([cycleInitial("A", -1), cycleInitial("9", 1), cycleInitial("Z", 1)], ["9", "A", "0"]);
  assert.ok(validInitials("V2X") && !validInitials("ab") && !validInitials("ABCD") && !validInitials("A B"));
});

test("Combat Cabb: the Lifestyle's free ride (periods, zones, used)", async () => {
  const { creditFor, creditPeriod } = await import("../apps/cabb/model.js");
  const day = 86400;
  assert.equal(creditPeriod("day", 10 * day + 5), "day:10");
  assert.equal(creditPeriod("week", 13 * day), "week:1");
  assert.equal(creditPeriod("month", 61 * day), "month:2", "30-day months without Simple Calendar");
  assert.equal(creditPeriod("month", 61 * day, "2045-3"), "month:2045-3");
  const kibble = { name: "Kibble", per: "month", anywhere: false };
  const safe = { id: "a", zone: null };
  const hot = { id: "b", zone: "hot" };
  assert.equal(creditFor(null, safe, safe, "month:1"), null, "no perk: no credit");
  assert.deepEqual(creditFor(kibble, safe, safe, "month:1"), { lifestyle: "Kibble", per: "month", key: "month:1", ok: true, why: null });
  assert.equal(creditFor(kibble, safe, hot, "month:1").why, "zone", "safe zones only, either end");
  assert.equal(creditFor(kibble, hot, safe, "month:1").why, "zone");
  assert.equal(creditFor(kibble, safe, safe, "month:1", { key: "month:1" }).why, "used");
  assert.ok(creditFor(kibble, safe, safe, "month:2", { key: "month:1" }).ok, "a new period, a new ride");
  assert.ok(creditFor({ name: "Fresh Food", per: "day", anywhere: true }, hot, hot, "day:3").ok, "Fresh Food: anywhere");
});

test("Combat Cabb: places, distance and fares", async () => {
  const { cabbPlaces, CABB_DEFAULTS, DISTRICTS, partyPickup, pickupMs, quote, tripMs, unitKm } = await import("../apps/cabb/model.js");
  const a = { id: "a", x: 0, y: 0 };
  const b = { id: "b", x: 3, y: 4 };
  const q = quote(a, b, CABB_DEFAULTS, 7);
  assert.ok(q.mi >= 3.4 && q.mi <= 4.4, `5 km straight, plus the streets, in miles: ${q.mi}`);
  assert.equal(q.fare, Math.round(20 + 16 * q.mi), "flag fall + per mile");
  assert.equal(q.road, false);
  assert.deepEqual(quote(a, b, CABB_DEFAULTS, 7), q, "the same trip, the same day: the same quote");
  const hot = quote(a, { ...b, zone: "hot" }, CABB_DEFAULTS, 7);
  assert.equal(hot.fare, Math.round(20 + 16 * hot.mi) * 2);
  // By road (the NAV map's traced roads): its miles, as they are.
  const byRoad = quote(a, b, { ...CABB_DEFAULTS, perMile: 10 }, 7, 7.25);
  assert.deepEqual([byRoad.mi, byRoad.fare, byRoad.road], [7.3, 93, true]);
  assert.equal(hot.zone, "hot");
  assert.equal(quote({ ...a, zone: "combat" }, b, CABB_DEFAULTS, 7).zone, null, "out of a zone: the normal rate");
  assert.equal(quote({ ...a, zone: "combat" }, b, { ...CABB_DEFAULTS, zonePickup: true }, 7).zone, "combat");
  assert.equal(pickupMs({ etaMin: 10, etaMax: 20 }, () => 0.5), 15000);
  assert.equal(pickupMs({ etaMin: 0, etaMax: 0 }), 0);
  assert.equal(tripMs(10, { secPerKm: 20, tripMin: 15, tripMax: 120 }), 120000);
  assert.equal(tripMs(0.5, { secPerKm: 20, tripMin: 15, tripMax: 120 }), 15000);
  assert.equal(unitKm("m"), 0.001);
  assert.equal(unitKm("mi"), 1.609344);

  // No NAV scene: the city list; the GM's party place.
  const cfg = { ...CABB_DEFAULTS, zones: {} };
  const places = cabbPlaces(cfg, null);
  assert.equal(places.length, DISTRICTS.length);
  // Night City's 25 districts (the Map's), the zones marked.
  assert.equal(DISTRICTS.length, 25);
  assert.equal(new Set(DISTRICTS.map(d => d.id)).size, 25, "ids are unique");
  assert.deepEqual(places.filter(p => p.zone).map(p => [p.name, p.zone]).sort(), [["Old Combat Zone", "combat"], ["Pacifica Playground", "combat"], ["South Night City", "combat"], ["The Hot Zone", "hot"]]);
  assert.equal(partyPickup(cfg, null, places), null, "the GM hasn't said: players pick");
  assert.equal(partyPickup({ ...cfg, partyAt: "d:the-glen" }, null, places).name, "The Glen");
  // The Glen → Santo Domingo, straight + streets: about the 7 mi the NAV map's roads give.
  const glen = places.find(p => p.id === "d:the-glen");
  const santo = places.find(p => p.id === "d:santo-domingo");
  const trip = quote(glen, santo, CABB_DEFAULTS, 7);
  assert.ok(trip.mi > 3.5 && trip.mi < 7.5, `The Glen → Santo Domingo: ${trip.mi} mi`);

  // The Map's pins (apps/map): in km (here 100 Map px = 1 km), each with its zone; the GM's list has those
  // some player sees, a player's those everyone sees or that list their character.
  const pin = (id, name, x, y, extra = {}) => ({ id, name, x, y, everyone: true, actorIds: [], zone: null, ...extra });
  const map = {
    k: 0.01,
    rows: {
      n1: pin("n1", "Afterlife", 100, 100),
      n2: pin("n2", "Arasaka Tower", 600, 900, { zone: "hot" }),
      n3: pin("n3", "Secret lab", 300, 300, { everyone: false }),
      n4: pin("n4", "Lizzie's", 400, 300, { everyone: false, actorIds: ["pcA"] })
    }
  };
  const pins = cabbPlaces(cfg, map, gm);
  assert.deepEqual(pins.map(p => [p.id, p.name, p.x, p.y, p.zone]), [["note:n1", "Afterlife", 1, 1, null], ["note:n2", "Arasaka Tower", 6, 9, "hot"], ["note:n4", "Lizzie's", 4, 3, null]], "the GM's list: what some player sees");
  assert.deepEqual(cabbPlaces(cfg, map, alice).map(p => p.name), ["Afterlife", "Arasaka Tower", "Lizzie's"], "V's player sees the pin listing V");
  assert.deepEqual(cabbPlaces(cfg, map, bob).map(p => p.name), ["Afterlife", "Arasaka Tower"]);
  assert.equal(partyPickup(cfg, map, pins), null, "the GM hasn't said: players pick");

  // The crew's GPS spot on the Map is the pickup: at its pin when snapped to one the player sees, else near the closest.
  const atPin = partyPickup({ ...cfg, crew: { x: 600, y: 900, noteId: "n2" } }, map, cabbPlaces(cfg, map, bob));
  assert.deepEqual([atPin.name, atPin.x, atPin.y, atPin.crew], ["Arasaka Tower", 6, 9, true]);
  const loose = partyPickup({ ...cfg, crew: { x: 390, y: 310, noteId: null } }, map, cabbPlaces(cfg, map, alice));
  assert.equal(loose.name, "near Lizzie's");
  const hiddenPin = partyPickup({ ...cfg, crew: { x: 300, y: 300, noteId: "n3" } }, map, cabbPlaces(cfg, map, bob));
  assert.equal(hiddenPin.name, "near Afterlife", "a pin the player doesn't see isn't named to them");
  assert.equal(partyPickup({ ...cfg, crew: { sceneId: "nav", x: 1, y: 1 } }, map, pins), null, "a spot still on a scene (not moved yet) doesn't count");
  assert.equal(partyPickup({ ...cfg, crew: { x: 1, y: 1 } }, null, places), null, "No map: no crew spot");
});

test("Combat Cabb: book, picked up (charged), waits for the GM, arrived; cancelling; declined", async () => {
  await game.settings.set("cpr-sam-agent", "cabb", { etaMin: 0, etaMax: 0, tripMin: 0, tripMax: 0, secPerKm: 0 });
  from(alice, "cabb-book", { actorId: "pcA", from: "d:the-glen", to: "d:little-china" });
  from(bob, "cabb-book", { actorId: "pcA", from: "d:the-glen", to: "d:little-china" });
  await settle();
  const rides = Object.values(store.apps.rides);
  assert.equal(rides.length, 1, "only the character's player books for them");
  const ride = rides[0];
  assert.equal(ride.status, "enroute");
  assert.match(alertsOf("pcA").at(-1).text, /on its way to The Glen/);
  assert.match(gmCards().at(-1).body, /V booked a cab: The Glen → Little China/);
  from(alice, "cabb-book", { actorId: "pcA", from: "d:the-glen", to: "d:pacifica-playground" });
  await settle();
  assert.equal(Object.values(store.apps.rides).length, 1, "one cab at a time");

  await store._tickCabb();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ride.status, "waiting");
  assert.equal(game.actors.get("pcA").system.wealth.value, 1500 - ride.fare);
  assert.equal(Object.values(store.apps.ledger).at(-1).kind, "cabb");
  assert.match(alertsOf("pcA").at(-1).text, /is here/);
  assert.match(gmCards().at(-1).body, /waits until you send it off/);
  assert.deepEqual(gmCards().at(-1).actions.map(a => a.data.action), ["depart", "cancel"]);

  // It doesn't leave on its own: only the GM sends it off.
  await store._tickCabb();
  assert.equal(ride.status, "waiting", "the clock doesn't move a waiting cab");
  from(alice, "cabb-gm", { rideId: ride.id, action: "depart" });
  from(alice, "cabb-cancel", { rideId: ride.id });
  await settle();
  assert.equal(ride.status, "waiting", "the rider can't send it off, or cancel once it's paid");
  from(gm, "cabb-gm", { rideId: ride.id, action: "depart" });
  await settle();
  assert.equal(ride.status, "riding");
  assert.match(alertsOf("pcA").at(-1).text, /is moving\. Little China in about/);
  assert.deepEqual(gmCards().at(-1).actions.map(a => a.data.action), ["arrived"]);
  await new Promise(r => setTimeout(r, 20));
  await store._tickCabb();
  assert.equal(ride.status, "arrived");
  assert.match(alertsOf("pcA").at(-1).text, /Arrived: Little China/);

  // The GM says where the party is: the pickup is theirs, whatever the player sent.
  await game.settings.set("cpr-sam-agent", "cabb", { etaMin: 60, etaMax: 60, partyAt: "d:pacifica-playground" });
  from(alice, "cabb-book", { actorId: "pcA", from: "d:the-glen", to: "d:little-china" });
  await settle();
  const second = Object.values(store.apps.rides).find(r => r.status === "enroute");
  assert.equal(second.from.name, "Pacifica Playground");
  from(bob, "cabb-cancel", { rideId: second.id });
  from(alice, "cabb-cancel", { rideId: second.id });
  await settle();
  assert.equal(second.status, "cancelled");

  // Can't cover the fare at pickup: the cab leaves.
  await game.settings.set("cpr-sam-agent", "cabb", { etaMin: 0, etaMax: 0 });
  from(bob, "cabb-book", { actorId: "pcB", from: "d:the-outskirts", to: "d:new-westbrook" });
  await settle();
  const third = Object.values(store.apps.rides).find(r => r.actorId === "pcB");
  game.actors.get("pcB").system.wealth.value = 5;
  await store._tickCabb();
  assert.equal(third.status, "declined");
  assert.match(alertsOf("pcB").at(-1).text, /declined/);

  // GM: here now, and cancelling a paid ride refunds it.
  game.actors.get("pcB").system.wealth.value = 1000;
  await game.settings.set("cpr-sam-agent", "cabb", { etaMin: 600, etaMax: 600, tripMin: 600, tripMax: 600 });
  from(bob, "cabb-book", { actorId: "pcB", from: "d:the-outskirts", to: "d:new-westbrook" });
  await settle();
  const fourth = Object.values(store.apps.rides).find(r => r.actorId === "pcB" && r.status === "enroute");
  from(bob, "cabb-gm", { rideId: fourth.id, action: "here" });
  from(gm, "cabb-gm", { rideId: fourth.id, action: "here" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fourth.status, "waiting");
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000 - fourth.fare);
  from(gm, "cabb-gm", { rideId: fourth.id, action: "cancel" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fourth.status, "cancelled");
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000, "a waiting cab is refunded");
  assert.match(alertsOf("pcB").at(-1).text, /refunded/);

  // And one that already left.
  from(bob, "cabb-book", { actorId: "pcB", from: "d:the-outskirts", to: "d:new-westbrook" });
  await settle();
  const fifth = Object.values(store.apps.rides).find(r => r.actorId === "pcB" && r.status === "enroute");
  from(gm, "cabb-gm", { rideId: fifth.id, action: "here" });
  await settle();
  from(gm, "cabb-gm", { rideId: fifth.id, action: "depart" });
  await settle();
  assert.equal(fifth.status, "riding");
  from(gm, "cabb-gm", { rideId: fifth.id, action: "cancel" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(game.actors.get("pcB").system.wealth.value, 1000, "a moving cab is refunded");
});

test("chat says when someone takes out or puts away a carried Agent: not an Internal Agent, no token, the GM's switches", async () => {
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getWhisperRecipients: () => [{ id: "gm" }] };
  from(alice, "agent-shown", { actorId: "pcA", open: true });
  await settle();
  assert.equal(ChatMessage.created.length, 0, "off unless the GM switches it on");
  await game.settings.set("cpr-sam-agent", "features", { agentChat: true });
  addActor({ id: "pcI", name: "Chip", owners: ["alice"], items: ["Internal Agent"] });
  from(alice, "agent-shown", { actorId: "pcA", open: true });
  from(alice, "agent-shown", { actorId: "pcA", open: true });
  from(bob, "agent-shown", { actorId: "pcA", open: false });
  from(alice, "agent-shown", { actorId: "pcI", open: true });
  await settle();
  assert.equal(ChatMessage.created.length, 1, "once, by its owner, and not for an Internal Agent");
  const [line] = ChatMessage.created;
  assert.match(line.content, /V takes out their Agent\./);
  assert.deepEqual(line.speaker, { alias: "V" }, "no token: Foundry draws no bubble and pans no camera");
  assert.deepEqual(line.whisper, [], "everyone");
  assert.deepEqual(line.flags["cpr-sam-agent"].agentShown, { actorId: "pcA", open: true }, "each screen draws its own bubble from this");
  from(alice, "agent-shown", { actorId: "pcA", open: false });
  await settle();
  assert.match(ChatMessage.created.at(-1).content, /V puts away their Agent\./);
  await game.settings.set("cpr-sam-agent", "features", { agentChat: true, agentChatWhisper: true });
  from(alice, "agent-shown", { actorId: "pcA", open: true });
  await settle();
  assert.deepEqual(ChatMessage.created.at(-1).whisper, ["gm"], "whispered to the GM");
  await game.settings.set("cpr-sam-agent", "features", { agentChat: false });
  from(alice, "agent-shown", { actorId: "pcA", open: false });
  from(alice, "agent-shown", { actorId: "pcA", open: true });
  await settle();
  assert.equal(ChatMessage.created.length, 3, "switched off in Control: nothing");
  delete globalThis.ChatMessage;
});

test("Achieve!: a player shows off what their character earned, in chat", async () => {
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); } };
  await game.settings.set("cpr-sam-agent", "achieve", { chat: false });
  from(alice, "achieve-show", { actorId: "pcA", id: "payday" });
  await settle();
  assert.equal(ChatMessage.created.length, 0, "not earned: nothing to show");
  from(gm, "achieve-award", { actorIds: ["pcA"], id: "payday" });
  await settle();
  from(bob, "achieve-show", { actorId: "pcA", id: "payday" });
  from(alice, "achieve-show", { actorId: "pcA", id: "payday" });
  await settle();
  assert.equal(ChatMessage.created.length, 1, "only by the character's player (and whatever the announce switch says)");
  assert.equal(ChatMessage.created[0].speaker.alias, "V");
  assert.match(ChatMessage.created[0].content, /V shows off <b>Payday<\/b>/);
  assert.match(ChatMessage.created[0].content, /<img src="[^"]+"/);
  delete globalThis.ChatMessage;
});

test("Achieve!: the GM awards to characters (several at once), trades one in, takes it back; players ask", async () => {
  const { achievementList, achievements, earnedData, newlyEarned, seenOf, unspent } = await import("../apps/achieve/model.js");
  assert.equal(achievements().length, 3, "the content folder's");
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); } };
  await game.settings.set("cpr-sam-agent", "achieve", { hidden: ["vip"], disabled: ["gamer"], custom: [{ id: "custom-x", name: "Mine" }] });
  const list = achievementList();
  assert.equal(list.length, 4);
  assert.deepEqual([list.find(a => a.id === "vip").hidden, list.find(a => a.id === "gamer").disabled], [true, true]);
  assert.match(list.at(-1).img, /badge-blank\.svg$/, "no content folder: the plain badge");

  from(alice, "achieve-award", { actorIds: ["pcA"], id: "payday" });
  from(gm, "achieve-award", { actorIds: ["pcA"], id: "gamer" });
  from(gm, "achieve-award", { actorIds: ["pcA", "pcB", "pcA", "nobody"], id: "payday", note: "Arasaka paid up" });
  await settle();
  const seen = seenOf({});
  let earned = earnedData(store.apps);
  assert.deepEqual(Object.keys(earned).sort(), ["pcA", "pcB"], "the GM only, not a switched-off one, real characters only");
  assert.deepEqual([Object.keys(earned.pcA), Object.keys(earned.pcB)], [["payday"], ["payday"]]);
  assert.equal(earned.pcA.payday.note, "Arasaka paid up");
  assert.equal(earned.pcA.payday.ts, earned.pcB.payday.ts, "one award: one time, celebrated together");
  assert.equal(ChatMessage.created.length, 1);
  assert.match(ChatMessage.created[0].content, /V, Judy unlocked <b>Payday<\/b>/);
  assert.equal(newlyEarned(earnedData(store.apps), seen).length, 2, "something to celebrate");
  assert.equal(hooks.filter(h => h.hook === "cpr-sam-agent.achievementEarned").length, 2);
  const ts = earned.pcA.payday.ts;
  from(gm, "achieve-award", { actorIds: ["pcA"], id: "payday" });
  await settle();
  assert.equal(earnedData(store.apps).pcA.payday.ts, ts, "once per character");
  assert.equal(ChatMessage.created.length, 1, "nobody new: no announcement");

  from(alice, "achieve-ask", { actorId: "pcB", id: "payday", kind: "box" });
  from(bob, "achieve-ask", { actorId: "pcB", id: "payday", kind: "box" });
  await settle();
  const card = gmCards().at(-1);
  assert.match(card.body, /Judy wants to trade in Payday for a Mystery Box/);
  assert.deepEqual(card.actions[0].data, { actorId: "pcB", id: "payday", kind: "box" });
  from(gm, card.actions[0].request, card.actions[0].data);
  await settle();
  earned = earnedData(store.apps);
  assert.equal(earned.pcB.payday.spent.kind, "box");
  assert.deepEqual(unspent(earned.pcB), []);
  assert.deepEqual(unspent(earned.pcA), ["payday"], "V's is still theirs to trade");
  assert.ok(hooks.some(h => h.hook === "cpr-sam-agent.achievementTraded"));
  from(gm, "achieve-trade", { actorId: "pcB", id: "payday", kind: "reroll" });
  await settle();
  assert.equal(earnedData(store.apps).pcB.payday.spent.kind, "box", "traded once");

  from(gm, "achieve-revoke", { actorId: "pcA", id: "payday" });
  await settle();
  assert.deepEqual(earnedData(store.apps).pcA, {});
  assert.ok(earnedData(store.apps).pcB.payday, "only theirs");
  delete globalThis.ChatMessage;
});

test("Gacha's rarities and odds; Achieve!'s Table of Mystery", async () => {
  const { COLLECTIBLES, GACHA_DEFAULTS, odds, pullCollectible, rollRarity } = await import("../apps/gacha/model.js");
  const { boxContents, boxName, MYSTERY_BOXES } = await import("../apps/achieve/boxes.js");
  assert.equal(MYSTERY_BOXES.length, 10);
  assert.ok(MYSTERY_BOXES.every(b => b.contents.length === 6));
  assert.equal(boxName(3), "A box dripping wet with fluid");
  assert.equal(boxContents(10, 6).items[0].name, "Techscanner");
  const w = GACHA_DEFAULTS.weights;
  assert.equal(rollRarity(w, COLLECTIBLES, 0), "common");
  assert.equal(rollRarity(w, COLLECTIBLES, 0.999), "legendary");
  assert.equal(rollRarity(w, COLLECTIBLES, 0.7), "uncommon");
  assert.equal(rollRarity({ ...w, legendary: 0 }, COLLECTIBLES, 0.999), "epic", "no weight: never");
  assert.equal(rollRarity(w, COLLECTIBLES.filter(c => c.rarity !== "epic" && c.rarity !== "legendary"), 0.999), "rare", "no collectibles of a rarity: never");
  assert.deepEqual(odds(w, COLLECTIBLES), { common: "68", uncommon: "24", rare: "6.0", epic: "1.4", legendary: "0.6" });
  const c = pullCollectible({ ...GACHA_DEFAULTS, collectibles: null }, () => 0.9999);
  assert.equal(c.rarity, "legendary");
});

test("Gacha collectibles: a picture (a web address or a file) or a Font Awesome icon", async () => {
  const { cleanCollectible } = await import("../apps/gacha/model.js");
  const c = (img, icon = "fa-crow") => cleanCollectible({ name: "X", icon, img });
  assert.equal(c("https://example.com/pigeon.webp").img, "https://example.com/pigeon.webp");
  assert.equal(c("worlds/nc/gacha/pigeon.png").img, "worlds/nc/gacha/pigeon.png");
  assert.equal(c("javascript:alert(1)").img, "", "no other kinds of address");
  assert.equal(c("data:image/svg+xml,<svg/>").img, "");
  assert.equal(c(undefined).img, "", "none: the icon");
  assert.equal(c("", "fa-crow").icon, "fa-crow");
  assert.equal(c("pic.png", "bad icon").icon, "fa-cube", "the icon stays as a fallback");
});

test("Gacha's default pictures: every Rare and up, 15 Uncommons, no Commons; each file is there and credited", async () => {
  const { COLLECTIBLES } = await import("../apps/gacha/model.js");
  const pictured = r => COLLECTIBLES.filter(c => c.rarity === r && c.img);
  assert.deepEqual(["common", "uncommon", "rare", "epic", "legendary"].map(r => pictured(r).length), [0, 15, 30, 15, 11]);
  const credits = fs.readFileSync(new URL("../images/gacha/CREDITS.md", import.meta.url), "utf8");
  for (const c of COLLECTIBLES.filter(c => c.img)) {
    assert.ok(fs.existsSync(new URL(`../${c.img.replace("modules/cpr-sam-agent/", "")}`, import.meta.url)), `${c.id}'s file`);
    assert.ok(credits.includes(`| ${c.id} |`), `${c.id}'s credit`);
  }
});

test("Gacha pity: an Epic or better by the 10th pull, Legendary odds climb from the 74th, and the 90th is one", async () => {
  const { COLLECTIBLES, GACHA_DEFAULTS, nextPity, pityWeights, rollRarity } = await import("../apps/gacha/model.js");
  const w = GACHA_DEFAULTS.weights;
  assert.deepEqual(pityWeights(w, COLLECTIBLES, {}), w, "no pity yet: the plain weights");
  assert.equal(pityWeights(w, COLLECTIBLES, { sinceLegendary: 72 }).legendary, 6, "pull 73: not yet");
  assert.equal(pityWeights(w, COLLECTIBLES, { sinceLegendary: 73 }).legendary, 66, "pull 74: +60");
  assert.equal(pityWeights(w, COLLECTIBLES, { sinceLegendary: 88 }).legendary, 6 + 16 * 60, "pull 89: (89 - 73) x 60");
  assert.deepEqual(pityWeights(w, COLLECTIBLES, { sinceLegendary: 89 }), { legendary: 1 }, "pull 90: Legendary");
  assert.equal(rollRarity(pityWeights(w, COLLECTIBLES, { sinceLegendary: 89 }), COLLECTIBLES, 0), "legendary");
  const tenth = pityWeights(w, COLLECTIBLES, { sinceEpic: 9 });
  assert.equal(rollRarity(tenth, COLLECTIBLES, 0), "epic", "the 10th: Epic or better");
  assert.equal(rollRarity(tenth, COLLECTIBLES, 0.99), "legendary");
  assert.equal(rollRarity(pityWeights({ ...w, epic: 0, legendary: 0 }, COLLECTIBLES, { sinceEpic: 9, sinceLegendary: 89 }), COLLECTIBLES, 0), "common", "switched off: never forced");
  assert.deepEqual(pityWeights({ common: 68, uncommon: 24, rare: 6, epic: 1.4, legendary: 0.6 }, COLLECTIBLES, { sinceLegendary: 73 }).legendary, 0.6 + 6, "the step is per mille of the GM's total");

  assert.deepEqual(nextPity({}, "common"), { sinceEpic: 1, sinceLegendary: 1 });
  assert.deepEqual(nextPity({ sinceEpic: 9, sinceLegendary: 40 }, "epic"), { sinceEpic: 0, sinceLegendary: 41 });
  assert.deepEqual(nextPity({ sinceEpic: 3, sinceLegendary: 89 }, "legendary"), { sinceEpic: 0, sinceLegendary: 0 });

  // A run of pulls on the worst luck there is: an Epic every 10th, a Legendary at the 90th.
  let pity = {};
  const got = [];
  for (let i = 1; i <= 90; i++) {
    const r = rollRarity(pityWeights(w, COLLECTIBLES, pity), COLLECTIBLES, 0);
    got.push(r);
    pity = nextPity(pity, r);
  }
  assert.deepEqual(got.map((r, i) => (r === "common" ? null : `${i + 1}:${r}`)).filter(Boolean), [10, 20, 30, 40, 50, 60, 70, 80].map(n => `${n}:epic`).concat("90:legendary"));
  assert.deepEqual(pity, { sinceEpic: 0, sinceLegendary: 0 });
});

test("Gacha: weights saved out of 100 move to per mille, once", async () => {
  await game.settings.set("cpr-sam-agent", "gachaConfig", { price: 5, weights: { common: 60, rare: 20 } });
  await store._gachaWeightsLoad();
  assert.deepEqual(game.settings.get("cpr-sam-agent", "gachaConfig"), { price: 5, weights: { rare: 200 }, perMille: true }, "the old default takes the new one; the GM's own is x10");
  await store._gachaWeightsLoad();
  assert.deepEqual(game.settings.get("cpr-sam-agent", "gachaConfig").weights, { rare: 200 }, "once");
});

test("Gacha: the GM's curated Legendary rewards are cleaned: real uuids, each once, 50 at most", async () => {
  const { cleanRewards, gachaConfig, REWARDS_MAX } = await import("../apps/gacha/model.js");
  assert.deepEqual(gachaConfig().legendaryRewards, [], "none until the GM adds some");
  assert.deepEqual(cleanRewards("nonsense"), []);
  const c = "Compendium.cyberpunk-red-core.core_gear.Item.abc123";
  assert.deepEqual(cleanRewards([
    { uuid: c, name: "  Agent ", img: "icons/agent.svg", weight: 3 },
    { uuid: c, name: "Agent again" },
    { uuid: "Item.xyz" },
    { uuid: "not a uuid", name: "No" },
    { uuid: "javascript:alert(1)", name: "No" },
    { uuid: "Actor.a1.Item.i1", name: "Off a sheet", img: "javascript:alert(1)" },
    null
  ]), [
    { uuid: c, name: "Agent", img: "icons/agent.svg" },
    { uuid: "Item.xyz", name: "Reward", img: "" },
    { uuid: "Actor.a1.Item.i1", name: "Off a sheet", img: "" }
  ]);
  const many = Array.from({ length: REWARDS_MAX + 5 }, (_, i) => ({ uuid: `Item.i${i}`, name: `R${i}` }));
  await game.settings.set("cpr-sam-agent", "gachaConfig", { legendaryRewards: many });
  assert.equal(gachaConfig().legendaryRewards.length, REWARDS_MAX);
});

test("Gacha: making a pull real gives the chosen item; a curated reward whose item is gone is a plain item by its name", async () => {
  const made = [];
  game.actors.get("pcA").createEmbeddedDocuments = async (type, docs) => made.push(...docs.map(d => d.name));
  globalThis.fromUuid = async uuid => (uuid === "Item.real" ? { toObject: () => ({ name: "Real Thing", type: "gear", system: {} }) } : null);
  const pull = id => ({ id, cid: "moon-rock", name: "Moon Rock", rarity: "legendary", icon: "fa-moon", img: "", ts: 1, real: null });
  store.apps.gachaShelves = { pcA: [pull("p1"), pull("p2")] };
  await game.settings.set("cpr-sam-agent", "gachaConfig", { legendaryRewards: [{ uuid: "Item.gone", name: "Lost Reward" }] });

  from(alice, "gacha-real", { actorId: "pcA", pullId: "p1", uuid: "Item.real" });
  await settle();
  assert.deepEqual(made, [], "a player can't");
  from(gm, "gacha-real", { actorId: "pcA", pullId: "p1", uuid: "Item.real" });
  await settle();
  from(gm, "gacha-real", { actorId: "pcA", pullId: "p2", uuid: "Item.gone" });
  await settle();
  assert.deepEqual(made, ["Real Thing", "Lost Reward"]);
  assert.deepEqual(store.apps.gachaShelves.pcA.map(p => p.real?.name), ["Real Thing", "Lost Reward"]);
  delete globalThis.fromUuid;
});

test("Gacha duplicates: each spare is a C level up to C6; past it they sell for 2.5x; selling lowers the level", async () => {
  const { constellation, duplicates, GACHA_DEFAULTS, saleValue } = await import("../apps/gacha/model.js");
  assert.deepEqual(constellation(1), { level: 0, over: 0 }, "the first copy is no level");
  assert.deepEqual(constellation(2), { level: 1, over: 0 });
  assert.deepEqual(constellation(7), { level: 6, over: 0 });
  assert.deepEqual(constellation(9), { level: 6, over: 2 }, "two spares past C6");

  const copies = (n, rarity = "legendary", cid = "moon-rock") => Array.from({ length: n }, (_, i) => ({ id: `${cid}${i}`, cid, name: cid, rarity, icon: "fa-moon", img: "", ts: i + 1, real: null }));
  const { sell } = GACHA_DEFAULTS;
  const one = shelf => saleValue(shelf, duplicates(shelf).slice(0, 1), sell);
  assert.equal(one(copies(2)), 8, "a spare under the cap: the plain price");
  assert.equal(one(copies(7)), 8, "the one that makes C6: the plain price, it lowers the level");
  assert.equal(one(copies(8)), 20, "past C6: 2.5x");
  assert.equal(one(copies(8, "common")), 3, "rounded");
  const nine = copies(9);
  assert.equal(saleValue(nine, duplicates(nine), sell), 2 * 20 + 6 * 8, "all eight spares: two past the cap, six under");
  const mixed = [...copies(2), ...copies(8, "rare", "noodle-cup")];
  assert.equal(saleValue(mixed, duplicates(mixed), sell), 8 + 8 + 6 * 3, "each collectible counts its own");

  store.apps.gachaShelves = { pcA: copies(8) };
  store.apps.gachaCreds = { pcA: 0 };
  from(alice, "gacha-sell", { actorId: "pcA", cid: "moon-rock" });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 20, "the host pays the past-C6 price");
  assert.equal(store.apps.gachaShelves.pcA.length, 7);
  from(alice, "gacha-sell", { actorId: "pcA", cid: "moon-rock" });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 28, "now at C6: the plain price");
  assert.equal(store.apps.gachaShelves.pcA.length, 6, "and it drops to C5");
});

test("Achieve!: a traded-in achievement brings a Mystery Box; opening, the GM giving it. Gacha: capsules, showing off and giving away", async () => {
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); } };
  await game.settings.set("cpr-sam-agent", "gachaConfig", { failChance: 0 });
  const gacha = () => ({ boxes: store.apps.boxes, shelves: store.apps.gachaShelves });
  const given = [];
  game.packs = [];
  game.actors.get("pcB").createEmbeddedDocuments = async (type, docs) => given.push([type, docs.map(d => d.name)]);

  from(gm, "achieve-award", { actorIds: ["pcB"], id: "payday" });
  await settle();
  from(gm, "achieve-trade", { actorId: "pcB", id: "payday", kind: "box" });
  await settle();
  const [box] = Object.values(gacha().boxes);
  assert.equal(box.status, "sealed");
  assert.equal(box.actorId, "pcB", "the box is the character's");
  assert.ok(box.table >= 1 && box.table <= 10);
  assert.equal(box.source, "Payday");
  assert.equal(store.apps.earned.pcB.payday.spent.boxId, box.id);
  assert.match(alertsOf("pcB").at(-1).text, /A Mystery Box has appeared within 10 m of you/);
  assert.ok(!alertsOf("pcA").some(a => /Mystery Box/.test(a.text)), "nobody else hears of it");

  from(alice, "achieve-box-open", { actorId: "pcA", boxId: box.id });
  await settle();
  assert.equal(gacha().boxes[box.id].status, "sealed", "someone else's box doesn't open");
  from(bob, "achieve-box-open", { actorId: "pcB", boxId: box.id });
  await settle();
  let opened = gacha().boxes[box.id];
  assert.equal(opened.status, "opening");
  assert.equal(opened.openedBy, "pcB");
  assert.ok(opened.contents.length >= 1);
  assert.match(gmCards().at(-1).body, /Judy opened a box/);
  from(bob, "achieve-box-confirm", { boxId: box.id });
  from(gm, "achieve-box-confirm", { boxId: box.id, contents: [{ name: "Something else", qty: 2 }] });
  await settle();
  opened = gacha().boxes[box.id];
  assert.equal(opened.status, "open");
  assert.deepEqual(given, [["Item", ["Something else", "Something else"]]], "the GM's choice, once (two of a plain item)");

  from(alice, "gacha-pull", { actorId: "pcA" });
  await settle();
  assert.equal(gacha().shelves.pcA, undefined, "no zCreds: no pull");
  assert.match(alertsOf("pcA").at(-1).text, /A pull is 160 zC; you have 0 zC/);

  // zCreds (the defaults): 10eb for 60, 50eb for 330; a pull is 160.
  from(alice, "gacha-buy", { actorId: "pcA", bundle: 0 });
  from(alice, "gacha-buy", { actorId: "pcA", bundle: 1 });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 390);
  assert.equal(game.actors.get("pcA").system.wealth.value, 1440);
  assert.match(alertsOf("pcA").at(-1).text, /\+330 zC\. You have 390 zC/);
  from(bob, "gacha-buy", { actorId: "pcA", bundle: 0 });
  from(alice, "gacha-buy", { actorId: "pcA", bundle: 7 });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 390, "not your character, or no such bundle: nothing");

  // A failed purchase: charged all the same.
  await game.settings.set("cpr-sam-agent", "gachaConfig", { failChance: 100 });
  from(alice, "gacha-buy", { actorId: "pcA", bundle: 0 });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 390);
  assert.equal(game.actors.get("pcA").system.wealth.value, 1430, "the eddies go anyway");
  assert.match(alertsOf("pcA").at(-1).text, /Transaction failed\. Your payment of .*10.* has been processed/);
  await game.settings.set("cpr-sam-agent", "gachaConfig", { failChance: 0 });

  from(alice, "gacha-pull", { actorId: "pcA" });
  from(alice, "gacha-pull", { actorId: "pcA" });
  await settle();
  await new Promise(r => setTimeout(r, 20));
  const shelf = gacha().shelves.pcA;
  assert.equal(shelf.length, 2);
  assert.ok(shelf.every(p => "img" in p), "a pull keeps the collectible's picture (or none)");
  const { nextPity } = await import("../apps/gacha/model.js");
  assert.deepEqual(store.apps.gachaPity.pcA, shelf.reduce((p, pull) => nextPity(p, pull.rarity), {}), "the pity counters follow the pulls");
  assert.equal(store.apps.gachaCreds.pcA, 70, "160 zC a pull: 70 left over");
  assert.equal(game.actors.get("pcA").system.wealth.value, 1430, "pulls cost zCreds, not eddies");
  assert.equal(Object.values(store.apps.ledger).filter(e => e.kind === "gacha").length, 3, "the three purchases");
  game.actors.get("pcA").system.wealth.value = 5;
  from(alice, "gacha-buy", { actorId: "pcA", bundle: 0 });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 70, "can't pay: no zCreds");

  // Favourites, and selling a duplicate (one of each is kept).
  from(alice, "gacha-fav", { actorId: "pcA", cid: shelf[0].cid });
  from(alice, "gacha-fav", { actorId: "pcA", cid: "not-on-the-shelf" });
  await settle();
  assert.deepEqual(store.apps.gachaFavs.pcA, [shelf[0].cid]);
  from(alice, "gacha-fav", { actorId: "pcA", cid: shelf[0].cid });
  await settle();
  assert.deepEqual(store.apps.gachaFavs.pcA, [], "pinned again: unpinned");
  const copy = { ...shelf[1], id: "copy1", ts: shelf[1].ts + 1, rarity: "rare" };
  store.apps.gachaShelves.pcA.push(copy);
  from(alice, "gacha-sell", { actorId: "pcA", cid: shelf[0].cid === shelf[1].cid ? "none" : shelf[0].cid });
  await settle();
  assert.equal(gacha().shelves.pcA.length, 3, "the only one of its kind isn't sold");
  from(alice, "gacha-sell", { actorId: "pcA", cid: copy.cid });
  await settle();
  assert.ok(!gacha().shelves.pcA.some(p => p.id === "copy1"), "the newest copy goes");
  assert.ok(gacha().shelves.pcA.some(p => p.id === shelf[1].id), "the first is kept");
  assert.equal(store.apps.gachaCreds.pcA, 73, "a rare duplicate: 3 zC");
  from(gm, "gacha-creds", { actorId: "pcA", amount: 50 });
  from(alice, "gacha-creds", { actorId: "pcA", amount: 99999 });
  await settle();
  assert.equal(store.apps.gachaCreds.pcA, 50, "the GM sets zCreds; a player can't");

  from(alice, "gacha-show", { actorId: "pcA", pullId: shelf[0].id });
  await settle();
  assert.match(ChatMessage.created.at(-1).content, new RegExp(shelf[0].name));
  // A pull from before the pictures stored "": the chat card takes the collectible's.
  store.apps.gachaShelves.pcA.push({ ...shelf[0], id: "old1", cid: "whole-tree", img: "" });
  from(alice, "gacha-show", { actorId: "pcA", pullId: "old1" });
  await settle();
  assert.match(ChatMessage.created.at(-1).content, /<img src="modules\/cpr-sam-agent\/images\/gacha\/whole-tree\.webp"/);
  store.apps.gachaShelves.pcA = store.apps.gachaShelves.pcA.filter(p => p.id !== "old1");

  from(alice, "gacha-trade", { actorId: "pcA", pullId: shelf[0].id, toId: "pcB" });
  await settle();
  const offer = alertsOf("pcB").at(-1);
  assert.deepEqual(offer.choices, ["Accept", "Decline"]);
  from(bob, "alert-answer", { alertId: offer.id, choice: "Accept" });
  await settle();
  assert.equal(gacha().shelves.pcA.length, 1);
  assert.equal(gacha().shelves.pcB[0].id, shelf[0].id);
  assert.equal(gacha().shelves.pcB[0].from, "pcA");
  delete game.packs;
  delete globalThis.ChatMessage;
});

test("the app folders, the built app lists, the templates, stylesheets and data methods agree", async () => {
  const { APP_IDS, APP_MANIFEST, APP_SETTINGS, APP_TABLES, appDataKey } = await import("../scripts/apps/manifest.js");
  const pages = await import("../apps/pages.js");
  const hosts = await import("../apps/hosts.js");
  const clients = await import("../apps/clients.js");
  const { stale } = await import("../tools/apps.mjs");
  const { AgentPhone } = await import("../scripts/ui/phone/AgentPhone.js");
  const { STYLES } = await import("../scripts/config.js");
  assert.deepEqual(await stale(), [], "the app lists and module.json styles are up to date (npm run apps)");
  assert.deepEqual(Object.keys(pages).sort(), [...APP_IDS].sort(), "apps/pages.js lists every app, and only apps");
  assert.deepEqual(Object.keys(hosts).sort(), [...APP_IDS].sort(), "apps/hosts.js lists every app, and only apps");
  for (const id of APP_IDS) {
    const app = APP_MANIFEST[id];
    assert.ok(app.name && app.icon && app.blurb, `${id}: a name, an icon and a blurb`);
    assert.ok(fs.existsSync(new URL(`../apps/${id}/${id}.hbs`, import.meta.url)), `${id}: apps/${id}/${id}.hbs`);
    for (const file of Object.values(app.partials ?? {})) assert.ok(fs.existsSync(new URL(`../apps/${id}/${file}`, import.meta.url)), `${id}: apps/${id}/${file}`);
    assert.equal(typeof AgentPhone.prototype[`${appDataKey(id)}Data`], "function", `${id}: its page has ${appDataKey(id)}Data()`);
    assert.ok(STYLES.includes(`apps/${id}/${id}.css`), `${id}: apps/${id}/${id}.css is in STYLES (and module.json)`);
    if (app.tick) assert.equal(typeof store[app.tick.method], "function", `${id}: the host has ${app.tick.method}()`);
    if (app.load) assert.equal(typeof store[app.load], "function", `${id}: the host has ${app.load}()`);
  }
  // Settings: each key once, an app's onSetting only for its own settings.
  const keys = APP_SETTINGS.map(s => s.key);
  assert.deepEqual(keys, [...new Set(keys)], "no app setting is defined twice");
  for (const { key, redraw } of APP_SETTINGS) assert.ok(redraw === undefined || redraw === "all" || Array.isArray(redraw), `${key}: redraw is a list of change flags or "all"`);
  for (const [id, client] of Object.entries(clients)) {
    for (const key of Object.keys(client.onSetting ?? {})) assert.ok(APP_MANIFEST[id].settings?.[key], `apps/${id}/client.js: onSetting.${key} is one of its settings`);
  }
  assert.deepEqual(Object.keys(emptyApps()).sort(), Object.keys(APP_TABLES).sort());
  for (const [name, table] of Object.entries(APP_TABLES)) {
    assert.ok(["actorId", "key", "listed", "crew", "crewKey", "gm"].includes(table.owner), `${name}: who may see its rows`);
  }
});

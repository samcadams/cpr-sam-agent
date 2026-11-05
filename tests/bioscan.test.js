import { addActor, addScene, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsFor, emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import {
  bioConfig, bioSkillBase, canAddRound, cleanLabel, hasMicroVideo, originalOf, pipCounts, pipView, recordLine, retinaAllowed, roundStatus,
  scanDone, scanNeed, staleOf
} from "../apps/handscan/model.js";
import { CATALOGUE_DEFAULTS } from "../apps/pool/model.js";

/*
 * Handprint Scanner and Retina Scanner (apps/handscan/model.js, host.js): pips (pending, confirmed, voided, failed,
 * not in a row), finishing at 3/5/5/1, stale marks through copies, MicroVideo, labels, and what players can't
 * see. Rolls and chat are faked here (the shared stub has neither).
 */

let gm, alice, dice;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const scans = () => Object.values(store.apps.bioScans);
const records = () => Object.values(store.apps.bioRecords);
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);
const start = async (data = {}) => {
  from(alice, "bio-start", { actorId: "pcA", kind: "hand", method: "direct", side: "left", tokenId: "t1", sceneId: "s1", label: "Kenji, lobby", ...data });
  await settle();
  return scans().at(-1);
};
const round = async (id, data) => {
  from(alice, "bio-round", { id, ...data });
  await settle();
};

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], system: { stats: { dex: { value: 6 }, int: { value: 5 } } }, items: ["Agent", { name: "Brawling", type: "skill", system: { stat: "dex", level: 4 } }] });
  addActor({ id: "pcI", name: "Inny", owners: ["alice"], items: ["Internal Agent"] });
  addActor({ id: "npc", name: "Kenji", type: "mook" });
  addScene({ name: "Arasaka lobby", tokens: [{ id: "t1", actorId: "npc", name: "Suit", texture: { src: "kenji.webp" } }, { id: "t2", actorId: "pcA", name: "V", texture: { src: "v.webp" } }] });
  dice = [];
  globalThis.Roll = class { constructor() {} async evaluate() { return { total: dice.length ? dice.shift() : 5 }; } };
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getSpeaker: () => ({}) };
  game.messages = new Map();
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("rules: rounds needed, pips (pending, confirmed, voided, failed), done, round status", () => {
  const config = bioConfig({});
  assert.deepEqual([scanNeed("hand", "direct", config), scanNeed("retina", "direct", config), scanNeed("hand", "partial", config), scanNeed("hand", "print", config)], [3, 5, 5, 1]);
  assert.deepEqual(bioConfig({ dv: "99", handRounds: 0, confirm: "yes", microVideo: { a: true, b: "no" } }), { dv: 40, handRounds: 1, retinaRounds: 5, partialPrints: 5, confirm: true, microVideo: { a: true } });
  const scan = { need: 3, pips: [{ status: "ok" }, { status: "fail" }, { status: "void" }, { status: "pending" }] };
  assert.deepEqual(pipCounts(scan), { ok: 1, pending: 1, void: 1, fail: 1 });
  assert.deepEqual(pipView(scan), ["ok", "pending", "empty"]);
  assert.ok(canAddRound(scan) && !scanDone(scan));
  scan.pips.push({ status: "pending" });
  assert.ok(!canAddRound(scan), "full while the GM hasn't answered");
  scan.pips.forEach(p => p.status === "pending" && (p.status = "ok"));
  assert.ok(scanDone(scan));
  assert.equal(roundStatus({ total: 13 }, 13, true), "pending");
  assert.equal(roundStatus({ total: 13 }, 13, false), "ok");
  assert.equal(roundStatus({ total: 12 }, 13, false), "fail");
  assert.equal(roundStatus({ auto: true }, 13, false), "pending", "can't move always waits for the GM");
  assert.deepEqual(bioSkillBase(game.actors.get("pcA"), "Brawling"), { stat: "dex", value: 6, level: 4 });
  assert.deepEqual(bioSkillBase(game.actors.get("pcA"), "Criminology"), { stat: "int", value: 5, level: 0 });
});

test("labels, record lines, stale through copies; App Store prices", () => {
  assert.equal(cleanLabel("  Kenji  https://evil.example/x  bar glass "), "Kenji bar glass");
  assert.equal(cleanLabel("x".repeat(200)).length, 80);
  assert.equal(recordLine({ kind: "hand", side: "right", method: "partial" }), "Right hand · Compiled from prints");
  assert.equal(recordLine({ kind: "retina", method: "direct" }), "Retina · Direct scan");
  const rows = { a: { id: "a", stale: { reason: "re-keyed" } }, b: { id: "b", copyOf: "a" }, c: { id: "c", copyOf: "b" }, d: { id: "d", copyOf: "gone" } };
  assert.equal(originalOf(rows.c, rows).id, "a");
  assert.equal(staleOf(rows.c, rows).reason, "re-keyed", "a copy of a copy is stale too");
  assert.equal(staleOf(rows.d, rows), null, "a copy whose original is gone stands alone");
  assert.deepEqual(CATALOGUE_DEFAULTS.handscan, { publisher: "Unspecified", price: 20, model: "once" });
  assert.deepEqual(CATALOGUE_DEFAULTS.retinascan, { publisher: "Unspecified", price: 50, model: "once" });
});

test("MicroVideo: an internal Agent needs it for retinas; cybereye option, smart glasses, the GM's word", () => {
  const actor = items => ({ items });
  assert.ok(!hasMicroVideo(actor([])));
  assert.ok(hasMicroVideo(actor([{ name: "MicroVideo", type: "cyberware", system: { isInstalled: true } }])));
  assert.ok(!hasMicroVideo(actor([{ name: "MicroVideo", type: "cyberware", system: { isInstalled: false } }])), "not installed");
  assert.ok(hasMicroVideo(actor([{ name: "Smart Glasses (MicroVideo, Low Light)", type: "gear", system: { equipped: "equipped" } }])));
  assert.ok(hasMicroVideo(actor([{ name: "Smart Glasses", type: "gear", system: { equipped: "carried", description: { value: "<p>Options: Micro-Video</p>" } } }])));
  assert.ok(!hasMicroVideo(actor([{ name: "Smart Glasses", type: "gear", system: { equipped: "owned", description: { value: "MicroVideo" } } }])), "left in storage");
  assert.ok(!hasMicroVideo(actor([{ name: "MicroVideo", type: "cyberware", system: { isInstalled: true } }]), false), "the GM's word wins");
  assert.ok(hasMicroVideo(actor([]), true));
  assert.ok(retinaAllowed({ agent: true, internal: true }, false), "a carried Agent can always scan");
  assert.ok(!retinaAllowed({ agent: false, internal: true }, false));
  assert.ok(retinaAllowed({ agent: false, internal: true }, true));
});

test("a handprint: a failed round, a good one, a can't-move one; the GM confirms and voids; the record lands in the vault", async () => {
  game.time.worldTime = 500;
  const scan = await start({ id: "abcdefABCDEF0123" });
  assert.equal(scan.id, "abcdefABCDEF0123", "the phone's id, so it opens the scan at once");
  assert.deepEqual([scan.need, scan.skill, scan.dv, scan.side, scan.subjectActorId, scan.label], [3, "Brawling", 13, "left", "npc", "Kenji, lobby"]);
  const seen = appsFor(alice, store.apps).bioScans[scan.id];
  assert.ok(!("subjectActorId" in seen) && !("noticed" in seen), "players don't see who the subject is");

  // Without a roll card the host rolls: 1d10 2 + DEX 6 + 4 = 12, a fail; then 5 + 10 = 15.
  dice = [2, 5];
  await round(scan.id, {});
  assert.equal(scan.pips[0].status, "fail");
  assert.equal(scan.pips[0].roll.total, 12);
  await round(scan.id, {});
  assert.deepEqual(scan.pips.map(p => p.status), ["fail", "pending"]);
  const cardOne = gmCards().at(-1);
  assert.equal(cardOne.id, `bio:${scan.id}:1`);
  assert.deepEqual(cardOne.actions.map(a => a.request), ["bio-confirm", "bio-void", "bio-notice"]);
  assert.match(cardOne.body, /Kenji's left hand, round 1\/3: Brawling 15 vs DV 13/);
  await round(scan.id, { auto: true });
  assert.equal(scan.pips[2].auto, true);
  assert.equal(scan.pips[2].status, "pending");

  from(gm, "bio-void", { id: scan.id, index: 2 });
  await settle();
  assert.equal(scan.pips[2].status, "void");
  assert.match(lastAlert("pcA").text, /didn't count/);
  from(gm, "bio-confirm", { id: scan.id, index: 1 });
  from(gm, "bio-notice", { id: scan.id, noticed: true });
  await settle();
  // Two more good rounds, not in a row with the first.
  dice = [9, 9];
  await round(scan.id, {});
  await round(scan.id, {});
  from(gm, "bio-confirm", { id: scan.id, index: 3 });
  await settle();
  assert.equal(records().length, 0, "one round still waits");
  from(gm, "bio-confirm", { id: scan.id, index: 4 });
  await settle();
  assert.equal(scans().length, 0, "the scan is done");
  const [record] = records();
  assert.deepEqual([record.kind, record.side, record.method, record.subjectActorId, record.by, record.takenAt, record.scene, record.noticed], ["hand", "left", "direct", "npc", "pcA", 500, "Arasaka lobby", true]);
  assert.match(lastAlert("pcA").text, /Biometric record saved: Kenji, lobby/);
  const mine = appsFor(alice, store.apps).bioRecords[record.id];
  assert.ok(!("subjectActorId" in mine) && !("noticed" in mine) && !("stale" in mine));

  // Stale is the GM's; players see their record unchanged.
  from(gm, "bio-stale", { id: record.id, reason: "lock re-keyed" });
  await settle();
  assert.equal(record.stale.reason, "lock re-keyed");
  assert.ok(!("stale" in appsFor(alice, store.apps).bioRecords[record.id]));
  from(gm, "bio-unstale", { id: record.id });
  await settle();
  assert.ok(!record.stale);

  from(alice, "bio-rename", { id: record.id, label: "Kenji (right?) http://x.y" });
  await settle();
  assert.equal(record.label, "Kenji (right?)");
  from(alice, "bio-delete", { id: record.id });
  await settle();
  assert.equal(records().length, 0);
});

test("with confirm off a good roll counts at once; a complete print takes one Criminology scan", async () => {
  await game.settings.set("cpr-sam-agent", "bioscan", { confirm: false });
  const scan = await start({ method: "print", tokenId: null, label: "bar glass" });
  assert.deepEqual([scan.need, scan.skill, scan.side, scan.subjectActorId], [1, "Criminology", "left", null]);
  from(alice, "bio-round", { id: scan.id, auto: true });
  await settle();
  assert.equal(scan.pips.length, 0, "a print can't be 'automatic'");
  // A roll card the player just posted: its total counts.
  game.messages.set("m1", { author: alice, timestamp: Date.now() });
  await round(scan.id, { roll: { total: 16, detail: "7 + 5 INT + 4 skill", messageId: "m1" } });
  assert.equal(scans().length, 0);
  assert.equal(records()[0].method, "print");
  assert.equal(ChatMessage.created.length, 0, "the player's own card, no host roll");
});

test("refused: a selfie, a retina on an Internal Agent without MicroVideo (unless the GM says so), someone else's scan, a GM's rounds", async () => {
  await start({ tokenId: "t2" });
  assert.equal(scans().length, 0, "your own hand");
  from(alice, "bio-start", { actorId: "pcI", kind: "retina", method: "direct", tokenId: "t1", sceneId: "s1" });
  await settle();
  assert.equal(scans().length, 0);
  assert.match(lastAlert("pcI").text, /Needs MicroVideo/);
  from(alice, "bio-start", { actorId: "pcI", kind: "retina", method: "print" });
  await settle();
  assert.equal(scans().length, 0, "no prints of eyes");
  await game.settings.set("cpr-sam-agent", "bioscan", { microVideo: { pcI: true } });
  from(alice, "bio-start", { actorId: "pcI", kind: "retina", method: "direct", tokenId: "t1", sceneId: "s1" });
  await settle();
  const [retina] = scans();
  assert.deepEqual([retina.need, retina.side], [5, undefined]);

  const bob = addUser({ id: "bob" });
  from(bob, "bio-round", { id: retina.id });
  from(gm, "bio-round", { id: retina.id });
  from(bob, "bio-cancel", { id: retina.id });
  await settle();
  assert.equal(retina.pips.length, 0);
  assert.ok(store.apps.bioScans[retina.id]);
  from(alice, "bio-cancel", { id: retina.id });
  await settle();
  assert.equal(scans().length, 0);
});

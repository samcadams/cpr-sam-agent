import { addActor, addScene, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsFor, emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { bountyJob, cleanRecord, cleanResult, etaLabel, findRecord, lookupNumber, migrateRecords, ncpdConfig, ncpdReachable, recordSummary, searchRecords, shotUsable, skillBase } from "../apps/ncpd/model.js";
import { CATALOGUE_DEFAULTS, DEFAULT_LISTINGS } from "../apps/pool/model.js";
import { recordMessage, renderRecordSheet } from "../apps/ncpd/sheet.js";

/*
 * NCPD Crime Database (apps/ncpd/model.js, apps/ncpd/host.js): the record card's cleaning, the shot's roll
 * (DV, opposed, a new shot), world-time reminders to the GM, delivery with a saved record, and what
 * players can't see. Rolls and chat are faked here (the shared stub has neither).
 */

let gm, alice, dice;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const lookups = () => Object.values(store.apps.ncpdLookups);
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], system: { stats: { tech: { value: 6 }, int: { value: 7 } } } });
  addActor({ id: "npc", name: "Royce", type: "mook", system: { stats: { cool: { value: 8 } } }, items: [{ name: "Acting", type: "skill", system: { stat: "cool", level: 4 } }] });
  addScene({ tokens: [{ id: "t1", actorId: "npc", name: "Big Guy", texture: { src: "royce.webp" } }, { id: "t2", actorId: "pcA", name: "V", texture: { src: "v.webp" } }] });
  // Dice: the next d10s, in order (then 5s).
  dice = [];
  globalThis.Roll = class { constructor() {} async evaluate() { return { total: dice.length ? dice.shift() : 5 }; } };
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getSpeaker: () => ({}) };
  game.messages = new Map();
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("the record card: picks checked, lists bounded, blank rows dropped, aliases from text", () => {
  const r = cleanRecord({
    name: "  Royce ", aliases: "Big R, , The Boss", match: "", cautions: ["Armed and dangerous", "Armed and dangerous"],
    priors: [{ charge: "Assault", disposition: " ", sentence: "2 years", year: "2041" }, { charge: "" }],
    warrants: [{ charge: "Murder", issuer: "" }],
    bounties: [{ amount: "5000", terms: "", reason: "Murder" }, { amount: 0 }],
    priors2: "ignored"
  });
  assert.equal(r.name, "Royce");
  assert.deepEqual(r.aliases, ["Big R", "The Boss"]);
  assert.equal(r.match, "Positive", "a blank match is Positive");
  assert.deepEqual(r.cautions, ["Armed and dangerous"]);
  assert.deepEqual(r.priors, [{ charge: "Assault", year: "2041", disposition: "Convicted", sentence: "2 years" }]);
  assert.deepEqual(r.warrants, [{ charge: "Murder", issuer: "NCPD", issued: "" }]);
  assert.deepEqual(r.bounties, [{ amount: 5000, issuer: "NCPD", reason: "Murder", terms: "Dead or alive" }]);
  assert.equal(cleanRecord({ priors: Array.from({ length: 50 }, () => ({ charge: "Theft" })) }).priors.length, 12);
  assert.equal(recordSummary(r), "1 prior · 1 active warrant · bounty 5000eb");
  assert.equal(recordSummary(cleanRecord({ name: "Nobody" })), "Clean record");
  assert.deepEqual(cleanResult({ kind: "inconclusive" }), { kind: "inconclusive", reason: "Image quality" });
  assert.deepEqual(cleanResult({ kind: "hack" }), { kind: "none" });
});

test("helpers: request numbers, the ETA line, the shot vs DV or opposed, skill bases, a bounty as a Job", () => {
  assert.match(lookupNumber(), /^NCPD-\d{6}$/);
  assert.equal(etaLabel(3600), "results within 1 hr");
  assert.equal(etaLabel(42 * 60 - 5), "results within 42 min");
  assert.equal(etaLabel(-1), "results any minute now");
  assert.equal(shotUsable({ dv: 13 }), null);
  assert.equal(shotUsable({ dv: 13, roll: { total: 13 } }), true);
  assert.equal(shotUsable({ dv: 13, roll: { total: 12 } }), false);
  assert.equal(shotUsable({ dv: 13, roll: { total: 15 }, gm: { opposed: { total: 15 } } }), false, "ties go to the defender");
  assert.deepEqual(skillBase(game.actors.get("pcA"), "Photography/Film"), { stat: "tech", value: 6, level: 0, total: 6 });
  assert.equal(skillBase(game.actors.get("npc"), "Acting").total, 12);
  const record = cleanRecord({ name: "Royce", warrants: [{ charge: "Murder" }], bounties: [{ amount: 5000, reason: "Murder" }] });
  const job = bountyJob(record, record.bounties[0], "royce.webp");
  assert.equal(job.name, "Bounty: Royce");
  assert.ok(job.hidden, "hidden until the GM shows it");
  assert.match(job.description, /NCPD bounty on Royce: 5000eb, dead or alive\./);
  assert.match(job.description, /Active warrants: Murder\./);
});

test("App Store: 500eb in the store, once; no Coming soon card any more", () => {
  assert.deepEqual(CATALOGUE_DEFAULTS.ncpd, { publisher: "NCPD", price: 500, model: "once" });
  assert.ok(!DEFAULT_LISTINGS.some(l => l.id === "bc-ncpd"));
  assert.deepEqual(ncpdConfig({ minutes: "-3", dv: 99, skill: "" }), { minutes: 0, warn: 10, skill: "Photography/Film", dv: 40, nightCityOnly: true, nightCityDefault: true });
});

test("the shutter: heard quietly around the player's token on submit and on a new shot, not on a refused one", async () => {
  const played = [];
  const was = store._worldSound;
  store._worldSound = (member, path, opts) => played.push({ member, path, ...opts });
  try {
    from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t2", sceneId: "s1" }); // a selfie
    await settle();
    assert.equal(played.length, 0);
    from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
    await settle();
    assert.equal(played.length, 1);
    assert.deepEqual([played[0].member, played[0].path, played[0].blip, played[0].loop, played[0].volume], [{ actorId: "pcA" }, null, "shutter", false, 1 / 3]);
    assert.ok(played[0].radius >= 3);
    const [l] = lookups();
    from(gm, "ncpd-ask", { id: l.id, skill: "Photography/Film", dv: 15 });
    await settle();
    from(alice, "ncpd-roll", { id: l.id, roll: null });
    await settle();
    assert.equal(played.length, 2, "the new shot");
  } finally {
    store._worldSound = was;
  }
});

test("submit: a token in sight; the host rolls without a skill item; the GM gets the actor behind it", async () => {
  game.time.worldTime = 1000;
  dice = [8];
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1", seen: "", caption: "outside Lizzie's" });
  await settle();
  const [l] = lookups();
  assert.equal(l.status, "pending");
  assert.equal(l.img, "royce.webp", "the token's picture");
  assert.deepEqual(l.subject, { actorId: "npc", name: "Big Guy", tokenId: "t1", sceneId: "s1" });
  assert.equal(l.due, 1000 + 3600);
  assert.deepEqual([l.skill, l.dv, l.roll.total], ["Photography/Film", 13, 14], "1d10 8 + TECH 6 + no skill");
  assert.equal(ChatMessage.created.length, 1, "the roll's chat card");
  assert.match(gmCards().at(-1).body, /usable shot/);
  // Players don't see who the GM linked, nor the GM's notes.
  const mine = appsFor(alice, store.apps);
  assert.equal(mine.ncpdLookups[l.id].subject, undefined);
  assert.equal(mine.ncpdLookups[l.id].gm, undefined);
  assert.equal(mine.ncpdRecords && Object.keys(mine.ncpdRecords).length, 0);
});

test("no selfies, no strangers' requests, nothing for the GM's own phone", async () => {
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t2", sceneId: "s1" });
  from(gm, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  addUser({ id: "bob" });
  from(game.users.get("bob"), "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  assert.equal(lookups().length, 0);
});

test("GM: DV, opposed by the subject's Acting (whispered), a new shot with another skill", async () => {
  dice = [8];
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  const [l] = lookups();
  from(gm, "ncpd-dv", { id: l.id, dv: 17 });
  await settle();
  assert.equal(shotUsable(l), false, "14 vs DV 17");
  dice = [1, 3];
  from(gm, "ncpd-oppose", { id: l.id });
  await settle();
  assert.deepEqual([l.gm.opposed.skill, l.gm.opposed.total], ["Acting", 10], "1 − 3 + COOL 8 + Acting 4");
  assert.equal(shotUsable(l), true, "14 beats 10");
  assert.deepEqual(ChatMessage.created.at(-1).whisper, ["gm"]);
  from(gm, "ncpd-ask", { id: l.id, skill: "Perception", dv: 15 });
  await settle();
  assert.deepEqual(l.ask, { skill: "Perception", dv: 15 });
  assert.match(lastAlert("pcA").text, /Perception, DV 15/);
  dice = [9];
  from(alice, "ncpd-roll", { id: l.id });
  await settle();
  assert.deepEqual([l.skill, l.dv, l.roll.total, l.ask, l.gm.opposed], ["Perception", 15, 16, undefined, undefined], "9 + INT 7");
});

test("world time: the GM is reminded before and when it's due; nothing is delivered by itself", async () => {
  game.time.worldTime = 0;
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  const [l] = lookups();
  const cards = () => gmCards().filter(c => /NCPD results/.test(c.title)).map(c => c.title);
  game.time.worldTime = 1800;
  store._tickNcpd();
  assert.deepEqual(cards(), []);
  game.time.worldTime = 3000;
  store._tickNcpd();
  store._tickNcpd();
  assert.deepEqual(cards(), ["NCPD results soon: V"], "once");
  game.time.worldTime = 3700;
  store._tickNcpd();
  assert.deepEqual(cards(), ["NCPD results soon: V", "NCPD results due: V"]);
  assert.equal(l.status, "pending");
});

test("deliver: the record reaches the player, is kept on the subject, and NCPD can flag the lookup", async () => {
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  const [l] = lookups();
  const record = { name: "Royce", aliases: "Big R", warrants: [{ charge: "Murder" }], bounties: [{ amount: 5000 }], notes: "Leads the Maelstrom" };
  from(alice, "ncpd-deliver", { id: l.id, result: { kind: "record", record }, save: true });
  await settle();
  assert.equal(l.status, "pending", "only the GM delivers");
  from(gm, "ncpd-deliver", { id: l.id, result: { kind: "record", record }, save: true, flagged: true });
  await settle();
  assert.equal(l.status, "delivered");
  assert.equal(l.result.record.name, "Royce");
  assert.deepEqual(l.result.record.aliases, ["Big R"]);
  const [kept] = Object.values(store.apps.ncpdRecords);
  assert.deepEqual([kept.name, kept.actorId, kept.id in store.apps.ncpdRecords], ["Royce", "npc", true], "archived, linked to the subject");
  assert.equal(lastAlert("pcA").kind, "ncpd");
  assert.match(lastAlert("pcA").text, /record found\. Royce: 1 active warrant · bounty/);
  assert.ok(l.gm.flagged);
  assert.ok(gmCards().some(c => c.title === "NCPD flagged a lookup"));
  // Forget it; players clear their finished lookups.
  from(gm, "ncpd-forget", { id: kept.id });
  from(alice, "ncpd-clear", { actorId: "pcA" });
  await settle();
  assert.deepEqual(store.apps.ncpdRecords, {});
  assert.equal(lookups().length, 0);
});

test("inconclusive and no record; a picture lookup is linked by the GM", async () => {
  game.settings.set("cpr-sam-agent", "features", { images: true, playerImages: true });
  from(alice, "ncpd-submit", { actorId: "pcA", image: "worlds/x/agent-photos/snap.webp", caption: "the van driver" });
  await settle();
  const [l] = lookups();
  assert.equal(l.img, "worlds/x/agent-photos/snap.webp");
  assert.equal(l.subject, undefined);
  from(gm, "ncpd-link", { id: l.id, actorId: "npc" });
  await settle();
  assert.equal(l.subject.actorId, "npc");
  from(gm, "ncpd-deliver", { id: l.id, result: { kind: "inconclusive" }, save: true });
  await settle();
  assert.match(lastAlert("pcA").text, /inconclusive \(image quality\)/);
  assert.deepEqual(store.apps.ncpdRecords, {}, "only a record is kept");
});

test("flag after delivery: GM only, delivered only, one card per set, the player sees nothing", async () => {
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  const [l] = lookups();
  const flagCards = () => gmCards().filter(c => c.title === "NCPD flagged a lookup").length;
  from(gm, "ncpd-flag", { id: l.id, flagged: true });
  await settle();
  assert.ok(!l.gm.flagged, "not while pending");
  from(gm, "ncpd-deliver", { id: l.id, result: { kind: "none" } });
  await settle();
  const alerts = Object.keys(store.apps.alerts).length;
  from(alice, "ncpd-flag", { id: l.id, flagged: true });
  await settle();
  assert.ok(!l.gm.flagged, "players can't");
  from(gm, "ncpd-flag", { id: l.id, flagged: true });
  from(gm, "ncpd-flag", { id: l.id, flagged: true });
  await settle();
  assert.ok(l.gm.flagged);
  assert.equal(flagCards(), 1, "once per set");
  from(gm, "ncpd-flag", { id: l.id, flagged: false });
  await settle();
  assert.ok(!l.gm.flagged);
  assert.equal(flagCards(), 1, "no card when cleared");
  from(gm, "ncpd-flag", { id: l.id, flagged: true });
  await settle();
  assert.equal(flagCards(), 2);
  assert.equal(Object.keys(store.apps.alerts).length, alerts, "no alert to the player");
  assert.equal(appsFor(alice, store.apps).ncpdLookups[l.id].gm, undefined);
});

test("Night City only: a scene's flag, else the GM's default; refused submits take no lookup and no roll", async () => {
  const on = ncpdConfig({});
  assert.equal(ncpdReachable({ flags: {} }, on), true, "unmarked scenes are Night City by default");
  assert.equal(ncpdReachable({ flags: { "cpr-sam-agent": { nightCity: false } } }, on), false);
  assert.equal(ncpdReachable({ flags: { "cpr-sam-agent": { nightCity: true } } }, ncpdConfig({ nightCityDefault: false })), true);
  assert.equal(ncpdReachable({}, ncpdConfig({ nightCityDefault: false })), false);
  assert.equal(ncpdReachable({ flags: { "cpr-sam-agent": { nightCity: false } } }, ncpdConfig({ nightCityOnly: false })), true, "the check off");

  const scene = game.scenes.get("s1");
  scene.flags = { "cpr-sam-agent": { nightCity: false } };
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  assert.equal(lookups().length, 0);
  assert.equal(ChatMessage.created.length, 0, "no roll");
  assert.equal(lastAlert("pcA").text, "No NCPD uplink outside Night City.");
  game.settings.set("cpr-sam-agent", "ncpd", { nightCityOnly: false });
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  assert.equal(lookups().length, 1, "the check off");
  game.settings.set("cpr-sam-agent", "ncpd", {});
  scene.flags["cpr-sam-agent"].nightCity = true;
  from(alice, "ncpd-submit", { actorId: "pcA", tokenId: "t1", sceneId: "s1" });
  await settle();
  assert.equal(lookups().length, 2, "a Night City scene");
});

test("archive: records of their own, searchable, found by linked actor then name/alias; old rows migrate", async () => {
  // Older rows were keyed by actor id.
  store.apps.ncpdRecords = { npc: { name: "Royce", aliases: ["Big R"], affiliation: "Maelstrom", cautions: [], priors: [], warrants: [], bounties: [], notes: "" } };
  await store._ncpdLoad();
  const [old] = Object.values(store.apps.ncpdRecords);
  assert.notEqual(old.id, "npc");
  assert.equal(old.actorId, "npc");
  assert.equal(migrateRecords(store.apps.ncpdRecords, () => "x"), 0, "once");

  // A record with no token or actor; players can't make one.
  from(alice, "ncpd-record-save", { record: { name: "Ghost" } });
  from(gm, "ncpd-record-save", { record: { name: "Jenna Voss", aliases: "Ghost, J", affiliation: "Tyger Claws" } });
  from(gm, "ncpd-record-save", { record: { name: "" } });
  await settle();
  const records = store.apps.ncpdRecords;
  assert.equal(Object.keys(records).length, 2);
  const jenna = Object.values(records).find(r => r.name === "Jenna Voss");
  assert.equal(jenna.actorId, null);
  assert.deepEqual(searchRecords(records, "ghost").map(r => r.name), ["Jenna Voss"], "by alias");
  assert.deepEqual(searchRecords(records, "MAEL").map(r => r.name), ["Royce"], "by affiliation");
  assert.deepEqual(searchRecords(records).map(r => r.name), ["Jenna Voss", "Royce"]);
  assert.equal(findRecord(records, { actorId: "npc", name: "Jenna Voss" }).name, "Royce", "the linked actor first");
  assert.equal(findRecord(records, { name: "j" }).name, "Jenna Voss", "an exact alias");
  assert.equal(findRecord(records, { name: "Jen" }), null);
  assert.equal(Object.keys(appsFor(alice, store.apps).ncpdRecords ?? {}).length, 0, "players never see it");

  // A picture lookup delivered from the archived record updates it, not a copy.
  game.settings.set("cpr-sam-agent", "features", { images: true, playerImages: true });
  from(alice, "ncpd-submit", { actorId: "pcA", image: "worlds/x/agent-photos/snap.webp" });
  await settle();
  const [l] = lookups();
  from(gm, "ncpd-deliver", { id: l.id, result: { kind: "record", record: { ...jenna, notes: "Seen at Lizzie's" } }, save: true, recordId: jenna.id });
  await settle();
  assert.equal(Object.keys(records).length, 2);
  assert.equal(records[jenna.id].notes, "Seen at Lizzie's");
  assert.match(lastAlert("pcA").text, /record found\. Jenna Voss/);

  // Edit (link an actor), unknown ids refused, delete by id.
  from(gm, "ncpd-record-save", { id: jenna.id, record: records[jenna.id], actorId: "pcA" });
  from(gm, "ncpd-record-save", { id: "nope", record: { name: "X" } });
  await settle();
  assert.equal(records[jenna.id].actorId, "pcA");
  assert.equal(Object.keys(records).length, 2);
  from(gm, "ncpd-forget", { id: jenna.id });
  await settle();
  assert.deepEqual(Object.values(records).map(r => r.name), ["Royce"]);
});

/* The printed file (apps/ncpd/sheet.js). */

const filed = record => ({
  num: "NCPD-123456", date: "Apr 3, 2045", time: "21:10", img: "tokens/ganger (1).webp", caption: "outside the Afterlife",
  subject: { actorId: "npc", name: "THE REAL NAME" }, gm: { flagged: true, opposed: { skill: "Acting", total: 19, detail: "SECRET ROLL" } },
  result: { kind: "record", record: cleanRecord(record) }
});

test("the file prints every field of the record", () => {
  const html = renderRecordSheet(filed({
    name: "Jenna Voss", aliases: ["Ghost", "J"], match: "Probable", affiliation: "Tyger Claws", cautions: ["Armed and dangerous"],
    priors: [{ charge: "Arson", year: "2041", disposition: "Convicted", sentence: "2 years" }],
    warrants: [{ charge: "Murder", issuer: "NCPD", issued: "2045-03" }],
    bounties: [{ amount: 5000, issuer: "Militech", terms: "Alive", reason: "Data theft" }],
    notes: "Last seen in Watson."
  }), n => `${n} EB`);
  for (const text of ["NCPD-123456", "Apr 3, 2045 21:10", "outside the Afterlife", "Jenna Voss", "Ghost, J", "Tyger Claws", "Probable", "Armed and dangerous",
    "Arson", "2041", "Convicted", "2 years", "Murder", "2045-03", "5000 EB", "Militech", "Alive", "Data theft", "Last seen in Watson."]) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes('src="tokens/ganger (1).webp"'), "the photo as the phone shows it, odd file names too");
  assert.match(html, /ncpd-file wanted/);
  assert.match(html, /ncpd-file-stamp/);
});

test("the file never prints who the GM linked or the GM's notes", () => {
  const html = renderRecordSheet(filed({ name: "Jenna Voss" }));
  assert.doesNotMatch(html, /THE REAL NAME|SECRET ROLL|Acting/);
});

test("a clean record: no stamp, no empty sections, priors say none", () => {
  const html = renderRecordSheet(filed({ name: "Jenna Voss" }));
  assert.doesNotMatch(html, /ncpd-file wanted|ncpd-file-stamp|ncpd-file-cautions|Active warrants|Bounties|Remarks/);
  assert.match(html, /None on file\./);
  assert.match(html, /<dt>Affiliation<\/dt><dd>N\/A<\/dd>/);
});

test("the file escapes what the GM and the player typed", () => {
  const lookup = filed({ name: "<img src=x onerror=alert(1)>", notes: "<script>x</script>", priors: [{ charge: "<b>Arson</b>" }] });
  lookup.caption = `"><script>y</script>`;
  const html = renderRecordSheet(lookup);
  assert.doesNotMatch(html, /<script|<img src=x|<b>Arson/);
});

test("the text to a contact: who, the summary, warrants and cautions, never the GM's", () => {
  const text = recordMessage(filed({
    name: "Jenna Voss", aliases: ["Ghost"], affiliation: "Tyger Claws", cautions: ["Armed and dangerous"],
    priors: [{ charge: "Arson" }], warrants: [{ charge: "Murder" }], bounties: [{ amount: 5000, issuer: "Militech" }]
  }), n => `${n} EB`);
  assert.equal(text, "NCPD record NCPD-123456: Jenna Voss (a.k.a. Ghost), Tyger Claws\n1 prior · 1 active warrant · bounty 5000 EB\nActive warrants: Murder\nCaution: Armed and dangerous");
  assert.equal(recordMessage(filed({})), "NCPD record NCPD-123456: Unnamed\nClean record");
});

import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { store } from "../scripts/store.js";
import { api } from "../scripts/api.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, gardenFor, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import {
  cleanCorp, cleanProfile, contextKeywords, fillReaction, keywordChips, keywordList, matchAccounts, parseSpan, parseWhen, pcKeywords, spanText, stirFits, stirPlan,
  stirPreview, STIR_COUNT, suggestKeywords, whenText, writerCharacters
} from "../apps/garden/writer.js";

const lists = Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))]));
setGardenLists(lists);

/*
 * The Garden's writer side (apps/garden/writer.js, writer-host.js): profiles, corps, formats, feeds,
 * happenings with Stir, seeds, the cast's own replies, and when characters last opened the Garden.
 */

let gm, alice;
beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"] });
  addActor({ id: "pcB", name: "Kade", owners: ["alice"] });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null
  });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

const settle = () => store._enqueue(() => {});
/** A socket request as `user` would send it. */
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const account = handle => Object.values(store.garden.accounts).find(a => a.handle === handle);

test("profiles: keywords from text, everything else cleaned; corps' relations by name", () => {
  assert.deepEqual(keywordList("Watson, #Kabuki;  noodles\nwatson"), ["watson", "kabuki", "noodles"]);
  const p = cleanProfile({ keywords: "Watson, Tyger Claws", cadence: "nonsense", lines: "too hot today\npay first | talk later", junk: 1 });
  assert.deepEqual(p.keywords, ["watson", "tyger claws"]);
  assert.equal(p.cadence, "sometimes");
  assert.deepEqual(p.lines, ["too hot today", "pay first", "talk later"]);
  assert.ok(!("junk" in p));
  const corp = cleanCorp({ tier: "megacorp", relations: [{ actor: "Kade", kind: "employer", note: "Ms. Ito" }, { actor: "Nobody", kind: "rival" }], calendar: [{ wt: 50, what: "launch" }, { wt: "x", what: "bad" }] },
    ref => (ref === "Kade" ? "pcB" : null));
  assert.deepEqual(corp.relations, [{ actorId: "pcB", kind: "employer", note: "Ms. Ito" }]);
  assert.equal(corp.calendar.length, 1);
  assert.deepEqual(pcKeywords({ role: "Exec", hq: "The Dock", cyberware: ["Kiroshi Optics"] }), ["exec", "the dock", "kiroshi optics"]);
});

test("spans and formats read as typed", () => {
  assert.equal(parseSpan("+1d4h20m"), 86400 + 4 * 3600 + 1200);
  assert.equal(parseSpan("4d 2h"), 4 * 86400 + 7200);
  assert.equal(parseSpan("-3h"), -10800);
  assert.equal(parseSpan("90"), 5400);
  assert.equal(parseSpan("soon"), null);
  assert.equal(spanText(4 * 86400 + 7200), "+4d2h");
  assert.equal(spanText(-60), "-1m");
  assert.equal(parseSpan(spanText(93_600)), 93_600);
  assert.deepEqual(parseWhen("Daily 7:00"), { every: "daily", time: "07:00" });
  assert.deepEqual(parseWhen("weekly thursday 20:00"), { every: "weekly", day: "thu", time: "20:00" });
  assert.deepEqual(parseWhen("after violent nights"), { every: "violent" });
  assert.equal(parseWhen("weekly someday 20:00"), null);
  assert.equal(whenText(parseWhen("weekly thu 20:00")), "weekly Thu 20:00");
});

test("keywords: the place, who, then words the Garden knows, then the rest", () => {
  const k = suggestKeywords({ what: "The Tyger Claws shot up a noodle stand", place: "Watson", names: ["v"], known: ["tyger claws", "noodle"] });
  assert.deepEqual(k.slice(0, 4), ["watson", "v", "tyger claws", "noodle"]);
  assert.ok(k.includes("shot") && !k.includes("the"));
  const accounts = {
    a: { id: "a", handle: "@mae", writer: { keywords: ["watson", "noodles"] } },
    b: { id: "b", handle: "@ink", writer: { keywords: ["kabuki"], reacts: ["shooting"] } },
    c: { id: "c", handle: "@v", actorId: "pcA", writer: { keywords: ["watson"] } }
  };
  assert.deepEqual(matchAccounts(["watson", "noodle"], accounts).map(m => m.account.handle), ["@mae"], "characters' own accounts never speak for the writer");
});

test("Stir: as many reactions as the heat says, from fitting accounts first, blanks filled", () => {
  assert.equal(fillReaction("riot at {place}", { place: "" }), null);
  assert.equal(fillReaction("the {thing}!", { thing: "shootout" }), "the shootout!");
  let seq = 0;
  const rand = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);
  const accounts = { mae: { id: "mae", handle: "@mae", kind: "citizen", mood: "hype", writer: { keywords: ["watson"] } } };
  const citizens = [{ id: "c1", handle: "@c1", kind: "citizen", mood: "hater" }, { id: "c2", handle: "@c2", kind: "citizen" }];
  for (const heat of ["small", "citywide"]) {
    const plan = stirPlan({ heat, place: "Watson", keywords: ["watson", "shootout"] }, { accounts, citizens, lists, rand });
    const [lo, hi] = STIR_COUNT[heat];
    assert.ok(plan.length >= Math.min(lo, 1) && plan.length <= hi, `${heat}: ${plan.length}`);
    assert.equal(plan[0].accountId, "mae", "whose keywords fit speaks first");
    for (const p of plan) {
      assert.ok(!p.text.includes("{"), p.text);
      assert.ok(p.delay >= 0 && p.delay <= 3600 && p.realDelay <= 4 * 60_000);
    }
    assert.equal(new Set(plan.map(p => p.text)).size, plan.length, "no line twice");
  }
});

test("Log an event: saved for the writer; Stir queues chatter that goes out on real minutes while the clock stands still", async () => {
  await api.garden.logEvent({ what: "Shootout behind the Totentanz", place: "Totentanz", who: ["V"], heat: "big", keywords: "totentanz, shootout", stir: true, thing: "shootout" });
  const [h] = Object.values(store.garden.happenings);
  assert.deepEqual([h.what, h.place, h.who, h.heat, h.stage, h.public], ["Shootout behind the Totentanz", "Totentanz", ["pcA"], "big", "new", true]);
  const stirred = store.garden.queue.filter(q => q.stir === h.id);
  assert.ok(stirred.length >= STIR_COUNT.big[0] && stirred.length <= STIR_COUNT.big[1]);
  // World time stands still (SmallTime off: real clock here, so make them due on real time only).
  for (const q of stirred) [q.wt, q.realAt] = [q.wt + 1e9, Date.now() - 1];
  await store._tickGarden();
  assert.equal(store.garden.queue.filter(q => q.stir === h.id).length, 0, "out on real minutes");
  assert.ok(Object.values(store.garden.posts).some(p => /shootout/i.test(p.text) || /Totentanz/.test(p.text)));
  // Moving it on, and the pop-up's edit keep the rest.
  from(gm, "garden-happening", { happening: { id: h.id, stage: "cooling" } });
  await settle();
  assert.deepEqual([store.garden.happenings[h.id].stage, store.garden.happenings[h.id].what], ["cooling", h.what]);
  await assert.rejects(api.garden.logEvent({ what: " " }), /Say what happened/);
});

test("seeds, formats, feeds and the mix: GM-only, cleaned", async () => {
  await api.garden.plantSeed({ what: "Militech crates at the docks", keywords: ["docks", "militech"], obvious: "clear", by: 2 * 86400, sources: ["@network54"] });
  const [s] = Object.values(store.garden.seeds);
  assert.deepEqual([s.obvious, s.keywords, s.sources.length, s.stage], ["clear", ["docks", "militech"], 1, "new"]);
  assert.ok(s.by > Date.now() / 1000 + 86400);
  const n54 = account("@network54");
  from(gm, "garden-format", { format: { accountId: n54.id, when: "daily 7:00", what: "headlines" } });
  from(gm, "garden-format", { format: { accountId: n54.id, when: "sometimes", what: "bad" } });
  from(gm, "garden-feed", { app: "weather", feed: { on: true, keywords: "acid rain", accounts: [n54.id, "nope"] } });
  from(gm, "garden-feed", { app: "nothing", feed: { on: true } });
  from(gm, "garden-mix", { mix: { city: 1, close: 1, about: 2 } });
  from(alice, "garden-format", { format: { accountId: n54.id, when: "daily 08:00" } });
  await settle();
  const w = store.garden.writer;
  assert.deepEqual(w.formats.map(f => f.when), ["daily 07:00"]);
  assert.deepEqual(w.feeds, { weather: { on: true, keywords: ["acid rain"], accounts: [n54.id] } });
  assert.deepEqual(w.mix, { city: 25, close: 25, about: 50 });
  from(gm, "garden-format", { format: { id: w.formats[0].id }, remove: true });
  await settle();
  assert.equal(store.garden.writer.formats.length, 0);
});

test("profiles: accounts' and characters'; the cast's own lines are their replies; players see none of it", async () => {
  const n54 = account("@network54");
  from(gm, "garden-writer-profile", { accountId: n54.id, profile: { keywords: "watson", agenda: "secret plan", lines: ["NEWS AT ELEVEN", "back to you"] } });
  from(gm, "garden-writer-profile", { actorId: "pcB", profile: { keywords: "raven, exec" } });
  from(alice, "garden-writer-profile", { actorId: "pcA", profile: { keywords: "hacked" } });
  await settle();
  assert.deepEqual(store.garden.accounts[n54.id].writer.keywords, ["watson"]);
  assert.deepEqual(store.garden.writer.pcs, { pcB: store.garden.writer.pcs.pcB });
  // A post that's fully grown at once, with one of their keywords: the cast member (no mood, own
  // lines) is among who replies (news and corps never auto-reply: make the newsdesk a citizen).
  n54.kind = "citizen";
  const zig = account("@ziggurat_trends");
  await store._publish(zig, { text: "trend in Watson", tier: "explosive", wt: Date.now() / 1000 - 86400 });
  for (const a of Object.values(store.garden.accounts)) if (a !== n54) a.mood = null; // only the cast can reply
  await store._tickGarden();
  const post = Object.values(store.garden.posts).find(p => p.text === "trend in Watson");
  // Their own lines (once per thread: one of them).
  const theirs = post.replies.filter(r => r.accountId === n54.id).map(r => r.text);
  assert.equal(theirs.length, 1);
  assert.ok(["NEWS AT ELEVEN", "back to you"].includes(theirs[0]), theirs[0]);
  // The player's view: no profiles, agendas, happenings, seeds or who looked when.
  await api.garden.logEvent({ what: "GM-only thing", public: false });
  const view = gardenFor(alice, store.garden);
  assert.equal(view.accounts[n54.id].writer, undefined);
  assert.deepEqual([view.happenings, view.seeds, view.seen, view.writer.pcs], [{}, {}, {}, {}]);
});

test("garden-seen: the character's owner opening the Garden is noted (Garden and real time)", async () => {
  from(alice, "garden-seen", { actorId: "pcA" });
  from(alice, "garden-seen", { actorId: "nobody" });
  await settle();
  const seen = store.garden.seen;
  assert.deepEqual(Object.keys(seen), ["pcA"]);
  assert.ok(Math.abs(seen.pcA.wt - Date.now() / 1000) < 5 && seen.pcA.ts <= Date.now());
  from(gm, "garden-seen", { actorId: "pcB" });
  await settle();
  assert.ok(!seen.pcB, "a GM looking isn't the character looking");
});


test("auto keywords: known ones found in what, the place, the scene and who was there, whole words, any case", () => {
  const known = ["watson", "tyger claws", "claws", "noodles", "raven", "ops", "kiroshi optics", "dock"];
  assert.deepEqual(contextKeywords({ what: "The TYGER CLAWS shook down Mae's noodles stand", place: "Kabuki" }, known), ["kabuki", "tyger claws", "claws", "noodles"]);
  // Whole words only: "optics" doesn't make "ops", "docks" doesn't make "dock".
  assert.deepEqual(contextKeywords({ what: "Raven optics crates at the docks" }, known), ["raven"]);
  // The scene's and journal's names, and the profile keywords of who was there.
  assert.deepEqual(contextKeywords({ what: "a fight", context: ["Watson Market"], pcKeywords: ["kiroshi optics", "exec"] }, known), ["watson", "kiroshi optics"]);
  assert.deepEqual(contextKeywords({ what: "" }, known), []);
  assert.equal(contextKeywords({ what: known.join(" ") }, known, 3).length, 3);
  // Regex characters in keywords are plain text.
  assert.deepEqual(contextKeywords({ what: "the 24/7 (c++) shop" }, ["24/7", "c++"]), ["24/7", "c++"]);
});

test("Stir preview and keyword chips: the same accounts Stir picks", () => {
  const accounts = {
    mae: { id: "mae", handle: "@mae", kind: "citizen", writer: { keywords: ["watson", "noodles"] } },
    n54: { id: "n54", handle: "@n54", kind: "news", writer: { keywords: ["watson"], reacts: ["shootout"] } },
    rav: { id: "rav", handle: "@raven", kind: "corp", writer: { keywords: [] }, corp: { assets: ["optics lab"] } },
    vex: { id: "vex", handle: "@vex", kind: "pc", actorId: "pcA", writer: { keywords: ["watson"] } }
  };
  assert.deepEqual(stirFits(["watson", "noodles"], accounts).map(a => a.id), ["mae", "n54"]);
  const p = stirPreview("Watson, shootout", accounts, "small");
  assert.deepEqual(p.fits, ["@n54", "@mae"]);
  assert.match(p.text, /^Would stir: @n54, @mae \(2 accounts\)\.$/);
  assert.match(stirPreview("watson", accounts, "big").text, /2 accounts\), then random citizens, 5–8 reactions/);
  assert.equal(stirPreview("nothing here", accounts).text, "No account reacts to these words; Stir will use random citizens.");
  // Stir itself picks them in that order.
  const plan = stirPlan({ heat: "small", place: "", keywords: ["watson", "shootout"] }, { accounts, citizens: [], lists, rand: () => 0 });
  assert.equal(plan[0].accountId, "n54");
  const chips = keywordChips({ accounts, writer: { pcs: { pcA: { keywords: ["exec"] } } } });
  assert.deepEqual(chips.map(c => c.keyword), ["noodles", "optics lab", "shootout", "watson", "exec"]);
  assert.deepEqual(chips.find(c => c.keyword === "watson").handles, ["@mae", "@n54"]);
  assert.deepEqual(chips.at(-1).handles, [], "a character's keyword stirs no one");
});

test("the writer's characters: the GM takes players' characters off the list and puts them back", async () => {
  addActor({ id: "pcT", name: "Claude1 Nomad", owners: ["alice"] });
  const actors = [{ id: "pcA" }, { id: "pcB" }, { id: "pcT" }];
  assert.deepEqual(writerCharacters(actors, { ignore: ["pcT"] }).map(a => a.id), ["pcA", "pcB"]);
  assert.deepEqual(writerCharacters(actors, undefined).length, 3);
  from(gm, "garden-writer-characters", { actorId: "pcT", ignore: true });
  from(gm, "garden-writer-characters", { actorId: "nobody", ignore: true });
  await settle();
  assert.deepEqual(store.garden.writer.ignore, ["pcT"]);
  from(alice, "garden-writer-characters", { ignore: ["pcA"] });
  await settle();
  assert.deepEqual(store.garden.writer.ignore, ["pcT"], "players can't");
  from(gm, "garden-writer-characters", { ignore: ["pcB", "pcT", "pcB", "ghost"] });
  await settle();
  assert.deepEqual(store.garden.writer.ignore, ["pcB", "pcT"]);
  from(gm, "garden-writer-characters", { actorId: "pcB", ignore: false });
  await settle();
  assert.deepEqual(store.garden.writer.ignore, ["pcT"]);
  // The writer pack leaves them out.
  const pack = store._buildPack();
  assert.deepEqual(pack.pcs.map(p => p.actorId).sort(), ["pcA", "pcB"]);
  assert.deepEqual(gardenFor(alice, store.garden).writer.ignore, [], "players see none of it");
});

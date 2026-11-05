import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsFor, emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import {
  activeTerms, canReach, clipFields, depthOf, DESK, gardenSuggestion, isFrontPage, journalDraft, matches, parseLine, repDepth, screamsheetPool, surfaced, watchTerms
} from "../apps/screamsheet/model.js";
import { cleanSheet, contrast, inkOn, newBlock, newSheet, renderSheet, safeSrc, sheetText, summary, switchOutlet, teaser } from "../apps/screamsheet/render.js";
import { clipRequest, clipSheet, clipTags, runClip } from "../apps/screamsheet/ai.js";

/*
 * DataPool (apps/screamsheet): the sheet renderer (escaping, unsafe images, cleaning what the GM sends), the
 * crawl's rules (watchlists, matching, depth, reach), journal entries as a source, what players may see,
 * and the host's flows: publish and the passive crawl, the deep crawl and the GM's confirm, suggestions
 * from Reputation events and viral Garden posts.
 */

let gm, alice, bob, dice;

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const clips = () => Object.values(store.apps.screamClips);
const alertsOf = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts);
const gmCards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]);

/** A clipping as the desk would save it. */
const clip = (over = {}) => ({ sheet: newSheet("n54", [newBlock("headline", { text: over.headline ?? "Gang war in Watson" }), newBlock("paragraph", { text: over.text ?? "Maelstrom and the Tyger Claws traded fire." })]), ...over });

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "Vex Ramos", owners: ["alice"], system: { stats: { int: { value: 6 } }, reputation: { value: 2, transactions: [] } } });
  addActor({ id: "pcB", name: "Juno", owners: ["bob"], system: { stats: { int: { value: 5 } }, reputation: { value: 0, transactions: [] } } });
  addActor({ id: "npc", name: "Rogue", type: "mook" });
  game.settings.set("cpr-sam-agent", "features", { app_screamsheet: true });
  dice = [];
  globalThis.Roll = class { constructor() {} async evaluate() { return { total: dice.length ? dice.shift() : 5 }; } };
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); }, getSpeaker: () => ({}), getWhisperRecipients: () => [] };
  game.messages = new Map();
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

/* ---------- the sheet ---------- */

test("the sheet: text escaped, unsafe images dropped, empty images only in the GM's preview", () => {
  const sheet = newSheet("street", [
    newBlock("headline", { text: "<script>alert(1)</script>" }),
    newBlock("image", { src: "javascript:alert(1)" }),
    newBlock("quote", { text: "  " }),
    newBlock("ad", { bg: "red;background:url(x)", copy: "BUY" })
  ]);
  const html = renderSheet(sheet);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("NO IMAGE") && renderSheet(sheet, { editing: true }).includes("NO IMAGE"));
  assert.ok(!html.includes("“”"), "an empty quote draws nothing");
  assert.ok(html.includes("--ad-bg:#ffffff") && !html.includes("url(x)"), "a bad colour falls back");
  assert.equal(safeSrc("worlds/x/a.webp"), "worlds/x/a.webp");
  assert.equal(safeSrc("x\" onerror=\"1"), "");
  assert.equal(inkOn("#00e0ff"), "#111111");
  assert.ok(contrast("#000000", "#ffffff") > 20);
});

test("the sheet: cleaned for the host (unknown blocks, bad fields, long text), round-trips through JSON", () => {
  const raw = {
    outlet: "nope", background: "javascript:x",
    masthead: { columns: 9, paper: "silk", brand: { accent: "pink", desks: ["A", "", "B"] } },
    blocks: [{ type: "evil", html: "<b>" }, { type: "headline", text: "x".repeat(500), size: "giant" }, { type: "columns", left: { kind: "image", src: "a/b.png" }, right: "nope" }]
  };
  const s = cleanSheet(raw);
  assert.equal(s.outlet, "custom");
  assert.equal(s.background, "");
  assert.equal(s.masthead.columns, 3);
  assert.equal(s.masthead.paper, "clean");
  assert.equal(s.masthead.brand.accent, "#00e0ff");
  assert.deepEqual(s.masthead.brand.desks, ["A", "B"]);
  assert.deepEqual(s.blocks.map(b => b.type), ["headline", "columns"]);
  assert.equal(s.blocks[0].text.length, 300);
  assert.equal(s.blocks[0].size, "lead");
  assert.equal(s.blocks[1].left.src, "a/b.png");
  assert.equal(s.blocks[1].right.kind, "text");
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(cleanSheet(s), s, "cleaning is stable");
});

test("the sheet: summary, searchable text, switching outlets keeps the blocks", () => {
  const sheet = clip({ headline: "WHO'S VEX?" }).sheet;
  sheet.masthead.ticker = "Breaking: Arasaka";
  assert.equal(summary(sheet).headline, "WHO'S VEX?");
  assert.equal(summary(sheet).outlet, "N54 NEWS");
  assert.match(sheetText(sheet), /Arasaka[\s\S]*Maelstrom/);
  const street = switchOutlet(sheet, "street");
  assert.equal(street.outlet, "street");
  assert.equal(street.masthead.ticker, "Breaking: Arasaka");
  assert.equal(street.blocks, sheet.blocks);
  assert.ok(renderSheet(switchOutlet(sheet, "board")).includes("ss-mast-board"));
});

test("the sheet: masthead styles per outlet, kept by cleaning, drawn only on the desks layout", () => {
  assert.equal(newSheet("wns").masthead.brand.style, "wire");
  assert.equal(newSheet("blotter").masthead.brand.style, "bulletin");
  const flick = cleanSheet(newSheet("flickin"));
  assert.equal(flick.outlet, "flickin", "Flick's blog is a preset, not custom");
  assert.equal(flick.masthead.brand.style, "blog");
  assert.equal(flick.masthead.brand.name, "WHAT'S FLICKIN IN NC?");
  assert.equal(cleanSheet({ outlet: "nope", masthead: { brand: { style: "blog" } } }).masthead.brand.style, "blog");
  assert.equal(cleanSheet({ outlet: "n54", masthead: { brand: { style: "neon" } } }).masthead.brand.style, "site", "an unknown style falls back to the outlet's");
  assert.equal(cleanSheet({ outlet: "custom", masthead: { brand: {} } }).masthead.brand.style, "site", "old sheets without one stay as they were");

  const sheet = clip().sheet;
  sheet.masthead.ticker = "Arasaka down 4%";
  assert.ok(renderSheet(sheet).includes("ss-style-site") && renderSheet(sheet).includes("▸ Arasaka"), "site keeps its arrow, no label");
  sheet.masthead.brand.style = "broadsheet";
  const html = renderSheet(sheet);
  assert.ok(html.includes("ss-style-broadsheet") && html.includes('class="ss-ticker-label">Latest</b>'));
  assert.ok(html.indexOf("ss-mast-desks") < html.indexOf("ss-status"), "a broadsheet's date line sits under the nameplate");
  const board = renderSheet(switchOutlet(sheet, "board"));
  assert.ok(!board.includes("ss-style-") && !board.includes("ss-ticker-label"), "the board keeps its own masthead");
});

/* ---------- the crawl's rules ---------- */

test("watchlists: automatic terms, aliases and extras without repeats, muted ones not searched", () => {
  const terms = watchTerms({ name: "Vex Ramos", handle: "@vexr", crews: ["The Kiosk"], aliases: ["Vex", "vex "], extra: ["Maelstrom", "maelstrom", "x"], muted: ["The Kiosk"] });
  assert.deepEqual(terms.map(t => [t.term, t.kind, t.auto, t.muted]), [
    ["Vex Ramos", "name", true, false], ["@vexr", "handle", true, false], ["The Kiosk", "crew", true, true], ["Vex", "alias", false, false], ["Maelstrom", "extra", false, false]
  ], "what the player added (aliases too) is dropped with a tap, not muted");
  assert.deepEqual(activeTerms(terms), ["Vex Ramos", "@vexr", "Vex", "Maelstrom"]);
});

test("matching: whole words, handles with or without @, subjects, a crewmate's clipping through the crew name", () => {
  const c = { sheet: clip({ text: "vexr was seen at the Afterlife with Rogue." }).sheet, subjects: ["pcB"], tags: [] };
  const ctx = { names: { pcB: "Juno" }, crews: { pcB: ["The Kiosk"] } };
  assert.ok(matches(c, "pcA", ["@vexr"], ctx), "the handle without its @");
  assert.ok(matches(c, "pcA", ["afterlife"], ctx), "any case");
  assert.ok(!matches(c, "pcA", ["Rog"], ctx), "whole words only");
  assert.ok(matches(c, "pcA", ["The Kiosk"], ctx), "a subject's crew");
  assert.ok(matches(c, "pcB", [], ctx), "its subjects always");
  assert.ok(matches({ ...c, tags: ["Arasaka"] }, "pcA", ["arasaka"], ctx), "tags");
});

test("depth and reach: the passive crawl gets Headlines, a roll reaches its DV, subjects-only stays with the crew", () => {
  const pub = (id, dv, over = {}) => ({ id, status: "published", dv, subjects: [], tags: ["Watson"], sheet: clip().sheet, pub: dv, ...over });
  const all = { a: pub("a", 0), b: pub("b", 13), c: pub("c", 15), d: pub("d", 17), e: { ...pub("e", 0), status: "draft" }, f: pub("f", 0, { actorIds: ["pcA"] }) };
  assert.deepEqual(surfaced(all, "pcA", ["Watson"], 0).map(c => c.id), ["a"]);
  assert.deepEqual(surfaced(all, "pcA", ["Watson"], 15).map(c => c.id), ["c", "b", "a"]);
  assert.deepEqual(surfaced(all, "pcA", ["Kabuki"], 30), []);
  const secret = pub("s", 0, { reach: "subjects", subjects: ["pcB"] });
  assert.ok(!canReach(secret, "pcA", { mates: {} }));
  assert.ok(canReach(secret, "pcA", { mates: { pcA: ["pcB"] } }));
  assert.ok(canReach(secret, "pcB"));
  assert.equal(depthOf(19).name, "Ghost");
  assert.equal(depthOf(14).name, "Buried");
  assert.deepEqual([repDepth(4), repDepth(-2), repDepth(1)], [0, 13, 15]);
  assert.ok(isFrontPage({ status: "published", dv: 0, reach: "public" }));
  assert.ok(!isFrontPage({ status: "published", dv: 13, reach: "public" }));
  assert.ok(!isFrontPage({ status: "published", dv: 0, reach: "subjects" }));
});

test("the clipping's fields: subjects must exist, Reputation only for subjects, bounds", () => {
  const f = clipFields({ subjects: ["pcA", "ghost", "pcA"], dv: 99, reach: "x", spin: "hit", tags: "alpha, beta, Alpha", rep: [{ actorId: "pcA", delta: 40, reason: "r" }, { actorId: "npc", delta: 1 }, { actorId: "pcA", delta: 0 }] }, id => !!game.actors.get(id));
  assert.deepEqual(f.subjects, ["pcA"]);
  assert.equal(f.dv, 30);
  assert.equal(f.reach, "public");
  assert.equal(f.spin, "hit");
  assert.deepEqual(f.tags, ["alpha", "beta"]);
  assert.deepEqual(f.rep, [{ actorId: "pcA", delta: 10, reason: "r" }]);
});

test("journal entries: the Screamsheet: line, the folder, secrets dropped", () => {
  assert.deepEqual(parseLine(" N54, DV 13, subjects: Vex Ramos, Juno, tags: Watson"), { outlet: "n54", dv: 13, subjects: ["Vex Ramos", "Juno"], tags: ["Watson"] });
  assert.equal(parseLine("street sheet, dv 15").outlet, "street");
  const page = html => ({ type: "text", text: { content: html } });
  const entries = [
    { id: "j1", name: "Shootout at the Afterlife", folder: null, pages: [page("<p>Screamsheet: wns, DV 13, subjects: Vex Ramos</p><p>Shots fired.</p><section class=\"secret\"><p>It was Rogue.</p></section>")] },
    { id: "j2", name: "Weather", folder: { name: "Screamsheets", folder: null }, pages: [page("<p>Acid rain all week.</p>")] },
    { id: "j3", name: "Unrelated", folder: null, pages: [page("<p>Nothing here.</p>")] }
  ];
  const pool = screamsheetPool(entries);
  assert.deepEqual(pool.map(j => [j.id, j.outlet, j.dv]), [["j1", "wns", 13], ["j2", "wns", 0]]);
  assert.equal(pool[0].text, "Shots fired.");
  const draft = journalDraft(pool[0], name => (name === "Vex Ramos" ? "pcA" : null));
  assert.deepEqual(draft.subjects, ["pcA"]);
  assert.equal(summary(draft.sheet).headline, "Shootout at the Afterlife");
  assert.equal(draft.source.kind, "journal");
});

test("a viral Garden post: an 'As seen on The Garden' pickup about its author and the post's Reputation subjects", () => {
  const s = gardenSuggestion({ id: "p1", text: "lol", tier: "viral", rep: [{ actorId: "pcB", delta: 1 }] }, { handle: "@vexr", actorId: "pcA" });
  assert.deepEqual(s.subjects, ["pcA", "pcB"]);
  assert.equal(s.sheet.outlet, "board");
  assert.match(summary(s.sheet).headline, /@vexr goes viral/);
});

/* ---------- the host ---------- */

test("players see the Front Page and what they pulled; drafts, GM fields and proposed finds stay on the host", async () => {
  from(gm, "scream-save", { clip: clip({ title: "secret title", notes: "gm note", text: "Vex Ramos spotted." }) });
  from(gm, "scream-save", { clip: clip({ headline: "Public headline", text: "Nothing about anyone." }), publish: true });
  from(gm, "scream-save", { clip: clip({ headline: "About Vex", text: "Vex Ramos again.", dv: 13 }), publish: true });
  await settle();
  const [draft, front, buried] = clips().sort((a, b) => a.ts - b.ts);
  assert.equal(draft.status, "draft");
  assert.ok(front.everyone && !buried.everyone);
  store._crawlRow("pcA").found = [buried.id];
  buried.actorIds = ["pcA"];
  const mine = appsFor(alice, store.apps);
  assert.deepEqual(Object.keys(mine.screamClips).sort(), [front.id, buried.id].sort());
  assert.ok(!("title" in mine.screamClips[buried.id]) && !("notes" in mine.screamClips[buried.id]) && !("source" in mine.screamClips[buried.id]));
  assert.ok(!("found" in mine.screamCrawls.pcA), "the deep crawl's proposal is the GM's");
  assert.ok(!(DESK in mine.screamCrawls));
  assert.deepEqual(Object.keys(appsFor(bob, store.apps).screamClips), [front.id]);
  assert.equal(Object.keys(appsFor(gm, store.apps).screamClips).length, 3);
});

test("publishing: the passive crawl pulls matching Headlines, alerts once, and the hook fires", async () => {
  from(alice, "scream-terms", { actorId: "pcA", extra: ["Maelstrom"] });
  from(bob, "scream-terms", { actorId: "pcA", extra: ["hijack"] });
  await settle();
  assert.deepEqual(store.apps.screamCrawls.pcA.extra, ["Maelstrom"], "only the owner edits a watchlist");
  from(gm, "scream-save", { clip: clip(), publish: true });
  await settle();
  const c = clips()[0];
  assert.deepEqual(c.actorIds, ["pcA"]);
  assert.match(alertsOf("pcA").at(-1).text, /Gang war in Watson/);
  assert.equal(alertsOf("pcB").length, 0);
  assert.ok(hooks.some(h => h.hook === "cpr-sam-agent.screamPublished" && h.args[0].id === c.id));
  from(gm, "scream-crawl", {});
  await settle();
  assert.equal(alertsOf("pcA").length, 1, "nothing new: no second alert");
  from(alice, "scream-read", { actorId: "pcA", clipIds: [c.id] });
  await settle();
  assert.equal(store.apps.screamCrawls.pcA.read[c.id], 1);
});

test("publishing with a Reputation event puts it on the sheet, marked so it isn't suggested again", async () => {
  const actor = game.actors.get("pcA");
  const calls = [];
  actor.deltaLedgerProperty = (prop, delta, reason) => calls.push([prop, delta, reason]);
  from(gm, "scream-save", { clip: clip({ subjects: ["pcA"], rep: [{ actorId: "pcA", delta: 1, reason: "the hijack" }] }), publish: true });
  await settle();
  assert.deepEqual(calls, [["reputation", 1, "DataPool: the hijack"]]);
  assert.deepEqual(clips()[0].actorIds, ["pcA"], "a subject always pulls it");
});

test("scheduling: out when world time gets there, then everyone crawls", async () => {
  from(alice, "scream-terms", { actorId: "pcA", extra: ["Watson"] });
  from(gm, "scream-save", { clip: clip(), publish: true, hours: 2 });
  await settle();
  assert.equal(clips()[0].status, "scheduled");
  await store._tickScream();
  assert.equal(clips()[0].status, "scheduled");
  game.time.worldTime = 7200;
  await store._tickScream();
  assert.equal(clips()[0].status, "published");
  assert.deepEqual(clips()[0].actorIds, ["pcA"]);
});

test("the deep crawl: the roll reaches by DV, waits for the GM, who confirms, trims or adds", async () => {
  from(alice, "scream-terms", { actorId: "pcA", extra: ["Watson"] });
  from(gm, "scream-save", { clip: clip({ headline: "Buried", text: "Shots in Watson.", dv: 13 }), publish: true });
  from(gm, "scream-save", { clip: clip({ headline: "Ghost", text: "Bodies in Watson.", dv: 17 }), publish: true });
  from(gm, "scream-save", { clip: clip({ headline: "Elsewhere", text: "Pacifica", dv: 13 }), publish: true });
  await settle();
  const [buried, ghost, elsewhere] = clips().sort((a, b) => a.ts - b.ts);
  // No Library Search item: the host rolls 1d10 (8) + INT 6 + skill 0 + 2.
  dice = [8];
  from(alice, "scream-deep", { actorId: "pcA" });
  await settle();
  const row = store.apps.screamCrawls.pcA;
  assert.equal(row.deep.status, "review");
  assert.equal(row.deep.total, 16);
  assert.deepEqual(row.found, [buried.id]);
  assert.ok(!(buried.actorIds ?? []).includes("pcA"), "nothing until the GM says so");
  assert.match(gmCards().at(-1).title, /crawls deep/);
  from(alice, "scream-deep", { actorId: "pcA" });
  await settle();
  assert.equal(ChatMessage.created.length, 1, "one deep crawl at a time");
  from(alice, "scream-resolve", { actorId: "pcA", clipIds: [ghost.id] });
  await settle();
  assert.equal(row.deep.status, "review", "players can't confirm their own");
  from(gm, "scream-resolve", { actorId: "pcA", clipIds: [buried.id, elsewhere.id] });
  await settle();
  assert.equal(row.deep.status, "done");
  assert.ok(buried.actorIds.includes("pcA") && elsewhere.actorIds.includes("pcA") && !(ghost.actorIds ?? []).includes("pcA"));
  assert.ok(!("found" in row));
  assert.match(alertsOf("pcA").at(-1).text, /2 clippings/);
  dice = [1, 3];
  from(alice, "scream-deep", { actorId: "pcA" });
  await settle();
  from(gm, "scream-resolve", { actorId: "pcA", clipIds: [] });
  await settle();
  assert.equal(alertsOf("pcA").at(-1).text, "Nothing new past page 1.");
});

test("a Reputation event on a sheet becomes a suggested draft; the app's own events and the first look don't", async () => {
  await store._screamLoad();
  const actor = game.actors.get("pcA");
  actor.system.reputation = { value: 5, transactions: [["Reputation increased by 3 to 5", "Took down a cyberpsycho"]] };
  store._onScreamActor(actor, { system: { reputation: { value: 5 } } });
  const drafts = clips().filter(c => c.status === "draft");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].source.kind, "rep");
  assert.equal(drafts[0].dv, 0, "a big event is a Headline");
  assert.match(sheetText(drafts[0].sheet), /cyberpsycho/);
  actor.system.reputation = { value: 6, transactions: [...actor.system.reputation.transactions, ["…", "DataPool: the hijack"]] };
  store._onScreamActor(actor, { system: { reputation: { value: 6 } } });
  assert.equal(clips().length, 1);
});

test("viral Garden posts become pickups; posts from before the first look don't", async () => {
  store.garden.accounts = { acc: { id: "acc", handle: "@vexr", actorId: "pcA", kind: "pc" } };
  store.garden.posts = { old: { id: "old", accountId: "acc", text: "old news", tier: "viral", ts: 10 } };
  await store._tickScream();
  assert.equal(clips().length, 0);
  store.garden.posts.n1 = { id: "n1", accountId: "acc", text: "fresh", tier: "explosive", ts: 20 };
  store.garden.posts.n2 = { id: "n2", accountId: "acc", text: "meh", tier: "normal", ts: 30 };
  await store._tickScream();
  assert.deepEqual(clips().map(c => [c.source.kind, c.source.ref, c.status]), [["garden", "n1", "draft"]]);
});

test("journal drafts: made once, the desk remembers which entries", async () => {
  const entry = { id: "j1", name: "Riot", folder: { name: "Screamsheets", folder: null }, pages: [{ type: "text", text: { content: "<p>Screamsheet: street, subjects: Juno</p><p>Trouble.</p>" } }] };
  game.journal = Object.assign([entry], { get: id => (id === entry.id ? entry : undefined) });
  from(gm, "scream-journal", { entryId: "j1" });
  await settle();
  assert.deepEqual(clips().map(c => [c.source.kind, c.sheet.outlet, c.subjects]), [["journal", "street", ["pcB"]]]);
  assert.deepEqual(store.apps.screamCrawls[DESK].journal, ["j1"]);
});

test("list previews are a short teaser, cut on a word", () => {
  assert.equal(teaser("Short one."), "Short one.");
  const t = teaser("In a stunning overnight maneuver, rival megacorps traded fire across the megabuilding skyline as fixers scrambled.");
  assert.ok(t.length <= 81 && t.endsWith("…"), t);
  assert.equal(t, "In a stunning overnight maneuver, rival megacorps traded fire across the…");
  assert.equal(summary(clip({ text: "x ".repeat(100) }).sheet).snippet.length <= 81, true);
});

test("Claude drafts: the request carries the outlet's voice, the spin, the depth and only public facts", () => {
  const body = clipRequest({
    outlet: "street", spin: "hit", dv: 13, prompt: "Make them look reckless",
    subjects: [{ name: "Juno", role: "solo", reputation: 4, handle: "@juno", crews: ["Kiosk Kids"] }], event: "A shootout at the Afterlife."
  });
  const user = body.messages[0].content;
  assert.deepEqual(body.tool_choice, { type: "tool", name: "clipping" });
  assert.match(user, /The Gutter Eye/);
  assert.match(user, /lurid tabloid/);
  assert.match(user, /Spin: Hit piece/);
  assert.match(user, /Depth: Buried/);
  assert.match(user, /- Juno, solo, Reputation 4, on The Garden as @juno, crew: Kiosk Kids/);
  assert.match(user, /The event:\nA shootout/);
  assert.match(user, /GM's prompt: Make them look reckless/);
  assert.match(clipRequest({ outlet: "n54", spin: "nope" }).messages[0].content, /Spin: Accurate/);
});

test("Claude drafts: the answer becomes a sheet (masthead and images kept on a rewrite); API errors in words", async () => {
  const r = { headline: "CHROME BLOODBATH", byline: "Street desk", desk: "gossip", paragraphs: ["One \u2014 two.", "Three."], quote: { text: "Never again.", attr: "a bartender" }, tags: ["Afterlife", "afterlife", "Watson"], gm_note: "Made up the bartender." };
  const fresh = clipSheet(r, "n54");
  assert.equal(fresh.masthead.brand.name, "N54 NEWS");
  assert.equal(fresh.masthead.desk, "Gossip");
  assert.deepEqual(fresh.blocks.map(b => b.type), ["headline", "byline", "paragraph", "quote"]);
  assert.equal(fresh.blocks[2].text, "One, two.\n\nThree.");
  assert.equal(fresh.blocks[3].attr, "— a bartender");
  assert.deepEqual(clipTags(r, ["watson"]), ["watson", "Afterlife"]);

  const base = newSheet("street", [newBlock("headline", { text: "old" }), newBlock("image", { src: "worlds/x/pic.webp" }), newBlock("paragraph", { text: "old text" })]);
  base.masthead.brand.name = "THE RENAMED EYE";
  const re = clipSheet(r, "street", base);
  assert.equal(re.masthead.brand.name, "THE RENAMED EYE");
  assert.deepEqual(re.blocks.map(b => b.type), ["headline", "byline", "image", "paragraph", "quote"]);
  assert.equal(base.blocks[0].text, "old");
  assert.equal(cleanSheet(re).blocks.length, 5);

  const ok = async () => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", name: "clipping", input: r }], usage: { input_tokens: 1000, output_tokens: 200 } }) });
  const out = await runClip(clipRequest({ outlet: "n54", spin: "accurate" }), { key: "k", fetch: ok });
  assert.equal(out.result.headline, "CHROME BLOODBATH");
  assert.ok(out.cost > 0);
  const broke = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(runClip({}, { key: "k", fetch: broke }), /key was refused/);
  const empty = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "hi" }] }) });
  await assert.rejects(runClip({}, { key: "k", fetch: empty }), /didn't write a clipping/);
});

test("Claude drafts land on the desk as drafts with the Claude source", async () => {
  from(gm, "scream-save", { clip: { ...clip({ headline: "By Claude" }), notes: "Claude, Accurate", source: { kind: "claude" } } });
  await settle();
  const c = clips().find(x => summary(x.sheet).headline === "By Claude");
  assert.equal(c.status, "draft");
  assert.equal(c.source.kind, "claude");
  assert.equal(c.everyone, undefined);
});

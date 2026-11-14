import { test } from "node:test";
import assert from "node:assert/strict";

import { batchMix, batchSummary, MAX_THREAD, nestRows, parseAt, parseDrafts, parseRep, queuedParent, resolveDrafts } from "../apps/garden/drafts.js";

/*
 * garden-drafts v1 (apps/garden/drafts.js): the batches the garden-writer skill writes into the
 * inbox. Pure: no Foundry needed (the skill's check-drafts.mjs runs the same parser).
 */

const PLAN_EXAMPLE = `garden-drafts v1
batch: 2026-10-22T21-14-03  world: my-world
base: 1234567890  # Day 14, 18:00 (from the pack; times are relative to it)

[mae1] @noodle_mae | +1h20m | normal | city | Third time this week the Tyger Claws came by "for tea". Tea is 20eb now apparently.
  > @gridghost | +1h45m | they're mapping the block. watch who else they visit
  > @random | +2h | lol pay up mae

[rav1] @raven_micro | +16h | normal | close | Raven is proud to welcome our Optics division's new leadership team. Exciting times ahead!
  why: corp/agenda (Ito pushed out); Exec hook

[ink1] @inkwell_rivera | +1d14h10m | hot | about | hook | Two dead, one AV down behind the Totentanz. NCPD says gang trouble. Nobody I talked to says gang.
  img: worlds/my-world/assets/garden/totentanz.webp
  rep: Vex Kade +1 "Seen leaving the Totentanz shootout"

> on post:Xy7Qp2 @noodle_mae | +30m | about | you were by my stand before all that, weren't you

msg: Roach -> Vex Kade, Jun | +20h | HEY HEY. 明天. JOB AT THE DOCKS, EASY MONEY (NOT EASY). CALL ME.
  why: seed Qw12Er, private half
dating: @noodle_mae | 41 | Best noodles in Watson, ask anyone | Looking for someone who closes late | Dealbreaker: Tyger Claws
dating: Ines Okafor | 29 | Medtech, nights | I've seen worse than your ex | Buy me coffee at 6am

@noodle_mae :: arc: Paid the Claws twice; a stranger offered to "fix it" for a favour.
@noodle_mae :: lines: too hot to stand here today | that's my cousin's block | pay first, talk later
@raven_micro :: agenda: Rushing the Kiroshi-rival optics line; blames Optics for the delay.
@raven_micro :: calendar: +4d | Optics launch event, Corporate Plaza
happening: aB3dE9 cooling
seed: Qw12Er planted 2/3
# note: the Totentanz post hints at the Kade job; cut "Nobody I talked to says gang" if that's too much.
`;

test("the plan's example batch reads without errors", () => {
  const p = parseDrafts(PLAN_EXAMPLE, { tiers: ["flop", "normal", "hot", "viral", "explosive"] });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.version, 1);
  assert.equal(p.batch, "2026-10-22T21-14-03");
  assert.equal(p.world, "my-world");
  assert.equal(p.base, 1234567890);
  assert.match(p.baseNote, /^Day 14, 18:00/);
  assert.equal(batchSummary(p.items), "3 posts, 3 replies, 1 text, 2 dating profiles, 4 profile changes, 2 stage changes");
  assert.deepEqual(p.notes, ["the Totentanz post hints at the Kade job; cut \"Nobody I talked to says gang\" if that's too much."]);

  const [mae, grid, rand, rav, ink, onPost, msg, d1, d2, arc, lines, agenda, cal, hap, seed] = p.items;
  assert.deepEqual({ ...mae, text: undefined }, {
    kind: "post", key: mae.key, line: 5, label: "mae1", handle: "noodle_mae", at: 4800, tier: "normal", ring: "city", hook: false, seeds: [], text: undefined, why: "", img: null, rep: []
  });
  assert.equal(mae.text, "Third time this week the Tyger Claws came by \"for tea\". Tea is 20eb now apparently.");
  assert.deepEqual(grid.to, { key: mae.key });
  assert.equal(grid.handle, "gridghost");
  assert.equal(grid.at, 6300);
  assert.equal(rand.handle, "random");
  assert.equal(rav.why, "corp/agenda (Ito pushed out); Exec hook");
  assert.equal(ink.at, 86400 + 14 * 3600 + 600);
  assert.equal(ink.hook, true);
  assert.equal(ink.ring, "about");
  assert.equal(ink.img, "worlds/my-world/assets/garden/totentanz.webp");
  assert.deepEqual(ink.rep, [{ who: "Vex Kade", delta: 1, reason: "Seen leaving the Totentanz shootout" }]);
  assert.deepEqual(onPost.to, { postId: "Xy7Qp2" });
  assert.equal(onPost.ring, "about");
  assert.deepEqual([msg.from, msg.to, msg.at], ["Roach", ["Vex Kade", "Jun"], 72000]);
  assert.match(msg.text, /明天/);
  assert.equal(msg.why, "seed Qw12Er, private half");
  assert.deepEqual([d1.who, d1.age, d1.prompts.length], ["@noodle_mae", 41, 3]);
  assert.equal(d2.who, "Ines Okafor");
  assert.equal(arc.field, "arc");
  assert.deepEqual(lines.value, ["too hot to stand here today", "that's my cousin's block", "pay first, talk later"]);
  assert.equal(agenda.who, "@raven_micro");
  assert.deepEqual(cal.value, { at: 4 * 86400, what: "Optics launch event, Corporate Plaza" });
  assert.deepEqual([hap.what, hap.id, hap.stage], ["happening", "aB3dE9", "cooling"]);
  assert.deepEqual([seed.what, seed.id, seed.stage, seed.progress], ["seed", "Qw12Er", "planted", "2/3"]);

  assert.deepEqual(batchMix(p.items), { city: 1, close: 1, about: 2, none: 2, total: 6 });
});

test("times and rep lines", () => {
  assert.equal(parseAt("+1h20m"), 4800);
  assert.equal(parseAt("-3h"), -10800);
  assert.equal(parseAt("+2d4h"), 2 * 86400 + 4 * 3600);
  assert.equal(parseAt("now"), 0);
  assert.equal(parseAt("tomorrow"), null);
  assert.deepEqual(parseRep("Jun -2 \"Snitched\""), { who: "Jun", delta: -2, reason: "Snitched" });
  assert.deepEqual(parseRep("Jun +1"), { who: "Jun", delta: 1, reason: "" });
  assert.equal(parseRep("Jun"), null);
});

test("a batch without its header fields is not importable", () => {
  const p = parseDrafts("garden-drafts v1\n@a | +1h | hi\n");
  assert.deepEqual(p.errors.map(e => e.message), ["missing \"batch: <id>\"", "missing \"world: <world id>\"", "missing \"base: <Garden time>\" (from the writer pack)"]);
  assert.match(parseDrafts("garden-drafts v2\nbatch: b world: w\nbase: 1\n").errors[0].message, /v1 only/);
  assert.match(parseDrafts("garden-drafts v1\nbatch: a/b world: w\nbase: 1\n").errors[0].message, /batch id/);
});

test("mistakes are reported by line, and the rest still reads", () => {
  const p = parseDrafts([
    "garden-drafts v1",
    "batch: b1 world: w",
    "base: 100",
    "@a | tomorrow | hi", // 4: bad time
    "@a | +1h | normal | city | hot | text", // 5: two tiers
    "> @b | +1h | orphan", // 6: reply with nothing to attach to
    "> on [nope] @b | +1h | hi", // 7: unknown label
    "[x] @a | +1h | weird | fine", // 8: unknown tier, a warning
    "[x] @a | +2h | again", // 9: label used twice
    "  rep: nobody", // 10: unreadable rep
    "msg: Roach | +1h | hi", // 11: no arrow
    "dating: Someone | 12 | too young", // 12
    "@a :: mood: angry", // 13: unknown field
    "seed: abc growing", // 14: unknown stage
    "plain words", // 15
    "@a :: calendar: soon | launch" // 16
  ].join("\n"), { tiers: ["normal", "hot"] });
  assert.deepEqual(p.errors.map(e => e.line), [4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(p.warnings.map(e => e.line), [8]);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].tier, "weird");
});

test("indented replies attach to the post above; \"on [label]\" to any post of the batch", () => {
  const p = parseDrafts("garden-drafts v1\nbatch: b world: w\nbase: 0\n[a] @x | +1h | one\n  > @y | +2h | to one\n@z | +3h | two\n  > @y | +4h | to two\n> on [a] @w | +5h | back to one\n  why: because\n");
  assert.deepEqual(p.errors, []);
  const [one, r1, two, r2, r3] = p.items;
  assert.deepEqual([r1.to.key, r2.to.key, r3.to.key], [one.key, two.key, one.key]);
  assert.equal(r3.why, "because");
});

test("a reply timed before its post gets a warning", () => {
  const p = parseDrafts("garden-drafts v1\nbatch: b world: w\nbase: 0\n@x | +2h | post\n  > @y | +1h | early\n");
  assert.equal(p.warnings.length, 1);
});

test("old drip lines still read (no header): posts with no time", () => {
  const p = parseDrafts("@mae | Tea is 20eb now | pics/tea.webp | hot\nJust text\n\n# comment\n");
  assert.equal(p.legacy, true);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.items.map(i => [i.handle, i.text, i.img, i.tier, i.at]), [["mae", "Tea is 20eb now", "pics/tea.webp", "hot", null], [null, "Just text", null, null, null]]);
});

test("long texts are cut, with a warning", () => {
  const p = parseDrafts(`garden-drafts v1\nbatch: b world: w\nbase: 0\n@x | +1h | ${"a".repeat(600)}\n`);
  assert.equal(p.items[0].text.length, 500);
  assert.equal(p.warnings.length, 1);
});

test("resolving a batch: accounts, characters, posts, stages, and times from base", () => {
  const p = parseDrafts(PLAN_EXAMPLE);
  const accounts = {
    a1: { id: "a1", handle: "noodle_mae", kind: "citizen" },
    a2: { id: "a2", handle: "raven_micro", kind: "corp" },
    a3: { id: "a3", handle: "vex", kind: "pc", actorId: "pcV" }
  };
  const actors = [{ id: "pcV", name: "Vex Kade" }, { id: "pcJ", name: "Jun Park", aliases: ["Jun"] }];
  const items = resolveDrafts(p, { accounts, actors, posts: { Xy7Qp2: {} }, happenings: { aB3dE9: {} }, seeds: {} });
  const by = k => items.find(i => i.key === k);
  const [mae, grid, rand, , ink, onPost, msg, d1, d2, , , , cal, , seed] = items;
  assert.equal(mae.wt, 1234567890 + 4800);
  assert.equal(mae.accountId, "a1");
  assert.deepEqual([grid.accountId, grid.newHandle], [null, "gridghost"]);
  assert.equal(rand.accountId, "@random");
  assert.equal(ink.rep[0].actorId, "pcV");
  assert.deepEqual(ink.problems, []);
  assert.deepEqual(onPost.problems, []);
  assert.deepEqual(msg.toIds, ["pcV", "pcJ"]);
  assert.equal(d1.accountId, "a1");
  assert.equal(d2.accountId, undefined);
  assert.equal(cal.wt, 1234567890 + 4 * 86400);
  assert.deepEqual(cal.problems, []);
  assert.deepEqual(seed.problems, ["no seed Qw12Er"]);
  assert.ok(by(mae.key));

  // A character's own account can't be written for; missing posts and characters are flagged.
  const bad = resolveDrafts(parseDrafts("garden-drafts v1\nbatch: b world: w\nbase: 10\n@vex | +1h | I'm the PC\n> on post:gone @x | now | hi\nmsg: Roach -> Nobody | +1h | hey\n@x :: face: nice\n"), { accounts, actors });
  assert.deepEqual(bad.map(i => i.problems), [["@vex is a character's account"], ["no post gone (deleted, or another world's)"], ["no character \"Nobody\""], ["no account @x"]]);
  assert.deepEqual(resolveDrafts(parseDrafts("garden-drafts v1\nbatch: b world: w\nbase: 10\n@raven_micro :: face: nice\n@noodle_mae :: assets: lab\n"), { accounts }).map(i => i.problems), [[], ["assets is for corporations only"]]);
});

/* ---------------- The writer pack (apps/garden/pack.js) ---------------- */

import { buildPack, naming, packMarkdown, PACK_FORMAT } from "../apps/garden/pack.js";

const DAY = 86400;
function packGarden() {
  const now = 100 * DAY;
  const accounts = {
    mae: { id: "mae", handle: "noodle_mae", name: "Mae", kind: "citizen", followers: 300, writer: { keywords: ["watson", "noodles", "tyger claws"], reacts: [], arc: "Paying the Claws", lines: [] } },
    rav: { id: "rav", handle: "raven_micro", name: "Raven Microcybernetics", kind: "corp", followers: 9000, writer: { keywords: ["raven", "optics"], reacts: [] }, corp: { tier: "local", face: "your friendly optics", assets: ["optics lab"], relations: [{ actorId: "pcV", kind: "employer", note: "Vex's division" }], calendar: [{ id: "c1", wt: now + 4 * DAY, what: "Optics launch" }] } },
    n54: { id: "n54", handle: "n54news", name: "N54", kind: "news", followers: 50000 },
    cit: { id: "cit", handle: "rando", name: "Rando", kind: "citizen", followers: 3, mood: "hater" },
    vex: { id: "vex", handle: "vex", name: "Vex Kade", kind: "pc", actorId: "pcV", followers: 100 }
  };
  const post = (id, accountId, wt, text, replies = [], extra = {}) => ({ id, accountId, wt, ts: wt * 1000, text, tier: "normal", likes: 3, grafts: 0, replies, likedBy: [], graftedBy: [], ...extra });
  const posts = {
    p1: post("p1", "vex", now - 3600, "anyone know a good ripperdoc in watson?", [{ id: "r1", accountId: "cit", text: "lol", wt: now - 3000, auto: true }]),
    p2: post("p2", "vex", now - 2 * DAY, "back in town", [{ id: "r2", accountId: "mae", text: "welcome back, noodles on me", wt: now - 2 * DAY + 600 }]),
    p3: post("p3", "mae", now - 5 * DAY, "Claws came by again", [{ id: "r3", accountId: "vex", text: "want me to talk to them?", wt: now - 5 * DAY + 60 }], { likedBy: ["vex"] }),
    p4: post("p4", "n54", now - 600, "Shooting behind the Totentanz; Vex seen nearby")
  };
  const garden = {
    accounts, posts, queue: [{ id: "q1", accountId: "mae", text: "tomorrow's special", wt: now + DAY + 3600 }], paused: null,
    dating: { profiles: { d1: { id: "d1", handle: "ines", name: "Ines", age: 29 } }, sparks: {} },
    writer: { pcs: { pcV: { keywords: ["raven", "optics"] } }, formats: [{ id: "f1", accountId: "mae", when: "weekly Thu 20:00", what: "specials" }], feeds: { weather: { on: true, keywords: [], accounts: ["n54"] }, ncpd: { on: false, keywords: [], accounts: [] } }, mix: { city: 45, close: 35, about: 20 } },
    happenings: {
      h1: { id: "h1", wt: now - 1200, place: "Watson", what: "Tyger Claws shake down noodle stands", who: ["pcV"], heat: "local", public: true, keywords: ["tyger claws", "watson"], direction: "", stage: "new" },
      h2: { id: "h2", wt: now - 9 * DAY, place: "x", what: "old news", who: [], heat: "small", public: true, keywords: [], direction: "", stage: "closed" }
    },
    seeds: { s1: { id: "s1", what: "Raven optics recall", keywords: ["optics"], obvious: "subtle", by: now + 3 * DAY, sources: ["rav"], stage: "new" } },
    seen: { pcV: { wt: now - 7200, ts: 1 } }
  };
  const ctx = {
    world: "livetestingenv", worldTitle: "Live Testing Env", now, nowMs: 1_700_000_000_000, clock: "world", when: wt => `Day ${Math.floor(wt / DAY)}, ${String(Math.floor((wt % DAY) / 3600)).padStart(2, "0")}:00`,
    days: [{ wt: now, label: "Day 100", weekday: "Tuesday" }, { wt: now + DAY, label: "Day 101", weekday: "Wednesday" }],
    pcs: [{ actorId: "pcV", name: "Vex Kade", reputation: 4, role: "Exec" }, { actorId: "pcJ", name: "Jun Park", reputation: 0, role: "Netrunner" }],
    tiers: ["flop", "normal"], feeds: { weather: ["{\"day\":\"rain\"}"] }, drafts: { pending: [], reviews: [{ batch: "b0", approved: 3, cut: 1, edited: [], note: "less Mae" }] }
  };
  return { garden, ctx, now };
}

test("the writer pack: characters, unanswered posts, fits, quiet voices, the queue", () => {
  const { garden, ctx, now } = packGarden();
  const pack = buildPack(garden, ctx);
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.world, "livetestingenv");
  assert.equal(pack.base, now);
  assert.equal(pack.inbox, "worlds/livetestingenv/cpr-sam-agent/garden/inbox/");

  const [vex, jun] = pack.pcs;
  assert.equal(vex.handle, "@vex");
  assert.equal(vex.naming, naming(4));
  assert.deepEqual(vex.profile, { keywords: ["raven", "optics"] });
  assert.equal(vex.lastOpenedGarden.wt, now - 7200);
  assert.equal(vex.posts.length, 2);
  assert.equal(vex.sprouted.length, 1);
  assert.equal(vex.repliedTo[0].to, "@noodle_mae");
  assert.equal(vex.lastAppeared.by, "@n54news"); // named in N54's post
  assert.equal(jun.handle, null);
  assert.equal(jun.lastAppeared, null);

  // p1 only has a citizen's auto-reply: unanswered. p2 has Mae's answer.
  assert.deepEqual(pack.unanswered.map(p => p.id), ["p1"]);
  assert.deepEqual(pack.happenings.map(h => h.id), ["h1"]); // closed ones left out
  assert.deepEqual(pack.happenings[0].whoNames, ["Vex Kade"]);
  assert.equal(pack.happenings[0].fits[0].handle, "@noodle_mae");
  assert.deepEqual(pack.seeds[0].sources, ["@raven_micro"]);
  assert.equal(pack.seeds[0].fits[0].handle, "@raven_micro");

  assert.deepEqual(pack.cast.map(a => a.handle), ["@noodle_mae"]);
  assert.deepEqual(pack.corps.map(a => a.handle), ["@raven_micro"]);
  assert.equal(pack.corps[0].corp.relations[0].name, "Vex Kade");
  assert.equal(pack.corps[0].corp.calendar[0].label, "Day 104, 00:00");
  assert.deepEqual(pack.others.map(a => a.handle), ["@n54news"]);
  assert.equal(pack.citizens.count, 1);
  // Mae last posted 5 days ago, Raven never: both quiet; Jun was never in the feed.
  assert.deepEqual(pack.quiet.voices, ["@noodle_mae", "@raven_micro"]);
  assert.deepEqual(pack.quiet.pcs, ["Jun Park"]);
  assert.deepEqual(pack.quiet.arcs, ["@noodle_mae: Paying the Claws"]);

  assert.equal(pack.queue.count, 1);
  assert.deepEqual(pack.queue.byDay, { "Day 101": 1 });
  assert.equal(pack.formats[0].handle, "@noodle_mae");
  assert.deepEqual(Object.keys(pack.feeds), ["weather"]);
  assert.deepEqual(pack.feeds.weather.accounts, ["@n54news"]);
  assert.deepEqual(pack.dating.npcProfiles, ["Ines (@ines, 29)"]);
  assert.equal(pack.recent[0].id, "p4");
  assert.deepEqual(pack.recent.find(p => p.id === "p1").replies, []);
  assert.equal(pack.recent.find(p => p.id === "p1").autoReplies, 1);

  const md = packMarkdown(pack);
  assert.match(md, /^# Garden writer pack: Live Testing Env/);
  assert.match(md, /\*\*Vex Kade\*\* @vex, Rep 4/);
  assert.match(md, /less Mae/);
  // JSON round trip (it's saved as a file).
  assert.deepEqual(JSON.parse(JSON.stringify(pack)), pack);
});

test("the writer pack: characters the GM left out aren't in it, nor their unanswered posts", () => {
  const { garden, ctx } = packGarden();
  const pack = buildPack(garden, { ...ctx, pcs: ctx.pcs.filter(p => p.actorId !== "pcV") });
  assert.deepEqual(pack.pcs.map(p => p.name), ["Jun Park"]);
  assert.deepEqual(pack.unanswered, []);
  assert.deepEqual(pack.quiet.pcs, ["Jun Park"]);
});

test("naming follows Reputation", () => {
  assert.match(naming(0), /not identifiable/);
  assert.match(naming(2), /description only/);
  assert.match(naming(4), /sometimes/);
  assert.match(naming(8), /by name;/);
});

/* ---------------- The host: inbox, approval, going out (apps/garden/drafts-host.js) ---------------- */

import { addActor, addUser, actAs, files, folders, reset } from "./foundry-stub.js";
import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, gardenFor, gardenNow, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import fs from "node:fs";

setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));

const INBOX_DIR = "worlds/test-world/cpr-sam-agent/garden/inbox";
let hostGm, alice;
async function hostSetup() {
  await store._writing;
  reset();
  hostGm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(hostGm);
  addActor({ id: "pcA", name: "Vex Kade", owners: ["alice"] });
  addActor({ id: "pcB", name: "Jun", owners: ["alice"] });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null, _inboxSkipped: null, _packAt: 0, _packWritten: null
  });
  store._folders = store._ensureFolders();
  await store._folders;
  store._seedGarden();
  folders.add(INBOX_DIR);
}
const drop = (name, text) => files.set(`${INBOX_DIR}/${name}`, text);
const gmSays = async (type, data) => {
  await store._onSocket({ ...data, type }, hostGm.id);
  await store._enqueue(() => {});
};

test("host: a batch in the inbox is read on the tick, approved, and goes out backdated", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  store._addAccount({ handle: "raven_micro", name: "Raven", kind: "corp" });
  store.garden.happenings.h1 = { id: "h1", wt: base, place: "Watson", what: "x", who: [], heat: "local", public: true, keywords: [], direction: "", stage: "new" };
  drop("b1.txt", [
    "garden-drafts v1",
    `batch: b1  world: test-world`,
    `base: ${base}`,
    "[old] @noodle_mae | -2h | normal | city | Claws came by for tea again",
    "  > @gridghost | -1h50m | they're mapping the block",
    "[later] @raven_micro | +3h | close | Raven welcomes new leadership",
    "[cut] @noodle_mae | +1h | this one gets cut",
    "  > @someone | +2h | so does this reply",
    "msg: Roach -> Vex Kade | -1h | HEY. JOB AT THE DOCKS.",
    "dating: Ines Okafor | 29 | Medtech, nights | Buy me coffee",
    "@noodle_mae :: arc: Paid the Claws twice",
    "@raven_micro :: calendar: +4d | Optics launch",
    "happening: h1 developing",
    "# note: check the Raven post"
  ].join("\n"));
  drop("other.txt", "garden-drafts v1\nbatch: o1 world: some-other-world\nbase: 0\n@x | now | hi\n");

  await store._tickGarden();
  const batch = store.garden.drafts.batches.b1;
  assert.ok(batch, "imported");
  assert.deepEqual(batch.errors, []);
  assert.deepEqual(batch.notes, ["check the Raven post"]);
  assert.equal(batch.summary, "3 posts, 2 replies, 1 text, 1 dating profile, 2 profile changes, 1 stage change");
  assert.ok(!store.garden.drafts.batches.o1, "another world's batch stays in the inbox");
  assert.deepEqual(store.garden.drafts.imported, ["b1.txt"]);
  // Players never see drafts.
  assert.equal(gardenFor(alice, store.garden).drafts, undefined);
  // The pack was saved too.
  const pack = JSON.parse(files.get("worlds/test-world/cpr-sam-agent/garden/writer-pack.json"));
  assert.equal(pack.world, "test-world");
  assert.deepEqual(pack.drafts.pending.map(b => b.id), ["b1"]);
  assert.match(files.get("worlds/test-world/cpr-sam-agent/garden/writer-pack.md"), /# Garden writer pack/);

  // Reading again doesn't import it twice.
  await store._tickGarden();
  assert.equal(Object.keys(store.garden.drafts.batches).length, 1);

  const cut = batch.items.find(i => i.label === "cut");
  const later = batch.items.find(i => i.label === "later");
  await gmSays("garden-drafts-approve", { batchId: "b1", items: [{ key: cut.key, include: false }, { key: later.key, text: "Raven proudly welcomes new leadership" }] });

  assert.equal(store.garden.drafts.batches.b1, undefined);
  const posts = Object.values(store.garden.posts).filter(p => p.text.startsWith("Claws"));
  assert.equal(posts.length, 1, "the due post went out");
  const [old] = posts;
  assert.ok(Math.abs(old.wt - (base - 7200)) < 2, "backdated to its own time");
  assert.equal(old.replies.filter(r => !r.auto).length, 1);
  const reply = old.replies.find(r => !r.auto);
  assert.equal(reply.text, "they're mapping the block");
  assert.ok(Math.abs(reply.wt - (base - 6600)) < 2);
  assert.ok(Object.values(store.garden.accounts).some(a => a.handle === "@gridghost"), "a new handle is a new citizen");
  // The later post waits in the queue, edited; the cut one and its reply are gone.
  assert.deepEqual(store.garden.queue.filter(q => q.draft).map(q => q.text), ["Raven proudly welcomes new leadership"]);
  assert.ok(!Object.values(store.garden.posts).some(p => p.text === "this one gets cut"));
  // The text went out to Vex from Roach.
  const thread = store.findThread("pcA", "Roach");
  assert.ok(thread, "Roach's conversation");
  assert.equal(thread.messages.at(-1).text, "HEY. JOB AT THE DOCKS.");
  // Applied at once: Dating, profiles, calendar, stage.
  assert.ok(Object.values(store.garden.dating.profiles).some(p => p.name === "Ines Okafor" && p.age === 29 && p.prompts.length === 2));
  const mae = Object.values(store.garden.accounts).find(a => a.handle === "@noodle_mae");
  assert.equal(mae.writer.arc, "Paid the Claws twice");
  const raven = Object.values(store.garden.accounts).find(a => a.handle === "@raven_micro");
  assert.equal(raven.corp.calendar[0].what, "Optics launch");
  assert.equal(store.garden.happenings.h1.stage, "developing");
  // The review is remembered for the next pack.
  const [review] = store.garden.drafts.reviews;
  assert.deepEqual([review.batch, review.approved, review.cut, review.edited.length], ["b1", 8, 2, 1]);
});

test("host: a broken batch can't be approved; discard and the writer's note", async () => {
  await hostSetup();
  drop("bad.txt", "garden-drafts v1\nbatch: bad world: test-world\nbase: 0\n@x | tomorrow | hi\n");
  await store._tickGarden();
  const batch = store.garden.drafts.batches.bad;
  assert.equal(batch.errors.length, 1);
  await gmSays("garden-drafts-approve", { batchId: "bad", items: [] });
  assert.ok(store.garden.drafts.batches.bad, "still waiting");
  await gmSays("garden-drafts-feedback", { batchId: "bad", text: "less Roach, more Raven" });
  assert.equal(files.get(`${INBOX_DIR}/bad.feedback.txt`), "less Roach, more Raven\n");
  await gmSays("garden-drafts-discard", { batchId: "bad" });
  assert.equal(store.garden.drafts.batches.bad, undefined);
  assert.equal(store.garden.drafts.reviews.at(-1).note, "discarded");
  // The feedback file is never read as a batch.
  await store._tickGarden();
  assert.deepEqual(Object.keys(store.garden.drafts.batches), []);
});

test("host: Post now on a batch's queued reply, and a reply to an existing post", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  const mae = store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  const post = await store._publish(mae, { text: "old post", wt: base - 600 });
  drop("b2.txt", `garden-drafts v1\nbatch: b2 world: test-world\nbase: ${base}\n> on post:${post.id} @noodle_mae | +2h | still here\n`);
  await store._tickGarden();
  await gmSays("garden-drafts-approve", { batchId: "b2", items: [] });
  const queued = store.garden.queue.find(q => q.draft?.kind === "reply");
  assert.ok(queued);
  await gmSays("garden-queue", { op: "now", id: queued.id });
  assert.equal(store.garden.posts[post.id].replies.at(-1).text, "still here");
  assert.equal(store.garden.queue.length, 0);
});

test("account:, format:, tier and relation lines (the writer's cast run)", () => {
  const p = parseDrafts([
    "garden-drafts v1", "batch: c1 world: w", "base: 0",
    "account: @roach | Roach | fixer | GOT A JOB? I GOT A JOB. | 900",
    "account: @raven_micro | Raven Microcybernetics | Corporation | Optics for a brighter tomorrow",
    "account: @bad | Bad | pc | no",
    "format: @roach | weekly Thu 20:00 | nonsense in ALL CAPS with a real job in it",
    "format: @roach | sometimes | nope",
    "@raven_micro :: tier: local",
    "@raven_micro :: relation: Vex Kade | employer | Ms. Ito runs Vex's division",
    "@raven_micro :: relation: Vex Kade | friend | no",
    "@roach :: arc: Owes the Claws a favour",
    "@roach | +1h | city | HEY CHOOMS"
  ].join("\n"));
  assert.deepEqual(p.errors.map(e => e.line), [6, 8, 11]);
  const [roach, raven] = p.items;
  assert.deepEqual([roach.handle, roach.name, roach.accountKind, roach.followers], ["roach", "Roach", "fixer", 900]);
  assert.equal(raven.accountKind, "corp");
  assert.equal(batchSummary(p.items), "1 post, 2 accounts, 1 format, 3 profile changes");
  const items = resolveDrafts(p, { actors: [{ id: "pcV", name: "Vex Kade" }] });
  assert.deepEqual(items.map(i => i.problems), [[], [], [], [], [], [], []]);
  const post = items.at(-1);
  assert.deepEqual([post.accountId, post.newHandle, post.madeHere], [null, "roach", true]);
  assert.equal(items.find(i => i.field === "relation").value.actorId, "pcV");
  // A corp field for an account the batch makes as a fixer is flagged.
  const bad = resolveDrafts(parseDrafts("garden-drafts v1\nbatch: b world: w\nbase: 0\naccount: @roach | Roach | fixer\n@roach :: face: friendly\n"), {});
  assert.deepEqual(bad[1].problems, ["face is for corporations only"]);
});

test("host: a cast batch makes its accounts, a format, a corp's tier and relation, and posts as them", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  drop("cast.txt", [
    "garden-drafts v1", "batch: cast world: test-world", `base: ${base}`,
    "@roach | -10m | city | HEY CHOOMS. 明天.",
    "account: @roach | Roach | fixer | GOT A JOB? I GOT A JOB.",
    "account: @raven_micro | Raven Microcybernetics | corp | Optics for a brighter tomorrow",
    "format: @roach | weekly Thu 20:00 | nonsense with a real job in it",
    "@raven_micro :: tier: local",
    "@raven_micro :: relation: Vex Kade | employer | Ms. Ito",
    "@roach :: lines: HEY | NO | CALL ME",
    "dating: @roach | 31 | Fixer | Will find you a job | And a date"
  ].join("\n"));
  await store._tickGarden();
  assert.deepEqual(store.garden.drafts.batches.cast.errors, []);
  await gmSays("garden-drafts-approve", { batchId: "cast", items: [] });
  const roach = Object.values(store.garden.accounts).find(a => a.handle === "@roach");
  const raven = Object.values(store.garden.accounts).find(a => a.handle === "@raven_micro");
  assert.deepEqual([roach.name, roach.kind, roach.bio], ["Roach", "fixer", "GOT A JOB? I GOT A JOB."]);
  assert.equal(raven.kind, "corp");
  assert.equal(raven.corp.tier, "local");
  assert.deepEqual(raven.corp.relations, [{ actorId: "pcA", kind: "employer", note: "Ms. Ito" }]);
  assert.deepEqual(roach.writer.lines, ["HEY", "NO", "CALL ME"]);
  assert.deepEqual(store.garden.writer.formats.map(f => [f.accountId, f.when]), [[roach.id, "weekly Thu 20:00"]]);
  assert.ok(Object.values(store.garden.posts).some(p => p.accountId === roach.id && p.text === "HEY CHOOMS. 明天."), "the post by the new account, even written above its account: line");
  assert.ok(Object.values(store.garden.dating.profiles).some(p => p.accountId === roach.id && p.name === "Roach"));
  assert.equal(Object.values(store.garden.accounts).filter(a => a.handle.startsWith("@roach")).length, 1, "no random citizen made for @roach");
});

/* ---------------- Threads ---------------- */

test("chatter: lines are retired: an error", () => {
  const parsed = parseDrafts(["garden-drafts v1", "batch: c1 world: w", "base: 1000", "chatter: any | anyone else's Agent buzzing all night?"].join("\n"));
  assert.deepEqual(parsed.errors.map(e => e.line), [4]);
  assert.equal(parsed.items.length, 0);
});

test("a thread is MAX_THREAD replies at most, per post, in the batch", () => {
  const replies = n => Array.from({ length: n }, (_, i) => `  > @cit${i} | +${i + 1}m | reply ${i}`);
  const parsed = parseDrafts([
    "garden-drafts v1", "batch: t1 world: w", "base: 1000",
    "[a] @noodle_mae | +0m | first", ...replies(MAX_THREAD + 1),
    "[b] @noodle_mae | +0m | second", ...replies(MAX_THREAD),
    ...Array.from({ length: MAX_THREAD + 1 }, (_, i) => `> on post:Xy7Qp2 @cit${i} | +${i}m | on an old one`)
  ].join("\n"));
  assert.deepEqual(parsed.errors.map(e => e.message), ["more than 10 replies to one post", "more than 10 replies to one post"]);
  assert.deepEqual(parsed.errors.map(e => e.line), [4 + MAX_THREAD + 1, 4 + 3 * MAX_THREAD + 3]);
});

/* ---------------- Answers: replies to a reply (one level) ---------------- */

test("\">>\" answers the \">\" reply above (answers to it join its discussion); \"> on reply:<id>\" an existing one", () => {
  const p = parseDrafts([
    "garden-drafts v1", "batch: s1 world: w", "base: 0",
    "[a] @x | +1h | post",
    "  > @y | +2h | a reply",
    "  >> @x | +3h | the post's author answers",
    "  >> @z | +4h | and someone else",
    "  > @w | +5h | another reply",
    "> on reply:Ab12Cd @x | +1h | to an old reply",
    ">> @y | +2h | under it too"
  ].join("\n"));
  assert.deepEqual(p.errors, []);
  const [post, r1, a1, a2, r2, old, a3] = p.items;
  assert.deepEqual([r1.under, a1.under, a2.under, r2.under], [null, r1.key, r1.key, null]);
  assert.deepEqual([a1.to, a2.to], [{ key: post.key }, { key: post.key }]);
  assert.deepEqual([old.to, old.under], [{ replyId: "Ab12Cd" }, null]);
  assert.deepEqual([a3.to, a3.under], [{ replyId: "Ab12Cd" }, null]);
});

test("an answer needs a reply right above it, and isn't timed before it", () => {
  const p = parseDrafts([
    "garden-drafts v1", "batch: s2 world: w", "base: 0",
    ">> @x | +1h | nothing above",
    "@x | +1h | post",
    "  >> @y | +2h | a post above, but no reply",
    "  > @y | +3h | a reply",
    "  >> @x | +2h | early",
    "  >> on reply:Ab12Cd @x | +4h | not like this",
    "msg: Roach -> Vex Kade | +1h | hi",
    ">> @y | +5h | a text in between"
  ].join("\n"));
  assert.deepEqual(p.errors.map(e => e.line), [4, 6, 9, 11]);
  assert.deepEqual(p.warnings.map(w => w.line), [8]);
});

test("answers count towards a post's MAX_THREAD", () => {
  const parsed = parseDrafts([
    "garden-drafts v1", "batch: s3 world: w", "base: 0", "@x | +0m | post", "  > @y | +1m | reply",
    ...Array.from({ length: MAX_THREAD }, (_, i) => `  >> @cit${i} | +${i + 2}m | answer ${i}`)
  ].join("\n"));
  assert.deepEqual(parsed.errors.map(e => e.line), [5 + MAX_THREAD]);
});

test("resolving \"on reply:\": the reply's post, or a problem", () => {
  const posts = { P1: { id: "P1", replies: [{ id: "R1", accountId: "a", text: "x" }] } };
  const parsed = parseDrafts("garden-drafts v1\nbatch: s4 world: w\nbase: 0\n> on reply:R1 @y | +1h | yes\n> on reply:R9 @y | +1h | no\n");
  const [ok, gone] = resolveDrafts(parsed, { posts });
  assert.equal(ok.postId, "P1");
  assert.deepEqual(ok.problems, []);
  assert.match(gone.problems[0], /no reply R9/);
});

test("the writer pack: replies as threads with ids; characters' replies waiting for an answer", () => {
  const { garden, ctx, now } = packGarden();
  garden.posts.p2.replies.push({ id: "a2", accountId: "vex", text: "you're on", wt: now - 2 * DAY + 900, parentId: "r2" });
  const pack = buildPack(garden, ctx);
  assert.deepEqual(pack.recent.find(p => p.id === "p2").replies, ["reply:r2 @noodle_mae: welcome back, noodles on me", "↳ reply:a2 @vex: you're on"]);
  // Vex's reply on Mae's post, and Vex's answer to Mae's reply on Vex's own post: nobody answered either since.
  assert.deepEqual(pack.waiting.map(r => [r.id, r.postId, r.on]), [["a2", "p2", "@vex"], ["r3", "p3", "@noodle_mae"]]);
  assert.deepEqual(pack.waiting[0].thread, ["reply:r2 @noodle_mae: welcome back, noodles on me", "↳ reply:a2 @vex: you're on"]);
  assert.match(packMarkdown(pack), /@vex on @vex's post \(.*reply:a2\): you're on/);
  // Mae answers in r3's discussion, and a crowd reaction elsewhere doesn't count; a month-old one is left out.
  garden.posts.p3.replies.push({ id: "a3", accountId: "mae", text: "please", wt: now - 5 * DAY + 120, parentId: "r3" });
  garden.posts.p2.replies.push({ id: "x2", accountId: "cit", text: "lol", wt: now - DAY, auto: true });
  garden.posts.p4.replies.push({ id: "r4", accountId: "vex", text: "wasn't me", wt: now - 30 * DAY });
  assert.deepEqual(buildPack(garden, ctx).waiting.map(r => r.id), ["a2"]);
});

test("host: a batch's answer goes out under its reply; an answer to an existing reply under that one", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  const mae = store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  store._addAccount({ handle: "gridghost", name: "Ghost", kind: "citizen" });
  const old = await store._publish(mae, { text: "old post", wt: base - 6000 });
  const top = store._addReply(old, mae.id, "top", base - 5000);
  const sub = store._addReply(old, mae.id, "sub", base - 4000, { parentId: top.id });
  drop("s5.txt", [
    "garden-drafts v1", "batch: s5 world: test-world", `base: ${base}`,
    "[n] @noodle_mae | -2h | new post",
    "  > @gridghost | -1h | a reply",
    "  >> @noodle_mae | -3h | timed before its reply",
    `> on reply:${sub.id} @gridghost | -1h | joins top's discussion`
  ].join("\n"));
  await store._tickGarden();
  await gmSays("garden-drafts-approve", { batchId: "s5", items: [] });
  await store._tickGarden();
  const fresh = Object.values(store.garden.posts).find(p => p.text === "new post");
  const [reply, answer] = fresh.replies;
  assert.equal(reply.text, "a reply");
  assert.deepEqual([answer.text, answer.parentId], ["timed before its reply", reply.id]);
  assert.ok(answer.wt >= reply.wt);
  assert.equal(old.replies.find(r => r.text === "joins top's discussion").parentId, top.id);
});

test("host: an answer whose reply was cut is cut too", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  drop("s6.txt", `garden-drafts v1\nbatch: s6 world: test-world\nbase: ${base}\n@noodle_mae | -2h | post\n  > @noodle_mae | -1h | reply\n  >> @noodle_mae | -1h | answer\n`);
  await store._tickGarden();
  const reply = store.garden.drafts.batches.s6.items.find(i => i.text === "reply");
  await gmSays("garden-drafts-approve", { batchId: "s6", items: [{ key: reply.key, include: false }] });
  await store._tickGarden();
  const post = Object.values(store.garden.posts).find(p => p.text === "post");
  assert.deepEqual(post.replies.map(r => r.text), []);
  assert.equal(store.garden.drafts.reviews.at(-1).cut, 2);
});

/* ---------------- The Drafts tab and the Queue as threads ---------------- */

test("nestRows: replies under their post, threads by when they start, the feed's own (ctx) untimed", () => {
  const rows = nestRows([
    { id: "late", wt: 50 },
    { id: "r1", parent: "early", wt: 30 },
    { id: "a1", parent: "r1", wt: 31 },
    { id: "x", parent: "a1", wt: 32 },
    { id: "early", wt: 20 },
    { id: "post:p", ctx: true },
    { id: "r2", parent: "post:p", wt: 10 },
    { id: "lost", parent: "nowhere", wt: 40 }
  ]);
  assert.deepEqual(rows.map(r => [r.id, r.depth]), [["post:p", 0], ["r2", 1], ["early", 0], ["r1", 1], ["a1", 2], ["x", 2], ["lost", 0], ["late", 0]]);
  assert.equal(rows[0].at, 10);
});

test("queuedParent: the reply it answers, else its post, while queued", () => {
  const post = { id: "q1", draft: { batch: "b", key: "p1", kind: "post" } };
  const reply = { id: "q2", draft: { batch: "b", key: "r1", kind: "reply", parent: "p1", under: null } };
  const answer = { id: "q3", draft: { batch: "b", key: "r2", kind: "reply", parent: "p1", under: "r1" } };
  const other = { id: "q4", draft: { batch: "c", key: "r1", kind: "reply", parent: "p1" } };
  const q = [post, reply, answer, other];
  assert.equal(queuedParent(q, answer), reply);
  assert.equal(queuedParent(q, reply), post);
  assert.equal(queuedParent(q, other), null);
  assert.equal(queuedParent([reply, answer], reply), null);
  assert.equal(queuedParent(q, post), null);
});

test("host: a reply waits for its queued post, even when due; Post now waits too", async () => {
  await hostSetup();
  const base = Math.floor(gardenNow());
  store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  drop("t1.txt", `garden-drafts v1\nbatch: t1 world: test-world\nbase: ${base}\n@noodle_mae | +2h | later post\n  > @noodle_mae | +3h | its reply\n`);
  await store._tickGarden();
  await gmSays("garden-drafts-approve", { batchId: "t1", items: [] });
  const [post, reply] = ["post", "reply"].map(k => store.garden.queue.find(q => q.draft.kind === k));
  assert.equal(store.garden.queue.find(q => q.draft.why !== undefined), undefined, "no why: none kept");
  await gmSays("garden-queue", { op: "edit", id: reply.id, item: { accountId: reply.accountId, text: "its reply", minutes: 0 } });
  await store._tickGarden();
  await gmSays("garden-queue", { op: "now", id: reply.id });
  assert.equal(store.garden.queue.length, 2, "both still queued");
  await gmSays("garden-queue", { op: "now", id: post.id });
  await store._tickGarden();
  const out = Object.values(store.garden.posts).find(p => p.text === "later post");
  assert.deepEqual(out.replies.map(r => r.text), ["its reply"]);
  assert.equal(store.garden.queue.length, 0);
});

test("host: the GM queues replies under a queued post, its reply and the feed; a thread moves and goes with its post", async () => {
  await hostSetup();
  const now = Math.floor(gardenNow());
  const mae = store._addAccount({ handle: "noodle_mae", name: "Mae", kind: "citizen" });
  const live = await store._publish(mae, { text: "on the feed", wt: now - 600 });
  const top = store._addReply(live, mae.id, "a reply there", now - 300);
  store._enqueuePost({ id: "qa", accountId: mae.id, text: "first", image: null, tier: null, wt: now + 3600 });
  store._enqueuePost({ id: "qb", accountId: mae.id, text: "second", image: null, tier: null, wt: now + 7200 });
  const reply = (id, text, more = {}) => gmSays("garden-queue", { op: "reply", id, item: { accountId: mae.id, text, minutes: 0, ...more } });
  await reply("qa", "under first");
  const r1 = store.garden.queue.find(q => q.text === "under first");
  assert.equal(r1.wt, now + 3600, "never before its post");
  await reply(r1.id, "answering it");
  await reply(null, "under the feed's reply", { postId: live.id, replyId: top.id });
  const r2 = store.garden.queue.find(q => q.text === "answering it");
  assert.equal(queuedParent(store.garden.queue, r2), r1);
  // "first" moves past "second": its thread moves with it.
  await gmSays("garden-queue", { op: "down", id: "qa", other: "qb" });
  assert.deepEqual(["first", "under first", "answering it", "second"].map(t => store.garden.queue.find(q => q.text === t).wt - now), [7200, 7200, 7200, 3600]);
  // Everything out: the threads land where they belong.
  await gmSays("garden-queue", { op: "remove", id: "qb" });
  for (const q of store.garden.queue) q.wt = now - 1;
  await store._tickGarden();
  const first = Object.values(store.garden.posts).find(p => p.text === "first");
  const [a, b] = first.replies;
  assert.deepEqual([a.text, b.text, b.parentId], ["under first", "answering it", a.id]);
  assert.equal(live.replies.find(r => r.text === "under the feed's reply").parentId, top.id);
  // Skipping a post skips what's queued under it.
  store._enqueuePost({ id: "qc", accountId: mae.id, text: "third", image: null, tier: null, wt: now + 3600 });
  await reply("qc", "under third");
  await gmSays("garden-queue", { op: "remove", id: "qc" });
  assert.equal(store.garden.queue.length, 0);
});

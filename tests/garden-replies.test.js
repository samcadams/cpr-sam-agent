import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import { castFit, castQuota, chatterLine, hasWord, isCast, isCrowd, mentions, pickAutoReply } from "../apps/garden/replies.js";

const lists = Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))]));
setGardenLists(lists);

/*
 * The Garden's auto-replies (apps/garden/replies.js, host.js _tickGarden): random citizens reply from
 * the word lists; the cast only to posts for them (a mention, a tie, their keywords); corps and news
 * never (their replies come from the writer's batches).
 */

const writer = (lines, more = {}) => ({ keywords: [], reacts: [], ties: [], lines, ...more });
const people = () => ({
  cit: { id: "cit", handle: "@mae_nc", name: "Mae", kind: "citizen", mood: "hype" },
  roach: { id: "roach", handle: "@roach", name: "Roach", kind: "citizen", mood: "hater", writer: writer(["Roach says no.", "Roach saw it first."], { keywords: ["kabuki", "tyger claws"], ties: ["@rook_nc", "kade"] }) },
  fixer: { id: "fixer", handle: "@ink", name: "Ink", kind: "fixer", writer: writer(["Pay first."], { reacts: ["shooting"] }) },
  rocklin: { id: "rocklin", handle: "@rocklin", name: "Rocklin Augmentics", kind: "corp", mood: "pr", writer: writer(["New drop soon."], { keywords: ["militech", "chrome"] }) },
  n54: { id: "n54", handle: "@network54", name: "Network 54", kind: "news", writer: writer(["Back to you."], { keywords: ["militech"] }) },
  militech: { id: "militech", handle: "@militech", name: "Militech", kind: "corp", writer: writer(["Peace through strength."]) },
  rook: { id: "rook", handle: "@rook_nc", name: "Rook", kind: "gang" },
  pc: { id: "pc", handle: "@kade", name: "Kade", kind: "pc", actorId: "pcB", mood: "hype", writer: writer(["pc line"]) }
});
const post = (accountId, text, more = {}) => ({ id: "p", accountId, text, replies: [], eng: { replies: 9, mix: { hype: 1, hater: 1 } }, ...more });
const auto = (accountId, text = "x") => ({ id: Math.random().toString(36), accountId, text, auto: true });

test("who's who: the crowd, the cast, and the quiet corps and news", () => {
  const a = people();
  assert.deepEqual(Object.values(a).filter(isCrowd).map(x => x.id), ["cit"]);
  assert.deepEqual(Object.values(a).filter(isCast).map(x => x.id), ["roach", "fixer"]);
});

test("words and mentions: whole words, any case; handles with or without the @", () => {
  assert.ok(hasWord("Saw the Tyger Claws in KABUKI tonight", "tyger claws"));
  assert.ok(hasWord("kabuki.", "Kabuki"));
  assert.ok(!hasWord("kabukicho", "kabuki"));
  assert.ok(!hasWord("chromed out", "chrome"));
  assert.ok(mentions("yo @Roach, look", "@roach"));
  assert.ok(mentions("yo @roach", "roach"));
  assert.ok(!mentions("yo @roachy", "@roach"));
  assert.ok(!mentions("mail roach@nc.net", "@roach"));
});

test("a cast member fits a post that mentions them, is by a tie, or has their keywords; never their own", () => {
  const a = people();
  assert.equal(castFit(a.roach, post("cit", "hey @roach"), a.cit), "mention");
  assert.equal(castFit(a.roach, post("rook", "quiet night"), a.rook), "tie");
  assert.equal(castFit(a.roach, post("pc", "quiet night"), a.pc, "Kade"), "tie");
  assert.equal(castFit(a.roach, post("cit", "Kabuki market's open"), a.cit), "keyword");
  assert.equal(castFit(a.fixer, post("cit", "Another shooting downtown"), a.cit), "keyword");
  assert.equal(castFit(a.roach, post("cit", "quiet night"), a.cit), null);
  assert.equal(castFit(a.roach, post("roach", "@roach kabuki"), a.roach), null, "not on their own post");
  // Corps and news never auto-reply, whatever the post says.
  assert.equal(castFit(a.rocklin, post("militech", "@rocklin Militech chrome"), a.militech), null);
  assert.equal(castFit(a.n54, post("militech", "@network54 Militech"), a.militech), null);
});

test("Rocklin doesn't answer Militech: a corp post nobody fits gets the crowd", () => {
  const a = people();
  for (let i = 0; i < 50; i++) {
    const pick = pickAutoReply(post("militech", "Militech: new chrome for the NCPD."), a, { lists });
    assert.equal(pick.account.id, "cit");
    assert.equal(pick.cast, false);
    assert.ok(lists.replyHype.includes(pick.text));
  }
});

test("a fitting cast member answers once per thread, with their own line, then the crowd", () => {
  const a = people();
  const p = post("cit", "@roach you seen Kabuki tonight?");
  const first = pickAutoReply(p, a, { lists });
  assert.deepEqual([first.account.id, first.cast], ["roach", true]);
  assert.ok(a.roach.writer.lines.includes(first.text));
  p.replies.push(auto("roach", first.text));
  const next = pickAutoReply(p, a, { lists });
  assert.equal(next.account.id, "cit", "once per thread");
});

test("mentions beat ties beat keywords", () => {
  const a = people();
  a.fixer.writer.keywords = ["kabuki"];
  a.fixer.writer.ties = ["@mae_nc"];
  // Roach by keyword, Ink by tie: Ink first.
  assert.equal(pickAutoReply(post("cit", "Kabuki at night"), a, { lists }).account.id, "fixer");
  // Roach mentioned: Roach first.
  assert.equal(pickAutoReply(post("cit", "Kabuki at night, @roach"), a, { lists }).account.id, "roach");
});

test("the cast stays a minority of a post's auto-replies", () => {
  assert.deepEqual([castQuota(1), castQuota(3), castQuota(6), castQuota(9)], [1, 1, 2, 3]);
  const a = people();
  a.fixer.writer.keywords = ["kabuki"];
  const p = post("cit", "Kabuki at night", { eng: { replies: 3, mix: { hype: 1 } } });
  p.replies.push(auto("roach"));
  assert.equal(pickAutoReply(p, a, { lists }).account.id, "cit", "quota of 1 used up");
  p.eng.replies = 6;
  assert.equal(pickAutoReply(p, a, { lists }).account.id, "fixer");
});

test("a cast member out of lines never says the word lists: the crowd answers", () => {
  const a = people();
  const p = post("cit", "Kabuki, shooting");
  p.replies.push({ id: "r1", accountId: "cit", text: "Roach says no." }, { id: "r2", accountId: "cit", text: "Roach saw it first." }, { id: "r3", accountId: "cit", text: "Pay first." });
  // Roach has a mood (hater) but no line left; Ink has none either.
  for (let i = 0; i < 20; i++) assert.equal(pickAutoReply(p, a, { lists }).account.id, "cit");
});

/* ---------------- The writer's chatter ---------------- */

const line = (id, text, more = {}) => ({ id, mood: null, keywords: [], text, used: 0, ...more });

test("chatter: topical lines on posts with their keywords, plain lines elsewhere, in the mood or any", () => {
  const pool = [line("t", "Watson's still burning?", { keywords: ["watson", "fire"] }), line("h", "SO preem", { mood: "hype" }), line("x", "who even asked", { mood: "hater" })];
  assert.equal(chatterLine({ text: "Smoke over Watson tonight" }, "hype", pool, []).id, "t");
  assert.equal(chatterLine({ text: "New noodle place" }, "hype", pool, []).id, "h");
  assert.equal(chatterLine({ text: "New noodle place" }, "hater", pool, []).id, "x");
  assert.equal(chatterLine({ text: "New noodle place" }, "bot", pool, []), null, "no line in that mood or any");
  assert.equal(chatterLine({ text: "Smoke over Watson" }, "hype", pool, ["Watson's still burning?"]).id, "h", "not twice in a thread");
});

test("chatter: the least used line first", () => {
  const pool = [line("a", "one", { used: 3 }), line("b", "two", { used: 1 }), line("c", "three", { used: 1 })];
  for (let i = 0; i < 10; i++) assert.ok(["b", "c"].includes(chatterLine({ text: "x" }, "hype", pool, []).id));
});

test("the crowd says the chatter before the word lists, then falls back to them", () => {
  const a = people();
  const p = post("militech", "Peace.");
  const pick = pickAutoReply(p, a, { lists, chatter: [line("a", "anyone else see that?")] });
  assert.deepEqual([pick.account.id, pick.text, pick.chatter], ["cit", "anyone else see that?", "a"]);
  p.replies.push(auto("cit", "anyone else see that?"));
  const next = pickAutoReply(p, a, { lists, chatter: [line("a", "anyone else see that?")] });
  assert.ok(lists.replyHype.includes(next.text));
  assert.equal(next.chatter, undefined);
});

test("the cast never says the chatter", () => {
  const a = people();
  const p = post("cit", "Kabuki, shooting");
  p.replies.push({ id: "r1", accountId: "cit", text: "Roach says no." }, { id: "r2", accountId: "cit", text: "Roach saw it first." }, { id: "r3", accountId: "cit", text: "Pay first." });
  for (let i = 0; i < 20; i++) assert.equal(pickAutoReply(p, a, { lists, chatter: [line("a", "chatter")] }).account.id, "cit");
});

test("no crowd and nobody fits: nothing", () => {
  const a = people();
  delete a.cit;
  assert.equal(pickAutoReply(post("militech", "Peace."), a, { lists }), null);
});

/* ---------------- On the host's tick ---------------- */

let gm;
beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  actAs(gm);
  addActor({ id: "pcB", name: "Kade" });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null
  });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

test("the tick: a grown corp post gets crowd replies and its fitting cast, never corps or news", async () => {
  const add = data => store.garden.accounts[store._addAccount(data).id];
  const zig = Object.values(store.garden.accounts).find(a => a.handle === "@ziggurat_trends");
  const n54 = Object.values(store.garden.accounts).find(a => a.handle === "@network54");
  n54.writer = writer(["Back to you."], { keywords: ["militech"] });
  zig.writer = writer(["Trending now."], { keywords: ["militech"] });
  const rocklin = add({ handle: "@rocklin", name: "Rocklin Augmentics", kind: "corp" });
  rocklin.writer = writer(["New drop soon."], { keywords: ["militech"] });
  const militech = add({ handle: "@militech", name: "Militech", kind: "corp" });
  const roach = add({ handle: "@roach", name: "Roach", kind: "citizen" });
  roach.writer = writer(["Militech again. Of course."], { keywords: ["militech"] });
  for (let i = 0; i < 4; i++) add({ handle: `@cit${i}`, name: `Cit ${i}`, kind: "citizen", mood: ["hype", "hater", "bot", "lurker"][i] });
  const post = await store._publish(militech, { text: "Militech: peace through strength.", tier: "explosive", wt: Date.now() / 1000 - 86400 });
  await store._tickGarden();
  const by = post.replies.filter(r => r.auto).map(r => store.garden.accounts[r.accountId]);
  assert.ok(by.length > 3);
  assert.ok(by.every(a => a.kind === "citizen"), `only citizens: ${by.map(a => a.handle)}`);
  assert.equal(by.filter(a => a === roach).length, 1, "Roach once");
  assert.ok(by.filter(a => a.writer?.lines?.length).length * 3 <= Math.max(3, post.eng.replies));
});

test("the tick: crowd replies use the live chatter and count it; expired lines are dropped", async () => {
  const militech = store._addAccount({ handle: "@militech", name: "Militech", kind: "corp" });
  for (let i = 0; i < 3; i++) store._addAccount({ handle: `@cit${i}`, name: `Cit ${i}`, kind: "citizen", mood: "hype" });
  const now = Date.now() / 1000;
  store.garden.chatter = [line("live", "militech again??", { keywords: ["militech"], until: now + 86400 }), line("old", "old news", { until: now - 10 })];
  const post = await store._publish(store.garden.accounts[militech.id], { text: "Militech: peace through strength.", tier: "explosive", wt: now - 86400 });
  await store._tickGarden();
  const texts = post.replies.filter(r => r.auto).map(r => r.text);
  assert.ok(texts.includes("militech again??"));
  assert.ok(!texts.includes("old news"));
  assert.deepEqual(store.garden.chatter.map(c => [c.id, c.used]), [["live", 1]]);
});

import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden, LIST_FILES, parseList, setGardenLists } from "../apps/garden/model.js";
import { isCrowd, MAX_REACTIONS, pickReaction } from "../apps/garden/replies.js";

const lists = Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))]));
setGardenLists(lists);

/*
 * The Garden's auto-replies (apps/garden/replies.js, host.js _tickGarden): a growing post gets a
 * reaction or two from random citizens (the word lists), and that's all; the rest of a thread is the
 * writer's and the players'.
 */

const writer = (lines, more = {}) => ({ keywords: [], reacts: [], ties: [], lines, ...more });
const people = () => ({
  cit: { id: "cit", handle: "@mae_nc", name: "Mae", kind: "citizen", mood: "hype" },
  grump: { id: "grump", handle: "@grump", name: "Grump", kind: "citizen", mood: "hater" },
  roach: { id: "roach", handle: "@roach", name: "Roach", kind: "citizen", mood: "hater", writer: writer(["Roach says no."]) },
  fixer: { id: "fixer", handle: "@ink", name: "Ink", kind: "fixer", writer: writer(["Pay first."]) },
  rocklin: { id: "rocklin", handle: "@rocklin", name: "Rocklin Augmentics", kind: "corp", mood: "pr" },
  n54: { id: "n54", handle: "@network54", name: "Network 54", kind: "news" },
  pc: { id: "pc", handle: "@kade", name: "Kade", kind: "pc", actorId: "pcB", mood: "hype" }
});
const post = (accountId, text, more = {}) => ({ id: "p", accountId, text, replies: [], eng: { replies: 9, mix: { hype: 1, hater: 1 } }, ...more });
const auto = (accountId, text = "x") => ({ id: Math.random().toString(36), accountId, text, auto: true });

test("the crowd: NPC citizens with a mood, not the cast, corps, news or characters", () => {
  assert.deepEqual(Object.values(people()).filter(isCrowd).map(x => x.id), ["cit", "grump"]);
});

test("a reaction: from the crowd, in their mood's word list", () => {
  const a = people();
  for (let i = 0; i < 20; i++) {
    const pick = pickReaction(post("pc", "Back from the Afterlife"), a, { lists });
    assert.ok(["cit", "grump"].includes(pick.account.id));
    assert.ok(lists[pick.account.id === "cit" ? "replyHype" : "replyHater"].includes(pick.text));
  }
});

test("who reacts follows the post's mood mix", () => {
  const a = people();
  for (let i = 0; i < 10; i++) assert.equal(pickReaction(post("pc", "x", { eng: { replies: 4, mix: { hater: 1 } } }), a, { lists }).account.id, "grump");
});

test("a citizen reacts once per thread; with everyone done, nothing", () => {
  const a = people();
  const p = post("pc", "x", { replies: [auto("cit")] });
  assert.equal(pickReaction(p, a, { lists }).account.id, "grump");
  p.replies.push(auto("grump"));
  assert.equal(pickReaction(p, a, { lists }), null);
});

test("a line isn't said twice in a thread", () => {
  const a = { cit: people().cit };
  const p = post("pc", "x", { replies: [{ id: "r", accountId: "pc", text: "SO preem 🔥" }] });
  assert.equal(pickReaction(p, a, { lists: { replyHype: ["SO preem 🔥", "legend"] } }).text, "legend");
  assert.equal(pickReaction(p, a, { lists: { replyHype: ["SO preem 🔥"] } }), null);
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

test("the tick: a grown post gets MAX_REACTIONS crowd reactions at most, never the cast's", async () => {
  const add = data => store.garden.accounts[store._addAccount(data).id];
  const roach = add({ handle: "@roach", name: "Roach", kind: "citizen", mood: "hater" });
  roach.writer = writer(["Roach says no."]);
  for (let i = 0; i < 4; i++) add({ handle: `@cit${i}`, name: `Cit ${i}`, kind: "citizen", mood: ["hype", "hater", "bot", "lurker"][i] });
  const kade = add({ handle: "@kade", name: "Kade", kind: "pc", actorId: "pcB" });
  const militech = add({ handle: "@militech", name: "Militech", kind: "corp" });
  const wt = Date.now() / 1000 - 86400;
  const posts = [await store._publish(kade, { text: "Back from the Afterlife", tier: "explosive", wt }), await store._publish(militech, { text: "Peace through strength.", tier: "explosive", wt })];
  await store._tickGarden();
  await store._tickGarden();
  for (const p of posts) {
    assert.ok(p.eng.replies > MAX_REACTIONS);
    const by = p.replies.filter(r => r.auto).map(r => store.garden.accounts[r.accountId]);
    assert.equal(by.length, MAX_REACTIONS);
    assert.ok(by.every(isCrowd), `only the crowd: ${by.map(a => a.handle)}`);
    assert.equal(new Set(by).size, by.length, "each once");
  }
});

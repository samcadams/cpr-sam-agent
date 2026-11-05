import { addActor, addUser, actAs, files, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { joinGarden, joinMessages, monthOf, splitGarden, splitMessages } from "../scripts/model/storage.js";

/*
 * The host's data folder: split into small files, and only what changed uploaded.
 */

const DATA = "worlds/test-world/cpr-sam-agent";
let alice;

beforeEach(async () => {
  await store._writing;
  reset();
  addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(game.users.get("gm"));
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500, flags: { contacts: [{ name: "Rogue" }, { name: "Dex" }] } });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null, _unsaved: {}
  });
  store._folders = store._ensureFolders();
});

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const threadFor = contact => [...store.threads.values()].find(t => t.contact === contact);

/** Count uploads per file while `fn` runs. */
async function uploadsDuring(fn) {
  const upload = FilePicker.upload;
  const counts = {};
  FilePicker.upload = async (source, dir, file) => {
    const path = `${dir}/${file.name}`.slice(DATA.length + 1);
    counts[path] = (counts[path] ?? 0) + 1;
    return upload(source, dir, file);
  };
  try {
    await fn();
  } finally {
    FilePicker.upload = upload;
  }
  return counts;
}

test("split and joined again, the data is the same; growing tables go by month", () => {
  const sept = Date.UTC(2026, 8, 15), oct = Date.UTC(2026, 9, 2);
  const data = {
    threads: new Map([["t1", { id: "t1", messages: [] }], ["t2", { id: "t2", messages: [] }]]),
    requests: new Map([["r1", { id: "r1" }]]),
    quests: new Map([["q1", { id: "q1" }]]),
    apps: { ...emptyApps(), ledger: { a: { id: "a", ts: sept }, b: { id: "b", ts: oct }, c: { id: "c" } }, subs: { pcA: { plan: "silver" } } }
  };
  const { index, parts } = splitMessages(data);
  assert.deepEqual(Object.keys(parts).filter(p => p.startsWith("apps/ledger")).sort(),
    ["apps/ledger-2026-09.json", "apps/ledger-2026-10.json", "apps/ledger-undated.json"]);
  assert.ok(parts["threads/t1.json"] && parts["apps/subs.json"]);
  const back = joinMessages(JSON.parse(JSON.stringify(index)), JSON.parse(JSON.stringify(parts)));
  assert.deepEqual(Object.keys(back.threads), ["t1", "t2"]);
  assert.deepEqual(back.apps.ledger, data.apps.ledger);
  assert.deepEqual(back.apps.subs, data.apps.subs);
  assert.deepEqual(back.requests, { r1: { id: "r1" } });
  assert.equal(monthOf(undefined), "undated");

  const garden = { ...emptyGarden(), accounts: { x: { id: "x" } }, posts: { p1: { id: "p1", ts: sept }, p2: { id: "p2", ts: oct } } };
  const g = splitGarden(garden);
  assert.deepEqual(g.index.files.sort(), ["garden/posts-2026-09.json", "garden/posts-2026-10.json"]);
  assert.equal(g.index.posts, undefined, "posts are only in their files");
  assert.deepEqual(joinGarden(g.index, g.parts), garden);
});

test("the host creates its folders, and a save uploads only what changed", async () => {
  assert.ok(files.size === 0);
  const first = await uploadsDuring(async () => {
    from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "one" });
    await settle();
  });
  const rogue = `threads/${threadFor("Rogue").id}.json`;
  assert.equal(first[rogue], 1);
  assert.equal(first["messages.json"], 1);

  const second = await uploadsDuring(async () => {
    from(alice, "send", { actorId: "pcA", contact: "Dex", text: "two" });
    await settle();
  });
  const dex = `threads/${threadFor("Dex").id}.json`;
  assert.equal(second[dex], 1, "the new conversation");
  assert.equal(second[rogue], undefined, "the other one is left alone");
  assert.equal(second["apps/subs.json"], undefined, "so are unchanged app tables");
  assert.equal(second["messages.json"], 1, "the index lists the new file");

  const third = await uploadsDuring(async () => {
    from(alice, "send", { actorId: "pcA", contact: "Dex", text: "three" });
    await settle();
  });
  assert.deepEqual(Object.keys(third), [dex], "only the conversation that changed; the index is the same");
});

test("a deleted conversation's file is emptied, and loading reads everything back", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "keep" });
  from(alice, "send", { actorId: "pcA", contact: "Dex", text: "gone" });
  await settle();
  const dex = threadFor("Dex");
  store.threads.delete(dex.id);
  store.save();
  await settle();
  assert.equal(files.get(`${DATA}/threads/${dex.id}.json`), "{}", "emptied, since the host can't delete files");

  const before = structuredClone([...store.threads.values()]);
  Object.assign(store, { threads: new Map(), _written: new Map() });
  await store.load();
  assert.equal(store.loadFailed, false);
  assert.deepEqual([...store.threads.values()], before);

  const after = await uploadsDuring(async () => {
    store.save();
    await settle();
  });
  assert.deepEqual(after, {}, "freshly loaded, nothing needs writing");
});

test("a failed upload is retried, and the index waits for it", async () => {
  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "one" });
  await settle();
  const rogue = `threads/${threadFor("Rogue").id}.json`;
  const index = files.get(`${DATA}/messages.json`);

  const upload = FilePicker.upload;
  FilePicker.upload = async (source, dir, file) => (file.name === "messages.json" || dir.endsWith("/threads") && !rogue.endsWith(file.name) ? false : upload(source, dir, file));
  from(alice, "send", { actorId: "pcA", contact: "Dex", text: "two" });
  await settle();
  FilePicker.upload = upload;
  assert.equal(files.get(`${DATA}/messages.json`), index, "the index doesn't list a file that isn't there");

  const retry = await uploadsDuring(async () => {
    store.save();
    await settle();
  });
  assert.equal(retry[`threads/${threadFor("Dex").id}.json`], 1);
  assert.equal(retry["messages.json"], 1);
});

test("a failed save tries again on its own, without waiting for the next change", async () => {
  const upload = FilePicker.upload;
  const retrySave = store._retrySave;
  const retries = [];
  store._retrySave = (key, again) => retries.push([key, again]);
  store._retryTimers = {};
  FilePicker.upload = async (source, dir, file) => (dir.endsWith("/apps") ? {} : upload(source, dir, file));
  try {
    from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "one" });
    from(game.users.get("gm"), "alert-send", { actorIds: ["pcA"], text: "Heads up" });
    await settle();
    assert.ok(retries.length && retries.every(([key]) => key === "messages"), "the alerts file failed: a retry is set");
    assert.equal(store._saveWarned, true);

    FilePicker.upload = upload;
    store._retrySave = retrySave;
    store._retries = { messages: 1 };
    const writes = await uploadsDuring(async () => {
      retries[0][1]();
      await settle();
    });
    assert.ok(Object.keys(writes).some(path => path.startsWith("apps/alerts-")), "the retry saves it");
    assert.equal(store._saveWarned, false, "and says so");
    assert.deepEqual(store._retries, {});
  } finally {
    FilePicker.upload = upload;
    store._retrySave = retrySave;
    store._saveWarned = false;
  }

  // While one retry waits, more failures don't stack more timers.
  store._retries = {};
  store._retrySave("messages", () => {});
  const timer = store._retryTimers.messages;
  store._retrySave("messages", () => {});
  assert.equal(store._retryTimers.messages, timer);
  assert.equal(store._retries.messages, 1);
  clearTimeout(timer);
  store._retryTimers = {};
  store._retries = {};
});

test("unsaved changes: marked until a write after the latest change goes through, so leaving can warn", async () => {
  assert.equal(store.hasUnsavedChanges(), false);
  // A change made while an older write is uploading stays unsaved after that write.
  store._markUnsaved("messages");
  const older = store._unsaved.messages;
  store._markUnsaved("messages");
  store._markSaved("messages", older);
  assert.equal(store.hasUnsavedChanges(), true, "the newer change is still waiting");

  from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "one" });
  await settle();
  assert.equal(store.hasUnsavedChanges(), false, "the save went through");

  // A failed upload keeps it unsaved (the retry will write it).
  const upload = FilePicker.upload;
  const retrySave = store._retrySave;
  FilePicker.upload = async () => false;
  store._retrySave = () => {};
  try {
    from(alice, "send", { actorId: "pcA", contact: "Rogue", text: "two" });
    await settle();
    assert.equal(store.hasUnsavedChanges(), true, "a failed save is still unsaved");
  } finally {
    FilePicker.upload = upload;
    store._retrySave = retrySave;
  }
  await store.flushSaves();
  assert.equal(store.hasUnsavedChanges(), false, "flushing writes it now");

  // The Garden too; with its history unreadable, saving is off and there's nothing to wait for.
  store.saveGarden();
  await settle();
  assert.equal(store.hasUnsavedChanges(), false);
  store.gardenFailed = true;
  store.saveGarden();
  await settle();
  assert.equal(store.hasUnsavedChanges(), false);
});

test("unreadable history is never overwritten", async () => {
  files.set(`${DATA}/messages.json`, JSON.stringify({ version: 6, files: ["threads/x.json"] }));
  files.set(`${DATA}/threads/x.json`, "{ broken");
  await store.load();
  assert.equal(store.loadFailed, true);
  const writes = await uploadsDuring(async () => {
    store.save();
    await settle();
  });
  assert.deepEqual(writes, {});
});

test("older worlds: shelves move into the data folder, boxes from Gacha to Achieve!; crew achievements and boxes are dropped, once", async () => {
  const sept = Date.UTC(2026, 8, 15);
  const crewBox = { id: "b1", crewKey: "party", table: 3, status: "sealed", ts: sept };
  const shelf = [{ id: "p1", cid: "c1", name: "Holo Johnny", rarity: "legendary", ts: sept }];
  const earned = { payday: { by: ["pcA"], note: "", ts: sept, spent: null } };
  await game.settings.set("cpr-sam-agent", "gacha", { boxes: { b1: crewBox }, shelves: { pcA: shelf } });
  await game.settings.set("cpr-sam-agent", "achievements", { crews: { party: earned } });
  await store.load();
  await settle();
  assert.deepEqual(store.apps.gachaShelves, { pcA: shelf });
  assert.deepEqual(store.apps.boxes, {}, "crew boxes aren't moved");
  assert.equal(store.apps.gachaBoxes, undefined);
  assert.deepEqual(store.apps.earned, {}, "nor crew achievements");
  assert.deepEqual(JSON.parse(files.get(`${DATA}/apps/gachaShelves.json`)), { pcA: shelf });
  assert.deepEqual(game.settings.get("cpr-sam-agent", "gacha"), { boxes: {}, shelves: {} }, "the old settings are emptied");
  assert.deepEqual(game.settings.get("cpr-sam-agent", "achievements"), { crews: {} });

  // A world that had already moved them into the data folder by crew: those go, a character's stay.
  const box = { id: "b2", actorId: "pcA", table: 4, status: "sealed", ts: sept };
  files.set(`${DATA}/apps/earned.json`, JSON.stringify({ party: earned, pcA: { vip: { note: "", ts: sept, spent: null } } }));
  files.set(`${DATA}/apps/gachaBoxes-2026-09.json`, JSON.stringify({ b1: crewBox, b2: box }));
  const index = JSON.parse(files.get(`${DATA}/messages.json`));
  index.files = [...new Set([...index.files, "apps/earned.json", "apps/gachaBoxes-2026-09.json"])];
  files.set(`${DATA}/messages.json`, JSON.stringify(index));
  store.apps = emptyApps();
  await store.load();
  await settle();
  assert.deepEqual(Object.keys(store.apps.earned), ["pcA"]);
  assert.deepEqual(store.apps.boxes, { b2: box }, "a character's box moves to Achieve!");
  assert.equal(store.apps.gachaBoxes, undefined);
  assert.deepEqual(JSON.parse(files.get(`${DATA}/apps/earned.json`)), { pcA: { vip: { note: "", ts: sept, spent: null } } });
  assert.deepEqual(JSON.parse(files.get(`${DATA}/apps/boxes-2026-09.json`)), { b2: box });
  assert.deepEqual(JSON.parse(files.get(`${DATA}/apps/gachaBoxes-2026-09.json`)), {}, "the old file is left empty");

  // And again: nothing changes.
  const again = await uploadsDuring(async () => {
    store.apps = emptyApps();
    await store.load();
    await settle();
  });
  assert.deepEqual(again, {});
});

test("players get their own characters' shelves, boxes and achievements", async () => {
  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  const bob = addUser({ id: "bob" });
  const { appsFor } = await import("../scripts/model/apps.js");
  const apps = {
    ...emptyApps(),
    gachaShelves: { pcA: [{ id: "p1" }], pcB: [{ id: "p2" }] },
    boxes: { b1: { id: "b1", actorId: "pcA" }, b2: { id: "b2", actorId: "pcB" } },
    earned: { pcA: { payday: {} }, pcB: { vip: {} } }
  };
  const mine = appsFor(alice, apps);
  assert.deepEqual(Object.keys(mine.gachaShelves), ["pcA"], "only her own character's shelf");
  assert.deepEqual(Object.keys(mine.boxes), ["b1"], "and boxes");
  assert.deepEqual(Object.keys(mine.earned), ["pcA"], "and achievements");
  assert.deepEqual(Object.keys(appsFor(bob, apps).earned), ["pcB"]);
  assert.equal(appsFor(game.users.get("gm"), apps), apps, "the GM sees everything");
});

test("BREACH: players see the Breach Points meant for them, without the GM's outcomes", async () => {
  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  const bob = addUser({ id: "bob" });
  const { appsFor } = await import("../scripts/model/apps.js");
  const apps = {
    ...emptyApps(),
    breachPoints: {
      open: { id: "open", everyone: true, actorIds: [], effects: { d1: "secret" } },
      judy: { id: "judy", everyone: false, actorIds: ["pcB"], effects: {} }
    },
    breaches: { r1: { id: "r1", actorId: "pcA" }, r2: { id: "r2", actorId: "pcB" } }
  };
  const mine = appsFor(alice, apps);
  assert.deepEqual(Object.keys(mine.breachPoints), ["open"]);
  assert.equal(mine.breachPoints.open.effects, undefined, "the outcomes stay the GM's");
  assert.deepEqual(Object.keys(mine.breaches), ["r1"]);
  assert.deepEqual(Object.keys(appsFor(bob, apps).breachPoints).sort(), ["judy", "open"]);
  assert.equal(apps.breachPoints.open.effects.d1, "secret", "the host's own rows are untouched");
});

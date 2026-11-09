import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { build } from "../tools/apps.mjs";
import { MODULE_ID } from "../scripts/config.js";
import { store } from "../scripts/store.js";
import { approvals } from "../scripts/ui/director/views/dashboard.js";
import { callStrip } from "../scripts/ui/director/views/calls.js";
import { directorState, directorTakesCalls } from "../scripts/ui/director/state.js";
import { AgentPhone } from "../scripts/ui/phone/AgentPhone.js";
import { GmLogic } from "../scripts/ui/director/logic.js";
import * as gardenView from "../scripts/ui/director/views/garden.js";
import { emptyGarden } from "../apps/garden/model.js";

/* The GM Director (scripts/ui/director/): its app seam, Dashboard approvals and call routing. */

let gm;

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  addUser({ id: "alice" });
  addActor({ id: "pcA", name: "V", owners: ["alice"] });
  store.threads = new Map();
  store.calls = new Map();
  store.quests = new Map();
  store.requests = new Map();
  store.apps = {};
  store.garden = emptyGarden();
  Object.assign(store, { loaded: true, loadFailed: false, _written: new Map(), _writing: null });
  directorState.open = false;
  AgentPhone.token = AgentPhone.console = null;
  actAs(gm);
});

test("npm run apps lists exactly the app folders with a director.js", async () => {
  const files = await build();
  const listed = [...files["apps/directors.js"].matchAll(/export \* as (\w+) from/g)].map(m => m[1]);
  const folders = fs.readdirSync("apps").filter(id => fs.existsSync(path.join("apps", id, "director.js")));
  assert.deepEqual(listed.sort(), folders.sort());
  assert.ok(listed.includes("market"));
});

test("Dashboard approvals: contact requests and Great River orders, oldest first; an order on request opens Economy to be priced", async () => {
  await game.settings.set(MODULE_ID, "features", { app_market: true });
  store.requests = new Map([["r1", { id: "r1", actorId: "pcA", name: "Rogue", note: "the fixer", ts: 300 }]]);
  store.apps.orders = {
    o1: { id: "o1", actorId: "pcA", status: "pending", ts: 100, total: 50, lines: [{ name: "Medtech kit", price: 50, qty: 1 }] },
    o2: { id: "o2", actorId: "pcA", status: "pending", ts: 200, lines: [{ name: "Rare part", price: null, qty: 2 }] },
    o3: { id: "o3", actorId: "pcA", status: "shipping", ts: 50, lines: [] }
  };
  const rows = approvals();
  assert.deepEqual(rows.map(r => r.key), ["o1", "o2", "r1"], "pending orders and requests, by age; not a shipped order");
  assert.ok(rows[0].actions.find(a => a.action === "market-approve"));
  assert.equal(rows[1].actions.find(a => a.action === "market-approve"), undefined, "a price on request is set in Economy");
  assert.deepEqual(rows[1].actions.find(a => a.action === "goto").data, { tab: "economy", economyApp: "market", marketTab: "queue" });
  assert.match(rows[1].detail, /2× Rare part \(price on request\)/);
  assert.match(rows[2].title, /V asks to add Rogue/);

  await game.settings.set(MODULE_ID, "features", { app_market: false });
  assert.deepEqual(approvals().map(r => r.key), ["r1"], "an app switched off has no approvals");
});

test("calls ring on the Director while it's open (client setting), and the GM Phone stops handling them", async () => {
  const phone = AgentPhone.get("console");
  await game.settings.set(MODULE_ID, "directorCalls", true); // its default (settings.js)
  assert.equal(phone.handlesCalls, true, "closed: calls stay on the GM Phone");
  directorState.open = true;
  assert.equal(directorTakesCalls(), true);
  assert.equal(phone.handlesCalls, false);
  await game.settings.set(MODULE_ID, "directorCalls", false);
  assert.equal(directorTakesCalls(), false);
  assert.equal(phone.handlesCalls, true);
});

test("the call strip: Answer and Decline for each NPC ringing, Leave once on, End for everyone", () => {
  store.calls = new Map([["c1", {
    id: "c1", callerKey: "a:pcA", startedAt: null,
    participants: [
      { key: "a:pcA", name: "V", actorId: "pcA", state: "joined" },
      { key: "n:Rogue", name: "Rogue", state: "ringing" },
      { key: "n:Kerry", name: "Kerry", state: "joined" }
    ]
  }]]);
  const html = callStrip();
  assert.match(html, /data-director="call-answer"[^>]*data-key="n:Rogue"/);
  assert.match(html, /data-director="call-decline"[^>]*data-key="n:Rogue"/);
  assert.match(html, /data-director="call-hangup"[^>]*data-key="n:Kerry"/);
  assert.match(html, /data-director="call-close"/);
  assert.doesNotMatch(html, /data-key="a:pcA"/, "the player isn't the GM's to answer");
  store.calls = new Map();
  assert.equal(callStrip(), "");
});

const direct = (id, actorId, contact) => ({
  id, type: "direct", actorId, contact, hideId: false, lastRead: {}, viewed: 0,
  messages: [{ id: `${id}-m`, from: "pc", text: "hi", ts: 1000, time: "12:00" }]
});

test("Dashboard approvals: each waiting Garden draft batch, with Review opening the Garden's Drafts", async () => {
  store.garden.drafts = { batches: { b1: { id: "b1", ts: 150, summary: "3 posts, 1 reply", errors: [], items: [] }, b2: { id: "b2", ts: 50, summary: "1 post", errors: [{ message: "x" }], items: [] } }, reviews: [] };
  await game.settings.set(MODULE_ID, "features", { app_garden: true, anthropic: true });
  const rows = approvals();
  assert.deepEqual(rows.map(r => r.key), ["b2", "b1"]);
  assert.match(rows[0].title, /1 error/);
  assert.deepEqual(rows[1].actions, [{ action: "goto", label: "Review", primary: true, data: { tab: "garden", gardenTab: "drafts" } }]);
  await game.settings.set(MODULE_ID, "features", { app_garden: true, anthropic: false });
  assert.deepEqual(approvals(), [], "the Anthropic API tools off: the writer's batches are hidden");
  await game.settings.set(MODULE_ID, "features", { app_garden: false, anthropic: true });
  assert.deepEqual(approvals(), [], "the Garden switched off: none");
});

test("Director Garden: Drafts, Writer and the writer-profile feather only with the Anthropic API tools on", async () => {
  store.garden.accounts = { n54: { id: "n54", handle: "@network54", name: "N54", kind: "news", followers: 1000 } };
  const director = { logic: new GmLogic(), drafts: {} };
  director.logic.gardenTab = "accounts";
  await game.settings.set(MODULE_ID, "features", { app_garden: true, anthropic: true });
  let html = gardenView.html(director);
  assert.match(html, /data-tab="drafts"/);
  assert.match(html, /data-tab="writer"/);
  assert.match(html, /garden-writer-edit/);
  await game.settings.set(MODULE_ID, "features", { app_garden: true, anthropic: false });
  html = gardenView.html(director);
  assert.doesNotMatch(html, /data-tab="drafts"|data-tab="writer"/);
  assert.doesNotMatch(html, /garden-writer-edit/);
  director.logic.gardenTab = "writer";
  gardenView.html(director);
  assert.equal(director.logic.gardenTab, "feed", "a hidden tab falls back to the feed");
});

test("GmLogic: the GM Phone's dropdowns and actions, never drawn; pick:persona narrows the inbox and redraws the Director", () => {
  store.threads = new Map([["t1", direct("t1", "pcA", "Rogue")], ["t2", direct("t2", "pcA", "Kerry")]]);
  let redraws = 0;
  const logic = new GmLogic(() => redraws++);
  assert.deepEqual(logic.inboxRows(logic.ctx()).map(r => r.name).sort(), ["Kerry", "Rogue"]);
  logic.pick("persona", "Rogue");
  assert.equal(logic.persona.name, "Rogue");
  assert.deepEqual(logic.inboxRows(logic.ctx()).map(r => r.threadId), ["t1"], "only the conversation with Rogue");
  assert.ok(redraws > 0, "its render redraws the Director");
  logic.run("garden-tab", { tab: "queue" });
  assert.equal(logic.gardenTab, "queue");
  logic.gardenPost = "p1";
  assert.equal(logic.with({ gardenPost: null }, () => logic.gardenPost), null);
  assert.equal(logic.gardenPost, "p1", "with() puts the state back");
});

test("Director Garden: a numbered rail of the GM's pages, the feed with its composer, controls as Director controls", async () => {
  await game.settings.set(MODULE_ID, "features", { app_garden: true });
  store.garden.accounts = { n54: { id: "n54", handle: "@network54", name: "N54", kind: "news", followers: 1000 } };
  store.garden.posts = { p1: { id: "p1", accountId: "n54", text: "Fire in Watson", wt: 10, ts: 10, likes: 3, grafts: 1, replies: [], likedBy: [], graftedBy: [] } };
  const director = { logic: new GmLogic(), drafts: {} };
  director.logic.gardenTab = "news";
  let html = gardenView.html(director);
  assert.match(html, /data-director="phone:garden-tab" data-tab="queue"/);
  assert.match(html, /director-rail-n">01</);
  assert.match(html, /data-director="garden-post"/);
  assert.match(html, /data-director="pick:gardenAs"[\s\S]*@network54/);
  assert.match(html, /Fire in Watson/);
  assert.doesNotMatch(html, /data-action=/, "data-action is the phone's only");
  director.logic.gardenPost = "p1";
  html = gardenView.html(director);
  assert.match(html, /data-director="garden-reply" data-post-id="p1"/);
  assert.match(html, /data-director="pick:gardenBoost"/);
});

import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DIALOGS, PARTIALS, TEMPLATES } from "../scripts/config.js";
import { store } from "../scripts/store.js";
import { personaColor } from "../scripts/model/threads.js";
import { settleAppsOff } from "../scripts/model/features.js";
import { AgentPhone, ACTIONS } from "../scripts/ui/phone/AgentPhone.js";

/* The phone's data for its templates, built without a browser. */

let gm, alice;

const direct = (id, actorId, contact, text) => ({
  id, type: "direct", actorId, contact, hideId: false, lastRead: {}, viewed: 0,
  messages: [{ id: `${id}-m`, from: "pc", text, ts: 1000, time: "12:00" }]
});

beforeEach(async () => {
  await store._writing; // the last test's saves land first
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  addUser({ id: "bob" });
  addActor({ id: "pcA", name: "V", owners: ["alice"], flags: { contacts: [{ name: "Rogue" }] } });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  store.threads = new Map([
    ["t1", direct("t1", "pcA", "Rogue", "Need a ride")],
    ["t2", direct("t2", "pcB", "Kerry", "Gig tonight")]
  ]);
  store.calls = new Map();
  store.quests = new Map();
  Object.assign(store, { loaded: true, loadFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  AgentPhone.token = AgentPhone.console = null;
  canvas.tokens.controlled = [];
});

/** A phone opened on Messages (phones start on the Apps page). */
const inMessages = mode => Object.assign(new AgentPhone(mode), { app: "messages" });

/** Every template file, with its text: the core ones (templates/) and each app's (apps/<id>/). */
const templates = ["templates", "apps"].flatMap(dir => fs.readdirSync(dir, { recursive: true })
  .filter(f => f.endsWith(".hbs"))
  .map(f => ({ file: dir === "apps" ? `apps/${f}` : f, text: fs.readFileSync(`${dir}/${f}`, "utf8") })));

test("every data-action in the templates has exactly one handler", () => {
  const used = new Set();
  for (const { text } of templates) {
    for (const [, name] of text.matchAll(/data-action="([^"]+)"/g)) used.add(name);
  }
  const missing = [...used].filter(a => !ACTIONS.has(a));
  const unused = [...ACTIONS.keys()].filter(a => !used.has(a));
  assert.deepEqual(missing, [], "actions in templates without a handler");
  assert.deepEqual(unused, [], "handlers nothing in the templates uses");
});

test("the GM Phone lists every conversation the first time it opens", () => {
  actAs(gm);
  const data = inMessages("console").getData();
  assert.ok(data.page.inbox);
  assert.deepEqual(data.rows.map(r => r.name).sort(), ["Kerry", "Rogue"]);
  assert.equal(data.pickers.whose.current.value, "all");
  assert.equal(data.pickers.as.current.label, "Anyone");
});

test("the GM Phone can narrow the inbox to one character", () => {
  actAs(gm);
  const phone = inMessages("console");
  phone.inbox = "pcB";
  assert.deepEqual(phone.getData().rows.map(r => r.name), ["Kerry"]);
  // A character that no longer exists falls back to everything.
  phone.inbox = "deleted";
  assert.equal(phone.getData().rows.length, 2);
});

test("a player's phone shows only their character's conversations", () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const data = inMessages("token").getData();
  assert.ok(data.page.inbox);
  assert.deepEqual(data.rows.map(r => r.name), ["Rogue"]);
  assert.equal(data.inboxName, "V");
});

test("without an Agent the player's phone has nothing in hand", () => {
  actAs(alice, gm);
  alice.character = addActor({ id: "pcC", owners: ["alice"], items: [] });
  assert.ok(inMessages("token").getData().page.none);
});

test("opening a conversation from the inbox shows its messages", () => {
  actAs(gm);
  const phone = inMessages("console");
  phone.getData(); // first render: the home screen
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  const data = phone.getData();
  assert.ok(data.page.direct);
  assert.deepEqual(data.thread.messages.map(m => m.text), ["Need a ride"]);
  // The GM Phone says loudly who the GM is speaking as.
  assert.deepEqual(data.actingAs, { verb: "Texting as", name: "Rogue", color: personaColor("Rogue"), target: "V", note: null });
  // …and heads the page with who it's talking to.
  assert.equal(data.thread.name, "V");

  ACTIONS.get("back").call(phone, {});
  assert.ok(phone.getData().page.inbox);
});

test("every partial used is registered, and every registered template exists", () => {
  for (const { file, text } of templates) {
    for (const [, name] of text.matchAll(/\{\{>\s*([\w-]+)/g)) {
      const inline = new RegExp(`\\{\\{#\\*inline "${name}"`).test(text);
      assert.ok(inline || name in PARTIALS, `${file} uses {{> ${name}}}`);
    }
  }
  const prefix = "modules/cpr-sam-agent/";
  for (const path of [...Object.values(TEMPLATES), ...Object.values(DIALOGS), ...Object.values(PARTIALS)]) {
    assert.ok(path.startsWith(prefix) && fs.existsSync(path.slice(prefix.length)), path);
  }
});

test("service pages: one call button, lines in a list, and only the GM handles money", async () => {
  await game.settings.set("cpr-sam-agent", "services", [
    { id: "tt", name: "Trauma Team", img: "tt.png", actions: [{ id: "a1", label: "Pickup" }], callLabel: "Emergency, Dispatch", chat: false, access: "all" }
  ]);
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  ACTIONS.get("open-contact").call(phone, { kind: "service", actorId: "pcA", serviceId: "tt" });
  const player = phone.getData();
  assert.ok(player.page.service);
  assert.deepEqual(player.service.lines, ["Emergency", "Dispatch"]);
  assert.equal(player.service.multiLine, true);
  assert.equal(player.service.canCall, true);
  assert.equal(player.service.canMoney, false, "players only pay requests");
  assert.equal(player.actingAs, null);

  actAs(gm);
  const gmPhone = inMessages("console");
  gmPhone.getData();
  ACTIONS.get("open-thread").call(gmPhone, { kind: "service", actorId: "pcA", serviceId: "tt" });
  const gmData = gmPhone.getData();
  assert.equal(gmData.service.canMoney, true, "the GM can always bill");
  assert.deepEqual(gmData.actingAs, { verb: "Replying as", name: "Trauma Team", color: personaColor("Trauma Team"), target: "V" });
});

test("a texts-only contact hides the player's call button", async () => {
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "contacts", [{ name: "Rogue", noCall: true }]);
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  const data = phone.getData();
  assert.equal(data.thread.canSend, true);
  assert.equal(data.thread.canCall, false);
});

test("the dock follows the Jobs switch, and only the GM Phone has Control", async () => {
  actAs(gm);
  const gmPhone = inMessages("console");
  let data = gmPhone.getData();
  const docked = d => d.dock.items.map(i => i.id);
  assert.deepEqual(docked(data), ["contacts", "messages", "quests", "control"]);
  ACTIONS.get("app").call(gmPhone, { app: "control" });
  data = gmPhone.getData();
  assert.ok(data.page.control);
  assert.deepEqual(data.control.characters.map(c => c.name), ["V", "Judy"]);
  assert.deepEqual(data.control.apps.slice(0, 2).map(a => a.key), ["comms", "jobs"], "Communications and Jobs are switched on and off with the other apps");
  assert.equal(data.control.features, undefined, "the other world switches are in Configure Settings → Phone rules");
  // Label and icon fields show what's in use, defaults included.
  assert.equal(data.control.labels.find(l => l.key === "noSignal").value, "NO SIGNAL");
  assert.equal(data.control.icons.find(i => i.key === "call").value, "fas fa-phone");

  // Photos and map pins are in Messages' own settings (the gear); the Available tab in Jobs'.
  gmPhone.app = "messages";
  ACTIONS.get("app-settings").call(gmPhone, { app: "messages" });
  data = gmPhone.getData();
  assert.deepEqual(data.appSettings.toggles.map(f => f.key), ["images", "playerImages", "playerUploads", "locations"]);
  assert.equal(data.appSettings.toggles.find(f => f.key === "playerUploads").on, false, "Foundry's default: players can't upload");
  assert.ok(data.appSettings.hasQuickReplies);
  ACTIONS.get("app").call(gmPhone, { app: "quests" });
  ACTIONS.get("app-settings").call(gmPhone, { app: "quests" });
  assert.deepEqual(gmPhone.getData().appSettings.toggles.map(f => f.key), ["jobsAvailable"]);
  gmPhone.appSettings = null;

  await game.settings.set("cpr-sam-agent", "features", { jobs: false });
  gmPhone.app = "quests";
  data = gmPhone.getData();
  assert.deepEqual(docked(data), ["contacts", "messages", "control"]);
  assert.ok(data.page.home, "a switched-off app falls back to the Apps page");

  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  const phone = inMessages("token");
  phone.app = "control";
  assert.ok(phone.getData().page.home, "players have no Control app");
});

test("the Anthropic API Tools switch (Configure Settings → Integrations): off by default, it hides Claude in Ask Alex and DataPool", async () => {
  actAs(gm);
  await game.settings.set("cpr-sam-agent", "alexAi", { key: "sk-ant-test" });
  await game.settings.set("cpr-sam-agent", "features", { app_alex: true, app_screamsheet: true });
  const gmPhone = inMessages("console");
  const view = app => (gmPhone.app = app, gmPhone.getData());
  assert.equal(view("alex").alex.anthropic, false, "the Optional Anthropic API section is hidden");
  assert.equal(view("screamsheet").screamsheet.anthropic, false, "no Draft with Claude on the desk");

  await game.settings.set("cpr-sam-agent", "features", { app_alex: true, app_screamsheet: true, anthropic: true });
  assert.equal(view("alex").alex.anthropic, true);
  assert.equal(view("screamsheet").screamsheet.anthropic, true);
});

test("a phone without signal shows it and can't send", async () => {
  await game.settings.set("cpr-sam-agent", "noSignal", { pcA: 1 });
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  const data = phone.getData();
  assert.equal(data.online, false);
  assert.equal(data.thread.canSend, false);
  assert.equal(data.appearance.labels.noSignal, "NO SIGNAL");
});

test("the GM can restyle emoji, labels and icons", async () => {
  await game.settings.set("cpr-sam-agent", "appearance", { emoji: ["🔥", "💀"], labels: { viewed: "Seen" }, icons: { call: "fas fa-headset" } });
  actAs(gm);
  const data = inMessages("console").getData();
  assert.deepEqual(data.emoji, ["🔥", "💀"]);
  assert.equal(data.appearance.labels.viewed, "Seen");
  assert.equal(data.appearance.labels.noSignal, "NO SIGNAL");
  assert.equal(data.appearance.icons.call, "fas fa-headset");
  assert.equal(data.appearance.icons.messages, "fas fa-comments");
});

test("pictures: the sheet's portrait, zoomed; token art only when the portrait is the default; chosen pictures stay", async () => {
  const { actorAvatar, pictureOf } = await import("../scripts/model/threads.js");
  const a = addActor({ id: "npcP", name: "Padre", type: "npc" });
  assert.equal(actorAvatar(a), "npcP.png");
  assert.equal(pictureOf("npcP-token.png", "npcP"), "npcP.png", "an old saved token picture follows the portrait");
  assert.equal(pictureOf(null, "npcP"), "npcP.png");
  assert.equal(pictureOf("custom.webp", "npcP"), "custom.webp", "a picture chosen for them stays");
  assert.equal(pictureOf("x.webp", null), "x.webp", "no sheet: as saved");
  a.img = "icons/svg/mystery-man.svg";
  assert.equal(actorAvatar(a), "npcP-token.png", "default portrait: the token art");
});

/* ---------------- 1.3.0 ---------------- */

test("texting as a sheet adds it as a linked contact, and reuses an existing conversation", async () => {
  addActor({ id: "npcT", name: "Takemura", type: "npc" });
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  const pc = game.actors.get("pcA");

  await phone._openAs(pc, { actor: game.actors.get("npcT") });
  assert.deepEqual(phone.view, { kind: "direct", actorId: "pcA", contact: "Takemura", hidden: false });
  assert.deepEqual(pc.getFlag("cpr-sam-agent", "contacts").at(-1), { name: "Takemura", img: "npcT.png", actorId: "npcT" });

  // Rogue is already a contact with a conversation: that's what opens.
  await phone._openAs(pc, { name: "rogue" });
  assert.equal(phone.view.contact, "Rogue");
  assert.equal(phone.getData().thread.messages[0].text, "Need a ride");

  // A hidden caller ID doesn't give itself away by appearing in their contacts.
  addActor({ id: "npcS", name: "Smasher", type: "npc" });
  await phone._openAs(pc, { actor: game.actors.get("npcS") }, true);
  assert.equal(phone.view.hidden, true);
  assert.ok(!pc.getFlag("cpr-sam-agent", "contacts").some(c => c.name === "Smasher"));
});

test("dropping actors on the GM Phone", async () => {
  addActor({ id: "npcT", name: "Takemura", type: "npc" });
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  phone._dropActor(game.actors.get("npcT"));
  assert.equal(phone.view, null, "no inbox chosen yet: nothing to text");

  phone._dropActor(game.actors.get("pcB"));
  assert.equal(phone.inbox, "pcB", "a PC opens their inbox");

  phone._dropActor(game.actors.get("npcT"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(phone.view, { kind: "direct", actorId: "pcB", contact: "Takemura", hidden: false });
});

test("the GM Phone offers jobs; the player's card has Accept and Decline", () => {
  store.quests = new Map([["q1", { id: "q1", name: "Heist", status: "available", hidden: true, objectives: [] }]]);
  store.threads.get("t1").messages.push({
    id: "m2", from: "contact", text: "", ts: 2000, time: "12:01",
    job: { questId: "q1", name: "Heist", summary: "Steal it", img: null, status: "offered" }
  });

  actAs(gm);
  const gmPhone = inMessages("console");
  gmPhone.getData();
  ACTIONS.get("open-thread").call(gmPhone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  gmPhone.jobs[gmPhone.draftKey] = "q1";
  const gmData = gmPhone.getData();
  assert.equal(gmData.canJob, true);
  assert.deepEqual(gmData.pendingJob, { name: "Heist" });
  assert.equal(gmData.thread.messages[1].job.canRespond, false, "the GM doesn't answer its own offer");

  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  const data = phone.getData();
  assert.equal(data.canJob, false);
  const card = data.thread.messages[1].job;
  assert.equal(card.canRespond, true);
  assert.equal(card.statusLabel, "Offer");
});

/* ---------------- 1.4.0 ---------------- */

/** Select a token on the canvas. */
const select = (actorId, name) => {
  const actor = game.actors.get(actorId);
  canvas.tokens.controlled = actor ? [{ id: `tok-${actorId}`, actor, document: { name: name ?? actor.name, texture: { src: `${actorId}.webp` } } }] : [];
};

test("no phone dropdown is a native <select> (browsers draw their lists unreadably)", () => {
  for (const { file, text } of templates) {
    if (file.startsWith("phone") || file.startsWith("apps/")) assert.ok(!/<select/.test(text), file);
  }
});

test("GMs have no token phone; the GM Phone narrows by whose phone and who it acts as", () => {
  addActor({ id: "npcR", name: "Rogue", type: "npc" });
  actAs(gm);
  select("npcR");
  assert.equal(inMessages("token").getData().page.none, true, "no NPC phone any more");

  store.threads.set("t3", direct("t3", "pcB", "Rogue", "Hey"));
  const phone = inMessages("console");
  let data = phone.getData();
  assert.deepEqual(data.pickers.as.options.map(o => o.label), ["Anyone", "Kerry", "Rogue"]);
  assert.equal(data.pickers.as.options.find(o => o.label === "Rogue").count, 2);

  ACTIONS.get("dropdown-pick").call(phone, { name: "persona", value: "Rogue" });
  data = phone.getData();
  assert.deepEqual(data.rows.map(r => r.name).sort(), ["Judy", "V"], "rows are named after the PC");
  assert.equal(phone.persona.actorId, "npcR", "the sheet is found by name");

  ACTIONS.get("dropdown-pick").call(phone, { name: "inbox", value: "pcB" });
  assert.deepEqual(phone.getData().rows.map(r => r.name), ["Judy"]);
});

test("selecting a token offers to switch the GM Phone, and never switches by itself", () => {
  addActor({ id: "npcR", name: "Rogue", type: "npc" });
  actAs(gm);
  const phone = inMessages("console");
  select("npcR", "Rogue (disguised)");
  let data = phone.getData();
  assert.equal(data.tokenPrompt.label, "Act as Rogue (disguised)");
  assert.equal(phone.persona, null);

  ACTIONS.get("token-apply").call(phone, {});
  assert.deepEqual(phone.persona, { name: "Rogue (disguised)", actorId: "npcR" });
  assert.equal(phone.getData().tokenPrompt, null, "already acting as them");

  select("pcA");
  assert.equal(phone.getData().tokenPrompt.label, "Open V's phone");
  ACTIONS.get("token-dismiss").call(phone, {});
  assert.equal(phone.getData().tokenPrompt, null, "dismissed until the selection changes");
  select("pcB");
  ACTIONS.get("token-apply").call(phone, {});
  assert.equal(phone.inbox, "pcB");
});

test("acting as an NPC on one PC's phone, + opens the conversation straight away", async () => {
  addActor({ id: "npcT", name: "Takemura", type: "npc" });
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  phone.inbox = "pcA";
  phone.persona = { name: "Takemura", actorId: "npcT" };
  assert.equal(phone.getData().canCompose, true);
  await phone._newThread();
  assert.deepEqual(phone.view, { kind: "direct", actorId: "pcA", contact: "Takemura", hidden: false });
});

test("a player's contact card: from Contacts, to the conversation and back", async () => {
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "notes", [{ key: "rogue", text: "Fixer. Owes me 500eb." }]);
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.app = "contacts";
  const contacts = phone.getData();
  const row = contacts.contacts.rows[0];
  assert.equal(row.card, true);

  ACTIONS.get("open-contact").call(phone, { kind: "direct", actorId: "pcA", contact: "Rogue", card: "true" });
  let data = phone.getData();
  assert.ok(data.page.card);
  assert.equal(data.card.name, "Rogue");
  assert.equal(data.card.fromElsewhere, true);
  assert.equal(data.card.notes.editable, true);
  assert.equal(data.card.canDeleteMine, true);
  assert.equal(data.card.gm, null);

  ACTIONS.get("card-text").call(phone, {});
  data = phone.getData();
  assert.ok(data.page.direct);
  ACTIONS.get("back").call(phone, {});
  assert.ok(phone.getData().page.card, "back to the card");
  ACTIONS.get("back").call(phone, {});
  assert.equal(phone.app, "contacts", "and back to Contacts");
});

test("the GM's card is the contact on that PC's phone, with the player's notes shortened", async () => {
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "notes", [{ key: "rogue", text: "line\n".repeat(8) }]);
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  assert.equal(phone.getData().thread.hasNotes, true);
  ACTIONS.get("card").call(phone, {});
  let data = phone.getData();
  assert.equal(data.card.sub, "In V's contacts");
  assert.equal(data.card.notes.long, true);
  assert.equal(data.card.notes.open, false);
  assert.deepEqual(data.card.gm, { canImage: true, canBlock: true, canReveal: false, canDelete: true });
  assert.equal(data.actingAs.name, "Rogue", "still says who the GM is");

  ACTIONS.get("toggle-notes").call(phone, {});
  assert.equal(phone.getData().card.notes.open, true);
  ACTIONS.get("card-text").call(phone, {});
  data = phone.getData();
  assert.ok(data.page.direct, "Messages goes back to the conversation");
});

test("a group with two NPCs names and colours each of the GM's messages; speak-as is saved", async () => {
  store.threads.set("g1", {
    id: "g1", type: "group", name: "Crew", lastRead: {},
    members: [{ key: "a:pcA", actorId: "pcA", name: "V" }, { key: "n:rogue", name: "Rogue" }, { key: "n:takemura", name: "Takemura" }],
    messages: [
      { id: "m1", from: "n:rogue", name: "Rogue", text: "Ready?", ts: 1, time: "12:00" },
      { id: "m2", from: "n:takemura", name: "Takemura", text: "Always", ts: 2, time: "12:01" }
    ]
  });
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  phone.persona = { name: "Takemura", actorId: null };
  ACTIONS.get("open-thread").call(phone, { kind: "group", groupId: "g1" });
  let data = phone.getData();
  assert.deepEqual(data.group.messages.map(m => [m.mine, m.sender, m.persona]), [[true, "Rogue", true], [true, "Takemura", true]]);
  assert.equal(data.group.messages[0].color, personaColor("Rogue"));
  assert.equal(data.actingAs.picker.current.label, "Takemura", "acting as Takemura: the default speaker");

  await ACTIONS.get("dropdown-pick").call(phone, { name: "speakAs", value: "n:rogue" });
  assert.equal(gm.getFlag("cpr-sam-agent", "speakAs").g1, "n:rogue");
  data = inMessages("console").getData.call(Object.assign(inMessages("console"), { view: { kind: "group", groupId: "g1" }, subjectKey: "console" }));
  assert.equal(data.actingAs.picker.current.label, "Rogue", "the choice survives a new window");
});

test("the GM Phone lists every call it holds someone in, with a button per NPC", () => {
  store.calls = new Map([
    ["c1", { id: "c1", threadId: "g1", groupName: "Crew", callerKey: "a:pcA", startedAt: null, participants: [
      { key: "a:pcA", actorId: "pcA", name: "V", state: "joined" },
      { key: "n:rogue", name: "Rogue", state: "ringing" },
      { key: "n:takemura", name: "Takemura", state: "ringing" }
    ] }],
    ["c2", { id: "c2", threadId: "t2", callerKey: "a:pcB", startedAt: 1, participants: [
      { key: "a:pcB", actorId: "pcB", name: "Judy", state: "joined" },
      { key: "n:kerry", name: "Kerry", state: "joined" }
    ] }]
  ]);
  actAs(gm);
  const data = inMessages("console").getData();
  assert.ok(data.page.gmCalls);
  assert.deepEqual(data.calls.map(c => c.title), ["Crew", "Judy"], "the ringing call first");
  assert.equal(data.calls[0].canAnswerAll, true);
  assert.deepEqual(data.calls[0].participants.filter(p => p.canAnswer).map(p => p.key), ["n:rogue", "n:takemura"]);
  assert.deepEqual(data.calls[1].participants.filter(p => p.canLeave).map(p => p.key), ["n:kerry"]);
  assert.equal(data.actingAs.verb, "Receiving call as");
  assert.equal(data.actingAs.name, "Rogue, Takemura");
});

test("players have a Settings app; the GM Phone's look and quick replies are in Control", () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  let data = phone.getData();
  assert.deepEqual(data.dock.items.map(i => i.id), ["contacts", "messages", "quests", "settings"]);
  ACTIONS.get("app").call(phone, { app: "settings" });
  data = phone.getData();
  assert.ok(data.page.settings);
  assert.equal(data.settings.look.skin.current.label, "Neon Agent");
  assert.equal(data.settings.look.palette.name, "theme", "Neon Agent takes the colour palettes");
  assert.equal(data.settings.look.canDockSide, true);

  actAs(gm);
  const console = inMessages("console");
  console.app = "settings";
  data = console.getData();
  assert.ok(!data.page.settings, "the GM Phone has no Settings app");
  console.app = "control";
  data = console.getData();
  assert.deepEqual(data.control.phone.simTiles, { on: false });
});

test("an Internal Agent is the Neuron HUD, unless the player turns that off", async () => {
  actAs(alice, gm);
  const actor = addActor({ id: "pcI", name: "Nix", owners: ["alice"], items: ["Internal Agent"] });
  alice.character = actor;
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  assert.equal(phone._ctx.look.skin, "neuron");
  phone.app = "settings";
  let data = phone.getData();
  assert.deepEqual(data.settings.look.skin.options.map(o => o.value), ["neuron"], "only the HUD while the HUD is forced");

  await actor.setFlag("cpr-sam-agent", "phone", { skin: "burner" });
  assert.equal(phone.context().look.skin, "neuron", "not a phone skin");
  data = phone.getData();
  assert.ok(data.settings.look.hudOpacity, "the HUD opacity slider");
  assert.equal(data.settings.look.palette.name, "internalTheme");
  assert.deepEqual(data.settings.look.freeInternal, { on: false });

  await actor.setFlag("cpr-sam-agent", "phone", { freeInternal: true, skin: "neuron" });
  data = phone.getData();
  assert.equal(data.settings.look.skin.current.label, "Rocklin Augmentics Neuron", "free to choose, and chose the HUD");
  assert.equal(data.settings.look.palette.name, "internalTheme");
  assert.ok(data.settings.look.hudOpacity);

  await actor.setFlag("cpr-sam-agent", "phone", { freeInternal: true, skin: "burner" });
  data = phone.getData();
  assert.equal(phone._ctx.look.skin, "burner");
  assert.equal(data.settings.look.palette, null, "Burner has no palettes");
  assert.deepEqual(data.settings.look.fontScale, { value: 1, percent: 100 }, "the text size slider, on every skin");
});

test("the lock screen: taking the phone out shows new messages; one opens its conversation", () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  store.threads.get("t1").messages[0].from = "contact";
  const phone = inMessages("token");
  phone.locked = true;
  let data = phone.getData();
  assert.ok(data.page.lock);
  assert.deepEqual(data.lock.notifications.map(n => n.name), ["Rogue"]);
  assert.equal(data.dock, undefined, "no apps until it's unlocked");

  ACTIONS.get("lock-open").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" }, { stopPropagation() {} });
  data = phone.getData();
  assert.ok(data.page.direct);

  // Switched off: straight in.
  game.actors.get("pcA").setFlag("cpr-sam-agent", "phone", { lockScreen: false });
  phone.locked = true;
  assert.ok(!phone.getData().page.lock);
});

test("GM: \"Set as Viewed\" is under the player's newest message, until it's viewed", () => {
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  let data = phone.getData();
  assert.deepEqual(data.thread.messages.map(m => !!m.setViewed), [true]);
  store.threads.get("t1").viewed = 2000;
  data = phone.getData();
  assert.deepEqual(data.thread.messages.map(m => !!m.setViewed), [false]);
});

test("a player's own name for a contact: on their phone, and \"Renamed to\" on the GM's", async () => {
  await game.actors.get("pcA").setFlag("cpr-sam-agent", "aliases", [{ key: "rogue", name: "The Queen" }]);
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  assert.deepEqual(phone.getData().rows.map(r => r.name), ["The Queen"]);
  ACTIONS.get("open-contact").call(phone, { kind: "direct", actorId: "pcA", contact: "Rogue", card: "true" });
  let data = phone.getData();
  assert.equal(data.card.name, "The Queen");
  assert.deepEqual(data.card.rename, { value: "The Queen", real: "Rogue" });

  actAs(gm);
  const console = inMessages("console");
  console.getData();
  ACTIONS.get("open-thread").call(console, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  data = console.getData();
  assert.match(data.thread.renamed, /The Queen/);
  ACTIONS.get("card").call(console, {});
  data = console.getData();
  assert.equal(data.card.name, "Rogue");
  assert.equal(data.card.renamed, "The Queen");
});

test("players open a group member's contact card from Group info, and come back to it", () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  store.threads.set("g1", {
    id: "g1", type: "group", name: "Crew", lastRead: {}, messages: [],
    members: [{ key: "a:pcA", actorId: "pcA", name: "V" }, { key: "n:rogue", name: "Rogue" }]
  });
  const phone = inMessages("token");
  phone.getData();
  phone.view = { kind: "group-info", groupId: "g1" };
  let data = phone.getData();
  assert.deepEqual(data.info.members.map(m => m.canCard), [false, true]);
  ACTIONS.get("member-card").call(phone, { name: "Rogue" });
  data = phone.getData();
  assert.ok(data.page.card);
  ACTIONS.get("back").call(phone, {});
  assert.ok(phone.getData().page.groupInfo);
});

test("GM: SIM tiles for the NPCs in use; tapping one acts as them", async () => {
  actAs(gm);
  await gm.setFlag("cpr-sam-agent", "phone", { simTiles: true });
  const phone = inMessages("console");
  let data = phone.getData();
  assert.deepEqual(data.sims.tiles.map(t => t.name).sort(), ["Kerry", "Rogue"]);
  assert.equal(data.sims.all, true);
  ACTIONS.get("sim-pick").call(phone, { name: "Rogue" });
  data = phone.getData();
  assert.equal(phone.persona.name, "Rogue");
  assert.deepEqual(data.rows.map(r => r.name), ["V"]);
  ACTIONS.get("sim-pick").call(phone, { name: "Rogue" });
  assert.equal(phone.persona, null, "tapping it again goes back to everyone");
});

test("redraws: a phone skips changes that aren't on its screen", () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.getData();
  assert.equal(phone.affectedBy({ threadId: "t1" }), true, "its inbox");
  assert.equal(phone.affectedBy({ threadId: "t2" }), false, "someone else's conversation");
  phone.view = { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue" };
  phone.getData();
  store.threads.set("t3", direct("t3", "pcA", "Kerry", "yo"));
  assert.equal(phone.affectedBy({ threadId: "t3" }), false, "another of theirs, while reading this one");
  assert.equal(phone.affectedBy({ threadId: "t1" }), true);
  phone.app = "control";
  assert.equal(phone.affectedBy({ requests: true }), false);
  assert.equal(phone.affectedBy({ all: true }), true);
});

test("split view: the list beside the conversation when the window is wide", () => {
  actAs(gm);
  const phone = inMessages("console");
  phone.position = { width: 700 };
  let data = phone.getData();
  assert.ok(data.split && data.page.splitEmpty && data.rows.length === 2);
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  data = phone.getData();
  assert.ok(data.split && data.page.direct && data.rows.length === 2);
  phone.position = { width: 340 };
  data = phone.getData();
  assert.ok(!data.split && data.page.direct && !data.rows);
});

test("GM: whether players can see the Available jobs tab, always shown under it", async () => {
  actAs(gm);
  const phone = inMessages("console");
  phone.app = "quests";
  assert.equal(phone.getData().quests.availableNote.shown, true);
  await game.settings.set("cpr-sam-agent", "features", { jobsAvailable: false });
  assert.equal(phone.getData().quests.availableNote.shown, false);
  phone.questTab = "active";
  assert.equal(phone.getData().quests.availableNote, null);
});

test("blood on the screen: only when switched on, and only for a badly hurt holder", async () => {
  actAs(alice, gm);
  const actor = game.actors.get("pcA");
  alice.character = actor;
  store.synced = true;
  actor.system = { derivedStats: { hp: { value: 10, max: 40 } } };
  const phone = inMessages("token");
  assert.equal(phone.getData().blood, null, "off by default");
  await game.settings.set("cpr-sam-agent", "features", { blood: true });
  assert.equal(phone.getData().blood, "serious");
  actor.system.derivedStats.hp.value = 0;
  assert.equal(phone.getData().blood, "mortal");
  actor.system.derivedStats.hp.value = 30;
  assert.equal(phone.getData().blood, null);

  actAs(gm);
  const console = inMessages("console");
  console.bloodPreview = "mortal";
  assert.equal(console.getData().blood, "mortal", "the GM's preview");
});

test("players make their own reaction keyboard; the GM's set is everyone else's", async () => {
  await game.settings.set("cpr-sam-agent", "appearance", { emoji: ["🔥", "💀"] });
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = inMessages("token");
  phone.app = "messages";
  phone.appSettings = "messages"; // Messages' gear: quick replies and the reaction keyboard
  let data = phone.getData();
  assert.deepEqual(data.emoji, ["🔥", "💀"]);
  assert.equal(data.appSettings.emoji.custom, false);

  await phone._setEmoji(["🔥", "💀", "🤘"]);
  data = phone.getData();
  assert.deepEqual(data.emoji, ["🔥", "💀", "🤘"]);
  assert.equal(data.appSettings.emoji.custom, true);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "appearance").emoji, ["🔥", "💀"], "the GM's set is untouched");

  ACTIONS.get("emoji-catalog").call(phone, {});
  assert.ok(phone.getData().appSettings.emoji.catalog.some(g => g.emoji.some(x => x.e === "🤘" && x.on)));
  ACTIONS.get("emoji-reset").call(phone, {});
  assert.deepEqual(phone.getData().emoji, ["🔥", "💀"]);
});

test("skin extras: the Med Field Agent's vitals; a Sponsored Cybereye's ads on any skin", async () => {
  actAs(alice, gm);
  const actor = game.actors.get("pcA");
  alice.character = actor;
  store.synced = true;
  const phone = inMessages("token");
  await actor.setFlag("cpr-sam-agent", "phone", { skin: "classic", lockScreen: false });
  let data = phone.getData();
  assert.equal(data.vitals, undefined);
  assert.equal(data.ad, undefined, "no ads without a Sponsored Cybereye");

  await actor.setFlag("cpr-sam-agent", "phone", { skin: "fieldMed", lockScreen: false });
  actor.system.derivedStats = { hp: { value: 10, max: 40 } };
  data = phone.getData();
  assert.deepEqual(data.vitals, { hp: "10/40", bpm: 128, state: "serious", label: "SERIOUSLY WOUNDED" });
  delete actor.system.derivedStats;

  // A Sponsored Cybereye streams ads over whatever Agent you use.
  await actor.setFlag("cpr-sam-agent", "phone", { skin: "dot", lockScreen: false });
  actor.items.push({ name: "Sponsored Cybereye", type: "cyberware", system: { isInstalled: true } });
  data = phone.getData();
  assert.ok(data.ad?.text, "an ad line");
  actor.items.pop();
  await actor.setFlag("cpr-sam-agent", "phone", {});
});

test("the apps: the home screen lists what's on, and an armed WatchBox takes over the phone", async () => {
  actAs(alice, gm);
  const actor = game.actors.get("pcA");
  alice.character = actor;
  store.synced = true;
  await actor.setFlag("cpr-sam-agent", "phone", { lockScreen: false, agentName: "Kitt" });
  const phone = inMessages("token");
  phone.app = "home";
  let data = phone.getData();
  assert.equal(data.brand, "KITT", "the Agent's name on the status bar");
  assert.deepEqual(data.home.apps.map(a => a.id), ["agent", "garden", "alex", "bangme", "trauma", "watchbox", "notes", "calendar", "weather", "cabb"], "Flappy Chrome, Achieve! and Gacha start off");
  assert.ok(data.dock.home);

  // A new world saves them off; one that used the module before keeps them on. Once, either way.
  await settleAppsOff(false);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "features"), { app_pool: false, app_market: false, app_cbk: false, app_fortify: false, app_pigeon: false, app_ncart: false, app_redline: false, app_roach: false, app_breach: false, app_map: false, app_achieve: false, app_gacha: false, app_ncpd: false, app_screamsheet: false, app_hustool: false, app_handscan: false, app_retinascan: false, app_gladiator: false, turnedOn_weather: true });
  // Weather was an off app: a world that saved it off gets it on, once.
  await game.settings.set("cpr-sam-agent", "features", { app_weather: false });
  await settleAppsOff(true);
  assert.equal(game.settings.get("cpr-sam-agent", "features").app_weather, true);
  await game.settings.set("cpr-sam-agent", "features", { app_weather: false, turnedOn_weather: true });
  await settleAppsOff(true);
  assert.equal(game.settings.get("cpr-sam-agent", "features").app_weather, false, "the GM's later choice stays");
  await game.settings.set("cpr-sam-agent", "features", { app_gacha: false, turnedOn_weather: true });
  await settleAppsOff(true);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "features"), { app_gacha: false, turnedOn_weather: true, app_pool: false, app_market: false, app_cbk: false, app_fortify: false, app_pigeon: true, app_ncart: false, app_redline: false, app_roach: false, app_breach: false, app_map: false, app_achieve: true, app_ncpd: false, app_screamsheet: false, app_hustool: false, app_handscan: false, app_retinascan: false, app_gladiator: false }, "the GM's own choice stays; the Ziggurat Pool, NC Market, NCART Runner, REDLINE, Roach Race, BREACH and Map were never on");
  data = phone.getData();
  assert.deepEqual(data.home.apps.map(a => a.id).slice(-3), ["pigeon", "cabb", "achieve"]);
  await game.settings.set("cpr-sam-agent", "features", {});

  await game.settings.set("cpr-sam-agent", "features", { app_garden: false });
  phone.app = "garden";
  data = phone.getData();
  assert.ok(data.page.home, "a switched-off app goes back to the Apps page");
  await game.settings.set("cpr-sam-agent", "features", {});

  store.apps.watch.pcA = { status: "armed", sceneId: "none", x: 0, y: 0, size: 100, assessUntil: 0 };
  data = phone.getData();
  assert.ok(data.page.watchbox && !data.dock, "the whole phone is the WatchBox");
  assert.equal(data.watchbox.alarm, false);
  delete store.apps.watch.pcA;
  await actor.setFlag("cpr-sam-agent", "phone", {});
});

test("home-screen navigation: no dock, a Home button, every app on the home screen", async () => {
  actAs(alice, gm);
  const actor = game.actors.get("pcA");
  alice.character = actor;
  store.synced = true;
  await actor.setFlag("cpr-sam-agent", "phone", { lockScreen: false, navigation: "home" });
  const phone = inMessages("token");
  phone.openedFresh = true;
  let data = phone.getData();
  assert.ok(data.page.home, "it opens on the home screen");
  assert.equal(data.dock, undefined, "no dock");
  assert.equal(data.homeButton.active, true);
  assert.ok(data.home.screen, "the full home screen, with the clock");
  assert.deepEqual(data.home.apps.slice(0, 4).map(a => a.id), ["contacts", "messages", "quests", "settings"]);

  ACTIONS.get("app").call(phone, { app: "garden" });
  ACTIONS.get("app").call(phone, { app: "home" });
  ACTIONS.get("app").call(phone, { app: "home" });
  assert.equal(phone.app, "home", "the Home button stays home");
  phone.app = "settings";
  assert.equal(phone.getData().settings.look.homeNavigation, true);
  await actor.setFlag("cpr-sam-agent", "phone", {});
});

test("The Garden: a player's handle opens their own Patch; the GM replies as an account they pick", async () => {
  const saved = store.garden;
  store.garden = {
    ...saved,
    accounts: {
      me: { id: "me", handle: "@v", name: "V", kind: "pc", actorId: "pcA", followers: 40 },
      n54: { id: "n54", handle: "@network54", name: "Network 54", kind: "news", followers: 4200000 }
    },
    posts: { p1: { id: "p1", accountId: "n54", text: "News", ts: 1, likes: 0, grafts: 0, likedBy: [], graftedBy: [], replies: [
      { id: "r1", accountId: "me", text: "fake news", ts: 2 }, { id: "r2", accountId: "n54", text: "it's real", ts: 3 }
    ] } }
  };
  try {
    actAs(alice, gm);
    const actor = game.actors.get("pcA");
    alice.character = actor;
    store.synced = true;
    await actor.setFlag("cpr-sam-agent", "phone", { lockScreen: false });
    const phone = inMessages("token");
    phone.app = "garden";
    let data = phone.getData();
    assert.equal(data.garden.me.handle, "@v", "the header's handle is a link to the Patch");
    ACTIONS.get("garden-me").call(phone, {});
    assert.equal(phone.getData().garden.patch.id, "me");
    assert.equal(phone.getData().garden.replyAs, undefined);
    assert.deepEqual(phone.getData().garden.patch.replies.map(r => [r.text, r.to, r.toText, r.canDelete]), [["fake news", "@network54", "News", false]], "their replies, with what they answer");
    await actor.setFlag("cpr-sam-agent", "phone", {});

    actAs(gm);
    const gmPhone = inMessages("console");
    gmPhone.app = "garden";
    gmPhone.gardenPost = "p1";
    data = gmPhone.getData();
    assert.deepEqual(data.garden.replyAs.options.map(o => o.value), ["n54"], "no characters' accounts");
    assert.equal(data.garden.me, null, "the GM has no Patch of their own");
    assert.deepEqual(data.garden.post.replies.map(r => r.canDelete), [false, true], "the GM deletes NPCs' replies, not characters'");
  } finally {
    store.garden = saved;
  }
});

test("Communications off: phones start on the Apps page, without Contacts, Messages or calls", async () => {
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  const phone = new AgentPhone("token");
  assert.equal(phone.app, "home", "a phone starts on the Apps page");
  const docked = d => d.dock.items.map(i => i.id);
  assert.deepEqual(docked(phone.getData()).slice(0, 2), ["contacts", "messages"]);

  await game.settings.set("cpr-sam-agent", "features", { comms: false });
  phone.app = "messages";
  const data = phone.getData();
  assert.ok(data.page.home, "Messages switched off goes back to the Apps page");
  assert.ok(!docked(data).includes("contacts") && !docked(data).includes("messages"));
  assert.equal(phone.canStartCall, false);
  phone.app = "contacts";
  assert.ok(phone.getData().page.home);
  phone.app = "settings";
  const { settings } = phone.getData();
  assert.equal(settings.quickReplies, undefined, "quick replies and the reaction keyboard are Messages' own");
  assert.equal(settings.look.comms, false, "no new-text style, split view or SIM tiles");

  actAs(gm);
  const gmPhone = new AgentPhone("console");
  ACTIONS.get("app").call(gmPhone, { app: "control" });
  assert.equal(gmPhone.getData().control.apps.find(a => a.key === "comms").on, false);
  await game.settings.set("cpr-sam-agent", "features", {});
});

test("Ask Alex on the GM Phone (the host): asking for a roll and answering reach the query", async () => {
  actAs(gm);
  store.apps.queries.q1 = { id: "q1", actorId: "pcA", text: "Who runs the Afterlife?", status: "crawling", ts: 1 };
  const phone = AgentPhone.get("console");
  phone.element = [{ querySelector: sel => sel.startsWith("textarea") ? { value: "Rogue." } : { value: "15" } }];
  ACTIONS.get("alex-need-roll").call(phone, { action: "alex-need-roll", queryId: "q1" });
  await store._enqueue(() => {});
  assert.deepEqual([store.apps.queries.q1.status, store.apps.queries.q1.dv], ["roll", 15]);
  ACTIONS.get("alex-need-roll").call(phone, { action: "alex-need-roll", queryId: "q1", dv: "17" });
  ACTIONS.get("alex-answer").call(phone, { action: "alex-answer", queryId: "q1" });
  await store._enqueue(() => {});
  assert.equal(store.apps.queries.q1.status, "answered");
  assert.equal(store.apps.queries.q1.answer.text, "Rogue.");
});

test("sharing texts: pick an unbroken run, tap an end to drop it, post the ids", () => {
  const t = store.threads.get("t1");
  t.messages = ["a", "b", "c", "d"].map((id, i) => ({ id, from: i % 2 ? "contact" : "pc", text: id, ts: 1000 + i, time: "12:00" }));
  t.messages.splice(2, 0, { id: "call", from: "system", system: true, call: true, text: "Missed call", ts: 1001.5 });
  actAs(gm);
  const phone = inMessages("console");
  phone.getData();
  ACTIONS.get("open-thread").call(phone, { kind: "direct", threadId: "t1", actorId: "pcA", contact: "Rogue", hidden: "false" });
  phone.render = () => {};
  assert.ok(phone.getData().thread.canShare);
  ACTIONS.get("share-start").call(phone);
  const picked = () => phone.getData().thread.messages.filter(m => m.picked).map(m => m.id);
  ACTIONS.get("share-pick").call(phone, { messageId: "b" });
  ACTIONS.get("share-pick").call(phone, { messageId: "d" });
  assert.deepEqual(picked(), ["b", "call", "c", "d"], "the call line in between comes along");
  assert.equal(phone.getData().thread.sharing.count, 3);
  assert.ok(!phone.getData().thread.canReact, "no reacting while picking");
  ACTIONS.get("share-pick").call(phone, { messageId: "d" });
  assert.deepEqual(picked(), ["b", "call", "c"], "tapping the last one drops it");
  ACTIONS.get("share-pick").call(phone, { messageId: "a" });
  assert.deepEqual(picked(), ["a", "b", "call", "c"]);
  const requests = [];
  const request = store.request;
  store.request = (type, data) => requests.push({ type, ...data });
  try {
    ACTIONS.get("share-post").call(phone);
  } finally {
    store.request = request;
  }
  assert.deepEqual(requests.map(r => [r.type, r.threadId, r.from, r.to]), [["share-texts", "t1", "a", "c"]]);
  assert.equal(phone.share, null);
});

test("the notification center: unread texts and the character's own alerts, not cleared ones; the GM's cards on the GM Phone", async () => {
  const { emptyApps } = await import("../scripts/model/apps.js");
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  store.apps = {
    ...emptyApps(),
    alerts: {
      a1: { id: "a1", actorId: "pcA", kind: "advice", text: "Duck", choices: ["Yes", "No"], answer: null, ts: 2000 },
      a2: { id: "a2", actorId: "pcA", kind: "garden", text: "old news", choices: [], answer: null, ts: 500, cleared: true },
      a3: { id: "a3", actorId: "pcB", kind: "advice", text: "not hers", choices: [], answer: null, ts: 3000 }
    },
    gmCards: { c1: { id: "c1", title: "Great River", body: "An order", ts: 4000, actions: [{ label: "Approve", request: "market-approve" }] } }
  };
  store.threads.get("t1").messages.push({ id: "t1-r", from: "contact", text: "On my way", ts: 1500, time: "12:01" });
  const phone = Object.assign(new AgentPhone("token"), { app: "home" });
  let data = phone.getData();
  assert.equal(data.shadeCount, 2, "the status bar counts them");
  assert.equal(data.shade, null, "closed until pulled down");
  phone.shadeOpen = true;
  data = phone.getData();
  assert.deepEqual(data.shade.items.map(i => i.key), ["a:a1", "t:t1"], "newest first; Judy's alert, the cleared one and the GM's cards aren't hers");
  assert.deepEqual(data.shade.items[0].choices, ["Yes", "No"], "it can be answered there");
  assert.equal(data.shade.items[1].title, "Rogue");
  assert.equal(data.shade.items[1].body, "On my way");

  actAs(gm);
  const gmPhone = Object.assign(new AgentPhone("console"), { app: "home", shadeOpen: true });
  const items = gmPhone.getData().shade.items;
  assert.equal(items[0].key, "c:c1");
  assert.deepEqual(items[0].actions.map(a => a.label), ["Approve"]);
  assert.ok(!items.some(i => i.kind === "alert"), "the GM Phone lists cards, not the players' alerts");
});

test("the notification center doesn't flash: it slides in only when pulled down, keeps its scroll, and Clear all empties it at once", async () => {
  const { emptyApps } = await import("../scripts/model/apps.js");
  const { phone: shadeHooks } = await import("../scripts/ui/phone/core/shade.js");
  actAs(alice, gm);
  alice.character = game.actors.get("pcA");
  store.synced = true;
  store.apps = {
    ...emptyApps(),
    alerts: {
      a1: { id: "a1", actorId: "pcA", kind: "advice", text: "One", choices: [], answer: null, ts: 2000 },
      a2: { id: "a2", actorId: "pcA", kind: "advice", text: "Two", choices: [], answer: null, ts: 2100 },
      a3: { id: "a3", actorId: "pcA", kind: "advice", text: "Still asking", choices: ["Yes", "No"], answer: null, ts: 2200 }
    }
  };
  const phone = Object.assign(new AgentPhone("token"), { app: "home" });
  let renders = 0;
  phone.render = () => renders++;
  const list = { scrollTop: 0, addEventListener() {} };
  const root = { querySelector: sel => (sel === ".agent-shade-list" ? list : null) };

  phone._shadeSet(true);
  assert.equal(phone.getData().shade.opening, true, "pulled down: it slides in");
  shadeHooks.render.call(phone, root);
  assert.equal(phone.getData().shade.opening, false, "a redraw while open doesn't replay it");
  phone._shadeTop = 120;
  shadeHooks.render.call(phone, root);
  assert.equal(list.scrollTop, 120, "a redraw keeps the list where it was scrolled to");

  phone.getData(); // sets phone._ctx, as a draw does
  const requests = [];
  const request = store.request;
  store.request = (type, data) => requests.push({ type, ...data });
  try {
    renders = 0;
    ACTIONS.get("shade-clear-all").call(phone);
  } finally {
    store.request = request;
  }
  assert.deepEqual(requests.map(r => [r.type, r.alertIds?.sort()]), [["alert-clear", ["a1", "a2"]]], "one request for them all; the open question stays");
  assert.equal(renders, 1, "one redraw");
  assert.deepEqual(phone.getData().shade.items.map(i => i.key), ["a:a3"], "already gone on screen, before the host answers");
});

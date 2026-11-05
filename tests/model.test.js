import { addActor, addUser, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { clean, initials, similarity, formatDuration } from "../scripts/util/text.js";
import { conversationKey, threadKey, previewText, contactMember, personaColor } from "../scripts/model/threads.js";
import {
  canActFor, canView, sideFor, otherSide, memberActorId, isIncoming, isAuthor, callRole, callRoles,
  redactThread, redactReaction, redactCall
} from "../scripts/model/permissions.js";
import { objectiveHidden, wouldLoop, redactQuest } from "../scripts/model/quests.js";
import { moneyCard, moneyLabel, isHeld, hasWallet, formatMoney, formatPrice, priceTierKey } from "../scripts/model/money.js";

let gm, alice, bob;
beforeEach(() => {
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500 });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  addActor({ id: "noAgent", owners: ["alice"], items: [] });
  addActor({ id: "npc", name: "Rogue" });
});

const direct = (extra = {}) => ({ id: "t1", type: "direct", actorId: "pcA", contact: "Rogue", messages: [], lastRead: {}, ...extra });
const group = () => ({
  id: "g1", type: "group", name: "Crew",
  members: [{ key: "a:pcA", actorId: "pcA", name: "V" }, { key: "a:pcB", actorId: "pcB", name: "Judy" }, { key: "n:rogue", name: "Rogue" }],
  messages: [], lastRead: {}
});
const service = () => ({ id: "s1", type: "service", serviceId: "tt", actorId: "pcA", name: "Trauma Team", messages: [], lastRead: {} });

/* ---------------- util/text ---------------- */

test("text helpers", () => {
  assert.equal(clean("  hello  ", 3), "hel");
  assert.equal(clean(null, 5), "");
  assert.equal(initials("Johnny Silverhand Jr"), "JS");
  assert.equal(initials(""), "");
  assert.equal(similarity("Rogue", "rogue"), 1);
  assert.equal(similarity("Rog", "Rogue Amendiares"), 0.9);
  assert.ok(similarity("Jhonny", "Johnny") >= 0.6);
  assert.ok(similarity("Takemura", "Panam") < 0.6);
  assert.equal(formatDuration(75_000), "1:15");
  assert.equal(formatDuration(-5), "0:00");
});

/* ---------------- keys (persisted in phone settings: must never change) ---------------- */

test("conversation keys keep their saved format", () => {
  assert.equal(threadKey(group()), "g:g1");
  assert.equal(threadKey(service()), "s:pcA:tt");
  assert.equal(threadKey(direct()), "d:pcA:rogue");
  assert.equal(threadKey(direct({ hideId: true })), "d:pcA:t1");
  // Inbox rows produce the same keys as the threads they show.
  assert.equal(conversationKey({ kind: "direct", actorId: "pcA", contact: "ROGUE", hidden: false, threadId: "t1" }), "d:pcA:rogue");
  assert.equal(conversationKey({ kind: "direct", actorId: "pcA", contact: "Unknown Number", hidden: true, threadId: "t1" }), "d:pcA:t1");
  assert.equal(conversationKey({ kind: "service", actorId: "pcA", serviceId: "tt" }), "s:pcA:tt");
  assert.equal(conversationKey({ kind: "group", groupId: "g1" }), "g:g1");
});

test("previews and members", () => {
  assert.equal(previewText({ text: "hi" }), "hi");
  assert.equal(previewText({ text: "", money: { kind: "send", amount: 1200 } }), `💸 Received ${formatMoney(1200)}`);
  assert.equal(previewText({ image: "x.png" }), "📷 Photo");
  assert.equal(previewText({ location: { label: "Afterlife" } }), "📍 Afterlife");
  assert.deepEqual(contactMember({ name: "Judy", actorId: "pcB" }).key, "a:pcB");
  assert.deepEqual(contactMember({ name: "Rogue", actorId: "npc", img: "r.png" }), { key: "n:rogue", name: "Rogue", img: "r.png" });
});

/* ---------------- permissions ---------------- */

test("players act for their own PCs, GMs for NPCs", () => {
  assert.ok(canActFor(alice, { actorId: "pcA" }));
  assert.ok(!canActFor(bob, { actorId: "pcA" }));
  assert.ok(!canActFor(gm, { actorId: "pcA" }));
  assert.ok(canActFor(gm, { key: "n:rogue" }));
  assert.ok(!canActFor(alice, { key: "n:rogue" }));
});

test("who can view a thread", () => {
  assert.ok(canView(gm, direct()));
  assert.ok(canView(alice, direct()));
  assert.ok(!canView(bob, direct()));
  assert.ok(canView(bob, group()));
  addUser({ id: "carol" });
  assert.ok(!canView(game.users.get("carol"), group()));
  assert.equal(memberActorId(bob, group()), "pcB");
  assert.equal(memberActorId(gm, group()), null);
});

test("sides in direct and service threads", () => {
  assert.equal(sideFor(gm, direct()), "contact");
  assert.equal(sideFor(gm, service()), "service");
  assert.equal(sideFor(alice, direct()), "pc");
  assert.equal(sideFor(bob, direct()), null);
  // Owning the PC isn't enough: it needs an Agent.
  assert.equal(sideFor(alice, direct({ actorId: "noAgent" })), null);
  assert.equal(otherSide(direct(), "pc"), "contact");
  assert.equal(otherSide(service(), "pc"), "service");
  assert.equal(otherSide(service(), "service"), "pc");
});

test("incoming messages and authorship", () => {
  const fromContact = { from: "contact", text: "yo" };
  assert.ok(isIncoming(direct(), fromContact, alice, "pcA"));
  assert.ok(!isIncoming(direct(), fromContact, gm, null));
  assert.ok(isIncoming(direct(), { from: "pc" }, gm, null));
  assert.ok(!isIncoming(direct(), { from: "pc", system: true }, gm, null));
  assert.ok(isIncoming(direct(), { from: "pc", system: true, call: true }, gm, null));
  assert.ok(isIncoming(group(), { from: "a:pcB" }, alice, "pcA"));
  assert.ok(!isIncoming(group(), { from: "a:pcA" }, alice, "pcA"));
  assert.ok(!isIncoming(group(), { from: "n:rogue" }, gm, null));
  assert.ok(isAuthor(alice, direct(), { from: "pc" }));
  assert.ok(isAuthor(gm, direct(), { from: "contact" }));
  assert.ok(isAuthor(bob, group(), { from: "a:pcB" }));
  assert.ok(!isAuthor(alice, group(), { from: "a:pcB" }));
});

test("persona colours are stable per name and tell names apart", () => {
  assert.equal(personaColor("Rogue"), personaColor(" rogue "));
  assert.notEqual(personaColor("Rogue"), personaColor("Takemura"));
  assert.match(personaColor("Rogue"), /^hsl\(\d+ 80% 66%\)$/);
});

test("the GM can hold several NPCs in one call", () => {
  const call = { participants: [
    { key: "a:pcA", actorId: "pcA", state: "joined" }, { key: "n:rogue", state: "joined" }, { key: "n:takemura", state: "ringing" }
  ] };
  const roles = callRoles(call, gm);
  assert.deepEqual(roles.joined.map(p => p.key), ["n:rogue"]);
  assert.deepEqual(roles.ringing.map(p => p.key), ["n:takemura"]);
  assert.equal(callRoles(call, bob), null);
});

test("call roles", () => {
  const call = { participants: [{ key: "a:pcA", actorId: "pcA", state: "joined" }, { key: "n:rogue", state: "ringing" }] };
  assert.equal(callRole(call, alice).kind, "active");
  assert.equal(callRole(call, gm).kind, "incoming");
  assert.equal(callRole(call, bob), null);
});

/* ---------------- redaction ---------------- */

test("hidden caller ID is removed for players", () => {
  const hidden = direct({ hideId: true, contactImg: "r.png", contactActorId: "npc", lastReaction: { side: "contact", by: "Rogue" } });
  const r = redactThread(hidden);
  assert.equal(r.contact, "Unknown Number");
  assert.equal(r.contactImg, null);
  assert.equal(r.contactActorId, null);
  assert.equal(r.lastReaction.by, "Unknown Number");
  assert.equal(hidden.contact, "Rogue", "original untouched");
  const plain = direct();
  assert.equal(redactThread(plain), plain, "nothing to hide");
  const g = group();
  assert.equal(redactThread(g), g);

  assert.equal(redactReaction(hidden, { side: "contact", by: "Rogue" }).by, "Unknown Number");
  assert.equal(redactReaction(hidden, { side: "pc", by: "V" }).by, "V");
  assert.equal(redactReaction(direct(), { side: "contact", by: "Rogue" }).by, "Rogue");
  assert.equal(redactReaction(hidden, null), null);

  const call = { participants: [{ name: "Rogue", img: "r.png", hidden: true }, { name: "V", img: "v.png" }] };
  assert.deepEqual(redactCall(call).participants.map(p => p.name), ["Unknown Number", "V"]);
  assert.equal(redactCall(call).participants[0].img, null);
});

/* ---------------- quests ---------------- */

test("objectives hidden through their parents", () => {
  const quest = {
    hidden: false,
    objectives: [
      { id: "a", hidden: false, parentId: null },
      { id: "b", hidden: true, parentId: "a" },
      { id: "c", hidden: false, parentId: "b" },
      { id: "d", hidden: false, parentId: "a" }
    ]
  };
  assert.deepEqual(quest.objectives.map(o => objectiveHidden(quest, o)), [false, true, true, false]);
  assert.deepEqual(redactQuest(quest).objectives.map(o => o.id), ["a", "d"]);
  assert.equal(redactQuest({ ...quest, hidden: true }), null);
});

test("objective loops are detected", () => {
  const quest = { objectives: [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }] };
  assert.ok(wouldLoop(quest, "a", "c"), "a under its own grandchild");
  assert.ok(wouldLoop(quest, "a", "a"), "a under itself");
  assert.ok(!wouldLoop(quest, "c", "a"));
  assert.ok(!wouldLoop(quest, "a", "missing"));
  // Corrupt data with a cycle doesn't hang.
  const cyclic = { objectives: [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }] };
  assert.ok(wouldLoop(cyclic, "x", "y"));
  assert.ok(objectiveHidden(cyclic, cyclic.objectives[0]) === false);
});

/* ---------------- money ---------------- */

test("money labels and wallets", () => {
  assert.equal(moneyLabel({ kind: "send", amount: 50 }, true), `Sent ${formatMoney(50)}`);
  assert.equal(moneyLabel({ kind: "request", amount: 50 }, false), `Requests ${formatMoney(50)}`);
  assert.ok(hasWallet(game.actors.get("pcA")));
  assert.ok(!hasWallet(game.actors.get("pcB")));
  assert.ok(!hasWallet(null));
});

test("money cards through a send", () => {
  const msg = status => ({ money: { kind: "send", amount: 100, status, escrow: status === "sent" } });
  // Held for the receiver.
  assert.ok(isHeld(msg("sent").money));
  assert.deepEqual(pick(moneyCard(msg("sent"), true, true)), { status: "held", statusLabel: "Awaiting transfer", canPay: false, canTransfer: false, canCancel: true });
  assert.deepEqual(pick(moneyCard(msg("sent"), false, true)), { status: "held", statusLabel: "Ready to transfer", canPay: false, canTransfer: true, canCancel: false });
  // Done.
  assert.deepEqual(pick(moneyCard(msg("transferred"), false, true)), { status: "transferred", statusLabel: "Transferred", canPay: false, canTransfer: false, canCancel: false });
  // Read-only phones can't act.
  assert.equal(moneyCard(msg("sent"), false, false).canTransfer, false);
});

test("money cards through a request", () => {
  const msg = (status, escrow = false) => ({ money: { kind: "request", amount: 100, status, escrow } });
  assert.deepEqual(pick(moneyCard(msg("pending"), true, true)), { status: "pending", statusLabel: "Pending", canPay: false, canTransfer: false, canCancel: true });
  assert.deepEqual(pick(moneyCard(msg("pending"), false, true)), { status: "pending", statusLabel: "Pending", canPay: true, canTransfer: false, canCancel: false });
  // Paid and held: the requester transfers it in.
  assert.deepEqual(pick(moneyCard(msg("paid", true), true, true)), { status: "held", statusLabel: "Ready to transfer", canPay: false, canTransfer: true, canCancel: false });
  // Paid to a side with no wallet: nothing to hold.
  assert.deepEqual(pick(moneyCard(msg("paid"), true, true)), { status: "paid", statusLabel: "Paid", canPay: false, canTransfer: false, canCancel: false });
  assert.equal(moneyCard({ text: "no money" }, true, true), null);
});

function pick({ status, statusLabel, canPay, canTransfer, canCancel }) {
  return { status, statusLabel, canPay, canTransfer, canCancel };
}

test("player characters are owned by or assigned to a player, whatever the sheet type", async () => {
  const { isPlayerCharacter } = await import("../scripts/model/agent.js");
  const { playerCharacters } = await import("../scripts/model/contacts.js");
  addActor({ id: "npcChar", name: "Misty", type: "character" });
  const assigned = addActor({ id: "mook", type: "mook" });
  bob.character = assigned;
  assert.equal(isPlayerCharacter(game.actors.get("npcChar")), false);
  assert.equal(isPlayerCharacter(assigned), true);
  assert.deepEqual(playerCharacters().map(a => a.id).sort(), ["mook", "noAgent", "pcA", "pcB"]);
  assert.equal(contactMember({ name: "Misty", actorId: "npcChar" }).key, "n:misty");
});

test("wounds: seriously below half HP, mortally below 1", async () => {
  const { woundState } = await import("../scripts/model/agent.js");
  const hp = (value, max) => ({ system: { derivedStats: { hp: { value, max } } } });
  assert.equal(woundState(hp(40, 40)), null);
  assert.equal(woundState(hp(20, 40)), null, "exactly half isn't yet");
  assert.equal(woundState(hp(19, 40)), "serious");
  assert.equal(woundState(hp(0, 40)), "mortal");
  assert.equal(woundState({ system: {} }), null, "no HP on the sheet");
});

test("the home screen: its owner's order first, then the rest; moving a tile; Ask Alex's short name", async () => {
  const { arrange, moveApp, tileName } = await import("../scripts/model/apps.js");
  const apps = ["a", "b", "c", "d"].map(id => ({ id }));
  const ids = list => list.map(a => a.id);
  assert.deepEqual(ids(arrange(apps, [])), ["a", "b", "c", "d"], "never arranged: as listed");
  assert.deepEqual(ids(arrange(apps, ["c", "gone", "a"])), ["c", "a", "b", "d"], "arranged first; new or never-moved after, in order");
  assert.deepEqual(moveApp(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveApp(["a", "b", "c", "d"], "a", null), ["b", "c", "d", "a"], "nothing after it: the end");
  assert.deepEqual(moveApp(["a", "b", "c", "d"], "a", "c"), ["b", "a", "c", "d"]);
  assert.equal(tileName({ id: "alex", name: "Ask Alex Anything" }), "Ask Alex");
  assert.equal(tileName({ id: "alex", name: "Alex's" }), "Alex's", "the GM's own name stays");
  assert.equal(tileName({ id: "bangme", name: "BangMe!" }), "BangMe!");
});

test("a phone's look: skins, which of them take palettes, and the Internal Agent HUD", async () => {
  const { phoneLook, getPhoneSettings } = await import("../scripts/model/agent.js");
  const base = getPhoneSettings(null);
  assert.deepEqual(phoneLook(base), { skin: "classic", theme: "nightcity", dockSide: false, hud: false, forced: false });
  assert.deepEqual(phoneLook({ ...base, theme: "arasaka", dock: "side" }), { skin: "classic", theme: "arasaka", dockSide: true, hud: false, forced: false });
  assert.equal(phoneLook({ ...base, skin: "burner", theme: "arasaka" }).theme, "nightcity", "Burner brings its own colours");
  assert.equal(phoneLook({ ...base, skin: "burner", dock: "side" }).dockSide, false);
  assert.equal(phoneLook({ ...base, skin: "terminal" }).skin, "classic", "a removed skin falls back");
  assert.deepEqual(phoneLook({ ...base, internalTheme: "internal-ghost" }, true), { skin: "neuron", theme: "internal-ghost", dockSide: false, hud: true, forced: true });
  assert.deepEqual(phoneLook({ ...base, skin: "neuron", internalTheme: "internal-ghost" }), { skin: "neuron", theme: "internal-ghost", dockSide: false, hud: true, forced: false }, "the Neuron always uses the HUD colours");
  assert.equal(phoneLook({ ...base, freeInternal: true, skin: "dot" }, true).skin, "dot", "unless the player frees it");
  // Retired skins (2026-10-21) become the nearest one still offered.
  const retired = { zetatechplus: "zetatech", double: "yourplay", merlyn: "classic", fieldConstruction: "fieldTech", zine: "dot", braindance: "neuron", braingen: "neuron", pir2: "neuron" };
  for (const [skin, now] of Object.entries(retired)) assert.equal(phoneLook({ ...base, skin }).skin, now, `${skin} becomes ${now}`);
  assert.equal(phoneLook({ ...base, skin: "pir2" }, true).skin, "neuron", "a retired HUD on an Internal Agent is the Neuron");
  assert.equal(getPhoneSettings(gm).lockScreen, false, "the GM Phone doesn't lock by default");
});

test("the stylesheets the module adds itself match module.json", async () => {
  const fs = await import("node:fs");
  const { STYLES } = await import("../scripts/config.js");
  const { BUNDLE } = await import("../scripts/styles.js");
  const manifest = JSON.parse(fs.readFileSync(new URL("../module.json", import.meta.url)));
  if (manifest.esmodules[0] === BUNDLE.js) assert.deepEqual(manifest.styles, [BUNDLE.css], "bundled: module.json loads the one bundled stylesheet");
  else assert.deepEqual(STYLES, manifest.styles);
  for (const path of STYLES) assert.ok(fs.statSync(new URL(`../${path}`, import.meta.url)).size > 0, path);
});

test("the dock holds what its owner picked; the rest is on the home screen", async () => {
  const { dockSplit, phoneApps } = await import("../scripts/model/apps.js");
  const apps = phoneApps({ gm: false });
  assert.ok(!apps.some(a => a.id === "control"), "players have Settings, not Control");
  const { dock, home } = dockSplit(apps, ["messages", "garden"]);
  assert.deepEqual(dock.map(a => a.id), ["messages", "garden"]);
  assert.ok(home.some(a => a.id === "contacts") && home.some(a => a.id === "settings"));
  assert.equal(phoneApps({ internal: true }).some(a => a.id === "watchbox"), false);
});

test("the clock: system time (on another date or not), the GM's own clock, with or without \"Day\"", async () => {
  const { agentTimestamp, customClockFields, customClockOffset, dateFieldFor, dateOffsetFor } = await import("../scripts/util/agentTime.js");
  const now = new Date();
  const month = now.toLocaleDateString([], { month: "long" });
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Automatic with no calendar modules: system time, "Day" by default.
  assert.deepEqual(agentTimestamp(), { time: hhmm, date: `${month}, Day ${now.getDate()}, ${now.getFullYear()}` });

  await game.settings.set("cpr-sam-agent", "clock", { source: "system", dayPrefix: false });
  assert.equal(agentTimestamp().date, `${month} ${now.getDate()}, ${now.getFullYear()}`, "no \"Day\"");

  // System time on another date.
  const days = dateOffsetFor("2045-03-07");
  assert.equal(dateFieldFor(days), "2045-03-07");
  await game.settings.set("cpr-sam-agent", "clock", { source: "system", dateOffset: days });
  assert.deepEqual(agentTimestamp(), { time: hhmm, date: "March, Day 7, 2045" });

  // The GM's clock: what they entered, running on.
  const offset = customClockOffset("2045-10-31", "23:15");
  await game.settings.set("cpr-sam-agent", "clock", { source: "custom", offset });
  assert.deepEqual(agentTimestamp(), { time: "23:15", date: "October, Day 31, 2045" });
  assert.deepEqual(customClockFields(offset), { date: "2045-10-31", time: "23:15" });
  assert.equal(customClockOffset("", "12:00"), null);

  // Simple Calendar picked but not active: system time.
  await game.settings.set("cpr-sam-agent", "clock", { source: "calendar" });
  assert.equal(agentTimestamp().time, hhmm);
});

test("each phone keeps its own new-text notification style", async () => {
  const { notifyStyle, setPhoneSettings } = await import("../scripts/model/agent.js");
  const gm = addUser({ id: "gm", isGM: true });
  const v = addActor({ id: "pcV", name: "V" });
  const judy = addActor({ id: "pcJ", name: "Judy" });
  assert.equal(notifyStyle(v), "toast", "a pop-up by default");
  await setPhoneSettings(v, { notify: "open" });
  await setPhoneSettings(gm, { notify: "none" });
  assert.equal(notifyStyle(v), "open");
  assert.equal(notifyStyle(judy), "toast", "another character's phone is unchanged");
  assert.equal(notifyStyle(gm), "none", "the GM Phone has its own");
  await setPhoneSettings(judy, { notify: "shout" });
  assert.equal(notifyStyle(judy), "toast", "an unknown style falls back");
});

test("Price categories: Black Chrome's \"20eb (Everyday)\" from the rulebook's tiers", () => {
  assert.equal(priceTierKey(10), "cheap");
  assert.equal(priceTierKey(11), "everyday");
  assert.equal(priceTierKey(20), "everyday");
  assert.equal(priceTierKey(100), "premium");
  assert.equal(priceTierKey(750), "veryExpensive");
  assert.equal(priceTierKey(5000), "luxury");
  assert.equal(priceTierKey(25000), "superLuxury");
  assert.equal(priceTierKey(0), null);
  assert.equal(priceTierKey(null), null);
  assert.equal(formatPrice(1000), `${formatMoney(1000)} (Very Expensive)`);
  assert.equal(formatPrice(0), formatMoney(0));
});

import { addActor, addUser, actAs, files, reset, sent } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { cabbConfig } from "../apps/cabb/model.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { clampAlpha, clampSize, cleanPinChange, cleanScenes, configFromScene, isTempPin, mapPicture, mapPin, mapReady, ownPicture, ownPins, ownRoute, journalName, mapKmPerPx, matchJournals, NO_DISTRICT, pinsByDistrict, ownCabbRoad, pinFromNote, rowSeenBy, rowShared, pinFromRow, seedFromNav, TERRITORY_SCALE } from "../apps/map/model.js";
import { roadNetwork } from "../apps/map/route.js";
import { CLUSTER_MIN, EXPAND, expandedAt, isExpanded, pinGroups, SHOW_PINS, SHOW_PINS_DEFAULT } from "../apps/map/clusters.js";
import { filterState } from "../apps/map/navFilter.js";
import { categoryIcon, isCategoryIcon, playersLevel, setJournalShared, sharedDoc } from "../apps/map/editor.js";
import { planPinMaps, resolveSceneKey } from "../apps/map/pinScenes.js";
import { existsSync, readFileSync } from "node:fs";
import { resolveMapPaths } from "../scripts/model/content.js";

/*
 * The Map and the GM's view of everyone's routes (apps/map): planned routes reach the host and only the GM (and
 * the character's own player) get them; territories' Map-only look; sharing a pin's journal page lifts its entry
 * to Limited, never lowers it; the GM's edits to the Map's pins go through the host, cleaned.
 */

let gm, alice, bob;

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  bob = addUser({ id: "bob" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], items: ["Agent"] });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], items: ["Agent"] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const lastApps = user => sent.filter(s => s.recipients?.includes(user.id) && s.payload.type === "apps").at(-1)?.payload.apps;

test("Map: a character's planned route reaches the host; only the GM and that character's player get it", async () => {
  const route = { from: { x: 100.4, y: 200, name: "Afterlife" }, to: { crew: true } };
  from(alice, "map-route", { actorId: "pcA", route });
  from(bob, "map-route", { actorId: "pcA", route: { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } } });
  await settle();
  assert.deepEqual(store.apps.routes.pcA.from, { x: 100, y: 200, name: "Afterlife" }, "rounded; only its player sets it");
  assert.deepEqual(store.apps.routes.pcA.to, { crew: true }, "from or to the crew, wherever they are");
  assert.ok(lastApps(alice).routes.pcA, "alice sees her own");
  assert.equal(lastApps(bob)?.routes?.pcA, undefined, "bob doesn't");

  from(alice, "map-route", { actorId: "pcA", route: { from: { x: "nope", y: 1 }, to: { x: 2, y: 2 } } });
  await settle();
  assert.equal(store.apps.routes.pcA, undefined, "nonsense clears it");
  from(alice, "map-route", { actorId: "pcA", route });
  from(alice, "map-route", { actorId: "pcA", route: null });
  await settle();
  assert.equal(store.apps.routes.pcA, undefined, "cleared");
});

const territory = (extra = {}) => ({
  id: "t1", x: 10, y: 20, text: "Tyger Claws", iconSize: 100, texture: { src: "turf.webp", tint: "#ffffff" },
  flags: { world: { r20import: { type: "territories", typeLabel: "Territory", district: "Kabuki" } }, ...extra }
});

test("Map: territories are drawn at twice their scene size unless the GM sized them; the look stays in range", () => {
  const plain = mapPin(territory());
  assert.equal(plain.territory, true);
  assert.equal(plain.size, 100 * TERRITORY_SCALE);
  assert.equal(plain.alpha, 1);
  const sized = mapPin(territory({ "cpr-sam-agent": { map: { size: 640, alpha: 0.4 }, temp: true } }));
  assert.deepEqual([sized.size, sized.alpha, sized.temp], [640, 0.4, true]);
  assert.equal(mapPin({ ...territory(), flags: { world: { r20import: { type: "bar" } } } }).size, null, "only territories");
  assert.deepEqual([clampSize(5), clampSize(99999), clampSize("x")], [20, 4000, 100]);
  assert.deepEqual([clampAlpha(0), clampAlpha(2), clampAlpha(0.333)], [0.1, 1, 0.33]);
  assert.equal(isTempPin(territory()), false);
});

test("Map: sharing a pin's page lifts its entry to Limited (never lowers it); hiding leaves the entry alone", async () => {
  globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
  const doc = (ownership, parent = null) => ({
    ownership: { ...ownership }, parent,
    async update(change) {
      this.ownership.default = change["ownership.default"];
    }
  });
  const entry = { ...doc({ default: 0 }), documentName: "JournalEntry" };
  const page = { ...doc({ default: -1 }, entry), documentName: "JournalEntryPage" };
  const docs = { "JournalEntry.e1": entry, "JournalEntry.e1.JournalEntryPage.p1": page };
  globalThis.fromUuidSync = uuid => docs[uuid] ?? null;
  // (setJournalShared finds the pin's row, and its journal from the row's page)
  store.apps.mapPins = { n1: { id: "n1", name: "Afterlife", page: "JournalEntry.e1.JournalEntryPage.p1" } };
  assert.deepEqual(sharedDoc(store.apps.mapPins.n1), { doc: page, page, entry });
  assert.deepEqual(sharedDoc({ page: "JournalEntry.e1" }), { doc: entry, page: null, entry });
  assert.equal(sharedDoc({ page: null }), null);
  assert.equal(playersLevel(page), 0, "a page that inherits: its entry's");

  await setJournalShared("n1", "observer");
  assert.deepEqual([page.ownership.default, entry.ownership.default], [2, 1]);
  entry.ownership.default = 2;
  await setJournalShared("n1", "limited");
  assert.deepEqual([page.ownership.default, entry.ownership.default], [1, 2], "the entry isn't lowered");
  await setJournalShared("n1", "none");
  assert.deepEqual([page.ownership.default, entry.ownership.default], [0, 2]);

  actAs(alice);
  await setJournalShared("n1", "observer");
  assert.equal(page.ownership.default, 0, "GMs only");
});

/* The Map's own data, seeded from the NAV scene */

// A NAV scene a quarter of its picture's size each way, placed 500, 300 into the canvas: 100 px = 0.1 mi.
const navScene = (notes = []) => ({
  // (a scene's notes iterate as the notes themselves, like Foundry's collections)
  id: "nav", name: "NAV", notes: Object.assign(new Map(notes.map(n => [n.id, n])), { [Symbol.iterator]() { return this.values(); } }),
  background: { src: "assets/Map/map.jpg" },
  dimensions: { sceneRect: { x: 500, y: 300, width: 5880, height: 7840 } },
  grid: { size: 100, distance: 0.1, units: "mi" }
});
const PICTURE = { width: 11760, height: 15680 };
const seedFrom = (note, extra = {}) =>
  pinFromNote(note, { pic: mapPicture(navScene()), size: PICTURE, players: [{ user: alice, actorIds: ["pcA"] }, { user: bob, actorIds: ["pcB"] }], ...extra });

test("Map seed: a NAV pin becomes a mapPins row in the picture's px, with Cabb's link (its one scene) and zone on it", () => {
  const row = seedFrom(
    { id: "n1", text: "Afterlife", x: 1500, y: 1300, texture: { src: "icons/bar.svg", tint: "#b4006a" },
      flags: { world: { r20import: { type: "bar", typeLabel: "Bar", district: "Watson", subLocation: "Little China", iconText: "AFTER" } } } },
    { links: { n1: "scene9" }, zones: { n1: "hot" } }
  );
  assert.deepEqual(row, {
    id: "n1", name: "Afterlife", x: 2000, y: 2000, type: "bar", typeLabel: "Bar", district: "Watson", place: "Little China",
    color: "#b4006a", icon: "icons/bar.svg", text: "AFT", label: false, everyone: true, actorIds: [], page: null,
    size: null, alpha: null, scenes: [{ sceneId: "scene9", label: "" }], zone: "hot"
  });
});

test("Map seed: who sees a pin is baked in: everyone, the characters of the players who see it, or the GM", () => {
  const page = { uuid: "JournalEntry.e1.JournalEntryPage.p1", testUserPermission: user => user.id === "alice" };
  const some = seedFrom({ id: "n2", text: "Safehouse", x: 500, y: 300, page });
  assert.deepEqual([some.everyone, some.actorIds, some.page, some.x, some.y], [false, ["pcA"], page.uuid, 0, 0]);
  const gmOnly = seedFrom({ id: "n3", text: "Stash", x: 600, y: 400, flags: { "pin-cushion": { showOnlyToGM: "true" } } });
  assert.deepEqual([gmOnly.everyone, gmOnly.actorIds], [false, []]);
  assert.equal(seedFrom({ id: "n4", text: "Here", x: 1, y: 1, flags: { "cpr-sam-agent": { temp: true } } }), null, "temp pins are cleared");
  assert.equal(seedFrom({ id: "n5", text: "Party", x: 1, y: 1, flags: { "cpr-sam-agent": { cabbParty: true } } }), null, "the party pin becomes the crew");
});

test("Map seed: a territory's size is converted to the picture's px", () => {
  const row = seedFrom(territory({ "cpr-sam-agent": { map: { alpha: 0.5 } } }));
  assert.deepEqual([row.size, row.alpha, row.type], [100 * TERRITORY_SCALE * 2, 0.5, "territories"]);
});

test("Map seed: the config names the picture, its scale per picture px and the traced files beside it", () => {
  const lists = { categories: [{ id: "bar", label: "Bars" }], groups: [{ id: "fun", label: "Fun", categories: ["bar"] }] };
  const cfg = configFromScene(navScene(), PICTURE, lists);
  assert.ok(Math.abs(cfg.milesPerPx - 0.0005) < 1e-12, "0.1 mi per 100 scene px; a scene px is 2 picture px");
  assert.deepEqual({ ...cfg, milesPerPx: 0 }, {
    picture: { src: "assets/Map/map.jpg", width: 11760, height: 15680 }, milesPerPx: 0,
    areas: "assets/Map/map.districts.json", roads: "assets/Map/map.graph.json", overlay: "assets/Map/map.roads.dzi",
    categories: lists.categories, groups: lists.groups
  });
  assert.equal(configFromScene({ ...navScene(), background: {} }, PICTURE, lists), null, "no picture");
  assert.equal(configFromScene(navScene(), null, lists), null, "picture size unknown");
});

test("Map import: the report counts what's copied and what each player will see", () => {
  const page = { uuid: "JournalEntry.e1.JournalEntryPage.p1", testUserPermission: user => user.id === "alice" };
  const scene = navScene([
    { id: "n1", text: "Afterlife", x: 1500, y: 1300 },
    { id: "n2", text: "Safehouse", x: 600, y: 400, page },
    { id: "n3", text: "Stash", x: 600, y: 400, flags: { "pin-cushion": { showOnlyToGM: "true" } } },
    { id: "n4", text: "Here", x: 700, y: 700, flags: { "cpr-sam-agent": { temp: true } } },
    { id: "n5", text: "Party", x: 700, y: 700, flags: { "cpr-sam-agent": { cabbParty: true } } },
    { id: "n6", text: "Way out", x: 100, y: 100 }
  ]);
  const carol = addUser({ id: "carol" });
  const players = [{ user: alice, actorIds: ["pcA"] }, { user: bob, actorIds: ["pcB"] }, { user: carol, actorIds: [] }];
  const seed = seedFromNav(scene, PICTURE, { players, cabb: { links: {}, zones: { n1: "combat" } }, lists: { categories: [], groups: [] } });
  assert.deepEqual(Object.keys(seed.rows), ["n1", "n2", "n3", "n6"]);
  assert.equal(seed.rows.n1.zone, "combat");
  assert.deepEqual(seed.config.seeded.pins, 4);
  assert.equal(seed.config.seeded.from, "nav");
  assert.deepEqual({ ...seed.report, players: null }, { pins: 4, gmOnly: 1, some: 1, temp: 1, party: 1, outside: ["Way out"], players: null });
  assert.deepEqual(seed.report.players.map(p => [p.name, p.sees, p.noCharacter]), [["alice", 3, false], ["bob", 2, false], ["carol", 2, true]]);
});

test("Map import: only a GM's request seeds the Map, on the host, from the Map's own scene; rows are replaced by id", async () => {
  game.settings.settings ??= new Map(); // (no CPR Pin Filter)
  game.scenes.set("nav", navScene([{ id: "n1", text: "Afterlife", x: 1500, y: 1300 }]));
  store.apps.mapPins = { n1: { id: "n1", name: "Old" }, kept: { id: "kept", name: "Made on the Map" } };
  from(alice, "map-import", { sceneId: "nav" });
  await settle();
  assert.equal(store.apps.mapPins.n1.name, "Old", "players can't");
  from(gm, "map-import", { sceneId: "other" });
  await settle();
  assert.equal(store.apps.mapPins.n1.name, "Old", "only the scene the Map shows");

  from(gm, "map-import", { sceneId: "nav" });
  await settle();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(store.apps.mapPins.n1.name, "Afterlife");
  assert.equal(store.apps.mapPins.kept.name, "Made on the Map", "pins not in the import stay");
  // No pyramid in Node: the picture's px are the scene's rectangle's.
  assert.deepEqual([store.apps.mapPins.n1.x, store.apps.mapPins.n1.y], [1000, 1000]);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "mapConfig").seeded.pins, 1);
  assert.equal(lastApps(alice).mapPins.n1.name, "Afterlife", "an everyone pin reaches players");
});

/* The Map drawing its own data */

test("Map: it has a map once seeded with a picture; the picture is its own frame, from 0, 0", () => {
  const cfg = { picture: { src: "assets/Map/map.jpg", width: 11760, height: 15680 }, seeded: { from: "nav" } };
  assert.equal(mapReady(cfg), true);
  assert.equal(mapReady({ ...cfg, seeded: undefined }), false, "not imported yet");
  assert.equal(mapReady({ ...cfg, picture: { src: "x.jpg", width: 0, height: 0 } }), false, "no picture size");
  assert.equal(mapReady({}), false);
  assert.deepEqual(ownPicture(cfg), { src: "assets/Map/map.jpg", x: 0, y: 0, w: 11760, h: 15680 });
  assert.equal(ownPicture({}), null);
});

const row = (extra = {}) => ({
  id: "r1", name: "Afterlife", x: 2000, y: 2000, type: "bar", typeLabel: "Bar", district: "Watson", place: null, color: "#b4006a",
  icon: "icons/bar.svg", text: "AFTER", label: false, everyone: true, actorIds: [], page: null, size: null, alpha: null, ...extra
});

test("Map: a row is drawn as a pin; only the GM sees which are GM-only, and how many scenes are linked to it", () => {
  const pin = pinFromRow(row());
  assert.deepEqual([pin.type, pin.big, pin.territory, pin.size, pin.alpha, pin.text], ["bar", false, false, null, null, "AFT"]);
  assert.deepEqual([pin.gmOnly, pin.temp, pin.linked, pin.scene, pin.scenes], [false, false, false, false, 0]);
  const hidden = row({ everyone: false, actorIds: [] });
  assert.equal(pinFromRow(hidden, { gm: true }).gmOnly, true, "neither everyone's nor any character's");
  assert.equal(pinFromRow(hidden).gmOnly, false, "(players never get those)");
  assert.equal(pinFromRow(row({ everyone: false, actorIds: ["pcA"] }), { gm: true }).gmOnly, false);
  const linked = row({ scenes: [{ sceneId: "barScene00000001", label: "" }, { sceneId: "barScene00000002", label: "Still" }] });
  assert.deepEqual([pinFromRow(linked, { gm: true }).scene, pinFromRow(linked, { gm: true }).scenes], [true, 2], "NavMap marks it");
  assert.deepEqual([pinFromRow(linked).scene, pinFromRow(linked).scenes], [false, 0], "the GM's");
  const extra = pinFromRow(row({ temp: true, page: "JournalEntry.e1" }));
  assert.deepEqual([extra.temp, extra.linked], [true, true]);
  assert.equal(pinFromRow(row({ type: "" })).type, "__none", "no type: uncategorised");
  assert.equal(pinFromRow(row({ type: "district" })).big, true);
});

test("Map: a territory row keeps its size and opacity, in range", () => {
  const turf = pinFromRow(row({ type: "territories", size: 800, alpha: 0.4 }));
  assert.deepEqual([turf.territory, turf.size, turf.alpha], [true, 800, 0.4]);
  const wild = pinFromRow(row({ type: "territories", size: 99999, alpha: null }));
  assert.deepEqual([wild.size, wild.alpha], [4000, 1]);
  assert.equal(pinFromRow(row({ size: 800, alpha: 0.4 })).size, null, "only territories");
});

test("Map: the pins this user has, districts last, then by name", () => {
  const rows = {
    a: row({ id: "a", name: "Watson", type: "district" }),
    b: row({ id: "b", name: "Lizzie's" }),
    c: row({ id: "c", name: "Afterlife" }),
    d: row({ id: "d", name: "Kabuki", type: "district" })
  };
  assert.deepEqual(ownPins(rows, alice).map(p => p.id), ["c", "b", "d", "a"]);
  assert.deepEqual(ownPins({}, alice), []);
});

test("Map: a route on its own roads is in picture px, its miles from the Map's scale", () => {
  // Roads traced at half the picture's size: A(0, 0) ── B(500, 0) ── C(1000, 0), streets.
  const net = roadNetwork({ width: 1000, height: 1000, nodes: [0, 0, 500, 0, 1000, 0], edges: [[0, 1, 500, 0, [0, 0, 500, 0]], [1, 2, 500, 0, [500, 0, 1000, 0]]] });
  const cfg = { picture: { src: "map.jpg", width: 2000, height: 2000 }, milesPerPx: 0.001 };
  const found = ownRoute(cfg, net, { x: 0, y: 0 }, { x: 2000, y: 0 });
  assert.equal(found.miles, 2, "2000 picture px at 0.001 mi each");
  assert.deepEqual(found.points.slice(-2), [2000, 0], "ends at the picture's point");
  assert.ok(found.points.includes(1000), "through B, at 1000 picture px");
  assert.ok(found.minutes.drive > 0 && found.minutes.walk > found.minutes.drive);
  assert.equal(ownRoute({}, net, { x: 0, y: 0 }, { x: 2000, y: 0 }), null, "no picture");
  assert.equal(ownRoute(cfg, null, { x: 0, y: 0 }, { x: 2000, y: 0 }), null, "no roads");
});

/* The GM's Map writes its own pins */

test("Map pins: a GM's change keeps only the keys the Map edits, each checked; a bad value drops its key", () => {
  const uuid = "JournalEntry.abcdefghij123456.JournalEntryPage.ABCDEFGHIJ654321";
  assert.deepEqual(cleanPinChange({
    name: "  Afterlife ", x: 10.6, y: -3.2, type: "bar", typeLabel: "Bar", district: "Watson", place: null,
    color: "#B4006A", icon: "icons/bar.svg", text: "AFT", label: true, everyone: false, temp: true,
    actorIds: ["pcA", "pcB", "pcA"], page: uuid, size: 99999, alpha: 0.333
  }), {
    name: "Afterlife", x: 11, y: -3, type: "bar", typeLabel: "Bar", district: "Watson", place: null,
    color: "#B4006A", icon: "icons/bar.svg", text: "AFT", label: true, everyone: false, temp: true,
    actorIds: ["pcA", "pcB"], page: uuid, size: 4000, alpha: 0.33
  });
  assert.deepEqual(cleanPinChange({ id: "x", sceneId: "barScene00000001", scenes: "s", zone: "warzone", ts: 1, bogus: 1 }), {}, "never the host's; the old sceneId, scenes or a zone that isn't one are dropped");
  assert.deepEqual(cleanPinChange({ scenes: [{ sceneId: "barScene00000001", label: "" }], zone: "hot" }),
    { scenes: [{ sceneId: "barScene00000001", label: "" }], zone: "hot" }, "Cabb's zone and the linked scenes are the pin's (phase 5, T274)");
  assert.deepEqual(cleanPinChange({ type: "" }), { type: "__none" }, "no type: uncategorised");
  assert.deepEqual(cleanPinChange({ type: "__none" }), { type: "__none" });
  assert.deepEqual(cleanPinChange({ page: "JournalEntry.abcdefghij123456" }), { page: "JournalEntry.abcdefghij123456" }, "a whole entry");
  assert.deepEqual(cleanPinChange({ page: null, color: null, icon: null, district: null, size: null, alpha: null }),
    { page: null, color: null, icon: null, district: null, size: null, alpha: null }, "cleared");
  assert.deepEqual(cleanPinChange({
    name: "  ", x: Infinity, y: "12", type: "t".repeat(41), typeLabel: 5, district: "d".repeat(81), place: 3,
    color: "red", icon: "i".repeat(301), text: "AFTER", label: "yes", everyone: 1, temp: null,
    actorIds: ["pcA", 7], page: "Actor.abcdefghij123456"
  }), {}, "each bad value dropped");
  assert.deepEqual(cleanPinChange({ name: "n".repeat(121) }), {});
  assert.deepEqual(cleanPinChange({ actorIds: Array.from({ length: 101 }, (_, i) => `a${i}`) }), {}, "at most 100 characters");
  assert.deepEqual(cleanPinChange(null), {});
});

test("Map pins: the GM sets, adds and deletes rows through the host; players can't", async () => {
  store.apps.mapPins = { r1: { ...row(), ts: 1 }, t1: { ...row({ id: "t1", name: "Marker 1", temp: true }), ts: 1 } };
  from(alice, "map-pin", { op: "set", id: "r1", change: { name: "Hacked" } });
  from(alice, "map-pin", { op: "delete", id: "r1" });
  await settle();
  assert.equal(store.apps.mapPins.r1.name, "Afterlife", "players' requests are ignored");
  assert.ok(store.apps.mapPins.r1);

  from(gm, "map-pin", { op: "set", id: "r1", change: { name: "Afterlife Bar", x: 5.4, sceneId: "s9", bogus: true } });
  from(gm, "map-pin", { op: "set", id: "nope", change: { name: "Ghost" } });
  await settle();
  const r1 = store.apps.mapPins.r1;
  assert.deepEqual([r1.name, r1.x, r1.y, r1.district], ["Afterlife Bar", 5, 2000, "Watson"], "merged");
  assert.equal("sceneId" in r1 || "bogus" in r1, false, "unknown and Cabb's keys dropped");
  assert.ok(r1.ts > 1, "stamped");
  assert.equal(store.apps.mapPins.nope, undefined, "set needs the row");

  from(gm, "map-pin", { op: "set", id: "t1", change: { temp: false } });
  await settle();
  assert.equal("temp" in store.apps.mapPins.t1, false, "Keep pin: no longer temporary");

  const id = "abcdefghij123456";
  from(gm, "map-pin", { op: "add", pin: { id, name: "New pin", x: 1, y: 2, color: "#b4006a", ts: 5, zone: "warzone" } });
  from(gm, "map-pin", { op: "add", pin: { id: "short", name: "Bad id", x: 1, y: 2 } });
  from(alice, "map-pin", { op: "add", pin: { id: "ABCDEFGHIJ123456", name: "Player's" } });
  await settle();
  const added = store.apps.mapPins[id];
  assert.deepEqual({ ...added, ts: 0 }, {
    everyone: false, actorIds: [], type: "misc", typeLabel: "Miscellaneous", label: false, page: null, size: null, alpha: null,
    scenes: [], zone: null, district: null, place: null, text: "", name: "New pin", x: 1, y: 2, color: "#b4006a", id, ts: 0
  }, "defaults, then the GM's values");
  assert.ok(added.ts > 5, "the host's time");
  assert.equal(store.apps.mapPins.short, undefined, "a bad id is ignored");
  assert.equal(store.apps.mapPins.ABCDEFGHIJ123456, undefined, "players can't add");
  from(gm, "map-pin", { op: "add", pin: { id, name: "Again" } });
  await settle();
  assert.equal(store.apps.mapPins[id].name, "New pin", "a taken id is ignored");
  assert.equal(lastApps(alice).mapPins[id], undefined, "a new pin is the GM's only");

  from(gm, "map-pin", { op: "set", id, change: { everyone: false, actorIds: ["pcA"] } });
  await settle();
  assert.ok(lastApps(alice).mapPins[id], "some characters: alice's player gets it");
  assert.equal(lastApps(bob).mapPins[id], undefined, "bob doesn't");

  from(gm, "map-pin", { op: "delete", id: "r1" });
  await settle();
  assert.equal(store.apps.mapPins.r1, undefined, "deleted");
});

test("Map pins: Clear temporary pins takes only the temporary ones", async () => {
  store.apps.mapPins = { a: row({ id: "a", temp: true }), b: row({ id: "b" }), c: row({ id: "c", temp: true }) };
  from(alice, "map-pin", { op: "clear-temp" });
  await settle();
  assert.equal(Object.keys(store.apps.mapPins).length, 3, "players can't");
  from(gm, "map-pin", { op: "clear-temp" });
  await settle();
  assert.deepEqual(Object.keys(store.apps.mapPins), ["b"]);
});

test("Map: activating a scene linked to a Map pin puts the crew there, even a pin made on the Map", async () => {
  await game.settings.set("cpr-sam-agent", "cabb", { ...cabbConfig(), crew: null });
  store.apps.mapPins = { newPin0000000001: { id: "newPin0000000001", name: "Made on the Map", x: 420, y: 640, scenes: [{ sceneId: "otherScene000001", label: "" }, { sceneId: "barScene00000001", label: "Night" }] } };
  await store._mapSceneActivated({ id: "elsewhere0000001" });
  assert.equal(cabbConfig().crew, null, "a scene no pin links to");
  await store._mapSceneActivated({ id: "barScene00000001" });
  assert.deepEqual({ ...cabbConfig().crew, ts: 0 }, { x: 420, y: 640, noteId: "newPin0000000001", ts: 0 }, "on the Map: no scene");
});

test("Map phase 5: Combat Cabb's zones, scene links and crew spot move onto the Map's pins, once", async () => {
  await game.settings.set("cpr-sam-agent", "mapConfig", { picture: { src: "assets/Map/map.jpg", width: 11760, height: 15680 }, seeded: { from: "nav" } });
  // The crew on the NAV scene, which sits 500, 300 into its canvas at half the picture's size.
  game.scenes.set("nav", navScene());
  await game.settings.set("cpr-sam-agent", "cabb", {
    ...cabbConfig(), zones: { n1: "hot", gone: "combat" }, links: { n2: "barScene00000001" },
    crew: { sceneId: "nav", x: 1500, y: 1300, noteId: "n1", ts: 5 }
  });
  store.apps.mapPins = { n1: { id: "n1", name: "Afterlife" }, n2: { id: "n2", name: "Lizzie's", scenes: [{ sceneId: "stillScene000001", label: "Still" }] } };
  await store._mapMoveCabb();
  assert.equal(store.apps.mapPins.n1.zone, "hot");
  assert.deepEqual(store.apps.mapPins.n2.scenes, [{ sceneId: "stillScene000001", label: "Still" }, { sceneId: "barScene00000001", label: "" }], "the link added to the pin's scenes");
  assert.equal(store.apps.mapPins.gone, undefined, "a zone for a pin the Map doesn't have is dropped");
  const cfg = cabbConfig();
  assert.deepEqual([cfg.zones, cfg.links], [{}, {}]);
  assert.deepEqual(cfg.crew, { x: 2000, y: 2000, noteId: "n1", ts: 5 }, "the crew in the Map's px, no scene");
  // Again: nothing left to move.
  store.apps.mapPins.n1.zone = "combat";
  await store._mapMoveCabb();
  assert.equal(store.apps.mapPins.n1.zone, "combat");
});

test("Map phase 5: the GM sets a pin's Cabb zone and linked scenes through the host; who sees a row", async () => {
  store.apps.mapPins = { a: { id: "a", name: "A", everyone: false, actorIds: ["pcA"] } };
  const scenes = [{ sceneId: "barScene00000001", label: "Night" }];
  from(gm, "map-pin", { op: "set", id: "a", change: { zone: "hot", scenes } });
  await settle();
  assert.deepEqual([store.apps.mapPins.a.zone, store.apps.mapPins.a.scenes], ["hot", scenes]);
  assert.equal(lastApps(alice).mapPins.a.scenes, undefined, "the linked scenes are the GM's");
  from(gm, "map-pin", { op: "set", id: "a", change: { zone: "warzone", scenes: [{ sceneId: "no" }] } });
  await settle();
  assert.deepEqual([store.apps.mapPins.a.zone, store.apps.mapPins.a.scenes], ["hot", scenes], "nonsense: unchanged");
  from(gm, "map-pin", { op: "set", id: "a", change: { zone: null, scenes: null } });
  await settle();
  assert.deepEqual([store.apps.mapPins.a.zone, store.apps.mapPins.a.scenes], [null, []]);
  const row = store.apps.mapPins.a;
  assert.deepEqual([rowSeenBy(row, gm), rowSeenBy(row, alice), rowSeenBy(row, bob), rowShared(row), rowShared({ everyone: false, actorIds: [] })], [true, true, false, true, false]);
});

/* Pin Maps (T274): several scenes per pin */

test("Map scenes: a pin's linked scenes are checked as a whole list; null or [] clears them", () => {
  const a = "barScene00000001";
  const b = "barScene00000002";
  assert.deepEqual(cleanScenes([{ sceneId: a, label: "  Night " }, { sceneId: b }, { sceneId: a, label: "Again" }]),
    [{ sceneId: a, label: "Night" }, { sceneId: b, label: "" }], "trimmed; no label: the scene's name; a scene once (its first)");
  assert.equal(cleanScenes([{ sceneId: "short", label: "" }]), null, "a bad id");
  assert.equal(cleanScenes([{ sceneId: 1234567890123456, label: "" }]), null, "not a string");
  assert.equal(cleanScenes([{ sceneId: a, label: "x".repeat(61) }]), null, "a label over 60");
  assert.equal(cleanScenes([{ sceneId: a, label: 5 }]), null, "a label that isn't text");
  assert.equal(cleanScenes(Array.from({ length: 13 }, (_, i) => ({ sceneId: `scene${String(i).padStart(11, "0")}`, label: "" }))), null, "over 12");
  assert.equal(cleanScenes(Array.from({ length: 12 }, (_, i) => ({ sceneId: `scene${String(i).padStart(11, "0")}`, label: "" }))).length, 12);
  assert.equal(cleanScenes("nope"), null);
  assert.deepEqual(cleanPinChange({ scenes: null }), { scenes: [] }, "null clears");
  assert.deepEqual(cleanPinChange({ scenes: [] }), { scenes: [] });
  assert.deepEqual(cleanPinChange({ scenes: [{ sceneId: a, label: "" }, { sceneId: "bad" }] }), {}, "one bad entry drops the change");
});

test("Map scenes: a row's one sceneId becomes its scenes once, on load", async () => {
  store.apps.mapPins = {
    a: { id: "a", name: "Afterlife", sceneId: "barScene00000001" },
    b: { id: "b", name: "New pin", sceneId: null },
    c: { id: "c", name: "Both", sceneId: "barScene00000001", scenes: [{ sceneId: "barScene00000002", label: "Still" }] },
    d: { id: "d", name: "Plain" }
  };
  await store._mapMoveScenes();
  const rows = store.apps.mapPins;
  assert.deepEqual(rows.a.scenes, [{ sceneId: "barScene00000001", label: "" }]);
  assert.deepEqual(rows.b.scenes, []);
  assert.deepEqual(rows.c.scenes, [{ sceneId: "barScene00000002", label: "Still" }], "a list already there is kept");
  assert.equal(Object.values(rows).some(r => "sceneId" in r), false, "sceneId gone");
  assert.equal("scenes" in rows.d, false, "a row without a link is left alone");
});

/** ChatMessage and game.messages, enough for the GM's card "Where is the crew?". */
function chatStub() {
  const created = [];
  game.messages = new Map();
  globalThis.ChatMessage = {
    async create(data) {
      const message = {
        id: `message${String(created.length).padStart(9, "0")}`, ...structuredClone(data),
        async update(change) {
          for (const [key, value] of Object.entries(change)) foundry.utils.setProperty(this, key, value);
        }
      };
      created.push(message);
      game.messages.set(message.id, message);
      return message;
    },
    getWhisperRecipients: () => [{ id: "gm" }]
  };
  return created;
}

const scenePins = () => ({
  p1: { id: "p1", name: "Lizzie's Bar", district: "Watson", x: 100, y: 200, scenes: [{ sceneId: "barScene00000001", label: "" }] },
  p2: { id: "p2", name: "Afterlife", district: "Watson", x: 300, y: 400, scenes: [{ sceneId: "barScene00000001", label: "Night" }] },
  p3: { id: "p3", name: "Elsewhere", x: 9, y: 9, scenes: [] }
});

test("Map scenes: a scene linked to several pins asks the GMs in chat where the crew is, unless it's at one of them", async () => {
  const created = chatStub();
  await game.settings.set("cpr-sam-agent", "cabb", { ...cabbConfig(), crew: { x: 9, y: 9, noteId: "p3", ts: 1 } });
  store.apps.mapPins = scenePins();
  await store._mapSceneActivated({ id: "noLinks000000001", name: "Nowhere" });
  assert.equal(created.length, 0, "a scene no pin links to: nothing");
  await store._mapSceneActivated({ id: "barScene00000001", name: "Dive Bar" });
  assert.equal(created.length, 1, "a card");
  const card = created[0];
  assert.deepEqual(card.whisper, [{ id: "gm" }], "whispered to the GMs");
  assert.match(card.content, /Dive Bar<\/b> is linked to 2 places\. Where is the crew\?/);
  assert.match(card.content, /data-map-crew-pick="p2">Afterlife · Watson<\/button><button type="button" data-map-crew-pick="p1">Lizzie&#39;s Bar · Watson/, "a button per pin, by name");
  assert.match(card.content, /data-map-crew-pick="">Leave the crew where it is/);
  assert.deepEqual(card.flags["cpr-sam-agent"].mapCrewPick, { sceneId: "barScene00000001", scene: "Dive Bar", pins: ["p2", "p1"], answer: null });
  assert.equal(cabbConfig().crew.noteId, "p3", "the crew stays until the GM picks");

  await game.settings.set("cpr-sam-agent", "cabb", { ...cabbConfig(), crew: { x: 100, y: 200, noteId: "p1", ts: 1 } });
  await store._mapSceneActivated({ id: "barScene00000001", name: "Dive Bar" });
  assert.equal(created.length, 1, "the crew is at one of them: no card");
  assert.equal(cabbConfig().crew.noteId, "p1");
});

test("Map scenes: the GM's pick on the card puts the crew at that pin, once; players can't", async () => {
  const created = chatStub();
  await game.settings.set("cpr-sam-agent", "cabb", { ...cabbConfig(), crew: null });
  store.apps.mapPins = scenePins();
  await store._mapSceneActivated({ id: "barScene00000001", name: "Dive Bar" });
  const card = created[0];
  from(alice, "map-crew-pick", { messageId: card.id, pinId: "p2" });
  from(gm, "map-crew-pick", { messageId: card.id, pinId: "p3" });
  from(gm, "map-crew-pick", { messageId: "nope", pinId: "p2" });
  await settle();
  assert.equal(cabbConfig().crew, null, "a player's, a pin not on the card, or no such card: nothing");
  assert.equal(card.flags["cpr-sam-agent"].mapCrewPick.answer, null);

  from(gm, "map-crew-pick", { messageId: card.id, pinId: "p2" });
  await settle();
  assert.deepEqual({ ...cabbConfig().crew, ts: 0 }, { x: 300, y: 400, noteId: "p2", ts: 0 }, "the crew is at the pin picked");
  assert.equal(card.flags["cpr-sam-agent"].mapCrewPick.answer, "p2");
  assert.doesNotMatch(card.content, /<button/, "answered: no buttons");
  assert.match(card.content, /The crew is at Afterlife · Watson\./, "the choice shown");

  from(gm, "map-crew-pick", { messageId: card.id, pinId: "p1" });
  await settle();
  assert.equal(cabbConfig().crew.noteId, "p2", "answered once");

  // Another card: Leave the crew where it is.
  await game.settings.set("cpr-sam-agent", "cabb", { ...cabbConfig(), crew: null });
  await store._mapSceneActivated({ id: "barScene00000001", name: "Dive Bar" });
  from(gm, "map-crew-pick", { messageId: created[1].id, pinId: "" });
  await settle();
  assert.equal(cabbConfig().crew, null, "the crew stays");
  assert.equal(created[1].flags["cpr-sam-agent"].mapCrewPick.answer, "");
  assert.match(created[1].content, /The crew stays where it is\./);
});

test("Map scenes: a recommended scene's key finds this world's scene: compendium source, then sourceId, or background", () => {
  const key = "Compendium.fragmaps-free.scenes.Scene.AbCdEfGhIj123456";
  const scenes = [
    { id: "s1", name: "Dive Bar (old copy)", compendiumSource: null, sourceId: key, backgroundSrc: "maps/bar.webp" },
    { id: "s2", name: "Dive Bar", compendiumSource: key, sourceId: null, backgroundSrc: "maps/bar.webp" },
    { id: "s3", name: "B Rooftop", compendiumSource: null, sourceId: null, backgroundSrc: "maps/Roof%20Top%20(night).webp" },
    { id: "s4", name: "A Rooftop", compendiumSource: null, sourceId: null, backgroundSrc: "maps/Roof Top (night).webp" }
  ];
  assert.equal(resolveSceneKey(key, scenes), "s2", "v12's compendium source first");
  assert.equal(resolveSceneKey(key, scenes.filter(s => s.id !== "s2")), "s1", "else the older flags.core.sourceId");
  assert.equal(resolveSceneKey("bg:maps/Roof Top (night).webp", scenes), "s4", "background, URL escapes undone on both sides; of several, the first by name");
  assert.equal(resolveSceneKey("bg:maps/Roof%20Top%20(night).webp", scenes.slice(0, 3)), "s3");
  assert.equal(resolveSceneKey("bg:maps/gone.webp", scenes), null, "missing");
  assert.equal(resolveSceneKey("Compendium.other.pack.Scene.ZZZZZZZZZZ123456", scenes), null, "missing");
  assert.equal(resolveSceneKey("S0042", scenes), null, "not a key");
  assert.equal(resolveSceneKey(undefined, scenes), null);
});

test("Map scenes: applying the recommended scenes skips linked pins (unless replacing) and pins not on the Map", async () => {
  const file = { version: 1, pins: {
    p1: { name: "Lizzie's Bar", scenes: [{ key: "bg:a.webp", label: "Main" }, { key: "bg:gone.webp", label: "Alt" }, { key: "bg:a.webp", label: "Twice" }] },
    p2: { name: "Afterlife", scenes: [{ key: "bg:b.webp", label: " Night " }] },
    p3: { name: "Elsewhere", scenes: [{ key: "bg:gone.webp", label: "" }] },
    zz: { name: "Not here", scenes: [{ key: "bg:a.webp", label: "" }] }
  } };
  const ids = { "bg:a.webp": "sceneAAAAAAAAAAA", "bg:b.webp": "sceneBBBBBBBBBBB" };
  const resolve = async key => ids[key] ?? null;
  const rows = scenePins();
  const kept = await planPinMaps(file, rows, { resolve });
  assert.deepEqual(kept.changes, {}, "p1 and p2 are linked already; p3 resolves to nothing");
  assert.deepEqual(kept.report, { pins: 0, links: 0, missing: 1, missingKeys: ["bg:gone.webp"], skipped: 2, notHere: 1 });
  const all = await planPinMaps(file, rows, { replace: true, resolve });
  assert.deepEqual(all.changes, {
    p1: { scenes: [{ sceneId: "sceneAAAAAAAAAAA", label: "Main" }] },
    p2: { scenes: [{ sceneId: "sceneBBBBBBBBBBB", label: "Night" }] }
  }, "unresolved links dropped, a scene once, labels from the file");
  assert.deepEqual(all.report, { pins: 2, links: 2, missing: 2, missingKeys: ["bg:gone.webp"], skipped: 0, notHere: 1 });
});

test("Map phase 5: Combat Cabb's trip by road on the Map, in km", () => {
  // Three nodes along the top of a 1000 px picture, the network at a tenth of its size; 0.001 mi per Map px.
  const net = roadNetwork({ width: 100, height: 100, nodes: [0, 0, 50, 0, 100, 0], edges: [[0, 1, 50, 0, [0, 0, 50, 0]], [1, 2, 50, 0, [50, 0, 100, 0]]] });
  const cfg = { picture: { src: "x", width: 1000, height: 1000 }, milesPerPx: 0.001 };
  const k = mapKmPerPx(cfg);
  assert.ok(Math.abs(k - 0.001609344) < 1e-12);
  const trip = ownCabbRoad(cfg, net, { x: 0, y: 0 }, { x: 1000 * k, y: 0 });
  assert.equal(trip.miles, 1, "1000 Map px at 0.001 mi");
  assert.ok(Math.abs(trip.points.at(-2) - 1000 * k) < 1e-9, "the line in km");
  assert.equal(ownCabbRoad({ ...cfg, milesPerPx: 0 }, net, { x: 0, y: 0 }, { x: 1, y: 0 }), null, "no scale: no road");
});

/* The default Night City: shipped pins, loaded where a world has no Map, and journals matched by name */

const page = (uuid, name, entry) => ({ uuid, name, kind: "page", entry });

test("Map journals: a pin finds the page with its name, numbering, accents and \"(E)\" aside", () => {
  const docs = [
    { uuid: "JournalEntry.e1", name: "The Outskirts", kind: "entry" },
    page("p1", "SovOil CHOOH2 Station", "The Outskirts"),
    page("p2", "Aldecaldo Camp", "Santo Domingo"),
    page("p3", "Chopper's", "Watson"),
    page("p4", "Café Noir", "Watson"),
    page("p5", "Prosperity Garden Tenements", "Little China")
  ];
  const pins = [
    { id: "a", name: "#16 SovOil CHOOH2 Station", type: "shop" },
    { id: "b", name: "Aldecaldo Camp (E)", type: "nomad" },
    { id: "c", name: "#5 Chopper’s", type: "bar" },
    { id: "d", name: "Cafe Noir", type: "bar" },
    { id: "e", name: "K. Prosperity Garden Tenements", type: "housing" },
    { id: "f", name: "Nowhere Special", type: "misc" }
  ];
  assert.deepEqual(matchJournals(pins, docs), { a: "p1", b: "p2", c: "p3", d: "p4", e: "p5" });
});

test("Map journals: a district gets its entry's District Overview; of several pages, the pin's district or a territory's", () => {
  const docs = [
    { uuid: "E.lc", name: "Little China", kind: "entry" },
    page("lc-o", "District Overview", "Little China"),
    { uuid: "E.wat", name: "Watson", kind: "entry" },
    page("vb-wat", "Voodoo Boys", "Watson"),
    page("vb-tm", "Voodoo Boys", "Territory Markers"),
    page("vb-pac", "Voodoo Boys", "Pacifica"),
    page("dw1", "DeadWoods", "Territory Markers"),
    page("dw2", "DeadWoods", "Territory Markers"),
    page("dw3", "DeadWoods", "The Glen"),
    page("gl1", "Glenlife Perfected", "The Glen"),
    page("gl2", "Glenlife Perfected", "Heywood")
  ];
  const pins = [
    { id: "d1", name: "Little China", type: "district" },
    { id: "d2", name: "Watson", type: "district" },
    { id: "v1", name: "Voodoo Boys", type: "gang", district: "Pacifica" },
    { id: "v2", name: "Voodoo Boys", type: "territories", district: "Watson" },
    { id: "v3", name: "Voodoo Boys", type: "territories", district: "Heywood" },
    { id: "w1", name: "DeadWoods", type: "territories", district: "Rancho Coronado" },
    { id: "g1", name: "Glenlife Perfected", type: "housing", district: null }
  ];
  assert.deepEqual(matchJournals(pins, docs), {
    d1: "lc-o", // its District Overview
    d2: "E.wat", // no overview: the entry
    v1: "vb-pac", // in its district's entry
    v2: "vb-wat", // its district first, even for a territory
    v3: "vb-tm", // a territory elsewhere: the Territory Markers page
    w1: "dw1" // the same page name twice in one entry: the first
    // g1: two entries, no district: none
  });
  assert.equal(journalName("#2 The Biotechnica Reference Forest RF-14"), "biotechnica reference forest rf 14");
});

test("Map journals: a near name counts only when it's clearly the same place", () => {
  const docs = [page("p1", "Gibson Battlegear Outlet", "Watson"), page("p2", "Night City University", "University District")];
  assert.deepEqual(matchJournals([{ id: "a", name: "Gibson Battlegear Outlet Store", type: "shop" }], docs), { a: "p1" });
  assert.deepEqual(matchJournals([{ id: "b", name: "A. Administration Building", type: "education" }], docs), {});
});

test("Map defaults: a world with no Map gets the content folder's pins (\"./\" paths made the folder's), hidden but the districts, and a GM is to be asked about journals", async () => {
  game.settings.settings ??= new Map();
  await game.settings.set("cpr-sam-agent", "mapConfig", {});
  await game.settings.set("cpr-sam-agent", "contentFolder", "content");
  await game.settings.set("cpr-sam-agent", "contentFiles", ["map/config.json", "map/pins.json"]);
  store.apps.mapPins = {};
  files.set("content/map/config.json", JSON.stringify({ picture: { src: "./map.dzi", width: 11760, height: 15680 }, areas: "./map.districts.json", milesPerPx: 0.001, categories: [], groups: [] }));
  files.set("content/map/pins.json", JSON.stringify({ p1: { id: "p1", name: "Watson", type: "district", icon: "./icons/district.svg", everyone: true, actorIds: [] }, p2: { id: "p2", name: "Afterlife", type: "bar", icon: "icons/svg/door.svg", everyone: false, actorIds: [] } }));
  await store._mapLoadDefaults();
  assert.deepEqual(Object.keys(store.apps.mapPins), ["p1", "p2"]);
  assert.equal(store.apps.mapPins.p1.icon, "content/map/icons/district.svg");
  assert.equal(store.apps.mapPins.p2.icon, "icons/svg/door.svg", "Foundry's own paths stay");
  const cfg = game.settings.get("cpr-sam-agent", "mapConfig");
  assert.equal(cfg.picture.src, "content/map/map.dzi");
  assert.equal(cfg.areas, "content/map/map.districts.json");
  assert.deepEqual({ ...cfg.seeded, at: 0 }, { from: "default", at: 0, pins: 2, defaults: true, journals: "ask" }, "no NAV scene here");

  // Never over a Map the world already has.
  store.apps.mapPins = { mine: { id: "mine", name: "Mine" } };
  await game.settings.set("cpr-sam-agent", "mapConfig", {});
  await store._mapLoadDefaults();
  assert.deepEqual(Object.keys(store.apps.mapPins), ["mine"]);
  assert.deepEqual(game.settings.get("cpr-sam-agent", "mapConfig"), {});
});

test("Map defaults: without the drop-in nothing is written; once the GM's scan finds it, the empty Map loads it", async () => {
  await game.settings.set("cpr-sam-agent", "mapConfig", {});
  await game.settings.set("cpr-sam-agent", "contentFolder", "content");
  store.apps.mapPins = {};
  files.set("content/map/config.json", JSON.stringify({ picture: { src: "./map.webp", width: 10, height: 20 } }));
  files.set("content/map/pins.json", JSON.stringify({ p1: { id: "p1", name: "Watson", type: "district", everyone: true, actorIds: [] } }));
  await game.settings.set("cpr-sam-agent", "contentFiles", ["map/config.json"]);
  await store._mapLoadDefaults();
  assert.deepEqual(store.apps.mapPins, {}, "only one of the two files listed");
  assert.deepEqual(game.settings.get("cpr-sam-agent", "mapConfig"), {}, "no seeded: a drop-in added later still loads");

  await game.settings.set("cpr-sam-agent", "contentFiles", ["map/config.json", "map/pins.json"]);
  store.loaded = false;
  await store._mapContentChanged();
  assert.deepEqual(store.apps.mapPins, {}, "not before the host has its data");
  store.loaded = true;
  sent.length = 0;
  await store._mapContentChanged();
  assert.deepEqual(Object.keys(store.apps.mapPins), ["p1"]);
  assert.equal(game.settings.get("cpr-sam-agent", "mapConfig").picture.src, "content/map/map.webp");
  assert.ok(lastApps(alice)?.mapPins?.p1, "players get the shared pins");

  // A Map with its own pins: left alone.
  store.apps.mapPins = { mine: { id: "mine", name: "Mine" } };
  await game.settings.set("cpr-sam-agent", "mapConfig", {});
  await store._mapContentChanged();
  assert.deepEqual(Object.keys(store.apps.mapPins), ["mine"]);
});

test("Map journals: pins to populate are grouped by district, by name; temporary and linked pins are left out", () => {
  const pins = [
    { id: "1", name: "Zed", district: "Watson" },
    { id: "2", name: "Abe", district: "Watson" },
    { id: "3", name: "Mid", district: "Arroyo" },
    { id: "4", name: "Lone", district: null },
    { id: "5", name: "Temp", district: "Watson", temp: true },
    { id: "6", name: "Done", district: "Watson", page: "JournalEntry.A.JournalEntryPage.B" }
  ];
  assert.deepEqual(pinsByDistrict(pins).map(g => [g.district, g.pins.map(p => p.name)]),
    [["Arroyo", ["Mid"]], [NO_DISTRICT, ["Lone"]], ["Watson", ["Abe", "Zed"]]]);
  assert.deepEqual(pinsByDistrict([]), []);
});

test("Map journals: the GM links many pins at once; bad journal ids are dropped, players can't", async () => {
  store.apps.mapPins = { a: { id: "a", name: "A", page: null }, b: { id: "b", name: "B", page: null } };
  const uuid = "JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.BBBBBBBBBBBBBBBB";
  from(alice, "map-pin", { op: "set-many", changes: { a: { page: uuid } } });
  await settle();
  assert.equal(store.apps.mapPins.a.page, null, "players can't");
  from(gm, "map-pin", { op: "set-many", changes: { a: { page: uuid }, b: { page: "Actor.nope" }, gone: { page: uuid } } });
  await settle();
  assert.equal(store.apps.mapPins.a.page, uuid);
  assert.equal(store.apps.mapPins.b.page, null, "not a journal: dropped");
  assert.equal(store.apps.mapPins.gone, undefined, "no such pin: not made");
});

test("Map defaults: the content folder's drop-in (when it's beside the module) points only at its own files; players see only the districts", { skip: !existsSync(new URL("../../../cpr-sam-agent-content/map/pins.json", import.meta.url)) }, () => {
  const dropIn = new URL("../../../cpr-sam-agent-content/map/", import.meta.url);
  const folder = "cpr-sam-agent-content";
  const pins = Object.values(resolveMapPaths(JSON.parse(readFileSync(new URL("pins.json", dropIn), "utf8")), folder));
  const cfg = resolveMapPaths(JSON.parse(readFileSync(new URL("config.json", dropIn), "utf8")), folder);
  const inDropIn = path => path.startsWith(`${folder}/map/`) && existsSync(new URL(path.slice(folder.length + 5), dropIn));
  assert.equal(pins.length, 792);
  assert.deepEqual(pins.filter(p => p.everyone).map(p => p.type).filter(t => t !== "district"), [], "only district names for everyone");
  assert.ok(pins.every(p => !p.page && !p.actorIds.length && !p.sceneId && !p.zone), "no journals, characters, scenes or zones");
  const icons = [...new Set(pins.map(p => p.icon).filter(i => i && !i.startsWith("icons/")))];
  assert.deepEqual(icons.filter(i => !inDropIn(i)), [], "every icon is the drop-in's");
  for (const key of ["areas", "roads", "overlay"]) assert.ok(inDropIn(cfg[key]), key);
  assert.ok(inDropIn(cfg.picture.src), "the picture's pyramid");
});

test("Map: the category icons are the module's", () => {
  const root = new URL("../", import.meta.url);
  const inModule = path => existsSync(new URL(path.replace(/^modules\/cpr-sam-agent\//, ""), root));
  assert.ok(isCategoryIcon(categoryIcon("bar")) && inModule(categoryIcon("bar")), "category icons are the module's");
  assert.ok(isCategoryIcon("r20import/icons/bar.svg"), "an imported NAV pin's icon still counts as a category icon");
});

test("Map clusters: pins grouped by district, at the district's name (or their middle)", () => {
  const pins = [
    { id: "w", name: "Watson", x: 100, y: 100, big: true, district: null },
    { id: "a", name: "A", x: 0, y: 0, district: "Watson" },
    { id: "b", name: "B", x: 200, y: 40, district: "Watson" },
    { id: "c", name: "C", x: 1000, y: 1000, district: "Outskirts" },
    { id: "d", name: "D", x: 1200, y: 1400, district: "Outskirts" },
    { id: "e", name: "E", x: 5, y: 5, district: null }
  ];
  const groups = pinGroups(pins);
  assert.deepEqual(groups.map(g => [g.key, g.pins.map(p => p.id), g.label?.id ?? null]), [["Watson", ["a", "b"], "w"], ["Outskirts", ["c", "d"], null], [null, ["e"], null]]);
  assert.deepEqual(groups[0].box, { x0: 0, y0: 0, x1: 200, y1: 40 });
  assert.deepEqual(groups[0].at, { x: 100, y: 100 }, "the district's name");
  assert.deepEqual(groups[1].at, { x: 1100, y: 1200 }, "no name: the pins' middle");
});

test("Map clusters: a group opens zoomed in on it (or past NAMES_AT) while in view; small groups never shut", () => {
  const spot = i => ({ id: `p${i}`, x: 1000 + i * 100, y: 1000, district: "Watson" });
  const [big] = pinGroups(Array.from({ length: CLUSTER_MIN }, (_, i) => spot(i)));
  const [small] = pinGroups([spot(0)]);
  const [w, h, namesAt] = [400, 800, 0.45];
  const at = expandedAt(big, w, h);
  assert.equal(at, 0.5 * 400 / 200);
  assert.ok(at > namesAt);
  assert.equal(isExpanded(small, { cx: 0, cy: 0, scale: 0.01 }, w, h, namesAt), true, "a small group");
  assert.equal(isExpanded(big, { cx: 0, cy: 0, scale: 0.01 }, w, h, namesAt), false, "zoomed out");
  assert.equal(isExpanded(big, { cx: 1100, cy: 1000, scale: namesAt }, w, h, namesAt), true, "every name shows");
  assert.equal(isExpanded(big, { cx: 1100, cy: 50000, scale: namesAt }, w, h, namesAt), false, "every name shows, but off screen");
  const wide = pinGroups(Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, x: i * 1000, y: 0, district: "Wide" })))[0];
  const near = expandedAt(wide, w, h);
  assert.ok(near < namesAt);
  assert.equal(isExpanded(wide, { cx: 2000, cy: 0, scale: near }, w, h, namesAt), true, "zoomed in on it");
  assert.equal(isExpanded(wide, { cx: 2000, cy: 50000, scale: near }, w, h, namesAt), false, "the same zoom, off screen");
  assert.equal(isExpanded(wide, { cx: 2000, cy: 0, scale: near * 0.9 }, w, h, namesAt), false, "not quite close enough");
  assert.equal(isExpanded(wide, { cx: 2000, cy: 0, scale: near * 0.9 }, w, h, namesAt, true), true, "open, it stays open a little further out");
  assert.equal(isExpanded(wide, { cx: 2000, cy: 0, scale: near * 0.7 }, w, h, namesAt, true), false, "and shuts past that");
});

test("Map clusters: the Show pins slider (expand): Later needs more zoom than Sooner, NAMES_AT moves with it", () => {
  const [w, h, namesAt] = [400, 800, 0.45];
  const wide = pinGroups(Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, x: i * 1000, y: 0, district: "Wide" })))[0];
  const view = scale => ({ cx: 2000, cy: 0, scale });
  assert.equal(SHOW_PINS[SHOW_PINS_DEFAULT], EXPAND, "the default stop is today's");
  assert.equal(expandedAt(wide, w, h, EXPAND), expandedAt(wide, w, h), "default unchanged");
  assert.ok(expandedAt(wide, w, h, 1.4) > expandedAt(wide, w, h, 0.2));
  const at = expandedAt(wide, w, h);
  assert.equal(isExpanded(wide, view(at), w, h, namesAt, false, 0.2), true, "Sooner: open already");
  assert.equal(isExpanded(wide, view(at), w, h, namesAt, false, 1.4), false, "Later: not yet");
  assert.equal(isExpanded(wide, view(at * 3), w, h, namesAt, false, 1.4), true, "Later: zoomed in further");
  // A group too tight to open before NAMES_AT: the cap scales with the slider.
  const [tight] = pinGroups(Array.from({ length: CLUSTER_MIN }, (_, i) => ({ id: `t${i}`, x: 1000 + i * 100, y: 1000, district: "W" })));
  const near = { cx: 1100, cy: 1000 };
  assert.equal(isExpanded(tight, { ...near, scale: namesAt }, w, h, namesAt), true, "default: open from NAMES_AT");
  assert.equal(isExpanded(tight, { ...near, scale: namesAt }, w, h, namesAt, false, 1), false, "Later: past NAMES_AT");
  assert.equal(isExpanded(tight, { ...near, scale: namesAt * 2 }, w, h, namesAt, false, 1), true, "Later: from NAMES_AT × 2");
  assert.equal(isExpanded(tight, { ...near, scale: namesAt * 0.4 }, w, h, namesAt, false, 0.2), true, "Sooner: well before NAMES_AT");
});

test("Map filter state: the Show pins stop saved, clamped to the slider, else the default", () => {
  assert.equal(filterState().showPins, SHOW_PINS_DEFAULT);
  assert.equal(filterState({ showPins: 0 }).showPins, 0, "All pins");
  assert.equal(filterState({ showPins: 5 }).showPins, 5);
  assert.equal(filterState({ showPins: 9 }).showPins, SHOW_PINS.length - 1);
  assert.equal(filterState({ showPins: -2 }).showPins, 0);
  assert.equal(filterState({ showPins: 2.6 }).showPins, 3);
  assert.equal(filterState({ showPins: "4" }).showPins, SHOW_PINS_DEFAULT);
  assert.equal(filterState({ showPins: null }).showPins, SHOW_PINS_DEFAULT);
  assert.equal(filterState({ showPins: 1 }).settings, false, "the popup starts shut");
});

import { files, folders, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { artPath, contentArt, contentScanned, parseAchievements, relativeFiles, resolveMapPaths, scanContent, setContentAchievements } from "../scripts/model/content.js";
import { achievementList, achievements, NEUTRAL_BADGE } from "../apps/achieve/model.js";

/*
 * The GM's content folder (scripts/model/content.js): art and Achieve!'s list the module doesn't ship.
 */

const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);

beforeEach(() => {
  reset();
  setContentAchievements([]);
});

test("contentArt: a file the folder has; null when it's missing or there's no folder; slashes trimmed", async () => {
  assert.equal(artPath("content", ["apps/cbk.webp"], "apps/cbk.webp"), "content/apps/cbk.webp");
  assert.equal(artPath("content", ["apps/cbk.webp"], "apps/4tify.webp"), null);
  assert.equal(artPath("", ["apps/cbk.webp"], "apps/cbk.webp"), null);
  assert.equal(artPath("  /content/art//  ", ["apps/cbk.webp"], "apps/cbk.webp"), "content/art/apps/cbk.webp");
  assert.equal(artPath("content", undefined, "apps/cbk.webp"), null);

  assert.equal(contentArt("apps/cbk.webp"), null, "settings never saved");
  await set("contentFolder", "cpr-sam-agent-content/");
  await set("contentFiles", ["apps/cbk.webp"]);
  assert.equal(contentArt("apps/cbk.webp"), "cpr-sam-agent-content/apps/cbk.webp");
  assert.equal(contentArt("cbk/logo.webp"), null);
});

test("the GM's scan: the folder's files and its apps, cbk and achievements folders, relative; a missing folder is empty", async () => {
  assert.deepEqual(await scanContent("nowhere"), []);
  assert.deepEqual(await scanContent(""), []);
  for (const dir of ["content", "content/apps", "content/achievements", "content/other"]) folders.add(dir);
  for (const path of ["content/achievements.json", "content/apps/cbk.webp", "content/achievements/payday.webp", "content/other/x.webp"]) files.set(path, "");
  assert.deepEqual(await scanContent("content/"), ["achievements.json", "achievements/payday.webp", "apps/cbk.webp"], "not other folders");
  assert.deepEqual(relativeFiles("my content", ["my%20content/apps/a.webp", "elsewhere/b.webp"]), ["apps/a.webp"], "decoded, only the folder's");
});

test("achievements.json: valid entries kept, anything else none", () => {
  const text = JSON.stringify([{ id: "payday", name: "Payday", text: "Get paid." }, { id: "x" }, null, { id: " vip ", name: "VIP" }]);
  assert.deepEqual(parseAchievements(text), [{ id: "payday", name: "Payday", text: "Get paid." }, { id: "vip", name: "VIP", text: "" }]);
  assert.deepEqual(parseAchievements("{ not json"), []);
  assert.deepEqual(parseAchievements(JSON.stringify({ id: "payday" })), [], "not a list");
  assert.deepEqual(parseAchievements(undefined), [], "missing");
});

test("Achieve!: no content folder, only the GM's own, on the plain badge; with one, its list and badges", async () => {
  await set("achieve", { custom: [{ id: "custom-x", name: "Mine" }] });
  assert.deepEqual(achievements(), []);
  assert.deepEqual(achievementList().map(a => [a.id, a.img]), [["custom-x", NEUTRAL_BADGE]]);

  setContentAchievements(parseAchievements(JSON.stringify([{ id: "payday", name: "Payday", text: "" }, { id: "vip", name: "VIP", text: "" }])));
  await set("contentFolder", "content");
  await set("contentFiles", ["achievements/payday.webp", "achievements/blank.webp"]);
  assert.deepEqual(achievementList().map(a => [a.id, a.img]), [
    ["payday", "content/achievements/payday.webp"],
    ["vip", "content/achievements/blank.webp"],
    ["custom-x", "content/achievements/blank.webp"]
  ], "a missing badge and the GM's own: the folder's blank one");
});

test("the GM's scan: map/'s files, territories and icons, never the pyramids' tiles", async () => {
  for (const dir of ["content", "content/map", "content/map/territories", "content/map/icons", "content/map/map_files", "content/map/map_files/0", "content/map/map.roads_files"]) folders.add(dir);
  for (const path of ["content/map/config.json", "content/map/map.dzi", "content/map/territories/t1.webp", "content/map/icons/bar.svg", "content/map/map_files/0/0_0.jpg", "content/map/map.roads_files/x.png"]) files.set(path, "");
  assert.deepEqual(await scanContent("content"), ["map/config.json", "map/icons/bar.svg", "map/map.dzi", "map/territories/t1.webp"]);
});

test("the drop-in's map JSON: \"./\" strings anywhere in it are made the folder's map/ paths; others stay", () => {
  const cfg = { picture: { src: "./map.dzi", width: 10 }, areas: "./map.districts.json", roads: "./map.graph.json", overlay: "./map.roads.dzi", milesPerPx: 0.1, categories: [{ id: "bar", icon: "./icons/bar.svg" }], seeded: null };
  assert.deepEqual(resolveMapPaths(cfg, "/my content/"), {
    picture: { src: "my content/map/map.dzi", width: 10 }, areas: "my content/map/map.districts.json", roads: "my content/map/map.graph.json",
    overlay: "my content/map/map.roads.dzi", milesPerPx: 0.1, categories: [{ id: "bar", icon: "my content/map/icons/bar.svg" }], seeded: null
  });
  const pins = { p1: { icon: "./territories/t1.webp", name: "./not a path? still one" }, p2: { icon: "icons/svg/door.svg", text: "a ./ inside" } };
  assert.deepEqual(resolveMapPaths(pins, "c"), { p1: { icon: "c/map/territories/t1.webp", name: "c/map/not a path? still one" }, p2: { icon: "icons/svg/door.svg", text: "a ./ inside" } });
  assert.equal(resolveMapPaths(null, "c"), null);
  assert.equal(cfg.picture.src, "./map.dzi", "the input isn't changed");
});

test("contentScanned: settled at once when no scan was started", async () => {
  assert.equal(await contentScanned(), undefined);
});

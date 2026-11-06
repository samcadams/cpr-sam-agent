import { addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { APP_SETTINGS } from "../scripts/apps/manifest.js";
import { fields, getSetting, groups, setSetting } from "../scripts/ui/settings/groups.js";
import { fieldHtml, fieldOf, kindOf, readValue } from "../scripts/ui/settings/form.js";

/*
 * Configure Settings' submenus (T266): every key in the groups is a registered setting with a name and hint,
 * or described by fields(); each group with a menu has one; get/set reach the right setting.
 */

const MODULE = "cpr-sam-agent";
const registry = new Map();
const menus = new Map();
Object.assign(game.settings, {
  settings: registry,
  menus,
  register: (ns, key, data) => registry.set(`${ns}.${key}`, { ...data, key }),
  registerMenu: (ns, key, data) => menus.set(`${ns}.${key}`, data)
});
// The submenus are Foundry FormApplications: a stand-in, before settings.js loads them.
globalThis.FormApplication ??= class {};
const { registerSettings } = await import("../scripts/settings.js");
registerSettings();

beforeEach(() => {
  reset();
  actAs(addUser({ id: "gm", isGM: true }));
});

test("every key in the groups is registered with a name and hint, or described by fields()", () => {
  const described = fields();
  for (const group of groups()) {
    assert.deepEqual(group.keys, group.sections.flatMap(s => s.keys), `${group.id}: keys are its sections' keys`);
    for (const key of group.keys) {
      const def = key.includes(".") ? described[key] : registry.get(`${MODULE}.${key}`);
      assert.ok(def, `${group.id}: ${key} is a setting`);
      assert.ok(def.name && def.hint, `${group.id}: ${key} has a name and hint`);
      assert.ok(["checkbox", "range", "number", "select", "text"].includes(kindOf(def)), `${key} draws as a field`);
      if (def.requires) assert.ok(described[def.requires] ?? registry.get(`${MODULE}.${def.requires}`), `${key} requires a setting`);
    }
  }
});

test("every setting settings.js registers has a name and hint", () => {
  const appKeys = new Set(APP_SETTINGS.map(s => s.key).filter(k => k !== "alexAgentVoice"));
  for (const [id, def] of registry) {
    if (appKeys.has(def.key)) continue;
    assert.ok(def.name && def.hint, `${id} has a name and hint`);
  }
});

test("no key is in two groups, and every group with a menu has a registered menu", () => {
  const seen = new Map();
  for (const group of groups()) {
    for (const key of group.keys) {
      assert.ok(!seen.has(key), `${key} is in ${seen.get(key)} and ${group.id}`);
      seen.set(key, group.id);
    }
    if (!group.menu) continue;
    const menu = menus.get(`${MODULE}.${group.menu}`);
    assert.ok(menu, `${group.id} has a menu`);
    assert.equal(menu.restricted, true);
    assert.equal(typeof menu.type, "function");
    assert.ok(menu.name && menu.label && menu.hint && menu.icon, `${group.id}'s menu has a name, label, hint and icon`);
  }
  assert.deepEqual([...menus.keys()], ["apps", "phoneRules", "sounds", "clock", "integrations"].map(m => `${MODULE}.${m}`), "in Configure Settings' order");
});

test("the submenus' moved settings: hidden in Foundry's list; the client ones flipped to it", () => {
  for (const key of ["requireAgentItem", "agentLibraryBonus", "ringRadius", "clock", "features", "citinetApps"]) {
    assert.equal(registry.get(`${MODULE}.${key}`).config, false, key);
  }
  for (const key of ["gmPopupSeconds", "gmPopupAnswers", "volume", "worldVolume", "fontScale"]) {
    assert.equal(registry.get(`${MODULE}.${key}`).config, true, key);
  }
});

test("get and set round-trip a plain key, a features key and a citinetApps key", async () => {
  await setSetting("ringRadius", 25);
  assert.equal(getSetting("ringRadius"), 25);

  assert.equal(getSetting("features.shareTexts"), true, "the default");
  await setSetting("features.shareTexts", false);
  assert.equal(getSetting("features.shareTexts"), false);
  assert.equal(game.settings.get(MODULE, "features").shareTexts, false);

  assert.equal(getSetting("citinetApps.garden"), true, "the manifest's default");
  await setSetting("citinetApps.garden", false);
  assert.equal(getSetting("citinetApps.garden"), false);
  assert.deepEqual(game.settings.get(MODULE, "citinetApps"), { garden: false });
  await setSetting("citinetApps.garden", true);
  assert.deepEqual(game.settings.get(MODULE, "citinetApps"), {}, "back to the default: nothing saved");

  assert.throws(() => getSetting("nope.thing"), /unknown setting/);
});

test("the form draws each type as its control and reads it back as that type", () => {
  const range = fieldOf("ringRadius", registry.get(`${MODULE}.ringRadius`), 10, { unit: "m" });
  assert.equal(range.kind, "range");
  assert.match(fieldHtml(range), /type="range" data-key="ringRadius"[^>]*min="1" max="60"/);
  assert.match(fieldHtml(range), /10 m/);
  assert.equal(readValue(range, { value: "12" }), 12);

  const check = fieldOf("features.playerImages", fields()["features.playerImages"], true, { disabled: true });
  assert.equal(check.kind, "checkbox");
  assert.match(fieldHtml(check), /type="checkbox" data-key="features.playerImages" disabled checked/);
  assert.equal(readValue(check, { checked: false }), false);

  assert.equal(kindOf({ type: Number }), "number");
  assert.equal(readValue(fieldOf("n", { type: Number }, 1), { value: "" }), null, "an empty number box saves nothing");
  assert.equal(kindOf({ type: String, choices: { a: "A" } }), "select");
  assert.equal(kindOf({ type: String }), "text");
  assert.match(fieldHtml(fieldOf("agentNames", registry.get(`${MODULE}.agentNames`), "Agent")), /type="text" data-key="agentNames" value="Agent"/);
});

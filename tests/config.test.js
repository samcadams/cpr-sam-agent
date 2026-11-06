import "./foundry-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldHtml, fieldOf, getPath, kindOf, readValue, setPath, typeOf } from "../scripts/ui/config/fields.js";
import { APP_MANIFEST, APP_RULES } from "../scripts/apps/manifest.js";
import { configModules, groupSections, saveSetting, settingField } from "../scripts/ui/config/settings.js";
import { MEDSCAN_DEFAULTS, TRAUMA_DEFAULTS } from "../apps/trauma/model.js";
import { OPTIONS_DEFAULTS } from "../apps/weather/model.js";
import { CABB_DEFAULTS } from "../apps/cabb/model.js";
import { cleanConfig } from "../apps/market/model.js";
import { ncpdConfig } from "../apps/ncpd/model.js";
import { bioConfig } from "../apps/handscan/model.js";
import { hustoolConfig } from "../apps/hustool/model.js";
import { configOf as roachConfig } from "../apps/roach/model.js";
import { configOf as redlineConfig } from "../apps/redline/model.js";
import { configOf as ncartConfig } from "../apps/ncart/model.js";
import { GACHA_DEFAULTS } from "../apps/gacha/model.js";
import { ACHIEVE_DEFAULTS } from "../apps/achieve/model.js";

/* The generic settings form (scripts/ui/config/): field per setting type, and the apps' rules schemas. */

test("each setting type gets its control", () => {
  assert.equal(kindOf({ type: Boolean }), "checkbox");
  assert.equal(kindOf({ type: Number }), "number");
  assert.equal(kindOf({ type: Number, range: { min: 0, max: 1, step: 0.1 } }), "range");
  assert.equal(kindOf({ type: String }), "text");
  assert.equal(kindOf({ type: String, choices: { a: "A", b: "B" } }), "select");
  assert.equal(kindOf({ type: Number, choices: { 1: "One" } }), "select");
  assert.equal(kindOf({ type: Object }), "object");
  assert.equal(kindOf({ type: Array }), "object");
  assert.equal(kindOf({ type: "boolean" }), "checkbox"); // a rule's own word
  class BooleanField {}
  assert.equal(typeOf(new BooleanField()), "boolean"); // a DataField
});

test("a field carries the registry's name, hint, scope and reload flag, and draws them", () => {
  const field = fieldOf("cpr-sam-agent.volume", { name: "Phone volume", hint: "0 mutes", type: Number, range: { min: 0, max: 1, step: 0.05 }, scope: "client", requiresReload: true }, 0.5);
  assert.equal(field.kind, "range");
  assert.ok(field.client && field.reload);
  const html = fieldHtml(field, { attrs: 'data-director="config-set"' });
  assert.match(html, /Phone volume/);
  assert.match(html, /\(this browser\)/);
  assert.match(html, /0 mutes/);
  assert.match(html, /type="range"[^>]*data-field="cpr-sam-agent.volume"|data-field="cpr-sam-agent.volume"[^>]*type="range"|type="range" data-field/);
  assert.match(html, /data-director="config-set"/);
  assert.match(html, /min="0" max="1" step="0.05" value="0.5"/);
});

test("select, checkbox and text controls show the current value; a draft wins over it", () => {
  const sel = fieldHtml(fieldOf("x.mode", { type: String, choices: { a: "Alpha", b: "Beta" } }, "b"));
  assert.match(sel, /<option value="b" selected>Beta/);
  assert.match(fieldHtml(fieldOf("x.on", { type: Boolean }, true)), /type="checkbox"[^>]*checked/);
  assert.doesNotMatch(fieldHtml(fieldOf("x.on", { type: Boolean }, false)), /checked/);
  assert.match(fieldHtml(fieldOf("x.t", { type: String }, "old"), { draft: "typing" }), /value="typing"/);
});

test("an object setting is an Open button when its group has a menu, else a note", () => {
  const open = fieldHtml(fieldOf("x.obj", { type: Object }, {}, { open: { label: "Table rules", data: { director: "config-menu", ns: "cpr-hq", menu: "rules" } } }));
  assert.match(open, /<button type="button" data-director="config-menu" data-ns="cpr-hq" data-menu="rules">/);
  assert.match(open, /Table rules/);
  assert.match(fieldHtml(fieldOf("x.obj", { type: Object }, {})), /Edited in its app/);
});

test("controls read back as the field's type", () => {
  assert.equal(readValue({ kind: "checkbox", type: "boolean" }, { checked: true }), true);
  assert.equal(readValue({ kind: "number", type: "number" }, { value: "12" }), 12);
  assert.equal(readValue({ kind: "number", type: "number" }, { value: "" }), null);
  assert.equal(readValue({ kind: "select", type: "number" }, { value: "3" }), 3);
  assert.equal(readValue({ kind: "text", type: "string" }, { value: "hi" }), "hi");
});

test("paths read and write inside a config object without touching the original", () => {
  const cfg = { medscan: { price: 20 }, eta: 5 };
  assert.equal(getPath(cfg, "medscan.price"), 20);
  assert.equal(getPath(cfg, "nope.deep"), undefined);
  assert.equal(getPath("ask", ""), "ask");
  const next = setPath(cfg, "medscan.wound", 150);
  assert.deepEqual(next, { medscan: { price: 20, wound: 150 }, eta: 5 });
  assert.equal(cfg.medscan.wound, undefined);
  assert.deepEqual(setPath({}, "a.b.c", true), { a: { b: { c: true } } });
});

test("every app's rules are well formed: a setting of the app, a label, a type the form can draw, a default", () => {
  assert.ok(Object.keys(APP_RULES).length > 0);
  for (const [app, rules] of Object.entries(APP_RULES)) {
    const settings = Object.keys(APP_MANIFEST[app].settings ?? {});
    for (const rule of rules) {
      const where = `${app}: ${rule.key}.${rule.path}`;
      assert.ok(settings.includes(rule.key), `${where}: not one of the app's settings`);
      assert.ok(rule.label, `${where}: no label`);
      assert.ok(["boolean", "number", "string"].includes(rule.type), `${where}: type ${rule.type}`);
      assert.notEqual(kindOf(rule), "object", where);
      assert.ok("default" in rule, `${where}: no default`);
      if (rule.choices) assert.ok(String(rule.default) in rule.choices, `${where}: default isn't a choice`);
      if (rule.range && typeof rule.default === "number") assert.ok(rule.default >= (rule.range.min ?? -Infinity) && rule.default <= (rule.range.max ?? Infinity), `${where}: default out of range`);
    }
  }
});

test("each rule's default is what the app uses while nothing is saved", () => {
  // What each app's model makes of an empty config object.
  const empty = {
    trauma: { ...TRAUMA_DEFAULTS, medscan: MEDSCAN_DEFAULTS },
    weather: OPTIONS_DEFAULTS,
    cabb: CABB_DEFAULTS,
    market: cleanConfig({}),
    ncpd: ncpdConfig({}),
    bioscan: bioConfig({}),
    hustool: hustoolConfig({}),
    roach: roachConfig({}),
    redline: redlineConfig({}),
    ncart: ncartConfig({}),
    gachaConfig: GACHA_DEFAULTS,
    achieve: ACHIEVE_DEFAULTS,
    gladiatorSettle: APP_MANIFEST.gladiator?.settings.gladiatorSettle.default,
    gardenConfig: { mergeNews: false, dating: true } // apps/garden/model.js gardenConfig: !!mergeNews, dating !== false
  };
  for (const rules of Object.values(APP_RULES)) {
    for (const rule of rules) {
      assert.ok(rule.key in empty, `${rule.key}: no model defaults to check against`);
      assert.deepEqual(getPath(empty[rule.key], rule.path), rule.default, `${rule.key}.${rule.path}`);
    }
  }
});

test("a module's api.settings: registered keys from the registry, dotted keys from its fields, read and written through its get/set", async () => {
  const stored = { "features.comms": true };
  const writes = [];
  game.i18n ??= { localize: s => s };
  foundry.utils.objectsEqual ??= (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const registry = game.settings.settings;
  game.settings.settings = new Map([["cpr-hq.workDay", { name: "Work day", hint: "hours", type: Number, scope: "world", default: 8 }]]);
  game.modules.set("cpr-hq", {
    active: true, title: "CPR HQ",
    api: { settings: {
      groups: [{ id: "rules", label: "Table rules", keys: ["workDay", "features.comms", "nope"], sections: [{ label: "Workshop", keys: ["workDay"] }, { label: "Crew", keys: ["features.comms", "nope"] }] }],
      fields: { "features.comms": { name: "Communications", type: "Boolean", default: true } },
      get: key => stored[key] ?? (key === "workDay" ? 8 : undefined),
      set: async (key, value) => { writes.push([key, value]); stored[key] = value; }
    } }
  });
  game.modules.set("cpr-sheet-skin", { active: false, title: "Skin", api: { settings: { groups: [] } } });
  try {
    assert.deepEqual(configModules().map(m => m.id), ["cpr-hq"], "only active modules that expose api.settings");
    const day = settingField("cpr-hq", "workDay");
    assert.equal(day.kind, "number");
    assert.equal(day.value, 8);
    const comms = settingField("cpr-hq", "features.comms");
    assert.equal(comms.kind, "checkbox");
    assert.equal(comms.name, "Communications");
    assert.equal(settingField("cpr-hq", "nope"), null);
    const sections = groupSections("cpr-hq", configModules()[0].groups[0]);
    assert.deepEqual(sections.map(s => [s.label, s.fields.map(f => f.id)]), [["Workshop", ["cpr-hq.workDay"]], ["Crew", ["cpr-hq.features.comms"]]]);
    await saveSetting("cpr-hq.features.comms", false);
    await saveSetting("cpr-hq.features.comms", false); // unchanged: not written again
    await saveSetting("cpr-hq.nope", true); // nobody knows it: not written
    assert.deepEqual(writes, [["features.comms", false]]);
  } finally {
    game.settings.settings = registry;
    game.modules.delete("cpr-hq");
    game.modules.delete("cpr-sheet-skin");
  }
});

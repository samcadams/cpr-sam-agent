// The release build (tools/bundle.mjs --release defines globalThis.CPR_SAM_AGENT_RELEASE): devOnly apps are left out.
// node --test runs each file in its own process, so setting the global before the imports affects only this file.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.CPR_SAM_AGENT_RELEASE = true;
const { APP_DEFS } = await import("../apps/index.js");
const { APP_IDS, APP_PARTIALS, APP_SETTINGS, APP_TABLES } = await import("../scripts/apps/manifest.js");

test("release builds leave Digital Gladiator out", () => {
  assert.ok(APP_DEFS.find(app => app.id === "gladiator").devOnly);
  assert.ok(!APP_IDS.includes("gladiator"));
  assert.ok(!("agent-app-gladiator" in APP_PARTIALS));
  assert.ok(!APP_SETTINGS.some(s => s.app === "gladiator"));
  assert.ok(!("gladiators" in APP_TABLES));
});

test("release builds keep every other app", () => {
  assert.deepEqual(APP_IDS, APP_DEFS.filter(app => !app.devOnly).map(app => app.id));
});

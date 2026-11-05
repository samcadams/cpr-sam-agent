import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fold, fragments } from "../tools/changelog.mjs";
import { isShipped, releaseManifest } from "../tools/release.mjs";

/* The dev tools: changelog fragments (tools/changelog.mjs). The app lists are checked in apps.test.js. */

test("changelog fragments fold into their version's section, newest first, and make it if it's new", () => {
  const log = "# Changelog\n\n## V1.2.0\n- Old line\n\n## V1.1.0\n- Older\n";
  assert.equal(fold(log, "1.2.0", ["- New", "- Newer"]), "# Changelog\n\n## V1.2.0\n- New\n- Newer\n- Old line\n\n## V1.1.0\n- Older\n");
  assert.equal(fold(log, "1.3.0", ["- Next"]), "# Changelog\n\n## V1.3.0\n- Next\n\n## V1.2.0\n- Old line\n\n## V1.1.0\n- Older\n");
});

test("a fragment is bullets only; the README isn't one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frag-"));
  fs.mkdirSync(path.join(root, "changes"));
  fs.writeFileSync(path.join(root, "changes/README.md"), "# not a fragment\n");
  fs.writeFileSync(path.join(root, "changes/b-feature.md"), "- B: did a thing\n  more about it\n\n");
  fs.writeFileSync(path.join(root, "changes/a-fix.md"), "- A: fixed it\n");
  assert.deepEqual(fragments(root), [{ file: "a-fix.md", bullets: ["- A: fixed it"] }, { file: "b-feature.md", bullets: ["- B: did a thing", "  more about it"] }]);
  fs.writeFileSync(path.join(root, "changes/c.md"), "Not a bullet\n");
  assert.throws(() => fragments(root), /every line is a "- " bullet/);
});

test("the fragments in changes/ are well formed", () => {
  assert.doesNotThrow(() => fragments());
});

test("a release ships only what's on the allowlist", () => {
  for (const p of ["module.json", "README.md", "apps/x/page.js", "images/apps/a.webp", "packs/agent-macros/CURRENT", "dist/cpr-sam-agent.js", "dist/cpr-sam-agent.css", "templates/a.hbs", "sounds/a.ogg"]) assert.ok(isShipped(p), p);
  for (const p of ["package.json", "TESTING.md", "v1.0 release.md", "eslint.config.js", "tests/a.js", "tools/a.mjs", "changes/a.md", "node_modules/x/y.js",
    ".gitignore", "packs/_source/a.json", "dist/cpr-sam-agent.js.map", "dist/.built", "dist/sub/a.js"]) assert.ok(!isShipped(p), p);
});

test("the release manifest gets its URLs from the version, without touching the original", () => {
  const original = { id: "cpr-sam-agent", version: "1.2.0" };
  const m = releaseManifest(original);
  assert.equal(m.download, "https://github.com/samcadams/cpr-sam-agent/releases/download/v1.2.0/cpr-sam-agent.zip");
  assert.equal(m.manifest, "https://github.com/samcadams/cpr-sam-agent/releases/latest/download/module.json");
  assert.equal(m.bugs, "https://github.com/samcadams/cpr-sam-agent/issues");
  assert.equal(m.url, "https://github.com/samcadams/cpr-sam-agent");
  assert.deepEqual(original, { id: "cpr-sam-agent", version: "1.2.0" });
});

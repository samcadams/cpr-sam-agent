#!/usr/bin/env node
/*
 * `npm run bundle`: build the files Foundry loads into dist/, so a world load fetches 2 files instead of
 * ~250 (209 ES modules + 45 stylesheets). The sources stay as they are; edit them as usual.
 *
 *   dist/cpr-sam-agent.js    scripts/main.js and everything it imports, + .map
 *   dist/cpr-sam-agent.css   every stylesheet in scripts/styles.js order, url()s rebased, + .map
 *
 * Not minified on purpose: names, comments and `// apps/x/page.js` section markers stay readable in DevTools
 * and stack traces (minifying saves only ~120 KB gzipped). fpw maps dist/ stack positions back to the sources.
 *
 * `--watch`   rebuild on every change (leave it running while you edit)
 * `--check`   build nothing; exit 1 (and say why) when dist/ is missing or a source file changed since the build
 * `--if-stale` build only when `--check` would fail
 * `--enable`  build, then point module.json at the bundle (needs a world relaunch to take effect)
 * `--disable` point module.json back at scripts/main.js and the separate stylesheets (relaunch too)
 * `--release` build as usual but with no sourcemaps and globalThis.CPR_SAM_AGENT_RELEASE = true (what `npm run release` ships)
 *
 * While it's enabled, a source edit shows up after a rebuild. fpw does that by itself before `fpw reload`
 * (and the other commands that load a page), and `tools/wip commit` after each commit. In a browser of your
 * own, reload after one of those, or keep `npm run bundle:watch` running.
 *
 * Outputs are written to a temp file and renamed, so a client never loads half a bundle; builds from
 * several lanes at once queue on a lock.
 *
 * Imports built from a runtime URL (`import(foundry.utils.getRoute(...))`) stay runtime imports.
 * Class and function names are kept (`keepNames`): Foundry registers sheets and settings by class name.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUT_JS = path.join(DIST, "cpr-sam-agent.js");
const OUT_CSS = path.join(DIST, "cpr-sam-agent.css");
/** When the last build started (ms). Output mtimes aren't reliable over the SFTP mount, so we keep our own. */
const STAMP = path.join(DIST, ".built");
/** A hash of each source file the last build read ({path: sha1}). Source mtimes aren't reliable either: kio-fuse
 *  keeps the old mtime for 10-20 s after an in-place write, so an edit right before `fpw reload` looked built. */
const SOURCES = path.join(DIST, ".sources");
/** Folders whose files end up in the bundles. */
const SOURCE_DIRS = ["scripts", "apps", "styles"];
const SOURCE_EXT = /\.(m?js|css)$/;

const ASSET = /\.(webp|png|jpe?g|gif|svg|avif|woff2?|ttf|otf|ogg|mp3|wav)(\?.*)?$/i;
/** Keep image/font url()s pointing at the module's own files, rebased from dist/. */
const rebaseAssets = {
  name: "rebase-assets",
  setup(build) {
    build.onResolve({ filter: ASSET }, args => {
      if (/^(data:|https?:|\/)/.test(args.path)) return { path: args.path, external: true };
      const target = path.resolve(args.resolveDir, args.path);
      return { path: path.relative(DIST, target).split(path.sep).join("/"), external: true };
    });
  }
};

/** One @import per stylesheet, in the order module.json used to list them (tools/apps.mjs). */
async function cssEntry() {
  const { stylesFor } = await import(pathToFileURL(path.join(ROOT, "scripts/styles.js")).href);
  const { readApps } = await import(pathToFileURL(path.join(ROOT, "tools/apps.mjs")).href);
  return stylesFor((await readApps(ROOT)).map(a => a.id)).map(s => `@import "./${s}";`).join("\n");
}

const common = { bundle: true, keepNames: true, sourcemap: process.argv.includes("--release") ? false : "linked", logLevel: "warning", target: "es2022", write: false };

async function options() {
  return [
    { ...common, entryPoints: [path.join(ROOT, "scripts/main.js")], format: "esm", outfile: OUT_JS,
      define: process.argv.includes("--release") ? { "globalThis.CPR_SAM_AGENT_RELEASE": "true" } : {} },
    {
      ...common,
      stdin: { contents: await cssEntry(), resolveDir: ROOT, sourcefile: "styles.css", loader: "css" },
      outfile: OUT_CSS,
      plugins: [rebaseAssets]
    }
  ];
}

/** {path: sha1} of every source file (about 0.4 s for ~300 files over the mount). */
function sourceHashes() {
  const out = {};
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(e.name)) out[path.relative(ROOT, p)] = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
    }
  };
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d));
  return out;
}

/** Whether dist/ is missing or was built from other sources, and the first source file that differs. */
function staleness() {
  const complete = [OUT_JS, OUT_CSS, STAMP, SOURCES].every(f => fs.existsSync(f));
  if (!complete) return { stale: true, built: false };
  let old = {};
  try { old = JSON.parse(fs.readFileSync(SOURCES, "utf8")); } catch { /* unreadable: rebuild */ }
  const now = sourceHashes();
  const changed = [...new Set([...Object.keys(now), ...Object.keys(old)])].find(f => now[f] !== old[f]);
  return { stale: !!changed, built: true, changedFile: changed };
}

/** Write esbuild's outputs (write: false) atomically: temp file, then rename over the old one. */
function writeOutputs(results, started, hashes) {
  fs.mkdirSync(DIST, { recursive: true });
  for (const { outputFiles } of results) {
    for (const f of outputFiles) {
      const tmp = `${f.path}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, f.contents);
      fs.renameSync(tmp, f.path);
    }
  }
  fs.writeFileSync(STAMP, String(started));
  fs.writeFileSync(SOURCES, JSON.stringify(hashes));
}

/** Run fn holding a machine-wide lock for this module (every lane builds from this machine). */
async function locked(fn) {
  const lock = path.join(os.tmpdir(), `cpr-bundle-${Buffer.from(ROOT).toString("base64url").slice(-40)}.lock`);
  for (let waited = 0; ; waited += 200) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // A build takes about a second; a lock older than two minutes belongs to a crashed one.
      if (Date.now() - fs.statSync(lock).mtimeMs > 120000) fs.rmSync(lock, { recursive: true, force: true });
      if (waited > 60000) throw new Error(`bundle: still locked by another build after 60 s (${lock})`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function build() {
  const t = Date.now(), hashes = sourceHashes();
  writeOutputs(await Promise.all((await options()).map(o => esbuild.build(o))), t, hashes);
  const size = f => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;
  console.log(`bundle: dist/cpr-sam-agent.js ${size(OUT_JS)}, dist/cpr-sam-agent.css ${size(OUT_CSS)} (${Date.now() - t} ms)`);
}

/** Point module.json at the bundle (on) or the sources (off), the way tools/apps.mjs writes it. */
async function setMode(on) {
  const { BUNDLE, stylesFor } = await import(pathToFileURL(path.join(ROOT, "scripts/styles.js")).href);
  const { readApps } = await import(pathToFileURL(path.join(ROOT, "tools/apps.mjs")).href);
  const file = path.join(ROOT, "module.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.esmodules = [on ? BUNDLE.js : "scripts/main.js"];
  manifest.styles = on ? [BUNDLE.css] : stylesFor((await readApps(ROOT)).map(a => a.id));
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`bundle: module.json now loads ${on ? "the bundle" : "the sources"}; relaunch the world to apply it`);
}

const arg = process.argv[2];
if (arg === "--enable") {
  await locked(build);
  await setMode(true);
} else if (arg === "--disable") {
  await setMode(false);
} else if (arg === "--check") {
  const s = staleness();
  if (s.stale) {
    console.log(s.built ? `bundle: out of date (${s.changedFile} changed); run npm run bundle` : "bundle: dist/ is missing; run npm run bundle");
    process.exit(1);
  }
} else if (arg === "--if-stale") {
  // Checked again under the lock: another lane may have just built it.
  if (staleness().stale) await locked(async () => { if (staleness().stale) await build(); });
} else if (arg === "--watch") {
  // Each rebuild that succeeds is written out with the stamp and source hashes from when it started.
  const stamp = { name: "stamp", setup(b) {
    let t, hashes;
    b.onStart(() => { t = Date.now(); hashes = sourceHashes(); });
    b.onEnd(r => {
      if (r.errors.length) return;
      writeOutputs([r], t, hashes);
      console.log(`bundle: rebuilt ${path.basename(b.initialOptions.outfile)}`);
    });
  } };
  const contexts = await Promise.all((await options()).map(o => esbuild.context({ ...o, plugins: [...(o.plugins ?? []), stamp] })));
  await Promise.all(contexts.map(c => c.watch()));
  console.log("bundle: watching (Ctrl-C to stop). A new app or stylesheet needs a restart.");
} else {
  await locked(build);
}

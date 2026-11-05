#!/usr/bin/env node
/*
 * `npm run release`: build a clean distribution of the module from git HEAD (not the working folder, where
 * gitignored R. Talsorian Games art sits on disk), into cpr-sam-agent-releases/v<version>/ beside Foundry's Data:
 *
 *   cpr-sam-agent.zip   the module, entries under cpr-sam-agent/ (unzips straight into Data/modules)
 *   module.json         the same manifest, with the release URLs stamped in
 *
 * `--art`      also zip the GM's art folder (../../cpr-sam-agent-content) as cpr-sam-agent-content-<version>.zip.
 *              It holds RTG art: private use only, never part of the module zip.
 * `--out DIR`  write there instead of ../../../cpr-sam-agent-releases/v<version>
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fragments } from "./changelog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ID = "cpr-sam-agent";
const REPO = "https://github.com/samcadams/cpr-sam-agent";
const FILES = ["module.json", "README.md", "LICENSE", "CHANGELOG.md", "API.md"];
const DIRS = ["apps", "data", "images", "packs", "scripts", "sounds", "styles", "templates", "dist"];

/** Whether a path inside the repo (forward slashes) ships. An allowlist: anything not named here stays out. */
export function isShipped(rel) {
  const parts = rel.split("/");
  if (parts.length === 1) return FILES.includes(rel);
  if (!DIRS.includes(parts[0])) return false;
  if (parts[0] === "packs" && parts[1] === "_source") return false;
  if (parts[0] === "dist") return parts.length === 2 && /\.(js|css)$/.test(rel);
  return true;
}

/**
 * The manifest with its release URLs, derived from `version` (the dev module.json carries the same ones). A Foundry
 * update deletes the module folder, .git included, so dev folders are locked in Setup (`<id>.lock`, gitignored).
 */
export function releaseManifest(manifest) {
  return { ...manifest, url: REPO, bugs: `${REPO}/issues`, manifest: `${REPO}/releases/latest/download/module.json`,
    download: `${REPO}/releases/download/v${manifest.version}/${ID}.zip` };
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
}

/** Every file under `dir` (relative, forward slashes) that ships. */
function shippedFiles(dir, sub = "") {
  return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap(e => {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    return e.isDirectory() ? shippedFiles(dir, rel) : isShipped(rel) ? [rel] : [];
  });
}

function countFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => !e.isDirectory()).length;
}

function report(file, count) {
  console.log(`${file}  ${(fs.statSync(file).size / 1e6).toFixed(1)} MB, ${count} files`);
}

function zip(file, cwd, name) {
  fs.rmSync(file, { force: true });
  run("zip", ["-qrX", file, name], cwd);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const art = path.resolve(ROOT, "../../cpr-sam-agent-content");
  if (args.includes("--art") && !fs.existsSync(art)) throw new Error(`--art: no art folder at ${art}`);
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).length;
  if (dirty) console.error(`warning: ${dirty} uncommitted change(s) left out of the zip: only HEAD ships`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-release-"));
  try {
    const tree = path.join(tmp, "tree");
    fs.mkdirSync(tree);
    execFileSync("sh", ["-c", `git archive HEAD | tar -x -C "${tree}"`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    const unfolded = fragments(tree);
    if (unfolded.length) console.error(`warning: ${unfolded.length} unfolded changelog fragment(s) in changes/: run npm run changelog -- --write first`);
    run("npm", ["ci", "--silent"], tree);
    run("node", ["tools/bundle.mjs", "--release"], tree);
    run("npm", ["run", "--silent", "build:packs"], tree);

    const stage = path.join(tmp, "stage", ID);
    const files = shippedFiles(tree);
    for (const rel of files) {
      fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
      fs.copyFileSync(path.join(tree, rel), path.join(stage, rel));
    }
    const manifest = releaseManifest(JSON.parse(fs.readFileSync(path.join(tree, "module.json"), "utf8")));
    const json = JSON.stringify(manifest, null, 2) + "\n";
    fs.writeFileSync(path.join(stage, "module.json"), json);

    // Beside Data, not under it: Foundry serves everything under Data publicly.
    const outIdx = args.indexOf("--out");
    const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : path.resolve(ROOT, "../../../cpr-sam-agent-releases", `v${manifest.version}`));
    fs.mkdirSync(out, { recursive: true });
    zip(path.join(out, `${ID}.zip`), path.dirname(stage), ID);
    fs.writeFileSync(path.join(out, "module.json"), json);
    report(path.join(out, `${ID}.zip`), files.length);
    if (args.includes("--art")) {
      const artZip = path.join(out, `${ID}-content-${manifest.version}.zip`);
      zip(artZip, path.dirname(art), path.basename(art));
      report(artZip, countFiles(art));
      console.log("The art zip contains R. Talsorian Games art: private use only, not for a public release.");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

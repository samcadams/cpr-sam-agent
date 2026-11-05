#!/usr/bin/env node
/*
 * `npm run changelog`: the changelog fragments (changes/<key>.md, see changes/README.md) and what folding
 * them adds to CHANGELOG.md. `-- --write` folds them in, under module.json's version, and deletes them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The fragments, by name: [{ file, bullets }]. Every line of a fragment that isn't blank is a bullet. */
export function fragments(root = ROOT) {
  const dir = path.join(root, "changes");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".md") && f !== "README.md").sort().map(file => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const bullets = text.split(/\r?\n/).filter(l => l.trim());
    const bad = bullets.find(l => !l.startsWith("- ") && !l.startsWith("  "));
    if (bad) throw new Error(`changes/${file}: every line is a "- " bullet (or indented under one): ${bad}`);
    return { file, bullets };
  });
}

/** The changelog with the fragments' bullets at the top of `version`'s section (made at the top if new). */
export function fold(changelog, version, bullets) {
  const heading = `## V${version}`;
  const lines = changelog.split("\n");
  let at = lines.findIndex(l => l.trim() === heading);
  if (at < 0) {
    const first = lines.findIndex(l => l.startsWith("## "));
    const insert = first < 0 ? lines.length : first;
    lines.splice(insert, 0, heading, "");
    at = insert;
  }
  lines.splice(at + 1, 0, ...bullets);
  return lines.join("\n").replace(new RegExp(`(${heading}\\n(?:.+\\n)*?)\\n(?=- )`), "$1");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  const found = fragments();
  if (!found.length) {
    console.log("No changelog fragments in changes/.");
    process.exit(0);
  }
  const bullets = found.flatMap(f => f.bullets);
  if (!process.argv.includes("--write")) {
    console.log(`Folding would add to ## V${version}:\n`);
    for (const { file, bullets: b } of found) console.log(`changes/${file}\n${b.join("\n")}\n`);
    process.exit(0);
  }
  const file = path.join(ROOT, "CHANGELOG.md");
  fs.writeFileSync(file, fold(fs.readFileSync(file, "utf8"), version, bullets));
  for (const { file: f } of found) fs.unlinkSync(path.join(ROOT, "changes", f));
  console.log(`Folded ${found.length} fragment(s) into CHANGELOG.md (## V${version}).`);
}

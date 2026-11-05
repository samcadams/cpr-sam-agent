#!/usr/bin/env node
/*
 * `npm run apps`: rebuild the app lists from the app folders (apps/<id>/app.js). Run it after adding,
 * removing or reordering an app; `npm test` fails while the lists are out of date.
 *
 * It writes:
 *   apps/index.js    every app's definition (app.js), in home-screen order (`order`)
 *   apps/hosts.js    each app's host code (host.js)
 *   apps/pages.js    each app's phone page (page.js)
 *   apps/clients.js  each app's own Foundry hooks (client.js, for the apps that have one)
 *   apps/directors.js  each app's part of the GM Director (director.js, for the apps that have one)
 *   module.json      "styles": the core stylesheets around each app's <id>.css (scripts/styles.js)
 *
 * The lists are files, not a folder scan at load time: browsers can't list a folder, and Foundry loads
 * the module before it could wait for one.
 *
 * `node tools/apps.mjs --check` changes nothing, prints what is out of date and exits 1 if anything is.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = "// Built by `npm run apps` (tools/apps.mjs) from the app folders. Don't edit it by hand.\n";

/** The files every app folder has, and the optional ones. */
export const REQUIRED = ["app.js", "host.js", "page.js"];

/** The app folders' definitions, in order: [{ id, def, client }]. */
export async function readApps(root = ROOT) {
  const dir = path.join(root, "apps");
  const apps = [];
  for (const id of fs.readdirSync(dir).sort()) {
    if (!fs.statSync(path.join(dir, id)).isDirectory()) continue;
    for (const file of [...REQUIRED, `${id}.hbs`, `${id}.css`]) {
      if (!fs.existsSync(path.join(dir, id, file))) throw new Error(`apps/${id}: ${file} is missing`);
    }
    const { default: def } = await import(pathToFileURL(path.join(dir, id, "app.js")).href);
    if (def?.id !== id) throw new Error(`apps/${id}/app.js: its id is "${def?.id}", not "${id}"`);
    if (typeof def.order !== "number") throw new Error(`apps/${id}/app.js: needs an \`order\` (its place on the home screen)`);
    apps.push({ id, def, client: fs.existsSync(path.join(dir, id, "client.js")), director: fs.existsSync(path.join(dir, id, "director.js")) });
  }
  const orders = new Map();
  for (const { id, def } of apps) {
    if (orders.has(def.order)) throw new Error(`apps/${id} and apps/${orders.get(def.order)} have the same order (${def.order})`);
    orders.set(def.order, id);
  }
  return apps.sort((a, b) => a.def.order - b.def.order);
}

/** What the generated files should hold: { [path]: text }. */
export async function build(root = ROOT) {
  const apps = await readApps(root);
  const name = id => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : null) ?? (() => { throw new Error(`apps/${id}: the folder name must be a JS identifier`); })();
  const files = {};
  files["apps/index.js"] = HEADER
    + apps.map(({ id }) => `import ${name(id)} from "./${id}/app.js";\n`).join("")
    + `\n/** Every app's definition (apps/<id>/app.js), in home-screen order. */\n`
    + `export const APP_DEFS = [${apps.map(({ id }) => id).join(", ")}];\n`;
  files["apps/hosts.js"] = HEADER + "// Each app's host code, by app id (host/index.js installs them).\n\n"
    + apps.map(({ id }) => `export * as ${id} from "./${id}/host.js";\n`).join("");
  files["apps/pages.js"] = HEADER + "// Each app's phone page, by app id (AgentPhone installs them).\n\n"
    + apps.map(({ id }) => `export * as ${id} from "./${id}/page.js";\n`).join("");
  files["apps/clients.js"] = HEADER + "// The apps' own Foundry hooks, by app id (main.js installs them).\n\n"
    + apps.filter(a => a.client).map(({ id }) => `export * as ${id} from "./${id}/client.js";\n`).join("");
  files["apps/directors.js"] = HEADER + "// Each app's part of the GM Director, by app id (ui/director/ uses them).\n\n"
    + apps.filter(a => a.director).map(({ id }) => `export * as ${id} from "./${id}/director.js";\n`).join("");

  const { BUNDLE, stylesFor } = await import(pathToFileURL(path.join(root, "scripts/styles.js")).href);
  const manifestPath = path.join(root, "module.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // With the bundle switched on (tools/bundle.mjs --enable), its one stylesheet holds all of them.
  manifest.styles = manifest.esmodules?.[0] === BUNDLE.js ? [BUNDLE.css] : stylesFor(apps.map(a => a.id));
  files["module.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return files;
}

/** The generated files that differ from what's on disk. */
export async function stale(root = ROOT) {
  const files = await build(root);
  return Object.keys(files).filter(f => !fs.existsSync(path.join(root, f)) || fs.readFileSync(path.join(root, f), "utf8") !== files[f]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const files = await build();
  const out = await stale();
  if (check) {
    if (out.length) {
      console.log(`Out of date (run npm run apps): ${out.join(", ")}`);
      process.exit(1);
    }
    console.log("The app lists are up to date.");
  } else {
    for (const f of out) fs.writeFileSync(path.join(ROOT, f), files[f]);
    console.log(out.length ? `Wrote ${out.join(", ")}` : "Nothing to change.");
  }
}

import { MODULE_ID } from "../config.js";

/*
 * The GM's content folder: pictures (and Achieve!'s list) the module doesn't ship, dropped into a folder
 * under Data (world setting "contentFolder"). Without it everything still works, with glyphs and blank
 * badges instead.
 *
 *   <folder>/apps/<4tify|digital-gladiator|ncpd-crime-database|trauma-team-medscan|ziggurat-city-database|cbk>.webp
 *   <folder>/cbk/<apps|cyberware|fashion|frames|gear|logo|vehicles|weapons>.webp
 *   <folder>/achievements/<id>.webp, blank.webp
 *   <folder>/achievements.json   [{ id, name, text }]
 *   <folder>/map/config.json, pins.json, with the files they name (the Map's Night City, apps/map/host.js):
 *     map.dzi, map.roads.dzi, map.districts.json, map.graph.json, territories/*.webp, icons/*.svg. In the two
 *     JSON files a string starting with "./" is relative to map/ (resolveMapPaths).
 *
 * Players can't browse files, so the active GM looks in the folder (on ready, and when the setting changes)
 * and saves what's there in the hidden world setting "contentFiles" (paths relative to the folder); every
 * client reads that. achievements.json is a plain static file, so every client fetches it. The pyramids' tiles
 * (map_files/, map.roads_files/) aren't listed: the viewer fetches them beside the .dzi.
 */

export const CONTENT_DEFAULT = "cpr-sam-agent-content";
/** The folders the scan looks in, and the folders it looks in inside them. */
const SUBFOLDERS = { apps: {}, cbk: {}, achievements: {}, map: { territories: {}, icons: {} } };
const ACHIEVEMENTS_FILE = "achievements.json";

/** Full-colour home-screen icons (the app's CSS shows them while body has agent-art-<app>). */
export const APP_ART = {
  trauma: "apps/trauma-team-medscan.webp",
  ncpd: "apps/ncpd-crime-database.webp",
  gladiator: "apps/digital-gladiator.webp",
  fortify: "apps/4tify.webp",
  cbk: "apps/cbk.webp"
};

const trimSlashes = path => String(path ?? "").trim().replace(/^\/+|\/+$/g, "");

/** `rel` in the folder, when the folder has it; else null. */
export function artPath(folder, files, rel) {
  const dir = trimSlashes(folder);
  return dir && Array.isArray(files) && files.includes(rel) ? `${dir}/${rel}` : null;
}

/** The files FilePicker.browse found (full paths, maybe URL-encoded), relative to `folder`. */
export function relativeFiles(folder, paths) {
  const prefix = `${trimSlashes(folder)}/`;
  const decode = p => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  return paths.map(decode).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length));
}

/** The drop-in's map/config.json or pins.json with every "./…" string made a path under `<folder>/map/`. */
export function resolveMapPaths(data, folder) {
  const base = `${trimSlashes(folder)}/map/`;
  const walk = value => {
    if (typeof value === "string") return value.startsWith("./") ? base + value.slice(2) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk(data);
}

/** achievements.json's text → [{ id, name, text }]; anything unreadable: none. */
export function parseAchievements(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map(a => ({ id: String(a?.id ?? "").trim(), name: String(a?.name ?? "").trim(), text: String(a?.text ?? "").trim() }))
    .filter(a => a.id && a.name);
}

const folderSetting = () => game.settings.get(MODULE_ID, "contentFolder") ?? "";
const filesSetting = () => game.settings.get(MODULE_ID, "contentFiles") ?? [];

/** A drop-in file's path (for an img src), or null when the content folder doesn't have it. */
export const contentArt = rel => artPath(folderSetting(), filesSetting(), rel);

let achievements = [];
/** achievements.json's entries (none until it's fetched, or without one). */
export const contentAchievements = () => achievements;
export const setContentAchievements = list => (achievements = list);

/** Each app's icon on the page: --agent-art-<app> on <html>, and the agent-art-<app> class on <body>. */
function applyArt() {
  for (const [app, rel] of Object.entries(APP_ART)) {
    const src = contentArt(rel);
    if (src) document.documentElement.style.setProperty(`--agent-art-${app}`, `url("${encodeURI(foundry.utils.getRoute(src))}")`);
    else document.documentElement.style.removeProperty(`--agent-art-${app}`);
    document.body.classList.toggle(`agent-art-${app}`, !!src);
  }
}

async function loadAchievements() {
  const src = contentArt(ACHIEVEMENTS_FILE);
  let list = [];
  if (src) {
    try {
      const res = await fetch(encodeURI(foundry.utils.getRoute(src)));
      if (res.ok) list = parseAchievements(await res.text());
    } catch (err) {
      console.warn(`${MODULE_ID} | Couldn't read ${src}`, err);
    }
  }
  setContentAchievements(list);
}

const browse = async dir => {
  try {
    return await FilePicker.browse("data", dir);
  } catch {
    return { dirs: [], files: [] }; // no such folder: nothing in it
  }
};

/** A folder's files and those of the `subs` folders in it (full paths). */
async function browseTree(dir, subs) {
  const here = await browse(dir);
  const dirs = relativeFiles(dir, here.dirs ?? []).map(trimSlashes).filter(d => Object.hasOwn(subs, d));
  const inside = await Promise.all(dirs.map(d => browseTree(`${dir}/${d}`, subs[d])));
  return [...(here.files ?? []), ...inside.flat()];
}

/** GM: what's in the folder (relative paths, sorted). A missing folder is empty. */
export async function scanContent(folder) {
  const dir = trimSlashes(folder);
  if (!dir) return [];
  return relativeFiles(dir, await browseTree(dir, SUBFOLDERS)).sort();
}

let scanned = Promise.resolve();
/** Settles once the latest scan is saved (at once when none was started); the Map's host awaits it (apps/map/host.js). */
export const contentScanned = () => scanned;

/** The active GM saves what's in the folder, only when that changed. */
function rescan() {
  scanned = (async () => {
    if (game.user !== game.users.activeGM) return;
    const files = await scanContent(folderSetting());
    if (JSON.stringify(files) !== JSON.stringify(filesSetting())) await game.settings.set(MODULE_ID, "contentFiles", files);
  })().catch(err => console.warn(`${MODULE_ID} | Couldn't look in the content folder`, err));
  return scanned;
}

let redraw = () => {};

/** init: the settings. `refreshPhones` redraws once the drop-in's achievements arrive. */
export function registerContent(refreshPhones) {
  redraw = refreshPhones;
  game.settings.register(MODULE_ID, "contentFolder", {
    scope: "world",
    config: true,
    name: "Content folder",
    hint: "A folder under Data with art the module doesn't ship: apps/ and cbk/ pictures (.webp), achievements/<id>.webp with blank.webp, achievements.json ([{ id, name, text }]), and map/ (the Map's Night City). Reload after adding files.",
    type: String,
    filePicker: "folder",
    default: CONTENT_DEFAULT,
    onChange: () => {
      applyArt();
      rescan();
    }
  });
  // What the GM found in it (relative paths); see rescan.
  game.settings.register(MODULE_ID, "contentFiles", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: async () => {
      applyArt();
      await loadAchievements();
      redraw();
    }
  });
}

/** ready: show what the folder had last time and fetch the achievements (before the phones draw); the GM looks again. */
export async function contentReady() {
  applyArt();
  await loadAchievements();
  rescan();
}

import { store } from "../../scripts/store.js";
import { esc } from "../../scripts/util/text.js";
import { MAX_PIN_SCENES, MAX_SCENE_LABEL, pinScenes } from "./model.js";

/*
 * Pin Maps (T274): the recommended scenes for the Map's pins (battle maps, alternates, stills), applied in bulk by a
 * GM from the map's menu ("Apply recommended scenes…", page.js). The file is made off the server (docs: map.md →
 * Pin Maps) and served from the world's assets: { version: 1, pins: { pinId: { name, scenes: [{ key, label, sid }] } } }.
 * A key is a compendium scene's uuid ("Compendium.<pack>.Scene.<id>": the world's copy of it, imported into the
 * scene folder "Pin Maps" when the world has none) or "bg:<path>" (the world scene with that background picture).
 * One map-pin set-many writes them all (host.js); pins that already have scenes are kept unless the GM ticks Replace.
 */

/** Where the file is served from. */
export const PIN_MAPS = "assets/pin-maps.json";

/** The scene folder imported scenes go into. */
const FOLDER = "Pin Maps";

/** A compendium scene's uuid: [, pack, id]. */
const COMPENDIUM_SCENE = /^Compendium\.([^.]+\.[^.]+)\.Scene\.([A-Za-z0-9]{16})$/;

/** A path as compared: URL escapes undone ("Dive%20Bar.webp" is "Dive Bar.webp"). */
function decoded(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The world scene a file key stands for, or null (missing). `scenes`: [{ id, name, compendiumSource, sourceId,
 * backgroundSrc }] (worldScenes). A compendium uuid: the scene made from it (v12's `_stats.compendiumSource`, else
 * the older `flags.core.sourceId`); "bg:<path>": the scene with that background. Of several, the first by name.
 */
export function resolveSceneKey(key, scenes) {
  const k = String(key ?? "");
  let found = [];
  if (k.startsWith("Compendium.")) {
    found = scenes.filter(s => s.compendiumSource === k);
    if (!found.length) found = scenes.filter(s => s.sourceId === k);
  } else if (k.startsWith("bg:")) {
    const path = decoded(k.slice(3));
    found = scenes.filter(s => s.backgroundSrc && decoded(s.backgroundSrc) === path);
  }
  return found.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))[0]?.id ?? null;
}

/** The world's scenes as resolveSceneKey reads them. */
export const worldScenes = () => game.scenes.map(s => ({
  id: s.id, name: s.name, compendiumSource: s._stats?.compendiumSource ?? null,
  sourceId: s.flags?.core?.sourceId ?? null, backgroundSrc: s.background?.src ?? null
}));

/**
 * What applying the file does to the Map's pins (`rows`): { changes: { [pinId]: { scenes } } (for map-pin
 * set-many), report: { pins, links (applied), missing (links), missingKeys (each once), skipped (pins already
 * linked), notHere (pins in the file not on this Map) } }. `replace`: pins that already have scenes get the file's;
 * `resolve(key)`: a key's world scene id, or null (async: it may import one). Unresolved links are dropped (a pin
 * left with none isn't written), at most 12 a pin, labels from the file.
 */
export async function planPinMaps(file, rows, { replace = false, resolve }) {
  const changes = {};
  const report = { pins: 0, links: 0, missing: 0, missingKeys: [], skipped: 0, notHere: 0 };
  for (const [pinId, pin] of Object.entries(file?.pins ?? {})) {
    if (!rows[pinId]) {
      report.notHere++;
      continue;
    }
    if (!replace && pinScenes(rows[pinId]).length) {
      report.skipped++;
      continue;
    }
    const scenes = [];
    for (const link of pin?.scenes ?? []) {
      const sceneId = await resolve(link?.key);
      if (!sceneId) {
        report.missing++;
        if (!report.missingKeys.includes(link?.key)) report.missingKeys.push(link?.key);
      } else if (scenes.length < MAX_PIN_SCENES && !scenes.some(s => s.sceneId === sceneId)) {
        scenes.push({ sceneId, label: String(link.label ?? "").trim().slice(0, MAX_SCENE_LABEL) });
      }
    }
    if (!scenes.length) continue;
    changes[pinId] = { scenes };
    report.pins++;
    report.links += scenes.length;
  }
  return { changes, report };
}

/**
 * GM: the map menu's "Apply recommended scenes…": the file's counts and a Replace tick first, then the keys resolved
 * (compendium scenes the world lacks imported, once each), one map-pin set-many, and a report.
 */
export async function applyPinMaps() {
  if (!game.user.isGM) return;
  const file = await fetch(foundry.utils.getRoute(PIN_MAPS)).then(res => (res.ok ? res.json() : null)).catch(() => null);
  if (!file?.pins) return ui.notifications.warn(`No recommended scenes: ${PIN_MAPS} wasn't found.`);
  const rows = store.apps.mapPins ?? {};
  const ids = Object.keys(file.pins);
  const here = ids.filter(id => rows[id]);
  const linked = here.filter(id => pinScenes(rows[id]).length).length;
  const replace = await new Promise(done => new Dialog({
    title: "Apply recommended scenes",
    content: `<p>Link the recommended scenes from <code>${esc(PIN_MAPS)}</code> to the Map's pins? Scenes from a
      compendium that this world doesn't have are imported into the scene folder "${FOLDER}".</p>
      <ul>
        <li><b>${ids.length}</b> pins in the file</li>
        <li><b>${here.length}</b> of them on this Map</li>
        <li><b>${linked}</b> of those already have scenes</li>
      </ul>
      <p><label><input type="checkbox" name="replace"> Replace scenes on pins that already have some</label></p>`,
    buttons: {
      apply: { icon: '<i class="fas fa-check"></i>', label: "Apply", callback: html => done(!!html[0].querySelector("input[name=replace]")?.checked) },
      cancel: { icon: '<i class="fas fa-xmark"></i>', label: "Cancel", callback: () => done(null) }
    },
    default: "apply",
    close: () => done(null)
  }).render(true));
  if (replace == null) return;

  ui.notifications.info("Applying the recommended scenes…");
  const scenes = worldScenes();
  const found = new Map();
  let folder = null;
  let imported = 0;
  // A compendium scene the world doesn't have: imported once, into the folder.
  const importScene = async key => {
    const [, packId, id] = COMPENDIUM_SCENE.exec(key ?? "") ?? [];
    const pack = packId ? game.packs.get(packId) : null;
    if (pack?.documentName !== "Scene") return null;
    try {
      folder ??= game.folders.find(f => f.type === "Scene" && f.name === FOLDER) ?? (await Folder.create({ name: FOLDER, type: "Scene" }));
      const doc = await game.scenes.importFromCompendium(pack, id, { folder: folder.id }, { keepId: false });
      if (doc) imported++;
      return doc?.id ?? null;
    } catch (err) {
      console.warn(`cpr-sam-agent | Map: couldn't import ${key}`, err);
      return null;
    }
  };
  const resolve = async key => {
    if (!found.has(key)) found.set(key, resolveSceneKey(key, scenes) ?? (await importScene(key)));
    return found.get(key);
  };
  const { changes, report } = await planPinMaps(file, rows, { replace, resolve });
  if (Object.keys(changes).length) store.request("map-pin", { op: "set-many", changes });

  const keys = report.missingKeys.slice(0, 20).map(k => `<li><code>${esc(k)}</code></li>`).join("");
  const more = report.missingKeys.length > 20 ? `<li>…and ${report.missingKeys.length - 20} more</li>` : "";
  Dialog.prompt({
    title: "Recommended scenes applied",
    content: `<ul>
        <li><b>${report.pins}</b> pins given <b>${report.links}</b> scenes</li>
        <li><b>${imported}</b> scenes imported from compendiums</li>
        <li><b>${report.missing}</b> links missing (no such scene here)</li>
        <li><b>${report.skipped}</b> pins skipped (already linked)</li>
        <li><b>${report.notHere}</b> pins in the file not on this Map</li>
      </ul>
      ${keys ? `<p>Missing:</p><ul>${keys}${more}</ul>` : ""}`,
    label: "OK",
    callback: () => {},
    rejectClose: false
  });
}

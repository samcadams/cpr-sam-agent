import { cabbConfig, isPartyPin, kmPerPx, pinHidden, pinName, pinVisibleTo } from "../cabb/model.js";
import { route, travelTimes } from "./route.js";
import { MODULE_ID } from "../../scripts/config.js";
import { deepZoom } from "../../scripts/util/deepZoom.js";
import { store } from "../../scripts/store.js";

/*
 * Map: Night City on the phone. It draws its own data (the bottom of this file): its picture (from its Deep
 * Zoom pyramid, see util/deepZoom.js) and its pins, seeded once from the NAV scene by the GM's Import from NAV.
 * The NAV scene's helpers above stay for that import and for Combat Cabb.
 *
 * The NAV scene: Combat Cabb's NAV scene (GM Phone → Combat Cabb) if the GM picked one, or the scene named NAV.
 *
 * Pins imported from Roll20 carry what they are in flags.world.r20import ({ type, typeLabel, district,
 * subLocation, bgColor, iconText }); others are "Pin".
 */

/** The scene the Map shows, or null. */
export function mapScene(cfg = cabbConfig()) {
  const chosen = cfg.sceneId && cfg.sceneId !== "none" ? game.scenes.get(cfg.sceneId) : null;
  return chosen ?? game.scenes.find(s => /^nav\b|\bnav$/i.test(s.name.trim())) ?? null;
}

/** Pin Cushion's GM-only pins, and who sees a pin: the same rule as Combat Cabb's (apps/cabb/model.js). */
export { pinHidden, pinVisibleTo as pinSeenBy };

/** Whether no player sees a pin (the GM's map marks these). */
export const pinGmOnly = note => pinHidden(note) || !game.users.some(u => !u.isGM && pinVisibleTo(note, u));

/** "#b4006a" or the like, or null. */
const colour = c => (/^#[0-9a-f]{3,8}$/i.test(String(c ?? "").trim()) ? String(c).trim() : null);

/** Territories (gang turf and the like): drawn as their picture at map scale, not as a dot. */
export const TERRITORY = "territories";

/** A territory's size on the Map (scene px) when the GM hasn't set one: twice its size on the NAV scene. */
export const TERRITORY_SCALE = 2;

/**
 * The Map's own look for a pin, kept on the note (flags.cpr-sam-agent.map; the NAV scene ignores it):
 * { size (scene px, territories), alpha (0.1–1, territories) }. And temporary pins (flags.cpr-sam-agent.temp),
 * dropped by the GM on the Map, cleared together.
 */
export const mapLook = note => note.flags?.[MODULE_ID]?.map ?? {};
export const isTempPin = note => !!note.flags?.[MODULE_ID]?.temp;

/**
 * A pin as the map draws it: { id, name, x, y (scene px), type, typeLabel, district, place, icon, color, text,
 * big (a district: a large label, no dot for players), territory (drawn as its picture, `size` scene px wide,
 * `alpha`), label (its name always shows), gmOnly, temp, linked (it has a page or entry), scene (GM: the name of
 * the scene linked to it) }. `type` is UNCATEGORISED for a pin without one.
 */
export function mapPin(note) {
  const r20 = note.flags?.world?.r20import ?? {};
  const type = String(r20.type || "").trim() || UNCATEGORISED;
  const territory = type === TERRITORY;
  const look = territory ? mapLook(note) : {};
  return {
    id: note.id,
    name: pinName(note),
    x: note.x,
    y: note.y,
    type,
    typeLabel: r20.typeLabel || null,
    district: r20.district || null,
    place: r20.subLocation || null,
    icon: note.texture?.src || null,
    color: colour(note.texture?.tint) ?? colour(r20.bgColor) ?? null,
    text: String(r20.iconText ?? "").slice(0, 3),
    big: type === "district",
    territory,
    size: territory ? clampSize(look.size ?? (note.iconSize || 50) * TERRITORY_SCALE) : null,
    alpha: territory ? clampAlpha(look.alpha ?? 1) : null,
    // GM: the scene linked to it (activating that scene puts the crew here)
    scene: game.user.isGM ? (game.scenes.get(cabbConfig().links[note.id])?.name ?? null) : null,
    label: type === "district" || note.flags?.["pin-cushion"]?.textAlwaysVisible === true,
    gmOnly: game.user.isGM ? pinGmOnly(note) : false,
    temp: isTempPin(note),
    linked: !!(note.page ?? note.entry)
  };
}

/** A territory's size on the Map (scene px) and its opacity, in range. */
export const clampSize = n => Math.round(Math.min(4000, Math.max(20, Number(n) || 100)));
export const clampAlpha = n => Math.round(Math.min(1, Math.max(0.1, Number.isFinite(Number(n)) ? Number(n) : 1)) * 100) / 100;

/** The pins this user sees on a scene, districts last (drawn on top), by name. */
export function mapPins(scene, user = game.user) {
  return [...scene.notes]
    .filter(n => !isPartyPin(n) && pinVisibleTo(n, user))
    .map(mapPin)
    .sort((a, b) => a.big - b.big || a.name.localeCompare(b.name));
}

/** The scene's picture and where it sits, in scene px: { src, x, y, w, h }, or null. */
export function mapPicture(scene) {
  const src = scene.background?.src;
  if (!src) return null;
  const r = scene.dimensions.sceneRect;
  return { src, x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Where the map starts: the box around the pins (padded), inside the scene; the whole scene without pins.
 * `bounds`: the scene, { x, y, w, h }.
 */
export function pinsBox(pins, bounds) {
  if (!pins.length) return bounds;
  const xs = pins.map(p => p.x);
  const ys = pins.map(p => p.y);
  let x0 = Math.min(...xs);
  let y0 = Math.min(...ys);
  let x1 = Math.max(...xs);
  let y1 = Math.max(...ys);
  const pad = Math.max(x1 - x0, y1 - y0, 400) * 0.06;
  x0 = Math.max(bounds.x, x0 - pad);
  y0 = Math.max(bounds.y, y0 - pad);
  x1 = Math.min(bounds.x + bounds.w, x1 + pad);
  y1 = Math.min(bounds.y + bounds.h, y1 + pad);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/* -------------------------------------------- */
/*  Categories (CPR Pin Filter's)               */
/* -------------------------------------------- */

/** A pin with no category (CPR Pin Filter's id for it). */
export const UNCATEGORISED = "__none";

const PIN_FILTER = "cpr-pin-filter";

/**
 * The pin categories and their groups, as CPR Pin Filter has them: the GM's lists when that module is on (its
 * settings), else none (categories then come from the pins). { categories: [{ id, label }], groups:
 * [{ id, label, categories: [id] }] }
 */
export function pinFilterLists() {
  const has = key => game.settings.settings.has(`${PIN_FILTER}.${key}`);
  return {
    categories: has("categories") ? game.settings.get(PIN_FILTER, "categories") ?? [] : [],
    groups: has("groups") ? game.settings.get(PIN_FILTER, "groups") ?? [] : []
  };
}

/**
 * Every category the pins can be filtered by (Pin Filter's rule): the GM's list, plus any type found on the
 * pins that isn't in it, so no pin is left unfilterable. Map id → label.
 */
export function mapCategories(pins, lists = pinFilterLists()) {
  const categories = new Map(lists.categories.map(c => [c.id, c.label]));
  for (const p of pins) {
    if (categories.has(p.type)) continue;
    categories.set(p.type, p.type === UNCATEGORISED ? "Uncategorised" : p.typeLabel || p.type);
  }
  return categories;
}

/* -------------------------------------------- */
/*  Routes (apps/map/route.js)                     */
/* -------------------------------------------- */

const KM_PER_MILE = 1.609344;

/** Miles per scene px (the scene's grid: its size, distance and units). */
export const milesPerPx = scene => kmPerPx(scene) / KM_PER_MILE;

/**
 * A route on the scene's roads between two scene points: { points: [x0, y0, …] (scene px, the drive),
 * miles (the drive), minutes: { drive, walk } }, or null without a way. `net`: the road network traced on
 * the scene's picture (apps/map/sidecars.js mapGraph), in the picture's px.
 */
export function sceneRoute(scene, net, from, to) {
  const pic = mapPicture(scene);
  return pic ? routeOn(pic, net, from, to, milesPerPx(scene)) : null;
}

/**
 * The same in any frame where the picture sits at `pic` ({ x, y, w, h }), `miles` miles per px of that frame.
 * `net` is in its own px (net.width × net.height over the picture).
 */
function routeOn(pic, net, from, to, miles) {
  if (!net) return null;
  const kx = net.width / pic.w;
  const ky = net.height / pic.h;
  const toNet = p => ({ x: (p.x - pic.x) * kx, y: (p.y - pic.y) * ky });
  const drive = route(net, toNet(from), toNet(to));
  if (!drive) return null;
  const walk = route(net, toNet(from), toNet(to), "walk");
  // The network's px → the frame's (the picture fills `pic`).
  const points = drive.points.map((n, i) => (i % 2 ? n / ky + pic.y : n / kx + pic.x));
  const perPx = miles / kx; // miles per network px
  return {
    points,
    miles: Math.round(drive.length * perPx * 10) / 10,
    minutes: travelTimes(drive, walk, perPx)
  };
}

/**
 * Combat Cabb's trip by road between two of its places ({ x, y } in km on the NAV scene, apps/cabb/model.js):
 * { miles, points: [x0, y0, …] (km, the line to draw on Cabb's map) }, or null (no roads, no way through).
 */
export function cabbRoad(scene, net, from, to) {
  const k = kmPerPx(scene);
  const found = sceneRoute(scene, net, { x: from.x / k, y: from.y / k }, { x: to.x / k, y: to.y / k });
  return found ? { miles: found.miles, points: found.points.map(n => n * k) } : null;
}

/* -------------------------------------------- */
/*  The Map's own data, seeded from NAV  */
/* -------------------------------------------- */

/*
 * The Map's map lives in the setting mapConfig and its pins in the table mapPins, everything in the picture's px
 * (the frame the traced districts and roads use). The first part turns the NAV scene into that data, once (the
 * GM's Import from NAV); the rest reads it for drawing.
 */

/** A scene point in the picture's px. `pic`: mapPicture(scene); `size`: the picture's { width, height }. */
export const toPicturePx = (p, pic, size) => ({
  x: Math.round((p.x - pic.x) * size.width / pic.w),
  y: Math.round((p.y - pic.y) * size.height / pic.h)
});

/**
 * A NAV note as a mapPins row, or null (temporary pins are cleared at import; the party pin becomes the crew).
 * `players`: [{ user, actorIds }] every player and the characters they own. A pin every player sees is
 * everyone's; one only some see lists those players' characters; a GM-only pin lists none.
 * `links`, `zones`: Combat Cabb's { noteId: sceneId } and { noteId: zone }, moved onto the pin (the link as its one
 * linked scene).
 */
export function pinFromNote(note, { pic, size, players = [], links = {}, zones = {} }) {
  if (isTempPin(note) || isPartyPin(note)) return null;
  const p = mapPin(note);
  const hidden = pinHidden(note);
  const seen = hidden ? [] : players.filter(pl => pinVisibleTo(note, pl.user));
  const everyone = !hidden && seen.length === players.length;
  return {
    id: note.id,
    name: p.name,
    ...toPicturePx(note, pic, size),
    type: p.type,
    typeLabel: p.typeLabel,
    district: p.district,
    place: p.place,
    color: p.color,
    icon: p.icon,
    text: p.text,
    label: p.label,
    everyone,
    actorIds: everyone ? [] : [...new Set(seen.flatMap(pl => pl.actorIds))],
    page: (note.page ?? note.entry)?.uuid ?? null,
    size: p.territory ? Math.round(p.size * size.width / pic.w) : null,
    alpha: p.alpha,
    scenes: links[note.id] ? [{ sceneId: links[note.id], label: "" }] : [],
    zone: zones[note.id] ?? null
  };
}

/**
 * The mapConfig setting from a scene the Map shows today, or null (no picture). `size`: the picture's
 * { width, height }. The traced files are the ones the Map finds beside the picture now (sidecars.js), named
 * from here on. Categories and groups: CPR Pin Filter's when it's on (else none: they come from the pins).
 */
export function configFromScene(scene, size, lists = pinFilterLists()) {
  const pic = mapPicture(scene);
  if (!pic || !(size?.width > 0 && size?.height > 0)) return null;
  const beside = suffix => pic.src.replace(/(\.[^./?#]+)?([?#].*)?$/, suffix);
  return {
    picture: { src: pic.src, width: size.width, height: size.height },
    milesPerPx: milesPerPx(scene) * pic.w / size.width,
    areas: beside(".districts.json"),
    roads: beside(".graph.json"),
    overlay: beside(".roads.dzi"),
    categories: lists.categories,
    groups: lists.groups
  };
}

/** The Map's own map (setting mapConfig); `seeded` once the GM has imported it from NAV. */
export const mapConfig = () => game.settings.get(MODULE_ID, "mapConfig") ?? {};

/** Every player and the characters they own: whom a seeded pin can list (the table's `listed` owner). */
export const navPlayers = () =>
  game.users.filter(u => !u.isGM).map(user => ({
    user,
    actorIds: game.actors.filter(a => a.type === "character" && a.testUserPermission(user, "OWNER")).map(a => a.id)
  }));

/**
 * Import from NAV: the Map's config and pins from a scene as the Map shows it now, and what the GM is told first:
 * { config (with `seeded`), rows: { [id]: row }, report: { pins, gmOnly, some (for some characters), temp, party,
 * outside (names of pins off the picture), players: [{ name, sees, noCharacter }] } }, or null (no picture).
 */
export function seedFromNav(scene, size, { players = navPlayers(), cabb = cabbConfig(), lists } = {}) {
  const config = configFromScene(scene, size, lists);
  if (!config) return null;
  const opts = { pic: mapPicture(scene), size, players, links: cabb.links ?? {}, zones: cabb.zones ?? {} };
  const notes = [...scene.notes];
  const rows = {};
  for (const note of notes) {
    const row = pinFromNote(note, opts);
    if (row) rows[row.id] = row;
  }
  const list = Object.values(rows);
  const report = {
    pins: list.length,
    gmOnly: list.filter(r => !r.everyone && !r.actorIds.length).length,
    some: list.filter(r => !r.everyone && r.actorIds.length).length,
    temp: notes.filter(isTempPin).length,
    party: notes.filter(isPartyPin).length,
    outside: list.filter(r => r.x < 0 || r.y < 0 || r.x > size.width || r.y > size.height).map(r => r.name),
    players: players.map(({ user, actorIds }) => ({
      name: user.name,
      sees: list.filter(r => r.everyone || r.actorIds.some(id => actorIds.includes(id))).length,
      noCharacter: !actorIds.length
    }))
  };
  return { config: { ...config, seeded: { from: scene.id, at: Date.now(), pins: list.length } }, rows, report };
}

/**
 * The same, for the picture's real size (its Deep Zoom pyramid; else the scene's rectangle). Without groups in CPR
 * Pin Filter's settings (it's off, or never set), its built-in categories and groups, from its own file (none
 * without it).
 */
export async function seedNav(scene) {
  const pic = mapPicture(scene);
  if (!pic) return null;
  const dz = await deepZoom(pic.src);
  const size = dz ? { width: dz.width, height: dz.height } : { width: pic.w, height: pic.h };
  let lists = pinFilterLists();
  if (!lists.groups.length) {
    try {
      const m = await import(foundry.utils.getRoute(`modules/${PIN_FILTER}/scripts/constants.js`));
      lists = { categories: lists.categories.length ? lists.categories : m.DEFAULT_CATEGORIES ?? [], groups: m.DEFAULT_GROUPS ?? [] };
    } catch {
      // (no CPR Pin Filter: the categories come from the pins)
    }
  }
  return seedFromNav(scene, size, { lists });
}

/** Whether the Map has its own map to draw (the GM has imported it). */
export const mapReady = (cfg = mapConfig()) => !!cfg.seeded && cfg.picture?.width > 0;

/** The Map's picture as NavMap draws it, { src, x, y, w, h } in its own px (also what can be looked at), or null. */
export function ownPicture(cfg) {
  const p = cfg?.picture;
  return p?.src && p.width > 0 && p.height > 0 ? { src: p.src, x: 0, y: 0, w: p.width, h: p.height } : null;
}

/**
 * A mapPins row as the map draws it (the shape mapPin gives, in picture px). `gm`: the GM's view (GM-only pins
 * marked, and how many scenes are linked to it: `scenes`, with `scene` true when there's one, which NavMap marks).
 */
export function pinFromRow(row, { gm = false } = {}) {
  const type = String(row.type || "").trim() || UNCATEGORISED;
  const territory = type === TERRITORY;
  const scenes = gm ? pinScenes(row).length : 0;
  return {
    id: row.id,
    name: row.name || "Pin",
    x: row.x,
    y: row.y,
    type,
    typeLabel: row.typeLabel || null,
    district: row.district || null,
    place: row.place || null,
    icon: row.icon || null,
    color: colour(row.color),
    text: String(row.text ?? "").slice(0, 3),
    big: type === "district",
    territory,
    size: territory ? clampSize(row.size) : null,
    alpha: territory ? clampAlpha(row.alpha ?? 1) : null,
    scene: scenes > 0,
    scenes,
    label: !!row.label,
    gmOnly: gm ? !row.everyone && !row.actorIds?.length : false,
    temp: !!row.temp,
    linked: !!row.page
  };
}

/** The Map's pins this client has (the host sent each player only theirs): { [id]: row }. */
export const mapRows = () => store.apps.mapPins ?? {};

/**
 * The scenes linked to a row (GM only: the table's secret): [{ sceneId, label }] in the GM's order. Activating one
 * puts the crew at the pin (host.js); `label` "" shows the scene's name.
 */
export const pinScenes = row => (Array.isArray(row?.scenes) ? row.scenes : []);

/** The most scenes a pin links to, and the longest label. */
export const MAX_PIN_SCENES = 12;
export const MAX_SCENE_LABEL = 60;

/**
 * The pins this user has, districts last (drawn on top), by name. The GM's say how many scenes are linked to
 * them (`row.scenes`).
 */
export function ownPins(rows = mapRows(), user = game.user) {
  return Object.values(rows ?? {})
    .map(row => pinFromRow(row, { gm: user.isGM }))
    .sort((a, b) => a.big - b.big || a.name.localeCompare(b.name));
}

/** Whether a user sees a Map pin: a GM, everyone's, or one listing a character they own (the table's `listed`). */
export const rowSeenBy = (row, user) =>
  !!user?.isGM || !!row?.everyone || (row?.actorIds ?? []).some(id => game.actors.get(id)?.testUserPermission(user, "OWNER"));

/** Whether some player sees a Map pin (what the GM's lists of the players' places show). */
export const rowShared = row => !!row?.everyone || !!row?.actorIds?.length;

/** km per Map px (Combat Cabb measures in km). */
export const mapKmPerPx = (cfg = mapConfig()) => (Number(cfg.milesPerPx) || 0) * KM_PER_MILE;

/** A route on the Map's roads between two of its points (as sceneRoute, all in picture px), or null. */
export function ownRoute(cfg, net, from, to) {
  const pic = ownPicture(cfg);
  return pic ? routeOn(pic, net, from, to, cfg.milesPerPx) : null;
}

/**
 * Combat Cabb's trip by road on the Map between two of its places ({ x, y } in km, apps/cabb/model.js): { miles,
 * points: [x0, y0, …] (km) }, or null (no roads, no way through). As cabbRoad, on the Map's own picture.
 */
export function ownCabbRoad(cfg, net, from, to) {
  const k = mapKmPerPx(cfg);
  if (!k) return null;
  const found = ownRoute(cfg, net, { x: from.x / k, y: from.y / k }, { x: to.x / k, y: to.y / k });
  return found ? { miles: found.miles, points: found.points.map(n => n * k) } : null;
}

/** The Map's pin categories and groups (seeded from CPR Pin Filter's), as pinFilterLists gives them. */
export const ownLists = cfg => ({ categories: cfg?.categories ?? [], groups: cfg?.groups ?? [] });

/** A journal entry's or one of its pages' uuid: what a row's `page` may be. */
const JOURNAL_UUID = /^JournalEntry\.[A-Za-z0-9]{16}(\.JournalEntryPage\.[A-Za-z0-9]{16})?$/;

/**
 * A GM's change to a mapPins row (host.js map-pin), cleaned: only the keys the Map edits, each checked; a bad
 * value drops its key. Never id or ts (the host's). `zone`: Combat Cabb's ("combat", "hot" or null); `scenes`: the
 * scenes linked to it, the whole list (cleanScenes; null clears it).
 */
export function cleanPinChange(change) {
  const out = {};
  const str = (v, max) => typeof v === "string" && v.length <= max;
  const strOrNull = (v, max) => v === null || str(v, max);
  const keep = (key, ok, value = change[key]) => {
    if (Object.hasOwn(change, key) && ok) out[key] = value;
  };
  if (!change || typeof change !== "object") return out;
  const name = typeof change.name === "string" ? change.name.trim() : "";
  keep("name", name.length >= 1 && name.length <= 120, name);
  for (const key of ["x", "y"]) keep(key, Number.isFinite(change[key]), Math.round(change[key]));
  keep("type", str(change.type, 40), change.type === "" ? UNCATEGORISED : change.type);
  keep("typeLabel", str(change.typeLabel, 80));
  for (const key of ["district", "place"]) keep(key, strOrNull(change[key], 80));
  keep("color", change.color === null || /^#[0-9a-f]{6}$/i.test(change.color ?? ""));
  keep("icon", strOrNull(change.icon, 300));
  keep("text", str(change.text, 3));
  for (const key of ["label", "everyone", "temp"]) keep(key, typeof change[key] === "boolean");
  const ids = change.actorIds;
  keep("actorIds", Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === "string"), Array.isArray(ids) ? [...new Set(ids)] : null);
  keep("page", change.page === null || JOURNAL_UUID.test(change.page ?? ""));
  keep("size", true, change.size === null ? null : clampSize(change.size));
  keep("alpha", true, change.alpha === null ? null : clampAlpha(change.alpha));
  keep("zone", change.zone === null || change.zone === "combat" || change.zone === "hot");
  const scenes = change.scenes === null ? [] : cleanScenes(change.scenes);
  keep("scenes", !!scenes, scenes);
  return out;
}

/**
 * A pin's linked scenes as sent, cleaned: [{ sceneId (16 letters and digits), label (trimmed, ≤ 60; "" shows the
 * scene's name) }], a scene once (its first), at most 12; null when it isn't such a list (or any entry is bad).
 */
export function cleanScenes(list) {
  if (!Array.isArray(list) || list.length > MAX_PIN_SCENES) return null;
  const out = [];
  for (const s of list) {
    const label = typeof s?.label === "string" ? s.label.trim() : s?.label == null ? "" : null;
    if (typeof s?.sceneId !== "string" || !/^[A-Za-z0-9]{16}$/.test(s.sceneId) || label === null || label.length > MAX_SCENE_LABEL) return null;
    if (!out.some(o => o.sceneId === s.sceneId)) out.push({ sceneId: s.sceneId, label });
  }
  return out;
}

/* -------------------------------------------- */
/*  Journals for the default pins        */
/* -------------------------------------------- */

/**
 * A name as journals are matched by: no accents, numbering ("#16 ", "J. "), leading "the", punctuation or case.
 * `bare`: without a "(...)" at the end either ("Aldecaldo Camp (E)").
 */
export function journalName(name, bare = false) {
  let s = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'");
  s = s.replace(/^\s*#\d+\s*/, "").replace(/^\s*[A-Z]\.\s+/, "");
  if (bare) s = s.replace(/\s*\([^)]*\)\s*$/, "");
  return s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** How alike two matched names are: the share of their words they have in common (0 to 1). */
function alike(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return (2 * both) / (A.size + B.size);
}

/** The folder name for pins without a district. */
export const NO_DISTRICT = "No District";

/** The pins that need a journal (not temporary, not linked yet) by district: [{ district, pins }], both by name. */
export function pinsByDistrict(pins) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const groups = new Map();
  for (const pin of pins.filter(p => !p.temp && !p.page)) {
    const district = pin.district || NO_DISTRICT;
    groups.set(district, [...(groups.get(district) ?? []), pin]);
  }
  return [...groups].map(([district, list]) => ({ district, pins: list.sort(byName) })).sort((a, b) => a.district.localeCompare(b.district));
}

/** Names at least this alike count as a match when no page has the pin's name. */
export const JOURNAL_ALIKE = 0.8;

/**
 * Each pin's journal, by name: { [pinId]: uuid }. `docs`: the world's journals, [{ uuid, name, kind: "entry" |
 * "page", entry (a page's entry's name) }]. A district: its entry's "District Overview" page, else the entry. Any
 * other pin: the page with its name (then without a "(...)" at the end, then the most alike name); of several, the
 * one in the pin's district's entry, a territory's in a "Territory…" entry, or the first when they're all one name
 * in one entry; still several: none. On a world with 789 GM-made links it finds 729, 2 wrong; the rest are lettered
 * sub-locations linked to their complex's page.
 */
export function matchJournals(pins, docs) {
  const pages = docs.filter(d => d.kind === "page").map(d => ({ ...d, key: journalName(d.name), entryKey: journalName(d.entry) }));
  const entries = docs.filter(d => d.kind === "entry");
  const named = new Map();
  for (const p of pages) named.set(p.key, [...(named.get(p.key) ?? []), p]);
  const pick = (found, pin) => {
    if (found.length === 1) return found[0];
    const district = journalName(pin.district);
    const here = district ? found.filter(p => p.entryKey === district) : [];
    if (here.length === 1) return here[0];
    if (pin.type === TERRITORY) {
      const turf = found.filter(p => p.entryKey.includes("territor"));
      if (turf.length === 1) return turf[0];
      if (turf.length) found = turf;
    }
    return new Set(found.map(p => `${p.entryKey}|${p.key}`)).size === 1 ? found[0] : null;
  };
  const out = {};
  for (const pin of pins) {
    let doc = null;
    if (pin.type === "district") {
      const name = journalName(pin.name);
      const overview = pages.filter(p => p.entryKey === name && p.key === "district overview");
      const entry = entries.filter(e => journalName(e.name) === name);
      doc = overview.length === 1 ? overview[0] : entry.length === 1 ? entry[0] : null;
    } else {
      for (const bare of [false, true]) {
        const found = named.get(journalName(pin.name, bare));
        doc = found ? pick(found, pin) : null;
        if (doc) break;
      }
      if (!doc) {
        const name = journalName(pin.name, true);
        let best = [];
        let score = 0;
        for (const p of pages) {
          const s = alike(name, p.key);
          if (s > score) [score, best] = [s, [p]];
          else if (s === score && s > 0) best.push(p);
        }
        doc = score >= JOURNAL_ALIKE ? pick(best, pin) : null;
      }
    }
    if (doc) out[pin.id] = doc.uuid;
  }
  return out;
}

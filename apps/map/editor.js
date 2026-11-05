import { MODULE_ID } from "../../scripts/config.js";
import { store } from "../../scripts/store.js";
import { UNCATEGORISED } from "./model.js";

/*
 * The GM's edits to the Map's own pins (the table mapPins): each one is a map-pin request the host checks
 * and writes (apps/map/host.js), so the NAV scene is never touched. Runs on a GM's client; the journals are
 * still updated here directly (a GM may change their permissions).
 *
 * - Move a pin (its district follows when it moves into another one).
 * - A territory's size and opacity on the Map.
 * - Name, category (its icon follows when it has a category icon), district, colour, icon, the name always shown.
 * - Who sees it: the pin (everyone, the GM only, or some characters) and its journal page (all players: hidden,
 *   Limited, Observer). Players read a page only when its entry is at least Limited too, so sharing a page lifts
 *   its entry to Limited (not Observer: the entry's other pages that inherit would open with it). Folders have no
 *   permissions in Foundry v12: a folder shows once something in it does.
 * - Drop a new pin, or a temporary one (players see it at once; cleared together).
 */

/**
 * The pictures of the pin categories: the module's images/map/icons/<category>.svg, or where the Roll20
 * import put them (r20import/icons/), which pins imported from a NAV scene still use.
 */
const CATEGORY_ICON = /^(?:r20import\/icons|modules\/cpr-sam-agent\/images\/map\/icons)\/([a-z]+)\.svg$/i;
export const categoryIcon = type => `modules/${MODULE_ID}/images/map/icons/${type}.svg`;
export const isCategoryIcon = src => CATEGORY_ICON.test(src ?? "");

/** Foundry's ownership levels (read when needed: the module loads before CONST in Node tests). */
const levels = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

/** The pin's row (the table mapPins), or null. */
const rowOf = id => store.apps.mapPins?.[id] ?? null;

/** A map-pin request to the host (GMs only). */
const send = (op, data = {}) => game.user.isGM && store.request("map-pin", { op, ...data });

/** GM: change a pin's row ({ field: value }, as the host's cleanPinChange takes it). */
const setRow = (id, change) => rowOf(id) && send("set", { id, change });

/** GM: move a pin; its district follows (`district`: the one where it lands, when the map knows). */
export async function movePin(id, { x, y }, district = null) {
  const row = rowOf(id);
  if (!row) return;
  const change = { x: Math.round(x), y: Math.round(y) };
  if (district && row.type !== "district" && row.district !== district) change.district = district;
  setRow(id, change);
}

/** GM: a territory's look on the Map: { size?, alpha? }. */
export async function setLook(id, { size, alpha }) {
  const change = {};
  if (size != null) change.size = size;
  if (alpha != null) change.alpha = alpha;
  setRow(id, change);
}

/**
 * GM: one of a pin's fields: name, type (category: its label and, with a category icon, the icon), district,
 * color, icon, named (its name always shows).
 */
export async function setField(id, field, value, { categories } = {}) {
  const row = rowOf(id);
  if (!row) return;
  const v = typeof value === "string" ? value.trim() : value;
  const change = {};
  switch (field) {
    case "name":
      change.name = String(v).slice(0, 120);
      break;
    case "type": {
      const type = v || UNCATEGORISED;
      change.type = type;
      change.typeLabel = String(categories?.get(type) ?? type).slice(0, 80);
      if (isCategoryIcon(row.icon) && type !== UNCATEGORISED) change.icon = categoryIcon(type);
      break;
    }
    case "district":
      change.district = v || null;
      break;
    case "color":
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      change.color = v;
      break;
    case "icon":
      if (v) change.icon = v;
      break;
    case "named":
      change.label = !!v;
      break;
    default:
      return;
  }
  setRow(id, change);
}

/** GM: who sees the pin: everyone, or the characters listed (neither: the GM only). */
export async function setPinSeen(id, { everyone, actorIds = [] }) {
  setRow(id, { everyone: !!everyone, actorIds: everyone ? [] : actorIds });
}

/** GM: a pin's Combat Cabb zone ("combat", "hot", or null: none). */
export async function setZone(id, zone) {
  setRow(id, { zone: zone || null });
}

/** GM: the scene linked to a pin (activating it puts the crew here), or none. */
export async function setLink(id, sceneId) {
  setRow(id, { sceneId: sceneId || null });
}

/**
 * The pin's journal page (or entry) that sharing works on, from its row's `page`: { doc, page, entry }, or
 * null.
 */
export function sharedDoc(row) {
  let doc = null;
  try {
    doc = row?.page ? fromUuidSync(row.page) : null;
  } catch {
    // (a uuid that's gone bad: no journal)
  }
  if (!doc) return null;
  if (doc.documentName === "JournalEntryPage") return { doc, page: doc, entry: doc.parent };
  return { doc, page: null, entry: doc };
}

/** What all players may do with a document: its default level (a page that inherits: its entry's). */
export function playersLevel(doc) {
  const { NONE, INHERIT } = levels();
  const own = doc?.ownership?.default ?? NONE;
  if (own !== INHERIT) return own;
  return doc.parent?.ownership?.default ?? NONE;
}

/**
 * GM: the pin's journal for all players: "none" (hidden), "limited" (its title), "observer" (readable). A page
 * shared lifts its entry to at least Limited (never lowers it); hiding a page leaves its entry alone.
 */
export async function setJournalShared(id, level) {
  const shared = sharedDoc(rowOf(id));
  if (!shared || !game.user.isGM) return;
  const { NONE, LIMITED, OBSERVER } = levels();
  const to = { none: NONE, limited: LIMITED, observer: OBSERVER }[level];
  if (to == null) return;
  await shared.doc.update({ "ownership.default": to });
  if (shared.page && to >= LIMITED && (shared.entry.ownership?.default ?? NONE) < LIMITED) {
    await shared.entry.update({ "ownership.default": LIMITED });
  }
}

/** GM: link the pin to a journal entry (and one of its pages), or to nothing: its row's `page` uuid. */
export async function setJournal(id, entryId, pageId = null) {
  const entry = entryId ? game.journal.get(entryId) : null;
  const page = entry && pageId ? entry.pages.get(pageId) : null;
  setRow(id, { page: (page ?? entry)?.uuid ?? null });
}

/**
 * GM: drop a pin on the Map at { x, y }: `temp` (players see it at once; cleared with the others) or a new
 * pin (only the GM sees it until shared). Its district: where it lands. Returns its id (made here, so the Map
 * can pick it before the host's push comes back), or null.
 */
export async function dropPin({ x, y }, { temp = false, district = null } = {}) {
  if (!game.user.isGM) return null;
  const n = Object.values(store.apps.mapPins ?? {}).filter(r => r.temp).length + 1;
  const color = temp ? "#00e5ff" : "#b4006a";
  const id = foundry.utils.randomID(16);
  const pin = {
    id, x: Math.round(x), y: Math.round(y), name: temp ? `Marker ${n}` : "New pin",
    icon: categoryIcon("misc"), color, district, everyone: temp, label: temp, temp
  };
  return send("add", { pin }) ? id : null;
}

/** GM: a temporary pin becomes a lasting one (players keep seeing it until the GM hides it). */
export async function keepPin(id) {
  setRow(id, { temp: false });
}

/** GM: take a pin off the Map. */
export async function deletePin(id) {
  if (rowOf(id)) send("delete", { id });
}

/** GM: take every temporary pin off the Map. How many went. */
export async function clearTempPins() {
  const n = Object.values(store.apps.mapPins ?? {}).filter(r => r.temp).length;
  if (n && send("clear-temp")) return n;
  return 0;
}

import { MODULE_ID } from "../config.js";

/*
 * Items for sale, shared by the phone's shops (Great River, apps/market; CBK, apps/cbk): prices, the world
 * items and Item compendiums they sell from (read from compendium indexes, so no documents are loaded), and
 * the item data a purchase puts on a character's sheet. Plain rules are Node-tested (tests/shop.test.js);
 * the catalogue functions need Foundry.
 *
 * Catalogue entry: { uuid, name, img, type, base (market price or null), source ("world" or a compendium
 * collection), sourceLabel, public (players can see the source) }.
 */

/** Most of one item a line may ask for. */
export const MAX_QTY = 99;

/** Compendium index fields the catalogue needs. */
export const INDEX_FIELDS = ["type", "img", "system.price.market"];

/** An item's market price (document, source data or index entry), or null when it has none (missing or 0). */
export function itemPrice(data) {
  const price = Number(data?.system?.price?.market);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** A price × markup ÷ 100, rounded up (null stays null). */
export function listPrice(base, markup = 100) {
  return base == null ? null : Math.ceil((base * markup) / 100);
}

/** A 32-bit FNV-1a hash: the same number for the same text on every client. */
export function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const clampQty = qty => Math.min(MAX_QTY, Math.max(1, Math.floor(Number(qty)) || 1));

export const linesTotal = lines => lines.reduce((sum, l) => sum + (l.price ?? 0) * l.qty, 0);

/**
 * Item data for `qty` of one item bought in a shop, flagged `flags.cpr-sam-agent.<key> = flag`. Ammo with a box
 * size becomes one item with the amount multiplied (CPR prices ammo per box); anything else becomes `qty`
 * separate items.
 */
export function boughtItems(source, qty, flag, key = "market") {
  const data = typeof source.toObject === "function" ? source.toObject() : structuredClone(source);
  for (const k of ["_id", "folder", "sort", "ownership"]) delete data[k];
  data._stats = { ...(data._stats ?? {}), compendiumSource: source.uuid ?? null };
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [key]: flag } };
  const amount = Number(data.system?.amount);
  if (data.type === "ammo" && amount > 0) {
    data.system.amount = amount * qty;
    return [data];
  }
  return Array.from({ length: qty }, () => structuredClone(data));
}

/** The item type's name in the system's words ("Weapon"). */
export const typeLabel = type => globalThis.game?.i18n?.localize?.(CONFIG.Item.typeLabels?.[type] ?? type) ?? type;

/* ---------------- The catalogue (Foundry only) ---------------- */

/** "Ammo (Black Chrome)": compendium titles repeat across books, so add the compendium folder. */
export function packLabel(pack) {
  const folder = pack.folder?.name?.replace(/^Cyberpunk RED:\s*/, "");
  return folder ? `${pack.title} (${folder})` : pack.title;
}

/** Item compendiums: every one (packs null), or those listed. */
export const itemPacks = (packs = null) => game.packs.filter(p => p.documentName === "Item" && (packs == null || packs.includes(p.collection)));

/** Whether players (by role) can see a compendium. */
export const publicPack = pack => ["OBSERVER", "OWNER"].includes(pack.ownership?.PLAYER ?? "OBSERVER");

const inFolder = (item, folderId) => !!item.folder && (item.folder.id === folderId || item.folder.ancestors.some(f => f.id === folderId));

/**
 * Every item a shop could sell, from world items (all, or one folder and its subfolders) and Item compendiums:
 * { entries, skipped (compendiums this client can't read) }.
 * @param {{ worldItems?: boolean, worldFolder?: string, packs?: string[]|null }} sources
 */
export async function loadCatalogue({ worldItems = true, worldFolder = "", packs = null } = {}) {
  const entries = [];
  const skipped = [];
  const entry = (data, uuid, source, sourceLabel, open = true) => ({ uuid, name: data.name, img: data.img, type: data.type, base: itemPrice(data), source, sourceLabel, public: open });
  if (worldItems) {
    for (const item of game.items) {
      if (!worldFolder || inFolder(item, worldFolder)) entries.push(entry(item, item.uuid, "world", "World items"));
    }
  }
  for (const pack of itemPacks(packs)) {
    if (!pack.visible) {
      skipped.push(packLabel(pack));
      continue;
    }
    try {
      const index = await pack.getIndex({ fields: INDEX_FIELDS });
      const open = publicPack(pack);
      for (const e of index) entries.push(entry(e, e.uuid ?? pack.getUuid(e._id), pack.collection, packLabel(pack), open));
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't read ${pack.collection} for the shop`, err);
      skipped.push(packLabel(pack));
    }
  }
  return { entries, skipped };
}

/**
 * Find an item for sale by name (case aside): world items first, then compendiums, `prefer` (compendium
 * collections) before the others. Returns its catalogue entry, or null.
 */
export function findByName(entries, name, { type, prefer = [] } = {}) {
  const want = String(name ?? "").trim().toLowerCase();
  const hits = entries.filter(e => e.name?.toLowerCase() === want && (!type || e.type === type));
  const rank = e => (e.source === "world" ? 0 : prefer.includes(e.source) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

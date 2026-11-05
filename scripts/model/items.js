import { MODULE_ID } from "../config.js";
import { esc } from "../util/text.js";

/*
 * Items from the Cyberpunk RED compendiums onto a character's sheet: what a Mystery Box held
 * (apps/achieve/boxes.js), or a Gacha Legendary made real (apps/gacha/model.js).
 */

/**
 * Find an Item in the compendiums by its exact name (case aside); `type` or `pack` (a pack name like
 * "core_gear") narrows it when the name is shared. Returns its uuid, or null.
 */
export async function findItem({ name, type, pack }) {
  const want = String(name).toLowerCase();
  const packs = game.packs.filter(p => p.documentName === "Item").sort((a, b) => (b.metadata.name === pack) - (a.metadata.name === pack));
  for (const p of packs) {
    if (pack && p.metadata.name !== pack && packs.some(q => q.metadata.name === pack)) continue;
    const index = await p.getIndex({ fields: ["type"] });
    const hit = index.find(e => e.name.toLowerCase() === want && (!type || e.type === type));
    if (hit) return hit.uuid ?? `Compendium.${p.collection}.Item.${hit._id}`;
  }
  return null;
}

/**
 * Put items on a sheet: each found in the compendiums (by uuid, or by name) or, if it isn't there, a
 * plain gear item by that name for the GM to fill in. `note`: where it came from (on the plain item).
 * Returns what was given ("Name x2").
 */
export async function giveItems(actor, items, note) {
  const docs = [];
  const given = [];
  for (const it of items) {
    const uuid = it.uuid || (await findItem(it));
    const source = uuid ? await fromUuid(uuid) : null;
    const data = source ? source.toObject() : { name: it.name, type: "gear", system: { description: { value: `<p>${esc(note)} Not in the compendiums: ask your GM for its stats.</p>` } } };
    delete data._id;
    data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { gacha: true } };
    const stack = typeof data.system?.amount === "number";
    if (stack) data.system.amount = it.qty;
    for (let i = 0; i < (stack ? 1 : it.qty); i++) docs.push(foundry.utils.deepClone(data));
    given.push(`${data.name}${it.qty > 1 ? ` x${it.qty}` : ""}`);
  }
  if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
  return given;
}

/** Every Item in the compendiums, for the GM's pickers: [{ value: uuid, label }] (read once). */
let itemOptions = null;
export async function compendiumItems() {
  if (itemOptions) return itemOptions;
  const out = [];
  for (const p of game.packs.filter(p => p.documentName === "Item")) {
    const index = await p.getIndex({ fields: ["type"] });
    for (const e of index) {
      if (["skill", "role", "criticalInjury"].includes(e.type)) continue;
      out.push({ value: e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, label: `${e.name} (${p.metadata.label})` });
    }
  }
  itemOptions = out.sort((a, b) => a.label.localeCompare(b.label));
  return itemOptions;
}

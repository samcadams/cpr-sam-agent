import { BAND_RANGES } from "./battle.js";
import { isExplosive } from "./model.js";

/*
 * Digital Gladiator's shop and skill list, read from the CPR system's own compendiums (so no book tables ship with the
 * module): standard-quality weapons, cyberweapons and other cyberware (Humanity at the book's fixed loss), body and head
 * armor, basic ammo, and the skills with their (x2) cost. Explosives are left out. Loaded once per client; the host
 * uses the same list to price a saved build, so a player can't name their own prices.
 */

const SYSTEM = "cyberpunk-red-core";
const pack = name => game.packs.get(`${SYSTEM}.${name}`);
const docs = async name => (await pack(name)?.getDocuments()) ?? [];

const STANDARD = /\((Poor|Excellent)\)/;
const DICE = /^\d+d\d+$/;

/** A weapon (gear or cyberware) as a GearEntry's `weapon`. `ammoTypes`: the basic ammo varieties on sale. */
function weaponOf(doc, ammoTypes) {
  const s = doc.system;
  return {
    skill: s.weaponSkill, damage: s.damage, rof: s.rof, magazine: s.magazine?.max ?? 0, dv: s.dvTable || null,
    autofire: s.fireModes?.autoFire ?? 0, ranged: !!s.isRanged, type: s.weaponType,
    ammo: s.isRanged ? (s.ammoVariety ?? []).find(v => ammoTypes.has(v)) ?? null : null
  };
}

const entry = (doc, kind, extra) => ({ uuid: doc.uuid, name: doc.name, img: doc.img, kind, price: doc.system.price?.market ?? 0, ...extra });

/** The DV tables by name, one DV per band (null where the table says N/A). */
async function readDvTables() {
  const tables = {};
  for (const table of await docs("internal_dv-tables")) {
    const byRange = Object.fromEntries(table.results.contents.map(r => [`${r.range[0]}-${r.range[1]}`, Number.parseInt(r.text, 10)]));
    tables[table.name] = BAND_RANGES.map(r => Number.isFinite(byRange[r]) ? byRange[r] : null);
  }
  return tables;
}

async function load() {
  const [weapons, armor, cyberware, ammo, skills, martial] = await Promise.all(
    ["core_weapons", "core_armor", "core_cyberware", "core_ammo", "internal_skills", "core_skills-martial-arts"].map(docs));
  const basicAmmo = ammo.filter(d => d.system.type === "basic" && d.system.price?.market > 0);
  const ammoTypes = new Set(basicAmmo.map(d => d.system.variety));
  // Cyberware that is armor (Subdermal Armor, Skin Weave) has a free armor item of the same name: its SP.
  const freeArmor = new Map(armor.filter(d => !d.system.price?.market).map(d => [d.name, d.system]));
  const armorOf = s => ({ body: s.bodyLocation?.sp ?? 0, head: s.headLocation?.sp ?? 0, penalty: s.penalty ?? 0 });

  const gear = [
    ...weapons.filter(d => !STANDARD.test(d.name) && d.system.price?.market > 0 && DICE.test(d.system.damage))
      .map(d => entry(d, "weapon", { weapon: weaponOf(d, ammoTypes) })),
    ...armor.filter(d => d.system.price?.market > 0 && !d.system.isShield)
      .map(d => entry(d, "armor", { armor: armorOf(d.system) })),
    ...cyberware.filter(d => d.system.price?.market > 0).map(d => {
      const extra = { humanity: d.system.humanityLoss?.static ?? 0 };
      if (d.system.isWeapon && DICE.test(d.system.damage)) extra.weapon = weaponOf(d, ammoTypes);
      if (freeArmor.has(d.name)) extra.armor = armorOf(freeArmor.get(d.name));
      return entry(d, "cyberware", extra);
    }),
    ...basicAmmo.map(d => entry(d, "ammo", { ammo: { type: d.system.variety, rounds: d.system.amount ?? 10 } }))
  ].filter(g => !isExplosive(g)).sort((a, b) => a.name.localeCompare(b.name));

  return {
    gear,
    byUuid: new Map(gear.map(g => [g.uuid, g])),
    skills: [...skills, ...martial].map(d => ({ name: d.name, stat: d.system.stat, x2: d.system.difficulty === "difficult", basic: !!d.system.basic }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    dv: await gladiatorDvTables()
  };
}

let loading = null;
let loadingDv = null;

/** Just the DV tables (a promise, loaded once): all the host needs to start a duel. */
export function gladiatorDvTables() {
  loadingDv ??= readDvTables().catch(err => {
    loadingDv = null;
    throw err;
  });
  return loadingDv;
}

/** The catalogue (a promise, loaded once). */
export function gladiatorCatalogue() {
  loading ??= load().catch(err => {
    loading = null;
    throw err;
  });
  return loading;
}

/** The catalogue if it's loaded already, else null (and it starts loading). */
let ready = null;
export function catalogueNow() {
  if (!ready) gladiatorCatalogue().then(c => (ready = c)).catch(() => {});
  return ready;
}

/** A build's gear from what the player asked for ([{ uuid, qty }]): the catalogue's entries and prices, unknown ones dropped. */
export const priceGear = (catalogue, wanted) => (Array.isArray(wanted) ? wanted : [])
  .map(w => catalogue.byUuid.get(w?.uuid) && { ...catalogue.byUuid.get(w.uuid), qty: Math.max(1, Math.min(20, Math.floor(Number(w.qty) || 1))) })
  .filter(Boolean);

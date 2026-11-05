/*
 * Gacha: Capsules for zCreds, and a shelf to show them off.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "gacha",
  order: 180,
  name: "Gacha", icon: "fas fa-box-open",
  blurb: "One more pull....",
  citinet: true,
  off: true,
  ledger: { gacha: "Gacha" },
  load: "_gachaLoad",
  tables: {
    gachaShelves: { owner: "key" },
    gachaPity: { owner: "key" },
    gachaCreds: { owner: "key" },
    gachaFavs: { owner: "key" }
  },
  settings: {
    // The GM's settings (apps/gacha/model.js).
    gachaConfig: { scope: "world", type: Object, default: {} },
    // Older worlds kept boxes and shelves here; the host moves the shelves into its data folder once (apps/gacha/host.js).
    gacha: { scope: "world", type: Object, default: { boxes: {}, shelves: {} } }
  }
};

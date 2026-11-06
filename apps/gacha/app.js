/*
 * Gacha: Capsules for zCreds, and a shelf to show them off.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "gacha",
  order: 180,
  name: "Gacha", icon: "fas fa-box-open",
  blurb: "One more pull....",
  citinet: true, offline: "browse",
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
  },
  rules: [
    { key: "gachaConfig", path: "pullCost", label: "zCreds a pull", type: "number", range: { min: 0, step: 1 }, default: 160 },
    { key: "gachaConfig", path: "failChance", label: "Purchases that fail (%)", type: "number", range: { min: 0, max: 100, step: 1 }, default: 20 },
    { key: "gachaConfig", path: "chat", label: "Show-offs in chat", type: "boolean", default: true },
    // Odds are weights out of 1000; perMille keeps the old-percent migration (host.js) from scaling them again.
    { key: "gachaConfig", path: "weights.common", label: "Odds: Common (out of 1000)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 680, with: { perMille: true } },
    { key: "gachaConfig", path: "weights.uncommon", label: "Odds: Uncommon (out of 1000)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 240, with: { perMille: true } },
    { key: "gachaConfig", path: "weights.rare", label: "Odds: Rare (out of 1000)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 60, with: { perMille: true } },
    { key: "gachaConfig", path: "weights.epic", label: "Odds: Epic (out of 1000)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 14, with: { perMille: true } },
    { key: "gachaConfig", path: "weights.legendary", label: "Odds: Legendary (out of 1000)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 6, with: { perMille: true } },
    { key: "gachaConfig", path: "sell.common", label: "A Common duplicate sells for (zCreds)", type: "number", range: { min: 0, step: 1 }, default: 1 },
    { key: "gachaConfig", path: "sell.uncommon", label: "An Uncommon duplicate sells for (zCreds)", type: "number", range: { min: 0, step: 1 }, default: 2 },
    { key: "gachaConfig", path: "sell.rare", label: "A Rare duplicate sells for (zCreds)", type: "number", range: { min: 0, step: 1 }, default: 3 },
    { key: "gachaConfig", path: "sell.epic", label: "An Epic duplicate sells for (zCreds)", type: "number", range: { min: 0, step: 1 }, default: 5 },
    { key: "gachaConfig", path: "sell.legendary", label: "A Legendary duplicate sells for (zCreds)", hint: "A spare past C6 sells for 2.5 times this.", type: "number", range: { min: 0, step: 1 }, default: 8 }
  ]
};

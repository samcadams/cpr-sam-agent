/*
 * HusTool: hit PAY ME, run an errand, get paid 10eb.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "hustool",
  order: 195,
  name: "HusTool", icon: "fas fa-bolt",
  blurb: "Need eb fast? Hit PAY ME for an errand.",
  citinet: true, offline: "browse",
  off: true,
  newApp: true,
  ledger: { hustool: "HusTool" },
  tables: {
    // Hustles, one row per settled round per character. Players see their own, without the gm side (the day's trouble).
    hustoolGigs: { monthly: true, owner: "actorId", secret: ["gm"] }
  },
  settings: {
    // Pay, trouble, errands per gig hour and the GM's errand list (apps/hustool/model.js HUSTOOL_DEFAULTS).
    hustool: { scope: "world", type: Object, default: {}, redraw: "all" }
  },
  rules: [
    { key: "hustool", path: "pay", label: "Pay per errand (eb)", type: "number", range: { min: 0, max: 1000, step: 1 }, default: 10 },
    { key: "hustool", path: "perHour", label: "Hustles per gig hour", type: "number", range: { min: 1, max: 10, step: 1 }, default: 2 },
    { key: "hustool", path: "trouble", label: "Trouble on a 10 (an encounter)", type: "boolean", default: true }
  ]
};

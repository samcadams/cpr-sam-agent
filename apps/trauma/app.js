/*
 * Trauma Team: Coverage, and the button you hope you never press.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "trauma",
  order: 60,
  name: "Trauma Team", icon: "fas fa-truck-medical",
  blurb: "Coverage, and security, you can count on.",
  citinet: true,
  tick: { method: "_tickTrauma" },
  ledger: { trauma: "Trauma Team", medscan: "MedScan" },
  tables: { subs: { owner: "key" }, dispatches: { monthly: true, owner: "actorId" }, medscan: { owner: "key" } },
  partials: { "agent-tt-medscan": "medscan.hbs" },
  settings: {
    // Trauma Team's plans and rules (apps/trauma/model.js).
    trauma: { scope: "world", type: Object, default: {} }
  }
};

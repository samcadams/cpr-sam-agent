/*
 * Trauma Team: Coverage, and the button you hope you never press.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "trauma",
  order: 60,
  name: "Trauma Team", icon: "fas fa-truck-medical",
  blurb: "Coverage, and security, you can count on.",
  citinet: true, offline: "browse",
  tick: { method: "_tickTrauma" },
  ledger: { trauma: "Trauma Team", medscan: "MedScan" },
  tables: { subs: { owner: "key" }, dispatches: { monthly: true, owner: "actorId" }, medscan: { owner: "key" } },
  partials: { "agent-tt-medscan": "medscan.hbs" },
  settings: {
    // Trauma Team's plans and rules (apps/trauma/model.js).
    trauma: { scope: "world", type: Object, default: {} }
  },
  rules: [
    { key: "trauma", path: "trigger", label: "Biomonitor calls", type: "string", default: "belowBody",
      choices: { belowBody: "HP drops below BODY", serious: "Seriously Wounded (below half HP)", mortal: "Mortally Wounded (below 1 HP)", critical: "A new Critical Injury", manual: "Never: only the panic button" } },
    { key: "trauma", path: "execAuto", label: "Execs get corporate coverage", type: "boolean", default: false },
    { key: "trauma", path: "solicit", label: "Sell coverage to the bleeding", type: "boolean", default: false },
    { key: "trauma", path: "allowNoAds", label: "Players can turn the offers off", type: "boolean", default: true },
    { key: "trauma", path: "eta", label: "Default ETA (minutes or rounds)", type: "number", range: { min: 0, step: 1 }, default: 5 },
    { key: "trauma", path: "medscan.price", label: "MedScan app (eb, once)", type: "number", range: { min: 0, step: 1 }, default: 20 },
    { key: "trauma", path: "medscan.wound", label: "Wound consult (eb, 1 h)", type: "number", range: { min: 0, step: 1 }, default: 100 },
    { key: "trauma", path: "medscan.surgery", label: "Surgical consult (eb, 4 h)", type: "number", range: { min: 0, step: 1 }, default: 500 },
    { key: "trauma", path: "medscan.live", label: "I answer each consult myself", hint: "On: every call waits for your Connect or Unavailable. Off: a specialist picks up at once.", type: "boolean", default: false },
    { key: "trauma", path: "medscan.unavailable", label: "No specialist available", type: "boolean", default: false }
  ]
};

/*
 * Handprint Scanner: Record a handprint from a hand or the prints it leaves.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 * It shares its model, host, page and template with the Retina Scanner (apps/retinascan/; see model.js).
 */

export default {
  id: "handscan",
  order: 200,
  name: "Handprint Scanner", homeName: "Handprint", icon: "fas fa-hand",
  blurb: "Record a handprint from a hand or the prints it leaves.",
  off: true,
  newApp: true,
  // Both scanners draw the same page (handscan/page.js bioscanData).
  data: "bioscan",
  tables: {
    // Scans in progress and the vault; players see their own, without who the subject is and the GM's marks.
    bioScans: { owner: "actorId", secret: ["subjectActorId", "noticed"] },
    bioRecords: { owner: "actorId", secret: ["subjectActorId", "stale", "noticed"] }
  },
  partials: { "agent-bio-pips": "pips.hbs" },
  settings: {
    // DV, rounds, partial prints, GM confirms, MicroVideo per character (model.js BIOSCAN_DEFAULTS).
    bioscan: { scope: "world", type: Object, default: {}, redraw: "all" }
  },
  rules: [
    { key: "bioscan", path: "dv", label: "DV", type: "number", range: { min: 1, max: 40, step: 1 }, default: 13 },
    { key: "bioscan", path: "handRounds", label: "Handprint rounds", type: "number", range: { min: 1, max: 20, step: 1 }, default: 3 },
    { key: "bioscan", path: "retinaRounds", label: "Retina rounds", type: "number", range: { min: 1, max: 20, step: 1 }, default: 5 },
    { key: "bioscan", path: "partialPrints", label: "Partial prints needed", type: "number", range: { min: 1, max: 20, step: 1 }, default: 5 },
    { key: "bioscan", path: "confirm", label: "I confirm each good round", hint: "\"Target can't move\" always waits for you.", type: "boolean", default: true }
  ]
};

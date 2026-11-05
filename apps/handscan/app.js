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
  }
};

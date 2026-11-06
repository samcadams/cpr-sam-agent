/*
 * NCPD Crime Database: Snap a face, get NCPD's public record within the hour.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "ncpd",
  order: 190,
  name: "NCPD Crime Database", homeName: "NCPD", icon: "fas fa-building-shield",
  blurb: "Snap a face, send it in, get NCPD's public record within the hour.",
  citinet: true, offline: "browse",
  off: true,
  newApp: true,
  tick: { method: "_tickNcpd" },
  load: "_ncpdLoad",
  tables: {
    // Players see their own lookups, without who the GM linked and the GM's notes.
    ncpdLookups: { monthly: true, owner: "actorId", secret: ["subject", "gm"] },
    // The records archive, by record id (optionally linked to an actor): GMs only ("listed" rows that list no one).
    ncpdRecords: { owner: "listed" }
  },
  settings: {
    // Hours, warning, default skill and DV (apps/ncpd/model.js NCPD_DEFAULTS).
    ncpd: { scope: "world", type: Object, default: {}, redraw: "all" }
  }
};

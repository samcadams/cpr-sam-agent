/*
 * DataPool: your Agent crawls the Data Pool for screamsheets about you.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "screamsheet",
  order: 45,
  name: "DataPool", icon: "fas fa-newspaper",
  blurb: "Screamsheets about you, crawled from the Pool.",
  citinet: true,
  off: true,
  newApp: true,
  refreshOn: ["screamJournal"],
  tick: { method: "_tickScream" },
  load: "_screamLoad",
  tables: {
    screamClips: { monthly: true, owner: "listed", secret: ["title", "notes", "source", "spin", "at", "rep"] },
    screamCrawls: { owner: "key", secret: ["found"] }
  },
  partials: { "agent-scream-row": "row.hbs", "agent-scream-desk": "desk.hbs" }
};

/*
 * 4Tify: scan your surroundings for 5 minutes, get +1d6 on the next damage against nearby cover.
 * The folder and id are "fortify", not "4tify": an app's id must be a JS identifier (tools/apps.mjs).
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "fortify",
  order: 205,
  name: "4Tify", icon: "fas fa-shield-halved",
  blurb: "Scan your surroundings for weak spots. Rates your home security, too.",
  off: true,
  newApp: true,
  load: "_fortifyLoad",
  tick: { method: "_tickFortify" },
  tables: {
    // Scans and marks, one row each, for everyone: every client draws the running scans' waves (client.js).
    fortifyMarks: { owner: "listed" }
  }
};

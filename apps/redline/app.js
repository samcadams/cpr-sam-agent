/*
 * REDLINE: Street races, lap times, ghosts and fists.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "redline",
  order: 120,
  name: "REDLINE", icon: "fas fa-flag-checkered",
  blurb: "3...2...1.... GO!",
  off: true,
  newApp: true,
  refreshOn: ["redline"],
  load: "_redlineLoad",
  tables: { redlineSeen: { owner: "key" } },
  settings: {
    // The GM's switches.
    redline: { scope: "world", type: Object, default: {}, redraw: ["redline"] },
    // The GM's tracks and players' nominations.
    redlineTracks: { scope: "world", type: Object, default: {}, redraw: ["redline"] },
    // Every track's board, written by the host.
    redlineBoard: { scope: "world", type: Object, default: {}, redraw: ["redline"] },
    // Whether this player wants the race music (M in a race).
    redlineMusic: { scope: "client", type: Boolean, default: true }
  }
};

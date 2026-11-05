/*
 * NCART Runner: Run the line. Grab the shards. Dodge the 22:40.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "ncart",
  order: 110,
  name: "NCART Runner", icon: "fas fa-train-subway",
  blurb: "The official game of NCART. Do not attempt in real life.",
  off: true,
  newApp: true,
  refreshOn: ["ncart"],
  settings: {
    // The leaderboard, written by the host.
    ncartBoard: { scope: "world", type: Object, default: { scores: [] }, redraw: ["ncart"] },
    // The GM's options: difficulty, which obstacles and power-ups turn up.
    ncart: { scope: "world", type: Object, default: {}, redraw: ["ncart"] },
    // Whether this player wants the game's music (M in the game).
    ncartMusic: { scope: "client", type: Boolean, default: true }
  }
};

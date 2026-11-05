/*
 * Flappy Chrome: Flap through the smog. Beat the board.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "pigeon",
  order: 100,
  name: "Flappy Chrome", icon: "fas fa-crow",
  blurb: "Flap through the smog. Beat the board.",
  off: true,
  refreshOn: ["pigeon"],
  settings: {
    // The leaderboard (apps/pigeon/model.js), written by the host.
    pigeonBoard: { scope: "world", type: Object, default: { scores: [] }, redraw: ["pigeon"] },
    // Maelstrom Heat, per character: { [actorId]: { heat, ts } }, written by the host.
    pigeonHeat: { scope: "world", type: Object, default: {}, redraw: ["pigeon"] }
  }
};

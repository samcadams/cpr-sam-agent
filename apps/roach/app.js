/*
 * Roach Race: The arcade classic. One button. One horse. One life.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "roach",
  order: 130,
  name: "Roach Race", icon: "fas fa-horse-head",
  blurb: "Mmmmh apples",
  off: true,
  newApp: true,
  refreshOn: ["roach"],
  ledger: { roach: "Roach Race" },
  tables: { roachRiders: { owner: "key" } },
  settings: {
    // The GM's settings: pass price, free play, out of order, House Record, steeds.
    roach: { scope: "world", type: Object, default: {}, redraw: ["roach"] },
    // The leaderboard, written by the host.
    roachBoard: { scope: "world", type: Object, default: { scores: [] }, redraw: ["roach"] },
    // Whether this player wants the music (M in a run).
    roachMusic: { scope: "client", type: Boolean, default: true }
  }
};

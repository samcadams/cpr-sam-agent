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
  },
  rules: [
    { key: "roach", path: "out", label: "Out of order (nobody plays)", type: "boolean", default: false },
    { key: "roach", path: "freePlay", label: "Free play (no pass needed)", type: "boolean", default: false },
    { key: "roach", path: "price", label: "Day pass (eb)", type: "number", range: { min: 0, max: 99999, step: 1 }, default: 20 },
    { key: "roach", path: "record", label: "House Record (0: none)", type: "number", range: { min: 0, max: 999999, step: 1 }, default: 3354 },
    { key: "roach", path: "prize", label: "Prize for beating the record", type: "string", default: "a Roach Whisperer jacket" }
  ]
};

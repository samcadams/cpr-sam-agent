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
  },
  rules: [
    { key: "ncart", path: "families.roadblock", label: "Obstacles: police roadblocks", type: "boolean", default: true },
    { key: "ncart", path: "families.overhead", label: "Obstacles: overhead signs and cables", type: "boolean", default: true },
    { key: "ncart", path: "families.wreck", label: "Obstacles: AV wreckage", type: "boolean", default: true },
    { key: "ncart", path: "families.parked", label: "Obstacles: parked trains", type: "boolean", default: true },
    { key: "ncart", path: "families.oncoming", label: "Obstacles: oncoming trains", type: "boolean", default: true },
    { key: "ncart", path: "families.drone", label: "Obstacles: drones", type: "boolean", default: true },
    { key: "ncart", path: "families.gunfire", label: "Obstacles: Maelstrom and Booster gunfire", type: "boolean", default: true },
    { key: "ncart", path: "families.tunnel", label: "Obstacles: tunnels", type: "boolean", default: true },
    { key: "ncart", path: "powers.sandevistan", label: "Power-up: Sandevistan (bullet time)", type: "boolean", default: true },
    { key: "ncart", path: "powers.kerenzikov", label: "Power-up: Kerenzikov (auto-dodge one crash)", type: "boolean", default: true },
    { key: "ncart", path: "powers.armor", label: "Power-up: Subdermal Armor (shrug off one crash)", type: "boolean", default: true },
    { key: "ncart", path: "powers.booster", label: "Power-up: Jump Booster (huge jumps)", type: "boolean", default: true },
    { key: "ncart", path: "powers.skate", label: "Power-up: Skate Foot (sprint through roadblocks)", type: "boolean", default: true },
    { key: "ncart", path: "powers.magnet", label: "Power-up: Neural Link (pull in shards)", type: "boolean", default: true },
    { key: "ncart", path: "powers.optics", label: "Power-up: TeleOptics (see trouble early)", type: "boolean", default: true },
    { key: "ncart", path: "powers.spike", label: "Power-up: Data Spike (double shards)", type: "boolean", default: true }
  ]
};

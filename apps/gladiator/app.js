/*
 * Digital Gladiator: build a Gladiator, challenge another Agent, lose and your Agent is fried.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "gladiator",
  order: 215,
  name: "Digital Gladiator", homeName: "Gladiator", icon: "fas fa-khanda",
  blurb: "Build a fighter, challenge another Agent. Losers lose their Agent.",
  off: true,
  newApp: true,
  devOnly: true,
  ledger: { gladiator: "Digital Gladiator" },
  tables: {
    // Builds, keyed by character (apps/gladiator/model.js): players see their own.
    gladiators: { owner: "key" },
    // Matches, for everyone: a nearby phone can watch a duel (apps/gladiator/model.js).
    gladiatorMatches: { owner: "listed" }
  },
  settings: {
    // How a match is settled: ask each time, always the GM's call, or always the duel (model.js SETTLE_MODES).
    gladiatorSettle: { scope: "world", type: String, default: "ask", redraw: "all" }
  },
  rules: [
    { key: "gladiatorSettle", path: "", label: "Settle matches", type: "string", choices: { ask: "Ask each match", gm: "Always GM choice", play: "Always gameplay" }, default: "ask" }
  ]
};

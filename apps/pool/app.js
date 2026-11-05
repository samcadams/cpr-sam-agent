/*
 * App Store: Ziggurat's app store: get, buy and subscribe to apps for your Agent.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "pool",
  order: 10,
  name: "App Store", icon: "fas fa-store",
  blurb: "Ziggurat's app store: get, buy and subscribe to apps for your Agent.",
  citinet: true,
  off: true,
  newApp: true,
  refreshOn: ["pool"],
  ledger: { pool: "App Store" },
  tables: { installs: { owner: "key" } },
  partials: { "agent-pool-card": "pool-card.hbs" },
  settings: {
    // The GM's catalogue (prices, where each app is offered, preinstalled) and the flavor listings. It
    // changes what's on the phones too.
    pool: { scope: "world", type: Object, default: {}, redraw: ["pool", "apps"] }
  }
};

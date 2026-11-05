/*
 * Great River (NC Market until 2026-10-21): Ziggurat's pilot store (Black Chrome p. 156). Order over the
 * CitiNet, a Transporter drone delivers within the hour. Every order is approved by the GM.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "market",
  order: 55,
  name: "Great River", icon: "fas fa-water",
  blurb: "Order it now, a Ziggurat drone drops it off within the hour. Everyday goods, delivered.",
  citinet: true,
  off: true,
  newApp: true,
  refreshOn: ["market"],
  tick: { method: "_tickMarket" },
  ledger: { market: "Great River" },
  tables: { orders: { owner: "actorId" } },
  partials: { "agent-market-order": "market-order.hbs", "agent-market-shop": "market-shop.hbs" },
  settings: {
    // The GM's store setup (apps/market/model.js MARKET_DEFAULTS): sources, item types, price limits, order rules.
    market: { scope: "world", type: Object, default: {}, redraw: ["market"] }
  }
};

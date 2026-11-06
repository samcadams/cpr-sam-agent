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
  citinet: true, offline: "block",
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
  },
  rules: [
    { key: "market", path: "pricing", label: "Pricing", type: "string", choices: { cap: "Canon store: 100eb (Premium) and under", fee: "No cap, with a delivery fee" }, default: "cap" },
    { key: "market", path: "deliveryFee", label: "Delivery fee per order (eb)", hint: "With the delivery fee pricing.", type: "number", range: { min: 0, step: 1 }, default: 20 },
    { key: "market", path: "deliveryPct", label: "Plus % of the items", hint: "With the delivery fee pricing.", type: "number", range: { min: 0, max: 100, step: 1 }, default: 10 },
    { key: "market", path: "delivery", label: "Delivery", type: "string", choices: { drone: "Transporter drone, within the hour", instant: "Instant (in the gear on approval)" }, default: "drone" },
    { key: "market", path: "etaMin", label: "Drone takes at least (min)", type: "number", range: { min: 1, max: 240, step: 1 }, default: 20 },
    { key: "market", path: "etaMax", label: "…and at most (min)", type: "number", range: { min: 1, max: 240, step: 1 }, default: 60 },
    { key: "market", path: "minPrice", label: "Lowest price (eb)", type: "number", range: { min: 0, step: 1 }, default: 0 },
    { key: "market", path: "maxPrice", label: "Highest price (eb, 0 = no limit)", type: "number", range: { min: 0, step: 1 }, default: 0 },
    { key: "market", path: "markup", label: "Markup (%, 100 = list price)", type: "number", range: { min: 1, step: 1 }, default: 100 },
    { key: "market", path: "ignoreBlankPrice", label: "Ignore blank price", type: "boolean", default: true },
    { key: "market", path: "maxPending", label: "Orders waiting per character (0 = no limit)", type: "number", range: { min: 0, step: 1 }, default: 0 },
    { key: "market", path: "allowOverBudget", label: "Players may order more than they have", type: "boolean", default: false },
    { key: "market", path: "featured", label: "Featured items a day (0 = none)", type: "number", range: { min: 0, max: 12, step: 1 }, default: 4 },
    { key: "market", path: "deals", label: "Hot Deals a day (0 = none)", type: "number", range: { min: 0, max: 12, step: 1 }, default: 5 },
    { key: "market", path: "dealOff", label: "Biggest Hot Deal discount (%)", type: "number", range: { min: 10, max: 90, step: 5 }, default: 30 },
    { key: "market", path: "worldItems", label: "Sell world items (Items sidebar)", type: "boolean", default: true }
  ]
};

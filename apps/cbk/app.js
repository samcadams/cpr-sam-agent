/*
 * CBK ("Cee Book"): Black Chrome's Night Market companion app (pp. 6-8). Browse the live market's listings,
 * BUY NOW!!!, pick it up at the booth with the receipt on your Agent.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "cbk",
  order: 57,
  name: "CBK", icon: "fas fa-receipt",
  blurb: "Browse a Night Market's booths, buy now, pick it up later. Free.",
  citinet: true,
  off: true,
  newApp: true,
  refreshOn: ["cbk"],
  ledger: { cbk: "CBK" },
  tables: { receipts: { owner: "actorId" }, cbkStock: { owner: "listed" }, cbkInvites: { owner: "actorId" }, cbkAuctions: { owner: "listed" }, cbkDeals: { owner: "actorId" } },
  partials: { "agent-cbk-receipt": "cbk-receipt.hbs" },
  settings: {
    // The Night Markets (apps/cbk/model.js): markets, their listings, which are live (stock left: table cbkStock).
    cbk: { scope: "world", type: Object, default: {}, redraw: ["cbk"] }
  }
};

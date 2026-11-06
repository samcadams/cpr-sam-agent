/*
 * BangMe!: Your balance, your ledger, and tap-to-pay.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "bangme",
  order: 50,
  name: "BangMe!", icon: "fas fa-burst",
  blurb: "Bang your friends! Bang your family!",
  citinet: true, offline: "browse",
  refreshOn: ["bangme"],
  tables: { ledger: { monthly: true, owner: "actorId" }, invoices: { owner: "listed" } },
  settings: {
    // BangMe! pay points (apps/bangme/model.js).
    payPoints: { scope: "world", type: Array, default: [] }
  }
};

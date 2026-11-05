/*
 * Combat Cabb: Armored taxis. Pickup wherever you are.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "cabb",
  order: 150,
  name: "Combat Cabb", icon: "fas fa-taxi",
  blurb: "Armored taxis. Pickup wherever you are.",
  citinet: true,
  refreshOn: ["cabb", "mapConfig"], // its settings; the Map's own map (its places, apps/map)
  tick: { method: "_tickCabb" },
  ledger: { cabb: "Combat Cabb" },
  // rideCredits: { [actorId]: { actorId, key, rideId, ts } } the Lifestyle's free ride used this period (model.js).
  tables: { rides: { monthly: true, owner: "actorId" }, rideCredits: { owner: "key" } },
  settings: {
    // Fares, places and where the party is (apps/cabb/model.js).
    cabb: { scope: "world", type: Object, default: {} }
  }
};

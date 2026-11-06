/*
 * Combat Cabb: Armored taxis. Pickup wherever you are.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "cabb",
  order: 150,
  name: "Combat Cabb", icon: "fas fa-taxi",
  blurb: "Armored taxis. Pickup wherever you are.",
  citinet: true, offline: "block",
  refreshOn: ["cabb", "mapConfig"], // its settings; the Map's own map (its places, apps/map)
  tick: { method: "_tickCabb" },
  ledger: { cabb: "Combat Cabb" },
  // rideCredits: { [actorId]: { actorId, key, rideId, ts } } the Lifestyle's free ride used this period (model.js).
  tables: { rides: { monthly: true, owner: "actorId" }, rideCredits: { owner: "key" } },
  settings: {
    // Fares, places and where the party is (apps/cabb/model.js).
    cabb: { scope: "world", type: Object, default: {} }
  },
  rules: [
    { key: "cabb", path: "flagFall", label: "Flag fall (eb)", type: "number", range: { min: 0, step: 1 }, default: 20 },
    { key: "cabb", path: "perMile", label: "Per mile (eb)", type: "number", range: { min: 0, step: 0.5 }, default: 16 },
    { key: "cabb", path: "zoneMult", label: "Zone rate ×", type: "number", range: { min: 1, step: 0.5 }, default: 2 },
    { key: "cabb", path: "zonePickup", label: "Zone rate for pickups in a zone too", type: "boolean", default: false },
    { key: "cabb", path: "etaMin", label: "Pickup in, at least (real seconds)", type: "number", range: { min: 0, step: 1 }, default: 10 },
    { key: "cabb", path: "etaMax", label: "Pickup in, at most (real seconds)", type: "number", range: { min: 0, step: 1 }, default: 180 },
    { key: "cabb", path: "tripTimer", label: "Trips on a timer", hint: "Off: once a cab departs, it arrives only when you say (Arrived now).", type: "boolean", default: true },
    { key: "cabb", path: "secPerKm", label: "Trip, per km (real seconds)", type: "number", range: { min: 0, step: 1 }, default: 20 },
    { key: "cabb", path: "tripMin", label: "Trip from (real seconds)", type: "number", range: { min: 0, step: 1 }, default: 15 },
    { key: "cabb", path: "tripMax", label: "Trip to (real seconds)", type: "number", range: { min: 0, step: 1 }, default: 300 }
  ]
};

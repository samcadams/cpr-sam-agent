/*
 * BREACH: Breach Protocol: your deck does the work, your Agent shows the code.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "breach",
  order: 140,
  name: "BREACH", icon: "fas fa-microchip",
  blurb: "Educational purposes only",
  off: true,
  newApp: true,
  tick: { method: "_tickBreach", realTimeOnly: true },
  tables: {
    breachPoints: { owner: "listed", secret: ["effects"] },
    breaches: { monthly: true, owner: "actorId" }
  }
};

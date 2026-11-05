/*
 * Agent: Your Agent's name, personality and what it's told you.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "agent",
  order: 20,
  name: "Agent", icon: "fas fa-robot", iconLabel: "Agent app",
  blurb: "Your Agent's name, personality and what it's told you.",
  data: "agentApp",
  tables: {
    alerts: { monthly: true, owner: "actorId" },
    // The GM's cards from the apps (host/core.js _gmCard), kept for the GM Phone's notification center. GMs only.
    gmCards: { monthly: true, owner: "gm" }
  },
  settings: {
    // The GM's saved SAAI alerts (Agent app → Send alert).
    savedAlerts: { scope: "world", type: Array, default: [] }
  }
};

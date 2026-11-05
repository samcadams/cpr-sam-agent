/*
 * Ask Alex Anything: Search the local Data Pool.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "alex",
  order: 40,
  name: "Ask Alex Anything", homeName: "Ask Alex", icon: "fas fa-magnifying-glass",
  blurb: "Search the local Data Pool.",
  citinet: true,
  tables: { queries: { monthly: true, owner: "actorId" } },
  settings: {
    // Claude drafts (GM Phone → Ask Alex → Alex AI; apps/alex/ai.js). Client-side so the key stays in the GM's
    // browser: world settings reach every player.
    alexAi: { scope: "client", type: Object, default: {} },
    // Whether Claude's drafts speak in the asker's Agent personality. World-wide so players' Ask Alex says so.
    alexAgentVoice: { scope: "world", type: Boolean, default: true, redraw: "all" }
  }
};

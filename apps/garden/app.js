/*
 * The Garden: Night City's feed, and The Garden Dating.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "garden",
  order: 30,
  name: "The Garden", icon: "fas fa-seedling",
  blurb: "Night City's feed, and The Garden Dating.",
  citinet: true, offline: "block",
  refreshOn: ["garden"],
  // Every 30 real seconds and whenever world time moves (catch-up: due posts go out backdated).
  tick: { method: "_tickGarden" },
  partials: { "agent-garden-post": "garden-post.hbs", "agent-dating-edit": "dating-edit.hbs", "agent-garden-drafts": "drafts.hbs" },
  settings: {
    // The Garden's outcome types and word lists (Garden → Control; apps/garden/model.js gardenConfig).
    gardenConfig: { scope: "world", type: Object, default: {} }
  }
};

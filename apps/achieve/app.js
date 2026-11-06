/*
 * Achieve!: Your achievements, and Mr. Amaze's Mystery Boxes.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "achieve",
  order: 170,
  name: "Achieve!", icon: "fas fa-trophy",
  blurb: "Anything but your dreams.",
  off: true,
  load: "_achieveLoad",
  tables: { earned: { owner: "key" }, boxes: { monthly: true, owner: "actorId" } },
  settings: {
    // The GM's settings (apps/achieve/model.js). What characters earn and the boxes are the host's data.
    achieve: { scope: "world", type: Object, default: {} },
    // Older worlds kept earned achievements here; the host empties it once (apps/achieve/host.js).
    achievements: { scope: "world", type: Object, default: { crews: {} } }
  },
  rules: [
    { key: "achieve", path: "chat", label: "Announce in chat", type: "boolean", default: true }
  ]
};

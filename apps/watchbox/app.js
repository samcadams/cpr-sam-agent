/*
 * WatchBox: Leave your Agent in a room and it keeps watch.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "watchbox",
  order: 70,
  name: "WatchBox", icon: "fas fa-eye",
  blurb: "Secure any room, at any time.",
  citinet: true, offline: "browse",
  noInternal: true,
  tick: { method: "_tickWatch" },
  tables: { watch: { owner: "key" } }
};

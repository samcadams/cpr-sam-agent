/*
 * Retina Scanner: Record someone's retinal pattern.
 * Its model, host code, page and template are the Handprint Scanner's (apps/handscan/); this folder only names
 * the app and gives it its tile.
 */

export default {
  id: "retinascan",
  order: 210,
  name: "Retina Scanner", homeName: "Retina", icon: "fas fa-eye",
  blurb: "Record someone's retinal pattern.",
  off: true,
  newApp: true,
  data: "bioscan"
};

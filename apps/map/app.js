/*
 * Map: Night City on your screen: the places you know, pinned.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "map",
  order: 160,
  name: "Map", icon: "fas fa-map-location-dot",
  blurb: "Night City in the palm of your hand",
  off: true,
  newApp: true,
  refreshOn: ["cabb", "notes", "mapPins", "mapConfig"], // the crew's spot; the NAV scene's pins and their journal pages (client.js); its own map
  // A world without a Map of its own gets the default Night City from the GM's content folder (host.js, its map/);
  // Combat Cabb's zones, scene links and crew spot move onto the Map's pins once
  load: "_mapLoad",
  // Each character's planned route, for the GM's Map (host.js). The Map's own pins (model.js pinFromNote):
  // everyone's, or the characters they list; the scene linked to a pin is the GM's (its Cabb zone isn't secret).
  tables: { routes: { owner: "key" }, mapPins: { owner: "listed", secret: ["sceneId"] } },
  settings: {
    // The Map's own map (model.js configFromScene): its picture, scale, traced files and pin categories.
    mapConfig: { scope: "world", type: Object, default: {}, redraw: ["mapConfig"] }
  }
};

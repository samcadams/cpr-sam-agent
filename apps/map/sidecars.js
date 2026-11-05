import { roadNetwork } from "./route.js";

/*
 * Files traced from a map picture and kept beside it (by an offline tracing script), like its Deep Zoom pyramid (util/deepZoom.js):
 *   map.jpg → map.districts.json  { width, height, districts: [{ name, polygons: [[x0, y0, …]] }] }
 *   map.jpg → map.graph.json      the road network (apps/map/route.js)
 * All in the picture's px. A picture without one has none. The Map names its files in its config (mapConfig);
 * Combat Cabb still finds them beside the NAV scene's picture.
 */

const found = new Map();

/**
 * A traced file: its data, null (none), or a Promise while it's being fetched (once a session). Always checked
 * with the server (`no-cache`), so a re-traced file isn't hidden by the browser's cache.
 */
function traced(url, check, make = d => d) {
  if (!url) return null;
  if (!found.has(url)) {
    const load = fetch(url, { cache: "no-cache" })
      .then(res => (res.ok ? res.json() : null))
      .then(d => (d?.width > 0 && d?.height > 0 && check(d) ? make(d) : null))
      .catch(() => null)
      .then(d => (found.set(url, d), d));
    found.set(url, load);
  }
  return found.get(url);
}

/** A picture's file with this suffix (map.jpg → map.districts.json and the like). */
const sidecar = (src, suffix, check, make) => traced(src.replace(/(\.[^./?#]+)?([?#].*)?$/, suffix), check, make);

const isAreas = d => Array.isArray(d.districts);
const isGraph = d => Array.isArray(d.nodes) && Array.isArray(d.edges);

/** The districts traced on a picture. */
export const mapAreas = src => sidecar(src, ".districts.json", isAreas);

/** The road network traced on a picture, ready to route on (apps/map/route.js roadNetwork). */
export const mapGraph = src => sidecar(src, ".graph.json", isGraph, roadNetwork);

/** The same, awaited (null: none). */
export const loadMapGraph = async src => mapGraph(src);

/**
 * The same from the files' own URLs (the Map's config names them, apps/map/model.js mapConfig): the districts, and
 * the road network ready to route on. Data, null (none, or no URL), or a Promise while it's being fetched.
 */
export const loadAreas = url => traced(url, isAreas);
export const loadGraph = url => traced(url, isGraph, roadNetwork);

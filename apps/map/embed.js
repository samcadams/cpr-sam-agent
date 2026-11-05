import { NavMap } from "./navMap.js";
import { mapConfig, mapReady, ownPicture, ownPins } from "./model.js";
import { store } from "../../scripts/store.js";
import { esc } from "../../scripts/util/text.js";

/*
 * A small map of one place, drawn inline: a shared location in Messages, a Combat Cabb ride, anything that
 * points at the Map (its own map, apps/map/model.js mapConfig). Tapping it opens the Map app on that place. Built on the Map's own NavMap (mini:
 * it doesn't move or zoom, so it never catches the scroll of the list it sits in).
 *
 * A place is what Messages already shares: { sceneId?, noteId?, x?, y?, label? } (the Map's picture px). Only places
 * with no scene or the NAV scene the Map was seeded from can be drawn (another scene: null, keep the old link).
 * `noteId` is a Map pin; it's shown only if this user has it; otherwise a plain marker at its spot, with the
 * caller's label.
 *
 * Two ways in:
 *   - In a phone template: <div class="agent-mapembed" data-scene-id data-note-id data-x data-y data-label></div>
 *     Every phone redraw fills these (apps/map/page.js, phone hook `render`); a tap opens the Map on that phone.
 *   - From code: mapEmbed(element, place, { onOpen, route }) → { destroy() } or null. `route`: { points } (picture
 *     px, as apps/map/model.js ownRoute gives) drawn on it, e.g. a cab's trip.
 */

/** How much of the city an inline map shows around its place (picture px across). */
const SPAN = 1400;

/** Whether a place can be drawn on the Map: { cfg, row (its pin, if this user has it), x, y } or null. */
export function embedPlace(place = {}) {
  const cfg = mapConfig();
  if (!mapReady(cfg) || (place.sceneId && place.sceneId !== cfg.seeded.from)) return null;
  const row = place.noteId ? store.apps.mapPins?.[place.noteId] ?? null : null;
  const x = Number(row?.x ?? place.x);
  const y = Number(row?.y ?? place.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { cfg, row, x, y };
}

/** A place's attributes for the template's <div class="agent-mapembed">. */
export const embedData = place => ({
  sceneId: place?.sceneId ?? "", noteId: place?.noteId ?? "", x: place?.x ?? "", y: place?.y ?? "", label: place?.label ?? ""
});

/** Draw an inline map of `place` into `element` (emptied). */
export function mapEmbed(element, place, { onOpen = null, route = null } = {}) {
  const at = embedPlace(place);
  if (!element || !at) return null;
  const { cfg, row, x, y } = at;
  const picture = ownPicture(cfg);
  const all = ownPins();
  const pin = row ? all.find(p => p.id === row.id) : null;
  // The districts around it for bearings, and the place itself (or a plain marker where it is).
  const spot = pin ?? { id: "__spot", name: place.label || "Here", x, y, type: "__spot", icon: null, color: "#00e5ff", label: true };
  const pins = [...all.filter(p => p.big), { ...spot, label: true }];
  element.classList.add("agent-mapembed", "ready");
  // Outside the phone (a chat card, another window): the phone's colours and the map's styles come with this class.
  if (!element.parentElement?.closest(".ctp-phone-app")) element.classList.add("ctp-phone-app");
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.title = `${spot.name}: open the Map`;
  element.innerHTML = `<div class="agent-navmap agent-navmap-mini" aria-hidden="true"></div>`
    + `<span class="agent-mapembed-open"><i class="fas fa-map-location-dot"></i> ${esc(spot.name)}</span>`;
  const map = new NavMap({
    picture, bounds: picture, pins, mini: true, areas: cfg.areas ?? null, overlay: cfg.overlay ?? null,
    home: { x: x - SPAN / 2, y: y - SPAN * 0.3, w: SPAN, h: SPAN * 0.6 },
    view: {}, onPick: () => onOpen?.({ sceneId: cfg.seeded.from, noteId: pin?.id ?? null, x, y, label: spot.name })
  });
  map.selected = spot.id;
  if (route?.points) map.route = route;
  map.attach(element.firstElementChild);
  return { map, destroy: () => map.detach() };
}

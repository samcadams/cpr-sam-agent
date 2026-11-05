import { cabbConfig } from "../cabb/model.js";
import { cleanPinChange, mapConfig, mapPicture, mapReady, mapScene, seedNav, toPicturePx } from "./model.js";
import { MODULE_ID } from "../../scripts/config.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { contentArt, contentScanned, resolveMapPaths } from "../../scripts/model/content.js";

/*
 * Host: the Map (apps/map/model.js). Pins linked to scenes (a row's `sceneId`, set on the GM's Map): when the GM
 * activates a linked scene, the crew's GPS spot (Combat Cabb's `crew`) moves to that pin. Only the host writes it, once.
 *
 * Planned routes (apps.routes[actorId] = { from, to, ts }): each character's route on their Map, sent as it
 * changes, so the GM's Map can show it. `from`/`to`: { x, y (scene px), name } or { crew: true } (from wherever
 * the crew is). Players see only their own (the table's owner is the character).
 * The Map's pins (apps.mapPins): only a GM edits them, from the GM's Map (apps/map/editor.js, map-pin).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "map-route": "_onMapRoute",
  "map-import": "_onMapImport",
  "map-pin": "_onMapPin"
};

/** A new pin's row before the GM's own values (a GM-only, uncategorised spot). */
const NEW_PIN = {
  everyone: false, actorIds: [], type: "misc", typeLabel: "Miscellaneous", label: false, page: null, size: null,
  alpha: null, sceneId: null, zone: null, district: null, place: null, text: ""
};

/** A route's end as sent: { x, y, name } or { crew: true }; null when it's nonsense. */
function routeEnd(end) {
  if (end?.crew === true) return { crew: true };
  const x = Number(end?.x);
  const y = Number(end?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y), name: String(end.name ?? "").slice(0, 80) || "a spot" };
}

export const methods = {
  /** A character's planned route changed (null: cleared). */
  _onMapRoute(user, { actorId, route }) {
    const actor = game.actors.get(actorId);
    if (!actor || !actor.testUserPermission(user, "OWNER") || !canUsePhone(actor)) return;
    const from = route ? routeEnd(route.from) : null;
    const to = route ? routeEnd(route.to) : null;
    const had = this.apps.routes?.[actor.id];
    this.apps.routes ??= {};
    if (from && to) this.apps.routes[actor.id] = { from, to, ts: Date.now() };
    else if (had) delete this.apps.routes[actor.id];
    else return;
    this._pushApps();
  },

  /**
   * A GM's Import from NAV: the Map's config and pins from the scene the Map shows, seeded here again (not
   * taken from the sender). Rows are replaced by id; the scene isn't touched.
   */
  async _onMapImport(user, { sceneId }) {
    const scene = mapScene();
    if (!user?.isGM || !scene || scene.id !== sceneId) return;
    const seed = await seedNav(scene);
    if (!seed) return;
    this.apps.mapPins = { ...(this.apps.mapPins ?? {}), ...seed.rows };
    this._pushApps();
    await game.settings.set(MODULE_ID, "mapConfig", seed.config);
  },

  /** Once the host has its data: the default Night City where the world has no Map, then Cabb's pin data moved in. */
  async _mapLoad() {
    await this._mapLoadDefaults();
    await this._mapMoveCabb();
  },

  /**
   * Combat Cabb kept its zones ({ pinId: zone }), its pins' scene links ({ pinId: sceneId }) and the crew's spot on
   * the NAV scene ({ sceneId, x, y, noteId }) in its own setting. The zone and the link are the
   * pin's own (`zone`, `sceneId`) and the crew's spot is on the Map ({ x, y (Map px), noteId (its pin) }). Moved once,
   * when the Map has its pins; a zone or link for a pin the Map doesn't have is dropped.
   */
  async _mapMoveCabb() {
    const cfg = cabbConfig();
    const links = cfg.links ?? {};
    const zones = cfg.zones ?? {};
    const crew = cfg.crew;
    if (!Object.keys(links).length && !Object.keys(zones).length && !crew?.sceneId) return;
    const rows = this.apps.mapPins ?? {};
    if (!mapReady() || !Object.keys(rows).length) return;
    for (const [id, sceneId] of Object.entries(links)) if (rows[id]) rows[id] = { ...rows[id], sceneId };
    for (const [id, zone] of Object.entries(zones)) if (rows[id]) rows[id] = { ...rows[id], zone };
    await this._queueWrite(() => this._write());
    // The crew: from the scene's px to the Map's (the same on the NAV scene the Map was seeded from).
    let spot = null;
    const own = mapConfig().picture;
    const scene = crew?.sceneId ? game.scenes.get(crew.sceneId) : null;
    const pic = scene ? mapPicture(scene) : null;
    if (crew?.sceneId && pic) spot = { ...toPicturePx(crew, pic, own), noteId: crew.noteId ?? null, ts: crew.ts ?? Date.now() };
    await patchSetting("cabb", c => {
      c.links = {};
      c.zones = {};
      if (c.crew?.sceneId) c.crew = spot;
    });
    console.log(`${MODULE_ID} | Map: Combat Cabb's ${Object.keys(zones).length} zones and ${Object.keys(links).length} scene links moved onto the Map's pins`);
  },

  /**
   * A world without a Map of its own gets the default Night City from the GM's content folder (map/config.json and
   * map/pins.json, its "./" paths made the folder's; scripts/model/content.js): its pins, every one hidden
   * from players but the district names, without journals (a GM is asked about linking them, journals.js). Seeded
   * "from" the NAV scene when the world has one: Combat Cabb's places and crew are on it until phase 5. Without the
   * drop-in nothing is written, so one added later still loads (_mapContentChanged).
   */
  async _mapLoadDefaults() {
    if (mapConfig().seeded || Object.keys(this.apps.mapPins ?? {}).length) return;
    await contentScanned();
    const [configSrc, pinsSrc] = [contentArt("map/config.json"), contentArt("map/pins.json")];
    if (!configSrc || !pinsSrc) return;
    const folder = game.settings.get(MODULE_ID, "contentFolder");
    const get = src => fetch(encodeURI(foundry.utils.getRoute(src))).then(res => (res.ok ? res.json() : null)).catch(() => null);
    const [config, pins] = (await Promise.all([get(configSrc), get(pinsSrc)])).map(d => resolveMapPaths(d, folder));
    if (!config?.picture || !pins) return;
    const n = Object.keys(pins).length;
    this.apps.mapPins = pins;
    await this._queueWrite(() => this._write());
    await game.settings.set(MODULE_ID, "mapConfig", {
      ...config, seeded: { from: mapScene()?.id ?? "default", at: Date.now(), pins: n, defaults: true, journals: "ask" }
    });
    console.log(`${MODULE_ID} | Map: the default Night City, ${n} pins`);
  },

  /** The content folder's files changed (apps/map/client.js): a Map still without pins tries the drop-in again. */
  async _mapContentChanged() {
    if (!this.loaded || this.loadFailed || mapConfig().seeded || Object.keys(this.apps.mapPins ?? {}).length) return;
    await this._mapLoad();
    if (Object.keys(this.apps.mapPins ?? {}).length) this._pushApps();
  },

  /**
   * A GM's edit to the Map's pins: { op: "set", id, change } (`temp: false` keeps a temporary pin), { op:
   * "set-many", changes: { [id]: change } } (e.g. journals linked by name), { op: "add", pin } (its id made on the
   * GM's client, so the Map can pick it at once), { op: "delete", id } or { op: "clear-temp" } (every temporary
   * pin). Every write stamps `ts` (the phones' redraw key reads it).
   */
  _onMapPin(user, { op, id, change, changes, pin }) {
    if (!user?.isGM) return;
    const rows = (this.apps.mapPins ??= {});
    const has = key => typeof key === "string" && Object.hasOwn(rows, key);
    const set = (key, ch) => {
      const row = { ...rows[key], ...cleanPinChange(ch), ts: Date.now() };
      if (row.temp !== true) delete row.temp;
      rows[key] = row;
    };
    switch (op) {
      case "set":
        if (!has(id)) return;
        set(id, change);
        break;
      case "set-many": {
        const ids = Object.keys(changes ?? {}).filter(has);
        if (!ids.length) return;
        for (const key of ids) set(key, changes[key]);
        break;
      }
      case "add": {
        if (typeof pin?.id !== "string" || !/^[A-Za-z0-9]{16}$/.test(pin.id) || has(pin.id)) return;
        const row = { ...NEW_PIN, ...cleanPinChange(pin), id: pin.id, ts: Date.now() };
        if (row.temp !== true) delete row.temp;
        rows[pin.id] = row;
        break;
      }
      case "delete":
        if (!has(id)) return;
        delete rows[id];
        break;
      case "clear-temp": {
        const temps = Object.keys(rows).filter(key => rows[key].temp);
        if (!temps.length) return;
        for (const key of temps) delete rows[key];
        break;
      }
      default:
        return;
    }
    this._pushApps();
  },

  /** A scene was activated: if a Map pin is linked to it, the crew is there now (Combat Cabb's `crew`, on the Map). */
  async _mapSceneActivated(scene) {
    const row = Object.values(this.apps.mapPins ?? {}).find(r => r.sceneId === scene.id);
    if (!row || cabbConfig().crew?.noteId === row.id) return;
    await patchSetting("cabb", c => (c.crew = { x: row.x, y: row.y, noteId: row.id, ts: Date.now() }));
  }
};

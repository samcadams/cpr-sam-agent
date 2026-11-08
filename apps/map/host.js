import { cabbConfig } from "../cabb/model.js";
import { cleanPinChange, mapConfig, mapPicture, mapReady, mapScene, pinScenes, seedNav, toPicturePx } from "./model.js";
import { MODULE_ID } from "../../scripts/config.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { contentArt, contentScanned, resolveMapPaths } from "../../scripts/model/content.js";
import { esc } from "../../scripts/util/text.js";

/*
 * Host: the Map (apps/map/model.js). Pins linked to scenes (a row's `scenes`, set on the GM's Map): when the GM
 * activates a linked scene, the crew's GPS spot (Combat Cabb's `crew`) moves to that pin; a scene linked to several
 * pins asks the GM in chat which one (map-crew-pick). Only the host writes it, once.
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
  "map-pin": "_onMapPin",
  "map-crew-pick": "_onMapCrewPick"
};

/**
 * The chat card's flag (apps/map/client.js binds its buttons): { sceneId, scene (its name), pins: [pinId], answer
 * (null; then a pin id, or "" for staying) }.
 */
export const CREW_PICK = "mapCrewPick";

/** A new pin's row before the GM's own values (a GM-only, uncategorised spot). */
const NEW_PIN = {
  everyone: false, actorIds: [], type: "misc", typeLabel: "Miscellaneous", label: false, page: null, size: null,
  alpha: null, scenes: [], zone: null, district: null, place: null, text: ""
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

  /**
   * Once the host has its data: the default Night City where the world has no Map, then Cabb's pin data moved in,
   * and a pin's one linked scene made its list.
   */
  async _mapLoad() {
    await this._mapLoadDefaults();
    await this._mapMoveCabb();
    await this._mapMoveScenes();
  },

  /** A row's one linked scene (`sceneId`, before T274) becomes its list of scenes (`scenes`), once. */
  async _mapMoveScenes() {
    const rows = this.apps.mapPins ?? {};
    let n = 0;
    for (const [id, row] of Object.entries(rows)) {
      if (!Object.hasOwn(row, "sceneId")) continue;
      const { sceneId, ...rest } = row;
      if (!Array.isArray(rest.scenes)) rest.scenes = sceneId ? [{ sceneId, label: "" }] : [];
      rows[id] = rest;
      n++;
    }
    if (!n) return;
    await this._queueWrite(() => this._write());
    console.log(`${MODULE_ID} | Map: ${n} pins' scene links made lists`);
  },

  /**
   * Combat Cabb kept its zones ({ pinId: zone }), its pins' scene links ({ pinId: sceneId }) and the crew's spot on
   * the NAV scene ({ sceneId, x, y, noteId }) in its own setting. The zone and the link are the
   * pin's own (`zone`, one of its `scenes`) and the crew's spot is on the Map ({ x, y (Map px), noteId (its pin) }). Moved once,
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
    for (const [id, sceneId] of Object.entries(links)) {
      if (!rows[id]) continue;
      const { sceneId: old, ...row } = rows[id];
      const scenes = Array.isArray(row.scenes) ? row.scenes : old ? [{ sceneId: old, label: "" }] : [];
      rows[id] = { ...row, scenes: scenes.some(s => s.sceneId === sceneId) ? scenes : [...scenes, { sceneId, label: "" }] };
    }
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

  /**
   * A scene was activated: if one Map pin is linked to it, the crew is there now (Combat Cabb's `crew`, on the Map).
   * Linked to several: the crew stays when it's at one of them; else the GMs are asked in chat which one, a button
   * per pin (by name) and one to leave the crew where it is (map-crew-pick).
   */
  async _mapSceneActivated(scene) {
    const rows = Object.values(this.apps.mapPins ?? {}).filter(r => pinScenes(r).some(s => s.sceneId === scene.id));
    if (!rows.length || rows.some(r => r.id === cabbConfig().crew?.noteId)) return;
    if (rows.length === 1) return this._mapCrewAt(rows[0]);
    rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    const pick = { sceneId: scene.id, scene: scene.name, pins: rows.map(r => r.id), answer: null };
    await ChatMessage.create({
      speaker: { alias: "Map" }, whisper: ChatMessage.getWhisperRecipients("GM"),
      content: crewPickCard(pick, rows), flags: { [MODULE_ID]: { [CREW_PICK]: pick } }
    });
  },

  /** The crew is at a Map pin now (Combat Cabb's `crew`). */
  async _mapCrewAt(row) {
    await patchSetting("cabb", c => (c.crew = { x: row.x, y: row.y, noteId: row.id, ts: Date.now() }));
  },

  /**
   * A GM's answer on the chat card "Where is the crew?" (_mapSceneActivated): { messageId, pinId } (one of the
   * card's pins; "" leaves the crew where it is). Answered once: the card then shows the choice, without buttons.
   */
  async _onMapCrewPick(user, { messageId, pinId }) {
    if (!user?.isGM || typeof pinId !== "string") return;
    const message = game.messages?.get(messageId);
    const pick = message?.flags?.[MODULE_ID]?.[CREW_PICK];
    if (!pick || pick.answer != null) return;
    const row = pinId ? this.apps.mapPins?.[pinId] : null;
    if (pinId && (!row || !pick.pins.includes(pinId))) return;
    if (row) await this._mapCrewAt(row);
    const answered = { ...pick, answer: pinId || "" };
    const rows = pick.pins.map(id => this.apps.mapPins?.[id]).filter(Boolean);
    await message.update({ content: crewPickCard(answered, rows), [`flags.${MODULE_ID}.${CREW_PICK}.answer`]: answered.answer });
  }
};

/** A pin as the chat card names it: "Afterlife · Watson". */
const pinPlace = row => [row.name || "Pin", row.district && row.district !== row.name ? row.district : null].filter(Boolean).join(" · ");

/** The chat card "Where is the crew?": a button per pin (`rows`) and one for staying; answered, the choice. */
function crewPickCard(pick, rows) {
  const head = `<p><b>${esc(pick.scene)}</b> is linked to ${pick.pins.length} places. Where is the crew?</p>`;
  if (pick.answer != null) {
    const row = rows.find(r => r.id === pick.answer);
    return `<div class="agent-map-crew-pick">${head}<p class="agent-map-crew-pick-done">${row ? `The crew is at ${esc(pinPlace(row))}.` : "The crew stays where it is."}</p></div>`;
  }
  const buttons = rows.map(r => `<button type="button" data-map-crew-pick="${esc(r.id)}">${esc(pinPlace(r))}</button>`).join("");
  return `<div class="agent-map-crew-pick">${head}<div class="agent-map-crew-pick-buttons">${buttons}`
    + `<button type="button" data-map-crew-pick="">Leave the crew where it is</button></div></div>`;
}

import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { openLocation } from "../../scripts/ui/location.js";
import { NavFilter, filterState } from "./navFilter.js";
import { MODULE_ID } from "../../scripts/config.js";
import { cabbConfig, cabbMap, cabbPlaces, OPEN_RIDE, partyPickup, ZONES } from "../cabb/model.js";
import { isLapsed, poolOn } from "../pool/model.js";
import { phoneApps } from "../../scripts/model/apps.js";
import { store } from "../../scripts/store.js";
import { mapCategories, mapConfig, mapReady, mapScene, navPlayers, ownLists, ownPicture, ownPins, ownRoute, pinsBox, seedNav, UNCATEGORISED } from "./model.js";
import { formatMinutes } from "./route.js";
import { loadGraph } from "./sidecars.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { displayName } from "../../scripts/model/threads.js";
import { esc } from "../../scripts/util/text.js";
import * as edit from "./editor.js";
import { embedPlace, mapEmbed } from "./embed.js";
import { NAMES_AT, NavMap } from "./navMap.js";

/*
 * Phone page: Map (see apps/map/model.js). The Map's own picture and the pins this user has (mapConfig and the table
 * mapPins, seeded from the NAV scene by the GM's Import from NAV), moved and zoomed (apps/map/navMap.js), with
 * CPR Pin Filter's panel to filter them (apps/map/navFilter.js). Tap a pin for
 * what it is and a look at its journal page (players: without its unrevealed secrets; the GM: all of it).
 *
 * The crew's GPS spot (Combat Cabb's `crew`, apps/cabb/model.js): everyone sees where the crew is; the GM drags it
 * anywhere or onto a pin, puts the crew at a pin from its card, or links a pin to a scene (activating that
 * scene puts the crew there, apps/map/host.js). Combat Cabb picks the crew up there.
 *
 * Routes (apps/map/route.js, on the roads traced beside the map picture): anyone plans one from a pin's card
 * ("Route here" from the crew's spot or the start picked with "Start here"); it's drawn as a glowing line,
 * with how far it is and how long it takes by car and on foot. A character's route is sent to the host
 * (apps/map/host.js) for the GM's Map, and comes back after a reload; other players don't see it.
 *
 * The GM's Map edits its own pins (apps/map/editor.js, through the host; the NAV scene isn't touched): drag the
 * picked pin (a district by its handle, a territory by its middle, and size a territory by its corner, with its
 * opacity), edit its fields on its card, say who sees the pin (everyone, the GM only or some characters) and its
 * journal page, and drop new or temporary pins (right-click or a long press on the map). The GM also sees every
 * character's planned route and the cabs that are out.
 *
 * Request Combat Cabb: a character with Combat Cabb on their Agent (switched on, installed while the App Store
 * is on, its subscription not lapsed) can call a cab to a pin from its card: the phone moves to Combat Cabb with
 * the pin as where to (and, when the GM hasn't set the crew's pickup, the route's start pin as where from).
 *
 * The phone turns on its side for it (and for BREACH, see LANDSCAPE): opening the Map turns the whole window landscape (status bar along the
 * long edge, the dock down the side) and bigger; leaving it turns the phone back to the size it was. The
 * landscape size, and the filter (what's hidden, the GM's switch, the panel folded away), are kept in this
 * browser (localStorage), as CPR Pin Filter keeps its own.
 * Methods, click actions (data-action) and dropdowns are installed onto AgentPhone.
 */

/** This browser's landscape size for the Map: { width, height }; and its filter. */
const SIZE_KEY = `${MODULE_ID}.mapSize`;
const FILTER_KEY = `${MODULE_ID}.mapFilter`;

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // (private windows and the like: it's only a convenience)
  }
}

function savedSize(key = SIZE_KEY) {
  const size = load(key);
  return size?.width > 0 && size?.height > 0 ? size : null;
}

/** A first landscape size: most of the screen, wider than tall. */
function defaultSize() {
  const width = Math.round(Math.min(window.innerWidth - 40, Math.max(760, window.innerWidth * 0.62)));
  const height = Math.round(Math.min(window.innerHeight - 60, Math.max(420, width * 0.6)));
  return { width, height };
}

/** A first landscape size for BREACH: room for the matrix beside the buffer and daemons, not the whole screen. */
function breachSize() {
  const width = Math.round(Math.min(window.innerWidth - 40, 860));
  const height = Math.round(Math.min(window.innerHeight - 60, 500));
  return { width, height };
}

/**
 * The apps that turn the phone on its side: the element that marks their own page, the key their landscape
 * size is kept under in this browser, and a first size.
 */
const LANDSCAPE = {
  map: { page: ".agent-map, .agent-map-none", key: SIZE_KEY, size: defaultSize },
  breach: { page: ".agent-breach-app", key: `${MODULE_ID}.breachSize`, size: breachSize }
};

/** `size` placed with its centre where `around`'s was, kept on screen. */
function centred(size, around) {
  const cx = (around.left ?? 0) + (around.width ?? 0) / 2;
  const cy = (around.top ?? 0) + (around.height ?? 0) / 2;
  const left = Math.max(0, Math.min(window.innerWidth - size.width, cx - size.width / 2));
  const top = Math.max(0, Math.min(window.innerHeight - size.height, cy - size.height / 2));
  return { ...size, left: Math.round(left), top: Math.round(top) };
}

/** The pin categories and their groups (the Map's own, seeded from CPR Pin Filter's). */
const filterLists = () => ownLists(mapConfig());

/** A pin's row (the table mapPins), or null. */
const rowOf = id => (id ? store.apps.mapPins?.[id] ?? null : null);

/** Where the crew is on the Map (Combat Cabb's `crew`, Map px), or null (none; one still on a scene isn't moved yet). */
const crewOn = (cfg = cabbConfig()) => (cfg.crew && !cfg.crew.sceneId ? cfg.crew : null);

/** GM: put the crew somewhere on the Map ({ x, y, noteId }), or nowhere (null). */
function setCrew(spot) {
  return patchSetting("cabb", c => {
    c.crew = spot ? { x: Math.round(spot.x), y: Math.round(spot.y), noteId: spot.noteId ?? null, ts: Date.now() } : null;
  });
}

/**
 * A pin's journal (its row's `page`: a journal page or a whole entry): { entry, page (its own page, or null) },
 * or null (none, or this user doesn't have it).
 */
function pinJournal(row) {
  let doc = null;
  try {
    doc = row?.page ? fromUuidSync(row.page) : null;
  } catch {
    // (a uuid that's gone bad: no journal)
  }
  if (!doc) return null;
  const page = doc.documentName === "JournalEntryPage" ? doc : null;
  const entry = page ? page.parent : doc;
  return entry ? { entry, page } : null;
}

/**
 * A pin's journal page to show on its card: its own page, or the first page of its entry this user may read.
 * Null when there's none (or only Limited). `journal`: pinJournal's.
 */
function previewPage(journal) {
  const can = page => page.testUserPermission(game.user, "OBSERVER");
  if (journal.page) return can(journal.page) ? journal.page : null;
  return journal.entry.pages.contents.sort((a, b) => a.sort - b.sort).find(can) ?? null;
}

/** A page as the card shows it: its text (players: without unrevealed secrets), or its picture. */
async function previewHtml(page) {
  if (page.type === "text") {
    const html = await TextEditor.enrichHTML(page.text?.content ?? "", { secrets: page.isOwner, relativeTo: page, async: true });
    if (page.isOwner) return html;
    // (enrichHTML already drops them; this makes sure)
    const div = document.createElement("div");
    div.innerHTML = html;
    for (const el of div.querySelectorAll("section.secret:not(.revealed)")) el.remove();
    return div.innerHTML;
  }
  if (page.type === "image" && page.src) {
    const img = document.createElement("img");
    img.src = page.src;
    img.alt = page.image?.caption || page.name;
    const caption = document.createElement("p");
    caption.textContent = page.image?.caption ?? "";
    return img.outerHTML + (caption.textContent ? caption.outerHTML : "");
  }
  return null;
}

export const actions = {
  /** The map's buttons: zoom in or out on the middle, back to the starting view, or to the crew. */
  "map-zoom"({ dir }) {
    const map = this._navMap;
    if (!map?.root) return;
    if (dir === "fit") map.fit();
    else if (dir === "crew") map.findCrew();
    else map.zoomBy(dir === "in" ? 1.6 : 1 / 1.6);
  },
  "map-close-pin"() {
    this.mapPick = null;
    this.render();
  },
  /** The picked pin's journal page (or entry), as clicking the pin on the scene would open it. */
  async "map-read"() {
    const journal = pinJournal(rowOf(this.mapPick));
    if (!journal) return;
    // As double-clicking a pin on a scene does (Note#_onClickLeft2): its page alone, or its entry.
    const page = journal.page ?? previewPage(journal);
    if (!(page ?? journal.entry).testUserPermission(game.user, "LIMITED")) return;
    if (page?.type === "image" && page.src) return new ImagePopout(page.src, { uuid: page.uuid, title: page.name, caption: page.image?.caption }).render(true);
    const sheet = journal.entry.sheet;
    await sheet.render(true, page ? { mode: JournalSheet.VIEW_MODES.SINGLE, pageId: page.id, focus: true } : { focus: true });
    // Over the phone (it may sit higher than a window opened after it).
    const z = Number(this.position?.zIndex ?? 0);
    if (sheet.rendered && Number(sheet.position?.zIndex ?? 0) <= z) sheet.setPosition({ zIndex: z + 1 });
  },
  /** GM: the crew is at the picked pin (or, without one, in the middle of the view). */
  "map-crew-here"() {
    if (!game.user.isGM) return;
    const row = rowOf(this.mapPick);
    if (row) return setCrew({ x: row.x, y: row.y, noteId: row.id });
    const v = this.mapView;
    if (v?.cx != null) setCrew({ x: v.cx, y: v.cy, noteId: null });
  },
  /** Route to the picked pin: from the start picked, else from the crew's spot. */
  "map-route-to"() {
    const row = rowOf(this.mapPick);
    if (!row) return;
    const crew = crewOn();
    // From the crew: wherever they are when it's drawn (it follows them).
    const from = this.mapRoute?.from ?? (crew ? { crew: true, name: "the crew" } : null);
    this.mapRoute = { from, to: { x: row.x, y: row.y, name: row.name || "the pin" } };
    this.mapPick = null;
    this._mapShareRoute();
    this.render();
  },
  /** Start a route at the picked pin. */
  "map-route-from"() {
    const row = rowOf(this.mapPick);
    if (!row) return;
    this.mapRoute = { ...this.mapRoute, from: { x: row.x, y: row.y, name: row.name || "the pin", noteId: row.id } };
    this._mapShareRoute();
    this.render();
  },
  "map-route-swap"() {
    const r = this.mapRoute;
    if (r?.from && r?.to) this.mapRoute = { from: r.to, to: r.from };
    this._mapShareRoute();
    this.render();
  },
  "map-route-clear"() {
    this.mapRoute = null;
    this._mapShareRoute();
    this.render();
  },
  /** Call a Combat Cabb to the picked pin: over to Combat Cabb, with where to (and where from) filled in. */
  "map-cabb"() {
    const ctx = this.context();
    const cabb = this._mapCabb(ctx, this.mapPick);
    if (!cabb) return;
    this.cabbTo = cabb.to;
    if (cabb.from) this.cabbFrom = cabb.from;
    this.mapPick = null;
    this.app = "cabb";
    this.render();
  },
  /** GM: nobody knows where the crew is. */
  "map-crew-clear"() {
    if (game.user.isGM) setCrew(null);
  },

  /* GM: the picked pin (apps/map/editor.js). */

  /** Fold the card's editor open or shut (kept while the Map is open). */
  "map-edit-toggle"() {
    this.mapEditOpen = !this.mapEditOpen;
    this.render();
  },
  /** The pin and its journal page, readable by every player, in one go. */
  async "map-share-all"() {
    const id = this.mapPick;
    if (!id) return;
    await edit.setPinSeen(id, { everyone: true });
    await edit.setJournalShared(id, "observer");
  },
  /** A temporary pin stays. */
  "map-pin-keep"() {
    if (this.mapPick) edit.keepPin(this.mapPick);
  },
  /** Take the pin off the Map (asked first, unless it's temporary). */
  "map-pin-delete"() {
    const row = rowOf(this.mapPick);
    if (!row) return;
    if (row.temp) return edit.deletePin(row.id);
    Dialog.confirm({
      title: "Delete pin",
      content: `<p>Take <b>${esc(row.name || "this pin")}</b> off the Map? Its journal entry stays.</p>`,
      defaultYes: false,
      yes: () => edit.deletePin(row.id)
    });
  },
  /** Every temporary pin off the Map. */
  async "map-clear-temp"() {
    const n = await edit.clearTempPins();
    if (n) ui.notifications.info(`${n} temporary pin${n === 1 ? "" : "s"} cleared.`);
  },
  /**
   * GM: an empty Map gets a picture of the GM's own: its size read from the file; no pins, no scale (routes
   * need traced roads anyway). Other mapConfig fields stay.
   */
  "map-set-picture"() {
    if (!game.user.isGM) return;
    new FilePicker({
      type: "image",
      callback: async src => {
        const size = await new Promise(resolve => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = encodeURI(foundry.utils.getRoute(src));
        });
        if (!(size?.width > 0 && size.height > 0)) return ui.notifications.warn(`Couldn't load ${src} as a picture.`);
        await patchSetting("mapConfig", c => {
          c.picture = { src, ...size };
          c.seeded ??= { from: "picture", at: Date.now(), pins: 0 };
        });
      }
    }).render(true);
  },
  /** GM: Import from NAV: what would be copied, then the host copies it. */
  async "map-import"() {
    const scene = mapScene();
    if (!game.user.isGM || !scene) return;
    const seed = await seedNav(scene);
    if (!seed) return ui.notifications.warn("The Map's scene has no picture to import.");
    Dialog.confirm({
      title: "Import from NAV",
      content: importReport(scene, seed.report, !!mapConfig().seeded),
      defaultYes: false,
      yes: () => {
        store.request("map-import", { sceneId: scene.id });
        ui.notifications.info(`Importing ${seed.report.pins} pins from ${scene.name}.`);
      }
    });
  }
};

/** What Import from NAV will copy (seedFromNav's report), for the GM to confirm. */
function importReport(scene, r, again) {
  const s = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const who = r.players.map(p => `<li>${esc(p.name)}: ${p.noCharacter ? "no character, sees only everyone's pins" : `sees ${p.sees}`}</li>`).join("");
  return `<p>Copy <b>${esc(scene.name)}</b>'s pins into the Map's own data? The scene isn't changed.</p>
    <ul>
      <li><b>${s(r.pins, "pin")}</b>: ${r.pins - r.gmOnly - r.some} for everyone, ${r.some} for some characters, ${r.gmOnly} GM-only</li>
      ${r.temp ? `<li>${s(r.temp, "temporary pin")} left out</li>` : ""}
      ${r.party ? "<li>The party pin left out (the crew stays where it is)</li>" : ""}
      ${r.outside.length ? `<li>Off the picture: ${r.outside.map(esc).join(", ")}</li>` : ""}
      ${again ? "<li>Pins imported before are replaced</li>" : ""}
    </ul>
    ${who ? `<p>What each player will see:</p><ul>${who}</ul>` : ""}`;
}

/** The GM's text and number fields on the card. */
export const inputs = {
  ".agent-map-edit input[name=mapPinName]": {
    change(event) {
      if (this.mapPick) edit.setField(this.mapPick, "name", event.currentTarget.value);
    }
  },
  ".agent-map-edit input[name=mapPinColor]": {
    change(event) {
      if (this.mapPick) edit.setField(this.mapPick, "color", event.currentTarget.value);
    }
  },
  ".agent-map-edit input[name=mapPinNamed]": {
    change(event) {
      if (this.mapPick) edit.setField(this.mapPick, "named", event.currentTarget.checked);
    }
  },
  // Who sees it, some characters: the ones ticked (any the list doesn't show stay listed).
  ".agent-map-share input[name=mapPinSeenBy]": {
    change(event) {
      const row = rowOf(this.mapPick);
      if (!row) return;
      const boxes = [...event.currentTarget.closest(".agent-map-seen-by").querySelectorAll("input[name=mapPinSeenBy]")];
      const listed = new Set(boxes.map(b => b.value));
      const actorIds = [...(row.actorIds ?? []).filter(id => !listed.has(id)), ...boxes.filter(b => b.checked).map(b => b.value)];
      // (the list stays open with none ticked)
      this.mapSeenSome = row.id;
      edit.setPinSeen(row.id, { everyone: false, actorIds });
    }
  },
  // A territory's size and opacity on the Map: shown as the slider moves, saved when it's let go.
  ".agent-map-edit input[name=mapTurfSize], .agent-map-edit input[name=mapTurfAlpha]": {
    input(event) {
      const el = event.currentTarget;
      const pin = this._navMap?.root?.querySelector(`.agent-navmap-pin[data-pin="${CSS.escape(this.mapPick ?? "")}"]`);
      if (el.name === "mapTurfSize") pin?.style.setProperty("--size", `${el.value}px`);
      else pin?.style.setProperty("--alpha", Number(el.value) / 100);
      el.nextElementSibling && (el.nextElementSibling.textContent = el.name === "mapTurfSize" ? `${el.value}` : `${el.value}%`);
    },
    change(event) {
      const el = event.currentTarget;
      if (!this.mapPick) return;
      edit.setLook(this.mapPick, el.name === "mapTurfSize" ? { size: Number(el.value) } : { alpha: Number(el.value) / 100 });
    }
  }
};

/** "pinId|value" → [pinId, value] (the GM's dropdowns on a pin's card). */
const pinValue = value => {
  const i = String(value).indexOf("|");
  return [String(value).slice(0, i), String(value).slice(i + 1)];
};

export const dropdowns = {
  /** GM: a pin's category. */
  mapPinType(value) {
    const [id, type] = pinValue(value);
    edit.setField(id, "type", type, { categories: mapCategories(ownPins(), filterLists()) });
  },
  mapPinDistrict(value) {
    const [id, district] = pinValue(value);
    edit.setField(id, "district", district);
  },
  mapPinColor(value) {
    const [id, color] = pinValue(value);
    edit.setField(id, "color", color);
  },
  mapPinIcon(value) {
    const [id, icon] = pinValue(value);
    edit.setField(id, "icon", icon);
  },
  /** The pin's journal entry ("pinId|": none). */
  mapPinEntry(value) {
    const [id, entryId] = pinValue(value);
    edit.setJournal(id, entryId || null);
  },
  /** The page of its entry ("pinId|": the entry itself). */
  mapPinPage(value) {
    const [id, pageId] = pinValue(value);
    const entry = pinJournal(rowOf(id))?.entry;
    if (entry) edit.setJournal(id, entry.id, pageId || null);
  },
  /**
   * Who sees the pin: everyone, the GM only, or some characters (none ticked yet: still the GM only, with the
   * characters to tick shown).
   */
  mapPinSeen(value) {
    const [id, seen] = pinValue(value);
    const row = rowOf(id);
    if (!row) return;
    this.mapSeenSome = seen === "some" ? id : null;
    if (seen === "some") {
      if (row.everyone) edit.setPinSeen(id, { everyone: false, actorIds: [] });
      else this.render();
    } else edit.setPinSeen(id, { everyone: seen === "everyone" });
  },
  /** What every player may do with its journal page: none, limited, observer. */
  mapPinShare(value) {
    const [id, level] = pinValue(value);
    edit.setJournalShared(id, level);
  },
  /** GM: a pin's Combat Cabb zone: "pinId|zone" ("pinId|": none). The pin's own, as on Cabb's GM page. */
  mapCabbZone(value) {
    const [id, zone] = pinValue(value);
    edit.setZone(id, ZONES[zone] ? zone : null);
  },
  /** GM: the scene linked to a pin: "pinId|sceneId" ("pinId|": none). */
  mapLink(value) {
    const [id, sceneId] = String(value).split("|");
    edit.setLink(id, sceneId || null);
  }
};

export const methods = {
  mapData(ctx) {
    const gm = ctx.perspective === "gm";
    const cfg = cabbConfig();
    const own = mapConfig();
    // Nothing imported yet: the GM's Import from NAV is the way in.
    if (!mapReady(own)) {
      this._mapModel = null;
      return { none: true, gm, importable: gm };
    }
    this._mapRestoreRoute(ctx);
    this._mapAppsKey = this._mapKeyOf(ctx);
    const pins = ownPins();
    const picture = ownPicture(own);
    const bounds = { x: 0, y: 0, w: picture.w, h: picture.h };
    const crew = crewOn(cfg);
    this._mapModel = {
      picture, bounds, home: pinsBox(pins, bounds), pins, crew, crewEditable: gm, pinsEditable: gm,
      areas: own.areas ?? null, overlay: own.overlay ?? null
    };
    this._mapOthers = gm ? this._mapOtherRoutes(own, crew) : [];
    const pin = pins.find(p => p.id === this.mapPick) ?? null;
    if (!pin) this.mapPick = null;
    // The card slides in only for a newly picked pin (not on every redraw: an alert, someone's item...).
    const fresh = !!pin && this._mapCardShown !== pin.id;
    this._mapCardShown = pin?.id ?? null;
    const row = pin ? rowOf(pin.id) : null;
    const journal = pinJournal(row);
    const page = journal ? previewPage(journal) : null;
    const crewPin = crew?.noteId ? pins.find(p => p.id === crew.noteId) : null;
    const temps = gm ? pins.filter(p => p.temp).length : 0;
    // Combat Cabb's places are the Map's pins, unless the GM chose its city list ("No map").
    const cabbOnMap = !!cabbMap(cfg);
    return {
      gm,
      temps,
      route: this._mapRouteData(own, crew),
      count: pins.length,
      crew: crew ? { at: crewPin?.name ?? null } : null,
      pin: pin ? {
        ...pin,
        fresh,
        // What it is, and where: "Bar · Little China"
        line: [pin.typeLabel, pin.place && pin.place !== pin.name ? pin.place : null, pin.district && pin.district !== pin.name ? pin.district : null].filter(Boolean).join(" · "),
        readable: !!journal && !!(journal.page ?? page ?? journal.entry).testUserPermission(game.user, "LIMITED"),
        preview: page ? this._mapPreview(page) : null,
        crewHere: crew?.noteId === pin.id,
        // Routes: "Route here" needs a start (picked, or the crew's spot); "Start here" unless it's the start already.
        canRouteTo: !!(this.mapRoute?.from || crew),
        cabb: !!this._mapCabb(ctx, pin.id),
        isStart: this.mapRoute?.from?.x === pin.x && this.mapRoute?.from?.y === pin.y,
        edit: gm ? this._mapEditData(row, journal, pin, pins) : null,
        // Combat Cabb's zone (fare multiplier) for this pin: only when the Map is Cabb's own NAV scene's.
        zoneDropdown: gm && cabbOnMap ? dropdown("mapCabbZone", [
          { value: `${pin.id}|`, label: "No zone", selected: !row?.zone },
          ...Object.entries(ZONES).map(([z, label]) => ({ value: `${pin.id}|${z}`, label, selected: row?.zone === z }))
        ], { title: `Combat Cabb's zone: fares into a zone cost ×${cfg.zoneMult}`, cls: "agent-wide" }) : null,
        linkDropdown: gm ? dropdown("mapLink", [
          { value: `${pin.id}|`, label: "No scene linked", selected: !row?.sceneId },
          ...game.scenes.filter(s => s.id !== own.seeded.from).map(s => ({ value: `${pin.id}|${s.id}`, label: s.navName || s.name, selected: row?.sceneId === s.id }))
        ], { title: "Scene linked to this pin: activating it puts the crew here", cls: "agent-wide", search: game.scenes.size > 8 }) : null
      } : null
    };
  },

  /**
   * GM: the picked pin's editor on its card: its fields (name, category, district, colour, icon, the name always
   * shown; a territory's size and opacity on the Map), who sees it and its journal, and the journal it's linked to.
   * From the pin's row (`journal`: pinJournal's).
   */
  _mapEditData(row, journal, pin, pins) {
    const id = pin.id;
    const opt = (value, label, selected, extra = {}) => ({ value: `${id}|${value}`, label, selected, ...extra });
    const categories = mapCategories(pins, filterLists());
    // Districts: the traced ones (map.districts.json) and any named on the pins.
    const areas = this._navMap?.areas?.districts?.map(d => d.name) ?? [];
    const districts = [...new Set([...areas, ...pins.map(p => p.district).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
    // Colours and icons in use on the Map, the most used first.
    const tally = list => [...list.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    const colors = tally(pins.map(p => p.color?.toLowerCase()).filter(c => /^#[0-9a-f]{6}$/.test(c ?? ""))).slice(0, 18);
    const color = /^#[0-9a-f]{6}$/i.test(pin.color ?? "") ? pin.color.toLowerCase() : "#b4006a";
    if (!colors.includes(color)) colors.unshift(color);
    const icons = tally(pins.map(p => p.icon).filter(edit.isCategoryIcon));
    if (pin.icon && !icons.includes(pin.icon)) icons.unshift(pin.icon);
    const iconName = src => String(src).split("/").pop().replace(/\.[a-z]+$/i, "").replace(/[-_]/g, " ");

    // Who sees it: the row says (everyone, or the characters it lists; neither: the GM only).
    const shared = journal ? { doc: journal.page ?? journal.entry, ...journal } : null;
    const level = shared ? edit.playersLevel(shared.doc) : null;
    const { LIMITED, OBSERVER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const entryLevel = shared?.page ? edit.playersLevel(shared.entry) : null;
    const everyone = !!row?.everyone;
    const listed = row?.actorIds ?? [];
    const seenBy = everyone ? "everyone" : listed.length || this.mapSeenSome === id ? "some" : "gm";
    // The player characters to tick (navPlayers'), by name.
    const characters = seenBy === "some"
      ? [...new Set(navPlayers().flatMap(p => p.actorIds))].map(a => game.actors.get(a)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name)).map(a => ({ id: a.id, name: a.name, checked: listed.includes(a.id) }))
      : null;
    const entries = game.journal.contents.sort((a, b) => a.name.localeCompare(b.name));
    const entry = journal?.entry ?? null;
    return {
      open: !!this.mapEditOpen,
      name: row?.name ?? pin.name,
      color,
      named: !!row?.label,
      temp: pin.temp,
      territory: pin.territory ? { size: pin.size, alpha: Math.round(pin.alpha * 100) } : null,
      typeDropdown: dropdown("mapPinType", [...categories].map(([type, label]) => opt(type, label, type === pin.type))
        .sort((a, b) => (a.value.endsWith(`|${UNCATEGORISED}`) ? 1 : 0) - (b.value.endsWith(`|${UNCATEGORISED}`) ? 1 : 0) || a.label.localeCompare(b.label)),
      { title: "Category (its icon follows when it has a category icon)", cls: "agent-wide", search: true }),
      districtDropdown: dropdown("mapPinDistrict", [opt("", "No district", !pin.district), ...districts.map(d => opt(d, d, d === pin.district))],
        { title: "District", cls: "agent-wide", search: districts.length > 8 }),
      colorDropdown: dropdown("mapPinColor", colors.map(c => opt(c, c, c === color, { color: c })), { title: "Colour (in use on the map)" }),
      iconDropdown: dropdown("mapPinIcon", icons.map(src => opt(src, iconName(src), src === pin.icon)), { title: "Icon", cls: "agent-wide", search: icons.length > 8 }),
      // The pin itself: everyone, the GM only, or the characters ticked (`nobody`: some characters, none ticked).
      seenDropdown: dropdown("mapPinSeen", [
        opt("everyone", "Everyone", seenBy === "everyone"),
        opt("gm", "GM only", seenBy === "gm"),
        opt("some", "Some characters", seenBy === "some")
      ], { title: "Who sees the pin on the Map", cls: "agent-wide" }),
      characters,
      nobody: seenBy === "some" && !listed.length,
      journal: shared ? {
        name: shared.page ? `${shared.entry.name}: ${shared.page.name}` : shared.entry.name,
        level: level >= OBSERVER ? "observer" : level >= LIMITED ? "limited" : "none",
        // A page shared while its entry is hidden: players still can't open it.
        entryHidden: !!shared.page && entryLevel < LIMITED && level >= LIMITED,
        shareDropdown: dropdown("mapPinShare", [
          opt("none", "Hidden from players", level < LIMITED),
          opt("limited", "Players: title only (Limited)", level >= LIMITED && level < OBSERVER),
          opt("observer", "Players can read it (Observer)", level >= OBSERVER)
        ], { title: "What every player may do with its journal page", cls: "agent-wide" }),
        everything: everyone && level >= OBSERVER && (!shared.page || entryLevel >= LIMITED)
      } : null,
      entryDropdown: dropdown("mapPinEntry", [opt("", "No journal", !entry), ...entries.map(e => opt(e.id, e.name, e.id === entry?.id))],
        { title: "The journal entry this pin opens", cls: "agent-wide", search: true }),
      pageDropdown: entry && entry.pages.size > 1 ? dropdown("mapPinPage", [
        opt("", "The whole entry", !journal.page),
        ...entry.pages.contents.sort((a, b) => a.sort - b.sort).map(pg => opt(pg.id, pg.name, pg.id === journal.page?.id))
      ], { title: "Which page of it", cls: "agent-wide", search: entry.pages.size > 8 }) : null
    };
  },

  /**
   * GM: everyone else's routes for the map: each character's planned route (apps.routes) and every cab that's
   * out (on its way: from where it was called to where it's going; riding: the same trip). [{ points, cls, label }]
   */
  _mapOtherRoutes(own, crew) {
    const net = loadGraph(own.roads);
    if (net instanceof Promise) {
      net.then(() => this.app === "map" && this._redraw());
      return [];
    }
    if (!net) return [];
    this._mapRouteCache ??= new Map();
    const cached = (key, from, to) => {
      if (!this._mapRouteCache.has(key)) {
        if (this._mapRouteCache.size > 60) this._mapRouteCache.clear();
        this._mapRouteCache.set(key, ownRoute(own, net, from, to)?.points ?? null);
      }
      return this._mapRouteCache.get(key);
    };
    const out = [];
    const end = e => (e?.crew ? (crew ? { x: crew.x, y: crew.y } : null) : e);
    for (const [actorId, r] of Object.entries(store.apps.routes ?? {})) {
      const from = end(r.from);
      const to = end(r.to);
      const actor = game.actors.get(actorId);
      if (!from || !to || !actor) continue;
      const points = cached(`${from.x},${from.y}>${to.x},${to.y}`, from, to);
      if (points) out.push({ points, cls: "player", label: `${displayName(actor)} → ${r.to.crew ? "the crew" : r.to.name}` });
    }
    // Cabs: a place id is a pin ("note:<id>": the Map's pin with that id), or the party's spot (the crew, where they are now).
    const at = id => {
      if (id === "party") return crew ? { x: crew.x, y: crew.y } : null;
      const row = String(id ?? "").startsWith("note:") ? rowOf(id.slice(5)) : null;
      return row ? { x: row.x, y: row.y } : null;
    };
    for (const ride of Object.values(store.apps.rides ?? {})) {
      if (!OPEN_RIDE.has(ride.status)) continue;
      const from = at(ride.from?.id);
      const to = at(ride.to?.id);
      if (!from || !to) continue;
      const points = cached(`${from.x},${from.y}>${to.x},${to.y}`, from, to);
      const who = game.actors.get(ride.actorId);
      if (points) out.push({ points, cls: "cabb", label: `Cabb ${ride.cab}${who ? `: ${displayName(who)}` : ""} → ${ride.to.name}` });
    }
    return out;
  },

  /**
   * What of the apps' data this Map shows (an apps change touching none of it leaves the Map as it is, phone
   * hook `keep`): the Map's pins (how many, when and where: a cheap sum, not every row); the GM's other routes
   * and cabs; a character's Combat Cabb button.
   */
  _mapKeyOf(ctx) {
    let n = 0, ts = 0, xy = 0;
    for (const r of Object.values(store.apps.mapPins ?? {})) {
      n++;
      ts += Number(r.ts) || 0;
      xy += (Number(r.x) || 0) + (Number(r.y) || 0);
    }
    const pins = `${n}:${ts}:${xy}`;
    if (ctx?.perspective === "gm") {
      const rides = Object.values(store.apps.rides ?? {}).filter(r => OPEN_RIDE.has(r.status)).map(r => [r.id, r.from?.id, r.to?.id, r.status]);
      return JSON.stringify([pins, store.apps.routes ?? {}, rides]);
    }
    const id = ctx?.actorId;
    const open = Object.values(store.apps.rides ?? {}).some(r => r.actorId === id && OPEN_RIDE.has(r.status));
    return JSON.stringify([pins, id, open, this.installedApps(ctx), poolOn() && isLapsed(store.apps.installs, id, "cabb")]);
  },

  /** A character's route, for the GM's Map (apps/map/host.js); only when it changed. */
  _mapShareRoute() {
    const ctx = this._ctx;
    if (ctx?.perspective !== "pc" || !ctx.actorId) return;
    const r = this.mapRoute;
    const end = e => (e?.crew ? { crew: true } : { x: e.x, y: e.y, name: e.name });
    const route = r?.from && r?.to ? { from: end(r.from), to: end(r.to) } : null;
    const key = `${ctx.actorId}:${JSON.stringify(route)}`;
    if (key === this._mapSharedRoute) return;
    this._mapSharedRoute = key;
    store.request("map-route", { actorId: ctx.actorId, route }, { quiet: true });
  },

  /** A character's route kept by the host comes back the first time the Map is drawn (after a reload). */
  _mapRestoreRoute(ctx) {
    if (ctx?.perspective !== "pc" || !ctx.actorId || this._mapRouteFor === ctx.actorId) return;
    this._mapRouteFor = ctx.actorId;
    const saved = store.apps.routes?.[ctx.actorId];
    if (!saved) {
      this.mapRoute = null;
      return;
    }
    this.mapRoute = { from: saved.from, to: saved.to };
    this._mapSharedRoute = `${ctx.actorId}:${JSON.stringify({ from: saved.from, to: saved.to })}`;
  },

  /**
   * Can this phone call a Combat Cabb to a pin? { to, from } (Cabb place ids; `from` only when players pick
   * their own pickup and the route starts at another pin), or null: not a character's phone, Combat Cabb not on
   * it (or its subscription lapsed), a ride already open, or the pin isn't one of Cabb's places (Cabb on its city
   * list, "No map") or is where the crew already is.
   */
  _mapCabb(ctx, pinId) {
    if (!pinId || ctx?.perspective !== "pc" || !ctx.actorId) return null;
    const installed = this.installedApps(ctx);
    if (!phoneApps({ internal: ctx.internal, installed }).some(a => a.id === "cabb")) return null;
    if (poolOn() && isLapsed(store.apps.installs, ctx.actorId, "cabb")) return null;
    if (Object.values(store.apps.rides ?? {}).some(r => r.actorId === ctx.actorId && OPEN_RIDE.has(r.status))) return null;
    const cfg = cabbConfig();
    const map = cabbMap(cfg);
    if (!map) return null;
    const places = cabbPlaces(cfg, map);
    const to = places.find(p => p.noteId === pinId);
    if (!to) return null;
    const party = partyPickup(cfg, map, places);
    if (party?.crew && cfg.crew?.noteId === pinId) return null;
    const start = !party && this.mapRoute?.from?.noteId ? places.find(p => p.noteId === this.mapRoute.from.noteId) : null;
    return { to: to.id, from: start && start.id !== to.id ? start.id : null };
  },

  /**
   * The route's summary for the bar, and its line for the map (this._mapRouteLine): { from, to, miles,
   * drive, walk } once worked out; { waiting } while the roads load; { none } when there's no way (or no roads);
   * { pickStart } with only a start. Null: no route.
   */
  _mapRouteData(own, crew) {
    this._mapRouteLine = null;
    let r = this.mapRoute;
    if (r?.from?.crew) r = { ...r, from: crew ? { x: crew.x, y: crew.y, name: "the crew" } : null };
    if (r?.to?.crew) r = { ...r, to: crew ? { x: crew.x, y: crew.y, name: "the crew" } : null };
    if (!r?.from && !r?.to) return null;
    if (!r.to) return { pickStart: false, from: r.from.name, pickEnd: true };
    if (!r.from) return { to: r.to.name, pickStart: true };
    const net = loadGraph(own.roads);
    if (net instanceof Promise) {
      net.then(() => this.app === "map" && this._redraw());
      return { from: r.from.name, to: r.to.name, waiting: true };
    }
    const found = net ? ownRoute(own, net, r.from, r.to) : null;
    if (!found) return { from: r.from.name, to: r.to.name, none: true, noRoads: !net };
    this._mapRouteLine = { points: found.points };
    return {
      from: r.from.name, to: r.to.name,
      miles: found.miles.toFixed(1),
      drive: formatMinutes(found.minutes.drive),
      walk: formatMinutes(found.minutes.walk)
    };
  },

  /**
   * A page's preview for the card: { html } once ready; { loading } while it's being read (it redraws the
   * phone when done). Kept until the page changes.
   */
  _mapPreview(page) {
    this._mapPreviews ??= new Map();
    const key = `${page.uuid}@${page._stats?.modifiedTime ?? 0}@${game.user.isGM}`;
    const have = this._mapPreviews.get(key);
    if (have) return have;
    this._mapPreviews.set(key, { loading: true });
    previewHtml(page).then(html => {
      this._mapPreviews.set(key, { html, empty: !html?.trim() });
      if (this.app === "map") this._redraw();
    }).catch(() => this._mapPreviews.set(key, { empty: true }));
    return this._mapPreviews.get(key);
  },

  /** After a redraw: the map (kept where it was moved and zoomed to) and its filter panel. */
  _mapAttach(html) {
    const root = html.querySelector(".agent-navmap");
    const model = this._mapModel;
    if (!root || !model) return this._navMap?.detach();
    this.mapView ??= {};
    this.mapFilter ??= filterState(load(FILTER_KEY) ?? {});
    const lists = filterLists();
    // A spot opened from a shared location (mapOpen): on the map, not in the filter's lists.
    const shown = this.mapSpot ? { ...model, pins: [...model.pins, this.mapSpot] } : model;
    if (this._navMap) this._navMap.update({ ...shown, view: this.mapView });
    else {
      this._navMap = new NavMap({
        ...shown, view: this.mapView,
        onPick: id => {
          if (id === "__spot") id = null;
          if (id && this.mapSpot) this.mapSpot = null;
          if (id === this.mapPick) return;
          this.mapPick = id;
          this._mapReveal = id;
          this._navMap.select(id);
          this.render();
        },
        onHover: id => this._navFilter?.markHovered(id),
        onCrew: spot => game.user.isGM && setCrew(spot),
        // GM: the picked pin dragged (its district follows), a territory resized; the menu on the map.
        onMove: (id, at) => edit.movePin(id, at, this._navMap?.areaAt(at.x, at.y)),
        onResize: (id, size) => edit.setLook(id, { size }),
        menu: at => this._mapMenu(at),
        onMenu: (item, at) => this._mapMenuPick(item, at)
      });
    }
    const filter = new NavFilter({
      state: this.mapFilter, pins: model.pins, categories: mapCategories(model.pins, lists), groups: lists.groups,
      isGM: game.user.isGM, map: this._navMap,
      onChange: () => {
        const { hidden, showGm, collapsed } = this.mapFilter;
        save(FILTER_KEY, { hidden: [...hidden], showGm, collapsed });
      },
      onJump: id => {
        this._navMap.jumpTo(id);
        if (id === this.mapPick) return;
        this.mapPick = id;
        this.render();
      }
    });
    this._navFilter = filter;
    this._navMap.filter = pin => filter.passes(pin);
    this._navMap.route = this._mapRouteLine;
    this._navMap.routes = this._mapOthers ?? [];
    this._navMap.selected = this.mapPick;
    this._navMap.attach(root);
    // The card keeps where it was scrolled to (the GM's editor is long) while the same pin is picked.
    const card = html.querySelector(".agent-map-card");
    if (card) {
      if (this._mapCardScroll?.id === this.mapPick) card.scrollTop = this._mapCardScroll.top;
      card.addEventListener("scroll", () => (this._mapCardScroll = { id: this.mapPick, top: card.scrollTop }), { passive: true });
    }
    const panel = html.querySelector(".agent-mapf");
    if (panel) filter.attach(panel);
    if (this._mapReveal) {
      filter.reveal(this._mapReveal);
      this._mapReveal = null;
    }
  },

  /**
   * Open the Map on a place: { sceneId?, noteId?, x?, y?, label? } (what Messages shares; apps/map/embed.js). A pin
   * this user has is picked; any other spot gets a marker. False when the Map can't show it (not on this
   * phone, no map yet, another scene): the caller falls back to the scene itself (ui/location.js openLocation).
   */
  mapOpen(place = {}) {
    const ctx = this._ctx ?? this.context();
    if (!phoneApps({ internal: ctx?.internal, installed: this.installedApps(ctx) }).some(a => a.id === "map")) return false;
    const at = embedPlace(place);
    if (!at) return false;
    const pin = at.row && ownPins().find(p => p.id === at.row.id);
    this.app = "map";
    this.mapPick = pin ? pin.id : null;
    this.mapSpot = pin ? null : { id: "__spot", name: place.label || "Shared spot", x: at.x, y: at.y, type: "__spot", icon: null, color: "#00e5ff", label: true };
    this._mapReveal = pin?.id ?? null;
    const r = ownPicture(at.cfg);
    this.mapView = { key: `${r.x} ${r.y} ${r.w} ${r.h}`, cx: at.x, cy: at.y, scale: Math.max(this.mapView?.scale ?? 0, NAMES_AT * 1.2), fit: false };
    this.render(true);
    return true;
  },

  /** Fill the inline maps in what was just drawn (<div class="agent-mapembed">, apps/map/embed.js); a tap opens the Map here. */
  _mapEmbeds(html) {
    for (const old of this._mapEmbedded ?? []) old.destroy();
    this._mapEmbedded = [];
    for (const el of html.querySelectorAll(".agent-mapembed:not(.ready)")) {
      const d = el.dataset;
      const place = { sceneId: d.sceneId || null, noteId: d.noteId || null, x: d.x === "" ? null : Number(d.x), y: d.y === "" ? null : Number(d.y), label: d.label || "" };
      const made = mapEmbed(el, place, { onOpen: to => this.mapOpen(to) || openLocation(to) });
      if (made) this._mapEmbedded.push(made);
      else el.classList.add("agent-mapembed-none");
    }
  },

  /** GM: the map's menu at a point of the picture (right-click or a long press). */
  _mapMenu(at) {
    if (!game.user.isGM) return [];
    const temps = ownPins().filter(p => p.temp).length;
    // (the default Night City wasn't imported from NAV: "again" only after an import; none without a NAV scene)
    const seeded = mapConfig().seeded;
    const importLabel = seeded?.defaults ? "Import from NAV" : "Import from NAV again";
    return [
      { id: "temp", label: "Drop a temporary pin here", icon: "fa-thumbtack" },
      { id: "pin", label: "Drop a new pin here", icon: "fa-map-pin" },
      { id: "crew", label: "Put the crew here", icon: "fa-location-arrow" },
      ...(temps ? [{ id: "clear-temp", label: `Clear temporary pins (${temps})`, icon: "fa-broom" }] : []),
      ...(seeded && mapScene() ? [{ id: "import", label: importLabel, icon: "fa-file-import" }] : [])
    ];
  },

  async _mapMenuPick(item, at) {
    if (!game.user.isGM) return;
    if (item === "crew") return setCrew(this._navMap?._snap(at) ?? { ...at, noteId: null });
    if (item === "clear-temp") return actions["map-clear-temp"].call(this);
    if (item === "import") return actions["map-import"].call(this);
    const id = await edit.dropPin(at, { temp: item === "temp", district: this._navMap?.areaAt(at.x, at.y) ?? null });
    if (!id) return;
    // Picked, with its editor open for a new pin (the redraw comes with the host's push of its row).
    this.mapPick = id;
    if (item === "pin") this.mapEditOpen = true;
    this._mapReveal = id;
  },

  /**
   * Every redraw: the phone lies on its side while the Map is open, and stands up again after. Turning keeps
   * the window's middle where it was. (Not while minimised: Foundry owns the size then.)
   */
  _mapOrient() {
    const el = this.element?.[0];
    if (!el || this._minimized) return;
    // The app's own page: not the lock screen, a call or an alert drawn in its place.
    const app = Object.keys(LANDSCAPE).find(id => this.app === id && el.querySelector(LANDSCAPE[id].page)) ?? null;
    el.classList.toggle("agent-landscape", !!app);
    if (app === (this._landscape || null)) return;
    const p = this.position;
    // (a wide window would otherwise redraw itself for the split conversation view; AgentPhone.setPosition)
    this._wide = undefined;
    // Leaving one app on its side: keep its size for next time.
    if (this._landscape) save(LANDSCAPE[this._landscape].key, { width: Math.round(p.width), height: Math.round(p.height) });
    if (this._landscape === "map" && app !== "map") this._navMap?.detach();
    if (app) {
      if (!this._landscape) this._portrait = { width: p.width, height: p.height };
      this._landscape = app;
      this.setPosition(centred(savedSize(LANDSCAPE[app].key) ?? LANDSCAPE[app].size(), p));
    } else {
      this._landscape = false;
      this.setPosition(centred(this._portrait ?? { width: 340, height: 580 }, p));
    }
  }
};

export const phone = {
  /** The Map turns the phone on its side (and back), then draws its map at that size. */
  render(html) {
    this._mapOrient();
    if (this.app === "map") this._mapAttach(html);
    else this._navMap?.detach();
    this._mapEmbeds(html);
  },
  /** Being dragged (a redraw would drop it). */
  busy() {
    return !!this._navMap?.dragging;
  },
  /** An apps change the Map doesn't show (an alert, someone's game score...) leaves it as it is. */
  keep(change, ctx) {
    return this.app === "map" && this._mapAppsKey != null && this._mapKeyOf(ctx) === this._mapAppsKey;
  }
};

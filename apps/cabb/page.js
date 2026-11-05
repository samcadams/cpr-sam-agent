import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import {
  cabbConfig, cabbDay, cabbMap, cabbPlaces, cleanDistrict, creditLabel, DISTRICTS, OPEN_RIDE, partyPickup, quote, rideCredit, rideMiles, ZONES
} from "./model.js";
import { mapConfig, mapRows, ownCabbRoad, ownPicture, ownPins, pinsBox } from "../map/model.js";
import { setZone } from "../map/editor.js";
import { NavMap } from "../map/navMap.js";
import { loadGraph } from "../map/sidecars.js";
import { feature } from "../../scripts/model/features.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { esc, formatDuration } from "../../scripts/util/text.js";

/*
 * Phone page: Combat Cabb (see apps/cabb/model.js). Players pick where to (on the map or the list), see the
 * fare, and call a cab; then follow it: on its way, here (waiting), moving, arrived. The GM Phone follows
 * the rides (here now, depart, arrived now, set the time by hand or no timer, cancel), says where the party is (the crew's
 * spot on the Map, or a place), and sets the fares, the places and their zones. Both see only the pins players can see,
 * on the Map app's own map (its own Night City, apps/map; NavMap: its picture, pins, district names, the crew and the
 * road route; _cabbAttach). With "No map" there is no map: Night City's districts, picked from lists.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const saveConfig = change => patchSetting("cabb", change);

/** GM: how many places the list shows at once (the search and the map find the rest). */
const LIST_MAX = 30;

/** At least this much of the city (Map px across) shows around a trip. */
const TRIP_SPAN = 1400;

/** Why a Lifestyle's free ride doesn't cover a trip. */
const PERIOD = { day: "today", week: "this week", month: "this month" };
const creditNote = c => (c.why === "used" ? `Your ${c.lifestyle} Lifestyle's free ride ${PERIOD[c.per] ?? ""} is used.` : `Your ${c.lifestyle} Lifestyle's free ride doesn't go to or from a Combat Zone or the Hot Zone.`);

const STATUS = { enroute: "On its way", waiting: "Here, waiting", riding: "In the cab", arrived: "Arrived", cancelled: "Cancelled", declined: "Payment declined" };

/** The city list as the GM has it (a copy to change). */
const districtsOf = cfg => foundry.utils.deepClone(cfg.districts ?? DISTRICTS);

export const actions = {
  "cabb-book"() {
    const actor = this.context()?.subject?.actor;
    const view = this._cabbQuote();
    if (!actor || !view) return;
    const credit = rideCredit(actor, view.from, view.to, store.apps.rideCredits);
    const price = credit?.ok ? `<s>${formatMoney(view.fare)}</s> <strong>free</strong>. ${esc(creditLabel(credit))}.` : `<strong>${formatMoney(view.fare)}</strong>${view.zone ? ` (${ZONES[view.zone]} rate)` : ""}`;
    Dialog.confirm({
      title: "Combat Cabb",
      content: `<p>Call a cab from <strong>${esc(view.from.name)}</strong> to <strong>${esc(view.to.name)}</strong>?</p><p>${view.mi} mi, ${price}</p>`,
      yes: () => store.request("cabb-book", { actorId: actor.id, from: view.from.id, to: view.to.id })
    });
  },
  "cabb-cancel"({ rideId }) {
    Dialog.confirm({ title: "Combat Cabb", content: "<p>Cancel your cab? Nothing has been charged yet.</p>", defaultYes: false, yes: () => store.request("cabb-cancel", { rideId }) });
  },
  "cabb-gm"({ rideId, act }) {
    store.request("cabb-gm", { rideId, action: act });
  },
  /** GM: when the cab gets there (pickup or destination), in minutes from now; blank: no timer, it waits for you. */
  async "cabb-time"({ rideId }) {
    const ride = store.apps.rides?.[rideId];
    if (!ride || (ride.status !== "enroute" && ride.status !== "riding")) return;
    const pickup = ride.status === "enroute";
    const at = pickup ? ride.eta : ride.arrive;
    const left = at && at > Date.now() ? Math.round((at - Date.now()) / 6000) / 10 : "";
    const result = await fieldsDialog({
      title: `Cabb ${ride.cab}: ${pickup ? `pickup at ${ride.from.name}` : `arrival at ${ride.to.name}`}`,
      label: "Set",
      fields: [{ name: "minutes", label: "Minutes from now", type: "number", step: "0.5", value: left, placeholder: "No timer", hint: `Real minutes. Leave it blank for no timer: the cab ${pickup ? "is there" : "arrives"} when you say.` }]
    });
    if (result) store.request("cabb-gm", { rideId, action: "time", minutes: result.minutes ?? "" });
  },

  /* GM: where the party is */
  /** GM: the crew's GPS spot is set on the Map. */
  "cabb-open-map"() {
    this.app = "map";
    this.render();
  },
  "cabb-crew-clear"() {
    return saveConfig(c => (c.crew = null));
  },

  /* GM: the city list ("No map") */
  async "cabb-place-edit"({ place } = {}) {
    const cfg = cabbConfig();
    const list = districtsOf(cfg);
    const i = list.findIndex(d => `d:${d.id}` === place);
    const d = list[i] ?? { name: "", x: 6, y: 6, zone: null };
    const result = await fieldsDialog({
      title: i >= 0 ? `Place: ${d.name}` : "New place",
      label: i >= 0 ? "Save" : "Add",
      fields: [
        { name: "name", label: "Name", value: d.name },
        { name: "x", label: "East (km)", type: "number", step: "0.1", value: d.x, hint: "From the city's west edge." },
        { name: "y", label: "South (km)", type: "number", step: "0.1", value: d.y, hint: "From the city's north edge." },
        { name: "zone", label: "Zone", type: "select", value: d.zone ?? "", options: [{ value: "", label: "None" }, ...Object.entries(ZONES).map(([value, label]) => ({ value, label }))] }
      ]
    });
    if (!result?.name) return;
    const clean = cleanDistrict({ ...result, id: i >= 0 ? d.id : null, zone: result.zone || null });
    if (i >= 0) list[i] = clean;
    else {
      if (list.some(x => x.id === clean.id)) clean.id = `${clean.id}-${foundry.utils.randomID(4)}`;
      list.push(clean);
    }
    await saveConfig(c => (c.districts = list));
  },
  "cabb-place-add"() {
    return actions["cabb-place-edit"].call(this);
  },
  "cabb-place-remove"({ place }) {
    const list = districtsOf(cabbConfig()).filter(d => `d:${d.id}` !== place);
    if (list.length < 2) return ui.notifications.warn("Keep at least two places.");
    return saveConfig(c => (c.districts = list));
  },
  "cabb-places-reset"() {
    Dialog.confirm({ title: "Combat Cabb", content: "<p>Put back the default Night City places?</p>", defaultYes: false, yes: () => saveConfig(c => (c.districts = null)) });
  },
  /** The map's buttons: zoom in or out, find the crew, or back to the trip (or the city). */
  "cabb-zoom"({ dir }) {
    const map = this._cabbNav;
    if (!map?.root) return;
    if (dir === "fit") map.fit();
    else if (dir === "crew") map.findCrew();
    else map.zoomBy(dir === "in" ? 1.6 : 1 / 1.6);
  }
};

export const dropdowns = {
  cabbFrom(value) {
    this.cabbFrom = value;
    this.render();
  },
  cabbTo(value) {
    this.cabbTo = value;
    this.render();
  },
  /**
   * GM: where the party is ("" = players pick). A Map pin puts the crew's GPS spot on it (as on the Map); a place
   * from the city list is remembered as it is.
   */
  cabbParty(value) {
    const row = String(value).startsWith("note:") ? mapRows()[value.slice(5)] ?? null : null;
    return saveConfig(c => {
      c.partyAt = row ? null : value || null;
      c.crew = row ? { x: row.x, y: row.y, noteId: row.id, ts: Date.now() } : null;
    });
  },
  /** GM: Cabb's places ("" = the Map's pins, "none" = the city list, no map). */
  cabbScene(value) {
    return saveConfig(c => {
      c.sceneId = value || null;
      c.partyAt = null;
    });
  },
  /** GM: a place's zone: "placeId|zone". */
  cabbZone(value) {
    const [place, zone] = String(value).split("|");
    const z = ZONES[zone] ? zone : null;
    // A Map pin's zone is the pin's own (apps/map: written by the host).
    if (place.startsWith("note:")) return setZone(place.slice(5), z);
    return saveConfig(c => (c.districts = districtsOf(cabbConfig()).map(d => (`d:${d.id}` === place ? { ...d, zone: z } : d))));
  }
};

export const inputs = {
  /** GM: narrow the place list as you type. */
  "input[name=cabbSearch]": {
    input(event) {
      this.cabbSearch = event.currentTarget.value;
      this.render();
    }
  },
  "input[data-cabb-setting]": {
    change(event) {
      const el = event.currentTarget;
      const key = el.dataset.cabbSetting;
      const value = el.type === "checkbox" ? el.checked : Math.max(0, Number(el.value) || 0);
      return saveConfig(c => (c[key] = value));
    }
  }
};

export const methods = {
  /** The trip on screen: { from, to, mi, km, fare, zone, road, line (km, by road) }, or null. */
  _cabbQuote(cfg = cabbConfig(), map = cabbMap(cfg), places = cabbPlaces(cfg, map)) {
    const from = partyPickup(cfg, map, places) ?? places.find(p => p.id === this.cabbFrom);
    const to = places.find(p => p.id === this.cabbTo);
    if (!from || !to || from.id === to.id) return null;
    const road = this._cabbRoad(map, from, to);
    return { from, to, line: road?.points ?? null, ...quote(from, to, cfg, cabbDay(), road?.miles) };
  },

  /**
   * A trip by road on the Map (apps/map/model.js ownCabbRoad), when its road network is traced: { miles, points
   * (km) }, or null (none yet: the phone redraws once it's loaded; no roads; no way through; no map).
   */
  _cabbRoad(map, from, to) {
    if (!map || !from || !to) return null;
    const own = mapConfig();
    const net = loadGraph(own.roads);
    if (net instanceof Promise) {
      net.then(n => n && this.app === "cabb" && this._redraw());
      return null;
    }
    return net ? ownCabbRoad(own, net, from, to) : null;
  },

  /**
   * The map, as the Map app draws it (NavMap): the Map's picture, the pins that are Cabb's places (the player's
   * own, or for the GM those players see), the crew's spot, and the trip by road (or straight, without roads) from
   * `from` to `to`. Zones are ringed red, the pickup and the drop-off marked. Null with "No map".
   */
  _cabbMap(cfg, map, places, from, to) {
    const own = mapConfig();
    const picture = map ? ownPicture(own) : null;
    if (!picture || !map.k) return null;
    const k = map.k;
    const px = p => ({ x: p.x / k, y: p.y / k });
    const bounds = { x: 0, y: 0, w: picture.w, h: picture.h };
    const byNote = new Map(places.filter(p => p.noteId).map(p => [p.noteId, p]));
    const pins = ownPins().filter(p => byNote.has(p.id)).map(p => {
      const place = byNote.get(p.id);
      const cls = [place.zone ? `cabb-zone cabb-zone-${place.zone}` : "", p.id === to?.noteId ? "cabb-to" : "", p.id === from?.noteId ? "cabb-from" : ""].filter(Boolean).join(" ");
      // The trip's ends always say their names; the GM's "players can't see this" mark means nothing here.
      return { ...p, gmOnly: false, cls, label: p.label || !!cls.match(/cabb-(to|from)/) };
    });
    // The crew's spot is the pickup: drawn as the crew.
    const crew = from?.crew ? { ...px(from), noteId: cfg.crew?.noteId ?? null } : null;
    let route = null;
    if (from && to) {
      const road = this._cabbRoad(map, from, to);
      const points = road ? road.points.map(n => n / k) : [from.x / k, from.y / k, to.x / k, to.y / k];
      route = { points, straight: !road };
    }
    // Where it starts: the whole trip, the way it goes (with the city around it), else every place.
    let home = pinsBox(pins, bounds);
    if (route) {
      const xs = route.points.filter((_, i) => i % 2 === 0);
      const ys = route.points.filter((_, i) => i % 2 === 1);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const w = Math.max((x1 - x0) * 1.2, TRIP_SPAN);
      const h = Math.max((y1 - y0) * 1.2, TRIP_SPAN * 0.6);
      home = { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
    }
    return {
      picture, bounds, home, pins, crew, crewEditable: false, route, areas: own.areas ?? null, overlay: own.overlay ?? null,
      selected: to?.noteId ?? null,
      trip: `map|${from?.id ?? ""}|${to?.id ?? ""}`
    };
  },

  /** After a redraw: the map (kept where it was moved and zoomed to; a new trip is shown whole). */
  _cabbAttach(html) {
    const root = html.querySelector(".agent-cabb-navmap");
    const model = this._cabbModel;
    if (!root || !model) return this._cabbNav?.detach();
    this.cabbView ??= {};
    if (this._cabbTrip !== model.trip) {
      this._cabbTrip = model.trip;
      this.cabbView.fit = true;
    }
    const opts = { ...model, view: this.cabbView };
    if (this._cabbNav) this._cabbNav.update(opts);
    else this._cabbNav = new NavMap({ ...opts, onPick: id => id && this._cabbPicked(`note:${id}`) });
    this._cabbNav.selected = model.selected;
    // The trip is the map's own route (the Map's cyan line, which stands out from the picture's yellow roads).
    this._cabbNav.route = model.route;
    this._cabbNav.routes = [];
    this._cabbNav.attach(root);
    // GM: bring the place just tapped on the map into view in the list (after the phone puts its scroll back).
    if (this._cabbScrollFound) {
      this._cabbScrollFound = false;
      requestAnimationFrame(() => html.querySelector(".agent-cabb-place.picked")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  },

  /** A place tapped on the map: the player's where to; the GM finds it in the list (tap again to let go). */
  _cabbPicked(place) {
    const ctx = this.context();
    if (ctx?.perspective === "gm") {
      this.cabbFound = this.cabbFound === place ? null : place;
      this._cabbScrollFound = !!this.cabbFound;
      return this.render();
    }
    const actor = ctx?.subject?.actor;
    if (actor && Object.values(store.apps.rides ?? {}).some(r => r.actorId === actor.id && OPEN_RIDE.has(r.status))) return;
    const cfg = cabbConfig();
    const map = cabbMap(cfg);
    const places = cabbPlaces(cfg, map);
    if (!places.some(p => p.id === place)) return;
    if (place === (partyPickup(cfg, map, places) ?? places.find(p => p.id === this.cabbFrom))?.id) return;
    this.cabbTo = place;
    this.render();
  },

  /**
   * The map for the template ({ gm, count, crew }), keeping what NavMap draws for _cabbAttach; null (and no map
   * drawn) with "No map" or no places.
   */
  _cabbMapView(cfg, map, places, from, to, gm) {
    this._cabbModel = places.length ? this._cabbMap(cfg, map, places, from, to) : null;
    const m = this._cabbModel;
    return m ? { gm, count: m.pins.length, crew: !!m.crew, trip: !!m.route } : null;
  },

  _cabbRide(r) {
    const actor = game.actors.get(r.actorId);
    const at = r.status === "enroute" ? r.eta : r.status === "riding" ? r.arrive : null;
    return {
      ...r, mi: rideMiles(r), who: actor ? displayName(actor) : "?", statusLabel: STATUS[r.status] ?? r.status, open: OPEN_RIDE.has(r.status),
      fareLabel: r.credit ? `free (${r.credit.lifestyle})` : formatMoney(r.fare), zoneLabel: r.zone ? ZONES[r.zone] : null,
      etaAt: at && at > Date.now() ? at : null, countdown: at && at > Date.now() ? formatDuration(at - Date.now()) : null,
      enroute: r.status === "enroute", waiting: r.status === "waiting", riding: r.status === "riding",
      timeable: r.status === "enroute" || r.status === "riding",
      untimed: (r.status === "enroute" && !r.eta) || (r.status === "riding" && !r.arrive),
      paid: r.status === "waiting" || r.status === "riding"
    };
  },

  cabbData(ctx) {
    const gm = ctx.perspective === "gm";
    const cfg = cabbConfig();
    const map = cabbMap(cfg);
    const places = cabbPlaces(cfg, map);
    const party = partyPickup(cfg, map, places);
    const rides = Object.values(store.apps.rides ?? {}).sort((a, b) => b.ts - a.ts);
    if (gm) {
      // The list: the place tapped on the map first, then those matching the search.
      const found = places.find(p => p.id === this.cabbFound) ?? null;
      const query = (this.cabbSearch ?? "").trim().toLowerCase();
      const listed = [...(found ? [found] : []), ...places.filter(p => p !== found && (!query || p.name.toLowerCase().includes(query)))];
      return {
        gm,
        bar: appBar("cabb"),
        map: this._cabbMapView(cfg, map, places, party, found, true),
        mapOpen: !!this.sectionsOpen().cabbMap,
        search: this.cabbSearch ?? "",
        total: places.length,
        more: Math.max(0, listed.length - LIST_MAX),
        open: rides.filter(r => OPEN_RIDE.has(r.status)).map(r => this._cabbRide(r)),
        recent: rides.filter(r => !OPEN_RIDE.has(r.status)).slice(0, 6).map(r => this._cabbRide(r)),
        onMap: !!map,
        // (an older NAV scene id counts as the Map)
        sceneDropdown: dropdown("cabbScene", [
          { value: "", label: "The Map's pins", selected: cfg.sceneId !== "none" },
          { value: "none", label: "No map: Night City districts", selected: cfg.sceneId === "none" }
        ], { title: "Where cabs go", cls: "agent-wide" }),
        noMapYet: cfg.sceneId !== "none" && !map,
        crew: party?.crew ? { near: party.name } : null,
        partyDropdown: dropdown("cabbParty", [
          { value: "", label: "Players pick their pickup", selected: !cfg.partyAt },
          ...places.map(p => ({ value: p.id, label: p.name, selected: party?.crew ? cfg.crew?.noteId === p.noteId : cfg.partyAt === p.id }))
        ], { title: "Where the party is", cls: "agent-wide", search: places.length > 8 }),
        mapOn: feature("app_map"),
        cfg,
        places: listed.slice(0, LIST_MAX).map(p => ({
          ...p, zoneLabel: p.zone ? ZONES[p.zone] : "", picked: p.id === found?.id,
          zone: dropdown("cabbZone", [{ value: `${p.id}|`, label: "No zone", selected: !p.zone }, ...Object.entries(ZONES).map(([z, label]) => ({ value: `${p.id}|${z}`, label, selected: p.zone === z }))], { title: "Zone" })
        })),
        editable: !map
      };
    }

    const actor = ctx.subject.actor;
    const mine = rides.filter(r => r.actorId === actor.id);
    const open = mine.find(r => OPEN_RIDE.has(r.status));
    if (!places.some(p => p.id === this.cabbTo)) this.cabbTo = null;
    const view = this._cabbQuote(cfg, map, places);
    const credit = view ? rideCredit(actor, view.from, view.to, store.apps.rideCredits) : null;
    const from = party ?? places.find(p => p.id === this.cabbFrom) ?? null;
    const to = places.find(p => p.id === this.cabbTo) ?? null;
    return {
      gm,
      bar: appBar("cabb", { owner: ctx.subject.name }),
      ride: open ? this._cabbRide(open) : null,
      map: this._cabbMapView(cfg, map, places, open ? places.find(p => p.id === open.from.id) ?? from : from, open ? places.find(p => p.id === open.to.id) : to, false),
      party: party ? { name: party.name } : null,
      fromDropdown: party ? null : dropdown("cabbFrom", [
        { value: "", label: "Pick up at…", selected: !from },
        ...places.map(p => ({ value: p.id, label: p.name, selected: p.id === from?.id }))
      ], { title: "Pick up at", cls: "agent-wide", search: places.length > 8 }),
      toDropdown: dropdown("cabbTo", [
        { value: "", label: "Where to?", selected: !to },
        ...places.filter(p => p.id !== from?.id).map(p => ({ value: p.id, label: `${p.name}${p.zone ? ` (${ZONES[p.zone]})` : ""}`, selected: p.id === to?.id }))
      ], { title: "Where to", cls: "agent-wide", search: places.length > 8 }),
      quote: view ? {
        mi: view.mi, road: view.road, fare: formatMoney(view.fare), zone: view.zone ? ZONES[view.zone] : null, mult: cfg.zoneMult,
        free: credit?.ok ? creditLabel(credit) : null, creditNote: credit && !credit.ok ? creditNote(credit) : null
      } : null,
      rates: `${formatMoney(cfg.flagFall)} + ${formatMoney(cfg.perMile)}/mi`,
      noPlaces: !places.length,
      recent: mine.filter(r => !OPEN_RIDE.has(r.status)).slice(0, 5).map(r => this._cabbRide(r))
    };
  }
};

export const phone = {
  render(html) {
    if (this.app === "cabb") this._cabbAttach(html);
    else this._cabbNav?.detach();
  },
  /** Its map being dragged (a redraw would drop it). */
  busy() {
    return this.app === "cabb" && !!this._cabbNav?.dragging;
  }
};

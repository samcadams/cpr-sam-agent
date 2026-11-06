import { deepZoom, deepZoomTiles } from "../../scripts/util/deepZoom.js";
import { loadAreas, mapAreas } from "./sidecars.js";
import { esc } from "../../scripts/util/text.js";
import { EXPAND, expandedAt, isExpanded, pinGroups } from "./clusters.js";

/*
 * A map that moves and zooms: a scene's picture (from its Deep Zoom pyramid when it has one, see
 * util/deepZoom.js) with pins over it. Drag (mouse or one finger) to move, the wheel or a pinch to zoom,
 * arrow keys and +/- from the keyboard. Used by the Map app (pages/map.js); built to be reused (an
 * inline map in Messages).
 *
 * Drawn in HTML, in scene px: one "stage" holds the picture's tiles and the pins and is moved and scaled by
 * a single CSS transform, so moving the map rewrites one style however many pins there are. Pins keep
 * their size on screen by scaling themselves back (--navmap-inv). (Combat Cabb's map, an SVG redrawn
 * attribute by attribute, does the same for a few dozen places.)
 *
 * The view lives in a plain object the caller keeps ({ cx, cy, scale, key, fit }), so it survives
 * redraws; so do the picture's tiles (kept in this NavMap and moved to the new element).
 *
 * Districts: a picture with traced district outlines beside it (apps/map/sidecars.js) gets them as an SVG
 * layer: hovering outlines one; the picked pin's district (its `district`) is lit softly. Districts can't be
 * picked themselves.
 *
 * Roads: a picture with a roads overlay pyramid beside it (map.jpg → map.roads.dzi)
 * lights them in a circle around the mouse (the road lens: the overlay through a round, soft-edged mask). A route (apps/map/route.js) is drawn
 * as a glowing line over the roads (setRoute).
 *
 * Clusters (`cluster`, the Map app): zoomed out, a district's pins are hidden behind their count (a badge in the
 * district's name, or a bubble for one without a name pin); zooming in on a district, or tapping its count, opens
 * it (apps/map/clusters.js). Fewer pins are laid out each frame of a zoom. How soon they open: `expand` (setExpand).
 */

/** How far in: screen px per scene px at the most (a little past the picture's own pixels). */
const MAX_SCALE = 2;
/** A drag shorter than this (screen px) is a tap. */
const TAP = 5;
/** The crew's spot dropped this close (screen px) to a pin snaps to it. */
const SNAP = 26;
/**
 * The road lens: radius on screen (px) of the circle of lit roads around the mouse, zoomed all the way out; it
 * shrinks as you zoom in, down to LENS_MIN of that at the closest.
 */
const LENS = 56;
const LENS_MIN = 0.5;
/** Zoomed in past this (screen px per scene px), every pin's name shows. */
export const NAMES_AT = 0.45;
/** More pins than this showing, far out: small dots (see _apply). */
const CROWDED = 150;
/** The zoom still this long (ms): it has stopped, and the pins' shadows come back (see _apply). */
const ZOOM_SETTLE = 200;

export class NavMap {
  /**
   * @param {object} opts
   * @param {{ src, x, y, w, h }|null} opts.picture   the scene's picture, in scene px
   * @param {{ x, y, w, h }} opts.bounds               what can be looked at (the scene), in scene px
   * @param {{ x, y, w, h }} [opts.home]                where the map starts, and its "whole map" button (default: bounds)
   * @param {object[]} opts.pins                       mapPin()s (a pin's own `cls`: extra classes, e.g. Combat Cabb's zones)
   * @param {object} opts.view                         the caller's view state (kept between redraws)
   * @param {{ x, y, noteId }|null} [opts.crew]        the crew's GPS spot (scene px), or none
   * @param {boolean} [opts.crewEditable]              the crew's spot can be dragged (the GM)
   * @param {(pinId: string|null) => void} [opts.onPick]   a pin tapped (null: the map itself)
   * @param {(pinId: string|null) => void} [opts.onHover]  the pointer over a pin (null: off it)
   * @param {(spot: { x, y, noteId }) => void} [opts.onCrew] the crew's spot dropped somewhere (noteId: snapped to that pin)
   * @param {string|null} [opts.areas]                 the traced districts' URL (null: none; not given: beside the picture)
   * @param {string|null} [opts.overlay]               the roads overlay's .dzi URL (the same)
   * @param {boolean} [opts.cluster]                   group the pins by district when zoomed out (the Map app)
   */
  constructor({ picture, bounds, home, pins, view, crew, crewEditable, pinsEditable, mini, cluster, onPick, onHover, onCrew, onMove, onResize, menu, onMenu, areas, overlay }) {
    Object.assign(this, { picture, bounds, home: home ?? bounds, pins, view, crew, crewEditable, pinsEditable, mini, cluster, onPick, onHover, onCrew, onMove, onResize, menu, onMenu, areasUrl: areas, overlay });
    this.filter = null; // pin => whether it shows (the filter panel's)
    this.expand = EXPAND; // how soon groups open (clusters.js; null: all pins, never grouped)
    this.routes = []; // other routes to draw: [{ points, cls, label }] (the GM: players' routes, cabs)
    this.tiles = new Map(); // url → <img>, kept between redraws
    this.roadTiles = new Map(); // the same, for the roads overlay
    this.roadsAvailable = null; // whether the picture has a roads overlay (null: not known yet)
    this.selected = null;
    this._culledAt = null;
  }

  /** Give the map new data (a redraw), keeping the view and the tiles. */
  update({ picture, bounds, home, pins, view, crew, crewEditable, pinsEditable, areas, overlay }) {
    if (picture?.src !== this.picture?.src) this.tiles.clear();
    if (picture?.src !== this.picture?.src || overlay !== this.overlay) {
      this.roadTiles.clear();
      this.roadsAvailable = null;
    }
    Object.assign(this, { picture, bounds, home: home ?? bounds, pins, view, crew, crewEditable, pinsEditable, areasUrl: areas, overlay });
  }

  /** Draw into `root` (an empty .agent-navmap) and start listening. */
  attach(root) {
    this.detach();
    this.root = root;
    root.innerHTML = `<div class="agent-navmap-stage"><div class="agent-navmap-tiles"></div><div class="agent-navmap-roads"></div><div class="agent-navmap-areas"></div><div class="agent-navmap-route"></div><div class="agent-navmap-pins"></div></div>`;
    this.stage = root.firstElementChild;
    this.tileLayer = this.stage.firstElementChild;
    this._drawPins(this.stage.lastElementChild);
    this._countGroups();
    this._culledAt = null;
    this.roadLayer = this.stage.querySelector(".agent-navmap-roads");
    for (const img of this.tiles.values()) this.tileLayer.append(img);
    for (const img of this.roadTiles.values()) this.roadLayer.append(img);
    this._drawAreas();
    this._drawRoute();
    this._listen(root);
    this._resize = new ResizeObserver(() => this.draw());
    this._resize.observe(root);
    this.draw();
  }

  /** Whether the map is being dragged (a redraw now would drop it). */
  get dragging() {
    return !!this.root?.classList.contains("dragging");
  }

  detach() {
    this._resize?.disconnect();
    for (const g of this._groups ?? []) clearTimeout(g.timer);
    clearTimeout(this._zoomEnd);
    this._zoomedAt = undefined;
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    this.root = null;
  }

  /**
   * The pins, each a button-like dot with its icon, and its name beside it. Territories are their picture at
   * map scale (`size` scene px, `alpha`); districts are only their name (the GM also gets a small handle to
   * move them by). The GM's picked pin can be dragged, and a picked territory resized by its corner.
   */
  _drawPins(layer) {
    this._byId = new Map(this.pins.map(p => [p.id, p]));
    for (const g of this._groups ?? []) clearTimeout(g.timer);
    this._groups = this.cluster ? pinGroups(this.pins) : [];
    this._groupOf = new Map(this._groups.flatMap(g => g.pins.map(p => [p.id, g])));
    const labelOf = new Map(this._groups.map((g, i) => [g.label, i]));
    const pinHtml = p => {
      const cls = [
        "agent-navmap-pin", p.big ? "big" : "", p.territory ? "territory" : "", p.label ? "named" : "", p.gmOnly ? "gm-only" : "", p.temp ? "temp" : "",
        p.scene ? "linked" : "", p.id === this.selected ? "selected" : "", p.id === this.crew?.noteId ? "crew-here" : "",
        this.filter && !this.filter(p) ? "filtered" : "", p.cls ?? ""
      ].filter(Boolean).join(" ");
      const icon = p.icon ? `<img src="${esc(p.icon)}" alt="" draggable="false">` : `<i class="fas fa-location-dot"></i>`;
      const tip = [p.name, p.typeLabel, p.district].filter(Boolean).join(" · ");
      const look = p.territory ? `--size:${p.size}px;--alpha:${p.alpha};` : "";
      // In a group: where its pins open out from.
      const g = this._groupOf.get(p.id);
      const from = g ? `--from-x:${g.at.x - p.x}px;--from-y:${g.at.y - p.y}px;` : "";
      // A district's name carries its group's count.
      const count = labelOf.has(p) ? `<span class="agent-navmap-count" data-group="${labelOf.get(p)}" title="Zoom in" hidden></span>` : "";
      return `<div class="${cls}" data-pin="${esc(p.id)}" style="left:${p.x}px;top:${p.y}px;${p.color ? `--pin:${esc(p.color)};` : ""}${look}${from}" role="button" aria-label="${esc(tip)}" title="${esc(tip)}">`
        + (p.territory ? `<span class="agent-navmap-turf">${icon}</span>` : "")
        + `<span class="agent-navmap-dot">${p.territory ? "" : icon}</span><span class="agent-navmap-name">${esc(p.name)}${count}</span>`
        + (p.territory && this.pinsEditable ? `<span class="agent-navmap-resize" title="Drag to resize (the Map only)"></span>` : "")
        + `</div>`;
    };
    // Grouped (`cluster`): each district's pins in a group, shut until zoomed in on (_showGroups); a group with
    // no district pin has a bubble with its count. The pins outside groups (the districts' names) come after them,
    // so the names stay on top.
    const html = this._groups.map((g, i) => {
      const bubble = g.label ? "" : `<div class="agent-navmap-cluster" data-group="${i}" style="left:${g.at.x}px;top:${g.at.y}px" role="button" title="${esc(g.key ?? "No district")}: zoom in" hidden></div>`;
      return `<div class="agent-navmap-group collapsed" data-group="${i}">${bubble}${g.pins.map(pinHtml).join("")}</div>`;
    });
    html.push(...this.pins.filter(p => !this._groupOf.has(p.id)).map(pinHtml));
    // The crew's GPS spot, over the pins.
    if (this.crew) {
      html.push(`<div class="agent-navmap-crew${this.crewEditable ? " editable" : ""}" style="left:${this.crew.x}px;top:${this.crew.y}px" role="img" aria-label="The crew is here"`
        + `${this.crewEditable ? ` title="The crew is here. Drag to move them; drop on a pin to put them there."` : ` title="The crew is here"`}>`
        + `<span class="agent-navmap-crew-dot"><i class="fas fa-location-arrow"></i></span><span class="agent-navmap-crew-name">CREW</span></div>`);
    }
    layer.innerHTML = html.join("");
    this._groups.forEach((g, i) => {
      g.el = layer.querySelector(`.agent-navmap-group[data-group="${i}"]`);
      g.badge = layer.querySelector(`[data-group="${i}"]:is(.agent-navmap-count, .agent-navmap-cluster)`);
      g.open = null; // (not known until the view is: _showGroups)
    });
  }

  /** How many of each group's pins the filter lets through: its badge's (or bubble's) number. */
  _countGroups() {
    for (const g of this._groups ?? []) {
      g.n = this.filter ? g.pins.filter(p => this.filter(p)).length : g.pins.length;
      if (g.badge) {
        g.badge.textContent = g.n;
        g.badge.hidden = !!g.open || !g.n;
      }
    }
  }

  /**
   * Open the groups zoomed in on, shut the others (clusters.js isExpanded). Only a group that changes is
   * touched; one opening animates its pins out from its middle.
   */
  _showGroups(width, height) {
    let changed = false;
    for (const g of this._groups ?? []) {
      const open = this.expand === null || isExpanded(g, this.view, width, height, NAMES_AT, !!g.open, this.expand);
      if (open === g.open) continue;
      const was = g.open;
      g.open = open;
      changed = true;
      g.el.classList.toggle("collapsed", !open);
      if (g.badge) g.badge.hidden = open || !g.n;
      clearTimeout(g.timer);
      g.el.classList.remove("expanding");
      if (open && was === false) {
        g.el.classList.add("expanding");
        g.timer = setTimeout(() => g.el.classList.remove("expanding"), 300);
      }
    }
    if (changed) this._culledAt = null;
  }

  /** Whether a pin is hidden in a shut group (the picked pin, the crew's, temporary ones still show). */
  _hiddenInGroup(p) {
    const g = this._groupOf?.get(p.id);
    return !!g && g.open === false && p.id !== this.selected && p.id !== this.crew?.noteId && !p.temp;
  }

  /** Zoom in on a group until it opens (its count tapped). */
  _openGroup(g) {
    const r = this.root.getBoundingClientRect();
    const { x0, y0, x1, y1 } = g.box;
    const expand = this.expand ?? EXPAND;
    this.centreOn((x0 + x1) / 2, (y0 + y1) / 2, Math.min(expandedAt(g, r.width, r.height, expand), NAMES_AT * expand / EXPAND) * 1.05);
  }

  /** How soon groups open (the "Show pins" slider; null: all pins). */
  setExpand(expand) {
    this.expand = expand;
    this.draw();
  }

  /* -------------------------------------------- */
  /*  Districts                                   */
  /* -------------------------------------------- */

  /** The district outlines, once loaded: an SVG over the picture, in the picture's own px. */
  _drawAreas() {
    const pic = this.picture;
    const layer = this.stage?.querySelector(".agent-navmap-areas");
    if (!pic || !layer) return;
    const areas = this.areasUrl === undefined ? mapAreas(pic.src) : loadAreas(this.areasUrl);
    if (areas instanceof Promise) {
      areas.then(() => this.root?.contains(layer) && this._drawAreas());
      return;
    }
    this.areas = areas;
    if (!areas) return;
    Object.assign(layer.style, { left: `${pic.x}px`, top: `${pic.y}px`, width: `${pic.w}px`, height: `${pic.h}px` });
    layer.innerHTML = `<svg viewBox="0 0 ${areas.width} ${areas.height}" preserveAspectRatio="none" aria-hidden="true">${areas.districts.map(d => `<path data-area="${esc(d.name)}" d="${d.polygons.map(p => `M${p.join(" ")}Z`).join("")}"/>`).join("")}</svg>`;
    this._showAreas();
  }

  /** The district at a scene point, or null. */
  areaAt(x, y) {
    const pic = this.picture;
    const a = this.areas;
    if (!a || !pic) return null;
    const px = (x - pic.x) * (a.width / pic.w);
    const py = (y - pic.y) * (a.height / pic.h);
    return a.districts.find(d => d.polygons.some(p => inside(p, px, py)))?.name ?? null;
  }

  /** Light the picked pin's district softly, and outline the hovered one. */
  _showAreas() {
    const svg = this.stage?.querySelector(".agent-navmap-areas svg");
    if (!svg) return;
    const soft = this._byId?.get(this.selected)?.district ?? null;
    for (const path of svg.children) {
      const name = path.dataset.area;
      path.classList.toggle("soft", name === soft);
      path.classList.toggle("hover", name === this._hoverArea);
    }
  }

  /** How many pins show (the filter's), counted again when the pins or the filter change. */
  _shownCount() {
    if (this._shown?.pins !== this.pins || this._shown?.filter !== this.filter) {
      this._shown = { pins: this.pins, filter: this.filter, n: this.filter ? this.pins.filter(p => this.filter(p)).length : this.pins.length };
    }
    return this._shown.n;
  }

  /** Show only the pins `filter` lets through (null: all). */
  setFilter(filter) {
    this.filter = filter;
    if (!this.root) return;
    for (const el of this.root.querySelectorAll(".agent-navmap-pin")) {
      const pin = this._byId.get(el.dataset.pin);
      el.classList.toggle("filtered", !!filter && !!pin && !filter(pin));
    }
    this._countGroups();
    this._culledAt = null;
    this.draw();
  }

  /** Ring a pin (hovered in the filter panel), or none. */
  ring(id) {
    for (const el of this.root?.querySelectorAll(".agent-navmap-pin.ringed") ?? []) el.classList.remove("ringed");
    if (id) this.root?.querySelector(`.agent-navmap-pin[data-pin="${CSS.escape(id)}"]`)?.classList.add("ringed");
  }

  /** Centre on a pin, close enough to read the names around it. */
  jumpTo(id) {
    const pin = this._byId?.get(id);
    if (pin) this.centreOn(pin.x, pin.y, NAMES_AT * 1.2);
  }

  /** Centre on the crew's spot. */
  findCrew() {
    if (this.crew) this.centreOn(this.crew.x, this.crew.y, NAMES_AT);
  }

  /** Mark a pin as picked (or none). */
  select(id) {
    this.selected = id;
    if (!this.root) return;
    for (const el of this.root.querySelectorAll(".agent-navmap-pin.selected")) el.classList.remove("selected");
    if (id) this.root.querySelector(`.agent-navmap-pin[data-pin="${CSS.escape(id)}"]`)?.classList.add("selected");
    this._showAreas();
  }

  /* -------------------------------------------- */
  /*  The view                                    */
  /* -------------------------------------------- */

  /** The scale that shows the whole of a box (default: the whole map, as far out as it goes). */
  _fitScale(box = this.bounds) {
    const r = this.root.getBoundingClientRect();
    return Math.min(r.width / box.w, r.height / box.h) || 1;
  }

  _maxScale() {
    return Math.max(this._fitScale() * 2, MAX_SCALE);
  }

  /** Back to the starting view (home). */
  fit() {
    this.view.fit = true;
    this.draw();
  }

  /** Zoom by `factor` (over 1: in), keeping the scene point `at` (default: the middle) where it is on screen. */
  zoomBy(factor, at = null) {
    const v = this.view;
    v.fit = false;
    const scale = Math.min(this._maxScale(), Math.max(this._fitScale(), v.scale * factor));
    if (at) {
      const k = v.scale / scale;
      v.cx = at.x - (at.x - v.cx) * k;
      v.cy = at.y - (at.y - v.cy) * k;
    }
    v.scale = scale;
    this.draw();
  }

  /** Move the view by screen px. */
  panBy(dx, dy) {
    this.view.fit = false;
    this.view.cx -= dx / this.view.scale;
    this.view.cy -= dy / this.view.scale;
    this.draw();
  }

  /** Centre on a scene point (zooming in to at least `scale`). */
  centreOn(x, y, scale = null) {
    Object.assign(this.view, { cx: x, cy: y, fit: false });
    if (scale) this.view.scale = Math.max(this.view.scale, scale);
    this.draw();
  }

  /** Keep the view on the map: the map can't be pushed off screen, and is centred when it's smaller than it. */
  _clamp(width, height) {
    const v = this.view;
    const b = this.bounds;
    v.scale = Math.min(this._maxScale(), Math.max(this._fitScale(), v.scale || 0));
    const halfW = width / 2 / v.scale;
    const halfH = height / 2 / v.scale;
    v.cx = b.w <= halfW * 2 ? b.x + b.w / 2 : Math.min(b.x + b.w - halfW, Math.max(b.x + halfW, v.cx));
    v.cy = b.h <= halfH * 2 ? b.y + b.h / 2 : Math.min(b.y + b.h - halfH, Math.max(b.y + halfH, v.cy));
  }

  /** A screen point → the scene. */
  toScene(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    const v = this.view;
    return { x: v.cx + (clientX - r.left - r.width / 2) / v.scale, y: v.cy + (clientY - r.top - r.height / 2) / v.scale };
  }

  /** Redraw on the next frame (at most once a frame, however fast the pointer moves). */
  draw() {
    if (!this.root || this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this._apply();
    });
  }

  _apply() {
    if (!this.root?.isConnected) return;
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // A different map (another scene) or a first look: the home view. Until it's moved, the home view
    // stays in view as the window changes size (turning the phone).
    const key = `${this.bounds.x} ${this.bounds.y} ${this.bounds.w} ${this.bounds.h}`;
    if (this.view.key !== key || !this.view.scale) Object.assign(this.view, { key, fit: true });
    if (this.view.fit) {
      const h = this.home;
      Object.assign(this.view, { cx: h.x + h.w / 2, cy: h.y + h.h / 2, scale: this._fitScale(h) });
    }
    this._clamp(r.width, r.height);
    const v = this.view;
    const tx = r.width / 2 - v.cx * v.scale;
    const ty = r.height / 2 - v.cy * v.scale;
    this.stage.style.transform = `translate(${tx}px, ${ty}px) scale(${v.scale})`;
    this.stage.style.setProperty("--navmap-inv", 1 / v.scale);
    this.root.classList.toggle("names", v.scale >= NAMES_AT);
    this.root.classList.toggle("editable", !!this.pinsEditable);
    // Hundreds of pins seen from far out (the GM's map): small dots, no icons, until zoomed in a little.
    this.root.classList.toggle("far", v.scale < NAMES_AT / 2.5 && this._shownCount() > CROWDED);
    this.root.classList.toggle("zoomed", v.scale > this._fitScale() * 1.01);
    this._showGroups(r.width, r.height);
    // While the zoom changes, the pins' soft shadows are left off (map.css): every frame redraws them at the new size.
    if (this._zoomedAt !== undefined && v.scale !== this._zoomedAt) {
      this.root.classList.add("zooming");
      clearTimeout(this._zoomEnd);
      this._zoomEnd = setTimeout(() => this.root?.classList.remove("zooming"), ZOOM_SETTLE);
    }
    this._zoomedAt = v.scale;
    if (v.scale !== this._culledAt) {
      this._cullNames();
      this._routeScale();
    }
    this._picture(r);
  }

  /**
   * Names that always show (districts and the like) mustn't pile up when zoomed out: one that would
   * overlap a name already placed waits until there's room (the pin and its tooltip still show). Only the
   * zoom changes how they overlap (and groups opening or shutting), so this runs when it does. Every name is
   * measured before any is culled (one layout, not one per name).
   */
  _cullNames() {
    this._culledAt = this.view.scale;
    const placed = [];
    const names = [];
    for (const el of this.root.querySelectorAll(".agent-navmap-pin.named:not(.filtered)")) {
      const name = el.lastElementChild;
      const pin = this._byId.get(el.dataset.pin);
      if (name && pin && !this._hiddenInGroup(pin)) names.push({ name, pin });
    }
    for (const { name } of names) name.classList.remove("culled");
    for (const n of names) [n.w, n.h] = [n.name.offsetWidth, n.name.offsetHeight];
    for (const { name, pin, w, h } of names) {
      // Where it's drawn (map.css): districts' and territories' names centred on the pin, the others' under it.
      const x = pin.x * this.view.scale - w / 2;
      const y = pin.y * this.view.scale + (pin.big || pin.territory ? -h / 2 : 15);
      const gap = 6; // (screen px between names)
      if (placed.some(b => x < b.x + b.w + gap && b.x < x + w + gap && y < b.y + b.h + gap && b.y < y + h + gap)) name.classList.add("culled");
      else placed.push({ x, y, w, h });
    }
  }

  /**
   * The picture: with a Deep Zoom pyramid, the whole picture at screen size and the part in view at the
   * zoom's size (finer tiles drawn over coarser ones); without one, the picture itself.
   */
  _picture(rect) {
    const pic = this.picture;
    if (!pic) return;
    this._layer(pic, pic.src, this.tileLayer, this.tiles, rect, true);
    // The roads overlay (map.jpg → map.roads.dzi), when there is one, seen through the road lens.
    const roads = { ...pic, src: this.overlay === undefined ? roadsSrc(pic.src) : this.overlay };
    if (!roads.src) {
      this.roadsAvailable = false;
      this.root.classList.remove("road-lens");
      return;
    }
    const dz = deepZoom(roads.src);
    if (dz instanceof Promise) {
      dz.then(() => this.draw());
      return;
    }
    this.roadsAvailable = !!dz;
    const lens = !!dz && !!this._lens;
    this.root.classList.toggle("road-lens", lens);
    this._applyLens();
    if (lens) this._layer(roads, roads.src, this.roadLayer, this.roadTiles, rect, false);
    else this._layer(roads, roads.src, this.roadLayer, this.roadTiles, rect, false, true);
  }

  /**
   * One picture's tiles into a layer: with a Deep Zoom pyramid, the whole picture at screen size and the part
   * in view at the zoom's size (finer tiles drawn over coarser ones); without one, the picture itself (`whole`)
   * or nothing. `none`: take them all away. Tiles already there stay (no reloading).
   */
  _layer(pic, src, layer, cache, rect, whole, none = false) {
    const want = [];
    const dz = none ? null : deepZoom(src);
    if (dz instanceof Promise) {
      dz.then(() => this.draw());
      return;
    }
    if (!none && !dz && whole) want.push({ url: src, x: 0, y: 0, w: 1, h: 1, level: 0 });
    else if (dz) {
      const dpr = window.devicePixelRatio || 1;
      const v = this.view;
      const all = deepZoomTiles(dz, Math.max(256, pic.w * this._fitScale() * dpr));
      want.push(...all.tiles.map(t => ({ ...t, level: all.level })));
      const halfW = rect.width / 2 / v.scale;
      const halfH = rect.height / 2 / v.scale;
      const part = { x0: (v.cx - halfW - pic.x) / pic.w, y0: (v.cy - halfH - pic.y) / pic.h, x1: (v.cx + halfW - pic.x) / pic.w, y1: (v.cy + halfH - pic.y) / pic.h };
      const near = deepZoomTiles(dz, pic.w * v.scale * dpr, part);
      if (near.level > all.level) want.push(...near.tiles.map(t => ({ ...t, level: near.level })));
    }
    const keep = new Set();
    for (const t of want) {
      keep.add(t.url);
      if (cache.has(t.url)) continue;
      const img = document.createElement("img");
      img.className = "agent-navmap-tile";
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      Object.assign(img.style, {
        left: `${pic.x + t.x * pic.w}px`, top: `${pic.y + t.y * pic.h}px`,
        width: `${t.w * pic.w}px`, height: `${t.h * pic.h}px`, zIndex: t.level
      });
      img.src = t.url;
      cache.set(t.url, img);
      layer.append(img);
    }
    for (const [url, img] of cache) {
      if (keep.has(url)) continue;
      img.remove();
      cache.delete(url);
    }
  }

  /**
   * The route to draw: { points: [x0, y0, …] (scene px) } or null. A glowing line, a dot at the start and a
   * ring at the end, kept the same width on screen however far in.
   */
  setRoute(route) {
    this.route = route;
    this._drawRoute();
  }

  /** Other routes, drawn under this phone's own: [{ points, cls ("player", "cabb"), label }] (the GM's). */
  setRoutes(routes) {
    this.routes = routes ?? [];
    this._drawRoute();
  }

  _drawRoute() {
    const layer = this.stage?.querySelector(".agent-navmap-route");
    if (!layer) return;
    const all = [...(this.routes ?? []).map(r => ({ ...r, cls: `other ${r.cls ?? ""}` })), ...(this.route ? [{ ...this.route, cls: "own" }] : [])]
      .filter(r => r.points?.length >= 4);
    layer.innerHTML = all.map(r => routeSvg(r)).join("");
    this._routeScale();
  }

  /** The route's ends stay the same size on screen (their radius follows the zoom). */
  _routeScale() {
    const inv = 1 / (this.view.scale || 1);
    for (const c of this.stage?.querySelectorAll(".agent-navmap-route circle") ?? []) c.setAttribute("r", (c.classList.contains("end") ? 8 : 6) * inv);
  }

  /**
   * The road lens: the roads overlay seen only through a circle around the mouse (this._lens: its screen
   * point), drawn as a mask in the stage's scene px. Its radius on screen is LENS zoomed all the way out and
   * shrinks (by the zoom's log) to LENS × LENS_MIN at the closest.
   */
  _applyLens() {
    const layer = this.roadLayer;
    if (!layer) return;
    const b = this.bounds;
    // The layer must cover the scene for its mask to.
    Object.assign(layer.style, { width: `${b.x + b.w}px`, height: `${b.y + b.h}px` });
    if (!this._lens || !this.root?.classList.contains("road-lens")) {
      layer.style.maskImage = layer.style.webkitMaskImage = "";
      return;
    }
    const at = this.toScene(this._lens.x, this._lens.y);
    const fit = this._fitScale(), max = this._maxScale();
    const t = max > fit ? Math.min(1, Math.max(0, Math.log(this.view.scale / fit) / Math.log(max / fit))) : 0;
    const r = LENS * (1 - (1 - LENS_MIN) * t) / this.view.scale;
    const mask = `radial-gradient(circle ${r}px at ${at.x}px ${at.y}px, #000 55%, transparent 100%)`;
    layer.style.maskImage = layer.style.webkitMaskImage = mask;
  }

  /** A spot the crew was dropped on: the shown pin within SNAP screen px (the closest), or the spot itself. */
  _snap(at) {
    let best = null;
    let bestD = SNAP / this.view.scale;
    for (const p of this.pins) {
      if ((this.filter && !this.filter(p)) || this._hiddenInGroup(p)) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d <= bestD) [best, bestD] = [p, d];
    }
    return best ? { x: best.x, y: best.y, noteId: best.id } : { x: Math.round(at.x), y: Math.round(at.y), noteId: null };
  }

  /* -------------------------------------------- */
  /*  The menu (right-click or long press)        */
  /* -------------------------------------------- */

  /**
   * The menu at a screen point: `menu(at)` (at: the scene point) gives its items, [{ id, label, icon }];
   * picking one calls `onMenu(id, at)`.
   */
  _openMenu(client) {
    this._closeMenu();
    if (!this.root) return;
    const at = this.toScene(client.x, client.y);
    const items = this.menu?.(at) ?? [];
    if (!items.length) return;
    const r = this.root.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "agent-navmap-menu";
    el.setAttribute("role", "menu");
    el.innerHTML = items.map(i => `<button type="button" role="menuitem" data-item="${esc(i.id)}"><i class="fas ${esc(i.icon ?? "fa-location-dot")}"></i> ${esc(i.label)}</button>`).join("");
    el.style.left = `${Math.min(client.x - r.left, r.width - 210)}px`;
    el.style.top = `${Math.min(client.y - r.top, r.height - items.length * 30 - 10)}px`;
    // (the map's own pointer handling stays out of it)
    el.addEventListener("pointerdown", event => event.stopPropagation());
    el.addEventListener("click", event => {
      const id = event.target.closest("[data-item]")?.dataset.item;
      if (!id) return;
      this._closeMenu();
      this.onMenu?.(id, at);
    });
    this.root.append(el);
    // Mark where it was opened.
    const mark = document.createElement("div");
    mark.className = "agent-navmap-menu-mark";
    Object.assign(mark.style, { left: `${at.x}px`, top: `${at.y}px` });
    this.stage.append(mark);
    this._menu = [el, mark];
  }

  _closeMenu() {
    for (const el of this._menu ?? []) el.remove();
    this._menu = null;
  }

  /* -------------------------------------------- */
  /*  Input                                       */
  /* -------------------------------------------- */

  _listen(root) {
    // An inline map (apps/map/embed.js) stays put: a tap (or Enter) is all it takes, and the page scrolls past it.
    if (this.mini) {
      const open = () => this.onPick?.(null);
      root.closest(".agent-mapembed")?.addEventListener("click", open);
      root.closest(".agent-mapembed")?.addEventListener("keydown", event => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), open()));
      return;
    }
    root.addEventListener("wheel", event => {
      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? 1.25 : 0.8, this.toScene(event.clientX, event.clientY));
    }, { passive: false });

    // One finger (or the mouse) drags the map; two pinch. A drag isn't a tap on a pin.
    const pointers = new Map();
    let moved = 0;
    let pinch = null;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: this.toScene((a.x + b.x) / 2, (a.y + b.y) / 2) };
    };
    // GM: the crew's spot is dragged on its own (the map stays put); so is the picked pin, and a picked
    // territory's size by its corner.
    let crewDrag = null;
    let pinDrag = null;
    // A long press (a finger, or the mouse held still) opens the menu, as a right-click does.
    let press = 0;
    const cancelPress = () => (clearTimeout(press), (press = 0));
    root.addEventListener("pointerdown", event => {
      this._closeMenu();
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const crewEl = this.crewEditable && event.target.closest?.(".agent-navmap-crew");
      if (crewEl) {
        event.stopPropagation();
        crewDrag = { id: event.pointerId, el: crewEl };
        root.setPointerCapture(event.pointerId);
        root.classList.add("dragging", "dragging-crew");
        return;
      }
      const pinEl = this.pinsEditable && event.target.closest?.(".agent-navmap-pin.selected");
      // (a territory moves by its dot, so the map can still be dragged across its picture)
      const grip = pinEl && event.target.closest(".agent-navmap-dot, .agent-navmap-resize");
      if (grip) {
        event.stopPropagation();
        const pin = this._byId.get(pinEl.dataset.pin);
        pinDrag = { id: event.pointerId, el: pinEl, pin, resize: grip.matches(".agent-navmap-resize"), start: { x: event.clientX, y: event.clientY } };
        root.setPointerCapture(event.pointerId);
        root.classList.add("dragging", "dragging-pin");
        return;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) moved = 0;
      pinch = pointers.size === 2 ? spread() : null;
      cancelPress();
      if (pointers.size === 1 && this.menu) {
        const at = { x: event.clientX, y: event.clientY };
        press = setTimeout(() => {
          press = 0;
          if (moved > TAP || pointers.size !== 1) return;
          pointers.clear();
          root.classList.remove("dragging");
          this._suppressTap = true;
          this._openMenu(at);
        }, 550);
      }
    });
    root.addEventListener("contextmenu", event => {
      if (!this.menu) return;
      event.preventDefault();
      cancelPress();
      this._openMenu({ x: event.clientX, y: event.clientY });
    });
    root.addEventListener("pointermove", event => {
      if (crewDrag?.id === event.pointerId) {
        const at = this.toScene(event.clientX, event.clientY);
        Object.assign(crewDrag.el.style, { left: `${at.x}px`, top: `${at.y}px` });
        crewDrag.at = at;
        return;
      }
      if (pinDrag?.id === event.pointerId) {
        const at = this.toScene(event.clientX, event.clientY);
        if (Math.hypot(event.clientX - pinDrag.start.x, event.clientY - pinDrag.start.y) <= TAP && !pinDrag.at) return;
        if (pinDrag.resize) {
          // The corner sits on the square's edge: twice the larger of the distances from the middle.
          const size = Math.max(Math.abs(at.x - pinDrag.pin.x), Math.abs(at.y - pinDrag.pin.y)) * 2;
          pinDrag.el.style.setProperty("--size", `${Math.max(20, size)}px`);
          pinDrag.at = { size };
        } else {
          Object.assign(pinDrag.el.style, { left: `${at.x}px`, top: `${at.y}px` });
          pinDrag.at = at;
        }
        return;
      }
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      moved += Math.hypot(dx, dy);
      p.x = event.clientX;
      p.y = event.clientY;
      if (moved > TAP) cancelPress();
      if (moved > TAP && !root.hasPointerCapture(event.pointerId)) {
        root.setPointerCapture(event.pointerId);
        root.classList.add("dragging");
      }
      if (pinch && pointers.size === 2) {
        const now = spread();
        if (pinch.d > 0) this.zoomBy(now.d / pinch.d, pinch.mid);
        pinch = { ...now, mid: pinch.mid };
      } else if (pointers.size === 1 && moved > TAP) this.panBy(dx, dy);
    });
    const up = event => {
      if (crewDrag?.id === event.pointerId) {
        const { at } = crewDrag;
        crewDrag = null;
        root.classList.remove("dragging", "dragging-crew");
        if (at && event.type === "pointerup") this.onCrew?.(this._snap(at));
        return;
      }
      if (pinDrag?.id === event.pointerId) {
        const { at, pin, resize, el } = pinDrag;
        pinDrag = null;
        root.classList.remove("dragging", "dragging-pin");
        if (!at) return;
        if (event.type !== "pointerup") {
          // Put it back as it was.
          Object.assign(el.style, { left: `${pin.x}px`, top: `${pin.y}px` });
          if (pin.territory) el.style.setProperty("--size", `${pin.size}px`);
          return;
        }
        if (resize) this.onResize?.(pin.id, Math.round(at.size));
        else {
          // Moved here until the scene says so (the redraw after its update).
          Object.assign(pin, { x: Math.round(at.x), y: Math.round(at.y) });
          this.onMove?.(pin.id, { x: pin.x, y: pin.y });
        }
        return;
      }
      cancelPress();
      if (!pointers.delete(event.pointerId)) return;
      pinch = null;
      if (!pointers.size) root.classList.remove("dragging");
      if (this._suppressTap) {
        this._suppressTap = false;
        return;
      }
      if (event.type !== "pointerup" || pointers.size || moved > TAP) return;
      // A tap: a group's count (zoom in on it), the pin under it (the topmost), or the map itself (none).
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const count = hit?.closest?.(".agent-navmap-count, .agent-navmap-cluster");
      if (count && root.contains(count)) return this._openGroup(this._groups[count.dataset.group]);
      const pin = hit?.closest?.(".agent-navmap-pin");
      this.onPick?.(pin && root.contains(pin) ? pin.dataset.pin : null);
    };
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);

    // The pin under the pointer, for the filter panel.
    let hovered = null;
    root.addEventListener("pointerover", event => {
      const id = event.target.closest?.(".agent-navmap-pin")?.dataset.pin ?? null;
      if (id === hovered) return;
      hovered = id;
      this.onHover?.(id);
    });
    root.addEventListener("pointerleave", () => {
      if (hovered) this.onHover?.((hovered = null));
      if (this._lens) {
        this._lens = null;
        this.draw();
      }
      if (this._hoverArea) {
        this._hoverArea = null;
        this._showAreas();
      }
    });
    // The road lens follows a mouse (not a finger, not while dragging the map).
    root.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse" || !this.roadsAvailable) return;
      const was = this._lens;
      this._lens = pointers.size ? null : { x: event.clientX, y: event.clientY };
      // The first time: load the overlay's tiles (draw); after, only the mask moves.
      if (!was || !this._lens) this.draw();
      else this._applyLens();
    });
    // The district under a mouse (not while dragging), once a frame.
    let areaFrame = 0;
    root.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse" || pointers.size || areaFrame || !this.areas) return;
      areaFrame = requestAnimationFrame(() => {
        areaFrame = 0;
        const at = this.toScene(event.clientX, event.clientY);
        const area = this.areaAt(at.x, at.y);
        if (area === this._hoverArea) return;
        this._hoverArea = area;
        this._showAreas();
      });
    });

    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && this._menu) return this._closeMenu();
      const step = 60;
      const keys = {
        ArrowLeft: () => this.panBy(step, 0), ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step), ArrowDown: () => this.panBy(0, -step),
        "+": () => this.zoomBy(1.25), "=": () => this.zoomBy(1.25), "-": () => this.zoomBy(0.8), "0": () => this.fit()
      };
      if (!(event.key in keys)) return;
      event.preventDefault();
      keys[event.key]();
    });
  }
}

/**
 * One route as an SVG: a glowing line, a dot at the start and a ring at the end, and its label (whose route it
 * is) by the end. The SVG covers the route's own box (with room for the ends): a tiny SVG relying on overflow
 * gets culled.
 */
function routeSvg({ points: p, cls, label }) {
  const line = [];
  for (let i = 0; i < p.length; i += 2) line.push(`${p[i]},${p[i + 1]}`);
  const [x0, y0, x1, y1] = [p[0], p[1], p.at(-2), p.at(-1)];
  const xs = p.filter((_, i) => i % 2 === 0);
  const ys = p.filter((_, i) => i % 2 === 1);
  const pad = 400;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  const pts = line.join(" ");
  return `<div class="agent-navmap-routeline ${esc(cls)}"><svg style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" aria-hidden="true">`
    + `<polyline class="glow" points="${pts}"/><polyline class="core" points="${pts}"/><polyline class="flow" points="${pts}"/>`
    + `<circle class="start" cx="${x0}" cy="${y0}" r="1"/><circle class="end" cx="${x1}" cy="${y1}" r="1"/></svg>`
    + (label ? `<span class="agent-navmap-routelabel" style="left:${x1}px;top:${y1}px">${esc(label)}</span>` : "")
    + `</div>`;
}

/** Whether a point is inside a polygon [x0, y0, x1, y1, …] (even-odd). */
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [poly[i], poly[i + 1], poly[j], poly[j + 1]];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The roads overlay beside a picture: map.jpg → map.roads.png (its pyramid: map.roads.dzi). */
const roadsSrc = src => src.replace(/(\.[^./?#]+)?([?#].*)?$/, ".roads.png");

import { UNCATEGORISED } from "./model.js";
import { SHOW_PINS, SHOW_PINS_DEFAULT } from "./clusters.js";
import { esc } from "../../scripts/util/text.js";

/*
 * The Map's filter panel: CPR Pin Filter's panel (modules/cpr-pin-filter/scripts/panel.js), on the phone.
 * Categories folded into the GM's groups (Pin Filter's settings), a checkbox per group (all, some or none of
 * its categories) and per category, counts, a search through categories and pins, show all / hide all,
 * right-click a row to show only that, open a category for its pins, and tap a pin to jump to it. Hovering a
 * pin's entry rings it on the map; hovering a pin on the map marks its entry; tapping one opens its entry.
 * GM: a switch for the pins no player sees. The gear: NAV Settings, a popup beside the panel ("Show pins").
 *
 * It draws and redraws itself (not the phone), so typing a search or ticking a box doesn't redraw the map.
 * What it shows lives in `state`, which the caller keeps between redraws (and saves what should last):
 * { hidden: Set<category>, showGm, collapsed, search, expanded: Set<group>, open: Set<category>, hovered,
 *   showPins (the slider's stop: clusters.js SHOW_PINS), settings (the popup open; not saved) }.
 */

/** The state of a fresh panel. */
export const filterState = (saved = {}) => ({
  hidden: new Set(saved.hidden ?? []),
  showGm: saved.showGm ?? true,
  collapsed: !!saved.collapsed,
  search: "",
  expanded: new Set(),
  open: new Set(),
  hovered: null,
  showPins: typeof saved.showPins === "number" && Number.isFinite(saved.showPins)
    ? Math.min(Math.max(Math.round(saved.showPins), 0), SHOW_PINS.length - 1) : SHOW_PINS_DEFAULT,
  settings: false
});

export class NavFilter {
  /**
   * @param {object} opts
   * @param {object} opts.state                       filterState(), kept by the caller
   * @param {object[]} opts.pins                      mapPin()s (what this user sees)
   * @param {Map<string, string>} opts.categories     id → label (apps/map/model.js mapCategories)
   * @param {{ id, label, categories }[]} opts.groups the GM's groups
   * @param {boolean} opts.isGM
   * @param {import("./navMap.js").NavMap} opts.map
   * @param {(what: "filter"|"collapse"|"settings") => void} [opts.onChange]  the filter or the panel changed (save it)
   * @param {(pinId: string) => void} [opts.onJump]   a pin picked in the list
   */
  constructor(opts) {
    Object.assign(this, opts);
    this._search = foundry.utils.debounce(() => this.render(), 200);
  }

  /** Whether a pin shows on the map. */
  passes(pin) {
    if (this.state.hidden.has(pin.type)) return false;
    return !(this.isGM && !this.state.showGm && pin.gmOnly);
  }

  /** Pins counted in the panel (the GM switch hides the GM-only ones from the counts too). */
  _countable() {
    return this.isGM && !this.state.showGm ? this.pins.filter(p => !p.gmOnly) : this.pins;
  }

  attach(root) {
    this.root = root;
    root.addEventListener("click", event => this._onClick(event));
    root.addEventListener("change", event => this._onChange(event));
    root.addEventListener("contextmenu", event => this._onSolo(event));
    root.addEventListener("input", event => {
      if (event.target.matches("input[name=mapfShowPins]")) return this._showPins(Number(event.target.value));
      if (!event.target.matches("input[name=mapfSearch]")) return;
      this.state.search = event.target.value;
      this._search();
    });
    root.addEventListener("mouseover", event => {
      const pin = event.target.closest(".agent-mapf-pin");
      if (pin && !pin.contains(event.relatedTarget)) this.map.ring(pin.dataset.pin);
    });
    root.addEventListener("mouseout", event => {
      const pin = event.target.closest(".agent-mapf-pin");
      if (pin && !pin.contains(event.relatedTarget)) this.map.ring(null);
    });
    // Keys typed into the panel aren't Foundry's.
    root.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape" && this.state.settings) this._settings(false);
    });
    this.render();
  }

  /** Show or hide pins on the map by the filter. */
  apply() {
    this.map.setFilter(pin => this.passes(pin));
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  _data() {
    const { state, categories } = this;
    const pins = this._countable();
    const counts = new Map();
    const byType = new Map();
    for (const p of pins) {
      counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    for (const list of byType.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const term = state.search.trim().toLowerCase();
    const matches = text => String(text).toLowerCase().includes(term);

    /**
     * A category's row. While searching, a category stays if its name matches (as it is) or some of its pins
     * do (opened, with only those pins). Null: left out.
     */
    const row = (id, keep = false) => {
      const label = categories.get(id);
      let open = state.open.has(id);
      let list = byType.get(id) ?? [];
      let pinMatch = false;
      if (term && !keep) {
        const found = list.filter(p => matches(p.name));
        if (found.length) {
          list = found;
          open = pinMatch = true;
        } else if (!matches(label)) return null;
      }
      return { id, label, count: counts.get(id), visible: !state.hidden.has(id), open, pins: open ? list : [], pinMatch };
    };
    // Categories with no pins this user sees are left out.
    const listed = id => categories.has(id) && counts.has(id);

    const grouped = new Set();
    const groups = [];
    for (const group of this.groups) {
      const ids = (group.categories ?? []).filter(listed);
      ids.forEach(id => grouped.add(id));
      const groupMatch = !!term && matches(group.label);
      const members = ids.map(id => row(id) ?? (groupMatch ? row(id, true) : null)).filter(Boolean);
      if (!members.length) continue;
      // A group of one category is that category alone, so one tap opens its pins.
      if (ids.length === 1) {
        groups.push({ ...members[0], single: true, label: `${group.label} / ${members[0].label}` });
        continue;
      }
      const shown = members.filter(m => m.visible).length;
      groups.push({
        id: group.id, label: group.label, members,
        count: members.reduce((n, m) => n + m.count, 0),
        checked: shown === members.length,
        some: shown > 0 && shown < members.length,
        expanded: state.expanded.has(group.id) || (!!term && members.some(m => m.pinMatch || matches(m.label)))
      });
    }
    const ungrouped = [...categories.keys()].filter(id => listed(id) && !grouped.has(id)).map(id => row(id)).filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
    const total = pins.length;
    const shown = pins.filter(p => !state.hidden.has(p.type)).length;
    return { groups, ungrouped, total, shown, none: !!term && !groups.length && !ungrouped.length };
  }

  _categoryHtml(c) {
    const pins = c.open ? `<ol class="agent-mapf-pins">${c.pins.map(p => `
      <li class="agent-mapf-pin${p.id === this.state.hovered ? " hovered" : ""}" data-pin="${esc(p.id)}">
        <a class="agent-mapf-pin-name" data-mapf="jump">${esc(p.name)}</a>${p.scene ? `
        <i class="agent-mapf-scene fas fa-film" title="Has linked scenes (GM)"></i>` : ""}
        <a class="agent-mapf-jump" data-mapf="jump" title="Jump to the pin" aria-label="Jump to ${esc(p.name)}"><i class="fas fa-crosshairs"></i></a>
      </li>`).join("")}</ol>` : "";
    return `<li class="agent-mapf-category${c.open ? " open" : ""}" data-category="${esc(c.id)}">
      <div class="agent-mapf-row" data-solo>
        <input type="checkbox" data-mapf-category="${esc(c.id)}" ${c.visible ? "checked" : ""} title="Show / hide on the map" aria-label="Show ${esc(c.label)}">
        <a class="agent-mapf-toggle" data-mapf="open"><i class="agent-mapf-caret fas fa-caret-right"></i><span class="agent-mapf-label">${esc(c.label)}</span><span class="agent-mapf-count">${c.count}</span></a>
      </div>${pins}</li>`;
  }

  render() {
    if (!this.root?.isConnected) return;
    const d = this._data();
    const { state } = this;
    const list = this.root.querySelector(".agent-mapf-list");
    const scroll = list?.scrollTop ?? 0;
    const search = this.root.querySelector("input[name=mapfSearch]");
    const caret = search && search === document.activeElement ? search.selectionStart : null;
    const groups = d.groups.map(g => (g.single ? this._categoryHtml(g) : `
      <li class="agent-mapf-group${g.expanded ? " expanded" : ""}" data-group="${esc(g.id)}">
        <div class="agent-mapf-row agent-mapf-group-row" data-solo>
          <input type="checkbox" data-mapf-group="${esc(g.id)}" ${g.checked ? "checked" : ""} ${g.some ? "data-some" : ""} title="Show / hide on the map" aria-label="Show ${esc(g.label)}">
          <a class="agent-mapf-toggle" data-mapf="expand"><i class="agent-mapf-caret fas fa-caret-right"></i><span class="agent-mapf-label">${esc(g.label)}</span><span class="agent-mapf-count">${g.count}</span></a>
        </div>
        <ol class="agent-mapf-members">${g.members.map(m => this._categoryHtml(m)).join("")}</ol>
      </li>`));
    this.root.classList.toggle("collapsed", state.collapsed);
    const all = SHOW_PINS[state.showPins] === null;
    this.root.innerHTML = `
      <header class="agent-mapf-header">
        <i class="fas fa-filter"></i><h3>Night City Nav</h3>
        <span class="agent-mapf-total" title="Pins shown / total">${d.shown}/${d.total}</span>
        <a class="agent-mapf-gear${state.settings ? " active" : ""}" data-mapf="settings" title="Map settings" aria-label="Map settings" aria-expanded="${state.settings}"><i class="fas fa-gear"></i></a>
        <a data-mapf="collapse" title="${state.collapsed ? "Open the filter" : "Fold the filter away"}" aria-label="${state.collapsed ? "Open the filter" : "Fold the filter away"}" aria-expanded="${!state.collapsed}"><i class="fas ${state.collapsed ? "fa-chevron-down" : "fa-chevron-up"}"></i></a>
      </header>
      <div class="agent-mapf-body">
        <div class="agent-mapf-toolbar">
          <input type="search" name="mapfSearch" value="${esc(state.search)}" placeholder="Search pins & categories…" aria-label="Search pins and categories" autocomplete="off">
          <a data-mapf="show-all" title="Show all" aria-label="Show all"><i class="fas fa-eye"></i></a>
          <a data-mapf="hide-all" title="Hide all" aria-label="Hide all"><i class="fas fa-eye-slash"></i></a>
        </div>
        ${this.isGM ? `<a class="agent-mapf-gm${state.showGm ? " active" : ""}" data-mapf="toggle-gm" role="switch" aria-checked="${state.showGm}"><i class="fas ${state.showGm ? "fa-toggle-on" : "fa-toggle-off"}"></i> Show GM pins</a>` : ""}
        <ol class="agent-mapf-list">${groups.join("")}${d.ungrouped.map(c => this._categoryHtml(c)).join("")}</ol>
        ${d.none ? `<p class="agent-mapf-empty">No pins or categories match.</p>` : ""}
        <p class="agent-mapf-hint">Right-click a row to show only that.</p>
      </div>
      <div class="agent-mapf-settings" ${state.settings ? "" : "hidden"}>
        <h4>NAV Settings</h4>
        <label class="agent-mapf-setting">
          <span class="agent-mapf-setting-label">Show pins <span class="agent-mapf-readout" ${all ? "" : "hidden"}>All pins</span></span>
          <input type="range" name="mapfShowPins" min="0" max="${SHOW_PINS.length - 1}" step="1" value="${state.showPins}">
          <span class="agent-mapf-ends"><span>Sooner</span><span>Later</span></span>
        </label>
      </div>`;
    if (state.settings) this._listen(true);
    for (const box of this.root.querySelectorAll("input[data-some]")) box.indeterminate = true;
    const newList = this.root.querySelector(".agent-mapf-list");
    if (newList) newList.scrollTop = scroll;
    if (caret !== null) {
      const box = this.root.querySelector("input[name=mapfSearch]");
      box.focus();
      box.setSelectionRange(caret, caret);
    }
  }

  /* -------------------------------------------- */
  /*  The map and the panel, linked               */
  /* -------------------------------------------- */

  /** Open the panel on a pin (tapped on the map): its group and category, scrolled to and marked. */
  reveal(pinId) {
    const pin = this.pins.find(p => p.id === pinId);
    if (!pin || !this.root) return;
    const { state } = this;
    state.search = "";
    for (const group of this.groups) if (group.categories?.includes(pin.type)) state.expanded.add(group.id);
    state.open.add(pin.type);
    state.hovered = pinId;
    this.render();
    if (!state.collapsed) this.root.querySelector(`.agent-mapf-pin[data-pin="${CSS.escape(pinId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** A pin hovered on the map: mark its entry (or none). */
  markHovered(pinId) {
    this.state.hovered = pinId;
    for (const el of this.root?.querySelectorAll(".agent-mapf-pin.hovered") ?? []) el.classList.remove("hovered");
    if (pinId) this.root?.querySelector(`.agent-mapf-pin[data-pin="${CSS.escape(pinId)}"]`)?.classList.add("hovered");
  }

  /* -------------------------------------------- */
  /*  Input                                       */
  /* -------------------------------------------- */

  _setHidden(ids, visible) {
    for (const id of ids) visible ? this.state.hidden.delete(id) : this.state.hidden.add(id);
    this._filtered();
  }

  /** Show only these categories. */
  _solo(ids) {
    const keep = new Set(ids);
    this.state.hidden = new Set([...this.categories.keys(), UNCATEGORISED].filter(id => !keep.has(id)));
    this._filtered();
  }

  _filtered() {
    this.apply();
    this.render();
    this.onChange?.("filter");
  }

  _groupMembers(el) {
    return [...el.closest(".agent-mapf-group").querySelectorAll("input[data-mapf-category]")].map(b => b.dataset.mapfCategory);
  }

  /** Open or shut NAV Settings (shown and hidden in place: no redraw, so a tap elsewhere in the panel still lands). */
  _settings(open) {
    this.state.settings = open;
    this._listen(open);
    this.root?.querySelector(".agent-mapf-settings")?.toggleAttribute("hidden", !open);
    const gear = this.root?.querySelector("[data-mapf=settings]");
    gear?.classList.toggle("active", open);
    gear?.setAttribute("aria-expanded", open);
  }

  /** While NAV Settings is open: a press outside it (and the gear) or Escape shuts it. */
  _listen(on) {
    if (on && !this._outside) {
      this._outside = event => {
        // The panel redrawn by the phone (a new NavFilter took over): let go.
        if (!this.root?.isConnected) return this._listen(false);
        if (event.type === "keydown" ? event.key === "Escape" : !event.target.closest?.(".agent-mapf-settings, [data-mapf=settings]")) this._settings(false);
      };
      document.addEventListener("pointerdown", this._outside, true);
      document.addEventListener("keydown", this._outside);
    } else if (!on && this._outside) {
      document.removeEventListener("pointerdown", this._outside, true);
      document.removeEventListener("keydown", this._outside);
      this._outside = null;
    }
  }

  /** The "Show pins" slider moved: the map follows as it's dragged (no redraw, which would drop the drag). */
  _showPins(stop) {
    this.state.showPins = stop;
    this.map.setExpand(SHOW_PINS[stop]);
    this.root.querySelector(".agent-mapf-readout")?.toggleAttribute("hidden", SHOW_PINS[stop] !== null);
    this.onChange?.("settings");
  }

  _onClick(event) {
    const target = event.target.closest("[data-mapf]");
    if (!target) return;
    const { state } = this;
    switch (target.dataset.mapf) {
      case "collapse":
        state.collapsed = !state.collapsed;
        this.render();
        return this.onChange?.("collapse");
      case "settings":
        return this._settings(!state.settings);
      case "expand": {
        const id = target.closest("[data-group]").dataset.group;
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
        return this.render();
      }
      case "open": {
        const id = target.closest("[data-category]").dataset.category;
        state.open.has(id) ? state.open.delete(id) : state.open.add(id);
        return this.render();
      }
      case "jump":
        return this.onJump?.(target.closest("[data-pin]").dataset.pin);
      case "show-all":
        state.hidden.clear();
        return this._filtered();
      case "hide-all":
        return this._solo([]);
      case "toggle-gm":
        state.showGm = !state.showGm;
        return this._filtered();
    }
  }

  _onChange(event) {
    const box = event.target;
    if (box.type !== "checkbox") return;
    if (box.dataset.mapfCategory) return this._setHidden([box.dataset.mapfCategory], box.checked);
    if (box.dataset.mapfGroup) return this._setHidden(this._groupMembers(box), box.checked);
  }

  /** Right-click a category or group: show only that. */
  _onSolo(event) {
    const row = event.target.closest("[data-solo]");
    if (!row) return;
    event.preventDefault();
    const box = row.querySelector("input[type=checkbox]");
    this._solo(box.dataset.mapfCategory ? [box.dataset.mapfCategory] : this._groupMembers(box));
  }
}

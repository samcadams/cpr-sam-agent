import { detach, redock } from "./detach.js";
import { GmLogic } from "./logic.js";
import { directorState } from "./state.js";
import * as apps from "./views/apps.js";
import { callStrip, callTimers, actions as callActions } from "./views/calls.js";
import { agentStrip } from "./views/strip.js";
import * as comms from "./views/comms.js";
import * as dashboard from "./views/dashboard.js";
import * as economy from "./views/economy.js";
import * as garden from "./views/garden.js";
import * as world from "./views/world.js";
import * as directors from "../../../apps/directors.js";
import { MODULE_ID } from "../../config.js";

/*
 * The GM Director: a wide GM window with a header of tabs,
 * its own views (views/*.js) and a button that moves it into a child browser window for a second
 * monitor (detach.js). Built: every tab (World without the Map; Apps one app at a time).
 *
 * Views draw their own HTML from the store; work goes through the same store requests and shared
 * commands the GM Phone uses. Each app adds its part through apps/<id>/director.js (apps/directors.js).
 * `director.logic` (logic.js) is the GM Phone's own state and rules, never drawn: Comms and the Garden
 * read its data and run its actions. data-director="phone:<action>" runs a GM Phone action on it (with the
 * control's data- attributes), "pick:<dropdown>" a GM Phone dropdown with the control's value, "input:<selector>"
 * a GM Phone input handler (INPUTS) with the control as its currentTarget; data-monitor
 * controls go to the Agent Monitor's (views/dashboard.js).
 * Under the tabs, on every tab: the players' Agents (views/strip.js), then the call strip (calls.js).
 * A view redraws only its live parts (refresh), so what's being typed survives; drafts also live here,
 * so they survive a full render (switching tabs, docking).
 *
 * A view: { html(director), refresh(director, root, change), attach?(director, root), actions: { [name](data, event) } }, with
 * `this` the Director in actions. Controls use data-director="<action>" (data-action is for phone actions
 * only; tests/ui.test.js) and data- attributes for the action's data. A text field with
 * data-draft="<key>" keeps its text in director.drafts[key].
 */

const TABS = [
  ["dashboard", "Dashboard", "fa-gauge"],
  ["comms", "Comms", "fa-comments"],
  ["garden", "Garden", "fa-seedling"],
  ["economy", "Economy", "fa-coins"],
  ["world", "World", "fa-city"],
  ["apps", "Apps", "fa-table-cells"]
];

const VIEWS = { dashboard, comms, garden, economy, world, apps };

/** Every control's handler: the frame's, the call strip's, the views', then the apps'. */
function allActions() {
  const all = { ...callActions };
  for (const view of Object.values(VIEWS)) Object.assign(all, view.actions);
  for (const app of Object.values(directors)) Object.assign(all, app.actions);
  return all;
}

export class Director extends Application {
  static instance = null;

  static open() {
    if (!game.user.isGM) return null;
    const director = (this.instance ??= new this());
    director.render(true);
    if (director.rendered) director.bringToTop();
    return director;
  }

  static toggle() {
    if (this.instance?.rendered) return this.instance.close();
    return this.open();
  }

  constructor() {
    super();
    this.tab = "dashboard";
    this.drafts = {};
    this.state = {}; // each view's own state, by view id
    this.child = null; // the child browser window while detached
    this._actions = allActions();
    this.logic = new GmLogic(() => this.refresh({ all: true }));
    this._timer = null;
    this._agentsTimer = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ctp-director",
      classes: ["ctp-director"],
      title: "Director",
      width: 1200,
      height: 760,
      resizable: true,
      minimizable: true
    });
  }

  get detached() {
    return !!this.child && !this.child.closed;
  }

  /** This view's state object (made on first use). */
  stateOf(view) {
    return (this.state[view] ??= {});
  }

  async _renderInner() {
    const tabs = TABS.map(([id, label, icon]) => `<button type="button" data-director="tab" data-tab="${id}" class="${id === this.tab ? "active" : ""}" aria-pressed="${id === this.tab}">
      <i class="fas ${icon}" aria-hidden="true"></i> ${label}</button>`).join("");
    const view = VIEWS[this.tab];
    return $(`<div class="director">
      <nav class="director-nav" aria-label="Director">${tabs}
        <button type="button" class="director-detach" data-director="detach" title="${this.detached ? "Put the Director back in the Foundry tab" : "Move the Director to its own window (a second monitor)"}">
          <i class="fas ${this.detached ? "fa-down-left-and-up-right-to-center" : "fa-up-right-from-square"}" aria-hidden="true"></i> ${this.detached ? "Dock" : "Detach"}</button>
      </nav>
      <ol class="director-strip" aria-label="Players' Agents">${agentStrip()}</ol>
      <div class="director-calls" aria-live="assertive">${callStrip()}</div>
      <section class="director-body" data-tab="${this.tab}">${view ? view.html(this) : `<p class="director-empty">Not built yet.</p>`}</section>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0]; // the inner content, replaced on every full render
    const body = root.querySelector(".director-body");
    if (body) VIEWS[this.tab]?.attach?.(this, body);
    root.addEventListener("click", event => {
      const monitor = event.target.closest("[data-monitor]");
      if (monitor) return dashboard.monitorAct(this, monitor);
      const el = event.target.closest("[data-director]");
      if (!el || el.matches("input, select, textarea, form")) return;
      this._act(el.dataset.director, el.dataset, event);
    });
    root.addEventListener("change", event => {
      const el = event.target.closest("input[data-director], select[data-director], textarea[data-director]");
      if (el) this._act(el.dataset.director, el.dataset, event);
    });
    root.addEventListener("submit", event => {
      event.preventDefault();
      this._act(event.target.dataset.director, event.target.dataset, event);
    });
    root.addEventListener("input", event => {
      const key = event.target.dataset?.draft;
      if (key) this.drafts[key] = event.target.value;
      if (event.target.dataset?.director?.startsWith("input:")) this._act(event.target.dataset.director, event.target.dataset, event);
      if (event.target.dataset?.live !== undefined) this.refresh({ search: true });
    });
    // Enter sends a reply (Shift+Enter: a new line).
    root.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || !event.target.matches(".director-reply textarea")) return;
      event.preventDefault();
      event.target.form.requestSubmit();
    });
  }

  _act(name, data, event) {
    if (name === "tab") {
      this.tab = data.tab;
      return this.render();
    }
    if (name === "detach") return this.detached ? this.child.close() : detach(this);
    if (name.startsWith("phone:")) return this.logic.run(name.slice(6), { ...data }, event, this.element);
    if (name.startsWith("pick:")) return this.logic.pick(name.slice(5), event.target.value);
    if (name.startsWith("input:")) return this.logic.input(name.slice(6), event.type, event.target);
    this._actions[name]?.call(this, data, event);
  }

  /** Redraw the live parts (call strip, the open view's lists), keeping fields and focus. */
  refresh(change = { all: true }) {
    const root = this.element?.[0];
    if (!this.rendered || !root) return;
    const strip = root.querySelector(".director-calls");
    if (strip) strip.innerHTML = callStrip();
    const agents = root.querySelector(".director-strip");
    if (agents) agents.innerHTML = agentStrip();
    const body = root.querySelector(".director-body");
    if (!body) return;
    VIEWS[this.tab]?.refresh(this, body, change);
    VIEWS[this.tab]?.attach?.(this, body);
  }

  async _render(force, options) {
    await super._render(force, options);
    if (!this.rendered) return;
    // Opening the Director moves calls to it: the call pop-ups and the GM Phone's call screen go.
    const opened = !directorState.open;
    directorState.open = true;
    if (opened) Hooks.callAll(`${MODULE_ID}.calls`);
    // Call timers tick between redraws.
    this._timer ??= setInterval(() => callTimers(this.element?.[0]), 1000);
    // The Agents card's "ago" times move on.
    this._agentsTimer ??= setInterval(() => this.tab === "dashboard" && this.refresh({ activity: true }), 20_000);
  }

  async close(options) {
    if (this.detached) redock(this, { closing: true });
    clearInterval(this._timer);
    clearInterval(this._agentsTimer);
    this._timer = this._agentsTimer = null;
    directorState.open = false;
    const closed = await super.close(options);
    Hooks.callAll(`${MODULE_ID}.calls`); // calls go back to the GM Phone
    return closed;
  }
}

/** The Director follows the message data, calls, players' activity and settings. */
export function installDirector() {
  Hooks.once("init", () => {
    game.keybindings.register(MODULE_ID, "director", {
      name: "Director (GM)",
      hint: "Open or close the GM Director, the wide GM control window.",
      editable: [],
      restricted: true,
      onDown: () => {
        Director.toggle();
        return true;
      }
    });
  });
  const refresh = change => Director.instance?.refresh(change);
  Hooks.once("ready", () => dashboard.loadMonitorTemplate());
  // Comms offers the selected token (whose phone, or who to act as), as the GM Phone does.
  Hooks.on("controlToken", foundry.utils.debounce(() => refresh({ token: true }), 100));
  Hooks.on(`${MODULE_ID}.changed`, refresh);
  Hooks.on(`${MODULE_ID}.calls`, () => refresh({ calls: true }));
  Hooks.on(`${MODULE_ID}.activity`, () => refresh({ activity: true }));
  Hooks.on("userConnected", () => refresh({ activity: true }));
  // Contact lists (blocked, texts only) live on actors, as do names and pictures (main.js), and balances
  // (BangMe!'s accounts, Great River's "Balance").
  Hooks.on("updateActor", (actor, changes) => {
    if (changes.flags?.[MODULE_ID] || changes.system?.wealth || ["name", "img", "prototypeToken"].some(k => k in changes)) refresh({ actors: true });
  });
  // Who the GM speaks as in each group is a user flag, saved after the pick redraws (speakAs).
  Hooks.on("updateUser", (user, changes) => user.isSelf && changes.flags?.[MODULE_ID] && refresh({ user: true }));
  Hooks.on("updateSetting", setting => setting.key.startsWith(`${MODULE_ID}.`) && refresh({ settings: true }));
}

import { activity, pingActivity } from "./activity.js";
import { MODULE_ID, TEMPLATES } from "../config.js";
import { agentsOf, agentType, isPlayerCharacter, isSilenced } from "../model/agent.js";
import { agentName } from "../model/apps.js";
import { noSignalSince } from "../model/features.js";
import { store } from "../store.js";
import { patchSetting } from "../util/settings.js";
import { ago } from "../util/text.js";

/*
 * The Agent Monitor (GM only): a see-through window over the scene with every player character's
 * Agent, and what its player is doing on it right now (ui/activity.js): whether it's out, which app
 * and screen, typing, and their last few actions. Beside that, what the GM already knows: a carried
 * Agent's ringer (silent or not), signal, calls, Combat Cabb rides, WatchBoxes and Trauma Team calls.
 *
 * The GM dismisses history it's done with: one line (its ×), a character's whole history (Clear), or
 * all of it at once (the bar's history switch); kept per GM, so new lines still come in.
 *
 * Opened from the GM Phone's header, the "Agent Monitor" key (unbound by default) or the API.
 * How see-through it is: the slider in its footer (the client setting monitorOpacity). It turns solid
 * while the pointer or focus is on it.
 */
export class AgentMonitor extends Application {
  static instance = null;

  static open() {
    if (!game.user.isGM) return null;
    const monitor = (this.instance ??= new this());
    monitor.render(true);
    if (monitor.rendered) monitor.bringToTop();
    pingActivity(); // fresh reports from everyone
    return monitor;
  }

  static toggle() {
    if (this.instance?.rendered) return this.instance.close();
    return this.open();
  }

  constructor() {
    super();
    this.expanded = new Set(); // actor ids with their whole log showing
    this.onlyOpen = false;
    this._redraw = foundry.utils.debounce(() => this._drawNow(), 150);
    this._pending = false; // a redraw waiting for the current draw or click to finish
    this._pressed = false; // a mouse button or finger is down on the window
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ctp-agent-monitor",
      classes: ["ctp-phone-app", "ctp-agent-monitor"],
      template: TEMPLATES.monitor,
      title: "Agent Monitor",
      width: 380,
      height: 460,
      top: 80,
      left: window.innerWidth - 700,
      resizable: true,
      minimizable: true
    });
  }

  /**
   * Redraw now, or as soon as it can. Foundry drops a render() asked for while one is drawing, and a
   * redraw between pressing and releasing the mouse swaps the button out from under the click (or the
   * slider being dragged). Either way the redraw waits, so no update is lost.
   */
  _drawNow() {
    if (!this.rendered && this._state !== Application.RENDER_STATES.RENDERING) return;
    if (this._pressed || this._state === Application.RENDER_STATES.RENDERING) {
      this._pending = true;
      return;
    }
    this._pending = false;
    this.render();
  }

  getData() {
    const now = Date.now();
    const rows = game.actors
      .filter(actor => isPlayerCharacter(actor) && (agentsOf(actor).agent || agentsOf(actor).internal))
      .map(actor => this._row(actor, now))
      .filter(row => !this.onlyOpen || row.open)
      .sort((a, b) => b.open - a.open || b.online - a.online || a.name.localeCompare(b.name));
    return {
      rows,
      onlyOpen: this.onlyOpen,
      historyOff: !!this._history().off,
      opacity: game.settings.get(MODULE_ID, "monitorOpacity"),
      openCount: rows.filter(r => r.open).length
    };
  }

  /** One character's Agent, and what its players are doing on it. */
  _row(actor, now) {
    const owners = game.users.filter(u => !u.isGM && (u.character?.id === actor.id || actor.testUserPermission(u, "OWNER")));
    const online = owners.filter(u => u.active);
    // The players holding this character's phone, the one with it open first.
    const reports = online
      .map(u => activity.get(u.id)?.report)
      .filter(r => r?.actorId === actor.id)
      .sort((a, b) => b.open - a.open || b.ts - a.ts);
    const report = reports[0] ?? null;
    const open = !!report?.open;
    const holder = report ? game.users.get(report.userId) : null;
    const history = this._history();
    const cleared = history.cleared?.[actor.id] ?? 0;
    const log = owners
      .flatMap(u => (activity.get(u.id)?.log ?? []).map(d => ({ ...d, user: u.name })))
      .filter(d => d.actorId === actor.id && d.ts > cleared && !history.hidden?.includes(d.id))
      .sort((a, b) => b.ts - a.ts)
      .map(d => ({ ...d, ago: ago(d.ts, now), urgent: /TRAUMA TEAM/.test(d.text) }));
    const expanded = this.expanded.has(actor.id);

    let status;
    if (!online.length) status = owners.length ? "Player offline" : "No player";
    else if (!report?.open) status = "Put away";
    else if (report.minimized) status = "Minimised";
    else if (report.locked) status = "Lock screen";
    else status = report.appName;

    return {
      id: actor.id,
      name: report?.actorName ?? actor.prototypeToken?.name ?? actor.name,
      img: actor.img,
      agent: agentName(actor) ?? (agentType(actor) === "internal" ? "Internal Agent" : "Agent"),
      internal: agentType(actor) === "internal",
      // A carried Agent's ringer (Internal Agents have no silent switch, see isSilenced).
      silent: agentType(actor) === "internal" ? null : isSilenced(actor),
      players: owners.map(u => ({ name: u.name, active: u.active, color: u.color?.css ?? u.color, holding: u === holder })),
      online: online.length > 0,
      open,
      status,
      icon: open && !report.locked ? report.icon : null,
      screen: open && !report.locked && !report.minimized ? report.screen : null,
      typing: open && report.typing,
      since: open ? ago(report.since, now) : null,
      badges: this._badges(actor),
      log: history.off ? [] : expanded ? log : log.slice(0, 1),
      more: !history.off && !expanded && log.length > 1 ? log.length - 1 : 0,
      expanded,
      hasToken: !!actor.getActiveTokens()[0],
      noSignal: !!noSignalSince(actor.id)
    };
  }

  /** The dismissed history (the client setting monitorHistory). */
  _history() {
    return game.settings.get(MODULE_ID, "monitorHistory") ?? {};
  }

  _setHistory(changes) {
    return game.settings.set(MODULE_ID, "monitorHistory", { ...this._history(), ...changes }).then(() => this._drawNow());
  }

  /** What the GM's own data says about this Agent. */
  _badges(actor) {
    const id = actor.id;
    const badges = [];
    if (noSignalSince(id)) badges.push({ icon: "fas fa-signal", label: "No signal", cls: "warn" });
    for (const call of store.calls.values()) {
      const me = call.participants.find(p => p.actorId === id);
      if (me?.state === "joined") badges.push({ icon: "fas fa-phone", label: "On a call", cls: "live" });
      else if (me?.state === "ringing") badges.push({ icon: "fas fa-phone-volume", label: "Ringing", cls: "live" });
    }
    const apps = store.apps ?? {};
    const ride = Object.values(apps.rides ?? {}).find(r => r.actorId === id && ["enroute", "waiting", "riding"].includes(r.status));
    if (ride) badges.push({ icon: "fas fa-taxi", label: `Cabb ${ride.status}: ${ride.to?.name ?? ""}`.trim(), cls: "live" });
    const watch = apps.watch?.[id];
    if (watch) badges.push({ icon: "fas fa-eye", label: `WatchBox ${watch.status}`, cls: watch.status === "alarm" ? "alarm" : "live" });
    const dispatch = Object.values(apps.dispatches ?? {}).find(d => d.actorId === id && d.status !== "closed");
    if (dispatch) badges.push({ icon: "fas fa-truck-medical", label: `Trauma Team ${dispatch.status}`, cls: "alarm" });
    const unread = store.totalUnread(store.threadsFor(id), game.user, id);
    if (unread) badges.push({ icon: "fas fa-envelope", label: `${unread} unread` });
    return badges;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.style.setProperty("--monitor-alpha", game.settings.get(MODULE_ID, "monitorOpacity"));
    // Hold redraws while pressed; the one waiting runs after the click (see _drawNow).
    root.addEventListener("pointerdown", () => {
      this._pressed = true;
      window.addEventListener("pointerup", () => setTimeout(() => {
        this._pressed = false;
        if (this._pending) this._drawNow();
      }, 0), { once: true });
    });
    // Its own attribute: data-action is the phone's (ui/phone/AgentPhone.js ACTIONS).
    html.on("click", "[data-monitor]", event => this.act(event.currentTarget));
    html.on("input", "input[name=opacity]", event => {
      const value = Number(event.currentTarget.value);
      this.element[0].style.setProperty("--monitor-alpha", value);
    });
    html.on("change", "input[name=opacity]", event => game.settings.set(MODULE_ID, "monitorOpacity", Number(event.currentTarget.value)));
  }

  /** A control (data-monitor) pressed, here or in the Director's Agents card (ui/director/views/dashboard.js). */
  act(el) {
    const { monitor: action, actorId } = el.dataset;
    const actor = game.actors.get(actorId);
    if (action === "log") {
      if (this.expanded.has(actorId)) this.expanded.delete(actorId);
      else this.expanded.add(actorId);
      this._drawNow();
    } else if (action === "dismiss") {
      // Ids of dismissed lines, the newest 200 (older ones have left the players' logs by then).
      this._setHistory({ hidden: [...(this._history().hidden ?? []), el.dataset.did].slice(-200) });
    } else if (action === "clear") {
      this.expanded.delete(actorId);
      this._setHistory({ cleared: { ...this._history().cleared, [actorId]: Date.now() } });
    } else if (action === "history") this._setHistory({ off: !this._history().off });
    else if (action === "signal") toggleSignal(actorId);
    else if (action === "pan") panTo(actor);
    else if (action === "sheet") actor?.sheet.render(true);
    else if (action === "only-open") {
      this.onlyOpen = !this.onlyOpen;
      this._drawNow();
    } else if (action === "refresh") pingActivity();
  }

  async _render(force, options) {
    const list = this.element?.[0]?.querySelector(".agent-monitor-list");
    const scroll = list?.scrollTop ?? 0;
    await super._render(force, options);
    if (!this.rendered) return;
    const fresh = this.element[0].querySelector(".agent-monitor-list");
    if (fresh) fresh.scrollTop = scroll;
    if (this._pending) this._redraw(); // something changed while it drew
    this.element[0].style.setProperty("--monitor-alpha", game.settings.get(MODULE_ID, "monitorOpacity"));
    // "for 2m", "3m ago": kept current without the players having to do anything.
    clearInterval(this._ticker);
    this._ticker = setInterval(() => this._redraw(), 20_000);
  }

  async close(options) {
    clearInterval(this._ticker);
    return super.close(options);
  }
}

/** Cut a character's cellular service (their incoming messages are held) or restore it, as Control does. */
function toggleSignal(actorId) {
  return patchSetting("noSignal", offline => {
    if (offline[actorId]) delete offline[actorId];
    else offline[actorId] = Date.now();
  });
}

/** Pan the canvas to the character's token on this scene. */
function panTo(actor) {
  const token = actor?.getActiveTokens()[0];
  if (token) canvas.animatePan({ x: token.center.x, y: token.center.y });
  else ui.notifications.info(`${actor?.name ?? "That character"} has no token on this scene.`);
}

export function installAgentMonitor() {
  Hooks.once("init", () => {
    game.keybindings.register(MODULE_ID, "agentMonitor", {
      name: "Agent Monitor (GM)",
      hint: "Open or close the GM's see-through window of every player's Agent and what they're doing on it.",
      editable: [],
      restricted: true,
      onDown: () => {
        AgentMonitor.toggle();
        return true;
      }
    });
  });
  // A button in the GM Phone's header.
  Hooks.on("getAgentPhoneHeaderButtons", (phone, buttons) => {
    if (!game.user.isGM || phone.mode !== "console") return;
    buttons.unshift({ label: "", tooltip: "Agent Monitor", class: "ctp-open-monitor", icon: "fas fa-binoculars", onclick: () => AgentMonitor.toggle() });
  });
  // Redraw on anything it shows.
  const redraw = () => AgentMonitor.instance?._redraw();
  Hooks.on(`${MODULE_ID}.activity`, redraw);
  Hooks.on(`${MODULE_ID}.changed`, change => (change.all || change.apps || change.threadId) && redraw());
  Hooks.on(`${MODULE_ID}.calls`, redraw);
  Hooks.on("userConnected", redraw);
  for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "updateSetting"]) Hooks.on(hook, redraw);
}

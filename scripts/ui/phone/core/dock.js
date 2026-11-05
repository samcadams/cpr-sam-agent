/*
 * The phone's dock (or Home button), and which apps it has: the apps installed on this character's Agent
 * (Ziggurat Pool), each app's badge. Installed onto AgentPhone (core/pages.js).
 */
import { PHONE_HOOKS } from "./pages.js";
import { describeControls } from "../../a11y.js";
import { MODULE_ID } from "../../../config.js";
import { APPS, DEFAULT_DOCK, dockSplit, phoneApps, tileName } from "../../../model/apps.js";
import { appearance } from "../../../model/appearance.js";
import { installedSet, poolConfig, poolOn } from "../../../../apps/pool/model.js";
import { store } from "../../../store.js";

/** The phone's own actions: switching apps from the dock. */
export const actions = {
  app({ app }) {
    // The Apps button again: back to the app you came from (with a dock; the Home button stays home).
    if (app === "home" && this.app === "home" && !this.homeNavigation(this._ctx)) app = this.lastApp ?? "home";
    else if (app === "home") this.lastApp = this.app;
    this.appSettings = null;
    if (this.app === app) {
      // Tapping the current app goes back to its home screen.
      if (app === "quests") this.questId = null;
      else if (app === "messages") this.view = null;
      else for (const hook of PHONE_HOOKS.retap) hook.call(this, app);
    }
    this.app = app;
    this.render();
  }
};

export const methods = {
  /** Update only the dock (its unread badges) without redrawing the page. */
  _patchDock() {
    const root = this.element?.[0];
    if (!root || !this._ctx) return;
    this._paintBezel(); // the LED follows the unread count
    this._paintShadeCount();
    if (this.homeNavigation(this._ctx)) {
      // Home-screen navigation: just the Home button's badge.
      const badge = this.homeButtonData(this._ctx).badge;
      const el = root.querySelector(".agent-home-button .agent-dock-badge");
      if (el) el.textContent = badge;
      else if (badge) return this._redraw();
      if (el && !badge) el.remove();
      return;
    }
    const el = root.querySelector(".agent-dock");
    const partial = globalThis.Handlebars?.partials?.["agent-dock"];
    if (!el || typeof partial !== "function") return;
    el.outerHTML = partial({ dock: this.dockData(this._ctx), appearance: appearance() });
    describeControls(root.querySelector(".agent-dock"));
  },

  /**
   * The dock: the apps the phone's owner put on it (Settings → Dock), each with its badge, and the
   * Apps button for everything else. Badges: unread messages, contact requests (GM), a dot when jobs
   * changed since you last looked, and what's waiting in each app.
   */
  dockData(ctx) {
    const { dock, home } = this.dockSplit(ctx);
    const item = app => ({ ...app, name: tileName(app), active: this.app === app.id, ...this.dockBadge(ctx, app.id) });
    return {
      items: dock.map(item),
      home: this.app === "home" || home.some(a => a.id === this.app),
      apps: home.reduce((n, a) => n + (this.dockBadge(ctx, a.id).badge || 0), 0)
    };
  },

  /** This phone's apps, split between its dock and its home screen. */
  dockSplit(ctx) {
    const apps = phoneApps({ gm: ctx.perspective === "gm", internal: ctx.internal, installed: this.installedApps(ctx) });
    // Home-screen navigation: no dock, every app on the home screen.
    if (this.homeNavigation(ctx)) return { dock: [], home: apps };
    return dockSplit(apps, ctx.settings.dockApps ?? DEFAULT_DOCK);
  },

  /**
   * The apps installed on this phone's character (a Set; apps/pool/model.js), or null for every app: the GM
   * Phone, or the Ziggurat Pool switched off.
   */
  installedApps(ctx) {
    if (ctx?.perspective !== "pc" || !poolOn()) return null;
    return installedSet(store.apps.installs, ctx.actorId, poolConfig());
  },

  /** Apps that arrived on this character's Agent since the last draw play the install animation on the home screen. */
  _noteInstalls(ctx) {
    const key = this._installedKeyOf(ctx);
    if (this._installedKey && key !== this._installedKey && this._installedActor === ctx?.actorId) {
      const before = new Set(this._installedKey.split(","));
      for (const id of key.split(",")) if (id && !before.has(id)) (this._freshApps ??= new Set()).add(id);
    }
    this._installedKey = key;
    this._installedActor = ctx?.actorId;
  },

  /** The installed apps as a string, to notice when they change (see affectedBy). */
  _installedKeyOf(ctx) {
    const set = this.installedApps(ctx);
    return set ? [...set].join() : "";
  },

  /** Does this phone get around by its home screen and a Home button, instead of a dock? */
  homeNavigation(ctx) {
    return ctx?.settings.navigation === "home";
  },

  /** The Home button (home-screen navigation): lit on the home screen, with everything waiting in its badge. */
  homeButtonData(ctx) {
    const { home } = this.dockSplit(ctx);
    return { active: this.app === "home", badge: home.reduce((n, a) => n + (this.dockBadge(ctx, a.id).badge || 0), 0) };
  },

  /** { badge } (a count) or { dot } for an app, wherever it shows. */
  dockBadge(ctx, id) {
    const gm = ctx.perspective === "gm";
    switch (id) {
      case "contacts":
        return { badge: gm ? store.visibleRequests().length : 0 };
      case "messages":
        return { badge: gm ? store.totalUnread() : store.totalUnread(store.threadsFor(ctx.actorId), game.user, ctx.actorId) };
      case "quests": {
        const seen = game.settings.get(MODULE_ID, "questsSeen") ?? 0;
        return { dot: this.app !== "quests" && this.questList(ctx).some(q => (q.updated ?? 0) > seen) };
      }
      default:
        return { badge: id in APPS ? this.appBadge(ctx, id) : 0 };
    }
  }
};

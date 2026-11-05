import { arrange, moveApp, tileName } from "../../../model/apps.js";
import { appearance } from "../../../model/appearance.js";
import { OPEN_RIDE } from "../../../../apps/cabb/model.js";
import { gardenConfig } from "../../../../apps/garden/model.js";
import { isDue, subsBilledBy, subscriptionsOf } from "../../../../apps/pool/model.js";
import { reduceMotion } from "../../a11y.js";
import { agentTimestamp } from "../../../util/agentTime.js";
import { store } from "../../../store.js";

/*
 * Phone page: the home screen: every app that isn't on the dock (see model/apps.js dockSplit), with a
 * badge for what's waiting in each. The dock's "Apps" button opens it. Its owner arranges it: drag a
 * tile onto another to put it there, or Alt + an arrow key to move the focused one (saved per phone,
 * `homeOrder`; model/apps.js arrange).
 * Methods and input handlers are installed onto AgentPhone.
 */

const TILE = ".agent-home-app";

/** The tiles' order on screen, with `id` moved before `before`; saved with the ids not on screen kept after. */
function saveOrder(phone, id, before) {
  const ctx = phone.context();
  if (!ctx || !id || id === before) return;
  const shown = [...phone.element[0].querySelectorAll(TILE)].map(el => el.dataset.app);
  const order = moveApp(shown, id, before);
  const kept = (ctx.settings.homeOrder ?? []).filter(x => !shown.includes(x));
  phone._focusNext = `${TILE}[data-app="${CSS.escape(id)}"]`;
  phone._saveSettings({ homeOrder: [...order, ...kept] });
}

export const inputs = {
  [TILE]: {
    dragstart(event) {
      this._homeDrag = event.currentTarget.dataset.app;
      event.originalEvent.dataTransfer.effectAllowed = "move";
      event.originalEvent.dataTransfer.setData("text/plain", this._homeDrag);
      event.currentTarget.classList.add("dragging");
    },
    dragend(event) {
      this._homeDrag = null;
      event.currentTarget.classList.remove("dragging");
      for (const el of this.element[0].querySelectorAll(`${TILE}.drop-before`)) el.classList.remove("drop-before");
    },
    dragover(event) {
      if (!this._homeDrag) return;
      event.preventDefault();
      event.originalEvent.dataTransfer.dropEffect = "move";
      const over = event.currentTarget;
      for (const el of this.element[0].querySelectorAll(`${TILE}.drop-before`)) if (el !== over) el.classList.remove("drop-before");
      if (over.dataset.app !== this._homeDrag) over.classList.add("drop-before");
    },
    drop(event) {
      if (!this._homeDrag) return;
      event.preventDefault();
      const id = this._homeDrag;
      const target = event.currentTarget.dataset.app;
      // Dropped later in the list: it goes after the tile (where it was dropped), not before.
      const shown = [...this.element[0].querySelectorAll(TILE)].map(el => el.dataset.app);
      const after = shown.indexOf(target) > shown.indexOf(id);
      this._homeDrag = null;
      saveOrder(this, id, after ? shown[shown.indexOf(target) + 1] ?? null : target);
    },
    /** Alt + ← ↑ moves the focused tile one earlier; Alt + → ↓ one later. */
    keydown(event) {
      if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const id = event.currentTarget.dataset.app;
      const shown = [...this.element[0].querySelectorAll(TILE)].map(el => el.dataset.app);
      const i = shown.indexOf(id);
      const later = event.key === "ArrowRight" || event.key === "ArrowDown";
      if (later ? i >= shown.length - 1 : i <= 0) return;
      saveOrder(this, id, later ? shown[i + 2] ?? null : shown[i - 1]);
    }
  }
};


/** An app page's header: back to the home screen, and the app's name and icon. */
export const appBar = (id, extra = {}) => {
  const { names, icons } = appearance();
  return { id, name: names[id], icon: icons[id], ...extra };
};

export const methods = {
  homeData(ctx) {
    // Apps just installed from the Ziggurat Pool drop in, once (AgentPhone._noteInstalls).
    const fresh = this._freshApps ?? new Set();
    const apps = arrange(this.dockSplit(ctx).home, ctx.settings.homeOrder).map(app => ({ ...app, name: tileName(app), fresh: fresh.has(app.id) && !reduceMotion(), ...this.dockBadge(ctx, app.id) }));
    for (const app of apps) fresh.delete(app.id);
    // Home-screen navigation: a full home screen, with the clock over the apps.
    if (this.homeNavigation(ctx)) return { apps, screen: { ...agentTimestamp(), name: ctx.subject?.name ?? null } };
    return { apps };
  },

  /** What's waiting in an app: unanswered alerts, questions for the GM, calls, an alarm, cabs on the road (GM). */
  appBadge(ctx, id) {
    const gm = ctx.perspective === "gm";
    const mine = list => Object.values(list).filter(x => gm || x.actorId === ctx.actorId);
    switch (id) {
      case "agent":
        return gm ? 0 : mine(store.apps.alerts).filter(a => a.choices.length && !a.answer).length;
      case "alex":
        return gm ? mine(store.apps.queries).filter(q => q.status === "crawling" || (q.status === "roll" && q.roll)).length : 0;
      case "trauma":
        return mine(store.apps.dispatches).filter(d => d.status !== "closed").length;
      case "cabb":
        return gm ? Object.values(store.apps.rides ?? {}).filter(r => OPEN_RIDE.has(r.status)).length : 0;
      case "watchbox":
        return gm ? Object.values(store.apps.watch).filter(w => w.status === "alarm").length : 0;
      case "pool":
        return gm && !subsBilledBy() ? Object.keys(store.apps.installs ?? {}).reduce((n, actorId) => n + subscriptionsOf(store.apps.installs, actorId).filter(s => isDue(s)).length, 0) : 0;
      case "screamsheet": {
        // Players: clippings pulled and not read yet; the GM: deep crawls to confirm.
        const crawls = store.apps.screamCrawls ?? {};
        if (gm) return Object.values(crawls).filter(r => r?.deep?.status === "review").length;
        const read = crawls[ctx.actorId]?.read ?? {};
        return Object.values(store.apps.screamClips ?? {}).filter(c => (c.actorIds ?? []).includes(ctx.actorId) && !read[c.id]).length;
      }
      case "garden":
        return gm && gardenConfig().dating ? Object.values(store.garden.dating.sparks).filter(s => s.status === "searching").length : 0;
      default:
        return 0;
    }
  }
};

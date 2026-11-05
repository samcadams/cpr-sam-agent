import { broadcastWaits } from "../../../../apps/cbk/broadcasts.js";
import { alertApp, appsOn } from "../../../model/apps.js";
import { commsOn, feature } from "../../../model/features.js";
import { getService } from "../../../model/services.js";
import { isGroup, isService } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { panToToken } from "../../location.js";
import { ago } from "../../../util/text.js";

/*
 * The notification center (styles/phone/shade.css): pulled down from the status bar (a tap, or a drag
 * down), over whatever is on screen. It lists what's waiting for this phone, newest first:
 *   text   conversations with unread messages (clearing one marks it read)
 *   alert  a player's Agent alerts (apps/agent/host.js), answerable here; clearing one leaves it in the
 *          Agent app's log (`cleared`)
 *   card   the GM's cards from the apps (host/core.js _gmCard), with their buttons; clearing one deletes it
 * Opening one goes where its pop-up would, and clears it. The status bar shows how many there are.
 * Installed onto AgentPhone (core/pages.js).
 */

const MAX_ITEMS = 40;

/** How far (px) a drag down from the status bar (or up on the shade) has to go to open (close) it. */
const DRAG = 24;

export const actions = {
  shade() {
    if (Date.now() < (this._shadeDragged ?? 0)) return; // the click that ends a drag
    this._shadeSet(!this.shadeOpen);
  },
  "shade-open"({ key }) {
    const item = this._shadeItem(key);
    if (!item) return;
    this.shadeOpen = false;
    if (item.kind === "text") return this.constructor.openThread(item.thread, this.mode);
    if (item.kind === "card") {
      this._shadeClear([item]);
      return this.openCard(item.card);
    }
    if (!item.pending && !broadcastWaits(item.alert)) this._shadeClear([item]);
    this.openAlert(item.alert);
  },
  "shade-clear"({ key }) {
    const item = this._shadeItem(key);
    if (item) this._shadeClear([item]);
  },
  "shade-clear-all"() {
    // Everything, not only what's shown; questions still waiting for an answer stay.
    this._shadeClear(this.shadeItems(this._ctx, { all: true }).filter(i => !i.pending));
  },
  /** One of a GM card's buttons (as on its pop-up). */
  "shade-card-action"({ key, index }) {
    const item = this._shadeItem(key);
    const action = item?.card.actions?.[Number(index)];
    if (!action) return;
    if (action.pan) panToToken(action.pan);
    else store.request(action.request, action.data);
    this._shadeClear([item]);
  }
};

export const methods = {
  /** What's waiting for this phone, newest first (see the header): the latest MAX_ITEMS, or `all`. */
  shadeItems(ctx, { all = false } = {}) {
    if (!ctx) return [];
    const items = [];
    const gm = ctx.perspective === "gm";

    if (commsOn()) {
      const threads = gm ? store.visibleThreads() : store.threadsFor(ctx.actorId);
      for (const t of threads) {
        const unread = gm ? store.unread(t) : store.unread(t, game.user, isGroup(t) ? undefined : ctx.actorId);
        const row = unread ? this._shadeThreadRow(ctx, t, gm) : null;
        if (row) items.push({ key: `t:${t.id}`, kind: "text", thread: t, ts: row.ts, title: row.name, owner: row.owner, body: row.preview, img: row.img, icon: row.isGroup ? "fa-users" : "fa-comment-dots", count: unread > 1 ? unread : null, ago: ago(row.ts) });
      }
    }

    if (gm) {
      for (const card of Object.values(store.apps.gmCards ?? {})) {
        items.push({
          key: `c:${card.id}`, kind: "card", card, ts: card.ts ?? 0, title: card.title, body: card.body, img: card.img,
          icon: card.icon ?? "fa-bell", urgent: !!card.urgent, ago: ago(card.ts),
          actions: (card.actions ?? []).map((a, index) => ({ label: a.label, icon: a.icon, index }))
        });
      }
    } else {
      const apps = new Map(appsOn(ctx.internal).map(a => [a.id, a]));
      for (const alert of Object.values(store.apps.alerts ?? {})) {
        if (alert.actorId !== ctx.actorId || alert.cleared) continue;
        const row = this._alertRow(alert, apps);
        items.push({
          key: `a:${alert.id}`, kind: "alert", alert, id: alert.id, ts: alert.ts, title: row.from, body: alert.text, icon: row.icon,
          pending: !!row.open, choices: row.open ? alert.choices : [], answer: alert.answer, ago: row.ago
        });
      }
    }
    items.sort((a, b) => b.ts - a.ts);
    return all ? items : items.slice(0, MAX_ITEMS);
  },

  _shadeThreadRow(ctx, t, gm) {
    const thread = this.cleared(ctx, t);
    if (!thread.messages.length) return null;
    if (isGroup(thread)) return this.groupRow(ctx, thread);
    const actor = game.actors.get(thread.actorId);
    if (!actor) return null;
    if (isService(thread)) return this.serviceRow(ctx, getService(thread.serviceId), thread, actor, gm);
    return this.directRow(ctx, thread, actor, thread.contact, gm);
  },

  _shadeItem(key) {
    return this.shadeItems(this._ctx, { all: true }).find(i => i.key === key) ?? null;
  },

  /** Open or close the center (a tap on the status bar or the grab bar, or a drag). */
  _shadeSet(open) {
    this._shadeOpening = open && !this.shadeOpen;
    this.shadeOpen = open;
    if (open) this._shadeTop = 0;
    this.render();
  },

  /**
   * Clear these items: texts are marked read, alerts leave the center, GM cards are deleted. Done here at
   * once too (the host's echoes then change nothing on screen), so Clear all empties the center in one
   * redraw instead of row by row as the host answers.
   */
  _shadeClear(items) {
    const alertIds = items.filter(i => i.kind === "alert").map(i => i.alert.id);
    const cardIds = items.filter(i => i.kind === "card").map(i => i.card.id);
    // (Not on the host: its store is the host's data, and the request below does it there.)
    if (!store.isHost) {
      for (const id of alertIds) if (store.apps.alerts?.[id]) store.apps.alerts[id].cleared = true;
      for (const id of cardIds) delete store.apps.gmCards?.[id];
    }
    for (const i of items) if (i.kind === "text") store.markRead(i.thread, this._ctx?.perspective === "gm" ? undefined : isGroup(i.thread) ? undefined : this._ctx.actorId);
    if (alertIds.length) store.request("alert-clear", { alertIds });
    if (cardIds.length) store.request("gm-card-clear", { cardIds });
    this.render();
  },

  /** The data for the open center, or null; and the status bar's count. */
  shadeData(ctx, data) {
    const items = this.shadeItems(ctx, { all: true });
    data.shadeCount = items.length || null;
    const shown = this.shadeOpen && !data.page.none && !data.page.lock && !data.page.call && !data.page.incoming;
    if (!shown) this.shadeOpen = false;
    // `opening`: it slides in only when pulled down, not on every redraw while it's open.
    data.shade = shown ? { items: items.slice(0, MAX_ITEMS), more: Math.max(0, items.length - MAX_ITEMS), opening: !!this._shadeOpening } : null;
  },

  /** Open what an Agent alert is about: its job, contacts, the Garden post, the app it came from, else the Agent app. */
  openAlert(alert) {
    const ref = alert.ref ?? {};
    this.locked = false;
    this.shadeOpen = false;
    if (alert.kind === "job" && feature("jobs")) Object.assign(this, { app: "quests", questId: ref.questId ?? null });
    else if (alert.kind === "contact") this.app = "contacts";
    else {
      this.app = alertApp(alert) ?? "agent";
      if (this.app === "garden") Object.assign(this, { gardenPost: ref.type === "garden-post" ? ref.postId : null, gardenAccount: null });
      if (this.app === "alex") this.alexFocus = ref.type === "alex-query" ? ref.queryId : null;
    }
    this.render(true);
  },

  /** Open what a GM card is about (its `open`: an app, and the Garden's tab). */
  openCard(card) {
    this.shadeOpen = false;
    if (card.open?.app) this.app = card.open.app;
    if (card.open?.tab) Object.assign(this, { gardenTab: card.open.tab, gardenPost: null, gardenAccount: null });
    this.render(true);
  },

  /** Keep the status bar's count current without a redraw (core/dock.js _patchDock). */
  _paintShadeCount() {
    const bar = this.element?.[0]?.querySelector(".agent-statusbar");
    if (!bar || !this._ctx) return;
    const n = this.shadeItems(this._ctx, { all: true }).length;
    let el = bar.querySelector(".agent-shade-count");
    if (!n) return el?.remove();
    if (!el) {
      el = document.createElement("b");
      el.className = "agent-shade-count";
      bar.querySelector(".agent-brand")?.after(el);
    }
    el.textContent = n;
  },

  /** Drag down from the status bar to open the center, up on it to close it. */
  _shadeGestures(root) {
    const drag = (el, open) => el?.addEventListener("pointerdown", down => {
      if (down.button !== 0) return;
      const move = event => {
        const dy = event.clientY - down.clientY;
        if (open ? dy < DRAG : dy > -DRAG) return;
        stop();
        this._shadeDragged = Date.now() + 400;
        this._shadeSet(open);
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    });
    drag(root.querySelector(".agent-statusbar"), true);
    drag(root.querySelector(".agent-shade-handle"), false);
  }
};

export const phone = {
  render(html) {
    const root = html?.[0] ?? html;
    if (!root?.querySelector) return;
    this._shadeGestures(root);
    // A redraw while it's open keeps where the list was scrolled to; only the next pull-down slides in again.
    this._shadeOpening = false;
    const list = root.querySelector(".agent-shade-list");
    if (!list) return;
    list.scrollTop = this._shadeTop ?? 0;
    list.addEventListener("scroll", () => (this._shadeTop = list.scrollTop), { passive: true });
  }
};

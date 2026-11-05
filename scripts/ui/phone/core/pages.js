import * as bezel from "./bezel.js";
import * as dock from "./dock.js";
import * as lists from "./lists.js";
import * as scroll from "./scroll.js";
import * as shade from "./shade.js";
import * as skins from "./skins.js";
import * as threads from "./threads.js";
import * as inbox from "../pages/inbox.js";
import * as conversation from "../pages/conversation.js";
import * as compose from "../pages/compose.js";
import * as contacts from "../pages/contacts.js";
import * as quests from "../pages/quests.js";
import * as settings from "../pages/settings.js";
import * as call from "../pages/call.js";
import * as control from "../pages/control.js";
import * as card from "../pages/card.js";
import * as dropdown from "../pages/dropdown.js";
import * as lock from "../pages/lock.js";
import * as blood from "../pages/blood.js";
import * as home from "../pages/home.js";
import * as appSettings from "../pages/appSettings.js";
import * as appPages from "../../../../apps/pages.js";
import { DROPDOWNS } from "../pages/dropdown.js";

/*
 * Everything installed onto AgentPhone: the phone's own parts (core/), its pages (pages/) and each app's
 * page (apps/<id>/page.js). Each exports, all run with `this` = the phone:
 *   methods     installed onto AgentPhone (a name defined twice throws)
 *   actions     click actions: data-action name → handler(dataset, event)
 *   inputs      selector → { event: handler(event) }
 *   dropdowns   name → handler(value) (see pages/dropdown.js)
 *   phone       hooks into the phone's own life, for pages that need them (PHONE_HOOKS below)
 */

const PAGES = {
  bezel, dock, lists, scroll, shade, skins, threads, dropdown, lock, blood, inbox, conversation, card, compose, contacts, quests, settings, call, control,
  home, appSettings,
  ...appPages // each app's (apps/pages.js)
};

/** Where a page's code is, for errors. */
const fileOf = page => (page in appPages ? `apps/${page}/page.js` : `ui/phone/${page in { bezel, dock, lists, scroll, shade, skins, threads } ? "core" : "pages"}/${page}.js`);

/**
 * The pages' `phone` hooks, in app order:
 *   render(html)          after every draw, whatever's on screen (start or stop a game, attach a map...)
 *   close()               the phone is put away (stop what's running)
 *   busy()                true while the user is mid-something a redraw would lose (a run, a drag)
 *   minSize()             the smallest the window may be right now ({ width, height }), or nothing
 *   retap(app)            the user tapped the app that's already open (back to its first screen)
 *   affected(change, ctx) true if an apps change (change.apps) touches this phone beyond its app's page
 *   keep(change, ctx)     true if an apps change leaves the open app's page as it is (its page needn't redraw;
 *                         the dock's badges still update)
 *   takeover(ctx, data)   before any app is drawn: fill `data` and return true to show this page
 *                         instead, whichever app is open (an armed WatchBox)
 *   gate(ctx, data)       before the open app's page: return true to show another page in its place
 *                         (a lapsed Ziggurat Pool subscription)
 */
export const PHONE_HOOKS = { render: [], close: [], busy: [], minSize: [], retap: [], affected: [], keep: [], takeover: [], gate: [] };

export const ACTIONS = new Map();
export const INPUTS = [];

/** Install every page onto the phone's class (AgentPhone.js, once it's defined). */
export function installPages(AgentPhone) {
  for (const [page, { methods = {}, actions = {}, inputs = {}, dropdowns = {}, phone = {} }] of Object.entries(PAGES)) {
    const file = fileOf(page);
    for (const name of Object.keys(methods)) {
      if (name in AgentPhone.prototype) throw new Error(`${file}: "${name}" is already defined`);
    }
    Object.assign(AgentPhone.prototype, methods);
    for (const [name, handler] of Object.entries(actions)) {
      if (ACTIONS.has(name)) throw new Error(`${file}: action "${name}" is already defined`);
      ACTIONS.set(name, handler);
    }
    INPUTS.push(...Object.entries(inputs));
    for (const [name, handler] of Object.entries(dropdowns)) {
      if (DROPDOWNS.has(name)) throw new Error(`${file}: dropdown "${name}" is already defined`);
      DROPDOWNS.set(name, handler);
    }
    for (const [hook, fn] of Object.entries(phone)) {
      if (!(hook in PHONE_HOOKS)) throw new Error(`${file}: unknown phone hook "${hook}"`);
      PHONE_HOOKS[hook].push(fn);
    }
  }
}

/*
 * The phone's apps, in one place: everything the rest of the module needs to know about each one.
 * Each app is a folder, apps/<id>/, that describes itself in apps/<id>/app.js; this file gathers them.
 * Plain data, no Foundry code, so anything can read it (the model, the host, the phone, the tests).
 *
 * An app's folder:
 *   app.js       what it is (the App fields below), its settings and extra partials. Plain data, no imports.
 *   model.js     its data and rules (unit-tested in Node), if it has any
 *   host.js      its host code: `methods` (installed onto the store) and `requests` (socket type → method)
 *   page.js      its phone page: `methods`, `actions`, `inputs`, `dropdowns`, and `phone` hooks
 *                (ui/phone/core/pages.js)
 *   client.js    optional: its own Foundry hooks, `install({ refreshPhones, store })`, `ready()`, and
 *                `onSetting` (setting key → what runs when it changes)
 *   <id>.hbs     its page template (the partial `agent-app-<id>`)
 *   <id>.css     its stylesheet
 *   anything else it needs (drawing, audio, editors...), imported by those files
 *
 * The rest is built from the apps' definitions:
 *   model/apps.js         APPS (the home screen, the dock, Control's switches)
 *   model/appearance.js   the default names and icons in Control → Labels and Icons
 *   model/features.js     each app's switch, on by default (app_<id>)
 *   model/storage.js      the host's data tables, and which are split by month
 *   model/apps.js         appsFor: who may see which rows of those tables
 *   apps/bangme/model.js  BangMe!'s ledger kinds
 *   settings.js           each app's settings
 *   config.js             each app's templates (as partials) and stylesheet
 *   ui/phone/AgentPhone   which page draws it, and which changes redraw it
 *   host/clock.js         what runs on the host's clock
 *   host/core.js          what runs once the host has loaded its data
 *
 * The code lists (apps/index.js, hosts.js, pages.js, clients.js) and module.json "styles" are built by
 * `npm run apps` (tools/apps.mjs); `npm test` fails while they're out of date.
 *
 * Adding an app: make its folder (copy a small one, e.g. apps/notes/), give it an `id` (the folder's
 * name) and an `order` in app.js, then run `npm run apps`. A new `off` app also gets `newApp: true`.
 *
 * App (apps/<id>/app.js, default export): {
 *   id, order           its folder's name; its place on the home screen (unique; gaps are fine)
 *   name, icon, blurb   what the phone shows (the GM can rename and re-icon it in Control)
 *   homeName?           a shorter name for its home-screen tile and dock button (unless the GM renamed it)
 *   iconLabel?          its row in Control → Icons, when that should differ from `name`
 *   noInternal?         not on an Internal Agent (the HUD has no room for it)
 *   citinet?            Black Chrome's "Requires CitiNet Access" keyword: it doesn't work without a connection.
 *                       The App Store says so on its card, and while the character has no signal the phone
 *                       shows a "No CitiNet" strip over its page (the app's host side refuses on its own)
 *   off?                off until the GM switches it on in Control (new worlds; see model/features.js)
 *   newApp?             with `off`: added after worlds were already using the module, so it starts off in
 *                       those worlds too (older `off` apps were on there before, and stay on)
 *   turnedOn?           was an `off` app and is on by default now: a world that saved it off back then gets
 *                       it switched on once (model/features.js settleAppsOff)
 *   data?               the key the page's data goes under, and its method `<data>Data` (default: the id)
 *   refreshOn?          change flags (store._changed) that redraw it; every app redraws on `apps`
 *   tick?               a host method run on the host's clock: { method, realTimeOnly? }
 *                       (realTimeOnly: not when world time jumps, see host/clock.js)
 *   load?               a host method run once the host has read its data (e.g. moving old data in)
 *   ledger?             BangMe!: { kind: label } for its money movements (the ledger and its filter)
 *   tables?             its host data tables (saved in the world's cpr-sam-agent/apps/ folder):
 *                       { [name]: { monthly?, owner } }
 *                         monthly: split into one file per month (tables that only grow)
 *                         owner:   who may see a row: "actorId" (the row's actorId field) or "key"
 *                                  (keyed by actorId): players see the rows of characters they own;
 *                                  "listed": rows with `everyone`, or listing one of their characters
 *                                  in `actorIds`; "gm": GMs only; GMs see everything
 *                         secret?: fields of a row only GMs see
 *   partials?           more templates in its folder: { [partial name]: file }
 *   settings?           its settings: { [key]: Foundry's setting data (config false and scope world unless
 *                       said), plus `redraw`: change flags to redraw phones on when it changes, or "all" }
 * }
 */

import { APP_DEFS } from "../../apps/index.js";

/** Every app, by id, without its id and order: { [id]: App }. In home-screen order. */
export const APP_MANIFEST = Object.fromEntries(APP_DEFS.map(({ id, order, ...app }) => [id, app]));

/** Every app's id, in order. */
export const APP_IDS = Object.keys(APP_MANIFEST);

/** The key an app's page data goes under (and its method is `<key>Data`). */
export const appDataKey = id => APP_MANIFEST[id]?.data ?? id;

/** The partial that draws an app (config.js registers one per app). */
export const appPartial = id => `agent-app-${id}`;

/** Every app's templates, as partials: { [name]: path in the module }. */
export const APP_PARTIALS = Object.fromEntries(
  Object.entries(APP_MANIFEST).flatMap(([id, { partials = {} }]) => [
    [appPartial(id), `apps/${id}/${id}.hbs`],
    ...Object.entries(partials).map(([name, file]) => [name, `apps/${id}/${file}`])
  ])
);

/** Every app's settings: [{ key, app, ...setting }]. */
export const APP_SETTINGS = Object.entries(APP_MANIFEST).flatMap(([app, { settings = {} }]) => Object.entries(settings).map(([key, data]) => ({ key, app, ...data })));

/** BangMe!'s ledger kinds the apps add: { kind: label }. */
export const APP_LEDGER = Object.assign({}, ...Object.values(APP_MANIFEST).map(app => app.ledger ?? {}));

/** Every app's host data tables: { [name]: { monthly?, owner, app } }. */
export const APP_TABLES = Object.fromEntries(
  Object.entries(APP_MANIFEST).flatMap(([app, { tables = {} }]) => Object.entries(tables).map(([name, table]) => [name, { ...table, app }]))
);

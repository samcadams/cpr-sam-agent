import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { appsOn, emptyApps, phoneApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import {
  cleanListing, DEFAULT_LISTINGS, installedSet, isDue, isInstalled, isLapsed, poolConfig, priceLabel, setSubsBilledBy, storeAction, storeApps, subscriptionState, subscriptionsOf
} from "../apps/pool/model.js";
import { MONTH } from "../apps/trauma/model.js";

/*
 * Ziggurat Pool (apps/pool/model.js, apps/pool/host.js): the first switch-on keeps phones as they
 * were, buying through BangMe!, uninstalling and reinstalling, subscriptions and their bill, the GM's
 * revoke and refund, and a Fixer's sideloaded package.
 */

let gm, alice;

const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const wealth = id => game.actors.get(id).system.wealth.value;
const has = (id, app) => isInstalled(store.apps.installs, id, app);
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);

beforeEach(async () => {
  await store._writing;
  reset();
  setSubsBilledBy(null);
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500 });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

/** Switch the App Store on (and any other apps). */
async function poolOn(extra = {}) {
  await set("features", { app_pool: true, ...extra });
}

test("defaults: the free Ziggurat apps are preinstalled, BangMe! is 10eb, the Pool itself can't be priced", () => {
  const cfg = poolConfig({ apps: { pool: { price: 99, model: "once", preinstalled: false } } });
  assert.ok(cfg.apps.agent.preinstalled && cfg.apps.alex.preinstalled && cfg.apps.garden.preinstalled);
  assert.equal(priceLabel(cfg.apps.bangme), "§10");
  assert.equal(priceLabel(cfg.apps.cabb), "Free");
  assert.deepEqual([cfg.apps.pool.price, cfg.apps.pool.preinstalled], [0, true]);
  assert.equal(priceLabel({ model: "monthly", price: 50 }), "§50/mo");
  // Publishers; no rules lines on the cards any more.
  assert.deepEqual(["bangme", "market", "redline", "roach", "breach", "watchbox"].map(id => cfg.apps[id].publisher),
    ["Eurobank", "Ziggurat", "NC Games LLC", "NC Games LLC", "Unspecified", "No/Brainer"]);
  assert.ok(Object.values(cfg.apps).every(e => !("rules" in e)));
});

test("listings: Black Chrome's apps come first with their pictures; a removed one stays gone; pictures stay local", async () => {
  const ids = poolConfig({}).listings.map(l => l.id);
  assert.deepEqual(ids, DEFAULT_LISTINGS.map(l => l.id));
  assert.ok(poolConfig({}).listings.every(l => !l.img && l.icon), "no content folder: the icon");
  await game.settings.set("cpr-sam-agent", "contentFolder", "content");
  await game.settings.set("cpr-sam-agent", "contentFiles", ["apps/ziggurat-city-database.webp"]);
  assert.equal(poolConfig({}).listings[0].img, "content/apps/ziggurat-city-database.webp", "its picture from the content folder");
  const mine = cleanListing({ name: "Weather", icon: "fas fa-cloud-rain", img: "worlds/x/weather.png" }, "w1");
  const cfg = poolConfig({ removedListings: ["bc-gladiator"], listings: [mine] });
  assert.deepEqual(cfg.listings.map(l => l.id), ["bc-citydb", "w1"]);
  assert.equal(mine.img, "worlds/x/weather.png");
  for (const img of ["https://evil.example/x.png", "javascript:alert(1)//.png", "../../x.png", "a.png\" onerror=\"x", "notes.txt"]) {
    assert.equal(cleanListing({ name: "X", img }).img, undefined, img);
  }
});

test("switching the App Store on installs nothing: every character starts with only the preinstalled apps", async () => {
  await poolOn();
  assert.ok(!has("pcA", "bangme") && !has("pcA", "cabb"), "V gets the rest from the store, though they were on");
  assert.deepEqual(store.apps.installs, {}, "no rows written");
  addActor({ id: "pcB", name: "Judy", owners: ["alice"], wealth: 100 });
  const judy = installedSet(store.apps.installs, "pcB");
  assert.ok(judy.has("agent") && judy.has("alex") && judy.has("pool"));
  assert.ok(!judy.has("bangme") && !judy.has("cabb"), "Judy downloads the rest");
  // The phone's home screen follows the installs; the GM Phone has every app.
  const ids = phoneApps({ installed: judy }).map(a => a.id);
  assert.ok(ids.includes("alex") && ids.includes("pool") && !ids.includes("cabb"));
  assert.ok(phoneApps({ gm: true, installed: judy }).some(a => a.id === "cabb"));
  assert.ok(appsOn(false, null).some(a => a.id === "cabb"), "no installs layer: every app that's on");
});

test("buying through BangMe!: declined installs nothing; uninstalled, it reinstalls free", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { watchbox: { price: 600, model: "once" } } });
  assert.equal(storeAction(store.apps.installs, "pcA", "watchbox"), "buy");
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(!has("pcA", "watchbox"));
  assert.match(lastAlert("pcA").text, /Declined/);

  await set("pool", { seeded: 1, apps: { watchbox: { price: 50, model: "once" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(has("pcA", "watchbox"));
  assert.equal(wealth("pcA"), 450);
  assert.ok(Object.values(store.apps.ledger).some(e => e.kind === "pool" && e.amount === -50));

  from(alice, "pool-remove", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(!has("pcA", "watchbox"));
  assert.equal(storeAction(store.apps.installs, "pcA", "watchbox"), "get", "owned: free to reinstall");
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(has("pcA", "watchbox"));
  assert.equal(wealth("pcA"), 450, "not charged twice");

  from(alice, "pool-remove", { actorId: "pcA", app: "alex" });
  await settle();
  assert.ok(has("pcA", "alex"), "preinstalled apps stay");
});

test("only what the store offers (and what's theirs); no signal, no App Store", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { cabb: { offer: "fixer" } } });
  assert.ok(!storeApps(store.apps.installs, "pcA").includes("cabb"));
  from(alice, "pool-get", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.ok(!has("pcA", "cabb"), "Fixer-only apps aren't in the store");

  // One the GM gave them is listed again once uninstalled, so it can be reinstalled.
  from(gm, "pool-grant", { actorId: "pcA", app: "cabb" });
  await settle();
  from(alice, "pool-remove", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.ok(!has("pcA", "cabb"));
  assert.ok(storeApps(store.apps.installs, "pcA").includes("cabb"), "back in the store's list");
  assert.equal(storeAction(store.apps.installs, "pcA", "cabb"), "get");
  from(alice, "pool-get", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.ok(has("pcA", "cabb"), "reinstalled");

  await set("noSignal", { pcA: 1 });
  from(alice, "pool-get", { actorId: "pcA", app: "trauma" });
  await settle();
  assert.ok(!has("pcA", "trauma"));
  assert.match(lastAlert("pcA").text, /No signal/);
});

test("subscriptions: the first month now, the GM's bill later, lapsed when unpaid, renewed", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { cabb: { price: 50, model: "monthly" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.equal(wealth("pcA"), 450);
  const [sub] = subscriptionsOf(store.apps.installs, "pcA");
  assert.equal(sub.status, "active");
  assert.equal(sub.paidThrough, MONTH);

  // Nothing bills by itself; a month on, the GM bills what's due.
  game.time.worldTime = MONTH + 10;
  from(gm, "pool-bill", { actorId: "pcA" });
  await settle();
  assert.equal(wealth("pcA"), 400);
  assert.equal(subscriptionsOf(store.apps.installs, "pcA")[0].paidThrough, 2 * MONTH + 10);
  from(alice, "pool-bill", { actorId: "pcA", all: true });
  await settle();
  assert.equal(wealth("pcA"), 400, "players can't bill");

  // Can't pay: it lapses, stays installed, locked.
  game.actors.get("pcA").system.wealth.value = 10;
  from(gm, "pool-bill", { actorId: "pcA", all: true });
  await settle();
  assert.ok(isLapsed(store.apps.installs, "pcA", "cabb"));
  assert.ok(has("pcA", "cabb"));
  assert.equal(storeAction(store.apps.installs, "pcA", "cabb"), "renew");

  game.actors.get("pcA").system.wealth.value = 100;
  from(alice, "pool-renew", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.ok(!isLapsed(store.apps.installs, "pcA", "cabb"));
  assert.equal(wealth("pcA"), 50);

  // Sponsored: never billed. Cancelled: gone.
  from(gm, "pool-sub", { actorId: "pcA", app: "cabb", sponsor: "Rogue" });
  await settle();
  assert.equal(subscriptionState(store.apps.installs, "pcA").total, 0);
  from(alice, "pool-cancel", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.ok(!has("pcA", "cabb"));
  assert.equal(subscriptionsOf(store.apps.installs, "pcA").length, 0);
});

test("handed off (CPR HQ): subscribing charges nothing; the state says what goes on the bill", async () => {
  setSubsBilledBy("CPR HQ");
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { cabb: { price: 50, model: "monthly" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.equal(wealth("pcA"), 500);
  const state = subscriptionState(store.apps.installs, "pcA");
  assert.deepEqual([state.total, state.billedBy, state.items[0].name], [50, "CPR HQ", "Combat Cabb"]);
  from(gm, "pool-bill", { actorId: "pcA", all: true });
  await settle();
  assert.equal(wealth("pcA"), 500, "the Pool's own bill is off while another module bills");
  store._traumaChanges(false);
  store._subsChanges();
  from(gm, "pool-sub", { actorId: "pcA", app: "cabb", status: "lapsed" });
  await settle();
  store._applyApps(store.apps);
  assert.ok(hooks.some(h => h.hook === "cpr-sam-agent.subscriptionsChanged" && h.args[0].items[0]?.status === "lapsed"));
  assert.ok(!hooks.some(h => h.hook === "cpr-sam-agent.traumaChanged"), "Trauma Team's hook doesn't fire for an app subscription");
});

test("HusTool is sold only with CPR HQ; one they have stays listed, and the GM still gives it", async () => {
  await set("features", { app_pool: true, app_hustool: true });
  game.modules.clear();
  assert.ok(!storeApps(store.apps.installs, "pcA").includes("hustool"), "not without CPR HQ");
  from(alice, "pool-get", { actorId: "pcA", app: "hustool" });
  await settle();
  assert.ok(!has("pcA", "hustool") && wealth("pcA") === 500, "nothing bought");

  game.modules.set("cpr-hq", { active: true });
  assert.ok(storeApps(store.apps.installs, "pcA").includes("hustool"));
  from(alice, "pool-get", { actorId: "pcA", app: "hustool" });
  await settle();
  assert.ok(has("pcA", "hustool"));

  // CPR HQ off: theirs stays listed, and reinstalls once uninstalled.
  game.modules.set("cpr-hq", { active: false });
  assert.ok(storeApps(store.apps.installs, "pcA").includes("hustool"), "installed");
  from(alice, "pool-remove", { actorId: "pcA", app: "hustool" });
  await settle();
  assert.ok(storeApps(store.apps.installs, "pcA").includes("hustool"), "owned");
  from(alice, "pool-get", { actorId: "pcA", app: "hustool" });
  await settle();
  assert.ok(has("pcA", "hustool") && wealth("pcA") === 480, "reinstalled free");

  addActor({ id: "pcB", name: "Judy", owners: ["alice"], wealth: 500 });
  from(gm, "pool-grant", { actorId: "pcB", app: "hustool" });
  await settle();
  assert.ok(has("pcB", "hustool"), "the GM's grant");
  game.modules.clear();
});

test("handed back: subs billed by CPR HQ have no month; the Agent's tick bills them from a month from now", async () => {
  setSubsBilledBy("CPR HQ");
  await set("features", { app_pool: true, app_cabb: true, app_ncart: true, app_map: true });
  await set("pool", { seeded: 1, apps: { cabb: { price: 50, model: "monthly" }, ncart: { price: 10, model: "monthly" }, map: { price: 5, model: "monthly" } } });
  for (const app of ["cabb", "ncart", "map"]) from(alice, "pool-get", { actorId: "pcA", app });
  await settle();
  const sub = app => store.apps.installs.pcA[app].sub;
  assert.equal(sub("cabb").paidThrough, null, "subscribe");

  // Lapsed and renewed (or made active by the GM) under CPR HQ: still no month of its own.
  store.apps.installs.pcA.cabb.sub.paidThrough = 123;
  from(gm, "pool-sub", { actorId: "pcA", app: "cabb", status: "lapsed" });
  await settle();
  from(alice, "pool-renew", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.deepEqual([sub("cabb").status, sub("cabb").paidThrough, wealth("pcA")], ["active", null, 500], "renew");
  store.apps.installs.pcA.ncart.sub.paidThrough = 123;
  from(gm, "pool-sub", { actorId: "pcA", app: "ncart", status: "lapsed" });
  from(gm, "pool-sub", { actorId: "pcA", app: "ncart", status: "active" });
  await settle();
  assert.equal(sub("ncart").paidThrough, null, "the GM's re-activation");

  // A sponsored one and a cancelled one are left alone.
  from(gm, "pool-sub", { actorId: "pcA", app: "ncart", sponsor: "Rogue" });
  from(alice, "pool-cancel", { actorId: "pcA", app: "map" });
  await settle();

  game.time.worldTime = 1000;
  store._tickPool();
  assert.equal(sub("cabb").paidThrough, null, "not while CPR HQ bills");
  setSubsBilledBy(null);
  store._tickPool();
  assert.equal(sub("cabb").paidThrough, 1000 + MONTH);
  assert.ok(!isDue(subscriptionsOf(store.apps.installs, "pcA").find(s => s.app === "cabb")), "not due");
  assert.deepEqual([sub("ncart").paidThrough, sub("map").paidThrough], [null, null], "sponsored, cancelled: untouched");
});

test("the GM revokes with a reason and a refund, and gives an app back", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { watchbox: { price: 50, model: "once" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  from(gm, "pool-revoke", { actorId: "pcA", app: "watchbox", reason: "Bricked by a virus", refund: true });
  await settle();
  assert.ok(!has("pcA", "watchbox"));
  assert.equal(wealth("pcA"), 500);
  assert.ok(Object.values(store.apps.alerts).some(a => /Bricked by a virus/.test(a.text)));
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(!has("pcA", "watchbox"), "a revoked app can't be reinstalled");
  from(gm, "pool-revoke", { actorId: "pcA", app: "alex", reason: "Confiscated" });
  await settle();
  assert.ok(!has("pcA", "alex"), "preinstalled apps can be taken too");
  from(gm, "pool-grant", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(has("pcA", "watchbox"));

  // A subscription the GM grants is theirs: no more bills. One the GM makes free stops billing too.
  await set("pool", { seeded: 1, apps: { cabb: { price: 50, model: "monthly" }, trauma: { price: 5, model: "monthly" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "cabb" });
  from(alice, "pool-get", { actorId: "pcA", app: "trauma" });
  await settle();
  assert.equal(subscriptionState(store.apps.installs, "pcA").total, 55);
  from(gm, "pool-grant", { actorId: "pcA", app: "cabb" });
  await settle();
  assert.equal(subscriptionState(store.apps.installs, "pcA").total, 5);
  await set("pool", { seeded: 1, apps: { trauma: { model: "free" } } });
  assert.equal(subscriptionsOf(store.apps.installs, "pcA").length, 0);
});

test("sideloading: a Fixer's package installs when its request is paid, or with Install when free", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { breach: { offer: "fixer" } } });
  from(gm, "pool-sideload", { actorId: "pcA", contact: "Rogue", app: "breach", price: 100 });
  await settle();
  const thread = store.findThread("pcA", "Rogue");
  const msg = thread.messages.at(-1);
  assert.deepEqual([msg.pkg.app, msg.money.amount, msg.from], ["breach", 100, "contact"]);
  from(alice, "money-respond", { threadId: thread.id, messageId: msg.id, action: "pay" });
  await settle();
  assert.ok(has("pcA", "breach"));
  assert.equal(store.apps.installs.pcA.breach.source, "sideload");
  assert.equal(msg.pkg.status, "installed");
  assert.equal(wealth("pcA"), 400);

  from(gm, "pool-sideload", { actorId: "pcA", contact: "Rogue", app: "pigeon", price: 0 });
  await settle();
  const free = thread.messages.at(-1);
  assert.ok(!free.money);
  from(alice, "pool-pkg", { threadId: thread.id, messageId: free.id });
  await settle();
  assert.equal(free.pkg.status, "installed");
  assert.ok(store.apps.installs.pcA.pigeon && !store.apps.installs.pcA.pigeon.removed);

  from(gm, "pool-sideload", { actorId: "pcA", contact: "Rogue", app: "gacha", price: 20 });
  await settle();
  const declined = thread.messages.at(-1);
  from(alice, "money-respond", { threadId: thread.id, messageId: declined.id, action: "decline" });
  await settle();
  assert.equal(declined.pkg.status, "declined");
  assert.ok(!store.apps.installs.pcA.gacha);
});

test("the GM forgets a purchase: it must be bought again, with no refund", async () => {
  await set("features", { app_pool: true });
  await set("pool", { seeded: 1, apps: { watchbox: { price: 50, model: "once" } } });
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.equal(wealth("pcA"), 450);
  from(alice, "pool-forget", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(has("pcA", "watchbox"), "only the GM can forget a purchase");
  from(gm, "pool-forget", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(!has("pcA", "watchbox"));
  assert.equal(store.apps.installs.pcA.watchbox, undefined, "no row, so no revoked or removed marker");
  assert.equal(wealth("pcA"), 450, "nothing refunded");
  assert.equal(storeAction(store.apps.installs, "pcA", "watchbox"), "buy");
  from(alice, "pool-get", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.ok(has("pcA", "watchbox"));
  assert.equal(wealth("pcA"), 400, "bought again at full price");

  // Uninstalled: the free reinstall goes too. Preinstalled apps stay, even revoked ones.
  from(alice, "pool-remove", { actorId: "pcA", app: "watchbox" });
  await settle();
  from(gm, "pool-forget", { actorId: "pcA", app: "watchbox" });
  await settle();
  assert.equal(storeAction(store.apps.installs, "pcA", "watchbox"), "buy");
  from(gm, "pool-revoke", { actorId: "pcA", app: "alex", reason: "Confiscated" });
  await settle();
  from(gm, "pool-forget", { actorId: "pcA", app: "alex" });
  await settle();
  assert.equal(store.apps.installs.pcA.alex?.revoked, "Confiscated", "a preinstalled app's row stays");
});

test("the API: installed apps, grant and revoke, subscriptions for a billing module", async () => {
  const { api } = await import("../scripts/api.js");
  assert.ok(api.pool.has("V", "cabb"), "Pool off: every app that's on");
  await poolOn();
  addActor({ id: "pcB", name: "Judy", owners: ["alice"], wealth: 100 });
  assert.ok(!api.pool.has("Judy", "cabb"));
  await api.pool.grant({ actor: "Judy", app: "cabb" });
  await settle();
  assert.ok(api.pool.has("Judy", "cabb"));
  assert.ok(api.pool.installed("Judy").includes("cabb"));
  await api.pool.revoke({ actor: "Judy", app: "cabb", reason: "Confiscated" });
  await settle();
  assert.ok(!api.pool.has("Judy", "cabb"));
  assert.throws(() => api.pool.has("Judy", "nope"), /No app "nope"/);
  api.subscriptions.handOffBilling("CPR HQ");
  assert.equal(api.subscriptions.billedBy(), "CPR HQ");
  assert.deepEqual(api.subscriptions.state("Judy"), { items: [], total: 0, billedBy: "CPR HQ" });
  await assert.rejects(api.subscriptions.update({ actor: "Judy", app: "cabb", status: "paused" }), /use "active"/);
});

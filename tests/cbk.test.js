import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { isInstalled, rowsOf } from "../apps/pool/model.js";
import { PRESETS } from "../apps/cbk/presets.js";
import {
  auctionable, auctionOf, bidderLabels, bidProblem, boothLine, broadcastText, buyProblem, canBroadcast, canEnter, categoryOf, CATEGORIES, cbkConfig, cleanConfig, courierName, dealKey, flashOf,
  inviteKey, marketFromPreset, MIN_RAISE, minBid, parseBooths, passcodeProblem, pendingBroadcasts, pickupProblem, playRex, priceNow, receiptCode, receiptsOf, REX_PCT, shownMarkets, upcomingMarkets
} from "../apps/cbk/model.js";
import { setContentAchievements } from "../scripts/model/content.js";

// Achieve!'s Investment comes from the content folder's achievements.json (model/content.js).
setContentAchievements([{ id: "investment", name: "Investment", text: "" }]);

/*
 * CBK (apps/cbk/model.js, host.js): Black Chrome's Night Market app. The presets, the rules, and the host's
 * BUY NOW!!! → receipt → pick up at the booth (only while the market is live), hand over and refund.
 */

let gm, alice;
const set = (key, value) => game.settings.set("cpr-sam-agent", key, value);
const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
const settle = async () => {
  await store._enqueue(() => {});
  await store._writing;
};
const wealth = id => game.actors.get(id).system.wealth.value;
const lastAlert = id => Object.values(store.apps.alerts).filter(a => a.actorId === id).sort((a, b) => a.ts - b.ts).at(-1);
const receipts = () => Object.values(store.apps.receipts);
const stockOf = id => cbkConfig(store.apps.cbkStock).markets[0].listings.find(l => l.id === id).stock;
const market = (over = {}) => ({
  id: "mC", letter: "C", name: "Molly Anderson's Market", fixer: "Molly Anderson", live: true, booths: { 4: "Weapons" },
  listings: [
    { id: "l1", uuid: "Item.gun", name: "Westwood", img: "gun.png", type: "weapon", corp: "Nova Arms", category: "weapons", sub: "Firearms", booths: ["C4"], price: 500, stock: 1 },
    { id: "l2", uuid: null, name: "Triti-Fizz", type: "gear", category: "gear", booths: ["C6"], price: 10, stock: null }
  ],
  ...over
});

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  const v = addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 600 });
  v.created = [];
  v.createEmbeddedDocuments = async (type, docs) => {
    v.created.push(...docs);
    return docs;
  };
  const gun = { uuid: "Item.gun", name: "Westwood", type: "weapon", documentName: "Item", system: {}, toObject() {
    return { name: this.name, type: this.type, system: {} };
  } };
  globalThis.fromUuid = async uuid => (uuid === gun.uuid ? gun : null);
  await set("cbk", { markets: [market()] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("CBK presets: Black Chrome's six markets, every listing with a booth in its own market", () => {
  assert.deepEqual(PRESETS.map(p => p.letter), ["A", "B", "C", "D", "E", "F"]);
  for (const p of PRESETS) {
    assert.ok(p.listings.length > 10, `${p.name} has listings`);
    for (const [name, , category, , booths, price] of p.listings) {
      assert.ok(category in CATEGORIES, `${name}: ${category}`);
      assert.ok(booths.length && booths.every(b => b.startsWith(p.letter)), `${name} is at a booth of ${p.letter}`);
      assert.ok(price > 0, `${name} has a price`);
    }
  }
  const ids = [];
  const m = marketFromPreset("B", name => (name === "Westwood" ? { uuid: "Item.gun", name: "Westwood", img: "g.png", type: "weapon" } : null), () => `id${ids.push(1)}`);
  assert.equal(m.name, "Woodchipper's Block Party");
  assert.equal(m.live, false, "a new market starts offline");
  assert.ok(m.listings.every(l => l.id && l.booths.length));
  assert.ok(m.listings.some(l => !l.uuid), "unmatched names are kept");
});

test("CBK rules: booths, categories, buying and picking up", () => {
  assert.deepEqual(parseBooths("c1 / E3, x"), ["C1", "E3"]);
  assert.equal(boothLine(["C1", "E3"]), "Pick-up or Browse at Booth C1/E3");
  assert.equal(categoryOf("armor"), "fashion");
  assert.equal(categoryOf("gear", "LF-001 SWAT Linear Frame"), "frames");
  const config = cleanConfig({ markets: [market()] });
  const [m] = config.markets;
  assert.equal(buyProblem({ market: m, listing: m.listings[0], wealth: 600 }), null);
  assert.match(buyProblem({ market: m, listing: m.listings[0], wealth: 100 }), /can't afford/);
  assert.match(buyProblem({ market: { ...m, live: false }, listing: m.listings[0], wealth: 600 }), /isn't broadcasting/);
  assert.match(buyProblem({ market: m, listing: { ...m.listings[0], stock: 0 }, wealth: 600 }), /sold out/);
  assert.equal(buyProblem({ market: m, listing: m.listings[1], wealth: null }), null, "no wallet, no budget");
  const r = { status: "paid", marketId: "mC", market: m.name };
  assert.equal(pickupProblem(r, config), null);
  assert.match(pickupProblem(r, cleanConfig({ markets: [market({ live: false })] })), /closed/);
  assert.match(pickupProblem({ ...r, status: "picked" }, config), /already/);
  assert.match(receiptCode("abcdef123456"), /^CBK-123456$/);
});

test("CBK: BUY NOW!!! charges and writes a receipt; the item waits at the booth until picked up", async () => {
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  const [r] = receipts();
  assert.equal(r.status, "paid");
  assert.equal(wealth("pcA"), 100);
  assert.equal(stockOf("l1"), 0, "the last one is gone");
  assert.equal(game.settings.get("cpr-sam-agent", "cbk").markets[0].listings[0].stock, 1, "the host never writes the GM's setting");
  assert.equal(game.actors.get("pcA").created.length, 0, "nothing in the gear yet");
  assert.match(lastAlert("pcA").text, /Booth C4: show receipt CBK-/);
  assert.ok(Object.values(store.apps.ledger).some(l => l.actorId === "pcA" && l.amount === -500 && l.kind === "cbk"));
  assert.deepEqual(receiptsOf(store.apps.receipts, "pcA").map(x => x.id), [r.id]);

  // Sold out now.
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(receipts().length, 1);
  assert.match(lastAlert("pcA").text, /sold out/);

  // Pick up at the booth: the item goes in the gear, once.
  from(alice, "cbk-pickup", { actorId: "pcA", receiptId: r.id });
  await settle();
  assert.equal(store.apps.receipts[r.id].status, "picked");
  assert.deepEqual(game.actors.get("pcA").created.map(i => [i.name, i.flags["cpr-sam-agent"].cbk.receipt]), [["Westwood", r.id]]);
  from(alice, "cbk-pickup", { actorId: "pcA", receiptId: r.id });
  await settle();
  assert.equal(game.actors.get("pcA").created.length, 1);
});

test("CBK: pick-up only while the market is live; the GM hands over or refunds", async () => {
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l2" });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l2" });
  await settle();
  const [a, b] = receipts();
  assert.equal(wealth("pcA"), 580);
  await set("cbk", { markets: [market({ live: false })] });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l2" });
  from(alice, "cbk-pickup", { actorId: "pcA", receiptId: a.id });
  await settle();
  assert.equal(receipts().length, 2, "a closed market sells nothing");
  assert.equal(store.apps.receipts[a.id].status, "paid");
  assert.match(lastAlert("pcA").text, /closed/);

  from(alice, "cbk-handover", { receiptId: a.id });
  await settle();
  assert.equal(store.apps.receipts[a.id].status, "paid", "only a GM hands over");
  from(gm, "cbk-handover", { receiptId: a.id });
  await settle();
  assert.equal(store.apps.receipts[a.id].status, "picked");
  const fizz = game.actors.get("pcA").created.at(-1);
  assert.equal(fizz.name, "Triti-Fizz", "no item found: a plain gear item by that name");
  assert.equal(fizz.type, "gear");

  from(gm, "cbk-refund", { receiptId: b.id });
  await settle();
  assert.equal(store.apps.receipts[b.id].status, "refunded");
  assert.equal(wealth("pcA"), 590);
  assert.match(lastAlert("pcA").text, /Refunded/);
});

test("CBK stock: the host owns the stock left, so a GM edit and a sale can't overwrite each other", async () => {
  await set("cbk", { markets: [market({ listings: [{ ...market().listings[0], stock: 2 }] })] });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  // The GM edits the listing meanwhile (a stale copy of the setting: stock 2 and a new price).
  await set("cbk", { markets: [market({ listings: [{ ...market().listings[0], stock: 2, price: 50 }] })] });
  await settle();
  assert.equal(stockOf("l1"), 1, "the sale still counts");
  assert.equal(game.settings.get("cpr-sam-agent", "cbk").markets[0].listings[0].price, 50, "and so does the GM's edit");

  // Two buyers for the last one: one gets it.
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(receipts().length, 2);
  assert.equal(stockOf("l1"), 0);

  // Restocking is the GM's, through the host.
  from(alice, "cbk-restock", { marketId: "mC", listingId: "l1", stock: 9 });
  await settle();
  assert.equal(stockOf("l1"), 0, "players can't restock");
  await set("cbk", { markets: [market({ listings: [{ ...market().listings[0], stock: 3 }] })] }); // the GM Phone saves first
  from(gm, "cbk-restock", { marketId: "mC", listingId: "l1", stock: 3 });
  await settle();
  assert.equal(stockOf("l1"), 3);
  assert.equal(store.apps.cbkStock["mC:l1"].base, 3);
  from(gm, "cbk-restock", { marketId: "mC", listingId: "l1", stock: -1 });
  await settle();
  assert.equal(stockOf("l1"), 3, "nonsense is ignored");

  // A refund puts it back on the shelf.
  from(gm, "cbk-refund", { receiptId: receipts()[0].id });
  await settle();
  assert.equal(stockOf("l1"), 4);

  // A new value written to the setting by hand (a macro) counts again; so does unlimited.
  await set("cbk", { markets: [market({ listings: [{ ...market().listings[0], stock: 7 }] })] });
  assert.equal(stockOf("l1"), 7);
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(stockOf("l1"), 6);
  await set("cbk", { markets: [market({ listings: [{ ...market().listings[0], stock: null }] })] });
  from(gm, "cbk-restock", { marketId: "mC", listingId: "l1", stock: null });
  await settle();
  assert.equal(stockOf("l1"), null);
  assert.equal(store.apps.cbkStock["mC:l1"], undefined);
});

test("CBK: a Luxury or Super Luxury buy earns Achieve!'s Investment, while Achieve! is on", async () => {
  const rich = (price, id) => ({ ...market().listings[0], id, price, stock: null });
  await set("cbk", { markets: [market({ listings: [rich(1000, "cheap"), rich(1001, "lux"), rich(1002, "lux2")] })] });
  game.actors.get("pcA").system.wealth.value = 10000;
  const investment = () => store.apps.earned?.pcA?.investment;
  globalThis.ChatMessage = { created: [], async create(data) { this.created.push(data); } };

  await set("features", { app_achieve: false });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "lux" });
  await settle();
  assert.equal(investment(), undefined, "Achieve! off: nothing earned");

  await set("features", { app_achieve: true });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "cheap" });
  await settle();
  assert.equal(investment(), undefined, "Very Expensive isn't Luxury");

  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "lux" });
  await settle();
  assert.match(investment().note, /Westwood for .*1,001.* at Molly Anderson's Market/);
  const { ts } = investment();
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "lux2" });
  await settle();
  assert.equal(investment().ts, ts, "earned once");
  assert.equal(ChatMessage.created.filter(m => /Investment/.test(m.content)).length, 1, "announced once");
});

test("CBK broadcasts: kept clean on the market; a flash sale is a real discount until it ends", () => {
  const now = 1_000_000;
  const flash = (id, pct, target, until = now + 600000) => ({ id, kind: "flash", ts: now, until, pct, target });
  const config = cleanConfig({ markets: [market({ broadcasts: [
    flash("f1", 20, { listingId: "l1" }), flash("f2", 50, { category: "weapons" }), flash("old", 90, { listingId: "l1" }, now - 1),
    { id: "r1", kind: "raid", ts: now + 1, by: "hostiles", text: "Maelstrom at the gate" }, { id: "p1", kind: "policy", ts: now + 2, text: "No drawn weapons" },
    { id: "x", kind: "party", ts: now }, flash("bad", 10, null)
  ] })] });
  const [m] = config.markets;
  assert.deepEqual(m.broadcasts.map(b => b.id), ["p1", "r1", "f1", "f2", "old"], "unknown kinds and untargeted sales dropped, newest first");
  assert.equal(flashOf(m, m.listings[0], now).id, "f2", "the biggest discount wins, no stacking");
  assert.equal(priceNow(m, m.listings[0], now), 250);
  assert.equal(priceNow(m, m.listings[1], now), 10, "Triti-Fizz isn't a weapon");
  assert.equal(priceNow(m, m.listings[0], now + 600000), 500, "the sale ends on time");
  assert.equal(priceNow({ ...m, live: false }, m.listings[0], now), 500);
  assert.equal(buyProblem({ market: m, listing: m.listings[0], wealth: 300, now }), null, "affordable on sale");
  assert.match(buyProblem({ market: m, listing: m.listings[0], wealth: 300, now: now + 600000 }), /can't afford/);
  assert.equal(broadcastText(m.broadcasts[2], m), "Flash sale: 20% off Westwood for 10 minutes!");
  assert.equal(broadcastText(m.broadcasts[1], m), "Hostiles incoming! Maelstrom at the gate");
  assert.equal(broadcastText(m.broadcasts[0], m), "Policy reminder: No drawn weapons");
  assert.ok(canBroadcast(gm, m) && !canBroadcast(alice, m), "the GM only, for now");
  const many = cleanConfig({ markets: [market({ broadcasts: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, kind: "date", ts: now + i, text: "Friday" })) })] });
  assert.equal(many.markets[0].broadcasts.length, 20, "the newest 20 are kept");
});

test("CBK broadcasts: what waits for the phone: not dismissed, this character's, the market live, still running", () => {
  const now = Date.now();
  const config = cleanConfig({ markets: [market({ broadcasts: [
    { id: "r1", kind: "raid", ts: now, by: "NCPD" },
    { id: "f1", kind: "flash", ts: now, until: now + 60000, pct: 50, target: { listingId: "l1" } },
    { id: "f2", kind: "flash", ts: now, until: now - 1, pct: 50, target: { listingId: "l1" } }
  ] })] });
  const ref = broadcastId => ({ type: "cbk-broadcast", marketId: "mC", broadcastId });
  const alerts = {
    a: { id: "a", actorId: "pcA", ts: 1, ref: ref("r1") }, b: { id: "b", actorId: "pcA", ts: 2, ref: ref("f1") },
    over: { id: "over", actorId: "pcA", ts: 3, ref: ref("f2") }, gone: { id: "gone", actorId: "pcA", ts: 4, ref: ref("nope") },
    done: { id: "done", actorId: "pcA", ts: 5, ref: ref("f1"), cleared: true }, other: { id: "other", actorId: "pcB", ts: 6, ref: ref("f1") },
    plain: { id: "plain", actorId: "pcA", ts: 7, ref: null }
  };
  assert.deepEqual(pendingBroadcasts(alerts, "pcA", config, now).map(p => p.alert.id), ["b", "a"], "newest first");
  config.markets[0].live = false;
  assert.deepEqual(pendingBroadcasts(alerts, "pcA", config, now), [], "nothing once the market closes");
});

test("CBK broadcasts: the GM's broadcast reaches every phone with a signal; BUY NOW!!! charges the sale price", async () => {
  addActor({ id: "pcB", name: "Bex", owners: ["alice"], wealth: 50 });
  addActor({ id: "pcC", name: "No Agent", owners: ["alice"], items: [] });
  const now = Date.now();
  await set("cbk", { markets: [market({ broadcasts: [
    { id: "f1", kind: "flash", ts: now, until: now + 600000, pct: 50, target: { listingId: "l1" } },
    { id: "r1", kind: "raid", ts: now, by: "NCPD", text: "Scatter" }
  ] })] });
  from(alice, "cbk-broadcast", { marketId: "mC", broadcastId: "r1" });
  await settle();
  assert.equal(lastAlert("pcA"), undefined, "players can't broadcast");

  from(gm, "cbk-broadcast", { marketId: "mC", broadcastId: "r1" });
  await settle();
  for (const id of ["pcA", "pcB"]) {
    assert.equal(lastAlert(id).kind, "raid");
    assert.equal(lastAlert(id).app, "cbk");
    assert.equal(lastAlert(id).from, "Molly Anderson");
    assert.match(lastAlert(id).text, /^Molly Anderson's Market: NCPD raid incoming! Scatter$/);
    assert.deepEqual(lastAlert(id).ref, { type: "cbk-broadcast", marketId: "mC", broadcastId: "r1" });
  }
  assert.equal(lastAlert("pcC"), undefined, "no Agent, no alert");

  from(gm, "cbk-broadcast-end", { marketId: "mC", broadcastId: "r1" });
  await settle();
  assert.match(lastAlert("pcA").text, /All clear/);

  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(wealth("pcA"), 350, "half price");
  assert.equal(receipts()[0].price, 250, "the receipt says what they paid");

  await set("cbk", { markets: [market({ live: false, broadcasts: [{ id: "d1", kind: "date", ts: now, text: "Friday" }] })] });
  const before = Object.keys(store.apps.alerts).length;
  from(gm, "cbk-broadcast", { marketId: "mC", broadcastId: "d1" });
  await settle();
  assert.equal(Object.keys(store.apps.alerts).length, before, "an offline market reaches nobody");
});

test("CBK apps: BUY NOW!!! installs the app through the App Store; double-buy refused; a refund uninstalls", async () => {
  await set("features", { app_pool: true, app_watchbox: true, app_cabb: false });
  const app = cleanConfig({ markets: [market({ listings: [{ id: "a1", app: "watchbox", name: "WatchBox", price: 200, booths: ["C4"], stock: 3, category: "gear" }] })] }).markets[0].listings[0];
  assert.deepEqual([app.app, app.category, app.booths, app.stock, app.uuid], ["watchbox", "apps", [], null, null], "an app: no booth, no stock, category Apps");
  await set("cbk", { markets: [market({ listings: [{ id: "a1", app: "watchbox", name: "WatchBox", price: 200 }, { id: "a2", app: "cabb", name: "Combat Cabb", price: 5 }] })] });
  const has = () => isInstalled(store.apps.installs, "pcA", "watchbox");
  assert.equal(has(), false);

  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a1" });
  await settle();
  assert.equal(has(), true, "installed at once");
  assert.equal(rowsOf(store.apps.installs, "pcA").watchbox.source, "cbk");
  assert.equal(rowsOf(store.apps.installs, "pcA").watchbox.paid, 200);
  assert.equal(wealth("pcA"), 400);
  const [r] = receipts();
  assert.equal(r.status, "picked", "nothing to pick up");
  assert.match(lastAlert("pcA").text, /It's on your Agent/);

  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a1" });
  await settle();
  assert.equal(receipts().length, 1, "already installed: refused");
  assert.match(lastAlert("pcA").text, /already on your Agent/);
  assert.equal(wealth("pcA"), 400);

  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a2" });
  await settle();
  assert.equal(receipts().length, 1, "an app switched off in Control isn't sold");

  from(gm, "cbk-refund", { receiptId: r.id });
  await settle();
  assert.equal(store.apps.receipts[r.id].status, "refunded");
  assert.equal(wealth("pcA"), 600);
  assert.equal(has(), false, "uninstalled");
  assert.equal(rowsOf(store.apps.installs, "pcA").watchbox, undefined, "not theirs to reinstall free from the store");
  from(gm, "cbk-refund", { receiptId: r.id });
  await settle();
  assert.equal(wealth("pcA"), 600, "refunded once");

  // A revoked app isn't sold back; a sale price that changed after the confirm isn't charged.
  store._poolRow("pcA", "watchbox", row => (row.revoked = "Confiscated"));
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a1" });
  await settle();
  assert.match(lastAlert("pcA").text, /taken off your Agent/);
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a2", price: 1 });
  await set("features", { app_pool: true, app_watchbox: true, app_cabb: true });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "a2", price: 1 });
  await settle();
  assert.match(lastAlert("pcA").text, /is .*5.* now\. Nothing was charged/);
  assert.equal(wealth("pcA"), 600);
});

/* ---------------- Invites ---------------- */

const inviteOnly = over => market({ access: { mode: "invite", passcode: "Zchat7" }, ...over });
const thread = () => [...store.threads.values()].find(t => t.actorId === "pcA" && t.contact === "Ms. Mynah");
const flagged = marketId => ({ name: "Signed Playing Card", flags: { "cpr-sam-agent": { cbkInvite: marketId } } });

test("CBK invites: rules: an open market is everyone's; an invite-only one needs a row or a carried item", () => {
  const [open] = cleanConfig({ markets: [market()] }).markets;
  assert.deepEqual(open.access, { mode: "open", passcode: "" }, "an old market stays open");
  const config = cleanConfig({ markets: [inviteOnly()] });
  const [m] = config.markets;
  const pc = { id: "pcA", items: [] };
  assert.equal(canEnter(open, pc, {}), true);
  assert.equal(canEnter(m, pc, {}), false);
  assert.deepEqual(shownMarkets(config, pc, {}), [], "a live invite-only market shows nothing without an invite");
  assert.equal(canEnter(m, pc, { [inviteKey("pcA", "mC")]: { via: "passcode" } }), true);
  assert.equal(canEnter(m, { ...pc, items: [flagged("mC")] }, {}), true, "by the item's flag");
  assert.equal(canEnter(m, { ...pc, items: [flagged("other")] }, {}), false, "another market's card");
  assert.equal(canEnter(m, { ...pc, items: [{ name: courierName(m), flags: {} }] }, {}), true, "by a courier invitation's name");
  assert.equal(canEnter(m, { ...pc, items: [{ name: "Signed Playing Card", flags: {} }] }, {}), false, "an unflagged card is only a card");
  const closed = cleanConfig({ markets: [inviteOnly({ live: false })] });
  assert.deepEqual(upcomingMarkets(closed, { ...pc, items: [flagged("mC")] }, {}).map(x => x.id), ["mC"]);
  assert.deepEqual(upcomingMarkets(closed, pc, {}), [], "no invite, no Upcoming");
  assert.deepEqual(upcomingMarkets(config, { ...pc, items: [flagged("mC")] }, {}), [], "live isn't upcoming");
  assert.equal(passcodeProblem(m, " zchat7 "), null);
  assert.match(passcodeProblem(m, "nope"), /Wrong code/);
  assert.match(passcodeProblem(cleanConfig({ markets: [market()] }).markets[0], ""), /Wrong code/, "no passcode set: nothing opens it");
});

test("CBK invites: the host refuses a buy without an invite, and alerts only reach those holding one", async () => {
  await set("cbk", { markets: [inviteOnly()] });
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(receipts().length, 0);
  assert.equal(wealth("pcA"), 600);
  const count = () => Object.values(store.apps.alerts).filter(a => /Now live/.test(a.text)).length;
  addActor({ id: "pcB", name: "B", owners: ["alice"] });
  from(gm, "cbk-live", { marketId: "mC", live: true });
  await settle();
  assert.equal(count(), 0, "GO LIVE doesn't tell a character without an invite");
  store.apps.cbkInvites[inviteKey("pcA", "mC")] = { id: inviteKey("pcA", "mC"), actorId: "pcA", marketId: "mC", via: "passcode" };
  from(gm, "cbk-live", { marketId: "mC", live: true });
  await settle();
  assert.equal(count(), 1, "the invite holder is told");
});

test("CBK invites: passcode: a card in the conversation, a wrong code refused with no lockout, then in", async () => {
  await set("cbk", { markets: [inviteOnly()] });
  from(gm, "cbk-invite-send", { actorId: "pcA", marketId: "mC", contact: "Ms. Mynah" });
  await settle();
  const msg = thread().messages.at(-1);
  assert.equal(msg.cbk.status, "offered");
  assert.match(msg.text, /Zchat7/, "the code is in the message");
  const accept = code => from(alice, "cbk-invite-accept", { threadId: thread().id, messageId: msg.id, code });
  accept("wrong");
  await settle();
  assert.match(lastAlert("pcA").text, /Wrong code/);
  assert.equal(msg.cbk.status, "offered", "can try again");
  assert.deepEqual(store.apps.cbkInvites, {});
  accept("zchat7");
  await settle();
  assert.equal(thread().messages.at(-1).cbk.status, "accepted");
  assert.equal(store.apps.cbkInvites["pcA:mC"].via, "passcode");
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(receipts().length, 1, "now they can buy");
});

test("CBK invites: a market with no passcode sends nothing; card and courier are plain gear flagged for the market", async () => {
  await set("cbk", { markets: [market({ access: { mode: "invite", passcode: "" } })] });
  from(gm, "cbk-invite-send", { actorId: "pcA", marketId: "mC", contact: "Ms. Mynah" });
  await settle();
  assert.equal(thread(), undefined, "no passcode: nothing to send");
  from(gm, "cbk-invite-give", { actorId: "pcA", marketId: "mC", via: "card" });
  from(gm, "cbk-invite-give", { actorId: "pcA", marketId: "mC", via: "courier" });
  await settle();
  const made = game.actors.get("pcA").created;
  assert.deepEqual(made.map(i => i.name), ["Signed Playing Card", "Courier Invitation: Molly Anderson's Market"]);
  assert.ok(made.every(i => i.type === "gear" && i.flags["cpr-sam-agent"].cbkInvite === "mC"));
});

/* ---------------- Message the Fixer ---------------- */

test("CBK Message the Fixer: adds the contact and sends nothing; nothing without a contact or a signal", async () => {
  const contacts = () => (game.actors.get("pcA").getFlag?.("cpr-sam-agent", "contacts") ?? []).map(c => c.name);
  from(alice, "cbk-message-fixer", { actorId: "pcA", marketId: "mC" });
  await settle();
  assert.deepEqual(contacts(), [], "no Fixer contact set");
  assert.equal(cleanConfig({ markets: [market({ fixerContact: "Molly" })] }).markets[0].fixerContact, "Molly");
  await set("cbk", { markets: [market({ fixerContact: "Molly" })] });
  await set("noSignal", { pcA: Date.now() });
  from(alice, "cbk-message-fixer", { actorId: "pcA", marketId: "mC" });
  await settle();
  assert.deepEqual(contacts(), [], "no signal");
  await set("noSignal", {});
  from(alice, "cbk-message-fixer", { actorId: "pcA", marketId: "mC" });
  from(alice, "cbk-message-fixer", { actorId: "pcA", marketId: "mC" });
  await settle();
  assert.deepEqual(contacts(), ["Molly"], "added once");
  assert.equal(store.threads.size, 0, "nothing is sent");
});

/* ---------------- Mister K's auction ---------------- */

const LOT = { id: "lot", uuid: "Item.gun", name: "Westwood", type: "weapon", category: "weapons", booths: ["C4"], price: 10000, stock: 1 };
const startAuction = async (reserve = 0, over = {}) => {
  await set("cbk", { markets: [market({ listings: [LOT, { id: "cheap", name: "Fizz", price: 10, stock: null }], ...over })] });
  from(gm, "cbk-auction-start", { marketId: "mC", listingId: "lot", reserve });
  await settle();
};
const bid = (user, actorId, amount) => from(user, "cbk-bid", { actorId, marketId: "mC", listingId: "lot", amount });

test("CBK auction: the rules: Super Luxury only, the minimum raise, numbered bidders, no bid past your money", () => {
  assert.equal(auctionable(LOT), true);
  assert.equal(auctionable({ ...LOT, price: 500 }), false);
  assert.equal(auctionable({ ...LOT, app: "watchbox" }), false);
  assert.equal(minBid({ reserve: 0, bids: [] }), MIN_RAISE);
  assert.equal(minBid({ reserve: 8000, bids: [] }), 8000);
  assert.equal(minBid({ reserve: 0, bids: [{ amount: 500 }] }), 600, "100eb beats 10% of 500");
  assert.equal(minBid({ reserve: 0, bids: [{ amount: 8000 }] }), 8800, "10% beats 100eb");
  assert.deepEqual(bidderLabels({ bids: [{ actorId: "a" }, { actorId: "b" }, { actorId: "a" }] }), { a: "Bidder 1", b: "Bidder 2" });
  const m = { live: true };
  const auction = { reserve: 0, bids: [{ actorId: "a", amount: 1000 }] };
  const args = { market: m, listing: LOT, auction, actorId: "b" };
  assert.match(bidProblem({ ...args, amount: 1099, wealth: 5000 }), /at least/);
  assert.equal(bidProblem({ ...args, amount: 1100, wealth: 5000 }), null);
  assert.match(bidProblem({ ...args, amount: 1100, wealth: 1000 }), /can't cover/);
  assert.equal(bidProblem({ ...args, actorId: "a", amount: 1100, wealth: 100 }), null, "their own hold counts");
  assert.match(bidProblem({ ...args, market: { live: false }, amount: 1100, wealth: 5000 }), /isn't broadcasting/);
  assert.match(bidProblem({ ...args, auction: null, amount: 1100, wealth: 5000 }), /over/);
});

test("CBK auction: only a Super Luxury listing of a live market opens; BUY NOW!!! is off while it's open", async () => {
  await set("cbk", { markets: [market({ listings: [LOT, { id: "cheap", name: "Fizz", price: 10, stock: null }] })] });
  from(gm, "cbk-auction-start", { marketId: "mC", listingId: "cheap" });
  await settle();
  assert.deepEqual(store.apps.cbkAuctions, {});
  from(alice, "cbk-auction-start", { marketId: "mC", listingId: "lot" });
  await settle();
  assert.deepEqual(store.apps.cbkAuctions, {}, "GMs only");
  from(gm, "cbk-auction-start", { marketId: "mC", listingId: "lot", reserve: 500 });
  await settle();
  assert.equal(auctionOf(store.apps.cbkAuctions, "mC", "lot").reserve, 500);
  assert.match(lastAlert("pcA").text, /Auction open: Westwood/);
  game.actors.get("pcA").system.wealth.value = 20000;
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "lot" });
  await settle();
  assert.match(lastAlert("pcA").text, /up for auction/);
  assert.equal(receipts().length, 0);
});

test("CBK auction: holds move with the bids; Sold! charges only the winner and writes a pick-up receipt", async () => {
  addUser({ id: "bob" });
  const bob = game.users.get("bob");
  addActor({ id: "pcB", name: "B", owners: ["bob"], wealth: 3000 });
  await startAuction();
  bid(alice, "pcA", 400);
  await settle();
  assert.equal(wealth("pcA"), 200, "held at once");
  bid(bob, "pcB", 450);
  await settle();
  assert.equal(wealth("pcB"), 3000, "under the minimum raise: refused");
  assert.match(lastAlert("pcB").text, /at least/);
  bid(bob, "pcB", 500);
  await settle();
  assert.equal(wealth("pcB"), 2500);
  assert.equal(wealth("pcA"), 600, "the bid it beat is back at once");
  assert.match(lastAlert("pcA").text, /Outbid/);
  bid(alice, "pcA", 601);
  await settle();
  assert.match(lastAlert("pcA").text, /can't cover/);
  bid(bob, "pcB", 1000);
  await settle();
  assert.equal(wealth("pcB"), 2000, "raising yourself only takes the difference");

  from(alice, "cbk-auction-sold", { marketId: "mC", listingId: "lot" });
  await settle();
  assert.equal(auctionOf(store.apps.cbkAuctions, "mC", "lot").status, "open", "GMs only");
  from(gm, "cbk-auction-sold", { marketId: "mC", listingId: "lot" });
  await settle();
  assert.equal(auctionOf(store.apps.cbkAuctions, "mC", "lot"), null);
  assert.equal(store.apps.cbkAuctions["mC:lot"].status, "sold");
  assert.equal(wealth("pcB"), 2000, "charged from the hold, not again");
  assert.equal(wealth("pcA"), 600);
  const [r] = receipts();
  assert.deepEqual([r.actorId, r.price, r.status, r.userId], ["pcB", 1000, "paid", "bob"]);
  assert.equal(stockOf("lot"), 0, "off the shelf");
  assert.ok(game.actors.get("pcB").created === undefined || !game.actors.get("pcB").created?.length, "nothing in the gear until the booth");
  from(gm, "cbk-auction-sold", { marketId: "mC", listingId: "lot" });
  await settle();
  assert.equal(receipts().length, 1, "the hammer falls once");
  const ledger = Object.values(store.apps.ledger).filter(l => l.actorId === "pcB").reduce((n, l) => n + l.amount, 0);
  assert.equal(ledger, -1000, "the ledger adds up to what they paid");
});

test("CBK auction: Cancel and the market going offline both give the hold back; no bid after", async () => {
  await startAuction();
  bid(alice, "pcA", 300);
  await settle();
  assert.equal(wealth("pcA"), 300);
  from(gm, "cbk-auction-cancel", { marketId: "mC", listingId: "lot" });
  await settle();
  assert.equal(wealth("pcA"), 600);
  assert.equal(store.apps.cbkAuctions["mC:lot"].status, "closed");
  assert.match(lastAlert("pcA").text, /Called off/);
  bid(alice, "pcA", 300);
  await settle();
  assert.equal(wealth("pcA"), 600, "no bid on a closed auction");

  await startAuction();
  bid(alice, "pcA", 300);
  await settle();
  await set("cbk", { markets: [market({ listings: [LOT], live: false })] });
  bid(alice, "pcA", 400);
  await settle();
  assert.equal(wealth("pcA"), 300, "refused while offline");
  from(gm, "cbk-live", { marketId: "mC", live: false });
  await settle();
  assert.equal(wealth("pcA"), 600, "the market closing gives it back");
  assert.equal(store.apps.cbkAuctions["mC:lot"].status, "closed");
});

/* ---------------- Rex's game ---------------- */

const play = () => from(alice, "cbk-rex-play", { actorId: "pcA", marketId: "mC", listingId: "l1" });
const dealId = dealKey("mC", "l1", "pcA");

test("CBK Rex's game: the rules: a discount no stacking with a flash sale; coin and card", () => {
  const [m] = cleanConfig({ markets: [market({ game: "rex" })] }).markets;
  assert.equal(m.game, "rex");
  assert.equal(cleanConfig({ markets: [market({ game: "darts" })] }).markets[0].game, "");
  assert.equal(priceNow(m, m.listings[0], Date.now(), REX_PCT), 400);
  const sale = { ...m, broadcasts: [{ id: "b", kind: "flash", pct: 50, ts: 1, target: { listingId: "l1" } }] };
  assert.equal(priceNow(sale, sale.listings[0], Date.now(), REX_PCT), 250, "the bigger discount wins");
  assert.equal(playRex("coin", () => 0.1).won, true);
  assert.equal(playRex("coin", () => 0.9).won, false);
  const draws = [0.9, 0.1];
  assert.equal(playRex("card", () => draws.shift()).won, true, "high card wins");
  assert.equal(playRex("card", () => 0.5).won, false, "a tie is the house's");
});

test("CBK Rex's game: a player plays, the GM resolves, a win discounts one buy, a second play is refused", async () => {
  const chat = [];
  globalThis.ChatMessage = { create: async data => chat.push(data) };
  play();
  await settle();
  assert.deepEqual(store.apps.cbkDeals, {}, "off unless the market has the game");
  await set("cbk", { markets: [market({ game: "rex" })] });
  play();
  await settle();
  assert.equal(store.apps.cbkDeals[dealId].status, "pending");
  assert.deepEqual(store.apps.gmCards[`cbk-rex:${dealId}`].actions.map(a => a.data.how), ["coin", "card"]);
  play();
  await settle();
  assert.match(lastAlert("pcA").text, /already played/);

  const random = Math.random;
  Math.random = () => 0.1;
  try {
    from(alice, "cbk-rex-resolve", { dealId, how: "coin" });
    await settle();
    assert.equal(store.apps.cbkDeals[dealId].status, "pending", "GMs only");
    from(gm, "cbk-rex-resolve", { dealId, how: "coin" });
    await settle();
  } finally {
    Math.random = random;
  }
  assert.equal(store.apps.cbkDeals[dealId].status, "won");
  assert.equal(store.apps.gmCards[`cbk-rex:${dealId}`], undefined);
  assert.equal(chat.length, 1, "the table sees it");
  assert.match(chat[0].content, /a win/);
  assert.match(lastAlert("pcA").text, /You won/);
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(wealth("pcA"), 200, "20% off 500");
  assert.equal(receipts()[0].price, 400);
  assert.equal(store.apps.cbkDeals[dealId].status, "used", "one time");
  play();
  await settle();
  assert.match(lastAlert("pcA").text, /already played/);

  from(gm, "cbk-live", { marketId: "mC", live: true });
  await set("cbk", { markets: [market({ game: "rex", live: false })] });
  from(gm, "cbk-live", { marketId: "mC", live: false });
  await settle();
  assert.deepEqual(store.apps.cbkDeals, {}, "the next opening deals again");
});

test("CBK Rex's game: a loss changes nothing", async () => {
  globalThis.ChatMessage = { create: async () => {} };
  await set("cbk", { markets: [market({ game: "rex" })] });
  play();
  await settle();
  const random = Math.random;
  Math.random = () => 0.9;
  try {
    from(gm, "cbk-rex-resolve", { dealId, how: "coin" });
    await settle();
  } finally {
    Math.random = random;
  }
  assert.equal(store.apps.cbkDeals[dealId].status, "lost");
  from(alice, "cbk-buy", { actorId: "pcA", marketId: "mC", listingId: "l1" });
  await settle();
  assert.equal(wealth("pcA"), 100, "full price");
});

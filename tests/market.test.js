import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import {
  cleanConfig, committedOf, dailyPicks, dayKey, dealPrice, inStock, invalidateCatalogue, listPrice, MARKET_DEFAULTS, orderedItems, orderProblem, priceToday,
  queueOf, stock
} from "../apps/market/model.js";
import { deliveryFee, droneLanded, droneProgress, highestPrice, orderTotal, STORE_CAP } from "../apps/market/model.js";

/*
 * NC Market (apps/market/model.js, apps/market/host.js): setup defaults, price limits with "ignore blank
 * price" and markup, the order rules, ammo boxes, and the host's order → approve/deny/cancel flow with
 * BangMe! charging. World items and compendiums are faked here (the shared stub has neither).
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
const orders = () => Object.values(store.apps.orders);
/** NC Market as it was before Great River: no price cap, no fee, items in the gear on approval. */
const CLASSIC = { pricing: "fee", deliveryFee: 0, deliveryPct: 0, delivery: "instant" };

/** World items for sale (uuid "Item.<id>"); a price of 0 is a blank price. */
const ITEMS = [
  { id: "hypo", name: "Airhypo", type: "gear", system: { price: { market: 50 } } },
  { id: "arrow", name: "Arrow (Expansive)", type: "ammo", system: { price: { market: 100 }, amount: 10 } },
  { id: "rocks", name: "Rocks", type: "gear", system: { price: { market: 0 } } },
  { id: "aegis", name: "Aegis", type: "weapon", system: { price: { market: 1000 } } },
  { id: "solo", name: "Solo", type: "role", system: {} }
];

function addWorldItems() {
  const docs = ITEMS.map(i => ({ ...structuredClone(i), uuid: `Item.${i.id}`, img: `${i.id}.png`, documentName: "Item", folder: null,
    toObject() {
      const { toObject, uuid, documentName, ...data } = this;
      return structuredClone({ ...data, _id: this.id });
    } }));
  game.items = docs;
  game.packs = [];
  globalThis.fromUuid = async uuid => docs.find(d => d.uuid === uuid) ?? null;
  invalidateCatalogue();
}

beforeEach(async () => {
  await store._writing;
  reset();
  gm = addUser({ id: "gm", isGM: true });
  alice = addUser({ id: "alice" });
  actAs(gm);
  const v = addActor({ id: "pcA", name: "V", owners: ["alice"], wealth: 500 });
  v.items = [...v.items];
  v.created = [];
  v.createEmbeddedDocuments = async (type, docs) => {
    v.created.push(...docs);
    return docs;
  };
  v.deltaLedgerProperty = (prop, delta) => v.update({ "system.wealth.value": v.system.wealth.value + delta });
  addWorldItems();
  await set("market", CLASSIC);
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(), loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
});

test("setup: defaults fill in, numbers are cleaned, an unknown pack list means every compendium", () => {
  const c = cleanConfig({ maxPrice: "-5", markup: "abc", packs: "nope" });
  assert.equal(c.maxPrice, 0);
  assert.equal(c.markup, 100);
  assert.equal(c.packs, null);
  assert.ok(c.ignoreBlankPrice, "blank prices are ignored by default");
  assert.deepEqual(cleanConfig(undefined).types, MARKET_DEFAULTS.types);
});

test("price limits, markup and ignore blank price", () => {
  const c = cleanConfig({ minPrice: 20, maxPrice: 500, markup: 120 });
  assert.equal(listPrice(50, c), 60);
  assert.equal(listPrice(null, c), null);
  const entry = (type, price) => ({ type, price });
  assert.ok(inStock(entry("gear", 60), c));
  assert.ok(!inStock(entry("gear", 10), c), "under the lowest price");
  assert.ok(!inStock(entry("weapon", 1200), c), "over the highest price");
  assert.ok(!inStock(entry("role", 60), c), "not an item type on sale");
  assert.ok(!inStock(entry("gear", null), c), "blank price ignored");
  assert.ok(inStock(entry("gear", null), { ...c, ignoreBlankPrice: false }), "price on request: outside the limits");
});

test("order rules: budget counts orders waiting, and the per-character cap", () => {
  const config = cleanConfig({ maxPending: 2 });
  const lines = [{ price: 100, qty: 2 }];
  assert.equal(orderProblem({ lines, config, wealth: 250, committed: 0 }), null);
  assert.match(orderProblem({ lines, config, wealth: 250, committed: 100 }), /more than you can spend/);
  assert.equal(orderProblem({ lines, config: { ...config, allowOverBudget: true }, wealth: 250, committed: 100 }), null);
  assert.match(orderProblem({ lines, config, wealth: 1000, pending: 2 }), /already have 2 orders/);
  assert.equal(orderProblem({ lines, config, wealth: null }), null, "no wallet, no budget");
  assert.match(orderProblem({ lines: [], config, wealth: 1000 }), /empty/);
});

test("ammo comes in boxes: three boxes of ten is one stack of thirty; other items are separate", () => {
  const [stack, ...rest] = orderedItems({ uuid: "Item.arrow", type: "ammo", name: "Arrow", system: { amount: 10 } }, 3, { orderId: "o" });
  assert.equal(stack.system.amount, 30);
  assert.equal(rest.length, 0);
  assert.equal(stack._stats.compendiumSource, "Item.arrow");
  assert.deepEqual(stack.flags["cpr-sam-agent"].market, { orderId: "o" });
  assert.equal(orderedItems({ type: "gear", name: "Hypo", system: {} }, 2, {}).length, 2);
});

test("order → approve: prices from the catalogue, items in the gear, charged through BangMe!", async () => {
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 2, name: "made up" }, { uuid: "Item.arrow", qty: 3 }], note: "for tonight" });
  await settle();
  const [order] = orders();
  assert.equal(order.status, "pending");
  assert.deepEqual(order.lines.map(l => [l.name, l.price, l.qty]), [["Airhypo", 50, 2], ["Arrow (Expansive)", 100, 3]], "names and prices come from the catalogue");
  assert.equal(order.total, 400);
  assert.equal(order.note, "for tonight");
  assert.equal(committedOf(store.apps.orders, "pcA"), 400);
  assert.match(lastAlert("pcA").text, /Order placed/);
  assert.equal(queueOf(store.apps.orders).length, 1);

  from(gm, "market-approve", { orderId: order.id, gmNote: "enjoy" });
  await settle();
  assert.equal(store.apps.orders[order.id].status, "approved");
  assert.equal(wealth("pcA"), 100);
  const v = game.actors.get("pcA");
  assert.deepEqual(v.created.map(i => [i.name, i.system.amount ?? null]), [["Airhypo", null], ["Airhypo", null], ["Arrow (Expansive)", 30]]);
  assert.ok(Object.values(store.apps.ledger).some(r => r.actorId === "pcA" && r.amount === -400 && r.kind === "market"));
  assert.match(lastAlert("pcA").text, /approved.*Charged.*"enjoy"/);

  // A second approve does nothing.
  from(gm, "market-approve", { orderId: order.id });
  await settle();
  assert.equal(wealth("pcA"), 100);
  assert.equal(v.created.length, 3);
});

test("what's not on sale can't be ordered; over budget is refused; players can't approve", async () => {
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.rocks", qty: 1, name: "Rocks" }] });
  await settle();
  assert.equal(orders().length, 0);
  assert.match(lastAlert("pcA").text, /Rocks isn't on sale/);
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.solo", qty: 1 }] });
  await settle();
  assert.equal(orders().length, 0, "roles aren't on sale");
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.aegis", qty: 1 }] });
  await settle();
  assert.equal(orders().length, 0);
  assert.match(lastAlert("pcA").text, /more than you can spend/);

  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 1 }] });
  await settle();
  const [order] = orders();
  from(alice, "market-approve", { orderId: order.id });
  await settle();
  assert.equal(store.apps.orders[order.id].status, "pending", "only a GM approves");
});

test("price on request: the GM must set a price; the GM's prices are what's charged", async () => {
  await set("market", { ...CLASSIC, ignoreBlankPrice: false });
  invalidateCatalogue();
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.rocks", qty: 2 }, { uuid: "Item.hypo", qty: 1 }] });
  await settle();
  const [order] = orders();
  assert.deepEqual(order.lines.map(l => l.price), [null, 50]);
  from(gm, "market-approve", { orderId: order.id });
  await settle();
  assert.equal(store.apps.orders[order.id].status, "pending", "no price, no approval");
  from(gm, "market-approve", { orderId: order.id, prices: [5, 40] });
  await settle();
  assert.equal(store.apps.orders[order.id].status, "approved");
  assert.equal(store.apps.orders[order.id].total, 50);
  assert.equal(wealth("pcA"), 450);
});

test("can't pay: not charged unless the GM forces it; deny and cancel ship nothing", async () => {
  await set("market", { ...CLASSIC, allowOverBudget: true });
  invalidateCatalogue();
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.aegis", qty: 1 }] });
  await settle();
  const [big] = orders();
  from(gm, "market-approve", { orderId: big.id });
  await settle();
  assert.equal(store.apps.orders[big.id].status, "pending");
  assert.equal(wealth("pcA"), 500);
  from(gm, "market-approve", { orderId: big.id, force: true });
  await settle();
  assert.equal(store.apps.orders[big.id].status, "approved");
  assert.equal(wealth("pcA"), -500);

  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 1 }] });
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 1 }] });
  await settle();
  const [a, b] = orders().filter(o => o.status === "pending");
  from(gm, "market-deny", { orderId: a.id, gmNote: "sold out" });
  from(alice, "market-cancel", { actorId: "pcA", orderId: b.id });
  await settle();
  assert.equal(store.apps.orders[a.id].status, "denied");
  assert.equal(store.apps.orders[b.id].status, "cancelled");
  assert.match(lastAlert("pcA").text, /denied.*"sold out"/);
  assert.equal(game.actors.get("pcA").created.length, 1, "only the forced order shipped");
  from(gm, "market-remove", { orderId: a.id });
  await settle();
  assert.ok(!store.apps.orders[a.id]);
});

test("the day's picks: the same for the same day, new the next day, independent of what else a client sees", () => {
  const config = cleanConfig({ featured: 3, deals: 4 });
  const entries = Array.from({ length: 40 }, (_, i) => ({ uuid: `Item.i${i}`, price: i % 7 ? 10 * i : null }));
  const a = dailyPicks(entries, config, "Spring, Day 7, 2045");
  assert.equal(a.featured.length, 3);
  assert.equal(a.deals.size, 4);
  assert.deepEqual(dailyPicks([...entries].reverse(), config, "Spring, Day 7, 2045"), a, "order doesn't matter");
  for (const [uuid, off] of a.deals) {
    assert.ok(!a.featured.includes(uuid), "a deal isn't also featured");
    assert.ok(off >= 10 && off <= 30 && off % 5 === 0, `discount ${off}`);
    assert.notEqual(entries.find(e => e.uuid === uuid).price, null, "deals have a price");
  }
  const next = dailyPicks(entries, config, "Spring, Day 8, 2045");
  assert.notDeepEqual(next.featured, a.featured, "a new day, new picks");
  assert.notDeepEqual(dailyPicks(entries, { ...config, reroll: 1 }, "Spring, Day 7, 2045").featured, a.featured, "the GM's reroll draws again");
  // A client that also sees extra items still agrees on the ones it ranks above them.
  const more = [...entries, ...Array.from({ length: 5 }, (_, i) => ({ uuid: `Item.x${i}`, price: 5 }))];
  const b = dailyPicks(more, config, "Spring, Day 7, 2045");
  assert.ok(b.featured.filter(u => !u.startsWith("Item.x")).every(u => a.featured.includes(u)));
  assert.equal(dailyPicks(entries, { ...config, featured: 0, deals: 0 }, "d").featured.length, 0);
  assert.equal(dailyPicks(entries.map(e => ({ ...e, disabled: true })), config, "d").featured.length, 0, "unavailable items aren't picked");
});

test("deal prices, hidden and unavailable items", () => {
  assert.equal(dealPrice(100, 30), 70);
  assert.equal(dealPrice(15, 25), 12);
  assert.equal(dealPrice(1, 90), 1, "never free");
  const config = cleanConfig({ featured: 0, deals: 0, blocked: { "Item.a": "hide", "Item.b": "off", "Item.c": "bogus" } });
  assert.deepEqual(Object.keys(config.blocked), ["Item.a", "Item.b"], "only hide and off are kept");
  const entries = ["a", "b", "c"].map(id => ({ uuid: `Item.${id}`, type: "gear", price: 10 }));
  const player = priceToday(entries, config, "d");
  assert.deepEqual(player.entries.map(e => [e.uuid, e.disabled]), [["Item.b", true], ["Item.c", false]], "hidden: gone; unavailable: listed");
  const gmView = priceToday(entries, config, "d", { withHidden: true });
  assert.deepEqual(gmView.entries.map(e => [e.uuid, e.hidden]), [["Item.a", true], ["Item.b", false], ["Item.c", false]]);
});

test("Hot Deals and Featured stay within the price limits (list price, before the discount)", () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({ uuid: `Item.p${i}`, type: "gear", price: 50 * (i + 1) }));
  for (const [minPrice, maxPrice] of [[0, 500], [200, 1000], [0, 400]]) {
    const config = cleanConfig({ ...CLASSIC, featured: 4, deals: 12, minPrice, maxPrice });
    const today = priceToday(entries, config, "Spring, Day 7, 2045", { withHidden: true });
    assert.ok(today.deals.length > 0, `some deals under ${maxPrice}`);
    for (const e of [...today.deals, ...today.featured]) {
      const list = e.was ?? e.price;
      assert.ok(list >= minPrice && list <= maxPrice, `${e.uuid} at ${list} eb is outside ${minPrice}..${maxPrice}`);
    }
  }
});

test("Hot Deals: the host charges the deal price; unavailable and hidden items can't be ordered", async () => {
  // Highest price 500: Aegis (1000) is never the deal, so the 500 eb character can always afford it.
  await set("market", { ...CLASSIC, featured: 0, deals: 1, maxPrice: 500 });
  invalidateCatalogue();
  const { deals } = await stock(undefined, { day: dayKey() });
  const [deal] = deals;
  assert.ok(deal?.off, "one item is on a Hot Deal today");
  assert.ok(deal.was <= 500, "the deal is within the Highest price");
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: deal.uuid, qty: 1 }] });
  await settle();
  const [order] = orders();
  assert.deepEqual([order.lines[0].price, order.lines[0].off, order.lines[0].was], [deal.price, deal.off, deal.was]);
  assert.ok(deal.price < deal.was);

  await set("market", { ...CLASSIC, featured: 0, deals: 0, blocked: { "Item.hypo": "off", "Item.arrow": "hide" } });
  for (const uuid of ["Item.hypo", "Item.arrow"]) {
    from(alice, "market-order", { actorId: "pcA", lines: [{ uuid, qty: 1, name: uuid }] });
    await settle();
    assert.match(lastAlert("pcA").text, /isn't on sale/);
  }
  assert.equal(orders().length, 1);
});

/* ---------------- Great River (2026-10-21): the canon price cap, the delivery fee, the drone ---------------- */

test("Great River pricing: canon stores stop at 100eb (Premium); no-cap stores charge a delivery fee", () => {
  const canon = cleanConfig({});
  assert.equal(canon.pricing, "cap", "the canon store by default");
  assert.equal(highestPrice(canon), STORE_CAP);
  assert.equal(highestPrice(cleanConfig({ maxPrice: 60 })), 60, "the GM's own lower limit still applies");
  assert.ok(inStock({ type: "gear", price: 100 }, canon));
  assert.ok(!inStock({ type: "weapon", price: 101 }, canon), "over 100eb isn't sold at a canon store");
  assert.equal(deliveryFee(500, canon), 0, "delivery is included");

  const fee = cleanConfig({ pricing: "fee", deliveryFee: 20, deliveryPct: 10 });
  assert.equal(highestPrice(fee), 0);
  assert.ok(inStock({ type: "weapon", price: 5000 }, fee));
  assert.equal(deliveryFee(500, fee), 70);
  assert.equal(deliveryFee(33, fee), 24, "the share rounds up");
  assert.deepEqual(orderTotal([{ price: 250, qty: 2 }], fee), { items: 500, fee: 70, total: 570 });
  assert.equal(deliveryFee(0, fee), 0, "nothing priced yet, no fee");
});

test("Great River: the drone lands when enough world time or real time has passed", () => {
  const drone = { minutes: 30, world: 1000 + 1800, real: 50_000 + 1_800_000 };
  assert.ok(!droneLanded(drone, 1000, 50_000));
  assert.ok(droneLanded(drone, 2800, 50_000), "world time caught up");
  assert.ok(droneLanded(drone, 1000, 1_850_000), "real time caught up");
  assert.equal(droneProgress(drone, 1900, 50_000), 0.5);
  assert.equal(droneProgress(drone, 1000, 50_000 + 1_350_000), 0.75, "the further of the two");
});

test("Great River order → approve: charged with the fee, the drone flies, the items land on the clock or at once", async () => {
  await set("market", { pricing: "fee", deliveryFee: 20, deliveryPct: 10, delivery: "drone", etaMin: 30, etaMax: 30 });
  invalidateCatalogue();
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 2 }] });
  await settle();
  const [order] = orders();
  assert.deepEqual([order.fee, order.total], [30, 130]);
  from(gm, "market-approve", { orderId: order.id });
  await settle();
  const flying = store.apps.orders[order.id];
  assert.equal(flying.status, "shipping");
  assert.equal(flying.drone.minutes, 30);
  assert.equal(wealth("pcA"), 370, "charged on approval, fee included");
  assert.equal(game.actors.get("pcA").created.length, 0, "nothing in the gear while it flies");
  assert.match(lastAlert("pcA").text, /drone is bringing.*30 minutes/);

  await store._tickMarket();
  assert.equal(store.apps.orders[order.id].status, "shipping", "not yet");
  store.apps.orders[order.id].drone.real = Date.now() - 1;
  await store._enqueue(() => store._tickMarket());
  await settle();
  assert.equal(store.apps.orders[order.id].status, "approved");
  assert.equal(game.actors.get("pcA").created.length, 2);
  assert.match(lastAlert("pcA").text, /drone dropped off/);

  // The GM can land one at once; players can't.
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 1 }] });
  await settle();
  const second = orders().find(o => o.status === "pending");
  from(gm, "market-approve", { orderId: second.id });
  await settle();
  from(alice, "market-deliver", { orderId: second.id });
  await settle();
  assert.equal(store.apps.orders[second.id].status, "shipping");
  from(gm, "market-remove", { orderId: second.id });
  await settle();
  assert.ok(store.apps.orders[second.id], "an order in the air can't be removed");
  from(gm, "market-deliver", { orderId: second.id });
  await settle();
  assert.equal(store.apps.orders[second.id].status, "approved");
  assert.equal(game.actors.get("pcA").created.length, 3);
});

test("Great River: a drone whose item is gone refunds the character", async () => {
  await set("market", { pricing: "cap", delivery: "drone" });
  invalidateCatalogue();
  from(alice, "market-order", { actorId: "pcA", lines: [{ uuid: "Item.hypo", qty: 1 }] });
  await settle();
  const [order] = orders();
  from(gm, "market-approve", { orderId: order.id });
  await settle();
  assert.equal(wealth("pcA"), 450);
  globalThis.fromUuid = async () => null; // the item was deleted
  from(gm, "market-deliver", { orderId: order.id });
  await settle();
  assert.equal(store.apps.orders[order.id].status, "denied");
  assert.equal(wealth("pcA"), 500, "refunded");
  assert.match(lastAlert("pcA").text, /Delivery failed.*refunded/);
});

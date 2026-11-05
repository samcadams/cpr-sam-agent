import "./foundry-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { boughtItems, clampQty, findByName, itemPrice, linesTotal, listPrice } from "../scripts/model/shop.js";

/* The shops' shared item and price rules (scripts/model/shop.js): Great River and CBK both use them. */

test("shop: prices, markup, quantities and totals", () => {
  assert.equal(itemPrice({ system: { price: { market: 50 } } }), 50);
  assert.equal(itemPrice({ system: { price: { market: 0 } } }), null);
  assert.equal(itemPrice({}), null);
  assert.equal(listPrice(50, 150), 75);
  assert.equal(listPrice(33, 110), 37, "rounded up");
  assert.equal(listPrice(null, 150), null);
  assert.equal(clampQty(0), 1);
  assert.equal(clampQty(250), 99);
  assert.equal(linesTotal([{ price: 20, qty: 2 }, { price: null, qty: 1 }, { price: 5, qty: 3 }]), 55);
});

test("shop: bought items carry their flag; ammo boxes stack", () => {
  const gun = { uuid: "Item.gun", name: "Gun", type: "weapon", _id: "x", folder: "f", system: {} };
  const two = boughtItems(gun, 2, { receipt: "r1" }, "cbk");
  assert.equal(two.length, 2);
  assert.deepEqual(two[0].flags["cpr-sam-agent"].cbk, { receipt: "r1" });
  assert.equal(two[0]._stats.compendiumSource, "Item.gun");
  assert.equal(two[0]._id, undefined);
  const ammo = boughtItems({ uuid: "Item.a", name: "Ammo", type: "ammo", system: { amount: 10 } }, 3, {}, "market");
  assert.equal(ammo.length, 1);
  assert.equal(ammo[0].system.amount, 30);
});

test("shop: find an item by name, world items first, then the preferred compendium", () => {
  const entries = [
    { uuid: "C.other.Item.1", name: "Sponsored Cybereye", source: "other", type: "cyberware" },
    { uuid: "C.bc.Item.2", name: "Sponsored Cybereye", source: "bc", type: "cyberware" },
    { uuid: "Item.3", name: "Shuriken", source: "world", type: "weapon" },
    { uuid: "C.bc.Item.4", name: "Shuriken", source: "bc", type: "weapon" }
  ];
  assert.equal(findByName(entries, "sponsored cybereye", { prefer: ["bc"] }).uuid, "C.bc.Item.2");
  assert.equal(findByName(entries, "Shuriken", { prefer: ["bc"] }).uuid, "Item.3");
  assert.equal(findByName(entries, "Nope"), null);
});

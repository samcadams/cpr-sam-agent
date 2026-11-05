import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rowsToHide, SHORT_LIST_ROWS } from "../scripts/ui/phone/core/lists.js";

const count = n => Array.from({ length: n }, (_, i) => i);
const none = () => false;

test("a short list hides what's past its handful", () => {
  assert.deepEqual(rowsToHide(count(SHORT_LIST_ROWS + 3), none), [5, 6, 7]);
});

test("a list that fits, or is only one row over, isn't cut", () => {
  assert.deepEqual(rowsToHide(count(SHORT_LIST_ROWS), none), []);
  assert.deepEqual(rowsToHide(count(SHORT_LIST_ROWS + 1), none), []);
});

test("rows waiting on an answer are never hidden, and take room from the rest", () => {
  const kept = row => row === 8 || row === 9;
  assert.deepEqual(rowsToHide(count(10), kept), [3, 4, 5, 6, 7]);
  assert.deepEqual(rowsToHide(count(10), row => row >= 2), [0, 1]); // more kept than the handful: all of them still show
});

test("each template's short lists have their own keys", () => {
  const files = fs.readdirSync("apps", { recursive: true }).filter(f => f.endsWith(".hbs"));
  let total = 0;
  for (const file of files) {
    const keys = [...fs.readFileSync(`apps/${file}`, "utf8").matchAll(/data-short-list="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(keys).size, keys.length, `${file}: ${keys}`);
    total += keys.length;
  }
  assert.ok(total > 0);
});

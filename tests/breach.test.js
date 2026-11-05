import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUFFER, bufferFor, buildGrid, canPick, cleanPoint, daemonStates, gridEnd, lineAfter, openCells, outcome, pointFor, rollOutcome,
  secondsFor, SIZES, SYMBOLS, timeLeft
} from "../apps/breach/model.js";

/*
 * BREACH's model (apps/breach/model.js): grids built the same from their seed, the picking rules, daemons
 * found in the buffer, fair grids (every daemon fits end to end; the main one always fits the smallest buffer),
 * the roll's buffer and time, "Just roll it", and the clock.
 */

let n = 0;
const randomID = () => `id${++n}`;

test("a grid is built the same from its seed; other seeds make other grids", () => {
  const a = buildGrid({ seed: 7, size: 6, lens: [2, 3, 4] });
  const b = buildGrid({ seed: 7, size: 6, lens: [2, 3, 4] });
  const c = buildGrid({ seed: 8, size: 6, lens: [2, 3, 4] });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.cells, c.cells);
  assert.equal(a.cells.length, 36);
  assert.ok(a.cells.every(s => SYMBOLS.includes(s)));
  assert.deepEqual(a.daemons.map(d => d.length), [2, 3, 4]);
});

test("picks start on the top row, then alternate column and row, a cell once", () => {
  const grid = buildGrid({ seed: 1, size: 5, lens: [2] });
  assert.deepEqual(lineAfter(grid, []), { row: 0 });
  assert.deepEqual(openCells(grid, []), [0, 1, 2, 3, 4]);
  assert.ok(!canPick(grid, [], 7, 6), "not off the top row");
  assert.ok(canPick(grid, [], 3, 6));
  assert.deepEqual(lineAfter(grid, [3]), { col: 3 });
  assert.deepEqual(openCells(grid, [3]), [8, 13, 18, 23], "its column, without itself");
  assert.ok(canPick(grid, [3], 13, 6));
  assert.deepEqual(lineAfter(grid, [3, 13]), { row: 2 });
  assert.ok(!canPick(grid, [3, 13], 13, 6), "a cell once");
  assert.ok(!canPick(grid, [3, 13], 10, 2), "no room in the buffer");
});

test("every grid is fair: the hidden path follows the rules and spells every daemon end to end", () => {
  for (const size of SIZES) {
    for (let seed = 0; seed < 300; seed++) {
      const lens = [2 + (seed % 3), 2 + ((seed >> 2) % 3), 2 + ((seed >> 4) % 3), 2 + ((seed >> 6) % 3)].slice(0, 1 + (seed % 4));
      const grid = buildGrid({ seed, size, lens });
      const total = lens.reduce((a, b) => a + b, 0);
      assert.equal(grid.path.length, total, `size ${size} seed ${seed}: a path`);
      for (let i = 0; i < grid.path.length; i++) assert.ok(canPick(grid, grid.path.slice(0, i), grid.path[i], total), `size ${size} seed ${seed}: pick ${i} is legal`);
      const all = daemonStates(grid, grid.path, total);
      assert.ok(all.every(s => s.state === "done"), `size ${size} seed ${seed}: all daemons upload along the path`);
      // The main daemon fits the smallest buffer.
      const main = grid.path.slice(0, lens[0]);
      assert.equal(daemonStates(grid, main, BUFFER.min)[0].state, "done");
    }
  }
});

test("daemons light up as they fill, upload anywhere in the buffer, and fail when there's no room", () => {
  const grid = { size: 3, cells: ["1C", "55", "7A", "BD", "E9", "FF", "1C", "55", "7A"], daemons: [["55", "E9"], ["7A", "FF", "1C"]] };
  // 1 (55) → column 1: 4 (E9) → row 1: 5 (FF)
  assert.deepEqual(daemonStates(grid, [1], 4).map(s => [s.state, s.progress]), [["open", 1], ["open", 0]]);
  assert.deepEqual(daemonStates(grid, [1, 4], 5).map(s => s.state), ["done", "open"]);
  assert.deepEqual(daemonStates(grid, [1, 4], 4).map(s => s.state), ["done", "failed"], "two slots left, three codes");
  assert.deepEqual(daemonStates(grid, [1, 4, 5], 4).map(s => s.state), ["done", "failed"], "three codes, one slot left");
  assert.equal(gridEnd(grid, [1, 4, 5], 4), "out");
  assert.deepEqual(outcome(grid, [1, 4, 5], 4), { uploaded: [0], failed: [1] });
  assert.equal(gridEnd(grid, [1, 4], 2), "buffer");
  assert.equal(gridEnd(grid, [1], 4), null);
});

test("the roll sizes the buffer; Interface rank sets the time", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 30].map(bufferFor), [4, 4, 5, 5, 6, 7, 8, 8]);
  assert.deepEqual([0, 1, 4, 10, 12].map(secondsFor), [20, 25, 40, 70, 70]);
});

test("Just roll it uploads the daemons, in order, while they fit end to end", () => {
  assert.deepEqual(rollOutcome([2, 3, 4], 4), { uploaded: [0], failed: [1, 2] });
  assert.deepEqual(rollOutcome([2, 3, 4], 5), { uploaded: [0, 1], failed: [2] });
  assert.deepEqual(rollOutcome([2, 3, 4], 8), { uploaded: [0, 1], failed: [2] });
  assert.deepEqual(rollOutcome([4, 2], 4), { uploaded: [0], failed: [1] });
});

test("the clock starts on the first pick and stops while paused", () => {
  const run = { timeMs: 30000 };
  assert.equal(timeLeft(run, 1e6), 30000, "not started");
  run.startedAt = 1000;
  assert.equal(timeLeft(run, 11000), 20000);
  run.pausedAt = 11000;
  assert.equal(timeLeft(run, 50000), 20000, "paused");
  run.pausedMs = 39000;
  run.pausedAt = null;
  assert.equal(timeLeft(run, 55000), 15000, "the pause doesn't count");
  assert.equal(timeLeft(run, 99999), 0);
});

test("Breach Points are cleaned; characters see the ones meant for them", () => {
  const p = cleanPoint({ name: " Door ", dv: 99, size: 9, daemons: [{ id: "d1", name: "Backdoor", len: 9 }, { name: "" }], effects: { d1: "Opens", x: "junk" } }, { randomID });
  assert.equal(p.name, "Door");
  assert.equal(p.dv, 40);
  assert.equal(p.size, 6);
  assert.deepEqual(p.daemons.map(d => d.len), [4, 3]);
  assert.equal(p.daemons[1].name, "Daemon");
  assert.deepEqual(Object.keys(p.effects).sort(), ["d1", p.daemons[1].id].sort());
  assert.ok(pointFor(p, "anyone"));
  const listed = { ...p, everyone: false, actorIds: ["a"] };
  assert.ok(pointFor(listed, "a") && !pointFor(listed, "b"));
  assert.ok(!pointFor({ ...p, used: true }, "a"), "a used single-use point is gone");
});

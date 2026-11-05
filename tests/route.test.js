import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, nearestNode, roadNetwork, route, travelTimes } from "../apps/map/route.js";

/*
 * Routes on a traced road network (apps/map/route.js). A small town: a slow street straight across (A–B–C) and a
 * highway around (A–D–C), a dead end off B, and an island no road reaches.
 *
 *   A(0,0) ──street 1000── B(1000,0) ──street 1000── C(2000,0)
 *     │                      └ E(1000,300)              │
 *   highway 1400 ── D(1000,-700) ── highway 1400 ───────┘          F(5000,5000) (alone)
 */
const data = {
  width: 6000, height: 6000,
  nodes: [0, 0, 1000, 0, 2000, 0, 1000, -700, 1000, 300, 5000, 5000, 5100, 5000],
  edges: [
    [0, 1, 1000, 0, [0, 0, 1000, 0]],
    [1, 2, 1000, 0, [1000, 0, 2000, 0]],
    [0, 3, 1400, 1, [0, 0, 1000, -700]],
    [3, 2, 1400, 1, [1000, -700, 2000, 0]],
    [1, 4, 300, 0, [1000, 0, 1000, 300]],
    [5, 6, 100, 0, [5000, 5000, 5100, 5000]]
  ]
};

test("routes: the quickest drive takes the highway, walking takes the shortest way", () => {
  const net = roadNetwork(data);
  assert.equal(nearestNode(net, 30, -20), 0);
  assert.equal(nearestNode(net, 4800, 4900), 5);
  const drive = route(net, { x: 0, y: 10 }, { x: 2000, y: 10 });
  assert.equal(drive.highway, 2800, "2800 px of highway beat 2000 px of street (55 vs 25 mph)");
  assert.equal(drive.street, 0);
  assert.equal(drive.walk, 20, "on foot to and from the road");
  assert.deepEqual(drive.points.slice(0, 6), [0, 10, 0, 0, 0, 0], "from the start, onto the road at A");
  assert.deepEqual(drive.points.slice(-4), [2000, 0, 2000, 10]);
  assert.ok(drive.points.includes(-700), "round by D");
  const walk = route(net, { x: 0, y: 10 }, { x: 2000, y: 10 }, "walk");
  assert.equal(walk.street, 2000);
  assert.equal(walk.length, 2020);
  // Edges are driven either way: the line turns round when driven backwards.
  const back = route(net, { x: 1000, y: 300 }, { x: 0, y: 0 }, "walk");
  assert.deepEqual(back.points, [1000, 300, 1000, 300, 1000, 300, 1000, 0, 1000, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(route(net, { x: 0, y: 0 }, { x: 5050, y: 5000 }), null, "no road to the island");
  // 1 px = 0.001 mi: the drive 2.8 mi of highway (55 mph) + 0.02 mi on foot (3 mph); the walk 2.02 mi.
  const t = travelTimes(drive, walk, 0.001);
  assert.ok(Math.abs(t.drive - (2.8 / 55 + 0.02 / 3) * 60) < 1e-9);
  assert.ok(Math.abs(t.walk - (2.02 / 3) * 60) < 1e-9);
  assert.deepEqual([formatMinutes(0.2), formatMinutes(44.6), formatMinutes(60), formatMinutes(83)], ["1 min", "45 min", "1 h", "1 h 23 min"]);
});

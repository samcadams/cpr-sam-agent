import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";

import {
  addScore, advance, boardRank, chunkFamilies, chunkGap, CHUNKS, chunksFor, configOf, deathLine, DEATHS, FAMILIES, groupOf, insideOf, KINDS, pickChunk, placeChunk,
  ceilingAt, NCART_DEFAULTS, newGame, pickPower, plausible, POWERS, randomEntries, runSpeed, SHOWN, SPEED, speedAt, speedLevel, step, STEP, topScores
} from "../apps/ncart/model.js";

/*
 * NCART Runner's game model (apps/ncart/model.js): the speed curve, the controls, what each
 * obstacle and power-up does, that every chunk leaves a way through, and the leaderboard (in the model,
 * and on the host).
 */

/** A steady speed (m/s), as a speed curve. */
const steady = v => ({ label: "test", start: v, step: 0, every: 1e9, cap: v });

/** A run over just these chunks, at a steady speed, without its shards unless asked. */
function run(chunks, { v = 14, lane = 1, rand = () => 0.3, shards = false } = {}) {
  const g = newGame(configOf(), rand, { chunks, lane });
  g.curve = steady(v);
  g.ramp = 0;
  if (!shards) g.pickupsOff = true;
  return g;
}

/** Run until `dist`, pressing `at(g)`'s input each step. Returns the run. */
function go(g, dist, at = () => ({})) {
  while (!g.over && g.dist < dist) {
    step(g, STEP, at(g));
    if (g.pickupsOff) g.pickups = [];
  }
  return g;
}

const copy = g => ({ ...g, obstacles: g.obstacles.map(o => ({ ...o })), pickups: [], powers: { ...g.powers }, events: [], fixed: [...(g.fixed ?? [])] });

/**
 * Whether some way of playing gets through a chunk: a depth-first search over every input (nothing,
 * left, right, jump, slide) every 0.05 s, trying "nothing" first and skipping states already tried.
 */
function passable(chunk, { v, lane, rand }) {
  const g = newGame(configOf(), rand, { chunks: [chunk], lane });
  g.curve = steady(v);
  g.ramp = 0;
  // As close as chunks come in a run (after the last one, at this speed).
  g.laid = chunkGap(v);
  const end = g.laid + chunk.len + 2;
  const INPUTS = [{ jump: true }, { slide: true }, { left: 1 }, { right: 1 }, {}];
  const seen = new Set();
  const stack = [g];
  while (stack.length) {
    const state = stack.pop();
    for (const input of INPUTS) {
      const s = copy(state);
      step(s, STEP, input);
      for (let i = 0; i < 5 && !s.over; i++) step(s, STEP);
      if (s.over) continue;
      if (s.dist >= end) return true;
      const key = [Math.round(s.t / (6 * STEP)), s.lane, s.x.toFixed(2), s.y.toFixed(1), s.vy.toFixed(0), s.slide.toFixed(2), s.air, s.queued, s.slideOnLanding].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(s);
    }
  }
  return false;
}

test("the passability search does find a dead end", () => {
  const wall = { id: "wall", len: 20, items: [0, 1, 2].map(lane => ({ kind: "wreck", lane, z: 10 })), shards: [] };
  assert.equal(passable(wall, { v: 14, lane: 1, rand: () => 0.3 }), false);
  const late = { id: "late", len: 20, items: [{ kind: "wreck", lane: 0, z: 1 }, { kind: "wreck", lane: 2, z: 1 }, { kind: "wreck", lane: 1, z: 3 }], shards: [] };
  assert.equal(passable(late, { v: 30, lane: 1, rand: () => 0.3 }), false);
});

test("every chunk leaves a way through, from any lane, slow or fast, mirrored or not", () => {
  const speeds = [SPEED.start, SPEED.cap];
  for (const chunk of CHUNKS) {
    for (const c of [chunk, mirror(chunk)]) {
      for (const v of [Math.min(...speeds), 20, Math.max(...speeds)]) {
        for (const lane of [0, 1, 2]) {
          for (const r of chunk.items.some(i => i.to !== undefined) ? [0, 0.25, 0.5, 0.75] : [0.3]) {
            assert.ok(passable(c, { v, lane, rand: () => r }), `${chunk.id}${c === chunk ? "" : " (mirrored)"} at ${v} m/s from lane ${lane} (drift ${r})`);
          }
        }
      }
    }
  }
});

/** A chunk left-for-right. */
const mirror = c => ({ ...c, items: c.items.map(i => ({ ...i, lane: 2 - i.lane, ...(i.to !== undefined ? { to: 2 - i.to } : {}) })), shards: c.shards.map(s => ({ ...s, lane: 2 - s.lane })) });

test("nothing to pick up sits inside a train, a wreck or a roadblock (power-ups go on top)", () => {
  for (const chunk of CHUNKS) {
    for (const c of [chunk, mirror(chunk)]) {
      const g = newGame(configOf(), () => 0.3, { chunks: [c] });
      placeChunk(g, { ...c, power: null }, 20, false);
      if (c.power) g.pickups.push({ power: "magnet", lane: c.power[0], z: 20 + c.power[1], y: 1 });
      placeChunk(g, { id: "none", items: [], shards: [] }, 0, false); // lifts what's inside
      for (const p of g.pickups) assert.equal(insideOf(g.obstacles, p), null, `${c.id}: a ${p.shard ? "shard" : "power-up"} at ${p.z - 20} m`);
    }
  }
  const g = newGame(configOf(), () => 0.3, { chunks: [] });
  placeChunk(g, CHUNKS.find(c => c.id === "ramp-roof"), 20, false);
  g.pickups.push({ power: "magnet", lane: 1, z: 64, y: 1 });
  placeChunk(g, { id: "none", items: [], shards: [] }, 0, false);
  assert.ok(g.pickups.at(-1).y > KINDS.parked.top, "on the roof");
});

test("chunks are well formed: known kinds, lanes 0–2, inside their length, unique ids", () => {
  assert.equal(new Set(CHUNKS.map(c => c.id)).size, CHUNKS.length);
  for (const c of CHUNKS) {
    for (const i of c.items) {
      assert.ok(KINDS[i.kind], `${c.id}: ${i.kind}`);
      assert.ok([0, 1, 2].includes(i.lane), `${c.id}: lane`);
      assert.ok(i.z >= 0 && i.z + (i.len ?? KINDS[i.kind].len) <= c.len, `${c.id}: ${i.kind} fits`);
    }
    for (const s of c.shards) assert.ok(s.z + (s.n - 1) * (s.gap ?? 2.5) <= c.len + 2, `${c.id}: shards fit`);
    for (const f of chunkFamilies(c)) assert.ok(FAMILIES[f]);
  }
  for (const kind of Object.keys(KINDS)) assert.ok(DEATHS[kind]?.length, `a death line for ${kind}`);
});

test("speed rises in small steps and stops at the cap", () => {
  assert.equal(speedAt(0), SPEED.start);
  assert.equal(speedAt(SPEED.every - 1), SPEED.start);
  assert.equal(speedAt(SPEED.every), SPEED.start + SPEED.step);
  assert.equal(speedAt(1e7), SPEED.cap);
  let last = 0;
  for (let d = 0; d < 20000; d += 50) {
    assert.ok(speedAt(d) >= last && speedAt(d) <= SPEED.cap);
    last = speedAt(d);
  }
  const top = speedLevel(1e7);
  assert.equal(speedAt(top * SPEED.every), SPEED.cap);
  assert.ok(speedAt((top - 1) * SPEED.every) < SPEED.cap);
  assert.ok(SPEED.step <= 0.5, "subtle");
});

test("a run starts with a short sprint up to speed", () => {
  const g = newGame(configOf(), () => 0.5, { chunks: [] });
  advance(g, 0.05);
  assert.ok(runSpeed(g) < SPEED.start * 0.3);
  for (let i = 0; i < 10; i++) advance(g, 0.1);
  assert.ok(runSpeed(g) < SPEED.start * 0.9, "still getting going after a second");
  for (let i = 0; i < 20; i++) advance(g, 0.1);
  assert.equal(runSpeed(g), SPEED.start);
});

test("a long run speeds up with SPEED UP events, and never past the cap", () => {
  const g = newGame(configOf(), () => 0.5, { chunks: [] });
  g.grace = Infinity;
  let ups = 0;
  while (g.dist < 6000) {
    advance(g, 0.1);
    ups += g.events.filter(e => e.type === "speedup").length;
    g.events = [];
    assert.ok(runSpeed(g) <= SPEED.cap);
  }
  assert.equal(ups, speedLevel(1e7));
});

test("a roadblock: running into it ends the run; a jump or a lane change clears it", () => {
  const block = { id: "t", len: 20, items: [{ kind: "roadblock", lane: 1, z: 10 }], shards: [] };
  const crash = go(run([block]), 60);
  assert.equal(crash.over, "roadblock");
  assert.match(deathLine(crash.over), /roadblock|barricade/);
  const jumped = go(run([block]), 60, g => ({ jump: g.dist > 26 && g.dist < 27 }));
  assert.equal(jumped.over, false);
  const dodged = go(run([block]), 60, g => ({ left: g.dist > 20 && g.dist < 20.2 ? 1 : 0 }));
  assert.equal(dodged.over, false);
  assert.equal(dodged.lane, 0);
});

test("a sign is slid under, not jumped; gunfire across all lanes can't be dodged sideways", () => {
  const sign = { id: "t", len: 20, items: [{ kind: "sign", lane: 1, z: 10 }], shards: [] };
  assert.equal(go(run([sign]), 60, g => ({ jump: g.dist > 26 && g.dist < 27 })).over, "sign");
  assert.equal(go(run([sign]), 60, g => ({ slide: g.dist > 26 && g.dist < 26.2 })).over, false);
  const guns = { id: "t", len: 20, items: [{ kind: "gunHigh", lane: 1, z: 10 }], shards: [] };
  assert.equal(go(run([guns], { lane: 0 }), 60).over, "gunHigh");
  assert.equal(go(run([guns], { lane: 0 }), 60, g => ({ slide: g.dist > 26 && g.dist < 26.2 })).over, false);
});

test("lane changes: one can be queued; the edge and a train's side bump you back", () => {
  const g = run([]);
  step(g, STEP, { left: 1 });
  step(g, STEP, { left: 1 }); // queued while moving
  go(g, 10);
  assert.equal(g.lane, 0);
  step(g, STEP, { left: 1 });
  assert.equal(g.lane, 0);
  assert.ok(g.events.some(e => e.type === "bump"));

  const train = { id: "t", len: 40, items: [{ kind: "parked", lane: 0, z: 2, len: 30 }], shards: [] };
  const h = go(run([train]), 30);
  step(h, STEP, { left: 1 });
  assert.equal(h.lane, 1, "no stepping into a train's side");
  assert.equal(go(h, 70).over, false);
});

test("a ramp runs up onto a train's roof, and off its end", () => {
  const ramp = { id: "t", len: 60, items: [{ kind: "ramp", lane: 1, z: 4 }, { kind: "parked", lane: 1, z: 12, len: 30 }], shards: [] };
  const g = go(run([ramp]), 18 + 25);
  assert.equal(g.over, false);
  assert.ok(Math.abs(g.y - KINDS.parked.top) < 0.01, "on the roof");
  // Across to the next lane's roof? Nothing there: they drop to the track.
  go(g, 18 + 50);
  assert.equal(g.over, false);
  assert.equal(g.y, 0);
});

test("an oncoming train sounds its horn as its headlights come on, well ahead, and again as it passes", () => {
  const train = { id: "t", len: 114, items: [{ kind: "oncoming", lane: 1, z: 90 }], shards: [] };
  for (const v of [SPEED.start, SPEED.cap * 1.35]) {
    const g = run([train], { v });
    let warned = null;
    while (!g.over && g.dist < 300) {
      step(g, STEP);
      if (warned === null && g.events.some(e => e.type === "warn")) warned = g.t;
      g.events = [];
    }
    assert.equal(g.over, "oncoming");
    assert.ok(g.t - warned >= 1.5, `warned ${g.t - warned} s ahead at ${v} m/s`);
  }
  const h = run([train], { v: 20, lane: 0 });
  const events = [];
  while (h.dist < 220) {
    step(h, STEP);
    events.push(...h.events.map(e => e.type));
    h.events = [];
  }
  assert.deepEqual(events.filter(e => e === "warn" || e === "pass"), ["warn", "pass"]);
});

test("slides: one at a time, with a breath before the next", () => {
  const g = run([]);
  step(g, STEP, { slide: true });
  g.events = [];
  let slides = 1;
  for (let i = 0; i < 120; i++) {
    step(g, STEP, { slide: true });
    slides += g.events.filter(e => e.type === "slide").length;
    g.events = [];
  }
  assert.equal(slides, 2, "a second second of mashing gets one more slide, not a held one");
  assert.ok(g.slide > 0 || g.slideCool > 0);
});

test("tunnels: a ceiling stops high jumps; riding a roof into the mouth is a crash", () => {
  const tunnel = { id: "t", len: 40, tunnel: [5, 35], items: [], shards: [] };
  const g = run([tunnel]);
  g.powers.booster = 99;
  go(g, 18 + 10);
  assert.ok(ceilingAt(g));
  let top = 0;
  step(g, STEP, { jump: true });
  while (g.air) {
    step(g, STEP);
    top = Math.max(top, g.y);
  }
  assert.ok(top + 1.8 <= 4.4 + 1e-6 && top > 2, "up to the ceiling, no further");
  assert.equal(g.over, false);
  const roof = { id: "t", len: 60, tunnel: [30, 55], items: [{ kind: "ramp", lane: 1, z: 2 }, { kind: "parked", lane: 1, z: 10, len: 40 }], shards: [] };
  assert.equal(go(run([roof]), 100).over, "tunnel");
  assert.equal(go(run([roof], { lane: 0 }), 100).over, false, "the track under it is fine");
});

test("no obstacle stands on (or over) a train, in any chunk", () => {
  const trains = new Set(["parked", "oncoming"]);
  for (const chunk of CHUNKS) {
    const g = newGame(configOf(), () => 0.3, { chunks: [] });
    placeChunk(g, chunk, 0, false);
    for (const t of g.obstacles.filter(o => trains.has(o.kind))) {
      for (const o of g.obstacles) {
        if (o === t || !(o.wide || [o.lane, o.to ?? o.lane].includes(t.lane))) continue;
        const along = o.z < t.z + t.len && o.z + o.len > t.z;
        assert.ok(!along || trains.has(o.kind), `${chunk.id}: a ${o.kind} on the ${t.kind} train in lane ${t.lane}`);
      }
    }
  }
});

test("power-ups: armor takes one crash, Kerenzikov dodges, Skate Foot smashes, bullet time slows the world", () => {
  const blocks = { id: "t", len: 60, items: [{ kind: "roadblock", lane: 1, z: 10 }, { kind: "roadblock", lane: 1, z: 30 }], shards: [] };
  const a = run([blocks]);
  a.powers.armor = true;
  go(a, 100);
  assert.equal(a.over, "roadblock", "only once");
  assert.ok(a.dist > 18 + 20 && !a.powers.armor, "past the first");

  const k = run([blocks]);
  k.powers.kerenzikov = 10;
  go(k, 100);
  assert.equal(k.over, false);
  assert.notEqual(k.lane, 1);

  const s = run([blocks]);
  s.powers.skate = 8;
  go(s, 100);
  assert.equal(s.over, false);
  assert.ok(runSpeed(s) > 14);

  const wreck = { id: "t", len: 20, items: [{ kind: "wreck", lane: 1, z: 10 }], shards: [] };
  const w = run([wreck]);
  w.powers.skate = 8;
  assert.equal(go(w, 60).over, "wreck", "Skate Foot doesn't smash wrecks");

  const t = run([]);
  t.powers.sandevistan = 6;
  for (let i = 0; i < 10; i++) advance(t, 0.1);
  assert.ok(Math.abs(t.dist - 14 * 0.7) < 0.2, "slower");
  for (let i = 0; i < 60; i++) advance(t, 0.1);
  assert.ok(!t.powers.sandevistan, "it wore off");
});

test("shards: picked up in your lane, pulled in by the magnet, doubled by the Data Spike", () => {
  const line = { id: "t", len: 30, items: [], shards: [{ lane: 1, z: 2, n: 5 }, { lane: 0, z: 2, n: 5 }] };
  assert.equal(go(run([line], { shards: true }), 60).shards, 5);
  const m = run([line], { shards: true });
  m.powers.magnet = 99;
  assert.equal(go(m, 60).shards, 10);
  const d = run([line], { shards: true });
  d.powers.spike = 99;
  assert.equal(go(d, 60).shards, 10);
  // The Jump Booster lays a high line, and jumps reach it.
  const b = run([], { shards: true });
  b.pickups.push({ power: "booster", lane: 1, z: 3, y: 1 });
  go(b, 100, g => ({ jump: true }));
  assert.ok(b.shards > 5);
});

test("the GM's options: unknown values dropped, switched-off families and power-ups never turn up", () => {
  assert.deepEqual(configOf(), NCART_DEFAULTS);
  assert.equal(configOf({ preset: "cyberpsycho", powers: { spike: "yes" } }).powers.spike, true, "old options and junk dropped");
  assert.equal(configOf({ families: { drone: false } }).families.drone, false);
  assert.equal(configOf({ families: { junk: true } }).families.junk, undefined);

  const noDrones = chunksFor(1e6, configOf({ families: { drone: false } }).families);
  assert.ok(noDrones.length && noDrones.every(c => !chunkFamilies(c).includes("drone")));
  const nothing = chunksFor(1e6, Object.fromEntries(Object.keys(FAMILIES).map(f => [f, false])));
  assert.ok(nothing.length, "an empty track is still a track");
  assert.ok(chunksFor(0).every(c => !c.from), "the hard ones wait");
  assert.ok(chunksFor(0).length < chunksFor(2000).length);

  const sandy = newGame(configOf({ powers: { ...Object.fromEntries(Object.keys(POWERS).map(p => [p, false])), sandevistan: true } }));
  assert.equal(pickPower(sandy, 500), null, "Sandevistan waits");
  assert.equal(pickPower(sandy, 900), "sandevistan");
  const g = newGame(configOf({ powers: { ...Object.fromEntries(Object.keys(POWERS).map(p => [p, false])), magnet: true } }));
  for (let i = 0; i < 20; i++) assert.equal(pickPower(g), "magnet");
  g.config.powers.magnet = false;
  assert.equal(pickPower(g), null);
});

test("a random run lays power-ups and only allowed chunks, with gaps that grow with speed", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = newGame(configOf({ families: { oncoming: false } }), rand);
  g.grace = Infinity;
  let powers = 0;
  while (g.dist < 4000) {
    advance(g, 0.1);
    assert.ok(!g.obstacles.some(o => o.kind === "oncoming"));
    powers += g.pickups.filter(p => p.power && !p.seen && (p.seen = true)).length;
  }
  assert.ok(powers >= 6, `${powers} power-ups`);
  assert.ok(chunkGap(30) > chunkGap(11));
});

test("variations share a group: it comes up as often as one chunk, and each variation turns up", () => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const list = chunksFor(2000);
  const groups = new Set(list.map(groupOf));
  const count = {};
  let last = null;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const c = pickChunk(list, last, rand);
    assert.notEqual(groupOf(c), last, "not the same group twice in a row");
    last = groupOf(c);
    count[c.id] = (count[c.id] ?? 0) + 1;
  }
  const roofs = list.filter(c => groupOf(c) === "rooftops").map(c => c.id);
  assert.deepEqual(roofs, ["rooftops", "rooftops-single", "rooftops-side", "rooftops-both"]);
  const share = roofs.reduce((t, id) => t + count[id], 0) / n;
  assert.ok(Math.abs(share - 1 / groups.size) < 0.01, `rooftops ${share} of chunks, one group in ${groups.size}`);
  for (const id of roofs) assert.ok(count[id] > n / groups.size / 4 * 0.8, `${id} turns up`);
});

test("leaderboard: ranked by shards, then distance; each character keeps their best", () => {
  let list = [];
  list = addScore(list, { id: "1", name: "AAA", actorId: "pcA", shards: 40, dist: 900, ts: 1 });
  list = addScore(list, { id: "2", name: "BBB", actorId: "pcB", shards: 40, dist: 1200, ts: 2 });
  list = addScore(list, { id: "3", name: "ZED", shards: 90, dist: 100, ts: 3, fake: true });
  assert.deepEqual(topScores(list).map(s => [s.rank, s.name]), [[1, "ZED"], [2, "BBB"], [3, "AAA"]]);
  assert.deepEqual(addScore(list, { id: "4", actorId: "pcA", shards: 40, dist: 800, ts: 4 }), list, "same shards, shorter: not their best");
  const worse = addScore(list, { id: "4", actorId: "pcA", shards: 39, dist: 5000, ts: 4 });
  assert.equal(worse.find(s => s.actorId === "pcA").id, "1", "not their best");
  const best = addScore(list, { id: "5", actorId: "pcA", shards: 41, dist: 100, ts: 5 });
  assert.equal(best.filter(s => s.actorId === "pcA").length, 1);
  assert.equal(topScores(best)[1].id, "5");
  assert.equal(boardRank(list, "pcA", 95, 10), 1);
  assert.equal(boardRank(list, "pcA", 10, 10), 0, "not a new best");
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: "F", shards: 100 + i, dist: 1, ts: i }));
  assert.equal(boardRank(full, "pcC", 50, 50), 0, "doesn't make the top ten");
  for (const e of randomEntries(8, Math.random)) assert.ok(plausible(e.shards, e.dist) && e.name.length === 3 && e.dist < 1400);
});

test("plausible scores: not too many shards for the distance", () => {
  assert.ok(plausible(0, 0));
  assert.ok(plausible(300, 1000 * SHOWN));
  assert.ok(!plausible(2000, 1000 * SHOWN));
  assert.ok(!plausible(-1, 10));
  assert.ok(!plausible(10, 1e9));
});

test("the host keeps the board: only your own character, believable numbers, your best; the GM manages it", async () => {
  await store._writing;
  reset();
  const gm = addUser({ id: "gm", isGM: true });
  const alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "Valerie Solo", owners: ["alice"] });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"] });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), loaded: true, loadFailed: false, _written: new Map(), _writing: null });
  const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
  const settle = async () => {
    await store._enqueue(() => {});
    await store._writing;
  };
  const scores = () => game.settings.get("cpr-sam-agent", "ncartBoard")?.scores ?? [];

  from(alice, "ncart-score", { actorId: "pcA", shards: 40, dist: 900, initials: "VAL" });
  await settle();
  assert.deepEqual(scores().map(s => [s.name, s.who, s.shards, s.dist]), [["VAL", "Valerie Solo", 40, 900]]);
  from(alice, "ncart-score", { actorId: "pcB", shards: 90, dist: 900 });
  from(alice, "ncart-score", { actorId: "pcA", shards: 4000, dist: 100 });
  from(alice, "ncart-score", { actorId: "pcA", shards: 30, dist: 5000 });
  from(alice, "ncart-fake", { name: "Cheat", shards: 999, dist: 9999 });
  await settle();
  assert.equal(scores().length, 1, "not your character, too many shards, a worse run, a player's fake: nothing");
  assert.equal(scores()[0].shards, 40);
  from(alice, "ncart-score", { actorId: "pcA", shards: 41, dist: 950, initials: "no!" });
  await settle();
  assert.deepEqual(scores().map(s => [s.name, s.shards]), [["VAL", 41]], "a better run; bad initials keep the old ones");

  from(gm, "ncart-fake", { name: "  Adam Smasher  ", shards: 2000, dist: 6000 });
  from(gm, "ncart-fill", { count: 3 });
  await settle();
  assert.equal(scores().length, 5);
  assert.equal(scores()[0].name, "Adam Smasher");
  assert.ok(scores().filter(s => s.fake).length === 4);
  from(gm, "ncart-remove", { id: scores()[0].id });
  await settle();
  assert.equal(scores().length, 4);
  from(alice, "ncart-reset");
  await settle();
  assert.equal(scores().length, 4, "only the GM clears it");
  from(gm, "ncart-reset");
  await settle();
  assert.deepEqual(scores(), []);
});

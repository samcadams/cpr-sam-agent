import { addActor, addUser, actAs, hooks, reset } from "./foundry-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addScore, advance, boardRank, canPlay, chunkGap, chunkLen, CHUNKS, chunksFor, configOf, deathLine, DEATHS, flyerAt, KINDS, move, newGame,
  PHYSICS, placeChunk, plausible, press, randomEntries, riderOf, SPEEDS, speedAt, stageAt, stageLabel, STEEDS, steedsOf, step, STEP, topScores
} from "../apps/roach/model.js";
import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import { agentDay } from "../scripts/util/agentTime.js";

/*
 * Roach Race's game model (apps/roach/model.js): the button (jump, double jump, glitch), the
 * stages, that every chunk can be cleared at every speed, pickups, and the steeds, passes and board.
 */

/** Roach on the ground just before a chunk placed at x0, at stage `stage` (its speed), glitch off. */
function before(chunk, stage, x0 = 1000) {
  const g = newGame(() => 0.5, { chunks: [] });
  g.next = Infinity;
  g.items = placeChunk(chunk, x0).filter(i => !KINDS[i.kind].pickup);
  g.stage = stage;
  g.dist = x0 - chunkGap(speedAt(stage)) / 2 - PHYSICS.horse.x;
  g.glitchCd = Infinity;
  return g;
}

const copy = g => ({ ...g, events: [] });

/**
 * Whether some way of pressing gets Roach across a chunk and back on the ground before the next one
 * can start (half the gap after it): a breadth-first search over pressing or not every 1/30 s, jumps
 * and double jumps only, merging states that are the same.
 */
function clears(chunk, stage) {
  const g0 = before(chunk, stage);
  const x0 = 1000;
  const goal = x0 + chunkLen(chunk) + chunkGap(speedAt(stage)) / 2;
  let layer = [g0];
  for (let n = 0; n < 2000 && layer.length; n++) {
    const next = new Map();
    for (const s of layer) {
      for (const pressed of s.jumps < 2 && !s.falling ? [false, true] : [false]) {
        const g = copy(s);
        for (let i = 0; i < 4 && !g.over; i++) move(g, STEP, pressed && i === 0);
        if (g.over) continue;
        if (g.dist + PHYSICS.horse.x >= goal) {
          if (g.y === 0 && !g.falling) return true;
          continue;
        }
        const key = `${Math.round(g.y * 4)}|${Math.round(g.vy)}|${g.jumps}|${g.falling}`;
        if (!next.has(key)) next.set(key, g);
      }
    }
    layer = [...next.values()];
  }
  return false;
}

test("every chunk can be cleared at every speed it turns up at, without the glitch", () => {
  const failed = [];
  for (const chunk of CHUNKS) {
    // The first stage it turns up in, and every speed after.
    for (let stage = chunk.from; speedAt(stage) <= PHYSICS.maxSpeed; stage++) {
      if (!clears(chunk, stage)) failed.push(`${chunk.id} @ ${speedAt(stage)}`);
      if (speedAt(stage) === PHYSICS.maxSpeed) break;
    }
  }
  assert.deepEqual(failed, []);
});

/**
 * The same search, but it also has to take every apple in the chunk on the way (a chunk's apples
 * promise a line through them, so all of them must be reachable together). An apple counts only when
 * Roach's box reaches its middle, so a frame-perfect graze doesn't pass for a line a player can ride.
 */
const reaches = (g, a) => {
  const hx = g.dist + PHYSICS.horse.x;
  const [cx, cy] = [a.x + a.w / 2, a.alt + a.h / 2];
  return cx > hx && cx < hx + PHYSICS.horse.w && cy > g.y && cy < g.y + PHYSICS.horse.h;
};

function takesAll(chunk, stage) {
  const apples = placeChunk(chunk, 1000).filter(i => i.kind === "apple");
  const all = 2 ** apples.length - 1;
  const g0 = before(chunk, stage);
  g0.got = 0;
  const goal = 1000 + chunkLen(chunk) + chunkGap(speedAt(stage)) / 2;
  let layer = [g0];
  for (let n = 0; n < 2000 && layer.length; n++) {
    const next = new Map();
    for (const s of layer) {
      for (const pressed of s.jumps < 2 && !s.falling ? [false, true] : [false]) {
        const g = copy(s);
        for (let i = 0; i < 4 && !g.over; i++) {
          move(g, STEP, pressed && i === 0);
          apples.forEach((a, k) => reaches(g, a) && (g.got |= 1 << k));
        }
        if (g.over) continue;
        if (g.dist + PHYSICS.horse.x >= goal) {
          if (g.y === 0 && !g.falling && g.got === all) return true;
          continue;
        }
        const key = `${Math.round(g.y * 4)}|${Math.round(g.vy)}|${g.jumps}|${g.falling}|${g.got}`;
        if (!next.has(key)) next.set(key, g);
      }
    }
    layer = [...next.values()];
  }
  return false;
}

test("every chunk's apples can all be taken in one go, at every speed it turns up at", () => {
  const failed = [];
  for (const chunk of CHUNKS.filter(c => c.items.some(([k]) => k === "apple"))) {
    for (let stage = chunk.from; speedAt(stage) <= PHYSICS.maxSpeed; stage++) {
      if (!takesAll(chunk, stage)) failed.push(`${chunk.id} @ ${speedAt(stage)}`);
      if (speedAt(stage) === PHYSICS.maxSpeed) break;
    }
  }
  assert.deepEqual(failed, []);
  // ... and the search can fail: one apple on the ground, one high above it.
  assert.ok(!takesAll({ id: "split", items: [["apple", 0, 4], ["apple", 0, 200]] }, 0));
});

test("the search isn't a pushover: an impossible chunk fails", () => {
  assert.ok(!clears({ id: "chasm", items: [["pit", 0, 400]] }, 0));
  assert.ok(!clears({ id: "tower", items: [["wall", 0], ["barrier", 20], ["wall", 40], ["barrier", 60], ["wall", 80], ["wall", 100]] }, 0));
});

test("standing still: flyers miss Roach on the ground, except a diving crow", () => {
  for (const chunk of CHUNKS) {
    const flyers = chunk.items.filter(([k]) => KINDS[k].flyer);
    if (!flyers.length || chunk.items.some(([k]) => !KINDS[k].flyer && !KINDS[k].pickup)) continue;
    const g = before(chunk, 6);
    while (!g.over && g.dist < 1000 + chunkLen(chunk) + 100) move(g, STEP);
    assert.equal(!!g.over, flyers.some(([k]) => k === "diver"), chunk.id);
  }
});

test("hazards come in by stage: ground only in 1-1, all of them once it loops", () => {
  const kinds = stage => new Set(chunksFor(stage).flatMap(c => c.items.map(([k]) => k)));
  assert.ok(!kinds(0).has("crow") && !kinds(0).has("pit"));
  assert.ok(kinds(1).has("crow") && kinds(1).has("pit") && !kinds(1).has("griffon"));
  assert.ok(kinds(2).has("griffon") && !kinds(2).has("swoop"));
  assert.ok(kinds(3).has("swoop"));
  assert.equal(chunksFor(9).length, CHUNKS.length);
  assert.deepEqual([0, 3, 4, 9].map(stageLabel), ["1-1", "1-4", "2-1", "3-2"]);
  assert.equal(stageAt(PHYSICS.stageLen * 4 + 1), 4);
  assert.ok(SPEEDS[0] === PHYSICS.speed && SPEEDS.at(-1) === PHYSICS.maxSpeed);
});

test("the button: jump, double jump, then glitch to the ground (once charged)", () => {
  const g = newGame(() => 0.5, { chunks: [] });
  g.next = Infinity;
  press(g);
  assert.equal(g.jumps, 1);
  for (let i = 0; i < 12; i++) move(g, STEP);
  const high = g.y;
  press(g);
  assert.equal(g.jumps, 2);
  assert.equal(g.vy, PHYSICS.double);
  for (let i = 0; i < 12; i++) move(g, STEP);
  assert.ok(g.y > high);
  press(g);
  assert.equal(g.y, 0, "glitched down");
  assert.equal(g.safe, PHYSICS.glitchSafe);
  assert.ok(g.events.some(e => e.type === "glitch"));
  // Again at once: a jump (on the ground), a double, then nothing (still charging).
  press(g);
  press(g);
  const y = g.y;
  press(g);
  assert.equal(g.jumps, 2);
  assert.equal(g.y, y, "no glitch while it charges");
});

test("the glitch carries Roach through a hazard and over a pit", () => {
  const chunk = { items: [["wall", 0]] };
  const g = before(chunk, 0);
  g.glitchCd = 0;
  while (g.dist + PHYSICS.horse.x + PHYSICS.horse.w < 1000 - 2) move(g, STEP);
  press(g);
  press(g);
  press(g);
  assert.ok(g.safe > 0);
  for (let i = 0; i < 20; i++) move(g, STEP);
  assert.ok(!g.over, "untouchable");
  for (let i = 0; i < 120; i++) move(g, STEP);
  assert.ok(!g.over);

  const pit = before({ items: [["pit", 0, 40]] }, 0);
  pit.glitchCd = 0;
  while (pit.dist + PHYSICS.horse.x < 1000 - 20) move(pit, STEP);
  press(pit);
  press(pit);
  press(pit);
  for (let i = 0; i < 40; i++) move(pit, STEP);
  assert.ok(!pit.over && !pit.falling, "glitched over the pit");
});

test("running into things ends the run; falling in a pit too", () => {
  const g = before({ items: [["barrier", 0]] }, 0);
  while (!g.over) move(g, STEP);
  assert.equal(g.over, "barrier");
  const p = before({ items: [["pit", 0, 80]] }, 0);
  while (!p.over) move(p, STEP);
  assert.equal(p.over, "pit");
  for (const kind of Object.keys(KINDS).filter(k => !KINDS[k].pickup)) assert.ok(DEATHS[kind], kind);
  assert.equal(typeof deathLine("nope"), "string");
});

test("flyers always meet Roach where they were placed, and dive or swoop as Roach comes", () => {
  const [swoop] = placeChunk({ items: [["swoop", 0]] }, 500);
  assert.equal(flyerAt(swoop, 500, 200).x, 500);
  const far = flyerAt(swoop, 100, 200);
  assert.ok(far.x > 500 && far.alt === KINDS.swoop.alt[0]);
  assert.equal(flyerAt(swoop, 500, 200).alt, KINDS.swoop.alt[1]);
});

test("apples score, carrots chain and treble the score", () => {
  const g = newGame(() => 0.5, { chunks: [{ items: [["apple", 0, 4], ["carrot", 60, 4], ["carrot", 200, 4]] }] });
  g.items = [];
  g.next = 100;
  while (g.dist < 600) step(g, STEP);
  assert.equal(g.apples, 1);
  assert.equal(g.carrots, 2);
  assert.ok(g.carrot > PHYSICS.carrotTime, "chained");
  // Two legs: three times the points a unit.
  const a = newGame(() => 0.5, { chunks: [] });
  const b = newGame(() => 0.5, { chunks: [] });
  a.next = b.next = Infinity;
  b.carrot = 10;
  for (let i = 0; i < 120; i++) {
    step(a, STEP);
    step(b, STEP);
  }
  assert.ok(Math.abs(b.score - 3 * a.score) < 1e-6);
});

test("a random run lays a course and plays at any frame rate", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = newGame(rand);
  for (let i = 0; i < 600 && !g.over; i++) advance(g, 1 / 60, i % 40 === 0);
  assert.ok(g.items.length > 0);
  assert.ok(g.dist > 0);
});

test("steeds: the GM's names, prices and sale; Roach always free", () => {
  const s = steedsOf({ roach: { price: 99, sale: "hidden" }, unicorn: { price: "350", name: "  Sparkles " }, gold: { sale: "buy" }, chromed: { sale: "bogus" } });
  assert.equal(s.roach.price, 0);
  assert.equal(s.roach.sale, "buy");
  assert.equal(s.unicorn.price, 350);
  assert.equal(s.unicorn.name, "Sparkles");
  assert.equal(s.gold.sale, "buy");
  assert.equal(s.chromed.sale, "buy");
  assert.equal(s.samurai.price, STEEDS.samurai.price);
  const cfg = configOf({ price: "35", record: -5 });
  assert.equal(cfg.price, 35);
  assert.equal(cfg.record, 0);
  assert.equal(configOf().price, 20);
  assert.equal(configOf().record, 3354);
});

test("riders: Roach is always in the stable; a pass is good for its day only", () => {
  const r = riderOf({ a: { steeds: ["unicorn", "nope"], steed: "nope", pass: "Day 7" } }, "a");
  assert.deepEqual(r.steeds, ["roach", "unicorn"]);
  assert.equal(r.steed, "roach");
  const cfg = configOf();
  assert.ok(canPlay(r, cfg, "Day 7"));
  assert.ok(!canPlay(r, cfg, "Day 8"));
  assert.ok(canPlay(riderOf({}, "b"), configOf({ freePlay: true }), "Day 8"));
  assert.ok(!canPlay(r, configOf({ out: true, freePlay: true }), "Day 7"));
});

test("the board: best per character, believable scores only", () => {
  let scores = addScore([], { id: "1", actorId: "a", name: "AAA", score: 900, ts: 1 });
  scores = addScore(scores, { id: "2", actorId: "a", name: "AAA", score: 500, ts: 2 });
  assert.equal(scores.length, 1);
  assert.equal(boardRank(scores, "b", 1000), 1);
  assert.equal(topScores(scores)[0].rank, 1);
  assert.ok(plausible(3354, 30000));
  assert.ok(!plausible(3354, 1000));
  const fakes = randomEntries(5, () => 0.4);
  assert.equal(fakes.length, 5);
  for (const f of fakes) assert.ok(plausible(f.score, f.dist), f.name);
});

/* ---------------- The host: passes, steeds, the board, the House Record ---------------- */

async function host() {
  await store._writing;
  reset();
  const gm = addUser({ id: "gm", isGM: true });
  const alice = addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "Valerie Solo", owners: ["alice"], wealth: 120 });
  addActor({ id: "pcB", name: "Judy", owners: ["bob"], wealth: 500 });
  Object.assign(store, { threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), loaded: true, loadFailed: false, _written: new Map(), _writing: null });
  store._folders = store._ensureFolders();
  const from = (user, type, data = {}) => store._onSocket({ ...data, type }, user.id);
  const settle = async () => {
    await store._enqueue(() => {});
    await store._writing;
  };
  return { gm, alice, from, settle, rider: id => riderOf(store.apps.roachRiders, id), wealth: id => game.actors.get(id).system.wealth.value };
}

test("a day pass is paid through BangMe!, good for today, and declined without the eddies", async () => {
  const { alice, from, settle, rider, wealth } = await host();
  from(alice, "roach-pass", { actorId: "pcA" });
  await settle();
  assert.equal(rider("pcA").pass, agentDay());
  assert.equal(wealth("pcA"), 100);
  assert.ok(Object.values(store.apps.ledger).some(l => l.actorId === "pcA" && l.amount === -20 && l.kind === "roach"));
  // Again the same day: nothing more to pay.
  from(alice, "roach-pass", { actorId: "pcA" });
  await settle();
  assert.equal(wealth("pcA"), 100);
  // Not their character.
  from(alice, "roach-pass", { actorId: "pcB" });
  await settle();
  assert.equal(rider("pcB").pass, null);
  // Too dear: declined, no pass.
  await game.settings.set("cpr-sam-agent", "roach", { price: 5000 });
  store.apps.roachRiders = {};
  from(alice, "roach-pass", { actorId: "pcA" });
  await settle();
  assert.equal(rider("pcA").pass, null);
  assert.equal(wealth("pcA"), 100);
  assert.ok(Object.values(store.apps.alerts).some(a => a.actorId === "pcA" && /Declined/.test(a.text)));
});

test("steeds: bought once, then ridden; gift-only ones can't be bought; the GM gives and takes", async () => {
  const { gm, alice, from, settle, rider, wealth } = await host();
  from(alice, "roach-steed", { actorId: "pcA", steedId: "chromed" });
  await settle();
  assert.deepEqual(rider("pcA").steeds, ["roach", "chromed"]);
  assert.equal(rider("pcA").steed, "chromed");
  assert.equal(wealth("pcA"), 70);
  from(alice, "roach-steed", { actorId: "pcA", steedId: "roach" });
  from(alice, "roach-steed", { actorId: "pcA", steedId: "chromed" });
  await settle();
  assert.equal(wealth("pcA"), 70, "riding one you own is free");
  from(alice, "roach-steed", { actorId: "pcA", steedId: "gold" });
  from(alice, "roach-steed", { actorId: "pcA", steedId: "samurai" }); // 500eb: declined
  await settle();
  assert.deepEqual(rider("pcA").steeds, ["roach", "chromed"]);
  from(alice, "roach-gift", { actorId: "pcA", steedId: "gold" });
  await settle();
  assert.ok(!rider("pcA").steeds.includes("gold"), "players can't gift");
  from(gm, "roach-gift", { actorId: "pcA", steedId: "gold" });
  await settle();
  assert.ok(rider("pcA").steeds.includes("gold"));
  from(gm, "roach-gift", { actorId: "pcA", steedId: "chromed", take: true });
  await settle();
  assert.deepEqual(rider("pcA").steeds, ["roach", "gold"]);
  assert.equal(rider("pcA").steed, "roach", "back on Roach");
});

test("the GM grants, revokes and refunds passes", async () => {
  const { gm, alice, from, settle, rider, wealth } = await host();
  from(alice, "roach-pass", { actorId: "pcA" });
  await settle();
  from(gm, "roach-grant", { actorId: "pcA", on: false, refund: true });
  await settle();
  assert.equal(rider("pcA").pass, null);
  assert.equal(wealth("pcA"), 120);
  from(gm, "roach-grant", { actorId: "pcB", on: true });
  await settle();
  assert.equal(rider("pcB").pass, agentDay());
  from(gm, "roach-grant", { actorId: "pcB", on: false, refund: true });
  await settle();
  assert.equal(wealth("pcB"), 500, "nothing paid, nothing refunded");
});

test("the board keeps believable bests; beating the House Record asks the GM once", async () => {
  const { gm, alice, from, settle, rider } = await host();
  const scores = () => game.settings.get("cpr-sam-agent", "roachBoard")?.scores ?? [];
  from(alice, "roach-score", { actorId: "pcA", score: 900, dist: 9000, initials: "VAL" });
  from(alice, "roach-score", { actorId: "pcA", score: 99999, dist: 100 });
  await settle();
  assert.deepEqual(scores().map(s => [s.name, s.score]), [["VAL", 900]]);
  from(alice, "roach-score", { actorId: "pcA", score: 3400, dist: 34000 });
  await settle();
  assert.equal(scores()[0].score, 3400);
  assert.equal(rider("pcA").record, "pending");
  const cards = () => hooks.filter(h => h.hook === "cpr-sam-agent.gmCard").map(h => h.args[0]).filter(c => c.id === "roach:pcA");
  assert.equal(cards().length, 1);
  from(alice, "roach-score", { actorId: "pcA", score: 3500, dist: 35000 });
  await settle();
  assert.equal(cards().length, 1, "once per character");
  from(alice, "roach-record", { actorId: "pcA", award: true });
  await settle();
  assert.equal(rider("pcA").record, "pending", "players can't award themselves");
  from(gm, "roach-record", { actorId: "pcA", award: true });
  await settle();
  assert.equal(rider("pcA").record, "awarded");
  assert.ok(Object.values(store.apps.alerts).some(a => a.actorId === "pcA" && /Roach Whisperer/.test(a.text)));
});

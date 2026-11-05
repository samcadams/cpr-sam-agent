import { addActor, addUser, actAs, files, folders, reset } from "./foundry-stub.js";
import { test } from "node:test";
import assert from "node:assert/strict";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";

import {
  addRun, autopilot, blocks, buildTrack, CLASS_IDS, CLASSES, configOf, crossings, decodeGhost, deltaTo, DISTRICT_IDS, DISTRICTS, encodeGhost, GAP,
  curveAt, ghostAt, ghostFile, ghostTimeAt, gridSlot, kmaxOf, lineGain, newRace, PHYSICS, placedMap, plausible, pointsFrom, position, QUICK_LEN,
  quickSpec, ROAD, RUNOUT, runRank, SEG, START, seenHas, seenMask, step, STEP, topRuns, trackPos, trackSpec, WALL
} from "../apps/redline/model.js";

/*
 * REDLINE's model (apps/redline/model.js): tracks built from seeds the same every time, circuits that
 * close, bends no sharper than the difficulty allows, hazards that always leave a way through, every
 * district's tracks drivable by every ride class, fighting, Heat, wrecks, ghosts, the board; and the host
 * (apps/redline/host.js).
 */

const NO_HEAT = { ...configOf(), heat: false };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Race a track on autopilot to the line (or `limit` seconds); returns the race and the crashes on the way. */
function drive(track, { cls = "sport", pack = 0, traffic = false, config = NO_HEAT, limit = 900 } = {}) {
  const g = newRace(track, { cls, pack, traffic, config });
  const crashes = [];
  while (!g.finished && g.t < limit) {
    step(g, STEP, autopilot(g));
    for (const e of g.events) if (e.type === "crash" || e.type === "wreck") crashes.push(`${e.type} ${e.kind ?? e.why} at ${Math.round(g.p.total)} m`);
    g.events = [];
  }
  return { g, crashes };
}

test("a track is built the same from its seed every time; seeds and districts make different ones", () => {
  const spec = { district: "corpo", kind: "circuit", seed: 42, difficulty: 2 };
  const a = buildTrack(spec);
  const b = buildTrack(spec);
  assert.deepEqual(a.segs, b.segs);
  assert.deepEqual(a.hazards, b.hazards);
  assert.notDeepEqual(buildTrack({ ...spec, seed: 43 }).segs, a.segs);
  assert.notDeepEqual(buildTrack({ ...spec, district: "badlands" }).segs, a.segs);
});

test("a track's seed record: kinds, lengths, laps and difficulty kept in range; the district's own hazard families", () => {
  const s = trackSpec({ district: "nowhere", kind: "loop", laps: 99, length: 5, difficulty: 7, families: { flood: true } });
  assert.equal(s.district, "combat");
  assert.equal(s.kind, "circuit");
  assert.equal(s.laps, 6);
  assert.equal(s.length, 1800);
  assert.equal(s.difficulty, 3);
  assert.deepEqual(Object.keys(s.families).sort(), Object.keys(DISTRICTS.combat.families).sort(), "only the district's families");
  assert.equal(trackSpec({ kind: "sprint", laps: 4 }).laps, 1, "a sprint is one run");
});

test("circuits close on themselves, their lap is the length asked for, and no bend is sharper than the difficulty allows", () => {
  const kmax = [0, 1 / 70, 1 / 46, 1 / 32];
  for (const district of DISTRICT_IDS) {
    for (const difficulty of [1, 2, 3]) {
      for (const seed of [1, 99, 2024]) {
        const t = buildTrack({ district, kind: "circuit", difficulty, seed, length: 3000 });
        assert.ok(Math.abs(t.len - 3000) <= SEG, `${district} lap length ${t.len}`);
        const [x0, y0] = t.map[0];
        const [x1, y1] = t.map.at(-1);
        assert.ok(Math.hypot(x1 - x0, y1 - y0) < SEG * 2, `${district} ${seed}: the minimap closes`);
        const turn = t.segs.reduce((sum, s) => sum + s.k * SEG, 0);
        assert.ok(Math.abs(Math.abs(turn) - Math.PI * 2) < 0.6, `${district} ${seed}: one full turn round (${turn.toFixed(2)})`);
        const sharpest = Math.max(...t.segs.map(s => Math.abs(s.k)));
        assert.ok(sharpest <= kmax[difficulty] * (DISTRICTS[district].tight ? 1.15 : 1) * 1.001, `${district} d${difficulty} ${seed}: radius ${(1 / sharpest).toFixed(0)} m`);
        assert.ok(Math.abs(t.segs[0].y - t.segs.at(-1).y) < 1, "the hills close too");
      }
    }
  }
});

test("every hazard leaves a way through at least GAP wide on the road, and things that block are spaced out", () => {
  for (const district of DISTRICT_IDS) {
    for (const kind of ["circuit", "sprint"]) {
      for (const seed of [3, 17, 500, 9001]) {
        const t = buildTrack({ district, kind, difficulty: 3, seed });
        const blockers = t.hazards.filter(blocks);
        for (const h of blockers) {
          // Everything blocking at the same point along the track.
          const here = blockers.filter(o => o.s < h.s + h.len && o.s + o.len > h.s);
          const cuts = here.map(o => [Math.max(-ROAD, o.x0), Math.min(ROAD, o.x1)]).sort((a, b) => a[0] - b[0]);
          let x = -ROAD;
          let widest = 0;
          for (const [a, b] of cuts) {
            widest = Math.max(widest, a - x);
            x = Math.max(x, b);
          }
          widest = Math.max(widest, ROAD - x);
          assert.ok(widest >= GAP - 1e-9, `${district} ${kind} ${seed}: only ${widest.toFixed(2)} m clear at ${h.s.toFixed(0)} m`);
        }
        const starts = [...new Set(blockers.map(h => h.s))].sort((a, b) => a - b);
        for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 120, `${district} ${kind} ${seed}: blockers ${starts[i - 1]} and ${starts[i]} too close`);
      }
    }
  }
});

test("every district's tracks can be driven clean by every ride class (autopilot, no traffic): no crash anywhere", () => {
  for (const district of DISTRICT_IDS) {
    for (const kind of ["circuit", "sprint"]) {
      for (const difficulty of [1, 2, 3]) {
        for (const seed of [11, 4242]) {
          const track = buildTrack({ district, kind, difficulty, seed, laps: 1 });
          for (const cls of CLASS_IDS) {
            const { g, crashes } = drive(track, { cls });
            assert.ok(g.finished, `${district} ${kind} d${difficulty} ${seed} ${cls}: didn't finish`);
            assert.deepEqual(crashes, [], `${district} ${kind} d${difficulty} ${seed} ${cls}`);
          }
        }
      }
    }
  }
});

test("a full race (the pack, traffic, convoys, gangers) still finishes for every ride class", () => {
  for (const district of DISTRICT_IDS) {
    const track = buildTrack({ district, kind: "circuit", difficulty: 2, seed: 77, laps: 2 });
    for (const cls of CLASS_IDS) {
      const { g } = drive(track, { cls, pack: 5, traffic: true, config: configOf() });
      assert.ok(g.finished, `${district} ${cls}`);
      assert.equal(g.laps.length, 2);
      assert.ok(Math.abs(g.laps.reduce((a, b) => a + b, 0) - g.time) < 1e-6, "the laps add up to the time");
      assert.ok(g.place >= 1 && g.place <= 6);
    }
  }
});

test("Quick Races are short sprints: about 45–90 s for a mid-pack ride", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const spec = quickSpec(seed);
    assert.equal(spec.kind, "sprint");
    assert.ok(spec.length >= QUICK_LEN[0] && spec.length <= QUICK_LEN[1]);
    assert.deepEqual(quickSpec(seed), spec, "the same seed, the same course");
    const { g } = drive(buildTrack(spec), { cls: "sport" });
    assert.ok(g.time > 35 && g.time < 100, `seed ${seed}: ${g.time.toFixed(1)} s`);
  }
});

test("the lights: nothing moves for the countdown, then the race clock starts at zero", () => {
  const g = newRace(buildTrack({ seed: 5 }), { pack: 2, traffic: false });
  const start = g.p.total;
  let lights = 0;
  while (g.t + STEP < -1e-9) {
    step(g, STEP, { steer: 1 });
    lights += g.events.filter(e => e.type === "light").length;
    g.events = [];
  }
  assert.equal(lights, 3);
  assert.equal(g.p.total, start);
  step(g, STEP, {});
  step(g, STEP, {});
  assert.ok(g.p.v > 0);
});

test("the grid: a Drive Land Vehicle roll picks the slot; no roll starts mid-pack", () => {
  assert.equal(gridSlot(26, 6), 0);
  assert.equal(gridSlot(19, 6), 2);
  assert.equal(gridSlot(13, 6), 4);
  assert.equal(gridSlot(3, 6), 5);
  assert.equal(gridSlot(3, 3), 2, "never past the back of a small grid");
  assert.equal(gridSlot(null, 6), 2);
  const t = buildTrack({ seed: 8 });
  const pole = newRace(t, { slot: 0, pack: 5 });
  const back = newRace(t, { slot: 5, pack: 5 });
  assert.ok(pole.p.total > back.p.total);
  assert.equal(new Set([pole.p, ...pole.racers].map(r => `${r.total},${r.x}`)).size, 6, "every slot is its own");
});

test("blocking hazards crash you; a wreck rolls you on, hands off, back to a clear line near the middle and up to speed, then nothing hits you for a moment", () => {
  const t = buildTrack({ district: "corpo", kind: "sprint", seed: 31, difficulty: 3 });
  const bar = t.hazards.find(h => blocks(h) && h.x0 <= -ROAD);
  assert.ok(bar, "a checkpoint with a barrier on the left");
  const g = newRace(t, { cls: "superbike", pack: 0, traffic: false, config: NO_HEAT });
  g.t = 0;
  g.p.total = bar.s - 72 - 30;
  g.p.x = (Math.max(-WALL, bar.x0) + bar.x1) / 2;
  g.p.v = 60;
  let crash = null;
  for (let i = 0; i < 240 && !crash; i++) {
    step(g, STEP, {});
    crash = g.events.find(e => e.type === "crash");
    g.events = [];
  }
  assert.ok(crash, "drove into it");
  assert.ok(g.p.v < 20);
  // Hurt again: wrecked.
  g.p.hp = 1;
  g.p.total += 400;
  g.p.v = 40;
  g.p.x = 4;
  g.p.grace = 0;
  g.fires.push({ id: "fx", kind: "fire", s: trackPos(t, g.p.total) + 3, len: 3, x0: 3, x1: 5 });
  const wrecks = g.crashes;
  for (let i = 0; i < 120 && g.crashes === wrecks; i++) step(g, STEP, {});
  assert.equal(g.crashes, wrecks + 1);
  assert.ok(g.p.wreck > 0);
  const at = g.p.total;
  for (let t2 = 0; t2 < PHYSICS.recover - 0.05; t2 += STEP) step(g, STEP, { steer: 1 });
  assert.ok(g.p.total > at + 60, `rolled on (${(g.p.total - at).toFixed(0)} m)`);
  assert.ok(Math.abs(g.p.x) <= 1.75, `back near the middle (${g.p.x})`);
  assert.ok(g.p.v > CLASSES.superbike.top * 0.55, "up to speed");
  g.events = [];
  for (let i = 0; i < 12; i++) step(g, STEP, {});
  assert.equal(g.p.wreck, 0);
  assert.ok(g.events.some(e => e.type === "respawn"));
  assert.ok(g.p.grace > 0 && g.p.hp >= 70);
  const hp = g.p.hp;
  g.fires.push({ id: "fy", kind: "fire", s: trackPos(t, g.p.total) + 1, len: 3, x0: g.p.x - 1, x1: g.p.x + 1 });
  for (let i = 0; i < 30; i++) step(g, STEP, {});
  assert.equal(g.p.hp >= hp, true, "nothing hits you in the grace");
});

test("the racing line: a bend's inside gains ground and its outside loses it", () => {
  assert.ok(lineGain(1 / 50, 5) > 1.1);
  assert.ok(lineGain(1 / 50, -5) < 0.95);
  assert.equal(lineGain(0, 5), 1);
});

/** The sharpest point of a track's bends: { s, k }. */
function sharpest(track) {
  let best = { s: 0, k: 0 };
  for (let s = START + 60; s < track.len - RUNOUT; s += SEG) if (Math.abs(curveAt(track, s)) > Math.abs(best.k)) best = { s, k: curveAt(track, s) };
  return best;
}

/** A sport ride mid-bend at `v`, in the middle of the road; steps it `secs` with `input`. */
function inBend(track, v, input, secs) {
  const g = newRace(track, { cls: "sport", pack: 0, traffic: false, config: NO_HEAT });
  const { s, k } = sharpest(track);
  Object.assign(g, { t: 1 });
  Object.assign(g.p, { total: s - START, x: 0, v });
  const start = { x: 0, v };
  for (let t = 0; t < secs; t += STEP) step(g, STEP, input);
  return { g, out: (g.p.x - start.x) * -Math.sign(k), lost: start.v - g.p.v, k };
}

test("a bend the grip holds only drifts you a little and the keys win easily; past the grip you slide wide and scrub speed", () => {
  const track = buildTrack({ district: "combat", kind: "sprint", difficulty: 3, seed: 11, length: 4000 });
  const { k } = sharpest(track);
  const hold = Math.sqrt((PHYSICS.steer * CLASSES.sport.grip ** 2) / (Math.abs(k) * PHYSICS.centri));
  const into = Math.sign(k);
  // Under the grip, hands off: a slow drift wide, nothing like the push itself.
  const drift = inBend(track, hold * 0.9, { steer: 0, brake: false }, 0.25);
  const push = ((hold * 0.9) ** 2 * Math.abs(k) * PHYSICS.centri) / CLASSES.sport.grip;
  assert.ok(drift.out > 0 && drift.out / 0.25 < push * 0.5, `drifts ${drift.out.toFixed(2)} m in 0.25 s`);
  // Steering in wins well: most of the steering is still yours.
  const held = inBend(track, hold * 0.9, { steer: into, brake: false }, 0.25);
  assert.ok(-held.out / 0.25 > PHYSICS.steer * 0.5, `steers in at ${(-held.out / 0.25).toFixed(1)} m/s`);
  // Overcooked: wide even on full lock, and the tyres scrub the speed off (no throttle lift needed).
  const hot = inBend(track, hold * 1.5, { steer: into, brake: false }, 0.4);
  assert.ok(hot.out > 0, "slides wide on full lock");
  assert.ok(hot.lost > PHYSICS.coast * 0.4 * 2, `scrubs speed: lost ${hot.lost.toFixed(1)} m/s`);
});

test("flat out with no brakes the sharpest bends still find the wall now and then; the AI brakes for them", () => {
  let flatOut = 0;
  let braked = 0;
  for (const district of DISTRICT_IDS) {
    const track = buildTrack({ district, kind: "sprint", difficulty: 3, seed: 14, length: 4000 });
    for (const brakes of [true, false]) {
      const g = newRace(track, { cls: "superbike", pack: 0, traffic: false, config: NO_HEAT });
      while (!g.finished && g.t < 300) {
        const input = autopilot(g);
        if (brakes && input.brake && g.t > 0) braked++;
        step(g, STEP, brakes ? input : { steer: input.steer });
        if (!brakes) flatOut += g.events.filter(e => e.type === "crash" && e.kind === "wall").length;
        g.events = [];
      }
    }
  }
  assert.ok(flatOut > 0, "flat out, a bend or two ends in the barrier");
  assert.ok(braked > 120, "the AI brakes for the bends");
});

/**
 * A keyboard player: full lock or nothing, reacting 0.15 s late to where they are and how they're drifting,
 * steering for the AI's line (it dodges), braking only once they feel themselves sliding at the edge.
 */
function keys(g, mem) {
  const p = g.p;
  autopilot(g);
  mem.q.push({ x: p.x, lat: p.lat ?? 0, want: p.lineX });
  const seen = mem.q.length > Math.round(0.15 / STEP) ? mem.q.shift() : mem.q[0];
  const need = clamp((seen.want - seen.x) * 0.8, -1, 1) * PHYSICS.steer - seen.lat;
  const steer = (mem.last = need > 1.5 ? 1 : need < -1.5 ? -1 : Math.abs(need) > 0.5 ? mem.last ?? 0 : 0);
  const edge = Math.abs(seen.x) > ROAD - 2.5 && Math.sign(seen.lat) === Math.sign(seen.x) && Math.abs(seen.lat) > 1;
  return { steer, brake: edge };
}

test("a keyboard player (on or off, a beat late, no anticipation) isn't thrown into the wall: every class, every district", () => {
  const crashes = [];
  for (const district of DISTRICT_IDS) {
    for (const difficulty of [1, 2, 3]) {
      const track = buildTrack({ district, kind: "sprint", difficulty, seed: 11 + difficulty, length: 4000 });
      for (const cls of CLASS_IDS) {
        const g = newRace(track, { cls, pack: 0, traffic: false, config: NO_HEAT });
        const mem = { q: [] };
        while (!g.finished && g.t < 400) {
          step(g, STEP, keys(g, mem));
          for (const e of g.events) if (e.type === "crash" && e.kind === "wall") crashes.push(`${district} d${difficulty} ${cls} at ${Math.round(g.p.total)} m`);
          g.events = [];
        }
        assert.ok(g.finished, `${district} d${difficulty} ${cls}: didn't finish`);
      }
    }
  }
  assert.ok(crashes.length <= 2, crashes.join(", "));
});

test("sprints never double back: they gain ground the same way all along and never cross themselves", () => {
  for (const district of DISTRICT_IDS) {
    for (const difficulty of [1, 2, 3]) {
      for (const seed of [2, 77, 1234, 98765]) {
        const t = buildTrack({ district, kind: "sprint", difficulty, seed, length: 14000 });
        for (let i = 1; i < t.map.length; i++) assert.ok(t.map[i][1] > t.map[i - 1][1], `${district} d${difficulty} ${seed}: turned back at ${i * SEG} m`);
        assert.deepEqual(crossings(t.map, false), []);
      }
    }
  }
});

test("the GM's layouts: drawn through control points, kept in the spec, built to match them, no sharper than the difficulty allows", () => {
  const ring = Array.from({ length: 12 }, (_, i) => [Math.round(Math.sin((i / 12) * Math.PI * 2) * 500), Math.round(Math.cos((i / 12) * Math.PI * 2) * 400)]);
  const spec = trackSpec({ kind: "circuit", district: "corpo", difficulty: 2, seed: 5, points: ring });
  assert.deepEqual(spec.points, ring);
  assert.equal(trackSpec({ kind: "circuit", points: [[0, 0], [1, 1]] }).points, undefined, "too few points");
  assert.equal(trackSpec({ kind: "circuit", points: [[0, 0], [1, 1], [2, "x"], [3, 3]] }).points, undefined, "not numbers");
  const t = buildTrack(spec);
  const around = ring.reduce((sum, p, i) => sum + Math.hypot(ring[(i + 1) % 12][0] - p[0], ring[(i + 1) % 12][1] - p[1]), 0);
  assert.ok(Math.abs(t.len - around) / around < 0.05, `a lap of ${t.len} m round ${around.toFixed(0)} m of points`);
  const map = placedMap(t);
  for (const [x, y] of ring) assert.ok(Math.min(...map.map(q => Math.hypot(q[0] - x, q[1] - y))) < 25, `passes ${x}, ${y}`);
  assert.ok(Math.max(...t.segs.map(s => Math.abs(s.k))) <= kmaxOf(spec) + 1e-9);
  // A hairpin too sharp for Easy is eased out.
  const tight = buildTrack({ kind: "sprint", difficulty: 1, seed: 3, points: [[0, 0], [0, 600], [40, 650], [80, 600], [80, 0]] });
  assert.ok(tight.eased.length > 0);
  assert.ok(Math.max(...tight.segs.map(s => Math.abs(s.k))) <= kmaxOf(tight.spec) + 1e-9);
  // Editing starts from the generated layout, and comes out about the same.
  for (const kind of ["circuit", "sprint"]) {
    const gen = buildTrack({ kind, district: "badlands", seed: 44, difficulty: 2 });
    const again = buildTrack({ ...gen.spec, points: pointsFrom(gen) });
    assert.ok(Math.abs(again.len - gen.len) / gen.len < 0.06, `${kind}: ${gen.len} → ${again.len}`);
  }
  // A figure of eight crosses itself.
  assert.equal(crossings(placedMap(buildTrack({ kind: "circuit", difficulty: 3, seed: 1, points: [[0, 0], [300, 300], [600, 0], [300, -300], [0, 300], [-300, 0]].map(([x, y]) => [x, y]) })), true).length > 0, true);
});

test("fighting: a bike's punches wreck a rival rider, who burns on the road for the rest of the race; cars can't punch; with fighting off nothing's hurt", () => {
  const t = buildTrack({ district: "badlands", kind: "circuit", seed: 12, difficulty: 1 });
  const g = newRace(t, { cls: "roadbike", pack: 1, traffic: false, config: NO_HEAT });
  g.t = 1;
  const r = g.racers[0];
  r.c = CLASSES.roadbike;
  Object.assign(r, { total: 400, x: 2, v: 30 });
  Object.assign(g.p, { total: 400, x: 0, v: 30 });
  for (let i = 0; i < 8 && !r.out; i++) {
    r.total = g.p.total;
    r.x = g.p.x + 2;
    step(g, STEP, { punch: 1 });
    g.p.punch = 0;
  }
  assert.ok(r.out, "knocked off");
  assert.equal(g.wrecks, 1);
  assert.equal(g.fires.length, 1);
  assert.ok(g.events.some(e => e.type === "wrecked" && e.id === r.id));

  const car = newRace(t, { cls: "sport", pack: 1, traffic: false, config: NO_HEAT });
  car.t = 1;
  const r2 = car.racers[0];
  Object.assign(r2, { total: 400, x: 2, v: 30 });
  Object.assign(car.p, { total: 400, x: 0, v: 30 });
  step(car, STEP, { punch: 1 });
  assert.equal(r2.hp, 100, "a car doesn't punch");

  const calm = newRace(t, { cls: "roadbike", pack: 1, traffic: false, config: { ...NO_HEAT, fighting: false } });
  calm.t = 1;
  const r3 = calm.racers[0];
  Object.assign(r3, { total: 400, x: 1, v: 30 });
  Object.assign(calm.p, { total: 400, x: 0, v: 30 });
  step(calm, STEP, { punch: 1, steer: 1 });
  assert.equal(r3.hp, 100);
  assert.equal(calm.p.hp, 100);
});

test("Heat: ramming civilians and crashing checkpoints bring NCPD after you; it cools off; the GM can switch it off", () => {
  const t = buildTrack({ district: "corpo", kind: "circuit", seed: 4, difficulty: 1 });
  const g = newRace(t, { cls: "compact", pack: 0, traffic: true, config: configOf() });
  g.t = 1;
  const car = g.traffic.find(x => x.kind === "car" || x.kind === "taxi");
  assert.ok(car);
  g.p.v = 30;
  for (let i = 0; i < 4; i++) {
    Object.assign(car, { total: g.p.total, x: g.p.x + 1.3, vx: 0, out: false });
    Object.assign(g.p, { bumps: {}, vx: 0 });
    step(g, STEP, { steer: 1 });
  }
  assert.ok(g.heat >= 2, `heat ${g.heat}`);
  step(g, STEP, {});
  assert.ok(g.traffic.some(x => x.kind === "cop" && !x.out), "a cruiser joins");
  g.heatT = 21;
  const before = g.heat;
  step(g, STEP, {});
  assert.equal(g.heat, before - 1, "cools off");

  const off = newRace(t, { cls: "compact", pack: 0, traffic: true, config: { ...configOf(), heat: false } });
  off.t = 1;
  const car2 = off.traffic.find(x => x.kind === "car" || x.kind === "taxi");
  off.p.v = 30;
  for (let i = 0; i < 4; i++) {
    Object.assign(car2, { total: off.p.total, x: off.p.x + 1.3, vx: 0, out: false });
    Object.assign(off.p, { bumps: {}, vx: 0 });
    step(off, STEP, { steer: 1 });
  }
  assert.equal(off.heat, 0);
});

test("a ganger's swing shows first: it misses if you get out of reach, lands if you don't, and a punch in the windup spoils it", () => {
  const t = buildTrack({ district: "combat", kind: "circuit", seed: 12, difficulty: 1 });
  const setup = () => {
    const g = newRace(t, { cls: "roadbike", pack: 0, traffic: false, config: NO_HEAT });
    g.t = 1;
    Object.assign(g.p, { total: 400, x: 0, v: 30 });
    g.traffic.push({ id: "gx", kind: "gang", total: 400, x: 1.8, v: 30, cruise: 30, vx: 0, lat: 0, hp: 40, w: 0.9, len: 2.2, lane: 1.8, atk: null, atkCool: 0 });
    return [g, g.traffic[0]];
  };
  const run = (g, secs, input = () => ({})) => {
    const seen = [];
    for (let i = 0; i < secs / STEP; i++) {
      step(g, STEP, input(g));
      seen.push(...g.events.map(e => e.type));
      g.events = [];
    }
    return seen;
  };
  // Stay beside them: the windup, then it lands.
  let [g, ganger] = setup();
  let seen = run(g, 0.05);
  assert.ok(seen.includes("windup"));
  assert.equal(ganger.atk.phase, "wind");
  const hp = g.p.hp;
  seen = run(g, PHYSICS.windup + 0.1, gg => ({ steer: (gg.traffic[0].x - 1.8 - gg.p.x) * 2 }));
  assert.ok(seen.includes("punched"));
  assert.ok(g.p.hp < hp);
  // Get out of reach in the windup: it misses.
  [g] = setup();
  run(g, 0.05);
  seen = run(g, PHYSICS.windup + 0.1, () => ({ steer: -1 }));
  assert.ok(seen.includes("dodged"), seen.join());
  assert.equal(g.p.hp, 100);
  // Punch them in the windup: it's spoiled.
  [g, ganger] = setup();
  run(g, 0.05);
  step(g, STEP, { punch: 1 });
  assert.equal(ganger.atk, null);
  assert.ok(ganger.hp < 40);
});

test("rams shove the other ride across smoothly (no jump), harder the faster you closed", () => {
  const t = buildTrack({ district: "corpo", kind: "circuit", seed: 4, difficulty: 1 });
  const shove = steer => {
    const g = newRace(t, { cls: "sport", pack: 0, traffic: false, config: NO_HEAT });
    g.t = 1;
    g.traffic.push({ id: "tx", kind: "car", total: 500, x: 1.45, v: 40, cruise: 40, vx: 0, lat: 0, hp: 60, w: 1.9, len: 4.3, lane: 1.45, atk: null });
    const car = g.traffic[0];
    Object.assign(g.p, { total: 500, x: 0, v: 40 });
    step(g, STEP, { steer });
    const first = car.x - 1.45;
    let later = first;
    for (let i = 0; i < 60; i++) {
      step(g, STEP, { steer: 0 });
      car.total = g.p.total + 20;
      later = Math.max(later, car.x - 1.45);
    }
    return { first, later };
  };
  const soft = shove(0);
  const hard = shove(1);
  assert.ok(hard.first < 0.4, `moved ${hard.first.toFixed(2)} m in one step`);
  assert.ok(hard.later > soft.later + 0.3, `rammed ${hard.later.toFixed(2)} m, brushed ${soft.later.toFixed(2)} m`);
});

test("a street race draws Heat by itself: a star a lap, or at 30% and 65% of a sprint, and it won't cool below that", () => {
  const circuit = buildTrack({ district: "corpo", kind: "circuit", seed: 4, difficulty: 1, laps: 3 });
  const g = newRace(circuit, { pack: 0, traffic: false, config: configOf() });
  while (lapOfTest(g) < 2) {
    step(g, STEP, autopilot(g));
    g.events = [];
  }
  for (let i = 0; i < 30; i++) step(g, STEP, autopilot(g));
  assert.ok(g.heat >= 1);
  g.heatT = 25;
  step(g, STEP, autopilot(g));
  assert.ok(g.heat >= 1, "not below what the race drew");
  const sprint = buildTrack({ district: "badlands", kind: "sprint", seed: 4, difficulty: 1 });
  const s = newRace(sprint, { pack: 0, traffic: false, config: configOf() });
  while (s.p.total < sprint.finish * 0.7) {
    step(s, STEP, autopilot(s));
    s.events = [];
  }
  assert.ok(s.heat >= 2 && s.traffic.some(x => x.kind === "cop"), "two stars by 65%, and a cruiser");
});

test("traffic: cars, box vans and semis (more of them on the highway), and they don't start on top of each other", () => {
  const g = newRace(buildTrack({ district: "badlands", kind: "sprint", seed: 6, difficulty: 2, length: 9000 }), { pack: 0 });
  const kinds = new Set(g.traffic.map(t => t.kind));
  assert.ok(kinds.has("semi") && kinds.has("van") && kinds.has("car"), [...kinds].join());
  assert.ok(g.traffic.filter(t => t.kind !== "truck").length > 30);
  for (const a of g.traffic) for (const b of g.traffic) if (a !== b && a.lane === b.lane) assert.ok(Math.abs(a.total - b.total) >= (a.len + b.len) / 2 || a.kind === "truck", `${a.id} on ${b.id}`);
});

const lapOfTest = g => Math.floor(Math.max(0, g.p.total) / g.track.len) + 1;

test("ghosts: a run kept as a few KB, back exactly enough to race; splits at your distance", () => {
  const track = buildTrack({ district: "pacifica", kind: "circuit", seed: 21, difficulty: 2, laps: 2 });
  const { g } = drive(track, { cls: "sport" });
  const kept = encodeGhost(g);
  const text = JSON.stringify(kept);
  assert.ok(text.length < 20000, `${text.length} bytes`);
  const gh = decodeGhost(JSON.parse(text), "YOU");
  assert.equal(gh.label, "YOU");
  assert.equal(gh.cls, "sport");
  assert.ok(Math.abs(gh.time - g.time) < 0.01);
  for (const at of [0.5, 10, 33.3, g.time - 1]) {
    const pos = ghostAt(gh, at);
    const i = Math.round(at * 10);
    assert.ok(Math.abs(pos.total - g.rec[Math.min(i, g.rec.length - 1)][0]) < 4, `at ${at}`);
  }
  assert.ok(Math.abs(ghostTimeAt(gh, 1000) - g.rec.findIndex(([d]) => d >= 1000) / 10) < 0.15);
  assert.equal(ghostTimeAt(gh, 1e9), null);
  assert.equal(decodeGhost({ v: 2 }), null);
  assert.equal(decodeGhost({ v: 1, d: [1, 2], x: [1] }), null);
  // Racing your own ghost exactly: level all the way.
  const again = newRace(track, { cls: "sport", pack: 0, traffic: false, config: NO_HEAT, ghosts: [gh] });
  let worst = 0;
  while (!again.finished) {
    step(again, STEP, autopilot(again));
    const d = deltaTo(again, gh);
    if (d !== null) worst = Math.max(worst, Math.abs(d));
    again.events = [];
  }
  assert.ok(worst < 0.2, `split drifted ${worst}`);
  assert.ok(position(again) <= 2);
});

test("the board: each character's best time and best lap; ranks; believable times only", () => {
  let runs = [];
  runs = addRun(runs, { actorId: "a", total: 100000, lap: 33000, ts: 1 });
  runs = addRun(runs, { actorId: "b", total: 95000, lap: 34000, ts: 2 });
  runs = addRun(runs, { actorId: "a", total: 99000, lap: 33500, ts: 3 });
  runs = addRun(runs, { actorId: "a", total: 120000, lap: 32000, ts: 4 });
  assert.deepEqual(runs.map(r => [r.actorId, r.total, r.lap]), [["a", 99000, 32000], ["b", 95000, 34000]]);
  const top = topRuns(runs);
  assert.deepEqual(top.map(r => [r.rank, r.actorId, r.fastestLap]), [[1, "b", false], [2, "a", true]]);
  assert.equal(runRank(runs, "a", 98000), 2);
  assert.equal(runRank(runs, "a", 99500), 0, "not their best");
  assert.equal(runRank(runs, "c", 90000), 1);

  const track = buildTrack({ seed: 9, laps: 2 });
  const { g } = drive(track, { cls: "superbike" });
  const total = Math.round(g.time * 1000);
  const laps = g.laps.map(l => Math.round(l * 1000));
  assert.ok(plausible(track, { total, laps, samples: g.rec.length }));
  assert.ok(!plausible(track, { total: total / 3, laps: laps.map(l => l / 3) }), "faster than flat out");
  assert.ok(!plausible(track, { total, laps: laps.slice(0, 1) }), "a lap missing");
  assert.ok(!plausible(track, { total, laps, samples: 10 }), "a ghost that doesn't match");
});

test("fog of war: the sections you drive are revealed", () => {
  const track = buildTrack({ seed: 3 });
  const g = newRace(track, { pack: 0, traffic: false, config: NO_HEAT });
  while (g.t < 15) {
    step(g, STEP, autopilot(g));
    g.events = [];
  }
  const mask = seenMask(g.seen);
  assert.ok(seenHas(mask, 0) || seenHas(mask, 1));
  assert.ok(!seenHas(mask, 19), "not the far end yet");
});

test("the host keeps the board and the ghosts: your own character, a live track, believable times, your best; nominations; the GM wipes", async () => {
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
  await store._redlineLoad();
  assert.ok(folders.has("worlds/test-world/cpr-sam-agent/redline"), "the ghosts' folder");
  const spec = trackSpec({ id: "t1", name: "Test Loop", seed: 9, laps: 2, status: "live" });
  await game.settings.set("cpr-sam-agent", "redlineTracks", { tracks: [spec, { ...spec, id: "t2", status: "draft" }] });
  const track = buildTrack(spec);
  const { g } = drive(track, { cls: "sport" });
  const run = { actorId: "pcA", trackId: "t1", cls: "sport", total: Math.round(g.time * 1000), laps: g.laps.map(l => Math.round(l * 1000)), slot: 2, tag: "val", ghost: encodeGhost(g), seen: 0b111 };
  const board = () => game.settings.get("cpr-sam-agent", "redlineBoard")?.t1 ?? [];

  from(alice, "redline-result", { ...run, actorId: "pcB" });
  from(alice, "redline-result", { ...run, trackId: "t2" });
  from(alice, "redline-result", { ...run, total: 1000, laps: [500, 500] });
  await settle();
  assert.deepEqual(board(), [], "not your character, not a live track, not believable");
  from(alice, "redline-result", run);
  await settle();
  assert.deepEqual(board().map(r => [r.tag, r.who, r.total, r.slot]), [["VAL", "Valerie Solo", run.total, 2]]);
  const file = `worlds/test-world/cpr-sam-agent/${ghostFile("t1", "pcA")}`;
  assert.ok(files.has(file), "the ghost is a file");
  assert.equal(decodeGhost(JSON.parse(files.get(file))).samples.length, g.rec.length);
  assert.equal(store.apps.redlineSeen.pcA.t1, 0b111, "what they drove");
  const ghostTs = board()[0].ghost;

  const fastest = Math.min(...run.laps);
  const slower = run.laps.map(l => (l === fastest ? l - 10 : l + 5010));
  from(alice, "redline-result", { ...run, total: run.total + 5000, laps: slower, ghost: null });
  await settle();
  assert.equal(board()[0].total, run.total, "a slower run doesn't change the time…");
  assert.equal(board()[0].lap, fastest - 10, "…but a faster lap counts");
  assert.equal(board()[0].ghost, ghostTs, "…and the ghost stays the best run's");

  from(alice, "redline-seen", { actorId: "pcA", trackId: "t1", mask: 0b11000 });
  await settle();
  assert.equal(store.apps.redlineSeen.pcA.t1, 0b11111);

  from(alice, "redline-nominate", { actorId: "pcA", seed: 1234, district: "pacifica", length: 3000, difficulty: 2 });
  from(alice, "redline-nominate", { actorId: "pcA", seed: 1234, district: "pacifica", length: 3000, difficulty: 2 });
  await settle();
  const nominated = game.settings.get("cpr-sam-agent", "redlineTracks").nominated;
  assert.equal(nominated.length, 1, "once per course");
  assert.equal(nominated[0].by, "Valerie Solo");

  from(alice, "redline-wipe", { trackId: "t1" });
  await settle();
  assert.equal(board().length, 1, "only the GM wipes");
  from(gm, "redline-remove", { trackId: "t1", actorId: "pcA" });
  await settle();
  assert.deepEqual(board(), []);
  assert.equal(files.get(file), "{}", "its ghost emptied (the host can't delete files)");
});

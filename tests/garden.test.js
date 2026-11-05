import { addActor, addUser, actAs, reset } from "./foundry-stub.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { store } from "../scripts/store.js";
import { emptyApps } from "../scripts/model/apps.js";
import {
  avatarGender, emptyGarden, gardenAgo, gardenClockMode, gardenNow, gardenWhen, growth, LIST_FILES, parseList, postGrowth, postSettled, queueWhen, randomCitizen, replyTime,
  setGardenLists, shiftGarden, spanLabel, syncGardenClock, WORLD_PACE
} from "../apps/garden/model.js";

setGardenLists(Object.fromEntries(Object.entries(LIST_FILES).map(([key, [file]]) => [key, parseList(fs.readFileSync(new URL(`../data/garden/${file}.txt`, import.meta.url), "utf8"))])));

/*
 * The Garden clock (apps/garden/model.js, host.js): Garden time follows world time when the phones'
 * clock does (Simple Calendar or SmallTime), posts are backdated to when they were due, and growth
 * is whichever is further along, in-game age (× WORLD_PACE) or real minutes.
 */

const HOUR = 3600;
const DAY = 86400;

/**
 * A stand-in Simple Calendar: 12 months of 30 days, year 2045 from world time 0. Its dates read like
 * the real one's (display.monthName, day, year).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fakeSimpleCalendar() {
  game.modules.set("foundryvtt-simple-calendar", { active: true });
  globalThis.SimpleCalendar = {
    api: {
      timestamp: () => game.time.worldTime,
      timestampToDate(ts) {
        const days = Math.floor(ts / DAY);
        const s = ((ts % DAY) + DAY) % DAY;
        return {
          hour: Math.floor(s / HOUR), minute: Math.floor((s % HOUR) / 60),
          display: { monthName: MONTHS[Math.floor(days / 30) % 12], day: String((days % 30) + 1), year: String(2045 + Math.floor(days / 360)) }
        };
      }
    }
  };
}

let gm;
beforeEach(async () => {
  await store._writing;
  reset();
  game.modules.clear();
  delete globalThis.SimpleCalendar;
  gm = addUser({ id: "gm", isGM: true });
  addUser({ id: "alice" });
  actAs(gm);
  addActor({ id: "pcA", name: "V", owners: ["alice"] });
  Object.assign(store, {
    threads: new Map(), calls: new Map(), requests: new Map(), quests: new Map(), apps: emptyApps(), garden: emptyGarden(),
    loaded: true, loadFailed: false, gardenFailed: false, _written: new Map(), _writing: null
  });
  store._folders = store._ensureFolders();
  store._seedGarden();
});

afterEach(() => {
  game.modules.clear();
  delete globalThis.SimpleCalendar;
});

const account = handle => Object.values(store.garden.accounts).find(a => a.handle === handle);
const postBy = text => Object.values(store.garden.posts).find(p => p.text === text);

test("Garden now: world time with Simple Calendar or SmallTime, else the real clock", () => {
  assert.equal(gardenClockMode(), "real");
  assert.ok(Math.abs(gardenNow() - Date.now() / 1000) < 2);
  game.time.worldTime = 5000;
  game.modules.set("smalltime", { active: true });
  assert.equal(gardenClockMode(), "world");
  assert.equal(gardenNow(), 5000);
  game.modules.clear();
  fakeSimpleCalendar();
  assert.equal(gardenClockMode(), "world");
  // Control's clock set to System time or the GM's: real, even with Simple Calendar.
  game.settings.set("cpr-sam-agent", "clock", { source: "system" });
  assert.equal(gardenClockMode(), "real");
  game.settings.set("cpr-sam-agent", "clock", { source: "calendar" });
  assert.equal(gardenClockMode(), "world");
  // "Simple Calendar" with it switched off falls back to the real clock; SmallTime only counts on Automatic.
  game.modules.clear();
  game.modules.set("smalltime", { active: true });
  assert.equal(gardenClockMode(), "real");
});

test("growth: in-game age at ten times the peak, or real minutes, whichever is further", () => {
  const nowMs = Date.now();
  const post = { wt: 1000, ts: nowMs, eng: { peak: 5 } };
  assert.equal(postGrowth(post, 1000, nowMs), 0);
  // 50 in-game minutes = 5 real-minute equivalents: halfway.
  assert.ok(Math.abs(postGrowth(post, 1000 + 5 * WORLD_PACE * 60, nowMs) - growth(5, 5)) < 1e-9);
  // The clock stands still, real minutes go by: it grows anyway.
  assert.ok(Math.abs(postGrowth(post, 1000, nowMs + 5 * 60_000) - growth(5, 5)) < 1e-9);
  // Both: the further one.
  assert.equal(postGrowth(post, 1000 + 2 * WORLD_PACE * 60, nowMs + 8 * 60_000), growth(8, 5));
  // A day later in-game it's fully grown and settled, even though it went up a second ago.
  assert.equal(postGrowth(post, 1000 + DAY, nowMs + 1000), 1);
  assert.ok(postSettled(post, 1000 + DAY, nowMs + 30 * 60_000));
  assert.ok(!postSettled(post, 1000 + DAY, nowMs + 1000), "still live on real minutes");
});

test("replies a catch-up adds are spread over the post's life, never in the future", () => {
  const post = { wt: 0, eng: { peak: 5 } };
  const times = [0.1, 0.5, 0.9].map(f => replyTime(post, f, DAY));
  assert.ok(times[0] > 0 && times[0] < times[1] && times[1] < times[2] && times[2] < DAY);
  // The inverse of growth: halfway grown at the reply's time (in Garden time, WORLD_PACE times slower).
  assert.ok(Math.abs(growth(replyTime(post, 0.5, DAY) / 60 / WORLD_PACE, 5) - 0.5) < 1e-9);
  // The clock has barely moved: they're now.
  assert.equal(replyTime(post, 0.9, 120), 120);
});

test("labels: ago, in-world dates past a day, the year only when it differs, queue times", () => {
  fakeSimpleCalendar();
  const now = 400 * DAY + 10 * HOUR; // Feb 11, 2046, 10:00
  assert.equal(gardenAgo(now - 30, now), "now");
  assert.equal(gardenAgo(now - 40 * 60, now), "40m");
  assert.equal(gardenAgo(now - 3 * HOUR, now), "3h");
  assert.equal(gardenAgo(now - 2 * DAY, now), "Feb, Day 9, 10:00");
  // Across the year boundary: last year's posts say their year.
  assert.equal(gardenAgo(359 * DAY + 21 * HOUR + 40 * 60, now), "Dec, Day 30, 2045, 21:40");
  // Across a month boundary.
  assert.equal(gardenWhen(389 * DAY + 23 * HOUR, now), "Jan, Day 30, 23:00");
  assert.equal(gardenWhen(390 * DAY, now), "Feb, Day 1, 00:00");
  assert.equal(queueWhen(now + 3 * HOUR, now), "Feb, Day 11, 13:00 · in 3h");
  assert.equal(queueWhen(now + DAY + 90 * 60, now), "Feb, Day 12, 11:30 · in 1d 1h");
  assert.equal(queueWhen(now - 60, now), "Feb, Day 11, 09:59 · due");
  assert.equal(queueWhen(now + 60, now, now), "Feb, Day 11, 10:01 · paused");
  assert.equal(spanLabel(90 * 60), "1h 30m");
  // SmallTime (no dates): the day count.
  game.modules.clear();
  delete globalThis.SimpleCalendar;
  game.modules.set("smalltime", { active: true });
  assert.equal(gardenWhen(14 * DAY + 21 * HOUR + 40 * 60), "Day 14, 21:40");
});

test("migration: old posts, replies and queue get Garden times as old (or as far ahead) as they really are", () => {
  const nowMs = Date.now();
  const garden = {
    ...emptyGarden(), clock: undefined,
    posts: { p: { id: "p", ts: nowMs - 2 * HOUR * 1000, replies: [{ id: "r", ts: nowMs - HOUR * 1000 }] } },
    queue: [{ id: "q", at: nowMs + 10 * 60_000 }],
    paused: nowMs - 60_000
  };
  assert.equal(syncGardenClock(garden, "world", 50_000, nowMs), true);
  assert.equal(garden.posts.p.wt, 50_000 - 2 * HOUR);
  assert.equal(garden.posts.p.replies[0].wt, 50_000 - HOUR);
  assert.deepEqual(garden.queue[0], { id: "q", wt: 50_000 + 600 });
  assert.equal(garden.paused, 50_000 - 60);
  assert.deepEqual(garden.clock, { mode: "world", wt: 50_000, ts: nowMs });
  // Nothing more to do next time.
  assert.equal(syncGardenClock(garden, "world", 50_100, nowMs + 1000), false);
});

test("the clock changes mode: every time moves so the newest stays where it was", () => {
  const nowMs = Date.now();
  const garden = { ...emptyGarden(), posts: { p: { id: "p", ts: nowMs, wt: 9000, replies: [] } }, queue: [{ id: "q", wt: 9600 }] };
  syncGardenClock(garden, "world", 9000, nowMs);
  // Simple Calendar switched off an hour (real) later: the real clock takes over from world time 9000.
  const real = nowMs / 1000 + HOUR;
  assert.equal(syncGardenClock(garden, "real", real, nowMs + HOUR * 1000), true);
  assert.equal(garden.posts.p.wt, real);
  assert.equal(garden.queue[0].wt, real + 600);
  // And back: real time has run on 10 minutes since.
  syncGardenClock(garden, "world", 20_000, nowMs + HOUR * 1000 + 600_000);
  assert.ok(Math.abs(garden.posts.p.wt - (20_000 - 600)) < 1e-6);
  shiftGarden(garden, 100);
  assert.ok(Math.abs(garden.queue[0].wt - 20_100) < 1e-6);
});

test("world time: queued posts wait for the clock, then go out backdated, in order, fully grown", async () => {
  game.modules.set("smalltime", { active: true });
  game.time.worldTime = 10 * DAY;
  await store._tickGarden(); // the clock takes over (world)
  const n54 = account("@network54");
  await store._onGardenGmPost(gm, { accountId: n54.id, text: "first", delay: 60 });
  await store._onGardenGmPost(gm, { accountId: n54.id, text: "second", delay: 26 * 60 });
  store._onGardenDrip(gm, { lines: "@noodle_mae | third", every: 3 * 24 * 60, jitter: 0 });
  assert.equal(store.garden.queue.length, 3);
  // Real time passes, the clock stands still: nothing goes out.
  await store._tickGarden();
  assert.equal(Object.keys(store.garden.posts).length, 0);
  // "Two days later": the first two go out, dated when they were due.
  game.time.worldTime = 12 * DAY;
  await store._tickGarden();
  assert.equal(postBy("first").wt, 10 * DAY + HOUR);
  assert.equal(postBy("second").wt, 10 * DAY + 26 * HOUR);
  assert.equal(store.garden.queue.length, 1);
  // A day+ old in-game: fully grown at once, its citizen replies spread over its life.
  const first = postBy("first");
  assert.equal(first.likes, first.eng.likes);
  for (const r of first.replies) assert.ok(r.wt >= first.wt && r.wt <= 12 * DAY);
  // The drip's post: three days after the last queued one's time.
  assert.equal(store.garden.queue[0].wt, 10 * DAY + 26 * HOUR + 3 * DAY);
  // Time going backwards deletes nothing.
  game.time.worldTime = 11 * DAY;
  await store._tickGarden();
  assert.ok(postBy("first") && postBy("second"));
});

test("pause and resume in Garden time; post now isn't backdated; player posts are dated now", async () => {
  game.modules.set("smalltime", { active: true });
  game.time.worldTime = 1000;
  await store._tickGarden();
  const n54 = account("@network54");
  await store._onGardenGmPost(gm, { accountId: n54.id, text: "later", delay: 10 });
  await store._onGardenQueue(gm, { op: "pause" });
  game.time.worldTime = 1000 + HOUR;
  await store._tickGarden();
  assert.equal(store.garden.queue.length, 1, "paused: stays");
  await store._onGardenQueue(gm, { op: "resume" });
  assert.equal(store.garden.queue[0].wt, 1000 + HOUR + 600);
  await store._onGardenQueue(gm, { op: "now", id: store.garden.queue[0].id });
  assert.equal(postBy("later").wt, 1000 + HOUR);
  // An edit's minutes are in-game minutes from now.
  await store._onGardenGmPost(gm, { accountId: n54.id, text: "edit me", delay: 5 });
  const item = store.garden.queue[0];
  await store._onGardenQueue(gm, { op: "edit", id: item.id, item: { accountId: n54.id, text: "edited", minutes: 90 } });
  assert.equal(store.garden.queue[0].wt, 1000 + HOUR + 90 * 60);
});

/* Random citizens: the first name matches the picture's gender. */

const pool = n => `assets/garden-avatars/citizens/${String(n).padStart(2, "0")}.webp`;

test("avatarGender: the module's citizen pool by file number, null for anything else", () => {
  for (let n = 1; n <= 40; n++) {
    const want = n <= 20 || (n >= 37 && n <= 39) ? "f" : "m";
    assert.equal(avatarGender(pool(n)), want, `citizens/${n}`);
  }
  assert.equal(avatarGender(`/modules/x/${pool(5)}`), "f", "any prefix");
  assert.equal(avatarGender(pool(41)), null);
  assert.equal(avatarGender("worlds/w/pics/05.webp"), null, "the GM's own folder");
  assert.equal(avatarGender(null), null);
});

test("randomCitizen: the first name comes from the list matching the pool picture's gender", () => {
  const lists = { firstNames: ["Any"], firstNamesF: ["Fa", "Fb"], firstNamesM: ["Ma", "Mb"], lastNames: ["Z"] };
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const c = randomCitizen([pool(3), pool(30), pool(38), pool(40)], rand, lists);
    const first = c.name.split(" ")[0];
    const g = avatarGender(c.avatar);
    assert.ok((g === "f" ? lists.firstNamesF : lists.firstNamesM).includes(first), `${c.avatar} → ${c.name}`);
  }
});

test("randomCitizen: unknown pictures, an empty gendered list, or no pictures use the combined list", () => {
  const lists = { firstNames: ["Any"], firstNamesF: ["Fa"], firstNamesM: [], lastNames: ["Z"] };
  assert.equal(randomCitizen(["worlds/w/a.webp"], Math.random, lists).name, "Any Z");
  assert.equal(randomCitizen([pool(30)], Math.random, lists).name, "Any Z", "male list empty");
  assert.equal(randomCitizen([], Math.random, lists).name, "Any Z");
  assert.equal(randomCitizen([pool(1)], Math.random, lists).name, "Fa Z");
});

test("the shipped gendered name lists are real, disjoint, and drawn from the combined list", () => {
  const read = f => parseList(fs.readFileSync(new URL(`../data/garden/${f}.txt`, import.meta.url), "utf8"));
  const [all, f, m] = [read("first-names"), read("first-names-female"), read("first-names-male")];
  assert.ok(f.length > 20 && m.length > 20);
  assert.deepEqual(f.filter(n => m.includes(n)), []);
  assert.deepEqual([...f, ...m].filter(n => !all.includes(n)), []);
});

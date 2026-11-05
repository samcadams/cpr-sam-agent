import { test } from "node:test";
import assert from "node:assert/strict";

import { BUDGET, budgets, canWatch, derived, emptyBuild, gladiatorProblems, isExplosive, skillPoints } from "../apps/gladiator/model.js";
import { BACKLOG, fighterSpots, newEvents } from "../apps/gladiator/draw.js";
import { BANDS, brawlDamage, checkDie, legalMoves, newBattle, resolveMove, START_BAND, woundState } from "../apps/gladiator/battle.js";

/*
 * Digital Gladiator: the Complete Package build rules (apps/gladiator/model.js) and the CPR-lite duel
 * (apps/gladiator/battle.js), with scripted dice.
 */

const BASIC = ["Athletics", "Brawling", "Concentration", "Conversation", "Education", "Evasion", "First Aid", "Human Perception",
  "Language (Streetslang)", "Local Expert (Your Home)", "Perception", "Persuasion", "Stealth"];
const SKILLS = [...BASIC.map(name => ({ name, basic: true })), { name: "Handgun" }, { name: "Melee Weapon" }, { name: "Shoulder Arms" },
  { name: "Autofire", x2: true }, { name: "Martial Arts", x2: true }];

const pistol = { uuid: "w1", name: "Heavy Pistol", kind: "weapon", price: 100, qty: 1,
  weapon: { skill: "Handgun", damage: "3d6", rof: 2, magazine: 8, dv: "DV Pistol", autofire: 0, ranged: true, type: "heavyPistol", ammo: "heavyPistol" } };
const sword = { uuid: "w2", name: "Sword", kind: "weapon", price: 100, qty: 1, weapon: { skill: "Melee Weapon", damage: "3d6", rof: 2, ranged: false, type: "heavyMelee" } };
const smg = { uuid: "w3", name: "SMG", kind: "weapon", price: 100, qty: 1,
  weapon: { skill: "Handgun", damage: "2d6", rof: 1, magazine: 30, dv: "DV SMG", autofire: 3, ranged: true, type: "smg", ammo: "medPistol" } };
const shotgun = { uuid: "w4", name: "Shotgun", kind: "weapon", price: 500, qty: 1,
  weapon: { skill: "Shoulder Arms", damage: "5d6", rof: 1, magazine: 4, dv: "DV Shotgun (Slug)", ranged: true, type: "shotgun", ammo: "slug" } };
const jacket = { uuid: "a1", name: "Light Armorjack (Body)", kind: "armor", price: 100, qty: 1, armor: { body: 11, head: 0, penalty: 0 } };
const helmet = { uuid: "a2", name: "Light Armorjack (Head)", kind: "armor", price: 100, qty: 1, armor: { body: 0, head: 11, penalty: 0 } };
const ammo = { uuid: "m1", name: "Basic Heavy Pistol Ammo", kind: "ammo", price: 10, qty: 2, ammo: { type: "heavyPistol", rounds: 10 } };
const speedheal = { uuid: "i1", name: "Speedheal", kind: "item", price: 100, qty: 1, effect: "speedheal" };

const DV = { "DV Pistol": [13, 15, 20, 25], "DV SMG": [15, 13, 15, 20], "DV SMG (Autofire)": [20, 17, 20, 25], "DV Shotgun (Slug)": [13, 15, 20, 25] };

function legal(actorId = "pcA", over = {}) {
  const b = emptyBuild(actorId);
  b.name = actorId === "pcA" ? "Razor" : "Bolt";
  Object.assign(b.stats, { int: 5, ref: 8, dex: 7, tech: 5, cool: 6, will: 6, luck: 6, move: 6, body: 7, emp: 6 });
  for (const s of BASIC) b.skills[s] = 2;
  Object.assign(b.skills, { Evasion: 6, Brawling: 4, Handgun: 6, "Melee Weapon": 6, Autofire: 4 });
  b.awareness.precision = 1;
  b.awareness.initiative = 1;
  b.gear = [pistol, jacket, ammo];
  return { ...b, ...over };
}

/** Scripted dice: [face, sides] pairs, one per die the engine rolls, in order. */
const exact = faces => {
  const queue = [...faces];
  return () => {
    if (!queue.length) throw new Error("ran out of scripted dice");
    const [face, sides] = queue.shift();
    return (face - 0.5) / sides;
  };
};
const d10 = f => [f, 10];
const d6 = f => [f, 6];

/** A duel where pcA (REF 8 + Initiative 1) goes first. */
const battle = (a = legal("pcA"), b = legal("pcB")) => newBattle({ a, b, dv: DV, rng: exact([d10(9), d10(1)]) });

test("a legal Complete Package build has no problems, and its derived numbers are the book's", () => {
  const b = legal();
  assert.deepEqual(gladiatorProblems(b, SKILLS), []);
  // BODY 7 + WILL 6 = 13 → ceil 6.5 = 7 → 10 + 35
  assert.deepEqual(derived(b), { hp: 45, serious: 23, deathSave: 7, humanity: 60 });
  assert.equal(budgets(b, SKILLS).eb, BUDGET - 220);
});

test("the build rules: STATs, skills, Combat Awareness, gear, Humanity", () => {
  const problems = over => gladiatorProblems({ ...legal(), ...over }, SKILLS);
  assert.match(problems({ name: " " }).join(), /name/);
  assert.match(problems({ stats: { ...legal().stats, ref: 9 } }).join(), /REF must be 2 to 8/);
  assert.match(problems({ stats: { ...legal().stats, int: 8, tech: 8 } }).join(), /68 STAT points/);
  assert.match(problems({ skills: { ...legal().skills, Stealth: 1 } }).join(), /Stealth must be at least 2/);
  assert.match(problems({ skills: { ...legal().skills, Handgun: 7 } }).join(), /Handgun can't be above 6/);
  assert.match(problems({ skills: { ...legal().skills, Bogus: 1 } }).join(), /Unknown skill/);
  assert.match(problems({ awareness: { ...legal().awareness, precision: 2 } }).join(), /7 Combat Awareness points/);
  assert.match(problems({ gear: [{ name: "Frag Grenade", kind: "item", price: 50, qty: 1 }] }).join(), /No explosives: Frag Grenade/);
  assert.match(problems({ gear: [{ ...pistol, price: 2600 }] }).join(), /budget is 2550eb/);
  assert.match(problems({ gear: [jacket, { ...jacket, uuid: "x" }] }).join(), /Only one body armor/);
  assert.match(problems({ gear: [{ name: "Cyberarm", kind: "cyberware", price: 500, qty: 1, humanity: 60 }] }).join(), /Humanity must stay above 0/);
});

test("(x2) skills cost two points a level; explosives are spotted by type and name", () => {
  assert.equal(skillPoints({ skills: { Autofire: 3, Handgun: 3 } }, SKILLS), 9);
  assert.ok(isExplosive({ name: "Grenade Launcher", weapon: { type: "grenadeLauncher" } }));
  assert.ok(isExplosive({ name: "Basic Rocket" }));
  assert.ok(!isExplosive(pistol));
});

test("check dice: 10 explodes, 1 subtracts unless Fumble Recovery", () => {
  assert.equal(checkDie(exact([d10(10), d10(4)])).total, 14);
  assert.equal(checkDie(exact([d10(1), d10(6)])).total, -5);
  assert.equal(checkDie(exact([d10(1)]), true).total, 1);
  assert.equal(brawlDamage(4), "1d6");
  assert.equal(brawlDamage(7), "3d6");
});

test("a new duel starts at Far, with initiative deciding who moves first", () => {
  const s = battle();
  assert.equal(s.band, START_BAND);
  assert.deepEqual(s.order, ["pcA", "pcB"]);
  assert.equal(s.turn, "pcA");
  assert.equal(s.fighters.pcA.hp, 45);
  assert.equal(s.fighters.pcA.mags.g0, 8);
  assert.equal(s.fighters.pcA.ammo.heavyPistol, 20);
  assert.deepEqual(s.fighters.pcA.sp, { body: 11, head: 0 });
});

test("legal moves: melee needs Close range, an empty gun can't shoot, only the fighter whose turn it is moves", () => {
  const s = battle();
  const ids = legalMoves(s, "pcA").map(m => m.id);
  assert.ok(ids.includes("shoot:g0") && ids.includes("aim:g0") && ids.includes("move:in") && ids.includes("move:out") && ids.includes("dodge"));
  assert.equal(legalMoves(s, "pcA").find(m => m.id === "melee:brawl").disabled, true);
  assert.deepEqual(legalMoves(s, "pcB"), []);
  s.fighters.pcA.mags.g0 = 0;
  assert.equal(legalMoves(s, "pcA").find(m => m.id === "shoot:g0").why, "Empty: reload.");
  assert.equal(resolveMove(s, "pcB", "move:in", exact([])).error, "Not your turn.");
});

test("a pistol shot: REF + Handgun + Precision + d10 vs the DV at Far; damage through SP ablates it", () => {
  const s = battle();
  // ROF 2: two shots. Shot 1: 8 + 6 + 1 + 9 = 24 vs DV 20, damage 6+6+3 = 15, no Spot Weakness, SP 11 → 4 through, a crit (+5).
  // Shot 2: 8 + 6 + 1 + 2 = 17 vs 20: miss.
  const { state } = resolveMove(s, "pcA", "shoot:g0", exact([d10(9), d6(6), d6(6), d6(3), d10(2)]));
  const b = state.fighters.pcB;
  assert.equal(b.hp, 45 - 4 - 5);
  assert.equal(b.sp.body, 10);
  assert.equal(state.fighters.pcA.mags.g0, 6);
  assert.equal(state.turn, "pcB");
  assert.deepEqual(state.log.slice(-3).map(e => e.kind), ["shot", "crit", "miss"]);
  assert.equal(s.fighters.pcB.hp, 45, "the old state is untouched");
});

test("melee weapons ignore half the SP (rounded up); Spot Weakness adds to the first hit of a round", () => {
  const s = battle(legal("pcA", { gear: [sword, jacket], awareness: { spot: 1, precision: 1, initiative: 0 } }));
  s.band = 0;
  // Sword: DEX 7 + 6 + 1 + 5 = 19 vs pcB's DEX 7 + Evasion 6 + 2 = 15: hit; 3d6 = 4+4+4 = 12 + Spot 1 = 13 - floor(11/2) 5 = 8.
  // Second blow: 19 vs 15 again; 12 (no Spot this round) - floor(10/2) 5 = 7.
  const { state } = resolveMove(s, "pcA", "melee:g0", exact([d10(5), d10(2), d6(4), d6(4), d6(4), d10(5), d10(2), d6(4), d6(4), d6(4)]));
  assert.equal(state.fighters.pcB.hp, 45 - 8 - 7);
  assert.equal(state.fighters.pcB.sp.body, 9);
});

test("an aimed head shot takes -8 and doubles what gets through head armor", () => {
  const s = battle(undefined, legal("pcB", { gear: [pistol, jacket, helmet] }));
  // 8 + 6 + 1 + 10 + 3 - 8 = 20 vs DV 20 at Far: miss (must beat the DV). Move in to Near (DV 15) first.
  s.band = 1;
  const { state } = resolveMove(s, "pcA", "aim:g0", exact([d10(10), d10(3), d6(5), d6(5), d6(5)]));
  // 15 - 11 = 4 through, x2 = 8; head SP 11 → 10.
  assert.equal(state.fighters.pcB.hp, 45 - 8);
  assert.equal(state.fighters.pcB.sp.head, 10);
  assert.equal(state.fighters.pcA.mags.g0, 7);
});

test("dodging (REF 8+) uses DEX + Evasion + d10 against ranged attacks when it's higher than the DV", () => {
  const s = battle();
  s.fighters.pcB.dodge = true;
  // 8 + 6 + 1 + 9 = 24 vs dodge 7 + 6 + 10 + 5 = 28: miss; second shot 24 vs 7 + 6 + 3 = 16 → DV 20 (higher): hit.
  const { state } = resolveMove(s, "pcA", "shoot:g0", exact([d10(9), d10(10), d10(5), d10(9), d10(3), d6(4), d6(4), d6(4)]));
  assert.deepEqual(state.log.filter(e => e.kind === "miss" || e.kind === "shot").map(e => e.kind), ["miss", "shot"]);
  assert.equal(state.fighters.pcB.hp, 45 - 1);
});

test("autofire: 2d6 x the margin over the DV, capped at the weapon's multiplier, 10 rounds", () => {
  const s = battle(legal("pcA", { gear: [smg, jacket] }));
  s.band = 1;
  // REF 8 + Autofire 4 + 1 + 9 = 22 vs 17 → margin 5, capped 3: (5+5) x 3 = 30 - 11 = 19.
  const { state } = resolveMove(s, "pcA", "auto:g0", exact([d10(9), d6(5), d6(5)]));
  assert.equal(state.fighters.pcB.hp, 45 - 19);
  assert.equal(state.fighters.pcA.mags.g0, 20);
});

test("Damage Deflection takes the edge off the first damage each round", () => {
  const s = battle(undefined, legal("pcB", { awareness: { deflection: 2, precision: 0, initiative: 0 } }));
  // Hit for 6+6+3=15 - 11 = 4, crit +5; deflection 2 off the 4 → 2 + 5 = 7. Second shot hits for 4+4+4 = 12 - 10 = 2, no deflection.
  const { state } = resolveMove(s, "pcA", "shoot:g0", exact([d10(9), d6(6), d6(6), d6(3), d10(9), d6(4), d6(4), d6(4)]));
  assert.equal(state.fighters.pcB.hp, 45 - 7 - 2);
});

test("below 1 HP: Mortally Wounded, a Death Save each turn; a failed save or another hit ends it", () => {
  let s = battle();
  s.fighters.pcB.hp = 3;
  ({ state: s } = resolveMove(s, "pcA", "shoot:g0", exact([d10(9), d6(6), d6(5), d6(4), d10(1), d10(1), d10(3)])));
  // pcB is Mortally Wounded; on their turn they roll a Death Save: 3 < BODY 7: they hold on.
  assert.equal(woundState(s.fighters.pcB), "mortal");
  assert.equal(s.turn, "pcB");
  assert.equal(s.over, false);
  ({ state: s } = resolveMove(s, "pcB", "move:in", exact([])));
  // pcA shoots again: any damage finishes them.
  ({ state: s } = resolveMove(s, "pcA", "shoot:g0", exact([d10(9), d6(6), d6(5), d6(4)])));
  assert.equal(s.over, true);
  assert.equal(s.winner, "pcA");
  assert.equal(s.loser, "pcB");
  assert.equal(s.how, "kill");
});

test("a failed Death Save ends the duel at the start of the fighter's turn", () => {
  let s = battle();
  s.fighters.pcB.mortal = true;
  s.fighters.pcB.hp = 0;
  ({ state: s } = resolveMove(s, "pcA", "move:in", exact([d10(8)])));
  assert.equal(s.over, true);
  assert.equal(s.winner, "pcA");
});

test("moving changes the band; reload refills from spare ammo; Speedheal heals BODY + WILL once", () => {
  let s = battle(legal("pcA", { gear: [pistol, jacket, ammo, speedheal] }));
  ({ state: s } = resolveMove(s, "pcA", "move:in", exact([])));
  assert.equal(s.band, START_BAND - 1);
  assert.equal(s.log.at(-1).text.includes(BANDS[1].label), true);
  ({ state: s } = resolveMove(s, "pcB", "move:out", exact([])));
  s.fighters.pcA.mags.g0 = 3;
  ({ state: s } = resolveMove(s, "pcA", "reload:g0", exact([])));
  assert.equal(s.fighters.pcA.mags.g0, 8);
  assert.equal(s.fighters.pcA.ammo.heavyPistol, 15);
  ({ state: s } = resolveMove(s, "pcB", "move:in", exact([])));
  s.fighters.pcA.hp = 10;
  ({ state: s } = resolveMove(s, "pcA", "item:speedheal", exact([])));
  assert.equal(s.fighters.pcA.hp, 23);
  assert.ok(!legalMoves(s, "pcA").some(m => m.id === "item:speedheal"));
});

test("either side can concede at any time; a finished duel takes no more moves", () => {
  const { state } = resolveMove(battle(), "pcB", "concede", exact([]));
  assert.equal(state.winner, "pcA");
  assert.equal(state.how, "concede");
  assert.equal(resolveMove(state, "pcA", "move:in", exact([])).error, "The match is over.");
});

test("shotguns can't aim; out-of-range weapons are disabled", () => {
  const s = battle(legal("pcA", { gear: [shotgun, jacket] }));
  const ids = legalMoves(s, "pcA").map(m => m.id);
  assert.ok(ids.includes("shoot:g0") && !ids.includes("aim:g0"));
  s.dv["DV Shotgun (Slug)"] = [13, 15, null, 25];
  assert.equal(legalMoves(s, "pcA").find(m => m.id === "shoot:g0").why, "Out of range.");
});

test("a nearby character can watch a duel: their token within 20 m/yd of either duelist's, on the same scene", () => {
  const scene = (...tokens) => ({ grid: { size: 100, distance: 2 }, tokens: tokens.map(([actorId, x]) => ({ actorId, x, y: 0 })) });
  const watch = s => canWatch({ watcher: "pcC", duelists: ["pcA", "pcB"], scene: s });
  assert.equal(watch(scene(["pcA", 0], ["pcB", 3000], ["pcC", 2000])), true, "10 squares (20 m) from pcB");
  assert.equal(watch(scene(["pcA", 0], ["pcB", 500], ["pcC", 1600])), false, "11 squares from the nearest");
  assert.equal(watch(scene(["pcC", 0])), false, "the duelists are on another scene");
  assert.equal(watch(scene(["pcA", 0], ["pcB", 100])), false, "no token of their own");
});

/* The arena (apps/gladiator/draw.js) */

test("arena: the viewer stands lower left, the other upper right, further apart the longer the range", () => {
  let last = 0;
  for (let band = 0; band < BANDS.length; band++) {
    const { me, foe } = fighterSpots(band, 320, 180);
    assert.ok(me.x < 160 && foe.x > 160, `band ${band}: left and right`);
    assert.ok(me.y > foe.y, `band ${band}: the viewer is lower`);
    assert.ok(me.x > 0 && foe.x < 320 && foe.y > 0 && me.y <= 180, `band ${band}: on the canvas`);
    const gap = foe.x - me.x;
    assert.ok(gap > last, `band ${band}: further apart than the band before`);
    last = gap;
  }
  const mid = fighterSpots(1.5, 320, 180);
  assert.ok(mid.foe.x - mid.me.x > fighterSpots(1).foe.x - fighterSpots(1).me.x, "a move slides between bands");
});

test("arena: only events newer than the last one drawn animate; a first look or a backlog animates none", () => {
  const log = [1, 2, 3, 4].map(n => ({ n, kind: "shot" }));
  assert.deepEqual(newEvents(log, null), []);
  assert.deepEqual(newEvents(log, 4), []);
  assert.deepEqual(newEvents(log, 2).map(e => e.n), [3, 4]);
  assert.deepEqual(newEvents([], 0), []);
  const many = Array.from({ length: BACKLOG + 1 }, (_, i) => ({ n: i + 1, kind: "miss" }));
  assert.deepEqual(newEvents(many, 0), []);
  assert.equal(newEvents(many.slice(0, BACKLOG), 0).length, BACKLOG);
});

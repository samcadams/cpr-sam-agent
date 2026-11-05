import { derived } from "./model.js";

/*
 * Digital Gladiator's duel, CPR-lite (proposal §2b): two Gladiators, alternating turns, one move each. Real CP:R math,
 * simplified: checks are STAT + Skill + 1d10 (10 explodes, 1 subtracts) against a DV, damage dice against SP with
 * ablation, Critical Injuries on two 6s (+5 to HP), Seriously Wounded -2, Mortally Wounded -4 and a Death Save each
 * turn. The arena is four range bands. The host runs it and rolls every die (`rng`, 0 <= x < 1); the battle state is
 * plain data, so every phone and spectator draws it and works out the legal moves itself.
 *
 * State: { round, turn, order: [actorId, actorId], band, dv: { [table]: [dv per band] }, fighters: { [actorId]: Fighter },
 *   log: [Event], seq, over, winner, loser, how }
 * Event: { n, round, kind, actor, target?, text, dmg?, weapon?, band?, crit? }; `kind` drives the animation.
 */

export const BANDS = [
  { id: "close", label: "Close", range: "0-6 m/yd" },
  { id: "near", label: "Near", range: "7-12 m/yd" },
  { id: "far", label: "Far", range: "13-25 m/yd" },
  { id: "long", label: "Long", range: "26-50 m/yd" }
];
export const START_BAND = 2;
/** The system's DV tables' ranges, in band order (internal_dv-tables). */
export const BAND_RANGES = ["0-6", "7-12", "13-25", "26-50"];

const AIM_PENALTY = 8;
const SERIOUS_PENALTY = 2;
const MORTAL_PENALTY = 4;
const CRIT_DAMAGE = 5;
const AUTOFIRE_ROUNDS = 10;
const LOG_KEEP = 60;

const die = (rng, sides) => 1 + Math.floor(rng() * sides);

/** A CP:R check die: 1d10, a 10 adds another d10, a 1 subtracts one (unless Fumble Recovery). */
export function checkDie(rng, fumbleRecovery = false) {
  const first = die(rng, 10);
  if (first === 10) return { total: 10 + die(rng, 10), first };
  if (first === 1 && !fumbleRecovery) return { total: 1 - die(rng, 10), first };
  return { total: first, first };
}

/** "3d6" → { total, faces }. Anything that isn't NdM rolls nothing. */
export function rollDamage(rng, formula) {
  const m = /^(\d+)d(\d+)$/.exec(String(formula).trim());
  if (!m) return { total: 0, faces: [] };
  const faces = Array.from({ length: Number(m[1]) }, () => die(rng, Number(m[2])));
  return { total: faces.reduce((a, b) => a + b, 0), faces };
}

/** Brawling and Martial Arts damage by BODY (CP:R p. 176). */
export const brawlDamage = body => body <= 4 ? "1d6" : body <= 6 ? "2d6" : body <= 10 ? "3d6" : "4d6";

/** A fighter's attacks: Brawling always, Martial Arts if trained, then their weapons (gear order). */
function attacksOf(build) {
  const body = build.stats.body;
  const list = [{ key: "brawl", name: "Brawling", skill: "Brawling", damage: brawlDamage(body), rof: 2, ranged: false, halveArmor: false }];
  // The system names each style: "Martial Arts (Karate)". The best one trained.
  const [style] = Object.entries(build.skills).filter(([k, v]) => k.startsWith("Martial Arts") && v > 0).sort((x, y) => y[1] - x[1]);
  if (style) list.push({ key: "martial", name: style[0], skill: style[0], damage: brawlDamage(body), rof: 2, ranged: false, halveArmor: true });
  (build.gear ?? []).forEach((g, i) => {
    const w = g.weapon;
    if (!w || !/^\d+d\d+$/.test(String(w.damage))) return;
    list.push({
      key: `g${i}`, name: g.name, skill: w.skill, damage: w.damage, rof: Math.max(1, Number(w.rof) || 1), ranged: !!w.ranged,
      halveArmor: !w.ranged, magazine: w.ranged ? Math.max(0, Number(w.magazine) || 0) : 0, dv: w.dv ?? null,
      autofire: Number(w.autofire) || 0, type: w.type ?? "", ammo: w.ammo ?? null
    });
  });
  return list;
}

/** A Gladiator as it enters the arena: everything the duel needs, copied, so the build can change later. */
export function newFighter(build) {
  const d = derived(build);
  const gear = build.gear ?? [];
  const best = loc => Math.max(0, ...gear.filter(g => g.armor).map(g => Number(g.armor[loc]) || 0));
  const count = effect => gear.filter(g => g.effect === effect).reduce((n, g) => n + (g.qty || 1), 0);
  const attacks = attacksOf(build);
  const ammo = {};
  for (const g of gear.filter(x => x.ammo?.type)) ammo[g.ammo.type] = (ammo[g.ammo.type] ?? 0) + (Number(g.ammo.rounds) || 0) * (g.qty || 1);
  return {
    actorId: build.actorId, name: build.name, look: build.look,
    stats: { ...build.stats }, skills: { ...build.skills }, awareness: { ...build.awareness },
    hp: d.hp, maxHp: d.hp, serious: d.serious, deathSave: d.deathSave,
    sp: { body: best("body"), head: best("head") },
    penalty: Math.max(0, ...gear.filter(g => g.armor).map(g => Number(g.armor.penalty) || 0)),
    attacks,
    mags: Object.fromEntries(attacks.filter(a => a.ranged).map(a => [a.key, a.magazine])),
    ammo,
    items: { speedheal: count("speedheal"), stim: count("stim") },
    dodge: false, mortal: false, dead: false, saves: 0, stim: false, speedhealUsed: false, deflectRound: 0, spotRound: 0
  };
}

const other = (state, actorId) => state.order.find(id => id !== actorId);
const skill = (f, name) => Number(f.skills[name]) || 0;
const isSerious = f => !f.mortal && f.hp < f.serious;
/** Wound penalty on every check. */
const woundPenalty = f => f.mortal ? MORTAL_PENALTY : isSerious(f) && !f.stim ? SERIOUS_PENALTY : 0;
const refOf = f => f.stats.ref - f.penalty;
const dexOf = f => f.stats.dex - f.penalty;
export const canDodge = f => refOf(f) >= 8;

/** The DV of a ranged attack at a band, or null when the weapon can't reach (the table's N/A). */
export function rangedDv(state, attack, band, autofire = false) {
  const table = autofire ? `${attack.dv} (Autofire)` : attack.dv;
  const dv = state.dv?.[table]?.[band];
  return Number.isFinite(dv) ? dv : null;
}

/** Wound state for the HP bar: ok | serious | mortal | dead. */
export const woundState = f => f.dead ? "dead" : f.mortal ? "mortal" : isSerious(f) ? "serious" : "ok";

function log(state, event) {
  state.seq = (state.seq ?? 0) + 1;
  state.log.push({ n: state.seq, round: state.round, ...event });
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

/**
 * A new duel. `a`, `b`: builds. `dv`: the system's DV tables by name, each an array per band (BAND_RANGES; null = N/A).
 * Initiative is REF + Initiative Reaction + 1d10, rolled again on a tie.
 */
export function newBattle({ a, b, dv, rng }) {
  const fighters = { [a.actorId]: newFighter(a), [b.actorId]: newFighter(b) };
  const fa = fighters[a.actorId], fb = fighters[b.actorId];
  let ia, ib;
  do {
    ia = refOf(fa) + (fa.awareness.initiative || 0) + die(rng, 10);
    ib = refOf(fb) + (fb.awareness.initiative || 0) + die(rng, 10);
  } while (ia === ib);
  const order = ia > ib ? [a.actorId, b.actorId] : [b.actorId, a.actorId];
  const state = { round: 1, turn: order[0], order, band: START_BAND, dv, fighters, log: [], seq: 0, over: false, winner: null, loser: null, how: null };
  log(state, { kind: "start", actor: order[0], text: `${fighters[order[0]].name} moves first (Initiative ${Math.max(ia, ib)} vs ${Math.min(ia, ib)}).`, band: state.band });
  return state;
}

/**
 * The moves a fighter has right now: { id, label, group: attack|move|other, detail, disabled?, why? }.
 * Not their turn, or the duel is over: none.
 */
export function legalMoves(state, actorId) {
  const me = state.fighters[actorId];
  if (state.over || state.turn !== actorId || !me) return [];
  const moves = [];
  const close = state.band === 0;
  for (const a of me.attacks) {
    if (!a.ranged) {
      moves.push({ id: `melee:${a.key}`, label: a.name, group: "attack", detail: `${a.damage}${a.rof > 1 ? ` x${a.rof}` : ""}`, disabled: !close, why: close ? "" : "Get close first." });
      continue;
    }
    const dv = rangedDv(state, a, state.band);
    const mag = me.mags[a.key] ?? 0;
    const why = mag < 1 ? "Empty: reload." : dv === null ? "Out of range." : "";
    moves.push({ id: `shoot:${a.key}`, label: a.name, group: "attack", detail: `${a.damage}${a.rof > 1 ? ` x${a.rof}` : ""} · DV ${dv ?? "-"} · ${mag}/${a.magazine}`, disabled: !!why, why });
    if (a.type !== "shotgun") moves.push({ id: `aim:${a.key}`, label: `${a.name}: aim for the head`, group: "attack", detail: `-${AIM_PENALTY}, head damage x2`, disabled: !!why, why });
    if (a.autofire && skill(me, "Autofire") > 0) {
      const adv = rangedDv(state, a, state.band, true);
      const awhy = mag < AUTOFIRE_ROUNDS ? `Needs ${AUTOFIRE_ROUNDS} rounds.` : adv === null ? "Out of range." : "";
      moves.push({ id: `auto:${a.key}`, label: `${a.name}: autofire`, group: "attack", detail: `2d6 x up to ${a.autofire} · DV ${adv ?? "-"}`, disabled: !!awhy, why: awhy });
    }
    if (a.ammo && mag < a.magazine) {
      const left = me.ammo[a.ammo] ?? 0;
      moves.push({ id: `reload:${a.key}`, label: `Reload ${a.name}`, group: "other", detail: `${left} spare`, disabled: left < 1, why: left < 1 ? "No spare ammo." : "" });
    }
  }
  if (state.band > 0) moves.push({ id: "move:in", label: "Close in", group: "move", detail: `To ${BANDS[state.band - 1].label}` });
  if (state.band < BANDS.length - 1) moves.push({ id: "move:out", label: "Back off", group: "move", detail: `To ${BANDS[state.band + 1].label}` });
  if (canDodge(me)) moves.push({ id: "dodge", label: "Dodge", group: "move", detail: "Evade ranged attacks until your next turn" });
  if (me.items.speedheal > 0 && !me.speedhealUsed) moves.push({ id: "item:speedheal", label: "Speedheal", group: "other", detail: `+${me.stats.body + me.stats.will} HP`, disabled: me.mortal || me.hp >= me.maxHp, why: me.mortal ? "Too far gone." : me.hp >= me.maxHp ? "Not hurt." : "" });
  if (me.items.stim > 0 && !me.stim) moves.push({ id: "item:stim", label: "Stim", group: "other", detail: "Ignore Seriously Wounded" });
  return moves;
}

/** Damage from one hit onto the defender: SP (halved for melee weapons and Martial Arts), ablation, crits, Deflection. */
function applyHit(state, me, foe, attack, { head = false, multiplier = 1 }) {
  const roll = rollDamage(state._rng, attack.damage);
  let base = roll.total * multiplier;
  if (me.awareness.spot > 0 && me.spotRound !== state.round) {
    base += me.awareness.spot;
    me.spotRound = state.round;
  }
  const loc = head ? "head" : "body";
  const sp = foe.sp[loc];
  const armor = attack.halveArmor ? Math.floor(sp / 2) : sp;
  let through = Math.max(0, base - armor);
  if (through > 0 && sp > 0) foe.sp[loc] = sp - 1;
  if (head) through *= 2;
  if (through > 0 && foe.awareness.deflection > 0 && foe.deflectRound !== state.round) {
    through = Math.max(0, through - foe.awareness.deflection);
    foe.deflectRound = state.round;
  }
  const crit = roll.faces.filter(f => f === 6).length >= 2;
  const dmg = through + (crit ? CRIT_DAMAGE : 0);
  const wasMortal = foe.mortal;
  foe.hp = Math.max(0, foe.hp - dmg);
  const where = head ? " to the head" : "";
  log(state, { kind: crit ? "crit" : "hit", actor: me.actorId, target: foe.actorId, weapon: attack.key, dmg, crit,
    text: dmg > 0 ? `${crit ? "Critical! " : ""}${dmg} damage${where}${armor >= base ? " (armor held, but it hurt)" : ""}.` : `The armor stops it${where}.` });
  if (dmg <= 0) return;
  if (wasMortal) {
    foe.dead = true;
    log(state, { kind: "dead", actor: foe.actorId, text: `${foe.name} is finished.` });
  } else if (foe.hp < 1) {
    foe.mortal = true;
    log(state, { kind: "down", actor: foe.actorId, text: `${foe.name} is Mortally Wounded.` });
  }
}

/** One attack roll; true if it hit. */
function attackRoll(state, me, foe, attack, { aim = 0, autofire = false } = {}) {
  const fumbleRecovery = me.awareness.fumble > 0;
  const check = checkDie(state._rng, fumbleRecovery);
  const stat = attack.ranged ? refOf(me) : dexOf(me);
  const total = stat + skill(me, autofire ? "Autofire" : attack.skill) + (me.awareness.precision || 0) + check.total - aim - woundPenalty(me);
  let dv;
  let against;
  if (!attack.ranged || (foe.dodge && canDodge(foe))) {
    const evade = dexOf(foe) + skill(foe, "Evasion") + checkDie(state._rng).total - woundPenalty(foe);
    dv = attack.ranged ? Math.max(rangedDv(state, attack, state.band, autofire), evade) : evade;
    against = attack.ranged ? `dodge ${evade}` : `evasion ${evade}`;
  } else {
    dv = rangedDv(state, attack, state.band, autofire);
    against = `DV ${dv}`;
  }
  const hit = total > dv;
  const fumble = check.first === 1 && !fumbleRecovery;
  log(state, { kind: hit ? "shot" : "miss", actor: me.actorId, target: foe.actorId, weapon: attack.key, band: state.band,
    text: `${me.name}: ${attack.name}${aim ? " (aimed)" : ""}${autofire ? " (autofire)" : ""}, ${total} vs ${against}: ${hit ? "hit" : fumble ? "fumble" : "miss"}.` });
  return { hit, margin: total - dv };
}

/** End the duel. */
function finish(state, winner, how) {
  state.over = true;
  state.winner = winner;
  state.loser = other(state, winner);
  state.how = how;
  log(state, { kind: "over", actor: winner, text: `${state.fighters[winner].name} wins.` });
}

/** Pass the turn; the next fighter makes their Death Save first if they're Mortally Wounded. */
function nextTurn(state) {
  const next = other(state, state.turn);
  if (next === state.order[0]) state.round += 1;
  state.turn = next;
  const f = state.fighters[next];
  f.dodge = false;
  if (!f.mortal) return;
  const roll = die(state._rng, 10);
  const target = f.deathSave - f.saves;
  f.saves += 1;
  if (roll === 10 || roll >= target) {
    f.dead = true;
    log(state, { kind: "dead", actor: next, text: `${f.name} fails the Death Save (${roll} vs under ${target}).` });
  } else log(state, { kind: "save", actor: next, text: `${f.name} holds on (Death Save ${roll} vs under ${target}).` });
}

/**
 * Play a move. Returns { state } (a new state; the old one is untouched) or { error }. The duel ends when a fighter
 * dies (a failed Death Save, or any damage while Mortally Wounded) or concedes ("concede", any time, by either side).
 */
export function resolveMove(state, actorId, moveId, rng) {
  if (state.over) return { error: "The match is over." };
  const s = structuredClone(state);
  s._rng = rng;
  const me = s.fighters[actorId];
  const foeId = other(s, actorId);
  const foe = s.fighters[foeId];
  if (!me || !foe) return { error: "Not in this match." };
  if (moveId === "concede") {
    log(s, { kind: "concede", actor: actorId, text: `${me.name} concedes.` });
    finish(s, foeId, "concede");
    delete s._rng;
    return { state: s };
  }
  const move = legalMoves(state, actorId).find(m => m.id === moveId);
  if (!move) return { error: state.turn !== actorId ? "Not your turn." : "You can't do that." };
  if (move.disabled) return { error: move.why || "You can't do that now." };
  const [kind, key] = moveId.split(":");
  const attack = me.attacks.find(a => a.key === key);

  if (kind === "shoot" || kind === "melee") {
    const shots = attack.ranged ? Math.min(attack.rof, me.mags[key]) : attack.rof;
    for (let i = 0; i < shots && !foe.dead; i++) {
      if (attack.ranged) me.mags[key] -= 1;
      if (attackRoll(s, me, foe, attack).hit) applyHit(s, me, foe, attack, {});
    }
  } else if (kind === "aim") {
    me.mags[key] -= 1;
    if (attackRoll(s, me, foe, attack, { aim: AIM_PENALTY }).hit) applyHit(s, me, foe, attack, { head: true });
  } else if (kind === "auto") {
    me.mags[key] -= AUTOFIRE_ROUNDS;
    const { hit, margin } = attackRoll(s, me, foe, attack, { autofire: true });
    if (hit) applyHit(s, me, foe, { ...attack, damage: "2d6" }, { multiplier: Math.min(margin, attack.autofire) });
  } else if (kind === "move") {
    s.band += key === "in" ? -1 : 1;
    log(s, { kind: "move", actor: actorId, band: s.band, text: `${me.name} ${key === "in" ? "closes in" : "backs off"}: ${BANDS[s.band].label} range.` });
  } else if (kind === "dodge") {
    me.dodge = true;
    log(s, { kind: "dodge", actor: actorId, text: `${me.name} gets ready to dodge.` });
  } else if (kind === "reload") {
    const need = attack.magazine - me.mags[key];
    const take = Math.min(need, me.ammo[attack.ammo] ?? 0);
    me.mags[key] += take;
    me.ammo[attack.ammo] -= take;
    log(s, { kind: "reload", actor: actorId, weapon: key, text: `${me.name} reloads the ${attack.name}.` });
  } else if (moveId === "item:speedheal") {
    const heal = Math.min(me.maxHp - me.hp, me.stats.body + me.stats.will);
    me.hp += heal;
    me.items.speedheal -= 1;
    me.speedhealUsed = true;
    log(s, { kind: "item", actor: actorId, dmg: -heal, text: `${me.name} jabs a Speedheal: +${heal} HP.` });
  } else if (moveId === "item:stim") {
    me.items.stim -= 1;
    me.stim = true;
    log(s, { kind: "item", actor: actorId, text: `${me.name} takes a Stim: wounds won't slow them now.` });
  }

  if (foe.dead) finish(s, actorId, "kill");
  else {
    nextTurn(s);
    if (s.fighters[s.turn].dead) finish(s, other(s, s.turn), "kill");
  }
  delete s._rng;
  return { state: s };
}

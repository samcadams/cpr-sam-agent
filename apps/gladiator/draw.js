import { reduceMotion } from "../../scripts/ui/a11y.js";

/*
 * Digital Gladiator's arena (the duel is apps/gladiator/battle.js, the page apps/gladiator/page.js): neon wireframe
 * fighters on a Segotari grid. The viewer's fighter (or side a, for a spectator or the GM) stands lower left facing
 * right, the other upper right facing left; how far apart follows the range band. Each fighter is drawn in their
 * Gladiator's colour, shaped by their frame (street, heavy, blade, runner), kneeling and flickering when Mortally
 * Wounded, collapsed when dead or fried. The battle log's events that arrive while the arena is on screen play one
 * after another (shots, hits, crits, moves, the fry-out...); a backlog (the page just opened, a spectator just
 * started watching) isn't replayed. With Reduce motion: no animation, just the current state.
 * The phone keeps its arena in `phone._gladiatorArena` ({ matchId, lastSeq, queue, current, raf, canvas, ... }), so
 * it survives the page's redraws, which replace the canvas.
 */

/** The arena's drawing size; the backing store is scaled up to the canvas's size on screen. */
export const W = 320;
export const H = 180;
const HORIZON = 64;
const C = { magenta: "#ff3c6e", cyan: "#29e3ff", green: "#8cff4a", gold: "#ffd23f", white: "#f4f0ff", ink: "#07060a", dusk: "#1a0f24" };
/** More new events than this at once is a backlog: draw the current state instead. */
export const BACKLOG = 16;
/** How long each event plays (ms). */
const DURATION = { start: 700, shot: 550, miss: 550, hit: 650, crit: 850, move: 600, dodge: 500, reload: 550, item: 650, save: 750, down: 600,
  dead: 1000, over: 1000, concede: 700 };

const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a, b, p) => a + (b - a) * p;
const clamp01 = p => Math.max(0, Math.min(1, p));
const ease = p => p * p * (3 - 2 * p);

/**
 * Where the two fighters stand (their feet), for a range band (0 Close … 3 Long; fractions while moving): `me` lower
 * left, `foe` upper right, further apart the longer the range.
 */
export function fighterSpots(band, width = W, height = H) {
  const spread = 0.24 + 0.16 * band;
  return {
    me: { x: width * (0.5 - spread / 2), y: height * 0.9 },
    foe: { x: width * (0.5 + spread / 2), y: height * (0.66 - 0.035 * band) }
  };
}

/** The log's events to animate after `lastSeq`: none on a first look (lastSeq null), nor for a backlog. */
export function newEvents(log, lastSeq) {
  if (lastSeq == null) return [];
  const fresh = (log ?? []).filter(e => e.n > lastSeq);
  return fresh.length > BACKLOG ? [] : fresh;
}

/** The last event's number in a battle (0 if none). */
const lastSeqOf = battle => battle?.seq ?? battle?.log?.at(-1)?.n ?? 0;

/** Who's at the bottom (the viewer, or side a) and who's on top. */
function sidesOf(match, me) {
  const ids = [match.a.actorId, match.b.actorId];
  const bottom = ids.includes(me) ? me : ids[0];
  return { bottom, top: ids.find(id => id !== bottom) };
}

/** Each fighter's pose as the battle has it now. */
function posesOf(battle) {
  return Object.fromEntries(Object.entries(battle.fighters).map(([id, f]) => {
    const dead = !!f.dead || (battle.over && battle.loser === id);
    return [id, { mortal: !!f.mortal, dead, conceded: battle.log.some(e => e.kind === "concede" && e.actor === id) }];
  }));
}

/* ---------------- The arena ---------------- */

function drawBackground(ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, C.ink);
  sky.addColorStop(1, C.dusk);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);
  // A far skyline, edged in cyan.
  ctx.fillStyle = "#0d0914";
  ctx.strokeStyle = "rgba(41, 227, 255, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0, x = 0; x < W; i++) {
    const w = 10 + Math.floor(hash(i) * 22);
    const h = 8 + Math.floor(hash(i + 50) * 30);
    ctx.fillRect(x, HORIZON - h, w - 2, h);
    ctx.strokeRect(x + 0.5, HORIZON - h + 0.5, w - 3, h);
    x += w;
  }
  // The floor and the horizon's glow.
  const floor = ctx.createLinearGradient(0, HORIZON, 0, H);
  floor.addColorStop(0, "#1b0a1c");
  floor.addColorStop(1, C.ink);
  ctx.fillStyle = floor;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  const glow = ctx.createLinearGradient(0, HORIZON - 14, 0, HORIZON + 10);
  glow.addColorStop(0, "rgba(255, 60, 110, 0)");
  glow.addColorStop(0.6, "rgba(255, 60, 110, 0.35)");
  glow.addColorStop(1, "rgba(255, 60, 110, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, HORIZON - 14, W, 24);
  // The grid: lines running to the vanishing point, and rows closing up toward the horizon.
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 60, 110, 0.45)";
  ctx.shadowColor = C.magenta;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  for (let k = -12; k <= 12; k++) {
    ctx.moveTo(W / 2 + k * 14, HORIZON);
    ctx.lineTo(W / 2 + k * 70, H);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(41, 227, 255, 0.4)";
  ctx.shadowColor = C.cyan;
  ctx.beginPath();
  for (let i = 1; i <= 9; i++) {
    const y = HORIZON + (H - HORIZON) * ((i / 9) ** 2.2);
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 60, 110, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, HORIZON + 0.5);
  ctx.lineTo(W, HORIZON + 0.5);
  ctx.stroke();
  ctx.restore();
}

/* ---------------- Fighters ---------------- */

/** Joints, facing right, feet at 0 (y up is negative): standing, kneeling, lying. */
const STAND = { head: [0, -46], neck: [0, -39], hip: [0, -22], kneeF: [5, -11], footF: [8, 0], kneeB: [-4, -11], footB: [-7, 0],
  elbowF: [7, -34], handF: [15, -35], elbowB: [3, -31], handB: [11, -33] };
const ARMS_DOWN = { elbowF: [3, -30], handF: [4, -21], elbowB: [-3, -30], handB: [-4, -21] };
const KNEEL = { head: [3, -33], neck: [2, -26], hip: [-1, -12], kneeF: [7, -12], footF: [8, 0], kneeB: [-3, 0], footB: [-11, 0],
  elbowF: [5, -18], handF: [8, -10], elbowB: [-1, -18], handB: [2, -10] };
const LYING = { head: [-21, -4], neck: [-15, -3], hip: [0, -2], kneeF: [8, -2], footF: [16, -1], kneeB: [8, -5], footB: [17, -4],
  elbowF: [-10, -1], handF: [-5, -1], elbowB: [-12, -6], handB: [-6, -6] };

/** A frame's standing joints: the runner leans in on a wide stance. */
function standOf(frame) {
  if (frame !== "runner") return STAND;
  const lean = ([x, y], dx) => [x + dx, y];
  return { ...STAND, head: lean(STAND.head, 5), neck: lean(STAND.neck, 4), elbowF: lean(STAND.elbowF, 3), handF: lean(STAND.handF, 3),
    elbowB: lean(STAND.elbowB, 3), handB: lean(STAND.handB, 3), kneeF: [8, -12], footF: [12, 0], kneeB: [-6, -10], footB: [-12, 0] };
}

/** The joints for a pose: { kneel 0..1, lie 0..1, down 0..1 (arms lowered) }. */
function jointsOf(frame, { kneel = 0, lie = 0, down = 0 }) {
  const stand = standOf(frame);
  const out = {};
  for (const k of Object.keys(STAND)) {
    let [x, y] = stand[k];
    if (ARMS_DOWN[k]) [x, y] = [lerp(x, ARMS_DOWN[k][0], down), lerp(y, ARMS_DOWN[k][1], down)];
    [x, y] = [lerp(x, KNEEL[k][0], kneel), lerp(y, KNEEL[k][1], kneel)];
    out[k] = [lerp(x, LYING[k][0], lie), lerp(y, LYING[k][1], lie)];
  }
  return out;
}

/**
 * One fighter at (x, y) (feet), `face` 1 right / -1 left, `scale` for depth. `pose`: { kneel, lie, down, alpha,
 * colour, frame, armed }.
 */
function drawFighter(ctx, x, y, face, scale, pose) {
  const j = jointsOf(pose.frame, pose);
  const P = k => [x + j[k][0] * face * scale, y + j[k][1] * scale];
  const line = (...keys) => {
    ctx.beginPath();
    keys.forEach((k, i) => (i ? ctx.lineTo(...P(k)) : ctx.moveTo(...P(k))));
    ctx.stroke();
  };
  const heavy = pose.frame === "heavy";
  ctx.save();
  ctx.globalAlpha *= pose.alpha ?? 1;
  ctx.strokeStyle = pose.colour;
  ctx.fillStyle = pose.colour;
  ctx.shadowColor = pose.colour;
  ctx.shadowBlur = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = (heavy ? 2.6 : 1.8) * scale;
  line("footB", "kneeB", "hip", "kneeF", "footF");
  line("hip", "neck");
  line("neck", "elbowB", "handB");
  line("neck", "elbowF", "handF");
  // The head: a visor'd helmet on a heavy, a circle on the rest.
  const [hx, hy] = P("head");
  const r = 4.6 * scale;
  ctx.beginPath();
  if (heavy) ctx.rect(hx - r, hy - r, r * 2, r * 2);
  else ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(hx, hy - 1 * scale);
  ctx.lineTo(hx + face * r * 1.1, hy - 1 * scale);
  ctx.stroke();
  if (heavy) {
    // Armour plates: a chest plate and shoulder pads.
    const [nx, ny] = P("neck");
    const [px, py] = P("hip");
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.moveTo(nx - 7 * scale, ny);
    ctx.lineTo(nx + 7 * scale, ny);
    ctx.lineTo(lerp(nx, px, 0.7) + 4 * scale, lerp(ny, py, 0.7));
    ctx.lineTo(lerp(nx, px, 0.7) - 4 * scale, lerp(ny, py, 0.7));
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(nx - 9 * scale, ny - 2 * scale, 4 * scale, 4 * scale);
    ctx.fillRect(nx + 5 * scale, ny - 2 * scale, 4 * scale, 4 * scale);
  }
  // The weapon in the front hand: a blade arm, or a gun.
  if (pose.armed !== false) {
    const [ex, ey] = P("elbowF");
    const [wx, wy] = P("handF");
    const len = Math.hypot(wx - ex, wy - ey) || 1;
    const blade = pose.frame === "blade";
    const reach = (blade ? 16 : 5) * scale;
    ctx.strokeStyle = blade ? C.white : pose.colour;
    ctx.lineWidth = (blade ? 1.4 : 2.6) * scale;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + ((wx - ex) / len) * reach, wy + ((wy - ey) / len) * reach);
    ctx.stroke();
  }
  ctx.restore();
}

/** A fighter in glitched horizontal slices (the fry-out): `amount` 0..1. */
function drawGlitched(ctx, x, y, face, scale, pose, amount, seed) {
  const top = y - 52 * scale;
  const slice = 6 * scale;
  for (let i = 0; i < 10; i++) {
    const shift = (hash(seed + i * 13) - 0.5) * 18 * amount * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 40 * scale, top + i * slice, 80 * scale, slice);
    ctx.clip();
    drawFighter(ctx, x + shift, y, face, scale, { ...pose, colour: hash(seed + i) < 0.3 * amount ? (i % 2 ? C.cyan : C.magenta) : pose.colour });
    ctx.restore();
  }
}

/** Electric arcs over a fighter. */
function drawArcs(ctx, x, y, scale, amount, seed) {
  ctx.save();
  ctx.strokeStyle = C.cyan;
  ctx.shadowColor = C.cyan;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1;
  ctx.globalAlpha *= amount;
  for (let a = 0; a < 4; a++) {
    ctx.beginPath();
    let px = x + (hash(seed + a) - 0.5) * 30 * scale;
    let py = y - hash(seed + a + 7) * 50 * scale;
    ctx.moveTo(px, py);
    for (let s = 0; s < 5; s++) {
      px += (hash(seed + a * 9 + s) - 0.5) * 16 * scale;
      py += (hash(seed + a * 11 + s + 3) - 0.3) * 12 * scale;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Floating text, rising and fading with `p`. */
function floatText(ctx, text, x, y, colour, p, size = 11) {
  ctx.save();
  ctx.globalAlpha *= 1 - clamp01((p - 0.6) / 0.4);
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 6;
  ctx.fillText(text, x, y - 14 * ease(clamp01(p * 1.4)));
  ctx.restore();
}

function sparks(ctx, x, y, p, size, colour, seed) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha *= 1 - p;
  const reach = size * ease(clamp01(p * 1.6));
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = hash(seed + i) * Math.PI * 2;
    const r0 = reach * 0.4;
    const r1 = reach * (0.7 + 0.3 * hash(seed + i + 20));
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

/* ---------------- One frame ---------------- */

/**
 * Draw the arena. `view`: { battle, bottom, top, band (shown), poses ({ [id]: { mortal, dead, conceded } }), event
 * (playing, or null), p (its progress 0..1), t (ms, for flicker) }.
 */
export function drawArena(ctx, view) {
  const { battle, bottom, top, event: e, t = 0 } = view;
  const p = e ? clamp01(view.p) : 1;
  let band = view.band;
  if (e?.kind === "move" && Number.isFinite(e.band)) band = lerp(view.band, e.band, ease(p));
  const spots = fighterSpots(band);
  const seat = { [bottom]: { ...spots.me, face: 1, scale: 1 }, [top]: { ...spots.foe, face: -1, scale: 0.78 } };

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (e?.kind === "crit" && p < 0.5) {
    const k = (1 - p * 2) * 4;
    ctx.translate((hash(t) - 0.5) * k, (hash(t + 1) - 0.5) * k);
  }
  drawBackground(ctx);

  // The fighters, the far one first.
  for (const id of [top, bottom]) {
    const f = battle.fighters[id];
    const s = seat[id];
    if (!f || !s) continue;
    const pose = view.poses[id] ?? {};
    const mine = e && e.actor === id;
    const look = { colour: f.look?.colour || (id === bottom ? C.cyan : C.magenta), frame: f.look?.frame || "street" };
    let kneel = pose.mortal ? 1 : 0;
    let lie = pose.dead ? 1 : 0;
    let down = pose.conceded || pose.mortal ? 1 : 0;
    let alpha = pose.dead ? 0.35 : pose.mortal ? 0.6 + 0.3 * Math.abs(Math.sin(t / 90 + hash(t >> 6))) : 1;
    let dx = 0;
    if (e?.kind === "start") alpha *= ease(p);
    if (mine && e.kind === "down") kneel = ease(p);
    if (mine && e.kind === "concede") down = ease(p);
    if (mine && e.kind === "dodge") dx = Math.sin(p * Math.PI) * 12 * s.face * -1;
    const frying = (e?.kind === "dead" && e.actor === id) || (e?.kind === "over" && battle.loser === id && !pose.dead);
    const fp = { ...look, kneel, lie, down, alpha, armed: !pose.conceded && !(mine && e.kind === "concede" && p > 0.5) };
    if (frying) {
      fp.lie = ease(clamp01((p - 0.3) / 0.7));
      fp.alpha = lerp(alpha, 0.35, p);
      drawGlitched(ctx, s.x, s.y, s.face, s.scale, fp, 1 - p * 0.6, e.n * 31 + Math.floor(t / 60));
      drawArcs(ctx, s.x, s.y, s.scale, 1 - p * 0.5, e.n * 17 + Math.floor(t / 70));
      continue;
    }
    if (mine && e.kind === "dodge") drawFighter(ctx, s.x, s.y, s.face, s.scale, { ...fp, alpha: alpha * 0.3 * (1 - p) });
    drawFighter(ctx, s.x + dx, s.y, s.face, s.scale, fp);
  }

  if (e) drawEvent(ctx, e, p, view, seat);
  ctx.restore();
}

/** One event's effects over the fighters. */
function drawEvent(ctx, e, p, view, seat) {
  const from = seat[e.actor];
  const to = seat[e.target];
  const chest = s => [s.x, s.y - 30 * s.scale];
  const hand = s => [s.x + 15 * s.face * s.scale, s.y - 35 * s.scale];
  const headTop = s => [s.x, s.y - 58 * s.scale];
  switch (e.kind) {
    case "shot":
    case "miss": {
      if (!from || !to) return;
      const attack = view.battle.fighters[e.actor]?.attacks?.find(a => a.key === e.weapon);
      const [tx, ty] = chest(to);
      if (attack && attack.ranged === false) {
        // A melee swing: a slash across the target.
        ctx.save();
        ctx.strokeStyle = C.white;
        ctx.shadowColor = C.white;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.globalAlpha *= 1 - p;
        const off = e.kind === "miss" ? -16 : 0;
        ctx.beginPath();
        ctx.arc(tx, ty + off, 12 * to.scale, -Math.PI * 0.8, -Math.PI * 0.8 + Math.PI * 1.2 * ease(clamp01(p * 1.5)));
        ctx.stroke();
        ctx.restore();
        return;
      }
      const [hx, hy] = hand(from);
      const [ex, ey] = e.kind === "miss" ? [tx + (to.x - from.x) * 0.5, ty - 26 - hash(e.n) * 20] : [tx, ty];
      if (p < 0.18) {
        ctx.save();
        ctx.fillStyle = C.gold;
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(hx, hy, 3 + 4 * (1 - p / 0.18), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const head = clamp01((p - 0.05) / 0.5);
      const tail = clamp01((p - 0.2) / 0.5);
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.shadowColor = C.gold;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lerp(hx, ex, tail), lerp(hy, ey, tail));
      ctx.lineTo(lerp(hx, ex, head), lerp(hy, ey, head));
      ctx.stroke();
      ctx.restore();
      return;
    }
    case "hit":
    case "crit": {
      if (!to) return;
      const [tx, ty] = chest(to);
      const crit = e.kind === "crit";
      sparks(ctx, tx, ty, p, crit ? 26 : 14, crit ? C.magenta : C.gold, e.n);
      if (crit) {
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - p);
        ctx.fillStyle = C.magenta;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        floatText(ctx, "CRIT", tx, ty - 26 * to.scale, C.magenta, p, 14);
      }
      floatText(ctx, e.dmg > 0 ? `-${e.dmg}` : "ARMOR", tx + 10, ty - 10, crit ? C.white : C.gold, p);
      return;
    }
    case "reload":
      if (from) floatText(ctx, "RELOAD", ...headTop(from), C.cyan, p, 9);
      return;
    case "item":
      if (!from) return;
      floatText(ctx, e.dmg < 0 ? `+${-e.dmg}` : "STIM", ...headTop(from), C.green, p);
      sparks(ctx, ...chest(from), p, 12, C.green, e.n);
      return;
    case "save": {
      if (!from) return;
      const [cx, cy] = chest(from);
      ctx.save();
      ctx.strokeStyle = C.magenta;
      ctx.shadowColor = C.magenta;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5;
      for (const beat of [0, 0.35]) {
        const q = clamp01((p - beat) / 0.6);
        if (q <= 0 || q >= 1) continue;
        ctx.globalAlpha = 1 - q;
        ctx.beginPath();
        ctx.arc(cx, cy, (6 + 22 * q) * from.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case "dead":
    case "over": {
      const loser = e.kind === "dead" ? e.actor : view.battle.loser;
      const s = seat[loser];
      if (s && p > 0.6) floatText(ctx, "FRIED", ...headTop(s), C.cyan, (p - 0.6) / 0.4 * 0.7, 10);
      return;
    }
    default:
  }
}

/* ---------------- The phone's arena ---------------- */

/** Size the canvas's backing store to its size on screen (HiDPI) and map the arena's W x H onto it. */
function fit(canvas) {
  const ratio = globalThis.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || W;
  const w = Math.round(cssW * ratio);
  const h = Math.round(((cssW * H) / W) * ratio);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(w / W, 0, 0, h / H, 0, 0);
  return ctx;
}

/** Play an event's end onto the shown state. */
function apply(arena, e) {
  const pose = arena.poses[e.actor];
  if (e.kind === "move" || e.kind === "start") {
    if (Number.isFinite(e.band)) arena.band = e.band;
  } else if (e.kind === "down" && pose) pose.mortal = true;
  else if (e.kind === "dead" && pose) pose.dead = true;
  else if (e.kind === "concede" && pose) pose.conceded = true;
  else if (e.kind === "over" && arena.poses[arena.battle.loser]) arena.poses[arena.battle.loser].dead = true;
}

function frame(phone) {
  const arena = phone._gladiatorArena;
  if (!arena) return;
  const now = performance.now();
  for (;;) {
    if (!arena.current) {
      const e = arena.queue.shift();
      if (!e) break;
      const quick = arena.queue.length > 3 ? 0.6 : 1;
      let ms = (DURATION[e.kind] ?? 0) * quick;
      if (e.kind === "over" && arena.poses[arena.battle.loser]?.dead) ms = 0; // already fried by the death
      arena.current = { e, t0: now, ms };
    }
    if (now - arena.current.t0 < arena.current.ms) break;
    apply(arena, arena.current.e);
    arena.current = null;
  }
  const { current } = arena;
  if (!current) {
    // Idle: the battle's own state, the final frame, and the loop stops.
    arena.band = arena.battle.band;
    arena.poses = posesOf(arena.battle);
  }
  if (arena.canvas?.isConnected) {
    drawArena(fit(arena.canvas), { ...arena, event: current?.e ?? null, p: current ? (now - current.t0) / current.ms : 1, t: current ? now : 0 });
  }
  arena.raf = current ? requestAnimationFrame(() => frame(phone)) : null;
}

/**
 * Show a match in this arena canvas (after every redraw): a new match (or the first look) starts from its current
 * state; the same match carries on, its new events queued after whatever's playing.
 */
export function showArena(phone, canvas, match) {
  const battle = match?.battle;
  if (!battle) return stopArena(phone);
  const { bottom, top } = sidesOf(match, canvas.dataset.me);
  let arena = phone._gladiatorArena;
  if (arena?.matchId !== match.id || arena.bottom !== bottom) {
    stopArena(phone);
    arena = phone._gladiatorArena = { matchId: match.id, bottom, top, lastSeq: null, queue: [], current: null, raf: null, band: battle.band, poses: posesOf(battle) };
  }
  arena.canvas = canvas;
  arena.battle = battle;
  const calm = reduceMotion();
  if (calm) {
    arena.queue = [];
    arena.current = null;
  } else arena.queue.push(...newEvents(battle.log, arena.lastSeq));
  arena.lastSeq = lastSeqOf(battle);
  if (!arena.raf) frame(phone);
}

/** Stop the phone's arena and forget it (the arena's off screen, or the phone's put away). */
export function stopArena(phone) {
  const arena = phone._gladiatorArena;
  if (arena?.raf) cancelAnimationFrame(arena.raf);
  phone._gladiatorArena = null;
}

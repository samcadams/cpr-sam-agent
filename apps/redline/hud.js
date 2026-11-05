import {
  bestLap, CLASSES, clock, deltaTo, DISTRICTS, fieldSize, ghostAt, kmh, lapOf, PHYSICS, position, SEG, sectionOf, seenHas, split, START, trackPos
} from "./model.js";
import { gearOf } from "./audio.js";
import { glow, label, poly, rgba } from "./gfx.js";
import { PAINT, PLAYER_PAINT } from "./rides.js";

/*
 * REDLINE's heads-up display over the race (apps/redline/draw.js), and the track's minimap (on the HUD, the
 * lobby's cards and the start menu). Top left the clock, the lap and the split; top right the place and
 * Heat; bottom left a tachometer round the gear with the speed and the ride's damage; bottom right the
 * minimap. Panels are cut-corner plates with a neon edge. Over the middle: the start lights, the grid roll,
 * messages, WRECKED, FINISH, PAUSED. At speed, lines streak past the edges (not with Reduce motion).
 */

/** The playfield (as draw.js's). */
const W = 288;
const H = 400;

export const HUD = { cyan: "#00f0ff", pink: "#ff2a6d", yellow: "#f5d300", green: "#3dff8b", red: "#ff4060", dim: "#a9a3c0", ink: "rgba(6, 2, 16, 0.72)" };

/* ---------------- Track extras, worked out once per track ---------------- */

const extras = new WeakMap();

/** The track's heading at each segment (for the sky's drift) and its minimap fitted to a unit box. */
export function trackExtra(track) {
  let e = extras.get(track);
  if (e) return e;
  const heading = [];
  let h = 0;
  for (const seg of track.segs) {
    heading.push(h);
    h += seg.k * SEG;
  }
  const xs = track.map.map(p => p[0]);
  const ys = track.map.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(x1 - x0, y1 - y0) || 1;
  const unit = track.map.map(([x, y]) => [(x - x0 + (size - (x1 - x0)) / 2) / size, 1 - (y - y0 + (size - (y1 - y0)) / 2) / size]);
  e = { heading, unit };
  extras.set(track, e);
  return e;
}

/* ---------------- Panels ---------------- */

/** A cut-corner plate: dark glass with a neon edge on one side. `cut`: which corner is cut ("tl", "tr", "bl", "br"). */
export function plate(ctx, x, y, w, h, { edge = HUD.cyan, cut = "br", c = 8 } = {}) {
  const pts = {
    tl: [[x + c, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + c]],
    tr: [[x, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h]],
    bl: [[x, y], [x + w, y], [x + w, y + h], [x + c, y + h], [x, y + h - c]],
    br: [[x, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x, y + h]]
  }[cut];
  poly(ctx, pts);
  ctx.fillStyle = HUD.ink;
  ctx.fill();
  ctx.strokeStyle = rgba(edge, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  // The bright edge.
  ctx.fillStyle = edge;
  if (cut === "tr" || cut === "br") ctx.fillRect(x, y, 2, h);
  else ctx.fillRect(x + w - 2, y, 2, h);
}

/** A banner across the middle: a slanted plate with a big line and an optional small one. */
function banner(ctx, y, big, color, small, smallColor = "#ffffff", px = 20) {
  const w = W - 50;
  ctx.fillStyle = HUD.ink;
  poly(ctx, [[25 + 10, y], [25 + w, y], [25 + w - 10, y + (small ? 46 : 32)], [25, y + (small ? 46 : 32)]]);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(25 + 10, y, w - 10, 2);
  ctx.fillRect(25, y + (small ? 44 : 30), w - 10, 2);
  label(ctx, big, W / 2 + 2, y + 24, px, rgba(color, 0.35), "center", "italic bold 20px sans-serif");
  label(ctx, big, W / 2, y + 23, px, color, "center", "italic bold 20px sans-serif");
  if (small) label(ctx, small, W / 2, y + 39, 9.5, smallColor);
}

/* ---------------- The race ---------------- */

/** Time, lap, split against the ghost, place, speed, damage, Heat, the minimap; the lights; messages. */
export function drawHud(ctx, g, fx, calm) {
  const { track } = g;
  const p = g.p;
  const now = performance.now();
  speedLines(ctx, g, calm);
  vignette(ctx);
  // Top left: the clock, the lap, the split.
  const rows = (track.closed ? 2 : 0) + (fx.ref ? 1 : 0);
  plate(ctx, 4, 4, 124, 28 + rows * 12, { edge: HUD.cyan, cut: "br" });
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px monospace";
  ctx.fillText(clock(Math.max(0, g.finished ? g.time : g.t)), 11, 24);
  ctx.font = "bold 9.5px monospace";
  let y = 38;
  if (track.closed) {
    ctx.fillStyle = HUD.cyan;
    ctx.fillText(`LAP ${lapOf(g)}/${track.spec.laps}`, 11, y);
    ctx.fillStyle = "#d8e6ff";
    ctx.fillText(clock(Math.max(0, g.t - g.lapStart)), 58, y);
    y += 12;
    const best = bestLap(g);
    ctx.fillStyle = HUD.dim;
    ctx.fillText(`BEST ${best === null ? "-:--.--" : clock(best)}`, 11, y);
    y += 12;
  }
  const delta = deltaTo(g, fx.ref);
  if (fx.ref) {
    ctx.fillStyle = delta === null ? HUD.dim : delta > 0 ? HUD.red : HUD.green;
    // Behind or ahead, in words too (not by colour alone).
    ctx.fillText(delta === null ? "GHOST --" : `${split(delta)} ${delta > 0 ? "BEHIND" : "AHEAD"}`, 11, y);
  }
  // Top right: the place, big.
  plate(ctx, W - 74, 4, 70, 40, { edge: HUD.yellow, cut: "bl" });
  const place = g.finished ? g.place : position(g);
  ctx.textAlign = "right";
  ctx.fillStyle = HUD.yellow;
  ctx.font = "italic bold 28px sans-serif";
  const of = `/${fieldSize(g)}`;
  ctx.font = "bold 11px monospace";
  const ofW = ctx.measureText(of).width;
  ctx.fillText(of, W - 12, 34);
  ctx.font = "italic bold 28px sans-serif";
  ctx.fillText(`P${place}`, W - 14 - ofW, 35);
  // Heat: stars, in words for a screen.
  if (g.config.heat && g.heat >= 1) {
    const stars = Math.floor(g.heat);
    const flash = calm || Math.floor(now / 300) % 2;
    plate(ctx, W - 92, 48, 88, 17, { edge: flash ? "#ff2a3d" : "#3d6bff", cut: "bl", c: 5 });
    ctx.fillStyle = flash ? "#ff2a3d" : "#6d8bff";
    ctx.font = "bold 9.5px monospace";
    ctx.fillText(`HEAT ${"★".repeat(stars)}${"☆".repeat(5 - stars)}`, W - 9, 60);
  }
  tach(ctx, g, calm);
  minimap(ctx, g, { x: W - 70, y: H - 70, s: 64 });
  // At the edges: someone beside you winding up to swing or swerve, on that side.
  for (const e of [...g.racers, ...g.traffic]) {
    if (e.out || e.atk?.phase !== "wind" || Math.abs(e.total - p.total) > 12) continue;
    const left = e.x < p.x;
    const flash = calm || Math.floor(now / 120) % 2;
    const color = flash ? "#ff2a3d" : "#f5d300";
    const x = left ? 4 : W - 4;
    const d = left ? 1 : -1;
    ctx.fillStyle = color;
    poly(ctx, [[x, 230], [x + d * 16, 214], [x + d * 16, 246]]);
    ctx.fill();
    glow(ctx, x + d * 8, 230, 26, rgba(color, 0.6), 0.7);
  }
  lights(ctx, g, fx, calm);
  if (p.wreck > 0) banner(ctx, 100, "WRECKED", HUD.pink, `Back in control in ${Math.ceil(p.wreck)}`);
  if (fx.intro && g.t < -PHYSICS.countdown + 0.01) {
    // The Drive Land Vehicle roll, and the grid slot it earned.
    const { roll, slot, of: slots } = fx.intro;
    plate(ctx, 24, 92, W - 48, 92, { edge: slot === 0 ? HUD.yellow : HUD.cyan, cut: "br", c: 12 });
    label(ctx, "DRIVE LAND VEHICLE", W / 2, 114, 11, HUD.dim);
    label(ctx, Number.isFinite(roll) ? `ROLLED ${roll}` : "NO ROLL", W / 2, 141, 20, "#fff", "center", "italic bold 20px sans-serif");
    label(ctx, `GRID P${slot + 1} OF ${slots}`, W / 2, 168, 17, slot === 0 ? HUD.yellow : HUD.cyan, "center", "italic bold 20px sans-serif");
  }
  for (const m of fx.messages ?? []) {
    const left = m.until - g.t;
    if (left <= 0) continue;
    ctx.globalAlpha = calm ? 1 : Math.min(1, left * 2);
    ctx.fillStyle = HUD.ink;
    poly(ctx, [[W / 2 - 92, 120], [W / 2 + 96, 120], [W / 2 + 88, 144], [W / 2 - 100, 144]]);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.fillRect(W / 2 - 92, 120, 188, 1.5);
    label(ctx, m.text, W / 2, 137, 13, m.color, "center", "italic bold 20px sans-serif");
    ctx.globalAlpha = 1;
  }
  if (g.finished) banner(ctx, 150, g.place === 1 ? "WINNER" : "FINISH", HUD.yellow, `${clock(g.time)}  ·  P${g.place}`, "#ffffff", 24);
  if (fx.paused) banner(ctx, 150, "PAUSED", HUD.cyan, fx.paused === "gm" ? "The GM paused all races" : "P or Esc to drive on · X ends the race", "#d8e6ff");
  if (g.t < 3 && fx.muted !== undefined) {
    ctx.textAlign = "right";
    ctx.font = "8.5px monospace";
    ctx.fillStyle = "#8f88a8";
    ctx.fillText(fx.muted ? "M: play music" : "M: mute music", W - 8, g.config.heat && g.heat >= 1 ? 76 : 56);
  }
}

/** The start lights: a gantry of three, red one by one, then all green; GO! */
function lights(ctx, g, fx, calm) {
  if (!(g.t < 0.9) || (fx.intro && g.t < -PHYSICS.countdown + 0.01)) return;
  const lit = g.t < 0 ? 3 - Math.ceil(-g.t) + 1 : 4;
  const cx = W / 2;
  const y = 66;
  ctx.fillStyle = "#0a0810";
  ctx.fillRect(cx - 2, 44, 4, 10);
  plate(ctx, cx - 48, 52, 96, 28, { edge: lit >= 4 ? HUD.green : "#ff2a3d", cut: "br", c: 6 });
  for (let i = 0; i < 3; i++) {
    const x = cx - 26 + i * 26;
    const on = lit >= 4 || i < lit;
    const color = lit >= 4 ? HUD.green : on ? "#ff2a3d" : "#2a0c12";
    ctx.fillStyle = "#050308";
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(x - 2.5, y - 2.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      glow(ctx, x, y, 22, rgba(color, 0.7), 0.9);
    }
  }
  if (g.t >= 0) {
    const k = calm ? 1 : 1 + Math.max(0, 0.3 - g.t);
    label(ctx, "GO!", cx + 2, 128, 34 * k, rgba(HUD.green, 0.35), "center", "italic bold 20px sans-serif");
    label(ctx, "GO!", cx, 126, 34 * k, HUD.green, "center", "italic bold 20px sans-serif");
  }
}

/** Bottom left: a tachometer round the gear, the speed under it, the damage bar. */
function tach(ctx, g, calm) {
  const p = g.p;
  const c = CLASSES[g.cls];
  const { gear, rpm } = gearOf(g.cls, p.v);
  const cx = 44;
  const cy = H - 50;
  const r = 30;
  plate(ctx, 4, H - 92, 108, 88, { edge: HUD.pink, cut: "tr", c: 10 });
  // The dial: segments from 7 o'clock round to 5, the top fifth red.
  const segs = 22;
  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  for (let i = 0; i < segs; i++) {
    const k = i / (segs - 1);
    const a = a0 + span * k;
    const on = k <= rpm;
    const red = k > 0.8;
    ctx.strokeStyle = on ? (red ? "#ff2a3d" : k > 0.6 ? HUD.yellow : HUD.cyan) : "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a, a + span / segs - 0.04);
    ctx.stroke();
  }
  // Bouncing off the limiter: the red flashes.
  if (rpm > 0.97 && !calm && Math.floor(performance.now() / 80) % 2) glow(ctx, cx, cy - r * 0.6, 20, "rgba(255, 40, 60, 0.6)");
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "italic bold 24px sans-serif";
  ctx.fillText(gear ? String(gear) : "N", cx, cy + 8);
  ctx.font = "bold 7px monospace";
  ctx.fillStyle = HUD.dim;
  ctx.fillText("GEAR", cx, cy + 18);
  // The speed, digital, beside the dial.
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 17px monospace";
  ctx.fillText(String(kmh(p.v)), 106, H - 50);
  ctx.font = "bold 7px monospace";
  ctx.fillStyle = HUD.dim;
  ctx.fillText("KM/H", 106, H - 41);
  // The ride's damage, in blocks.
  const hp = Math.max(0, p.hp) / 100;
  const color = hp > 0.5 ? HUD.green : hp > 0.25 ? HUD.yellow : HUD.red;
  ctx.textAlign = "left";
  ctx.font = "bold 7.5px monospace";
  ctx.fillStyle = HUD.dim;
  ctx.fillText(c.name.toUpperCase(), 10, H - 10);
  const blocks = 10;
  for (let i = 0; i < blocks; i++) {
    ctx.fillStyle = (i + 0.5) / blocks <= hp ? color : "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(60 + i * 4.6, H - 16, 3.6, 7);
  }
  if (hp <= 0.25 && !calm && Math.floor(performance.now() / 250) % 2) glow(ctx, 82, H - 12, 20, "rgba(255, 64, 96, 0.6)");
}

/** Streaks past the edges at speed (none with Reduce motion). */
function speedLines(ctx, g, calm) {
  if (calm || g.finished) return;
  const c = CLASSES[g.cls];
  const k = (g.p.v / c.top - 0.72) / 0.28;
  if (k <= 0) return;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.strokeStyle = `rgba(220, 240, 255, ${0.22 * Math.min(1, k)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const vx = W / 2;
  const vy = 162;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const ph = (t * 3.2 + i * 0.37) % 1;
    const r0 = 150 + ph * 140;
    const x0 = vx + Math.cos(a) * r0;
    const y0 = vy + Math.sin(a) * r0 * 0.9;
    ctx.moveTo(x0, y0);
    ctx.lineTo(vx + Math.cos(a) * (r0 + 30), vy + Math.sin(a) * (r0 + 30) * 0.9);
  }
  ctx.stroke();
  ctx.restore();
}

/** Darker corners. */
function vignette(ctx) {
  const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.8);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/**
 * A track's minimap in a box ({ x, y, s }): the line, the start, the pack, the ghosts and you. Without a
 * race (`g` with only a track: the menu), just the line and the start.
 */
export function minimap(ctx, g, box, { frame = true } = {}) {
  const track = g.track;
  if (frame) plate(ctx, box.x - 4, box.y - 4, box.s + 8, box.s + 8, { edge: HUD.cyan, cut: "tl", c: 8 });
  const { unit } = trackExtra(track);
  const at = ([x, y]) => [box.x + x * box.s, box.y + y * box.s];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [width, color] of [[4, "rgba(0, 240, 255, 0.18)"], [1.6, "rgba(220, 245, 255, 0.85)"]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    unit.forEach((p, i) => (i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p))));
    if (track.closed) ctx.closePath();
    ctx.stroke();
  }
  const dot = (total, color, r, hollow) => {
    const i = Math.floor(trackPos(track, total) / SEG) % unit.length;
    const [x, y] = at(unit[Math.max(0, Math.min(unit.length - 1, i))]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  };
  // The start, a checkered square.
  const [sx, sy] = at(unit[Math.floor(START / SEG) % unit.length]);
  ctx.fillStyle = "#fff";
  ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
  ctx.fillStyle = "#111";
  ctx.fillRect(sx - 2.5, sy - 2.5, 2.5, 2.5);
  ctx.fillRect(sx, sy, 2.5, 2.5);
  if (!g.p) return;
  g.racers.forEach((r, i) => !r.out && dot(r.total, PAINT[i % PAINT.length], 2));
  for (const gh of g.ghosts) dot(ghostAt(gh, Math.max(0, g.t)).total, "#7fe9ff", 2.5, true);
  for (const e of g.traffic) if (e.kind === "cop" && !e.out) dot(e.total, Math.floor(performance.now() / 200) % 2 ? "#ff2a3d" : "#3d6bff", 1.8);
  dot(g.p.total, PLAYER_PAINT, 3.2);
  const [px, py] = at(unit[Math.floor(trackPos(track, g.p.total) / SEG) % unit.length] ?? unit[0]);
  glow(ctx, px, py, 9, "rgba(0, 240, 255, 0.7)");
}

/** The GM's fly-through: the track's name and where we are. */
export function drawPreviewHud(ctx, g, v) {
  plate(ctx, 4, 4, W - 8, 36, { edge: HUD.cyan, cut: "br" });
  ctx.textAlign = "left";
  ctx.fillStyle = HUD.cyan;
  ctx.font = "bold 12px monospace";
  ctx.fillText(`PREVIEW  ${(g.track.spec.name || "Untitled").slice(0, 24)}`, 11, 20);
  ctx.fillStyle = HUD.dim;
  ctx.font = "10px monospace";
  const done = Math.min(1, Math.max(0, g.p.total) / g.track.finish);
  ctx.fillText(`${DISTRICTS[g.track.spec.district].name} · ${Math.round(done * 100)}%${v.sand ? " · sandstorm" : ""}`, 11, 33);
  minimap(ctx, g, { x: W - 70, y: H - 70, s: 64 });
}

/* ---------------- The minimap card (the lobby and the GM's builder) ---------------- */

/** Hazard marks on the card (what each looks like). */
const MARKS = {
  pothole: "#c9a77a", wreck: "#ff8a1c", fire: "#ff8a1c", checkpoint: "#3d6bff", roadblock: "#ff2a3d", flood: "#40c4ff", ramp: "#f5d300", sand: "#c4703e"
};

/**
 * A track's layout on a small canvas: the shape always, the start line, and hazards only in the sections
 * `seen` (a fog-of-war mask; `all` shows everything, for the GM). Unseen stretches are drawn dashed.
 * `ctx`/`size`/`at`: draw into a box on another canvas (the start menu) instead.
 */
export function drawCard(canvas, track, { seen = 0, all = false, ctx: into = null, size: boxSize = 0, at = [0, 0] } = {}) {
  let ctx = into;
  let size = boxSize;
  if (!ctx) {
    const ratio = window.devicePixelRatio || 1;
    size = canvas.clientWidth || 96;
    if (canvas.width !== Math.round(size * ratio)) Object.assign(canvas, { width: Math.round(size * ratio), height: Math.round(size * ratio) });
    ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
  }
  const { unit } = trackExtra(track);
  const pad = size * 0.08;
  const pt = i => [at[0] + pad + unit[i][0] * (size - pad * 2), at[1] + pad + unit[i][1] * (size - pad * 2)];
  const known = i => all || seenHas(seen, sectionOf(track, i * SEG));
  ctx.lineWidth = Math.max(2, size / 32);
  ctx.lineCap = "round";
  for (let i = 0; i < unit.length - (track.closed ? 0 : 1); i++) {
    const [a, b] = [pt(i), pt((i + 1) % unit.length)];
    ctx.strokeStyle = known(i) ? "#00f0ff" : "rgba(160, 160, 190, 0.45)";
    ctx.setLineDash(known(i) ? [] : [2, 3]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const h of track.hazards) {
    const i = Math.floor(h.s / SEG) % unit.length;
    if (!known(i)) continue;
    const [x, y] = pt(i);
    ctx.fillStyle = MARKS[h.kind] ?? "#fff";
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  for (const z of track.zones) {
    for (let s = z.s0; s < z.s1; s += SEG * 4) {
      const i = Math.floor(s / SEG) % unit.length;
      if (!known(i)) continue;
      const [x, y] = pt(i);
      ctx.fillStyle = "rgba(196, 112, 62, 0.6)";
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // The start (and a sprint's finish).
  const s0 = pt(Math.floor(START / SEG));
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(s0[0], s0[1], 3.5, 0, Math.PI * 2);
  ctx.fill();
  if (!track.closed) {
    const f = pt(Math.min(unit.length - 1, Math.floor((track.finish + START) / SEG)));
    ctx.fillStyle = "#f5d300";
    ctx.fillRect(f[0] - 3, f[1] - 3, 6, 6);
  }
}

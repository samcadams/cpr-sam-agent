import { hasPower, inTunnel, PHYSICS, POWERS, runSpeed, shownDist, shownSpeed, worldScale } from "./model.js";
import { reduceMotion } from "../../scripts/ui/a11y.js";

/*
 * NCART Runner's drawing (the game is apps/ncart/model.js, the page apps/ncart/page.js): the elevated line
 * at night in pseudo-3D, seen from behind the runner. The track bends down over a crest a few dozen metres
 * ahead, so what's coming rises into view late (TeleOptics flattens it, to see further). A run opens with
 * the camera on the runner's back, pulling out as they get up to speed. Each obstacle has its own shape,
 * not just its own colour. With Reduce motion: no rain, shake, flicker or flashing.
 */

/** The playfield, in canvas units (scaled to fit, like Flappy Chrome's). */
export const FIELD = { w: 288, h: 400 };

const C = {
  skyTop: "#04010c", skyBottom: "#2b0b3d", haze: "rgba(255, 60, 140, 0.12)", far: "#110720", near: "#1a0c2e",
  window: "rgba(255, 210, 120, 0.55)", cyan: "#00f0ff", pink: "#ff2a6d", yellow: "#f5d300", orange: "#ff8a1c",
  deck: "#15131e", deckEdge: "#2b2838", rail: "#9aa0b6", sleeper: "#25212f", pillar: "#0c0a13", below: "#07040d",
  train: "#4a5266", trainDark: "#2c3140", trainRoof: "#323848", trainWin: "rgba(255, 220, 150, 0.8)",
  police: "#e8e8f0", shard: "#3dfcff"
};
export const POWER_COLORS = {
  sandevistan: "#b388ff", kerenzikov: "#ff5252", armor: "#b0bec5", booster: "#69f0ae",
  skate: "#ffd740", magnet: "#40c4ff", optics: "#ff6e40", spike: "#ff4081"
};

/** Steady pseudo-random per number (buildings, windows, which ad a sign shows). */
const hash = n => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;

/* ---------------- Camera and projection ---------------- */

/**
 * The camera: `back` metres behind the runner, `height` lane-widths up. World x is lanes (0–2), heights
 * metres (drawn HS lane-widths each), z metres along the track. `bend`: how fast the track drops away past
 * `bendFrom` metres from the camera (metres per metre²), which makes the crest.
 */
const CAM = { back: 5, focal: 430, horizon: 92, height: 2.2, near: 0.8, bendFrom: 14, bend: 0.0035 };
const HS = 0.55;
/** The opening shot: close over the runner's shoulder, holding a moment, then pulling out behind them. */
const INTRO = { hold: 0.6, pull: 2.6 };
const CLOSE = { back: 1.6, height: 1.1, side: 0.3 };

/** Where the camera is for this frame (`fx.cam`: last frame's, to smooth the climb onto roofs). */
function camera(g, fx) {
  const k = g.started ? ease((g.t - INTRO.hold) / INTRO.pull) : 0;
  const prev = fx.cam;
  const lift = Math.min(g.ground, PHYSICS.roof) * HS * 0.8;
  const smooth = prev ? prev.lift + (lift - prev.lift) * 0.12 : lift;
  const bend = CAM.bend * (hasPower(g, "optics") ? 0.4 : 1);
  const cam = {
    x: 1 + (g.x - 1) * lerp(0.95, 0.6, k) + CLOSE.side * (1 - k),
    y: lerp(CLOSE.height, CAM.height, k) + smooth,
    z: g.dist - lerp(CLOSE.back, CAM.back, k),
    lift: smooth,
    bend: prev ? prev.bend + (bend - prev.bend) * 0.05 : bend
  };
  // The crest: where the track's surface is highest on screen. Past it, things are behind the hill.
  let best = { dz: 200, y: Infinity };
  for (let dz = 4; dz < 200; dz += 0.5) {
    const y = CAM.horizon + (cam.y + drop(cam, dz) * HS) * (CAM.focal / dz);
    if (y < best.y) best = { dz, y };
  }
  cam.crest = best;
  cam.cut = cam.z + best.dz;
  return cam;
}

/** How far the track has dropped away `dz` metres from the camera. */
const drop = (cam, dz) => (dz > CAM.bendFrom ? cam.bend * (dz - CAM.bendFrom) ** 2 : 0);

/** A world point on the canvas: [x, y, scale], or null behind the near plane. */
function project(cam, x, h, z) {
  const dz = z - cam.z;
  if (dz < CAM.near - 1e-6) return null;
  const s = CAM.focal / dz;
  return [FIELD.w / 2 + (x - cam.x) * s, CAM.horizon + (cam.y - (h - drop(cam, dz)) * HS) * s, s];
}

/* ---------------- Helpers ---------------- */

function poly(ctx, points, fill, stroke) {
  if (points.some(p => !p)) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const p of points.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/**
 * Text at any size, smoothly (fonts snap to whole pixels; this scales a fixed one), fading in as it grows
 * from too small to read. `align`: canvas textAlign.
 */
function label(ctx, text, x, y, px, color, align = "center") {
  if (px < 1.5) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, (px - 1.5) / 2);
  ctx.translate(x, y);
  ctx.scale(px / 20, px / 20);
  ctx.font = "bold 20px monospace";
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A label's size so it fits `width` (monospace: about 0.6 of the size per character). */
const fit = (text, width, most) => Math.min(most, width / (text.length * 0.62));

/** Draw in a rectangle as if it were the unit square (0,0 top left to 1,1 bottom right). */
function inRect(ctx, r, fn) {
  if (!r || r.w < 1 || r.h < 1) return;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(r.w, r.h);
  fn();
  ctx.restore();
}

/** The screen rectangle of a box's front (a front face is always upright and square-on). */
const rectOf = front => (front ? { x: front[3][0], y: front[3][1], w: front[1][0] - front[0][0], h: front[0][1] - front[3][1] } : null);

/**
 * A box from x0 to x1 (lanes), y0 to y1 (metres), z0 to z1: its top, the side facing the camera and its
 * front. `faces`: { front, top, side } colours; `top0`: the top's height at z0 (a ramp). A box running over
 * the crest is drawn up to it, and its far part only where it rises above the hill. Returns the front's
 * corners (bottom left, bottom right, top right, top left), or null when its front is behind the camera (then
 * what's drawn there is just where the camera cuts through it, with nothing to decorate).
 */
function box(ctx, cam, x0, x1, y0, y1, z0, z1, faces, top0 = y1) {
  const cut = z0 < cam.z + CAM.near;
  const topAt = z => top0 + (y1 - top0) * ((z - z0) / (z1 - z0));
  const zs = Math.max(z0, cam.z + CAM.near);
  if (z1 <= zs) return null;
  if (zs < cam.cut && z1 > cam.cut) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FIELD.w, cam.crest.y);
    ctx.clip();
    slab(ctx, cam, x0, x1, y0, cam.cut, z1, topAt(cam.cut), y1, { ...faces, front: null });
    ctx.restore();
  }
  const front = slab(ctx, cam, x0, x1, y0, zs, Math.min(z1, Math.max(cam.cut, zs + 0.01)), topAt(zs), topAt(Math.min(z1, Math.max(cam.cut, zs + 0.01))), faces);
  return !cut && front.every(Boolean) ? front : null;
}

/** One stretch of a box, from z0 (top t0) to z1 (top t1). Returns its front's corners. */
function slab(ctx, cam, x0, x1, y0, z0, z1, t0, t1, faces) {
  const P = (x, y, z) => project(cam, x, y, z);
  if (faces.side && x1 < cam.x) poly(ctx, [P(x1, y0, z0), P(x1, y0, z1), P(x1, t1, z1), P(x1, t0, z0)], faces.side);
  if (faces.side && x0 > cam.x) poly(ctx, [P(x0, y0, z0), P(x0, y0, z1), P(x0, t1, z1), P(x0, t0, z0)], faces.side);
  if (faces.top && Math.max(t0, t1) * HS < cam.y) poly(ctx, [P(x0, t0, z0), P(x1, t0, z0), P(x1, t1, z1), P(x0, t1, z1)], faces.top);
  const front = [P(x0, y0, z0), P(x1, y0, z0), P(x1, t0, z0), P(x0, t0, z0)];
  if (faces.front && t0 > y0) poly(ctx, front, faces.front);
  return front;
}

/* ---------------- The city and the line ---------------- */

function drawCity(ctx, g, cam, calm) {
  const sky = ctx.createLinearGradient(0, 0, 0, cam.crest.y);
  sky.addColorStop(0, C.skyTop);
  sky.addColorStop(1, C.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  const base = cam.crest.y + 6;
  for (const [depth, color, height, width, seed, lights] of [[0.015, C.far, 120, 30, 0, false], [0.04, C.near, 80, 22, 40, true]]) {
    const offset = (g.dist * depth) % width;
    const first = Math.floor((g.dist * depth) / width);
    for (let i = -1; i < FIELD.w / width + 2; i++) {
      const n = first + i + seed;
      const h = height * (0.3 + hash(n) * 0.7);
      const x = i * width - offset;
      ctx.fillStyle = color;
      ctx.fillRect(x, base - h, width - 2, h + 20);
      if (lights) {
        ctx.fillStyle = C.window;
        let row = 0;
        for (let wy = base - h + 5; wy < base; wy += 7, row++) {
          let col = 0;
          for (let wx = x + 3; wx < x + width - 5; wx += 5, col++) if (hash(n * 97 + row * 13 + col * 7) > 0.74) ctx.fillRect(wx, wy, 1.5, 2);
        }
      }
      if (hash(n * 7) > 0.8) {
        ctx.fillStyle = hash(n) > 0.5 ? C.cyan : C.pink;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x + 3, base - h - 4, width - 9, 2);
        ctx.globalAlpha = 1;
      }
    }
  }
  // AVs crossing the sky, blinking.
  if (!calm) {
    for (let i = 0; i < 3; i++) {
      const x = ((g.t * (12 + i * 7) + hash(i) * 400) % (FIELD.w + 40)) - 20;
      const y = 30 + i * 22 + hash(i * 3) * 20;
      ctx.fillStyle = Math.floor(g.t * 3 + i) % 2 ? "#ff3b3b" : "#ffffff";
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = C.haze;
  ctx.fillRect(0, base - 40, FIELD.w, 50);
}

/** Below the deck: the city far down, a scatter of lights, the pillars. */
function drawBelow(ctx, g, cam) {
  const zFar = cam.cut;
  const zNear = cam.z + CAM.near;
  const P = (x, y, z) => project(cam, x, y, z);
  ctx.fillStyle = C.below;
  ctx.fillRect(0, cam.crest.y, FIELD.w, FIELD.h - cam.crest.y);
  for (let i = 0; i < 60; i++) {
    const x = hash(i * 1.7) * FIELD.w;
    const y = cam.crest.y + 4 + (((hash(i * 2.3) * (FIELD.h - cam.crest.y) + g.dist * (1 + hash(i) * 2)) % (FIELD.h - cam.crest.y)));
    ctx.fillStyle = i % 3 ? "rgba(255, 190, 110, 0.5)" : "rgba(0, 220, 255, 0.4)";
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  // Pillars.
  for (let z = Math.ceil(zFar / 18) * 18; z > zNear; z -= 18) {
    const a = P(-0.8, -0.45, z);
    const b = P(2.8, -0.45, z);
    if (!a || !b) continue;
    ctx.fillStyle = C.pillar;
    const w = Math.max(2, a[2] * 0.4);
    ctx.fillRect(a[0] + w * 0.5, a[1], w, FIELD.h - a[1]);
    ctx.fillRect(b[0] - 1.5 * w, b[1], w, FIELD.h - b[1]);
  }
}

/** The elevated line up to the crest: the deck, sleepers, rails and neon edges. */
function drawTrack(ctx, g, cam) {
  const zFar = cam.cut;
  const zNear = cam.z + CAM.near;
  const P = (x, y, z) => project(cam, x, y, z);
  // The deck and its sides, in slices, so it follows the bend.
  const edges = [];
  for (let z = zNear; z < zFar; z += Math.max(0.6, (z - cam.z) * 0.15)) edges.push(z);
  edges.push(zFar);
  for (let i = 0; i + 1 < edges.length; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    poly(ctx, [P(-0.8, 0, a), P(2.8, 0, a), P(2.8, 0, b), P(-0.8, 0, b)], C.deck);
    poly(ctx, [P(-0.8, 0, a), P(-0.8, -0.45, a), P(-0.8, -0.45, b), P(-0.8, 0, b)], C.deckEdge);
    poly(ctx, [P(2.8, 0, a), P(2.8, -0.45, a), P(2.8, -0.45, b), P(2.8, 0, b)], C.deckEdge);
  }
  // Sleepers, every 2 m: they're what shows the speed.
  ctx.strokeStyle = C.sleeper;
  for (let z = Math.ceil(zNear / 2) * 2; z < zFar; z += 2) {
    const a = P(-0.65, 0, z);
    const b = P(2.65, 0, z);
    if (!a || !b) continue;
    ctx.lineWidth = Math.max(1, a[2] * 0.14);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // Rails and the neon edge strips, following the bend.
  const line = (x, h, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    edges.forEach((z, i) => {
      const p = P(x, h, z);
      if (p) i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    });
    ctx.stroke();
  };
  for (let lane = 0; lane < 3; lane++) for (const side of [-0.28, 0.28]) line(lane + side, 0.02, C.rail, 1.2);
  line(-0.77, 0.03, C.cyan, 2);
  line(2.77, 0.03, C.pink, 2);
  ctx.lineWidth = 1;
}

/* ---------------- Obstacles ---------------- */

/** Hazard stripes across a rectangle. */
function stripes(ctx, r, color) {
  inRect(ctx, r, () => {
    ctx.beginPath();
    ctx.rect(0, 0, 1, 1);
    ctx.clip();
    ctx.fillStyle = color;
    for (let k = -1; k < 1.2; k += 0.25) {
      ctx.beginPath();
      ctx.moveTo(k, 1);
      ctx.lineTo(k + 0.1, 1);
      ctx.lineTo(k + 0.6, 0);
      ctx.lineTo(k + 0.5, 0);
      ctx.fill();
    }
  });
}

/** The ads on billboards: an icon (drawn in a unit square) and a name. */
const ADS = [
  ["KIROSHI", "#00f0ff", ctx => {
    // An eye.
    ctx.beginPath();
    ctx.moveTo(0.1, 0.5);
    ctx.quadraticCurveTo(0.5, 0.1, 0.9, 0.5);
    ctx.quadraticCurveTo(0.5, 0.9, 0.1, 0.5);
    ctx.fill();
    ctx.fillStyle = "#1a1030";
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.16, 0, Math.PI * 2);
    ctx.fill();
  }],
  ["NCART", "#f5d300", ctx => {
    // A train, head on.
    ctx.fillRect(0.22, 0.12, 0.56, 0.62);
    ctx.fillStyle = "#1a1030";
    ctx.fillRect(0.3, 0.2, 0.4, 0.22);
    ctx.beginPath();
    ctx.arc(0.34, 0.6, 0.06, 0, Math.PI * 2);
    ctx.arc(0.66, 0.6, 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f5d300";
    ctx.fillRect(0.2, 0.8, 0.14, 0.08);
    ctx.fillRect(0.66, 0.8, 0.14, 0.08);
  }],
  ["TRAUMA", "#ff2a6d", ctx => {
    // A medic's cross.
    ctx.fillRect(0.38, 0.12, 0.24, 0.76);
    ctx.fillRect(0.12, 0.38, 0.76, 0.24);
  }],
  ["NOODLES", "#ff8a1c", ctx => {
    // A bowl and chopsticks.
    ctx.beginPath();
    ctx.moveTo(0.1, 0.5);
    ctx.lineTo(0.9, 0.5);
    ctx.quadraticCurveTo(0.85, 0.9, 0.5, 0.9);
    ctx.quadraticCurveTo(0.15, 0.9, 0.1, 0.5);
    ctx.fill();
    ctx.fillRect(0.55, 0.08, 0.06, 0.45);
    ctx.fillRect(0.68, 0.1, 0.06, 0.42);
  }],
  ["BRAINDANCE", "#b388ff", ctx => {
    // A head with waves coming off it.
    ctx.beginPath();
    ctx.arc(0.38, 0.5, 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = ctx.fillStyle;
    for (const r of [0.38, 0.5]) {
      ctx.beginPath();
      ctx.arc(0.38, 0.5, r, -0.6, 0.6);
      ctx.stroke();
    }
  }]
];

function drawRoadblock(ctx, g, cam, o, blink) {
  const { x } = o;
  box(ctx, cam, x - 0.42, x - 0.34, 0, 0.55, o.z, o.z + o.len, { front: "#555", side: "#333" });
  box(ctx, cam, x + 0.34, x + 0.42, 0, 0.55, o.z, o.z + o.len, { front: "#555", side: "#333" });
  const front = box(ctx, cam, x - 0.47, x + 0.47, 0.5, o.top, o.z, o.z + o.len, { front: C.police, top: "#bbb", side: "#999" });
  const r = rectOf(front);
  if (r) {
    stripes(ctx, r, "#d01010");
    // NCPD on a plate in the middle.
    ctx.fillStyle = "#0b1a3a";
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h * 0.2, r.w * 0.4, r.h * 0.6);
    label(ctx, "NCPD", r.x + r.w / 2, r.y + r.h * 0.66, fit("NCPD", r.w * 0.36, r.h * 0.45), "#fff");
  }
  const l = project(cam, x - 0.3, o.top + 0.1, o.z);
  const rr = project(cam, x + 0.3, o.top + 0.1, o.z);
  if (l && rr) {
    const s = Math.max(1.2, l[2] * 0.07);
    for (const [p, on] of [[l, blink], [rr, !blink]]) {
      ctx.fillStyle = on ? "#ff2020" : "#2040ff";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.fillRect(p[0] - s, p[1] - s, 2 * s, 2 * s);
    }
    ctx.shadowBlur = 0;
  }
}

function drawSign(ctx, g, cam, o) {
  const { x } = o;
  box(ctx, cam, x - 0.46, x - 0.4, 0, o.bottom, o.z, o.z + o.len, { front: "#444", side: "#333" });
  box(ctx, cam, x + 0.4, x + 0.46, 0, o.bottom, o.z, o.z + o.len, { front: "#444", side: "#333" });
  const r = rectOf(box(ctx, cam, x - 0.5, x + 0.5, o.bottom, o.top, o.z, o.z + o.len, { front: "#140a26", top: "#2a2040", side: "#0d0619" }));
  if (!r) return;
  const [name, color, icon] = ADS[Math.floor(hash(Math.round(o.z)) * ADS.length)];
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.lineWidth = Math.max(1, r.w / 50);
  ctx.strokeRect(r.x + r.w * 0.05, r.y + r.h * 0.1, r.w * 0.9, r.h * 0.8);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  // The icon on the left, the name beside it.
  const side = r.h * 0.6;
  inRect(ctx, { x: r.x + r.w * 0.1, y: r.y + r.h * 0.2, w: side, h: side }, () => {
    ctx.fillStyle = color;
    icon(ctx);
  });
  const left = r.x + r.w * 0.12 + side;
  const room = r.x + r.w * 0.92 - left;
  label(ctx, name, left + room / 2, r.y + r.h * 0.6, fit(name, room, r.h * 0.32), color);
}

function drawCable(ctx, g, cam, o, calm) {
  const { x } = o;
  const P = (dx, h) => project(cam, x + dx, h, o.z);
  // Poles at the lane's sides, so it reads as something strung across.
  box(ctx, cam, x - 0.56, x - 0.5, 0, o.top + 0.15, o.z, o.z + 0.1, { front: "#3a3a44", side: "#26262e" });
  box(ctx, cam, x + 0.5, x + 0.56, 0, o.top + 0.15, o.z, o.z + 0.1, { front: "#3a3a44", side: "#26262e" });
  // Two runs, sagging between the poles: the low one at a jump's height, a second above it (too high
  // to jump the pair), so it reads as slide-only.
  const a = P(-0.53, o.bottom + 0.3);
  const b = P(0.53, o.bottom + 0.3);
  const m = P(0, o.bottom + 0.05);
  const ua = P(-0.53, o.top);
  const ub = P(0.53, o.top);
  const um = P(0, o.top - 0.25);
  if (!a || !b || !m || !ua || !ub || !um) return;
  const s = a[2];
  // Live cables: a glowing line under the black ones, pulsing.
  const pulse = calm ? 0.8 : 0.6 + 0.4 * Math.sin(g.t * 18 + o.z);
  for (const [l, r, c] of [[ua, ub, um], [a, b, m]]) {
    for (const [dy, color, w, glow] of [[0, `rgba(80, 200, 255, ${pulse})`, 0.1, 12], [0, "#111", 0.05, 0], [-0.12, "#111", 0.04, 0]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, s * w);
      ctx.shadowColor = "#50c8ff";
      ctx.shadowBlur = glow;
      ctx.beginPath();
      ctx.moveTo(l[0], l[1] - dy * s);
      ctx.quadraticCurveTo(c[0], c[1] - dy * s * 0.5, r[0], r[1] - dy * s);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  // Hazard tape hanging off it, and a HIGH VOLTAGE triangle in the middle.
  for (const k of [0.2, 0.4, 0.6, 0.8]) {
    const tx = lerp(a[0], b[0], k);
    const ty = lerp(a[1], b[1], k) + (m[1] - a[1]) * 4 * k * (1 - k) * 0.9;
    ctx.fillStyle = k * 10 % 4 < 2 ? C.yellow : "#111";
    ctx.fillRect(tx - s * 0.03, ty, s * 0.06, s * 0.2);
  }
  const ty = m[1] + s * 0.02;
  ctx.fillStyle = C.yellow;
  ctx.beginPath();
  ctx.moveTo(m[0], ty);
  ctx.lineTo(m[0] + s * 0.16, ty + s * 0.28);
  ctx.lineTo(m[0] - s * 0.16, ty + s * 0.28);
  ctx.fill();
  // A lightning bolt on it.
  inRect(ctx, { x: m[0] - s * 0.06, y: ty + s * 0.08, w: s * 0.12, h: s * 0.18 }, () => {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    for (const [bx, by] of [[0.6, 0], [0.1, 0.55], [0.45, 0.55], [0.3, 1], [0.9, 0.4], [0.55, 0.4]]) ctx.lineTo(bx, by);
    ctx.fill();
  });
  // Sparks.
  if (!calm && Math.floor(g.t * 10 + o.z) % 3 === 0) {
    const k = hash(Math.floor(g.t * 10) + o.z);
    ctx.fillStyle = "#e8fbff";
    ctx.shadowColor = "#50c8ff";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(lerp(a[0], b[0], k), lerp(a[1], b[1], k) + (m[1] - a[1]) * 4 * k * (1 - k) * 0.9, Math.max(1.5, s * 0.04), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/** A crashed AV, burning: a hull with its thrusters and a cracked canopy, flames and smoke on top. */
function drawWreck(ctx, g, cam, o, calm) {
  const { x } = o;
  // The fire lights up the track around it.
  const glow = project(cam, x, 0, o.z - 0.5);
  if (glow) {
    const r = glow[2] * 1.4;
    const flick = calm ? 1 : 0.85 + 0.15 * Math.sin(g.t * 17 + o.z);
    const grad = ctx.createRadialGradient(glow[0], glow[1], 0, glow[0], glow[1], r);
    grad.addColorStop(0, `rgba(255, 120, 30, ${0.35 * flick})`);
    grad.addColorStop(1, "rgba(255, 120, 30, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(glow[0], glow[1], r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const body = o.top * 0.62;
  const front = box(ctx, cam, x - 0.48, x + 0.48, 0, body, o.z, o.z + o.len, { top: "#2e2628", side: "#171213" });
  const r = rectOf(front);
  if (!r) return;
  // The fire's box: from a third of the way down the hull up to the wreck's full height.
  const above = r.h * (o.top / body - 1);
  const fire = { x: r.x, y: r.y - above, w: r.w, h: above + r.h * 0.35 };
  inRect(ctx, r, () => {
    // Hull: a squat, rounded fuselage, tipped over.
    ctx.fillStyle = "#2c2427";
    ctx.beginPath();
    ctx.moveTo(0.02, 1);
    ctx.lineTo(0.06, 0.35);
    ctx.quadraticCurveTo(0.5, -0.05, 0.94, 0.3);
    ctx.lineTo(0.98, 1);
    ctx.fill();
    // Cracked canopy.
    ctx.fillStyle = "rgba(120, 190, 230, 0.55)";
    ctx.beginPath();
    ctx.moveTo(0.28, 0.42);
    ctx.quadraticCurveTo(0.5, 0.18, 0.72, 0.42);
    ctx.lineTo(0.66, 0.55);
    ctx.lineTo(0.34, 0.55);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0.42, 0.3);
    ctx.lineTo(0.5, 0.44);
    ctx.lineTo(0.46, 0.55);
    ctx.moveTo(0.5, 0.44);
    ctx.lineTo(0.6, 0.4);
    ctx.stroke();
    // Thruster pods, one still glowing, one smashed.
    for (const [cx, lit] of [[0.16, true], [0.84, false]]) {
      ctx.fillStyle = "#1a1416";
      ctx.beginPath();
      ctx.ellipse(cx, 0.75, 0.13, 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lit ? "#ff8a1c" : "#4a3a3a";
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.ellipse(cx, 0.75, 0.08, 0.11, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Scorch and a hazard stripe.
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0.3, 0.62, 0.4, 0.12);
    ctx.fillStyle = C.yellow;
    ctx.fillRect(0.38, 0.86, 0.24, 0.05);
  });
  // Flames: three tongues, red outside to white-hot inside, flickering.
  inRect(ctx, fire, () => {
    const t = calm ? 0 : g.t;
    // A bed of embers along the hull's top, so nothing shows through under the flames.
    ctx.fillStyle = "#c2410c";
    ctx.beginPath();
    ctx.moveTo(0.04, 1);
    ctx.quadraticCurveTo(0.5, 0.62, 0.96, 1);
    ctx.fill();
    const tongues = [[0.14, 0.45], [0.3, 0.75], [0.5, 1], [0.68, 0.85], [0.85, 0.55]];
    for (const [cx, tall] of tongues) {
      const h = tall * (0.75 + (calm ? 0 : 0.25 * Math.sin(t * 13 + cx * 20)));
      const sway = calm ? 0 : Math.sin(t * 9 + cx * 7) * 0.05;
      for (const [w, k, color] of [[0.15, 1, "#ff3b1f"], [0.1, 0.78, "#ff8a1c"], [0.06, 0.55, "#ffd23f"], [0.025, 0.32, "#fff6d0"]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - w, 0.95);
        ctx.quadraticCurveTo(cx - w * 0.9, 0.9 - h * k * 0.5, cx + sway, 0.95 - h * k * 0.75);
        ctx.quadraticCurveTo(cx + w * 0.9, 0.9 - h * k * 0.5, cx + w, 0.95);
        ctx.fill();
      }
    }
    // Smoke, rising off it.
    for (let k = 0; k < 4; k++) {
      const age = calm ? k / 4 : (t * 0.7 + k / 4) % 1;
      ctx.fillStyle = `rgba(40, 34, 40, ${0.55 * (1 - age)})`;
      ctx.beginPath();
      ctx.arc(0.5 + Math.sin(k * 2.1 + age * 3) * 0.12, -age * 1.4, 0.12 + age * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawRamp(ctx, g, cam, o) {
  const { x } = o;
  box(ctx, cam, x - 0.46, x + 0.46, 0, o.top, o.z, o.z + o.len, { top: "#4a3a2a", side: "#2a2018" }, 0);
  for (let k = 0.15; k < 1; k += 0.25) {
    const zz = o.z + o.len * k;
    if (zz > cam.cut) break;
    const a = project(cam, x - 0.3, o.top * k, zz);
    const b = project(cam, x + 0.3, o.top * k, zz);
    const m = project(cam, x, o.top * (k + 0.06), zz + o.len * 0.06);
    if (!a || !b || !m) continue;
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = Math.max(1, a[2] * 0.06);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(m[0], m[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

/** An NCART car: windows down its side, a lit front; an oncoming one blazing its headlights. */
function drawTrain(ctx, g, cam, o, calm) {
  const { x } = o;
  const moving = o.kind === "oncoming";
  const z1 = o.z + o.len;
  const front = box(ctx, cam, x - 0.47, x + 0.47, 0.05, o.top, o.z, z1, { front: moving ? "#3a4256" : C.trainDark, top: C.trainRoof, side: C.train });
  const P = (xx, h, z) => project(cam, xx, h, z);
  // Windows on the side facing the camera, each a proper quad on that side (so they foreshorten, not squash).
  const sideX = x + 0.47 < cam.x ? x + 0.47 : x - 0.47 > cam.x ? x - 0.47 : null;
  if (sideX !== null) {
    for (let zz = o.z + 1.2; zz < z1 - 1; zz += 3) {
      if (zz < cam.z + CAM.near || zz + 1.8 > cam.cut) continue;
      poly(ctx, [P(sideX, 1.8, zz), P(sideX, 1.8, zz + 1.8), P(sideX, 2.6, zz + 1.8), P(sideX, 2.6, zz)], C.trainWin);
    }
    // A neon stripe along the side.
    const z0 = Math.max(o.z, cam.z + CAM.near);
    const zEnd = Math.min(z1, cam.cut);
    if (zEnd > z0) poly(ctx, [P(sideX, 1.2, z0), P(sideX, 1.2, zEnd), P(sideX, 1.35, zEnd), P(sideX, 1.35, z0)], moving ? C.pink : C.cyan);
  }
  const r = rectOf(front);
  if (r) {
    ctx.fillStyle = "rgba(160, 200, 255, 0.35)";
    ctx.fillRect(r.x + r.w * 0.15, r.y + r.h * 0.12, r.w * 0.7, r.h * 0.3);
    label(ctx, "NCART", r.x + r.w / 2, r.y + r.h * 0.58, fit("NCART", r.w * 0.75, r.h * 0.15), C.yellow);
    ctx.fillStyle = moving ? "#fffbe0" : "rgba(255, 240, 200, 0.5)";
    if (moving) {
      ctx.shadowColor = "#fff6c0";
      ctx.shadowBlur = calm ? 6 : 18;
    }
    const rad = Math.max(1.2, r.w * 0.07);
    for (const fx of [0.22, 0.78]) {
      ctx.beginPath();
      ctx.arc(r.x + r.w * fx, r.y + r.h * 0.75, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (moving && o.moving) {
      // Light thrown on the track ahead of it.
      const near = Math.max(cam.z + CAM.near, o.z - 14);
      poly(ctx, [P(x - 0.45, 0, o.z), P(x + 0.45, 0, o.z), P(x + 0.6, 0, near), P(x - 0.6, 0, near)], "rgba(255, 245, 200, 0.12)");
    }
  }
}

/** Just a train's two headlights, coming through the dark. */
function drawHeadlights(ctx, cam, o) {
  for (const dx of [-0.25, 0.25]) {
    const p = project(cam, o.x + dx, 0.8, o.z);
    if (!p) continue;
    ctx.fillStyle = "#fffbe0";
    ctx.shadowColor = "#fff6c0";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(p[0], p[1], Math.max(1.5, p[2] * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/** A train still over the crest, coming: its headlights glowing over the hill. */
function drawTrainGlow(ctx, g, cam, o) {
  const p = project(cam, o.x, 0, cam.cut);
  if (!p) return;
  const near = Math.max(0, 1 - (o.z - cam.cut) / 70);
  const r = 20 + near * 30;
  const grad = ctx.createRadialGradient(p[0], cam.crest.y, 0, p[0], cam.crest.y, r);
  grad.addColorStop(0, `rgba(255, 248, 210, ${0.25 + near * 0.55})`);
  grad.addColorStop(1, "rgba(255, 248, 210, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p[0], cam.crest.y, r, Math.PI, 2 * Math.PI);
  ctx.fill();
}

function drawDrone(ctx, g, cam, o) {
  const mid = (o.bottom + o.top) / 2;
  // Where a drifting drone goes: a dashed line on the track between its lanes.
  if (o.to !== undefined) {
    const a = project(cam, Math.min(o.lane, o.to), 0.02, o.z + o.len / 2);
    const b = project(cam, Math.max(o.lane, o.to), 0.02, o.z + o.len / 2);
    if (a && b) {
      ctx.strokeStyle = "rgba(255, 42, 109, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }
  const p = project(cam, o.x, mid, o.z);
  if (!p) return;
  const s = p[2] * 0.45;
  if (o.kind === "droneHigh") {
    // Quad-rotor: a flat body with spinning rotors (slide under).
    ctx.fillStyle = "#3a3f4f";
    ctx.fillRect(p[0] - s, p[1] - s * 0.18, 2 * s, s * 0.36);
    ctx.strokeStyle = "#b8c0d0";
    ctx.lineWidth = Math.max(1, s * 0.05);
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(p[0] + dx * s, p[1] - s * 0.3, s * 0.45, s * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = C.pink;
    ctx.shadowColor = C.pink;
    ctx.shadowBlur = 8;
    ctx.fillRect(p[0] - s * 0.15, p[1] + s * 0.05, s * 0.3, s * 0.15);
    ctx.shadowBlur = 0;
  } else {
    // A spiked mine-drone close to the deck, with a red ring (jump over).
    ctx.fillStyle = "#2a2e3a";
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = k % 2 ? s * 0.55 : s * 0.85;
      ctx.lineTo(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.7);
    }
    ctx.fill();
    ctx.strokeStyle = C.pink;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], s * 0.4, s * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

/** Gang gunfire across every lane, from a shooter on the deck's edge (kneeling for low fire). */
function drawGunfire(ctx, g, cam, o, calm, blink) {
  const low = o.kind === "gunLow";
  const gunH = low ? 0.55 : 1.5;
  const ys = [o.bottom + 0.15, (o.bottom + o.top) / 2, o.top - 0.15];
  const flick = calm ? 0 : g.t * 30;
  ys.forEach((y, i) => {
    const a = project(cam, -0.8, y, o.z);
    const b = project(cam, 2.9, y, o.z);
    if (!a || !b) return;
    ctx.strokeStyle = i === 1 ? C.yellow : C.orange;
    ctx.shadowColor = C.orange;
    ctx.shadowBlur = 6;
    ctx.lineWidth = Math.max(1, a[2] * 0.06);
    ctx.setLineDash([a[2] * 0.4, a[2] * 0.25]);
    ctx.lineDashOffset = -flick * (i + 1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  // The shooter: Maelstrom (chrome face, red optics) or a Booster (pink mohawk), by where they stand.
  const feet = project(cam, 3.15, 0, o.z);
  if (!feet) return;
  const u = feet[2] * HS * 0.1; // a tenth of a metre
  const booster = hash(Math.round(o.z) * 3) > 0.5;
  const [fx, fy] = feet;
  const hip = low ? -6 : -9;
  const shoulder = low ? -11 : -15;
  ctx.fillStyle = "#1c1a24";
  // Legs (kneeling: one folded under), body, head.
  if (low) {
    ctx.fillRect(fx - 1 * u, fy - 5 * u, 2.2 * u, 5 * u);
    ctx.fillRect(fx - 4 * u, fy - 1.5 * u, 4 * u, 1.5 * u);
  } else {
    ctx.fillRect(fx - 1.6 * u, fy + hip * u, 1.3 * u, -hip * u);
    ctx.fillRect(fx + 0.4 * u, fy + hip * u, 1.3 * u, -hip * u);
  }
  ctx.fillStyle = booster ? "#2c1f3a" : "#2a2a30";
  ctx.fillRect(fx - 2.2 * u, fy + shoulder * u, 4.4 * u, (hip - shoulder) * u);
  ctx.fillStyle = booster ? "#c9a27e" : "#9aa3b5";
  ctx.beginPath();
  ctx.arc(fx, fy + (shoulder - 1.8) * u, 1.6 * u, 0, Math.PI * 2);
  ctx.fill();
  if (booster) {
    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.moveTo(fx - 0.5 * u, fy + (shoulder - 3.2) * u);
    ctx.lineTo(fx, fy + (shoulder - 5.4) * u);
    ctx.lineTo(fx + 0.6 * u, fy + (shoulder - 3.2) * u);
    ctx.fill();
  }
  ctx.fillStyle = "#ff1a1a";
  ctx.shadowColor = "#ff1a1a";
  ctx.shadowBlur = 6;
  ctx.fillRect(fx - 1.4 * u, fy + (shoulder - 2.2) * u, 1.2 * u, 0.5 * u);
  ctx.shadowBlur = 0;
  // Arms out to the left with the gun, aimed across the track.
  const gy = fy - gunH * 10 * u;
  ctx.fillStyle = "#1c1a24";
  ctx.fillRect(fx - 4.5 * u, gy - 0.6 * u, 3.5 * u, 1.2 * u);
  ctx.fillStyle = "#3d3d46";
  ctx.fillRect(fx - 7.5 * u, gy - 0.8 * u, 3.6 * u, 1.3 * u);
  ctx.fillRect(fx - 5 * u, gy + 0.3 * u, 0.9 * u, 1.4 * u);
  if (blink) {
    ctx.fillStyle = "#fff4b0";
    ctx.shadowColor = C.orange;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    const mx = fx - 8 * u;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const r = k % 2 ? 0.8 * u : 2.2 * u;
      ctx.lineTo(mx + Math.cos(a) * r, gy + Math.sin(a) * r);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawObstacle(ctx, g, cam, o, calm) {
  if (o.broken) return;
  const blink = calm ? true : Math.floor(g.t * 6) % 2 === 0;
  switch (o.kind) {
    case "roadblock": return drawRoadblock(ctx, g, cam, o, blink);
    case "sign": return drawSign(ctx, g, cam, o);
    case "cable": return drawCable(ctx, g, cam, o, calm);
    case "wreck": return drawWreck(ctx, g, cam, o, calm);
    case "ramp": return drawRamp(ctx, g, cam, o);
    case "parked":
    case "oncoming": return drawTrain(ctx, g, cam, o, calm);
    case "droneHigh":
    case "droneLow": return drawDrone(ctx, g, cam, o);
    case "gunLow":
    case "gunHigh": return drawGunfire(ctx, g, cam, o, calm, blink);
  }
}

/* ---------------- Scenery and tunnels ---------------- */

/** Scenery comes in slots this long: a building on either side (most of the time), and a lamp pole. */
const SLOT = 14;
const BUILDINGS = ["#1b1430", "#141a2c", "#23152b", "#18182a", "#1d1424"];
/** In a tunnel, things darken from DARK / 2 past the runner and are lost in the dark from DARK * 1.5 (TeleOptics sees them). */
const DARK = 32;

/** The trackside scenery in view, steady for each slot of track (nothing inside tunnels). */
function scenery(g, cam) {
  const out = [];
  // Far enough out that a building has sunk out of sight below the bend before it's drawn at all.
  for (let k = Math.floor((cam.z + CAM.near) / SLOT) - 1; k <= Math.floor((cam.z + 150) / SLOT); k++) {
    for (const side of [-1, 1]) {
      const n = k * 2 + (side > 0 ? 1 : 0);
      if (hash(n * 13.7) < 0.35) continue;
      const z = k * SLOT + hash(n * 3.3) * 4;
      const len = 6 + hash(n * 7.1) * 7;
      if (inTunnel(g, z) || inTunnel(g, z + len)) continue;
      const gap = 1.2 + hash(n * 11.3) * 3;
      const width = 1.2 + hash(n * 17.9) * 2.5;
      const x0 = side < 0 ? -0.85 - gap - width : 2.85 + gap;
      // Mostly below the deck or a little above it; now and then a tower.
      const tall = hash(n * 19.1);
      out.push({ z, len, building: { x0, x1: x0 + width, top: tall > 0.85 ? 8 + (tall - 0.85) * 80 : -9 + tall * 12, n } });
    }
    const z = k * SLOT;
    if (!inTunnel(g, z)) out.push({ z, len: 0.2, pole: k % 2 ? -0.95 : 2.95 });
  }
  return out;
}

/** A building beside the line, rising from far below: lit windows on its faces, sometimes a neon ad. */
function drawBuilding(ctx, g, cam, t) {
  const { x0, x1, top, n } = t.building;
  const z0 = t.z;
  const z1 = t.z + t.len;
  const color = BUILDINGS[n % BUILDINGS.length];
  const front = box(ctx, cam, x0, x1, -30, top, z0, z1, { front: color, top: "#2c2442", side: "#100c1c" });
  // Floors on the side facing the track: lit strips, some warm, some neon.
  const sideX = x1 < cam.x ? x1 : x0 > cam.x ? x0 : null;
  const za = Math.max(z0, cam.z + CAM.near);
  const zb = z0 < cam.cut ? Math.min(z1, cam.cut) : z1;
  if (sideX !== null && zb > za) {
    for (let fy = top - 2; fy > -14; fy -= 2.6) {
      const h = hash(n * 31 + fy);
      if (h < 0.45) continue;
      const color = h > 0.93 ? (h > 0.965 ? "rgba(0, 240, 255, 0.55)" : "rgba(255, 42, 109, 0.55)") : `rgba(255, 205, 120, ${0.15 + h * 0.25})`;
      poly(ctx, [project(cam, sideX, fy, za), project(cam, sideX, fy, zb), project(cam, sideX, fy + 0.9, zb), project(cam, sideX, fy + 0.9, za)], color);
    }
  }
  const r = rectOf(front);
  if (!r || r.w < 6) return;
  // Windows on the front: a grid, by floor.
  const floors = (top + 30) / 2.6;
  const rowH = r.h / floors;
  if (rowH > 1.2) {
    const cols = Math.max(2, Math.round(r.w / Math.max(3, rowH)));
    for (let row = 0; row < floors && row * rowH < r.h; row++) {
      for (let col = 0; col < cols; col++) {
        if (hash(n * 97 + row * 13 + col * 7) < 0.62) continue;
        ctx.fillStyle = C.window;
        ctx.fillRect(r.x + (col + 0.25) * (r.w / cols), r.y + (row + 0.3) * rowH, (r.w / cols) * 0.5, rowH * 0.4);
      }
    }
  }
  // Now and then a neon ad near the top.
  if (hash(n * 5.7) > 0.7 && r.h > 20) {
    const [name, color, icon] = ADS[Math.floor(hash(n * 2.9) * ADS.length)];
    const ad = { x: r.x + r.w * 0.1, y: r.y + r.h * 0.04, w: r.w * 0.8, h: Math.min(r.h * 0.18, r.w * 0.5) };
    ctx.fillStyle = "rgba(8, 2, 20, 0.85)";
    ctx.fillRect(ad.x, ad.y, ad.w, ad.h);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeRect(ad.x, ad.y, ad.w, ad.h);
    ctx.shadowBlur = 0;
    inRect(ctx, { x: ad.x + ad.h * 0.15, y: ad.y + ad.h * 0.15, w: ad.h * 0.7, h: ad.h * 0.7 }, () => {
      ctx.fillStyle = color;
      icon(ctx);
    });
    label(ctx, name, ad.x + ad.h + (ad.w - ad.h) / 2, ad.y + ad.h * 0.65, fit(name, (ad.w - ad.h) * 0.9, ad.h * 0.45), color);
  }
}

/** A lamp pole on the deck's edge, its arm out over the track and a pool of light under it. */
function drawPole(ctx, g, cam, t) {
  const x = t.pole;
  const dir = x < 1 ? 1 : -1;
  box(ctx, cam, x - 0.04, x + 0.04, 0, 5.5, t.z, t.z + 0.15, { front: "#2a2a34", side: "#1a1a22" });
  const top = project(cam, x, 5.5, t.z);
  const lamp = project(cam, x + dir * 0.55, 5.3, t.z);
  if (!top || !lamp) return;
  ctx.strokeStyle = "#2a2a34";
  ctx.lineWidth = Math.max(1, top[2] * 0.05);
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(lamp[0], lamp[1]);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = "#fff1d0";
  ctx.shadowColor = "#ffd890";
  ctx.shadowBlur = 10;
  ctx.fillRect(lamp[0] - lamp[2] * 0.08, lamp[1], lamp[2] * 0.16, Math.max(1, lamp[2] * 0.04));
  ctx.shadowBlur = 0;
}

/** A lamp's pool of light on the deck (drawn with the deck, under everything on it). */
function drawPool(ctx, cam, t) {
  const floor = project(cam, t.pole + (t.pole < 1 ? 1 : -1) * 0.55, 0, t.z);
  if (!floor || t.z > cam.cut) return;
  const pool = ctx.createRadialGradient(floor[0], floor[1], 0, floor[0], floor[1], floor[2] * 0.9);
  pool.addColorStop(0, "rgba(255, 220, 160, 0.18)");
  pool.addColorStop(1, "rgba(255, 220, 160, 0)");
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(floor[0], floor[1], floor[2] * 0.9, floor[2] * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The tunnels in view: the portal (a megabuilding's face), then the tube in slices, with its ceiling lights. */
function tunnelParts(g, cam) {
  const out = [];
  for (const t of g.tunnels) {
    if (t.z0 > cam.z + CAM.near) out.push({ z: t.z0, len: 0.1, portal: t });
    const end = Math.min(t.z1, cam.cut + 30);
    let z = Math.max(t.z0, cam.z + CAM.near);
    while (z < end) {
      const next = Math.min(end, z + Math.max(1, (z - cam.z) * 0.12));
      out.push({ z, len: next - z, slice: [z, next] });
      z = next;
    }
  }
  return out;
}

/** Ramps are low, so they only clear the track crest at the very end. They darken over the last RAMP_FADE metres before the crest (0 lit, up to 0.8), so they come up out of the dark instead of popping in. */
const RAMP_FADE = 30;
const rampFade = (cam, z) => 0.8 * Math.min(1, Math.max(0, (z - (cam.cut - RAMP_FADE)) / RAMP_FADE));

/** How dark a point in a tunnel is, past the runner: 0 lit, 1 black. */
const darkness = (g, z) => Math.min(1, Math.max(0, (z - g.dist - DARK * 0.5) / DARK));

const shade = (rgb, k) => `rgb(${rgb.map(c => Math.round(c * (1 - k))).join(", ")})`;

/** A slice of tunnel: walls, ceiling, the light strips. */
function drawSlice(ctx, g, cam, [za, zb]) {
  const P = (x, y, z) => project(cam, x, y, z);
  const d = darkness(g, za);
  const roof = PHYSICS.tunnel;
  poly(ctx, [P(-0.85, 0, za), P(-0.85, 0, zb), P(-0.85, roof, zb), P(-0.85, roof, za)], shade([46, 42, 58], d));
  poly(ctx, [P(2.85, 0, za), P(2.85, 0, zb), P(2.85, roof, zb), P(2.85, roof, za)], shade([40, 36, 52], d));
  poly(ctx, [P(-0.85, roof, za), P(2.85, roof, za), P(2.85, roof, zb), P(-0.85, roof, zb)], shade([30, 27, 40], d));
  // Neon guide lines along the walls.
  poly(ctx, [P(-0.84, 1, za), P(-0.84, 1, zb), P(-0.84, 1.12, zb), P(-0.84, 1.12, za)], `rgba(0, 240, 255, ${0.8 * (1 - d)})`);
  poly(ctx, [P(2.84, 1, za), P(2.84, 1, zb), P(2.84, 1.12, zb), P(2.84, 1.12, za)], `rgba(255, 42, 109, ${0.8 * (1 - d)})`);
  // A light strip on the ceiling every 6 m.
  for (let m = Math.ceil(za / 6) * 6; m < zb; m += 6) {
    // Fading out right overhead, so a light passing over doesn't white out the screen.
    const near = Math.min(1, Math.max(0, (m - cam.z - 3) / 6));
    poly(ctx, [P(0.75, roof - 0.02, m), P(1.25, roof - 0.02, m), P(1.25, roof - 0.02, m + 0.8), P(0.75, roof - 0.02, m + 0.8)], `rgba(232, 244, 255, ${0.85 * near * (1 - d * 0.85)})`);
  }
}

/** A tunnel's megabuilding below the deck (its face, under the line). */
function drawPortalBase(ctx, cam, t) {
  const P = (x, y) => project(cam, x, y, t.z0);
  poly(ctx, [P(-9, -12), P(10.85, -12), P(10.85, 0), P(-9, 0)], "#1d1830");
}

/** A tunnel mouth: the line runs into a megabuilding, under a lit NCART sign, framed in hazard stripes. */
function drawPortal(ctx, g, cam, t) {
  const z = t.portal.z0;
  const P = (x, y) => project(cam, x, y, z);
  const roof = PHYSICS.tunnel;
  const face = "#1d1830";
  for (const [x0, x1, y0, y1] of [[-9, -0.85, 0, 30], [2.85, 10.85, 0, 30], [-0.85, 2.85, roof, 30]]) poly(ctx, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], face);
  const a = P(-9, 30);
  const b = P(10.85, -12);
  if (!a || !b) return;
  // Windows across the face.
  const unit = a[2] * HS * 2.6;
  if (unit > 1.5) {
    for (let fy = 0; fy < 16; fy++) {
      for (let col = 0; col < 26; col++) {
        const wx = -9 + col * 0.76;
        const wy = fy * 2.6;
        if ((wx > -1.2 && wx < 3.2 && wy < roof + 0.5) || hash(fy * 31 + col * 7 + z) < 0.55) continue;
        const p = P(wx, wy + 1.6);
        ctx.fillStyle = C.window;
        ctx.fillRect(p[0], p[1], a[2] * 0.35, unit * 0.35);
      }
    }
  }
  // Hazard frame around the opening, and the sign above it.
  const o0 = P(-0.85, roof);
  const o1 = P(2.85, 0);
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = Math.max(1.5, a[2] * 0.08);
  ctx.setLineDash([a[2] * 0.25, a[2] * 0.25]);
  ctx.strokeRect(o0[0], o0[1], o1[0] - o0[0], o1[1] - o0[1]);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  const s0 = P(-0.4, roof + 2.2);
  const s1 = P(2.4, roof + 0.6);
  const sign = { x: s0[0], y: s0[1], w: s1[0] - s0[0], h: s1[1] - s0[1] };
  ctx.fillStyle = "#0b0716";
  ctx.fillRect(sign.x, sign.y, sign.w, sign.h);
  ctx.strokeStyle = C.cyan;
  ctx.shadowColor = C.cyan;
  ctx.shadowBlur = 8;
  ctx.strokeRect(sign.x, sign.y, sign.w, sign.h);
  ctx.shadowBlur = 0;
  label(ctx, "NCART METRO", sign.x + sign.w / 2, sign.y + sign.h * 0.68, fit("NCART METRO", sign.w * 0.9, sign.h * 0.55), C.cyan);
}

/* ---------------- Pickups and the runner ---------------- */

/** A shard (a spinning cyan diamond) or a power-up (a hexagon with its two letters). */
function drawPickup(ctx, g, cam, p, calm) {
  const bob = calm ? 0 : Math.sin(g.t * 4 + p.z) * 0.12;
  const at = project(cam, p.lane, p.y + bob, p.z);
  if (!at) return;
  // Out of the way: fading as they reach the camera, and see-through when well above the runner's head.
  const high = p.y > g.y + PHYSICS.height + 1;
  ctx.globalAlpha = Math.min(1, Math.max(0, (p.z - cam.z - 1.5) / 3)) * (high ? 0.45 : 1);
  const s = at[2] * (high ? 0.16 : 0.22) * (p.shard ? 0.65 : 1);
  if (p.shard) {
    ctx.globalAlpha *= 0.7;
    const spin = calm ? 1 : Math.abs(Math.cos(g.t * 5 + p.z));
    ctx.fillStyle = C.shard;
    ctx.shadowColor = C.shard;
    ctx.shadowBlur = calm ? 0 : 6;
    ctx.beginPath();
    ctx.moveTo(at[0], at[1] - s);
    ctx.lineTo(at[0] + s * 0.6 * spin + 0.5, at[1]);
    ctx.lineTo(at[0], at[1] + s);
    ctx.lineTo(at[0] - s * 0.6 * spin - 0.5, at[1]);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }
  const r = s * 1.8;
  const color = POWER_COLORS[p.power];
  ctx.fillStyle = "rgba(10, 5, 20, 0.85)";
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = calm ? 0 : 8;
  ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) ctx.lineTo(at[0] + Math.cos((k * Math.PI) / 3) * r, at[1] + Math.sin((k * Math.PI) / 3) * r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  label(ctx, POWERS[p.power].tag, at[0], at[1] + r * 0.32, r * 0.85, color);
  ctx.globalAlpha = 1;
}

const R = {
  jacket: "#3a2547", jacketDark: "#271832", trim: "#00f0ff", pants: "#2a2f3b", pad: "#55596a", boot: "#141418",
  chrome: "#c9d1e0", chromeDark: "#7c8597", skin: "#b7896b", hair: "#1e1a1e", mohawk: "#ff2a6d", deck: "#20232c"
};

/**
 * The runner, from behind: a street kid with a pink mohawk, a cropped jacket with neon trim, a cyberdeck on
 * their back, a chrome right arm, cargo pants with knee pads and boots. They sprint, tuck in a jump, and
 * lean back into a slide with their chrome hand scraping sparks.
 */
function drawRunner(ctx, g, cam, calm) {
  const foot = project(cam, g.x, g.y, g.dist);
  if (!foot) return;
  const sliding = g.slide > 0;
  const u = foot[2] * HS * (PHYSICS.height / 18); // a eighteenth of the runner's standing height
  const [fx, fy] = foot;
  const P = (x, y) => [fx + x * u, fy + y * u];
  const limb = (a, b, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...P(...a));
    ctx.lineTo(...P(...b));
    ctx.stroke();
  };
  // Shadow on whatever's under them.
  const shadow = project(cam, g.x, g.ground, g.dist);
  if (shadow) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(shadow[0], shadow[1], 5 * u, 1.4 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const phase = g.dist * 1.7;
  const air = g.air && !sliding;

  if (sliding) {
    // Leaning right back: legs out ahead (short, seen from behind), body low, chrome hand on the deck.
    for (const side of [-1, 1]) {
      limb([side * 1.4, -2.2], [side * 1.6, -1], R.pants, 2.2);
      ctx.fillStyle = R.boot;
      ctx.fillRect(...P(side * 1.6 - 1.1, -1.2), 2.2 * u, 1.2 * u);
    }
    ctx.fillStyle = R.jacket;
    ctx.beginPath();
    ctx.moveTo(...P(-3, -1.8));
    ctx.lineTo(...P(3, -1.8));
    ctx.lineTo(...P(3.8, -6.5));
    ctx.lineTo(...P(-3.8, -6.5));
    ctx.fill();
    ctx.fillStyle = R.deck;
    ctx.fillRect(...P(-1.8, -6.2), 3.6 * u, 3 * u);
    limb([3.6, -5.8], [5.6, -0.4], R.chrome, 1.5);
    limb([-3.6, -5.8], [-4.4, -3.5], R.jacket, 1.7);
    ctx.fillStyle = R.hair;
    ctx.beginPath();
    ctx.arc(...P(0, -8), 1.6 * u, 0, Math.PI * 2);
    ctx.fill();
    mohawk(ctx, P, u, -8, calm);
    if (!calm) {
      ctx.fillStyle = C.yellow;
      for (let k = 0; k < 4; k++) {
        const [sx, sy] = P(5.6 + hash(g.t * 30 + k) * 3, -0.4 - hash(g.t * 40 + k) * 2);
        ctx.fillRect(sx, sy, Math.max(1, u * 0.4), Math.max(1, u * 0.4));
      }
    }
    aura(ctx, g, P, u, 4);
    ctx.lineWidth = 1;
    return;
  }

  const bounce = air ? 0 : Math.abs(Math.sin(phase)) * 0.5;
  const hipY = -9.5 - bounce;
  // Legs: thigh and shin; the leg swinging back lifts its boot (from behind, its sole shows).
  for (const side of [-1, 1]) {
    const lift = air ? 0.75 : Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0)));
    const knee = [side * 1.7, -5 - lift * 0.6 - (air ? 1.5 : 0)];
    const ankle = [side * 1.5, -0.8 - lift * 4.2 - (air ? 0.5 : 0)];
    limb([side * 1.3, hipY], knee, R.pants, 2.4);
    limb(knee, ankle, R.pants, 2.1);
    ctx.fillStyle = R.pad;
    ctx.fillRect(...P(knee[0] - 1, knee[1] - 0.6), 2 * u, 1.2 * u);
    ctx.fillStyle = R.boot;
    ctx.fillRect(...P(ankle[0] - 1.25, ankle[1] - 0.6), 2.5 * u, 1.9 * u);
    ctx.fillStyle = R.trim;
    ctx.fillRect(...P(ankle[0] - 1.25, ankle[1] + 1.05), 2.5 * u, 0.3 * u);
  }
  // Jacket: wider at the shoulders, twisting with the stride.
  const twist = air ? 0 : Math.sin(phase) * 0.35;
  const top = hipY - 6.2;
  ctx.fillStyle = R.jacket;
  ctx.beginPath();
  ctx.moveTo(...P(-2.7, hipY + 0.6));
  ctx.lineTo(...P(2.7, hipY + 0.6));
  ctx.lineTo(...P(3.7 + twist, top));
  ctx.lineTo(...P(-3.7 + twist, top));
  ctx.fill();
  ctx.fillStyle = R.jacketDark;
  ctx.fillRect(...P(-2.7, hipY - 0.2), 5.4 * u, 0.8 * u);
  ctx.strokeStyle = R.trim;
  ctx.lineWidth = Math.max(1, 0.35 * u);
  ctx.shadowColor = R.trim;
  ctx.shadowBlur = calm ? 0 : 6;
  ctx.beginPath();
  ctx.moveTo(...P(-2.7, hipY + 0.6));
  ctx.lineTo(...P(2.7, hipY + 0.6));
  ctx.moveTo(...P(-3.7 + twist, top));
  ctx.lineTo(...P(3.7 + twist, top));
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The cyberdeck on their back, its LEDs running, a cable up into their neck.
  ctx.fillStyle = R.deck;
  ctx.fillRect(...P(-1.9 + twist, top + 1.2), 3.8 * u, 3.6 * u);
  for (let k = 0; k < 4; k++) {
    const on = calm ? k % 2 : (Math.floor(g.t * 8) + k) % 4 === 0;
    ctx.fillStyle = on ? "#69f0ae" : "#1f4a35";
    ctx.fillRect(...P(-1.4 + twist + k * 0.8, top + 3.8), 0.5 * u, 0.5 * u);
  }
  limb([0.8 + twist, top + 1.2], [0.3, top - 0.5], "#111", 0.35);
  // Arms swinging against the legs: the left in its sleeve, the right all chrome.
  for (const side of [-1, 1]) {
    const swing = air ? -1 : Math.sin(phase + (side > 0 ? 0 : Math.PI));
    const shoulder = [side * 3.6 + twist, top + 0.4];
    const elbow = [side * 4.5 + twist * 0.5, top + 3.2 + swing * 0.9 - (air ? 1.5 : 0)];
    const hand = [side * 4.2, top + 5.6 + swing * 2 - (air ? 4 : 0)];
    const color = side > 0 ? R.chrome : R.jacket;
    limb(shoulder, elbow, color, 1.8);
    limb(elbow, hand, side > 0 ? R.chrome : R.skin, 1.5);
    if (side > 0) {
      ctx.fillStyle = R.chromeDark;
      ctx.beginPath();
      ctx.arc(...P(...elbow), 0.6 * u, 0, Math.PI * 2);
      ctx.fill();
      limb([shoulder[0] + 0.3, shoulder[1] + 0.6], [elbow[0] + 0.2, elbow[1]], R.trim, 0.25);
    }
  }
  // Neck, with its interface port glowing; the head, shaved at the sides; the mohawk.
  ctx.fillStyle = R.skin;
  ctx.fillRect(...P(-0.8, top - 1.2), 1.6 * u, 1.4 * u);
  ctx.fillStyle = R.trim;
  ctx.fillRect(...P(-0.25, top - 0.7), 0.5 * u, 0.5 * u);
  ctx.fillStyle = R.hair;
  ctx.beginPath();
  ctx.arc(...P(0, top - 2.6), 1.75 * u, 0, Math.PI * 2);
  ctx.fill();
  mohawk(ctx, P, u, top - 2.6, calm);
  aura(ctx, g, P, u, 10);
  ctx.lineWidth = 1;
}

/** The pink mohawk along the top of the head (centre at y `head`). */
function mohawk(ctx, P, u, head, calm) {
  ctx.fillStyle = R.mohawk;
  ctx.shadowColor = R.mohawk;
  ctx.shadowBlur = calm ? 0 : 6;
  ctx.beginPath();
  ctx.moveTo(...P(-0.6, head - 1.2));
  for (const [x, y] of [[-0.4, -3.6], [0, -2.4], [0.1, -4.2], [0.35, -2.4], [0.6, -3.4]]) ctx.lineTo(...P(x, head + y));
  ctx.lineTo(...P(0.65, head - 1.2));
  ctx.fill();
  ctx.shadowBlur = 0;
}

/** Armor's grey shell or Kerenzikov's red outline around the runner. */
function aura(ctx, g, P, u, mid) {
  ctx.lineCap = "butt";
  if (!g.powers.armor && !g.powers.kerenzikov) return;
  ctx.strokeStyle = g.powers.armor ? POWER_COLORS.armor : C.pink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(...P(0, -mid), 7 * u, mid * 1.2 * u, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}

/** Rain, falling past the camera. */
function drawRain(ctx, g) {
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.strokeStyle = "rgba(170, 200, 255, 0.22)";
  ctx.beginPath();
  for (let i = 0; i < 40; i++) {
    const x = (hash(i) * FIELD.w + g.t * 30) % FIELD.w;
    const y = (hash(i * 3.1) * FIELD.h + g.t * 520) % FIELD.h;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 9);
  }
  ctx.stroke();
}

/* ---------------- HUD and panels ---------------- */

/** Shards, distance, the running power-ups (what each does, and a bar for what's left) and warnings. */
function drawHud(ctx, g, fx, calm) {
  ctx.textAlign = "left";
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = C.shard;
  ctx.shadowColor = C.shard;
  ctx.shadowBlur = 6;
  ctx.fillText(`◆ ${g.shards}`, 10, 24);
  ctx.shadowBlur = 0;
  ctx.textAlign = "right";
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`${shownDist(g.dist)} m`, FIELD.w - 10, 22);
  ctx.font = "10px monospace";
  ctx.fillStyle = "#a9a3c0";
  ctx.fillText(`${shownSpeed(runSpeed(g) * worldScale(g))} km/h`, FIELD.w - 10, 35);
  let y = 46;
  for (const [id, left] of Object.entries(g.powers)) {
    const p = POWERS[id];
    const color = POWER_COLORS[id];
    // "SV Sandevistan", then what it does, dimmer; under them a bar for what's left.
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(5, 0, 15, 0.55)";
    ctx.fillRect(6, y - 10, 236, p.time ? 17 : 14);
    ctx.fillStyle = color;
    ctx.font = "bold 10px monospace";
    const name = `${p.tag} ${p.name}`;
    ctx.fillText(name, 10, y);
    ctx.fillStyle = "#c9c3dd";
    ctx.font = "9px monospace";
    ctx.fillText(p.time ? p.blurb : `${p.blurb}, once`, 10 + ctx.measureText(name).width * 1.12 + 6, y);
    if (p.time) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.fillRect(10, y + 3, 120, 2);
      ctx.fillStyle = color;
      ctx.fillRect(10, y + 3, 120 * Math.max(0, left / p.time), 2);
    }
    y += p.time ? 19 : 16;
  }
  // A train coming: a red marker over its lane, flashing (steady with Reduce motion).
  for (const w of fx.warnings) {
    const left = w.until - g.t;
    if (left <= 0 || (!calm && Math.floor(left * 6) % 2)) continue;
    const cx = FIELD.w / 2 + (w.lane - 1) * 70;
    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.moveTo(cx, y + 6);
    ctx.lineTo(cx + 14, y + 30);
    ctx.lineTo(cx - 14, y + 30);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("!", cx, y + 27);
    ctx.font = "bold 10px monospace";
    ctx.fillText("TRAIN", cx, y + 42);
  }
  for (const m of fx.messages) {
    const left = m.until - g.t;
    if (left <= 0) continue;
    // Low on the screen, out of the way of the track.
    ctx.globalAlpha = calm ? 1 : Math.min(1, left * 2);
    ctx.fillStyle = "rgba(5, 0, 15, 0.55)";
    ctx.fillRect(FIELD.w / 2 - 80, FIELD.h - 26, 160, 18);
    ctx.fillStyle = m.color;
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(m.text, FIELD.w / 2, FIELD.h - 13);
    ctx.globalAlpha = 1;
  }
  if (fx.muted !== undefined && g.t < 3) {
    ctx.textAlign = "right";
    ctx.font = "9px monospace";
    ctx.fillStyle = "#8f88a8";
    ctx.fillText(fx.muted ? "M: play music" : "M: mute music", FIELD.w - 10, 47);
  }
}

/**
 * One frame. `panel`: the title, pause or game-over panel (or the initials entry). `fx`: effects state kept
 * by the page ({ warnings, messages, shake, flash, cam, muted }).
 */
export function draw(ctx, g, panel, fx) {
  const calm = reduceMotion();
  ctx.save();
  if (fx.shake > 0 && !calm) ctx.translate((Math.random() - 0.5) * 8 * fx.shake, (Math.random() - 0.5) * 8 * fx.shake);
  const cam = camera(g, fx);
  fx.cam = cam;
  drawCity(ctx, g, cam, calm);
  drawBelow(ctx, g, cam);
  // Trackside scenery and the megabuildings' lower floors: all outside the deck's edges, so nothing out there
  // is ever in front of the deck or anything on it. Drawn first, far first, for the deck and trains to cover.
  // Scenery isn't on the track, so the crest doesn't cut it: it just sinks with the bend.
  const open = { ...cam, cut: Infinity };
  const scene = [
    ...scenery(g, cam),
    ...g.tunnels.filter(t => t.z0 > cam.z + CAM.near).map(t => ({ z: t.z0, len: 0.1, base: t }))
  ].sort((a, b) => b.z + (b.len ?? 0) - (a.z + (a.len ?? 0)));
  for (const t of scene) {
    const over = !!t.base && t.z > cam.cut;
    if (over) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, FIELD.w, cam.crest.y);
      ctx.clip();
    }
    if (t.building) drawBuilding(ctx, g, open, t);
    else if (t.pole !== undefined) drawPole(ctx, g, open, t);
    else drawPortalBase(ctx, cam, t.base);
    if (over) ctx.restore();
  }
  drawTrack(ctx, g, cam);
  for (const t of scene) if (t.pole !== undefined) drawPool(ctx, cam, t);
  const look = hasPower(g, "optics");
  const far = cam.cut + 40;
  // In a tunnel's dark, what's ahead darkens with the walls around it (no popping in), out to black; past
  // that only an oncoming train's lights show. TeleOptics sees it all.
  const dim = z => (!look && inTunnel(g, z) ? darkness(g, z) : 0);
  const hidden = z => dim(z) >= 1;
  const things = [
    ...tunnelParts(g, cam),
    ...g.obstacles.filter(o => o.z + o.len > cam.z + CAM.near && o.z < far).map(o => ({ z: o.z, len: o.len, o })),
    ...g.pickups.filter(p => !p.got && p.z > cam.z + CAM.near && p.z < far && !hidden(p.z)).map(p => ({ z: p.z, p })),
    { z: g.dist, runner: true }
  ];
  // Far first: long things (trains, tunnel slices) by their far end, so what's on or beside them draws over
  // them; but a train coming out of a tunnel mouth goes in front of the mouth.
  const mouths = g.tunnels.map(t => t.z0);
  const depth = t => {
    if (!(t.len > 3 || t.slice)) return t.z;
    const end = Math.min(t.z + t.len, Math.max(cam.cut, t.z));
    const mouth = t.o ? mouths.find(m => m > t.z && m < end) : undefined;
    return mouth === undefined ? end : mouth - 0.01;
  };
  // Ties (two long things both reaching the crest): the one starting further away first.
  things.sort((a, b) => depth(b) - depth(a) || b.z - a.z);
  for (const t of things) {
    // Over the crest: only what rises above the hill shows.
    const over = t.z > cam.cut;
    if (over) {
      if (t.o?.kind === "oncoming" && t.o.moving) drawTrainGlow(ctx, g, cam, t.o);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, FIELD.w, cam.crest.y);
      ctx.clip();
    }
    const d = t.o || t.p ? Math.max(dim(t.z), t.o?.kind === "ramp" ? rampFade(cam, t.z) : 0) : 0;
    if (d > 0 && d < 1) {
      ctx.save();
      ctx.filter = `brightness(${(1 - d).toFixed(2)})`;
    }
    if (t.o && d >= 1) {
      if (t.o.kind === "oncoming" && t.o.moving) drawHeadlights(ctx, cam, t.o);
    } else if (t.o) drawObstacle(ctx, g, cam, t.o, calm);
    else if (t.p) drawPickup(ctx, g, cam, t.p, calm);
    else if (t.slice) drawSlice(ctx, g, cam, t.slice);
    else if (t.portal) drawPortal(ctx, g, cam, t);
    else drawRunner(ctx, g, cam, calm);
    if (d > 0 && d < 1) {
      ctx.restore();
      // Its headlights cut through the dark, undimmed.
      if (t.o?.kind === "oncoming" && t.o.moving) drawHeadlights(ctx, cam, t.o);
    }
    if (over) ctx.restore();
  }
  if (!calm) drawRain(ctx, g);
  if (hasPower(g, "sandevistan")) {
    ctx.fillStyle = "rgba(120, 60, 255, 0.12)";
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  ctx.restore();
  if (fx.flash > 0 && !calm) {
    ctx.fillStyle = `rgba(255, 30, 60, ${fx.flash * 0.4})`;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  if (g.started && !panel?.full) drawHud(ctx, g, fx, calm);
  if (panel) drawPanel(ctx, g, panel);
}

/** The panel's box: returns its top and bottom. */
function drawFrame(ctx, accent, top = FIELD.h * 0.22, bottom = FIELD.h - 22) {
  ctx.fillStyle = "rgba(5, 0, 15, 0.85)";
  ctx.fillRect(14, top, FIELD.w - 28, bottom - top);
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.strokeRect(14, top, FIELD.w - 28, bottom - top);
  ctx.shadowBlur = 0;
  return { top, bottom };
}

/** Split a line to fit a width. */
function wrap(ctx, text, width) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The title / pause / game-over panel, with the leaderboard; or the initials entry. */
function drawPanel(ctx, g, panel) {
  if (panel.entry) return drawEntry(ctx, panel.entry);
  if (panel.paused) {
    const { top, bottom } = drawFrame(ctx, C.cyan, 160, 240);
    ctx.textAlign = "center";
    ctx.fillStyle = C.cyan;
    ctx.font = "bold 20px monospace";
    ctx.fillText("PAUSED", FIELD.w / 2, top + 32);
    ctx.fillStyle = "#d8e6ff";
    ctx.font = "12px monospace";
    ctx.fillText("P or Esc to run on", FIELD.w / 2, bottom - 20);
    return;
  }
  const { lines, board, best } = panel;
  const accent = g.over ? C.pink : C.cyan;
  const { top, bottom } = drawFrame(ctx, accent);
  let y = top + 24;
  ctx.textAlign = "center";
  lines.forEach((line, i) => {
    ctx.fillStyle = i ? "#d8e6ff" : accent;
    ctx.font = i ? "bold 12px monospace" : "bold 17px monospace";
    for (const part of wrap(ctx, line, FIELD.w - 44)) {
      ctx.fillText(part, FIELD.w / 2, y);
      y += i ? 16 : 21;
    }
  });
  y += 4;
  ctx.fillStyle = C.yellow;
  ctx.font = "bold 11px monospace";
  ctx.fillText("- LEADERBOARD -", FIELD.w / 2, y);
  y += 16;
  const rowH = 14;
  const rows = Math.max(0, Math.min(board.length, Math.floor((bottom - 44 - y) / rowH)));
  ctx.font = "11px monospace";
  for (const s of board.slice(0, rows)) {
    ctx.fillStyle = s.mine ? C.cyan : "#c9c3dd";
    ctx.textAlign = "left";
    ctx.fillText(`${String(s.rank).padStart(2)}. ${s.name.slice(0, 12)}`, 26, y);
    ctx.textAlign = "right";
    ctx.fillText(`◆${s.shards}  ${s.dist}m`, FIELD.w - 26, y);
    y += rowH;
  }
  if (!board.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#8f88a8";
    ctx.fillText("No runs yet. Be the first.", FIELD.w / 2, y);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#8f88a8";
  ctx.font = "10px monospace";
  ctx.fillText(best ? `Your best: ◆${best.shards}, ${best.dist} m` : "A/D lanes · W jump · S slide · P pause · M music", FIELD.w / 2, bottom - 26);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px monospace";
  ctx.fillText(g.over ? "Tap or Space to run again" : "Tap or Space to run", FIELD.w / 2, bottom - 9);
}

/** The initials entry's layout, in field units (as Flappy Chrome's). */
export const ENTRY = { slotW: 44, slotGap: 14, up: [190, 224], box: [224, 270], down: [270, 304], ok: { x: 104, y: 312, w: 80, h: 26 }, ms: 30_000 };
export const slotX = i => (FIELD.w - (3 * ENTRY.slotW + 2 * ENTRY.slotGap)) / 2 + i * (ENTRY.slotW + ENTRY.slotGap);

function arrow(ctx, cx, cy, dir) {
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 5 * dir);
  ctx.lineTo(cx + 8, cy + 5 * dir);
  ctx.lineTo(cx, cy - 5 * dir);
  ctx.fill();
}

/** NEW HIGH SCORE: the three initials, the selected one blinking, a countdown to OK. */
function drawEntry(ctx, { chars, slot, rank, shards, dist, left }) {
  const { bottom } = drawFrame(ctx, C.yellow, 100);
  const blink = reduceMotion() || Math.floor(Date.now() / 300) % 2;
  ctx.textAlign = "center";
  ctx.fillStyle = C.yellow;
  ctx.shadowColor = C.yellow;
  ctx.shadowBlur = blink ? 10 : 4;
  ctx.font = "bold 20px monospace";
  ctx.fillText("NEW HIGH SCORE!", FIELD.w / 2, 136);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d8e6ff";
  ctx.font = "bold 12px monospace";
  ctx.fillText(`Rank #${rank}   ◆${shards}   ${dist} m`, FIELD.w / 2, 158);
  ctx.fillStyle = C.cyan;
  ctx.fillText("ENTER YOUR INITIALS", FIELD.w / 2, 182);
  chars.forEach((ch, i) => {
    const x = slotX(i);
    const cx = x + ENTRY.slotW / 2;
    const on = i === slot;
    ctx.fillStyle = on ? C.cyan : "#6c6688";
    arrow(ctx, cx, (ENTRY.up[0] + ENTRY.up[1]) / 2 + 2, 1);
    arrow(ctx, cx, (ENTRY.down[0] + ENTRY.down[1]) / 2 - 2, -1);
    const [y0, y1] = ENTRY.box;
    ctx.fillStyle = on ? "rgba(0, 240, 255, 0.12)" : "rgba(255, 255, 255, 0.04)";
    ctx.fillRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.strokeStyle = on ? C.cyan : "#3d3758";
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.lineWidth = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px monospace";
    ctx.fillText(ch, cx, y1 - 11);
  });
  const { x, y, w, h } = ENTRY.ok;
  ctx.fillStyle = C.pink;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px monospace";
  ctx.fillText("OK", x + w / 2, y + 18);
  ctx.fillStyle = "#8f88a8";
  ctx.font = "11px monospace";
  ctx.fillText(`Tap the arrows or type  ${left}`, FIELD.w / 2, bottom - 8);
}

import {
  bestLap, CLASSES, clock, deltaTo, DISTRICTS, fieldSize, ghostAt, heightAt, inZone, kmh, lapOf, PHYSICS, position, ROAD,
  SEG, sectionOf, seenHas, split, START, trackPos, WALL
} from "./model.js";
import { calm, clamp01, fit, glow, hash, label, lerp, mix, poly } from "./gfx.js";
import { drawRide, PAINT, PLAYER_PAINT } from "./rides.js";
import { drawHud, drawPreviewHud, trackExtra as extra } from "./hud.js";
export { drawCard } from "./hud.js";
import { drawProp, drawSky, flames, props } from "./scenery.js";

/*
 * REDLINE's drawing (the game is apps/redline/model.js, the page apps/redline/page.js): the classic
 * pseudo-3D road. The track ahead is cut into segments, each projected from a camera behind and above the
 * player's ride; bends shift each segment sideways by the sum of the bends before it, hills lift it, and a
 * hill hides what's behind it (each segment only draws where the nearer ones left sky). Everything on the
 * road (rides, hazards, roadside) is drawn far to near, clipped to its segment's hill line. Each district
 * has its own sky, palette and roadside. With Reduce motion: no shake, flashing or rain.
 */

/** The playfield, in canvas units (as NCART Runner's). */
export const FIELD = { w: 288, h: 400 };

/** The camera: metres behind and above the ride, the focal length, where the horizon sits, how far it sees. */
const CAM = { back: 5.6, height: 3.7, focal: 210, horizon: 162, near: 1, draw: 150, follow: 0.85 };
/** Bends on screen are this much of the real ones (keeps the road on screen in hairpins). */
const VCURVE = 0.6;
/** Segments per colour band (the road's stripes going by). */
const BAND = 3;

/* ---------------- Palettes ---------------- */

const LOOKS = {
  combat: {
    sky: ["#05020a", "#1c0820", "#3a0d22"], far: "#12060f", glow: "rgba(255, 70, 40, 0.18)",
    ground: ["#0d0b10", "#110e15"], road: ["#1d1b22", "#211f26"], rumble: ["#ff2a6d", "#2a2430"], lane: "#6b6370",
    fog: "#0b0610", draw: 105, dark: true
  },
  corpo: {
    sky: ["#030622", "#0c1a4a", "#3a1f6d"], far: "#0a1030", glow: "rgba(0, 200, 255, 0.16)",
    ground: ["#16181f", "#1b1d25"], road: ["#2a2c35", "#2e3039"], rumble: ["#00f0ff", "#e8e8f0"], lane: "#d8dce8",
    fog: "#141a3a", draw: 150
  },
  badlands: {
    sky: ["#1a0a2e", "#7a2d4e", "#f08a3c"], far: "#4a1f35", glow: "rgba(255, 160, 60, 0.2)",
    ground: ["#7a5232", "#84593a"], road: ["#3a3236", "#3f363a"], rumble: ["#f5d300", "#3a3236"], lane: "#f5d300",
    fog: "#c4703e", draw: 150
  },
  pacifica: {
    sky: ["#020b14", "#0b2a3a", "#5a1f5e"], far: "#0b1c26", glow: "rgba(255, 60, 200, 0.16)",
    ground: ["#0b2430", "#0d2a37"], road: ["#1e2a30", "#222f36"], rumble: ["#ff2a6d", "#00f0ff"], lane: "#9fd8e8",
    fog: "#0d2230", draw: 130, rain: true
  }
};
const SAND = { fog: "#b4733f", draw: 55 };

/** Traffic colours, by kind. */
const TRAFFIC_PAINT = {
  car: ["#5a6070", "#6c5048", "#405a50", "#706a58"], taxi: ["#f5c400"], truck: ["#8a7a66"], gang: ["#c01830"], cop: ["#e8eaf2"],
  van: ["#d8d8dc", "#9aa4b0", "#c8b070", "#6a7a8a"], semi: ["#c8ccd4", "#a4aab4", "#d4cfc4"]
};
/** Names on the back of semis. */
const LOGOS = ["PETROCHEM", "SOVOIL", "BIOTECHNICA", "KANG TAO", "ORBITAL AIR", "MILITECH", "CHOOH2"];

/* ---------------- Projection ---------------- */

/**
 * The view for this frame: the camera, and each segment boundary ahead projected ({ z, xo (the road's
 * centre offset, metres), y (world height), scale, sx, sy, w (road half-width on screen), clip }).
 */
function view(g, fx) {
  const { track, p } = g;
  const look = { ...LOOKS[track.spec.district] };
  // The start arch's lights follow the countdown (1–3 red, 4 green; none once the race is going).
  look.lights = g.t < 0 ? 4 - Math.ceil(-g.t) : g.t < 2 ? 4 : 0;
  const sp = trackPos(track, p.total);
  const sand = inZone(track, sp, "sand");
  const draw = Math.min(look.draw, sand ? SAND.draw : Infinity);
  const sc = sp - CAM.back;
  const base = Math.floor(sc / SEG);
  const frac = sc / SEG - base;
  const lift = p.air > 0 ? Math.sin(Math.min(1, p.air / Math.max(0.01, (PHYSICS.air * Math.max(p.v, 12)) / 10)) * Math.PI) * 1.4 : 0;
  // The camera rides a little smoothed over the hills.
  const ground = heightAt(track, sp);
  const camY = (fx.camY = fx.camY === undefined ? ground : lerp(fx.camY, ground, 0.2)) + CAM.height + (CLASSES[g.cls].bike ? -0.4 : 0);
  const camX = p.x * CAM.follow;
  const pts = [];
  let xo = 0;
  let hd = 0;
  for (let i = 0; i <= draw; i++) {
    const z = (i - frac) * SEG;
    const seg = segAt(track, base + i);
    const y = heightAt(track, (base + i) * SEG);
    // (The boundary behind the camera is drawn as if just in front of it, so the road reaches the bottom.)
    const scale = CAM.focal / Math.max(z, CAM.near);
    pts.push({
      i, z, xo, y, scale, seg: base + i, k: seg.k,
      sx: scale ? FIELD.w / 2 + (xo - camX) * scale : 0,
      sy: scale ? CAM.horizon + (camY - y) * scale : FIELD.h,
      w: scale ? ROAD * scale : 0
    });
    // On to the next boundary (the first step is only what's left of the camera's segment, measured from
    // the camera: the boundary behind it sits on the camera's line).
    const step = i === 0 ? (1 - frac) * SEG : SEG;
    const k = seg.k * VCURVE;
    xo += hd * step + 0.5 * k * step * step;
    hd += k * step;
  }
  return { look, sand, draw, camY, camX, pts, sp, sc, base, frac, lift };
}

/** A segment by its index along the geometry (wrapping on a circuit, held at the ends of a sprint). */
function segAt(track, i) {
  const n = track.n;
  return track.segs[track.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))];
}

/**
 * A point on the road: `dz` metres ahead of the camera, `x` across, `h` up. Returns { sx, sy, scale, clip }
 * or null (behind the camera or past the draw distance).
 */
function at(v, dz, x, h = 0) {
  if (dz <= CAM.near) return null;
  const f = dz / SEG + v.frac;
  const i = Math.floor(f);
  if (i < 0 || i >= v.pts.length - 1) return null;
  const a = v.pts[i];
  const b = v.pts[i + 1];
  const k = f - i;
  const xo = lerp(a.xo, b.xo, k);
  const y = lerp(a.y, b.y, k);
  const scale = CAM.focal / dz;
  return { sx: FIELD.w / 2 + (xo + x - v.camX) * scale, sy: CAM.horizon + (v.camY - y - h) * scale, scale, clip: b.clip ?? FIELD.h, dz };
}

/** How far ahead of the camera a point along the track is (the short way round a circuit). */
function ahead(g, v, s) {
  let dz = s - v.sc;
  const L = g.track.len;
  if (g.track.closed) {
    dz = ((dz % L) + L) % L;
    if (dz > L - 20) dz -= L;
  }
  return dz;
}

/* ---------------- Sky and road ---------------- */

function sky(ctx, g, v) {
  // The skyline drifts the other way as the road turns.
  const { heading } = extra(g.track);
  const seg = Math.max(0, Math.min(heading.length - 1, Math.floor(v.sp / SEG)));
  const drift = (heading[seg] ?? 0) * 140 - v.camX * 0.6;
  drawSky(ctx, { look: v.look, district: g.track.spec.district, drift, camX: v.camX, horizon: CAM.horizon, W: FIELD.w });
}

function quad(ctx, x1, y1, w1, x2, y2, w2, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - w1, y1);
  ctx.lineTo(x2 - w2, y2);
  ctx.lineTo(x2 + w2, y2);
  ctx.lineTo(x1 + w1, y1);
  ctx.closePath();
  ctx.fill();
}

/** The road near to far, each segment only below the hill line so far; records each segment's clip line. */
function drawRoad(ctx, g, v) {
  const { look, pts } = v;
  const fogColor = v.sand ? SAND.fog : look.fog;
  let maxy = FIELD.h;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    b.clip = maxy;
    if (!a.scale || !b.scale) {
      continue;
    }
    if (b.sy >= maxy || b.sy >= a.sy - 0.01) {
      continue;
    }
    const band = Math.floor(((a.seg % 1e6) + 1e6) / BAND) % 2;
    const fog = Math.min(1, (i / v.draw) ** 1.6 * (v.sand ? 1.4 : 1));
    const tint = c => (fog > 0.02 ? mix(c, fogColor, fog) : c);
    const y1 = Math.min(a.sy, maxy);
    // Ground across the whole width.
    ctx.fillStyle = tint(look.ground[band]);
    ctx.fillRect(0, b.sy, FIELD.w, y1 - b.sy + 1);
    // Shoulders, rumble strips, road, lane lines.
    quad(ctx, a.sx, a.sy, a.w * (WALL / ROAD), b.sx, b.sy, b.w * (WALL / ROAD), tint(mix(look.ground[band], look.road[band], 0.55)));
    quad(ctx, a.sx, a.sy, a.w * 1.08, b.sx, b.sy, b.w * 1.08, tint(look.rumble[band]));
    quad(ctx, a.sx, a.sy, a.w, b.sx, b.sy, b.w, tint(look.road[band]));
    if (band) {
      for (const lane of [-0.5, 0, 0.5]) {
        const lw = (a.w / ROAD) * (lane === 0 ? 0.08 : 0.055);
        const lw2 = (b.w / ROAD) * (lane === 0 ? 0.08 : 0.055);
        quad(ctx, a.sx + a.w * lane, a.sy, lw, b.sx + b.w * lane, b.sy, lw2, tint(lane === 0 ? look.rumble[0] : look.lane));
      }
    }
    // The start/finish line.
    const sAt = ((a.seg * SEG) % g.track.len + g.track.len) % g.track.len;
    if (Math.abs(sAt - START) < SEG / 2 || (!g.track.closed && Math.abs(a.seg * SEG - (g.track.finish + START)) < SEG / 2)) {
      const w = a.w;
      for (let c = -4; c < 4; c++) {
        ctx.fillStyle = c % 2 ? "#fff" : "#111";
        ctx.fillRect(a.sx + (c / 4) * w, b.sy, w / 4, Math.max(1, a.sy - b.sy));
      }
    }
    maxy = b.sy;
  }
  v.pts.at(-1).clip ??= maxy;
}

/** The walls either side, by district: height (m), the face's two shades, the cap (neon on some), a guard rail instead. */
const WALLS = {
  combat: { h: 0.95, face: ["#2a2430", "#231e28"], cap: "#4a4450" },
  corpo: { h: 0.85, face: ["#363a48", "#2f3342"], cap: "#00f0ff", neon: true },
  badlands: { h: 0.75, rail: true, face: ["#a4a8b0", "#8a8e96"], post: "#4a4038" },
  pacifica: { h: 1.0, face: ["#2c3a40", "#25333a"], cap: "#ff2a6d", neon: true }
};

/** One segment's walls (both sides), clipped to the hill line in front of it. */
function drawWall(ctx, g, v, i) {
  const a = v.pts[i];
  const b = v.pts[i + 1];
  if (!a.scale || !b.scale || b.sy >= a.sy + 40) return;
  const look = WALLS[g.track.spec.district] ?? WALLS.combat;
  const clip = b.clip ?? FIELD.h;
  const ha = look.h * a.scale;
  const hb = look.h * b.scale;
  if (Math.min(a.sy - ha, b.sy - hb) >= clip) return;
  const band = Math.floor(((a.seg % 1e6) + 1e6) / BAND) % 2;
  const fog = Math.min(1, (i / v.draw) ** 1.6);
  const fogColor = v.sand ? SAND.fog : v.look.fog;
  const tint = c => (fog > 0.02 ? mix(c, fogColor, fog) : c);
  const paint = () => {
    for (const side of [-1, 1]) {
      const xa = a.sx + side * a.w * (WALL / ROAD);
      const xb = b.sx + side * b.w * (WALL / ROAD);
      if (look.rail) {
        // A steel rail on posts.
        ctx.fillStyle = tint(look.face[band]);
        poly(ctx, [[xa, a.sy - ha * 0.45], [xb, b.sy - hb * 0.45], [xb, b.sy - hb], [xa, a.sy - ha]]);
        ctx.fill();
        if (a.seg % 2 === 0) {
          ctx.fillStyle = tint(look.post);
          ctx.fillRect(xa - Math.max(0.5, 0.06 * a.scale), a.sy - ha, Math.max(1, 0.12 * a.scale), ha);
        }
        continue;
      }
      ctx.fillStyle = tint(look.face[band]);
      poly(ctx, [[xa, a.sy], [xb, b.sy], [xb, b.sy - hb], [xa, a.sy - ha]]);
      ctx.fill();
      ctx.fillStyle = tint(look.cap);
      const ca = Math.max(0.6, 0.08 * a.scale);
      const cb = Math.max(0.6, 0.08 * b.scale);
      poly(ctx, [[xa, a.sy - ha], [xb, b.sy - hb], [xb, b.sy - hb - cb], [xa, a.sy - ha - ca]]);
      ctx.fill();
      if (look.neon && fog < 0.9) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25 * (1 - fog);
        poly(ctx, [[xa, a.sy - ha + ca * 2], [xb, b.sy - hb + cb * 2], [xb, b.sy - hb - cb * 3], [xa, a.sy - ha - ca * 3]]);
        ctx.fill();
        ctx.restore();
      }
    }
  };
  if (Math.max(a.sy, b.sy) <= clip) paint();
  else clipped(ctx, clip, paint);
}

/* ---------------- Things on and beside the road ---------------- */

/** Draw `fn` clipped to the hill line in front of a point. */
function clipped(ctx, clip, fn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, FIELD.w, clip);
  ctx.clip();
  fn();
  ctx.restore();
}

/** A hazard lying on the road (pothole, flood, ramp), as a patch between its near and far edges. */
function drawPatch(ctx, g, v, h, color, edge) {
  // In slices a segment long, so a long patch (a flood) follows the bends.
  const d0 = Math.max(CAM.near + 0.5, ahead(g, v, h.s));
  const d1 = ahead(g, v, h.s) + h.len;
  if (d1 <= d0) return;
  const steps = Math.max(1, Math.ceil((d1 - d0) / SEG));
  const pts = Array.from({ length: steps + 1 }, (_, i) => at(v, lerp(d0, d1, i / steps), 0));
  const first = pts[0];
  if (!first) return;
  const x0 = Math.max(-WALL, h.x0);
  const x1 = Math.min(WALL, h.x1);
  const edgeAt = (p, x) => [p.sx + x * p.scale, p.sy];
  const shown = pts.filter(Boolean);
  if (h.kind === "pothole") {
    // A ragged hole: dark inside, broken light asphalt round the rim (it has to show on the darkest road).
    const far = shown.at(-1);
    clipped(ctx, first.clip, () => {
      const cx = ((first.sx + far.sx) / 2) + ((x0 + x1) / 2) * ((first.scale + far.scale) / 2);
      const cy = (first.sy + far.sy) / 2;
      const rx = ((x1 - x0) / 2) * ((first.scale + far.scale) / 2);
      const ry = Math.max(0.8, (first.sy - far.sy) / 2);
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 1.12, ry * 1.25 + 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.1, rx * 0.9, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(140, 160, 200, 0.18)";
      ctx.beginPath();
      ctx.ellipse(cx + rx * 0.15, cy + ry * 0.35, rx * 0.45, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }
  // Hidden only behind a hill in front of its near edge (past a crest the road's own clip hides the rest).
  clipped(ctx, first.clip, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    shown.forEach((p, i) => (i ? ctx.lineTo(...edgeAt(p, x0)) : ctx.moveTo(...edgeAt(p, x0))));
    for (const p of [...shown].reverse()) ctx.lineTo(...edgeAt(p, x1));
    ctx.closePath();
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (h.kind === "flood") {
      // Ripples across the water, drifting toward you.
      ctx.strokeStyle = "rgba(210, 245, 255, 0.55)";
      const drift = calm() ? 0 : (performance.now() / 900) % 1;
      for (let i = 0; i < steps; i++) {
        const p = at(v, lerp(d0, d1, (i + drift) / steps), 0);
        if (!p) continue;
        ctx.beginPath();
        ctx.moveTo(...edgeAt(p, x0 + 0.4));
        ctx.lineTo(...edgeAt(p, x1 - 0.4));
        ctx.stroke();
      }
    }
  });
}

/** A hazard that stands up (barrier, wreck, burning ride, ramp face). */
function drawHazard(ctx, g, v, h, p, still) {
  const s = p.scale;
  const x0 = p.sx + (Math.max(-WALL, h.x0) - 0) * s;
  const x1 = p.sx + (Math.min(WALL, h.x1) - 0) * s;
  const w = x1 - x0;
  const blink = still || Math.floor(performance.now() / 250) % 2;
  if (h.kind === "checkpoint" || h.kind === "roadblock") {
    const hgt = 1.1 * s;
    const stripes = h.kind === "checkpoint" ? ["#e8e8f0", "#1a3cff"] : ["#f5d300", "#1a1a1a"];
    ctx.fillStyle = stripes[1];
    ctx.fillRect(x0, p.sy - hgt, w, hgt);
    ctx.fillStyle = stripes[0];
    const step = Math.max(2, 0.8 * s);
    for (let x = x0; x < x1; x += step * 2) ctx.fillRect(x, p.sy - hgt, Math.min(step, x1 - x), hgt * 0.55);
    if (h.kind === "checkpoint") {
      // Lights on the barrier, blue and red.
      ctx.fillStyle = blink ? "#3d6bff" : "#ff2a3d";
      ctx.fillRect(x0 + w * 0.1, p.sy - hgt - 0.3 * s, 0.6 * s, 0.3 * s);
      ctx.fillStyle = blink ? "#ff2a3d" : "#3d6bff";
      ctx.fillRect(x1 - w * 0.1 - 0.6 * s, p.sy - hgt - 0.3 * s, 0.6 * s, 0.3 * s);
      if (s > 2) label(ctx, "NCPD", (x0 + x1) / 2, p.sy - hgt * 0.15, Math.min(hgt * 0.45, w / 3), "#1a3cff");
    } else {
      // Maelstrom junk on top.
      ctx.fillStyle = "#4a2a2a";
      for (let x = x0; x < x1; x += 2.2 * s) ctx.fillRect(x, p.sy - hgt - 0.5 * s, 1.2 * s, 0.5 * s);
      if (s > 2) label(ctx, "MAELSTROM", (x0 + x1) / 2, p.sy - hgt * 0.15, Math.min(hgt * 0.4, w / 6), "#ff2a3d");
    }
  } else if (h.kind === "wreck" || h.kind === "fire") {
    // A burnt-out shell the size of what's in the way (a bike's is a heap).
    const mid = (x0 + x1) / 2;
    const half = Math.min(1.05, (h.x1 - h.x0) / 2) * s;
    const tall = h.bike ? 0.6 : 1;
    ctx.fillStyle = "#2a2226";
    ctx.fillRect(mid - half, p.sy - 1.0 * tall * s, half * 2, 1.0 * tall * s);
    if (!h.bike) {
      ctx.fillStyle = "#18131a";
      ctx.fillRect(mid - half * 0.72, p.sy - 1.5 * s, half * 1.44, 0.52 * s);
    }
    flames(ctx, mid, p.sy - 1.2 * tall * s, half * 1.6, s * tall);
  } else if (h.kind === "ramp") {
    // The ramp's face, rising away from us.
    const far = at(v, ahead(g, v, h.s + h.len), 0, 1.4);
    if (!far) return;
    ctx.fillStyle = "#6b5a40";
    ctx.beginPath();
    ctx.moveTo(x0, p.sy);
    ctx.lineTo(far.sx + h.x0 * far.scale, far.sy);
    ctx.lineTo(far.sx + h.x1 * far.scale, far.sy);
    ctx.lineTo(x1, p.sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#f5d300";
    ctx.lineWidth = Math.max(1, 0.1 * s);
    ctx.stroke();
  }
}

/* ---------------- Hits ---------------- */

/** A hit landing: a burst of lines at a point. */
function burst(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const k = i % 2 ? 0.55 : 1;
    ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
    ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
  }
  ctx.stroke();
}

/* ---------------- The frame ---------------- */

/**
 * One frame. `fx`: effects kept by the page ({ messages: [{ text, color, until }], shake, flash, camY,
 * tag (the player's plate), ref (the ghost the split is against), backfire, preview (the GM's fly-through),
 * menu (behind the start menu: no ride of yours, no HUD) }).
 */
export function draw(ctx, g, fx) {
  const still = calm();
  ctx.save();
  if (fx.shake > 0 && !still) ctx.translate((Math.random() - 0.5) * 6 * fx.shake, (Math.random() - 0.5) * 6 * fx.shake);
  const v = view(g, fx);
  sky(ctx, g, v);
  drawRoad(ctx, g, v);
  const range = v.draw * SEG;
  const things = [];
  // The walls, a segment at a time.
  for (let i = 0; i < v.pts.length - 1; i++) things.push({ dz: (i + 0.5 - v.frac) * SEG, wall: i });
  // Roadside, by segment.
  const finishSeg = g.track.closed ? null : Math.round((g.track.finish + START) / SEG);
  for (let i = 1; i < v.pts.length - 1; i++) {
    const seg = v.pts[i].seg;
    const j = g.track.closed ? ((seg % g.track.n) + g.track.n) % g.track.n : seg;
    for (const t of props(g.track.spec.district, j, v.pts[i].k, finishSeg)) things.push({ dz: (i - v.frac) * SEG, x: t.x, scene: t });
  }
  // Hazards and burning wrecks.
  for (const h of [...g.track.hazards, ...g.fires]) {
    const dz = ahead(g, v, h.s);
    if (dz + h.len < CAM.near || dz > range) continue;
    if (h.kind === "pothole" || h.kind === "flood") things.push({ dz: dz + h.len, patch: h });
    else if (h.kind === "ramp") things.push({ dz: Math.max(dz, CAM.near + 0.5), hz: h });
    else things.push({ dz, hz: h, x: 0 });
  }
  // Rides: the pack, traffic, ghosts, the player. Anyone winding up a swing (or a swerve) shows it.
  const rel = total => ahead(g, v, trackPos(g.track, total));
  const night = !!v.look.dark || g.track.spec.district === "pacifica";
  const moves = e => (e.atk?.phase === "wind" ? { windup: e.atk.side } : e.atk?.phase === "swing" ? { punch: e.atk.side } : {});
  g.racers.forEach((r, i) => {
    if (r.out) return;
    things.push({ dz: rel(r.total), x: r.x, id: r.id, ride: { bike: r.c.bike, w: r.c.w, paint: PAINT[i % PAINT.length], lean: 0, kind: "racer", cls: r.cls, brake: false, spin: r.total, night, ...moves(r) }, name: r.name });
  });
  for (const t of g.traffic) {
    if (t.out) continue;
    const paints = TRAFFIC_PAINT[t.kind] ?? TRAFFIC_PAINT.car;
    const pick = Math.abs(Math.round(Number(t.id.slice(1)) * 7.3));
    things.push({
      dz: rel(t.total), x: t.x, id: t.id,
      ride: {
        bike: t.kind === "gang", w: t.w, paint: paints[pick % paints.length], kind: t.kind, lights: t.kind === "cop", helmet: t.kind === "gang" ? "#2a0a10" : null,
        logo: t.kind === "semi" || t.kind === "van" ? LOGOS[pick % LOGOS.length] : null, spin: t.total, night, brake: t.v < (t.cruise ?? t.v) - 3, ...moves(t)
      }
    });
  }
  for (const gh of g.ghosts) {
    const pos = ghostAt(gh, Math.max(0, g.t));
    const c = CLASSES[gh.cls];
    things.push({ dz: rel(pos.total), x: pos.x, ghost: gh, ride: { bike: c.bike, w: c.w, paint: "#7fe9ff", helmet: "#7fe9ff", kind: "ghost", cls: gh.cls, spin: pos.total } });
  }
  const p = g.p;
  const pc = CLASSES[g.cls];
  if (!fx.preview && !fx.menu) {
    things.push({
      dz: CAM.back, x: p.x, me: true, id: "me",
      ride: {
        bike: pc.bike, w: pc.w, paint: PLAYER_PAINT, lean: p.steer, brake: !!fx.braking, tag: fx.tag, punch: p.punch > PHYSICS.punchCool - 0.22 ? p.punchSide : 0,
        kind: "me", cls: g.cls, helmet: "#ff2a6d", spin: p.total, night, backfire: fx.backfire ?? 0
      }
    });
  }
  things.sort((a, b) => b.dz - a.dz);
  for (const t of things) {
    if (t.wall !== undefined) {
      drawWall(ctx, g, v, t.wall);
      continue;
    }
    if (t.patch) {
      const h = t.patch;
      if (h.kind === "flood") drawPatch(ctx, g, v, h, "rgba(60, 175, 255, 0.62)", "rgba(200, 240, 255, 0.85)");
      else drawPatch(ctx, g, v, h, "#050407", "rgba(190, 168, 140, 0.95)");
      continue;
    }
    // Rides just behind you (between you and the camera) would fill the screen: they fade out instead.
    const behind = t.ride && !t.me ? clamp01((t.dz - CAM.back * 0.55) / (CAM.back * 0.4)) : 1;
    if (behind <= 0) continue;
    const pt = at(v, t.dz, t.x ?? 0, t.me ? v.lift : 0);
    if (!pt) continue;
    const fog = Math.min(1, (t.dz / range) ** 1.6);
    clipped(ctx, t.me ? FIELD.h : pt.clip, () => {
      // (Props right by the camera would fill the screen: they fade out as they go by.)
      if (t.scene) drawProp(ctx, t.scene, pt, v.look, fog, t.x ? null : { sx: pt.sx, w: ROAD * pt.scale }, clamp01((t.dz - 2.5) / 4));
      else if (t.hz) drawHazard(ctx, g, v, t.hz, at(v, t.dz, 0) ?? pt, still);
      else if (t.ride) {
        ctx.globalAlpha = (t.ghost ? (still ? 0.4 : 0.32 + 0.1 * Math.sin(performance.now() / 70)) : 1) * behind;
        // Ghosts are holograms: light added, not paint.
        if (t.ghost) ctx.globalCompositeOperation = "lighter";
        // Wrecked and getting going again (and a moment after): flickering, untouchable.
        if (t.me && (p.wreck > 0 || p.grace > 0)) ctx.globalAlpha = still ? 0.55 : Math.floor(performance.now() / 90) % 2 ? 0.85 : 0.3;
        // Far off, rides sink into the fog (an alpha fade: a canvas filter is too slow for this many draws).
        if (fog > 0.05 && !t.me) ctx.globalAlpha *= 1 - fog * 0.75;
        drawRide(ctx, pt.sx, pt.sy, pt.scale, t.ride);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        if (t.ghost && pt.scale > 3) label(ctx, t.ghost.label || "GHOST", pt.sx, pt.sy - (t.ride.bike ? 2.3 : 1.8) * pt.scale, Math.min(10, pt.scale * 0.5), "#7fe9ff");
        // A hit just landed on them (or on you).
        const hit = fx.hits?.[t.id];
        if (hit && hit.until > g.t) burst(ctx, pt.sx + (hit.side ?? 0) * pt.scale * 0.5, pt.sy - (t.ride.bike ? 1.5 : 1) * pt.scale, Math.max(6, 0.9 * pt.scale), hit.color ?? "#f5d300");
      }
    });
  }
  // Dust, dark, rain.
  if (v.sand) {
    ctx.fillStyle = "rgba(196, 120, 62, 0.28)";
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  if (v.look.rain && !still) drawRain(ctx, g);
  ctx.restore();
  if (fx.flash > 0 && !still) {
    ctx.fillStyle = `rgba(255, 30, 60, ${fx.flash * 0.35})`;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  if (!fx.menu) {
    if (fx.preview) drawPreviewHud(ctx, g, v);
    else drawHud(ctx, g, fx, still);
  }
}

function drawRain(ctx, g) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(170, 200, 255, 0.2)";
  ctx.beginPath();
  for (let i = 0; i < 36; i++) {
    const x = (hash(i) * FIELD.w + g.t * 40) % FIELD.w;
    const y = (hash(i * 3.1) * FIELD.h + g.t * 560) % FIELD.h;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y + 10);
  }
  ctx.stroke();
}

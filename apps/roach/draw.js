import { FIELD, flyerAt, horseX, KINDS, PHYSICS, runSpeed, stageLabel } from "./model.js";
import { reduceMotion } from "../../scripts/ui/a11y.js";

/*
 * Roach Race's drawing (the game is apps/roach/model.js, the page apps/roach/page.js): a 2D arcade
 * side-scroller in the style of the 2077 cabinet. The sky goes from day (1-1) through sunset and dusk to
 * night (1-4) and round again each loop; mountains, a far keep, hills and pines scroll behind. Roach is
 * drawn in the steed's colours (apps/roach/model.js STEEDS), galloping, tucked in the air, on two legs with
 * a carrot, and split into red and cyan while glitched. Scanlines over it all, like the cabinet's CRT.
 * With Reduce motion: no shake, flash or flicker, and the wings and gallop slow down.
 */

export { FIELD };

const C = {
  gold: "#f5c542", red: "#e0303a", cyan: "#3fe0ff", ink: "#120a05", text: "#f3ead2", dim: "#a89c80",
  panel: "rgba(18, 10, 5, 0.88)", wood: "#8b5a2b", woodDark: "#5a3618", stone: "#8d8a86", stoneDark: "#5e5a55"
};

/** The sky and land of each part of a loop: 1-1 day, 1-2 sunset, 1-3 dusk, 1-4 night. */
const SKIES = [
  { top: "#5fb8ff", bottom: "#d4f0ff", sun: "#fff3b0", far: "#8ea4cc", keep: "#6f83ab", hill: "#4f9e45", tree: "#2f6e2e", grass: "#62c13c", dirt: "#7a5230", clouds: true },
  { top: "#ff8a5a", bottom: "#ffd890", sun: "#ffe6a0", far: "#a0607a", keep: "#7d4a62", hill: "#6f8e3a", tree: "#3e5a24", grass: "#7aa83a", dirt: "#6e4428", clouds: true },
  { top: "#4a3080", bottom: "#d07aa0", sun: "#ffd0e0", far: "#4f3e70", keep: "#3a2c58", hill: "#3c5a40", tree: "#22382a", grass: "#4c7a3a", dirt: "#4e3420" },
  { top: "#070b22", bottom: "#28285a", moon: "#eef2ff", far: "#1f2644", keep: "#151a33", hill: "#1d3828", tree: "#0f2218", grass: "#2c5a2c", dirt: "#33220f", stars: true }
];

const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The ground line, on the canvas. */
const GY = FIELD.ground;

/* ---------------- The land ---------------- */

function drawSky(ctx, g, sky, calm) {
  const grad = ctx.createLinearGradient(0, 0, 0, GY);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(1, sky.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, FIELD.w, GY);
  if (sky.stars) {
    for (let i = 0; i < 40; i++) {
      const twinkle = calm ? 1 : 0.5 + 0.5 * Math.sin(g.t * 2 + i * 7);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + 0.5 * hash(i) * twinkle})`;
      ctx.fillRect(Math.floor(hash(i * 3) * FIELD.w), Math.floor(hash(i * 5) * GY * 0.6), 1, 1);
    }
  }
  // The sun, or a crescent moon (the two circles' difference, so no disc covers the sky).
  const glow = sky.sun ?? sky.moon;
  ctx.save();
  ctx.fillStyle = glow;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  if (sky.moon) {
    ctx.arc(220, 60, 14, 0, Math.PI * 2);
    ctx.arc(227, 55, 12, 0, Math.PI * 2);
    ctx.fill("evenodd");
  } else {
    ctx.arc(64, 72, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (sky.clouds) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    const off = (g.dist * 0.05) % 160;
    for (let i = -1; i < 4; i++) {
      const x = i * 160 - off + hash(i + Math.floor(g.dist * 0.05 / 160)) * 40;
      const y = 40 + hash(i * 9 + Math.floor(g.dist * 0.05 / 160)) * 50;
      for (const [dx, dy, w] of [[0, 0, 30], [12, -6, 26], [24, 0, 30]]) ctx.fillRect(Math.round(x + dx), Math.round(y + dy), w, 8);
    }
  }
}

/** A row of shapes scrolling at `depth` × the run: `shape(ctx, x, n)` for each slot `width` wide. */
function layer(ctx, g, depth, width, shape) {
  const scroll = g.dist * depth;
  const first = Math.floor(scroll / width);
  const off = scroll - first * width;
  for (let i = -1; i < FIELD.w / width + 2; i++) shape(ctx, Math.round(i * width - off), first + i);
}

function drawLand(ctx, g, sky) {
  // Mountains, far off.
  layer(ctx, g, 0.08, 90, (c, x, n) => {
    const h = 70 + hash(n) * 70;
    c.fillStyle = sky.far;
    c.beginPath();
    c.moveTo(x - 30, GY - 40);
    c.lineTo(x + 45, GY - 40 - h);
    c.lineTo(x + 120, GY - 40);
    c.fill();
    if (h > 110) {
      c.fillStyle = "rgba(255, 255, 255, 0.55)";
      c.beginPath();
      c.moveTo(x + 45, GY - 40 - h);
      c.lineTo(x + 33, GY - 40 - h + 18);
      c.lineTo(x + 57, GY - 40 - h + 18);
      c.fill();
    }
  });
  // Now and then a keep on a crag.
  layer(ctx, g, 0.14, 420, (c, x, n) => {
    if (hash(n * 3.3) < 0.55) return;
    const b = GY - 44;
    c.fillStyle = sky.keep;
    c.fillRect(x + 20, b - 46, 18, 46);
    c.fillRect(x + 38, b - 30, 40, 30);
    c.fillRect(x + 78, b - 58, 14, 58);
    for (let k = 0; k < 3; k++) c.fillRect(x + 20 + k * 7, b - 51, 4, 5);
    for (let k = 0; k < 2; k++) c.fillRect(x + 78 + k * 9, b - 63, 4, 5);
    c.beginPath();
    c.moveTo(x + 76, b - 58);
    c.lineTo(x + 85, b - 76);
    c.lineTo(x + 94, b - 58);
    c.fill();
    c.fillStyle = "rgba(255, 210, 120, 0.7)";
    c.fillRect(x + 83, b - 46, 3, 5);
    c.fillRect(x + 26, b - 34, 3, 5);
  });
  // Hills.
  layer(ctx, g, 0.3, 120, (c, x, n) => {
    c.fillStyle = sky.hill;
    c.beginPath();
    c.ellipse(x + 60, GY - 4, 80, 34 + hash(n) * 22, 0, Math.PI, 0);
    c.fill();
  });
  // Pines.
  layer(ctx, g, 0.6, 46, (c, x, n) => {
    if (hash(n * 1.7) < 0.35) return;
    const h = 26 + hash(n * 2.1) * 22;
    c.fillStyle = sky.tree;
    for (let k = 0; k < 3; k++) {
      const w = 12 - k * 3;
      const y = GY - 4 - k * (h / 4);
      c.beginPath();
      c.moveTo(x + 14 - w, y);
      c.lineTo(x + 14, y - h / 2);
      c.lineTo(x + 14 + w, y);
      c.fill();
    }
  });
}

/** The ground: grass on dirt, pits cut out. */
function drawGround(ctx, g, sky) {
  ctx.fillStyle = sky.dirt;
  ctx.fillRect(0, GY, FIELD.w, FIELD.h - GY);
  ctx.fillStyle = sky.grass;
  ctx.fillRect(0, GY, FIELD.w, 6);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  layer(ctx, g, 1, 24, (c, x, n) => {
    c.fillRect(x + Math.floor(hash(n) * 18), GY + 12 + Math.floor(hash(n * 4) * 50), 3, 2);
    c.fillRect(x + Math.floor(hash(n * 2) * 18), GY + 6, 2, 2);
  });
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  layer(ctx, g, 1, 18, (c, x, n) => c.fillRect(x + Math.floor(hash(n * 6) * 14), GY - 2, 2, 3));
  for (const i of g.items) {
    if (i.kind !== "pit") continue;
    const x = Math.round(i.x - g.dist);
    if (x > FIELD.w || x + i.w < 0) continue;
    const grad = ctx.createLinearGradient(0, GY, 0, FIELD.h);
    grad.addColorStop(0, "#1b0f06");
    grad.addColorStop(1, "#000");
    ctx.fillStyle = grad;
    ctx.fillRect(x, GY, i.w, FIELD.h - GY);
    ctx.fillStyle = sky.grass;
    ctx.fillRect(x - 2, GY, 3, 8);
    ctx.fillRect(x + i.w - 1, GY, 3, 8);
  }
}

/* ---------------- Hazards and pickups ---------------- */

function drawFence(ctx, x, w, h) {
  const posts = Math.max(2, Math.round(w / 14) + 1);
  ctx.fillStyle = C.woodDark;
  for (let k = 0; k < posts; k++) ctx.fillRect(Math.round(x + (k * (w - 4)) / (posts - 1)), GY - h, 4, h);
  ctx.fillStyle = C.wood;
  ctx.fillRect(x - 1, GY - h + 3, w + 2, 3);
  ctx.fillRect(x - 1, GY - h + 11, w + 2, 3);
}

function drawBarrier(ctx, x, w, h) {
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x + 1, GY - h, 3, h);
  ctx.fillRect(x + w - 4, GY - h, 3, h);
  for (let k = 0; k < 3; k++) {
    const y = GY - h + 2 + k * 11;
    ctx.fillStyle = k % 2 ? "#f3ead2" : C.red;
    ctx.fillRect(x - 3, y, w + 6, 7);
    ctx.fillStyle = k % 2 ? C.red : "#f3ead2";
    ctx.fillRect(x + w / 2 - 2, y, 4, 7);
  }
}

function drawWall(ctx, x, w, h) {
  ctx.fillStyle = C.stone;
  ctx.fillRect(x, GY - h, w, h);
  ctx.fillStyle = C.stoneDark;
  for (let row = 0; row * 9 < h; row++) {
    const y = GY - h + row * 9;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x + (row % 2 ? 4 : 10), y, 1, 9);
  }
  ctx.fillRect(x - 2, GY - h - 3, w + 4, 4);
}

/** A crow or a griffon (`big`), wings beating; `look`: tilt (diving or swooping). */
function drawBird(ctx, x, y, w, h, t, kind, calm) {
  const big = kind === "griffon" || kind === "swoop";
  const flap = Math.sin(t * (calm ? 4 : big ? 9 : 16));
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (big) {
    // Lion's body, eagle's head and wings.
    ctx.fillStyle = "#a8742c";
    ctx.fillRect(10, h * 0.35, w - 16, h * 0.55);
    ctx.fillRect(w - 10, h * 0.55, 3, h * 0.45);
    ctx.fillRect(14, h * 0.55, 3, h * 0.45);
    ctx.fillStyle = "#e9e0c8";
    ctx.fillRect(0, h * 0.25, 12, 9);
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(-5, h * 0.25 + 5);
    ctx.lineTo(1, h * 0.25 + 2);
    ctx.lineTo(1, h * 0.25 + 7);
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.fillRect(3, h * 0.25 + 3, 2, 2);
    ctx.fillStyle = "#7a5320";
    ctx.beginPath();
    ctx.moveTo(14, h * 0.4);
    ctx.lineTo(24 + flap * 4, h * 0.4 - 16 * flap - 4);
    ctx.lineTo(34, h * 0.4);
    ctx.fill();
    ctx.fillStyle = "#a8742c";
    ctx.fillRect(w - 6, h * 0.4, 8, 3);
  } else {
    ctx.fillStyle = "#16141c";
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2 + 2, w / 2 - 3, h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(2, h / 2 - 2, 6, 5);
    ctx.fillStyle = "#f0a020";
    ctx.beginPath();
    ctx.moveTo(-3, h / 2);
    ctx.lineTo(3, h / 2 - 2);
    ctx.lineTo(3, h / 2 + 2);
    ctx.fill();
    ctx.fillStyle = kind === "diver" ? C.red : "#ddd";
    ctx.fillRect(4, h / 2 - 1, 2, 2);
    ctx.fillStyle = "#26232e";
    ctx.beginPath();
    ctx.moveTo(8, h / 2);
    ctx.lineTo(13 + flap * 2, h / 2 - 10 * flap);
    ctx.lineTo(18, h / 2);
    ctx.fill();
    ctx.fillRect(w - 4, h / 2, 6, 3);
  }
  ctx.restore();
}

function drawApple(ctx, x, y, t, calm) {
  const bob = calm ? 0 : Math.sin(t * 4 + x * 0.1) * 1.5;
  ctx.fillStyle = "#d81e2a";
  ctx.beginPath();
  ctx.arc(x + 6, y + 6 + bob, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillRect(x + 3, y + 3 + bob, 2, 2);
  ctx.fillStyle = "#4a2a10";
  ctx.fillRect(x + 6, y - 1 + bob, 1, 3);
  ctx.fillStyle = "#4caf50";
  ctx.fillRect(x + 7, y - 1 + bob, 3, 2);
}

function drawCarrot(ctx, x, y, t, calm) {
  const bob = calm ? 0 : Math.sin(t * 5) * 1.5;
  ctx.save();
  ctx.shadowColor = "#ffb030";
  ctx.shadowBlur = calm ? 0 : 6 + 4 * Math.sin(t * 6);
  ctx.fillStyle = "#ff8a1e";
  ctx.beginPath();
  ctx.moveTo(x, y + 5 + bob);
  ctx.lineTo(x + 12, y + 1 + bob);
  ctx.lineTo(x + 12, y + 9 + bob);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#3fa33a";
  ctx.fillRect(x + 12, y + bob, 4, 3);
  ctx.fillRect(x + 12, y + 7 + bob, 4, 3);
}

function drawItems(ctx, g, calm) {
  const hx = horseX(g);
  const speed = runSpeed(g);
  for (const i of g.items) {
    const k = KINDS[i.kind];
    if (k.pit) continue;
    if (k.flyer) {
      const f = flyerAt(i, hx, speed);
      const x = f.x - g.dist;
      if (x > FIELD.w + 10 || x + i.w < -10) continue;
      drawBird(ctx, x, GY - f.alt - i.h, i.w, i.h, g.t + i.x * 0.01, i.kind, calm);
      continue;
    }
    const x = Math.round(i.x - g.dist);
    if (x > FIELD.w + 10 || x + i.w < -10) continue;
    if (i.kind === "apple") drawApple(ctx, x, GY - i.alt - i.h, g.t, calm);
    else if (i.kind === "carrot") drawCarrot(ctx, x, GY - i.alt - i.h, g.t, calm);
    else if (i.kind === "barrier") drawBarrier(ctx, x, i.w, i.h);
    else if (i.kind === "wall") drawWall(ctx, x, i.w, i.h);
    else drawFence(ctx, x, i.w, i.h);
  }
}

/* ---------------- Roach ---------------- */

/** One leg from a hip: thigh, then shin, swinging by `a` (radians). */
function leg(ctx, hx, hy, a, bend, color, hoof) {
  const kx = hx + Math.sin(a) * 7;
  const ky = hy + Math.cos(a) * 7;
  const fx = kx + Math.sin(a + bend) * 7;
  const fy = ky + Math.cos(a + bend) * 7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(kx, ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  ctx.fillStyle = hoof;
  ctx.fillRect(Math.round(fx - 2), Math.round(fy - 1), 4, 2);
}

/**
 * Roach (a steed's colours: STEEDS), feet on `base` at `x` (the hitbox's left edge). `pose`: { run (gallop
 * phase), air, two (on two legs), t }. `only`: one flat colour (the glitch's ghosts).
 */
export function drawHorse(ctx, x, base, steed, pose, only = null) {
  const coat = only ?? steed.coat;
  const mane = only ?? steed.mane;
  const dark = only ?? "rgba(0, 0, 0, 0.35)";
  const hoof = only ?? "#1a1410";
  ctx.save();
  ctx.translate(Math.round(x), Math.round(base));
  if (pose.two) {
    // Rearing on the hind legs, front hooves pawing.
    ctx.translate(10, -12);
    ctx.rotate(-0.55);
    ctx.translate(-10, 12);
  }
  const p = pose.run;
  // Hind legs (behind), then the body, then the front legs.
  const legs = (hips, front) => hips.forEach(([hx, off]) => {
    let a;
    let bend;
    if (pose.two && !front) {
      a = Math.sin(p * 2 + off) * 0.5 + 0.3;
      bend = -0.2;
    } else if (pose.two) {
      a = -1.6 + Math.sin(p * 3 + off) * 0.6;
      bend = 1.2;
    } else if (pose.air) {
      a = front ? -1.1 : 0.9;
      bend = front ? 1.4 : -1.2;
    } else {
      a = Math.sin(p + off) * 0.7;
      bend = (front ? 0.6 : -0.6) * Math.max(0, Math.sin(p + off + 0.8));
    }
    leg(ctx, hx, -12, a, bend, coat, hoof);
  });
  legs([[9, 0], [13, 0.9]], false);
  // Tail.
  ctx.fillStyle = mane;
  const sway = Math.sin(pose.t * 9) * 2;
  ctx.beginPath();
  ctx.moveTo(6, -24);
  ctx.lineTo(-6, -18 + sway);
  ctx.lineTo(-4, -10 + sway);
  ctx.lineTo(4, -18);
  ctx.fill();
  // Body, neck, head.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(19, -19, 14, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(26, -24);
  ctx.lineTo(33, -36);
  ctx.lineTo(39, -34);
  ctx.lineTo(34, -19);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(32, -37);
  ctx.lineTo(37, -38);
  ctx.lineTo(45, -30);
  ctx.lineTo(44, -26);
  ctx.lineTo(40, -26);
  ctx.lineTo(34, -30);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(42, -28, 2, 1); // nostril
  ctx.fillRect(10, -15, 18, 2); // belly shade
  // Ear and mane.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(33, -37);
  ctx.lineTo(34, -42);
  ctx.lineTo(36, -38);
  ctx.fill();
  ctx.fillStyle = mane;
  ctx.beginPath();
  ctx.moveTo(25, -25);
  ctx.lineTo(31, -38);
  ctx.lineTo(33, -38);
  ctx.lineTo(29, -24);
  ctx.fill();
  ctx.fillRect(34, -38, 3, 3); // forelock
  if (!only) {
    if (steed.armor) {
      ctx.fillStyle = "#2b3324";
      ctx.fillRect(22, -24, 12, 10);
      ctx.fillRect(35, -37, 6, 4);
      ctx.fillStyle = steed.eye;
      ctx.fillRect(23, -22, 10, 1);
    }
    if (steed.chrome) {
      ctx.fillStyle = steed.gold ? "#fff2a0" : "#eef8ff";
      ctx.fillRect(9, -26, 16, 1);
      ctx.fillRect(28, -30, 1, 6);
      for (const rx of [12, 18, 24]) ctx.fillRect(rx, -21, 1, 1);
    }
    if (steed.samurai) {
      ctx.fillStyle = C.red;
      ctx.fillRect(14, -27, 10, 4); // saddle
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(15, -48, 1, 22); // sashimono pole
      ctx.fillStyle = C.red;
      ctx.fillRect(16, -48, 8, 12);
      ctx.fillStyle = "#f3ead2";
      ctx.beginPath();
      ctx.arc(20, -42, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (steed.horn) {
      ctx.save();
      ctx.fillStyle = "#fff6d0";
      ctx.shadowColor = steed.mane;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(37, -37);
      ctx.lineTo(44, -48);
      ctx.lineTo(39, -35);
      ctx.fill();
      ctx.restore();
    }
    // The eye (glowing for chromed and neon steeds).
    ctx.save();
    ctx.fillStyle = steed.eye;
    if (steed.glow || steed.chrome) {
      ctx.shadowColor = steed.eye;
      ctx.shadowBlur = 5;
    }
    ctx.fillRect(37, -34, 2, 2);
    ctx.restore();
  }
  legs([[25, 2.2], [29, 3.1]], true);
  if (!only && steed.gold && !pose.calm) {
    ctx.fillStyle = "#fffbe0";
    for (let k = 0; k < 3; k++) {
      const s = (pose.t * 2 + k / 3) % 1;
      ctx.globalAlpha = 1 - s;
      ctx.fillRect(Math.round(hash(k + Math.floor(pose.t * 2)) * 40), Math.round(-10 - hash(k * 7 + Math.floor(pose.t * 2)) * 30), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** A steed standing on a little patch of grass, for the stable's tiles. */
export function drawSteedCard(ctx, steed, w, h, t = 0) {
  const sky = SKIES[0];
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#1c1430");
  grad.addColorStop(1, "#3a2850");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = sky.grass;
  ctx.fillRect(0, h - 8, w, 8);
  ctx.save();
  const scale = Math.min(w / 64, h / 56);
  ctx.translate((w - 50 * scale) / 2, h - 8);
  ctx.scale(scale, scale);
  drawHorse(ctx, 4, 0, steed, { run: 0.6, air: false, two: false, t, calm: true });
  ctx.restore();
}

function drawRoach(ctx, g, steed, calm) {
  const x = PHYSICS.horse.x - 4;
  const base = GY - g.y;
  const pose = { run: g.dist / (calm ? 14 : 7), air: g.y > 0 || g.falling, two: g.carrot > 0 && g.y <= 0, t: g.t, calm };
  if (g.falling) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FIELD.w, FIELD.h);
    ctx.clip();
  }
  if (g.safe > 0) {
    // Glitched: red and cyan ghosts either side, a sliced copy on top.
    const k = calm ? 2 : 2 + Math.random() * 3;
    ctx.globalAlpha = 0.7;
    drawHorse(ctx, x - k, base, steed, pose, "#ff2a4a");
    drawHorse(ctx, x + k, base, steed, pose, "#2af0ff");
    ctx.globalAlpha = 1;
    ctx.save();
    for (let s = 0; s < 4; s++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, base - 50 + s * 12, FIELD.w, 10);
      ctx.clip();
      drawHorse(ctx, x + (calm ? 0 : (hash(s + Math.floor(g.t * 30)) - 0.5) * 6), base, steed, pose);
      ctx.restore();
    }
    ctx.restore();
  } else drawHorse(ctx, x, base, steed, pose);
  if (g.carrot > 0 && !calm) {
    ctx.fillStyle = `rgba(255, 170, 40, ${0.35 + 0.25 * Math.sin(g.t * 12)})`;
    for (let k = 0; k < 3; k++) ctx.fillRect(x - 10 - k * 8, base - 18 - k * 4, 6, 1);
  }
  if (g.falling) ctx.restore();
}

/* ---------------- HUD and panels ---------------- */

/** Text with a hard drop shadow, arcade style. */
function text(ctx, s, x, y, { size = 12, color = C.text, align = "center", shadow = C.ink } = {}) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = align;
  ctx.fillStyle = shadow;
  ctx.fillText(s, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function drawHud(ctx, g, fx, calm) {
  text(ctx, stageLabel(g.stage), 10, 20, { size: 13, color: C.gold, align: "left" });
  text(ctx, String(Math.floor(g.score)).padStart(6, "0"), FIELD.w - 10, 20, { size: 15, align: "right" });
  if (g.apples) {
    drawApple(ctx, FIELD.w - 64, 27, 0, true);
    text(ctx, `×${g.apples}`, FIELD.w - 48, 37, { size: 10, align: "left" });
  }
  // The glitch's charge.
  const ready = g.glitchCd <= 0;
  const k = ready ? 1 : 1 - g.glitchCd / PHYSICS.glitchCooldown;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(10, 28, 54, 6);
  ctx.fillStyle = ready ? C.cyan : "#5a7a88";
  ctx.fillRect(10, 28, Math.round(54 * k), 6);
  text(ctx, ready ? "GLITCH" : "glitch", 10, 46, { size: 9, color: ready ? C.cyan : C.dim, align: "left" });
  if (g.carrot > 0) {
    const blink = !calm && g.carrot < 1.5 && Math.floor(g.t * 8) % 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(FIELD.w / 2 - 40, 28, 80, 6);
    ctx.fillStyle = blink ? "#fff" : "#ff8a1e";
    ctx.fillRect(FIELD.w / 2 - 40, 28, Math.round(80 * (g.carrot / PHYSICS.carrotMax)), 6);
    text(ctx, "TWO LEGS ×3", FIELD.w / 2, 46, { size: 9, color: "#ffb050" });
  }
  for (const m of fx.messages) if (m.until > g.t) text(ctx, m.text, FIELD.w / 2, 110, { size: 22, color: m.color });
}

/** The CRT's scanlines. */
function scanlines(ctx) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.13)";
  for (let y = 0; y < FIELD.h; y += 3) ctx.fillRect(0, y, FIELD.w, 1);
}

/**
 * Draw a frame: the land, the course, Roach, the HUD, and a panel over it all (title, game over, pause,
 * the pass you need, out of order, or the initials entry). `fx`: { shake, flash, messages }.
 */
export function draw(ctx, g, panel, fx, steed) {
  const calm = reduceMotion();
  const sky = SKIES[g.stage % 4];
  ctx.save();
  if (fx.shake > 0 && !calm) ctx.translate((Math.random() - 0.5) * 8 * fx.shake, (Math.random() - 0.5) * 8 * fx.shake);
  drawSky(ctx, g, sky, calm);
  drawLand(ctx, g, sky);
  drawGround(ctx, g, sky);
  drawItems(ctx, g, calm);
  drawRoach(ctx, g, steed, calm);
  ctx.restore();
  if (fx.flash > 0 && !calm) {
    ctx.fillStyle = `rgba(255, 255, 255, ${fx.flash * 0.5})`;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  if (g.t > 0 && !panel?.full) drawHud(ctx, g, fx, calm);
  if (panel) drawPanel(ctx, g, panel);
  scanlines(ctx);
}

function frame(ctx, accent, top, bottom) {
  ctx.fillStyle = C.panel;
  ctx.fillRect(14, top, FIELD.w - 28, bottom - top);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(14, top, FIELD.w - 28, bottom - top);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(18, top + 4, FIELD.w - 36, bottom - top - 8);
  return { top, bottom };
}

function wrap(ctx, s, width) {
  const out = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The title / game-over / no-pass panel with the board; pause; or the initials entry. */
function drawPanel(ctx, g, panel) {
  if (panel.entry) return drawEntry(ctx, panel.entry);
  if (panel.paused) {
    const { top, bottom } = frame(ctx, C.gold, 160, 240);
    text(ctx, "PAUSED", FIELD.w / 2, top + 34, { size: 20, color: C.gold });
    text(ctx, "P or Esc to ride on", FIELD.w / 2, bottom - 20, { size: 11 });
    return;
  }
  const { lines, board = [], best, foot, record } = panel;
  const accent = panel.alert ? C.red : C.gold;
  const { top, bottom } = frame(ctx, accent, 66, FIELD.h - 18);
  let y = top + 30;
  lines.forEach((line, i) => {
    ctx.font = i ? "bold 12px monospace" : "bold 22px monospace";
    for (const part of wrap(ctx, line, FIELD.w - 48)) {
      text(ctx, part, FIELD.w / 2, y, { size: i ? 12 : 22, color: i ? C.text : accent, shadow: i ? C.ink : "#7a1010" });
      y += i ? 16 : 24;
    }
  });
  if (record) {
    text(ctx, `HOUSE RECORD ${String(record).padStart(6, "0")}`, FIELD.w / 2, y + 2, { size: 11, color: C.cyan });
    y += 16;
  }
  y += 6;
  text(ctx, "- HALL OF FAME -", FIELD.w / 2, y, { size: 11, color: C.gold });
  y += 16;
  const rowH = 14;
  const rows = Math.max(0, Math.min(board.length, Math.floor((bottom - 46 - y) / rowH)));
  for (const s of board.slice(0, rows)) {
    const color = s.mine ? C.cyan : C.text;
    text(ctx, `${String(s.rank).padStart(2)}. ${s.name.slice(0, 12)}`, 28, y, { size: 11, color, align: "left" });
    text(ctx, String(s.score).padStart(6, "0"), FIELD.w - 28, y, { size: 11, color, align: "right" });
    y += rowH;
  }
  if (!board.length) text(ctx, "No riders yet. Be the first.", FIELD.w / 2, y, { size: 11, color: C.dim });
  text(ctx, best ? `Your best: ${best.score}` : "Space / tap: jump · again: double · 3rd: glitch", FIELD.w / 2, bottom - 28, { size: 9, color: C.dim });
  text(ctx, foot, FIELD.w / 2, bottom - 11, { size: 12, color: panel.alert ? C.red : "#fff" });
}

/** The initials entry's layout, in field units (as NCART Runner's). */
export const ENTRY = { slotW: 44, slotGap: 14, up: [190, 224], box: [224, 270], down: [270, 304], ok: { x: 104, y: 312, w: 80, h: 26 }, ms: 30_000 };
export const slotX = i => (FIELD.w - (3 * ENTRY.slotW + 2 * ENTRY.slotGap)) / 2 + i * (ENTRY.slotW + ENTRY.slotGap);

function arrow(ctx, cx, cy, dir) {
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 5 * dir);
  ctx.lineTo(cx + 8, cy + 5 * dir);
  ctx.lineTo(cx, cy - 5 * dir);
  ctx.fill();
}

function drawEntry(ctx, { chars, slot, rank, score, left }) {
  const { bottom } = frame(ctx, C.gold, 100, FIELD.h - 22);
  const blink = reduceMotion() || Math.floor(Date.now() / 300) % 2;
  text(ctx, "NEW HIGH SCORE!", FIELD.w / 2, 136, { size: 20, color: blink ? C.gold : "#c89a20", shadow: "#7a1010" });
  text(ctx, `Rank #${rank}   ${String(score).padStart(6, "0")}`, FIELD.w / 2, 158);
  text(ctx, "ENTER YOUR INITIALS", FIELD.w / 2, 182, { color: C.cyan });
  chars.forEach((ch, i) => {
    const x = slotX(i);
    const cx = x + ENTRY.slotW / 2;
    const on = i === slot;
    ctx.fillStyle = on ? C.gold : "#6c6070";
    arrow(ctx, cx, (ENTRY.up[0] + ENTRY.up[1]) / 2 + 2, 1);
    arrow(ctx, cx, (ENTRY.down[0] + ENTRY.down[1]) / 2 - 2, -1);
    const [y0, y1] = ENTRY.box;
    ctx.fillStyle = on ? "rgba(245, 197, 66, 0.14)" : "rgba(255, 255, 255, 0.04)";
    ctx.fillRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.strokeStyle = on ? C.gold : "#4a3e48";
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.lineWidth = 1;
    text(ctx, ch, cx, y1 - 11, { size: 32 });
  });
  const { x, y, w, h } = ENTRY.ok;
  ctx.fillStyle = C.red;
  ctx.fillRect(x, y, w, h);
  text(ctx, "OK", x + w / 2, y + 18, { size: 14 });
  text(ctx, `Tap the arrows or type  ${left}`, FIELD.w / 2, bottom - 8, { size: 11, color: C.dim });
}

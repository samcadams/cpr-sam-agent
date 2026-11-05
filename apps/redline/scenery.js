import { START, WALL } from "./model.js";
import { calm, fit, glow, hash, label, mix, poly, rgba, rrect, vgrad } from "./gfx.js";

/*
 * REDLINE's world beside the road (the race draws it in apps/redline/draw.js): each district's sky and its
 * roadside. The sky: stars, a moon or a striped synthwave sun, two layers of skyline drifting the other way as
 * the road turns, and what lives up there (the Combat Zone's searchlights and fires on the horizon, the
 * Corporate Center's megatower and AVs, the Badlands' mesas and wind turbines, Pacifica's cranes and a dead
 * Ferris wheel). The roadside: lamps that light the road, buildings with lit windows and neon signs,
 * billboards, sign gantries, overpasses, the start arch and its crowd, and each district's own props.
 * Everything is placed from the segment's number, so it's the same every time it comes round.
 */

/** The world's clock for animation (seconds); frozen with Reduce motion. */
const clock = () => (calm() ? 0 : performance.now() / 1000);

/* ---------------- The sky ---------------- */

/**
 * The sky down to the horizon. `sky`: { look, district, drift (the skyline's turn, px), camX, horizon, W }.
 */
export function drawSky(ctx, { look, district, drift, camX, horizon: H, W }) {
  const t = clock();
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, look.sky[0]);
  sky.addColorStop(0.6, look.sky[1]);
  sky.addColorStop(1, look.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H + 2);
  const wrap = (x, span = W + 80) => ((((x + 40) % span) + span) % span) - 40;
  // Stars.
  if (district !== "badlands") {
    for (let i = 0; i < 70; i++) {
      const y = hash(i * 2.7) * H * (district === "corpo" ? 0.45 : 0.7);
      const x = wrap(hash(i) * (W + 80) - drift * 0.15);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.6 + hash(i * 5) * 2) + i));
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.15 + 0.5 * hash(i * 9)) * tw * (district === "corpo" ? 0.5 : 1)})`;
      ctx.fillRect(x, y, hash(i * 3) > 0.9 ? 1.5 : 1, hash(i * 3) > 0.9 ? 1.5 : 1);
    }
  }
  const far = (k = 0.45) => mix(look.far, look.sky[1], k);
  if (district === "badlands") badlandsSky(ctx, look, drift, H, W, t, wrap, far);
  else if (district === "pacifica") pacificaSky(ctx, look, drift, H, W, t, wrap, far);
  else if (district === "corpo") corpoSky(ctx, look, drift, H, W, t, wrap, far);
  else combatSky(ctx, look, drift, H, W, t, wrap, far);
  // Haze on the horizon.
  const haze = ctx.createLinearGradient(0, H - 46, 0, H + 2);
  haze.addColorStop(0, "rgba(0, 0, 0, 0)");
  haze.addColorStop(1, look.glow);
  ctx.fillStyle = haze;
  ctx.fillRect(0, H - 46, W, 48);
}

/** A skyline layer: `top(u)` the height (px above the horizon) at column u, in steps `step` px wide. */
function skyline(ctx, H, W, shift, step, color, top) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H + 1);
  const off = ((shift % step) + step) % step;
  for (let x = -step; x <= W + step; x += step) {
    const u = Math.floor((x + shift) / step);
    const y = H - top(u);
    ctx.lineTo(x - off, y);
    ctx.lineTo(x - off + step, y);
  }
  ctx.lineTo(W, H + 1);
  ctx.closePath();
  ctx.fill();
}

/** Lit windows on a skyline layer. */
function windows(ctx, H, W, shift, step, top, color, chance, seed) {
  ctx.fillStyle = color;
  const off = ((shift % step) + step) % step;
  for (let x = -step; x <= W + step; x += step) {
    const u = Math.floor((x + shift) / step);
    const h = top(u);
    for (let r = 4; r < h - 2; r += 3) {
      for (let c = 1; c < step - 1; c += 2) {
        if (hash(u * 31.7 + r * 3.1 + c + seed) < chance) ctx.fillRect(x - off + c, H - r, 1, 1);
      }
    }
  }
}

/** Columns before a skyline repeats (divisible by every grouping the layers use). */
const PERIOD = 108;
const layers = new Map();

/**
 * A skyline layer (and its lit windows: `win` = [color, chance, seed]), drawn once into a strip that repeats
 * every PERIOD columns, then just copied each frame at its drift. `key` names the layer.
 */
function layer(ctx, key, H, W, shift, step, color, top, win = null) {
  const scale = Math.max(1, Math.min(3, Math.round(ctx.getTransform().a)));
  const width = PERIOD * step;
  const id = `${key}|${scale}|${H}|${color}`;
  let strip = layers.get(id);
  if (!strip) {
    if (layers.size > 40) layers.clear();
    strip = document.createElement("canvas");
    strip.width = width * scale;
    strip.height = (H + 2) * scale;
    const sctx = strip.getContext("2d");
    sctx.scale(scale, scale);
    const wrapped = u => top(((u % PERIOD) + PERIOD) % PERIOD);
    skyline(sctx, H, width, 0, step, color, wrapped);
    if (win) windows(sctx, H, width, 0, step, wrapped, ...win);
    layers.set(id, strip);
  }
  const off = ((shift % width) + width) % width;
  for (let x = -off; x < W; x += width) ctx.drawImage(strip, 0, 0, strip.width, strip.height, x, 0, width, H + 2);
}

function combatSky(ctx, look, drift, H, W, t, wrap, far) {
  // A blood moon through the smog.
  const mx = wrap(W * 0.24 - drift * 0.04);
  glow(ctx, mx, 52, 46, "rgba(255, 70, 50, 0.35)");
  ctx.fillStyle = "#7a2418";
  ctx.beginPath();
  ctx.arc(mx, 52, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(20, 4, 10, 0.35)";
  ctx.beginPath();
  ctx.arc(mx + 5, 48, 5, 0, Math.PI * 2);
  ctx.arc(mx - 6, 57, 3, 0, Math.PI * 2);
  ctx.fill();
  // Searchlights sweeping.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 2; i++) {
    const bx = wrap(W * (0.3 + i * 0.45) - drift * 0.5);
    const a = Math.sin(t * (0.35 + i * 0.12) + i * 2) * 0.5 - Math.PI / 2;
    const grad = ctx.createLinearGradient(bx, H, bx + Math.cos(a) * 160, H + Math.sin(a) * 160);
    grad.addColorStop(0, "rgba(255, 200, 160, 0.16)");
    grad.addColorStop(1, "rgba(255, 200, 160, 0)");
    ctx.fillStyle = grad;
    poly(ctx, [[bx, H - 20], [bx + Math.cos(a - 0.06) * 200, H - 20 + Math.sin(a - 0.06) * 200], [bx + Math.cos(a + 0.06) * 200, H - 20 + Math.sin(a + 0.06) * 200]]);
    ctx.fill();
  }
  ctx.restore();
  // Smoke drifting.
  ctx.fillStyle = "rgba(30, 10, 20, 0.35)";
  for (let i = 0; i < 4; i++) {
    const x = wrap(hash(i + 40) * W + t * 3 * (i + 1) - drift * 0.2, W + 160);
    ctx.beginPath();
    ctx.ellipse(x, 30 + i * 22, 70, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Broken towers, far and near; fires burning on the horizon.
  const tall = u => 14 + hash(Math.floor(u / 3)) * 46 - (hash(u * 1.7) > 0.8 ? 10 : 0);
  layer(ctx, "1", H, W, drift * 0.5, 6, far(), tall);
  for (let i = 0; i < 4; i++) {
    const x = wrap(hash(i + 70) * (W + 80) - drift * 0.7);
    glow(ctx, x, H - 2, 16 + 6 * Math.sin(t * 5 + i), "rgba(255, 110, 30, 0.6)");
  }
  const near = u => 8 + hash(Math.floor(u / 2) + 991) * 30;
  layer(ctx, "2", H, W, drift, 7, look.far, near, ["rgba(255, 160, 80, 0.55)", 0.1, 5]);
}

function corpoSky(ctx, look, drift, H, W, t, wrap, far) {
  // The megatower: a spire with a lit crown and a beacon.
  const tx = wrap(W * 0.55 - drift * 0.25, W + 200);
  ctx.fillStyle = mix(look.far, look.sky[1], 0.25);
  poly(ctx, [[tx - 16, H], [tx - 12, H - 120], [tx - 6, H - 138], [tx, H - 150], [tx + 6, H - 138], [tx + 12, H - 120], [tx + 16, H]]);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 40, 60, 0.85)";
  ctx.fillRect(tx - 12, H - 120, 24, 2);
  ctx.fillRect(tx - 9, H - 112, 18, 1);
  if (Math.floor(t * 1.5) % 2) glow(ctx, tx, H - 150, 6, "rgba(255, 40, 40, 1)");
  ctx.fillStyle = "rgba(140, 220, 255, 0.35)";
  for (let y = H - 104; y < H - 6; y += 4) ctx.fillRect(tx - 11, y, 22, 1);
  // A hologram over the towers.
  const hx = wrap(W * 0.2 - drift * 0.4, W + 220);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flick = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 2.3);
  ctx.globalAlpha = 0.5 * flick;
  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 1;
  ctx.strokeRect(hx - 30, H - 104, 60, 26);
  label(ctx, "ARASAKA", hx, H - 88, 9, "#00f0ff");
  ctx.fillStyle = "rgba(0, 240, 255, 0.08)";
  ctx.fillRect(hx - 30, H - 104, 60, 26);
  for (let y = H - 104; y < H - 78; y += 3) ctx.fillRect(hx - 30, y, 60, 1);
  ctx.restore();
  // Two layers of towers with lit windows.
  const tallFar = u => 30 + hash(Math.floor(u / 2)) * 80;
  layer(ctx, "3", H, W, drift * 0.5, 9, far(0.35), tallFar, ["rgba(140, 220, 255, 0.35)", 0.22, 1]);
  const tallNear = u => 18 + hash(Math.floor(u / 2) + 991) * 55;
  layer(ctx, "4", H, W, drift, 11, look.far, tallNear, ["rgba(170, 235, 255, 0.55)", 0.28, 3]);
  // AVs crossing, lights blinking.
  for (let i = 0; i < 3; i++) {
    const speed = 14 + i * 7;
    const x = wrap(hash(i + 7) * W + t * speed * (i % 2 ? -1 : 1) - drift * 0.6, W + 120);
    const y = 26 + i * 18 + Math.sin(t * 0.7 + i) * 3;
    ctx.fillStyle = "#0a0c18";
    ctx.fillRect(x - 5, y - 1, 10, 3);
    ctx.fillStyle = Math.floor(t * 2 + i) % 2 ? "#ff3040" : "#ffffff";
    ctx.fillRect(x + (i % 2 ? -6 : 5), y, 1.5, 1.5);
    glow(ctx, x, y + 3, 5, "rgba(140, 220, 255, 0.5)");
  }
}

function badlandsSky(ctx, look, drift, H, W, t, wrap, far) {
  // The synthwave sun: striped, sinking into the haze.
  const sx = wrap(W * 0.68 - drift * 0.05, W + 160);
  const sy = H - 30;
  const r = 38;
  glow(ctx, sx, sy, r * 2.4, "rgba(255, 150, 80, 0.4)");
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = vgrad(ctx, sy - r, sy + r, [[0, "#ffe680"], [0.5, "#ff9a3c"], [1, "#ff2a6d"]]);
  ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  ctx.fillStyle = look.sky[2];
  for (let i = 0; i < 7; i++) {
    const y = sy - 4 + i * 6;
    ctx.fillRect(sx - r, y, r * 2, 1 + i * 0.7);
  }
  ctx.restore();
  // Mesas, far and near; wind turbines turning on the far ones.
  const mesa = (u, seed, most) => {
    const m = Math.floor(u / 9);
    const on = hash(m + seed) > 0.45;
    const edge = u % 9 === 0 || u % 9 === 8 ? 0.6 : 1;
    return on ? (8 + hash(m + seed + 3) * most) * edge : 4 + Math.abs(Math.sin(u * 0.2)) * 4;
  };
  layer(ctx, "5", H, W, drift * 0.5, 4, far(0.5), u => mesa(u, 11, 26));
  ctx.strokeStyle = far(0.3);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const x = wrap(hash(i + 21) * (W + 80) - drift * 0.5);
    const y = H - 22 - i * 3;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, y);
    ctx.stroke();
    const a0 = t * (1.2 + i * 0.3);
    for (let b = 0; b < 3; b++) {
      const a = a0 + (b * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      ctx.stroke();
    }
  }
  layer(ctx, "6", H, W, drift, 5, look.far, u => mesa(u, 57, 16));
}

function pacificaSky(ctx, look, drift, H, W, t, wrap, far) {
  // A pale moon in a halo, low cloud lit pink.
  const mx = wrap(W * 0.78 - drift * 0.04, W + 160);
  glow(ctx, mx, 40, 50, "rgba(200, 220, 255, 0.25)");
  ctx.fillStyle = "#dfe8f0";
  ctx.beginPath();
  ctx.arc(mx, 40, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 60, 200, 0.12)";
  for (let i = 0; i < 3; i++) {
    const x = wrap(hash(i + 3) * W + t * 2 - drift * 0.2, W + 200);
    ctx.beginPath();
    ctx.ellipse(x, 70 + i * 16, 90, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Unfinished towers, cranes on them; the dead Ferris wheel.
  const tall = u => (hash(Math.floor(u / 4)) > 0.5 ? 20 + hash(Math.floor(u / 4) + 7) * 50 : 5);
  layer(ctx, "7", H, W, drift * 0.5, 6, far(), tall);
  ctx.strokeStyle = far(0.2);
  ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    const x = wrap(hash(i + 51) * (W + 80) - drift * 0.5);
    const y = H - 70 - i * 10;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, y);
    ctx.moveTo(x - 10, y + 2);
    ctx.lineTo(x + 34, y + 2);
    ctx.moveTo(x + 30, y + 2);
    ctx.lineTo(x + 30, y + 14);
    ctx.stroke();
    if (Math.floor(t + i) % 2) glow(ctx, x, y, 3, "rgba(255, 50, 50, 1)");
  }
  const wx = wrap(W * 0.3 - drift * 0.6, W + 160);
  const wy = H - 34;
  ctx.strokeStyle = mix(look.far, "#ff2a6d", 0.25);
  ctx.beginPath();
  ctx.arc(wx, wy, 26, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = t * 0.05 + (k * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(a) * 26, wy + Math.sin(a) * 26);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(wx - 12, H);
  ctx.lineTo(wx, wy);
  ctx.lineTo(wx + 12, H);
  ctx.stroke();
  const near = u => (hash(Math.floor(u / 3) + 991) > 0.4 ? 10 + hash(Math.floor(u / 3) + 9) * 30 : 4);
  layer(ctx, "8", H, W, drift, 6, look.far, near, ["rgba(255, 90, 200, 0.4)", 0.06, 9]);
}

/* ---------------- The roadside ---------------- */

/** Billboards: an icon and a line (made-up brands, slogans, Night City nonsense). */
const ADS = [
  ["KIROSHI", "#ff2a6d", "eye"], ["NICOLA", "#f5d300", "can"], ["MILITECH", "#3dff8b", "gun"], ["BUCK-A-SLICE", "#ff8a1c", "slice"],
  ["ARASAKA", "#ff2a6d", "chip"], ["ZETATECH", "#5cc8ff", "bolt"], ["NO FUTURE", "#ff5ce1", "skull"], ["OPEN 24/7", "#00f0ff", "star"],
  ["CHOOH2", "#3dff8b", "drop"], ["BRAINDANCE", "#ff5ce1", "eye"], ["CHROME 50% OFF", "#00f0ff", "chip"], ["SLEEP? LATER.", "#f5d300", "pill"],
  ["TRAUMA TEAM", "#3dff8b", "cross"], ["LOVE ME", "#ff2a6d", "heart"], ["OBEY", "#e8e8f0", "eye"], ["BIOTECHNICA", "#3dff8b", "leaf"],
  ["DRIVE FAST", "#f5d300", "bolt"], ["SMASH IT", "#ff8a1c", "skull"], ["NOODLES", "#ff8a1c", "bowl"], ["XXX", "#ff5ce1", "heart"]
];

/** Little neon signs on the buildings. */
const SIGNS = [["BAR", "#ff2a6d"], ["HOTEL", "#00f0ff"], ["24H", "#3dff8b"], ["CLINIC", "#e8e8f0"], ["RAMEN", "#ff8a1c"], ["ゲーム", "#ff5ce1"], ["DOLLS", "#ff5ce1"], ["GUNS", "#f5d300"]];

/** What the sign gantries say, by district. */
const GANTRY = {
  combat: [["COMBAT ZONE", "NO NCPD PAST HERE"], ["KEEP MOVING", "DON'T STOP"], ["WATSON ↑", "HEYWOOD →"]],
  corpo: [["CORPO PLAZA", "EXIT 4"], ["ARASAKA TWR ↑", "MILITECH →"], ["NIGHT CITY", "CITY CENTER"]],
  badlands: [["NIGHT CITY", "48 MI"], ["ROUTE 101", "LAST GAS 12 MI"], ["BIOTECHNICA FLATS", "→"]],
  pacifica: [["PACIFICA", "COASTVIEW"], ["GRAND IMPERIAL", "MALL ↑"], ["WEST WIND", "ESTATE →"]]
};

/** The segment of a point along the track (for the start arch). */
const START_SEG = Math.round(START / 6);

/**
 * Roadside props for segment `j` (the same every time it comes round). `k`: its bend. `finish`: a sprint's
 * finish segment, or null.
 */
export function props(district, j, k, finish = null) {
  const out = [];
  const r = hash(j);
  const side = n => (hash(j + n) > 0.5 ? 1 : -1);
  // The start (and a sprint's finish): an arch over the road, a crowd either side.
  if (j === START_SEG || j === finish) out.push({ kind: "arch", x: 0, text: j === finish ? "FINISH" : "START" });
  if (Math.abs(j - START_SEG) <= 6 || (finish !== null && Math.abs(j - finish) <= 6)) {
    for (const sd of [-1, 1]) out.push({ kind: "crowd", x: sd * (WALL + 1.8), seed: j * 2 + sd });
  }
  // Chevrons on the outside of a sharp bend, pointing the way it goes.
  if (Math.abs(k) > 1 / 110 && j % 2 === 0) out.push({ kind: "chevron", x: -Math.sign(k) * (WALL + 0.7), dir: Math.sign(k) });
  // Sign gantries now and then; overpasses in the city.
  if (j % 71 === 23) out.push({ kind: "gantry", x: 0, lines: GANTRY[district][Math.floor(hash(j + 5) * 3)], district });
  if ((district === "corpo" || district === "combat") && j % 97 === 61) out.push({ kind: "overpass", x: 0, district });
  if (j % 4 === 0) out.push({ kind: district === "badlands" ? "pole" : "lamp", x: (j % 8 ? 1 : -1) * (WALL + 0.8), district });
  if (district === "badlands") {
    if (r > 0.82) out.push({ kind: "cactus", x: side(1) * (WALL + 4 + hash(j + 2) * 20), h: 2.4 + hash(j + 6) * 2 });
    if (r < 0.06) out.push({ kind: "rock", x: side(3) * (WALL + 6 + hash(j + 4) * 30) });
    if (j % 37 === 11) out.push({ kind: "billboard", x: side(3) * (WALL + 4), ad: Math.floor(hash(j + 9) * ADS.length) });
    if (j % 53 === 30) out.push({ kind: "derrick", x: side(7) * (WALL + 14 + hash(j + 8) * 10), seed: j });
    if (j % 61 === 17) out.push({ kind: "hulk", x: side(5) * (WALL + 3.5), seed: j });
    if (j % 89 === 44) out.push({ kind: "camp", x: side(11) * (WALL + 9), seed: j });
  } else if (district === "pacifica") {
    if (j % 5 === 2) out.push({ kind: "palm", x: side(1) * (WALL + 2.5 + hash(j + 5) * 4), h: 7 + hash(j + 12) * 3 });
    if (j % 9 === 0) out.push({ kind: "building", x: side(2) * (WALL + 14 + hash(j + 6) * 10), w: 12 + hash(j + 7) * 10, h: 14 + hash(j + 8) * 22, ruin: hash(j + 13) > 0.4, district, sign: hash(j + 10) > 0.6 ? Math.floor(hash(j + 11) * SIGNS.length) : null });
    if (j % 19 === 7) out.push({ kind: "billboard", x: side(3) * (WALL + 3), ad: Math.floor(hash(j + 9) * ADS.length) });
    if (j % 29 === 13) out.push({ kind: "graffiti", x: side(4) * (WALL + 1.2), seed: j });
  } else if (district === "corpo") {
    if (j % 3 === 0) out.push({ kind: "tower", x: (j % 6 ? 1 : -1) * (WALL + 10 + hash(j + 2) * 8), w: 12 + hash(j + 7) * 12, h: 30 + hash(j + 8) * 60, tint: hash(j + 14), sign: hash(j + 10) > 0.7 ? Math.floor(hash(j + 11) * SIGNS.length) : null });
    if (j % 4 === 2) out.push({ kind: "tree", x: (j % 8 === 2 ? 1 : -1) * (WALL + 2.4) });
    if (j % 11 === 5) out.push({ kind: "screen", x: side(3) * (WALL + 3), ad: Math.floor(hash(j + 9) * ADS.length) });
    if (j % 23 === 9) out.push({ kind: "holo", x: side(6) * (WALL + 4), ad: Math.floor(hash(j + 9) * ADS.length) });
  } else {
    if (j % 3 === 0) out.push({ kind: "building", x: (j % 6 ? 1 : -1) * (WALL + 9 + hash(j + 2) * 8), w: 10 + hash(j + 7) * 14, h: 10 + hash(j + 8) * 24, district, escape: hash(j + 15) > 0.5, sign: hash(j + 10) > 0.55 ? Math.floor(hash(j + 11) * SIGNS.length) : null });
    if (j % 11 === 5) out.push({ kind: "billboard", x: side(3) * (WALL + 3), ad: Math.floor(hash(j + 9) * ADS.length) });
    if (j % 13 === 7) out.push({ kind: "barrel", x: side(4) * (WALL + 1.6) });
    if (j % 17 === 3) out.push({ kind: "steam", x: side(8) * (WALL + 1.4), seed: j });
    if (j % 41 === 20) out.push({ kind: "hulk", x: side(5) * (WALL + 3), seed: j, burnt: true });
    if (j % 7 === 4) out.push({ kind: "trash", x: side(9) * (WALL + 1.2), seed: j });
  }
  return out;
}

/** An icon in a box (x, y top left, `size` square on screen), in one colour. */
export function icon(ctx, kind, x, y, size, color) {
  if (size < 3) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.09;
  ctx.lineJoin = "round";
  const path = pts => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
  };
  const circle = (cx, cy, r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  };
  if (kind === "eye") {
    ctx.beginPath();
    ctx.moveTo(0.05, 0.5);
    ctx.quadraticCurveTo(0.5, 0.05, 0.95, 0.5);
    ctx.quadraticCurveTo(0.5, 0.95, 0.05, 0.5);
    ctx.stroke();
    circle(0.5, 0.5, 0.16);
    ctx.fill();
  } else if (kind === "skull") {
    circle(0.5, 0.42, 0.32);
    ctx.fill();
    ctx.fillRect(0.32, 0.6, 0.36, 0.28);
    ctx.fillStyle = "#0a0712";
    circle(0.38, 0.42, 0.09);
    ctx.fill();
    circle(0.62, 0.42, 0.09);
    ctx.fill();
    ctx.fillRect(0.45, 0.72, 0.04, 0.16);
    ctx.fillRect(0.53, 0.72, 0.04, 0.16);
  } else if (kind === "bolt") {
    path([[0.58, 0.04], [0.2, 0.56], [0.46, 0.56], [0.38, 0.96], [0.8, 0.4], [0.54, 0.4]]);
    ctx.fill();
  } else if (kind === "heart") {
    ctx.beginPath();
    ctx.moveTo(0.5, 0.88);
    ctx.bezierCurveTo(0.05, 0.55, 0.1, 0.12, 0.5, 0.32);
    ctx.bezierCurveTo(0.9, 0.12, 0.95, 0.55, 0.5, 0.88);
    ctx.fill();
  } else if (kind === "can") {
    ctx.fillRect(0.3, 0.12, 0.4, 0.78);
    ctx.fillStyle = "#0a0712";
    ctx.fillRect(0.3, 0.4, 0.4, 0.12);
  } else if (kind === "gun") {
    path([[0.06, 0.32], [0.94, 0.32], [0.94, 0.48], [0.5, 0.48], [0.42, 0.86], [0.24, 0.86], [0.3, 0.48], [0.06, 0.48]]);
    ctx.fill();
  } else if (kind === "slice") {
    path([[0.12, 0.14], [0.88, 0.14], [0.5, 0.92]]);
    ctx.fill();
    ctx.fillStyle = "#0a0712";
    circle(0.4, 0.34, 0.07);
    ctx.fill();
    circle(0.6, 0.46, 0.06);
    ctx.fill();
  } else if (kind === "chip") {
    ctx.fillRect(0.24, 0.24, 0.52, 0.52);
    for (let i = 0; i < 3; i++) {
      const o = 0.3 + i * 0.2;
      ctx.fillRect(o - 0.03, 0.06, 0.06, 0.18);
      ctx.fillRect(o - 0.03, 0.76, 0.06, 0.18);
      ctx.fillRect(0.06, o - 0.03, 0.18, 0.06);
      ctx.fillRect(0.76, o - 0.03, 0.18, 0.06);
    }
  } else if (kind === "star") {
    path(Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 0.2 : 0.46;
      return [0.5 + Math.cos(a) * rr, 0.52 + Math.sin(a) * rr];
    }));
    ctx.fill();
  } else if (kind === "drop") {
    ctx.beginPath();
    ctx.moveTo(0.5, 0.06);
    ctx.quadraticCurveTo(0.86, 0.5, 0.78, 0.7);
    ctx.arc(0.5, 0.66, 0.28, 0.15, Math.PI - 0.15);
    ctx.quadraticCurveTo(0.14, 0.5, 0.5, 0.06);
    ctx.fill();
  } else if (kind === "pill") {
    ctx.save();
    ctx.translate(0.5, 0.5);
    ctx.rotate(-0.7);
    ctx.fillRect(-0.36, -0.15, 0.36, 0.3);
    ctx.strokeRect(0, -0.15, 0.36, 0.3);
    ctx.restore();
  } else if (kind === "cross") {
    ctx.fillRect(0.38, 0.1, 0.24, 0.8);
    ctx.fillRect(0.1, 0.38, 0.8, 0.24);
  } else if (kind === "leaf") {
    ctx.beginPath();
    ctx.moveTo(0.15, 0.85);
    ctx.quadraticCurveTo(0.1, 0.1, 0.88, 0.12);
    ctx.quadraticCurveTo(0.85, 0.85, 0.15, 0.85);
    ctx.fill();
  } else if (kind === "bowl") {
    ctx.beginPath();
    ctx.arc(0.5, 0.45, 0.4, 0, Math.PI);
    ctx.fill();
    for (const x of [0.4, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(x, 0.42);
      ctx.lineTo(x + 0.25, 0.06);
      ctx.stroke();
    }
  }
  ctx.restore();
}


/** Flickering flames over a point, `w` wide on screen. */
export function flames(ctx, sx, sy, w, s) {
  const t = performance.now() / 1000;
  const still = calm();
  glow(ctx, sx, sy - 0.4 * s, w * 2.2, "rgba(255, 120, 30, 0.6)", 0.8);
  for (let i = 0; i < 3; i++) {
    const f = still ? 0.8 : 0.7 + 0.3 * Math.sin(t * 13 + i * 2.1 + sx);
    ctx.fillStyle = ["rgba(255, 70, 20, 0.85)", "rgba(255, 150, 30, 0.8)", "rgba(255, 230, 120, 0.8)"][i];
    ctx.beginPath();
    ctx.ellipse(sx + (i - 1) * w * 0.15, sy - (0.5 + i * 0.1) * s * f, w * (0.45 - i * 0.1), s * (0.9 - i * 0.2) * f, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A prop at its point on screen (p: { sx, sy, scale }; sx is the road's centre for x = 0 props, the prop's
 * own spot otherwise), faded into the fog, and by `fade` (0–1). `road`: the road's centre and half-width on
 * screen there, for the things that span it.
 */
export function drawProp(ctx, t, p, look, fog, road, fade = 1) {
  if (fade <= 0) return;
  const s = p.scale;
  const { sx, sy } = p;
  const now = clock();
  ctx.globalAlpha = (1 - fog * 0.85) * fade;
  // Specks in the distance: not worth the draw calls.
  if (s < 0.25 && t.kind !== "building" && t.kind !== "tower") return;
  switch (t.kind) {
    case "lamp": {
      const corpo = t.district === "corpo";
      const top = sy - (corpo ? 8 : 7) * s;
      const toRoad = t.x > 0 ? -1 : 1;
      ctx.fillStyle = "#2b2838";
      ctx.fillRect(sx - 0.12 * s, top, 0.24 * s, sy - top);
      ctx.fillRect(sx + (toRoad < 0 ? -1.6 : 0) * s, top, 1.6 * s, 0.2 * s);
      const color = look.dark ? "rgba(255, 150, 60, 0.95)" : corpo ? "rgba(220, 245, 255, 0.95)" : "rgba(180, 240, 255, 0.95)";
      const lx = sx + toRoad * 1.5 * s;
      ctx.fillStyle = color;
      ctx.fillRect(lx - 0.35 * s, top + 0.15 * s, 0.7 * s, 0.14 * s);
      glow(ctx, lx, top + 0.3 * s, 1.4 * s, color, 0.8);
      // The light falling: a cone, and a pool on the road (close up only).
      if (s < 1.2) break;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const cone = look.dark ? "rgba(255, 130, 50, 0.06)" : "rgba(140, 220, 255, 0.05)";
      ctx.fillStyle = cone;
      poly(ctx, [[lx - 0.3 * s, top + 0.3 * s], [lx - 2.6 * s, sy], [lx + 2.6 * s, sy], [lx + 0.3 * s, top + 0.3 * s]]);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(lx + toRoad * 1.2 * s, sy);
      ctx.scale(1, 0.18);
      glow(ctx, 0, 0, 4.5 * s, look.dark ? "rgba(255, 140, 50, 0.35)" : "rgba(150, 220, 255, 0.25)");
      ctx.restore();
      break;
    }
    case "chevron": {
      const w = 1.6 * s;
      const h = 1.1 * s;
      const top = sy - 1.9 * s;
      ctx.fillStyle = "#2b2838";
      ctx.fillRect(sx - 0.07 * s, top + h, 0.14 * s, 1.9 * s - h);
      ctx.fillStyle = "#111014";
      ctx.fillRect(sx - w / 2, top, w, h);
      ctx.fillStyle = "#f5d300";
      for (const off of [-0.32, 0.2]) {
        const cx = sx + off * w * t.dir;
        poly(ctx, [[cx - 0.18 * w * t.dir, top + h * 0.15], [cx + 0.12 * w * t.dir, top + h * 0.5], [cx - 0.18 * w * t.dir, top + h * 0.85], [cx - 0.02 * w * t.dir, top + h * 0.85], [cx + 0.28 * w * t.dir, top + h * 0.5], [cx - 0.02 * w * t.dir, top + h * 0.15]]);
        ctx.fill();
      }
      if (look.dark) glow(ctx, sx, top + h / 2, w, "rgba(245, 211, 0, 0.4)", 0.5);
      break;
    }
    case "pole": {
      ctx.fillStyle = "#3a2420";
      ctx.fillRect(sx - 0.15 * s, sy - 9 * s, 0.3 * s, 9 * s);
      ctx.fillRect(sx - 1.2 * s, sy - 8.6 * s, 2.4 * s, 0.25 * s);
      ctx.fillStyle = "#6a6a70";
      for (const dx of [-1.05, 0, 1.05]) ctx.fillRect(sx + dx * s - 0.06 * s, sy - 8.85 * s, 0.12 * s, 0.25 * s);
      // The wires sagging away.
      ctx.strokeStyle = "rgba(20, 10, 10, 0.5)";
      ctx.lineWidth = Math.max(0.5, 0.04 * s);
      ctx.beginPath();
      for (const dx of [-1.05, 1.05]) {
        ctx.moveTo(sx + dx * s, sy - 8.8 * s);
        ctx.quadraticCurveTo(sx + dx * s * 0.6, sy - 7.5 * s, sx + dx * s * 0.2, sy - 8.0 * s);
      }
      ctx.stroke();
      break;
    }
    case "cactus": {
      const h = (t.h ?? 3.2) * s;
      ctx.fillStyle = vgrad(ctx, sy - h, sy, [[0, "#4a7a3e"], [1, "#24442a"]]);
      rrect(ctx, sx - 0.3 * s, sy - h, 0.6 * s, h, 0.3 * s);
      ctx.fill();
      rrect(ctx, sx - 1 * s, sy - h * 0.7, 0.4 * s, h * 0.38, 0.2 * s);
      ctx.fill();
      ctx.fillRect(sx - 1 * s, sy - h * 0.38, 0.8 * s, 0.35 * s);
      rrect(ctx, sx + 0.6 * s, sy - h * 0.82, 0.4 * s, h * 0.42, 0.2 * s);
      ctx.fill();
      ctx.fillRect(sx + 0.2 * s, sy - h * 0.44, 0.8 * s, 0.35 * s);
      break;
    }
    case "rock": {
      ctx.fillStyle = "#5a3a2a";
      ctx.beginPath();
      ctx.ellipse(sx, sy - 0.1 * s, 3 * s, 1.6 * s, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 190, 120, 0.15)";
      ctx.beginPath();
      ctx.ellipse(sx - 0.6 * s, sy - 0.9 * s, 1.6 * s, 0.6 * s, -0.2, Math.PI, 0);
      ctx.fill();
      break;
    }
    case "palm": {
      const h = (t.h ?? 8) * s;
      ctx.strokeStyle = "#3a2a24";
      ctx.lineWidth = Math.max(1, 0.35 * s);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + 0.9 * s, sy - h * 0.5, sx + 0.3 * s, sy - h);
      ctx.stroke();
      const cx = sx + 0.3 * s;
      const cy = sy - h;
      ctx.strokeStyle = "#16503a";
      ctx.lineWidth = Math.max(1, 0.3 * s);
      const sway = Math.sin(now * 1.3 + t.x) * 0.08;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI + (i / 6) * Math.PI + sway;
        const len = (2.2 + (i % 2) * 0.6) * s;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, cy + Math.sin(a) * len * 0.6 - 0.6 * s, cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.3 + 0.9 * s);
        ctx.stroke();
      }
      ctx.fillStyle = "#3a2a24";
      ctx.beginPath();
      ctx.arc(cx, cy, 0.3 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "building":
      building(ctx, t, s, sx, sy, look);
      break;
    case "tower":
      tower(ctx, t, s, sx, sy, now);
      break;
    case "billboard": {
      const [text, color, glyph] = ADS[t.ad];
      const w = 9 * s;
      const h = 3.4 * s;
      const top = sy - 6.5 * s - h;
      ctx.fillStyle = "#1b1726";
      ctx.fillRect(sx - w * 0.3 - 0.15 * s, sy - 6.5 * s, 0.3 * s, 6.5 * s);
      ctx.fillRect(sx + w * 0.3 - 0.15 * s, sy - 6.5 * s, 0.3 * s, 6.5 * s);
      ctx.fillStyle = "#0a0712";
      ctx.fillRect(sx - w / 2, top, w, h);
      // Lit from below at night.
      glow(ctx, sx, top + h, w * 0.5, rgba(color, 0.35), 0.6);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.5, 0.15 * s);
      ctx.strokeRect(sx - w / 2, top, w, h);
      const pad = h * 0.14;
      icon(ctx, glyph, sx - w / 2 + pad, top + pad, h - pad * 2, color);
      const room = w - h - pad;
      label(ctx, text, sx - w / 2 + h + room / 2, top + h * 0.62, fit(text, room * 0.92, h * 0.42), color);
      break;
    }
    case "screen": {
      // A video wall on a pylon: an ad that changes, colour bars rolling between.
      const [text, color, glyph] = ADS[(t.ad + Math.floor(now / 4)) % ADS.length];
      const w = 7 * s;
      const h = 4 * s;
      const top = sy - 7 * s - h;
      ctx.fillStyle = "#1b1d26";
      ctx.fillRect(sx - 0.25 * s, sy - 7 * s, 0.5 * s, 7 * s);
      ctx.fillStyle = vgrad(ctx, top, top + h, [[0, mix(color, "#000000", 0.55)], [1, "#06040c"]]);
      ctx.fillRect(sx - w / 2, top, w, h);
      icon(ctx, glyph, sx - h * 0.3, top + h * 0.1, h * 0.6, color);
      label(ctx, text, sx, top + h * 0.92, fit(text, w * 0.9, h * 0.2), "#ffffff");
      if (now % 4 < 0.25) {
        const bars = ["#ff2a6d", "#f5d300", "#00f0ff", "#3dff8b", "#ff5ce1"];
        bars.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(sx - w / 2 + (i * w) / 5, top, w / 5, h);
        });
      }
      ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
      for (let y = top; y < top + h; y += Math.max(1.5, 0.25 * s)) ctx.fillRect(sx - w / 2, y, w, Math.max(0.5, 0.08 * s));
      glow(ctx, sx, top + h / 2, w * 0.8, rgba(color, 0.4), 0.5);
      break;
    }
    case "holo": {
      // A hologram turning over a little plinth.
      const [text, color, glyph] = ADS[t.ad];
      ctx.fillStyle = "#20222c";
      ctx.fillRect(sx - 0.8 * s, sy - 0.8 * s, 1.6 * s, 0.8 * s);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const turn = Math.cos(now * 1.2 + t.x);
      const size = 3.2 * s;
      ctx.globalAlpha *= 0.55 + 0.15 * Math.sin(now * 11);
      ctx.translate(sx, sy - 4.2 * s);
      ctx.scale(Math.max(0.08, Math.abs(turn)), 1);
      icon(ctx, glyph, -size / 2, -size / 2, size, color);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(color, 0.12);
      poly(ctx, [[sx - 0.6 * s, sy - 0.8 * s], [sx - 2 * s, sy - 6 * s], [sx + 2 * s, sy - 6 * s], [sx + 0.6 * s, sy - 0.8 * s]]);
      ctx.fill();
      ctx.restore();
      label(ctx, text, sx, sy - 6.4 * s, fit(text, 5 * s, 0.6 * s), color);
      break;
    }
    case "tree": {
      ctx.fillStyle = "#2a2c36";
      ctx.fillRect(sx - 0.8 * s, sy - 0.7 * s, 1.6 * s, 0.7 * s);
      ctx.fillStyle = "#3a3d4a";
      ctx.fillRect(sx - 0.8 * s, sy - 0.75 * s, 1.6 * s, 0.1 * s);
      ctx.fillStyle = "#3a2a24";
      ctx.fillRect(sx - 0.08 * s, sy - 2.6 * s, 0.16 * s, 2 * s);
      ctx.fillStyle = vgrad(ctx, sy - 4.4 * s, sy - 2 * s, [[0, "#3a8a5a"], [1, "#163a2a"]]);
      ctx.beginPath();
      ctx.arc(sx, sy - 3.2 * s, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
      glow(ctx, sx, sy - 0.8 * s, 1.2 * s, "rgba(0, 240, 255, 0.5)", 0.5);
      break;
    }
    case "barrel":
      ctx.fillStyle = "#3a2a20";
      ctx.fillRect(sx - 0.4 * s, sy - 1.1 * s, 0.8 * s, 1.1 * s);
      ctx.fillStyle = "#4a3428";
      ctx.fillRect(sx - 0.4 * s, sy - 0.75 * s, 0.8 * s, 0.08 * s);
      flames(ctx, sx, sy - 1.1 * s, 0.8 * s, s);
      break;
    case "steam": {
      // A vent: puffs rising and spreading.
      ctx.fillStyle = "#2a2830";
      ctx.fillRect(sx - 0.5 * s, sy - 0.15 * s, 1 * s, 0.15 * s);
      for (let i = 0; i < 4; i++) {
        const k = (now * 0.5 + i / 4 + hash(t.seed)) % 1;
        ctx.fillStyle = `rgba(200, 190, 210, ${0.22 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(sx + Math.sin(k * 3 + i) * 0.4 * s, sy - (0.4 + k * 4) * s, (0.4 + k * 1.4) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "trash": {
      ctx.fillStyle = "#1e1c22";
      ctx.beginPath();
      ctx.ellipse(sx, sy, 1.2 * s, 0.7 * s, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "#2a3a2a";
      ctx.fillRect(sx - 0.9 * s, sy - 1 * s, 0.7 * s, 0.6 * s);
      ctx.fillStyle = "#3a2a3a";
      ctx.fillRect(sx + 0.1 * s, sy - 0.85 * s, 0.6 * s, 0.5 * s);
      break;
    }
    case "graffiti": {
      // A wall panel sprayed in neon.
      ctx.fillStyle = "#2a3238";
      ctx.fillRect(sx - 3 * s, sy - 2.4 * s, 6 * s, 2.4 * s);
      const tags = ["MAELSTROM", "NO FUTURE", "VDB", "6TH ST", "CHOOMBA"];
      const color = ["#ff2a6d", "#3dff8b", "#ff5ce1", "#f5d300", "#00f0ff"][t.seed % 5];
      label(ctx, tags[t.seed % tags.length], sx, sy - 0.9 * s, fit(tags[t.seed % tags.length], 5.4 * s, 1.2 * s), color, "center", "italic bold 20px sans-serif");
      break;
    }
    case "hulk": {
      // A wrecked car on the shoulder, rusted out (or still smouldering).
      const w = 1.9 * s;
      ctx.fillStyle = t.burnt ? "#1c1618" : "#6a3a24";
      ctx.fillRect(sx - w / 2, sy - 0.9 * s, w, 0.7 * s);
      ctx.fillStyle = t.burnt ? "#141012" : "#4a2a1c";
      ctx.fillRect(sx - w * 0.35, sy - 1.35 * s, w * 0.7, 0.45 * s);
      ctx.fillStyle = "#0a0808";
      ctx.fillRect(sx - w * 0.28, sy - 1.28 * s, w * 0.56, 0.32 * s);
      ctx.fillRect(sx - w / 2, sy - 0.3 * s, 0.3 * s, 0.3 * s);
      if (t.burnt) {
        for (let i = 0; i < 3; i++) {
          const k = (now * 0.3 + i / 3) % 1;
          ctx.fillStyle = `rgba(40, 36, 44, ${0.4 * (1 - k)})`;
          ctx.beginPath();
          ctx.arc(sx, sy - (1.5 + k * 5) * s, (0.4 + k * 1.2) * s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "derrick": {
      // An oil pump nodding.
      const nod = Math.sin(now * 1.4 + t.seed) * 0.25;
      ctx.strokeStyle = "#2a1c18";
      ctx.lineWidth = Math.max(1, 0.25 * s);
      ctx.beginPath();
      ctx.moveTo(sx - 1.5 * s, sy);
      ctx.lineTo(sx, sy - 4 * s);
      ctx.lineTo(sx + 1.5 * s, sy);
      ctx.stroke();
      ctx.save();
      ctx.translate(sx, sy - 4 * s);
      ctx.rotate(nod);
      ctx.fillStyle = "#3a2420";
      ctx.fillRect(-3.5 * s, -0.3 * s, 7 * s, 0.6 * s);
      ctx.fillStyle = "#f5d300";
      poly(ctx, [[3.5 * s, -0.9 * s], [4.6 * s, -0.3 * s], [4.6 * s, 0.9 * s], [3.5 * s, 0.9 * s]]);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "camp": {
      // A Nomad camp: a tent and a fire.
      ctx.fillStyle = "#5a4030";
      poly(ctx, [[sx - 3 * s, sy], [sx - 1.5 * s, sy - 2.2 * s], [sx, sy]]);
      ctx.fill();
      ctx.fillStyle = "#3a2a20";
      poly(ctx, [[sx - 1.8 * s, sy], [sx - 1.5 * s, sy - 1.2 * s], [sx - 1.2 * s, sy]]);
      ctx.fill();
      flames(ctx, sx + 1.2 * s, sy, 0.7 * s, s * 0.8);
      break;
    }
    case "crowd": {
      // Fans at the start: heads and shoulders, phones up, flashes going off.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const h = (1.5 + hash(t.seed * 7 + i) * 0.4) * s;
        const x = sx + (i - n / 2) * 0.55 * s;
        ctx.fillStyle = ["#1c1824", "#24202c", "#2a1a24"][i % 3];
        rrect(ctx, x - 0.24 * s, sy - h, 0.48 * s, h, 0.18 * s);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, sy - h - 0.16 * s, 0.17 * s, 0, Math.PI * 2);
        ctx.fill();
        if (hash(t.seed + i * 3) > 0.6) {
          const flash = Math.floor(now * 3 + i * 1.7 + t.seed) % 7 === 0;
          ctx.fillStyle = flash ? "#ffffff" : "#5cc8ff";
          ctx.fillRect(x + 0.1 * s, sy - h - 0.5 * s, 0.12 * s, 0.18 * s);
          if (flash) glow(ctx, x + 0.16 * s, sy - h - 0.4 * s, 1.2 * s, "rgba(255, 255, 255, 0.9)");
        }
      }
      break;
    }
    case "arch":
      arch(ctx, t, s, road, sy, now, look);
      break;
    case "gantry":
      gantry(ctx, t, s, road, sy, look);
      break;
    case "overpass":
      overpass(ctx, t, s, road, sy, now);
      break;
  }
  ctx.globalAlpha = 1;
}

/** A building beside the road: dark, lit windows, a neon sign; the Combat Zone's have fire escapes, Pacifica's are ruins. */
function building(ctx, t, s, sx, sy, look) {
  const w = t.w * s;
  const h = t.h * s;
  const x0 = sx - w / 2;
  const base = look.dark ? "#120c18" : t.district === "pacifica" ? "#14242c" : "#161a30";
  ctx.fillStyle = vgrad(ctx, sy - h, sy, [[0, mix(base, "#ffffff", 0.06)], [1, base]]);
  if (t.ruin) {
    // Broken off at the top.
    const pts = [[x0, sy], [x0, sy - h * 0.8]];
    for (let i = 0; i <= 6; i++) pts.push([x0 + (i / 6) * w, sy - h * (0.8 + 0.2 * hash(t.x + i))]);
    pts.push([x0 + w, sy]);
    poly(ctx, pts);
    ctx.fill();
  } else ctx.fillRect(x0, sy - h, w, h);
  // The side facing the road, a shade lighter.
  const face = 0.12 * w;
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.fillRect(t.x > 0 ? x0 : x0 + w - face, sy - h * (t.ruin ? 0.8 : 1), face, h * (t.ruin ? 0.8 : 1));
  if (w > 14) {
    ctx.fillStyle = look.dark ? "rgba(255, 150, 70, 0.6)" : t.district === "pacifica" ? "rgba(255, 110, 200, 0.45)" : "rgba(150, 220, 255, 0.5)";
    const cols = Math.max(2, Math.floor(t.w / 3));
    const rows = Math.max(2, Math.floor(t.h / 3.5));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (t.ruin && r < rows * 0.25) continue;
        if (hash(t.x * 31 + c * 7 + r * 13 + t.h) > (look.dark ? 0.8 : 0.6)) ctx.fillRect(x0 + ((c + 0.3) / cols) * w, sy - h + ((r + 0.3) / rows) * h, (w / cols) * 0.4, (h / rows) * 0.35);
      }
    }
    if (t.escape && w > 12) {
      // A fire escape zig-zagging down the front.
      ctx.strokeStyle = "rgba(10, 6, 12, 0.85)";
      ctx.lineWidth = Math.max(0.5, 0.12 * s);
      const ex = t.x > 0 ? x0 + w * 0.2 : x0 + w * 0.55;
      ctx.beginPath();
      for (let y = sy - h * 0.9, i = 0; y < sy - 2 * s; y += 3 * s, i++) {
        ctx.moveTo(ex, y);
        ctx.lineTo(ex + w * 0.25, y);
        ctx.moveTo(ex + (i % 2 ? 0 : w * 0.25), y);
        ctx.lineTo(ex + (i % 2 ? w * 0.25 : 0), y + 3 * s);
      }
      ctx.stroke();
    }
  }
  if (t.sign !== null && t.sign !== undefined) neonSign(ctx, t, s, x0, w, h, sy);
}

/** A neon sign down the side nearest the road. */
function neonSign(ctx, t, s, x0, w, h, sy) {
  const [text, color] = SIGNS[t.sign];
  const bw = 2.2 * s;
  const bh = Math.min(h * 0.5, 7 * s);
  const bx = t.x > 0 ? x0 + 0.4 * s : x0 + w - bw - 0.4 * s;
  const by = sy - h * 0.85;
  ctx.fillStyle = "#08060c";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, 0.12 * s);
  ctx.strokeRect(bx, by, bw, bh);
  glow(ctx, bx + bw / 2, by + bh / 2, bh * 0.8, rgba(color, 0.45), 0.6);
  const chars = [...text];
  const px = Math.min(bw * 0.8, (bh * 0.9) / chars.length);
  chars.forEach((ch, i) => label(ctx, ch, bx + bw / 2, by + (i + 0.85) * (bh / chars.length), px, color));
}

/** A glass tower: a gradient face, mullions, a reflection band sliding as you pass. */
function tower(ctx, t, s, sx, sy, now) {
  const w = t.w * s;
  const h = t.h * s;
  const x0 = sx - w / 2;
  const tints = [["#1a2a5a", "#0a1030"], ["#2a1a4a", "#0c0a24"], ["#103a4a", "#06141e"]];
  const [a, b] = tints[Math.floor(t.tint * tints.length)];
  ctx.fillStyle = vgrad(ctx, sy - h, sy, [[0, a], [1, b]]);
  ctx.fillRect(x0, sy - h, w, h);
  if (w > 12) {
    ctx.fillStyle = "rgba(160, 220, 255, 0.10)";
    const band = ((sx * 0.6) % (w * 2) + w * 2) % (w * 2) - w * 0.5;
    poly(ctx, [[x0 + band, sy - h], [x0 + band + w * 0.25, sy - h], [x0 + band - w * 0.2, sy], [x0 + band - w * 0.45, sy]]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, sy - h, w, h);
    ctx.clip();
    poly(ctx, [[x0 + band, sy - h], [x0 + band + w * 0.25, sy - h], [x0 + band - w * 0.2, sy], [x0 + band - w * 0.45, sy]]);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    const cols = Math.max(3, Math.floor(t.w / 2.5));
    for (let c = 1; c < cols; c++) ctx.fillRect(x0 + (c / cols) * w, sy - h, Math.max(0.5, 0.06 * s), h);
    ctx.fillStyle = "rgba(170, 235, 255, 0.55)";
    // Lit floors only close enough to tell apart.
    const rows = w > 26 ? Math.floor(t.h / 3.2) : 0;
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash(t.x * 17 + c * 5 + r * 11) > 0.72) ctx.fillRect(x0 + (c / cols) * w + 0.08 * s, sy - h + (r / rows) * h, w / cols - 0.16 * s, Math.max(0.5, 0.5 * s));
      }
    }
    // A lit crown.
    ctx.fillStyle = "rgba(0, 240, 255, 0.7)";
    ctx.fillRect(x0, sy - h, w, Math.max(0.5, 0.25 * s));
    if (Math.floor(now * 1.2 + t.x) % 2) glow(ctx, sx, sy - h, 0.8 * s, "rgba(255, 40, 40, 1)");
  }
  if (t.sign !== null && t.sign !== undefined) neonSign(ctx, t, s, x0, w, Math.min(h, 30 * s), sy);
}

/** The start (or finish) arch over the road: a checkered banner, start lights, flags. */
function arch(ctx, t, s, road, sy, now, look) {
  const cx = road.sx;
  const half = road.w * (WALL / 7) + 0.6 * s;
  const top = sy - 7.5 * s;
  ctx.fillStyle = "#1e1c26";
  for (const sd of [-1, 1]) ctx.fillRect(cx + sd * half - 0.35 * s, top, 0.7 * s, sy - top);
  ctx.fillStyle = "#14121a";
  ctx.fillRect(cx - half, top, half * 2, 2 * s);
  // The checkered band.
  const sq = 0.5 * s;
  for (let x = cx - half, i = 0; x < cx + half; x += sq, i++) {
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (i + r) % 2 ? "#f0f0f4" : "#101014";
      ctx.fillRect(x, top + 0.2 * s + r * sq, Math.min(sq, cx + half - x), sq);
    }
  }
  label(ctx, t.text, cx, top + 1.85 * s, fit(t.text, half, 0.6 * s), "#ff2a6d");
  glow(ctx, cx, top + 1.6 * s, half * 0.5, "rgba(255, 42, 109, 0.5)", 0.6);
  // Lights hanging under it: the countdown (red one pair at a time, then green), idle otherwise.
  for (let i = -2; i <= 2; i++) {
    const lx = cx + i * 1.1 * s;
    ctx.fillStyle = "#0a0a0e";
    ctx.fillRect(lx - 0.4 * s, top + 2 * s, 0.8 * s, 0.8 * s);
    const n = look.lights ?? 0;
    const color = n >= 4 ? "#3dff8b" : n > 0 && Math.abs(i) >= 3 - n ? "#ff2a3d" : n ? "#3a1018" : Math.floor(now * 2 + i) % 3 ? "#3a1018" : "#ff2a3d";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, top + 2.4 * s, 0.25 * s, 0, Math.PI * 2);
    ctx.fill();
    if (color !== "#3a1018") glow(ctx, lx, top + 2.4 * s, 0.9 * s, color === "#3dff8b" ? "rgba(61, 255, 139, 0.8)" : "rgba(255, 42, 61, 0.8)", 0.8);
  }
  // Flags on the posts.
  for (const sd of [-1, 1]) {
    const fx = cx + sd * half;
    const wave = Math.sin(now * 6 + sd) * 0.3 * s;
    ctx.fillStyle = sd < 0 ? "#00f0ff" : "#ff2a6d";
    poly(ctx, [[fx, top - 0.2 * s], [fx + sd * 1.8 * s, top + 0.3 * s + wave], [fx, top + 1 * s]]);
    ctx.fill();
  }
}

/** A sign gantry over the road: two green signs, lit from below. */
function gantry(ctx, t, s, road, sy, look) {
  const cx = road.sx;
  const half = road.w * (WALL / 7) + 0.6 * s;
  const top = sy - 6.6 * s;
  ctx.fillStyle = "#3a3d48";
  for (const sd of [-1, 1]) ctx.fillRect(cx + sd * half - 0.2 * s, top, 0.4 * s, sy - top);
  ctx.fillRect(cx - half, top, half * 2, 0.3 * s);
  ctx.fillRect(cx - half, top + 0.9 * s, half * 2, 0.15 * s);
  const holo = t.district === "corpo";
  const [a, b] = t.lines;
  const sw = half * 0.9;
  for (const [i, text] of [[0, a], [1, b]]) {
    const x = cx - half + 0.4 * s + i * (sw + 0.2 * s);
    const y = top - 2.2 * s;
    if (holo) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(0, 240, 255, 0.12)";
      ctx.fillRect(x, y, sw, 2.2 * s);
      ctx.strokeStyle = "rgba(0, 240, 255, 0.8)";
      ctx.lineWidth = Math.max(0.5, 0.08 * s);
      ctx.strokeRect(x, y, sw, 2.2 * s);
      ctx.restore();
      label(ctx, text, x + sw / 2, y + 1.4 * s, fit(text, sw * 0.9, 0.8 * s), "#bff8ff");
    } else {
      ctx.fillStyle = "#0e5a32";
      ctx.fillRect(x, y, sw, 2.2 * s);
      ctx.strokeStyle = "#e8f0e8";
      ctx.lineWidth = Math.max(0.5, 0.06 * s);
      ctx.strokeRect(x + 0.1 * s, y + 0.1 * s, sw - 0.2 * s, 2 * s);
      label(ctx, text, x + sw / 2, y + 1.4 * s, fit(text, sw * 0.88, 0.8 * s), "#f0f4f0", "center", "bold 20px sans-serif");
      if (look.dark) glow(ctx, x + sw / 2, y + 2.2 * s, sw * 0.4, "rgba(220, 255, 220, 0.3)", 0.5);
    }
  }
}

/** An overpass across everything: a concrete deck on pillars, a neon strip on its edge, lights underneath. */
function overpass(ctx, t, s, road, sy, now) {
  const cx = road.sx;
  const half = road.w * (WALL / 7) + 1.5 * s;
  const deck = sy - 7.5 * s;
  ctx.fillStyle = "#1c1a22";
  for (const sd of [-1, 1]) ctx.fillRect(cx + sd * half - 0.8 * s, deck, 1.6 * s, sy - deck);
  ctx.fillStyle = vgrad(ctx, deck - 2.2 * s, deck, [[0, "#3a3842"], [1, "#24222a"]]);
  ctx.fillRect(-20, deck - 2.2 * s, 400, 2.2 * s);
  ctx.fillStyle = "#121016";
  ctx.fillRect(-20, deck, 400, 0.4 * s);
  const color = t.district === "corpo" ? "#00f0ff" : "#ff2a6d";
  ctx.fillStyle = color;
  ctx.fillRect(-20, deck - 2.25 * s, 400, Math.max(0.6, 0.12 * s));
  glow(ctx, cx, deck - 2.2 * s, half * 0.8, rgba(color, 0.4), 0.5);
  for (let i = -2; i <= 2; i++) {
    glow(ctx, cx + i * 2.6 * s, deck + 0.3 * s, 1.2 * s, "rgba(255, 220, 160, 0.8)", 0.7);
  }
  if (t.district === "combat") label(ctx, "NO FUTURE", cx, deck - 0.7 * s, fit("NO FUTURE", half, 1 * s), "#ff5ce1", "center", "italic bold 20px sans-serif");
}

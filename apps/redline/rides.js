import { calm, fit, glow, label, mix, poly, rrect, vgrad } from "./gfx.js";

/*
 * REDLINE's rides (the race draws them in apps/redline/draw.js; the start menu's garage, apps/redline/menu.js,
 * shows them side on). From behind: each ride class has its own shape (the Compact a tall hatch with a roof
 * spoiler and round lights, the Sport a low wedge with a wing, a light bar and four pipes, the Roadbike a twin
 * with upswept pipes and an upright rider, the Superbike a fairing, an under-tail exhaust and a tucked
 * rider), and so does traffic (sedans, Delamain-yellow taxis, box vans, semi trailers, tankers, NCPD cruisers
 * with their light bars, Maelstrom gangers with spiked helmets). Tyres roll (their tread moves with the
 * distance), tail lights glow (brighter braking), exhausts flash on a backfire. The `ride` record is in
 * drawRide's comment.
 */

/** Ride colours: the AI pack in turn, traffic, NCPD, gangers, the player. */
export const PAINT = ["#ff2a6d", "#f5d300", "#8a5cff", "#3dff8b", "#ff8a1c", "#ff5ce1", "#5cc8ff", "#ffffff"];
export const PLAYER_PAINT = "#00f0ff";

/** Car bodies from behind: height (m), the glass's share of it, the cabin's width at its foot and roof (of the car's). */
const CARS = {
  compact: { h: 1.55, belt: 0.52, cabin: [0.88, 0.76], lights: "round", spoiler: "roof", pipes: 1 },
  sport: { h: 1.2, belt: 0.58, cabin: [0.72, 0.5], lights: "bar", spoiler: "wing", pipes: 4, diffuser: true },
  car: { h: 1.4, belt: 0.56, cabin: [0.8, 0.62], lights: "split", trunk: true, pipes: 1 },
  taxi: { h: 1.45, belt: 0.56, cabin: [0.8, 0.62], lights: "split", trunk: true, sign: true, checker: true, pipes: 1 },
  cop: { h: 1.42, belt: 0.56, cabin: [0.8, 0.62], lights: "split", trunk: true, lightbar: true, lower: "#0e1016", pipes: 2 }
};

const blinkAt = ms => calm() || Math.floor(performance.now() / ms) % 2;

/**
 * A ride from behind, its ground point at (sx, sy), `s` pixels per metre. `ride`: { bike, w, paint, kind
 * ("me", "racer", "ghost" or a traffic kind), cls (a ride class, for "me", "racer" and "ghost"), lean
 * (−1..1), brake, tag (plate), punch (−1/0/1: an arm out that side), windup (−1/0/1: winding up to swing or
 * swerve that way), lights (NCPD), helmet, logo (a semi's), spin (metres rolled), backfire (0–1), night (the
 * district is dark: lights glow more) }.
 */
export function drawRide(ctx, sx, sy, s, ride) {
  const w = ride.w * s;
  ctx.save();
  ctx.translate(sx, sy);
  // A shadow under it.
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.ellipse(0, -0.02 * s, w * (ride.bike ? 0.75 : 0.62), 0.22 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  let top;
  if (ride.bike) top = bike(ctx, s, ride);
  else if (ride.kind === "van") top = van(ctx, s, w, ride);
  else if (ride.kind === "semi") top = semi(ctx, s, w, ride);
  else if (ride.kind === "truck") top = tanker(ctx, s, w, ride);
  else top = car(ctx, s, w, ride, CARS[ride.cls] ?? CARS[ride.kind] ?? CARS.car);
  ctx.restore();
  // A warning over anyone about to swing or swerve at you.
  if (ride.windup && s > 1.2) {
    const r = Math.max(4, 0.42 * s);
    const y = sy + top - r * 1.6;
    ctx.fillStyle = blinkAt(120) ? "#ff2a3d" : "#f5d300";
    poly(ctx, [[sx, y - r], [sx + r, y + r * 0.8], [sx - r, y + r * 0.8]]);
    ctx.fill();
    label(ctx, "!", sx, y + r * 0.62, r * 1.3, "#0a0712");
  }
}

/** A tyre seen from behind: `x` its left edge, `tw` wide, `th` tall; tread moving with `spin`. */
function tyre(ctx, x, tw, th, s, spin) {
  ctx.fillStyle = "#0a0a0d";
  rrect(ctx, x, -th, tw, th, Math.min(tw, th) * 0.3);
  ctx.fill();
  if (s < 3) return;
  ctx.fillStyle = "rgba(90, 90, 105, 0.28)";
  const gap = th / 4;
  const off = (((spin ?? 0) * s * 0.9) % gap + gap) % gap;
  for (let y = -th + off; y < 0; y += gap) ctx.fillRect(x + tw * 0.2, y, tw * 0.6, Math.max(0.4, gap * 0.14));
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.fillRect(x + tw * 0.12, -th, tw * 0.12, th);
}

/** A tail light: lit braking, dim otherwise; a glow round it (bigger at night). */
function tail(ctx, x, y, w, h, s, ride, shape = "rect") {
  ctx.fillStyle = ride.brake ? "#ff3a3a" : "#9a1020";
  if (shape === "round") {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x, y, w, h);
  if (ride.brake) {
    ctx.fillStyle = "rgba(255, 220, 220, 0.8)";
    ctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.35);
  }
  glow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * (ride.brake ? 2.2 : 1.4), ride.brake ? "rgba(255, 40, 40, 0.75)" : "rgba(255, 20, 40, 0.5)", ride.brake ? 0.9 : ride.night ? 0.55 : 0.3);
}

/** An exhaust pipe's end, flashing on a backfire. */
function pipe(ctx, x, y, r, ride) {
  ctx.fillStyle = "#6a6e78";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0a0d";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  if (ride.backfire > 0) {
    glow(ctx, x, y, r * 6 * ride.backfire, "rgba(255, 150, 40, 0.9)", 1);
    glow(ctx, x, y, r * 2.5, "rgba(180, 220, 255, 0.9)", ride.backfire);
  }
}

/** A plate under the lights. */
function plate(ctx, y, s, tag) {
  ctx.fillStyle = "#e8e8f0";
  ctx.fillRect(-0.36 * s, y, 0.72 * s, 0.2 * s);
  if (tag) label(ctx, tag, 0, y + 0.165 * s, fit(tag, 0.64 * s, 0.17 * s), "#111");
}

/* ---------------- Cars ---------------- */

function car(ctx, s, w, ride, spec) {
  const H = spec.h * s;
  const lean = (ride.lean ?? 0) * 0.08 * s;
  const paint = ride.paint.startsWith("#") ? ride.paint : "#888888";
  const belt = -H * (1 - spec.belt) - 0.15 * s;
  const foot = -0.22 * s;
  ctx.rotate(-(ride.lean ?? 0) * 0.025);
  const tw = 0.36 * s;
  tyre(ctx, -w / 2 + 0.02 * s, tw, 0.62 * s, s, ride.spin);
  tyre(ctx, w / 2 - tw - 0.02 * s, tw, 0.62 * s, s, ride.spin);
  // The body.
  const c = 0.12 * s;
  poly(ctx, [[-w / 2 + c, foot], [w / 2 - c, foot], [w / 2, foot - c * 1.4], [w / 2, belt + c * 0.6], [w / 2 - c, belt], [-w / 2 + c, belt], [-w / 2, belt + c * 0.6], [-w / 2, foot - c * 1.4]]);
  ctx.fillStyle = vgrad(ctx, belt, foot, [[0, mix(paint, "#ffffff", 0.28)], [0.25, paint], [1, mix(paint, "#000000", 0.5)]]);
  ctx.fill();
  if (spec.lower) {
    ctx.fillStyle = spec.lower;
    ctx.fillRect(-w / 2, (belt + foot) / 2 + 0.05 * s, w, foot - (belt + foot) / 2 - 0.05 * s);
  }
  if (spec.checker && s > 3) {
    // A checker band across the back.
    const sq = 0.12 * s;
    for (let i = 0, x = -w / 2; x < w / 2 - 0.01; x += sq, i++) {
      ctx.fillStyle = i % 2 ? "#111" : "#f5f0e0";
      ctx.fillRect(x, belt + 0.12 * s, Math.min(sq, w / 2 - x), sq * 0.9);
    }
  }
  // The shoulder line and the boot's panel.
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(-w / 2 + c, belt + 0.03 * s, w - 2 * c, Math.max(0.5, 0.03 * s));
  if (spec.trunk && s > 4) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = Math.max(0.5, 0.025 * s);
    ctx.strokeRect(-w * 0.3, belt + 0.06 * s, w * 0.6, (foot - belt) * 0.42);
  }
  // The cabin: pillars in the paint, the rear glass, a streak of reflection.
  const roof = -H - 0.15 * s;
  const [b0, b1] = spec.cabin;
  poly(ctx, [[-w * b0 / 2 + lean * 0.4, belt], [-w * b1 / 2 + lean, roof], [w * b1 / 2 + lean, roof], [w * b0 / 2 + lean * 0.4, belt]]);
  ctx.fillStyle = mix(paint, "#000000", 0.3);
  ctx.fill();
  const i = 0.07 * s;
  poly(ctx, [[-w * b0 / 2 + i * 1.6 + lean * 0.4, belt], [-w * b1 / 2 + i + lean, roof + i], [w * b1 / 2 - i + lean, roof + i], [w * b0 / 2 - i * 1.6 + lean * 0.4, belt]]);
  ctx.fillStyle = vgrad(ctx, roof, belt, [[0, "#2a3656"], [1, "#0a0f1c"]]);
  ctx.fill();
  if (s > 3) {
    ctx.fillStyle = "rgba(200, 230, 255, 0.13)";
    poly(ctx, [[-w * b1 * 0.2 + lean, roof + i], [-w * b1 * 0.05 + lean, roof + i], [-w * b0 * 0.25 + lean * 0.4, belt], [-w * b0 * 0.42 + lean * 0.4, belt]]);
    ctx.fill();
  }
  ctx.fillStyle = mix(paint, "#ffffff", 0.35);
  ctx.fillRect(-w * b1 / 2 + lean, roof, w * b1, Math.max(0.5, 0.04 * s));
  // Spoilers.
  if (spec.spoiler === "roof") {
    ctx.fillStyle = mix(paint, "#000000", 0.2);
    ctx.fillRect(-w * b1 * 0.56 + lean, roof - 0.05 * s, w * b1 * 1.12, 0.09 * s);
  }
  // Lights.
  const ly = belt + 0.12 * s;
  if (spec.lights === "round") {
    for (const side of [-1, 1]) {
      tail(ctx, side * w * 0.42 - 0.13 * s, ly, 0.26 * s, 0.26 * s, s, ride, "round");
      tail(ctx, side * w * 0.42 - 0.13 * s - side * 0.3 * s, ly + 0.03 * s, 0.2 * s, 0.2 * s, s, ride, "round");
    }
  } else if (spec.lights === "bar") {
    tail(ctx, -w * 0.46, ly, w * 0.92, 0.07 * s, s, ride);
    for (const side of [-1, 1]) tail(ctx, side > 0 ? w * 0.46 - 0.3 * s : -w * 0.46, ly - 0.03 * s, 0.3 * s, 0.14 * s, s, ride);
  } else {
    for (const side of [-1, 1]) tail(ctx, side > 0 ? w / 2 - 0.08 * s - w * 0.22 : -w / 2 + 0.08 * s, ly, w * 0.22, 0.2 * s, s, ride);
  }
  // Bumper, plate, pipes.
  ctx.fillStyle = "#1a1a20";
  ctx.fillRect(-w / 2 + c * 0.5, foot - 0.16 * s, w - c, 0.16 * s);
  if (spec.diffuser && s > 3) {
    ctx.fillStyle = "#0a0a0d";
    for (let k = -2; k <= 2; k++) ctx.fillRect(k * w * 0.09 - 0.02 * s, foot - 0.14 * s, 0.04 * s, 0.14 * s);
  }
  plate(ctx, foot - 0.44 * s, s, ride.tag ?? "");
  if (s > 2.5) {
    const n = spec.pipes;
    const xs = n === 4 ? [-0.38, -0.28, 0.28, 0.38] : n === 2 ? [-0.34, 0.34] : [0.34];
    for (const x of xs) pipe(ctx, x * w, foot - 0.06 * s, 0.07 * s, ride);
  }
  if (spec.spoiler === "wing") {
    // A wing on two struts over the boot.
    ctx.fillStyle = "#15141a";
    for (const side of [-1, 1]) ctx.fillRect(side * w * 0.3 - 0.03 * s, belt - 0.28 * s, 0.06 * s, 0.3 * s);
    ctx.fillStyle = mix(paint, "#000000", 0.15);
    ctx.fillRect(-w * 0.5, belt - 0.34 * s, w, 0.09 * s);
    ctx.fillStyle = "#15141a";
    ctx.fillRect(-w * 0.52, belt - 0.4 * s, 0.06 * s, 0.2 * s);
    ctx.fillRect(w * 0.46, belt - 0.4 * s, 0.06 * s, 0.2 * s);
  }
  // Roof extras: an NCPD light bar, a taxi's sign.
  if (spec.lightbar) {
    const on = blinkAt(160);
    ctx.fillStyle = "#1a1c24";
    ctx.fillRect(-w * 0.3 + lean, roof - 0.16 * s, w * 0.6, 0.16 * s);
    const lit = ride.lights !== false;
    ctx.fillStyle = lit && on ? "#ff2a3d" : "#5a1018";
    ctx.fillRect(-w * 0.28 + lean, roof - 0.14 * s, w * 0.26, 0.11 * s);
    ctx.fillStyle = lit && !on ? "#3d6bff" : "#101a50";
    ctx.fillRect(w * 0.02 + lean, roof - 0.14 * s, w * 0.26, 0.11 * s);
    if (lit) {
      glow(ctx, -w * 0.15 + lean, roof - 0.1 * s, (on ? 1.8 : 0.6) * s, "rgba(255, 40, 60, 0.9)", 0.8);
      glow(ctx, w * 0.15 + lean, roof - 0.1 * s, (on ? 0.6 : 1.8) * s, "rgba(60, 110, 255, 0.9)", 0.8);
    }
    if (s > 4) label(ctx, "NCPD", 0, belt + 0.5 * s, Math.min(0.24 * s, w * 0.12), "#e8eaf2");
  }
  if (spec.sign) {
    ctx.fillStyle = "#16141a";
    ctx.fillRect(-w * 0.18 + lean, roof - 0.2 * s, w * 0.36, 0.2 * s);
    ctx.fillStyle = "#ffd84a";
    ctx.fillRect(-w * 0.16 + lean, roof - 0.18 * s, w * 0.32, 0.15 * s);
    if (s > 4) label(ctx, "TAXI", lean, roof - 0.065 * s, Math.min(0.13 * s, w * 0.07), "#16141a");
    glow(ctx, lean, roof - 0.1 * s, 0.9 * s, "rgba(255, 220, 90, 0.6)", ride.night ? 0.6 : 0.3);
  }
  // Winding up to swerve: the indicator on that side flashing.
  if (ride.windup && blinkAt(120)) {
    const x = ride.windup > 0 ? w / 2 - 0.3 * s : -w / 2 + 0.05 * s;
    ctx.fillStyle = "#ffb000";
    ctx.fillRect(x, ly - 0.24 * s, 0.25 * s, 0.18 * s);
    glow(ctx, x + 0.12 * s, ly - 0.15 * s, 1.1 * s, "rgba(255, 176, 0, 0.9)", 0.9);
  }
  return roof - 0.2 * s;
}

/** A box van's back: two doors with windows, tall lights at the corners. */
function van(ctx, s, w, ride) {
  const H = 2.7 * s;
  const top = -H - 0.15 * s;
  for (const side of [-1, 1]) tyre(ctx, side > 0 ? w / 2 - 0.4 * s : -w / 2 + 0.02 * s, 0.38 * s, 0.66 * s, s, ride.spin);
  rrect(ctx, -w / 2, top, w, H - 0.1 * s, 0.25 * s);
  ctx.fillStyle = vgrad(ctx, top, -0.2 * s, [[0, mix(ride.paint, "#ffffff", 0.2)], [1, mix(ride.paint, "#000000", 0.35)]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = Math.max(0.5, 0.05 * s);
  ctx.strokeRect(-w / 2 + 0.14 * s, top + 0.14 * s, w - 0.28 * s, H - 0.5 * s);
  ctx.beginPath();
  ctx.moveTo(0, top + 0.14 * s);
  ctx.lineTo(0, -0.36 * s);
  ctx.stroke();
  ctx.fillStyle = "#1a2236";
  for (const side of [-1, 1]) ctx.fillRect(side > 0 ? 0.12 * s : -w / 2 + 0.3 * s, top + 0.35 * s, w / 2 - 0.42 * s, 0.55 * s);
  ctx.fillStyle = "#2a2a30";
  for (const side of [-1, 1]) ctx.fillRect(side * 0.12 * s - (side < 0 ? 0.25 * s : 0), -H * 0.45, 0.25 * s, 0.06 * s);
  if (ride.logo && s > 3) label(ctx, ride.logo, 0, -H * 0.62, fit(ride.logo, w * 0.7, 0.3 * s), "rgba(20, 20, 30, 0.6)");
  for (const side of [-1, 1]) tail(ctx, side > 0 ? w / 2 - 0.12 * s : -w / 2 + 0.02 * s, -1.4 * s, 0.1 * s, 0.7 * s, s, ride);
  ctx.fillStyle = "#1a1a20";
  ctx.fillRect(-w / 2, -0.42 * s, w, 0.2 * s);
  plate(ctx, -0.66 * s, s, "");
  return top;
}

/** A semi trailer's back: doors, lock bars, reflective tape, mud flaps, a logo, amber markers up top. */
function semi(ctx, s, w, ride) {
  const H = 3.9 * s;
  const top = -H - 0.15 * s;
  for (const side of [-1, 1]) {
    tyre(ctx, side > 0 ? w / 2 - 0.42 * s : -w / 2 + 0.02 * s, 0.4 * s, 0.7 * s, s, ride.spin);
    tyre(ctx, side > 0 ? w / 2 - 0.84 * s : -w / 2 + 0.44 * s, 0.38 * s, 0.7 * s, s, ride.spin);
  }
  ctx.fillStyle = vgrad(ctx, top, -0.5 * s, [[0, mix(ride.paint, "#ffffff", 0.15)], [1, mix(ride.paint, "#000000", 0.25)]]);
  ctx.fillRect(-w / 2, top, w, H - 0.35 * s);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = Math.max(0.5, 0.05 * s);
  ctx.strokeRect(-w / 2 + 0.1 * s, top + 0.1 * s, w - 0.2 * s, H - 0.55 * s);
  ctx.beginPath();
  ctx.moveTo(0, top + 0.1 * s);
  ctx.lineTo(0, -0.55 * s);
  ctx.stroke();
  if (ride.logo && s > 2) label(ctx, ride.logo, 0, -H * 0.62, fit(ride.logo, w * 0.82, H * 0.12), "rgba(20, 20, 30, 0.7)");
  // Lock bars.
  ctx.fillStyle = "#7a7e88";
  for (const x of [-0.36, -0.14, 0.14, 0.36]) ctx.fillRect(x * w - 0.025 * s, top + 0.2 * s, 0.05 * s, H - 0.8 * s);
  // Red and white tape along the bottom.
  if (s > 2) {
    const seg = 0.3 * s;
    for (let i = 0, x = -w / 2; x < w / 2; x += seg, i++) {
      ctx.fillStyle = i % 2 ? "#e8e8f0" : "#d01020";
      ctx.fillRect(x, -0.62 * s, Math.min(seg, w / 2 - x), 0.08 * s);
    }
  }
  // Amber markers.
  ctx.fillStyle = "#ffb000";
  for (const x of [-0.2, 0, 0.2]) {
    ctx.fillRect(x * w - 0.06 * s, top + 0.03 * s, 0.12 * s, 0.07 * s);
    if (ride.night) glow(ctx, x * w, top + 0.06 * s, 0.5 * s, "rgba(255, 176, 0, 0.8)", 0.6);
  }
  // The ICC bar, mud flaps, lights.
  ctx.fillStyle = "#2a2a30";
  ctx.fillRect(-w * 0.42, -0.5 * s, w * 0.84, 0.12 * s);
  ctx.fillStyle = "#111";
  ctx.fillRect(-w / 2 + 0.06 * s, -0.55 * s, 0.4 * s, 0.5 * s);
  ctx.fillRect(w / 2 - 0.46 * s, -0.55 * s, 0.4 * s, 0.5 * s);
  for (const side of [-1, 1]) tail(ctx, side > 0 ? w / 2 - 0.36 * s : -w / 2 + 0.06 * s, -0.86 * s, 0.3 * s, 0.2 * s, s, ride);
  return top;
}

/** A tanker's back: a round chrome tank, a ladder, a hazard diamond. */
function tanker(ctx, s, w, ride) {
  const r = 1.2 * s;
  const cy = -2.05 * s;
  for (const side of [-1, 1]) {
    tyre(ctx, side > 0 ? w / 2 - 0.42 * s : -w / 2 + 0.02 * s, 0.4 * s, 0.7 * s, s, ride.spin);
    tyre(ctx, side > 0 ? w / 2 - 0.84 * s : -w / 2 + 0.44 * s, 0.38 * s, 0.7 * s, s, ride.spin);
  }
  ctx.fillStyle = "#2a2a30";
  ctx.fillRect(-w / 2, -0.9 * s, w, 0.3 * s);
  const grad = ctx.createLinearGradient(-r, 0, r, 0);
  grad.addColorStop(0, "#5a5e66");
  grad.addColorStop(0.35, "#e8ecf2");
  grad.addColorStop(0.6, "#a4aab4");
  grad.addColorStop(1, "#4a4e56");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, cy, Math.min(r, w / 2), r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = Math.max(0.5, 0.05 * s);
  ctx.beginPath();
  ctx.ellipse(0, cy, Math.min(r, w / 2) * 0.85, r * 0.85, 0, 0, Math.PI * 2);
  ctx.stroke();
  // The ladder up the middle.
  ctx.fillStyle = "#3a3d44";
  ctx.fillRect(-0.24 * s, cy - r * 0.9, 0.05 * s, r * 1.6);
  ctx.fillRect(0.19 * s, cy - r * 0.9, 0.05 * s, r * 1.6);
  for (let y = cy - r * 0.8; y < cy + r * 0.7; y += 0.28 * s) ctx.fillRect(-0.24 * s, y, 0.48 * s, 0.04 * s);
  // The hazard diamond.
  if (s > 2.5) {
    ctx.save();
    ctx.translate(w * 0.28, cy + r * 0.2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#ff8a1c";
    ctx.fillRect(-0.18 * s, -0.18 * s, 0.36 * s, 0.36 * s);
    ctx.restore();
  }
  for (const side of [-1, 1]) tail(ctx, side > 0 ? w / 2 - 0.36 * s : -w / 2 + 0.06 * s, -0.86 * s, 0.3 * s, 0.2 * s, s, ride);
  ctx.fillStyle = "#111";
  ctx.fillRect(-w / 2 + 0.06 * s, -0.55 * s, 0.4 * s, 0.5 * s);
  ctx.fillRect(w / 2 - 0.46 * s, -0.55 * s, 0.4 * s, 0.5 * s);
  return cy - r;
}

/* ---------------- Bikes ---------------- */

function bike(ctx, s, ride) {
  const kind = ride.kind === "gang" ? "gang" : ride.cls === "superbike" ? "superbike" : "roadbike";
  const sup = kind === "superbike";
  const lean = ride.lean ?? 0;
  ctx.rotate(lean * 0.32);
  const paint = ride.paint;
  // The tyre and the hugger over it.
  const tw = (sup ? 0.3 : 0.25) * s;
  tyre(ctx, -tw / 2, tw, 0.68 * s, s, ride.spin);
  ctx.fillStyle = mix(paint.startsWith("#") ? paint : "#888888", "#000000", 0.4);
  ctx.fillRect(-tw * 0.6, -0.76 * s, tw * 1.2, 0.1 * s);
  // Pipes: a twin's upswept either side; a superbike's under its tail.
  const chrome = vgrad(ctx, -0.75 * s, -0.4 * s, [[0, "#e0e4ec"], [1, "#4a4e58"]]);
  if (!sup) {
    for (const side of [-1, 1]) {
      ctx.fillStyle = chrome;
      poly(ctx, [[side * 0.14 * s, -0.42 * s], [side * 0.36 * s, -0.6 * s], [side * 0.36 * s, -0.74 * s], [side * 0.14 * s, -0.56 * s]]);
      ctx.fill();
      pipe(ctx, side * 0.36 * s, -0.67 * s, 0.065 * s, ride);
    }
  }
  // The frame and engine, with the fairing's sides in the paint.
  ctx.fillStyle = "#18161e";
  ctx.fillRect(-0.3 * s, -1.0 * s, 0.6 * s, 0.32 * s);
  ctx.fillStyle = vgrad(ctx, -1.1 * s, -0.6 * s, [[0, mix(paint, "#ffffff", 0.25)], [1, mix(paint, "#000000", 0.45)]]);
  if (sup) poly(ctx, [[-0.44 * s, -0.66 * s], [-0.3 * s, -1.08 * s], [0.3 * s, -1.08 * s], [0.44 * s, -0.66 * s], [0.2 * s, -0.78 * s], [-0.2 * s, -0.78 * s]]);
  else poly(ctx, [[-0.34 * s, -0.8 * s], [-0.3 * s, -1.06 * s], [0.3 * s, -1.06 * s], [0.34 * s, -0.8 * s]]);
  ctx.fill();
  // The tail: a superbike's sharp cowl with an LED strip and its pipes; a twin's fender and round light.
  if (sup) {
    ctx.fillStyle = mix(paint, "#000000", 0.2);
    poly(ctx, [[-0.2 * s, -0.98 * s], [-0.06 * s, -1.2 * s], [0.06 * s, -1.2 * s], [0.2 * s, -0.98 * s]]);
    ctx.fill();
    tail(ctx, -0.13 * s, -1.0 * s, 0.26 * s, 0.05 * s, s, ride);
    for (const side of [-1, 1]) pipe(ctx, side * 0.08 * s, -0.9 * s, 0.05 * s, ride);
    plate(ctx, -0.72 * s, s * 0.42, "");
  } else {
    tail(ctx, -0.08 * s, -0.86 * s, 0.16 * s, 0.12 * s, s, ride, "round");
    plate(ctx, -0.72 * s, s * 0.42, "");
  }
  // The rider: legs to the pegs, the jacket (a stripe of the paint down the back), the helmet.
  const hip = -1.05 * s;
  const sh = sup ? -1.45 * s : -1.66 * s;
  const sw = (sup ? 0.34 : 0.32) * s;
  ctx.fillStyle = "#14121a";
  for (const side of [-1, 1]) {
    poly(ctx, [[side * 0.06 * s, hip], [side * 0.22 * s, hip], [side * (0.44 + Math.max(0, lean * side) * 0.12) * s, -0.82 * s], [side * 0.34 * s, -0.56 * s], [side * 0.24 * s, -0.6 * s], [side * 0.28 * s, -0.84 * s]]);
    ctx.fill();
  }
  const jacket = kind === "gang" ? "#2a1a1a" : "#1c1824";
  ctx.fillStyle = vgrad(ctx, sh, hip, [[0, mix(jacket, "#ffffff", 0.12)], [1, jacket]]);
  poly(ctx, [[-0.2 * s, hip], [-sw, sh + 0.12 * s], [-sw * 0.8, sh], [sw * 0.8, sh], [sw, sh + 0.12 * s], [0.2 * s, hip]]);
  ctx.fill();
  ctx.fillStyle = kind === "gang" ? "#c01830" : paint;
  ctx.fillRect(-0.05 * s, sh + 0.04 * s, 0.1 * s, hip - sh - 0.06 * s);
  ctx.fillRect(-sw * 0.82, sh, 0.12 * s, 0.1 * s);
  ctx.fillRect(sw * 0.82 - 0.12 * s, sh, 0.12 * s, 0.1 * s);
  // Arms to the bars, unless one is swinging.
  const arm = (side, x, y) => {
    ctx.strokeStyle = jacket;
    ctx.lineWidth = Math.max(1, 0.15 * s);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * sw * 0.8, sh + 0.08 * s);
    ctx.lineTo(side * x * s, y * s);
    ctx.stroke();
    ctx.fillStyle = "#0e0c12";
    ctx.beginPath();
    ctx.arc(side * x * s, y * s, 0.11 * s, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const side of [-1, 1]) {
    if (ride.windup === side) arm(side, 0.48, sup ? -2.05 : -2.25);
    else if (ride.punch === side) arm(side, 1.25, sup ? -1.25 : -1.35);
    else arm(side, 0.44, sup ? -1.18 : -1.3);
  }
  // The helmet.
  const hy = sh - 0.2 * s;
  const hr = 0.19 * s;
  const lid = ride.helmet ?? paint;
  ctx.fillStyle = vgrad(ctx, hy - hr, hy + hr, [[0, mix(lid.startsWith("#") ? lid : "#888888", "#ffffff", 0.35)], [1, mix(lid.startsWith("#") ? lid : "#888888", "#000000", 0.4)]]);
  ctx.beginPath();
  ctx.arc(0, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  if (kind === "gang") {
    // Maelstrom spikes.
    ctx.fillStyle = "#d8d0c0";
    for (const a of [-0.9, -0.3, 0.3, 0.9]) {
      const x = Math.sin(a) * hr;
      const y = hy - Math.cos(a) * hr;
      poly(ctx, [[x - 0.05 * s, y + 0.02 * s], [x + Math.sin(a) * 0.22 * s, y - Math.cos(a) * 0.22 * s], [x + 0.05 * s, y + 0.02 * s]]);
      ctx.fill();
    }
    glow(ctx, 0, hy + hr * 0.2, 0.25 * s, "rgba(255, 30, 40, 0.9)", 0.6);
  } else {
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(-0.035 * s, hy - hr, 0.07 * s, hr * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    ctx.arc(-hr * 0.35, hy - hr * 0.35, hr * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ride.lights) {
    const on = blinkAt(160);
    glow(ctx, -0.2 * s, hy - hr, 1.2 * s, on ? "rgba(255, 40, 60, 0.9)" : "rgba(60, 110, 255, 0.9)", 0.8);
  }
  return hy - hr - 0.1 * s;
}

/* ---------------- Side on (the garage) ---------------- */

/**
 * A ride class side on, facing right, its wheels on (x, y), `s` pixels per metre, in `paint`. `spin`: metres
 * rolled (the rims turn). For the start menu's garage.
 */
export function drawProfile(ctx, x, y, s, cls, paint, spin = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(0, 0, (cls.includes("bike") ? 1.3 : 2.4) * s, 0.12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  const wheel = (wx, r) => {
    ctx.fillStyle = "#0a0a0d";
    ctx.beginPath();
    ctx.arc(wx, -r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a4e58";
    ctx.beginPath();
    ctx.arc(wx, -r, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c8ccd4";
    ctx.lineWidth = Math.max(1, r * 0.1);
    const a0 = spin / Math.max(0.1, r / s);
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(wx, -r);
      ctx.lineTo(wx + Math.cos(a) * r * 0.58, -r + Math.sin(a) * r * 0.58);
      ctx.stroke();
    }
    ctx.fillStyle = "#1a1a20";
    ctx.beginPath();
    ctx.arc(wx, -r, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  };
  const body = pts => {
    poly(ctx, pts.map(([px, py]) => [px * s, py * s]));
    ctx.fillStyle = vgrad(ctx, -1.6 * s, 0, [[0, mix(paint, "#ffffff", 0.3)], [0.45, paint], [1, mix(paint, "#000000", 0.55)]]);
    ctx.fill();
  };
  const glass = pts => {
    poly(ctx, pts.map(([px, py]) => [px * s, py * s]));
    ctx.fillStyle = vgrad(ctx, -1.6 * s, -0.7 * s, [[0, "#3a4a70"], [1, "#0a0f1c"]]);
    ctx.fill();
  };
  const light = (lx, ly, w, h, color, r) => {
    ctx.fillStyle = color;
    ctx.fillRect(lx * s, ly * s, w * s, h * s);
    glow(ctx, (lx + w / 2) * s, (ly + h / 2) * s, r * s, color, 0.7);
  };
  if (cls === "sport") {
    body([[-2.25, -0.3], [-2.3, -0.75], [-1.9, -0.9], [-0.9, -1.05], [-0.3, -1.25], [0.6, -1.2], [1.4, -0.85], [2.3, -0.62], [2.35, -0.3], [2.1, -0.22], [-2.1, -0.22]]);
    glass([[-0.75, -1.02], [-0.25, -1.2], [0.55, -1.16], [1.2, -0.86], [-0.5, -0.86]]);
    // The wing.
    ctx.fillStyle = "#15141a";
    ctx.fillRect(-2.0 * s, -1.2 * s, 0.08 * s, 0.3 * s);
    ctx.fillRect(-2.35 * s, -1.28 * s, 0.75 * s, 0.1 * s);
    light(-2.32, -0.72, 0.08, 0.1, "#ff2a3d", 0.6);
    light(2.2, -0.6, 0.14, 0.08, "#e8f4ff", 0.8);
    ctx.fillStyle = "rgba(0, 240, 255, 0.85)";
    ctx.fillRect(-1.9 * s, -0.4 * s, 3.7 * s, 0.04 * s);
    wheel(-1.45 * s, 0.38 * s);
    wheel(1.45 * s, 0.36 * s);
  } else if (cls === "compact") {
    body([[-1.85, -0.3], [-1.9, -1.0], [-1.7, -1.5], [-0.6, -1.6], [0.5, -1.55], [1.3, -1.0], [1.95, -0.85], [2.0, -0.32], [1.8, -0.22], [-1.7, -0.22]]);
    glass([[-1.62, -1.42], [-0.6, -1.5], [0.42, -1.46], [1.12, -1.02], [-1.6, -1.02]]);
    ctx.fillStyle = mix(paint, "#000000", 0.3);
    ctx.fillRect(-0.55 * s, -1.5 * s, 0.06 * s, 0.48 * s);
    ctx.fillStyle = "#15141a";
    ctx.fillRect(-1.95 * s, -1.62 * s, 0.5 * s, 0.08 * s);
    light(-1.92, -0.95, 0.07, 0.16, "#ff2a3d", 0.6);
    light(1.88, -0.78, 0.1, 0.1, "#e8f4ff", 0.7);
    ctx.fillStyle = "#2a2a30";
    ctx.fillRect(-1.95 * s, -0.42 * s, 3.95 * s, 0.12 * s);
    wheel(-1.2 * s, 0.34 * s);
    wheel(1.25 * s, 0.34 * s);
  } else {
    // A bike: wheels, swingarm and fork, the engine, the tank and seat (a superbike's under a full fairing).
    const sup = cls === "superbike";
    const line = (pts, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, width * s);
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * s, py * s) : ctx.moveTo(px * s, py * s)));
      ctx.stroke();
    };
    line([[-0.85, -0.33], [-0.1, -0.5]], "#2a2830", 0.07);
    line([[0.85, -0.33], [0.55, -1.08]], "#8a8e98", 0.06);
    wheel(-0.85 * s, 0.33 * s);
    wheel(0.85 * s, 0.33 * s);
    ctx.fillStyle = "#18161e";
    ctx.fillRect(-0.25 * s, -0.78 * s, 0.6 * s, 0.4 * s);
    ctx.fillStyle = "#3a3842";
    for (let k = 0; k < 4; k++) ctx.fillRect((-0.2 + k * 0.13) * s, -0.74 * s, 0.07 * s, 0.32 * s);
    if (sup) {
      body([[-1.0, -0.98], [-0.86, -1.04], [-0.35, -0.93], [0.1, -1.08], [0.42, -1.12], [0.62, -1.26], [0.98, -0.86], [0.86, -0.52], [0.3, -0.36], [-0.2, -0.44], [-0.5, -0.74], [-0.95, -0.86]]);
      glass([[0.42, -1.12], [0.62, -1.26], [0.78, -1.06], [0.5, -1.04]]);
      ctx.fillStyle = "#ff2a6d";
      poly(ctx, [[-0.5 * s, -0.8 * s], [0.75 * s, -0.8 * s], [0.7 * s, -0.74 * s], [-0.45 * s, -0.74 * s]]);
      ctx.fill();
      ctx.fillStyle = "#0a0a0d";
      for (let k = 0; k < 3; k++) ctx.fillRect((0.15 + k * 0.12) * s, -0.66 * s, 0.07 * s, 0.14 * s);
      line([[-0.55, -0.9], [-0.9, -0.95]], "#c8ccd4", 0.06);
      light(-1.02, -1.0, 0.08, 0.05, "#ff2a3d", 0.4);
      light(0.9, -0.92, 0.09, 0.05, "#e8f4ff", 0.6);
    } else {
      // A twin: an exhaust swept back, a teardrop tank, a flat seat, a round headlight.
      line([[0.15, -0.42], [-0.35, -0.5], [-0.75, -0.62]], "#c8ccd4", 0.07);
      line([[-0.55, -0.58], [-0.95, -0.66]], "#e0e4ec", 0.12);
      body([[-0.02, -0.88], [0.12, -1.02], [0.45, -1.04], [0.6, -0.92], [0.45, -0.82], [0.05, -0.8]]);
      ctx.fillStyle = "#1a1820";
      poly(ctx, [[-0.62 * s, -0.9 * s], [-0.02 * s, -0.88 * s], [0.02 * s, -0.8 * s], [-0.6 * s, -0.82 * s]].map(([px, py]) => [px, py]));
      ctx.fill();
      body([[-0.9, -0.92], [-0.62, -0.94], [-0.6, -0.84], [-0.86, -0.82]]);
      line([[-0.85, -0.33], [-0.6, -0.84]], "#2a2830", 0.05);
      line([[0.52, -1.1], [0.42, -1.18], [0.3, -1.16]], "#2a2830", 0.04);
      light(-0.95, -0.88, 0.07, 0.05, "#ff2a3d", 0.4);
      ctx.fillStyle = "#c8ccd4";
      ctx.beginPath();
      ctx.arc(0.68 * s, -1.0 * s, 0.09 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8f4ff";
      ctx.beginPath();
      ctx.arc(0.72 * s, -1.0 * s, 0.06 * s, 0, Math.PI * 2);
      ctx.fill();
      glow(ctx, 0.78 * s, -1.0 * s, 0.45 * s, "#e8f4ff", 0.5);
    }
  }
  ctx.restore();
}

import { reduceMotion } from "../../scripts/ui/a11y.js";

/*
 * REDLINE's little drawing helpers, shared by the race (apps/redline/draw.js), the rides (rides.js), the
 * roadside (scenery.js) and the start menu (menu.js).
 */

let calmAt = -Infinity;
let calmNow = false;
/**
 * Reduce motion, looked up at most twice a second (the setting and the media query are slow, and the frame
 * asks hundreds of times).
 */
export function calm() {
  const now = performance.now();
  if (now - calmAt > 500) {
    calmAt = now;
    calmNow = reduceMotion();
  }
  return calmNow;
}

export const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = k => Math.min(1, Math.max(0, k));

/** Two colours mixed (#rrggbb), `k` of the way to the second. */
export function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = sh => Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, k));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** #rrggbb with an alpha. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Text at any size, smoothly (fonts snap to whole pixels; this scales a fixed one), fading in as it grows
 * from too small to read (as NCART Runner's). `font`: "bold 20px monospace" unless given (at 20px).
 */
export function label(ctx, text, x, y, px, color, align = "center", font = "bold 20px monospace") {
  if (px < 1.5) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, (px - 1.5) / 2);
  ctx.translate(x, y);
  ctx.scale(px / 20, px / 20);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A label's size so it fits `width` (monospace: about 0.6 of the size per character). */
export const fit = (text, width, most) => Math.min(most, width / (text.length * 0.62));

/** A soft light: a radial glow added over what's there. */
export function glow(ctx, x, y, r, color, alpha = 1) {
  // (Too small to see: skipped, there are a lot of these.)
  if (r < 1.5 || alpha <= 0 || ctx.globalAlpha < 0.04) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha *= alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** A rounded rectangle path. */
export function rrect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** A closed path through points. */
export function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** A vertical gradient between two y's. */
export function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([at, c]) => g.addColorStop(at, c));
  return g;
}

import { store } from "../../scripts/store.js";

/*
 * 4Tify's scan wave: while a scan runs, a ring travels outward from the character's token every few seconds, on every
 * client that can see the token. Drawn from the marks each client already has, so nothing extra goes over the socket.
 */

const EVERY_MS = 4000;
const TRAVEL_MS = 1600;
/** How far the wave reaches past the token's edge, in grid squares. */
const REACH = 5;
const COLOR = 0xff8c32;

/** One ring, gone when it arrives (or when the scene or the token is). */
function sendWave(token) {
  const ticker = canvas.app.ticker;
  const ring = canvas.interface.addChild(new PIXI.Graphics());
  ring.name = "fortify-wave";
  const start = performance.now();
  const edge = Math.max(token.w, token.h) / 2;
  const reach = canvas.grid.size * REACH;
  const draw = () => {
    const t = (performance.now() - start) / TRAVEL_MS;
    if (ring.destroyed || token.destroyed || t >= 1) {
      ticker.remove(draw);
      if (!ring.destroyed) ring.destroy();
      return;
    }
    const { x, y } = token.center;
    const radius = edge + reach * (1 - (1 - t) ** 2);
    const fade = 1 - t ** 3;
    ring.clear();
    ring.beginFill(COLOR, 0.12 * fade).drawCircle(x, y, radius).endFill();
    ring.lineStyle(canvas.grid.size * 0.09, COLOR, fade).drawCircle(x, y, radius);
    ring.lineStyle(canvas.grid.size * 0.05, COLOR, 0.5 * fade).drawCircle(x, y, Math.max(edge, radius - canvas.grid.size * 0.35));
  };
  ticker.add(draw);
}

function sendWaves() {
  if (!canvas?.ready) return;
  for (const mark of Object.values(store.apps.fortifyMarks ?? {})) {
    if (mark.status !== "scanning") continue;
    const token = game.actors.get(mark.actorId)?.getActiveTokens()[0];
    if (token?.visible) sendWave(token);
  }
}

export function ready() {
  setInterval(sendWaves, EVERY_MS);
}

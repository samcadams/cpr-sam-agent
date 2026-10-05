/*
 * WatchBox (No/Brainer, 50eb; All About Agents p. 8). The Agent, left in the middle of a room no
 * bigger than 20 × 20 m, spends 5 minutes assessing it. After that, anyone new moving in it sets off
 * a loud alarm (the GM decides, and triggers it). It stops if the Agent is moved, and doesn't work on
 * Internal Agents.
 *
 * Watch (apps.watch[actorId]): { status: "assessing"|"armed"|"alarm", sceneId, templateId, x, y, size
 *   (the square: centre and side, in pixels), assessUntil (world time), assessAt (real ms: the
 *   assessment ends at whichever of the two comes first), soundId }
 */

export const WATCH_SIZE_M = 20;
export const ASSESS_SECONDS = 5 * 60;

/** The square's side in pixels on a scene (20 m, in the scene's grid). */
export function squarePixels(scene) {
  const distance = Number(scene.grid.distance) || 1;
  return (WATCH_SIZE_M / distance) * scene.grid.size;
}

/** A token's centre in pixels. */
export function tokenCenter(token, scene) {
  const size = scene.grid.size;
  return { x: token.x + ((token.width ?? 1) * size) / 2, y: token.y + ((token.height ?? 1) * size) / 2 };
}

/** Is a point inside the watched square? */
export function inSquare(watch, point) {
  const half = watch.size / 2;
  return Math.abs(point.x - watch.x) <= half && Math.abs(point.y - watch.y) <= half;
}


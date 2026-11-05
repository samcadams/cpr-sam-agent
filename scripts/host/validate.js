import { canSendImages, feature } from "../model/features.js";
import { clean, splitText } from "../util/text.js";

/* Checks on what clients send the host. */

/** Mark a request handler as GM only (see host/index.js). */
export const gm = name => ({ name, gmOnly: true });

/** One text bubble. Longer texts become several bubbles (`textParts`), at most MAX_PARTS. */
export const MAX_LENGTH = 2000;
export const MAX_PARTS = 10;
export const MAX_NAME = 60;

/** A sent text as its bubbles: [""] when there is no text (a bare photo, location or job). */
export function textParts(text) {
  const parts = splitText(text, MAX_LENGTH, MAX_PARTS);
  return parts.length ? parts : [""];
}

/** A shared map location: a Note (map pin) on a scene, or a bare point. Returns null if invalid. */
export function cleanLocation(loc) {
  if (!loc || typeof loc !== "object" || !feature("locations")) return null;
  const scene = game.scenes.get(loc.sceneId);
  if (!scene) return null;
  const note = loc.noteId ? scene.notes.get(loc.noteId) : null;
  const x = Number(note?.x ?? loc.x);
  const y = Number(note?.y ?? loc.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const label = loc.label || note?.text || note?.entry?.name || scene.name;
  return { sceneId: scene.id, sceneName: scene.navName || scene.name, noteId: note?.id ?? null, x, y, label: clean(label, MAX_NAME) };
}

/** Photos: the GM when images are on, players too when the GM allows it (see model/features.js). */
export function cleanImage(path, user) {
  if (!canSendImages(user) || typeof path !== "string") return null;
  path = path.trim();
  if (!path || path.length > 500) return null;
  // A web link or a path on the server; nothing else (no data:, javascript: and the like).
  return /^https?:\/\//i.test(path) || !/^[a-z][a-z0-9+.-]*:/i.test(path) ? path : null;
}

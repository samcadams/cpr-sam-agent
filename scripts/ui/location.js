import { formDialog, formIn } from "./dialogs/formDialog.js";
import { DIALOGS } from "../config.js";
import { feature } from "../model/features.js";
import { mapConfig, mapReady, mapRows, ownPins } from "../../apps/map/model.js";

/*
 * Map locations: picking a map pin (or the sender's own position) to share, and jumping to one.
 */

const MAP = "map";

/**
 * The Map app's Night City (apps/map) as one more "scene" to pick from: the pins this user has. Its places
 * have no scene (the Map draws them); the scene it was seeded from isn't listed beside it.
 */
function mapChoice() {
  if (!feature("app_map") || !mapReady()) return null;
  const notes = ownPins().filter(p => p.name).map(p => ({ id: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label));
  return notes.length ? { id: MAP, name: "Night City (the Map)", notes } : null;
}

function locationScenes() {
  const map = mapChoice();
  const seeded = map ? mapConfig().seeded?.from : null;
  const scenes = game.scenes
    .filter(s => s.id !== seeded && s.notes.size && (game.user.isGM || s.navigation || s.testUserPermission(game.user, "LIMITED")))
    .map(s => ({
      id: s.id,
      name: s.navName || s.name,
      notes: s.notes
        .map(n => ({ id: n.id, label: n.text || n.entry?.name || "" }))
        .filter(n => n.label)
        .sort((a, b) => a.label.localeCompare(b.label))
    }))
    .filter(s => s.notes.length);
  return map ? [map, ...scenes] : scenes;
}

/** Dialog listing map pins by scene. Resolves to a location or null. */
export async function pickLocation(current = null) {
  const scenes = locationScenes();
  if (!scenes.length && !current) {
    ui.notifications.warn("No map pins available to share.");
    return null;
  }
  const shown = scenes.find(s => s.id === MAP) ?? scenes.find(s => s.id === canvas.scene?.id) ?? scenes.find(s => /map/i.test(s.name)) ?? scenes[0];
  for (const scene of scenes) scene.shown = scene === shown;

  return formDialog({
    title: "Share a location",
    template: DIALOGS.pickLocation,
    data: { scenes, current },
    label: "Attach",
    render: html => {
      const form = formIn(html);
      if (!form.scene) return;
      const update = () => {
        const scene = form.scene.value;
        const filter = form.filter.value.trim().toLowerCase();
        for (const el of form.querySelectorAll("[data-scene]")) {
          el.hidden = el.dataset.scene !== scene || !el.textContent.toLowerCase().includes(filter);
        }
      };
      form.scene.addEventListener("change", update);
      form.filter.addEventListener("input", update);
    },
    callback: html => {
      const value = html.find("input[name=pin]:checked").val();
      if (!value) return null;
      if (value === "current") return current;
      const [sceneId, noteId] = value.split("|");
      // A Map pin: no scene (the Map draws it), in the Map's px.
      if (sceneId === MAP) {
        const row = mapRows()[noteId];
        return row ? { noteId, x: row.x, y: row.y, label: row.name || "Pin", sceneName: "Night City" } : null;
      }
      const scene = game.scenes.get(sceneId);
      const note = scene?.notes.get(noteId);
      if (!note) return null;
      return {
        sceneId,
        noteId,
        x: note.x,
        y: note.y,
        label: note.text || note.entry?.name || scene.name,
        sceneName: scene.navName || scene.name
      };
    }
  });
}

/** Switch to the location's scene, pan to the pin and ping it (locally). */
export async function openLocation({ sceneId, noteId, x, y }) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return ui.notifications.warn("That map is no longer available.");
  const note = noteId ? scene.notes.get(noteId) : null;
  const point = { x: note?.x ?? x, y: note?.y ?? y };

  if (canvas.scene?.id !== scene.id) {
    const ready = new Promise(resolve => {
      Hooks.once("canvasReady", resolve);
      setTimeout(resolve, 10_000);
    });
    try {
      await scene.view();
    } catch (err) {
      return ui.notifications.warn("You can't open that map.");
    }
    if (canvas.scene?.id !== scene.id) await ready;
    if (canvas.scene?.id !== scene.id) return;
  }
  await canvas.animatePan({ x: point.x, y: point.y, scale: Math.max(canvas.stage.scale.x, 1), duration: 750 });
  canvas.ping?.(point);
}

/** GM: show a token on its scene (e.g. a Trauma Team call), and select it. */
export async function panToToken({ sceneId, tokenId }) {
  const scene = game.scenes.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if (!token) return ui.notifications.warn("That token isn't on a scene any more.");
  const size = scene.grid.size;
  await openLocation({ sceneId, x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 });
  token.object?.control({ releaseOthers: true });
}

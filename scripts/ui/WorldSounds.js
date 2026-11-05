import { MODULE_ID } from "../config.js";
import { playBlip, playSound } from "../util/audio.js";

/*
 * Phones heard in the world: the host announces a sound at a token; each client plays it locally,
 * louder the closer one of its tokens is. Users who already hear that phone in their own UI are
 * listed in `muteFor` and skip it, so nobody hears the same ring twice.
 */


/*
 * Volume: every in-world phone sound (text tones and rings alike) plays on Foundry's "environment"
 * channel, so the core Ambient slider scales them, times the "In-world phone volume" setting,
 * times distance falloff.
 */

/** Tokens this client "hears" through: controlled tokens, else (for players) any owned token. */
function listeners() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length || game.user.isGM) return controlled;
  return canvas.tokens?.placeables.filter(t => t.document.isOwner) ?? [];
}

function volumeFor(data) {
  if (canvas.scene?.id !== data.sceneId) return 0;
  let nearest = Infinity;
  for (const token of listeners()) {
    const { x, y } = token.center;
    nearest = Math.min(nearest, Math.hypot(x - data.x, y - data.y));
  }
  if (nearest >= data.radius) return 0;
  const falloff = 1 - nearest / data.radius;
  return game.settings.get(MODULE_ID, "worldVolume") * (data.volume ?? 1) * falloff * falloff;
}

export const WorldSounds = {
  active: new Map(),

  async play(data) {
    if (data.muteFor?.includes(game.user.id)) return;
    const volume = volumeFor(data);
    if (!data.loop && volume <= 0) return;
    // A synth blip (Flappy Chrome): no file, so it follows the core Ambient slider by hand.
    if (data.blip) return playBlip(data.blip, volume * (game.settings.get("core", "globalAmbientVolume") ?? 1));

    const entry = { stopped: false, sound: null, timer: null };
    if (data.loop) this.active.set(data.id, entry);
    const sound = await playSound(data.path, { volume, loop: data.loop, channel: "environment" });
    if (!data.loop) return;
    if (entry.stopped) return sound?.stop();

    // Loops follow tokens as they move and pick up volume changes.
    entry.sound = sound;
    entry.timer = setInterval(() => {
      if (sound) sound.volume = volumeFor(data);
    }, 500);
  },

  stop(id) {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    entry.stopped = true;
    clearInterval(entry.timer);
    entry.sound?.stop();
  }
};

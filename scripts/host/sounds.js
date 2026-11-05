import { MODULE_ID, SOCKET } from "../config.js";
import { agentType, getPhoneSettings, isPlayerCharacter } from "../model/agent.js";
import { noSignalSince } from "../model/features.js";
import { memberSound } from "../model/sounds.js";
import { canActFor } from "../model/permissions.js";
import { npcMember } from "../model/threads.js";

/*
 * Host: rings and text tones heard around tokens (each client plays them; see worldsound.js).
 * Methods run on the store (`this`); see host/index.js.
 */

export const methods = {
  /** Users who already hear this member's phone through their own UI. */
  _uiListeners(member) {
    return game.users.filter(u => canActFor(u, member)).map(u => u.id);
  },

  /** Play the text tone once at a recipient's token. */
  _ding(member) {
    if (!game.settings.get(MODULE_ID, "textToneAtToken")) return;
    this._worldSound(member, memberSound(member, "text"), { loop: false });
  },

  /** In-world tone for whoever receives a direct message. Never reveals a hidden caller's location. */
  _dingDirect(thread, from) {
    if (from === "contact") return this._ding({ actorId: thread.actorId });
    const other = thread.contactActorId ? game.actors.get(thread.contactActorId) : null;
    if (isPlayerCharacter(other)) return this._ding({ actorId: other.id });
    if (!thread.hideId) this._ding(npcMember(thread.contact));
  },

  /**
   * Ask every client to play a sound at a member's token on the active scene. Each client plays it
   * locally with distance falloff; users who already hear this phone in their own UI (`muteFor`) skip it.
   * `blip`, `radius` and `volume`: see _worldSoundAt (the radius defaults to the ring radius).
   * @returns {string|null} id for stopping a looping sound
   */
  _worldSound(member, path, { loop, blip, radius = game.settings.get(MODULE_ID, "ringRadius"), volume }) {
    const scene = game.scenes.active;
    if (!(path || blip) || !scene) return null;
    // Internal Agents ring inside the user's head; silenced phones and phones with no signal make no sound at all.
    if (member.actorId) {
      const actor = game.actors.get(member.actorId);
      if (agentType(actor) === "internal" || getPhoneSettings(actor).silent || noSignalSince(member.actorId)) return null;
    }
    const token = scene.tokens.find(t =>
      member.actorId ? t.actorId === member.actorId : t.name.toLowerCase() === member.name?.toLowerCase()
    );
    if (!token) return null;

    const size = scene.grid.size;
    const at = { sceneId: scene.id, x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 };
    return this._worldSoundAt(at, path, { loop, blip, radius, volume, muteFor: this._uiListeners(member) });
  },

  /**
   * Play a sound at a point on a scene: each client plays it with distance falloff within `radius`
   * (scene units). `muteFor`: users who hear it through their own phone instead. `blip`: a synth blip
   * (util/audio.js BLIPS) instead of a file at `path`, played once. `volume`: scales it (default 1).
   * @returns {string|null} id for stopping it (_stopWorldSound)
   */
  _worldSoundAt({ sceneId, x, y }, path, { loop, blip, radius, volume = 1, muteFor = [] }) {
    const scene = game.scenes.get(sceneId);
    if (!(path || blip) || !scene) return null;
    const sound = { id: foundry.utils.randomID(), sceneId, path, blip, loop: !blip && loop, volume, x, y, radius: (radius / (Number(scene.grid.distance) || 1)) * scene.grid.size, muteFor };
    game.socket.emit(SOCKET, { type: "world-sound", sound });
    Hooks.callAll(`${MODULE_ID}.worldSound`, sound);
    return sound.id;
  },

  _stopWorldSound(id) {
    game.socket.emit(SOCKET, { type: "world-sound-stop", id });
    Hooks.callAll(`${MODULE_ID}.worldSoundStop`, id);
  }
};

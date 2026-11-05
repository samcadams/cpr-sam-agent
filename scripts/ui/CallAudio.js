import { MODULE_ID } from "../config.js";
import { isSilenced } from "../model/agent.js";
import { phoneSound } from "../model/sounds.js";
import { commsOn, noSignalSince } from "../model/features.js";
import { store } from "../store.js";
import { playSound } from "../util/audio.js";

/** Plays the ringtone for incoming calls and, quieter, as a ringback while your call is ringing out. */
export const CallAudio = {
  mode: null,
  sound: null,

  async update() {
    const role = commsOn() ? store.myCall() : null;
    let mode = null;
    const owner = role?.me.actorId ? game.actors.get(role.me.actorId) : game.user;
    // Silent, or no signal: the call screen still shows.
    if (role && (isSilenced(owner) || (role.me.actorId && noSignalSince(role.me.actorId)))) mode = null;
    else if (role?.kind === "incoming") mode = "ring";
    else if (role?.kind === "active" && !role.call.startedAt && role.call.participants.some(p => p.state === "ringing")) {
      mode = "ringback";
    }
    if (mode === this.mode) return;

    this.mode = mode;
    this.sound?.stop();
    this.sound = null;
    if (!mode) return;

    const src = phoneSound(owner, "ring"); // this phone's ringtone, for its ringback too
    if (!src) return;
    const sound = await playSound(src, { volume: this.volume(), loop: true });
    if (this.mode === mode && !this.sound) this.sound = sound;
    else sound?.stop();
  },

  volume() {
    return game.settings.get(MODULE_ID, "volume") * (this.mode === "ringback" ? 0.5 : 1);
  },

  /** Follow the Phone volume setting while ringing. */
  applyVolume() {
    if (this.sound) this.sound.volume = this.volume();
  }
};

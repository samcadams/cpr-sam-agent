import { MODULE_ID } from "../config.js";
import { phoneSound } from "../model/sounds.js";

/**
 * Play a sound file. "interface" is scaled by Foundry's Interface volume, "environment" by Ambient.
 * @returns {Promise<Sound|undefined>}
 */
export function playSound(src, { volume = 1, loop = false, channel = "interface" } = {}) {
  const helper = foundry.audio?.AudioHelper ?? AudioHelper;
  return helper.play({ src, volume, loop, autoplay: true, channel }, false);
}

/** Try a sound from a picker, once, at this user's phone volume. */
export function previewSound(src) {
  const volume = game.settings.get(MODULE_ID, "volume");
  if (!src) return ui.notifications.info("No sound to play.");
  if (!volume) return ui.notifications.info("Your phone volume is at 0.");
  playSound(src, { volume });
}

/**
 * Play a phone's sound once ("text", "ring", "money", "alarm" or "fanfare"; see model/sounds.js) at this user's
 * phone volume (0 mutes it). `owner`: the character whose phone it is, or a GM's user (the GM Phone).
 */
export function playPhoneSound(kind, owner) {
  const src = phoneSound(owner, kind);
  const volume = game.settings.get(MODULE_ID, "volume");
  if (src && volume) playSound(src, { volume });
}

/* ---------------- Synth blips (no files): Flappy Chrome's, NCART Runner's and REDLINE's sounds ---------------- */

/**
 * Each blip: a waveform sweeping `from` → `to` Hz over `len` seconds, at `vol` before any volume scaling.
 * `type: "noise"`: white noise through a `filter` ("lowpass", "highpass", "bandpass") swept from → to.
 */
export const BLIPS = {
  flap: { type: "square", from: 520, to: 880, len: 0.08, vol: 0.05 },
  point: { type: "triangle", from: 988, to: 1319, len: 0.14, vol: 0.08 },
  hit: { type: "sawtooth", from: 220, to: 55, len: 0.35, vol: 0.1 },
  // NCART Runner (apps/ncart/page.js).
  shard: { type: "triangle", from: 1568, to: 2093, len: 0.07, vol: 0.05 },
  jump: { type: "square", from: 330, to: 660, len: 0.1, vol: 0.04 },
  lane: { type: "triangle", from: 440, to: 520, len: 0.04, vol: 0.03 },
  slide: { type: "sawtooth", from: 300, to: 150, len: 0.12, vol: 0.03 },
  bump: { type: "square", from: 160, to: 120, len: 0.08, vol: 0.05 },
  power: { type: "triangle", from: 523, to: 1568, len: 0.3, vol: 0.08 },
  speedup: { type: "square", from: 660, to: 990, len: 0.22, vol: 0.05 },
  shield: { type: "triangle", from: 880, to: 330, len: 0.25, vol: 0.08 },
  horn: { type: "sawtooth", from: 196, to: 185, len: 0.7, vol: 0.09 },
  pass: { type: "sawtooth", from: 233, to: 150, len: 1.1, vol: 0.1 }, // a horn going by, falling away
  step: { type: "noise", filter: "lowpass", from: 900, to: 250, len: 0.05, vol: 0.05 },
  land: { type: "noise", filter: "lowpass", from: 500, to: 120, len: 0.14, vol: 0.09 },
  gun: { type: "noise", filter: "bandpass", from: 2200, to: 500, len: 0.1, vol: 0.09 },
  // A train warning's lane, when the player asks for it: low left, middle, high right.
  warn0: { type: "sine", from: 392, to: 392, len: 0.18, vol: 0.09 },
  warn1: { type: "sine", from: 587, to: 587, len: 0.18, vol: 0.09 },
  warn2: { type: "sine", from: 880, to: 880, len: 0.18, vol: 0.09 },
  // REDLINE (apps/redline/page.js): "rl-" and the race's event.
  "rl-light": { type: "sine", from: 440, to: 440, len: 0.25, vol: 0.09 },
  "rl-go": { type: "sine", from: 880, to: 880, len: 0.5, vol: 0.1 },
  "rl-lap": { type: "triangle", from: 660, to: 1320, len: 0.25, vol: 0.07 },
  "rl-finish": { type: "triangle", from: 523, to: 2093, len: 0.6, vol: 0.09 },
  "rl-crash": { type: "noise", filter: "lowpass", from: 1800, to: 80, len: 0.5, vol: 0.14 },
  "rl-ram": { type: "noise", filter: "lowpass", from: 700, to: 120, len: 0.22, vol: 0.11 },
  "rl-bump": { type: "noise", filter: "lowpass", from: 400, to: 90, len: 0.12, vol: 0.09 },
  "rl-scrape": { type: "noise", filter: "highpass", from: 3000, to: 1200, len: 0.18, vol: 0.05 },
  "rl-punch": { type: "noise", filter: "bandpass", from: 900, to: 250, len: 0.1, vol: 0.12 },
  "rl-whiff": { type: "noise", filter: "highpass", from: 2500, to: 900, len: 0.08, vol: 0.04 },
  "rl-ramp": { type: "square", from: 220, to: 660, len: 0.2, vol: 0.04 },
  "rl-siren": { type: "sawtooth", from: 700, to: 1100, len: 0.6, vol: 0.05 },
  // NCPD's camera (apps/ncpd/page.js): the shutter opening, then closing a moment later.
  shutter: { type: "noise", filter: "bandpass", from: 4200, to: 1800, len: 0.045, vol: 0.1 },
  "shutter-close": { type: "noise", filter: "bandpass", from: 2600, to: 900, len: 0.06, vol: 0.08 }
};

let audio = null;
let noise = null;
let master = null;

/** The page's one AudioContext (made on first use). */
export function audioContext() {
  audio ??= new AudioContext();
  return audio;
}

/**
 * Where the synth sounds go: one filter before the speakers, open unless a game muffles it (setMuffle).
 */
export function masterOut() {
  const ctx = audioContext();
  if (!master) {
    master = ctx.createBiquadFilter();
    master.type = "lowpass";
    master.frequency.value = 18000;
    master.connect(ctx.destination);
  }
  return master;
}

/** Muffle every synth sound (NCART Runner's bullet time), or open them up again. */
export function setMuffle(on) {
  if (!audio && !on) return;
  try {
    masterOut().frequency.setTargetAtTime(on ? 650 : 18000, audio.currentTime, 0.08);
  } catch {
    // No audio.
  }
}

/** A second of white noise, made once. */
export function noiseBuffer() {
  const ctx = audioContext();
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** Play a blip (a BLIPS key) once at `volume` (0–1). Without audio it stays silent. */
export function playBlip(kind, volume) {
  const tone = BLIPS[kind];
  if (!tone || !(volume > 0)) return;
  try {
    audioContext();
    const t = audio.currentTime;
    const gain = audio.createGain();
    gain.connect(masterOut());
    if (tone.type === "noise") {
      const src = audio.createBufferSource();
      src.buffer = noiseBuffer();
      const filter = audio.createBiquadFilter();
      filter.type = tone.filter ?? "lowpass";
      filter.frequency.setValueAtTime(tone.from, t);
      filter.frequency.exponentialRampToValueAtTime(tone.to, t + tone.len);
      src.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(tone.vol * volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.len);
      src.start(t, Math.random() * 0.5);
      src.stop(t + tone.len + 0.02);
      return;
    }
    const osc = audio.createOscillator();
    osc.connect(gain);
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.from, t);
    osc.frequency.exponentialRampToValueAtTime(tone.to, t + tone.len);
    gain.gain.setValueAtTime(tone.vol * volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.len);
    osc.start(t);
    osc.stop(t + tone.len + 0.02);
  } catch {
    // No audio: play on silently.
  }
}

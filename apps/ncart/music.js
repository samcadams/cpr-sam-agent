import { audioContext, masterOut, noiseBuffer } from "../../scripts/util/audio.js";

/*
 * NCART Runner's background groove: a little funk loop synthesised live (no files), on the phone only.
 * Kick, snare and hats, a slap-ish sawtooth bassline in E minor and offbeat chord stabs, two bars that
 * alternate. It speeds up a touch with the run's speed steps; bullet time muffles it with every other sound
 * (util/audio.js setMuffle).
 * Scheduled a little ahead of the audio clock, so it keeps time whatever the frame rate.
 */

const STEPS = 16; // sixteenths in a bar
const LOOKAHEAD = 0.12; // seconds scheduled ahead
const BASS = [
  [40, 0, 40, 52, 0, 40, 0, 43, 45, 0, 43, 0, 40, 0, 47, 45],
  [40, 0, 40, 52, 0, 40, 0, 43, 45, 0, 47, 0, 50, 48, 47, 43]
];
const CHORDS = [[64, 67, 71, 74], [69, 72, 76, 79]]; // Em9-ish, Am9-ish
const STABS = [3, 6, 11, 14];
const KICKS = [0, 7, 8, 10];
const SNARES = [4, 12];

const hz = note => 440 * 2 ** ((note - 69) / 12);

export class Groove {
  constructor() {
    this.playing = false;
    this.bpm = 112;
  }

  /** Start (or keep) playing at `volume` (0–1, the phone's). */
  start(volume) {
    if (this.playing || !(volume > 0)) return;
    try {
      const ctx = audioContext();
      ctx.resume?.();
      this.out = ctx.createGain();
      this.out.gain.value = volume * 0.22;
      this.out.connect(masterOut());
      this.step = 0;
      this.next = ctx.currentTime + 0.05;
      this.playing = true;
      this.timer = setInterval(() => this._schedule(), 25);
    } catch {
      // No audio: run in silence.
    }
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const ctx = audioContext();
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    const out = this.out;
    setTimeout(() => out.disconnect(), 400);
  }

  /** The run's speed step: a little faster each. */
  set(level) {
    this.bpm = Math.min(126, 112 + level);
  }

  _schedule() {
    const ctx = audioContext();
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this._play(this.step, this.next);
      this.next += 60 / this.bpm / 4;
      this.step = (this.step + 1) % (STEPS * 2);
    }
  }

  _play(step, t) {
    const bar = Math.floor(step / STEPS);
    const s = step % STEPS;
    if (KICKS.includes(s)) this._kick(t);
    if (SNARES.includes(s)) this._snare(t);
    if (s % 2 === 0) this._hat(t, s === 14 ? 0.12 : 0.03);
    const note = BASS[bar][s];
    if (note) this._bass(hz(note), t);
    if (STABS.includes(s)) for (const n of CHORDS[bar]) this._stab(hz(n), t);
  }

  _env(t, peak, len) {
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(this.out);
    return g;
  }

  _kick(t) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    osc.connect(this._env(t, 0.9, 0.18));
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _noise(t, type, freq, peak, len) {
    const ctx = audioContext();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    src.connect(filter);
    filter.connect(this._env(t, peak, len));
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.02);
  }

  _snare(t) {
    this._noise(t, "highpass", 1200, 0.35, 0.13);
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 190;
    osc.connect(this._env(t, 0.25, 0.08));
    osc.start(t);
    osc.stop(t + 0.1);
  }

  _hat(t, len) {
    this._noise(t, "highpass", 7000, 0.12, len);
  }

  _bass(freq, t) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    osc.connect(filter);
    filter.connect(this._env(t, 0.32, 0.14));
    osc.start(t);
    osc.stop(t + 0.16);
  }

  _stab(freq, t) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    osc.connect(filter);
    filter.connect(this._env(t, 0.035, 0.09));
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

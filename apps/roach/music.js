import { audioContext, masterOut, noiseBuffer } from "../../scripts/util/audio.js";

/*
 * Roach Race's background tune: a bouncy little jig in G, synthesised live (no files), on the phone only.
 * 6/8, eight bars that loop: woodblock clip-clop hooves on the beats, an oom-pah plucked bass, offbeat
 * lute plucks, a pizzicato lead, and a slide whistle at the end of each phrase. It speeds up a touch each
 * loop of the course. Same shape as NCART's Groove (apps/ncart/music.js): start / stop / set.
 * Scheduled a little ahead of the audio clock, so it keeps time whatever the frame rate.
 */

const STEPS = 6; // eighths in a bar
const LOOKAHEAD = 0.12; // seconds scheduled ahead
// The lead, an eighth a step (0 = rest: the note before rings on).
const TUNE = [
  [74, 0, 71, 67, 71, 74],
  [76, 0, 72, 79, 76, 72],
  [74, 71, 74, 79, 0, 74],
  [78, 76, 74, 69, 0, 0],
  [74, 0, 71, 67, 71, 74],
  [76, 0, 79, 81, 79, 76],
  [78, 0, 74, 76, 78, 81],
  [79, 0, 0, 67, 0, 0]
];
// Each bar's chord: G C G D G C D G.
const CHORDS = [
  [43, [59, 62, 67]], [48, [60, 64, 67]], [43, [59, 62, 67]], [50, [57, 62, 66]],
  [43, [59, 62, 67]], [48, [60, 64, 67]], [50, [57, 62, 66]], [43, [59, 62, 67]]
];

const hz = note => 440 * 2 ** ((note - 69) / 12);

export class Gallop {
  constructor() {
    this.playing = false;
    this.bpm = 132; // dotted quarters (gallops) a minute
  }

  /** Start (or keep) playing at `volume` (0–1, the phone's). */
  start(volume) {
    if (this.playing || !(volume > 0)) return;
    try {
      const ctx = audioContext();
      ctx.resume?.();
      this.out = ctx.createGain();
      this.out.gain.value = volume * 0.36;
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

  /** The course's loop (0, 1, 2…): a little faster each. */
  set(level) {
    this.bpm = Math.min(156, 132 + 4 * level);
  }

  _schedule() {
    const ctx = audioContext();
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this._play(this.step, this.next);
      this.next += this._eighth();
      this.step = (this.step + 1) % (STEPS * TUNE.length);
    }
  }

  _eighth() {
    return 60 / this.bpm / 3;
  }

  _play(step, t) {
    const bar = Math.floor(step / STEPS);
    const s = step % STEPS;
    const [root, chord] = CHORDS[bar];
    // Hooves: clop-clip, clop-clip; the plucks fill the gaps.
    if (s === 0 || s === 3) this._hoof(t, 620, s === 0 ? 0.5 : 0.38);
    if (s === 1 || s === 4) this._hoof(t, 940, 0.26);
    if (s === 0) this._bass(hz(root), t);
    if (s === 3) this._bass(hz(root + 7), t);
    if (s === 2 || s === 5) chord.forEach((n, i) => this._pluck(hz(n), t + i * 0.012, 0.05, 0.16));
    const note = TUNE[bar][s];
    if (note) {
      let len = 1;
      while (len < 3 && !TUNE[bar][s + len] && s + len < STEPS) len++;
      this._lead(hz(note), t, len * this._eighth());
    }
    if (step === STEPS * TUNE.length - 2) this._whistle(t, 2 * this._eighth());
  }

  _env(t, peak, len) {
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(this.out);
    return g;
  }

  /** A coconut-shell clip-clop: a knock that drops in pitch, and a tick of noise. */
  _hoof(t, freq, peak) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.04);
    osc.connect(this._env(t, peak, 0.06));
    osc.start(t);
    osc.stop(t + 0.07);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq * 3;
    src.connect(filter);
    filter.connect(this._env(t, peak * 0.3, 0.02));
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.03);
  }

  _bass(freq, t) {
    this._pluck(freq, t, 0.34, 0.22, "triangle");
  }

  /** A lute-ish pluck: a filtered saw (or `type`) that closes quickly. */
  _pluck(freq, t, peak, len, type = "sawtooth") {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + len * 0.6);
    osc.connect(filter);
    filter.connect(this._env(t, peak, len));
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  /** The lead: a bright pizzicato square with a little hop up into the note. */
  _lead(freq, t, len) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq * 0.97, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    osc.connect(filter);
    const ring = Math.max(0.1, len * 0.9);
    filter.connect(this._env(t, 0.07, ring));
    osc.start(t);
    osc.stop(t + ring + 0.02);
  }

  /** A slide whistle up to round off the phrase: whee! */
  _whistle(t, len) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(hz(67), t);
    osc.frequency.exponentialRampToValueAtTime(hz(91), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
    g.gain.setValueAtTime(0.09, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
    g.connect(this.out);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + len + 0.08);
  }
}

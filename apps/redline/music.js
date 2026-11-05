import { audioContext, masterOut, noiseBuffer } from "../../scripts/util/audio.js";

/*
 * REDLINE's own tune, "Night Drive": a synthwave loop in A minor, synthesised live (no files), on the phone
 * only. Sixteen bars of sixteenths: four on the floor, a big gated snare on 2 and 4, offbeat hats, a driving
 * octave bass, gated pad chords (Am F C G, then Dm F C E for the turn), a plucked arpeggio, and a lead that
 * comes in for the second eight bars. The race's lap (or a sprint's half) brings the lead in early.
 * Same shape as NCART's Groove (apps/ncart/music.js): start / stop / set. Scheduled a little ahead of the
 * audio clock, so it keeps time whatever the frame rate.
 */

const STEPS = 16; // sixteenths in a bar
const LOOKAHEAD = 0.12;
// Each bar's chord: a bass root and the pad's notes (MIDI).
const CHORDS = [
  [45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]],
  [45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]],
  [38, [57, 62, 65]], [41, [57, 60, 65]], [48, [55, 60, 64]], [40, [56, 59, 64]],
  [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]], [40, [56, 59, 64]]
];
// The lead, two bars a line (0 = rest; a note rings until the next).
const LEAD = [
  [76, 0, 0, 0, 74, 0, 72, 0, 74, 0, 0, 0, 0, 0, 69, 0, 72, 0, 0, 0, 0, 0, 0, 0, 71, 0, 72, 0, 74, 0, 0, 0],
  [76, 0, 0, 0, 79, 0, 0, 0, 77, 0, 76, 0, 74, 0, 72, 0, 74, 0, 0, 0, 0, 0, 72, 0, 71, 0, 0, 0, 68, 0, 0, 0],
  [74, 0, 0, 0, 77, 0, 0, 0, 81, 0, 0, 0, 79, 0, 77, 0, 76, 0, 0, 0, 72, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0],
  [76, 0, 0, 0, 74, 0, 72, 0, 74, 0, 0, 0, 71, 0, 0, 0, 69, 0, 0, 0, 0, 0, 0, 0, 68, 0, 71, 0, 76, 0, 0, 0]
];

const hz = note => 440 * 2 ** ((note - 69) / 12);

export class NightDrive {
  constructor() {
    this.playing = false;
    this.bpm = 118;
    this.lead = false;
  }

  /** Start (or keep) playing at `volume` (0–1, the phone's). */
  start(volume) {
    if (this.playing || !(volume > 0)) return;
    try {
      const ctx = audioContext();
      ctx.resume?.();
      this.out = ctx.createGain();
      this.out.gain.value = volume * 0.3;
      this.out.connect(masterOut());
      // A short echo on the lead and snare: the 80s in it.
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = (60 / this.bpm) * 0.75;
      const back = ctx.createGain();
      back.gain.value = 0.3;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2400;
      this.echo.connect(tone);
      tone.connect(back);
      back.connect(this.echo);
      tone.connect(this.out);
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
    const echo = this.echo;
    setTimeout(() => {
      out.disconnect();
      echo.disconnect();
    }, 600);
  }

  /** The race's way through (0–1): the lead joins in from halfway. */
  set(done) {
    this.lead = done >= 0.5;
  }

  _schedule() {
    const ctx = audioContext();
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this._play(this.step, this.next);
      this.next += 60 / this.bpm / 4;
      this.step = (this.step + 1) % (STEPS * CHORDS.length);
    }
  }

  _play(step, t) {
    const bar = Math.floor(step / STEPS);
    const s = step % STEPS;
    const [root, pad] = CHORDS[bar];
    const six = 60 / this.bpm / 4;
    if (s % 4 === 0) this._kick(t);
    if (s === 4 || s === 12) this._snare(t);
    if (s % 4 === 2) this._hat(t, 0.05);
    else if (s % 2) this._hat(t, 0.018);
    // Octave bass on every sixteenth, accented on the beat.
    this._bass(hz(root + (s % 2 ? 12 : 0)), t, s % 4 === 0 ? 0.2 : 0.13, six * 0.9);
    // The pad, gated in eighths.
    if (s % 2 === 0) pad.forEach(n => this._pad(hz(n), t, six * 1.6));
    // An arpeggio up the chord, an octave over.
    const arp = [...pad, pad[0] + 12][s % 4] + 12;
    if (s % 2 === 0 || bar >= 8) this._pluck(hz(arp), t, 0.035);
    // The lead: the second half of the loop, or all of it once the race is halfway.
    if (bar >= 8 || this.lead) {
      const line = LEAD[Math.floor(bar / 2) % LEAD.length];
      const i = (bar % 2) * STEPS + s;
      const note = line[i];
      if (note) {
        let len = 1;
        while (i + len < line.length && !line[i + len] && len < 8) len++;
        this._lead(hz(note), t, len * six);
      }
    }
    // A cymbal swell into each eight-bar half.
    if ((bar === 7 || bar === 15) && s === 8) this._swell(t, six * 8);
  }

  _env(t, peak, len, to = this.out) {
    const ctx = audioContext();
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(to);
    return g;
  }

  _kick(t) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    osc.connect(this._env(t, 0.75, 0.28));
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** The big 80s snare: a crack of noise and tone, its tail cut short (gated). */
  _snare(t) {
    const ctx = audioContext();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    src.connect(filter);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.setTargetAtTime(0.25, t + 0.01, 0.06);
    g.gain.setValueAtTime(0.22, t + 0.17);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.2);
    filter.connect(g);
    g.connect(this.out);
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    g.connect(wet);
    wet.connect(this.echo);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.22);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    osc.connect(this._env(t, 0.3, 0.1));
    osc.start(t);
    osc.stop(t + 0.12);
  }

  _hat(t, peak) {
    const ctx = audioContext();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    src.connect(filter);
    filter.connect(this._env(t, peak, 0.04));
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
  }

  _bass(freq, t, peak, len) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + len);
    osc.connect(filter);
    filter.connect(this._env(t, peak, len));
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  _pad(freq, t, len) {
    const ctx = audioContext();
    for (const cents of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = cents;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1300;
      osc.connect(filter);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.022, t + 0.01);
      g.gain.setValueAtTime(0.022, t + len * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      filter.connect(g);
      g.connect(this.out);
      osc.start(t);
      osc.stop(t + len + 0.02);
    }
  }

  _pluck(freq, t, peak) {
    const ctx = audioContext();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3800, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    osc.connect(filter);
    filter.connect(this._env(t, peak, 0.14));
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** The lead: two detuned saws with a slow vibrato, into the echo. */
  _lead(freq, t, len) {
    const ctx = audioContext();
    const ring = Math.max(0.12, len * 0.95);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.setTargetAtTime(0.035, t + 0.05, 0.2);
    g.gain.setValueAtTime(0.035, t + ring * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    g.connect(this.out);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    g.connect(wet);
    wet.connect(this.echo);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2800;
    filter.connect(g);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(12, t + Math.min(0.4, ring));
    vib.connect(depth);
    vib.start(t);
    vib.stop(t + ring + 0.02);
    for (const cents of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = cents;
      depth.connect(osc.detune);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + ring + 0.02);
    }
  }

  /** A reversed-cymbal swell: noise rising into the downbeat. */
  _swell(t, len) {
    const ctx = audioContext();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(8000, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.out);
    src.start(t);
    src.stop(t + len + 0.05);
  }
}

import { audioContext, masterOut, noiseBuffer } from "../../scripts/util/audio.js";
import { CLASSES, curveAt, PHYSICS, ROAD, TRAFFIC, trackPos } from "./model.js";

/*
 * REDLINE's sound, synthesised live on the phone (no files).
 *
 * RaceAudio runs the race's sound: the player's engine, the rides near you, NCPD sirens, the tyres, the wall,
 * the wind, the rain. Each engine (a Voice) is a few oscillators at its firing note plus a band of noise for
 * the rasp, through a drive (soft clipping) and a low-pass that opens on the throttle, with a slow pulse in
 * the volume for the lope of a V-twin or a big V8. Every ride class (and kind of traffic) has its own: the
 * Roadbike's loping twin, the Superbike's screaming four, the Compact's buzzy turbo four, the Sport's V8
 * rumble and crackle; vans and semis are diesels. Revs climb through the gears (a dip and a crackle on each
 * shift); held at one pitch (flat out on a straight) the engine settles back so it doesn't drone. The rides
 * near you are panned to their side and pitched by how fast they close (Doppler, a little exaggerated).
 * Sirens wail, then yelp once a cruiser is right on you.
 *
 * The race's knocks (sfx): layered noise and tones, most through a bit-crusher for a 90s arcade crunch; the
 * lights and the jingles are clean. The music is apps/redline/music.js; the few sounds also heard around the
 * token are blips (util/audio.js, "rl-…").
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * Engines. `idle`/`top`: the firing note (Hz) at idle and the redline. `gears`: the speeds (of top) each gear
 * tops out at. `parts`: [ratio, wave, level] oscillators. `lope`: how deep the volume pulses, at `lopeAt` × the
 * note. `rasp`: noise level, band (× the note) and Q. `drive`: soft clipping. `open`/`shut`: the low-pass on
 * and off the throttle (Hz). `crackle`: pops on a shift and lifting off. `turbo`: a whistle's level. `vol`.
 */
const ENGINES = {
  roadbike: {
    idle: 24, top: 96, gears: [0.16, 0.32, 0.5, 0.72, 1], parts: [[1, "sawtooth", 0.5], [0.5, "triangle", 0.55], [2, "square", 0.12]],
    lope: 0.42, lopeAt: 0.5, rasp: [0.12, 7, 2.5], drive: 2.2, open: 1500, shut: 460, crackle: 0.5, vol: 1.15
  },
  superbike: {
    idle: 46, top: 250, gears: [0.12, 0.24, 0.38, 0.54, 0.75, 1], parts: [[1, "sawtooth", 0.5], [2, "sawtooth", 0.22], [4, "square", 0.05]],
    lope: 0.1, lopeAt: 1, rasp: [0.2, 5, 2], drive: 1.7, open: 3600, shut: 900, crackle: 0.35, vol: 1.3
  },
  compact: {
    idle: 34, top: 150, gears: [0.15, 0.32, 0.52, 0.75, 1], parts: [[1, "square", 0.36], [2, "sawtooth", 0.2], [3, "square", 0.07]],
    lope: 0.14, lopeAt: 0.5, rasp: [0.32, 8, 3], drive: 1.4, open: 1700, shut: 560, turbo: 0.045, vol: 1.45
  },
  sport: {
    idle: 27, top: 116, gears: [0.14, 0.3, 0.48, 0.7, 1], parts: [[1, "sawtooth", 0.45], [0.5, "sine", 0.7], [1.5, "triangle", 0.1]],
    lope: 0.26, lopeAt: 0.25, rasp: [0.1, 5, 2.5], drive: 2.4, open: 1250, shut: 400, crackle: 1, vol: 1
  },
  // Traffic.
  car: {
    idle: 30, top: 95, gears: [0.3, 0.6, 1], parts: [[1, "square", 0.35], [2, "triangle", 0.25]],
    lope: 0.1, lopeAt: 0.5, rasp: [0.2, 6, 2], drive: 1.2, open: 900, shut: 500, vol: 0.6
  },
  diesel: {
    idle: 16, top: 52, gears: [0.25, 0.5, 0.75, 1], parts: [[1, "square", 0.5], [0.5, "sawtooth", 0.5], [3, "square", 0.08]],
    lope: 0.3, lopeAt: 0.5, rasp: [0.45, 10, 1.2], drive: 2, open: 700, shut: 400, vol: 1.1
  }
};
/** Which engine each kind of traffic has. */
const TRAFFIC_ENGINE = { car: "car", taxi: "car", cop: "sport", van: "diesel", semi: "diesel", truck: "diesel", gang: "roadbike" };
/** Seconds at steady revs before an engine settles back, and how far (of its volume). */
const SETTLE = { after: 1.2, to: 0.45 };
/** How far away (m) a ride near you is heard, and how many at once. */
const NEAR = { range: 70, most: 3 };
/** Doppler, exaggerated: the speed of sound as heard here (m/s). */
const SOUND = 160;

/** A soft-clipping curve, `k` hard. */
function driveCurve(k) {
  const curve = new Float32Array(512);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/** A looping noise source through a filter into a gain (0 to start). */
function noiseLoop(ctx, type, freq, q, dest) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(0, Math.random() * 0.5);
  return { src, filter, gain };
}

/**
 * The gear and revs (0–1 of the way from idle to the redline) a ride class is in at `v` (m/s): the race's
 * tachometer (apps/redline/hud.js) reads the same gearbox the engine plays.
 */
export function gearOf(cls, v) {
  const e = ENGINES[cls] ?? ENGINES.sport;
  const k = clamp(v / Math.max(1, CLASSES[cls]?.top ?? 60), 0, 1);
  let gear = e.gears.findIndex(hi => k <= hi);
  if (gear < 0) gear = e.gears.length - 1;
  const lo = gear ? e.gears[gear - 1] : 0;
  const rev = (k - lo) / Math.max(0.01, e.gears[gear] - lo);
  return { gear: v < 0.5 ? 0 : gear + 1, gears: e.gears.length, rpm: v < 0.5 ? 0.08 : gear ? 0.42 + 0.58 * rev : 0.12 + 0.88 * rev };
}

/* ---------------- One engine ---------------- */

class Voice {
  constructor(ctx, id, dest) {
    const e = (this.e = ENGINES[id] ?? ENGINES.car);
    this.id = id;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner?.() ?? null;
    if (this.pan) {
      this.out.connect(this.pan);
      this.pan.connect(dest);
    } else this.out.connect(dest);
    // The lope: a pulse in the volume.
    this.am = ctx.createGain();
    this.am.gain.value = 1 - e.lope / 2;
    this.am.connect(this.out);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = e.idle * e.lopeAt;
    const depth = ctx.createGain();
    depth.gain.value = e.lope / 2;
    this.lfo.connect(depth);
    depth.connect(this.am.gain);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = e.shut;
    this.filter.Q.value = 1.2;
    this.filter.connect(this.am);
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(e.drive);
    shaper.connect(this.filter);
    const pre = ctx.createGain();
    pre.gain.value = 0.6;
    pre.connect(shaper);
    this.osc = e.parts.map(([ratio, type, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = e.idle * ratio;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(pre);
      osc.start();
      return { osc, ratio };
    });
    this.rasp = noiseLoop(ctx, "bandpass", e.idle * e.rasp[1], e.rasp[2], pre);
    this.rasp.gain.gain.value = e.rasp[0];
    if (e.turbo) {
      this.turbo = ctx.createOscillator();
      this.turbo.type = "sine";
      this.turbo.frequency.value = 1800;
      this.turboGain = ctx.createGain();
      this.turboGain.gain.value = 0;
      this.turbo.connect(this.turboGain);
      this.turboGain.connect(this.out);
      this.turbo.start();
    }
    this.lfo.start();
    this.hz = e.idle;
    this.gear = 0;
    this.steady = 0;
  }

  /** The revs for a speed: { hz, gear, k (of top speed) }. */
  revs(v, top) {
    const e = this.e;
    const k = clamp(v / Math.max(1, top), 0, 1);
    let gear = e.gears.findIndex(hi => k <= hi);
    if (gear < 0) gear = e.gears.length - 1;
    const lo = gear ? e.gears[gear - 1] : 0;
    const rev = (k - lo) / Math.max(0.01, e.gears[gear] - lo);
    const rpm = gear ? 0.42 + 0.58 * rev : 0.12 + 0.88 * rev;
    return { hz: v < 0.5 ? e.idle : e.idle + (e.top - e.idle) * rpm, gear, k };
  }

  /**
   * One frame: `hz` the note, `load` 0–1 (the throttle), `level` its loudness, `pan` −1..1, `bend` a pitch
   * factor (Doppler), `t` the audio clock, `dt` seconds since the last.
   */
  set({ hz, load, level, pan = 0, bend = 1, t, dt, settle = true }) {
    const e = this.e;
    this.steady = settle && Math.abs(hz - this.hz) < 0.6 ? this.steady + dt : 0;
    this.hz = hz;
    const calm = this.steady > SETTLE.after ? SETTLE.to : 1;
    const f = hz * bend;
    for (const { osc, ratio } of this.osc) osc.frequency.setTargetAtTime(f * ratio, t, 0.03);
    this.lfo.frequency.setTargetAtTime(f * e.lopeAt, t, 0.03);
    this.rasp.filter.frequency.setTargetAtTime(Math.min(9000, f * e.rasp[1]), t, 0.05);
    this.filter.frequency.setTargetAtTime(lerp(e.shut, e.open * (calm < 1 ? 0.8 : 1), load) * (0.7 + 0.3 * bend), t, 0.08);
    this.out.gain.setTargetAtTime(level * e.vol * (0.5 + 0.5 * load) * calm, t, calm < 1 ? 0.6 : 0.06);
    if (this.pan) this.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
    if (this.turbo) {
      this.turbo.frequency.setTargetAtTime(1400 + f * 22, t, 0.2);
      this.turboGain.gain.setTargetAtTime(e.turbo * level * load * clamp((hz - e.idle) / (e.top - e.idle), 0, 1), t, 0.25);
    }
  }

  /** A shift: the revs drop and the volume dips for a moment. */
  dip(t) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(this.out.gain.value * 0.35, t, 0.015);
  }

  stop(t) {
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const o of [...this.osc.map(x => x.osc), this.lfo, this.rasp.src, this.turbo].filter(Boolean)) o.stop(t + 0.4);
    setTimeout(() => this.pan?.disconnect(), 800);
  }
}

/* ---------------- A siren ---------------- */

class Siren {
  constructor(ctx, dest) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner?.() ?? null;
    if (this.pan) {
      this.out.connect(this.pan);
      this.pan.connect(dest);
    } else this.out.connect(dest);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    filter.connect(this.out);
    this.osc = [0, 9].map(cents => {
      const osc = ctx.createOscillator();
      osc.type = cents ? "square" : "sawtooth";
      osc.detune.value = cents;
      osc.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = cents ? 0.35 : 0.6;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      return osc;
    });
    this.phase = Math.random();
  }

  /** `yelp`: the quick one (close pursuit); otherwise the slow wail. */
  set({ level, pan, bend, yelp, t, dt }) {
    const period = yelp ? 0.34 : 3.4;
    this.phase = (this.phase + dt / period) % 1;
    const sweep = yelp ? (this.phase < 0.5 ? this.phase * 2 : 2 - this.phase * 2) : 0.5 - 0.5 * Math.cos(this.phase * Math.PI * 2);
    const f = (680 + 820 * sweep) * bend;
    for (const osc of this.osc) osc.frequency.setTargetAtTime(f, t, 0.012);
    this.out.gain.setTargetAtTime(level, t, 0.08);
    if (this.pan) this.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  stop(t) {
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const osc of this.osc) osc.stop(t + 0.4);
    setTimeout(() => this.pan?.disconnect(), 800);
  }
}

/* ---------------- The race's sound ---------------- */

export class RaceAudio {
  constructor() {
    this.on = false;
  }

  /** Start (or keep) running at `volume` (0–1, the phone's), for the player's ride class. */
  start(volume, cls) {
    if (this.on || !(volume > 0)) return;
    try {
      const ctx = (this.ctx = audioContext());
      ctx.resume?.();
      this.bus = ctx.createGain();
      this.bus.gain.value = volume;
      this.bus.connect(masterOut());
      this.volume = volume;
      this.level = 0.12;
      this.me = new Voice(ctx, ENGINES[cls] ? cls : "sport", this.bus);
      this.near = new Map(); // key → { voice, last (dist), seen }
      this.sirens = [];
      // Tyres: a hiss and a squeal. The wall: a grind. Off the road: a rumble. The wind; the rain.
      this.skid = noiseLoop(ctx, "bandpass", 1300, 2.5, this.bus);
      this.squeal = ctx.createOscillator();
      this.squeal.type = "triangle";
      this.squeal.frequency.value = 820;
      this.squealGain = ctx.createGain();
      this.squealGain.gain.value = 0;
      this.squeal.connect(this.squealGain);
      this.squealGain.connect(this.bus);
      this.squeal.start();
      this.grind = noiseLoop(ctx, "bandpass", 2600, 1.5, this.bus);
      this.rumble = noiseLoop(ctx, "lowpass", 160, 1, this.bus);
      this.wind = noiseLoop(ctx, "lowpass", 400, 0.7, this.bus);
      this.rain = noiseLoop(ctx, "highpass", 3500, 0.5, this.bus);
      this.gust = noiseLoop(ctx, "bandpass", 500, 0.8, this.bus);
      this.throttle = false;
      this.at = performance.now();
      this.on = true;
    } catch {
      // No audio.
    }
  }

  /**
   * One frame of the race `g`: `throttle` (open), `brake`, `rain` (the district's), `sand` (in a sandstorm).
   * Returns true when the exhaust popped (a shift or a lift: the drawing flashes the pipes).
   */
  update(g, { throttle, brake, rain = false, sand = false }) {
    if (!this.on) return false;
    let pop = false;
    try {
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.at) / 1000);
      this.at = now;
      const t = this.ctx.currentTime;
      this.bus.gain.setTargetAtTime(this.volume, t, 0.05);
      const p = g.p;
      const c = CLASSES[g.cls];
      // The player's engine, through the gears.
      const r = this.me.revs(p.v, c.top);
      const limiter = throttle && r.k > 0.985 && ENGINES[g.cls]?.crackle && Math.floor(now / 70) % 2;
      if (r.gear > this.me.gear && p.v > 3) {
        this.me.dip(t);
        if (this.me.e.crackle) {
          sfx("crackle", this.me.e.crackle * this.volume);
          pop = true;
        }
      }
      if (this.throttle && !throttle && r.k > 0.45) {
        if (this.me.e.turbo) sfx("blowoff", this.volume);
        else if (this.me.e.crackle) {
          sfx("crackle", this.me.e.crackle * 0.8 * this.volume);
          pop = true;
        }
      }
      this.me.gear = r.gear;
      this.throttle = throttle;
      this.me.set({ hz: r.hz * (limiter ? 0.97 : 1), load: throttle ? 1 : 0, level: this.level, t, dt });
      // The tyres: past the grip in a bend (as the model's bend push), or braking hard.
      const k = curveAt(g.track, trackPos(g.track, p.total));
      const bend = k / Math.max(0.6, 1 - p.x * k);
      const push = (p.v * p.v * Math.abs(bend) * PHYSICS.centri) / c.grip / (PHYSICS.steer * c.grip);
      let slip = clamp((push - 0.85) / 0.5, 0, 1);
      if (brake && p.v > 16) slip = Math.max(slip, 0.6 * clamp((p.v - 16) / 24, 0, 1));
      if (p.air > 0 || p.wreck > 0) slip = 0;
      const tyre = c.bike ? 0.5 : 1;
      this.skid.gain.gain.setTargetAtTime(slip * 0.05 * tyre, t, 0.06);
      this.squeal.frequency.setTargetAtTime(760 + Math.random() * 90 + slip * 120, t, 0.03);
      this.squealGain.gain.setTargetAtTime(slip * slip * 0.025 * tyre, t, 0.06);
      // The wall, the shoulder, the wind.
      this.grind.gain.gain.setTargetAtTime(p.onWall && p.v > 4 ? 0.06 * clamp(p.v / 30, 0.3, 1) : 0, t, 0.04);
      const off = Math.abs(p.x) > ROAD && p.air <= 0 ? clamp(p.v / 25, 0, 1) : 0;
      this.rumble.gain.gain.setTargetAtTime(off * 0.18, t, 0.05);
      const kv = clamp(p.v / 70, 0, 1);
      this.wind.filter.frequency.setTargetAtTime(250 + 1600 * kv, t, 0.2);
      this.wind.gain.gain.setTargetAtTime(0.004 + 0.05 * kv * kv, t, 0.2);
      this.rain.gain.gain.setTargetAtTime(rain ? 0.018 : 0, t, 0.5);
      this.gust.gain.gain.setTargetAtTime(sand ? 0.05 + 0.04 * Math.sin(now / 700) : 0, t, 0.3);
      this._near(g, t, dt);
      this._sirens(g, t, dt);
    } catch {
      // No audio.
    }
    return pop;
  }

  /** The rides near you: the nearest few, each with its own engine. */
  _near(g, t, dt) {
    const p = g.p;
    const all = [];
    for (const r of g.racers) if (!r.out) all.push({ key: r.id, engine: r.cls, v: r.v, top: r.c.top, total: r.total, x: r.x, load: 1 });
    for (const e of g.traffic) {
      if (e.out) continue;
      const kind = TRAFFIC_ENGINE[e.kind] ?? "car";
      all.push({ key: e.id, engine: kind, v: e.v, top: e.kind === "cop" ? 64 : (TRAFFIC[e.kind]?.v[1] ?? 30) * 1.3, total: e.total, x: e.x, load: 0.6 });
    }
    for (const a of all) a.dist = Math.hypot(a.total - p.total, (a.x - p.x) * 1.5);
    const near = all.filter(a => a.dist < NEAR.range).sort((a, b) => a.dist - b.dist).slice(0, NEAR.most);
    const keep = new Set(near.map(a => a.key));
    for (const [key, n] of this.near) {
      if (!keep.has(key)) {
        n.voice.stop(t);
        this.near.delete(key);
      }
    }
    for (const a of near) {
      let n = this.near.get(a.key);
      if (!n) this.near.set(a.key, (n = { voice: new Voice(this.ctx, a.engine, this.bus), last: a.dist }));
      // Closing (m/s): positive coming together.
      const closing = dt > 0 ? (n.last - a.dist) / dt : 0;
      n.last = a.dist;
      const bend = clamp(SOUND / (SOUND - clamp(closing, -60, 60)), 0.7, 1.4);
      const r = n.voice.revs(a.v, a.top);
      const level = (this.level * 0.7) / (1 + (a.dist / 9) ** 2);
      n.voice.set({ hz: r.hz, load: a.load, level, pan: (a.x - p.x) / 9, bend, t, dt, settle: false });
    }
  }

  /** NCPD cruisers: a siren each (the nearest two), wailing, yelping once one's on you. */
  _sirens(g, t, dt) {
    const p = g.p;
    const cops = g.traffic.filter(e => e.kind === "cop" && !e.out).map(e => ({ e, dist: Math.hypot(e.total - p.total, e.x - p.x) })).filter(c => c.dist < 260).sort((a, b) => a.dist - b.dist).slice(0, 2);
    while (this.sirens.length < cops.length) this.sirens.push({ s: new Siren(this.ctx, this.bus), last: null });
    this.sirens.forEach((sr, i) => {
      const cop = cops[i];
      if (!cop) return sr.s.set({ level: 0, pan: 0, bend: 1, yelp: false, t, dt });
      const closing = sr.last !== null && dt > 0 ? (sr.last - cop.dist) / dt : 0;
      sr.last = cop.dist;
      const bend = clamp(SOUND / (SOUND - clamp(closing, -50, 50)), 0.8, 1.25);
      sr.s.set({ level: 0.08 / (1 + (cop.dist / 30) ** 2) + 0.006, pan: (cop.e.x - p.x) / 10, bend, yelp: cop.dist < 28, t, dt });
    });
  }

  /** Silent until the next update() (a pause). */
  hush() {
    if (!this.on) return;
    try {
      this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.me.steady = 0;
    } catch {
      // No audio.
    }
  }

  /** The phone's volume changed. */
  setVolume(volume) {
    this.volume = volume;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    try {
      const t = this.ctx.currentTime;
      this.bus.gain.setTargetAtTime(0, t, 0.05);
      this.me.stop(t);
      for (const n of this.near.values()) n.voice.stop(t);
      for (const sr of this.sirens) sr.s.stop(t);
      for (const loop of [this.skid, this.grind, this.rumble, this.wind, this.rain, this.gust]) loop.src.stop(t + 0.4);
      this.squeal.stop(t + 0.4);
      const bus = this.bus;
      setTimeout(() => bus.disconnect(), 800);
    } catch {
      // No audio.
    }
  }
}

/**
 * The garage's engine: one ride's engine, revved once when it's picked (the menu, apps/redline/menu.js).
 * Returns nothing; it stops by itself.
 */
export function revOnce(cls, volume) {
  if (!(volume > 0) || !ENGINES[cls]) return;
  try {
    const ctx = audioContext();
    ctx.resume?.();
    const bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(masterOut());
    const voice = new Voice(ctx, cls, bus);
    const top = CLASSES[cls]?.top ?? 60;
    const start = performance.now();
    let last = start;
    // Idle, a blip of the throttle up to the second gear's top, and back down.
    const tick = () => {
      const now = performance.now();
      const s = (now - start) / 1000;
      const dt = (now - last) / 1000;
      last = now;
      const v = s < 0.15 ? 0 : s < 0.55 ? top * voice.e.gears[1] * ((s - 0.15) / 0.4) : top * voice.e.gears[1] * Math.max(0, 1 - (s - 0.55) / 0.6);
      const r = voice.revs(v, top);
      voice.set({ hz: r.hz, load: s > 0.15 && s < 0.55 ? 1 : 0, level: 0.11 * (s > 1.25 ? Math.max(0, 1 - (s - 1.25) * 3) : 1), t: ctx.currentTime, dt, settle: false });
      if (s < 1.6) requestAnimationFrame(tick);
      else {
        voice.stop(ctx.currentTime);
        setTimeout(() => bus.disconnect(), 800);
      }
    };
    requestAnimationFrame(tick);
    if (ENGINES[cls].crackle) setTimeout(() => sfx("crackle", ENGINES[cls].crackle * volume), 620);
  } catch {
    // No audio.
  }
}

/* ---------------- Knocks ---------------- */

/**
 * The race's knocks, each a few layers: a tone ("sine", "square", "sawtooth", "triangle") or "noise" through
 * a `filter`, swept `from` → `to` Hz over `len` seconds at `vol`, starting `at` seconds in. `clean`: not
 * through the bit-crusher (the lights, the jingles).
 */
const SFX = {
  // Your punch lands: a slap and a thud.
  hit: [{ type: "noise", filter: "bandpass", from: 1600, to: 350, len: 0.12, vol: 0.5 }, { type: "square", from: 190, to: 60, len: 0.12, vol: 0.22 }],
  // You're hit: low, heavy, a grunt of a tone falling.
  hurt: [{ type: "sine", from: 140, to: 38, len: 0.28, vol: 0.55 }, { type: "noise", filter: "lowpass", from: 900, to: 120, len: 0.2, vol: 0.4 }, { type: "sawtooth", from: 220, to: 110, len: 0.16, vol: 0.08, at: 0.02 }],
  // A ram: metal on metal, a clank that rings.
  ram: [{ type: "noise", filter: "bandpass", from: 2600, to: 450, len: 0.3, vol: 0.5 }, { type: "square", from: 95, to: 48, len: 0.26, vol: 0.2 }, { type: "sawtooth", from: 1300, to: 900, len: 0.12, vol: 0.05, at: 0.04 }, { type: "triangle", from: 2100, to: 1900, len: 0.35, vol: 0.06, at: 0.02 }],
  // A soft knock (a bump, a pothole).
  bump: [{ type: "noise", filter: "lowpass", from: 500, to: 90, len: 0.14, vol: 0.45 }, { type: "sine", from: 90, to: 50, len: 0.12, vol: 0.3 }],
  // Into a barrier or the wall: a big crunch, and glass after.
  crash: [{ type: "noise", filter: "lowpass", from: 3200, to: 70, len: 0.6, vol: 0.6 }, { type: "square", from: 80, to: 30, len: 0.5, vol: 0.25 }, { type: "noise", filter: "highpass", from: 5000, to: 2500, len: 0.2, vol: 0.18, at: 0.05 }, { type: "noise", filter: "highpass", from: 7000, to: 4000, len: 0.35, vol: 0.12, at: 0.14 }],
  // You're wrecked: a boom.
  wreck: [{ type: "noise", filter: "lowpass", from: 4200, to: 40, len: 1.2, vol: 0.7 }, { type: "sine", from: 70, to: 24, len: 1.0, vol: 0.55 }, { type: "square", from: 60, to: 28, len: 0.6, vol: 0.15 }, { type: "noise", filter: "highpass", from: 6500, to: 3000, len: 0.4, vol: 0.14, at: 0.2 }],
  // Something else wrecked: glass and a pop.
  smash: [{ type: "noise", filter: "highpass", from: 6500, to: 3000, len: 0.28, vol: 0.3 }, { type: "noise", filter: "lowpass", from: 1800, to: 90, len: 0.5, vol: 0.45, at: 0.03 }, { type: "sine", from: 90, to: 35, len: 0.4, vol: 0.3 }],
  // A swing that missed you.
  whoosh: [{ type: "noise", filter: "bandpass", from: 450, to: 2200, len: 0.22, vol: 0.35 }],
  // Your swing that missed.
  whiff: [{ type: "noise", filter: "bandpass", from: 2400, to: 800, len: 0.12, vol: 0.25 }],
  // Someone winding up beside you: a quick warning.
  warn: [{ type: "square", from: 880, to: 880, len: 0.07, vol: 0.06, clean: true }, { type: "square", from: 660, to: 660, len: 0.07, vol: 0.06, at: 0.09, clean: true }],
  // Along the wall: a short grate (the grind loop carries on while you're on it).
  scrape: [{ type: "noise", filter: "bandpass", from: 3200, to: 1600, len: 0.16, vol: 0.3 }, { type: "sawtooth", from: 240, to: 180, len: 0.14, vol: 0.05 }],
  // Off a ramp: a whoosh up.
  ramp: [{ type: "noise", filter: "bandpass", from: 300, to: 1800, len: 0.35, vol: 0.3 }, { type: "square", from: 220, to: 660, len: 0.2, vol: 0.03, clean: true }],
  // The lights: three low beeps, then a high one.
  light: [{ type: "square", from: 440, to: 440, len: 0.22, vol: 0.16, clean: true }, { type: "sine", from: 880, to: 880, len: 0.22, vol: 0.08, clean: true }],
  go: [{ type: "square", from: 880, to: 880, len: 0.55, vol: 0.16, clean: true }, { type: "sine", from: 1760, to: 1760, len: 0.5, vol: 0.08, clean: true }, { type: "square", from: 1320, to: 1320, len: 0.5, vol: 0.05, clean: true }],
  // A lap: a rising arpeggio.
  lap: [523, 659, 784, 1047].map((f, i) => ({ type: "square", from: f, to: f, len: 0.12, vol: 0.07, at: i * 0.07, clean: true })),
  // Over the line: a fanfare.
  finish: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [784, 0.45], [1047, 0.55]].map(([f, at], i) => ({ type: i % 2 ? "triangle" : "square", from: f, to: f, len: i === 5 ? 0.7 : 0.14, vol: 0.08, at, clean: true })),
  // Back in control: a lift.
  respawn: [{ type: "triangle", from: 330, to: 990, len: 0.3, vol: 0.1, clean: true }],
  // Heat goes up: a short whoop of a siren.
  siren: [{ type: "sawtooth", from: 600, to: 1500, len: 0.35, vol: 0.06, clean: true }, { type: "sawtooth", from: 1500, to: 700, len: 0.35, vol: 0.06, at: 0.35, clean: true }],
  // A shift or lifting off: the exhaust crackles.
  crackle: [0, 0.05, 0.08, 0.14].map(at => ({ type: "noise", filter: "bandpass", from: 900 + Math.random() * 600, to: 300, len: 0.035, vol: 0.32, at })),
  // The Compact's turbo letting go.
  blowoff: [{ type: "noise", filter: "highpass", from: 5000, to: 2200, len: 0.32, vol: 0.12, clean: true }],
  // The menu: moving and picking.
  tick: [{ type: "square", from: 1200, to: 1200, len: 0.03, vol: 0.04, clean: true }],
  pick: [{ type: "square", from: 660, to: 660, len: 0.06, vol: 0.06, clean: true }, { type: "square", from: 990, to: 990, len: 0.09, vol: 0.06, at: 0.06, clean: true }],
  back: [{ type: "square", from: 660, to: 440, len: 0.1, vol: 0.05, clean: true }]
};

let crusher = null;

/** A bit-crusher (a stepped wave-shaper) in front of the speakers: the 90s in it. */
function crushed() {
  const ctx = audioContext();
  if (!crusher) {
    crusher = ctx.createWaveShaper();
    const steps = 14;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(Math.tanh(x * 1.6) * steps) / steps;
    }
    crusher.curve = curve;
    crusher.connect(masterOut());
  }
  return crusher;
}

/** Whether there's a knock by this name. */
export const hasSfx = kind => Object.hasOwn(SFX, kind);

/** Play a knock once at `volume` (0–1, the phone's). */
export function sfx(kind, volume) {
  const layers = SFX[kind];
  if (!layers || !(volume > 0)) return;
  try {
    const ctx = audioContext();
    const t0 = ctx.currentTime;
    for (const l of layers) {
      const t = t0 + (l.at ?? 0);
      const gain = ctx.createGain();
      gain.connect(l.clean ? masterOut() : crushed());
      gain.gain.setValueAtTime(l.vol * volume * 0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + l.len);
      let src;
      if (l.type === "noise") {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer();
        const filter = ctx.createBiquadFilter();
        filter.type = l.filter ?? "lowpass";
        filter.frequency.setValueAtTime(l.from, t);
        filter.frequency.exponentialRampToValueAtTime(l.to, t + l.len);
        src.connect(filter);
        filter.connect(gain);
        src.start(t, Math.random() * 0.5);
      } else {
        src = ctx.createOscillator();
        src.type = l.type;
        src.frequency.setValueAtTime(l.from, t);
        src.frequency.exponentialRampToValueAtTime(l.to, t + l.len);
        src.connect(gain);
        src.start(t);
      }
      src.stop(t + l.len + 0.02);
    }
  } catch {
    // No audio: play on silently.
  }
}

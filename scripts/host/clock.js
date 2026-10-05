/*
 * Host: one clock for the apps. Every 30 real seconds (and whenever world time moves), each app gets
 * a tick: the Garden's queue and engagement run on real minutes; Trauma Team billing and WatchBox
 * assessments run on world time.
 * Methods run on the store (`this`); see host/index.js.
 */

const TICK_MS = 30_000;

export const methods = {
  _startClock() {
    clearInterval(this._clock);
    this._rememberVitals();
    this._clock = setInterval(() => this.isHost && this._enqueue(() => this._tick()), TICK_MS);
  },

  /** A combat round went by (main.js, updateCombat): an AV-4 may be landing. */
  _onCombatRound() {
    this._enqueue(() => this._traumaArrivals());
  },

  /** World time moved (main.js, updateWorldTime): bills and assessments may be due. */
  _onWorldTime() {
    this._enqueue(() => this._tick({ world: true }));
  },

  async _tick({ world = false } = {}) {
    await this._tickTrauma();
    this._tickWatch();
    if (!world) await this._tickGarden();
  }
};

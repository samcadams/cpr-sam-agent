import { APP_MANIFEST } from "../apps/manifest.js";

/*
 * Host: one clock for the apps. Every 30 real seconds (and whenever world time moves), each app gets
 * a tick: the Garden's queue and engagement run on real minutes (and Combat Cabb's rides, on real seconds, as a
 * backstop for their own timers); Trauma Team billing and WatchBox
 * assessments run on world time. The GM's scheduled texts go out on either (host/texts.js).
 * Which apps tick, and with what method, is in apps/manifest.js.
 * Methods run on the store (`this`); see host/index.js.
 */

const TICK_MS = 30_000;

const TICKS = Object.values(APP_MANIFEST).map(app => app.tick).filter(Boolean);

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

  /** Each app's tick (apps/manifest.js `tick`), one after another. */
  async _tick({ world = false } = {}) {
    await this._sendScheduled(); // the GM's scheduled texts (host/texts.js)
    for (const { method, realTimeOnly } of TICKS) {
      if (!(world && realTimeOnly)) await this[method]();
    }
  }
};

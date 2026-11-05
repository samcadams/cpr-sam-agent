import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { advance, boardRank, configOf, deathLine, FAMILIES, hasPower, newGame, POWERS, shownDist, topScores } from "./model.js";
import { cycleInitial, defaultInitials, INITIAL_CHARS, validInitials } from "../pigeon/model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { draw, ENTRY, FIELD, POWER_COLORS, slotX } from "./draw.js";
import { Groove } from "./music.js";
import { playBlip, setMuffle } from "../../scripts/util/audio.js";
import { patchSetting } from "../../scripts/util/settings.js";

/*
 * Phone page: NCART Runner (see apps/ncart/model.js). A canvas game drawn in pseudo-3D: the elevated NCART
 * line at night, three lanes, the runner from behind. A / ← and D / → change lane, W / ↑ / Space jump,
 * S / ↓ slide (or slam down from a jump), Esc / P pause; on a touch screen, swipe (a tap jumps). The keys
 * are caught while the game is on screen, so they don't also move tokens. While a run is going the phone
 * holds its redraws (AgentPhone._busy). At the end the shards and distance go to the host's leaderboard;
 * a run that makes the board asks for three initials first, like Flappy Chrome. The GM hears when someone
 * starts and stops playing (ui/activity.js), and the run's sounds play quietly around the player's token.
 * A funk loop plays on the phone during runs (M turns it off). The drawing is apps/ncart/draw.js.
 * The GM Phone manages the board and the game's options instead (the world setting "ncart").
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

/** No new run for this long after a crash: they've stopped playing. */
const IDLE_MS = 120_000;

/* ---------------- Sound: synth blips (util/audio.js), at the phone's volume ---------------- */

/** Sounds also heard around the token, and how often each may be (taps and shards come fast). */
const WORLD_SOUNDS = { shard: 220, jump: 150, power: 0, horn: 0, pass: 0, gun: 400, hit: 0, speedup: 0, shield: 0 };
const lastWorld = {};

/** Play a blip on the phone, and (some) quietly around the player's token, through the host (apps/ncart/host.js). */
function blip(kind, actorId) {
  playBlip(kind, Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
  if (!actorId || !Object.hasOwn(WORLD_SOUNDS, kind)) return;
  const now = Date.now();
  if (now - (lastWorld[kind] ?? 0) < WORLD_SOUNDS[kind]) return;
  lastWorld[kind] = now;
  store.request("ncart-sound", { actorId, kind }, { quiet: true });
}

/** The game's events (apps/ncart/model.js emit) as sounds; a train warning also sounds its lane (low left, high right). */
function sounds(g, actorId) {
  for (const e of g.events) {
    if (e.type === "shard") blip("shard", actorId);
    else if (e.type === "jump") blip("jump", actorId);
    else if (e.type === "land") blip("land");
    else if (e.type === "lane") blip("lane");
    else if (e.type === "slide") blip("slide");
    else if (e.type === "bump") blip("bump");
    else if (e.type === "power") blip("power", actorId);
    else if (e.type === "speedup") blip("speedup", actorId);
    else if (e.type === "shield" || e.type === "dodge" || e.type === "smash") blip("shield", actorId);
    else if (e.type === "warn") {
      blip("horn", actorId);
      setTimeout(() => blip(`warn${e.lane}`), 250);
    } else if (e.type === "pass") blip("pass", actorId);
    else if (e.type === "crash") blip("hit", actorId);
  }
}

/** Footsteps every stride on the ground; gunfire in bursts while a shooter is close ahead. */
function ambience(g, state, actorId) {
  const stride = Math.floor(g.dist / 1.9);
  if (stride !== state.stride) {
    state.stride = stride;
    if (!g.air && g.slide <= 0) blip("step");
  }
  const shooting = g.obstacles.some(o => o.wide && !o.broken && o.z > g.dist - 2 && o.z - g.dist < 30);
  const shot = Math.floor(g.t * 9);
  if (shooting && shot !== state.shot && shot % 4 !== 3) blip("gun", actorId);
  state.shot = shot;
}

/** The canvas, as a multiple of the field (288 × 400), as Flappy Chrome's. */
const SIZE = { min: 0.85, max: 2.25 };

/** Keys: what each does in a run. */
const KEYS = {
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyW: "jump", ArrowUp: "jump", Space: "jump", KeyS: "slide", ArrowDown: "slide",
  KeyP: "pause", Escape: "pause", KeyM: "music"
};

/** A swipe this long (in screen pixels) is a swipe; shorter is a tap. */
const SWIPE = 24;

/* ---------------- The GM's options ---------------- */

const saveConfig = change => patchSetting("ncart", c => change(c));

export const actions = {
  "ncart-fake"() {
    const root = this.element[0];
    const name = root.querySelector("input[name=ncartName]")?.value.trim();
    const shards = Number(root.querySelector("input[name=ncartShards]")?.value);
    const dist = Number(root.querySelector("input[name=ncartDist]")?.value);
    if (!name) return ui.notifications.warn("Give the entry a name.");
    store.request("ncart-fake", { name, shards, dist });
  },
  "ncart-fill"() {
    store.request("ncart-fill", { count: 5 });
  },
  "ncart-remove"({ id }) {
    store.request("ncart-remove", { id });
  },
  "ncart-reset"() {
    Dialog.confirm({ title: "NCART Runner", content: "<p>Clear the whole leaderboard?</p>", yes: () => store.request("ncart-reset") });
  }
};

export const inputs = {
  "input[data-ncart-family]": {
    async change(event) {
      const { ncartFamily: key } = event.currentTarget.dataset;
      const on = event.currentTarget.checked;
      await saveConfig(c => {
        c.families = { ...c.families, [key]: on };
      });
    }
  },
  "input[data-ncart-power]": {
    async change(event) {
      const { ncartPower: key } = event.currentTarget.dataset;
      const on = event.currentTarget.checked;
      await saveConfig(c => {
        c.powers = { ...c.powers, [key]: on };
      });
    }
  }
};

/* ---------------- The page ---------------- */

const boardOf = () => game.settings.get(MODULE_ID, "ncartBoard")?.scores ?? [];

export const methods = {
  ncartData(ctx) {
    const gm = ctx.perspective === "gm";
    const actorId = ctx.subject?.actor?.id ?? null;
    const scores = boardOf();
    const mine = actorId ? scores.find(s => s.actorId === actorId) : null;
    const board = topScores(scores, gm ? 50 : undefined).map(s => ({ ...s, mine: !!actorId && s.actorId === actorId }));
    this._ncartBoard = { board, best: mine ?? null };
    const bar = appBar("ncart", { owner: gm ? null : ctx.subject.name });
    if (!gm) return { gm, bar, board };
    const cfg = configOf(game.settings.get(MODULE_ID, "ncart"));
    return {
      gm, bar, board,
      families: Object.entries(FAMILIES).map(([id, label]) => ({ id, label, on: cfg.families[id] })),
      powers: Object.entries(POWERS).map(([id, p]) => ({ id, label: `${p.name}: ${p.blurb}`, on: cfg.powers[id] }))
    };
  },

  /** After a redraw on this page: put the game on the new canvas (its last frame, or the title). */
  _ncartAttach(html) {
    const canvas = html.querySelector("canvas.agent-ncart-canvas");
    if (!canvas) return;
    this._ncartCanvas = canvas;
    this._ncartSize();
    this.ncart ??= newGame(configOf(game.settings.get(MODULE_ID, "ncart")));
    this._ncartFx ??= { warnings: [], messages: [], shake: 0, flash: 0, cam: null };
    this._ncartFx.muted = !game.settings.get(MODULE_ID, "ncartMusic");
    this._ncartRedraw();
    this._ncartDescribe();
    this._ncartResize?.disconnect();
    this._ncartResize = new ResizeObserver(() => {
      if (!canvas.isConnected) return this._ncartResize?.disconnect();
      this._ncartSize();
      if (!this._ncartRunning || this.ncart?.paused) this._ncartRedraw();
    });
    this._ncartResize.observe(canvas.parentElement);
    // Touch and mouse: a swipe steers, a tap jumps (or starts, or picks on the initials).
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      // Nothing else on the phone keeps the keyboard.
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
      this._ncartPointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointerup", event => {
      event.preventDefault();
      const start = this._ncartPointer;
      this._ncartPointer = null;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return this._ncartTap(event);
      if (!this._ncartRunning || this.ncart?.paused) return;
      if (Math.abs(dx) > Math.abs(dy)) this._ncartInput(dx < 0 ? "left" : "right");
      else this._ncartInput(dy < 0 ? "jump" : "slide");
    });
    if (!this._ncartKeys) {
      // Early (capture), so the game's keys don't also move tokens or work Foundry's keybindings.
      this._ncartKeys = event => {
        if (!this._ncartCanvas?.isConnected || !this.rendered || this.app !== "ncart" || this._minimized) return;
        if (this.context()?.perspective === "gm") return;
        if (event.target.closest?.("input, textarea, [contenteditable]")) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (this._ncartEntry) {
          if (this._ncartEntryKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            Hooks.callAll(`${MODULE_ID}.input`, this);
          }
          return;
        }
        const what = KEYS[event.code] ?? (event.code === "Enter" ? "start" : null);
        if (!what) return;
        // Not running, Esc is Foundry's again (closing windows).
        if (event.code === "Escape" && !this._ncartRunning) return;
        event.preventDefault();
        event.stopPropagation();
        Hooks.callAll(`${MODULE_ID}.input`, this);
        if (event.repeat) return;
        if (what === "pause") return this._ncartPause();
        if (what === "music") return this._ncartMusic();
        if (!this._ncartRunning) {
          if (what === "jump" || what === "start") this._ncartTap();
          return;
        }
        if (this.ncart.paused) return;
        this._ncartInput(what);
      };
      window.addEventListener("keydown", this._ncartKeys, true);
    }
  },

  /** Size the canvas: the field's shape, as big as the page allows within SIZE, pixels to match the screen. */
  _ncartSize() {
    const canvas = this._ncartCanvas;
    const box = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    const fit = Math.min((box?.clientWidth || FIELD.w) / FIELD.w, (box?.clientHeight || FIELD.h) / FIELD.h);
    const scale = Math.min(SIZE.max, Math.max(SIZE.min, fit));
    canvas.style.width = `${Math.round(FIELD.w * scale)}px`;
    canvas.style.height = `${Math.round(FIELD.h * scale)}px`;
    const width = Math.round(FIELD.w * scale * ratio);
    const height = Math.round(FIELD.h * scale * ratio);
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    canvas.getContext("2d").setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
  },

  /** Draw the current frame (outside a run: the panel changed). */
  _ncartRedraw() {
    const canvas = this._ncartCanvas;
    if (canvas?.isConnected && this.ncart) draw(canvas.getContext("2d"), this.ncart, this._ncartPanel(), this._ncartFx);
  },

  /** The panel over the track: initials, pause, or the title / how the last run ended with the board. */
  _ncartPanel() {
    const g = this.ncart;
    const entry = this._ncartEntry;
    if (entry) return { full: true, entry: { ...entry, left: Math.max(0, Math.ceil((entry.until - Date.now()) / 1000)) } };
    if (g?.paused) return { paused: true };
    if (this._ncartRunning) return null;
    const board = this._ncartBoard ?? { board: [], best: null };
    if (g?.over) return { ...board, full: true, lines: [g.overLine ?? deathLine(g.over), `◆ ${g.shards} shards   ${shownDist(g.dist)} m`] };
    return { ...board, full: true, lines: ["NCART RUNNER", "Grab shards. Dodge trains."] };
  },

  /** A tap: start a run, jump, or press on the initials entry. */
  _ncartTap(event) {
    if (this.context()?.perspective === "gm") return;
    if (this._ncartEntry) {
      if (!event || (!event.clientX && event.clientX !== 0)) return;
      const rect = this._ncartCanvas.getBoundingClientRect();
      return this._ncartEntryTap(((event.clientX - rect.left) / rect.width) * FIELD.w, ((event.clientY - rect.top) / rect.height) * FIELD.h);
    }
    if (this._ncartRunning) {
      if (this.ncart.paused) return this._ncartPause();
      return this._ncartInput("jump");
    }
    // A short pause after a crash, so a frantic key doesn't start the next run at once.
    if (this.ncart?.over && Date.now() - this._ncartEnded < 700) return;
    this.ncart = newGame(configOf(game.settings.get(MODULE_ID, "ncart")));
    this._ncartFx = { warnings: [], messages: [], shake: 0, flash: 0, cam: null, muted: !game.settings.get(MODULE_ID, "ncartMusic") };
    this._ncartPlaying(true);
    this._ncartRun();
  },

  /** A control for the next step. */
  _ncartInput(what) {
    const input = (this._ncartPressed ??= {});
    if (what === "left" || what === "right") input[what] = (input[what] ?? 0) + 1;
    else input[what] = true;
  },

  /** Music on or off (remembered for this player). */
  async _ncartMusic() {
    const on = !game.settings.get(MODULE_ID, "ncartMusic");
    await game.settings.set(MODULE_ID, "ncartMusic", on);
    if (this._ncartFx) this._ncartFx.muted = !on;
    this._ncartSay(on ? "Music on." : "Music off.");
    if (on && this._ncartRunning && !this.ncart?.paused) this._ncartGroove(true);
    else this._ncartGroove(false);
    if (!this._ncartRunning || this.ncart?.paused) this._ncartRedraw();
  },

  /** The background groove: on while a run is going (and the player wants it). */
  _ncartGroove(on) {
    this._ncartBeat ??= new Groove();
    if (on && game.settings.get(MODULE_ID, "ncartMusic")) this._ncartBeat.start(Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
    else this._ncartBeat.stop();
  },

  /** Pause or carry on (only in a run). */
  _ncartPause() {
    const g = this.ncart;
    if (!this._ncartRunning || !g || g.over) return;
    g.paused = !g.paused;
    this._ncartGroove(!g.paused);
    if (g.paused && this._ncartMuffled) setMuffle((this._ncartMuffled = false));
    this._ncartPressed = {};
    this._ncartSay(g.paused ? "Paused. P or Escape to carry on." : "Running.");
    this._ncartScreen();
    if (g.paused) this._ncartRedraw();
  },

  _ncartRun() {
    this._ncartRunning = true;
    this._ncartScreen();
    let last = performance.now();
    let lastShards = 0;
    let lastReport = 0;
    const actorId = this.context()?.subject?.actor?.id;
    const amb = {};
    this._ncartGroove(true);
    this._ncartSay("Run started. A and D change lanes, W jumps, S slides, P pauses, M turns the music off or on.");
    const frame = now => {
      const canvas = this._ncartCanvas;
      if (!canvas?.isConnected || !this._ncartRunning) return this._ncartStop();
      const g = this.ncart;
      // The phone minimised or the tab hidden: pause.
      if (!g.paused && (this._minimized || document.hidden)) this._ncartPause();
      const dt = (now - last) / 1000;
      last = now;
      if (!g.paused) {
        const input = this._ncartPressed ?? {};
        this._ncartPressed = {};
        advance(g, dt, input);
        this._ncartEffects(g, dt);
        sounds(g, actorId);
        ambience(g, amb, actorId);
        this._ncartBeat?.set(g.level);
        // Bullet time muffles every sound, the music too.
        const muffled = hasPower(g, "sandevistan");
        if (muffled !== this._ncartMuffled) setMuffle((this._ncartMuffled = muffled));
        g.events = [];
        // The GM's Monitor: shards as they come, at most every couple of seconds.
        if (g.shards !== lastShards && now - lastReport > 2000) {
          lastShards = g.shards;
          lastReport = now;
          this._ncartScreen();
        }
        draw(canvas.getContext("2d"), g, this._ncartPanel(), this._ncartFx);
      }
      if (g.over) return this._ncartStop(true);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  /** Turn the run's events into the page's effects (flashes, warnings, screen-reader lines). */
  _ncartEffects(g, dt) {
    const fx = this._ncartFx;
    fx.shake = Math.max(0, fx.shake - dt * 2.5);
    fx.flash = Math.max(0, fx.flash - dt * 2);
    for (const e of g.events) {
      if (e.type === "warn") {
        fx.warnings.push({ lane: e.lane, until: g.t + 2.2 });
        this._ncartSay(`Train coming in the ${["left", "middle", "right"][e.lane]} lane!`);
      } else if (e.type === "speedup") {
        fx.messages = [{ text: "SPEED UP", color: "#f5d300", until: g.t + 1.2 }];
      } else if (e.type === "power") {
        fx.messages = [{ text: POWERS[e.id].name.toUpperCase(), color: POWER_COLORS[e.id], until: g.t + 1.2 }];
        this._ncartSay(`${POWERS[e.id].name}: ${POWERS[e.id].blurb}.`);
      } else if (e.type === "shield") {
        fx.messages = [{ text: "ARMOR HELD", color: POWER_COLORS.armor, until: g.t + 1 }];
        fx.shake = 0.5;
      } else if (e.type === "dodge") {
        fx.messages = [{ text: "KERENZIKOV", color: POWER_COLORS.kerenzikov, until: g.t + 1 }];
      } else if (e.type === "crash") {
        fx.shake = 1;
        fx.flash = 1;
      }
    }
    fx.warnings = fx.warnings.filter(w => w.until > g.t);
  },

  /**
   * The run ended (or the page went away): send the score (a board-making one after its initials) and
   * let held redraws through.
   */
  _ncartStop(crashed = false) {
    if (!this._ncartRunning) return;
    this._ncartRunning = false;
    this._ncartGroove(false);
    if (this._ncartMuffled) setMuffle((this._ncartMuffled = false));
    const g = this.ncart;
    if (g && !g.over) g.over = "quit";
    if (g) g.overLine = g.over === "quit" ? "Got off at the next stop." : deathLine(g.over, Math.random());
    this._ncartEnded = Date.now();
    this._ncartScreen();
    const actorId = this.context()?.subject?.actor?.id;
    const shards = g?.shards ?? 0;
    const dist = shownDist(g?.dist ?? 0);
    const rank = crashed && shards > 0 && actorId ? boardRank(boardOf(), actorId, shards, dist) : 0;
    this._ncartSay(`${g?.overLine ?? "Run over."} ${shards} shards, ${dist} metres.${rank ? ` That's number ${rank} on the board: pick three initials with the arrow keys, then Enter.` : ""}`);
    if (shards > 0 && actorId) {
      if (rank) this._ncartEntryStart(actorId, shards, dist, rank);
      else store.request("ncart-score", { actorId, shards, dist, initials: this._ncartInitials(actorId) }, { quiet: true });
    }
    if (this._ncartSession) {
      this._ncartSession.runs++;
      const s = this._ncartSession;
      if (shards > s.best || (shards === s.best && dist > s.dist)) Object.assign(s, { best: shards, dist });
    }
    clearTimeout(this._ncartIdle);
    this._ncartIdle = setTimeout(() => this._ncartPlaying(false), IDLE_MS);
    // The crash's flash and shake die down under the game-over panel.
    if (crashed) {
      setTimeout(() => {
        Object.assign(this._ncartFx ?? {}, { flash: 0, shake: 0 });
        this._ncartRedraw();
      }, 250);
    }
    this._flush();
  },

  /** A run started, scored, paused or ended without the phone redrawing: the GM's Agent Monitor hears (ui/activity.js). */
  _ncartScreen() {
    Hooks.callAll(`${MODULE_ID}.screen`, this);
  },

  /** Screen readers: what the canvas shows when it's still (the title, your best, the board's top five). */
  _ncartDescribe() {
    const canvas = this._ncartCanvas;
    if (!canvas?.isConnected) return;
    const { board, best } = this._ncartBoard ?? { board: [], best: null };
    const top = board.slice(0, 5).map((s, i) => `${i + 1}, ${s.name}, ${s.shards} shards, ${s.dist} metres`).join("; ");
    canvas.setAttribute("aria-label", `NCART Runner, a running game: A and D or the left and right arrows change lanes, W or Space jumps, S slides, P pauses. Press Space to start.${best ? ` Your best: ${best.shards} shards, ${best.dist} metres.` : ""}${top ? ` Leaderboard: ${top}.` : ""}`);
  },

  /** Screen readers: read out a line. */
  _ncartSay(text) {
    const el = this._ncartCanvas?.parentElement?.querySelector("[data-ncart-say]");
    if (el) el.textContent = text;
  },

  /** The initials a character last went by on the board, or ones made from their name. */
  _ncartInitials(actorId) {
    const mine = boardOf().find(s => s.actorId === actorId);
    if (validInitials(mine?.name)) return mine.name;
    const actor = game.actors.get(actorId);
    return defaultInitials(actor ? displayName(actor) : "");
  },

  /** Ask for initials: the board-making run waits until OK (or the countdown, or leaving). */
  _ncartEntryStart(actorId, shards, dist, rank) {
    this._ncartEntryDone();
    this._ncartEntry = { actorId, shards, dist, rank, chars: [...this._ncartInitials(actorId)], slot: 0, until: Date.now() + ENTRY.ms };
    this._ncartScreen();
    this._ncartTicker = setInterval(() => {
      if (Date.now() >= this._ncartEntry?.until) this._ncartEntryDone();
      else this._ncartRedraw();
    }, 150);
  },

  /** Send the waiting score under the entered initials. */
  _ncartEntryDone() {
    clearInterval(this._ncartTicker);
    const entry = this._ncartEntry;
    if (!entry) return;
    this._ncartEntry = null;
    this._ncartEnded = Date.now();
    store.request("ncart-score", { actorId: entry.actorId, shards: entry.shards, dist: entry.dist, initials: entry.chars.join("") }, { quiet: true });
    this._ncartSay(`On the board as ${entry.chars.join(" ")}.`);
    blip("power");
    this._ncartScreen();
    this._ncartRedraw();
  },

  /** A tap on the entry (field units): an arrow cycles its slot, a slot selects it, OK sends. */
  _ncartEntryTap(x, y) {
    const entry = this._ncartEntry;
    if (Date.now() - this._ncartEnded < 500) return;
    const { ok } = ENTRY;
    if (x >= ok.x - 6 && x <= ok.x + ok.w + 6 && y >= ok.y - 4 && y <= ok.y + ok.h + 6) return this._ncartEntryDone();
    const i = [0, 1, 2].find(n => x >= slotX(n) - ENTRY.slotGap / 2 && x <= slotX(n) + ENTRY.slotW + ENTRY.slotGap / 2);
    if (i === undefined || y < ENTRY.up[0] || y > ENTRY.down[1]) return;
    entry.slot = i;
    if (y < ENTRY.up[1]) entry.chars[i] = cycleInitial(entry.chars[i], 1);
    else if (y > ENTRY.down[0]) entry.chars[i] = cycleInitial(entry.chars[i], -1);
    blip("lane");
    this._ncartRedraw();
  },

  /** A key on the entry: letters and digits fill the slots, arrows cycle and move, Enter sends. Handled? */
  _ncartEntryKey(event) {
    const entry = this._ncartEntry;
    const key = event.key?.length === 1 ? event.key.toUpperCase() : event.key;
    if (key === "Enter") this._ncartEntryDone();
    else if (key === " ") return true;
    else if (key.length === 1 && INITIAL_CHARS.includes(key)) {
      entry.chars[entry.slot] = key;
      entry.slot = Math.min(2, entry.slot + 1);
    } else if (key === "ArrowUp") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], 1);
    else if (key === "ArrowDown") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], -1);
    else if (key === "ArrowLeft" || key === "Backspace") entry.slot = Math.max(0, entry.slot - 1);
    else if (key === "ArrowRight") entry.slot = Math.min(2, entry.slot + 1);
    else return false;
    if (this._ncartEntry) this._ncartRedraw();
    return true;
  },

  /**
   * Note that someone started playing (their first run since they last stopped) or stopped (left the game or
   * the phone, or idled), with how it went. The host does nothing with it; the GM's Agent Monitor logs the
   * request (ui/activity.js).
   */
  _ncartPlaying(on) {
    clearTimeout(this._ncartIdle);
    if (on) {
      const actorId = this.context()?.subject?.actor?.id;
      if (!actorId || this._ncartSession) return;
      this._ncartSession = { actorId, runs: 0, best: 0, dist: 0 };
      return store.request("ncart-play", { actorId, playing: true }, { quiet: true });
    }
    // Leaving mid-run ends it (the score counts); leaving mid-initials sends them as they are.
    if (this._ncartRunning) this._ncartStop();
    this._ncartEntryDone();
    const session = this._ncartSession;
    if (!session) return;
    this._ncartSession = null;
    store.request("ncart-play", { actorId: session.actorId, playing: false, runs: session.runs, best: session.best, dist: session.dist }, { quiet: true });
  }
};

export const phone = {
  render(html) {
    if (this.app === "ncart") this._ncartAttach(html);
    else if (this._ncartSession) this._ncartPlaying(false); // left the game
  },
  close() {
    if (this._ncartSession) this._ncartPlaying(false);
  },
  /** A run in progress (its canvas would be lost). */
  busy() {
    return !!(this._ncartRunning);
  }
};

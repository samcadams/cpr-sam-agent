import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { formatMoney } from "../../scripts/model/money.js";
import { cycleInitial, defaultInitials, INITIAL_CHARS, validInitials } from "../pigeon/model.js";
import { advance, boardRank, canPlay, configOf, deathLine, newGame, riderOf, SALES, stageLabel, topScores } from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { draw, drawSteedCard, ENTRY, FIELD, slotX } from "./draw.js";
import { Gallop } from "./music.js";
import { agentDay } from "../../scripts/util/agentTime.js";
import { playBlip } from "../../scripts/util/audio.js";
import { esc } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";

/*
 * Phone page: Roach Race (see apps/roach/model.js). The cabinet fills the page: one button, Space / W / ↑ or a
 * tap (again in the air: double jump; a third time: glitch). Esc / P pauses, M the music. The keys are
 * caught while the game is on screen, so they don't also move tokens. Under the screen: the day pass
 * (bought through BangMe!, apps/roach/host.js) and the Steeds button, which opens the stable (buy a steed,
 * pick the one to ride). While a run is going the phone holds its redraws (AgentPhone._busy). At the end
 * the score goes to the host's board; a run that makes the board asks for initials first, like Flappy
 * Chrome. The GM hears when someone starts and stops playing (ui/activity.js), and the run's sounds play
 * quietly around the player's token. The drawing is apps/roach/draw.js.
 * The GM Phone shows the cabinet's settings, everyone's passes and steeds, the steed list and the board.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** No new run for this long after a crash: they've stopped playing. */
const IDLE_MS = 120_000;

/** The canvas, as a multiple of the field (288 × 400), as Flappy Chrome's. */
const SIZE = { min: 0.85, max: 2.25 };

/** Keys: what each does. */
const KEYS = { Space: "press", KeyW: "press", ArrowUp: "press", Enter: "press", KeyP: "pause", Escape: "pause", KeyM: "music" };

/* ---------------- Sound: synth blips (util/audio.js), at the phone's volume ---------------- */

/** Sounds also heard around the token, and how often each may be. */
const WORLD_SOUNDS = { jump: 150, point: 200, power: 0, hit: 0 };
const lastWorld = {};

function blip(kind, actorId) {
  playBlip(kind, Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
  if (!actorId || !Object.hasOwn(WORLD_SOUNDS, kind)) return;
  const now = Date.now();
  if (now - (lastWorld[kind] ?? 0) < WORLD_SOUNDS[kind]) return;
  lastWorld[kind] = now;
  store.request("roach-sound", { actorId, kind }, { quiet: true });
}

/** The run's events (apps/roach/model.js emit) as sounds. */
const SOUNDS = { jump: "jump", double: "flap", glitch: "shield", land: "land", apple: "point", carrot: "power", stage: "speedup", crash: "hit" };

const boardOf = () => game.settings.get(MODULE_ID, "roachBoard")?.scores ?? [];
const cfgOf = () => configOf(game.settings.get(MODULE_ID, "roach"));
const saveConfig = change => patchSetting("roach", change);

/* ---------------- Click actions ---------------- */

export const actions = {
  "roach-pass"() {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const { price } = cfgOf();
    if (!price) return store.request("roach-pass", { actorId: actor.id });
    Dialog.confirm({
      title: "Roach Race",
      content: `<p>A day pass for ${formatMoney(price)}? Unlimited rides until midnight.</p>`,
      yes: () => store.request("roach-pass", { actorId: actor.id })
    });
  },
  "roach-stable"() {
    this.roachStable = !this.roachStable;
    this.render();
  },
  "roach-steed"({ id }) {
    const actor = this.context()?.subject?.actor;
    const steed = cfgOf().steeds[id];
    if (!actor || !steed) return;
    const owned = riderOf(store.apps.roachRiders, actor.id).steeds.includes(id);
    if (owned || !steed.price) return store.request("roach-steed", { actorId: actor.id, steedId: id });
    Dialog.confirm({
      title: "Roach Race: Steeds",
      content: `<p>Buy ${esc(steed.name)} for ${formatMoney(steed.price)}? It's only a look: every steed rides like Roach.</p>`,
      yes: () => store.request("roach-steed", { actorId: actor.id, steedId: id })
    });
  },
  // The GM.
  "roach-grant"({ actorId, on }) {
    store.request("roach-grant", { actorId, on: on === "1" });
  },
  "roach-refund"({ actorId }) {
    Dialog.confirm({ title: "Roach Race", content: "<p>Take today's pass back and refund what was paid for it?</p>", yes: () => store.request("roach-grant", { actorId, on: false, refund: true }) });
  },
  "roach-take"({ actorId, steed }) {
    store.request("roach-gift", { actorId, steedId: steed, take: true });
  },
  "roach-record"({ actorId, award }) {
    store.request("roach-record", { actorId, award: award === "1" });
  },
  "roach-fake"() {
    const root = this.element[0];
    const name = root.querySelector("input[name=roachName]")?.value.trim();
    const score = Number(root.querySelector("input[name=roachScore]")?.value);
    if (!name) return ui.notifications.warn("Give the entry a name.");
    store.request("roach-fake", { name, score });
  },
  "roach-fill"() {
    store.request("roach-fill", { count: 5 });
  },
  "roach-remove"({ id }) {
    store.request("roach-remove", { id });
  },
  "roach-reset"() {
    Dialog.confirm({ title: "Roach Race", content: "<p>Clear the whole Hall of Fame?</p>", yes: () => store.request("roach-reset") });
  }
};

/* ---------------- The GM's settings ---------------- */

export const inputs = {
  "input[data-roach-flag]": {
    async change(event) {
      const { roachFlag: key } = event.currentTarget.dataset;
      const on = event.currentTarget.checked;
      await saveConfig(c => (c[key] = on));
    }
  },
  "input[data-roach-num]": {
    async change(event) {
      const { roachNum: key } = event.currentTarget.dataset;
      const value = Math.max(0, Math.floor(Number(event.currentTarget.value) || 0));
      await saveConfig(c => (c[key] = value));
    }
  },
  "input[data-roach-text]": {
    async change(event) {
      const { roachText: key } = event.currentTarget.dataset;
      const value = event.currentTarget.value.trim().slice(0, 120);
      await saveConfig(c => (c[key] = value));
    }
  },
  "[data-roach-steed]": {
    async change(event) {
      const { roachSteed: id, field } = event.currentTarget.dataset;
      let value = event.currentTarget.value;
      if (field === "price") value = Math.max(0, Math.floor(Number(value) || 0));
      await saveConfig(c => {
        c.steeds = { ...c.steeds, [id]: { ...c.steeds?.[id], [field]: value } };
      });
    }
  },
};

/** The GM's dropdowns: values are "<actorId>|<steedId>" (a gift) and "<steedId>|<sale>". */
export const dropdowns = {
  roachGift(value) {
    const [actorId, steedId] = String(value).split("|");
    if (actorId && steedId) store.request("roach-gift", { actorId, steedId });
  },
  roachSale(value) {
    const [id, sale] = String(value).split("|");
    if (id && sale) return saveConfig(c => (c.steeds = { ...c.steeds, [id]: { ...c.steeds?.[id], sale } }));
  }
};

/* ---------------- The page ---------------- */

export const methods = {
  roachData(ctx) {
    const gm = ctx.perspective === "gm";
    const actorId = ctx.subject?.actor?.id ?? null;
    const cfg = cfgOf();
    const scores = boardOf();
    const mine = actorId ? scores.find(s => s.actorId === actorId) : null;
    const board = topScores(scores, gm ? 50 : undefined).map(s => ({ ...s, mine: !!actorId && s.actorId === actorId }));
    const today = agentDay();
    this._roachBoard = { board, best: mine ?? null, record: cfg.record };
    const bar = appBar("roach", { owner: gm ? null : ctx.subject.name });
    if (gm) return { gm, bar, board, ...this._roachGmData(cfg, today) };
    const rider = riderOf(store.apps.roachRiders, actorId);
    this._roachRider = rider;
    this._roachOk = canPlay(rider, cfg, today);
    const steeds = Object.values(cfg.steeds)
      .filter(s => rider.steeds.includes(s.id) || s.sale !== "hidden")
      .map(s => {
        const owned = rider.steeds.includes(s.id);
        return { ...s, owned, riding: rider.steed === s.id, buy: !owned && s.sale === "buy", gift: !owned && s.sale === "gift", price: formatMoney(s.price) };
      });
    return {
      gm, bar, stable: !!this.roachStable, steeds,
      out: cfg.out, free: cfg.freePlay, pass: rider.pass === today, price: formatMoney(cfg.price), steed: cfg.steeds[rider.steed].name
    };
  },

  /** The GM's lists: every player character's pass and steeds, and the steed catalogue. */
  _roachGmData(cfg, today) {
    const riders = store.apps.roachRiders ?? {};
    const steedList = Object.values(cfg.steeds);
    return {
      cfg,
      riders: playerCharacters().map(actor => {
        const r = riderOf(riders, actor.id);
        return {
          actorId: actor.id, name: displayName(actor), pass: r.pass === today, paid: r.pass === today && r.paid > 0 ? formatMoney(r.paid) : null,
          steeds: r.steeds.filter(id => id !== "roach").map(id => ({ id, name: cfg.steeds[id].name, riding: r.steed === id })),
          gift: this._roachGiftDropdown(actor, steedList.filter(s => s.id !== "roach" && !r.steeds.includes(s.id))),
          pending: r.record === "pending", record: r.record === "awarded" ? "House Record: prize awarded" : r.record === "declined" ? "House Record: no prize" : null
        };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      steedList: steedList.map(s => ({
        ...s, fixed: s.id === "roach",
        sale: dropdown("roachSale", Object.entries(SALES).map(([value, label]) => ({ value: `${s.id}|${value}`, label, selected: value === s.sale })), { title: `${s.name}: where it's sold` })
      }))
    };
  },

  /** The GM's "Give a steed…" for a character (null when they own every steed). */
  _roachGiftDropdown(actor, gifts) {
    if (!gifts.length) return null;
    return dropdown("roachGift", [
      { value: "", label: "Give a steed…", selected: true },
      ...gifts.map(s => ({ value: `${actor.id}|${s.id}`, label: s.name }))
    ], { title: `Give ${displayName(actor)} a steed`, cls: "agent-wide" });
  },

  /** After a redraw on this page: the game on the new canvas (its last frame, or the title), or the stable's pictures. */
  _roachAttach(html) {
    for (const c of html.querySelectorAll("canvas[data-roach-card]")) {
      const steed = cfgOf().steeds[c.dataset.roachCard];
      if (!steed) continue;
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * ratio) || 96;
      c.height = Math.round(c.clientHeight * ratio) || 72;
      const ctx = c.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawSteedCard(ctx, steed, c.width / ratio, c.height / ratio);
    }
    const canvas = html.querySelector("canvas.agent-roach-canvas");
    if (!canvas) return;
    this._roachCanvas = canvas;
    this._roachSize();
    this.roach ??= newGame();
    this._roachFx ??= { messages: [], shake: 0, flash: 0 };
    this._roachRedraw();
    this._roachDescribe();
    this._roachResize?.disconnect();
    this._roachResize = new ResizeObserver(() => {
      if (!canvas.isConnected) return this._roachResize?.disconnect();
      this._roachSize();
      if (!this._roachRunning || this.roach?.paused) this._roachRedraw();
    });
    this._roachResize.observe(canvas.parentElement);
    // Press on the way down (it's a jump: no waiting for the finger to lift).
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
      this._roachTap(event);
    });
    if (!this._roachKeys) {
      // Early (capture), so the game's keys don't also move tokens or work Foundry's keybindings.
      this._roachKeys = event => {
        if (!this._roachCanvas?.isConnected || !this.rendered || this.app !== "roach" || this._minimized) return;
        if (this.context()?.perspective === "gm") return;
        if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (this._roachEntry) {
          if (this._roachEntryKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            Hooks.callAll(`${MODULE_ID}.input`, this);
          }
          return;
        }
        const what = KEYS[event.code];
        if (!what) return;
        // Not running, Esc is Foundry's again (closing windows).
        if (event.code === "Escape" && !this._roachRunning) return;
        event.preventDefault();
        event.stopPropagation();
        Hooks.callAll(`${MODULE_ID}.input`, this);
        if (event.repeat) return;
        if (what === "pause") return this._roachPause();
        if (what === "music") return this._roachMusic();
        this._roachTap();
      };
      window.addEventListener("keydown", this._roachKeys, true);
    }
  },

  /** Size the canvas: the field's shape, as big as the page allows within SIZE, pixels to match the screen. */
  _roachSize() {
    const canvas = this._roachCanvas;
    const box = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    const fit = Math.min((box?.clientWidth || FIELD.w) / FIELD.w, (box?.clientHeight || FIELD.h) / FIELD.h);
    const scale = Math.min(SIZE.max, Math.max(SIZE.min, fit));
    canvas.style.width = `${Math.round(FIELD.w * scale)}px`;
    canvas.style.height = `${Math.round(FIELD.h * scale)}px`;
    const width = Math.round(FIELD.w * scale * ratio);
    const height = Math.round(FIELD.h * scale * ratio);
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
  },

  /** The steed being ridden (its look). */
  _roachSteed() {
    const cfg = cfgOf();
    return cfg.steeds[this._roachRider?.steed] ?? cfg.steeds.roach;
  },

  _roachRedraw() {
    const canvas = this._roachCanvas;
    if (canvas?.isConnected && this.roach) draw(canvas.getContext("2d"), this.roach, this._roachPanel(), this._roachFx, this._roachSteed());
  },

  /** The panel over the course: initials, pause, or the title / last run / no pass, with the board. */
  _roachPanel() {
    const g = this.roach;
    const entry = this._roachEntry;
    if (entry) return { full: true, entry: { ...entry, left: Math.max(0, Math.ceil((entry.until - Date.now()) / 1000)) } };
    if (g?.paused) return { paused: true };
    if (this._roachRunning) return null;
    const board = this._roachBoard ?? { board: [], best: null, record: 0 };
    const cfg = cfgOf();
    const base = { ...board, full: true };
    if (cfg.out) return { ...base, alert: true, lines: ["OUT OF ORDER", "Sorry, choom. The cabinet's down."], foot: "Come back later" };
    if (!this._roachOk) return { ...base, lines: ["ROACH RACE", "INSERT PASS", `A day pass is ${formatMoney(cfg.price)}: ride all you like until midnight.`], foot: "Buy a day pass below" };
    const foot = g?.over ? "Tap or Space to ride again" : "Tap or Space to ride";
    if (g?.over) return { ...base, lines: [g.overLine ?? deathLine(g.over), `${String(Math.floor(g.score)).padStart(6, "0")}  ·  reached ${stageLabel(g.stage)}`], foot };
    return { ...base, lines: ["ROACH RACE", cfg.freePlay ? "FREE PLAY" : "One button. One horse. One life."], foot };
  },

  /** A tap or the button: start a run, press, or pick on the initials entry. */
  _roachTap(event) {
    if (this.context()?.perspective === "gm") return;
    if (this._roachEntry) {
      if (!event || (!event.clientX && event.clientX !== 0)) return;
      const rect = this._roachCanvas.getBoundingClientRect();
      return this._roachEntryTap(((event.clientX - rect.left) / rect.width) * FIELD.w, ((event.clientY - rect.top) / rect.height) * FIELD.h);
    }
    if (this._roachRunning) {
      if (this.roach.paused) return this._roachPause();
      this.roach.pending = true;
      return;
    }
    if (this.roach?.over && Date.now() - this._roachEnded < 700) return;
    // No pass, or out of order: the panel says so.
    if (!this._roachOk || cfgOf().out) {
      this._roachSay(cfgOf().out ? "The cabinet is out of order." : "You need a day pass to ride: the Buy button is under the screen.");
      return this._roachRedraw();
    }
    this.roach = newGame();
    this._roachFx = { messages: [], shake: 0, flash: 0 };
    this._roachPlaying(true);
    this._roachRun();
  },

  /** Music on or off (remembered for this player). */
  async _roachMusic() {
    const on = !game.settings.get(MODULE_ID, "roachMusic");
    await game.settings.set(MODULE_ID, "roachMusic", on);
    this._roachSay(on ? "Music on." : "Music off.");
    this._roachGroove(on && this._roachRunning && !this.roach?.paused);
  },

  _roachGroove(on) {
    this._roachBeat ??= new Gallop();
    if (on && game.settings.get(MODULE_ID, "roachMusic")) this._roachBeat.start(Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
    else this._roachBeat.stop();
  },

  _roachPause() {
    const g = this.roach;
    if (!this._roachRunning || !g || g.over) return;
    g.paused = !g.paused;
    g.pending = false;
    this._roachGroove(!g.paused);
    this._roachSay(g.paused ? "Paused. P or Escape to ride on." : "Riding.");
    this._roachScreen();
    if (g.paused) this._roachRedraw();
  },

  _roachRun() {
    this._roachRunning = true;
    this._roachScreen();
    let last = performance.now();
    let lastReport = 0;
    let stride = 0;
    const actorId = this.context()?.subject?.actor?.id;
    this._roachGroove(true);
    this._roachSay("Ride! Space or tap jumps; again in the air jumps again; a third time glitches you to the ground. P pauses, M turns the music off or on.");
    const frame = now => {
      const canvas = this._roachCanvas;
      if (!canvas?.isConnected || !this._roachRunning) return this._roachStop();
      const g = this.roach;
      if (!g.paused && (this._minimized || document.hidden)) this._roachPause();
      const dt = (now - last) / 1000;
      last = now;
      if (!g.paused) {
        advance(g, dt);
        this._roachEffects(g, dt, actorId);
        // Hoofbeats.
        const s = Math.floor(g.dist / (g.carrot > 0 ? 30 : 22));
        if (s !== stride) {
          stride = s;
          if (g.y <= 0 && !g.falling) blip("step");
        }
        this._roachBeat?.set(Math.floor(g.stage / 4));
        g.events = [];
        if (now - lastReport > 3000) {
          lastReport = now;
          this._roachScreen();
        }
        draw(canvas.getContext("2d"), g, this._roachPanel(), this._roachFx, this._roachSteed());
      }
      if (g.over) return this._roachStop(true);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  /** The run's events as sounds, banners and screen-reader lines. */
  _roachEffects(g, dt, actorId) {
    const fx = this._roachFx;
    fx.shake = Math.max(0, fx.shake - dt * 2.5);
    fx.flash = Math.max(0, fx.flash - dt * 3);
    for (const e of g.events) {
      if (SOUNDS[e.type]) blip(SOUNDS[e.type], actorId);
      if (e.type === "stage") {
        fx.messages = [{ text: `STAGE ${e.label}`, color: "#f5c542", until: g.t + 1.6 }];
        this._roachSay(`Stage ${e.label}.`);
      } else if (e.type === "carrot") {
        fx.messages = [{ text: e.chain ? "CARROT CHAIN!" : "TWO LEGS!", color: "#ff9a2a", until: g.t + 1.2 }];
        this._roachSay("Carrot: two legs, triple points.");
      } else if (e.type === "glitch") {
        fx.flash = 0.6;
        this._roachSay("Glitch.");
      } else if (e.type === "crash") {
        fx.shake = 1;
        fx.flash = 1;
      }
    }
    fx.messages = fx.messages.filter(m => m.until > g.t);
  },

  /** The run ended (or the page went away): send the score (after initials, if it makes the board). */
  _roachStop(crashed = false) {
    if (!this._roachRunning) return;
    this._roachRunning = false;
    this._roachGroove(false);
    const g = this.roach;
    if (g && !g.over) g.over = "quit";
    if (g) g.overLine = deathLine(g.over, Math.random());
    this._roachEnded = Date.now();
    this._roachScreen();
    const actorId = this.context()?.subject?.actor?.id;
    const score = Math.floor(g?.score ?? 0);
    const dist = Math.floor(g?.dist ?? 0);
    const rank = crashed && score > 0 && actorId ? boardRank(boardOf(), actorId, score) : 0;
    this._roachSay(`${g?.overLine ?? "Run over."} ${score} points, stage ${stageLabel(g?.stage ?? 0)}.${rank ? ` That's number ${rank} in the Hall of Fame: pick three initials with the arrow keys, then Enter.` : ""}`);
    if (score > 0 && actorId) {
      if (rank) this._roachEntryStart(actorId, score, dist, rank);
      else store.request("roach-score", { actorId, score, dist, initials: this._roachInitials(actorId) }, { quiet: true });
    }
    if (this._roachSession) {
      this._roachSession.runs++;
      this._roachSession.best = Math.max(this._roachSession.best, score);
    }
    clearTimeout(this._roachIdle);
    this._roachIdle = setTimeout(() => this._roachPlaying(false), IDLE_MS);
    if (crashed) {
      setTimeout(() => {
        Object.assign(this._roachFx ?? {}, { flash: 0, shake: 0 });
        this._roachRedraw();
      }, 250);
    }
    this._flush();
  },

  /** A run started, scored, paused or ended without the phone redrawing: the GM's Agent Monitor hears (ui/activity.js). */
  _roachScreen() {
    Hooks.callAll(`${MODULE_ID}.screen`, this);
  },

  /** Screen readers: what the canvas shows when it's still. */
  _roachDescribe() {
    const canvas = this._roachCanvas;
    if (!canvas?.isConnected) return;
    const { board, best } = this._roachBoard ?? { board: [], best: null };
    const top = board.slice(0, 5).map((s, i) => `${i + 1}, ${s.name}, ${s.score}`).join("; ");
    const state = cfgOf().out ? " Out of order." : this._roachOk ? " Press Space to ride." : " You need a day pass: the Buy button is under the screen.";
    canvas.setAttribute("aria-label", `Roach Race, a one-button jumping game: Space, W or a tap jumps, again in the air jumps again, a third time glitches you to the ground. P pauses.${state}${best ? ` Your best: ${best.score}.` : ""}${top ? ` Hall of Fame: ${top}.` : ""}`);
  },

  _roachSay(text) {
    const el = this._roachCanvas?.parentElement?.querySelector("[data-roach-say]");
    if (el) el.textContent = text;
  },

  _roachInitials(actorId) {
    const mine = boardOf().find(s => s.actorId === actorId);
    if (validInitials(mine?.name)) return mine.name;
    const actor = game.actors.get(actorId);
    return defaultInitials(actor ? displayName(actor) : "");
  },

  _roachEntryStart(actorId, score, dist, rank) {
    this._roachEntryDone();
    this._roachEntry = { actorId, score, dist, rank, chars: [...this._roachInitials(actorId)], slot: 0, until: Date.now() + ENTRY.ms };
    this._roachScreen();
    this._roachTicker = setInterval(() => {
      if (Date.now() >= this._roachEntry?.until) this._roachEntryDone();
      else this._roachRedraw();
    }, 150);
  },

  _roachEntryDone() {
    clearInterval(this._roachTicker);
    const entry = this._roachEntry;
    if (!entry) return;
    this._roachEntry = null;
    this._roachEnded = Date.now();
    store.request("roach-score", { actorId: entry.actorId, score: entry.score, dist: entry.dist, initials: entry.chars.join("") }, { quiet: true });
    this._roachSay(`In the Hall of Fame as ${entry.chars.join(" ")}.`);
    blip("power");
    this._roachScreen();
    this._roachRedraw();
  },

  _roachEntryTap(x, y) {
    const entry = this._roachEntry;
    if (Date.now() - this._roachEnded < 500) return;
    const { ok } = ENTRY;
    if (x >= ok.x - 6 && x <= ok.x + ok.w + 6 && y >= ok.y - 4 && y <= ok.y + ok.h + 6) return this._roachEntryDone();
    const i = [0, 1, 2].find(n => x >= slotX(n) - ENTRY.slotGap / 2 && x <= slotX(n) + ENTRY.slotW + ENTRY.slotGap / 2);
    if (i === undefined || y < ENTRY.up[0] || y > ENTRY.down[1]) return;
    entry.slot = i;
    if (y < ENTRY.up[1]) entry.chars[i] = cycleInitial(entry.chars[i], 1);
    else if (y > ENTRY.down[0]) entry.chars[i] = cycleInitial(entry.chars[i], -1);
    blip("lane");
    this._roachRedraw();
  },

  _roachEntryKey(event) {
    const entry = this._roachEntry;
    const key = event.key?.length === 1 ? event.key.toUpperCase() : event.key;
    if (key === "Enter") this._roachEntryDone();
    else if (key === " ") return true;
    else if (key.length === 1 && INITIAL_CHARS.includes(key)) {
      entry.chars[entry.slot] = key;
      entry.slot = Math.min(2, entry.slot + 1);
    } else if (key === "ArrowUp") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], 1);
    else if (key === "ArrowDown") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], -1);
    else if (key === "ArrowLeft" || key === "Backspace") entry.slot = Math.max(0, entry.slot - 1);
    else if (key === "ArrowRight") entry.slot = Math.min(2, entry.slot + 1);
    else return false;
    if (this._roachEntry) this._roachRedraw();
    return true;
  },

  /** Note that someone started or stopped playing; the GM's Agent Monitor logs it (ui/activity.js). */
  _roachPlaying(on) {
    clearTimeout(this._roachIdle);
    if (on) {
      const actorId = this.context()?.subject?.actor?.id;
      if (!actorId || this._roachSession) return;
      this._roachSession = { actorId, runs: 0, best: 0 };
      return store.request("roach-play", { actorId, playing: true }, { quiet: true });
    }
    if (this._roachRunning) this._roachStop();
    this._roachEntryDone();
    const session = this._roachSession;
    if (!session) return;
    this._roachSession = null;
    store.request("roach-play", { actorId: session.actorId, playing: false, runs: session.runs, best: session.best }, { quiet: true });
  }
};

export const phone = {
  render(html) {
    if (this.app === "roach") this._roachAttach(html);
    else if (this._roachSession) this._roachPlaying(false); // left the game
  },
  close() {
    if (this._roachSession) this._roachPlaying(false);
  },
  /** A run in progress (its canvas would be lost). */
  busy() {
    return !!(this._roachRunning);
  }
};

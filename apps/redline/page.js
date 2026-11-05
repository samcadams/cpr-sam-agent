import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { dataFolder, MODULE_ID } from "../../scripts/config.js";
import {
  advance, autopilot, bestLap, inZone, trackPos, buildTrack, CLASS_IDS, CLASSES, clock, configOf, decodeGhost, defaultFamilies, DISTRICT_IDS, DISTRICTS,
  DRIVE_MODES, encodeGhost, finishLine, ghostFile, gridSlot, HAZARDS, LAP_LEN, LAPS, newRace, newSeed, ordinal, PACK, PHYSICS, quickSpec, runRank,
  seenMask, split, SPRINT_LEN, topRuns, trackName, trackSpec, deltaTo
} from "./model.js";
import { defaultInitials } from "../pigeon/model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { draw, drawCard, FIELD } from "./draw.js";
import { drawMenu, menuRows } from "./menu.js";
import { hasSfx, RaceAudio, revOnce, sfx } from "./audio.js";
import { openLayoutEditor } from "./editor.js";
import { NightDrive } from "./music.js";
import { playBlip } from "../../scripts/util/audio.js";
import { patchSetting } from "../../scripts/util/settings.js";

/*
 * Phone page: REDLINE (see apps/redline/model.js). Players get a lobby (Quick Race, or the GM's Set Tracks with
 * their layouts, boards and ghosts; a ride class and a plate tag), then the race on a canvas (apps/redline/draw.js):
 * A / ← and D / → steer, S / ↓ brakes, Q and E punch or kick from a bike, P / Esc pauses (the pause has
 * buttons to drive on or end the race; X ends it too), M turns the music off or on. Keyboard only. The keys are
 * caught while racing, so they don't also move tokens. With the GM's Drive skill switch on, a Set Track race
 * starts with a Drive Land Vehicle check (the character sheet's own roll, waited out if Dice So Nice is rolling
 * it) that picks the grid slot, shown on the track before the lights; "Race again" keeps that roll. Up to three
 * ghosts load by themselves, the split against the fastest. While racing the phone holds its redraws
 * (AgentPhone._busy). A finished Set Track run goes to the host (apps/redline/host.js) with its ghost. The GM Phone
 * gets the switches and the track builder (and its layout editor, apps/redline/editor.js).
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** The canvas, as a multiple of the field (288 × 400), as NCART Runner's. */
const SIZE = { min: 0.85, max: 2.25 };
/** No new race for this long after the last: they've stopped playing. */
const IDLE_MS = 180_000;
/** Most ghosts on the track at once. */
const MAX_GHOSTS = 3;
/** Seconds on the finish line before the results. */
const FINISH_HOLD = 2.6;
/** Seconds the grid roll shows on the track before the lights. */
const INTRO = 2.8;
/** Longest wait for Dice So Nice to finish rolling the grid check (ms). */
const DICE_WAIT = 8000;

const KEYS = {
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", KeyS: "brake", ArrowDown: "brake",
  KeyQ: "punchL", KeyE: "punchR", KeyP: "pause", Escape: "pause", KeyM: "music", KeyX: "quit"
};

const cfgOf = () => configOf(game.settings.get(MODULE_ID, "redline"));
const tracksAll = () => game.settings.get(MODULE_ID, "redlineTracks") ?? {};
const boardOf = id => game.settings.get(MODULE_ID, "redlineBoard")?.[id] ?? [];
const saveConfig = change => patchSetting("redline", c => change(c));
const saveTracks = change => patchSetting("redlineTracks", c => change(c));
/** A ghost's address. `ts`: the board entry's ghost stamp, so a newer ghost isn't served from the cache. */
const ghostUrl = (trackId, actorId, ts) => `${foundry.utils.getRoute(`${dataFolder()}/${ghostFile(trackId, actorId)}`)}?t=${ts}`;

/** Built tracks, by their seed record (building is quick, but not every frame). */
const built = new Map();
function trackOf(spec) {
  const key = JSON.stringify(trackSpec(spec));
  if (!built.has(key)) {
    if (built.size > 40) built.clear();
    built.set(key, buildTrack(spec));
  }
  return built.get(key);
}

/* ---------------- Sound ---------------- */

/** Sounds also heard around the token, and how often each may be. */
const WORLD_SOUNDS = { crash: 400, ram: 400, punch: 300, siren: 4000, go: 0, finish: 0 };
const lastWorld = {};

function blip(kind, actorId, local = kind) {
  const volume = Number(game.settings.get(MODULE_ID, "volume") ?? 0.5);
  if (hasSfx(local)) sfx(local, volume);
  else playBlip(`rl-${local}`, volume);
  if (!actorId || !Object.hasOwn(WORLD_SOUNDS, kind)) return;
  const now = Date.now();
  if (now - (lastWorld[kind] ?? 0) < WORLD_SOUNDS[kind]) return;
  lastWorld[kind] = now;
  store.request("redline-sound", { actorId, kind }, { quiet: true });
}

/* ---------------- Click actions ---------------- */

export const actions = {
  /** A Quick Race on the menu's course (a run of the last one races your ghosts of it). */
  "redline-quick"() {
    const seed = this._redlineQuickSeed();
    return this._redlineStart({ quick: seed, again: this._rlLast?.quick === seed });
  },
  /** The menu's Set Track (the screen reader's button; the menu's own RACE does the same). */
  "redline-race-picked"() {
    if (this.rlTrack) return this._redlineStart({ trackId: this.rlTrack });
  },
  "redline-resume"() {
    if (this.redline?.paused === true) this._redlinePause();
  },
  "redline-end"() {
    if (this._rlRunning) this._redlineStop("quit");
  },

  /* GM: the track builder. */
  "redline-new"() {
    const seed = newSeed();
    this.rlDraft = { ...trackSpec({ id: foundry.utils.randomID(), district: "combat", seed, name: trackName(seed) }), autoName: true };
    this.render();
  },
  "redline-reroll"() {
    if (!this.rlDraft) return;
    const seed = newSeed();
    const { points, ...draft } = this.rlDraft;
    this.rlDraft = { ...draft, seed, ...(draft.autoName ? { name: trackName(seed) } : {}) };
    this.render();
  },
  /** GM: the layout editor (a big window: drag the points, pan, zoom). */
  "redline-layout"() {
    const draft = this.rlDraft;
    if (!draft || (draft.editing && draft.status !== "draft")) return;
    openLayoutEditor(trackSpec(draft), points => {
      if (!this.rlDraft) return;
      const next = { ...this.rlDraft, points };
      if (!points) delete next.points;
      const track = trackOf(next);
      this.rlDraft = { ...next, length: Math.round(track.len / 100) * 100 };
      this.render();
    });
  },
  "redline-edit"({ id }) {
    const spec = (tracksAll().tracks ?? []).find(t => t.id === id);
    if (spec) this.rlDraft = { ...spec, editing: true };
    this.render();
  },
  "redline-cancel"() {
    this.rlDraft = null;
    this.render();
  },
  async "redline-save"({ status }) {
    const draft = this.rlDraft;
    if (!draft) return;
    const name = this.element[0].querySelector("input[name=redlineName]")?.value.trim();
    const spec = trackSpec({ ...draft, name: name || draft.name || trackName(draft.seed), status: status ?? draft.status, ts: draft.ts || Date.now() });
    await saveTracks(c => {
      const list = c.tracks ?? [];
      c.tracks = list.some(t => t.id === spec.id) ? list.map(t => (t.id === spec.id ? spec : t)) : [...list, spec];
      if (draft.nominee) c.nominated = (c.nominated ?? []).filter(n => n.id !== draft.nominee);
    });
    this.rlDraft = null;
    this.render();
  },
  async "redline-status"({ id, status }) {
    await saveTracks(c => {
      c.tracks = (c.tracks ?? []).map(t => (t.id === id ? { ...t, status } : t));
    });
  },
  "redline-delete"({ id }) {
    const spec = (tracksAll().tracks ?? []).find(t => t.id === id);
    Dialog.confirm({
      title: "REDLINE",
      content: `<p>Delete <b>${foundry.utils.escapeHTML?.(spec?.name ?? "this track") ?? spec?.name}</b>, its board and its ghosts?</p>`,
      yes: async () => {
        store.request("redline-wipe", { trackId: id });
        await saveTracks(c => {
          c.tracks = (c.tracks ?? []).filter(t => t.id !== id);
        });
      }
    });
  },
  "redline-wipe"({ id }) {
    Dialog.confirm({ title: "REDLINE", content: "<p>Wipe this track's board and ghosts?</p>", yes: () => store.request("redline-wipe", { trackId: id }) });
  },
  "redline-remove"({ id, actor }) {
    store.request("redline-remove", { trackId: id, actorId: actor });
  },
  "redline-nominee"({ id }) {
    const n = (tracksAll().nominated ?? []).find(x => x.id === id);
    if (!n) return;
    this.rlDraft = { ...trackSpec({ id: foundry.utils.randomID(), district: n.district, kind: "sprint", length: n.length, difficulty: n.difficulty, seed: n.seed, name: n.name, from: n.by }), nominee: n.id };
    this.render();
  },
  async "redline-dismiss"({ id }) {
    await saveTracks(c => {
      c.nominated = (c.nominated ?? []).filter(n => n.id !== id);
    });
  },
  "redline-preview"({ id }) {
    const spec = id === "draft" ? this.rlDraft : (tracksAll().tracks ?? []).find(t => t.id === id);
    if (!spec) return;
    const track = trackOf(spec);
    this.redline = newRace(track, { pack: 0, config: { ...cfgOf(), heat: false } });
    this.redline.t = 0;
    this._rlFx = { messages: [], shake: 0, flash: 0, preview: true };
    this._rlPreview = true;
    this._rlStartLoop = true;
    this.render();
  }
};

/* ---------------- Inputs ---------------- */

export const inputs = {
  "input[name=redlineTag]": {
    change(event) {
      const actorId = this.context()?.subject?.actor?.id;
      const tag = event.currentTarget.value.replace(/[^\w\- ]/g, "").trim().toUpperCase().slice(0, 8);
      if (actorId) (this._rlTags ??= {})[actorId] = tag;
      event.currentTarget.value = tag;
    }
  },
  "input[data-rl-ghost]": {
    change(event) {
      const key = event.currentTarget.dataset.rlGhost;
      const list = (this.rlGhosts ??= []).filter(k => k !== key);
      if (event.currentTarget.checked) list.push(key);
      // Three at most: the oldest pick drops off.
      this.rlGhosts = list.slice(-MAX_GHOSTS);
      this.rlGhostsPicked = true;
      this.render();
    }
  },
  /* GM: switches. */
  "input[data-rl-setting]": {
    change(event) {
      const el = event.currentTarget;
      const key = el.dataset.rlSetting;
      const value = el.type === "checkbox" ? el.checked : el.value;
      return saveConfig(c => (c[key] = value));
    }
  },
  /* GM: the draft's numbers. */
  "input[data-rl-draft]": {
    change(event) {
      this._redlineDraftSet(event.currentTarget.dataset.rlDraft, Number(event.currentTarget.value));
    }
  },
  "input[data-rl-family]": {
    change(event) {
      if (!this.rlDraft) return;
      const key = event.currentTarget.dataset.rlFamily;
      this.rlDraft = { ...this.rlDraft, families: { ...this.rlDraft.families, [key]: event.currentTarget.checked } };
      this.render();
    }
  },
  "input[name=redlineName]": {
    change(event) {
      if (this.rlDraft) this.rlDraft = { ...this.rlDraft, name: event.currentTarget.value.trim().slice(0, 40), autoName: false };
    }
  }
};

/* ---------------- Dropdowns ---------------- */

export const dropdowns = {
  /** GM: the Drive skill switch. */
  redlineDrive(value) {
    return saveConfig(c => (c.drive = value));
  },
  redlineDistrict(value) {
    this._redlineDraftSet("district", value);
  },
  redlineKind(value) {
    this._redlineDraftSet("kind", value);
  },
  redlineDifficulty(value) {
    this._redlineDraftSet("difficulty", Number(value));
  }
};

/* ---------------- The page's data ---------------- */

/** A track's line on a card: kind, laps, length, difficulty. */
function trackLine(spec) {
  const km = (spec.length / 1000).toFixed(1);
  const kind = spec.kind === "circuit" ? `${spec.laps} lap${spec.laps === 1 ? "" : "s"} × ${km} km` : `${km} km sprint`;
  return `${kind} · ${["", "Easy", "Medium", "Hard"][spec.difficulty]}`;
}

/** A board's rows as shown. */
function runsShown(trackId, actorId, closed) {
  return topRuns(boardOf(trackId)).map(r => ({
    ...r, time: clock(r.total / 1000), lapTime: closed && Number.isFinite(r.lap) ? clock(r.lap / 1000) : "", mine: r.actorId === actorId,
    clsName: CLASSES[r.cls]?.name ?? r.cls, grid: Number.isInteger(r.slot) ? `P${r.slot + 1}` : ""
  }));
}

export const methods = {
  /** GM: change one of the draft's fields (a new district brings its own hazards; a new kind its own length). */
  _redlineDraftSet(key, value) {
    if (!this.rlDraft) return;
    const next = { ...this.rlDraft, [key]: value };
    if (key === "district") next.families = defaultFamilies(value);
    if (key === "kind") {
      next.length = value === "sprint" ? SPRINT_LEN.default : LAP_LEN.default;
      delete next.points;
    }
    // A drawn layout stretches (or shrinks) to the new length.
    if (key === "length" && next.points) {
      const range = next.kind === "circuit" ? LAP_LEN : SPRINT_LEN;
      const k = Math.min(range.max, Math.max(range.min, value)) / trackOf(this.rlDraft).len;
      next.points = next.points.map(([x, y]) => [x * k, y * k]);
    }
    this.rlDraft = { ...next, ...trackSpec(next), autoName: this.rlDraft.autoName, editing: this.rlDraft.editing, nominee: this.rlDraft.nominee };
    this.render();
  },

  redlineData(ctx) {
    const gm = ctx.perspective === "gm";
    const bar = appBar("redline", { owner: gm ? null : ctx.subject.name });
    const cfg = cfgOf();
    // On the track: the canvas fills the page.
    if (this._rlRunning || this._rlPreview || this._rlStartLoop) return { gm, bar, racing: true };
    this._rlCards = {};
    // Players: the start menu, drawn on the canvas (apps/redline/menu.js).
    return gm ? this._redlineGmData(bar, cfg) : { gm: false, bar, menu: true };
  },

  _redlinePlayerData(ctx, bar, cfg) {
    const actor = ctx.subject?.actor;
    const actorId = actor?.id ?? null;
    this.rlTab ??= "quick";
    this.rlCls ??= "sport";
    const seen = store.apps.redlineSeen?.[actorId] ?? {};
    const live = (tracksAll().tracks ?? []).filter(t => t.status === "live");
    const tracks = live.map(spec => {
      this._rlCards[spec.id] = { spec, seen: seen[spec.id] ?? 0 };
      const runs = boardOf(spec.id);
      const mine = runs.find(r => r.actorId === actorId);
      const record = topRuns(runs)[0];
      return {
        id: spec.id, name: spec.name, line: trackLine(spec), district: DISTRICTS[spec.district].name, open: this.rlTrack === spec.id,
        best: mine ? clock(mine.total / 1000) : "", record: record ? `${clock(record.total / 1000)} ${record.tag}` : ""
      };
    });
    const open = live.find(t => t.id === this.rlTrack);
    let detail = null;
    if (open) {
      const runs = runsShown(open.id, actorId, open.kind === "circuit");
      // Ghosts: up to three load by themselves (the fastest on the board, and your own best), until the
      // player picks their own.
      const withGhost = runs.filter(r => r.ghost);
      if (!this.rlGhostsPicked) {
        const mine = withGhost.find(r => r.mine);
        const top = withGhost.slice(0, MAX_GHOSTS).map(r => r.actorId);
        if (mine && !top.includes(mine.actorId)) top.splice(MAX_GHOSTS - 1, 1, mine.actorId);
        this.rlGhosts = top;
      }
      detail = {
        id: open.id, closed: open.kind === "circuit", runs,
        ghosts: withGhost.map(r => ({
          key: r.actorId, on: this.rlGhosts.includes(r.actorId),
          label: `${r.mine ? "You" : r.rank === 1 ? "Record" : `#${r.rank}`}: ${r.tag} ${r.time}${r.mine ? "" : ` (${r.who})`}`
        })),
        full: this.rlGhosts.length >= MAX_GHOSTS
      };
    }
    const mineTag = Object.values(game.settings.get(MODULE_ID, "redlineBoard") ?? {}).flat().find(r => r.actorId === actorId)?.tag;
    const tag = this._rlTags?.[actorId] ?? mineTag ?? defaultInitials(actor ? displayName(actor) : "");
    const last = this._rlLast;
    return {
      gm: false, bar, paused: cfg.paused, grid: cfg.drive === "grid",
      tabs: [{ id: "quick", label: "Quick Race", active: this.rlTab === "quick" }, { id: "tracks", label: `Set Tracks (${live.length})`, active: this.rlTab === "tracks" }],
      quickTab: this.rlTab === "quick",
      classes: CLASS_IDS.map(id => {
        const c = CLASSES[id];
        return { id, name: c.name, blurb: c.blurb, on: this.rlCls === id, bike: c.bike, stats: [["Speed", c.top / 70], ["Grip", c.grip / 1.12], ["Tough", c.tough / 1.5]].map(([label, k]) => ({ label, pct: Math.round(k * 100) })) };
      }),
      tag,
      again: last?.quick !== undefined ? { name: quickSpec(last.quick).name, ghosts: last.ghosts?.length ? `${last.ghosts.length} ghost${last.ghosts.length === 1 ? "" : "s"}` : "" } : null,
      tracks, detail,
      result: this.rlResult
    };
  },

  _redlineGmData(bar, cfg) {
    const all = tracksAll();
    const draft = this.rlDraft;
    let builder = null;
    if (draft) {
      const spec = trackSpec(draft);
      this._rlCards.draft = { spec, all: true };
      const track = trackOf(spec);
      const range = spec.kind === "circuit" ? LAP_LEN : SPRINT_LEN;
      builder = {
        ...spec, editing: !!draft.editing, locked: !!draft.editing && spec.status !== "draft",
        districts: dropdown("redlineDistrict", DISTRICT_IDS.map(id => ({ value: id, label: DISTRICTS[id].name, selected: id === spec.district })), { title: "District" }),
        kinds: dropdown("redlineKind", [{ value: "circuit", label: "Circuit (laps)", selected: spec.kind === "circuit" }, { value: "sprint", label: "Sprint (A to B)", selected: spec.kind === "sprint" }], { title: "Kind" }),
        difficulties: dropdown("redlineDifficulty", [1, 2, 3].map(d => ({ value: String(d), label: ["", "Easy", "Medium", "Hard"][d], selected: d === spec.difficulty })), { title: "Difficulty" }),
        circuit: spec.kind === "circuit", range, lapsRange: LAPS,
        families: Object.keys(DISTRICTS[spec.district].families).map(id => ({ id, name: HAZARDS[id].name, on: spec.families[id] })),
        blurb: DISTRICTS[spec.district].blurb,
        stats: `${(track.len / 1000).toFixed(2)} km${track.closed ? " a lap" : ""} · ${track.hazards.length} hazards · ${spec.points ? `your layout${track.eased.length ? " (some bends eased)" : ""}` : `seed ${spec.seed}`}`,
        drawn: !!spec.points
      };
    }
    const tracks = (all.tracks ?? []).map(spec => {
      this._rlCards[spec.id] = { spec, all: true };
      return {
        id: spec.id, name: spec.name, line: trackLine(spec), district: DISTRICTS[spec.district].name, status: spec.status,
        live: spec.status === "live", draft: spec.status === "draft", retired: spec.status === "retired", from: spec.from ?? null,
        runs: runsShown(spec.id, null, spec.kind === "circuit")
      };
    });
    return {
      gm: true, bar, cfg,
      drives: dropdown("redlineDrive", Object.entries(DRIVE_MODES).map(([value, label]) => ({ value, label, selected: cfg.drive === value })), { title: "Drive skill" }),
      builder, tracks,
      nominated: (all.nominated ?? []).map(n => ({ ...n, district: DISTRICTS[n.district]?.name ?? n.district, km: (n.length / 1000).toFixed(1) }))
    };
  },

  /* ---------------- After a redraw ---------------- */

  /** After a redraw on this page: the layout cards, or the race's canvas (starting the loop if one's waiting). */
  _redlineAttach(html) {
    for (const canvas of html.querySelectorAll("canvas[data-rl-card]")) {
      const card = this._rlCards?.[canvas.dataset.rlCard];
      if (card) drawCard(canvas, trackOf(card.spec), card);
    }
    const canvas = html.querySelector("canvas.agent-redline-canvas");
    if (!canvas) return;
    this._rlCanvas = canvas;
    if (canvas.closest(".agent-redline-menu")) return this._redlineMenuAttach(canvas);
    this._redlineSize();
    this._rlResize?.disconnect();
    this._rlResize = new ResizeObserver(() => {
      if (!canvas.isConnected) return this._rlResize?.disconnect();
      this._redlineSize();
    });
    this._rlResize.observe(canvas.parentElement);
    this._redlineListen(canvas);
    if (this._rlStartLoop) {
      this._rlStartLoop = false;
      this._redlineLoop();
    }
  },

  /** Size the canvas: the field's shape, as big as the page allows within SIZE. */
  _redlineSize() {
    const canvas = this._rlCanvas;
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

  /** Keys (held, caught early so they don't move tokens). A click on the GM's fly-through ends it. */
  _redlineListen(canvas) {
    this._rlHeld ??= new Set();
    canvas.addEventListener("pointerdown", event => {
      if (this._rlPreview) {
        event.preventDefault();
        this._redlineStop("quit");
      }
    });
    if (this._rlKeys) return;
    this._rlKeys = event => {
      if (!this._rlCanvas?.isConnected || !this.rendered || this.app !== "redline" || this._minimized) return;
      if (!this._rlRunning && !this._rlPreview) return;
      if (event.target.closest?.("input, textarea, [contenteditable]")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const what = KEYS[event.code];
      if (!what) return;
      event.preventDefault();
      event.stopPropagation();
      Hooks.callAll(`${MODULE_ID}.input`, this);
      if (event.type === "keyup") return this._rlHeld.delete(what);
      if (this._rlPreview) return what === "pause" || what === "quit" ? this._redlineStop("quit") : undefined;
      if (event.repeat) return;
      if (what === "pause") return this._redlinePause();
      if (what === "music") return this._redlineMusic();
      if (what === "quit") return this.redline?.paused ? this._redlineStop("quit") : undefined;
      if (what === "punchL" || what === "punchR") this._rlPunch = what === "punchL" ? -1 : 1;
      else this._rlHeld.add(what);
    };
    window.addEventListener("keydown", this._rlKeys, true);
    window.addEventListener("keyup", this._rlKeys, true);
  },

  /* ---------------- The start menu (players) ---------------- */

  /** A fresh menu: on the RACE button, a Quick Race course rolled. */
  _redlineMenuState() {
    return { screen: "main", focus: "go", boardAt: 0, resultAt: 0, quickSeeds: [newSeed()], quickAt: 0, spin: 0, tagDraft: "" };
  },

  /** The Quick Race course the menu shows. */
  _redlineQuickSeed() {
    const m = (this._rlMenu ??= this._redlineMenuState());
    return m.quickSeeds[m.quickAt];
  },

  /** What the menu shows, worked out after each change (not every frame). */
  _redlineMenuData() {
    const ctx = this.context();
    const actorId = ctx?.subject?.actor?.id ?? null;
    const cfg = cfgOf();
    const m = (this._rlMenu ??= this._redlineMenuState());
    const live = (tracksAll().tracks ?? []).filter(t => t.status === "live");
    if (this.rlTab === "tracks" && !live.some(t => t.id === this.rlTrack)) {
      this.rlTrack = live[0]?.id ?? null;
      this.rlGhostsPicked = false;
    }
    const d = this._redlinePlayerData(ctx, null, cfg);
    const seen = store.apps.redlineSeen?.[actorId] ?? {};
    const seed = this._redlineQuickSeed();
    const qspec = quickSpec(seed);
    const again = this._rlLast?.quick === seed ? this._rlLast : null;
    const best = again?.ghosts?.[0];
    const quick = {
      name: qspec.name, district: DISTRICTS[qspec.district].name, line: trackLine(qspec), built: trackOf(qspec), again: !!again,
      notes: again ? [[best ? `YOUR BEST ${clock(best.time)}` : "RUN IT AGAIN", "#f5d300"], [`${again.ghosts?.length ?? 0} GHOST${again.ghosts?.length === 1 ? "" : "S"} OF YOUR RUNS`, "#7fe9ff"]] : [["NO BOARD · BEAT YOUR GHOST", "#a9a3c0"]]
    };
    const i = live.findIndex(t => t.id === this.rlTrack);
    const spec = live[i];
    const row = d.tracks.find(t => t.id === spec?.id);
    const track = spec ? {
      id: spec.id, name: spec.name, district: row.district, line: row.line, built: trackOf(spec), seen: seen[spec.id] ?? 0,
      notes: [row.record ? [`RECORD ${row.record}`, "#f5d300"] : ["NO TIMES YET", "#a9a3c0"], ...(row.best ? [[`YOUR BEST ${row.best}`, "#00f0ff"]] : [])]
    } : null;
    const board = this.rlTab === "tracks" && d.detail ? {
      runs: d.detail.runs.map(r => ({ ...r, ghostOn: !!r.ghost && (this.rlGhosts ?? []).includes(r.actorId) })),
      ghostsOn: (this.rlGhosts ?? []).length
    } : null;
    const ci = CLASS_IDS.indexOf(this.rlCls ?? "sport");
    const result = this.rlResult;
    const resultButtons = result ? [
      { id: "again", label: result.quick ? "RUN IT AGAIN" : "RACE AGAIN" },
      ...(result.quick && result.done && !result.nominated ? [{ id: "nominate", label: "NOMINATE" }] : []),
      { id: "done", label: "DONE" }
    ] : [];
    if (m.screen === "result" && !result) m.screen = "main";
    return {
      paused: cfg.paused, mode: this.rlTab, setCount: live.length, quick, track, trackIndex: Math.max(0, i), trackCount: live.length,
      ride: d.classes[ci], classIndex: ci, classCount: CLASS_IDS.length, tag: d.tag, board, result, resultButtons,
      canRace: !cfg.paused && (this.rlTab === "quick" || !!spec)
    };
  },

  /** The world behind the menu: a race the autopilot drives (the Quick Race's own course; a Set Track's district, no hazards: its fog of war stays). */
  _redlineAttract() {
    const data = this._rlMenuData;
    let spec;
    if (data.mode === "quick") spec = quickSpec(this._redlineQuickSeed());
    else {
      const district = (tracksAll().tracks ?? []).find(t => t.id === this.rlTrack)?.district ?? "combat";
      const base = quickSpec(1000 + DISTRICT_IDS.indexOf(district));
      spec = trackSpec({ ...base, district, families: Object.fromEntries(Object.keys(DISTRICTS[district].families).map(f => [f, f === "traffic"])) });
    }
    const key = JSON.stringify(trackSpec(spec));
    if (this._rlAttract?.key === key && !this._rlAttract.g.finished) return this._rlAttract.g;
    const g = newRace(trackOf(spec), { pack: 4, cls: this.rlCls ?? "sport", config: { ...cfgOf(), heat: false, fighting: false } });
    // Already rolling.
    for (let i = 0; i < 150; i++) advance(g, 1 / 30, autopilot(g));
    g.events = [];
    this._rlAttract = { key, g, fx: { messages: [], shake: 0, flash: 0, menu: true } };
    return g;
  },

  /** The menu's canvas is on the page: work out what it shows, listen, and run its loop. */
  _redlineMenuAttach(canvas) {
    this._rlMenu ??= this._redlineMenuState();
    if (this.rlResult && this._rlMenu.screen !== "result" && this._rlMenu.resultFor !== this.rlResult) {
      this._rlMenu.screen = "result";
      this._rlMenu.resultAt = 0;
    }
    this._rlMenu.resultFor = this.rlResult;
    this._rlMenuData = this._redlineMenuData();
    this._redlineSize();
    this._rlResize?.disconnect();
    this._rlResize = new ResizeObserver(() => canvas.isConnected ? this._redlineSize() : this._rlResize?.disconnect());
    this._rlResize.observe(canvas.parentElement);
    canvas.addEventListener("keydown", event => this._redlineMenuKey(event));
    canvas.addEventListener("pointerdown", event => this._redlineMenuClick(event, canvas));
    // Take the keys if nothing else on the page has them (not out of a chat box).
    const active = document.activeElement;
    if (!active || active === document.body || active.closest?.(".ctp-phone-app")) canvas.focus({ preventScroll: true });
    const token = (this._rlMenuLoop = {});
    let last = performance.now();
    const frame = now => {
      if (this._rlMenuLoop !== token || !canvas.isConnected || this._rlRunning || this._rlPreview) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this._minimized && !document.hidden) {
        const g = this._redlineAttract();
        advance(g, dt, autopilot(g));
        g.events = [];
        const ctx = canvas.getContext("2d");
        draw(ctx, g, this._rlAttract.fx);
        this._rlMenu.spin = (this._rlMenu.spin ?? 0) + dt * 2.2;
        this._rlHits = drawMenu(ctx, this._rlMenuData, this._rlMenu);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  /** Redraw the menu's data after a change, and say what changed for screen readers. */
  _redlineMenuChanged(say) {
    this._rlMenuData = this._redlineMenuData();
    if (say) this._redlineSay(say);
  },

  /** What a main-screen row says (for screen readers). */
  _redlineMenuSay(row) {
    const d = this._rlMenuData;
    const tr = d.mode === "quick" ? d.quick : d.track;
    switch (row) {
      case "mode": return `Mode: ${d.mode === "quick" ? "Quick Race" : `Set Tracks, ${d.setCount} open`}. Left and right change.`;
      case "track": return tr ? `${d.mode === "quick" ? "Course" : "Track"}: ${tr.name}, ${tr.district}, ${tr.line}. ${(tr.notes ?? []).map(n => n[0].toLowerCase()).join(". ")}. Left and right ${d.mode === "quick" ? "roll a new course" : "change track"}.` : "No Set Tracks open yet.";
      case "ride": return `Ride: ${d.ride.name}, ${d.ride.blurb}. ${d.ride.stats.map(s => `${s.label} ${Math.round(s.pct / 10)} of 10`).join(", ")}. Left and right change.`;
      case "plate": return `Plate tag ${d.tag || "none"}. Enter to edit.`;
      case "board": return `Board and ghosts: ${d.board.runs.length} times, ${d.board.ghostsOn} ghosts on. Enter to open.`;
      case "go": return d.canRace ? `${d.mode === "quick" ? (d.quick.again ? "Run it again" : "Quick Race") : `Race ${d.track?.name}`}. Enter to start.` : d.paused ? "The GM has paused all races." : "No track to race.";
    }
    return "";
  },

  /** Keys on the menu (only while its canvas has the focus). */
  _redlineMenuKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const m = this._rlMenu;
    const d = this._rlMenuData;
    if (!m || !d) return;
    const key = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Enter: "enter", Space: "enter", NumpadEnter: "enter", Escape: "back", Backspace: "back", KeyM: "music" }[event.code];
    if (m.screen === "tag") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") return this._redlineTagSave(true);
      if (event.key === "Escape") return this._redlineTagSave(false);
      if (event.key === "Backspace") m.tagDraft = m.tagDraft.slice(0, -1);
      else if (/^[\w\- ]$/.test(event.key) && m.tagDraft.length < 8) m.tagDraft += event.key.toUpperCase();
      else return;
      sfx("tick", this._redlineVolume());
      return this._redlineSay(m.tagDraft.split("").join(" ") || "empty");
    }
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "music") return this._redlineMusic();
    this._redlineMenuDo(key);
  },

  /** A click or tap on the menu: what's under it. */
  _redlineMenuClick(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * FIELD.w;
    const y = ((event.clientY - rect.top) / rect.height) * FIELD.h;
    const hit = [...(this._rlHits ?? [])].reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    canvas.focus({ preventScroll: true });
    if (!hit) return;
    event.preventDefault();
    const m = this._rlMenu;
    if (hit.row === "tag") return this._redlineTagSave(true);
    if (hit.row === "result") {
      m.resultAt = Number(hit.act.split(":")[1]);
      return this._redlineMenuDo("enter");
    }
    if (hit.row === "board" && m.screen === "board") {
      m.boardAt = hit.act === "back" ? -1 : Number(hit.act.split(":")[1]);
      return this._redlineMenuDo("enter");
    }
    const was = m.focus;
    m.focus = hit.row;
    if (hit.act === "prev") return this._redlineMenuDo("left");
    if (hit.act === "next") return this._redlineMenuDo("right");
    if (hit.act === "quick" || hit.act === "tracks") {
      if (this.rlTab !== hit.act) return this._redlineMenuDo("right");
      return this._redlineSay(this._redlineMenuSay("mode"));
    }
    if (hit.act === "enter" || (hit.act === "focus" && was === hit.row)) return this._redlineMenuDo("enter");
    sfx("tick", this._redlineVolume());
    this._redlineSay(this._redlineMenuSay(hit.row));
  },

  /** The result screen's "Race again". */
  _redlineAgain() {
    const last = this._rlLast;
    if (!last) return;
    if (last.quick !== undefined) return this._redlineStart({ quick: last.quick, again: true });
    return this._redlineStart({ trackId: last.trackId, again: true });
  },
  /** Leaves the result screen for the start menu. */
  _redlineDone() {
    this.rlResult = null;
    if (this._rlMenu) this._rlMenu.screen = "main";
    this.render();
  },
  /** Sends the last Quick Race course to the GM's track builder. */
  _redlineNominate() {
    const last = this._rlLast;
    const actorId = this.context()?.subject?.actor?.id;
    if (last?.quick === undefined || !actorId) return;
    const spec = quickSpec(last.quick);
    store.request("redline-nominate", { actorId, seed: spec.seed, district: spec.district, length: spec.length, difficulty: spec.difficulty });
    last.nominated = true;
    if (this.rlResult) this.rlResult.nominated = true;
    ui.notifications.info("REDLINE: course sent to the GM's track builder.");
    this.render();
  },
  _redlineVolume() {
    return Number(game.settings.get(MODULE_ID, "volume") ?? 0.5);
  },

  /** One menu move: "up", "down", "left", "right", "enter", "back". */
  _redlineMenuDo(key) {
    const m = this._rlMenu;
    const d = this._rlMenuData;
    const vol = this._redlineVolume();
    if (m.screen === "result") {
      const buttons = d.resultButtons;
      if (key === "left" || key === "right") {
        m.resultAt = (m.resultAt + (key === "left" ? -1 : 1) + buttons.length) % buttons.length;
        sfx("tick", vol);
        return this._redlineSay(buttons[m.resultAt].label);
      }
      if (key === "back") return this._redlineDone();
      if (key !== "enter") return;
      const b = buttons[m.resultAt] ?? buttons.at(-1);
      sfx("pick", vol);
      if (b.id === "again") return this._redlineAgain();
      if (b.id === "nominate") {
        this._redlineNominate();
        m.resultAt = 0;
        return this._redlineMenuChanged("Course nominated for the GM's Set Tracks.");
      }
      return this._redlineDone();
    }
    if (m.screen === "board") {
      const runs = d.board?.runs.slice(0, 10) ?? [];
      if (key === "up" || key === "down") {
        const order = [...runs.keys(), -1];
        const at = order.indexOf(m.boardAt);
        m.boardAt = order[(at + (key === "up" ? -1 : 1) + order.length) % order.length];
        sfx("tick", vol);
        const r = runs[m.boardAt];
        return this._redlineSay(r ? `${r.rank}. ${r.tag}, ${r.who}, ${r.time}.${r.ghost ? ` Ghost ${r.ghostOn ? "on" : "off"}: Enter switches it.` : ""}` : "Back.");
      }
      if (key === "back" || (key === "enter" && m.boardAt === -1)) {
        m.screen = "main";
        sfx("back", vol);
        return this._redlineMenuChanged(this._redlineMenuSay("board"));
      }
      const r = runs[m.boardAt];
      if (key === "enter" && r?.ghost) {
        const list = (this.rlGhosts ?? []).filter(k => k !== r.actorId);
        if (!r.ghostOn) list.push(r.actorId);
        this.rlGhosts = list.slice(-MAX_GHOSTS);
        this.rlGhostsPicked = true;
        sfx("pick", vol);
        return this._redlineMenuChanged(`Ghost ${r.ghostOn ? "off" : "on"}: ${r.tag}.`);
      }
      return;
    }
    const rows = menuRows(d);
    if (!rows.includes(m.focus)) m.focus = "go";
    if (key === "up" || key === "down") {
      const i = rows.indexOf(m.focus);
      m.focus = rows[Math.max(0, Math.min(rows.length - 1, i + (key === "up" ? -1 : 1)))];
      sfx("tick", vol);
      return this._redlineSay(this._redlineMenuSay(m.focus));
    }
    if (key === "back") return;
    const step = key === "left" ? -1 : 1;
    switch (m.focus) {
      case "mode":
        if (key === "enter" || key === "left" || key === "right") {
          this.rlTab = this.rlTab === "quick" ? "tracks" : "quick";
          this.rlResult = null;
          sfx("pick", vol);
          return this._redlineMenuChanged(this._redlineMenuSay("mode"));
        }
        return;
      case "track":
        if (key === "enter") {
          m.focus = "ride";
          return this._redlineSay(this._redlineMenuSay("ride"));
        }
        if (this.rlTab === "quick") {
          // → rolls a new course (← goes back through the ones rolled).
          if (step < 0) m.quickAt = Math.max(0, m.quickAt - 1);
          else {
            if (m.quickAt === m.quickSeeds.length - 1) m.quickSeeds.push(newSeed());
            m.quickAt++;
            if (m.quickSeeds.length > 12) {
              m.quickSeeds.shift();
              m.quickAt--;
            }
          }
        } else {
          const live = (tracksAll().tracks ?? []).filter(t => t.status === "live");
          if (live.length < 2) return;
          const i = live.findIndex(t => t.id === this.rlTrack);
          this.rlTrack = live[(i + step + live.length) % live.length].id;
          this.rlGhosts = null;
          this.rlGhostsPicked = false;
        }
        sfx("tick", vol);
        return this._redlineMenuChanged(this._redlineMenuSay("track"));
      case "ride": {
        if (key === "enter") {
          m.focus = "plate";
          return this._redlineSay(this._redlineMenuSay("plate"));
        }
        const i = CLASS_IDS.indexOf(this.rlCls ?? "sport");
        this.rlCls = CLASS_IDS[(i + step + CLASS_IDS.length) % CLASS_IDS.length];
        revOnce(this.rlCls, vol);
        return this._redlineMenuChanged(this._redlineMenuSay("ride"));
      }
      case "plate":
        if (key !== "enter") return;
        m.screen = "tag";
        m.tagDraft = d.tag ?? "";
        sfx("pick", vol);
        return this._redlineSay(`Type a plate tag, up to 8 letters and numbers, then Enter. Now: ${m.tagDraft || "empty"}.`);
      case "board":
        if (key !== "enter") return;
        m.screen = "board";
        m.boardAt = d.board.runs.length ? 0 : -1;
        sfx("pick", vol);
        return this._redlineSay(`Board: ${d.board.runs.length} times. Up and down choose, Enter switches a ghost, Escape goes back.`);
      case "go":
        if (key !== "enter") return;
        if (!d.canRace) return this._redlineSay(this._redlineMenuSay("go"));
        sfx("pick", vol);
        return this.rlTab === "quick" ? actions["redline-quick"].call(this) : actions["redline-race-picked"].call(this);
    }
  },

  /** The plate tag typed: kept (`save`) or not. */
  _redlineTagSave(save) {
    const m = this._rlMenu;
    const actorId = this.context()?.subject?.actor?.id;
    m.screen = "main";
    if (save && actorId) {
      const tag = m.tagDraft.replace(/[^\w\- ]/g, "").trim().toUpperCase().slice(0, 8);
      if (tag) (this._rlTags ??= {})[actorId] = tag;
    }
    sfx(save ? "pick" : "back", this._redlineVolume());
    this._redlineMenuChanged(this._redlineMenuSay("plate"));
  },

  /* ---------------- Starting a race ---------------- */

  /**
   * Start a race: { quick: seed } or { trackId }; `again`: the same course (a Set Track keeps its grid roll; a
   * Quick Race races your best runs of it). A Set Track asks for the Drive Land Vehicle check first when the
   * GM wants it; Quick Races start mid-pack.
   */
  async _redlineStart({ quick, trackId, again = false }) {
    if (this._rlStarting || this._rlRunning) return;
    const cfg = cfgOf();
    if (cfg.paused) return ui.notifications.info("REDLINE: the GM has paused all races.");
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const spec = quick !== undefined ? quickSpec(quick) : (tracksAll().tracks ?? []).find(t => t.id === trackId && t.status === "live");
    if (!spec) return ui.notifications.warn("REDLINE: that track isn't open any more.");
    this._rlStarting = true;
    try {
      const track = trackOf(spec);
      const pack = quick !== undefined ? PACK.quick : PACK.set;
      // The grid: the roll for this track, kept for "Race again".
      let slot = null;
      let roll = null;
      if (cfg.drive === "grid" && trackId) {
        roll = again ? this._rlRolls?.[trackId] : undefined;
        if (roll === undefined) {
          roll = await this._redlineRoll(actor);
          if (roll === false) return;
          (this._rlRolls ??= {})[trackId] = roll;
        }
        slot = gridSlot(roll, pack + 1);
      }
      // Ghosts: a Quick Race rerun races your best runs of it; a Set Track the ones picked (up to three).
      const ghosts = quick !== undefined ? (again && this._rlLast?.quick === quick ? this._rlLast.ghosts ?? [] : []) : await this._redlineGhosts(trackId);
      // The split is against the fastest.
      const ref = ghosts.reduce((best, gh) => (!best || gh.time < best.time ? gh : best), null);
      this.redline = newRace(track, { cls: this.rlCls ?? "sport", slot, pack, ghosts, config: cfg, rand: null });
      this._rlFx = { messages: [], shake: 0, flash: 0, hits: {}, ref, tag: this._redlineTag(actor), muted: !game.settings.get(MODULE_ID, "redlineMusic") };
      // A roll shows on the track (the result and the slot) before the lights.
      if (slot !== null) this._rlFx.intro = { roll, slot, of: pack + 1, until: performance.now() + INTRO * 1000 };
      this._rlRace = { quick, trackId, roll, actorId: actor.id };
      this.rlResult = null;
      this._redlinePlaying(true);
      this._rlStartLoop = true;
      this._rlRunning = true;
      this.render();
    } finally {
      this._rlStarting = false;
    }
  },

  /**
   * Drive Land Vehicle with the character sheet's own roll (the system's dialog, mods and Luck; its card in
   * chat), waiting for Dice So Nice's dice to land if it's rolling them. Returns the total, null with no such
   * skill (mid-pack), or false if they cancelled.
   */
  async _redlineRoll(actor) {
    const skill = actor.items.find(i => i.type === "skill" && /^drive land vehicle$/i.test(i.name));
    if (!skill?.createRoll) {
      ui.notifications.info("REDLINE: no Drive Land Vehicle skill on the sheet, so you start mid-pack.");
      return null;
    }
    const roll = skill.createRoll("skill", actor);
    if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, skill))) return false;
    await roll.roll();
    if (Number.isInteger(roll.luck) && roll.luck > 0) {
      const luck = actor.system.stats.luck.value;
      await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
    }
    roll.entityData = { actor: actor.id, token: null };
    const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
    const message = await CPRChat.RenderRollCard(roll);
    if (game.dice3d?.waitFor3DAnimationByMessageID && message?.id) {
      await Promise.race([game.dice3d.waitFor3DAnimationByMessageID(message.id), new Promise(done => setTimeout(done, DICE_WAIT))]).catch(() => {});
    }
    // A beat to read the card.
    await new Promise(done => setTimeout(done, 500));
    return roll.resultTotal;
  },

  /** The picked ghosts for a track, fetched and decoded (any that fail are left out). */
  async _redlineGhosts(trackId) {
    const runs = topRuns(boardOf(trackId), 50);
    const actorId = this.context()?.subject?.actor?.id;
    const picked = (this.rlGhosts ?? []).map(key => runs.find(r => r.actorId === key && r.ghost)).filter(Boolean);
    const out = await Promise.all(picked.map(async r => {
      try {
        const response = await fetch(ghostUrl(trackId, r.actorId, r.ghost), { cache: "force-cache" });
        if (!response.ok) return null;
        const gh = decodeGhost(await response.json(), r.actorId === actorId ? "YOU" : r.tag);
        if (gh) gh.key = r.actorId;
        return gh;
      } catch {
        return null;
      }
    }));
    return out.filter(Boolean);
  },

  /** The plate tag the player goes by. */
  _redlineTag(actor) {
    const mine = Object.values(game.settings.get(MODULE_ID, "redlineBoard") ?? {}).flat().find(r => r.actorId === actor.id)?.tag;
    return this._rlTags?.[actor.id] ?? mine ?? defaultInitials(displayName(actor));
  },

  /* ---------------- The race loop ---------------- */

  _redlineLoop() {
    const g = this.redline;
    if (!g) return;
    const actorId = this._rlRace?.actorId ?? null;
    let last = performance.now();
    let report = 0;
    this._rlEngine ??= new RaceAudio();
    const volume = Number(game.settings.get(MODULE_ID, "volume") ?? 0.5);
    if (!this._rlPreview) {
      this._rlEngine.start(volume, g.cls);
      this._redlineGroove(true);
      this._redlineSay(`Race started: ${g.track.spec.name}. A and D steer, S brakes${CLASSES[g.cls].bike ? ", Q and E punch" : ""}, P pauses.`);
    }
    this._redlineScreen();
    const frame = now => {
      const canvas = this._rlCanvas;
      if (!canvas?.isConnected || !(this._rlRunning || this._rlPreview) || this.redline !== g) return this._redlineStop("quit");
      const dt = (now - last) / 1000;
      last = now;
      const gmPaused = cfgOf().paused && !this._rlPreview;
      if (!g.paused && (this._minimized || document.hidden || gmPaused)) this._redlinePause(gmPaused ? "gm" : true);
      if (g.paused === "gm" && !gmPaused) this._redlinePause();
      // The grid roll on show: the field waits on the line.
      const intro = this._rlFx.intro && now < this._rlFx.intro.until;
      if (this._rlFx.intro && !intro) delete this._rlFx.intro;
      if (!g.paused && intro) this._rlEngine.update(g, { throttle: false });
      else if (!g.paused) {
        const input = this._rlPreview ? autopilot(g) : this._redlineInput();
        this._rlFx.braking = !!input.brake;
        advance(g, dt, input);
        this._redlineEffects(g, dt, actorId);
        if (!this._rlPreview) {
          const pop = this._rlEngine.update(g, {
            throttle: !input.brake && g.t > 0 && g.p.wreck <= 0 && !g.finished, brake: !!input.brake,
            rain: g.track.spec.district === "pacifica", sand: inZone(g.track, trackPos(g.track, g.p.total), "sand")
          });
          if (pop) this._rlFx.backfire = 1;
          this._rlBeat?.set(Math.max(0, g.p.total) / (g.track.finish || 1));
        }
        g.events = [];
        if (now - report > 2500) {
          report = now;
          this._redlineScreen();
        }
      }
      this._rlFx.paused = g.paused || null;
      draw(canvas.getContext("2d"), g, this._rlFx);
      if (this._rlPreview && (g.finished || g.t > 600)) return this._redlineStop("quit");
      if (g.finished && g.t - g.time > FINISH_HOLD) return this._redlineStop("finish");
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  /** This frame's controls: held keys steer and brake; a punch once. */
  _redlineInput() {
    const held = this._rlHeld ?? new Set();
    const steer = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    const punch = this._rlPunch ?? 0;
    this._rlPunch = 0;
    return { steer, brake: held.has("brake"), punch };
  },

  /** The race's events as sounds, hit bursts, messages and screen-reader lines. */
  _redlineEffects(g, dt, actorId) {
    const fx = this._rlFx;
    fx.shake = Math.max(0, fx.shake - dt * 2.5);
    fx.flash = Math.max(0, fx.flash - dt * 2);
    fx.backfire = Math.max(0, (fx.backfire ?? 0) - dt * 7);
    const say = (text, color, secs = 1.4) => (fx.messages = [{ text, color, until: g.t + secs }]);
    const hit = (id, color, side = 0) => ((fx.hits ??= {})[id] = { until: g.t + 0.25, color, side });
    if (this._rlPreview) return;
    for (const e of g.events) {
      if (e.type === "light") blip("light");
      else if (e.type === "go") {
        blip("go", actorId);
        this._redlineSay("Go!");
      } else if (e.type === "lap") {
        const final = e.lap === g.track.spec.laps;
        blip("lap");
        const delta = deltaTo(g, fx.ref);
        say(`${final ? "FINAL LAP" : `LAP ${e.lap}`}  ${clock(e.time)}${delta === null ? "" : `  ${split(delta)}`}`, final ? "#f5d300" : "#00f0ff", 2.2);
        this._redlineSay(`${final ? "Final lap" : `Lap ${e.lap}`}. Last lap ${clock(e.time)}.`);
      } else if (e.type === "crash") {
        blip("crash", actorId);
        fx.shake = 1;
        fx.flash = 0.8;
        this._redlineSay(e.kind === "wall" ? "Into the wall: that bend wanted the brakes." : `Crashed into a ${e.kind}.`);
      } else if (e.type === "wreck") {
        blip("crash", actorId, "wreck");
        fx.shake = 1;
        fx.flash = 1;
        this._redlineSay(`Wrecked. Back in control in ${Math.round(PHYSICS.recover)} seconds.`);
      } else if (e.type === "respawn") {
        blip("lap");
        this._redlineSay("Back in control.");
      } else if (e.type === "scrape") blip("scrape");
      else if (e.type === "pothole" || e.type === "land") {
        blip("bump");
        fx.shake = Math.max(fx.shake, 0.35);
      } else if (e.type === "ram") {
        blip("ram", actorId);
        fx.shake = Math.max(fx.shake, e.hard ? 0.7 : 0.35);
        if (e.hard) hit("me", "#ffffff", e.side);
      } else if (e.type === "bump") {
        blip("bump");
        if (e.hard) fx.shake = Math.max(fx.shake, 0.5);
      } else if (e.type === "punch") {
        if (!e.hit) blip("whiff");
      } else if (e.type === "landed") {
        blip("punch", actorId, "hit");
        hit(e.id, "#f5d300", -e.side);
      } else if (e.type === "windup") {
        blip("warn");
        this._redlineSay(`Swing coming from the ${e.side < 0 ? "left" : "right"}.`);
      } else if (e.type === "dodged") blip("whoosh");
      else if (e.type === "punched") {
        blip("punch", actorId, "hurt");
        hit("me", "#ff2a3d", e.side);
        fx.shake = Math.max(fx.shake, 0.45);
        fx.flash = Math.max(fx.flash, 0.4);
        this._redlineSay(`${e.by ?? "A ganger"} hit you from the ${e.side < 0 ? "left" : "right"}.`);
      } else if (e.type === "wrecked" && e.by === "player") {
        blip("crash", actorId, "smash");
        say(e.name ? `WRECKED ${e.name.toUpperCase()}` : e.kind === "cop" ? "COP DOWN" : "WRECKED", "#ff8a1c");
        this._redlineSay(`You wrecked ${e.name ?? `a ${e.kind}`}.`);
      } else if (e.type === "heat") {
        blip("siren", actorId);
        say(`HEAT ${"★".repeat(e.heat)}`, "#ff2a3d");
        this._redlineSay(`Heat ${e.heat} of 5.${e.heat >= 2 ? " NCPD are on you." : ""}`);
      } else if (e.type === "siren") blip("siren", actorId);
      else if (e.type === "ramp") blip("ramp");
      else if (e.type === "finish") {
        blip("finish", actorId);
        this._redlineSay(`Finished ${ordinal(e.place)} in ${clock(e.time)}.`);
      }
    }
  },

  /** Pause or carry on. `why`: true (the player, or the phone went away) or "gm" (the GM paused all races). */
  _redlinePause(why = true) {
    const g = this.redline;
    if (!this._rlRunning || !g || g.finished) return;
    g.paused = g.paused ? false : why;
    this._rlHeld?.clear();
    this._redlineGroove(!g.paused);
    if (g.paused) this._rlEngine?.hush();
    // The pause's buttons (drive on, end the race): the player's own pause only.
    const box = this._rlCanvas?.parentElement?.querySelector("[data-rl-pausebox]");
    if (box) {
      box.hidden = g.paused !== true;
      if (!box.hidden) box.querySelector("button")?.focus();
      else if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();
    }
    this._redlineSay(g.paused ? (why === "gm" ? "The GM paused all races." : "Paused. P or Escape to drive on, X to end the race.") : "Racing.");
    this._redlineScreen();
  },

  async _redlineMusic() {
    const on = !game.settings.get(MODULE_ID, "redlineMusic");
    await game.settings.set(MODULE_ID, "redlineMusic", on);
    if (this._rlFx) this._rlFx.muted = !on;
    this._redlineGroove(on && this._rlRunning && !this.redline?.paused);
    this._redlineSay(on ? "Music on." : "Music off.");
  },

  _redlineGroove(on) {
    this._rlBeat ??= new NightDrive();
    if (on && game.settings.get(MODULE_ID, "redlineMusic")) {
      this._rlBeat.start(Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
    } else this._rlBeat.stop();
  },

  /**
   * The race ended: "finish" (crossed the line), or "quit" (quit, or left the page). A finished Set Track run
   * goes to the host; a Quick Race keeps its ghost for "Run it again". Then the lobby, with the results.
   */
  _redlineStop(how) {
    if (this._rlPreview) {
      this._rlPreview = false;
      this.redline = null;
      this.render();
      return;
    }
    if (!this._rlRunning) return;
    this._rlRunning = false;
    this._rlEngine?.stop();
    this._rlEngine = null;
    this._redlineGroove(false);
    this._rlHeld?.clear();
    const g = this.redline;
    const race = this._rlRace ?? {};
    const actorId = race.actorId;
    const done = how === "finish" && g?.finished;
    if (g && actorId) {
      const seen = seenMask(g.seen);
      const ghost = done ? encodeGhost(g) : null;
      const totalMs = done ? Math.round(g.time * 1000) : null;
      const lapsMs = done ? g.laps.map(l => Math.round(l * 1000)) : [];
      let rank = 0;
      if (race.trackId) {
        if (done) {
          rank = runRank(boardOf(race.trackId), actorId, totalMs);
          store.request("redline-result", { actorId, trackId: race.trackId, cls: g.cls, total: totalMs, laps: lapsMs, slot: g.config.drive === "grid" ? g.p.slot : null, tag: this._rlFx?.tag, ghost, seen }, { quiet: true });
        } else if (seen) store.request("redline-seen", { actorId, trackId: race.trackId, mask: seen }, { quiet: true });
      }
      // "Run it again": a Quick Race keeps your best three runs of it as ghosts.
      if (race.quick !== undefined) {
        const before = this._rlLast?.quick === race.quick ? this._rlLast.ghosts ?? [] : [];
        const runs = [...before, ...(done ? [decodeGhost(ghost)] : [])].filter(Boolean).sort((a, b) => a.time - b.time).slice(0, MAX_GHOSTS);
        runs.forEach((gh, i) => (gh.label = i ? `YOU ${i + 1}` : "YOUR BEST"));
        this._rlLast = { quick: race.quick, ghosts: runs };
      } else this._rlLast = { trackId: race.trackId };
      const best = bestLap(g);
      this._rlMenu = { ...(this._rlMenu ?? this._redlineMenuState()), screen: "result", resultAt: 0 };
      this.rlResult = {
        done, title: done ? (g.place === 1 ? "WINNER" : `${ordinal(g.place)} PLACE`) : "PULLED OVER", line: done ? finishLine(g) : "No time set.",
        time: done ? clock(g.time) : "", lap: best !== null && g.track.closed ? clock(best) : "", wrecks: g.wrecks, crashes: g.crashes,
        grid: g.config.drive === "grid" ? `P${g.p.slot + 1}${Number.isFinite(race.roll) ? ` (rolled ${race.roll})` : ""}` : "",
        delta: done && this._rlFx?.ref ? split(g.time - this._rlFx.ref.time) : "", deltaOn: this._rlFx?.ref?.label ?? "",
        rank: race.trackId && done && rank ? rank : 0,
        quick: race.quick !== undefined, nominated: false, name: g.track.spec.name
      };
      if (this._rlSession) {
        this._rlSession.races++;
        if (done && (!this._rlSession.best || g.time < this._rlSession.best)) this._rlSession.best = g.time;
      }
    }
    clearTimeout(this._rlIdle);
    this._rlIdle = setTimeout(() => this._redlinePlaying(false), IDLE_MS);
    this._redlineScreen();
    this.render();
  },

  /** A race started, paused or ended without the phone redrawing: the GM's Agent Monitor hears (ui/activity.js). */
  _redlineScreen() {
    Hooks.callAll(`${MODULE_ID}.screen`, this);
  },

  /** Screen readers: read out a line. */
  _redlineSay(text) {
    const el = this._rlCanvas?.parentElement?.querySelector("[data-redline-say]");
    if (el) el.textContent = text;
  },

  /**
   * Note that someone started playing (their first race since they last stopped) or stopped (left the app or
   * the phone, or idled). The host does nothing with it; the GM's Agent Monitor logs it (ui/activity.js).
   */
  _redlinePlaying(on) {
    clearTimeout(this._rlIdle);
    if (on) {
      const actorId = this.context()?.subject?.actor?.id;
      if (!actorId || this._rlSession) return;
      this._rlSession = { actorId, races: 0, best: null };
      return store.request("redline-play", { actorId, playing: true }, { quiet: true });
    }
    if (this._rlRunning) this._redlineStop("quit");
    if (this._rlPreview) this._redlineStop("quit");
    const session = this._rlSession;
    if (!session) return;
    this._rlSession = null;
    store.request("redline-play", { actorId: session.actorId, playing: false, races: session.races, best: session.best ? clock(session.best) : null }, { quiet: true });
  }
};

export const phone = {
  render(html) {
    if (this.app === "redline") this._redlineAttach(html);
    else if (this._rlSession || this._rlPreview) this._redlinePlaying(false); // left the game
  },
  close() {
    if (this._rlSession || this._rlPreview) this._redlinePlaying(false);
  },
  /** A run in progress (its canvas would be lost). */
  busy() {
    return !!(this._rlRunning || this._rlPreview);
  }
};

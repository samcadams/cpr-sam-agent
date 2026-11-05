import { gm } from "../../scripts/host/validate.js";
import { dataFolder, MODULE_ID } from "../../scripts/config.js";
import { addRun, buildTrack, CLASSES, decodeGhost, DISTRICTS, GHOST_DIR, ghostFile, plausible, SECTIONS, topRuns, trackName, trackSpec } from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { BLIPS } from "../../scripts/util/audio.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: REDLINE (see apps/redline/model.js). Players send a finished Set Track run (times, laps, grid slot,
 * plate tag and the ghost); the host checks the sender owns the character, the track is live and the times
 * are believable, keeps each character's best on the board (the world setting "redlineBoard") and writes
 * that run's ghost as a file (cpr-sam-agent/redline/<track>-<actor>.json, read by anyone who races against
 * it). What a character has driven of each track (fog of war) goes in the app table redlineSeen. Players
 * nominate Quick Race courses for the GM's track builder (the world setting "redlineTracks"). The GM wipes
 * boards and removes runs. Crashes, rams and punches are also heard, quietly, around the player's token.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "redline-result": "_onRedlineResult",
  "redline-seen": "_onRedlineSeen",
  "redline-nominate": "_onRedlineNominate",
  "redline-sound": "_onRedlineSound",
  "redline-wipe": gm("_onRedlineWipe"),
  "redline-remove": gm("_onRedlineRemove")
};

/** The sounds a race may play in the world (the rest stay on the phone). */
const WORLD_SOUNDS = new Set(["crash", "ram", "punch", "siren", "go", "finish"]);
/** Nominations kept for the GM, newest first. */
const MAX_NOMINATED = 20;
/** The longest ghost accepted (samples: an hour at 10 a second). */
const MAX_SAMPLES = 36000;

const boardAll = () => game.settings.get(MODULE_ID, "redlineBoard") ?? {};
const tracksAll = () => game.settings.get(MODULE_ID, "redlineTracks") ?? {};

/** A track by id, built (cached by its seed record). */
const built = new Map();
function trackById(id) {
  const spec = (tracksAll().tracks ?? []).find(t => t.id === id);
  if (!spec) return null;
  const key = JSON.stringify(spec);
  if (!built.has(key)) built.set(key, buildTrack(spec));
  return built.get(key);
}

export const methods = {
  /** Once the host has its data: make sure the ghosts' folder is there. */
  async _redlineLoad() {
    const picker = FilePicker.implementation ?? FilePicker;
    const root = dataFolder();
    const dirs = (await picker.browse("data", root).catch(() => null))?.dirs ?? [];
    if (!dirs.some(dir => decodeURIComponent(dir).replace(/\/$/, "").endsWith(`/${GHOST_DIR}`))) {
      await picker.createDirectory("data", `${root}/${GHOST_DIR}`).catch(err => console.error(`${MODULE_ID} | Could not create ${root}/${GHOST_DIR}`, err));
    }
  },

  /** A game sound around the player's token, as NCART Runner's (apps/ncart/host.js). */
  _onRedlineSound(user, { actorId, kind }) {
    const actor = game.actors.get(actorId);
    if (!actor || !WORLD_SOUNDS.has(kind) || !Object.hasOwn(BLIPS, `rl-${kind}`) || !actor.testUserPermission(user, "OWNER")) return;
    const radius = Math.max(3, game.settings.get(MODULE_ID, "ringRadius") * 0.4);
    this._worldSound({ actorId }, null, { loop: false, blip: `rl-${kind}`, radius, volume: 1 / 3 });
  },

  /**
   * A finished Set Track run: { actorId, trackId, cls, total (ms), laps (ms each), slot, tag, ghost, seen }.
   * Only a character's best time changes the board (and their ghost); their best lap is kept from any run.
   */
  async _onRedlineResult(user, data) {
    const { actorId, trackId } = data;
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER")) return;
    const track = trackById(trackId);
    if (!track || track.spec.status !== "live") return;
    this._redlineSee(actorId, trackId, data.seen);
    const total = Math.round(Number(data.total));
    const laps = Array.isArray(data.laps) ? data.laps.map(l => Math.round(Number(l))) : [];
    const ghost = decodeGhost(data.ghost);
    const samples = ghost?.samples.length ?? 0;
    if (!Object.hasOwn(CLASSES, data.cls) || samples > MAX_SAMPLES || !plausible(track, { total, laps, samples })) return;
    const runs = boardAll()[trackId] ?? [];
    const old = runs.find(r => r.actorId === actorId);
    const now = Date.now();
    const lap = track.closed ? Math.min(...laps) : null;
    const best = !old || total < old.total;
    const entry = {
      id: foundry.utils.randomID(), actorId, who: displayName(actor), tag: clean(String(data.tag ?? ""), 8).toUpperCase() || "???",
      cls: data.cls, total, lap, slot: Number.isInteger(data.slot) ? data.slot : null, ts: now, ghost: best && ghost ? now : old?.ghost ?? null
    };
    const next = addRun(runs, entry);
    // Nothing better: the board stays as it is.
    if (!best && old && !(lap !== null && (old.lap === null || lap < old.lap))) return;
    if (best && ghost) {
      try {
        await this._upload(ghostFile(trackId, actorId), JSON.stringify(data.ghost));
      } catch (err) {
        console.error(`${MODULE_ID} | Could not save a REDLINE ghost`, err);
        entry.ghost = old?.ghost ?? null;
      }
    }
    await game.settings.set(MODULE_ID, "redlineBoard", { ...boardAll(), [trackId]: next });
    this._lostTop(topRuns(runs, 1)[0], topRuns(next, 1)[0], { from: "REDLINE", app: "redline", where: track.spec.name ?? trackName(track.spec.seed) });
  },

  /** What a character has driven of a track (a run they didn't finish, too). */
  _onRedlineSeen(user, { actorId, trackId, mask }) {
    const actor = game.actors.get(actorId);
    if (!actor || !actor.testUserPermission(user, "OWNER") || !trackById(trackId)) return;
    this._redlineSee(actorId, trackId, mask);
  },

  _redlineSee(actorId, trackId, mask) {
    const bits = (Number(mask) || 0) & ((1 << SECTIONS) - 1);
    if (!bits) return;
    const table = (this.apps.redlineSeen ??= {});
    const row = table[actorId] ?? {};
    const merged = (row[trackId] ?? 0) | bits;
    if (merged === row[trackId]) return;
    table[actorId] = { ...row, [trackId]: merged };
    this._pushApps();
  },

  /** A player liked a Quick Race course: it waits in the GM's track builder. */
  async _onRedlineNominate(user, { actorId, seed, district, length, difficulty }) {
    const actor = game.actors.get(actorId);
    if (!actor || !actor.testUserPermission(user, "OWNER") || !Object.hasOwn(DISTRICTS, district)) return;
    const spec = trackSpec({ district, kind: "sprint", length, difficulty, seed });
    const all = tracksAll();
    const nominated = all.nominated ?? [];
    if (nominated.some(n => n.seed === spec.seed) || (all.tracks ?? []).some(t => t.seed === spec.seed)) return;
    const entry = { id: foundry.utils.randomID(), seed: spec.seed, district: spec.district, length: spec.length, difficulty: spec.difficulty, by: displayName(actor), name: trackName(spec.seed), ts: Date.now() };
    await game.settings.set(MODULE_ID, "redlineTracks", { ...all, nominated: [entry, ...nominated].slice(0, MAX_NOMINATED) });
    this._gmCard({ id: `redline-nom:${spec.seed}`, title: `REDLINE: ${entry.name} nominated`, body: `${entry.by} liked this Quick Race course. It waits in the track builder.`, icon: "fa-flag-checkered", open: { app: "redline" } });
  },

  /** Wipe a track's board (its ghost files are emptied: the host can't delete files). */
  async _onRedlineWipe(user, { trackId }) {
    const all = boardAll();
    for (const run of all[trackId] ?? []) await this._redlineDropGhost(trackId, run.actorId);
    await game.settings.set(MODULE_ID, "redlineBoard", Object.fromEntries(Object.entries(all).filter(([id]) => id !== trackId)));
  },

  /** Remove one character's run (and ghost) from a track's board. */
  async _onRedlineRemove(user, { trackId, actorId }) {
    const all = boardAll();
    if (!all[trackId]) return;
    await this._redlineDropGhost(trackId, actorId);
    await game.settings.set(MODULE_ID, "redlineBoard", { ...all, [trackId]: all[trackId].filter(r => r.actorId !== actorId) });
  },

  async _redlineDropGhost(trackId, actorId) {
    try {
      await this._upload(ghostFile(trackId, actorId), "{}");
    } catch (err) {
      console.error(`${MODULE_ID} | Could not empty a REDLINE ghost`, err);
    }
  }
};

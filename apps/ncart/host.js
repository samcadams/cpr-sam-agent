import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { addScore, plausible, randomEntries } from "./model.js";
import { defaultInitials, validInitials } from "../pigeon/model.js";
import { displayName } from "../../scripts/model/threads.js";
import { BLIPS } from "../../scripts/util/audio.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: NCART Runner's leaderboard (see apps/ncart/model.js), the world setting "ncartBoard". Players send
 * their shards, distance and initials at the end of a run; the host checks the sender owns the character
 * and the numbers are believable, and each character keeps their best. The GM adds made-up names,
 * removes entries or clears the board. A run's jumps, shards, power-ups, horns, gunfire and crash are also heard,
 * quietly, around the player's token. (Starting and stopping play shows in the GM's Agent Monitor,
 * ui/activity.js.) Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "ncart-score": "_onNcartScore",
  "ncart-sound": "_onNcartSound",
  "ncart-fake": gm("_onNcartFake"),
  "ncart-fill": gm("_onNcartFill"),
  "ncart-remove": gm("_onNcartRemove"),
  "ncart-reset": gm("_onNcartReset")
};

/** The sounds a run may play in the world (the rest stay on the phone). */
const WORLD_SOUNDS = new Set(["shard", "jump", "power", "horn", "pass", "gun", "hit", "speedup", "shield"]);

const board = () => game.settings.get(MODULE_ID, "ncartBoard")?.scores ?? [];
const save = scores => game.settings.set(MODULE_ID, "ncartBoard", { scores });
const entry = data => ({ id: foundry.utils.randomID(), ts: Date.now(), ...data });

export const methods = {
  /** A game sound around the player's token, as Flappy Chrome's (apps/pigeon/host.js). */
  _onNcartSound(user, { actorId, kind }) {
    const actor = game.actors.get(actorId);
    if (!actor || !WORLD_SOUNDS.has(kind) || !Object.hasOwn(BLIPS, kind) || !actor.testUserPermission(user, "OWNER")) return;
    const radius = Math.max(3, game.settings.get(MODULE_ID, "ringRadius") * 0.4);
    this._worldSound({ actorId }, null, { loop: false, blip: kind, radius, volume: 1 / 3 });
  },

  async _onNcartScore(user, { actorId, shards, dist, initials }) {
    const actor = game.actors.get(actorId);
    shards = Math.floor(Number(shards));
    dist = Math.floor(Number(dist));
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !(shards > 0) || !plausible(shards, dist)) return;
    const before = board();
    const who = displayName(actor);
    const was = before.find(s => s.actorId === actorId)?.name;
    const name = validInitials(initials) ? initials : validInitials(was) ? was : defaultInitials(who);
    const made = entry({ name, who, actorId, shards, dist });
    const next = addScore(before, made);
    // Not their best: nothing changes.
    if (next.includes(made)) {
      await save(next);
      this._lostTop(before[0], next[0], { from: "NCART Runner", app: "ncart" });
    }
  },

  async _onNcartFake(user, { name, shards, dist }) {
    name = clean(name, 24);
    shards = Math.floor(Number(shards));
    dist = Math.floor(Number(dist));
    if (!name || !(shards >= 0) || !(dist >= 0) || !plausible(0, dist) || shards > 99999) return;
    await save(addScore(board(), entry({ name, shards, dist, fake: true })));
  },

  async _onNcartFill(user, { count }) {
    let scores = board();
    for (const e of randomEntries(Math.min(10, Math.max(1, Math.floor(Number(count) || 5))), Math.random, scores.map(s => s.name))) {
      scores = addScore(scores, entry({ ...e, fake: true }));
    }
    await save(scores);
  },

  async _onNcartRemove(user, { id }) {
    await save(board().filter(s => s.id !== id));
  },

  async _onNcartReset() {
    await save([]);
  }
};

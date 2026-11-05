import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { addScore, defaultInitials, heatOf, MAX_SCORE, raiseHeat, randomEntries, setHeat, validInitials } from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { BLIPS } from "../../scripts/util/audio.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: Flappy Chrome's leaderboard (see apps/pigeon/model.js), the world setting "pigeonBoard". Players
 * send their score and initials at the end of a run; each character keeps their best. The GM adds made-up names,
 * removes entries or clears the board. A run also raises the character's Maelstrom Heat ("pigeonHeat"), which only
 * the GM lowers (one step, or everyone's at once, or along with the board). A run's flaps, points and crash are also heard, quietly, around the
 * player's token. (Starting and stopping play shows in the GM's Agent Monitor, ui/activity.js.)
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "pigeon-score": "_onPigeonScore",
  "pigeon-sound": "_onPigeonSound",
  "pigeon-fake": gm("_onPigeonFake"),
  "pigeon-fill": gm("_onPigeonFill"),
  "pigeon-remove": gm("_onPigeonRemove"),
  "pigeon-reset": gm("_onPigeonReset"),
  "pigeon-heat": gm("_onPigeonHeat")
};

const board = () => game.settings.get(MODULE_ID, "pigeonBoard")?.scores ?? [];
const save = scores => game.settings.set(MODULE_ID, "pigeonBoard", { scores });
const heat = () => game.settings.get(MODULE_ID, "pigeonHeat") ?? {};
const saveHeat = value => game.settings.set(MODULE_ID, "pigeonHeat", value);
const entry = (data) => ({ id: foundry.utils.randomID(), ts: Date.now(), ...data });

export const methods = {
  /**
   * A game sound (a BLIPS key) around the player's token: a small radius (0.4× the ring radius, at least
   * 3 units), at a third of the in-world volume. Silenced and internal Agents stay quiet (_worldSound).
   */
  _onPigeonSound(user, { actorId, kind }) {
    const actor = game.actors.get(actorId);
    if (!actor || !Object.hasOwn(BLIPS, kind) || !actor.testUserPermission(user, "OWNER")) return;
    const radius = Math.max(3, game.settings.get(MODULE_ID, "ringRadius") * 0.4);
    this._worldSound({ actorId }, null, { loop: false, blip: kind, radius, volume: 1 / 3 });
  },

  async _onPigeonScore(user, { actorId, score, initials }) {
    const actor = game.actors.get(actorId);
    score = Math.floor(Number(score));
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !(score > 0 && score <= MAX_SCORE)) return;
    const hotter = raiseHeat(heat(), actorId, score);
    if (hotter) await saveHeat(hotter);
    const before = board();
    const who = displayName(actor);
    // No good initials sent (an older phone): the ones they went by, or ones from the name.
    const was = before.find(s => s.actorId === actorId)?.name;
    const name = validInitials(initials) ? initials : validInitials(was) ? was : defaultInitials(who);
    const next = addScore(before, entry({ name, who, actorId, score }));
    // Not their best: nothing changes.
    if (next.some(s => s.actorId === actorId && s.score === score && !before.some(b => b.id === s.id))) {
      await save(next);
      this._lostTop(before[0], next[0], { from: "Flappy Chrome", app: "pigeon" });
    }
  },

  async _onPigeonFake(user, { name, score }) {
    name = clean(name, 24);
    score = Math.floor(Number(score));
    if (!name || !(score >= 0 && score <= MAX_SCORE)) return;
    await save(addScore(board(), entry({ name, score, fake: true })));
  },

  async _onPigeonFill(user, { count }) {
    let scores = board();
    for (const e of randomEntries(Math.min(10, Math.max(1, Math.floor(Number(count) || 5))), Math.random, scores.map(s => s.name))) {
      scores = addScore(scores, entry({ ...e, fake: true }));
    }
    await save(scores);
  },

  async _onPigeonRemove(user, { id }) {
    await save(board().filter(s => s.id !== id));
  },

  /** `heat`: clear everyone's Heat too. */
  async _onPigeonReset(user, { heat: alsoHeat } = {}) {
    await save([]);
    if (alsoHeat) await saveHeat({});
  },

  /** A character's Heat up or down a step (`by`), or everyone's back to 0 (no actorId). */
  async _onPigeonHeat(user, { actorId, by }) {
    if (!actorId) return saveHeat({});
    if (!game.actors.get(actorId)) return;
    const now = heat();
    await saveHeat(setHeat(now, actorId, heatOf(now, actorId) + Math.sign(Number(by) || 0)));
  }
};

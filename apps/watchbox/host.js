import { gm } from "../../scripts/host/validate.js";
import { agentType } from "../../scripts/model/agent.js";
import { phoneSound } from "../../scripts/model/sounds.js";
import { displayName } from "../../scripts/model/threads.js";
import { ASSESS_SECONDS, inSquare, squarePixels, tokenCenter } from "./model.js";
import { MODULE_ID } from "../../scripts/config.js";

/*
 * Host: WatchBox (see apps/watchbox/model.js). Arming leaves the Agent in the middle of a 20 × 20 m square
 * (drawn as a hidden template the GM can move or resize) and assesses the room for 5 minutes of
 * world time. Once it's armed, the GM decides when someone sets it off (Trigger). The alarm sounds
 * at the Agent's spot, for whoever is close enough to hear it: WatchBox doesn't notify anyone remotely.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "wb-arm": "_onWatchArm",
  "wb-disarm": "_onWatchDisarm",
  "wb-skip": gm("_onWatchSkip"),
  "wb-trigger": gm("_onWatchTrigger"),
  "wb-silence": gm("_onWatchSilence")
};

/** The actor's token on a scene: the active scene first. */
function placedToken(actor) {
  const scenes = [game.scenes.active, ...game.scenes].filter(Boolean);
  for (const scene of scenes) {
    const token = scene.tokens.find(t => t.actorId === actor.id);
    if (token) return { scene, token };
  }
  return null;
}

export const methods = {
  async _onWatchArm(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || this.apps.watch[actorId]) return;
    if (agentType(actor) === "internal") return this._alertNow(actorId, { kind: "warning", app: "watchbox", text: "WatchBox doesn't work on an Internal Agent." });
    if (!this._citinet(actor, "watchbox")) return;
    const placed = placedToken(actor);
    if (!placed) return this._alertNow(actorId, { kind: "warning", app: "watchbox", text: "Put your Agent down somewhere first: your token needs to be on a scene." });
    const { scene, token } = placed;
    const center = tokenCenter(token, scene);
    const size = squarePixels(scene);
    const watch = {
      status: "assessing", sceneId: scene.id, x: center.x, y: center.y, size,
      assessUntil: game.time.worldTime + ASSESS_SECONDS, assessAt: Date.now() + ASSESS_SECONDS * 1000, templateId: null, soundId: null
    };
    // The square, for the GM to see (and move or resize): hidden from players.
    try {
      const side = (size / scene.grid.size) * (Number(scene.grid.distance) || 1);
      const [template] = await scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: "rect", x: center.x - size / 2, y: center.y - size / 2, distance: side * Math.SQRT2, direction: 45,
        hidden: true, fillColor: "#ffcc00", borderColor: "#ffcc00", flags: { [MODULE_ID]: { watchbox: actorId } }
      }]);
      watch.templateId = template?.id ?? null;
    } catch (err) {
      console.warn(`${MODULE_ID} | WatchBox: couldn't draw the square`, err);
    }
    this.apps.watch[actorId] = watch;
    this._gmCard({ title: `WatchBox: ${displayName(actor)}`, body: `Armed on ${scene.name}. Assessing for 5 minutes.`, icon: "fa-eye", actions: [{ label: "Skip", icon: "fa-forward", request: "wb-skip", data: { actorId } }] });
    this._pushApps();
  },

  /** The square as it is now: from its template if the GM moved or resized it. */
  _watchSquare(watch) {
    const scene = game.scenes.get(watch.sceneId);
    const template = scene?.templates.get(watch.templateId);
    if (template && template.t === "rect") {
      const side = (template.distance / Math.SQRT2 / (Number(scene.grid.distance) || 1)) * scene.grid.size;
      return { ...watch, x: template.x + side / 2, y: template.y + side / 2, size: side };
    }
    return watch;
  },

  _onWatchDisarm(user, { actorId }) {
    const watch = this.apps.watch[actorId];
    const actor = game.actors.get(actorId);
    if (!watch || !actor || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) return;
    if (!user.isGM) {
      const scene = game.scenes.get(watch.sceneId);
      const square = this._watchSquare(watch);
      const near = scene?.tokens.some(t => t.actorId === actorId && inSquare(square, tokenCenter(t, scene)));
      if (!near) return this._alertNow(actorId, { kind: "warning", app: "watchbox", text: "Your Agent is back in the room. Go get it to disarm WatchBox." });
    }
    this._endWatch(actorId);
    this._pushApps();
  },

  _endWatch(actorId) {
    const watch = this.apps.watch[actorId];
    if (!watch) return;
    if (watch.soundId) this._stopWorldSound(watch.soundId);
    const scene = game.scenes.get(watch.sceneId);
    if (watch.templateId && scene?.templates.get(watch.templateId)) scene.deleteEmbeddedDocuments("MeasuredTemplate", [watch.templateId]).catch(() => null);
    delete this.apps.watch[actorId];
  },

  _onWatchSkip(user, { actorId }) {
    const watch = this.apps.watch[actorId];
    if (watch?.status !== "assessing") return;
    this._armWatch(actorId, watch);
    this._pushApps();
  },

  _armWatch(actorId, watch) {
    watch.status = "armed";
  },

  /** Assessments that are done arm: after 5 real minutes, or 5 minutes of world time, whichever comes first. */
  _tickWatch() {
    let changed = false;
    for (const [actorId, watch] of Object.entries(this.apps.watch)) {
      const done = game.time.worldTime >= watch.assessUntil || Date.now() >= (watch.assessAt ?? Infinity);
      if (watch.status === "assessing" && done) {
        this._armWatch(actorId, watch);
        changed = true;
      }
    }
    if (changed) this._pushApps();
  },

  /** GM: someone set it off; the alarm goes off. */
  _onWatchTrigger(user, { actorId }) {
    const watch = this.apps.watch[actorId];
    if (!watch || watch.status === "assessing") return;
    if (watch.status !== "alarm") {
      watch.status = "alarm";
      const square = this._watchSquare(watch);
      const sound = phoneSound(game.actors.get(actorId), "alarm");
      watch.soundId = this._worldSoundAt({ sceneId: watch.sceneId, x: square.x, y: square.y }, sound, { loop: true, radius: Math.max(30, game.settings.get(MODULE_ID, "ringRadius") * 3) });
    }
    this._pushApps();
  },

  /** GM: stop the alarm; WatchBox keeps watching. */
  _onWatchSilence(user, { actorId }) {
    const watch = this.apps.watch[actorId];
    if (watch?.status !== "alarm") return;
    if (watch.soundId) this._stopWorldSound(watch.soundId);
    watch.soundId = null;
    watch.status = "armed";
    this._pushApps();
  }
};


import { appPartial } from "../../scripts/apps/manifest.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { inSquare, tokenCenter } from "./model.js";
import { store } from "../../scripts/store.js";
import { formatDuration } from "../../scripts/util/text.js";

/*
 * Phone page: WatchBox (see apps/watchbox/model.js). Armed, it takes over the whole phone: the Agent is
 * sitting in a room somewhere, so every other app waits until it's disarmed. The alarm only shows
 * to an owner standing in the room: WatchBox has no remote notification. The GM Phone lists every
 * armed WatchBox, with Trigger (noise, light), Silence and Disarm.
 * Methods and click actions (data-action) are installed onto AgentPhone.
 */

export const actions = {
  "wb-arm"() {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    Dialog.confirm({
      title: "WatchBox",
      content: "<p>Leave your Agent here and arm WatchBox?</p><p class=\"notes\">It watches a 20 × 20 m square around you. You can't use your phone until you come back and disarm it.</p>",
      yes: () => store.request("wb-arm", { actorId: actor.id })
    });
  },
  "wb-disarm"({ actorId }) {
    store.request("wb-disarm", { actorId: actorId || this.context()?.actorId });
  },
  "wb-skip"({ actorId }) {
    store.request("wb-skip", { actorId });
  },
  "wb-trigger"({ actorId }) {
    store.request("wb-trigger", { actorId });
  },
  "wb-silence"({ actorId }) {
    store.request("wb-silence", { actorId });
  }
};

export const methods = {
  /** A character's WatchBox, if it's armed (the phone is then the WatchBox screen). */
  watching(ctx) {
    return ctx?.perspective === "pc" ? store.apps.watch[ctx.actorId] ?? null : null;
  },

  /** Is the character's token in the watched square (so they'd hear an alarm)? */
  _ownerNear(actorId, watch) {
    const scene = game.scenes.get(watch.sceneId);
    return !!scene?.tokens.some(t => t.actorId === actorId && inSquare(watch, tokenCenter(t, scene)));
  },

  watchboxData(ctx) {
    if (ctx.perspective === "gm") {
      return {
        gm: true,
        bar: appBar("watchbox"),
        watches: Object.entries(store.apps.watch).map(([actorId, w]) => ({
          actorId,
          name: displayName(game.actors.get(actorId)),
          scene: game.scenes.get(w.sceneId)?.name ?? "?",
          status: w.status,
          assessing: w.status === "assessing",
          alarm: w.status === "alarm"
        })),
        characters: playerCharacters().filter(a => !store.apps.watch[a.id]).length
      };
    }
    const watch = this.watching(ctx);
    const internal = ctx.internal;
    if (!watch) return { bar: appBar("watchbox", { owner: ctx.subject.name }), internal };
    // Whichever ends first: 5 real minutes (ticking on screen) or 5 minutes of world time.
    const worldLeft = Math.max(0, watch.assessUntil - game.time.worldTime) * 1000;
    const realLeft = Math.max(0, (watch.assessAt ?? Infinity) - Date.now());
    const near = this._ownerNear(ctx.actorId, watch);
    return {
      armed: true,
      assessing: watch.status === "assessing",
      countdown: formatDuration(Math.min(worldLeft, realLeft)),
      endsAt: realLeft <= worldLeft ? watch.assessAt : null,
      alarm: watch.status === "alarm" && near,
      near
    };
  }
};

/** An armed WatchBox is the whole phone (it's sitting in a room somewhere). */
export const phone = {
  takeover(ctx, data) {
    this._watching = !!this.watching(ctx);
    if (!this._watching) return false;
    data.watchbox = this.watchboxData(ctx);
    data.page.watchbox = true;
    data.appPartial = appPartial("watchbox");
    return true;
  },
  /** Armed or disarmed: the whole phone changes, whichever app it's on. */
  affected(change, ctx) {
    return this._watching !== !!this.watching(ctx);
  }
};

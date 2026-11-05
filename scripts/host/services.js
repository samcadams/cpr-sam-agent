import { cleanImage, cleanLocation, gm, textParts } from "./validate.js";
import { canUsePhone } from "../model/agent.js";
import { getService, serviceAvailable } from "../model/services.js";
import { isService } from "../model/threads.js";

/*
 * Host: service contacts (button presses, free text, the GM's replies).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "service-action": "_onServiceAction",
  "service-send": "_onServiceSend",
  "service-reply": gm("_onServiceReply")
};

export const methods = {
  /** A player may use a service: owns the PC, has an Agent, and the service is offered to them. */
  _playerService(user, actorId, serviceId) {
    const actor = game.actors.get(actorId);
    const service = getService(serviceId);
    if (!actor || !service || user.isGM) return null;
    if (!actor.testUserPermission(user, "OWNER") || !canUsePhone(actor) || !serviceAvailable(service, actor.id)) return null;
    return { actor, service };
  },

  _serviceThread(actor, service) {
    let thread = this.findServiceThread(actor.id, service.id);
    if (!thread) {
      thread = {
        id: foundry.utils.randomID(),
        type: "service",
        serviceId: service.id,
        actorId: actor.id,
        messages: [],
        lastRead: { owner: 0, gm: 0 }
      };
      this.threads.set(thread.id, thread);
    }
    thread.name = service.name;
    thread.img = service.img;
    return thread;
  },

  _onServiceAction(user, { actorId, serviceId, actionId }) {
    const { actor, service } = this._playerService(user, actorId, serviceId) ?? {};
    const action = service?.actions.find(a => a.id === actionId);
    if (!action) return;

    const thread = this._serviceThread(actor, service);
    const message = this._message("pc", action.label, { userId: user.id, action: true });
    thread.messages.push(message);
    thread.lastRead.owner = message.ts;
    this.save();
    this._push(thread, true);
  },

  /** A player typing to a text-conversation service. */
  _onServiceSend(user, { actorId, serviceId, text, location, image }) {
    const { actor, service } = this._playerService(user, actorId, serviceId) ?? {};
    const parts = textParts(text);
    location = cleanLocation(location);
    image = cleanImage(image, user);
    if (!service?.chat || (!parts[0] && !location && !image)) return;
    const thread = this._serviceThread(actor, service);
    thread.messages.push(...this._textMessages("pc", parts, { userId: user.id, location, image }));
    thread.lastRead.owner = thread.messages.at(-1).ts;
    this.save();
    this._push(thread, true);
  },

  _onServiceReply(user, { threadId, actorId, serviceId, text, location, image, job }) {
    let thread = threadId ? this.threads.get(threadId) : null;
    if (!thread) {
      // The GM can write first, e.g. an "Agent AI" pinging the player.
      const actor = game.actors.get(actorId);
      const service = getService(serviceId);
      if (actor && service) thread = this._serviceThread(actor, service);
    }
    const parts = textParts(text);
    location = cleanLocation(location);
    image = cleanImage(image, user);
    job = this._jobOffer(user, job);
    if (!isService(thread) || (!parts[0] && !location && !image && !job)) return;
    thread.messages.push(...this._textMessages("service", parts, { userId: user.id, location, image, job }));
    thread.lastRead.gm = thread.messages.at(-1).ts;
    this.save();
    this._push(thread, true);
    this._ding({ actorId: thread.actorId });
  }
};

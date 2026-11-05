import { gm, MAX_NAME } from "./validate.js";
import { DEFAULT_CONTACT_IMG } from "../config.js";
import { canUsePhone } from "../model/agent.js";
import { commsOn } from "../model/features.js";
import { findContact, getContacts, setContacts } from "../model/contacts.js";
import { actorAvatar, displayName, knownNpcs, npcKey } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: players asking the GM for a number.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "contact-request": "_onContactRequest",
  "request-resolve": gm("_onRequestResolve")
};

export const methods = {
  _pushRequests(notice = null) {
    const relevant = user => {
      if (!notice) return false;
      if (notice.kind === "new") return user.isGM;
      return !user.isGM && !!game.actors.get(notice.request.actorId)?.testUserPermission(user, "OWNER");
    };
    for (const user of game.users) {
      if (!user.active || user === game.user) continue;
      this._send([user.id], {
        type: "requests",
        requests: this.visibleRequests(user),
        notice: relevant(user) ? notice : null
      });
    }
    this._applyRequests([...this.requests.values()], relevant(game.user) ? notice : null);
  },

  _onContactRequest(user, { actorId, name, note }) {
    const actor = game.actors.get(actorId);
    name = clean(name, MAX_NAME);
    if (user.isGM || !name || !actor?.testUserPermission(user, "OWNER") || !canUsePhone(actor)) return;
    if (findContact(getContacts(actor), name)) return;
    const lower = name.toLowerCase();
    if ([...this.requests.values()].some(r => r.actorId === actor.id && r.name.toLowerCase() === lower)) return;

    const request = { id: foundry.utils.randomID(), actorId: actor.id, name, note: clean(note, 300), userId: user.id, ts: Date.now() };
    this.requests.set(request.id, request);
    this.save();
    this._pushRequests({ kind: "new", request });
    if (commsOn()) this._gmCard({ id: `contact:${request.id}`, title: "Contact request", body: `${displayName(actor)} wants ${name}'s number`, icon: "fa-user-plus", open: { app: "contacts" } });
  },

  async _onRequestResolve(user, { requestId, approve, name, linkActorId }) {
    const request = this.requests.get(requestId);
    if (!request) return;
    this.requests.delete(request.id);

    const actor = game.actors.get(request.actorId);
    if (approve && actor) {
      // The GM can point the request at an existing sheet (e.g. the player misspelled the name).
      const link = linkActorId ? game.actors.get(linkActorId) : null;
      request.name = link ? displayName(link) : clean(name, MAX_NAME) || request.name;
      const contacts = getContacts(actor);
      if (!findContact(contacts, request.name)) {
        const entry = link
          ? { name: request.name, img: actorAvatar(link), actorId: link.id }
          : { name: request.name, img: knownNpcs().find(m => m.key === npcKey(request.name))?.img ?? DEFAULT_CONTACT_IMG };
        await setContacts(actor, [...contacts, entry]);
      }
    }
    this.save();
    this._gmCardDone(`contact:${request.id}`);
    this._pushRequests({ kind: approve ? "approved" : "denied", request });
    if (actor && commsOn()) {
      this._alertNow(actor.id, approve
        ? { kind: "contact", from: "Contact added", text: `${request.name} is now in your contacts.` }
        : { kind: "contact", from: "Request denied", text: `Couldn't get ${request.name}'s number.` });
    }
  }
};

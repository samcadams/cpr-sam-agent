import { approveRequestDialog, contactRequestDialog } from "../../dialogs/forms.js";
import { ContactsManager } from "../../managers/ContactsManager.js";
import { ServicesManager } from "../../managers/ServicesManager.js";
import { appearance } from "../../../model/appearance.js";
import { getAlias, getContacts, getNote, noteKey, playerCharacters } from "../../../model/contacts.js";
import { servicesFor } from "../../../model/services.js";
import { actorAvatar, displayName, pictureOf } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { initials, similarity } from "../../../util/text.js";

/*
 * Phone page: the Contacts app (contacts, services, number requests; GM managers).
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

export const actions = {
  /** People open their contact card; a service, or (GM acting as an NPC) a PC to text, the conversation. */
  "open-contact"(d) {
    if (d.card === "true") return this._openCard(d);
    const back = { app: "contacts" };
    if (d.kind === "service") this.view = { kind: "service", actorId: d.actorId, serviceId: d.serviceId, back };
    else this.view = { kind: "direct", threadId: null, actorId: d.actorId, contact: d.contact, hidden: false, back };
    this.app = "messages";
    this.notesOpen = false;
    this.render();
  },
  "request-contact"() {
    this._requestContact();
  },
  "request-approve"({ requestId }) {
    this._approveRequest(requestId);
  },
  "request-deny"({ requestId }) {
    store.request("request-resolve", { requestId, approve: false });
  },
  contacts() {
    ContactsManager.open(game.actors.get(this.inbox) ?? undefined);
  },
  services() {
    ServicesManager.open();
  }
};

export const inputs = {
  "input[name=contactSearch]": {
    input(event) {
      this.contactSearch = event.currentTarget.value;
      this._contactSearchFocus = true;
      this.render();
    }
  }
};

export const methods = {
  contactsData(ctx) {
    const query = this.contactSearch.trim().toLowerCase();
    const byName = (a, b) => a.name.localeCompare(b.name);
    const data = { search: this.contactSearch, rows: [], services: [] };
    const gm = ctx.perspective === "gm";

    if (gm) {
      data.pickers = this.gmPickers();
      data.gmConsole = true;
      data.inboxName = appearance().names.contacts;
      data.requests = store.visibleRequests().map(r => ({
        ...r,
        owner: game.actors.get(r.actorId) ? displayName(game.actors.get(r.actorId)) : "?"
      }));
    } else {
      data.inboxName = ctx.subject.name;
    }

    const persona = gm ? this.persona : null;
    const actor = game.actors.get(gm ? this.inbox : ctx.actorId);
    if (persona && !actor) {
      // GM acting as an NPC on all phones: every player character, to text as them.
      data.rows = playerCharacters().map(a => ({
        kind: "direct", actorId: a.id, contact: persona.name, name: displayName(a),
        img: actorAvatar(a), initials: initials(displayName(a)), sub: `Text as ${persona.name}`
      }));
    } else {
      if (actor) {
        data.rows = getContacts(actor).map(c => {
          const linked = c.actorId ? game.actors.get(c.actorId) : null;
          const alias = getAlias(actor, noteKey(c.name, null));
          const note = getNote(actor, noteKey(c.name, null));
          return {
            kind: "direct", actorId: actor.id, contact: c.name, name: gm ? c.name : alias || c.name,
            img: pictureOf(c.img, linked?.id),
            initials: initials(c.name),
            card: true,
            blocked: this.isGM && c.blocked,
            sub: (gm && alias ? `Renamed to “${alias}”${note ? ` · ${note}` : ""}` : note) || ""
          };
        });
        data.services = servicesFor(actor.id).map(s => ({
          kind: "service", actorId: actor.id, serviceId: s.id, name: s.name,
          img: s.img, initials: initials(s.name), sub: "Service"
        }));
      }
      if (!gm) {
        data.pending = store.visibleRequests().filter(r => r.actorId === ctx.actorId);
        data.canRequest = this.online;
      }
    }

    if (query) {
      data.rows = data.rows.filter(r => r.name.toLowerCase().includes(query) || r.sub.toLowerCase().includes(query));
      data.services = data.services.filter(r => r.name.toLowerCase().includes(query));
    }
    data.rows.sort(byName);
    data.services.sort(byName);
    if (gm && !actor) data.emptyText = "Choose whose phone to see their contacts, or who to act as to text anyone.";
    else data.emptyText = query ? "No matches." : "No contacts yet.";
    data.empty = !data.rows.length && !data.services.length;
    return data;
  },

  /**
   * GM: approve a contact request, optionally correcting the name or linking it to an existing
   * sheet (the closest-named actor is preselected, e.g. when the player misspelled it).
   */
  async _approveRequest(requestId) {
    const request = store.requests.get(requestId);
    if (!request) return;
    const owner = game.actors.get(request.actorId);
    const candidates = game.actors
      .filter(a => a !== owner && a.type !== "container")
      .map(a => ({ actor: a, name: displayName(a), score: similarity(request.name, displayName(a)) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    // Preselect the closest-named sheet, e.g. when the player misspelled it.
    const best = candidates[0]?.score >= 0.6 ? candidates[0].actor : null;
    const result = await approveRequestDialog({
      owner: owner ? displayName(owner) : "?",
      request,
      candidates: candidates.map(({ actor, name }) => ({ id: actor.id, name, selected: actor === best }))
    });
    if (result) store.request("request-resolve", { requestId, approve: true, ...result });
  },

  /** Player: ask the GM to add a number to this character's contacts. */
  async _requestContact() {
    const ctx = this.context();
    if (ctx?.perspective !== "pc") return;
    const result = await contactRequestDialog();
    if (!result?.name) return;
    if (store.request("contact-request", { actorId: ctx.actorId, ...result })) {
      ui.notifications.info(`Requested ${result.name}'s number.`);
    }
  }
};

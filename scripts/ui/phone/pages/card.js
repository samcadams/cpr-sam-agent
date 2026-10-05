import { findContact, getAlias, getContacts, getNote, noteKey, setAlias } from "../../../model/contacts.js";
import { conversationKey, displayName, personaColor, pictureOf } from "../../../model/threads.js";
import { initials } from "../../../util/text.js";

/*
 * Phone page: a contact card, for a person (NPC or PC) in a character's contacts. Services don't
 * have one.
 *
 * Opened from the top of a direct conversation, the Contacts app, or a player's Group info. The view
 * is the same shape as a direct conversation's ({ actorId, contact, threadId, hidden }) plus `back`,
 * so the GM tools in pages/conversation.js (block, texts only, reveal, delete, picture) work on it
 * unchanged.
 *  - Player: their own name for the contact, their notes, and deleting the conversation from their phone.
 *  - GM: the contact as it sits on that PC's phone: what the player renamed it to, their notes
 *    (shortened), its picture or sheet, texts only, block, reveal caller ID and deleting the
 *    conversation for everyone.
 * Methods and click actions (data-action) are installed onto AgentPhone.
 */

export const actions = {
  /** The open conversation's contact card. */
  card() {
    this._openCard();
  },
  /** The card's "Send text": back to the conversation it came from, or into it. */
  "card-text"() {
    const v = this.view;
    if (v?.back?.kind === "direct") this.view = v.back;
    else this.view = { kind: "direct", actorId: v.actorId, contact: v.contact, threadId: v.threadId, hidden: v.hidden, back: v };
    this.render();
  },
  "card-sheet"({ actorId }) {
    game.actors.get(actorId)?.sheet.render(true);
  },
  /** Player: delete the conversation from this phone (it comes back when something new arrives). */
  "card-clear"() {
    const v = this.view;
    this._clearThread(conversationKey({ kind: "direct", ...v }), () => {
      this.view = null;
      this.render();
    });
  }
};

export const inputs = {
  /** Player: their own name for the contact on the open card. */
  "input[name=contactAlias]": {
    change(event) {
      const ctx = this.context();
      const actor = ctx?.perspective === "pc" && game.actors.get(ctx.actorId);
      if (!actor || this.view?.kind !== "card") return;
      const thread = this.resolveDirect();
      const hidden = !!(thread?.hideId ?? this.view.hidden);
      const contact = thread?.contact ?? this.view.contact;
      const name = event.currentTarget.value.trim();
      setAlias(actor, noteKey(contact, hidden ? thread?.id : null), name === contact ? "" : name);
    }
  }
};

export const methods = {
  /**
   * Open a contact card: of the open conversation's contact, or of `row` ({ actorId, contact }: a
   * contact in the Contacts app, or a member in Group info), coming back to where it was opened.
   */
  _openCard(row) {
    const from = this.view;
    if (!row && from?.kind === "direct") {
      const thread = this.resolveDirect();
      this.view = { kind: "card", actorId: from.actorId, contact: thread?.contact ?? from.contact, threadId: thread?.id ?? null, hidden: !!from.hidden, back: from };
    } else if (row) {
      const back = from?.kind === "group-info" ? from : { app: "contacts" };
      this.view = { kind: "card", actorId: row.actorId, contact: row.contact, threadId: null, hidden: false, back };
      this.app = "messages";
    } else return;
    this.notesOpen = false;
    this.render();
  },

  cardData(ctx) {
    const v = this.view;
    const actor = game.actors.get(v.actorId);
    if (!actor) return null;
    const gm = ctx.perspective === "gm";
    const thread = this.resolveDirect();
    const contact = thread?.contact ?? v.contact;
    const hidden = !!(thread?.hideId ?? v.hidden);
    const entry = hidden ? null : findContact(getContacts(actor), contact);
    const linkedId = entry?.actorId ?? (gm ? thread?.contactActorId : null);
    const linked = linkedId ? game.actors.get(linkedId) : null;
    const pc = displayName(actor);
    const key = noteKey(contact, hidden ? thread?.id : null);
    const note = getNote(actor, key);
    const alias = getAlias(actor, key);
    const blocked = !!entry?.blocked;
    const noCall = !!entry?.noCall;
    const unreachable = blocked && !gm;
    const hasMessages = !!this.cleared(ctx, thread)?.messages.length;

    let sub;
    if (gm) sub = hidden ? `Caller ID hidden from ${pc}` : entry ? `In ${pc}'s contacts` : `Not in ${pc}'s contacts`;
    else sub = hidden ? "Caller ID hidden" : entry ? "Contact" : "Not in your contacts";

    return {
      actingAs: gm ? this.actingAsContact(actor, contact, hidden) : null,
      name: gm ? contact : alias || contact,
      // Player: their own name for them (the real one stays underneath). GM: what the player calls them.
      rename: gm ? null : { value: alias || contact, real: alias ? contact : null },
      renamed: gm && alias ? alias : null,
      img: pictureOf(entry?.img ?? thread?.contactImg, thread?.hideId ? null : linked?.id),
      initials: initials(contact),
      color: gm ? personaColor(contact) : null,
      sub,
      pc,
      blocked,
      noCall,
      // Player: their notes, written here. GM: the player's notes, shortened until "Show all".
      notes: gm
        ? note ? { text: note, long: note.length > 180 || note.split("\n").length > 4, open: this.notesOpen } : null
        : { editable: true, text: note },
      // Opened from the conversation: its button goes back to it. Elsewhere: "Send text", when they can.
      fromElsewhere: v.back?.kind !== "direct",
      canText: gm || !!entry || !!thread,
      canCall: this.online && !unreachable && this.canStartCall && !(noCall && !gm),
      sheet: gm && linked ? linked.id : null,
      canDeleteMine: !gm && hasMessages,
      gm: gm
        ? {
          canImage: !hidden && !linked,
          canBlock: !hidden,
          canReveal: hidden && !!thread,
          canDelete: !!thread
        }
        : null
    };
  }
};

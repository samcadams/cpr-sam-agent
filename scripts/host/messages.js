import { cleanImage, cleanLocation, gm, MAX_NAME, textParts } from "./validate.js";
import { DEFAULT_CONTACT_IMG, MODULE_ID } from "../config.js";
import { canUsePhone, isPlayerCharacter } from "../model/agent.js";
import { findContact, getContacts, setContacts, shownName } from "../model/contacts.js";
import { feature } from "../model/features.js";
import { canActFor, canView, readKey } from "../model/permissions.js";
import { shareCard, shareFits } from "../model/share.js";
import { actorAvatar, displayName, isDirect, isGroup, unknownLabel } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: direct texts between a PC and a contact (mirrored for PC-to-PC), read and viewed receipts, caller ID.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  send: "_onSend",
  read: "_onRead",
  viewed: gm("_onViewed"),
  reveal: gm("_onReveal"),
  "share-texts": "_onShareTexts"
};

export const methods = {
  _getOrCreate(actor, contact, entry, hidden = false) {
    let thread = this.findThread(actor.id, contact, hidden);
    if (!thread) {
      thread = {
        id: foundry.utils.randomID(),
        type: "direct",
        actorId: actor.id,
        contact: entry?.name ?? contact,
        contactImg: entry?.img ?? null,
        contactActorId: entry?.actorId ?? null,
        hideId: hidden,
        messages: [],
        lastRead: { owner: 0, gm: 0 },
        viewed: 0
      };
      this.threads.set(thread.id, thread);
    }
    return thread;
  },

  /** GMs can text or call a PC from any name; it becomes one of the PC's contacts. */
  async _ensureContact(actor, name, entry) {
    if (entry) return entry;
    entry = { name, img: DEFAULT_CONTACT_IMG };
    await setContacts(actor, [...getContacts(actor), entry]);
    return entry;
  },

  /** The other PC's copy of a PC-to-PC conversation. */
  _mirror(thread, create) {
    if (thread.hideId) return null;
    const actor = game.actors.get(thread.actorId);
    const other = thread.contactActorId ? game.actors.get(thread.contactActorId) : null;
    if (!actor || !other || other === actor || !isPlayerCharacter(other)) return null;
    const name = displayName(actor);
    if (!create) return this.findThread(other.id, name);
    return this._getOrCreate(other, name, { name, img: actorAvatar(actor), actorId: actor.id });
  },

  /** Add a message to a direct thread (and its mirror), save and push. */
  _postDirect(thread, message, notify = true) {
    message.pairId ??= message.id;
    thread.messages.push(message);
    const mirror = this._mirror(thread, true);
    if (mirror) {
      mirror.messages.push({ ...message, id: foundry.utils.randomID(), from: message.from === "pc" ? "contact" : "pc" });
      // A PC writing has obviously seen the other PC's messages.
      if (message.from === "pc") mirror.viewed = Math.max(mirror.viewed ?? 0, message.ts);
      // The GM wrote it, so the GM has read both copies.
      if (game.users.get(message.userId)?.isGM) mirror.lastRead.gm = Math.max(mirror.lastRead.gm ?? 0, message.ts);
    }
    this.save();
    this._push(thread, notify);
    if (mirror) this._push(mirror, notify);
  },

  /**
   * Validate a player's texting identity for a direct thread (by id, or by PC + contact name).
   * Players need an Agent and can't reach blocked numbers.
   */
  _playerDirect(user, { threadId, actorId, contact }) {
    let thread = threadId ? this.threads.get(threadId) : null;
    if (threadId && !isDirect(thread)) return null;
    const actor = game.actors.get(thread?.actorId ?? actorId);
    if (!actor?.testUserPermission(user, "OWNER") || !canUsePhone(actor)) return null;
    const name = thread?.contact ?? clean(contact, MAX_NAME);
    const entry = thread?.hideId ? null : findContact(getContacts(actor), name);
    thread ??= this.findThread(actor.id, name);
    if (entry?.blocked) return null;
    if (!entry && !thread) return null;
    return { actor, entry, thread, contact: name };
  },

  /** GM: resolve (or create) the direct thread they're writing in. */
  async _gmDirect({ threadId, actorId, contact, hidden }) {
    if (threadId) {
      const thread = this.threads.get(threadId);
      return isDirect(thread) ? thread : null;
    }
    const actor = game.actors.get(actorId);
    contact = clean(contact, MAX_NAME);
    if (!actor || !contact) return null;
    if (hidden) return this._getOrCreate(actor, contact, null, true);
    const entry = await this._ensureContact(actor, contact, findContact(getContacts(actor), contact));
    return this._getOrCreate(actor, contact, entry);
  },

  _partyName(thread, key) {
    if (isGroup(thread)) return thread.members.find(m => m.key === key)?.name ?? "Someone";
    const actor = game.actors.get(thread.actorId);
    if (key === "pc") return actor ? displayName(actor) : "Someone";
    if (key === "service") return thread.name;
    return thread.contact;
  },

  async _onSend(user, msg) {
    const parts = textParts(msg.text);
    const location = cleanLocation(msg.location);
    const image = cleanImage(msg.image, user);
    const job = this._jobOffer(user, msg.job);
    if (!parts[0] && !location && !image && !job) return;

    let thread;
    if (user.isGM) {
      thread = await this._gmDirect(msg);
    } else {
      const found = this._playerDirect(user, msg);
      if (!found) return;
      thread = found.thread ?? this._getOrCreate(found.actor, found.contact, found.entry);
    }
    if (!thread) return;

    // A long text arrives as several bubbles: only the last one notifies.
    const messages = this._textMessages(user.isGM ? "contact" : "pc", parts, { userId: user.id, location, image, job });
    for (const message of messages) {
      thread.lastRead[user.isGM ? "gm" : "owner"] = message.ts;
      if (user.isGM) thread.viewed = message.ts; // replying means the contact has seen it
      this._postDirect(thread, message, message === messages.at(-1));
    }
    this._dingDirect(thread, messages[0].from);
  },

  _onRead(user, { threadId, ts, actorId }) {
    const thread = this.threads.get(threadId);
    if (!thread || !canView(user, thread)) return;
    if (isGroup(thread) && !user.isGM && !thread.members.some(m => m.actorId === actorId && canActFor(user, m))) return;
    const key = readKey(user, thread, actorId);
    if (!key) return;
    thread.lastRead[key] = Math.max(thread.lastRead[key] ?? 0, Number(ts) || 0);

    // PC-to-PC: this player reading means their contact's copy shows "Viewed".
    if (isDirect(thread) && !user.isGM) {
      const mirror = this._mirror(thread, false);
      if (mirror && (mirror.viewed ?? 0) < thread.lastRead[key]) {
        mirror.viewed = thread.lastRead[key];
        this._push(mirror);
      }
    }
    // PC-to-PC: the GM sees both copies, so reading one reads the other (mirrored messages share ts).
    if (isDirect(thread) && user.isGM) {
      const mirror = this._mirror(thread, false);
      if (mirror && (mirror.lastRead.gm ?? 0) < thread.lastRead.gm) {
        mirror.lastRead.gm = thread.lastRead.gm;
        this._push(mirror);
      }
    }
    this.save();
    this._push(thread);
  },

  /** GM: mark a PC's texts as seen by the contact. */
  _onViewed(user, { threadId }) {
    const thread = this.threads.get(threadId);
    if (!isDirect(thread)) return;
    const last = thread.messages.filter(m => m.from === "pc").at(-1)?.ts;
    if (!last || (thread.viewed ?? 0) >= last) return;
    thread.viewed = last;
    this.save();
    this._push(thread);
  },

  /** GM: reveal a hidden caller ID. Merges into the named conversation if one exists. */
  async _onReveal(user, { threadId }) {
    const hidden = this.threads.get(threadId);
    if (!isDirect(hidden) || !hidden.hideId) return;
    const actor = game.actors.get(hidden.actorId);
    if (!actor) return;

    const entry = await this._ensureContact(actor, hidden.contact, findContact(getContacts(actor), hidden.contact));
    const named = this.findThread(actor.id, hidden.contact);
    if (!named) {
      hidden.hideId = false;
      hidden.contactImg ??= entry.img;
      this.save();
      return this._push(hidden);
    }
    named.messages = [...named.messages, ...hidden.messages].sort((a, b) => a.ts - b.ts);
    for (const key of ["owner", "gm"]) named.lastRead[key] = Math.max(named.lastRead[key] ?? 0, hidden.lastRead[key] ?? 0);
    named.viewed = Math.max(named.viewed ?? 0, hidden.viewed ?? 0);
    this._pushWithRemovals(hidden, this._viewers(hidden), true);
    this._push(named);
  },

  /**
   * Share an unbroken run of texts (from, to: message ids) in a direct or group conversation to chat,
   * publicly, as the sharer's phone shows it (see model/share.js). Players share as a PC they own
   * (`actorId`, for groups); the GM as the conversation's NPC side (`as`: the group NPC it speaks as).
   */
  async _onShareTexts(user, { threadId, actorId, as, from, to, theme }) {
    if (!feature("shareTexts")) return;
    const thread = this.threads.get(threadId);
    if (!(isDirect(thread) || isGroup(thread)) || !canView(user, thread)) return;
    const start = thread.messages.findIndex(m => m.id === from);
    const end = thread.messages.findIndex(m => m.id === to);
    if (start < 0 || end < start) return;
    const run = thread.messages.slice(start, end + 1);
    if (!shareFits(run)) return;

    let card;
    let alias;
    if (isGroup(thread)) {
      const me = user.isGM
        ? thread.members.find(m => !m.actorId && m.key === as) ?? thread.members.find(m => !m.actorId)
        : thread.members.find(m => m.actorId && m.actorId === actorId && canActFor(user, m));
      if (!user.isGM && !me) return;
      alias = me?.name ?? thread.name;
      const mine = user.isGM ? m => m.from.startsWith("n:") : m => m.from === me.key;
      card = { title: thread.name, run, mine, sender: m => m.name ?? null };
    } else {
      const actor = game.actors.get(thread.actorId);
      if (!actor) return;
      const hidden = unknownLabel();
      if (user.isGM) {
        // Headed with the PC, as on the GM Phone. A hidden caller stays hidden.
        alias = thread.hideId ? hidden : thread.contact;
        card = { title: displayName(actor), run, mine: m => m.from === "contact" };
      } else {
        alias = displayName(actor);
        card = { title: thread.hideId ? hidden : shownName(actor, thread.contact), run, mine: m => m.from === "pc" };
      }
    }
    const content = shareCard({ ...card, sharer: alias, theme });
    await ChatMessage.create({
      speaker: { alias }, content, style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
      flags: { [MODULE_ID]: { sharedTexts: { threadId: thread.id, from, to, userId: user.id } } }
    });
  }
};

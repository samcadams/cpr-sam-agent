import { canActFor, sideFor } from "../model/permissions.js";
import { isDirect, isGroup } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: emoji reactions.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  react: "_onReact"
};

export const methods = {
  /** Who is reacting: a group member key, or the side of a direct/service thread. */
  _reactorKey(user, thread, as) {
    if (isGroup(thread)) {
      const member = thread.members.find(m => m.key === as);
      return member && canActFor(user, member) ? member.key : null;
    }
    return sideFor(user, thread);
  },

  _onReact(user, { threadId, messageId, emoji, as }) {
    const thread = this.threads.get(threadId);
    const message = thread?.messages.find(m => m.id === messageId);
    emoji = clean(emoji, 16);
    if (!message || message.system || !emoji) return;
    const key = this._reactorKey(user, thread, as);
    if (!key) return;

    // Returns the reaction event when one was added (for notifications and previews), else null.
    const toggle = (t, msg, k) => {
      msg.reactions ??= {};
      if (msg.reactions[k] === emoji) {
        delete msg.reactions[k];
        if (t.lastReaction?.messageId === msg.id && t.lastReaction.side === k) delete t.lastReaction;
        return null;
      }
      msg.reactions[k] = emoji;
      const reaction = { messageId: msg.id, emoji, side: k, by: this._partyName(t, k), userId: user.id, ts: Date.now() };
      t.lastReaction = reaction;
      return reaction;
    };
    const reaction = toggle(thread, message, key);

    // PC-to-PC: the other player's copy shows the same reaction from the other side.
    const mirror = isDirect(thread) && message.pairId ? this._mirror(thread, false) : null;
    const twin = mirror?.messages.find(m => m.pairId === message.pairId);
    const twinReaction = twin ? toggle(mirror, twin, key === "pc" ? "contact" : "pc") : null;

    this.save();
    this._push(thread, false, reaction);
    if (twin) this._push(mirror, false, twinReaction);
  }
};

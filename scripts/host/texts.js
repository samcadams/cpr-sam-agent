import { gm, MAX_LENGTH } from "./validate.js";
import { commsOn } from "../model/features.js";
import { isDirect } from "../model/threads.js";
import { scheduleDue } from "../util/agentTime.js";
import { clean } from "../util/text.js";

/*
 * Host: the GM's tools for texts. Edit or delete a text already sent (silently, on every phone that has
 * it), and schedule a text to send when the phones' clock reaches a time (util/agentTime.js scheduleAt).
 * A scheduled text is the GM's send request, kept in `scheduled` (GMs only) and replayed when it's due.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "edit-text": gm("_onEditText"),
  "delete-text": gm("_onDeleteText"),
  "schedule-text": gm("_onScheduleText"),
  "unschedule-text": gm("_onUnscheduleText")
};

/** The sends a GM can schedule: a direct text, a group text, a service's reply. */
const SCHEDULABLE = new Set(["send", "group-send", "service-reply"]);

export const methods = {
  /** A message and, in a PC-to-PC conversation, its twin in the other player's copy: [[thread, message]]. */
  _withTwin(thread, message) {
    const pairs = [[thread, message]];
    const mirror = isDirect(thread) && message.pairId ? this._mirror(thread, false) : null;
    const twin = mirror?.messages.find(m => m.pairId === message.pairId);
    if (twin) pairs.push([mirror, twin]);
    return pairs;
  },

  _findText(threadId, messageId) {
    const thread = this.threads.get(threadId);
    const message = thread?.messages.find(m => m.id === messageId);
    return message && !message.system ? [thread, message] : null;
  },

  _onEditText(user, { threadId, messageId, text }) {
    const found = this._findText(threadId, messageId);
    text = clean(text, MAX_LENGTH);
    if (!found || !text) return;
    for (const [thread, message] of this._withTwin(...found)) {
      message.text = text;
      this._push(thread);
    }
    this.save();
  },

  _onDeleteText(user, { threadId, messageId }) {
    const found = this._findText(threadId, messageId);
    if (!found) return;
    for (const [thread, message] of this._withTwin(...found)) {
      thread.messages = thread.messages.filter(m => m !== message);
      if (thread.lastReaction?.messageId === message.id) delete thread.lastReaction;
      this._push(thread);
    }
    this.save();
  },

  _onScheduleText(user, { at, unit, request }) {
    if (!SCHEDULABLE.has(request?.type) || !Number.isFinite(at) || !["world", "real"].includes(unit)) return;
    const id = foundry.utils.randomID();
    this.scheduled.set(id, { id, at, unit, userId: user.id, request });
    this.save();
    this._pushScheduled();
  },

  _onUnscheduleText(user, { id }) {
    if (!this.scheduled.delete(id)) return;
    this.save();
    this._pushScheduled();
  },

  /**
   * The clock ticked (host/clock.js): send the scheduled texts now due, soonest first, as the GM who wrote
   * them. While Communications are off they wait (the send would be refused).
   */
  async _sendScheduled() {
    if (!commsOn()) return;
    const due = [...this.scheduled.values()].filter(scheduleDue).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    for (const entry of due) {
      this.scheduled.delete(entry.id);
      const writer = game.users.get(entry.userId);
      await this._dispatch(writer?.isGM ? writer : game.user, entry.request);
    }
    this.save();
    this._pushScheduled();
  },

  /** Scheduled texts go to GMs only. */
  _pushScheduled() {
    const gms = game.users.filter(u => u.active && u.isGM && u !== game.user).map(u => u.id);
    this._send(gms, { type: "scheduled", scheduled: [...this.scheduled.values()] });
    this._changed({ scheduled: true });
  }
};

import { viewFromRow } from "./inbox.js";
import { commsOn } from "../../../model/features.js";
import { agentTimestamp } from "../../../util/agentTime.js";

/*
 * Phone page: the lock screen. Taking the phone out from its button opens on it (when the phone's
 * settings have it on): the time, large, and new messages stacked as notifications. Tapping a
 * notification opens that conversation; tapping anywhere else unlocks to where the phone was.
 * Calls always take over, lock screen or not. With Communications off it's just the time.
 * Methods and click actions (data-action) are installed onto AgentPhone.
 */

const MAX_NOTIFICATIONS = 5;

export const actions = {
  unlock() {
    this.locked = false;
    this.render();
  },
  /** A notification: straight into its conversation. */
  "lock-open"(d, event) {
    event?.stopPropagation();
    this.locked = false;
    this.app = "messages";
    this.view = viewFromRow(d);
    this.render();
  }
};

export const methods = {
  lockData(ctx) {
    const { time, date } = agentTimestamp();
    const unread = !commsOn() ? [] : this.inboxRows(ctx).filter(r => r.unread).sort((a, b) => b.ts - a.ts);
    return {
      time,
      date,
      notifications: unread.slice(0, MAX_NOTIFICATIONS),
      more: Math.max(0, unread.length - MAX_NOTIFICATIONS)
    };
  }
};

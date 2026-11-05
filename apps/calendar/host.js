import { scApi } from "./model.js";
import { hqApi, textToHtml } from "../notes/model.js";
import { MODULE_ID } from "../../scripts/config.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: Calendar (see apps/calendar/model.js). Players can't create journal entries, so the host makes
 * their Simple Calendar notes: owned by whoever asked, visible to them, or to their whole crew (the
 * players of every crew they share through CPR HQ). They edit and delete them themselves.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "cal-note": "_onCalNote"
};

const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));

/** Players of the actor's crews (CPR HQ), besides `user`. */
function crewUsers(actor) {
  const api = hqApi();
  const ids = new Set();
  for (const entry of api?.crewHQsOf(actor) ?? []) {
    for (const member of api.getHQ(entry).crew) {
      const mate = fromUuidSync(member.uuid);
      for (const u of game.users) if (mate && !u.isGM && mate.testUserPermission(u, "OWNER")) ids.add(u.id);
    }
  }
  return ids;
}

export const methods = {
  async _onCalNote(user, { actorId, title, details, date, allDay, hour, minute, share, remind }) {
    const api = scApi();
    const actor = game.actors.get(actorId);
    title = clean(title, 100);
    if (!api || !title || !date || (!user.isGM && !actor?.testUserPermission(user, "OWNER"))) return;
    const day = { year: Math.floor(Number(date.year) || 0), month: int(date.month, 0, 99), day: int(date.day, 0, 99) };
    const h = allDay ? 0 : int(hour, 0, 23);
    const m = allDay ? 0 : int(minute, 0, 59);
    const start = { ...day, hour: h, minute: m, seconds: 0 };
    const end = { ...day, hour: allDay ? 0 : Math.min(23, h + 1), minute: m, seconds: 0 };
    const viewers = new Set(user.isGM ? [] : [user.id]);
    if (share === "crew" && actor) for (const id of crewUsers(actor)) viewers.add(id);
    const entry = await api.addNote(title, textToHtml(clean(details, 2000)), start, end, !!allDay, undefined, [], "active", null, [...viewers]);
    // SC makes its creator (this GM) the owner; the player who asked owns it instead.
    if (entry && !user.isGM) await entry.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    // "Remind me": the character's Agent says so when the note starts (_tickCalendar). Only notes asked for,
    // so CPR HQ's downtime notes stay quiet.
    const at = api.dateToTimestamp(start);
    if (entry && remind && actor && at > game.time.worldTime) await entry.setFlag(MODULE_ID, "remind", { actorId: actor.id, at });
  },

  /** The clock: notes whose reminder time has come. */
  async _tickCalendar() {
    const now = game.time.worldTime;
    const due = game.journal.filter(e => {
      const r = e.flags?.[MODULE_ID]?.remind;
      return r && !r.done && r.at <= now;
    });
    const ids = [];
    for (const entry of due) {
      const { actorId } = entry.flags[MODULE_ID].remind;
      await entry.setFlag(MODULE_ID, "remind.done", true);
      ids.push(this._alert(actorId, { kind: "reminder", app: "calendar", text: `Now: ${entry.name}` }));
    }
    if (ids.some(Boolean)) this._pushApps(ids.filter(Boolean));
  }
};

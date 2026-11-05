import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { dayKey, monthGrid, noteView, scApi, stepMonth } from "./model.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { hqApi } from "../notes/model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { feature } from "../../scripts/model/features.js";
import { condName } from "../weather/model.js";
import { CONDITIONS } from "../weather/tables.js";

/*
 * Phone page: Calendar (see apps/calendar/model.js). A month of Simple Calendar, with the days that have
 * notes or settled downtime marked; a day shows its notes and (with CPR HQ) what the character did.
 * Players add notes for themselves or their crew, and delete their own. The GM Phone picks whose
 * downtime it shows.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const ROUND_STATUS = { draft: "not sent yet", submitted: "sent, waiting for the GM", approved: "approved", returned: "returned by the GM: needs changes" };

/** Today in Simple Calendar's terms: { year, month, day } (0-based month and day). */
function today(api) {
  const now = api.currentDateTime();
  return { year: now.year, month: now.month, day: now.day };
}

export const actions = {
  "cal-step"({ step }) {
    const api = scApi();
    if (!api) return;
    this.calMonth = stepMonth(this.calMonth ?? today(api), Number(step), api.getAllMonths().length);
    this.calAdding = false;
    this.render();
  },
  "cal-today"() {
    const api = scApi();
    if (!api) return;
    const t = today(api);
    this.calMonth = { year: t.year, month: t.month };
    this.calDay = t;
    this.calAdding = false;
    this.render();
  },
  "cal-day"({ day }) {
    const month = this.calMonth;
    if (!month) return;
    this.calDay = { ...month, day: Number(day) };
    this.calAdding = false;
    this.render();
  },
  "cal-add"() {
    this.calAdding = !this.calAdding;
    this.render();
  },
  "cal-note-save"() {
    const root = this.element[0];
    const value = name => root.querySelector(`[name=${name}]`);
    const title = value("calTitle")?.value.trim();
    if (!title) return ui.notifications.warn("Give the note a title.");
    const [hour, minute] = String(value("calTime")?.value || "12:00").split(":").map(Number);
    const actor = this.calSubject();
    const sent = store.request("cal-note", {
      actorId: actor?.id ?? null,
      title,
      details: value("calDetails")?.value ?? "",
      date: this.calDay,
      allDay: !!value("calAllDay")?.checked,
      hour, minute,
      share: root.querySelector("input[name=calShare]:checked")?.value ?? "me",
      remind: !!value("calRemind")?.checked
    });
    if (sent) {
      this.calAdding = false;
      this.render();
    }
  },
  "cal-note-delete"({ noteId }) {
    const entry = game.journal.get(noteId);
    if (!entry?.isOwner) return;
    Dialog.confirm({
      title: "Delete note",
      content: `<p>Delete "${entry.name}" from the calendar?</p>`,
      yes: () => (scApi()?.removeNote ? scApi().removeNote(noteId) : entry.delete())
    });
  },
  /** CPR HQ's Downtime window, to fill in this round's schedule. */
  "cal-downtime"() {
    const actor = this.calSubject();
    hqApi()?.openDowntime?.(game.user.isGM ? undefined : actor);
  }
};

export const dropdowns = {
  calActor(value) {
    this.calActor = value;
    this.render();
  }
};

export const methods = {
  /** Whose downtime: the character in hand, or on the GM Phone the one picked. */
  calSubject(ctx = this.context()) {
    if (ctx?.perspective === "gm") return game.actors.get(this.calActor) ?? null;
    return ctx?.subject?.actor ?? null;
  },

  calendarData(ctx) {
    const gm = ctx.perspective === "gm";
    const pcs = gm ? playerCharacters() : [];
    if (gm && !pcs.some(a => a.id === this.calActor)) this.calActor = pcs[0]?.id ?? null;
    const actor = this.calSubject(ctx);
    const hq = hqApi();
    const base = {
      gm,
      bar: appBar("calendar", { owner: gm ? null : ctx.subject.name }),
      picker: gm && hq?.downtime ? dropdown("calActor", pcs.map(a => ({ value: a.id, label: displayName(a), selected: a.id === this.calActor })), { title: "Whose downtime", cls: "agent-wide" }) : null
    };
    const api = scApi();
    if (!api) return { ...base, noCalendar: true };

    const now = today(api);
    this.calMonth ??= { year: now.year, month: now.month };
    this.calDay ??= now;
    const { year, month } = this.calMonth;
    const months = api.getAllMonths();
    const monthCfg = months[month] ?? months[0];
    const weekdays = api.getAllWeekdays();
    const first = api.timestampToDate(api.dateToTimestamp({ year, month, day: 0, hour: 0, minute: 0, seconds: 0 }));
    const days = first.isLeapYear && monthCfg.numberOfLeapYearDays ? monthCfg.numberOfLeapYearDays : monthCfg.numberOfDays;

    // Marks: days with notes this user can see, and with settled downtime.
    const marks = {};
    for (let d = 0; d < days; d++) {
      const notes = api.getNotesForDay(year, month, d).filter(e => e?.testUserPermission(game.user, "OBSERVER"));
      if (notes.length) marks[dayKey({ year, month, day: d })] = { note: true };
    }
    // The Weather app's days (same keys), when it's on.
    const wx = feature("app_weather") ? store.apps.weather ?? {} : {};
    const wxOf = key => (key !== "now" && wx[key]?.w ? { wxIcon: CONDITIONS[wx[key].w.cond]?.icon, wxName: condName(wx[key].w) } : null);
    for (let d = 0; d < days; d++) {
      const key = dayKey({ year, month, day: d });
      const w = wxOf(key);
      if (w) marks[key] = { ...(marks[key] ?? {}), ...w };
    }
    const from = api.dateToTimestamp({ year, month, day: 0, hour: 0, minute: 0, seconds: 0 });
    const downtime = hq?.downtime && actor ? hq.downtime.days(actor, from, from + days * 86400) : new Map();
    for (const [ts] of downtime) {
      const d = api.timestampToDate(ts);
      const key = dayKey({ year: d.year, month: d.month, day: d.day });
      marks[key] = { ...(marks[key] ?? {}), downtime: true };
    }

    // The selected day.
    const sel = this.calDay;
    const selTs = api.dateToTimestamp({ ...sel, hour: 0, minute: 0, seconds: 0 });
    const selDate = api.timestampToDate(selTs);
    const notes = api.getNotesForDay(sel.year, sel.month, sel.day)
      .filter(e => e?.testUserPermission(game.user, "OBSERVER"))
      .map(e => noteView(e))
      .sort((a, b) => a.sort - b.sort);
    const pad = n => String(n).padStart(2, "0");
    const dayBlocks = (hq?.downtime && actor ? hq.downtime.days(actor, selTs, selTs + 86400).get(selTs) : null) ?? [];

    // The open downtime round, while it covers days.
    const round = hq?.downtime && actor ? hq.downtime.round(actor) : null;
    const roundView = round && round.round === "open" ? {
      from: api.timestampToDate(round.start)?.display?.date,
      days: round.days,
      schedule: ROUND_STATUS[round.schedule] ?? round.schedule
    } : null;

    return {
      ...base,
      actorName: actor ? displayName(actor) : null,
      title: `${monthCfg.name} ${first.display?.year ?? year}`,
      weekdays: weekdays.map(w => w.abbreviation || w.name.slice(0, 2)),
      weeks: monthGrid({
        days, firstWeekday: first.dayOfTheWeek ?? 0, weekLength: weekdays.length || 7,
        date: { year, month }, today: dayKey(now), selected: dayKey(sel), marks
      }),
      day: {
        label: selDate.display ? `${selDate.display.weekday}, ${selDate.display.date}` : dayKey(sel),
        weather: wxOf(dayKey(sel)),
        notes,
        downtime: dayBlocks.map(b => ({ ...b, time: `${pad(b.start)}:00–${pad(b.end)}:00` })),
        canAdd: !!actor || gm,
        crew: !gm && !!hq?.crewHQsOf(actor).length
      },
      adding: !!this.calAdding,
      round: roundView,
      hq: !!hq?.downtime
    };
  }
};

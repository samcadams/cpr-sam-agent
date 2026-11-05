import { MODULE_ID } from "../../scripts/config.js";

/*
 * Calendar: Simple Calendar's months, weekdays and notes on the phone, plus (with CPR HQ) each
 * character's settled downtime. Dates are Simple Calendar's: { year, month, day }, month and day
 * counted from 0. Players add notes through the host (as SC notes visible to them, or to their crew).
 * The world setting "hideSimpleCalendar" keeps SC's own window and button away from players.
 */

const SC = "foundryvtt-simple-calendar";

/** Simple Calendar's API while it's running. */
export function scApi() {
  return game.modules?.get(SC)?.active ? globalThis.SimpleCalendar?.api ?? null : null;
}

/** Does Simple Calendar's own window stay hidden for this user? */
export const scHidden = (user = game.user) => !user.isGM && !!game.settings.get(MODULE_ID, "hideSimpleCalendar");

export const dayKey = ({ year, month, day }) => `${year}-${month}-${day}`;

/**
 * A month's grid: weeks of cells, each { day, date, today, selected, marks } or null for blanks.
 * @param {object} o
 * @param {number} o.days          days in the month
 * @param {number} o.firstWeekday  0-based weekday of its first day
 * @param {number} o.weekLength
 * @param {object} o.date          { year, month } of the month
 * @param {string} [o.today]       dayKey of today
 * @param {string} [o.selected]    dayKey of the selected day
 * @param {object} [o.marks]       dayKey → { note, downtime }
 */
export function monthGrid({ days, firstWeekday, weekLength, date, today, selected, marks = {} }) {
  const cells = Array.from({ length: firstWeekday }, () => null);
  for (let d = 0; d < days; d++) {
    const key = dayKey({ ...date, day: d });
    cells.push({ day: d + 1, index: d, today: key === today, selected: key === selected, ...(marks[key] ?? {}) });
  }
  while (cells.length % weekLength) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += weekLength) weeks.push(cells.slice(i, i + weekLength));
  return weeks;
}

/** The month after or before { year, month }, given how many months a year has. */
export function stepMonth({ year, month }, step, monthsInYear) {
  let m = month + step;
  let y = year;
  while (m < 0) { m += monthsInYear; y--; }
  while (m >= monthsInYear) { m -= monthsInYear; y++; }
  return { year: y, month: m };
}

/** "13:30", or "All day". */
export function noteTime(noteData) {
  if (!noteData || noteData.allDay) return "All day";
  const pad = n => String(n ?? 0).padStart(2, "0");
  const s = noteData.startDate ?? {};
  const e = noteData.endDate ?? {};
  const from = `${pad(s.hour)}:${pad(s.minute)}`;
  const to = `${pad(e.hour)}:${pad(e.minute)}`;
  return to !== from && dayKey(s) === dayKey(e) ? `${from}–${to}` : from;
}

/** An SC note entry as the phone shows it. */
export function noteView(entry, user = game.user) {
  const data = entry.getFlag?.(SC, "noteData") ?? entry.flags?.[SC]?.noteData ?? {};
  const page = [...(entry.pages ?? [])].find(p => p.type === "text");
  return {
    id: entry.id,
    title: entry.name,
    time: noteTime(data),
    html: page?.text?.content ?? "",
    mine: entry.testUserPermission?.(user, "OWNER") ?? false,
    sort: data.allDay ? -1 : (data.startDate?.hour ?? 0) * 60 + (data.startDate?.minute ?? 0)
  };
}

import {
  agentTimestamp, CLOCK_SOURCES, clockSettings, customClockFields, customClockOffset, dateFieldFor, dateOffsetFor, localClockOffset, simpleCalendar
} from "../../util/agentTime.js";
import { patchSetting } from "../../util/settings.js";

/*
 * Configure Settings → Clock (ui/settings/menus.js): where the phones' time comes from, and the GM's own
 * time and date (world setting "clock", util/agentTime.js). What the form shows, and what each control saves.
 */

/** The form: the source, the Simple Calendar note, system time's other date, the GM's own time, "Day", and now. */
export function clockData() {
  const clock = clockSettings();
  return {
    sources: Object.entries(CLOCK_SOURCES).map(([value, label]) => ({ value, label, selected: value === clock.source })),
    noCalendar: clock.source === "calendar" && !simpleCalendar(),
    system: clock.source === "system" ? { otherDate: clock.dateOffset !== null, date: dateFieldFor(clock.dateOffset) } : null,
    custom: clock.source === "custom" ? customClockFields(clock.offset) : null,
    dayPrefix: clock.dayPrefix,
    now: agentTimestamp()
  };
}

/** Where the phones' clock comes from. The GM's own clock starts at this computer's time. */
export const setClockSource = value => patchSetting("clock", c => {
  c.source = value;
  if (value === "custom" && !c.offset) c.offset = localClockOffset();
});

/** "Day" before the day's number. */
export const setClockDayPrefix = on => patchSetting("clock", c => (c.dayPrefix = !!on));

/** System time on another date (from today, as it is now), or on today's. */
export const setClockOtherDate = on => patchSetting("clock", c => (c.dateOffset = on ? 0 : null));

/** System time's other date ("YYYY-MM-DD"); one that doesn't parse is ignored. */
export function setClockSystemDate(date) {
  const days = dateOffsetFor(date);
  return days === null ? null : patchSetting("clock", c => (c.dateOffset = days));
}

/** The GM's clock: it runs on from the date and time entered (ignored until both parse). */
export function setCustomClock(date, time) {
  const offset = customClockOffset(date, time);
  return offset === null ? null : patchSetting("clock", c => (c.offset = offset));
}

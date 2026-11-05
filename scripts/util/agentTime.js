import { MODULE_ID } from "../config.js";

/**
 * In-world time for Agent messages and the phones' clocks. The GM picks where it comes from
 * (world setting "clock", Control → Every phone → Clock):
 *  - auto: Simple Calendar → SmallTime (world time only) → real-world clock;
 *  - calendar: Simple Calendar (the real-world clock if it isn't active);
 *  - system: the real-world clock, optionally on another date (`dateOffset` days from today);
 *  - custom: a time and date the GM set, running on from there (`offset` ms from now, read in UTC so
 *    every client shows the same).
 * Dates read "<Month>, Day <n>, <Year>" ("Spring, Day 7, 2045"), or without "Day" ("Spring 7, 2045").
 */

export const CLOCK_SOURCES = { auto: "Automatic", calendar: "Simple Calendar", system: "System time", custom: "Set by the GM" };

const DAY_MS = 86_400_000;

/** The clock setting, with its defaults. */
export function clockSettings() {
  const s = game.settings.get(MODULE_ID, "clock") ?? {};
  return {
    source: s.source in CLOCK_SOURCES ? s.source : "auto",
    dayPrefix: s.dayPrefix !== false,
    offset: Number(s.offset) || 0,
    dateOffset: Number.isFinite(s.dateOffset) ? s.dateOffset : null
  };
}

export const simpleCalendar = () => (game.modules.get("foundryvtt-simple-calendar")?.active ? globalThis.SimpleCalendar?.api ?? null : null);

function smallTimeIs12h() {
  if (!game.modules.get("smalltime")?.active) return false;
  try {
    return game.settings.get("smalltime", "time-format") == 12;
  } catch {
    return false;
  }
}

function formatClock(hours, minutes, twelveHour) {
  const mm = String(minutes).padStart(2, "0");
  if (!twelveHour) return `${String(hours).padStart(2, "0")}:${mm}`;
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${mm} ${suffix}`;
}

const formatDate = (month, day, year, dayPrefix) => (dayPrefix ? `${month}, Day ${day}, ${year}` : `${month} ${day}, ${year}`);

/** A Date's parts, in local time or UTC. */
const partsOf = (d, utc) => ({
  hours: utc ? d.getUTCHours() : d.getHours(),
  minutes: utc ? d.getUTCMinutes() : d.getMinutes(),
  day: utc ? d.getUTCDate() : d.getDate(),
  year: utc ? d.getUTCFullYear() : d.getFullYear(),
  month: d.toLocaleDateString([], { month: "long", ...(utc ? { timeZone: "UTC" } : {}) })
});

/**
 * Whether the phones' clock follows world time (`game.time.worldTime`): Simple Calendar (Automatic or
 * Simple Calendar), or SmallTime (Automatic). Otherwise it's the real clock.
 */
export function worldClock(clock = clockSettings()) {
  if ((clock.source === "auto" || clock.source === "calendar") && simpleCalendar()) return true;
  return clock.source === "auto" && !!game.modules.get("smalltime")?.active;
}

/**
 * The phones' time and date now, or at `at` (seconds: world time when worldClock(), else real
 * seconds since 1970; the Garden's posts carry one).
 * @returns {{time: string, date: string|null}}
 */
export function agentTimestamp(at = null) {
  const twelveHour = smallTimeIs12h();
  const clock = clockSettings();

  const sc = clock.source === "auto" || clock.source === "calendar" ? simpleCalendar() : null;
  if (sc) {
    try {
      // Use the month's full configured name, not its abbreviation.
      const d = sc.timestampToDate(at ?? sc.timestamp());
      const year = `${d.display.yearPrefix ?? ""}${d.display.year}${d.display.yearPostfix ?? ""}`;
      return {
        time: formatClock(d.hour, d.minute, twelveHour),
        date: formatDate(d.display.monthName, d.display.day, year, clock.dayPrefix)
      };
    } catch (err) {
      console.warn("cpr-sam-agent | Simple Calendar time lookup failed, falling back to world time.", err);
    }
  }

  if (clock.source === "auto" && game.modules.get("smalltime")?.active) {
    const seconds = (((at ?? game.time.worldTime) % 86400) + 86400) % 86400;
    const totalMinutes = Math.floor(seconds / 60);
    return { time: formatClock(Math.floor(totalMinutes / 60), totalMinutes % 60, twelveHour), date: null };
  }

  const custom = clock.source === "custom";
  const now = new Date((at === null ? Date.now() : at * 1000) + (custom ? clock.offset : 0));
  const t = partsOf(now, custom);
  // By calendar days, not 24-hour steps: across a daylight saving change those land an hour off,
  // a day early just after midnight.
  const shifted = () => {
    const n = new Date(now);
    n.setDate(n.getDate() + clock.dateOffset);
    return partsOf(n, false);
  };
  const d = !custom && clock.dateOffset !== null ? shifted() : t;
  return { time: formatClock(t.hours, t.minutes, twelveHour), date: formatDate(d.month, d.day, d.year, clock.dayPrefix) };
}

/**
 * The in-world day, as a key that changes at in-world midnight (Roach Race's day passes): the phones'
 * date, or the world time's day count when the clock shows no date (SmallTime).
 */
export function agentDay() {
  return agentTimestamp().date ?? `World day ${Math.floor((game.time?.worldTime ?? 0) / 86400)}`;
}

/* ---------------- Setting the clock (Control) ---------------- */

const pad = n => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m + 1)}-${pad(d)}`;

/** This computer's date today, as UTC midnight (so whole days can be counted). */
const todayUtc = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};

/** "YYYY-MM-DD" as UTC midnight, or NaN. */
const parseDate = value => {
  const [y, m, d] = String(value ?? "").split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : NaN;
};

/** The GM's clock as the Control fields show it: { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function customClockFields(offset = clockSettings().offset) {
  const n = new Date(Date.now() + offset);
  return { date: isoDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()), time: `${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}` };
}

/** The offset that makes the GM's clock read `date` `time` now; null if they don't parse. */
export function customClockOffset(date, time) {
  const day = parseDate(date);
  const [h, m] = String(time ?? "").split(":").map(Number);
  if (!Number.isFinite(day) || !Number.isFinite(h) || !Number.isFinite(m)) return null;
  return day + (h * 60 + m) * 60_000 - Date.now();
}

/** Starting the GM's clock: this computer's time and date now. */
export function localClockOffset() {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes()) - Date.now();
}

/** System time on another date: that date's distance from today in days (null if it doesn't parse). */
export function dateOffsetFor(date) {
  const day = parseDate(date);
  return Number.isFinite(day) ? Math.round((day - todayUtc()) / DAY_MS) : null;
}

/** The date `dateOffset` days from today, for the Control field. */
export function dateFieldFor(dateOffset) {
  const n = new Date(todayUtc() + (dateOffset ?? 0) * DAY_MS);
  return isoDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

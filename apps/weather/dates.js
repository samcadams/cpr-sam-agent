import { clockSettings, simpleCalendar } from "../../scripts/util/agentTime.js";

/*
 * Weather's in-world days: today and the days after it, on the phones' clock (scripts/util/agentTime.js):
 * Simple Calendar when it's the clock (keys "year-month-day", 0-based like the Calendar app's dayKey, so
 * the Calendar can show the weather), otherwise the real-world or GM-set date (ISO keys).
 * Each day: { key, month (0-11, for the season's table), label ("Monday, February 22"), short ("Mon 22") }.
 */

const DAY_MS = 86_400_000;
const pad = n => String(n).padStart(2, "0");

/** Simple Calendar's day `offset` days from today. */
function scDay(api, offset) {
  const now = api.timestamp();
  const ts = offset ? api.timestampPlusInterval(now, { day: offset }) : now;
  const d = api.timestampToDate(ts);
  const months = api.getAllMonths?.().length || 12;
  const month = months === 12 ? d.month : Math.floor((d.month * 12) / months);
  const weekday = d.display?.weekday ?? "";
  return {
    key: `${d.year}-${d.month}-${d.day}`,
    month,
    label: `${weekday ? `${weekday}, ` : ""}${d.display?.monthName ?? d.month + 1} ${d.display?.day ?? d.day + 1}`,
    short: `${weekday.slice(0, 3)} ${d.display?.day ?? d.day + 1}`.trim()
  };
}

/** A JS date (read in UTC or local time) as a weather day. */
function jsDay(date, utc) {
  const opt = utc ? { timeZone: "UTC" } : {};
  const y = utc ? date.getUTCFullYear() : date.getFullYear();
  const m = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  return {
    key: `${y}-${pad(m + 1)}-${pad(day)}`,
    month: m,
    label: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...opt }),
    short: `${date.toLocaleDateString("en-US", { weekday: "short", ...opt })} ${day}`
  };
}

/** The in-world day `offset` days from today. */
export function weatherDay(offset = 0) {
  const clock = clockSettings();
  const sc = clock.source === "auto" || clock.source === "calendar" ? simpleCalendar() : null;
  if (sc) {
    try {
      return scDay(sc, offset);
    } catch (err) {
      console.warn("cpr-sam-agent | Weather: Simple Calendar's date failed, using the phones' clock.", err);
    }
  }
  if (clock.source === "auto" && game.modules.get("smalltime")?.active) {
    // World time only: day 0 is January 1st.
    const days = Math.floor((game.time?.worldTime ?? 0) / 86400) + offset;
    return jsDay(new Date(Date.UTC(2045, 0, 1) + days * DAY_MS), true);
  }
  if (clock.source === "custom") return jsDay(new Date(Date.now() + clock.offset + offset * DAY_MS), true);
  const n = new Date();
  n.setDate(n.getDate() + (clock.dateOffset ?? 0) + offset);
  return jsDay(n, false);
}

/** Today and the next `count - 1` days. */
export const weatherDays = count => Array.from({ length: count }, (_, i) => weatherDay(i));

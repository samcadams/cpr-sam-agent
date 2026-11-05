import { installSimpleCalendarHiding, onHideSimpleCalendarChanged } from "./hideSimpleCalendar.js";

/* The Calendar's Foundry hooks (main.js installs every app's client.js when the module loads). */

export function install({ refreshPhones }) {
  // The Calendar follows Simple Calendar's date and the characters' downtime (CPR HQ's actor flags).
  const refreshNotes = foundry.utils.debounce(() => refreshPhones({ notes: true }), 150);
  Hooks.on("simple-calendar-date-time-change", refreshNotes);
  Hooks.on("updateActor", (actor, changes) => changes.flags?.["cpr-hq"] && refreshNotes());
  installSimpleCalendarHiding();
}

/** What runs when one of this app's settings (app.js) changes. */
export const onSetting = {
  hideSimpleCalendar: () => onHideSimpleCalendarChanged()
};

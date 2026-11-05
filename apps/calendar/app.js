/*
 * Calendar: The date, your plans, and what you did.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "calendar",
  order: 90,
  name: "Calendar", icon: "fas fa-calendar-days",
  blurb: "The date, your plans, and what you did.",
  refreshOn: ["notes"],
  tick: { method: "_tickCalendar" },
  settings: {
    // In Foundry's settings window. Changing it shows or hides Simple Calendar (client.js onSetting).
    hideSimpleCalendar: {
      config: true,
      scope: "world",
      name: "Hide Simple Calendar from players",
      hint: "Players use the phone's Calendar instead: Simple Calendar's window and its button stay hidden for them. The GM keeps both.",
      type: Boolean,
      default: false
    }
  }
};

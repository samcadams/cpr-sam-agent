/*
 * Weather: Night City Weather, today and the next ten days.
 * Its files are in this folder (see the "Apps" header in scripts/apps/manifest.js for what each one is).
 */

export default {
  id: "weather",
  order: 95,
  name: "Weather", icon: "fas fa-cloud-sun-rain",
  blurb: "Your weather. Your call.",
  turnedOn: true,
  citinet: true, offline: "browse",
  refreshOn: ["weather"],
  tick: { method: "_tickWeather" },
  load: "_weatherLoad",
  tables: {
    weather: { owner: "listed", secret: ["actual"] },
    wxChecks: { owner: "actorId" }
  },
  partials: { "agent-wx-edit": "weather-edit.hbs" },
  settings: {
    // The GM's options (Weather Control): wrong forecasts, apply automatically, the daily radio post, units.
    weather: { scope: "world", type: Object, default: {}, redraw: ["weather"] }
  }
};

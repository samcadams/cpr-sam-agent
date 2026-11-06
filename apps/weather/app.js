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
  },
  rules: [
    { key: "weather", path: "wrong", label: "Forecasts can be wrong", type: "boolean", default: false },
    { key: "weather", path: "wrongChance", label: "Chance a day turns out different (%)", type: "number", range: { min: 0, max: 100, step: 5 }, default: 25 },
    { key: "weather", path: "autoApply", label: "Apply new weather automatically (to the same characters)", type: "boolean", default: false },
    { key: "weather", path: "blackoutSignal", label: "A Blackout cuts the signal (no calls, no Data Pool)", type: "boolean", default: true },
    { key: "weather", path: "radio", label: "Morro Rock Radio posts the forecast in The Garden every morning", type: "boolean", default: true },
    { key: "weather", path: "units", label: "Temperatures in", type: "string", choices: { both: "°F and °C", f: "°F", c: "°C" }, default: "both" }
  ]
};

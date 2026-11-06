import { MODULE_ID } from "./config.js";
import { SOUND_DEFAULTS, SOUND_KINDS } from "./model/sounds.js";
import { CallAudio } from "./ui/CallAudio.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";
import { applyReduceMotion } from "./ui/a11y.js";
import { APP_SETTINGS } from "./apps/manifest.js";
import * as clients from "../apps/clients.js";
import { registerSettingsMenus } from "./ui/settings/menus.js";

/*
 * The module's settings, and Configure Settings' submenus (ui/settings/menus.js, after the settings). The ones
 * with config: true are in Foundry's settings window; the submenus show others (ui/settings/groups.js); the rest
 * are set from the phones (Control, the apps' own settings) or are the module's own records, kept out of sight.
 * Every one has a name and hint, so the submenus, the Director and api.settings can show it.
 */

export function registerSettings() {
  // First, so their place in Foundry's settings window stays where it was (the Calendar's switch is first).
  registerAppSettings();
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true, ...data });

  // Every phone's default sounds (Configure Settings → Sounds; each phone can pick its own): a bundled
  // sound's id or a file path. See model/sounds.js.
  for (const [kind, { label, setting }] of Object.entries(SOUND_KINDS)) {
    world(setting, {
      config: false,
      name: label,
      hint: `Every phone's ${label.toLowerCase()}: a bundled sound, or a file of the GM's own. Each phone can pick its own.`,
      type: String,
      default: SOUND_DEFAULTS[kind]
    });
  }
  world("textToneAtToken", {
    config: false, // set in Configure Settings → Sounds
    name: "Text tone in the world",
    hint: "Play the text sound around the recipient's token on the active scene.",
    type: Boolean,
    default: true
  });
  world("ringAtToken", {
    config: false, // set in Configure Settings → Sounds
    name: "Ring in the world",
    hint: "While a call rings, play the ringtone around the recipient's token on the active scene.",
    type: Boolean,
    default: true
  });
  world("ringRadius", {
    config: false, // set in Configure Settings → Sounds
    name: "In-world sound radius",
    hint: "How far rings and text tones carry around the token, in scene distance units.",
    type: Number,
    range: { min: 1, max: 60, step: 1 },
    default: 10
  });
  world("agentNames", {
    name: "Agent item names",
    hint: "Gear with these names (comma separated) counts as an Agent when carried or equipped.",
    type: String,
    default: "Agent"
  });
  world("biomonitorNames", {
    name: "Biomonitor item names",
    hint: "Cyberware or gear with these names (comma separated) is a Biomonitor the Agent can read: biometric alerts, and Trauma Team's automatic calls.",
    type: String,
    default: "Biomonitor"
  });
  world("internalAgentNames", {
    name: "Internal Agent item names",
    hint: "Installed cyberware with these names (comma separated) counts as an Internal Agent.",
    type: String,
    default: "Internal Agent"
  });
  // The GM's toggles (config: false: Configure Settings → Phone rules shows them).
  const redrawPhones = () => {
    for (const phone of AgentPhone.all()) phone.refresh();
  };
  world("requireAgentItem", {
    config: false,
    name: "Require carried Agent item",
    hint: "Player characters need an Agent item to have a phone. Off: every player character has an Agent, item or not (Internal Agents and Biomonitors still need theirs).",
    type: Boolean,
    default: true,
    onChange: redrawPhones
  });
  world("citinetApps", {
    config: false,
    name: "Apps that need the CitiNet",
    hint: "Per app: whether it stops working without a signal. Only what differs from the app's own default is saved.",
    type: Object,
    default: {},
    onChange: redrawPhones
  });
  world("agentLibraryBonus", {
    config: false,
    name: "Agent's Library Search bonus",
    hint: "What an Agent adds to Library Search (Ask Alex Anything).",
    type: Number,
    range: { min: 0, max: 5, step: 1 },
    default: 2
  });
  world("bigSaaiBonus", {
    config: false,
    name: "Big SAAI's Library Search bonus",
    hint: "What the Big SAAI add-on adds to Library Search, on top of the Agent's bonus.",
    type: Number,
    range: { min: 0, max: 5, step: 1 },
    default: 1
  });
  world("sponsoredAds", {
    config: false, // set in Control → Labels
    name: "Sponsored Cybereye ads",
    hint: "An installed Sponsored Cybereye streams ad lines over the phone, whatever its skin (the lines are in Control → Labels).",
    type: Boolean,
    default: true,
    onChange: redrawPhones
  });

  client("volume", { // also on the phone: Settings → Look (This GM Phone in Control)
    name: "Phone volume",
    hint: "Your own phone: text tones and ringtones (0 mutes them). Also scaled by Foundry's Interface volume.",
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
    onChange: () => CallAudio.applyVolume()
  });
  client("worldVolume", { // also on the phone: Settings → Look (This GM Phone in Control)
    name: "In-world phone volume",
    hint: "Phones ringing and buzzing near your tokens (0 mutes them). Also scaled by Foundry's Ambient volume.",
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });
  client("hudOpacity", {
    name: "Internal Agent HUD opacity",
    hint: "How solid the Internal Agent HUD looks on your screen (also adjustable in the phone's settings).",
    type: Number,
    range: { min: 0.2, max: 1, step: 0.05 },
    default: 0.8,
    onChange: () => {
      for (const phone of AgentPhone.all()) phone.refresh();
    }
  });
  client("directorCalls", {
    name: "Calls ring on the Director (GM)",
    hint: "While the GM Director is open, calls ring in its call strip instead of on the GM Phone (no call pop-ups).",
    type: Boolean,
    default: true
  });
  client("monitorOpacity", {
    name: "Agent Monitor opacity (GM)",
    hint: "How solid the GM's Agent Monitor looks over the scene (also its footer slider). It turns solid while the pointer is on it.",
    type: Number,
    range: { min: 0.15, max: 1, step: 0.05 },
    default: 0.6,
    onChange: value => document.getElementById("ctp-agent-monitor")?.style.setProperty("--monitor-alpha", value)
  });
  // The Agent Monitor's dismissed history: { cleared: { [actorId]: ts }, hidden: [did id], off: bool }.
  client("monitorHistory", {
    config: false, name: "Agent Monitor's cleared history", hint: "What the GM cleared or hid in the Agent Monitor's log.", type: Object, default: {}
  });
  client("reduceMotion", {
    name: "Reduce motion",
    hint: "Stop the phone's blinking, pulsing, shaking and sliding, and show text all at once. Always on when your device asks for less motion.",
    type: Boolean,
    default: false,
    onChange: () => applyReduceMotion()
  });
  client("keepPopups", {
    name: "Keep phone pop-ups open",
    hint: "Notifications and achievement celebrations stay until you close them, instead of going away after a few seconds.",
    type: Boolean,
    default: false
  });
  client("gmPopupSeconds", {
    name: "GM pop-ups close after",
    hint: "Seconds before the GM's notification pop-ups close themselves (0 keeps the usual timing). Ringing calls stay until answered.",
    type: Number,
    range: { min: 0, max: 60, step: 1 },
    default: 30
  });
  client("gmPopupAnswers", {
    name: "GM pop-ups that ask for an answer close too",
    hint: "With a time above: pop-ups waiting for the GM's answer (requests, approvals) close after it as well. Off: they stay until answered.",
    type: Boolean,
    default: true
  });
  client("fontScale", { // also on the phone: Settings → Look (This GM Phone in Control)
    name: "Phone text size",
    hint: "How big the text is on your phone.",
    type: Number,
    range: { min: 0.8, max: 1.5, step: 0.05 },
    default: 1,
    onChange: () => {
      for (const phone of AgentPhone.all()) phone.refresh();
    }
  });

  // The module's own records and the GM's Object settings, set from the phones and the submenus.
  const hidden = (scope, key, data) => game.settings.register(MODULE_ID, key, { scope, config: false, ...data });
  hidden("world", "services", {
    name: "Services", hint: "The services in the Contacts app: Trauma Team, fixers, shops (the GM Phone's Contacts → Services).", type: Array, default: []
  });
  // Ids of the built-in services already added to this world (model/services.js seedDefaultServices).
  hidden("world", "seededServices", { name: "Built-in services added", hint: "Which built-in services this world already has, so they're added once.", type: Array, default: [] });
  // The world switches (model/features.js): the apps' (Control → Apps, Configure Settings → Apps), Configure
  // Settings → Phone rules and Integrations.
  hidden("world", "features", { name: "World switches", hint: "Which apps and phone features are on in this world.", type: Object, default: {} });
  // Set from the GM Phone's Control app: emoji, labels, app names, icons, the money format.
  hidden("world", "appearance", { name: "Look of every phone", hint: "Reaction emoji, labels, app names, icons and how money is written (Control).", type: Object, default: {} });
  // Where the phones' clock comes from (Configure Settings → Clock; util/agentTime.js).
  hidden("world", "clock", {
    name: "Phones' clock", hint: "Where the phones' time and date come from: Simple Calendar, SmallTime, system time, or the GM's own.", type: Object, default: {}
  });
  // BrainGen's sponsored content, one per line (empty: the built-in lines; see model/agent.js).
  hidden("world", "brainGenAds", { name: "Sponsored Cybereye ad lines", hint: "One per line; empty uses the built-in lines (Control → Labels).", type: String, default: "" });
  // What players see instead of the name when the GM hides caller ID (Control → Labels).
  hidden("world", "unknownLabel", { name: "Hidden caller ID", hint: "What players see instead of a name when the GM hides caller ID (Control → Labels).", type: String, default: "Unknown Number" });
  hidden("world", "noSignal", { name: "Characters without signal", hint: "Whose cellular service the GM cut, and when (Control → Characters).", type: Object, default: {} });
  hidden("client", "buttonPosition", { name: "Phone button position", hint: "Where you dragged the phone button.", type: Object, default: null });
  hidden("client", "gmButtonPosition", { name: "GM Phone button position", hint: "Where you dragged the GM Phone button.", type: Object, default: null });
  hidden("client", "directorButtonPosition", { name: "Director button position", hint: "Where you dragged the Director button.", type: Object, default: null });
  hidden("client", "questsSeen", { name: "Jobs seen", hint: "When you last looked at Jobs, for its new-job badge.", type: Number, default: 0 });
  // Where the minimised call card was dragged to (ui/CallWidget.js).
  hidden("client", "callWidgetPosition", { name: "Call card position", hint: "Where you dragged the minimised call card.", type: Object, default: null });

  registerSettingsMenus();
}

/**
 * Each app's own settings (apps/<id>/app.js `settings`). `redraw` redraws the phones when the setting
 * changes (with those change flags, or everything); an app's client.js `onSetting` runs its own code.
 */
function registerAppSettings() {
  for (const { key, app, redraw, ...data } of APP_SETTINGS) {
    const own = clients[app]?.onSetting?.[key];
    const change = redraw === "all" ? undefined : Object.fromEntries((redraw ?? []).map(flag => [flag, true]));
    game.settings.register(MODULE_ID, key, {
      scope: "world",
      config: false,
      ...data,
      onChange: redraw || own
        ? value => {
          if (redraw) for (const phone of AgentPhone.all()) phone.refresh(change);
          own?.(value);
        }
        : undefined
    });
  }
}

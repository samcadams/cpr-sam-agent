import { DEFAULT_SOUND, MODULE_ID } from "./config.js";
import { CallAudio } from "./ui/CallAudio.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";

/*
 * The module's settings. The ones with config: true are in Foundry's settings window; the rest are set
 * from the phones (Control, the apps' own settings) and kept out of sight.
 */

export function registerSettings() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true, ...data });

  world("sound", {
    name: "Text message sound",
    hint: "Played when a text arrives. Leave empty for silence.",
    type: String,
    default: DEFAULT_SOUND,
    filePicker: "audio"
  });
  world("ringtone", {
    name: "Ringtone",
    hint: "Looped for incoming calls, and quieter for the caller while it rings out.",
    type: String,
    default: DEFAULT_SOUND,
    filePicker: "audio"
  });
  world("moneySound", {
    name: "Money transfer sound",
    hint: "Played when a player transfers received eurobucks into their account.",
    type: String,
    default: "sounds/lock.wav",
    filePicker: "audio"
  });
  world("watchboxSound", {
    name: "WatchBox alarm",
    hint: "The alarm an armed WatchBox sounds at its spot. Leave empty to use the ringtone.",
    type: String,
    default: "",
    filePicker: "audio"
  });
  world("textToneAtToken", {
    name: "Text tone in the world",
    hint: "Play the text sound around the recipient's token on the active scene.",
    type: Boolean,
    default: true
  });
  world("ringAtToken", {
    name: "Ring in the world",
    hint: "While a call rings, play the ringtone around the recipient's token on the active scene.",
    type: Boolean,
    default: true
  });
  world("ringRadius", {
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

  client("volume", {
    name: "Phone volume",
    hint: "Your own phone: text tones and ringtones (0 mutes them). Also scaled by Foundry's Interface volume.",
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
    onChange: () => CallAudio.applyVolume()
  });
  client("worldVolume", {
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
  client("fontScale", {
    name: "Phone text size",
    hint: "How big the text is on your phone (also adjustable in the phone's settings).",
    type: Number,
    range: { min: 0.8, max: 1.5, step: 0.05 },
    default: 1,
    onChange: () => {
      for (const phone of AgentPhone.all()) phone.refresh();
    }
  });

  game.settings.register(MODULE_ID, "services", { scope: "world", config: false, type: Array, default: [] });
  // Set from the GM Phone's Control app.
  game.settings.register(MODULE_ID, "features", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "appearance", { scope: "world", config: false, type: Object, default: {} });
  // Where the phones' clock comes from (Control → Every phone → Clock; util/agentTime.js).
  game.settings.register(MODULE_ID, "clock", { scope: "world", config: false, type: Object, default: {} });
  // BangMe! pay points, Trauma Team's plans and rules, and the GM's saved SAAI alerts (see model/).
  game.settings.register(MODULE_ID, "payPoints", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "trauma", { scope: "world", config: false, type: Object, default: {} });
  // The Garden's outcome types and word lists (Garden → Control; model/garden.js gardenConfig).
  game.settings.register(MODULE_ID, "gardenConfig", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "savedAlerts", { scope: "world", config: false, type: Array, default: [] });
  // BrainGen's sponsored content, one per line (empty: the built-in lines; see model/agent.js).
  game.settings.register(MODULE_ID, "brainGenAds", { scope: "world", config: false, type: String, default: "" });
  // What players see instead of the name when the GM hides caller ID (Control → Labels).
  game.settings.register(MODULE_ID, "unknownLabel", { scope: "world", config: false, type: String, default: "Unknown Number" });
  game.settings.register(MODULE_ID, "noSignal", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "buttonPosition", { scope: "client", config: false, type: Object, default: null });
  game.settings.register(MODULE_ID, "gmButtonPosition", { scope: "client", config: false, type: Object, default: null });
  game.settings.register(MODULE_ID, "questsSeen", { scope: "client", config: false, type: Number, default: 0 });
  // Where the minimised call card was dragged to (ui/CallWidget.js).
  game.settings.register(MODULE_ID, "callWidgetPosition", { scope: "client", config: false, type: Object, default: null });

}

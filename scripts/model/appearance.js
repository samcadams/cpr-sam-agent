import { MODULE_ID } from "../config.js";
import { patchSetting } from "../util/settings.js";

/*
 * What the GM can restyle from the Control app (world setting "appearance"): the reaction emoji,
 * a few labels and the main icons. Anything not set falls back to these defaults.
 */

export const DEFAULT_EMOJI = [
  "👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🙏",
  "🔥", "💯", "❗", "❓", "👀", "💀", "🤘", "✅",
  "❌", "🤖", "💸", "🔫", "🚓", "🩸", "💊", "🚗",
  "🍺", "🎉", "😏", "🤡", "😬", "🫡", "🖕", "💥"
];

/** Emoji the GM can pick from in the Control app's emoji picker, by group. */
export const EMOJI_CATALOG = {
  Faces: ["😀", "😂", "🤣", "😅", "😊", "😉", "😍", "😘", "😎", "🤓", "😏", "😒", "🙄", "😬", "😮", "😱", "😢", "😭", "😡", "🤬", "🤯", "🥴", "😵", "🤢", "🤮", "🥶", "🥵", "😈", "👿", "💀", "☠️", "🤡", "👻", "👽", "🤖", "🫠", "🫡", "🤐", "🤫", "🤔"],
  Hands: ["👍", "👎", "👌", "✌️", "🤞", "🤘", "🤙", "👊", "✊", "👏", "🙌", "🙏", "🤝", "🖕", "💪", "🫵", "👋", "☝️", "👉", "🤌"],
  Hearts: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❤️‍🔥", "💕", "💯", "💢", "💥", "💫", "💦", "💨", "💤"],
  Street: ["🔫", "🔪", "🗡️", "💣", "🧨", "🩸", "💉", "💊", "🩹", "🚑", "🚓", "🚨", "🚗", "🏍️", "🚁", "🛰️", "💸", "💰", "💳", "💎", "📦", "🔒", "🔓", "🔑"],
  Tech: ["📱", "📞", "☎️", "📡", "💻", "🖥️", "⌨️", "🕹️", "💾", "📀", "🔋", "🔌", "🧠", "🦾", "🦿", "👁️", "🛠️", "⚙️", "🔧", "🧬"],
  Symbols: ["✅", "❌", "❗", "❓", "⚠️", "⛔", "🚫", "🔥", "⚡", "☢️", "☣️", "🎯", "🏆", "🎉", "🍺", "🍻", "🍸", "🚬", "🎸", "🎵", "⏰", "⌛", "📍", "👀"]
};

/** What each app is called on the dock, the home screen and its own header (Control → Labels → App names). */
export const APP_NAMES = {
  contacts: { name: "Contacts", default: "Contacts" },
  messages: { name: "Messages", default: "Messages" },
  quests: { name: "Jobs", default: "Jobs" },
  settings: { name: "Settings (players)", default: "Settings" },
  control: { name: "Control (GM)", default: "Control" },
  home: { name: "Apps (home screen)", default: "Apps" },
  agent: { name: "Agent", default: "Agent" },
  garden: { name: "The Garden", default: "The Garden" },
  alex: { name: "Ask Alex Anything", default: "Ask Alex Anything" },
  bangme: { name: "BangMe!", default: "BangMe!" },
  trauma: { name: "Trauma Team", default: "Trauma Team" },
  watchbox: { name: "WatchBox", default: "WatchBox" }
};

export const LABELS = {
  noSignal: { name: "No signal", default: "NO SIGNAL" },
  viewed: { name: "Read receipt", default: "Viewed" }
};

/** Font Awesome classes, e.g. "fas fa-comments" or "fa-regular fa-comments". */
export const ICONS = {
  contacts: { name: "Contacts app", default: "fas fa-address-book" },
  messages: { name: "Messages app", default: "fas fa-comments" },
  jobs: { name: "Jobs app", default: "fas fa-list-check" },
  apps: { name: "Apps (home screen)", default: "fas fa-grip" },
  agent: { name: "Agent app", default: "fas fa-robot" },
  garden: { name: "The Garden", default: "fas fa-seedling" },
  alex: { name: "Ask Alex Anything", default: "fas fa-magnifying-glass" },
  bangme: { name: "BangMe!", default: "fas fa-burst" },
  trauma: { name: "Trauma Team", default: "fas fa-truck-medical" },
  watchbox: { name: "WatchBox", default: "fas fa-eye" },
  control: { name: "Control app (GM)", default: "fas fa-sliders" },
  settings: { name: "Settings app", default: "fas fa-gear" },
  call: { name: "Call", default: "fas fa-phone" },
  location: { name: "Share a location", default: "fas fa-location-dot" },
  photo: { name: "Send a photo", default: "fas fa-camera" },
  money: { name: "Eurobucks", default: "fas fa-money-bill-transfer" }
};

const defaults = table => Object.fromEntries(Object.entries(table).map(([key, { default: value }]) => [key, value]));

/** Split what the GM typed into emoji: separated by spaces or commas. */
export const parseEmoji = text => [...new Set(String(text ?? "").split(/[\s,]+/).filter(Boolean))].slice(0, 64);

/** GM: change the saved look (only what the GM set; everything else keeps its default). */
export const updateAppearance = change => patchSetting("appearance", change);

export function appearance() {
  const saved = game.settings.get(MODULE_ID, "appearance") ?? {};
  const pick = (table, values = {}) => ({ ...defaults(table), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v)) });
  return {
    emoji: saved.emoji?.length ? saved.emoji : DEFAULT_EMOJI,
    labels: pick(LABELS, saved.labels),
    names: pick(APP_NAMES, saved.names),
    icons: pick(ICONS, saved.icons)
  };
}

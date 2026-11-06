import { MODULE_ID } from "../../config.js";
import { APP_IDS, APP_MANIFEST } from "../../apps/manifest.js";
import { appearance } from "../../model/appearance.js";
import { CITINET_APPS, citinetOffline, FEATURE_DEFAULTS, features, needsCitinet, setFeature, setNeedsCitinet } from "../../model/features.js";
import { SOUND_KINDS } from "../../model/sounds.js";

/*
 * The module's settings in groups, in the order a GM sets a world up. Each group with a `menu` is one of
 * Configure Settings' submenus (ui/settings/menus.js); api.settings gives the same groups to the Director's
 * Config page (T268), so both show the same sections.
 *
 * A key is a registered setting ("ringRadius"), or a switch inside an Object setting, written "setting.name":
 *   features.<name>      a world switch (model/features.js; app_<id> is an app's switch)
 *   citinetApps.<id>     whether a CitiNet app needs the CitiNet (model/features.js needsCitinet)
 * Registered settings carry their own name and hint; fields() describes the others. `menu` is the registerMenu
 * key in this module (Foundry's game.settings.menus has it as "cpr-sam-agent.<menu>").
 */

/** The world switches the groups show (not the apps'): { name: { name, hint, requires? } }. */
const FEATURE_FIELDS = {
  comms: { name: "Communications", hint: "Contacts, Messages and calls, together: none works without the others." },
  shareTexts: { name: "Share texts to chat", hint: "Players and the GM Phone can share a few texts from a conversation to chat." },
  images: { name: "Photos", hint: "The GM can send photos in Messages." },
  playerImages: {
    name: "Players can send photos", requires: "features.images",
    hint: "A link to a picture, or a file already on the server (that needs Foundry's \"Use File Browser\" permission)."
  },
  locations: { name: "Map pins", hint: "Share map pins and positions in Messages." },
  jobsAvailable: { name: "Players see the \"Available\" tab", hint: "Off: players see only their In Progress, Completed and Failed jobs." },
  freeInternal: { name: "Players can turn off the forced Internal Agent HUD", hint: "In their phone's Settings." },
  agentChat: { name: "Chat notice for a carried Agent", hint: "Say in chat when someone takes out or puts away their Agent (not an Internal Agent)." },
  agentChatWhisper: { name: "Only the GM sees it", requires: "features.agentChat", hint: "The chat notice is whispered to the GM, and only the GM sees the speech bubble." },
  blood: { name: "Blood overlay when hurt", hint: "Blood on the screen of a Seriously or Mortally Wounded character's phone." },
  anthropic: {
    name: "Enable Anthropic API Tools",
    hint: "Draft with Claude in Ask Alex and DataPool, and Ask Alex's Optional Anthropic API settings (the key stays in your browser, in Ask Alex). Off hides them all."
  }
};

const OFFLINE_HINTS = {
  browse: "Without a signal it stays browsable under a \"No CitiNet\" strip; what needs the CitiNet is refused.",
  block: "Without a signal it shows \"Cannot connect!\" and nothing in it can be browsed."
};

/**
 * The fields that aren't registered settings: { key: { name, hint, type, default, requires? } }. App names follow
 * the GM's own (Control → Labels), so this is worked out when asked.
 */
export function fields() {
  const { names } = appearance();
  const out = {};
  for (const [name, field] of Object.entries(FEATURE_FIELDS)) out[`features.${name}`] = { type: "Boolean", default: FEATURE_DEFAULTS[name], ...field };
  out["features.jobs"] = { name: names.quests ?? "Jobs", hint: "The Jobs app and job notices.", type: "Boolean", default: true };
  for (const id of APP_IDS) {
    out[`features.app_${id}`] = { name: names[id] ?? APP_MANIFEST[id].name, hint: APP_MANIFEST[id].blurb ?? "", type: "Boolean", default: !APP_MANIFEST[id].off };
  }
  for (const id of CITINET_APPS) {
    out[`citinetApps.${id}`] = { name: `${names[id] ?? APP_MANIFEST[id].name} needs the CitiNet`, hint: OFFLINE_HINTS[citinetOffline(id)], type: "Boolean", default: true };
  }
  return out;
}

/**
 * The groups: [{ id, label, hint?, menu?, keys, sections? }]. `sections` ([{ label, keys }]) are the headings
 * inside a submenu; `keys` is them all, in order.
 */
export function groups() {
  const section = (label, keys) => ({ label, keys });
  const list = [
    {
      id: "apps", label: "Apps", menu: "apps",
      hint: "Which apps every Agent has. Control → Apps and the Director's Setup have the same switches.",
      sections: [section("Apps", ["features.comms", "features.jobs", ...APP_IDS.map(id => `features.app_${id}`)])]
    },
    {
      id: "phoneRules", label: "Phone rules", menu: "phoneRules",
      hint: "What every phone may do: Messages' extras, Jobs, who has an Agent, Library Search, and which apps need the CitiNet.",
      sections: [
        section("Messages", ["features.shareTexts", "features.images", "features.playerImages", "features.locations"]),
        section("Jobs", ["features.jobsAvailable"]),
        section("Agents", ["requireAgentItem", "features.freeInternal", "features.agentChat", "features.agentChatWhisper", "features.blood"]),
        section("Library Search", ["agentLibraryBonus", "bigSaaiBonus"]),
        section("CitiNet", CITINET_APPS.map(id => `citinetApps.${id}`))
      ]
    },
    {
      id: "sounds", label: "Sounds", menu: "sounds",
      hint: "Every phone's default sounds (each phone can pick its own), and phones heard around the token.",
      sections: [
        section("Default sounds", Object.values(SOUND_KINDS).map(k => k.setting)),
        section("Sounds in the world", ["textToneAtToken", "ringAtToken", "ringRadius"])
      ]
    },
    {
      id: "clock", label: "Clock", menu: "clock",
      hint: "Where the phones' time and date come from.",
      sections: [section("Clock", ["clock"])]
    },
    {
      id: "integrations", label: "Integrations", menu: "integrations",
      hint: "The GM's Anthropic API tools and how Claude's drafts sound. The API key itself stays in Ask Alex, in your browser.",
      sections: [section("Anthropic API", ["features.anthropic", "alexAgentVoice"])]
    },
    {
      id: "items", label: "Agent items",
      hint: "Which items count as an Agent, an Internal Agent and a Biomonitor.",
      sections: [section("Items", ["agentNames", "internalAgentNames", "biomonitorNames"])]
    },
    {
      id: "thisBrowser", label: "This browser",
      hint: "Your own phone and GM tools, in this browser only.",
      sections: [section("This browser", [
        "volume", "worldVolume", "fontScale", "hudOpacity", "gmPopupSeconds", "gmPopupAnswers",
        "directorCalls", "monitorOpacity", "reduceMotion", "keepPopups"
      ])]
    }
  ];
  for (const group of list) group.keys = group.sections.flatMap(s => s.keys);
  return list;
}

/** A group's keys' current values (a dotted key reads its Object setting). */
export function getSetting(key) {
  const [setting, name] = key.split(".");
  if (!name) return game.settings.get(MODULE_ID, setting);
  if (setting === "features") return features()[name];
  if (setting === "citinetApps") return needsCitinet(name);
  throw new Error(`${MODULE_ID} | unknown setting "${key}"`);
}

/** Change one (GM, for world settings). */
export function setSetting(key, value) {
  const [setting, name] = key.split(".");
  if (!name) return game.settings.set(MODULE_ID, setting, value);
  if (setting === "features") return setFeature(name, value);
  if (setting === "citinetApps") return setNeedsCitinet(name, value);
  throw new Error(`${MODULE_ID} | unknown setting "${key}"`);
}

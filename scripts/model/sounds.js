import { MODULE_ID } from "../config.js";
import { getPhoneSettings } from "./agent.js";

/*
 * Phone sounds. The bundled ones are in sounds/ (all CC0; see sounds/CREDITS.md).
 *  - Every phone's defaults: the world settings "sound", "ringtone", "moneySound", "watchboxSound" and "fanfareSound"
 *    (Control → Every phone): a bundled sound's id, or a file path the GM picked.
 *  - Each phone's own choice: its phone settings' `sounds` ({ text, ring, money, alarm, fanfare }): a bundled
 *    sound's id, or "" for the default.
 */

const bundled = name => `modules/${MODULE_ID}/sounds/${name}.ogg`;

/** The kinds of sound: their label, the world setting with the default, and the bundled choices. */
export const SOUND_KINDS = {
  text: {
    label: "Text tone", setting: "sound",
    sounds: {
      "text-chime": "Chime", "text-ping": "Ping", "text-query": "Query", "text-rise": "Rise",
      "text-retro": "Retro", "text-terminal": "Terminal", "foundry-notify": "Foundry notify"
    }
  },
  ring: {
    label: "Ringtone", setting: "ringtone",
    sounds: {
      "ring-tuneup": "Tune up", "ring-generic": "Generic", "ring-cordless": "Cordless", "ring-classic": "Classic ring",
      "ring-desk": "Desk phone", "ring-tizzy": "Tizzy", "ring-alert": "Alert", "ring-arpeggio": "Arpeggio",
      "ring-chirp": "Chirp", "foundry-notify": "Foundry notify"
    }
  },
  money: {
    label: "Money Transfer", setting: "moneySound",
    sounds: {
      "money-kaching": "Ka-ching", "money-confirm": "Confirm", "money-up": "Level up", "foundry-lock": "Foundry lock"
    }
  },
  alarm: {
    label: "WatchBox alarm", setting: "watchboxSound",
    sounds: {
      "alarm-detector": "Detector", "alarm-security": "Security", "alarm-burglar": "Burglar siren", "alarm-digital": "Digital"
    }
  },
  fanfare: {
    label: "Achievement fanfare", setting: "fanfareSound",
    sounds: {
      "fanfare-arcade": "Arcade jingle", "fanfare-levelup": "Arcade level up", "fanfare-trophy": "Console trophy", "fanfare-chime": "Console chime",
      "fanfare-synth": "Synth stinger", "fanfare-sting": "Synth victory", "fanfare-party": "Party pop", "fanfare-tadaa": "Party tadaa"
    }
  }
};

/** The defaults a new world starts with (the world settings' defaults). */
export const SOUND_DEFAULTS = { text: "text-chime", ring: "ring-tuneup", money: "money-kaching", alarm: "alarm-detector", fanfare: "fanfare-arcade" };

/** Foundry's own sounds, offered alongside the bundled ones (the module used them before). */
const CORE = { "foundry-notify": "sounds/notify.wav", "foundry-lock": "sounds/lock.wav" };

/**
 * A sound's file: a bundled id, or a file path as given. Anything else (empty, or a sound that's no
 * longer bundled) is "" — no file.
 */
export function soundSrc(value) {
  if (!value) return "";
  if (value in CORE) return CORE[value];
  for (const kind of Object.values(SOUND_KINDS)) if (value in kind.sounds) return bundled(value);
  return value.includes("/") ? value : "";
}

/** Every phone's default for a kind (Control → Every phone), as a file; the built-in default if unset. */
export function defaultSound(kind) {
  return soundSrc(game.settings.get(MODULE_ID, SOUND_KINDS[kind].setting)) || soundSrc(SOUND_DEFAULTS[kind]);
}

/**
 * The file a phone plays for a kind of sound: its own choice, else the default. `owner`: a character
 * (their phone) or a GM's user (the GM Phone); without one, the default.
 */
export function phoneSound(owner, kind) {
  const choice = owner ? getPhoneSettings(owner).sounds?.[kind] : "";
  return soundSrc(choice) || defaultSound(kind);
}

/** The sound a call or text member's phone makes in the world: a character's own, an NPC's the default. */
export const memberSound = (member, kind) => phoneSound(member?.actorId ? game.actors.get(member.actorId) : null, kind);

/**
 * Options for a sound picker: the bundled sounds of a kind, and on a phone (`phone: true`) "Same as
 * every phone" first. A file path (a GM's own sound) is kept as "Custom".
 */
export function soundOptions(kind, current, { phone = false } = {}) {
  current = Object.keys(CORE).find(id => CORE[id] === current) ?? current; // saved as Foundry's path
  if (!soundSrc(current)) current = phone ? "" : SOUND_DEFAULTS[kind]; // unset, or no longer bundled
  const options = Object.entries(SOUND_KINDS[kind].sounds).map(([value, label]) => ({ value, label }));
  if (phone) options.unshift({ value: "", label: "Same as every phone" });
  if (current.includes("/") && !options.some(o => o.value === current)) options.push({ value: current, label: `Custom: ${current.split("/").pop()}` });
  return options.map(o => ({ ...o, selected: o.value === current }));
}

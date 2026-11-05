import { PLAYER_ROLES } from "./appSettings.js";
import { dropdown } from "./dropdown.js";
import { emojiCatalog } from "./settings.js";
import { ContactsManager } from "../../managers/ContactsManager.js";
import { MODULE_ID } from "../../../config.js";
import { DEFAULT_ADS } from "../../../model/agent.js";
import { APPS, appFeature } from "../../../model/apps.js";
import { APP_NAMES, appearance, ICONS, LABELS, parseEmoji, updateAppearance } from "../../../model/appearance.js";
import { formatMoney, moneyStyle } from "../../../model/money.js";
import { playerCharacters } from "../../../model/contacts.js";
import { CLEARABLE } from "../../../model/clearing.js";
import { features, setFeature } from "../../../model/features.js";
import { defaultSound, SOUND_KINDS, soundOptions } from "../../../model/sounds.js";
import { previewSound } from "../../../util/audio.js";
import { actorAvatar, displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";
import {
  agentTimestamp, CLOCK_SOURCES, clockSettings, customClockFields, customClockOffset, dateFieldFor, dateOffsetFor, localClockOffset, simpleCalendar
} from "../../../util/agentTime.js";
import { patchSetting } from "../../../util/settings.js";
import { esc, initials } from "../../../util/text.js";

/*
 * Phone page: the GM Phone's Control app. World-wide switches, each character's phone (signal,
 * wiping), the Contacts and Services managers, the GM Phone's own look and quick replies, the look
 * of every phone, blood on the screen, and wiping everything.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */


export const actions = {
  /** Every phone → Default sounds: hear one, or pick a file of the GM's own. */
  "default-sound-preview"({ kind }) {
    previewSound(defaultSound(kind));
  },
  "default-sound-file"({ kind }) {
    const setting = SOUND_KINDS[kind].setting;
    new FilePicker({ type: "audio", current: game.settings.get(MODULE_ID, setting), callback: path => game.settings.set(MODULE_ID, setting, path) }).render(true);
  },
  "control-signal"({ actorId }) {
    this._toggleSignal(actorId);
  },
  "control-contacts"({ actorId }) {
    ContactsManager.open(game.actors.get(actorId));
  },
  /** Clear one kind of app data, for everyone or the character picked. */
  "app-clear"({ target }) {
    const kind = CLEARABLE[target];
    const actor = kind?.perCharacter ? game.actors.get(this.clearFor) : null;
    if (!kind) return;
    Dialog.confirm({
      title: `Clear ${kind.label}`,
      content: `<p>Delete ${esc(kind.what)}${actor ? `, for <strong>${esc(displayName(actor))}</strong> only` : ", for everyone"}?</p><p class="notes">This can't be undone.</p>`,
      yes: () => store.request("app-clear", { target, actorId: actor?.id ?? null }),
      defaultYes: false
    });
  },
  /** Emoji, labels (app names included) and icons back to their defaults; the money format stays. */
  "control-reset-look"() {
    const { money } = game.settings.get(MODULE_ID, "appearance") ?? {};
    game.settings.set(MODULE_ID, "appearance", money ? { money } : {});
  },
};

export const inputs = {
  "input[data-feature]": {
    change(event) {
      setFeature(event.currentTarget.dataset.feature, event.currentTarget.checked);
    }
  },
  /** Every phone → Sounds in the world: the switches, and the radius (its label follows while dragging). */
  "input[data-world-setting]": {
    "input change"(event) {
      const input = event.currentTarget;
      const key = input.dataset.worldSetting;
      if (input.type === "checkbox") {
        if (event.type === "change") game.settings.set(MODULE_ID, key, input.checked);
        return;
      }
      const label = input.parentElement.querySelector(".agent-range-value");
      if (label) label.textContent = `${input.value} ${canvas.scene?.grid.units || "m"}`;
      if (event.type === "change") game.settings.set(MODULE_ID, key, Number(input.value));
    }
  },
  /** This GM Phone → Pop-ups: how long the GM's pop-ups stay (its label follows while dragging). */
  "input[data-gm-popup]": {
    "input change"(event) {
      const input = event.currentTarget;
      if (input.type === "checkbox") {
        if (event.type === "change") game.settings.set(MODULE_ID, "gmPopupAnswers", input.checked);
        return;
      }
      const seconds = Number(input.value);
      const label = input.parentElement.querySelector(".agent-range-value");
      if (label) label.textContent = seconds ? `${seconds}s` : "Usual";
      if (event.type === "change") game.settings.set(MODULE_ID, "gmPopupSeconds", seconds).then(() => this.render());
    }
  },
  "input[data-permission=playerUploads]": {
    change(event) {
      this._setPlayerUploads(event.currentTarget.checked);
    }
  },
  "textarea[name=emoji]": {
    change(event) {
      updateAppearance(look => (look.emoji = parseEmoji(event.currentTarget.value)));
    }
  },
  // Labels and icons show their current value; what's left at (or cleared back to) the default
  // isn't saved, so it follows the default.
  "input[data-label]": {
    change(event) {
      const { label } = event.currentTarget.dataset;
      const value = event.currentTarget.value.trim();
      updateAppearance(look => (look.labels = { ...look.labels, [label]: value === LABELS[label].default ? "" : value }));
    }
  },
  "input[data-app-name]": {
    change(event) {
      const { appName } = event.currentTarget.dataset;
      const value = event.currentTarget.value.trim();
      updateAppearance(look => (look.names = { ...look.names, [appName]: value === APP_NAMES[appName].default ? "" : value }));
    }
  },
  "input[data-icon]": {
    change(event) {
      const { icon } = event.currentTarget.dataset;
      const value = event.currentTarget.value.trim();
      updateAppearance(look => (look.icons = { ...look.icons, [icon]: value === ICONS[icon].default ? "" : value }));
    }
  },
  "textarea[name=brainGenAds]": {
    change(event) {
      const text = event.currentTarget.value.split("\n").map(l => l.trim()).filter(Boolean).join("\n");
      // Left as the built-in ads (or emptied): follow the built-in list.
      game.settings.set(MODULE_ID, "brainGenAds", text === DEFAULT_ADS.join("\n") ? "" : text);
    }
  },
  /** How money is written: a prefix and a suffix, either may be blank. */
  "input[data-money]": {
    change(event) {
      const part = event.currentTarget.dataset.money;
      updateAppearance(look => (look.money = { ...moneyStyle(), [part]: event.currentTarget.value.trim().slice(0, 6) }));
    }
  },

  /** Clock: "Day" before the day's number. */
  "input[name=clockDayPrefix]": {
    change(event) {
      patchSetting("clock", c => (c.dayPrefix = event.currentTarget.checked));
    }
  },
  /** Clock: system time on another date (from today, as it is now). */
  "input[name=clockOtherDate]": {
    change(event) {
      patchSetting("clock", c => (c.dateOffset = event.currentTarget.checked ? 0 : null));
    }
  },
  "input[name=clockSystemDate]": {
    change(event) {
      const days = dateOffsetFor(event.currentTarget.value);
      if (days !== null) patchSetting("clock", c => (c.dateOffset = days));
    }
  },
  /** Clock set by the GM: it runs on from the time and date entered. */
  "input[name=clockDate], input[name=clockTime]": {
    change(event) {
      const form = event.currentTarget.closest(".agent-clock");
      const offset = customClockOffset(form.querySelector("[name=clockDate]").value, form.querySelector("[name=clockTime]").value);
      if (offset !== null) patchSetting("clock", c => (c.offset = offset));
    }
  },
  "input[name=unknownLabel]": {
    change(event) {
      game.settings.set(MODULE_ID, "unknownLabel", event.currentTarget.value.trim() || "Unknown Number");
    }
  }
};

export const dropdowns = {
  /** Whose app data Clear app data clears: everyone's (""), or one character's. */
  clearFor(value) {
    this.clearFor = value || null;
    this.render();
  },
  /** Where the phones' clock comes from. The GM's own clock starts at this computer's time. */
  clockSource(value) {
    patchSetting("clock", c => {
      c.source = value;
      if (value === "custom" && !c.offset) c.offset = localClockOffset();
    });
  },
  /** Try the blood on the GM Phone: off, or as a Seriously or Mortally Wounded character sees it. */
  bloodPreview(value) {
    this.bloodPreview = value || null;
    this.render();
  }
};

// Every phone's default sound of each kind ("default-sound-text", …): saved, then played to hear it.
for (const [kind, { setting }] of Object.entries(SOUND_KINDS)) {
  dropdowns[`default-sound-${kind}`] = async function (value) {
    await game.settings.set(MODULE_ID, setting, value);
    previewSound(defaultSound(kind));
  };
}

export const methods = {
  controlData(ctx) {
    const on = features();
    const offline = game.settings.get(MODULE_ID, "noSignal") ?? {};
    const look = appearance();
    const rows = (table, values) => Object.entries(table).map(([key, { name, default: fallback }]) => ({
      key, name, value: values[key], placeholder: fallback, isDefault: values[key] === fallback
    }));
    return {
      features: [
        { key: "freeInternal", label: "Players can disable the forced Internal Agent skin", on: on.freeInternal },
        { key: "shareTexts", label: "Share a few texts from a conversation to chat (players and the GM Phone)", on: on.shareTexts },
        { key: "agentChat", label: "Say in chat when someone takes out or puts away their Agent (not an Internal Agent)", on: on.agentChat },
        { key: "agentChatWhisper", label: "Only the GM sees it (whispered)", on: on.agentChatWhisper, sub: true, disabled: !on.agentChat }
      ],
      comms: on.comms,
      apps: [
        // Contacts, Messages and Calls are one switch: none of them works without the others.
        {
          key: "comms", label: "Communications", icon: look.icons.messages, on: on.comms,
          title: `${look.names.contacts}, ${look.names.messages} and calls`
        },
        { key: "jobs", label: look.names.quests, icon: look.icons.jobs, on: on.jobs },
        ...Object.entries(APPS).map(([id]) => ({ key: appFeature(id), label: look.names[id], icon: look.icons[id], on: on[appFeature(id)] }))
      ],
      names: rows(APP_NAMES, look.names),
      blood: {
        on: on.blood,
        preview: dropdown("bloodPreview", [
          { value: "", label: "Off" },
          { value: "serious", label: "Seriously Wounded" },
          { value: "mortal", label: "Mortally Wounded" }
        ].map(o => ({ ...o, selected: o.value === (this.bloodPreview ?? "") })), { title: "Preview on this phone", cls: "agent-wide" })
      },
      defaultSounds: Object.entries(SOUND_KINDS).map(([kind, { label, setting }]) => ({
        kind, label, picker: dropdown(`default-sound-${kind}`, soundOptions(kind, game.settings.get(MODULE_ID, setting)), { title: label, cls: "agent-wide" })
      })),
      worldSounds: {
        textTone: game.settings.get(MODULE_ID, "textToneAtToken"),
        ring: game.settings.get(MODULE_ID, "ringAtToken"),
        radius: game.settings.get(MODULE_ID, "ringRadius"),
        units: canvas.scene?.grid.units || "m"
      },
      characters: playerCharacters().map(a => ({
        id: a.id,
        name: displayName(a),
        img: actorAvatar(a),
        initials: initials(displayName(a)),
        noSignal: !!offline[a.id],
        conversations: store.threadsFor(a.id).length
      })),
      phone: this.lookData(ctx),
      popups: {
        seconds: game.settings.get(MODULE_ID, "gmPopupSeconds"),
        answers: game.settings.get(MODULE_ID, "gmPopupAnswers")
      },
      emoji: look.emoji.join(" "),
      catalog: this.emojiCatalogOpen ? emojiCatalog(look.emoji) : null,
      labels: rows(LABELS, look.labels),
      icons: rows(ICONS, look.icons),
      unknownLabel: game.settings.get(MODULE_ID, "unknownLabel"),
      // The ads in use: the GM's, or the built-in ones (shown so they can be edited).
      ads: game.settings.get(MODULE_ID, "brainGenAds") || DEFAULT_ADS.join("\n"),
      money: { ...moneyStyle(), example: formatMoney(1500) },
      clock: this._clockData(),
      open: this.sectionsOpen(),
      clearing: this._clearingData(look)
    };
  },



  /** Control → Every phone → Clock: where the time comes from, and the GM's own time and date. */
  _clockData() {
    const clock = clockSettings();
    const custom = customClockFields(clock.offset);
    return {
      source: dropdown("clockSource", Object.entries(CLOCK_SOURCES).map(([value, label]) => ({ value, label, selected: value === clock.source })), { title: "Clock", cls: "agent-wide" }),
      noCalendar: clock.source === "calendar" && !simpleCalendar(),
      system: clock.source === "system" ? { otherDate: clock.dateOffset !== null, date: dateFieldFor(clock.dateOffset) } : null,
      custom: clock.source === "custom" ? custom : null,
      dayPrefix: clock.dayPrefix,
      now: agentTimestamp()
    };
  },

  /** Clear app data: the character picker, and a row of buttons per app that's in use. */
  _clearingData(look) {
    const pcs = playerCharacters();
    if (!pcs.some(a => a.id === this.clearFor)) this.clearFor = null;
    const apps = {};
    for (const [target, kind] of Object.entries(CLEARABLE)) {
      if (this.clearFor && !kind.perCharacter) continue;
      (apps[kind.app] ??= { name: look.names[kind.app], icon: look.icons[kind.app === "quests" ? "jobs" : kind.app], items: [] }).items.push({ target, label: kind.label });
    }
    return {
      who: dropdown("clearFor", [{ value: "", label: "Everyone" }, ...pcs.map(a => ({ value: a.id, label: displayName(a), selected: a.id === this.clearFor }))], { title: "Whose data", cls: "agent-wide" }),
      apps: Object.values(apps)
    };
  },

  /** Give Players and Trusted Players Foundry's "Upload New Files" permission, or take it away. */
  async _setPlayerUploads(on) {
    const permissions = foundry.utils.deepClone(game.permissions ?? {});
    const roles = new Set(permissions.FILES_UPLOAD ?? []);
    for (const role of PLAYER_ROLES()) on ? roles.add(role) : roles.delete(role);
    permissions.FILES_UPLOAD = [...roles].sort();
    await game.settings.set("core", "permissions", permissions);
    this.render();
  },

  /** Switch a character's cellular service off (holding their incoming messages) or back on. */
  _toggleSignal(actorId) {
    const offline = { ...(game.settings.get(MODULE_ID, "noSignal") ?? {}) };
    if (offline[actorId]) delete offline[actorId];
    else offline[actorId] = Date.now();
    return game.settings.set(MODULE_ID, "noSignal", offline);
  }
};

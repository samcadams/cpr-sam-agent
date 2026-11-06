import { setPlayerUploads } from "./appSettings.js";
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
import { actorAvatar, displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { esc, initials } from "../../../util/text.js";

/*
 * Phone page: the GM Phone's Control app. The apps' switches, each character's phone (signal,
 * wiping), the Contacts and Services managers, the GM Phone's own look and quick replies, the look
 * of every phone, blood on the screen, and wiping everything. The other world-wide rules, sounds and
 * the clock are in Configure Settings' submenus (ui/settings/menus.js); Control has buttons to them.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */


export const actions = {
  /** One of Configure Settings' submenus (ui/settings/menus.js): "apps", "phoneRules", "sounds", "clock", "integrations". */
  "open-settings-menu"({ menu }) {
    const type = game.settings.menus.get(`${MODULE_ID}.${menu}`)?.type;
    if (type) new type().render(true);
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
  /** A world setting's switch (Labels → Sponsored Cybereye ads). */
  "input[data-world-setting]": {
    change(event) {
      game.settings.set(MODULE_ID, event.currentTarget.dataset.worldSetting, event.currentTarget.checked);
    }
  },
  "input[data-permission=playerUploads]": {
    change(event) {
      setPlayerUploads(event.currentTarget.checked).then(() => this.render());
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
  /** Try the blood on the GM Phone: off, or as a Seriously or Mortally Wounded character sees it. */
  bloodPreview(value) {
    this.bloodPreview = value || null;
    this.render();
  }
};

export const methods = {
  controlData(ctx) {
    const on = features();
    const offline = game.settings.get(MODULE_ID, "noSignal") ?? {};
    const look = appearance();
    const rows = (table, values) => Object.entries(table).map(([key, { name, default: fallback }]) => ({
      key, name, value: values[key], placeholder: fallback, isDefault: values[key] === fallback
    }));
    return {
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
        preview: dropdown("bloodPreview", [
          { value: "", label: "Off" },
          { value: "serious", label: "Seriously Wounded" },
          { value: "mortal", label: "Mortally Wounded" }
        ].map(o => ({ ...o, selected: o.value === (this.bloodPreview ?? "") })), { title: "Preview on this phone", cls: "agent-wide" })
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
      emoji: look.emoji.join(" "),
      catalog: this.emojiCatalogOpen ? emojiCatalog(look.emoji) : null,
      labels: rows(LABELS, look.labels),
      icons: rows(ICONS, look.icons),
      unknownLabel: game.settings.get(MODULE_ID, "unknownLabel"),
      // The ads in use: the GM's, or the built-in ones (shown so they can be edited).
      ads: game.settings.get(MODULE_ID, "brainGenAds") || DEFAULT_ADS.join("\n"),
      adsOn: game.settings.get(MODULE_ID, "sponsoredAds"),
      money: { ...moneyStyle(), example: formatMoney(1500) },
      open: this.sectionsOpen(),
      clearing: this._clearingData(look)
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

  /** Switch a character's cellular service off (holding their incoming messages) or back on. */
  _toggleSignal(actorId) {
    const offline = { ...(game.settings.get(MODULE_ID, "noSignal") ?? {}) };
    if (offline[actorId]) delete offline[actorId];
    else offline[actorId] = Date.now();
    return game.settings.set(MODULE_ID, "noSignal", offline);
  }
};

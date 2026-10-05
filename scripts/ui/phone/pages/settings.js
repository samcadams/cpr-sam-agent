import { dropdown } from "./dropdown.js";
import { MODULE_ID } from "../../../config.js";
import { agentsOf, INTERNAL_THEMES, isSilenced, NOTIFY_STYLES, notifyStyle, SKINS, THEMES } from "../../../model/agent.js";
import { DEFAULT_DOCK, DOCK_MAX, phoneApps } from "../../../model/apps.js";
import { appearance, EMOJI_CATALOG, parseEmoji, updateAppearance } from "../../../model/appearance.js";
import { commsOn, feature } from "../../../model/features.js";

/** The emoji picker's groups, with the emoji already `chosen` lit. */
export function emojiCatalog(chosen) {
  const on = new Set(chosen);
  return Object.entries(EMOJI_CATALOG).map(([name, list]) => ({ name, emoji: list.map(e => ({ e, on: on.has(e) })) }));
}

/*
 * Phone page: the Settings app on a player's phone (which Agent, its look, its reaction keyboard,
 * quick replies). The look
 * part (skin, colour palette, app bar, lock screen…) is shared with the GM Phone, where it sits in
 * the Control app (see lookData and templates/phone/parts/look-settings.hbs).
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

export const actions = {
  "toggle-silent"() {
    const ctx = this.context();
    if (ctx) this._saveSettings({ silent: !isSilenced(ctx.settingsOwner) });
  },
  /** Open or close the emoji picker (players' reaction keyboard, or the GM's set for everyone). */
  "emoji-catalog"() {
    this.emojiCatalogOpen = !this.emojiCatalogOpen;
    this.render();
  },
  /** Add an emoji from the picker, or take it out again. */
  "emoji-toggle"({ emoji }) {
    const current = this._emojiSet();
    this._setEmoji(current.includes(emoji) ? current.filter(e => e !== emoji) : [...current, emoji]);
  },
  /** Player: back to the GM's reaction emoji. */
  "emoji-reset"() {
    this._saveSettings({ emoji: [] });
  }
};

export const dropdowns = {
  skin(value) {
    this._saveSettings({ skin: value });
  },
  /** The colour palette of skins that take one. */
  theme(value) {
    this._saveSettings({ theme: value });
  },
  /** The colour palette of the Internal Agent HUD. */
  internalTheme(value) {
    this._saveSettings({ internalTheme: value });
  }
};

export const inputs = {
  /** Which sections of Settings and Control are open (kept across redraws). */
  "details[data-section]": {
    toggle(event) {
      this.sectionsOpen()[event.currentTarget.dataset.section] = event.currentTarget.open;
    }
  },
  "textarea[name=phoneEmoji]": {
    change(event) {
      this._setEmoji(parseEmoji(event.currentTarget.value));
    }
  },
  "textarea[name=quickReplies]": {
    change(event) {
      const quickReplies = event.currentTarget.value.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 12);
      this._saveSettings({ quickReplies });
    }
  },
  /** Getting around: a dock, or a home screen and a Home button. */
  "input[name=navigation]": {
    change(event) {
      const navigation = event.currentTarget.value === "home" ? "home" : "dock";
      this._saveSettings({ navigation });
    }
  },
  /** How a new text shows up on this phone when its conversation isn't open. */
  "input[name=notifyStyle]": {
    change(event) {
      const notify = event.currentTarget.value;
      if (notify in NOTIFY_STYLES) this._saveSettings({ notify });
    }
  },
  "input[name=agentChoice]": {
    change(event) {
      this._saveSettings({ agent: event.currentTarget.value });
    }
  },
  /** On/off settings of this phone. "dock" is the app bar: down the side when on. */
  "input[data-phone-setting]": {
    change(event) {
      const { phoneSetting } = event.currentTarget.dataset;
      const on = event.currentTarget.checked;
      this._saveSettings({ [phoneSetting]: phoneSetting === "dock" ? (on ? "side" : "bottom") : on });
    }
  },
  /** An app on the dock, or off it (then it's on the home screen). */
  "input[data-dock-app]": {
    change(event) {
      const ctx = this.context();
      if (!ctx) return;
      const id = event.currentTarget.dataset.dockApp;
      const current = new Set(ctx.settings.dockApps ?? DEFAULT_DOCK);
      if (event.currentTarget.checked) current.add(id);
      else current.delete(id);
      // Kept in the phone's own app order.
      const ids = phoneApps({ gm: ctx.perspective === "gm", internal: ctx.internal }).map(a => a.id).filter(a => current.has(a));
      this._saveSettings({ dockApps: ids.slice(0, DOCK_MAX) });
    }
  },
  "input[name=hudOpacity]": {
    "input change"(event) {
      const value = Number(event.currentTarget.value);
      this.element[0].style.setProperty("--hud-alpha", value);
      if (event.type === "change") game.settings.set(MODULE_ID, "hudOpacity", value);
    }
  },
  /** Text size: previewed while dragging, saved on release. */
  "input[name=fontScale]": {
    "input change"(event) {
      const value = Number(event.currentTarget.value);
      this.element[0].style.setProperty("--agent-font-scale", value);
      const label = event.currentTarget.parentElement.querySelector(".agent-font-scale-value");
      if (label) label.textContent = `${Math.round(value * 100)}%`;
      if (event.type === "change") game.settings.set(MODULE_ID, "fontScale", value);
    }
  }
};

export const methods = {
  settingsData(ctx) {
    const agents = agentsOf(ctx.subject.actor);
    const emoji = this._emojiSet(ctx);
    return {
      owner: ctx.subject.name,
      agentChoice: agents.internal && agents.agent ? { internal: ctx.internal } : null,
      look: this.lookData(ctx),
      comms: commsOn(), // quick replies and the reaction keyboard are for Messages
      quickReplies: ctx.settings.quickReplies.join("\n"),
      open: this.sectionsOpen(),
      emoji: {
        text: emoji.join(" "),
        custom: !!ctx.settings.emoji?.length,
        catalog: this.emojiCatalogOpen ? emojiCatalog(emoji) : null
      }
    };
  },

  /**
   * The reaction keyboard this phone edits: a player's own (their phone's settings, starting from
   * the GM's set), or on the GM Phone the set every phone gets by default (Control).
   */
  _emojiSet(ctx = this.context()) {
    if (ctx?.perspective === "pc" && ctx.settings.emoji?.length) return ctx.settings.emoji;
    return appearance().emoji;
  },

  _setEmoji(list) {
    const emoji = parseEmoji(list.join(" "));
    if (this.context()?.perspective === "pc") return this._saveSettings({ emoji });
    return updateAppearance(look => (look.emoji = emoji));
  },

  /** How this phone looks and behaves: shown in Settings (players) and Control (GM). */
  lookData(ctx) {
    const s = ctx.settings;
    const { hud, skin, forced } = ctx.look;
    const info = SKINS[skin];
    const fontScale = game.settings.get(MODULE_ID, "fontScale");
    const options = (table, current) => Object.entries(table).map(([value, label]) => ({ value, label, selected: value === current }));
    let palette = null;
    if (hud) palette = dropdown("internalTheme", options(INTERNAL_THEMES, ctx.look.theme), { title: "HUD colours", cls: "agent-wide" });
    else if (info.palettes) palette = dropdown("theme", options(THEMES, ctx.look.theme), { title: "Colour palette", cls: "agent-wide" });
    return {
      hud,
      // A forced Internal Agent picks among the HUDs only.
      skin: dropdown("skin", Object.entries(SKINS).filter(([, k]) => !forced || k.hud).map(([value, k]) => ({ value, label: k.name, selected: value === skin })), { title: "Skin", cls: "agent-wide" }),
      blurb: forced ? `Your Internal Agent projects a HUD over your eyes. ${info.blurb}` : info.blurb,
      palette,
      paletteNote: palette ? null : `${info.name} brings its own colours.`,
      canDockSide: !!info.dockSide,
      dockSide: ctx.look.dockSide,
      freeInternal: ctx.internal && feature("freeInternal") ? { on: !!s.freeInternal } : null,
      dock: this._dockChoices(ctx),
      homeNavigation: this.homeNavigation(ctx),
      hudOpacity: hud || info.opacity ? game.settings.get(MODULE_ID, "hudOpacity") : null,
      opacityLabel: hud ? "HUD opacity" : "Opacity",
      fontScale: { value: fontScale, percent: Math.round(fontScale * 100) },
      notify: Object.entries(NOTIFY_STYLES).map(([value, label]) => ({ value, label, checked: value === notifyStyle(ctx.settingsOwner) })),
      lockScreen: !!s.lockScreen,
      // Messages' own: new-text notifications, split view and SIM tiles (while Communications are on).
      comms: commsOn(),
      split: !!s.split,
      simTiles: ctx.perspective === "gm" ? { on: !!s.simTiles } : null
    };
  },

  /** Settings' and Control's sections, open or closed: the first few start open. */
  sectionsOpen() {
    return (this.openSections ??= { agent: true, look: true, characters: true, apps: true });
  },

  /** The dock checklist: every app this phone has, ticked if it's on the dock (at most DOCK_MAX). */
  _dockChoices(ctx) {
    const { dock } = this.dockSplit(ctx);
    const on = new Set(dock.map(a => a.id));
    const full = on.size >= DOCK_MAX;
    const apps = phoneApps({ gm: ctx.perspective === "gm", internal: ctx.internal });
    return { apps: apps.map(a => ({ ...a, on: on.has(a.id), disabled: full && !on.has(a.id) })), max: DOCK_MAX };
  }
};

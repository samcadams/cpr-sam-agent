import { MODULE_ID } from "../../config.js";
import { appearance } from "../../model/appearance.js";
import { defaultSound, SOUND_KINDS, soundOptions } from "../../model/sounds.js";
import { previewSound } from "../../util/audio.js";
import { esc } from "../../util/text.js";
import { playersCanUpload, setPlayerUploads } from "../phone/pages/appSettings.js";
import { clockData, setClockDayPrefix, setClockOtherDate, setClockSource, setClockSystemDate, setCustomClock } from "./clock.js";
import { fieldHtml, fieldOf, rangeLabel, readValue, sectionHtml } from "./form.js";
import { fields, getSetting, groups, setSetting } from "./groups.js";

/*
 * Configure Settings' submenus, one per group with a `menu` (groups.js): Apps, Phone rules, Sounds, Clock and
 * Integrations. A change saves at once (no Save step), and an open submenu redraws when one of this module's
 * settings changes. Apps, Phone rules and Integrations are drawn from their groups' keys (form.js); Sounds and
 * Clock have their own templates (templates/settings/).
 */

/** A key's definition: its registry entry, or fields()' for a dotted key. */
export const defOf = key => (key.includes(".") ? fields()[key] : game.settings.settings.get(`${MODULE_ID}.${key}`)) ?? { name: key };

/** A key's field, disabled while the key it `requires` is off. */
function fieldFor(key, options = {}) {
  const def = defOf(key);
  return fieldOf(key, def, getSetting(key), { disabled: !!def.requires && !getSetting(def.requires), ...options });
}

const closeButton = `<footer class="sheet-footer flexrow"><button type="button" data-close><i class="fas fa-check"></i> Close</button></footer>`;

class SettingsMenu extends FormApplication {
  /** The group (groups.js id) this submenu shows. */
  static group = "";

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `ctp-settings-${this.group}`,
      classes: ["ctp-config-menu"],
      title: groups().find(g => g.id === this.group)?.label ?? "",
      width: 560,
      height: "auto",
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false
    });
  }

  get group() {
    return groups().find(g => g.id === this.constructor.group);
  }

  /** Redraw when one of this module's settings (or Foundry's permissions) changes, while open. */
  render(force, options) {
    if (!this._hooks) {
      const redraw = setting => {
        const key = typeof setting === "string" ? setting : setting?.key;
        if (key?.startsWith(`${MODULE_ID}.`) || key === "core.permissions") this.render();
      };
      this._hooks = ["createSetting", "updateSetting", "clientSettingChanged"].map(hook => [hook, Hooks.on(hook, redraw)]);
    }
    return super.render(force, options);
  }

  async close(options) {
    for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
    this._hooks = null;
    return super.close(options);
  }

  /** Nothing to submit: every change is saved as it's made. */
  async _updateObject() {}

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelector("[data-close]")?.addEventListener("click", () => this.close());
    // A slider's value (and unit) follows while dragging; Foundry's own change handler drops the unit.
    const label = input => {
      const shown = input.parentElement.querySelector(".range-value");
      if (shown) shown.textContent = rangeLabel(input.value, input.dataset.unit);
    };
    root.addEventListener("input", event => {
      if (event.target.type === "range") label(event.target);
    });
    root.addEventListener("change", event => {
      const el = event.target;
      if (el.type === "range") label(el);
      if (el.dataset.permission === "playerUploads") return setPlayerUploads(el.checked);
      const key = el.dataset.key;
      if (!key) return;
      const value = readValue(fieldOf(key, defOf(key), null), el);
      if (value !== null) setSetting(key, value);
    });
  }
}

/** A submenu drawn from its group's sections and keys. */
class GroupMenu extends SettingsMenu {
  async _renderInner() {
    const { hint, sections } = this.group;
    const body = sections.map(s => sectionHtml({ label: s.label, note: this.note(s), rows: s.keys.flatMap(key => this.rows(key)) }));
    return $(`<form class="ctp-config" autocomplete="off">${hint ? `<p class="notes">${esc(hint)}</p>` : ""}${body.join("")}${closeButton}</form>`);
  }

  /** A note under a section's heading. */
  note() {
    return "";
  }

  /** A key's rows. */
  rows(key) {
    return [fieldHtml(fieldFor(key))];
  }
}

/** Which of appearance().icons an app switch shows. */
const iconOf = key => ({ "features.comms": "messages", "features.jobs": "jobs" })[key] ?? key.replace("features.app_", "");

export class AppsMenu extends GroupMenu {
  static group = "apps";

  rows(key) {
    return [fieldHtml(fieldFor(key, { icon: appearance().icons[iconOf(key)] ?? null }))];
  }
}

export class PhoneRulesMenu extends GroupMenu {
  static group = "phoneRules";

  note(section) {
    return section.label === "CitiNet"
      ? "Off: the app works without a signal. On, without one: a \"browsable\" app stays open under a \"No CitiNet\" strip; a \"Cannot connect!\" app shows nothing. Each hint says which it is."
      : "";
  }

  /** Under "Players can send photos": Foundry's "Upload New Files" permission for Players and Trusted Players. */
  rows(key) {
    const rows = super.rows(key);
    if (key !== "features.playerImages") return rows;
    const disabled = !getSetting("features.images") || !getSetting("features.playerImages");
    rows.push(`<div class="form-group${disabled ? " disabled" : ""}">
      <label>Players can upload photos</label>
      <div class="form-fields"><input type="checkbox" data-permission="playerUploads" ${playersCanUpload() ? "checked" : ""} ${disabled ? "disabled" : ""}></div>
      <p class="notes">Sets Foundry's "Upload New Files" permission for Players and Trusted Players. Uploads go in the world's cpr-sam-agent/agent-photos folder.</p>
    </div>`);
    return rows;
  }
}

export class IntegrationsMenu extends GroupMenu {
  static group = "integrations";

  note() {
    return "The Anthropic API key stays in Ask Alex: GM Phone → Ask Alex → Optional Anthropic API, in this browser only.";
  }
}

/** Every phone's default sounds, and phones heard around the token. */
export class SoundsMenu extends SettingsMenu {
  static group = "sounds";

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { template: `modules/${MODULE_ID}/templates/settings/sounds.hbs` });
  }

  getData() {
    const units = canvas.scene?.grid.units || "m";
    return {
      hint: this.group.hint,
      kinds: Object.entries(SOUND_KINDS).map(([kind, { label, setting }]) => ({ kind, label, options: soundOptions(kind, game.settings.get(MODULE_ID, setting)) })),
      world: ["textToneAtToken", "ringAtToken", "ringRadius"].map(key => fieldHtml(fieldFor(key, { unit: key === "ringRadius" ? units : "" }))).join("")
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    // Picking a sound saves it, then plays it.
    for (const select of root.querySelectorAll("select[data-sound-kind]")) {
      select.addEventListener("change", async () => {
        const { kind } = select.dataset;
        await game.settings.set(MODULE_ID, SOUND_KINDS[kind].setting, select.value);
        previewSound(defaultSound(kind));
      });
    }
    for (const button of root.querySelectorAll("[data-sound-play]")) {
      button.addEventListener("click", () => previewSound(defaultSound(button.dataset.soundPlay)));
    }
    for (const button of root.querySelectorAll("[data-sound-file]")) {
      button.addEventListener("click", () => {
        const kind = button.dataset.soundFile;
        const setting = SOUND_KINDS[kind].setting;
        new FilePicker({
          type: "audio", current: game.settings.get(MODULE_ID, setting),
          callback: async path => {
            await game.settings.set(MODULE_ID, setting, path);
            previewSound(defaultSound(kind));
          }
        }).render(true);
      });
    }
  }
}

/** Where the phones' time and date come from (ui/settings/clock.js). */
export class ClockMenu extends SettingsMenu {
  static group = "clock";

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { template: `modules/${MODULE_ID}/templates/settings/clock.hbs` });
  }

  getData() {
    return { hint: this.group.hint, ...clockData() };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    const on = (name, fn) => root.querySelector(`[name=${name}]`)?.addEventListener("change", event => fn(event.currentTarget));
    on("clockSource", el => setClockSource(el.value));
    on("clockDayPrefix", el => setClockDayPrefix(el.checked));
    on("clockOtherDate", el => setClockOtherDate(el.checked));
    on("clockSystemDate", el => setClockSystemDate(el.value));
    const custom = () => setCustomClock(root.querySelector("[name=clockDate]").value, root.querySelector("[name=clockTime]").value);
    on("clockDate", custom);
    on("clockTime", custom);
  }
}

/** The submenus, in the order Configure Settings shows them: registerMenu key → [type, icon]. */
const MENUS = {
  apps: [AppsMenu, "fas fa-mobile-screen"],
  phoneRules: [PhoneRulesMenu, "fas fa-scale-balanced"],
  sounds: [SoundsMenu, "fas fa-volume-high"],
  clock: [ClockMenu, "fas fa-clock"],
  integrations: [IntegrationsMenu, "fas fa-plug"]
};

/** Register the submenus (settings.js registerSettings, at init). */
export function registerSettingsMenus() {
  const byMenu = Object.fromEntries(groups().filter(g => g.menu).map(g => [g.menu, g]));
  for (const [menu, [type, icon]] of Object.entries(MENUS)) {
    const { label, hint } = byMenu[menu];
    game.settings.registerMenu(MODULE_ID, menu, { name: label, label: `Open ${label}`, hint, icon, type, restricted: true });
  }
}

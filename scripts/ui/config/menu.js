import { MODULE_ID } from "../../config.js";
import { esc } from "../../util/text.js";
import { fieldHtml, readValue } from "./fields.js";
import { ruleSections, saveRule } from "./settings.js";

/*
 * Configure Settings → App rules: each app's simple values (apps/<id>/app.js `rules`), one section per
 * app, drawn by the generic form (fields.js) the Director's Config view uses too. A change saves at once
 * to the app's own setting, the one its GM page writes; open windows redraw when a rule changes.
 */

// A FormApplication: Foundry's registerMenu takes nothing else in v12. Fields save on change, so there's no submit.
export class AppRulesMenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ctp-app-rules",
      classes: ["ctp-config-menu"],
      title: "App rules",
      width: 560,
      height: 640,
      resizable: true,
      closeOnSubmit: false
    });
  }

  async _renderInner() {
    const sections = ruleSections().map(s => `<fieldset class="ctp-config-group" data-app="${esc(s.app)}"><legend>${esc(s.name)}</legend>
      ${s.fields.map(field => fieldHtml(field)).join("")}</fieldset>`).join("");
    return $(`<form class="ctp-config" autocomplete="off"><p class="notes">Changes save at once. The apps' own GM pages (GM Phone, Director) have the same controls.</p>${sections}</form>`);
  }

  async _updateObject() {}

  activateListeners(html) {
    super.activateListeners(html);
    html[0].addEventListener("change", async event => {
      const el = event.target.closest("[data-field]");
      const field = el && ruleSections().flatMap(s => s.fields).find(f => f.id === el.dataset.field);
      if (field) await saveRule(field.id, readValue(field, el));
    });
    html[0].addEventListener("input", event => {
      if (event.target.type === "range") event.target.nextElementSibling.value = event.target.value;
    });
  }
}

/** The App rules submenu in Configure Settings (at init). Its windows redraw when an app's setting changes. */
export function registerAppRulesMenu() {
  game.settings.registerMenu(MODULE_ID, "appRules", {
    name: "App rules",
    label: "App rules",
    hint: "Each app's simple values: prices, timers, DVs, switches. The apps' GM pages have the same controls.",
    icon: "fas fa-sliders",
    type: AppRulesMenu,
    restricted: true
  });
  const redraw = setting => {
    if (!setting.key.startsWith(`${MODULE_ID}.`)) return;
    for (const app of Object.values(ui.windows)) if (app instanceof AppRulesMenu) app.render();
  };
  Hooks.on("updateSetting", redraw);
  Hooks.on("createSetting", redraw);
}

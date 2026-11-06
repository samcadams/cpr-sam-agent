import { fieldHtml, readValue } from "../../config/fields.js";
import { configModules, groupFields, groupSections, menuButton, openMenu, ruleSections, saveRule, saveSetting } from "../../config/settings.js";
import { esc } from "../../../util/text.js";
import { label } from "./garden.js";
import { pageHead, redraw } from "./railed.js";

/*
 * Director → Config: every module's settings, as Foundry's Configure Settings has them (the source of
 * truth; this view mirrors it). A rail of the active modules that list their settings in api.settings
 * (ui/config/settings.js), then App rules (each app's `rules` over its config object, the same form as the
 * Agent's App rules submenu). Each group is drawn from Foundry's settings registry by the generic form
 * (ui/config/fields.js); a group with a submenu gets its "Open …" button. A change saves at once; client
 * settings change only this browser's copy, and settings that need a reload ask for one.
 * Redrawn on updateSetting (installDirector) and when Configure Settings closes (client settings fire no hook).
 * Text and number fields keep what's being typed across redraws (drafts "cfg:<field id>").
 */

const RULES = "rules";

/** The rail: each shown module, then App rules. */
function railOf() {
  return [...configModules().map(m => ({ id: m.id, name: m.title, icon: "fa-puzzle-piece", module: m })), { id: RULES, name: "App rules", icon: "fa-sliders" }];
}

const openOf = (director, rail) => {
  const state = director.stateOf("config");
  if (!rail.some(r => r.id === state.open)) state.open = rail[0].id;
  return state.open;
};

const draftOf = (director, field) => director.drafts[`cfg:${field.id}`];

function fieldsHtml(director, fields, action) {
  return fields.map(field => fieldHtml(field, {
    attrs: `data-director="${action}"${["text", "number"].includes(field.kind) ? ` data-draft="cfg:${esc(field.id)}"` : ""}`,
    draft: draftOf(director, field)
  })).join("");
}

function moduleHtml(director, mod) {
  if (!mod.groups.length) return `<p class="director-empty">${esc(mod.title)} lists no settings yet.</p>`;
  return mod.groups.map(group => {
    const menu = group.menu ? menuButton(mod.id, group.menu) : null;
    const tools = menu ? `<button type="button" data-director="config-menu" data-ns="${esc(mod.id)}" data-menu="${esc(group.menu)}"><i class="fas fa-up-right-from-square" aria-hidden="true"></i> ${esc(menu.label)}</button>` : "";
    return `<section class="ctp-config-group" data-group="${esc(group.id)}">${label(esc(group.label), tools)}
      ${group.hint ? `<p class="director-note">${esc(group.hint)}</p>` : ""}
      ${groupSections(mod.id, group).map(s => `${s.label && s.label !== group.label ? `<h4 class="ctp-config-section">${esc(s.label)}</h4>` : ""}${fieldsHtml(director, s.fields, "config-set")}`).join("")}</section>`;
  }).join("");
}

function rulesHtml(director) {
  const sections = ruleSections();
  if (!sections.length) return `<p class="director-empty">No app has rules yet.</p>`;
  return sections.map(s => `<section class="ctp-config-group" data-app="${esc(s.app)}">${label(esc(s.name))}
    ${fieldsHtml(director, s.fields, "config-rule")}</section>`).join("");
}

function headHtml(open, rail) {
  const entry = rail.find(r => r.id === open);
  return open === RULES
    ? pageHead("App rules", "Each app's simple values. The apps' own GM pages have the same controls.")
    : pageHead(entry.name, "Its settings in Foundry's Configure Settings, by section.");
}

function railHtml(open, rail) {
  return `<ol class="director-rail" aria-label="Settings">${rail.map((r, i) => `<li><button type="button" class="${r.id === open ? "active" : ""}" aria-pressed="${r.id === open}" data-director="config-open" data-open="${esc(r.id)}">
    <span class="director-rail-n">${String(i + 1).padStart(2, "0")}</span> <i class="fas ${r.icon}" aria-hidden="true"></i> ${esc(r.name)}</button></li>`).join("")}</ol>`;
}

function pageHtml(director, open, rail) {
  const body = open === RULES ? rulesHtml(director) : moduleHtml(director, rail.find(r => r.id === open).module);
  return `<p class="director-note"><i class="fas fa-circle-info"></i> Changes save at once, to the same settings as Configure Settings.</p><div class="ctp-config">${body}</div>`;
}

export function html(director) {
  const rail = railOf();
  const open = openOf(director, rail);
  return `<div class="director-railed director-config" data-app="${esc(open)}">
    <nav class="director-railed-rail" data-part="rail">${railHtml(open, rail)}</nav>
    <div class="director-railed-main">
      <header class="director-railed-head" data-part="head">${headHtml(open, rail)}</header>
      <div class="director-page" data-part="page">${pageHtml(director, open, rail)}</div>
    </div>
  </div>`;
}

export function refresh(director, root) {
  const rail = railOf();
  const open = openOf(director, rail);
  const el = root.querySelector(".director-config");
  if (!el || el.dataset.app !== open) {
    root.innerHTML = html(director);
    return;
  }
  el.querySelector('[data-part="rail"]').innerHTML = railHtml(open, rail);
  redraw(el.querySelector('[data-part="page"]'), pageHtml(director, open, rail));
}

/** The field a control belongs to, as drawn now (its type and kind). */
function fieldFor(id, rule) {
  if (rule) return ruleSections().flatMap(s => s.fields).find(f => f.id === id);
  for (const mod of configModules()) {
    for (const group of mod.groups) {
      const field = groupFields(mod.id, group).find(f => f.id === id);
      if (field) return field;
    }
  }
  return null;
}

/** A control changed: save it (text and numbers on change, not while typing), drop its draft, redraw. */
async function save(director, data, event, rule) {
  if (event.type !== "change") return;
  const field = fieldFor(data.field, rule);
  if (!field) return;
  const value = readValue(field, event.target);
  await (rule ? saveRule(field.id, value) : saveSetting(field.id, value));
  delete director.drafts[`cfg:${field.id}`];
  director.refresh({ settings: true }); // client settings fire no hook
}

export const actions = {
  "config-open"({ open }) {
    this.stateOf("config").open = open;
    this.refresh({ all: true });
  },
  "config-set"(data, event) {
    return save(this, data, event, false);
  },
  "config-rule"(data, event) {
    return save(this, data, event, true);
  },
  "config-menu"({ ns, menu }) {
    openMenu(ns, menu);
  }
};

/** Range sliders show their value as they move. */
export function attach(director, root) {
  for (const input of root.querySelectorAll(".ctp-config-range input")) input.oninput = () => (input.nextElementSibling.value = input.value);
}

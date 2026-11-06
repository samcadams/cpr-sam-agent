import { MODULE_ID } from "../../config.js";
import { APP_MANIFEST, APP_RULES } from "../../apps/manifest.js";
import { appearance } from "../../model/appearance.js";
import { fieldOf, getPath, setPath } from "./fields.js";

/*
 * What the generic settings form shows and how it saves, read from Foundry: the modules' setting groups
 * (each module's api.settings), each setting's field from the registry (game.settings.settings), the
 * apps' rules over their config objects. Foundry's settings stay the source of truth: everything here
 * reads and writes the same stored values Configure Settings does.
 *
 * A module's groups (root ARCHITECTURE §3): game.modules.get(id).api.settings =
 *   { groups: [{ id, label, hint?, menu?, keys: [...], sections?: [{ label, keys }] }], fields?, get?, set? }
 *   keys      its setting keys, in order: a registered setting, or "setting.name" for a value inside an Object setting
 *   menu      a registerMenu key of that module: the group's "Open …" button
 *   sections  headings inside the group (keys is them all)
 *   fields    { [key]: { name, hint, type, default, range?, choices? } } for the keys that aren't registered settings
 *   get/set   (key) / (key, value): read and write any of its keys (dotted ones too); without them, game.settings
 */

/** The modules whose settings the Director shows, in order (only the active ones that expose api.settings). */
export const CONFIG_MODULES = [MODULE_ID, "cpr-hq", "cpr-sheet-skin"];

/** Each shown module: [{ id, title, groups }]. */
export function configModules() {
  return CONFIG_MODULES.flatMap(id => {
    const mod = game.modules.get(id);
    const api = mod?.active ? mod.api?.settings : null;
    const groups = typeof api?.groups === "function" ? api.groups() : api?.groups;
    return Array.isArray(groups) ? [{ id, title: mod.title, groups }] : [];
  });
}

/** A registered menu's "Open …" button: { label, data }, or null. */
export function menuButton(ns, menu) {
  const m = game.settings.menus.get(`${ns}.${menu}`);
  if (!m) return null;
  return { label: game.i18n.localize(m.label || m.name), data: { director: "config-menu", ns, menu } };
}

/** Open a registered menu (a settings submenu). */
export function openMenu(ns, menu) {
  const m = game.settings.menus.get(`${ns}.${menu}`);
  if (m?.type) new m.type().render(true);
}

/** A module's api.settings (only while it's active). */
const apiOf = ns => (game.modules.get(ns)?.active ? game.modules.get(ns).api?.settings : null) ?? null;

/** Its api.settings.fields (a value or a function giving one). */
function fieldsOf(ns) {
  const fields = apiOf(ns)?.fields;
  return (typeof fields === "function" ? fields() : fields) ?? {};
}

/** A key's value: through the module's api.settings.get when it has one (it reads dotted keys), else Foundry's. */
function valueOf(ns, key) {
  const api = apiOf(ns);
  return typeof api?.get === "function" ? api.get(key) : game.settings.get(ns, key);
}

/**
 * One key's field: a registered setting from Foundry's registry, or a value inside an Object setting
 * ("features.app_garden") from the module's api.settings.fields. An object setting opens its group's menu.
 * Null when neither knows the key.
 */
export function settingField(ns, key, { menu } = {}) {
  const def = game.settings.settings.get(`${ns}.${key}`) ?? fieldsOf(ns)[key];
  if (!def) return null;
  const local = { ...def, name: def.name ? game.i18n.localize(def.name) : key, hint: def.hint ? game.i18n.localize(def.hint) : "" };
  return fieldOf(`${ns}.${key}`, local, valueOf(ns, key) ?? def.default, { open: menu ? menuButton(ns, menu) : null });
}

/** A group's fields (keys nobody describes are left out). */
export function groupFields(ns, group) {
  return (group.keys ?? []).map(key => settingField(ns, key, group)).filter(Boolean);
}

/**
 * A group's fields under its sections' headings ([{ label, fields }]); a group without `sections` is one
 * section with no heading.
 */
export function groupSections(ns, group) {
  const sections = Array.isArray(group.sections) && group.sections.length ? group.sections : [{ label: "", keys: group.keys ?? [] }];
  return sections.map(s => ({ label: s.label ?? "", fields: groupFields(ns, { ...group, keys: s.keys ?? [] }) })).filter(s => s.fields.length);
}

/**
 * Save a key from the form, through the module's api.settings.set when it has one (dotted keys), else
 * Foundry's. A requiresReload setting asks to reload, as Configure Settings does (game.settings.set alone doesn't).
 */
export async function saveSetting(id, value) {
  const [ns, ...rest] = id.split(".");
  const key = rest.join(".");
  const def = game.settings.settings.get(id);
  const api = apiOf(ns);
  if ((!def && !fieldsOf(ns)[key]) || value === null) return;
  if (foundry.utils.objectsEqual({ v: valueOf(ns, key) }, { v: value })) return;
  await (typeof api?.set === "function" ? api.set(key, value) : game.settings.set(ns, key, value));
  if (def?.requiresReload) await SettingsConfig.reloadConfirm({ world: def.scope === "world" });
}

/* ---------------- App rules (apps/<id>/app.js rules) ---------------- */

/** A rule's field id: "<app>:<n>". */
const ruleId = (app, n) => `${app}:${n}`;

/** A rule's field, with the value stored at its path (or its default). A number with a range is a number field, as on the apps' pages. */
function ruleField(app, n, rule) {
  const stored = getPath(game.settings.get(MODULE_ID, rule.key), rule.path);
  const field = fieldOf(ruleId(app, n), { ...rule, name: rule.label }, stored ?? rule.default);
  if (field.kind === "range") field.kind = "number";
  return field;
}

/** Every app with rules, as sections: [{ app, name, off, fields }], in home-screen order. */
export function ruleSections() {
  const names = appearance().names ?? {};
  return Object.entries(APP_RULES).map(([app, rules]) => ({
    app,
    name: names[app] || APP_MANIFEST[app]?.name || app,
    fields: rules.map((rule, n) => ruleField(app, n, rule))
  }));
}

/** Save a rule from the form: its value at its path in the app's setting (the whole setting when it has no path). */
export async function saveRule(id, value) {
  const [app, n] = id.split(":");
  const rule = APP_RULES[app]?.[Number(n)];
  if (!rule || value === null) return;
  const current = game.settings.get(MODULE_ID, rule.key);
  if (!rule.path) return current === value ? undefined : game.settings.set(MODULE_ID, rule.key, value);
  if (getPath(current, rule.path) === value) return;
  const next = Object.entries(rule.with ?? {}).reduce((obj, [path, v]) => setPath(obj, path, v), setPath(current, rule.path, value));
  return game.settings.set(MODULE_ID, rule.key, next);
}

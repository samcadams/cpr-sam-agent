import { esc } from "../../util/text.js";

/*
 * The settings submenus' fields (ui/settings/menus.js): one Foundry form-group row per key, drawn from the
 * setting's registry entry (game.settings.settings) or groups.js fields(). Plain logic and HTML strings, no
 * Foundry calls, so the tests can run them.
 *
 * A field: { key, name, hint, kind, type, value, choices, range, disabled, icon, unit }
 *   kind   "checkbox" | "range" | "number" | "select" | "text"
 *   type   what the value is: "boolean" | "number" | "string"
 */

/** A type as one word: a constructor (Boolean…) or fields()' own word ("Boolean"). */
export function typeOf(type) {
  if (typeof type === "string") return type.toLowerCase();
  if (type === Boolean) return "boolean";
  if (type === Number) return "number";
  return "string";
}

/** Boolean: a checkbox; Number: a slider with a range, else a number box; String: a select with choices, else text. */
export function kindOf({ type, choices, range }) {
  const t = typeOf(type);
  if (t === "boolean") return "checkbox";
  if (t === "number") return range ? "range" : "number";
  return choices && Object.keys(choices).length ? "select" : "text";
}

/** A field from a key's definition and its value. */
export function fieldOf(key, def, value, { disabled = false, icon = null, unit = "" } = {}) {
  return {
    key, name: def.name || key, hint: def.hint ?? "", kind: kindOf(def), type: typeOf(def.type), value,
    choices: def.choices ?? null, range: def.range ?? null, disabled, icon, unit
  };
}

/** A control's value as the field's type (null: a number box holding no number). */
export function readValue(field, el) {
  if (field.kind === "checkbox") return !!el.checked;
  if (field.type === "number") return el.value !== "" && Number.isFinite(Number(el.value)) ? Number(el.value) : null;
  return el.value;
}

/** A range's shown value: the number and its unit. */
export const rangeLabel = (value, unit = "") => `${value}${unit ? ` ${unit}` : ""}`;

/** One field as a form-group row: label, control (data-key="<key>"), and its hint under it. */
export function fieldHtml(field) {
  const key = `data-key="${esc(field.key)}"${field.disabled ? " disabled" : ""}`;
  const value = esc(String(field.value ?? ""));
  let input;
  switch (field.kind) {
    case "checkbox":
      input = `<input type="checkbox" ${key} ${field.value ? "checked" : ""}>`;
      break;
    case "range": {
      const { min, max, step = 1 } = field.range;
      input = `<input type="range" ${key} min="${min}" max="${max}" step="${step}" value="${value}" data-unit="${esc(field.unit)}">
        <span class="range-value">${esc(rangeLabel(field.value, field.unit))}</span>`;
      break;
    }
    case "number":
      input = `<input type="number" ${key} value="${value}">`;
      break;
    case "select":
      input = `<select ${key}>${Object.entries(field.choices).map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(field.value) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
      break;
    default:
      input = `<input type="text" ${key} value="${value}">`;
  }
  const icon = field.icon ? `<i class="${esc(field.icon)}"></i> ` : "";
  return `<div class="form-group${field.disabled ? " disabled" : ""}">
    <label>${icon}${esc(field.name)}</label>
    <div class="form-fields">${input}</div>
    ${field.hint ? `<p class="notes">${esc(field.hint)}</p>` : ""}
  </div>`;
}

/** A section: a fieldset with its heading, an optional note under it, and its rows. */
export const sectionHtml = ({ label, note = "", rows }) =>
  `<fieldset class="ctp-config-group"><legend>${esc(label)}</legend>${note ? `<p class="notes">${esc(note)}</p>` : ""}${rows.join("")}</fieldset>`;

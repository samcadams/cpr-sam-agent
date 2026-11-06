import { esc } from "../../util/text.js";

/*
 * The generic settings form's fields: one control per setting type, drawn from what Foundry's settings
 * registry already says about a setting (game.settings.settings: name, hint, type, choices, range, scope)
 * or from an app's rules (apps/<id>/app.js `rules`). Plain logic and HTML strings, no Foundry calls, so
 * the Director's Config view, the App rules submenu and the tests share it.
 *
 * A field: { id, name, hint, kind, type, choices, range, value, client, reload, open }
 *   kind     "checkbox" | "select" | "range" | "number" | "text" | "object" (an "Open …" button, or a note)
 *   type     what the value is: "boolean" | "number" | "string" | "object"
 *   client   a client setting: it changes only this browser's copy
 *   reload   Foundry's requiresReload: saving it asks to reload
 *   open     for an object: { label, data } for its "Open …" button (data: the button's data- attributes)
 */

/** A setting's or rule's type as one word: a constructor (Boolean…), a DataField, or a rule's own word. */
export function typeOf(type) {
  if (typeof type === "string") return type.toLowerCase(); // a rule's word, or api.settings.fields' "Boolean"
  if (type === Boolean) return "boolean";
  if (type === Number) return "number";
  if (type === String) return "string";
  const field = type?.constructor?.name ?? "";
  if (/Boolean/.test(field)) return "boolean";
  if (/Number/.test(field)) return "number";
  if (/String/.test(field)) return "string";
  return "object";
}

/** The control a value of this type, choices and range gets. */
export function kindOf({ type, choices, range }) {
  const t = typeOf(type);
  if (t === "object") return "object";
  if (choices && Object.keys(choices).length) return "select";
  if (t === "boolean") return "checkbox";
  if (t === "number") return range && Number.isFinite(range.min) && Number.isFinite(range.max) ? "range" : "number";
  return "text";
}

/** A field from a setting's registry entry (or a rule) and its current value. */
export function fieldOf(id, def, value, { open = null } = {}) {
  return {
    id,
    name: def.name || def.label || id,
    hint: def.hint ?? "",
    type: typeOf(def.type),
    kind: kindOf(def),
    choices: def.choices ?? null,
    range: def.range ?? null,
    value,
    client: def.scope === "client",
    reload: !!def.requiresReload,
    open
  };
}

/** A control's value as the field's type (null when a number field holds no number). */
export function readValue(field, el) {
  if (field.kind === "checkbox") return !!el.checked;
  if (field.type === "number") {
    if (el.value === "" || !Number.isFinite(Number(el.value))) return null;
    return Number(el.value);
  }
  return el.value;
}

/** The value at a dot path in an object ("" = the object itself). */
export function getPath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A copy of `obj` with `value` at the dot path. */
export function setPath(obj, path, value) {
  const copy = structuredClone(obj ?? {});
  const keys = path.split(".");
  let o = copy;
  for (const k of keys.slice(0, -1)) o = (o[k] && typeof o[k] === "object") ? o[k] : (o[k] = {});
  o[keys.at(-1)] = value;
  return copy;
}

const attrsOf = data => Object.entries(data ?? {}).map(([k, v]) => `data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${esc(String(v))}"`).join(" ");

/**
 * One field as HTML. `attrs` are extra attributes for its control (the Director's data-director);
 * every control has data-field="<id>". A draft (text being typed) is drawn instead of the value.
 */
export function fieldHtml(field, { attrs = "", draft } = {}) {
  const id = esc(field.id);
  const control = `data-field="${id}" ${attrs}`;
  const name = `${esc(field.name)}${field.client ? ` <small class="ctp-config-client">(this browser)</small>` : ""}${field.reload ? ` <i class="fas fa-rotate" title="Needs a reload" aria-label="Needs a reload"></i>` : ""}`;
  const value = draft ?? field.value;
  let input;
  switch (field.kind) {
    case "checkbox":
      input = `<input type="checkbox" ${control} ${value ? "checked" : ""}>`;
      break;
    case "select":
      input = `<select ${control}>${Object.entries(field.choices).map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
      break;
    case "range": {
      const { min, max, step = 1 } = field.range;
      input = `<span class="ctp-config-range"><input type="range" ${control} min="${min}" max="${max}" step="${step}" value="${esc(String(value ?? ""))}"><output>${esc(String(value ?? ""))}</output></span>`;
      break;
    }
    case "number": {
      const r = field.range ?? {};
      input = `<input type="number" ${control} value="${esc(String(value ?? ""))}" ${r.min != null ? `min="${r.min}"` : ""} ${r.max != null ? `max="${r.max}"` : ""} ${r.step != null ? `step="${r.step}"` : ""}>`;
      break;
    }
    case "text":
      input = `<input type="text" ${control} value="${esc(String(value ?? ""))}">`;
      break;
    default:
      input = field.open
        ? `<button type="button" ${attrsOf(field.open.data)}><i class="fas fa-up-right-from-square" aria-hidden="true"></i> ${esc(field.open.label)}</button>`
        : `<span class="ctp-config-elsewhere">Edited in its app</span>`;
  }
  const tag = field.kind === "object" ? "div" : "label";
  return `<div class="ctp-config-field" data-kind="${field.kind}">
    <${tag} class="ctp-config-row"><span class="ctp-config-name">${name}</span>${input}</${tag}>
    ${field.hint ? `<p class="ctp-config-hint">${esc(field.hint)}</p>` : ""}
  </div>`;
}

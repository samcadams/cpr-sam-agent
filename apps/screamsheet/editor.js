import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { DEPTHS, REACHES, SPINS } from "./model.js";
import { activate, BLOCK_TYPES, esc, newBlock, newSheet, OUTLETS, PAPERS, renderSheet, STYLES, switchOutlet } from "./render.js";

/*
 * DataPool's editor: the GM writes a clipping in a big window. Left: the clipping (outlet, depth, reach,
 * spin, subjects and a Reputation event for each, tags, GM notes), the masthead (fixed: clock, desk,
 * ticker, columns, paper, background image, branding) and the blocks (drag the handle or use ▲▼ to
 * reorder, duplicate, remove; the palette adds one). Right: the sheet as players will see it; click a
 * block there to jump to its form. Save keeps it a draft; Publish sends it out now or in some hours of
 * world time. Ported from the prototype's editor.
 * Typing redraws only the preview (focus stays in the form); the form is rebuilt only when its shape
 * changes (a block added, moved or removed, a split side's kind, the desk list, the subjects).
 */

export function openEditor(clipId = null) {
  const open = Object.values(ui.windows).find(w => w instanceof ClippingEditor && clipId && w.clip.id === clipId);
  if (open) return open.bringToTop();
  new ClippingEditor(clipId).render(true);
}

const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => {
  const ks = p.split(".");
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
};

const options = (map, value) => Object.entries(map).map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("");

/** One form field, from a block's field schema (BLOCK_TYPES[].fields). */
function field(f, path, val) {
  const p = `data-path="${esc(path)}"`;
  switch (f.kind) {
    case "textarea": return `<label>${esc(f.label)}<textarea ${p} rows="4">${esc(val)}</textarea></label>`;
    case "select": return `<label>${esc(f.label)}<select ${p}>${options(f.options, val)}</select></label>`;
    case "color": return `<label>${esc(f.label)}<input type="color" ${p} value="${esc(val)}"></label>`;
    case "image": return `<label>${esc(f.label)}<span class="scream-ed-file"><input type="text" ${p} value="${esc(val)}" placeholder="path or URL"><button type="button" data-pick="${esc(path)}" title="Browse"><i class="fas fa-file-image"></i></button></span></label>`;
    case "side": return `<div class="scream-ed-side-pick"><label>${esc(f.label)}<select data-path="${esc(path)}.kind" data-shape>${options({ text: "Text", image: "Image" }, val?.kind)}</select></label>`
      + (val?.kind === "image" ? field({ kind: "image", label: "Image" }, `${path}.src`, val.src) : field({ kind: "textarea", label: "Text" }, `${path}.text`, val?.text)) + "</div>";
    default: return `<label>${esc(f.label)}<input type="text" ${p} value="${esc(val)}"></label>`;
  }
}

class ClippingEditor extends Application {
  constructor(clipId) {
    super({ id: `agent-scream-editor-${clipId ?? foundry.utils.randomID()}` });
    const saved = clipId ? store.apps.screamClips?.[clipId] : null;
    this.clip = saved ? foundry.utils.deepClone(saved) : {
      id: foundry.utils.randomID(), sheet: newSheet("n54"), subjects: [], tags: [], dv: 0, reach: "public", spin: "accurate", rep: [], title: "", notes: ""
    };
    this.clip.rep ??= [];
    this.clip.subjects ??= [];
    this.selected = null;
    this.dragId = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "DataPool: the desk",
      classes: ["agent-scream-window", "agent-scream-editor"],
      width: Math.min(1240, Math.round(window.innerWidth * 0.92)),
      height: Math.min(900, Math.round(window.innerHeight * 0.9)),
      resizable: true
    });
  }

  get sheet() {
    return this.clip.sheet;
  }

  get published() {
    return store.apps.screamClips?.[this.clip.id]?.status === "published";
  }

  async _renderInner() {
    return $(`<div class="scream-editor">
      <div class="scream-ed-form">
        <section class="scream-ed-card" data-part="meta"></section>
        <section class="scream-ed-card"><h3>Masthead</h3><div data-part="mast"></div></section>
        <section class="scream-ed-card"><h3>Blocks <small data-part="count"></small></h3>
          <p class="scream-ed-hint">Ads, two-column splits and lead headlines span the page: in a 2- or 3-column sheet, keep them at the top or the end.</p>
          <div data-part="blocks"></div>
          <div class="scream-ed-palette" data-part="palette">${Object.entries(BLOCK_TYPES).map(([k, t]) => `<button type="button" data-add="${k}"><i class="fas ${t.icon}"></i> ${esc(t.label)}</button>`).join("")}</div>
        </section>
      </div>
      <div class="scream-ed-preview" data-part="out"></div>
      <footer class="scream-ed-foot">
        <button type="button" data-ed="save"><i class="fas fa-floppy-disk"></i> Save</button>
        <button type="button" data-ed="publish" class="scream-ed-go"><i class="fas fa-paper-plane"></i> <span data-part="go"></span></button>
        <label class="scream-ed-hours">in <input type="number" name="hours" min="0" step="0.5" value="0" aria-label="Hours of world time from now (0: now)"> h</label>
        <span class="scream-ed-status" aria-live="polite"></span>
      </footer>
    </div>`);
  }

  part(name) {
    return this.element[0].querySelector(`[data-part="${name}"]`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    this.redraw();
    const form = root.querySelector(".scream-ed-form");
    form.addEventListener("input", e => this.onInput(e));
    form.addEventListener("change", e => this.onChange(e));
    form.addEventListener("click", e => this.onClick(e));
    this.bindDrag(this.part("blocks"));
    this.part("out").addEventListener("click", e => {
      const b = e.target.closest("[data-block-id]");
      if (!b) return;
      this.selected = b.dataset.blockId;
      this.preview();
      const card = root.querySelector(`.scream-ed-block[data-id="${CSS.escape(this.selected)}"]`);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.querySelector("input,textarea")?.focus({ preventScroll: true });
    });
    root.querySelector("[data-ed=save]").addEventListener("click", () => this.save(false));
    root.querySelector("[data-ed=publish]").addEventListener("click", () => this.save(true));
    root.querySelector("input[name=hours]").addEventListener("input", () => this.drawGo());
  }

  setPosition(pos) {
    const out = super.setPosition(pos);
    const preview = this.element?.[0]?.querySelector("[data-part=out]");
    if (preview) activate(preview);
    return out;
  }

  redraw() {
    this.drawMeta();
    this.drawMast();
    this.drawBlocks();
    this.drawGo();
    this.preview();
  }

  drawGo() {
    const hours = Number(this.element[0].querySelector("input[name=hours]")?.value) || 0;
    const go = this.part("go");
    if (go) go.textContent = this.published ? "Update" : hours > 0 ? "Schedule" : "Publish now";
    this.element[0].querySelector(".scream-ed-hours")?.toggleAttribute("hidden", this.published);
  }

  /** The clipping itself: what it is to the crawl, who it's about. */
  drawMeta() {
    const c = this.clip;
    const pcs = new Set(playerCharacters().map(a => a.id));
    const actors = [...playerCharacters(), ...game.actors.filter(a => !pcs.has(a.id) && a.type !== "container")];
    const subjects = c.subjects.map(id => game.actors.get(id)).filter(Boolean);
    const repOf = id => c.rep.find(r => r.actorId === id) ?? { delta: 0, reason: "" };
    const dvs = Object.fromEntries(Object.entries(DEPTHS).map(([dv, d]) => [dv, `${d.name}${Number(dv) ? ` (DV ${dv})` : ""}`]));
    this.part("meta").innerHTML = `<h3>Clipping</h3>
      <label>Title (only you see it)<input type="text" data-path="title" value="${esc(c.title)}" placeholder="What this is about"></label>
      <div class="scream-ed-grid">
        <label>Outlet<select data-outlet>${options(Object.fromEntries(Object.entries(OUTLETS).map(([k, o]) => [k, o.label])), this.sheet.outlet)}</select></label>
        <label>Depth<select data-path="dv" data-number>${options(dvs, String(c.dv in DEPTHS ? c.dv : 0))}</select></label>
        <label>Reach<select data-path="reach">${options(REACHES, c.reach)}</select></label>
        <label>Spin<select data-path="spin">${options(SPINS, c.spin)}</select></label>
      </div>
      <p class="scream-ed-hint">${esc(DEPTHS[c.dv]?.hint ?? "")} Headlines everyone can find also go on the Front Page.</p>
      <label>Tags (comma separated: what else a crawl should find it by)<input type="text" data-path="tags" data-list value="${esc(c.tags.join(", "))}"></label>
      <div class="scream-ed-subjects">
        <span>About</span>
        ${subjects.map(a => `<span class="scream-ed-chip">${esc(displayName(a))}<button type="button" data-unsubject="${a.id}" title="Remove"><i class="fas fa-xmark"></i></button></span>`).join("")}
        <input type="text" list="scream-ed-actors-${esc(c.id)}" data-subject placeholder="Add a character…" aria-label="Add a character the clipping is about">
        <datalist id="scream-ed-actors-${esc(c.id)}">${actors.map(a => `<option value="${esc(a.name)}"></option>`).join("")}</datalist>
      </div>
      ${subjects.length ? `<div class="scream-ed-rep"><span class="scream-ed-hint">Reputation event when it goes out (optional):</span>${subjects.map(a => `<div class="scream-ed-rep-row"><b>${esc(displayName(a))}</b>
        <input type="number" min="-10" max="10" step="1" data-rep="${a.id}" data-rep-field="delta" value="${repOf(a.id).delta || ""}" placeholder="±" aria-label="Reputation change for ${esc(displayName(a))}">
        <input type="text" data-rep="${a.id}" data-rep-field="reason" value="${esc(repOf(a.id).reason)}" placeholder="Reason (on the sheet's ledger)" aria-label="Reason"></div>`).join("")}</div>` : ""}
      <label>Notes (only you see them)<textarea data-path="notes" rows="2">${esc(c.notes)}</textarea></label>`;
  }

  drawMast() {
    const m = this.sheet.masthead;
    const br = m.brand;
    const layout = (OUTLETS[this.sheet.outlet] ?? OUTLETS.custom).layout;
    this.part("mast").innerHTML = `<div class="scream-ed-grid">${field({ label: "Clock" }, "sheet.masthead.clock", m.clock)}
      ${layout !== "tabloid" ? `<label>${layout === "board" ? "Section" : "Active desk"}<select data-path="sheet.masthead.desk">${br.desks.map(d => `<option${d === m.desk ? " selected" : ""}>${esc(d)}</option>`).join("")}</select></label>` : "<span></span>"}</div>
      ${field({ label: "Breaking ticker (optional)" }, "sheet.masthead.ticker", m.ticker)}
      <div class="scream-ed-grid">${field({ kind: "select", label: "Body columns", options: { 1: "One column", 2: "Two columns", 3: "Three columns" } }, "sheet.masthead.columns", String(m.columns))}
      ${field({ kind: "select", label: "Paper", options: PAPERS }, "sheet.masthead.paper", m.paper)}</div>
      ${layout === "desks" ? field({ kind: "select", label: "Masthead style", options: Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.label])) }, "sheet.masthead.brand.style", br.style) : ""}
      ${field({ kind: "image", label: "Background image (lies over the paper, text on top)" }, "sheet.background", this.sheet.background)}
      <details><summary>Branding</summary>
        <div class="scream-ed-grid">${field({ label: "Outlet name" }, "sheet.masthead.brand.name", br.name)}${field({ label: "Tagline" }, "sheet.masthead.brand.tagline", br.tagline)}
        ${field({ kind: "color", label: "Accent" }, "sheet.masthead.brand.accent", br.accent)}${field({ kind: "color", label: "Header background" }, "sheet.masthead.brand.headerBg", br.headerBg)}
        ${field({ kind: "color", label: "Header text" }, "sheet.masthead.brand.headerText", br.headerText)}${field({ kind: "image", label: "Logo" }, "sheet.masthead.brand.logo", br.logo)}</div>
        <label>Desks (comma separated)<input type="text" data-path="sheet.masthead.brand.desks" data-list data-desks value="${esc(br.desks.join(", "))}"></label>
        <label class="scream-ed-check"><input type="checkbox" data-path="sheet.masthead.brand.showNav"${br.showNav ? " checked" : ""}> Show the desk tabs</label>
      </details>
      <label class="scream-ed-check"><input type="checkbox" data-path="sheet.masthead.credit"${m.credit ? " checked" : ""}> Credit line</label>`;
  }

  drawBlocks() {
    const blocks = this.sheet.blocks;
    this.part("count").textContent = `(${blocks.length})`;
    this.part("blocks").innerHTML = blocks.map((b, i) => {
      const t = BLOCK_TYPES[b.type];
      if (!t) return "";
      return `<div class="scream-ed-block" data-id="${esc(b.id)}">
        <div class="scream-ed-block-head"><span class="scream-ed-handle" draggable="true" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span><span class="scream-ed-block-type"><i class="fas ${t.icon}"></i> ${esc(t.label)}</span>
          <button type="button" data-move="up" ${i === 0 ? "disabled" : ""} title="Move up"><i class="fas fa-arrow-up"></i></button><button type="button" data-move="down" ${i === blocks.length - 1 ? "disabled" : ""} title="Move down"><i class="fas fa-arrow-down"></i></button>
          <button type="button" data-move="dup" title="Duplicate"><i class="fas fa-clone"></i></button><button type="button" data-move="del" title="Remove"><i class="fas fa-trash"></i></button></div>
        <div class="scream-ed-block-body">${t.fields.map(f => field(f, `sheet.blocks.${i}.${f.key}`, b[f.key])).join("") || `<i class="scream-ed-hint">A rule across the page.</i>`}</div></div>`;
    }).join("");
  }

  preview() {
    const out = this.part("out");
    out.innerHTML = renderSheet(this.sheet, { editing: true });
    activate(out);
    if (this.selected) out.querySelector(`[data-block-id="${CSS.escape(this.selected)}"]`)?.classList.add("is-selected");
  }

  onInput(e) {
    const t = e.target;
    if (t.dataset.rep) {
      const r = this.clip.rep.find(x => x.actorId === t.dataset.rep) ?? this.clip.rep[this.clip.rep.push({ actorId: t.dataset.rep, delta: 0, reason: "" }) - 1];
      r[t.dataset.repField] = t.dataset.repField === "delta" ? Math.trunc(Number(t.value) || 0) : t.value;
      return;
    }
    const path = t.dataset.path;
    if (!path) return;
    let v = t.type === "checkbox" ? t.checked : t.value;
    if ("list" in t.dataset) v = v.split(",").map(s => s.trim()).filter(Boolean);
    if (path === "sheet.masthead.columns" || "number" in t.dataset) v = Number(v);
    setPath(this.clip, path, v);
    if (path === "sheet.masthead.brand.desks" && !v.includes(this.sheet.masthead.desk)) this.sheet.masthead.desk = v[0] ?? "";
    if ("shape" in t.dataset) this.drawBlocks();
    if (path === "dv") this.drawMeta();
    this.preview();
  }

  onChange(e) {
    const t = e.target;
    if ("desks" in t.dataset) this.drawMast();
    if ("outlet" in t.dataset) {
      this.clip.sheet = switchOutlet(this.sheet, t.value);
      this.drawMast();
      this.preview();
    }
    if ("subject" in t.dataset && t.value.trim()) {
      const name = t.value.trim();
      const actor = game.actors.find(a => a.name === name) ?? game.actors.find(a => displayName(a) === name);
      if (!actor) return ui.notifications.warn(`No character called "${name}".`);
      if (!this.clip.subjects.includes(actor.id)) this.clip.subjects.push(actor.id);
      this.drawMeta();
      this.part("meta").querySelector("[data-subject]")?.focus();
    }
  }

  onClick(e) {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.dataset.unsubject) {
      this.clip.subjects = this.clip.subjects.filter(id => id !== el.dataset.unsubject);
      this.clip.rep = this.clip.rep.filter(r => r.actorId !== el.dataset.unsubject);
      return this.drawMeta();
    }
    if (el.dataset.pick) {
      const path = el.dataset.pick;
      return new FilePicker({
        type: "image", current: getPath(this.clip, path) ?? "",
        callback: file => {
          setPath(this.clip, path, file);
          const input = this.element[0].querySelector(`input[data-path="${CSS.escape(path)}"]`);
          if (input) input.value = file;
          this.preview();
        }
      }).render(true);
    }
    if (el.dataset.add) {
      const block = newBlock(el.dataset.add);
      this.sheet.blocks.push(block);
      this.selected = block.id;
      this.drawBlocks();
      this.preview();
      this.element[0].querySelector(`.scream-ed-block[data-id="${CSS.escape(block.id)}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    if (el.dataset.move) {
      const B = this.sheet.blocks;
      const i = B.findIndex(b => b.id === el.closest(".scream-ed-block")?.dataset.id);
      if (i < 0) return;
      ({
        up: () => B.splice(i - 1, 0, ...B.splice(i, 1)),
        down: () => B.splice(i + 1, 0, ...B.splice(i, 1)),
        dup: () => B.splice(i + 1, 0, { ...foundry.utils.deepClone(B[i]), id: newBlock("divider").id }),
        del: () => B.splice(i, 1)
      })[el.dataset.move]();
      this.drawBlocks();
      this.preview();
    }
  }

  /** Drag a block's handle onto another block (HTML5 drag and drop; ▲▼ for touch and keyboard). */
  bindDrag(list) {
    const clear = () => list.querySelectorAll(".dragging,.drop-before,.drop-after").forEach(x => x.classList.remove("dragging", "drop-before", "drop-after"));
    list.addEventListener("dragstart", e => {
      const card = e.target.closest(".scream-ed-block");
      if (!card) return;
      this.dragId = card.dataset.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", this.dragId);
    });
    list.addEventListener("dragover", e => {
      const card = e.target.closest(".scream-ed-block");
      if (!card || !this.dragId) return;
      e.preventDefault();
      list.querySelectorAll(".drop-before,.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
      const r = card.getBoundingClientRect();
      card.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
    });
    list.addEventListener("drop", e => {
      e.preventDefault();
      const card = e.target.closest(".scream-ed-block");
      if (!card || !this.dragId || card.dataset.id === this.dragId) return clear();
      const after = card.classList.contains("drop-after");
      const B = this.sheet.blocks;
      const moved = B.splice(B.findIndex(b => b.id === this.dragId), 1)[0];
      B.splice(B.findIndex(b => b.id === card.dataset.id) + (after ? 1 : 0), 0, moved);
      this.dragId = null;
      this.drawBlocks();
      this.preview();
    });
    list.addEventListener("dragend", () => {
      this.dragId = null;
      clear();
    });
  }

  save(publish) {
    const hours = publish && !this.published ? Number(this.element[0].querySelector("input[name=hours]")?.value) || 0 : 0;
    const clip = { ...this.clip, rep: this.clip.rep.filter(r => r.delta && this.clip.subjects.includes(r.actorId)) };
    if (!store.request("scream-save", { clip, publish, hours })) return;
    const status = this.element[0].querySelector(".scream-ed-status");
    if (publish) return this.close();
    if (status) status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
  }
}

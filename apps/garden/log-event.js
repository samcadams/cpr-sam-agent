import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { esc } from "../../scripts/util/text.js";
import { store } from "../../scripts/store.js";
import { gardenNow, gardenWhen } from "./model.js";
import { contextKeywords, HEATS, keywordChips, keywordList, knownKeywords, OBVIOUS, parseSpan, spanText, stirPreview, writerCharacters } from "./writer.js";

/*
 * The GM's pop-up for the Garden writer (plan §6–7): "Log an event" (a happening: one line, the
 * place and who prefilled from the scene, a heat, ~10 seconds) and "Plant a seed" (something the city
 * should start talking about). On the hotbar as a macro (api.garden.logEvent()), and in the Garden's
 * Writer tab. Saving goes to the host (garden-happening / garden-seed); "Stir now" adds instant
 * chatter from the word lists.
 */

/** The characters on the active scene (prefilled as who was there). */
const onScene = () => new Set((game.scenes.active?.tokens ?? []).map(t => t.actorId).filter(Boolean));

/** Places to suggest: scenes, and places already logged. */
function placeSuggestions() {
  const out = new Set(game.scenes.map(s => s.navName || s.name));
  for (const h of Object.values(store.garden.happenings ?? {})) if (h.place) out.add(h.place);
  return [...out].filter(Boolean).slice(0, 80);
}

/** The active scene's names and its journal's: context for the keywords. */
function sceneContext() {
  const scene = game.scenes.active;
  return [scene?.name, scene?.navName, scene?.journal?.name].filter(Boolean);
}

/**
 * The keywords that apply to an event or seed (the pop-up fills them in as the GM types; the API uses
 * it when no keywords are given): known keywords found in what, the place, the active scene and its
 * journal, and the profile keywords of who was there. `who`: actor ids.
 */
export function autoKeywords({ what = "", place = "", who = [], context = sceneContext() } = {}) {
  const pcs = store.garden.writer?.pcs ?? {};
  return contextKeywords({ what, place, context, pcKeywords: who.flatMap(id => pcs[id]?.keywords ?? []) }, knownKeywords(store.garden));
}

const radios = (name, options, value) => Object.entries(options).map(([v, label]) =>
  `<label class="ctp-garden-pill"><input type="radio" name="${name}" value="${v}"${v === value ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");

/** The known keywords as chips (tap: add to the field), with who each one stirs as a tooltip. */
function chipsHtml(field) {
  const chips = keywordChips(store.garden);
  if (!chips.length) return '<p class="notes">No keywords known yet: give accounts keywords (Accounts → feather) and Stir can pick them.</p>';
  return `<div class="ctp-garden-chips" data-for="${field}">${chips.map(c => `<a class="ctp-garden-chip${c.handles.length ? "" : " quiet"}" data-keyword="${esc(c.keyword)}" title="${esc(c.handles.length ? `Stirs ${c.handles.join(", ")}` : "No account reacts to it (a character's keyword)")}">${esc(c.keyword)}${c.handles.length ? ` <small>${c.handles.length}</small>` : ""}</a>`).join("")}</div>`;
}

/**
 * Open the pop-up. `tab`: "event" or "seed"; `happening` / `seed`: one to edit (its tab opens).
 * Resolves with the id saved, or null.
 */
export function openWriterPopup({ tab = "event", happening = null, seed = null } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Logging Garden events is for GMs.");
    return Promise.resolve(null);
  }
  if (seed) tab = "seed";
  else if (happening) tab = "event";
  const h = happening ?? {};
  const s = seed ?? {};
  const scene = onScene();
  // The writer's characters (Writer tab), and anyone already on the event.
  const pcs = playerCharacters().filter(a => writerCharacters([a], store.garden.writer).length || (h.who ?? []).includes(a.id));
  const who = new Set(h.who ?? pcs.filter(a => scene.has(a.id)).map(a => a.id));
  const accounts = Object.values(store.garden.accounts).filter(a => !a.actorId).sort((a, b) => a.handle.localeCompare(b.handle));
  const now = gardenNow();
  const sceneName = game.scenes.active?.navName || game.scenes.active?.name || "";
  const editing = happening || seed;
  const content = `<form class="ctp-fields-form ctp-garden-writer-form" autocomplete="off">
    ${editing ? "" : `<nav class="ctp-garden-tabs"><a data-tab="event"${tab === "event" ? ' class="active"' : ""}><i class="fas fa-bolt"></i> Log an event</a><a data-tab="seed"${tab === "seed" ? ' class="active"' : ""}><i class="fas fa-seedling"></i> Plant a seed</a></nav>`}
    <section data-tab="event"${tab === "event" ? "" : ' hidden'}>
      <div class="form-group"><label>What</label><input type="text" name="what" value="${esc(h.what ?? "")}" placeholder="Shootout behind the Totentanz, an AV went down"></div>
      <div class="form-group"><label>Where</label><input type="text" name="place" list="ctp-garden-places" value="${esc(h.place ?? sceneName)}" placeholder="Totentanz, Watson"></div>
      <datalist id="ctp-garden-places">${placeSuggestions().map(p => `<option value="${esc(p)}">`).join("")}</datalist>
      <div class="form-group"><label>Who</label><div class="ctp-garden-checks">${pcs.map(a => `<label><input type="checkbox" name="who" value="${a.id}"${who.has(a.id) ? " checked" : ""}> ${esc(displayName(a))}</label>`).join("") || '<span class="notes">No characters</span>'}</div></div>
      <div class="form-group"><label>Heat</label><div class="ctp-garden-pills">${radios("heat", HEATS, h.heat ?? "local")}</div></div>
      <div class="form-group"><label>Public</label><div class="ctp-garden-pills">${radios("public", { yes: "Public", no: "GM-only" }, h.public === false ? "no" : "yes")}</div>
        <p class="notes">GM-only: the writer never states it; at most a rumour, noted for you.</p></div>
      <div class="form-group stacked"><label>Keywords</label><input type="text" name="keywords" value="${esc((h.keywords ?? []).join(", "))}" placeholder="Filled in from what, where and who">
        <p class="notes ctp-garden-stir-preview" data-preview="keywords"></p>
        ${chipsHtml("keywords")}</div>
      <div class="form-group stacked"><label>Note to the writer</label><textarea name="direction" rows="2" placeholder="Optional: make it look like Militech's fault">${esc(h.direction ?? "")}</textarea></div>
      ${happening ? `<p class="notes">Logged ${esc(gardenWhen(h.wt, now))}.</p>` : `<div class="form-group"><label>Stir now</label><input type="checkbox" name="stir">
        <p class="notes">Instant reactions from the word lists (Control → Stir reactions), from accounts whose keywords fit, over the next in-game hour (and the next real minutes, if the clock stands still).</p></div>
      <div class="form-group" data-stir-only style="display: none"><label>People call it</label><input type="text" name="thing" placeholder="the shootout"></div>`}
    </section>
    <section data-tab="seed"${tab === "seed" ? "" : ' hidden'}>
      <div class="form-group"><label>What</label><input type="text" name="seedWhat" value="${esc(s.what ?? "")}" placeholder="Someone's moving Militech crates through the docks"></div>
      <div class="form-group stacked"><label>Keywords</label><input type="text" name="seedKeywords" value="${esc((s.keywords ?? []).join(", "))}" placeholder="Filled in from what">
        <p class="notes ctp-garden-stir-preview" data-preview="seedKeywords"></p>
        ${chipsHtml("seedKeywords")}</div>
      <div class="form-group"><label>How obvious</label><div class="ctp-garden-pills">${radios("obvious", OBVIOUS, s.obvious ?? "subtle")}</div></div>
      <div class="form-group"><label>By</label><input type="text" name="by" value="${s.by ? esc(spanText(s.by - now)) : ""}" placeholder="+2d (in-game, from now); empty: any time">
        ${s.by ? `<p class="notes">${esc(gardenWhen(s.by, now))}</p>` : ""}</div>
      <div class="form-group"><label>Who says it</label><select name="sources" multiple size="5">${accounts.map(a => `<option value="${a.id}"${(s.sources ?? []).includes(a.id) ? " selected" : ""}>${esc(a.handle)} · ${esc(a.name)}</option>`).join("")}</select>
        <p class="notes">Optional: the writer picks voices whose keywords fit.</p></div>
    </section>
  </form>`;

  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (!done) resolve(v);
      done = true;
    };
    const dialog = new Dialog({
      title: editing ? (seed ? "Garden seed" : "Garden event") : "The Garden: log an event",
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>', label: "Save",
          callback: async html => finish(await save(html[0].querySelector("form"), { happening, seed }))
        },
        cancel: { label: "Cancel", callback: () => finish(null) }
      },
      default: "save",
      close: () => finish(null),
      render: html => wire(html[0].querySelector("form"))
    }, { classes: ["dialog", "ctp-garden-writer"], width: 460 });
    dialog.render(true);
  });
}

/** Tabs, keyword suggestions as the GM types, and the Stir-only field. */
function wire(form) {
  let tab = form.querySelector("nav a.active")?.dataset.tab ?? form.querySelector("section:not([hidden])").dataset.tab;
  form.dataset.tab = tab;
  form.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => {
    tab = a.dataset.tab;
    form.dataset.tab = tab;
    form.querySelectorAll("nav a").forEach(x => x.classList.toggle("active", x === a));
    form.querySelectorAll("section").forEach(sec => (sec.hidden = sec.dataset.tab !== tab));
    form.closest(".app")?.style.setProperty("height", "auto");
  }));
  const accounts = store.garden.accounts;
  const parse = v => keywordList(v, 30);
  const heat = () => form.querySelector("[name=heat]:checked")?.value ?? "local";
  /*
   * A keywords field filled in from the context as the GM types: keywords the GM typed stay, the
   * filled-in ones follow the context, and one the GM deleted is never put back.
   */
  const auto = (field, read) => {
    const input = form.querySelector(`[name=${field}]`);
    const preview = form.querySelector(`[data-preview=${field}]`);
    const removed = new Set();
    let added = new Set(); // in the field because they were filled in
    const show = () => {
      if (preview) preview.textContent = stirPreview(input.value, accounts, field === "keywords" ? heat() : "local").text;
      form.querySelectorAll(`[data-for=${field}] [data-keyword]`).forEach(c => c.classList.toggle("active", parse(input.value).includes(c.dataset.keyword)));
    };
    input.addEventListener("input", () => {
      const now = parse(input.value);
      for (const k of added) if (!now.includes(k)) removed.add(k);
      added = new Set([...added].filter(k => now.includes(k)));
      show();
    });
    form.querySelectorAll(`[data-for=${field}] [data-keyword]`).forEach(chip => chip.addEventListener("click", () => {
      const k = chip.dataset.keyword;
      const now = parse(input.value);
      removed.delete(k);
      added.delete(k);
      input.value = (now.includes(k) ? now.filter(x => x !== k) : [...now, k]).join(", ");
      if (now.includes(k)) removed.add(k);
      show();
    }));
    const fill = () => {
      const want = autoKeywords(read()).filter(k => !removed.has(k));
      const now = parse(input.value);
      const kept = now.filter(k => !added.has(k) || want.includes(k));
      const extra = want.filter(k => !kept.includes(k));
      added = new Set([...[...added].filter(k => kept.includes(k)), ...extra]);
      input.value = [...kept, ...extra].join(", ");
      show();
    };
    return { fill, show };
  };
  const who = () => [...form.querySelectorAll("[name=who]:checked")].map(c => c.value);
  // Editing an event or seed: its keywords are the GM's; filled-in ones only follow later changes.
  const event = auto("keywords", () => ({ what: form.what.value, place: form.place.value, who: who() }));
  const seed = auto("seedKeywords", () => ({ what: form.seedWhat.value, place: "", who: [] }));
  form.addEventListener("input", e => {
    if (e.target.name === "seedWhat") seed.fill();
    else if (["what", "place"].includes(e.target.name)) event.fill();
  });
  form.addEventListener("change", e => {
    if (e.target.name === "who" || e.target.name === "place") event.fill();
    if (e.target.name === "heat") event.show();
    const stir = form.querySelector("[data-stir-only]");
    if (stir) stir.style.display = form.stir.checked ? "" : "none";
    if (stir && form.stir.checked && !form.thing.value) form.thing.placeholder = form.keywords.value.split(",").map(k => k.trim()).find(k => k && k !== form.place.value.toLowerCase()) || "that";
  });
  if (!form.keywords.value) event.fill();
  else event.show();
  if (!form.seedKeywords.value) seed.fill();
  else seed.show();
}

/** Send what the form says to the host; the id saved, or null. */
async function save(form, { happening, seed }) {
  const tab = form.dataset.tab;
  if (tab === "seed") {
    const what = form.seedWhat.value.trim();
    if (!what) return ui.notifications.warn("A seed needs a line saying what it is."), null;
    const span = form.by.value.trim() ? parseSpan(form.by.value) : null;
    if (form.by.value.trim() && span === null) return ui.notifications.warn("By: an in-game time from now, like +2d or +6h."), null;
    const data = {
      id: seed?.id, what, keywords: form.seedKeywords.value, obvious: form.querySelector("[name=obvious]:checked")?.value,
      by: span === null ? null : gardenNow() + span, sources: [...form.sources.selectedOptions].map(o => o.value)
    };
    store.request("garden-seed", { seed: data });
    return data.id ?? true;
  }
  const what = form.what.value.trim();
  if (!what) return ui.notifications.warn("An event needs a line saying what happened."), null;
  const data = {
    id: happening?.id, what, place: form.place.value.trim(), who: [...form.querySelectorAll("[name=who]:checked")].map(c => c.value),
    heat: form.querySelector("[name=heat]:checked")?.value, public: form.querySelector("[name=public]:checked")?.value !== "no",
    keywords: form.keywords.value, direction: form.direction.value
  };
  const stir = !!form.stir?.checked;
  store.request("garden-happening", { happening: data, stir, thing: stir ? form.thing.value.trim() || form.thing.placeholder : null });
  if (!happening) ui.notifications.info(`Garden: logged "${what}"${stir ? ", and the city's reacting" : ""}.`);
  return data.id ?? true;
}

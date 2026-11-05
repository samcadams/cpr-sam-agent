import { appFeature } from "../../../model/apps.js";
import { feature } from "../../../model/features.js";
import { esc } from "../../../util/text.js";

/*
 * A Director tab made of apps on a numbered rail (Economy, World): the open app's header and page beside
 * it. A page: { data(director), count(data), head(data), page(director, data), shape(data), attach? }; `shape`
 * is the page's layout (its sub-tab), and a new shape draws everything again; `attach(director, root)` runs
 * after every draw (canvases). Otherwise a refresh redraws
 * the rail, the header and the page, keeping scroll and the focused data-draft field (focus and caret).
 * Which app is open lives in director.stateOf(<view>).app.
 */

/** Redraw a part, keeping its scroll, and the focus and caret of a draft field inside it. */
export function redraw(el, markup) {
  const active = el.ownerDocument.activeElement;
  const key = el.contains(active) ? active.dataset?.draft : null;
  let caret = null;
  try {
    caret = key ? [active.selectionStart, active.selectionEnd] : null;
  } catch {
    // number inputs have no caret
  }
  const scroll = el.scrollTop;
  el.innerHTML = markup;
  el.scrollTop = scroll;
  if (!key) return;
  const again = el.querySelector(`[data-draft="${CSS.escape(key)}"]`);
  again?.focus();
  try {
    if (caret?.[0] != null) again?.setSelectionRange(...caret);
  } catch {
    // as above
  }
}

/** A page's header: its title, a line under it, extra tags, and its sub-tabs (GM Phone tabs: { id, label, active, count }). */
export function pageHead(title, sub, { tags = "", tabs = null, action = "" } = {}) {
  const tabsHtml = tabs ? `<div class="director-subtabs">${tabs.map(t => `<button type="button" class="${t.active ? "active" : ""}" aria-pressed="${t.active}" data-director="phone:${action}" data-tab="${t.id}">${esc(t.label)}${t.count ? ` <span class="director-count">${t.count}</span>` : ""}</button>`).join("")}</div>` : "";
  return `<div class="director-railed-title"><h2>${esc(title)}</h2><span class="director-sub">${esc(sub)}</span>${tags}</div>${tabsHtml}`;
}

/**
 * The tab `view` (its state key and aria label `label`) over `apps` ([[id, name, icon]]) and their
 * `pages` (by id); an app may name its Control switch fourth ([id, name, icon, feature]). Returns the
 * view's html and refresh.
 */
export function railed(view, label, apps, pages) {
  const appOf = director => {
    const state = director.stateOf(view);
    if (!apps.some(([id]) => id === state.app)) state.app = apps[0][0];
    return state.app;
  };

  const railHtml = (open, data) => `<ol class="director-rail" aria-label="${esc(label)}">${apps.map(([id, name, icon], i) => {
    const count = id === open ? pages[id].count(data) : 0;
    return `<li><button type="button" class="${id === open ? "active" : ""}" aria-pressed="${id === open}" data-director="rail-app" data-view="${view}" data-app="${id}">
      <span class="director-rail-n">${String(i + 1).padStart(2, "0")}</span> <i class="fas ${icon}" aria-hidden="true"></i> ${esc(name)}${count ? ` <span class="director-count">${count}</span>` : ""}</button></li>`;
  }).join("")}</ol>`;

  // An app's switch in Control: app_<id>, or the one given as the app's fourth entry (Jobs: "jobs"; true: none).
  const switchOf = id => apps.find(([app]) => app === id)?.[3] ?? appFeature(id);
  const offNote = id => (switchOf(id) === true || feature(switchOf(id)) ? "" : `<p class="director-note"><i class="fas fa-power-off"></i> Switched off in Control: players don't have it. You can still set it up here.</p>`);

  function html(director) {
    const id = appOf(director);
    const page = pages[id];
    const data = page.data(director);
    return `<div class="director-railed" data-app="${id}" data-shape="${esc(page.shape(data))}">
      <nav class="director-railed-rail" data-part="rail">${railHtml(id, data)}</nav>
      <div class="director-railed-main">
        <header class="director-railed-head" data-part="head">${page.head(data)}</header>
        <div class="director-page" data-part="page">${offNote(id)}${page.page(director, data)}</div>
      </div>
    </div>`;
  }

  function refresh(director, root) {
    const id = appOf(director);
    const page = pages[id];
    const data = page.data(director);
    const el = root.querySelector(".director-railed");
    if (!el || el.dataset.app !== id || el.dataset.shape !== page.shape(data)) {
      root.innerHTML = html(director);
      return;
    }
    const part = name => el.querySelector(`[data-part="${name}"]`);
    part("rail").innerHTML = railHtml(id, data);
    part("head").innerHTML = page.head(data);
    redraw(part("page"), offNote(id) + page.page(director, data));
  }

  /** After a draw: the open page's own (canvases and the like), if it has one. */
  function attach(director, root) {
    pages[appOf(director)].attach?.(director, root);
  }

  return { html, refresh, attach };
}

export const actions = {
  /** Open an app on a rail. */
  "rail-app"({ view, app }) {
    this.stateOf(view).app = app;
    this.refresh({ all: true });
  }
};

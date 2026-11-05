/*
 * The phone's dropdowns. A native <select> has its open list drawn by the browser, which can end up
 * unreadable (Chrome on Windows draws it white, under the phone's light text). These are drawn by the
 * phone like everything else. Template: templates/phone/parts/dropdown.hbs.
 *
 * A page offers a dropdown by exporting `dropdowns: { name(value) {…} }`; picking an option runs it
 * with `this` = the phone. Methods and click actions are installed onto AgentPhone.
 */

/**
 * The data for one dropdown.
 * @param {string} name  which `dropdowns` handler runs when an option is picked
 * @param {Array<{value: string, label: string, selected?: boolean, color?: string, count?: number}>} options
 * @param {object} [extra]  e.g. { title, cls, search } (search: a box that narrows the list)
 */
export function dropdown(name, options, extra = {}) {
  const current = options.find(o => o.selected) ?? options[0];
  return { name, options, current, ...extra };
}

export const actions = {
  "dropdown-toggle"(data, event) {
    this._toggleDropdown(event.currentTarget);
  },
  "dropdown-pick"({ name, value }) {
    this._closeDropdowns();
    DROPDOWNS.get(name)?.call(this, value);
  }
};

export const inputs = {
  ".agent-dropdown-search input": {
    input(event) {
      filterMenu(event.currentTarget.closest(".agent-dropdown-menu"), event.currentTarget.value);
    },
    keydown(event) {
      const menu = event.currentTarget.closest(".agent-dropdown-menu");
      if (event.key === "Enter") {
        event.preventDefault();
        menu.querySelector(".agent-dropdown-option:not([hidden])")?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this._closeDropdowns();
      }
    }
  },
  // The open list: arrow keys move between options, Escape closes it (Enter picks, see ui/a11y.js).
  ".agent-dropdown-menu": {
    keydown(event) {
      const menu = event.currentTarget;
      if (event.key === "Escape") {
        event.preventDefault();
        this._closeDropdowns();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const options = [...menu.querySelectorAll(".agent-dropdown-option:not([hidden])")];
      const at = options.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? Math.min(options.length - 1, at + 1) : Math.max(0, at - 1);
      options[next]?.focus();
    }
  },
  // Clicking anywhere else closes an open dropdown.
  ".agent-phone": {
    click(event) {
      if (!event.target.closest(".agent-dropdown-menu, [data-action=dropdown-toggle]")) this._closeDropdowns();
    }
  }
};

export const methods = {
  /**
   * Open a dropdown's list, or close it if it's open. The list moves to the phone's top level while
   * it's open, so no bar or scrolling panel can cover or clip it; it opens downwards, or upwards when
   * there's more room there.
   */
  _toggleDropdown(button) {
    const phone = this.element?.find(".agent-phone")[0];
    // Its own menu: several dropdowns may share a name (one per App Store row), and an open menu is moved
    // out to the phone, so the button keeps hold of it.
    const menu = (button._menu ??= button.closest(".agent-dropdown")?.querySelector(".agent-dropdown-menu"));
    if (!phone || !menu) return;
    const wasOpen = !menu.hidden;
    this._closeDropdowns();
    if (wasOpen) return;

    phone.append(menu);
    menu.hidden = false;
    button.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    // Positions are inside the phone's border (a skin may give the screen a bezel).
    const outer = phone.getBoundingClientRect();
    const box = { left: outer.left + phone.clientLeft, top: outer.top + phone.clientTop, width: phone.clientWidth, height: phone.clientHeight };
    box.bottom = box.top + box.height;
    const at = button.getBoundingClientRect();
    const width = Math.min(Math.max(at.width, 170), box.width - 12);
    Object.assign(menu.style, {
      minWidth: `${width}px`,
      left: `${Math.max(6, Math.min(at.left - box.left, box.width - width - 6))}px`
    });
    const below = box.bottom - at.bottom - 8;
    const above = at.top - box.top - 8;
    const down = below >= Math.min(menu.scrollHeight, 220) || below >= above;
    Object.assign(menu.style, down
      ? { top: `${at.bottom - box.top + 2}px`, bottom: "", maxHeight: `${below}px` }
      : { top: "", bottom: `${box.bottom - at.top + 2}px`, maxHeight: `${above}px` });
    const search = menu.querySelector(".agent-dropdown-search input");
    if (search) {
      search.value = "";
      filterMenu(menu, "");
      search.focus();
    }
    const selected = menu.querySelector(".selected");
    selected?.scrollIntoView({ block: "nearest" });
    // From the keyboard, the list opens on the option that's picked now.
    if (!search && button.matches(":focus-visible")) (selected ?? menu.querySelector(".agent-dropdown-option"))?.focus();
  },

  _closeDropdowns() {
    const root = this.element?.[0];
    if (!root) return;
    for (const menu of root.querySelectorAll(".agent-dropdown-menu:not([hidden])")) menu.hidden = true;
    for (const button of root.querySelectorAll(".agent-dropdown-btn.open")) {
      button.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    }
    this._flush(); // a redraw that waited for the menu to close
  }
};

/** Show only the options whose label has every word typed (any case). */
function filterMenu(menu, text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const option of menu.querySelectorAll(".agent-dropdown-option")) {
    const label = option.textContent.toLowerCase();
    option.hidden = !words.every(w => label.includes(w));
  }
}

/** name → handler, filled from every page's `dropdowns` (see AgentPhone.js). */
export const DROPDOWNS = new Map();

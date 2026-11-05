/*
 * Long lists show a handful of rows, with a button for the rest. Installed onto AgentPhone (core/pages.js).
 *
 * A template opts a list in with data-short-list="<key>" on the element whose children are the rows, the key
 * unique on its page. Rows that aren't in a list get a <div class="agent-short-list"> around them.
 *   data-keep on a row         it's waiting on an answer, so it's never hidden
 *   data-short-last on a list  it runs oldest first, so its last rows are the ones that show
 * Rows are hidden, not removed: their fields stay there for whatever reads them.
 */

/** How many rows a short list shows. */
export const SHORT_LIST_ROWS = 5;

/** The rows to hide, in showing order. Hiding just one would only swap it for the button, so that's none. */
export function rowsToHide(rows, kept) {
  let room = SHORT_LIST_ROWS - rows.filter(kept).length;
  const hide = rows.filter(row => !kept(row) && room-- <= 0);
  return hide.length > 1 ? hide : [];
}

export const phone = {
  render(html) {
    this._openLists ??= new Set(); // what's been shown in full stays that way across redraws
    for (const list of html.querySelectorAll("[data-short-list]")) {
      const key = list.dataset.shortList;
      const rows = [...list.children];
      const hide = rowsToHide(list.hasAttribute("data-short-last") ? rows.reverse() : rows, row => row.hasAttribute("data-keep"));
      if (!hide.length) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "agent-wide-btn agent-short-more";
      const draw = () => {
        const open = this._openLists.has(key);
        for (const row of hide) row.classList.toggle("agent-short-hidden", !open);
        button.textContent = open ? "Show less" : `Show all (${rows.length})`;
        button.setAttribute("aria-expanded", String(open));
      };
      button.addEventListener("click", () => {
        const closing = this._openLists.delete(key);
        if (!closing) this._openLists.add(key);
        draw();
        // Everything below just moved up: follow the button rather than land somewhere else on the page.
        if (closing) button.scrollIntoView({ block: "nearest" });
      });
      draw();
      list.after(button);
    }
  }
};

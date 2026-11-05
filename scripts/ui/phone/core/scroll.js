/*
 * Keeping the lists' scroll positions across redraws. Installed onto AgentPhone (core/pages.js).
 */

/** Lists whose scroll position survives a redraw (see AgentPhone._render). */
const SCROLLERS = ".agent-inbox, .agent-info, .agent-messages, .agent-gm-calls, .agent-lock-list";

export const methods = {
  /**
   * Scroll positions of the lists on screen, and whether each was at the bottom. Keyed by the page that
   * was drawn (`_shownKey`), not `_pageKey`: a click has usually changed the view already.
   */
  _saveScroll() {
    const el = this.element?.[0];
    if (!el) return null;
    const lists = [...el.querySelectorAll(SCROLLERS)].map(l => ({ top: l.scrollTop, bottom: l.scrollHeight - l.scrollTop - l.clientHeight < 40 }));
    const side = el.querySelector(".agent-split-list .agent-inbox")?.scrollTop;
    return { key: this._shownKey, lists, side };
  },

  /**
   * Put the lists back where they were. Conversations stay pinned to the newest message if they were
   * there, and otherwise stay where the user was reading. A newly opened page starts at the top, and a
   * conversation at its newest message; the split view's conversation list keeps its place.
   */
  _restoreScroll(saved, html) {
    const same = saved?.key === this._pageKey;
    html.querySelectorAll(SCROLLERS).forEach((list, i) => {
      const was = same ? saved.lists[i] : null;
      if (list.matches(".agent-messages") && (!was || was.bottom)) this._pinToBottom(list);
      else if (was) list.scrollTop = was.top;
      else if (saved?.side != null && list.matches(".agent-split-list .agent-inbox")) list.scrollTop = saved.side;
      else list.scrollTop = 0;
    });
    this._shownKey = this._pageKey;
  },

  /** Scroll a conversation to its newest message, and keep it there as its photos load until the user scrolls. */
  _pinToBottom(list) {
    list.scrollTop = list.scrollHeight;
    const pending = [...list.querySelectorAll("img")].filter(img => !img.complete);
    if (!pending.length) return;
    let stick = true;
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) list.addEventListener(type, () => (stick = false), { once: true, passive: true });
    for (const img of pending) img.addEventListener("load", () => stick && (list.scrollTop = list.scrollHeight), { once: true });
  }
};

import { esc } from "../util/text.js";

/*
 * Notification pop-ups: small cards beside the phone button instead of opening the whole phone.
 */


const MAX_TOASTS = 4;

export const Toasts = {
  el: null,
  byId: new Map(),

  container() {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.id = "ctp-toasts";
      document.body.append(this.el);
    }
    return this.el;
  },

  /** Sit next to the given button (or bottom-left if there's none on screen). */
  position(anchor) {
    const el = this.container();
    const rect = anchor && !anchor.hidden ? anchor.getBoundingClientRect() : null;
    if (!rect) {
      Object.assign(el.style, { left: "15px", top: "", bottom: "120px" });
      return;
    }
    const width = 280;
    const right = rect.right + 8 + width <= window.innerWidth;
    Object.assign(el.style, {
      left: `${right ? rect.right + 8 : Math.max(8, rect.left - width - 8)}px`,
      top: `${Math.max(8, Math.min(rect.top, window.innerHeight - 200))}px`,
      bottom: ""
    });
  },

  /**
   * @param {object} options
   * @param {string} options.title
   * @param {string} [options.body]
   * @param {string} [options.img]
   * @param {string} [options.icon]   Font Awesome class used when there's no image
   * @param {Function} [options.onClick]
   * @param {HTMLElement} [options.anchor]
   * @param {number} [options.duration]  0 keeps it until dismissed
   * @param {string} [options.id]        replaces/dismisses a toast by id
   * @param {{label: string, icon?: string, text?: boolean, cls?: string, onClick: Function}[]} [options.actions]
   *   text: show the label on the button (an answer), not only as its tooltip
   */
  show({ title, body = "", img, icon = "fa-comment-dots", onClick, anchor, duration = 6000, id, actions = [], cls = "" }) {
    const container = this.container();
    this.position(anchor);
    if (id) this.dismiss(id);

    const toast = document.createElement("div");
    toast.className = `ctp-toast ${cls}`;
    toast.innerHTML = `
      ${img ? `<img class="ctp-toast-img" src="${esc(img)}">` : `<span class="ctp-toast-img"><i class="${/\bfa-(solid|regular|brands)\b|\bfa[srb]\b/.test(icon) ? icon : `fas ${icon}`}"></i></span>`}
      <div class="ctp-toast-main">
        <div class="ctp-toast-title">${esc(title)}</div>
        ${body ? `<div class="ctp-toast-body">${esc(body)}</div>` : ""}
      </div>
      ${actions.length ? `<div class="ctp-toast-actions${actions.some(a => a.text) ? " text" : ""}">${actions.map((a, i) => `<a class="ctp-toast-action ${a.cls ?? ""}${a.text ? " text" : ""}" data-index="${i}" title="${esc(a.label)}">${a.icon ? `<i class="fas ${a.icon}"></i>` : ""}${a.text ? ` ${esc(a.label)}` : ""}</a>`).join("")}</div>` : ""}
      <a class="ctp-toast-close" title="Dismiss"><i class="fas fa-xmark"></i></a>`;

    const remove = () => {
      if (id && this.byId.get(id) === toast) this.byId.delete(id);
      toast.classList.add("leaving");
      setTimeout(() => toast.remove(), 250);
    };
    toast.dismiss = remove;
    if (id) this.byId.set(id, toast);
    for (const button of toast.querySelectorAll(".ctp-toast-action")) {
      button.addEventListener("click", event => {
        event.stopPropagation();
        actions[Number(button.dataset.index)].onClick?.();
        remove();
      });
    }
    toast.querySelector(".ctp-toast-close").addEventListener("click", event => {
      event.stopPropagation();
      remove();
    });
    toast.addEventListener("click", () => {
      onClick?.();
      remove();
    });

    container.prepend(toast);
    while (container.children.length > MAX_TOASTS) container.lastElementChild.remove();
    if (duration) setTimeout(remove, duration);
  },

  dismiss(id) {
    this.byId.get(id)?.dismiss();
  },

  has(id) {
    return this.byId.has(id);
  }
};

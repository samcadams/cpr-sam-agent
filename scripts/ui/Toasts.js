import { MODULE_ID } from "../config.js";
import { esc } from "../util/text.js";
import { describeControls } from "./a11y.js";

/*
 * Notification pop-ups: small cards beside the phone button instead of opening the whole phone. While
 * the phone is up, the same card drops in as a banner at the top of its screen instead (`phone`).
 * Screen readers announce each one (calls and urgent cards right away). A pop-up's timer waits while
 * the pointer or focus is on it, and "Keep phone pop-ups open" (a client setting) turns timers off.
 * The GM's pop-ups close after the time set in Control (This GM Phone), with a bar along the bottom
 * filling up until they go; ringing calls stay until they stop ringing.
 */

const MAX_TOASTS = 4;
const MAX_BANNERS = 2;

/** The banner strip on an open phone's window (outside its content, so a redraw keeps it). */
function bannerStrip(phone) {
  const win = phone.element?.[0];
  if (!win) return null;
  let el = win.querySelector(":scope > .ctp-banners");
  if (!el) {
    el = document.createElement("div");
    el.className = "ctp-banners";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Phone notifications");
    el.setAttribute("aria-live", "polite");
    win.append(el);
  }
  return el;
}

export const Toasts = {
  el: null,
  byId: new Map(),

  container() {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.id = "ctp-toasts";
      this.el.setAttribute("role", "region");
      this.el.setAttribute("aria-label", "Phone notifications");
      this.el.setAttribute("aria-live", "polite");
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
   * @param {Application} [options.phone]  an open phone: show it as a banner on its screen instead
   * @param {number} [options.duration]  0 keeps it until dismissed
   * @param {string} [options.id]        replaces/dismisses a toast by id
   * @param {{label: string, icon?: string, text?: boolean, cls?: string, onClick: Function}[]} [options.actions]
   *   text: show the label on the button (an answer), not only as its tooltip
   */
  show({ title, body = "", img, icon = "fa-comment-dots", onClick, anchor, phone, duration = 6000, id, actions = [], cls = "" }) {
    const banners = phone ? bannerStrip(phone) : null;
    const container = banners ?? this.container();
    if (!banners) this.position(anchor);
    // A banner covers the screen: it goes after a while even when it asks something (the center keeps it).
    else if (!duration) duration = 8000;
    if (id) this.dismiss(id);

    const toast = document.createElement("div");
    toast.className = `ctp-toast ${cls}`;
    if (/\b(urgent|ctp-toast-call)\b/.test(cls)) toast.setAttribute("role", "alert");
    toast.innerHTML = `
      ${img ? `<img class="ctp-toast-img" src="${esc(img)}" alt="">` : `<span class="ctp-toast-img"><i class="${/\bfa-(solid|regular|brands)\b|\bfa[srb]\b/.test(icon) ? icon : `fas ${icon}`}"></i></span>`}
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

    describeControls(toast);
    container.prepend(toast);
    while (container.children.length > (banners ? MAX_BANNERS : MAX_TOASTS)) container.lastElementChild.remove();
    // The GM's own pop-up time (Control) wins over "Keep phone pop-ups open".
    const gmTime = gmDuration(duration, cls);
    if (gmTime) duration = gmTime;
    else if (game.settings.get(MODULE_ID, "keepPopups")) duration = 0;
    if (duration) holdWhileUsed(toast, duration, remove, game.user.isGM ? timerBar(toast, duration) : undefined);
  },

  dismiss(id) {
    this.byId.get(id)?.dismiss();
  },

  has(id) {
    return this.byId.has(id);
  }
};

/** The GM's own pop-up time in ms (Control → This GM Phone), for everything but a ringing call; else null. */
function gmDuration(duration, cls) {
  if (!game.user.isGM || /\bctp-toast-call\b/.test(cls)) return null;
  const seconds = game.settings.get(MODULE_ID, "gmPopupSeconds");
  if (!seconds || (!duration && !game.settings.get(MODULE_ID, "gmPopupAnswers"))) return null;
  return seconds * 1000;
}

/** A bar along the bottom of `el` that fills from left to right as its time runs out; it waits when the timer does. */
function timerBar(el, ms) {
  const bar = document.createElement("span");
  bar.className = "ctp-toast-timer";
  bar.setAttribute("aria-hidden", "true");
  el.append(bar);
  const fill = bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: ms, easing: "linear", fill: "forwards" });
  return {
    onHold: () => fill.pause(),
    // Back from a hold with a couple of seconds' grace: the bar finishes with the timer.
    onResume: left => {
      const rest = ms - (fill.currentTime ?? 0);
      fill.playbackRate = rest > 0 ? rest / left : 1;
      fill.play();
    }
  };
}

/**
 * Run `done` after `ms`, but not while the pointer or keyboard focus is on `el`: the clock stops there
 * and starts again (with at least a couple of seconds left) when they leave.
 */
export function holdWhileUsed(el, ms, done, { onHold, onResume } = {}) {
  let left = ms;
  let started = Date.now();
  let timer = setTimeout(done, left);
  const hold = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    left -= Date.now() - started;
    onHold?.();
  };
  // (While leaving, the browser may still count the pointer as over it: each check asks about the other.)
  const resume = still => {
    if (timer || el.matches(still)) return;
    started = Date.now();
    left = Math.max(left, 2000);
    timer = setTimeout(done, left);
    onResume?.(left);
  };
  el.addEventListener("pointerenter", hold);
  el.addEventListener("focusin", hold);
  el.addEventListener("pointerleave", () => resume(":focus-within"));
  el.addEventListener("focusout", () => setTimeout(() => resume(":hover, :focus-within"), 0));
}

import { GmButton, TokenButton } from "./buttons.js";
import { AgentPhone } from "./phone/AgentPhone.js";
import { MODULE_ID } from "../config.js";
import { commsOn } from "../model/features.js";
import { personaColor } from "../model/threads.js";
import { store } from "../store.js";
import { esc, formatDuration, initials } from "../util/text.js";

/*
 * The minimised call: a small card by the phone button while you're on a call and your phone isn't
 * open (closed or minimised). It shows who's on the call and the timer, and hangs up or reopens it.
 * Drag it by its top line to put it anywhere (remembered per client; double-click puts it back by
 * the button). The GM may be on it as several NPCs: each can leave on its own, or all at once.
 */

const STATES = { joined: "", ringing: "ringing…" };

export const CallWidget = {
  el: null,
  timer: null,

  /** Show, refresh or hide the card to match this user's call and phone. */
  update() {
    const calls = commsOn() ? store.myCalls() : [];
    const phone = AgentPhone.primary();
    const phoneOpen = phone.rendered && !phone._minimized;
    // A ringing call shows as a notification instead.
    const role = calls.some(r => r.ringing.length) ? null : calls.find(r => r.joined.length);
    if (!role || phoneOpen) return this.hide();
    this.render(role, phone);
  },

  render({ call, joined }, phone) {
    const el = (this.el ??= this.create());
    const mine = new Set(joined.map(p => p.key));
    const live = call.participants.filter(p => !mine.has(p.key) && p.state in STATES);
    // The GM on as several NPCs: one Leave per NPC.
    const several = game.user.isGM && joined.length > 1;
    const as = !game.user.isGM ? "" : several
      ? `<ol class="ctp-call-widget-as">${joined.map(p => `<li style="--persona: ${personaColor(p.name)}"><i class="agent-persona-dot"></i>${esc(p.name)}
          <a data-leave="${esc(p.key)}" title="${esc(p.name)} leaves the call"><i class="fas fa-phone-slash"></i></a></li>`).join("")}</ol>`
      : `<div class="ctp-call-widget-as">As ${esc(joined[0]?.name ?? "")}</div>`;
    el.innerHTML = `
      <div class="ctp-call-widget-head" title="Drag to move · double-click to put it back">
        <i class="fas fa-grip-vertical ctp-call-widget-grip"></i><i class="fas fa-phone"></i> Active call
        <span class="ctp-call-widget-timer">${call.startedAt ? formatDuration(Date.now() - call.startedAt) : "Calling…"}</span>
      </div>
      ${as}
      <ol class="ctp-call-widget-people">
        ${live.map(p => `<li>${p.img ? `<img src="${esc(p.img)}">` : `<span class="ctp-call-widget-initials">${esc(initials(p.name))}</span>`}
          <span>${esc(p.name)}</span>${STATES[p.state] ? `<em>${STATES[p.state]}</em>` : ""}</li>`).join("")}
      </ol>
      <div class="ctp-call-widget-actions">
        <a data-widget="open" title="Open the call"><i class="fas fa-up-right-and-down-left-from-center"></i></a>
        <a data-widget="hangup" class="hangup" title="${several ? "Everyone of yours leaves" : "Hang up"}"><i class="fas fa-phone-slash"></i></a>
      </div>`;
    el.querySelector("[data-widget=open]").addEventListener("click", () => {
      phone.callHidden = false;
      if (phone._minimized) phone.maximize();
      else phone.render(true);
    });
    el.querySelector("[data-widget=hangup]").addEventListener("click", () => {
      for (const p of joined) store.request("call-hangup", { callId: call.id, key: p.key });
    });
    for (const a of el.querySelectorAll("[data-leave]")) {
      a.addEventListener("click", () => store.request("call-hangup", { callId: call.id, key: a.dataset.leave }));
    }
    this.makeDraggable(el.querySelector(".ctp-call-widget-head"));
    el.hidden = false;
    this.place();

    clearInterval(this.timer);
    if (call.startedAt) {
      this.timer = setInterval(() => {
        el.querySelector(".ctp-call-widget-timer").textContent = formatDuration(Date.now() - call.startedAt);
      }, 1000);
    }
  },

  create() {
    const el = document.createElement("div");
    el.id = "ctp-call-widget";
    el.hidden = true;
    document.body.append(el);
    window.addEventListener("resize", () => this.place());
    return el;
  },

  /** Drag the card by its head; where it's dropped is saved for this client. */
  makeDraggable(handle) {
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = this.el.getBoundingClientRect();
      const dx = event.clientX - start.left;
      const dy = event.clientY - start.top;
      handle.setPointerCapture(event.pointerId);
      const move = e => this.moveTo(e.clientX - dx, e.clientY - dy);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        const box = this.el.getBoundingClientRect();
        game.settings.set(MODULE_ID, "callWidgetPosition", { left: box.left, top: box.top });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
    handle.addEventListener("dblclick", () => {
      game.settings.set(MODULE_ID, "callWidgetPosition", null);
      this.place(true);
    });
  },

  /** Put the card at a point, kept on screen. */
  moveTo(left, top) {
    const el = this.el;
    Object.assign(el.style, {
      left: `${Math.max(0, Math.min(left, window.innerWidth - el.offsetWidth))}px`,
      top: `${Math.max(0, Math.min(top, window.innerHeight - el.offsetHeight))}px`,
      bottom: ""
    });
  },

  /** Where it was dragged to; else beside the phone button (like notifications), or bottom-left. */
  place(ignoreSaved = false) {
    const el = this.el;
    if (!el || el.hidden) return;
    const saved = ignoreSaved ? null : game.settings.get(MODULE_ID, "callWidgetPosition");
    if (saved) return this.moveTo(saved.left, saved.top);
    const button = game.user.isGM ? GmButton.el : TokenButton.el;
    const rect = button && !button.hidden ? button.getBoundingClientRect() : null;
    if (!rect) return Object.assign(el.style, { left: "15px", top: "", bottom: "120px" });
    const width = el.offsetWidth || 220;
    const right = rect.right + 8 + width <= window.innerWidth;
    Object.assign(el.style, {
      left: `${right ? rect.right + 8 : Math.max(8, rect.left - width - 8)}px`,
      top: `${Math.max(8, Math.min(rect.bottom - el.offsetHeight, window.innerHeight - el.offsetHeight - 8))}px`,
      bottom: ""
    });
  },

  hide() {
    clearInterval(this.timer);
    if (this.el) this.el.hidden = true;
  }
};

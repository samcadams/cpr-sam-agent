import { AgentPhone } from "./phone/AgentPhone.js";
import { MODULE_ID } from "../config.js";
import { phoneSubject } from "../model/agent.js";
import { commsOn, noSignalSince } from "../model/features.js";
import { store } from "../store.js";

/*
 * The floating Agent and GM Phone buttons: draggable, with unread badges and a ringing state.
 */

class FloatingButton {
  constructor({ id, icon, title, setting, offset, onClick }) {
    Object.assign(this, { id, icon, title, setting, offset, onClick });
    this.el = null;
  }

  create() {
    const el = document.createElement("div");
    el.id = this.id;
    el.className = "ctp-float-button";
    el.title = this.title;
    el.hidden = true;
    el.innerHTML = `<i class="fas ${this.icon}"></i><span class="ctp-badge" hidden></span>`;
    document.body.append(el);
    this.el = el;

    const saved = game.settings.get(MODULE_ID, this.setting);
    this.position = { left: saved?.left ?? 15 + this.offset, top: saved?.top ?? window.innerHeight - 260 };

    let drag = null;
    el.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, left: el.offsetLeft, top: el.offsetTop, moved: false };
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener("pointermove", event => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      this.place(drag.left + dx, drag.top + dy);
    });
    el.addEventListener("pointerup", event => {
      if (!drag) return;
      el.releasePointerCapture(event.pointerId);
      if (drag.moved) game.settings.set(MODULE_ID, this.setting, this.position);
      else this.onClick();
      drag = null;
    });
    window.addEventListener("resize", () => this.place(this.position.left, this.position.top));
  }

  place(left, top) {
    const el = this.el;
    const width = el.offsetWidth || 46;
    const height = el.offsetHeight || 46;
    this.position = {
      left: Math.clamp(left, 0, window.innerWidth - width),
      top: Math.clamp(top, 0, window.innerHeight - height)
    };
    el.style.left = `${this.position.left}px`;
    el.style.top = `${this.position.top}px`;
  }

  update({ visible, unread = 0, offline = false, ringing = false, label }) {
    const el = this.el;
    if (!el) return;
    const wasHidden = el.hidden;
    el.hidden = !visible;
    if (visible && wasHidden) this.place(this.position.left, this.position.top);
    if (label) el.title = label;
    const badge = el.querySelector(".ctp-badge");
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = !unread;
    el.classList.toggle("offline", offline);
    el.classList.toggle("ringing", ringing);
  }
}

export const TokenButton = new FloatingButton({
  id: "ctp-phone-button",
  icon: "fa-mobile-screen-button",
  title: "Agent",
  setting: "buttonPosition",
  offset: 0,
  onClick: () => AgentPhone.toggle("token")
});

export const GmButton = new FloatingButton({
  id: "ctp-gm-phone-button",
  icon: "fa-tower-cell",
  title: "GM Phone",
  setting: "gmButtonPosition",
  offset: 56,
  onClick: () => AgentPhone.toggle("console")
});

/**
 * Show/hide buttons for the phone in hand, with unread counts and ringing state. Players get the
 * token button (their Agent); GMs get the GM Phone button, which speaks for every NPC.
 */
export function updateButtons() {
  const subject = phoneSubject();
  // Communications off: no calls, and no unread badges.
  const comms = commsOn();
  const role = comms ? store.myCall() : null;
  const incoming = role?.kind === "incoming";
  const unread = subject && comms ? store.totalUnread(store.threadsFor(subject.actor.id), game.user, subject.actor.id) : 0;

  const playerCall = !game.user.isGM && !!role;
  TokenButton.update({
    visible: !!subject || playerCall,
    unread,
    offline: !store.online || (!!subject && !!noSignalSince(subject.actor.id)),
    ringing: !game.user.isGM && incoming,
    label: subject ? `${subject.name}'s ${subject.agent === "internal" ? "Internal Agent" : "Agent"}` : "Agent"
  });

  if (game.user.isGM) {
    GmButton.update({ visible: true, unread: comms ? store.totalUnread() : 0, offline: !store.online, ringing: incoming });
  }

  // The token phone closes when the Agent is put away (unless a call is up on it).
  const tokenPhone = AgentPhone.token;
  if (tokenPhone?.rendered && !subject && !playerCall) tokenPhone.close();
}

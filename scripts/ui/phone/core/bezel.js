import { commsOn } from "../../../model/features.js";
import { store } from "../../../store.js";

/*
 * The phone's hardware (styles/phone/bezel.css): the window header is the top bezel, with a notification
 * LED, an earpiece and a front camera; the resize bar along the bottom is the speaker grille. They come
 * alive with the phone's state, as classes on the window:
 *   hw-ring    a call ringing: the grille and earpiece pulse in the skin's ring colour, the LED blinks
 *   hw-call    on a call: the grille and earpiece glow steadily, the LED stays lit
 *   hw-unread  unread texts: the LED blinks in the skin's notification colour
 * Reduce motion stops the blinking (base.css). Installed onto AgentPhone (core/pages.js).
 */

const BEZEL = `<div class="agent-bezel" aria-hidden="true"><span class="agent-led"></span><span class="agent-earpiece"></span><span class="agent-camera"></span></div>`;

export const methods = {
  /** What the hardware shows: the line ("ring", "call" or null) and whether texts wait unread. */
  _hardwareState() {
    let line = null;
    if (this.handlesCalls && commsOn()) {
      if (this.isGM) {
        const calls = store.myCalls();
        if (calls.some(r => r.ringing.length)) line = "ring";
        else if (calls.length) line = "call";
      } else {
        const role = store.myCall();
        if (role) line = role.kind === "incoming" ? "ring" : "call";
      }
    }
    const unread = !!this._ctx && !!this.dockBadge(this._ctx, "messages").badge;
    return { line, unread };
  },

  /** Put the hardware into the window's header (once) and light it for the phone's state. */
  _paintBezel() {
    const win = this.element?.[0];
    const header = win?.querySelector(".window-header");
    if (!header) return;
    if (!header.querySelector(".agent-bezel")) header.querySelector(".window-title")?.insertAdjacentHTML("afterend", BEZEL);
    const { line, unread } = this._hardwareState();
    win.classList.toggle("hw-ring", line === "ring");
    win.classList.toggle("hw-call", line === "call");
    win.classList.toggle("hw-unread", unread);
  }
};

export const phone = {
  render() {
    this._paintBezel();
  }
};

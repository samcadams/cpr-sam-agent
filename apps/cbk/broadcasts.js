import { MODULE_ID } from "../../scripts/config.js";
import { store } from "../../scripts/store.js";
import { reduceMotion } from "../../scripts/ui/a11y.js";
import { playSound } from "../../scripts/util/audio.js";
import { esc } from "../../scripts/util/text.js";
import { BROADCAST_KINDS, CBK, cbkConfig, pendingBroadcasts } from "./model.js";

/*
 * A Fixer's broadcast on the phone, nowhere else. A raid warning covers the phone's screen in red whichever
 * app is open, with its own alarm; the others are a little popup while CBK is open. Each waits as its Agent alert:
 * dismissing clears the alert, and one still running shows the next time the phone or CBK opens. While the phone is
 * away they're ordinary notifications (ui/notifications.js). Not colour alone: a big icon and RAID WARNING; with
 * "Reduce motion" it doesn't flash.
 */

const ALARM = `modules/${MODULE_ID}/sounds/alarm-security.ogg`;

let alarm = null;

/** The raid warning's alarm, once, at this user's phone volume. Dismissing the warning stops it. */
export function playRaidAlarm() {
  const volume = game.settings.get(MODULE_ID, "volume");
  if (volume) alarm = playSound(ALARM, { volume });
}

const stopAlarm = () => {
  alarm?.then(sound => sound?.stop());
  alarm = null;
};

/** Does this alert still wait to be shown on the phone? Then opening it mustn't clear it. */
export const broadcastWaits = alert => pendingBroadcasts({ [alert.id]: alert }, alert.actorId, cbkConfig()).length > 0;

function draw(phone, { alert, broadcast }) {
  const raid = broadcast.kind === "raid";
  const el = document.createElement("div");
  el.className = `agent-cbk-popup ${raid ? "raid" : "notice"}${raid && !reduceMotion() ? " flashing" : ""}`;
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", BROADCAST_KINDS[broadcast.kind].label);
  el.tabIndex = -1;
  el.dataset.alert = alert.id;
  el.innerHTML = `<div class="agent-cbk-popup-box">
    <i class="fas ${BROADCAST_KINDS[broadcast.kind].icon}" aria-hidden="true"></i>
    <b>${raid ? "RAID WARNING" : esc(BROADCAST_KINDS[broadcast.kind].label)}</b>
    <p>${esc(alert.text)}</p>
    ${alert.from ? `<small>${esc(alert.from)} via CBK</small>` : ""}
    <span class="agent-cbk-popup-dismiss">Tap to dismiss</span>
  </div>`;
  const close = () => {
    el.remove();
    if (raid) stopAlarm();
    phone._shadeClear([{ kind: "alert", alert }]);
  };
  el.addEventListener("click", close);
  el.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  });
  const win = phone.element[0];
  win.querySelector(".window-content").append(el);
  // Not out of the chat box or another window the player is typing in.
  const active = document.activeElement;
  if (!active || active === document.body || win.contains(active)) el.focus();
}

/**
 * Put on this phone what should be on it now, and take off what's ended (the phone's redraws and each alert call
 * this). Returns the alert showing on a phone that's up, or null.
 */
export function showBroadcast(phone) {
  if (phone.mode !== "token" || !phone.rendered) return null;
  const win = phone.element?.[0];
  const pending = pendingBroadcasts(store.apps.alerts, phone._ctx?.actorId, cbkConfig());
  const inCbk = phone.app === CBK && !phone.shadeOpen && !!win?.querySelector(".agent-cbk");
  const show = pending.find(p => p.broadcast.kind === "raid") ?? (inCbk ? pending[0] : null);
  const el = win?.querySelector(".agent-cbk-popup");
  if (el && el.dataset.alert !== show?.alert.id) el.remove();
  if (show && el?.dataset.alert !== show.alert.id) draw(phone, show);
  return show && !phone._minimized ? show.alert : null;
}

import { commsOn } from "../../../model/features.js";
import { store } from "../../../store.js";
import { esc, formatDuration } from "../../../util/text.js";

/*
 * The Director's call strip, under its tabs on every tab: each call the GM holds an NPC in, with
 * Answer / Decline / Leave per NPC and End for everyone. While the Director takes calls (client
 * setting directorCalls, see state.js) this is where they ring: no pop-ups, no GM Phone call screen.
 */

const STATES = { ringing: "ringing", joined: "on", left: "left", declined: "declined", missed: "missed" };

const timer = call => (call.startedAt ? formatDuration(Date.now() - call.startedAt) : "Calling…");

function callCard({ call, ringing, joined }) {
  const caller = call.participants.find(p => p.key === call.callerKey);
  const title = call.groupName ? `Group call · ${call.groupName}` : `${caller?.name ?? "Unknown"}${call.line ? ` · ${call.line}` : ""}`;
  const people = call.participants.filter(p => p.state in STATES && p.state !== "left")
    .map(p => `<li class="${p.state}">${esc(p.name)}${p.hidden ? " (hidden)" : ""} <em>${STATES[p.state]}</em></li>`).join("");
  const button = (action, key, label, cls = "") =>
    `<button type="button" class="${cls}" data-director="${action}" data-call-id="${call.id}"${key ? ` data-key="${esc(key)}"` : ""}>${label}</button>`;
  const mine = [
    ...ringing.map(p => button("call-answer", p.key, `<i class="fas fa-phone"></i> Answer as ${esc(p.name)}`, "accept")
      + button("call-decline", p.key, `<i class="fas fa-phone-slash"></i> Decline`, "decline")),
    ...joined.map(p => button("call-hangup", p.key, `<i class="fas fa-phone-slash"></i> ${esc(p.name)} leaves`, "decline"))
  ].join("");
  return `<article class="director-call ${ringing.length ? "ringing" : ""}" aria-label="${esc(title)}">
    <header><i class="fas fa-phone" aria-hidden="true"></i> <strong>${esc(title)}</strong>
      <span class="director-call-timer" data-started="${call.startedAt ?? ""}">${timer(call)}</span></header>
    <ol class="director-call-people">${people}</ol>
    <div class="director-call-actions">${mine}${button("call-close", null, "End for everyone", "end")}</div>
  </article>`;
}

/** The strip's HTML: nothing while no call involves the GM. */
export function callStrip() {
  if (!commsOn()) return "";
  return store.myCalls().map(callCard).join("");
}

/** Tick the strip's timers between redraws. */
export function callTimers(root) {
  for (const el of root?.querySelectorAll(".director-call-timer[data-started]") ?? []) {
    const started = Number(el.dataset.started);
    if (started) el.textContent = formatDuration(Date.now() - started);
  }
}

export const actions = {
  "call-answer"({ callId, key }) {
    store.request("call-answer", { callId, key });
  },
  "call-decline"({ callId, key }) {
    store.request("call-decline", { callId, key });
  },
  "call-hangup"({ callId, key }) {
    store.request("call-hangup", { callId, key });
  },
  "call-close"({ callId }) {
    store.request("call-close", { callId });
  }
};

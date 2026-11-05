import { THEMES } from "./agent.js";
import { moneyLabel } from "./money.js";
import { personaColor } from "./threads.js";
import { esc } from "../util/text.js";

/*
 * "Share to chat": a few texts from one conversation, posted publicly as a Neon Agent screen
 * (host/messages.js _onShareTexts builds it from the stored messages, so nobody can fake a text).
 * Always the Neon Agent look, in the sharer's colour palette (styles/toasts.css .ctp-text-share).
 */

/** At most this many texts at a time (call and other system lines in between don't count). */
export const MAX_SHARE = 8;
/** ...and never more lines than this in all. */
export const MAX_SHARE_LINES = 20;

export const shareTheme = theme => (theme in THEMES ? theme : "nightcity");

/** Does this run (messages from one conversation, in order) fit in one card? */
export const shareFits = run => run.length > 0 && run.length <= MAX_SHARE_LINES && run.filter(m => !m.system).length <= MAX_SHARE;

/** One message as the card shows it: words, plus a one-line note for money, jobs and pins. */
function body(m, mine) {
  const note = m.money ? `💸 ${moneyLabel(m.money, mine)}` : m.job ? `💼 Job: ${m.job.name}` : m.location ? `📍 ${m.location.label}` : "";
  const img = m.image ? `<img class="ctp-ts-photo" src="${esc(m.image)}" alt="Photo">` : "";
  const parts = [img];
  if (note) parts.push(`<span class="ctp-ts-note">${esc(note)}</span>`);
  if (m.text) parts.push(`<span class="ctp-ts-text">${esc(m.text)}</span>`);
  return parts.join("");
}

/**
 * The card's HTML.
 *  title   the conversation, as the sharer's phone heads it
 *  sharer  who shared it (named in the tag line, and for screen readers on their own texts)
 *  theme   the sharer's colour palette (THEMES)
 *  run     the messages, in order
 *  mine    m => did the sharer's side write it
 *  sender  m => the name shown above someone else's text (groups), or null
 */
export function shareCard({ title, sharer, theme, run, mine, sender = () => null }) {
  let lastDate = null;
  const lines = run.map(m => {
    const out = [];
    if (m.date && m.date !== lastDate) out.push(`<li class="ctp-ts-date">${esc(m.date)}</li>`);
    if (m.date) lastDate = m.date;
    if (m.system) {
      const text = m.call && m.name ? `${m.name} · ${m.text}` : m.text;
      out.push(`<li class="ctp-ts-system">${m.call ? '<i class="fas fa-phone"></i> ' : ""}${esc(text)}${m.time ? ` · ${esc(m.time)}` : ""}</li>`);
      return out.join("");
    }
    const own = !!mine(m);
    const who = own ? null : sender(m);
    const style = who ? ` style="--persona: ${personaColor(who)}"` : "";
    // Sides are shown by alignment and colour; screen readers get who wrote it.
    const label = who ? `<span class="ctp-ts-sender">${esc(who)}</span>` : `<span class="ctp-ts-sr">${esc(own ? sharer : title)}:</span>`;
    out.push(
      `<li class="ctp-ts-msg ${own ? "mine" : "theirs"}"${style}>${label}<div class="ctp-ts-bubble">${body(m, own)}</div>` +
        `${m.time ? `<span class="ctp-ts-time">${esc(m.time)}</span>` : ""}</li>`
    );
    return out.join("");
  });
  const count = run.filter(m => !m.system).length;
  return (
    `<div class="ctp-text-share theme-${shareTheme(theme)}">` +
    `<div class="ctp-ts-tag"><i class="fas fa-mobile-screen-button"></i> ${count} text${count === 1 ? "" : "s"} · from ${esc(sharer)}'s Agent</div>` +
    `<div class="ctp-ts-head"><span class="ctp-ts-slash" aria-hidden="true">//</span> <b class="ctp-ts-name">${esc(title)}</b></div>` +
    `<ol class="ctp-ts-msgs">${lines.join("")}</ol></div>`
  );
}

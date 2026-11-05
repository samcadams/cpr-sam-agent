import { AgentMonitor } from "../../AgentMonitor.js";
import { esc } from "../../../util/text.js";
import { avatar } from "./comms.js";

/*
 * The Agent strip under the Director's tabs, on every tab: each player character's Agent in a line, with
 * its state (put away, lock screen, player offline...) or the app open on it and what's on its screen.
 * The rows are the Agent Monitor's (ui/AgentMonitor.js), from a monitor of its own that's never drawn;
 * the Dashboard's Agents card has the rest (players, history, signal).
 */

let monitor = null;

export function agentStrip() {
  monitor ??= new AgentMonitor();
  const { rows } = monitor.getData();
  if (!rows.length) return "";
  return rows.map(r => {
    const state = r.open ? (r.icon ? "app" : "locked") : r.online ? "away" : "offline";
    const title = [r.name, r.status, r.screen, r.typing ? "typing" : "", r.players.map(p => p.name).join(", ")].filter(Boolean).join(" · ");
    return `<li class="director-strip-pc ${state}" title="${esc(title)}">${avatar(r.img, r.name)}
      <span><b>${esc(r.name)}</b><small>${r.icon ? `<i class="${esc(r.icon)}" aria-hidden="true"></i> ` : ""}${esc(r.status)}${r.screen ? ` · ${esc(r.screen)}` : ""}${r.typing ? ` <i class="fas fa-ellipsis" title="Typing"></i>` : ""}</small></span></li>`;
  }).join("");
}

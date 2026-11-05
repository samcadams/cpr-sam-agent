import * as directors from "../../../../apps/directors.js";
import { AgentMonitor } from "../../AgentMonitor.js";
import { approveContactRequest } from "../../phone/pages/contacts.js";
import { MODULE_ID, TEMPLATES } from "../../../config.js";
import { APPS, appFeature } from "../../../model/apps.js";
import { appearance } from "../../../model/appearance.js";
import { playerCharacters } from "../../../model/contacts.js";
import { feature, features, setFeature } from "../../../model/features.js";
import { displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { patchSetting } from "../../../util/settings.js";
import { ago, esc } from "../../../util/text.js";

/*
 * Director → Dashboard: what needs the GM now and the world's switches.
 *   Agents          the Agent Monitor itself (ui/AgentMonitor.js): its template, data and controls
 *                   (data-monitor, run by a never-drawn monitor of the Director's own)
 *   Waiting on you  what players and the writer asked for that only the GM can settle: contact requests,
 *                   then each app's (apps/<id>/director.js `approvals()`, for the apps switched on):
 *                   Great River's orders, the Garden's draft batches
 *   Switches        Control's app switches and each character's signal
 * Calls ring in the strip above every tab (calls.js).
 *
 * An approval row: { key, ts, source, title, detail, actions: [{ action, label, disabled?, title?, data? }] },
 * each action a Director control (data-director, with data-key and its data) the app's director.js
 * handles; "goto" opens a tab (data: { tab, gardenTab, economyApp, marketTab }).
 */

/** The Director's own Agent Monitor, never drawn: its data and controls. */
let monitor = null;
let monitorTemplate = null;

/** The Agent Monitor's template, compiled (once Foundry has loaded it). */
export async function loadMonitorTemplate() {
  monitorTemplate = await getTemplate(TEMPLATES.monitor);
}

/** An Agent Monitor control pressed in the Agents card. */
export function monitorAct(director, el) {
  monitor ??= new AgentMonitor();
  monitor.act(el);
  director.refresh({ activity: true });
}

/** Contact requests, as approval rows. */
function contactRequests() {
  if (!feature("comms")) return [];
  return store.visibleRequests().map(r => ({
    key: r.id,
    ts: r.ts,
    source: "Contacts",
    title: `${game.actors.get(r.actorId) ? displayName(game.actors.get(r.actorId)) : "?"} asks to add ${r.name}`,
    detail: r.note ?? "",
    actions: [
      { action: "request-approve", label: "Approve…" },
      { action: "request-deny", label: "Deny" }
    ]
  }));
}

/** Everything waiting for the GM, oldest first. */
export function approvals() {
  const rows = contactRequests();
  for (const [id, app] of Object.entries(directors)) {
    if (app.approvals && feature(appFeature(id))) rows.push(...app.approvals());
  }
  return rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

function approvalsHtml() {
  const rows = approvals();
  if (!rows.length) return `<p class="director-empty">Nothing waiting. Players' contact requests, Great River orders and the Garden writer's draft batches show up here.</p>`;
  return `<ol class="director-approvals">${rows.map(row => `<li>
    <span class="director-source">${esc(row.source)}</span>
    <strong>${esc(row.title)}</strong>${row.ts ? ` <span class="director-ago">${ago(row.ts)}</span>` : ""}
    ${row.detail ? `<p>${esc(row.detail)}</p>` : ""}
    <div class="director-row-actions">${row.actions.map(a => `<button type="button" class="${a.primary ? "primary" : ""}" data-director="${a.action}" data-key="${esc(row.key)}"
      ${Object.entries(a.data ?? {}).map(([k, v]) => `data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${esc(String(v))}"`).join(" ")}
      ${a.disabled ? "disabled" : ""} ${a.title ? `title="${esc(a.title)}"` : ""}>${esc(a.label)}</button>`).join("")}</div>
  </li>`).join("")}</ol>`;
}

function agentsHtml() {
  monitor ??= new AgentMonitor();
  if (!monitorTemplate) return `<p class="director-empty">Loading…</p>`;
  const html = monitorTemplate(monitor.getData(), { allowProtoMethodsByDefault: true, allowProtoPropertiesByDefault: true });
  return `<div class="ctp-agent-monitor director-monitor">${html}</div>`;
}

function switchesHtml() {
  const on = features();
  const look = appearance();
  const apps = [
    { key: "comms", label: "Communications", icon: look.icons.messages },
    { key: "jobs", label: look.names.quests, icon: look.icons.jobs },
    ...Object.keys(APPS).map(id => ({ key: appFeature(id), label: look.names[id], icon: look.icons[id] }))
  ];
  const offline = game.settings.get(MODULE_ID, "noSignal") ?? {};
  return `<fieldset class="director-switches"><legend>Apps</legend>${apps.map(a => `<label>
      <input type="checkbox" data-director="feature" data-feature="${a.key}" ${on[a.key] ? "checked" : ""}>
      <i class="${esc(a.icon ?? "")}" aria-hidden="true"></i> ${esc(a.label ?? a.key)}</label>`).join("")}</fieldset>
    <fieldset class="director-switches"><legend>Signal</legend>${playerCharacters().map(a => `<label>
      <input type="checkbox" data-director="signal" data-actor-id="${a.id}" ${offline[a.id] ? "" : "checked"}> ${esc(displayName(a))}</label>`).join("")}</fieldset>`;
}

export function html() {
  return `<div class="director-dashboard">
    <section class="director-card director-card-agents">
      <h2>Agents <button type="button" data-director="open-monitor" title="Open the Agent Monitor as its own see-through window"><i class="fas fa-binoculars" aria-hidden="true"></i></button></h2>
      <div class="director-fill" data-part="agents">${agentsHtml()}</div></section>
    <section class="director-card director-card-approvals">
      <h2>Waiting on you</h2>
      <div class="director-fill" data-part="approvals">${approvalsHtml()}</div></section>
    <section class="director-card director-card-switches"><h2>Switches</h2><div class="director-fill" data-part="switches">${switchesHtml()}</div></section>
  </div>`;
}

const PARTS = { approvals: approvalsHtml, agents: agentsHtml, switches: switchesHtml };

/** Redraw each card's contents (switches only when a setting changed, so a click isn't lost). */
export function refresh(director, root, change = {}) {
  for (const [part, draw] of Object.entries(PARTS)) {
    if (part === "switches" && !change.settings && !change.all) continue;
    const el = root.querySelector(`[data-part="${part}"]`);
    if (!el) continue;
    const scroll = [el.scrollTop, el.querySelector(".agent-monitor-list")?.scrollTop ?? 0];
    el.innerHTML = draw();
    el.scrollTop = scroll[0];
    const list = el.querySelector(".agent-monitor-list");
    if (list) list.scrollTop = scroll[1];
  }
}

export const actions = {
  /** Open a tab (and, for the Garden, one of its pages). */
  goto({ tab, gardenTab, economyApp, marketTab }) {
    if (gardenTab) this.logic.gardenTab = gardenTab;
    if (economyApp) this.stateOf("economy").app = economyApp;
    if (marketTab) this.logic.marketTab = marketTab;
    this.tab = tab;
    this.render();
  },
  "request-approve"({ key }) {
    approveContactRequest(key);
  },
  "request-deny"({ key }) {
    store.request("request-resolve", { requestId: key, approve: false });
  },
  "open-monitor"() {
    AgentMonitor.toggle();
  },
  feature({ feature: key }, event) {
    setFeature(key, event.target.checked);
  },
  signal({ actorId }, event) {
    const on = event.target.checked;
    patchSetting("noSignal", offline => {
      if (on) delete offline[actorId];
      else offline[actorId] ??= Date.now();
    });
  }
};

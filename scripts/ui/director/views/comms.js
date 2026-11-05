import { appearance } from "../../../model/appearance.js";
import { findContact, getContacts, playerCharacters } from "../../../model/contacts.js";
import { noSignalSince } from "../../../model/features.js";
import { displayName, personaColor } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { esc, initials } from "../../../util/text.js";

/*
 * Director → Comms: the GM Phone's Messages, wide. Everything comes from director.logic (logic.js),
 * the GM Phone's own state and rules: whose phone and who the GM acts as (the same pickers), the SIM
 * tiles, the selected-token offer, the inbox rows (pins, search, hidden caller IDs, blocked), and the
 * open conversation's page data (directData, groupData, groupInfoData, serviceData). Buttons run the GM
 * Phone's own actions (data-director="phone:<action>"); sending goes through its _sendMessage, so
 * attachments, a group's speaker and service replies work as on the phone.
 */

/** A control that runs a GM Phone action, with the given data- attributes. */
export function phoneBtn(action, label, { data = {}, cls = "", title = "", icon = "", disabled = false } = {}) {
  const attrs = Object.entries(data).filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => ` data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${esc(String(v))}"`).join("");
  return `<button type="button" class="${cls}" data-director="phone:${action}"${attrs}${title ? ` title="${esc(title)}"` : ""}${disabled ? " disabled" : ""}>`
    + `${icon ? `<i class="fas ${icon}" aria-hidden="true"></i>` : ""}${label ? ` ${label}` : ""}</button>`;
}

/** A picture, or initials on the persona's colour. */
export function avatar(img, name, color) {
  if (img) return `<img class="director-avatar" src="${esc(img)}" alt="">`;
  return `<span class="director-avatar initials" style="--persona: ${esc(color ?? personaColor(name ?? "?"))}">${esc(initials(name ?? "?"))}</span>`;
}

/* ---------------- The bar: whose phone, acting as, SIM tiles, the token offer ---------------- */

function barHtml(director) {
  const logic = director.logic;
  const pcs = playerCharacters();
  if (!pcs.some(a => a.id === logic.inbox)) logic.inbox = "all";
  const whose = [`<option value="all">All phones</option>`, ...pcs.map(a => {
    const unread = store.totalUnread(store.threadsFor(a.id));
    return `<option value="${a.id}" ${a.id === logic.inbox ? "selected" : ""}>${esc(displayName(a))}${noSignalSince(a.id) ? " (no signal)" : ""}${unread ? ` · ${unread}` : ""}</option>`;
  })].join("");
  const current = logic.persona?.name.toLowerCase() ?? "";
  const as = [`<option value="">Anyone</option>`, ...logic.personas().map(name => {
    const unread = store.totalUnread(store.threadsForNpc(name));
    return `<option value="${esc(name)}" ${name.toLowerCase() === current ? "selected" : ""}>${esc(name)}${unread ? ` · ${unread}` : ""}</option>`;
  })].join("");

  const sims = logic.simTiles();
  const tiles = [`<button type="button" class="director-sim ${sims.all ? "active" : ""}" data-director="phone:sim-pick" data-name="">All</button>`,
    ...sims.tiles.map(t => `<button type="button" class="director-sim ${t.active ? "active" : ""}" style="--persona: ${esc(t.color)}" data-director="phone:sim-pick" data-name="${esc(t.name)}" title="Act as ${esc(t.name)}">
      <span class="director-sim-dot"></span>${esc(t.name)}${t.unread ? ` <span class="director-unread">${t.unread}</span>` : ""}</button>`)].join("");

  const prompt = logic.tokenPrompt();
  const offer = prompt ? `<div class="director-token-offer">${avatar(prompt.img, prompt.name, prompt.color)}
      ${phoneBtn("token-apply", esc(prompt.label), { cls: "primary" })}
      ${phoneBtn("token-dismiss", "", { icon: "fa-xmark", title: "Not now" })}</div>` : "";

  return `<div class="director-pickers">
      <label><span>Whose phone</span><select data-director="pick:inbox" aria-label="Whose phone">${whose}</select></label>
      <label><span>Acting as</span><select data-director="pick:persona" aria-label="Who you're acting as">${as}</select></label>
      ${phoneBtn("new-thread", "New text", { icon: "fa-pen", disabled: !logic.online || (logic.inbox === "all" && !logic.persona), title: "Text a character as someone (pick a phone or who you act as first)" })}
      ${phoneBtn("new-group", "New group", { icon: "fa-users", disabled: !logic.online })}
    </div>
    <div class="director-sims" aria-label="SIM tiles: who you act as">${tiles}</div>${offer}`;
}

/* ---------------- The list ---------------- */

function rowsHtml(director) {
  const logic = director.logic;
  const ctx = logic.ctx();
  logic.search = director.drafts["comms-search"] ?? "";
  const v = logic.view;
  const isOpen = row => !!v && (row.kind === "group" ? v.groupId === row.groupId
    : row.kind === "service" ? v.kind === "service" && v.serviceId === row.serviceId && v.actorId === row.actorId
      : v.kind === "direct" && v.actorId === row.actorId && v.contact?.toLowerCase() === row.contact?.toLowerCase() && !!v.hidden === !!row.hidden);
  const rows = logic.inboxRows(ctx).map(row => {
    const data = { kind: row.kind, threadId: row.threadId, actorId: row.actorId, contact: row.contact, hidden: row.hidden ? "true" : null, groupId: row.groupId, serviceId: row.serviceId };
    const attrs = Object.entries(data).filter(([, x]) => x).map(([k, x]) => ` data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${esc(String(x))}"`).join("");
    const icon = row.isGroup ? `<i class="fas fa-users" aria-hidden="true"></i> ` : row.isService ? `<i class="fas fa-robot" aria-hidden="true"></i> ` : "";
    return `<li class="${isOpen(row) ? "active" : ""} ${row.unread ? "unread" : ""}" style="${row.color ? `--persona: ${esc(row.color)}` : ""}">
      <button type="button" class="director-row" data-director="phone:open-thread"${attrs}>
        ${avatar(row.img, row.name, row.color)}
        <span class="director-row-main">
          <span class="director-row-head"><strong>${icon}${esc(row.name)}</strong>
            ${row.owner ? `<span class="director-owner">${esc(row.owner)}</span>` : ""}
            ${row.hiddenBadge ? `<em class="director-tag">hidden ID</em>` : ""}${row.blocked ? `<em class="director-tag warn">blocked</em>` : ""}
            <span class="director-time">${esc(row.time ?? "")}</span></span>
          <span class="director-preview">${esc(row.preview ?? "")}</span>
        </span>
        ${row.unread ? `<span class="director-unread" aria-label="${row.unread} unread">${row.unread}</span>` : ""}
      </button>
      <button type="button" class="director-pin ${row.pinned ? "on" : ""}" data-director="phone:pin" data-pin-key="${esc(row.pinKey)}" title="${row.pinned ? "Unpin" : "Pin to the top"}" aria-pressed="${row.pinned}"><i class="fas fa-thumbtack" aria-hidden="true"></i></button>
    </li>`;
  });
  return rows.join("") || `<li class="director-empty">${logic.search ? "No matches." : "No conversations here yet."}</li>`;
}

/* ---------------- The open conversation ---------------- */

function messageHtml(m, { reactable }) {
  if (m.system) return `${m.dateLabel ? `<div class="director-date">${esc(m.dateLabel)}</div>` : ""}<div class="director-msg system">${esc(m.text ?? "")}</div>`;
  const money = m.money ? `<div class="director-card-inline money ${esc(m.money.status)}"><i class="fas fa-money-bill-transfer" aria-hidden="true"></i> ${esc(m.money.label)}
      ${m.money.statusLabel ? `<span class="director-tag">${esc(m.money.statusLabel)}</span>` : ""}
      ${m.money.canPay ? phoneBtn("money-pay", "Pay", { data: { messageId: m.id } }) + phoneBtn("money-decline", "Decline", { data: { messageId: m.id } }) : ""}
      ${m.money.canTransfer ? phoneBtn("money-transfer", "Transfer", { data: { messageId: m.id } }) : ""}
      ${m.money.canCancel ? phoneBtn("money-cancel", "Cancel", { data: { messageId: m.id } }) : ""}</div>` : "";
  const job = m.job ? `<div class="director-card-inline job"><i class="fas fa-briefcase" aria-hidden="true"></i> ${esc(m.job.name)} <span class="director-tag">${esc(m.job.statusLabel ?? "")}</span></div>` : "";
  const photo = m.image ? `<img class="director-photo" src="${esc(m.image)}" alt="Photo" data-director="phone:open-photo" data-src="${esc(m.image)}">` : "";
  const loc = m.location ? `<button type="button" class="director-link" data-director="phone:open-location" data-scene-id="${esc(m.location.sceneId ?? "")}" data-note-id="${esc(m.location.noteId ?? "")}" data-x="${m.location.x ?? ""}" data-y="${m.location.y ?? ""}"><i class="fas fa-location-dot" aria-hidden="true"></i> ${esc(m.location.label ?? m.location.sceneName ?? "Location")}</button>` : "";
  const chips = (m.reactions ?? []).map(r => `<button type="button" class="director-chip ${r.mine ? "mine" : ""}" data-director="phone:react" data-message-id="${m.id}" data-emoji="${esc(r.emoji)}">${esc(r.emoji)}${r.label ? ` ${r.label}` : ""}</button>`).join("");
  const react = reactable ? `<details class="director-react"><summary title="React" aria-label="React"><i class="far fa-face-smile"></i></summary>
      ${appearance().emoji.map(e => `<button type="button" data-director="phone:react" data-message-id="${m.id}" data-emoji="${esc(e)}">${esc(e)}</button>`).join("")}</details>` : "";
  return `${m.dateLabel ? `<div class="director-date">${esc(m.dateLabel)}</div>` : ""}
    <div class="director-msg ${m.mine ? "mine" : ""} ${m.persona ? "persona" : ""}" style="${m.color ? `--persona: ${esc(m.color)}` : ""}">
      ${m.sender ? `<span class="director-who">${esc(m.sender)}</span>` : ""}
      ${money || (m.text ? `<span class="director-text">${esc(m.text)}</span>` : "")}${job}${photo}${loc}
      <span class="director-meta">${esc(m.time ?? "")}${m.viewed ? " · Viewed" : ""}</span>
      ${chips || react ? `<span class="director-reactions">${chips}${react}</span>` : ""}
    </div>
    ${m.setViewed ? `<div class="director-set-viewed">${phoneBtn("set-viewed", "Set as Viewed", { icon: "fa-eye", title: "Show the player their text was read" })}</div>` : ""}`;
}

/** The banner of who the GM speaks as (and to whom). */
function actingAsHtml(director, a, kind) {
  if (!a) return "";
  if (kind === "group") {
    const group = store.threads.get(director.logic.view.groupId);
    const as = director.logic.groupSpeaker(director.logic.ctx(), group);
    const npcs = group.members.filter(m => !m.actorId);
    const options = npcs.map(m => `<option value="${esc(m.key)}" ${m.key === as ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    return `<div class="director-acting" style="--persona: ${esc(personaColor(npcs.find(m => m.key === as)?.name ?? ""))}">
      <span>${esc(a.verb)}</span><select data-director="pick:speakAs" aria-label="Who you speak as">${options}<option value="+add">Add an NPC…</option></select>
      ${a.note ? `<em>${esc(a.note)}</em>` : ""}</div>`;
  }
  return `<div class="director-acting" style="--persona: ${esc(a.color ?? "")}"><span>${esc(a.verb)}</span> <strong>${esc(a.name)}</strong>${a.target ? ` <i class="fas fa-arrow-right" aria-hidden="true"></i> ${esc(a.target)}` : ""}${a.note ? ` <em>${esc(a.note)}</em>` : ""}</div>`;
}

function conversationHtml(director) {
  const logic = director.logic;
  const ctx = logic.ctx();
  const v = logic.view;
  if (!v) return `<div class="director-empty director-pick">Pick a conversation, or start a New text.</div>`;

  if (v.kind === "group-info") {
    const d = logic.groupInfoData(ctx);
    if (!d) return "";
    return `<header class="director-convo-head">${phoneBtn("back", "", { icon: "fa-arrow-left", title: "Back" })}<h2>${esc(d.name)}</h2></header>
      <div class="director-group-info">
        <form data-director="comms-group-rename"><input name="name" value="${esc(d.name)}" aria-label="Group name"><button type="submit">Rename</button></form>
        <ol class="director-members">${d.members.map(m => `<li>${avatar(m.img, m.name)} <strong>${esc(m.name)}</strong> <em class="director-tag">${m.tag}</em>
          ${d.canEdit ? phoneBtn("group-remove", "", { data: { key: m.key }, icon: "fa-user-minus", title: `Remove ${m.name}` }) : ""}</li>`).join("")}</ol>
        <div class="director-toolbar">${d.canEdit ? phoneBtn("group-add", "Add someone", { icon: "fa-user-plus" }) : ""}${d.canDelete ? phoneBtn("group-delete", "Delete group", { icon: "fa-trash", cls: "danger" }) : ""}</div>
      </div>`;
  }

  const kind = v.kind === "group" ? "group" : v.kind === "service" ? "service" : "direct";
  const d = kind === "group" ? logic.groupData(ctx) : kind === "service" ? logic.serviceData(ctx) : logic.directData(ctx);
  if (!d) return `<div class="director-empty">That conversation is gone.</div>`;

  const tools = [];
  if (d.canCall) tools.push(phoneBtn(kind === "service" ? "service-call" : "call", "Call", { icon: "fa-phone" }));
  if (kind === "direct") {
    const actor = game.actors.get(v.actorId);
    const thread = logic.resolveDirect();
    const entry = d.hidden ? null : findContact(getContacts(actor), thread?.contact ?? v.contact);
    if (d.hidden && d.exists) tools.push(phoneBtn("reveal", "Reveal caller ID", { icon: "fa-user-secret" }));
    if (entry) {
      tools.push(phoneBtn("toggle-block", d.blocked ? "Unblock" : "Block", { icon: "fa-ban", cls: d.blocked ? "on" : "" }));
      tools.push(phoneBtn("toggle-calls", entry.noCall ? "Allow calls" : "Texts only", { icon: "fa-phone-slash", cls: entry.noCall ? "on" : "", title: "Players may text this contact but not call it" }));
      tools.push(phoneBtn("set-contact-img", "Picture", { icon: "fa-image" }));
    }
    if (d.exists) tools.push(phoneBtn("delete-thread", "Delete", { icon: "fa-trash", cls: "danger" }));
  }
  if (kind === "group") tools.push(phoneBtn("group-info", "Members", { icon: "fa-users-gear" }));

  const reactable = !!d.canReact;
  const messages = (d.messages ?? []).map(m => messageHtml(m, { reactable })).join("")
    || `<div class="director-empty">No messages yet${d.hidden ? " (caller ID hidden)" : ""}. Send the first.</div>`;
  return `<header class="director-convo-head">
      ${avatar(d.img, d.name)}
      <div class="director-convo-title"><h2>${esc(d.name)}</h2>
        <span class="director-sub">${esc(d.subtitle ?? d.renamed ?? "")}${d.hidden ? ` <em class="director-tag">caller ID hidden</em>` : ""}${d.blocked ? ` <em class="director-tag warn">blocked</em>` : ""}</span></div>
      <div class="director-toolbar">${tools.join("")}</div>
    </header>
    ${actingAsHtml(director, d.actingAs, kind)}
    <div class="director-messages" aria-live="polite">${messages}</div>
    <div class="director-reply-slot">${composeHtml(director, d)}</div>`;
}

function composeHtml(director, d) {
  const logic = director.logic;
  if (d.canSend === false && !d.canReply) return `<p class="director-empty">${esc(d.placeholder ?? "Can't send here.")}</p>`;
  const key = logic.draftKey;
  const chips = [];
  if (logic.images[key]) chips.push(`<span class="director-chip"><i class="fas fa-image"></i> Photo ${phoneBtn("clear-photo", "", { icon: "fa-xmark", title: "Remove" })}</span>`);
  if (logic.locations[key]) chips.push(`<span class="director-chip"><i class="fas fa-location-dot"></i> ${esc(logic.locations[key].label ?? "Location")} ${phoneBtn("clear-location", "", { icon: "fa-xmark", title: "Remove" })}</span>`);
  if (logic.jobs[key]) chips.push(`<span class="director-chip"><i class="fas fa-briefcase"></i> ${esc(store.quests.get(logic.jobs[key])?.name ?? "Job")} ${phoneBtn("clear-job", "", { icon: "fa-xmark", title: "Remove" })}</span>`);
  const direct = logic.view?.kind === "direct";
  const attach = [
    phoneBtn("attach-photo", "", { icon: "fa-image", title: "Attach a photo" }),
    phoneBtn("attach-location", "", { icon: "fa-location-dot", title: "Share a map pin" }),
    phoneBtn("attach-job", "", { icon: "fa-briefcase", title: "Offer a job" }),
    direct ? phoneBtn("money", "", { icon: "fa-money-bill-transfer", title: "Send or request money" }) : ""
  ].join("");
  return `${chips.length ? `<div class="director-attached">${chips.join("")}</div>` : ""}
    <form class="director-reply" data-director="comms-send" data-key="${esc(key)}">
      <div class="director-attach">${attach}</div>
      <textarea name="reply" data-draft="reply:${esc(key)}" aria-label="Message" placeholder="${esc(d.placeholder ?? "Text message")}">${esc(director.drafts[`reply:${key}`] ?? "")}</textarea>
      <button type="submit" class="primary"><i class="fas fa-paper-plane" aria-hidden="true"></i> Send</button>
    </form>`;
}

export function html(director) {
  return `<div class="director-comms">
    <div class="director-side">
      <div class="director-bar">${barHtml(director)}</div>
      <div class="director-tools"><input type="search" data-draft="comms-search" data-live aria-label="Search conversations" placeholder="Search names and messages" value="${esc(director.drafts["comms-search"] ?? "")}"></div>
      <ol class="director-threads" aria-label="Conversations">${rowsHtml(director)}</ol>
    </div>
    <div class="director-convo" data-view="${esc(viewKey(director.logic.view))}">${conversationHtml(director)}</div>
  </div>`;
}

/** Which conversation (and page) is open: the reply box is kept while this stays the same. */
const viewKey = v => (v ? `${v.kind}:${v.threadId ?? v.groupId ?? ""}:${v.actorId ?? ""}:${v.contact ?? ""}:${v.serviceId ?? ""}:${!!v.hidden}` : "");

/** Mark the open conversation read (on the GM's side), as the GM Phone does when it shows it. */
function markOpenRead(logic) {
  const v = logic.view;
  if (!v) return;
  const thread = v.kind === "direct" ? logic.resolveDirect() : v.kind === "group" ? store.threads.get(v.groupId) : v.kind === "service" ? store.findServiceThread(v.actorId, v.serviceId) : null;
  if (thread && store.unread(thread)) store.markRead(thread);
}

/**
 * Redraw the bar, list and messages. The reply box is redrawn only when the conversation changed or
 * its attachments did, so a text being typed survives.
 */
export function refresh(director, root) {
  const logic = director.logic;
  markOpenRead(logic);
  const bar = root.querySelector(".director-bar");
  if (bar) bar.innerHTML = barHtml(director);
  const list = root.querySelector(".director-threads");
  if (list) list.innerHTML = rowsHtml(director);
  const convo = root.querySelector(".director-convo");
  if (!convo) return;
  const key = viewKey(logic.view);
  const messages = convo.querySelector(".director-messages");
  const slot = convo.querySelector(".director-reply-slot");
  if (convo.dataset.view !== key || !messages || !slot) {
    convo.dataset.view = key;
    convo.innerHTML = conversationHtml(director);
    const fresh = convo.querySelector(".director-messages");
    if (fresh) fresh.scrollTop = fresh.scrollHeight;
    return;
  }
  // Same conversation: swap everything but the reply box (attachments: just their chips).
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
  const tmp = root.ownerDocument.createElement("div");
  tmp.innerHTML = conversationHtml(director);
  for (const part of [".director-convo-head", ".director-acting", ".director-messages"]) {
    const now = convo.querySelector(part);
    const next = tmp.querySelector(part);
    if (now && next) now.replaceWith(next);
    else if (next && part === ".director-acting") convo.querySelector(".director-convo-head")?.after(next);
    else if (now && !next) now.remove();
  }
  const attached = tmp.querySelector(".director-attached");
  const current = slot.querySelector(".director-attached");
  if (current) current.remove();
  if (attached) slot.prepend(attached);
  const fresh = convo.querySelector(".director-messages");
  if (fresh && atBottom) fresh.scrollTop = fresh.scrollHeight;
}

export const actions = {
  "comms-send"({ key }, event) {
    const textarea = event.target.elements.reply;
    const text = textarea.value.trim();
    if (!this.logic._sendMessage(text)) return;
    textarea.value = "";
    delete this.drafts[`reply:${key}`];
  },
  "comms-group-rename"(data, event) {
    const name = event.target.elements.name.value.trim();
    const groupId = this.logic.view?.groupId;
    if (name && groupId) store.request("group-rename", { groupId, actorId: null, name });
  }
};

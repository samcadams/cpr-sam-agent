import { getContacts } from "../../scripts/model/contacts.js";
import { formatMoney } from "../../scripts/model/money.js";
import { store } from "../../scripts/store.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { esc } from "../screamsheet/render.js";
import { recordSummary } from "./model.js";
import { recordMessage, renderRecordSheet } from "./sheet.js";

/*
 * A delivered record in its own window, page sized and resizable, like DataPool's reader
 * (apps/screamsheet/reader.js, whose window and page styles it shares). Buttons, as there: share it to chat,
 * and send it to a contact (a text typed in their conversation, on the phone it was opened from).
 */

export function openRecord(lookupId, { actorId = null, phone = null } = {}) {
  const open = Object.values(ui.windows).find(w => w instanceof RecordReader && w.lookupId === lookupId);
  if (open) return open.bringToTop();
  new RecordReader(lookupId, actorId, phone).render(true);
}

class RecordReader extends Application {
  constructor(lookupId, actorId, phone) {
    super({ id: `agent-ncpd-record-${lookupId}` });
    this.lookupId = lookupId;
    this.actorId = actorId;
    this.phone = phone;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "NCPD Crime Database",
      classes: ["agent-scream-window"],
      width: 760,
      height: Math.min(900, Math.round(window.innerHeight * 0.9)),
      resizable: true
    });
  }

  get lookup() {
    return store.apps.ncpdLookups?.[this.lookupId] ?? null;
  }

  get title() {
    return this.lookup ? `NCPD: ${this.lookup.num}` : "NCPD Crime Database";
  }

  async _renderInner() {
    const lookup = this.lookup;
    if (lookup?.result?.kind !== "record") return $(`<div class="scream-reader"><p class="scream-gone">This record is gone.</p></div>`);
    return $(`<div class="scream-reader">
      <div class="scream-reader-bar">
        <span class="scream-reader-spacer"></span>
        <button type="button" data-ncpd="chat"><i class="fas fa-comment"></i> Share to chat</button>
        ${this.actorId && this.phone ? `<button type="button" data-ncpd="send"><i class="fas fa-paper-plane"></i> Send to…</button>` : ""}
      </div>
      <div class="scream-reader-page">${renderRecordSheet(lookup, formatMoney)}</div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelector("[data-ncpd=chat]")?.addEventListener("click", () => this.share());
    root.querySelector("[data-ncpd=send]")?.addEventListener("click", () => this.sendTo());
  }

  /** A short card in chat: the request, who it's on, the summary. */
  async share() {
    const lookup = this.lookup;
    if (lookup?.result?.kind !== "record") return;
    const r = lookup.result.record;
    const actor = game.actors.get(this.actorId);
    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
      content: `<div class="agent-scream-chat agent-ncpd-chat"><span class="agent-scream-chat-outlet">NCPD public record · ${esc(lookup.num)}</span>`
        + `<b>${esc(r.name || "Unnamed")}</b><p>${esc(recordSummary(r, formatMoney))}</p><small>From the NCPD Crime Database</small></div>`
    });
  }

  /** Pick a contact; their conversation opens on the phone with the record typed in, for the player to send. */
  async sendTo() {
    const lookup = this.lookup;
    const contacts = getContacts(game.actors.get(this.actorId)).filter(c => !c.blocked);
    if (lookup?.result?.kind !== "record") return;
    if (!contacts.length) return ui.notifications.warn("You have no contacts to send it to.");
    const asked = await fieldsDialog({
      title: "Send to…",
      fields: [{ name: "contact", label: "Contact", type: "select", search: contacts.length > 8, value: contacts[0].name, options: contacts.map(c => ({ value: c.name, label: c.name })) }],
      label: "Write the text",
      note: "Opens your conversation with them, the record already typed in. You send it."
    });
    if (!asked?.contact) return;
    this.phone.composeTo(this.actorId, asked.contact, recordMessage(lookup, formatMoney));
  }
}

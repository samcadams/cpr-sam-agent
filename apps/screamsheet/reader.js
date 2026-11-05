import { getContacts } from "../../scripts/model/contacts.js";
import { store } from "../../scripts/store.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { notesEntry, textToHtml } from "../notes/model.js";
import { openEditor } from "./editor.js";
import { activate, esc, renderSheet, sheetText, summary } from "./render.js";

/*
 * DataPool's reader: a clipping in its own window, page sized and resizable (the phone's 380px gets the
 * one-column layout, which works but loses the newspaper; handoff prototype NOTES §5). Buttons: share it
 * to chat, send it to a contact (a text typed in their conversation, on the phone it was opened from),
 * clip it to the character's Agent Notes, and for the GM, edit it.
 */

export function openReader(clipId, { actorId = null, phone = null } = {}) {
  const open = Object.values(ui.windows).find(w => w instanceof ClippingReader && w.clipId === clipId);
  if (open) return open.bringToTop();
  new ClippingReader(clipId, actorId, phone).render(true);
}

class ClippingReader extends Application {
  constructor(clipId, actorId, phone) {
    super({ id: `agent-scream-reader-${clipId}` });
    this.clipId = clipId;
    this.actorId = actorId;
    this.phone = phone;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "DataPool",
      classes: ["agent-scream-window"],
      width: 880,
      height: Math.min(980, Math.round(window.innerHeight * 0.9)),
      resizable: true
    });
  }

  get clip() {
    return store.apps.screamClips?.[this.clipId] ?? null;
  }

  get title() {
    const clip = this.clip;
    return clip ? `DataPool: ${summary(clip.sheet).outlet}` : "DataPool";
  }

  async _renderInner() {
    const clip = this.clip;
    if (!clip) return $(`<div class="scream-reader"><p class="scream-gone">This clipping is gone from the Pool.</p></div>`);
    const gm = game.user.isGM;
    return $(`<div class="scream-reader">
      <div class="scream-reader-bar">
        <span class="scream-reader-when">${esc(clip.date ?? "Not published")}${clip.time ? ` · ${esc(clip.time)}` : ""}</span>
        <span class="scream-reader-spacer"></span>
        <button type="button" data-scream="chat"><i class="fas fa-comment"></i> Share to chat</button>
        ${this.actorId && this.phone ? `<button type="button" data-scream="send"><i class="fas fa-paper-plane"></i> Send to…</button>` : ""}
        ${this.actorId ? `<button type="button" data-scream="notes"><i class="fas fa-note-sticky"></i> Clip to Notes</button>` : ""}
        ${gm ? `<button type="button" data-scream="edit"><i class="fas fa-pen"></i> Edit</button>` : ""}
      </div>
      <div class="scream-reader-page">${renderSheet(clip.sheet, { clock: clip.time ?? "" })}</div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    const page = root.querySelector(".scream-reader-page");
    if (page) requestAnimationFrame(() => activate(page));
    root.querySelector("[data-scream=chat]")?.addEventListener("click", () => this.share());
    root.querySelector("[data-scream=send]")?.addEventListener("click", () => this.sendTo());
    root.querySelector("[data-scream=notes]")?.addEventListener("click", () => this.clipToNotes());
    root.querySelector("[data-scream=edit]")?.addEventListener("click", () => openEditor(this.clipId));
  }

  setPosition(pos) {
    const out = super.setPosition(pos);
    const page = this.element?.[0]?.querySelector(".scream-reader-page");
    if (page) activate(page);
    return out;
  }

  /** A short card in chat: the outlet, the headline, the first lines. */
  async share() {
    const clip = this.clip;
    if (!clip) return;
    const s = summary(clip.sheet);
    const actor = game.actors.get(this.actorId);
    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
      content: `<div class="agent-scream-chat"><span class="agent-scream-chat-outlet">${esc(s.outlet)}${clip.date ? ` · ${esc(clip.date)}` : ""}</span>`
        + `<b>${esc(s.headline)}</b>${s.snippet ? `<p>${esc(s.snippet)}</p>` : ""}<small>Pulled from the Data Pool</small></div>`
    });
  }

  /** Pick a contact; their conversation opens on the phone with the clipping typed in, for the player to send. */
  async sendTo() {
    const clip = this.clip;
    const contacts = getContacts(game.actors.get(this.actorId)).filter(c => !c.blocked);
    if (!clip) return;
    if (!contacts.length) return ui.notifications.warn("You have no contacts to send it to.");
    const asked = await fieldsDialog({
      title: "Send to…",
      fields: [{ name: "contact", label: "Contact", type: "select", search: contacts.length > 8, value: contacts[0].name, options: contacts.map(c => ({ value: c.name, label: c.name })) }],
      label: "Write the text",
      note: "Opens your conversation with them, the clipping already typed in. You send it."
    });
    if (!asked?.contact) return;
    const s = summary(clip.sheet);
    const text = `Saw this on the Pool: "${s.headline}" (${s.outlet}${clip.date ? `, ${clip.date}` : ""})${s.snippet ? `\n${s.snippet}` : ""}`;
    this.phone.composeTo(this.actorId, asked.contact, text);
  }

  /** The clipping's text as a page in the character's Agent Notes. */
  async clipToNotes() {
    const clip = this.clip;
    if (!clip) return;
    let entry = notesEntry(this.actorId);
    // No notes yet: the host makes the entry (players can't), and the clipping goes in once it's here.
    if (!entry?.isOwner) {
      store.request("notes-make", { actorId: this.actorId }, { quiet: true });
      for (let i = 0; i < 25 && !entry?.isOwner; i++) {
        await new Promise(r => setTimeout(r, 200));
        entry = notesEntry(this.actorId);
      }
      if (!entry?.isOwner) return ui.notifications.warn("Your Agent couldn't open your notes. Is a GM online?");
    }
    const s = summary(clip.sheet);
    const text = `${s.outlet}${clip.date ? `, ${clip.date}` : ""}\n\n${sheetText({ ...clip.sheet, masthead: { ...clip.sheet.masthead, brand: {}, ticker: "" } })}`;
    await entry.createEmbeddedDocuments("JournalEntryPage", [{ name: s.headline.slice(0, 100), type: "text", text: { content: textToHtml(text) }, sort: Date.now() }]);
    ui.notifications.info(`Clipped to ${entry.name}.`);
  }
}

import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { crewNotes, hasFormatting, hqApi, htmlToText, notesEntry, textToHtml } from "./model.js";

/** How long a requested crew note is waited for, to open it when it arrives (ms). */
const CREW_NEW_MS = 10_000;
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { ago } from "../../scripts/util/text.js";

/*
 * Phone page: Notes (see apps/notes/model.js). The character's notes (pages of their Agent Notes journal)
 * and, with CPR HQ, their HQ's shared Crew Notes. Players write them here; the GM Phone reads any
 * character's. Notes are typed as plain text; a page formatted in the journal says so before editing
 * here flattens it.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

/** The page an open note refers to. */
const pageOf = open => game.journal.get(open?.entryId)?.pages.get(open?.pageId) ?? null;

export const actions = {
  "note-open"({ entryId, pageId }) {
    this.noteOpen = { entryId, pageId };
    this.noteEditing = false;
    this.render();
  },
  "note-back"() {
    this.noteOpen = null;
    this.noteEditing = false;
    this.render();
  },
  async "note-new"() {
    const actor = this.notesSubject();
    const entry = actor && notesEntry(actor.id);
    if (!entry?.isOwner) return;
    const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{ name: "New note", type: "text", text: { content: "" }, sort: Date.now() }]);
    if (!page) return;
    this.noteOpen = { entryId: entry.id, pageId: page.id };
    this.noteEditing = true;
    this.render();
  },
  "note-edit"() {
    this.noteEditing = true;
    this.render();
  },
  "note-cancel"() {
    this.noteEditing = false;
    this.render();
  },
  async "note-save"() {
    const page = pageOf(this.noteOpen);
    if (!page?.isOwner) return;
    const root = this.element[0];
    const name = root.querySelector("input[name=noteTitle]")?.value.trim().slice(0, 100);
    const text = root.querySelector("textarea[name=noteText]")?.value ?? "";
    await page.update({ name: name || page.name, "text.content": textToHtml(text) });
    this.noteEditing = false;
    this.render();
  },
  "note-delete"() {
    const page = pageOf(this.noteOpen);
    if (!page?.isOwner) return;
    Dialog.confirm({
      title: "Delete note",
      content: `<p>Delete "${foundry.utils.escapeHTML?.(page.name) ?? page.name}"?</p>`,
      yes: async () => {
        await page.delete();
        this.noteOpen = null;
        this.render();
      }
    });
  },
  /** Open the note in its journal: the full editor, or for crew notes the HQ's Journal tab. */
  "note-journal"() {
    const page = pageOf(this.noteOpen);
    if (!page) return;
    if (page.getFlag("cpr-hq", "crewNotes") && hqApi()?.openCrewJournal) return hqApi().openCrewJournal(page.parent, page);
    page.parent.sheet.render(true, { pageId: page.id });
  },
  /** A new crew note: the GM's host makes the page (crew don't own the HQ), and it opens when it arrives. */
  async "note-crew-new"({ hqId }) {
    const actor = this.notesSubject();
    if (!actor) return;
    if (game.user.isGM) {
      const page = await hqApi()?.createCrewNote(game.journal.get(hqId), { name: "New note" });
      if (!page) return;
      Object.assign(this, { noteOpen: { entryId: hqId, pageId: page.id }, noteEditing: true });
      return this.render();
    }
    if (store.request("notes-crew", { actorId: actor.id, hqId })) this._crewNew = { hqId, since: Date.now() - 2000 };
  }
};

export const dropdowns = {
  notesActor(value) {
    this.notesActor = value;
    this.noteOpen = null;
    this.render();
  }
};

export const methods = {
  /** Whose notes: the character in hand, or on the GM Phone the one picked. */
  notesSubject(ctx = this.context()) {
    if (ctx?.perspective === "gm") return game.actors.get(this.notesActor) ?? null;
    return ctx?.subject?.actor ?? null;
  },

  notesData(ctx) {
    const gm = ctx.perspective === "gm";
    const pcs = gm ? playerCharacters() : [];
    if (gm && !pcs.some(a => a.id === this.notesActor)) this.notesActor = pcs[0]?.id ?? null;
    const actor = this.notesSubject(ctx);
    const entry = actor ? notesEntry(actor.id) : null;
    // A player's first look: the host makes their notes entry, or makes them an owner of it.
    if (!gm && actor && !entry?.isOwner && this._notesAsked !== actor.id) {
      this._notesAsked = actor.id;
      store.request("notes-make", { actorId: actor.id }, { quiet: true });
    }
    const base = {
      gm,
      bar: appBar("notes", { owner: gm ? null : ctx.subject.name }),
      picker: gm ? dropdown("notesActor", pcs.map(a => ({ value: a.id, label: displayName(a), selected: a.id === this.notesActor })), { title: "Whose notes", cls: "agent-wide" }) : null
    };

    // A crew note asked for just now: open it for writing once it's here.
    if (this._crewNew) {
      const { hqId, since } = this._crewNew;
      const fresh = game.journal.get(hqId)?.pages.find(p => p.getFlag("cpr-hq", "crewNotes") && (p._stats?.createdTime ?? 0) >= since && p.isOwner);
      if (fresh || Date.now() - since > CREW_NEW_MS) this._crewNew = null;
      if (fresh) Object.assign(this, { noteOpen: { entryId: hqId, pageId: fresh.id }, noteEditing: true });
    }
    const open = pageOf(this.noteOpen);
    if (open) {
      const crew = !!open.getFlag("cpr-hq", "crewNotes");
      const html = open.text?.content ?? "";
      return {
        ...base,
        note: {
          title: crew ? `${open.parent.name}: ${open.name}` : open.name,
          name: open.name,
          html,
          text: htmlToText(html),
          empty: !htmlToText(html).trim(),
          crew,
          canEdit: open.isOwner,
          canDelete: open.isOwner,
          editing: this.noteEditing && open.isOwner,
          formatted: hasFormatting(html),
          edited: open._stats?.modifiedTime ? ago(open._stats.modifiedTime) : ""
        }
      };
    }
    this.noteOpen = null;

    const pages = entry ? [...entry.pages].filter(p => p.type === "text") : [];
    pages.sort((a, b) => (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0));
    const snippet = p => htmlToText(p.text?.content).replace(/\s+/g, " ").trim().slice(0, 70);
    return {
      ...base,
      actorName: actor ? displayName(actor) : null,
      ready: !!entry,
      canWrite: !!entry?.isOwner,
      notes: pages.map(p => ({ entryId: entry.id, pageId: p.id, name: p.name, snippet: snippet(p), edited: p._stats?.modifiedTime ? ago(p._stats.modifiedTime) : "" })),
      hq: !!hqApi(),
      crew: crewNotes(actor).map(({ entry: hq, pages: crewPages }) => ({
        hqId: hq.id,
        hqName: hq.name,
        notes: crewPages.filter(p => p.testUserPermission(game.user, "OBSERVER")).map(p => ({
          entryId: hq.id, pageId: p.id, name: p.name, snippet: snippet(p), edited: p._stats?.modifiedTime ? ago(p._stats.modifiedTime) : ""
        }))
      }))
    };
  }
};

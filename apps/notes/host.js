import { hqApi, NOTES_FOLDER, notesEntry, notesEntryData } from "./model.js";

/*
 * Host: Notes (see apps/notes/model.js). Players write their own pages; the host makes what they can't:
 * the "Agent Notes" folder and a character's notes entry, and (through CPR HQ) a new Crew Notes page.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "notes-make": "_onNotesMake",
  "notes-crew": "_onNotesCrew"
};

/** The character, if this user plays it. */
const owned = (user, actorId) => {
  const actor = game.actors.get(actorId);
  return actor && (user.isGM || actor.testUserPermission(user, "OWNER")) ? actor : null;
};

export const methods = {
  async _onNotesMake(user, { actorId }) {
    const actor = owned(user, actorId);
    if (!actor) return;
    const entry = notesEntry(actor.id);
    if (entry) {
      // Given the character after the entry was made: the character's players own its notes.
      if (!user.isGM && !entry.testUserPermission(user, "OWNER")) await entry.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
      return;
    }
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === NOTES_FOLDER && !f.folder);
    folder ??= await Folder.create({ name: NOTES_FOLDER, type: "JournalEntry" });
    await JournalEntry.create(notesEntryData(actor, folder.id));
  },

  /** A new Crew Notes page in an HQ, for a crew member (CPR HQ gives it to the crew and keeps it in step). */
  async _onNotesCrew(user, { actorId, hqId }) {
    const actor = owned(user, actorId);
    const api = hqApi();
    if (!actor || !api) return;
    const entry = api.crewHQsOf(actor).find(e => e.id === hqId);
    if (entry) await api.createCrewNote(entry, { name: "New note" });
  }
};

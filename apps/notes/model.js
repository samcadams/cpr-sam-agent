import { MODULE_ID } from "../../scripts/config.js";

/*
 * Notes: each character's notes are the pages of a "<name> Agent Notes" journal entry in the
 * "Agent Notes" folder (flags.cpr-sam-agent.notesFor = the actor's id, so renaming either is fine).
 * The character's players own it, so they write its pages themselves; the GM's host only makes the
 * entry (players can't create journal entries). With CPR HQ, every HQ whose crew includes the
 * character adds its shared Crew Notes pages (see cpr-hq's crew-notes.mjs).
 */

export const NOTES_FOLDER = "Agent Notes";
const FLAG = "notesFor";

/** The character's notes entry, if made yet. `entries`: JournalEntry documents (defaults to game.journal). */
export function notesEntry(actorId, entries = game.journal ?? []) {
  return [...entries].find(e => e.getFlag?.(MODULE_ID, FLAG) === actorId) ?? null;
}

export const notesName = actor => `${actor.name} Agent Notes`;

/** What the new entry is made from: owned by the character's players, hidden from everyone else. */
export function notesEntryData(actor, folderId, users = game.users) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const user of users) {
    if (!user.isGM && actor.testUserPermission(user, "OWNER")) ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }
  return { name: notesName(actor), folder: folderId, ownership, flags: { [MODULE_ID]: { [FLAG]: actor.id } } };
}

/** CPR HQ's API, if it's on and new enough to have Crew Notes. */
export function hqApi() {
  const mod = game.modules?.get("cpr-hq");
  return mod?.active && mod.api?.crewNotesPages ? mod.api : null;
}

/** The character's HQs (crew with access), each with its Crew Notes pages: [{ entry, pages }]. */
export function crewNotes(actor) {
  const api = hqApi();
  if (!api || !actor) return [];
  return api.crewHQsOf(actor).map(entry => ({ entry, pages: api.crewNotesPages(entry) }));
}

const escape = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Typed text as a page's HTML: a paragraph per line, blank lines kept. */
export function textToHtml(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  return lines.map(l => (l.trim() ? `<p>${escape(l)}</p>` : "<p></p>")).join("");
}

/** A page's HTML as text to edit (one line per paragraph or line break). */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n$/, "");
}

/** Does the HTML have formatting beyond plain paragraphs (which editing on the phone would drop)? */
export const hasFormatting = html => /<(?!\/?(p|br)\b)[a-z]/i.test(String(html ?? ""));

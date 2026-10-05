import { isPlayerCharacter } from "./agent.js";
import { DEFAULT_CONTACT_IMG, MODULE_ID } from "../config.js";

/* -------------------------------------------- */
/*  Storage: contacts live in an actor flag      */
/* -------------------------------------------- */

/** @returns {{name: string, img: string, actorId?: string}[]} */
export function getContacts(actor) {
  return foundry.utils.deepClone(actor?.getFlag(MODULE_ID, "contacts") ?? []);
}

export function setContacts(actor, contacts) {
  return actor.setFlag(MODULE_ID, "contacts", contacts);
}

/* -------------------------------------------- */
/*  Player notes: stored on the PC, readable by the GM
/* -------------------------------------------- */

/** Notes are keyed by lowercased contact name, or "t:<threadId>" for unknown numbers. */
export const noteKey = (contact, threadId) => (threadId ? `t:${threadId}` : contact.toLowerCase());

/** @returns {{key: string, text: string}[]} */
export function getNotes(actor) {
  return foundry.utils.deepClone(actor?.getFlag(MODULE_ID, "notes") ?? []);
}

export function getNote(actor, key) {
  return getNotes(actor).find(n => n.key === key)?.text ?? "";
}

export function setNote(actor, key, text) {
  const notes = getNotes(actor).filter(n => n.key !== key);
  if (text.trim()) notes.push({ key, text: text.trim() });
  return actor.setFlag(MODULE_ID, "notes", notes);
}

/*
 * Names a player gave their contacts: stored on the PC like notes, keyed the same way (noteKey).
 * They only change what that PC's phone shows; the GM sees them as "Renamed to".
 */

/** @returns {{key: string, name: string}[]} */
export function getAliases(actor) {
  return foundry.utils.deepClone(actor?.getFlag(MODULE_ID, "aliases") ?? []);
}

export function getAlias(actor, key) {
  return getAliases(actor).find(a => a.key === key)?.name ?? "";
}

export function setAlias(actor, key, name) {
  const aliases = getAliases(actor).filter(a => a.key !== key);
  name = String(name ?? "").trim().slice(0, 60);
  if (name) aliases.push({ key, name });
  return actor.setFlag(MODULE_ID, "aliases", aliases);
}

/** The name a PC's phone shows for a contact: their own name for it, else the contact's. */
export const shownName = (actor, contact, threadId = null) => getAlias(actor, noteKey(contact, threadId)) || contact;

/**
 * Change options on one of a PC's contacts, e.g. { blocked: true } or { noCall: true } (the PC can
 * text this contact but not call it). Creates the contact entry if the thread had none.
 */
export async function setContactOptions(actor, name, changes, fallback = {}) {
  const contacts = getContacts(actor);
  let entry = findContact(contacts, name);
  if (!entry) {
    entry = { name, img: fallback.img ?? DEFAULT_CONTACT_IMG };
    if (fallback.actorId) entry.actorId = fallback.actorId;
    contacts.push(entry);
  }
  Object.assign(entry, changes);
  return setContacts(actor, contacts);
}

export function findContact(contacts, name) {
  const lower = name.toLowerCase();
  return contacts.find(c => c.name.toLowerCase() === lower) ?? null;
}

/** PCs: actors owned by or assigned to a player (see isPlayerCharacter). */
export function playerCharacters() {
  return game.actors.filter(a => isPlayerCharacter(a));
}

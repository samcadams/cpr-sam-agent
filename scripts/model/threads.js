import { isPlayerCharacter } from "./agent.js";
import { getContacts } from "./contacts.js";
import { moneyLabel } from "./money.js";
import { DEFAULT_CONTACT_IMG, MODULE_ID } from "../config.js";

/*
 * Conversations ("threads"), as stored in the world's message file and sent to clients.
 *
 * Direct thread (one PC's conversation with one contact):
 * {
 *   id, type: "direct", actorId, contact, contactImg, contactActorId,
 *   hideId,                            // caller ID hidden: players see "Unknown Number"
 *   messages: [{ id, from: "pc"|"contact", text, time, date, ts, userId, pairId, system?, call? }],
 *   lastRead: { owner: ts, gm: ts },   // unread tracking; lastRead.owner doubles as "Viewed" for the GM
 *   viewed: ts                         // contact side has seen PC messages up to here (shown to the player)
 * }
 * A PC-to-PC conversation is two direct threads, one per PC, mirrored message by message; pairId links
 * a message to its copy so reactions and money status follow.
 *
 * Group thread:
 * {
 *   id, type: "group", name, createdBy,
 *   members: [{ key, name, img, actorId? }],   // key "a:<actorId>" for PCs, "n:<name>" for GM-voiced NPCs
 *   messages: [{ id, from: memberKey|"system", name, text, time, date, ts, userId, system?, call? }],
 *   lastRead: { gm: ts, "a:<actorId>": ts }
 * }
 *
 * Service thread (a PC's button presses on a scripted contact and the GM's responses):
 * { id, type: "service", serviceId, actorId, name, img,
 *   messages: [{ id, from: "pc"|"service", text, action?, ... }], lastRead: { owner, gm } }
 *
 * Any message may also carry:
 *   money      see model/money.js
 *   reactions  { [reactorKey]: emoji }, keyed "pc"/"contact"/"service" or a group member key
 *   location   { sceneId, sceneName, noteId, x, y, label }: a map pin or a shared position
 *   image      a file path (GM only)
 * and a thread may carry lastReaction { messageId, emoji, side, by, userId, ts } for inbox previews.
 *
 * Calls live only in the host's memory:
 * { id, threadId, groupName, line, callerKey, startedAt,
 *   participants: [{ ...member, hidden?, state: "ringing"|"joined"|"left"|"declined"|"missed", joinedAt }] }
 *
 * Contact requests (persisted): { id, actorId, name, note, userId, ts }, a player asking the GM to add a number.
 */

export const isGroup = thread => thread?.type === "group";
export const isService = thread => thread?.type === "service";
export const isDirect = thread => !!thread && !isGroup(thread) && !isService(thread);

export const displayName = actor => actor.prototypeToken?.name || actor.name;
/** A sheet's picture on the phone: its portrait, or its token art when the portrait is the default. */
export const actorAvatar = actor => (actor.img && actor.img !== DEFAULT_CONTACT_IMG ? actor.img : actor.prototypeToken?.texture?.src || actor.img);

/**
 * The picture shown for someone who may have a sheet (`actorId`): the sheet's current portrait,
 * unless a different picture was chosen for them. Pictures saved with contacts, conversations and
 * group members before are the default, the sheet's portrait or its token art: those follow the sheet.
 */
export function pictureOf(img, actorId) {
  const actor = actorId ? game.actors.get(actorId) : null;
  if (!actor) return img ?? null;
  const saved = !img || img === DEFAULT_CONTACT_IMG || img === actor.img || img === actor.prototypeToken?.texture?.src;
  return saved ? actorAvatar(actor) : img;
}
export const unknownLabel = () => game.settings.get(MODULE_ID, "unknownLabel") || "Unknown Number";

/**
 * A stable colour per person (NPC, PC or service), from their name, so the GM can tell at a glance
 * who is speaking: in banners, bubbles, inbox rows and call lists.
 */
export function personaColor(name) {
  let hash = 0;
  for (const ch of String(name ?? "").trim().toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 80% 66%)`;
}

/** Text shown in inbox previews for a message. */
export const previewText = m =>
  m.text ||
  (m.money ? `💸 ${moneyLabel(m.money, false)}` : m.job ? `💼 Job: ${m.job.name}` : m.image ? "📷 Photo" : m.location ? `📍 ${m.location.label}` : "");

/* -------------------------------------------- */
/*  Keys                                         */
/* -------------------------------------------- */

export const pcKey = actorId => `a:${actorId}`;
export const npcKey = name => `n:${name.toLowerCase()}`;

/**
 * Stable per-phone key for a conversation (pins and "deleted" markers are saved under it).
 * Takes an inbox row or view: { kind, groupId?, actorId?, serviceId?, contact?, hidden?, threadId? }.
 */
export function conversationKey(c) {
  if (c.kind === "group") return `g:${c.groupId}`;
  if (c.kind === "service") return `s:${c.actorId}:${c.serviceId}`;
  return `d:${c.actorId}:${c.hidden ? c.threadId : c.contact.toLowerCase()}`;
}

export function threadKey(thread) {
  if (isGroup(thread)) return conversationKey({ kind: "group", groupId: thread.id });
  if (isService(thread)) return conversationKey({ kind: "service", actorId: thread.actorId, serviceId: thread.serviceId });
  return conversationKey({ kind: "direct", actorId: thread.actorId, hidden: !!thread.hideId, threadId: thread.id, contact: thread.contact });
}

/* -------------------------------------------- */
/*  Members                                      */
/* -------------------------------------------- */

export function pcMember(actor) {
  return { key: pcKey(actor.id), actorId: actor.id, name: displayName(actor), img: actorAvatar(actor) };
}

export function npcMember(name, img) {
  return { key: npcKey(name), name, img: img ?? null };
}

/** Players' characters join as PCs; every other contact is an NPC voiced by the GM. */
export function contactMember(entry) {
  const actor = entry.actorId ? game.actors.get(entry.actorId) : null;
  return isPlayerCharacter(actor) ? pcMember(actor) : npcMember(entry.name, entry.img);
}

/** Every NPC name on any PC's contact list, for GM pickers. */
export function knownNpcs() {
  const seen = new Map();
  for (const actor of game.actors) {
    for (const entry of getContacts(actor)) {
      const member = contactMember(entry);
      if (!member.actorId && !seen.has(member.key)) seen.set(member.key, member);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

import { canUsePhone } from "./agent.js";
import { isGroup, isService, pcKey, unknownLabel } from "./threads.js";

/*
 * Who may see and act in what. Players act for PCs they own; GMs act for every NPC and service.
 * The host runs every request through these, and redacts what it sends to players.
 */

const owns = (user, actorId) => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");

/** Players speak and answer for PCs they own; GMs for NPCs. */
export function canActFor(user, member) {
  if (member.actorId) return !user.isGM && owns(user, member.actorId);
  return user.isGM;
}

export function canView(user, thread) {
  if (user.isGM) return true;
  if (isGroup(thread)) return thread.members.some(m => canActFor(user, m));
  return owns(user, thread.actorId);
}

/** The PC a player speaks as in a thread (null for GMs in groups). */
export function memberActorId(user, thread) {
  if (!isGroup(thread)) return thread.actorId;
  if (user.isGM) return null;
  return thread.members.find(m => m.actorId && canActFor(user, m))?.actorId ?? null;
}

/**
 * The side a user acts for in a direct or service thread: "pc" for a player who owns the PC and can
 * use their phone (has an Agent and signal), "contact"/"service" for the GM, else null.
 */
export function sideFor(user, thread) {
  if (user.isGM) return isService(thread) ? "service" : "contact";
  return owns(user, thread.actorId) && canUsePhone(game.actors.get(thread.actorId)) ? "pc" : null;
}

/** The other party in a direct or service thread. */
export function otherSide(thread, side) {
  if (side === "pc") return isService(thread) ? "service" : "contact";
  return "pc";
}

/** Where this user's read position is kept on a thread. */
export function readKey(user, thread, actorId) {
  if (user.isGM) return "gm";
  if (!isGroup(thread)) return "owner";
  return actorId ? pcKey(actorId) : null;
}

/** Is this message something the user should be notified about / count as unread? */
export function isIncoming(thread, message, user, actorId) {
  if (message.system && !message.call && !message.alert) return false;
  if (isGroup(thread)) return user.isGM ? message.from.startsWith("a:") : message.from !== pcKey(actorId);
  if (isService(thread)) return message.from === (user.isGM ? "pc" : "service");
  return message.from === (user.isGM ? "pc" : "contact");
}

/** Did this user write the message (i.e. should hear about reactions to it)? */
export function isAuthor(user, thread, message) {
  if (isGroup(thread)) {
    const member = thread.members.find(m => m.key === message.from);
    return !!member && canActFor(user, member);
  }
  if (message.from === "pc") return !user.isGM && owns(user, thread.actorId);
  return user.isGM;
}

/**
 * Everyone the user holds in a call: the participants ringing for them and those they're on it as.
 * A player holds one PC; the GM can hold several NPCs in the same call. Null when none.
 */
export function callRoles(call, user = game.user) {
  const mine = call.participants.filter(p => canActFor(user, p));
  const ringing = mine.filter(p => p.state === "ringing");
  const joined = mine.filter(p => p.state === "joined");
  return ringing.length || joined.length ? { call, ringing, joined } : null;
}

/** How the user relates to a call, as one participant: ringing for them first, else on it. */
export function callRole(call, user = game.user) {
  const roles = callRoles(call, user);
  if (!roles) return null;
  if (roles.ringing.length) return { call, kind: "incoming", me: roles.ringing[0] };
  return { call, kind: "active", me: roles.joined[0] };
}

/* -------------------------------------------- */
/*  Redaction for players                        */
/* -------------------------------------------- */

export function redactThread(thread) {
  if (!thread.hideId || isGroup(thread) || isService(thread)) return thread;
  const redacted = { ...thread, contact: unknownLabel(), contactImg: null, contactActorId: null };
  if (thread.lastReaction?.side === "contact") redacted.lastReaction = { ...thread.lastReaction, by: unknownLabel() };
  return redacted;
}

/** A reaction event as players see it: a hidden caller reacting stays unknown. */
export function redactReaction(thread, reaction) {
  if (!reaction || !thread.hideId || reaction.side !== "contact") return reaction;
  return { ...reaction, by: unknownLabel() };
}

export function redactCall(call) {
  if (!call.participants.some(p => p.hidden)) return call;
  return {
    ...call,
    participants: call.participants.map(p => (p.hidden ? { ...p, name: unknownLabel(), img: null } : p))
  };
}

import { gm } from "./validate.js";
import { MODULE_ID } from "../config.js";
import { canUsePhone, isPlayerCharacter } from "../model/agent.js";
import { findContact, getContacts } from "../model/contacts.js";
import { noSignalSince } from "../model/features.js";
import { canActFor, redactCall } from "../model/permissions.js";
import { callLines } from "../model/services.js";
import { memberSound } from "../model/sounds.js";
import { contactMember, isGroup, isService, npcMember, pcKey, pcMember } from "../model/threads.js";
import { formatDuration } from "../util/text.js";

/*
 * Host: voice calls. Calls live only in memory; each ends with a log line in its thread.
 * Methods run on the store (`this`); see host/index.js.
 */

const RING_TIMEOUT_MS = 30_000;

// Per ringing participant ("<callId>:<memberKey>"): the no-answer timeout, and the in-world ring's id.
const ringTimers = new Map();
const worldRings = new Map();

export const requests = {
  "call-start": "_onCallStart",
  "call-answer": "_onCallAnswer",
  "call-decline": "_onCallDecline",
  "call-hangup": "_onCallHangup",
  "call-add": "_onCallAdd",
  "call-close": gm("_onCallClose")
};

export const methods = {
  _callAudience(call, user) {
    return user.isGM || call.participants.some(p => canActFor(user, p));
  },

  _pushCall(call) {
    const users = game.users.filter(u => u.active && u !== game.user && this._callAudience(call, u));
    this._emitSplit(users, "call", r => ({ call: r(call) }), redactCall);
    this._applyCall(call);
  },

  /** Players can only be on one call at a time (they can still add people to it). */
  _playerBusy(user) {
    return !user.isGM && [...this.calls.values()].some(c =>
      c.participants.some(p => ["joined", "ringing"].includes(p.state) && canActFor(user, p))
    );
  },

  async _onCallStart(user, msg) {
    if (this._playerBusy(user)) return;
    let thread, caller, callees, line = null;

    if (msg.serviceId) {
      // Ringing a service: the GM answers as the service on the GM Phone.
      const { actor, service } = this._playerService(user, msg.actorId, msg.serviceId) ?? {};
      const lines = service ? callLines(service) : [];
      line = lines.includes(msg.line) ? msg.line : lines[0];
      if (!line) return;
      thread = this._serviceThread(actor, service);
      caller = pcMember(actor);
      callees = [{ ...npcMember(service.name, service.img), service: true }];
    } else if (msg.groupId) {
      thread = this.threads.get(msg.groupId);
      if (!isGroup(thread)) return;
      caller = thread.members.find(m => m.key === msg.as);
      if (!caller || !canActFor(user, caller)) return;
      if (caller.actorId && !canUsePhone(game.actors.get(caller.actorId))) return;
      // The GM is the one calling: its other NPCs don't ring it (it adds them from the call screen).
      callees = thread.members.filter(m => m !== caller && !(user.isGM && canActFor(user, m)));
    } else if (user.isGM) {
      thread = await this._gmDirect(msg);
      const actor = thread && game.actors.get(thread.actorId);
      if (!actor) return;
      const entry = findContact(getContacts(actor), thread.contact);
      caller = { ...npcMember(thread.contact, entry?.img ?? thread.contactImg), hidden: !!thread.hideId };
      callees = [pcMember(actor)];
    } else {
      const found = this._playerDirect(user, msg);
      if (!found || found.entry?.noCall) return; // "texts only" contact
      const { actor, entry } = found;
      thread = found.thread ?? this._getOrCreate(actor, found.contact, entry);
      caller = pcMember(actor);
      const other = thread.contactActorId ? game.actors.get(thread.contactActorId) : null;
      let callee = entry ? contactMember(entry) : isPlayerCharacter(other) ? pcMember(other) : npcMember(thread.contact, thread.contactImg);
      if (thread.hideId) callee = { ...callee, hidden: true };
      callees = [callee];
    }
    if (!callees.length) return;

    const call = {
      id: foundry.utils.randomID(),
      threadId: thread.id,
      groupName: isGroup(thread) ? thread.name : null,
      line,
      callerKey: caller.key,
      startedAt: null,
      participants: [
        { ...caller, state: "joined", joinedAt: Date.now() },
        ...callees.map(m => ({ ...m, state: this._reachable(m) ? "ringing" : "missed" }))
      ]
    };
    this.calls.set(call.id, call);
    // Nobody reachable: it's over before it starts, logged as a missed call.
    if (!call.participants.some(p => p.state === "ringing")) return this._checkCall(call);
    for (const p of call.participants) if (p.state === "ringing") this._ring(call, p);
    this._pushCall(call);
  },

  /** Characters without cellular service can't be rung (NPCs always can: the GM answers). */
  _reachable(member) {
    return !member.actorId || !noSignalSince(member.actorId);
  },

  _participant(user, callId, key) {
    const call = this.calls.get(callId);
    const p = call?.participants.find(x => x.key === key);
    return p && canActFor(user, p) ? { call, p } : {};
  },

  /**
   * Answer a ringing call. A player can only be on one call: answering while on another hangs that
   * one up first ("Hang up & Answer").
   */
  _onCallAnswer(user, { callId, key }) {
    const { call, p } = this._participant(user, callId, key);
    if (!p || p.state !== "ringing") return;
    if (!user.isGM) {
      for (const other of [...this.calls.values()]) {
        if (other === call) continue;
        for (const q of other.participants) {
          if (q.state !== "joined" || !canActFor(user, q)) continue;
          q.state = "left";
          this._checkCall(other);
        }
      }
    }
    p.state = "joined";
    p.joinedAt = Date.now();
    call.startedAt ??= p.joinedAt;
    this._stopRing(call, p);
    this._pushCall(call);
  },

  _onCallDecline(user, { callId, key }) {
    const { call, p } = this._participant(user, callId, key);
    if (!p || p.state !== "ringing") return;
    p.state = "declined";
    this._stopRing(call, p);
    this._checkCall(call);
  },

  _onCallHangup(user, { callId, key }) {
    const { call, p } = this._participant(user, callId, key);
    if (!p || !["joined", "ringing"].includes(p.state)) return;
    p.state = "left";
    this._stopRing(call, p);
    this._checkCall(call);
  },

  /**
   * Ring more people into a call. An NPC the GM adds joins at once: the GM is already holding the
   * phone, so there's nobody to ring.
   */
  _onCallAdd(user, msg) {
    const { call, p } = this._participant(user, msg.callId, msg.key);
    if (!p || p.state !== "joined") return;
    const actor = p.actorId ? game.actors.get(p.actorId) : null;
    for (const member of this._buildMembers(user, actor, msg, [p.key])) {
      const existing = call.participants.find(x => x.key === member.key);
      if (existing && ["joined", "ringing"].includes(existing.state)) continue;
      const target = existing ?? { ...member };
      if (user.isGM && canActFor(user, target)) {
        target.state = "joined";
        target.joinedAt = Date.now();
      } else target.state = this._reachable(target) ? "ringing" : "missed";
      if (!existing) call.participants.push(target);
      if (target.state === "ringing") this._ring(call, target);
    }
    this._pushCall(call);
  },

  /** GM: end a call for everyone on it. */
  _onCallClose(user, { callId }) {
    const call = this.calls.get(callId);
    if (!call) return;
    for (const p of call.participants) {
      if (!["joined", "ringing"].includes(p.state)) continue;
      p.state = p.state === "ringing" ? "missed" : "left";
      this._stopRing(call, p);
    }
    this._checkCall(call);
  },

  /** Communications switched off (main.js): every call ends. */
  _endCalls() {
    for (const callId of [...this.calls.keys()]) this._onCallClose(null, { callId });
  },

  /** Keep the call going while two people are on it (or one is waiting on a ring); otherwise end it. */
  _checkCall(call) {
    const joined = call.participants.filter(p => p.state === "joined");
    const ringing = call.participants.filter(p => p.state === "ringing");
    if (joined.length >= 2 || (joined.length === 1 && ringing.length)) return this._pushCall(call);

    for (const p of ringing) {
      p.state = "missed";
      this._stopRing(call, p);
    }
    this._logCall(call);
    this.calls.delete(call.id);
    const to = game.users.filter(u => u.active && u !== game.user && this._callAudience(call, u)).map(u => u.id);
    this._send(to, { type: "call-end", callId: call.id });
    this._applyCallEnd(call.id);
  },

  _logCall(call) {
    const thread = this.threads.get(call.threadId);
    if (!thread) return;
    let text = call.startedAt
      ? `Call · ${formatDuration(Date.now() - call.startedAt)}`
      : call.participants.some(p => p.state === "declined") ? "Call declined" : "Missed call";
    if (call.line) text = `${call.line} · ${text}`;
    const extra = { system: true, call: true, userId: null };

    if (isService(thread)) {
      thread.messages.push(this._message("pc", text, extra));
      this.save();
      this._push(thread, !call.startedAt);
    } else if (isGroup(thread)) {
      const caller = call.participants.find(p => p.key === call.callerKey);
      thread.messages.push(this._message(call.callerKey, text, { ...extra, name: caller?.name }));
      this.save();
      this._push(thread, !call.startedAt);
    } else {
      const from = call.callerKey === pcKey(thread.actorId) ? "pc" : "contact";
      this._postDirect(thread, this._message(from, text, extra), !call.startedAt);
    }
  },

  _ring(call, p) {
    const key = `${call.id}:${p.key}`;
    clearTimeout(ringTimers.get(key));
    ringTimers.set(key, setTimeout(() => {
      if (p.state !== "ringing") return;
      p.state = "missed";
      this._stopRing(call, p);
      this._checkCall(call);
    }, RING_TIMEOUT_MS));

    if (!worldRings.has(key) && game.settings.get(MODULE_ID, "ringAtToken")) {
      const id = this._worldSound(p, memberSound(p, "ring"), { loop: true });
      if (id) worldRings.set(key, id);
    }
  },

  _stopRing(call, p) {
    const key = `${call.id}:${p.key}`;
    clearTimeout(ringTimers.get(key));
    ringTimers.delete(key);
    const id = worldRings.get(key);
    if (!id) return;
    worldRings.delete(key);
    this._stopWorldSound(id);
  }
};

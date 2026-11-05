import { MODULE_ID, SOCKET } from "./config.js";
import { installHost } from "./host/index.js";
import { callRole, callRoles, canView, isAuthor, isIncoming, memberActorId, readKey } from "./model/permissions.js";
import { isPlayerCharacter } from "./model/agent.js";
import { emptyApps } from "./model/apps.js";
import { emptyGarden } from "../apps/garden/model.js";
import { playerQuests } from "./model/quests.js";
import { isDirect, isGroup, isService, npcKey, pcKey } from "./model/threads.js";
import { subscriptionInfo } from "../apps/trauma/model.js";
import { subscriptionsOf, subscriptionState } from "../apps/pool/model.js";

/*
 * Message & call store.
 *
 * The active GM ("host") owns all data: it loads/saves the data folder (model/storage.js), runs calls, places in-world
 * sounds, and is the only client that changes anything. Everyone else sends requests over the module
 * socket and receives only the threads and calls they may see — with hidden caller IDs redacted.
 * Data shapes are described in model/threads.js.
 *
 * This file is what every client uses: the state, queries over it, sending requests and applying
 * what the host pushes. The host's side is in host/, installed onto the same class.
 */

/** Socket messages the host sends out; every other type is a request to the host. */
const PUSHES = new Set(["thread", "remove", "sync", "call", "call-end", "requests", "quests", "notice", "world-sound", "world-sound-stop", "apps", "garden", "gm-card", "job-popout"]);

/* -------------------------------------------- */
/*  Store                                        */
/* -------------------------------------------- */

class MessageStore {
  threads = new Map();
  calls = new Map();
  requests = new Map();
  quests = new Map();
  apps = emptyApps(); // the apps' data (model/apps.js)
  garden = emptyGarden(); // The Garden (apps/garden/model.js)
  loaded = false;
  loadFailed = false;
  synced = false;

  get isHost() {
    return game.user === game.users.activeGM;
  }

  /** True when texts can be sent: we are the host, or a host is online and has synced us. */
  get online() {
    return this.isHost ? this.loaded && !this.loadFailed : !!game.users.activeGM && this.synced;
  }

  async init() {
    game.socket.on(SOCKET, (msg, senderId) => this._onSocket(msg, senderId));
    if (this.isHost) await this._enqueue(() => this._becomeHost());
    else if (game.users.activeGM) this._toHost({ type: "request" });
  }

  onUserConnected() {
    if (this.isHost && !this.loaded) {
      // The previous host left and this GM took over.
      this._enqueue(() => this._becomeHost());
      return;
    }
    if (!game.users.activeGM) {
      this.synced = false;
      this.calls.clear();
      this._callsChanged();
    }
    this._changed();
  }

  /* ---------------- Queries ---------------- */

  findThread(actorId, contact, hidden = false) {
    const lower = contact.toLowerCase();
    for (const t of this.threads.values()) {
      if (isDirect(t) && t.actorId === actorId && !!t.hideId === hidden && t.contact.toLowerCase() === lower) return t;
    }
    return null;
  }

  findServiceThread(actorId, serviceId) {
    for (const t of this.threads.values()) {
      if (isService(t) && t.actorId === actorId && t.serviceId === serviceId) return t;
    }
    return null;
  }

  /** A PC's phone: its direct and service threads plus groups it's in. */
  threadsFor(actorId) {
    const key = pcKey(actorId);
    return [...this.threads.values()].filter(t =>
      isGroup(t) ? t.members.some(m => m.key === key) : t.actorId === actorId
    );
  }

  /** Everything one NPC is part of (GM): conversations where it is the contact, and groups it's in. */
  threadsForNpc(name) {
    const lower = name.toLowerCase();
    const key = npcKey(name);
    return [...this.threads.values()].filter(t =>
      isGroup(t) ? t.members.some(m => m.key === key) : isDirect(t) && t.contact.toLowerCase() === lower
    );
  }

  visibleRequests(user = game.user) {
    return [...this.requests.values()].filter(r =>
      user.isGM || !!game.actors.get(r.actorId)?.testUserPermission(user, "OWNER")
    );
  }

  visibleQuests(user = game.user) {
    const quests = [...this.quests.values()];
    return user.isGM ? quests : playerQuests(quests);
  }

  visibleThreads(user = game.user) {
    return [...this.threads.values()].filter(t => canView(user, t));
  }

  unread(thread, user = game.user, actorId = thread ? memberActorId(user, thread) : null) {
    if (!thread) return 0;
    const key = readKey(user, thread, actorId);
    if (!key) return 0;
    const since = thread.lastRead?.[key] ?? 0;
    return thread.messages.filter(m => m.ts > since && isIncoming(thread, m, user, actorId)).length;
  }

  totalUnread(threads = this.visibleThreads(), user = game.user, actorId) {
    return threads.reduce((sum, t) => sum + this.unread(t, user, isGroup(t) ? actorId ?? memberActorId(user, t) : t.actorId), 0);
  }

  /**
   * GM: every NPC name the GM has spoken as or could speak as (conversation contacts that aren't
   * players' characters, group members), for the "As" picker.
   */
  npcNames() {
    const names = new Map();
    const add = name => name && !names.has(name.toLowerCase()) && names.set(name.toLowerCase(), name);
    for (const t of this.threads.values()) {
      if (isGroup(t)) t.members.filter(m => !m.actorId).forEach(m => add(m.name));
      else if (isDirect(t) && !isPlayerCharacter(game.actors.get(t.contactActorId))) add(t.contact);
    }
    return [...names.values()];
  }

  /** Every call this user holds someone in (see callRoles), calls ringing for them first. */
  myCalls(user = game.user) {
    const roles = [...this.calls.values()].map(call => callRoles(call, user)).filter(Boolean);
    return roles.sort((a, b) => b.ringing.length - a.ringing.length);
  }

  /** The call this user should see: an incoming ring first, else one they're on. */
  myCall(user = game.user) {
    let active = null;
    for (const call of this.calls.values()) {
      const role = callRole(call, user);
      if (role?.kind === "incoming") return role;
      active ??= role;
    }
    return active;
  }

  /* ---------------- Client requests ---------------- */

  /** Run a request on the host (locally if we are the host). */
  request(type, data = {}, { quiet = false } = {}) {
    const msg = { ...data, type };
    if (this.isHost) this._handle(msg, game.user);
    else if (this.online) this._toHost(msg);
    else {
      if (!quiet) ui.notifications.warn("No signal — a GM needs to be online.");
      return false;
    }
    Hooks.callAll(`${MODULE_ID}.request`, type, data); // sent: what the phone is doing (ui/activity.js)
    return true;
  }

  /** Send a request to the host only. */
  _toHost(msg) {
    const host = game.users.activeGM;
    if (host) game.socket.emit(SOCKET, msg, { recipients: [host.id] });
  }

  markRead(thread, actorId = thread ? memberActorId(game.user, thread) : null) {
    if (!thread) return;
    const last = thread.messages.at(-1)?.ts;
    const key = readKey(game.user, thread, actorId);
    if (!last || !key || (thread.lastRead[key] ?? 0) >= last) return;
    thread.lastRead[key] = last; // optimistic, the host echoes the thread back
    if (this.request("read", { threadId: thread.id, ts: last, actorId }, { quiet: true }) && !this.isHost) {
      this._changed({ threadId: thread.id });
    }
  }

  /* ---------------- Receiving from the host ---------------- */

  _applyRequests(list, notice) {
    this.requests = new Map(list.map(r => [r.id, r]));
    if (notice) Hooks.callAll(`${MODULE_ID}.requestNotice`, notice);
    this._changed({ requests: true });
  }

  /**
   * Foundry passes the sender's user id alongside every module socket message. Pushes (thread
   * updates, syncs, sounds…) are only accepted from a GM; anything else is a request for the host.
   */
  _onSocket(msg, senderId) {
    const sender = game.users.get(senderId);
    if (!sender || !msg || typeof msg !== "object") return;
    if (!PUSHES.has(msg.type)) {
      if (this.isHost) this._handle(msg, sender);
      return;
    }
    if (!sender.isGM) return;
    switch (msg.type) {
      case "thread":
        return this._apply(msg.thread, msg.notify, msg.reaction);
      case "remove":
        this.threads.delete(msg.threadId);
        return this._changed({ threadId: msg.threadId });
      case "sync":
        this.threads = new Map(msg.threads.map(t => [t.id, t]));
        this.calls = new Map((msg.calls ?? []).map(c => [c.id, c]));
        this.requests = new Map((msg.requests ?? []).map(r => [r.id, r]));
        this.quests = new Map((msg.quests ?? []).map(q => [q.id, q]));
        this.apps = { ...emptyApps(), ...(msg.apps ?? {}) };
        this._traumaChanges(false);
        this.garden = { ...emptyGarden(), ...(msg.garden ?? {}) };
        this.synced = true;
        this._changed();
        return this._callsChanged();
      case "call":
        return this._applyCall(msg.call);
      case "call-end":
        return this._applyCallEnd(msg.callId);
      case "requests":
        return this._applyRequests(msg.requests, msg.notice);
      case "quests":
        this.quests = new Map(msg.quests.map(q => [q.id, q]));
        if (msg.notice) Hooks.callAll(`${MODULE_ID}.questNotice`, msg.notice);
        return this._changed({ quests: true });
      case "notice":
        return Hooks.callAll(`${MODULE_ID}.notice`, msg.notice);
      case "apps":
        return this._applyApps(msg.apps, msg.alerts);
      case "garden":
        this.garden = { ...emptyGarden(), ...msg.garden };
        return this._changed({ garden: true });
      case "gm-card":
        // A new card (it pops up), or cards cleared from the notification center.
        for (const id of msg.clear ?? []) delete this.apps.gmCards[id];
        if (msg.card) this.apps.gmCards[msg.card.id] = msg.card;
        this._changed({ apps: true });
        if (msg.clear?.length) Hooks.callAll(`${MODULE_ID}.gmCardGone`, msg.clear);
        return msg.card ? Hooks.callAll(`${MODULE_ID}.gmCard`, msg.card) : undefined;
      case "job-popout":
        return Hooks.callAll(`${MODULE_ID}.jobPopout`, msg.questId);
      case "world-sound":
        return Hooks.callAll(`${MODULE_ID}.worldSound`, msg.sound);
      case "world-sound-stop":
        return Hooks.callAll(`${MODULE_ID}.worldSoundStop`, msg.id);
    }
  }

  _apply(thread, notify, reaction = null) {
    this.threads.set(thread.id, thread);
    if (reaction && reaction.userId !== game.user.id && canView(game.user, thread)) {
      const message = thread.messages.find(m => m.id === reaction.messageId);
      if (message && isAuthor(game.user, thread, message)) Hooks.callAll(`${MODULE_ID}.reacted`, thread, message, reaction);
    }
    if (notify && canView(game.user, thread)) {
      const last = thread.messages.at(-1);
      if (last && last.userId !== game.user.id && isIncoming(thread, last, game.user, memberActorId(game.user, thread))) {
        Hooks.callAll(`${MODULE_ID}.received`, thread, last);
      }
    }
    this._changed({ threadId: thread.id });
  }

  /** New app data; `alerts` are ids of Agent alerts that just arrived (they pop up). */
  _applyApps(apps, alerts = []) {
    this.apps = { ...emptyApps(), ...apps };
    for (const id of alerts ?? []) {
      const alert = this.apps.alerts[id];
      if (alert) Hooks.callAll(`${MODULE_ID}.agentAlert`, alert);
    }
    this._traumaChanges();
    this._subsChanges();
    this._changed({ apps: true });
  }

  /**
   * Ziggurat Pool subscriptions that changed since this client last looked: the subscriptionsChanged
   * hook (API.md) for each character, unless `fire` is false (the first sync only sets what's been seen).
   */
  _subsChanges(fire = !!this._poolSubsSeen) {
    // Its own record: Trauma Team's (_traumaChanges) is _subsSeen.
    const seen = (this._poolSubsSeen ??= {});
    const installs = this.apps.installs ?? {};
    for (const actorId of new Set([...Object.keys(seen), ...Object.keys(installs)])) {
      const now = JSON.stringify(subscriptionsOf(installs, actorId));
      if (now === (seen[actorId] ?? "[]")) continue;
      seen[actorId] = now;
      if (fire) Hooks.callAll(`${MODULE_ID}.subscriptionsChanged`, { actorId, ...subscriptionState(installs, actorId) });
    }
  }

  /**
   * Trauma Team subscriptions that changed since this client last looked: the traumaChanged hook
   * (API.md) for each, unless `fire` is false (the first sync only sets what's been seen).
   */
  _traumaChanges(fire = true) {
    const seen = (this._subsSeen ??= {});
    const subs = this.apps.subs ?? {};
    for (const actorId of new Set([...Object.keys(seen), ...Object.keys(subs)])) {
      const now = subs[actorId] ? JSON.stringify(subs[actorId]) : null;
      if (now === (seen[actorId] ?? null)) continue;
      if (now) seen[actorId] = now;
      else delete seen[actorId];
      if (fire) Hooks.callAll(`${MODULE_ID}.traumaChanged`, { actorId, ...subscriptionInfo(subs[actorId]) });
    }
  }

  _applyCall(call) {
    this.calls.set(call.id, call);
    this._callsChanged();
  }

  _applyCallEnd(callId) {
    this.calls.delete(callId);
    this._callsChanged();
  }

  /**
   * Tell phones the data changed. `change` says what, so a phone can skip redrawing for something it
   * doesn't show (see AgentPhone.affectedBy): { threadId }, { requests }, { quests }, { apps }, { garden }; anything else
   * (sync, load) is { all: true }.
   */
  _changed(change = { all: true }) {
    Hooks.callAll(`${MODULE_ID}.changed`, change);
  }

  _callsChanged() {
    Hooks.callAll(`${MODULE_ID}.calls`);
  }
}

installHost(MessageStore);

export const store = new MessageStore();

import { dataFolder, MODULE_ID, SOCKET } from "../config.js";
import { noSignalSince } from "../model/features.js";
import { appsFor, emptyApps } from "../model/apps.js";
import { emptyGarden, gardenFor } from "../model/garden.js";
import { canView, memberActorId, redactCall, redactReaction, redactThread } from "../model/permissions.js";
import {
  DATA_FOLDER, GARDEN_FILE, joinGarden, joinMessages, MESSAGES_FILE, splitGarden, splitMessages, SUBFOLDERS
} from "../model/storage.js";
import { isGroup, pcKey } from "../model/threads.js";
import { agentTimestamp } from "../util/agentTime.js";

/*
 * Host core: the job queue, loading and saving the data folder (model/storage.js), and sending state
 * to clients.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  request: "syncUser"
};

let queue = Promise.resolve();

export const methods = {
  /**
   * Host work runs one job at a time. Handlers await sheet updates part-way through, so without this
   * two requests could both pass a check before either records its result (e.g. paying twice).
   */
  _enqueue(job) {
    queue = queue.then(job).catch(err => console.error(`${MODULE_ID} | Host job failed`, err));
    return queue;
  },

  async _becomeHost() {
    this._written = new Map();
    this._folders = this._ensureFolders();
    await this.load();
    await this.loadGarden();
    this._signalSeen = { ...(game.settings.get(MODULE_ID, "noSignal") ?? {}) };
    this._startClock();
    this.syncAll();
  },

  /**
   * The GM changed who has cellular service. Characters getting it back receive what was held for
   * them (see _forPlayer), and their Agent tells them how much arrived.
   */
  _signalChanged() {
    const now = { ...(game.settings.get(MODULE_ID, "noSignal") ?? {}) };
    const alerts = [];
    for (const [actorId, since] of Object.entries(this._signalSeen ?? {})) {
      if (now[actorId]) continue;
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      const held = this.threadsFor(actorId).reduce((n, t) => {
        const own = isGroup(t) ? pcKey(actorId) : "pc";
        // Counted like unread: texts, plus call logs and alerts.
        return n + t.messages.filter(m => m.ts > since && m.from !== own && (!m.system || m.call || m.alert)).length;
      }, 0);
      const text = held ? `Signal restored. ${held} new while you had no signal.` : "Signal restored. Back online.";
      alerts.push(this._alert(actorId, { kind: "system", text }));
    }
    this._signalSeen = now;
    this.syncAll(); // restored phones get what was held; phones that just lost signal stop getting more
    this._pushApps(alerts.filter(Boolean));
  },

  async load() {
    try {
      const data = await this._readSplit(MESSAGES_FILE, joinMessages);
      if (data) {
        this.threads = new Map(
          // Keys in the order saved, so an unchanged conversation isn't rewritten.
          Object.values(data.threads ?? {}).map(t => [t.id, { ...t, type: t.type ?? "direct", lastRead: t.lastRead ?? {} }])
        );
        this.requests = new Map(Object.values(data.requests ?? {}).map(r => [r.id, r]));
        this.quests = new Map(Object.values(data.quests ?? {}).map(q => [q.id, q]));
        this.apps = { ...emptyApps(), ...(data.apps ?? {}) };
      }
      this.loadFailed = false;
    } catch (err) {
      // Never overwrite history we failed to read.
      this.loadFailed = true;
      console.error(`${MODULE_ID} | Could not read the message history`, err);
      ui.notifications.error("Agent: could not load message history. Saving is disabled until reload.");
    }
    this.loaded = true;
    this._changed();
  },

  /** Save soon: a burst of changes is written once. */
  save() {
    (this._saveSoon ??= foundry.utils.debounce(() => this._queueWrite(() => this._write()), 500))();
  },

  async _write() {
    if (!this.isHost || this.loadFailed) return;
    await this._writeSplit(MESSAGES_FILE, splitMessages(this), ["threads/", "apps/"]);
  },

  /** The Garden's own files (it can grow large, so it's kept apart from messages). */
  async loadGarden() {
    try {
      const data = await this._readSplit(GARDEN_FILE, joinGarden);
      if (data) this.garden = { ...emptyGarden(), ...data };
      this.gardenFailed = false;
    } catch (err) {
      // Never overwrite a Garden we failed to read.
      this.gardenFailed = true;
      console.error(`${MODULE_ID} | Could not read the Garden`, err);
    }
    this._seedGarden();
  },

  saveGarden() {
    (this._saveGardenSoon ??= foundry.utils.debounce(() => this._queueWrite(async () => {
      if (this.isHost && !this.gardenFailed) await this._writeSplit(GARDEN_FILE, splitGarden(this.garden), ["garden/"]);
    }), 1000))();
  },

  /** Saves run one at a time, so a slow upload can't be overtaken by an older one. */
  _queueWrite(job) {
    this._writing = (this._writing ?? Promise.resolve()).then(job).catch(err => console.error(`${MODULE_ID} | Save failed`, err));
    return this._writing;
  },

  /**
   * A JSON file in the data folder (`path` relative to it): its content, or null if there's no such
   * file. Throws if it couldn't be read.
   */
  async _readJSON(path) {
    const route = foundry.utils.getRoute(`${dataFolder()}/${path}`);
    const response = await fetch(`${route}?t=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${DATA_FOLDER}/${path}: HTTP ${response.status}`);
    return response.json();
  },

  /**
   * Read a split save (model/storage.js): its index, then every file the index lists, and remember
   * what's on the server so the next save only uploads what changed. Null when nothing's saved yet.
   */
  async _readSplit(indexFile, join) {
    const index = await this._readJSON(indexFile);
    if (!index) return null;
    const parts = {};
    await Promise.all((index.files ?? []).map(async path => {
      const content = await this._readJSON(path);
      if (content) parts[path] = content;
      else console.warn(`${MODULE_ID} | ${DATA_FOLDER}/${path} is missing`);
    }));
    this._written ??= new Map();
    this._written.set(indexFile, JSON.stringify(index));
    for (const [path, content] of Object.entries(parts)) this._written.set(path, JSON.stringify(content));
    return join(index, parts);
  },

  /**
   * Upload the files of a split save that changed since they were last written. Files under `owned`
   * that it no longer has (a deleted conversation) are emptied. The index goes last, and only once
   * everything it lists is on the server.
   */
  async _writeSplit(indexFile, { index, parts }, owned) {
    await this._folders;
    this._written ??= new Map();
    const files = Object.entries(parts).map(([path, content]) => [path, JSON.stringify(content)]);
    for (const path of this._written.keys()) {
      if (owned.some(prefix => path.startsWith(prefix)) && !(path in parts)) files.push([path, "{}"]);
    }
    const changed = files.filter(([path, text]) => this._written.get(path) !== text);
    const results = await Promise.allSettled(changed.map(([path, text]) => this._upload(path, text)));
    let failed = 0;
    results.forEach((result, i) => {
      const [path, text] = changed[i];
      if (result.status === "rejected") {
        failed++;
        console.error(`${MODULE_ID} | Could not save ${DATA_FOLDER}/${path}`, result.reason);
      } else if (path in parts) this._written.set(path, text);
      else this._written.delete(path);
    });
    if (failed) {
      // Left as it was: the next save tries again.
      if (!this._saveWarned) ui.notifications.error("Agent: some changes could not be saved. They'll be retried.");
      this._saveWarned = true;
      return;
    }
    const text = JSON.stringify(index);
    if (this._written.get(indexFile) === text) return;
    await this._upload(indexFile, text);
    this._written.set(indexFile, text);
  },

  /** Write one file in the data folder (`path` relative to it). */
  async _upload(path, text) {
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? dataFolder() : `${dataFolder()}/${path.slice(0, slash)}`;
    const file = new File([text], path.slice(slash + 1), { type: "application/json" });
    const picker = FilePicker.implementation ?? FilePicker;
    const result = await picker.upload("data", dir, file, {}, { notify: false });
    if (!result?.path) throw new Error("upload failed");
  },

  /** The data folder and its subfolders, which uploads need (and players may not create folders). */
  async _ensureFolders() {
    const picker = FilePicker.implementation ?? FilePicker;
    const root = dataFolder();
    const make = path => picker.createDirectory("data", path).catch(err => console.error(`${MODULE_ID} | Could not create ${path}`, err));
    let dirs = (await picker.browse("data", root).catch(() => null))?.dirs;
    if (!dirs) {
      await make(root);
      dirs = [];
    }
    for (const sub of SUBFOLDERS) {
      if (!dirs.some(dir => decodeURIComponent(dir).replace(/\/$/, "").endsWith(`/${sub}`))) await make(`${root}/${sub}`);
    }
  },

  /**
   * Send everyone their share of the apps' data (see model/apps.js appsFor). `alerts`: ids of new
   * Agent alerts, which pop up for whoever they're for.
   */
  _pushApps(alerts = []) {
    for (const user of game.users) {
      if (!user.active || user === game.user) continue;
      const mine = appsFor(user, this.apps);
      this._send([user.id], { type: "apps", apps: mine, alerts: alerts.filter(id => mine.alerts[id]) });
    }
    this._applyApps(this.apps, alerts);
    this.save();
  },

  _pushGarden() {
    for (const user of game.users) {
      if (!user.active || user === game.user) continue;
      this._send([user.id], { type: "garden", garden: gardenFor(user, this.garden) });
    }
    this._changed({ garden: true });
    this.saveGarden();
  },

  /**
   * A card for the GMs (a pop-up with buttons): { id?, title, body, icon, img?, actions: [{ label, icon,
   * request, data }] }; each button sends that request to the host.
   */
  _gmCard(card) {
    this._send(game.users.filter(u => u.isGM && u.active && u !== game.user).map(u => u.id), { type: "gm-card", card });
    if (game.user.isGM) Hooks.callAll(`${MODULE_ID}.gmCard`, card);
  },

  /** Host: send a payload to the given users only. */
  _send(userIds, payload) {
    if (userIds.length) game.socket.emit(SOCKET, payload, { recipients: userIds });
  },

  _viewers(thread) {
    return game.users.filter(u => u.active && u !== game.user && canView(u, thread));
  },

  /** Send GMs the full data and players the redacted version. */
  _emitSplit(users, type, payload, redact) {
    const gms = users.filter(u => u.isGM).map(u => u.id);
    const players = users.filter(u => !u.isGM).map(u => u.id);
    this._send(gms, { type, ...payload(x => x) });
    this._send(players, { type, ...payload(redact) });
  },

  _push(thread, notify = false, reaction = null) {
    const viewers = this._viewers(thread);
    this._send(viewers.filter(u => u.isGM).map(u => u.id), { type: "thread", thread, notify, reaction });
    for (const user of viewers.filter(u => !u.isGM)) {
      const shown = this._forPlayer(thread, user);
      // No signal: nothing announces itself (not even a reaction to an older message). And a held
      // message must not make their phone announce the one before it.
      const actorId = memberActorId(user, thread);
      const fresh = !(actorId && noSignalSince(actorId)) && shown.messages.at(-1)?.id === thread.messages.at(-1)?.id;
      this._send([user.id], { type: "thread", thread: shown, notify: notify && fresh, reaction: fresh ? redactReaction(thread, reaction) : null });
    }
    this._apply(thread, notify, reaction);
  },

  /**
   * A thread as a player's phone has it: hidden caller IDs redacted, and, while their character has no
   * signal, nothing that arrived after it was lost (their own messages and everything before stay).
   */
  _forPlayer(thread, user) {
    const shown = redactThread(thread);
    const actorId = memberActorId(user, thread);
    const since = actorId ? noSignalSince(actorId) : null;
    if (!since) return shown;
    const own = isGroup(thread) ? pcKey(actorId) : "pc";
    return {
      ...shown,
      messages: shown.messages.filter(m => m.ts <= since || m.from === own),
      lastReaction: shown.lastReaction?.ts > since ? null : shown.lastReaction
    };
  },

  /** Push a thread whose audience may have shrunk (group member removed, thread deleted). */
  _pushWithRemovals(thread, previousViewers, deleted = false) {
    const now = deleted ? [] : this._viewers(thread).map(u => u.id);
    const gone = previousViewers.map(u => u.id).filter(id => !now.includes(id));
    this._send(gone, { type: "remove", threadId: thread.id });
    if (deleted) {
      this.threads.delete(thread.id);
      this._changed({ threadId: thread.id });
    } else {
      this._push(thread);
    }
    this.save();
  },

  syncUser(user) {
    if (!user?.active || user === game.user) return;
    const redactT = user.isGM ? t => t : t => this._forPlayer(t, user);
    const redactC = user.isGM ? c => c : redactCall;
    const calls = [...this.calls.values()].filter(c => this._callAudience(c, user)).map(redactC);
    const threads = this.visibleThreads(user).map(redactT);
    this._send([user.id], {
      type: "sync",
      threads,
      calls,
      requests: this.visibleRequests(user),
      quests: this.visibleQuests(user),
      apps: appsFor(user, this.apps),
      garden: gardenFor(user, this.garden)
    });
  },

  syncAll() {
    for (const user of game.users) this.syncUser(user);
  },

  /** Queue a request from `user` (who is who Foundry says sent it, never a field in the message). */
  _handle(msg, user) {
    if (!user || !msg || typeof msg !== "object") return;
    return this._enqueue(() => this._dispatch(user, msg));
  },

  _message(from, text, extra = {}) {
    return { id: foundry.utils.randomID(), from, text, ...agentTimestamp(), ts: Date.now(), ...extra };
  }
};

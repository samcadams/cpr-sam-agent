import { APP_MANIFEST } from "../apps/manifest.js";
import { dataFolder, MODULE_ID, SOCKET } from "../config.js";
import { noSignalSince } from "../model/features.js";
import { agentType } from "../model/agent.js";
import { appsFor, emptyApps } from "../model/apps.js";
import { emptyGarden, gardenFor } from "../../apps/garden/model.js";
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

/** GM cards kept for the notification center (older ones drop off). */
const MAX_GM_CARDS = 60;

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
    this._guardUnload();
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
      if (!actor || !agentType(actor)) continue;
      const held = this.threadsFor(actorId).reduce((n, t) => {
        const own = isGroup(t) ? pcKey(actorId) : "pc";
        // Counted like unread: texts, plus call logs and alerts.
        return n + t.messages.filter(m => m.ts > since && m.from !== own && (!m.system || m.call || m.alert)).length;
      }, 0);
      const text = held ? `Signal restored. ${held} new while you had no signal.` : "Signal restored. Back online.";
      alerts.push(this._alert(actorId, { kind: "system", text }));
    }
    // Losing signal is told too (alerts ignore signal, so it still arrives).
    for (const actorId of Object.keys(now)) {
      const actor = game.actors.get(actorId);
      if (this._signalSeen?.[actorId] || !actor || !agentType(actor)) continue;
      alerts.push(this._alert(actorId, { kind: "system", text: "No signal. Texts and calls will wait until you're back." }));
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
        this._traumaChanges(false); // what's loaded isn't a change
      }
      this.loadFailed = false;
    } catch (err) {
      // Never overwrite history we failed to read.
      this.loadFailed = true;
      console.error(`${MODULE_ID} | Could not read the message history`, err);
      ui.notifications.error("Agent: could not load message history. Saving is disabled until reload.");
    }
    // Each app's own step once the data is in (apps/manifest.js `load`).
    for (const [id, app] of Object.entries(APP_MANIFEST)) {
      if (!app.load || this.loadFailed) continue;
      try {
        await this[app.load]();
      } catch (err) {
        console.error(`${MODULE_ID} | ${id}: ${app.load} failed`, err);
      }
    }
    this.loaded = true;
    this._changed();
  },

  /** Save soon: a burst of changes is written once. */
  save() {
    this._markUnsaved("messages");
    (this._saveSoon ??= foundry.utils.debounce(() => this._writeMessages(), 500))();
  },

  _writeMessages() {
    return this._queueWrite(async () => {
      const mark = this._unsaved?.messages;
      if ((await this._write()) === false) this._retrySave("messages", () => this.save());
      else this._markSaved("messages", mark);
    });
  },

  /** False if some files couldn't be saved. */
  async _write() {
    if (!this.isHost || this.loadFailed) return;
    return this._writeSplit(MESSAGES_FILE, splitMessages(this), ["threads/", "apps/"]);
  },

  /**
   * Some files couldn't be saved (the connection dropped, or the server or a proxy in front of it
   * refused): try again on its own, sooner at first (5 s, doubling up to a minute), so the changes
   * don't wait for the next one. One retry waits at a time; another change saving first clears it.
   */
  _retrySave(key, again) {
    this._retries ??= {};
    this._retryTimers ??= {};
    if (this._retryTimers[key]) return;
    const delay = Math.min(60000, 5000 * 2 ** (this._retries[key] ?? 0));
    this._retries[key] = (this._retries[key] ?? 0) + 1;
    this._retryTimers[key] = setTimeout(() => {
      delete this._retryTimers[key];
      if (this.isHost) again();
    }, delay);
    this._retryTimers[key]?.unref?.();
  },

  /** A save went through: forget the retries, and say so if the GM was told it failed. */
  _saved(key) {
    if (!this._retries?.[key]) return;
    delete this._retries[key];
    if (Object.keys(this._retries).length || !this._saveWarned) return;
    this._saveWarned = false;
    ui.notifications.info("Agent: the changes that couldn't be saved are saved now.");
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
    this._markUnsaved("garden");
    (this._saveGardenSoon ??= foundry.utils.debounce(() => this._writeGarden(), 1000))();
  },

  _writeGarden() {
    return this._queueWrite(async () => {
      const mark = this._unsaved?.garden;
      if (this.gardenFailed) return this._markSaved("garden", mark); // saving is off: nothing to wait for
      if (!this.isHost) return;
      if ((await this._writeSplit(GARDEN_FILE, splitGarden(this.garden), ["garden/"])) === false) this._retrySave("garden", () => this.saveGarden());
      else this._markSaved("garden", mark);
    });
  },

  /*
   * Unsaved changes: each kind ("messages", "garden") is marked when a save is asked for and cleared
   * once a write that started after the latest change went through. A text that arrives just before
   * the GM reloads is still waiting for its batched save, so the browser asks "Leave site?" then.
   */
  _markUnsaved(key) {
    this._unsaved ??= {};
    this._unsaved[key] = (this._unsavedSeq = (this._unsavedSeq ?? 0) + 1);
  },

  /** A write that started when `mark` was the latest change went through. */
  _markSaved(key, mark) {
    if (this._unsaved?.[key] === mark) delete this._unsaved[key];
  },

  /** True while some change is still waiting to be written (batched, uploading, or retrying). */
  hasUnsavedChanges() {
    return !!this.isHost && Object.keys(this._unsaved ?? {}).length > 0;
  },

  /** Write what's waiting now instead of after the batch delay. */
  flushSaves() {
    if (this._unsaved?.messages) this._writeMessages();
    if (this._unsaved?.garden) this._writeGarden();
    return this._writing;
  },

  _guardUnload() {
    if (this._unloadGuard) return;
    this._unloadGuard = event => {
      if (!this.hasUnsavedChanges()) return;
      this.flushSaves(); // if the GM stays, the save is already on its way
      event.preventDefault();
      event.returnValue = ""; // older browsers need this to show the warning
    };
    window.addEventListener("beforeunload", this._unloadGuard);
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
   * everything it lists is on the server. False if anything couldn't be saved (left as it was, so the
   * next try uploads it again).
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
    const text = JSON.stringify(index);
    if (!failed && this._written.get(indexFile) !== text) {
      try {
        await this._upload(indexFile, text);
        this._written.set(indexFile, text);
      } catch (err) {
        failed++;
        console.error(`${MODULE_ID} | Could not save ${DATA_FOLDER}/${indexFile}`, err);
      }
    }
    const key = indexFile === GARDEN_FILE ? "garden" : "messages";
    if (!failed) {
      this._saved(key);
      return true;
    }
    if (!this._saveWarned) ui.notifications.error("Agent: some changes could not be saved. Trying again.");
    this._saveWarned = true;
    return false;
  },

  /** Write one file in the data folder (`path` relative to it). */
  async _upload(path, text) {
    const slash = path.lastIndexOf("/");
    const dir = slash < 0 ? dataFolder() : `${dataFolder()}/${path.slice(0, slash)}`;
    const file = new File([text], path.slice(slash + 1), { type: "application/json" });
    const picker = FilePicker.implementation ?? FilePicker;
    const result = await picker.upload("data", dir, file, {}, { notify: false });
    // Foundry's upload gives nothing back when the request itself failed (a dropped connection, or an
    // error page from the server or a proxy), and logs why when the server said no.
    if (!result?.path) throw new Error("upload failed: no answer from the server (see any Foundry error above)");
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
    // Agent alerts the Garden held for this push (replies to a character's post, Reputation: apps/garden/host.js).
    const alerts = (this._gardenAlerts ?? []).filter(Boolean);
    this._gardenAlerts = [];
    if (alerts.length) this._pushApps(alerts);
  },

  /**
   * A card for the GMs (a pop-up with buttons): { id?, title, body, icon, img?, actions: [{ label, icon,
   * request, data }] }; each button sends that request to the host.
   */
  _gmCard(card) {
    // Kept for the GM Phone's notification center (a card with the same id replaces the last one).
    card = { ...card, id: card.id ?? foundry.utils.randomID(), ts: Date.now() };
    this.apps.gmCards[card.id] = card;
    const cards = Object.values(this.apps.gmCards).sort((a, b) => a.ts - b.ts);
    for (const old of cards.slice(0, Math.max(0, cards.length - MAX_GM_CARDS))) delete this.apps.gmCards[old.id];
    this.save();
    this._changed({ apps: true });
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
  },

  /**
   * One sent text as its messages (`parts` from validate.js textParts: a long text is several
   * bubbles), a millisecond apart so they keep their order. The photo, location and job come with
   * the last one; the other fields of `extra` with each.
   */
  _textMessages(from, parts, { location, image, job, ...extra } = {}) {
    const now = Date.now();
    return parts.map((text, i) => this._message(from, text, {
      ...extra, ts: now + i, ...(i === parts.length - 1 ? { location, image, job } : {})
    }));
  }
};

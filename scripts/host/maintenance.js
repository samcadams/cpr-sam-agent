import { cleanImage, gm, MAX_NAME } from "./validate.js";
import { MODULE_ID } from "../config.js";
import { CLEARABLE } from "../model/clearing.js";
import { setPhoneSettings } from "../model/agent.js";
import { getContacts, setContacts } from "../model/contacts.js";
import { displayName, isDirect, isGroup, npcKey, pcKey } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: GM housekeeping (deleting conversations, NPC pictures, wiping history).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "clear-actor": gm("_onClearActor"),
  delete: gm("_onDelete"),
  "npc-image": gm("_onNpcImage"),
  scrub: gm("_onScrub"),
  "app-clear": gm("_onAppClear")
};

export const methods = {
  /**
   * GM: clear one kind of app data (model/clearing.js CLEARABLE), everyone's, or one character's
   * (`actorId`) where that makes sense.
   */
  async _onAppClear(user, { target, actorId = null }) {
    const kind = CLEARABLE[target];
    if (!kind || (actorId && !kind.perCharacter)) return;
    const mine = x => !actorId || x?.actorId === actorId;
    const dropWhere = (table, keep = () => false) => {
      for (const [id, x] of Object.entries(table)) if (mine(x) && !keep(x)) delete table[id];
    };
    const g = this.garden;
    const dropPosts = accountIds => {
      for (const [id, p] of Object.entries(g.posts)) if (accountIds.has(p.accountId)) delete g.posts[id];
      g.queue = g.queue.filter(q => !accountIds.has(q.accountId));
    };
    switch (target) {
      case "messages":
        return actorId ? this._onClearActor(user, { actorId }) : this._onScrub(user);
      case "contacts":
        for (const actor of game.actors) {
          if (!mine({ actorId: actor.id }) || !["contacts", "notes", "aliases"].some(f => actor.getFlag(MODULE_ID, f)?.length)) continue;
          await setContacts(actor, []);
          await actor.setFlag(MODULE_ID, "notes", []);
          await actor.setFlag(MODULE_ID, "aliases", []);
        }
        return this._changed();
      case "alerts":
      case "ledger":
      case "dispatches":
      case "queries":
        dropWhere(this.apps[target]);
        return this._pushApps();
      case "subs":
        for (const id of Object.keys(this.apps.subs)) if (!actorId || id === actorId) delete this.apps.subs[id];
        return this._pushApps();
      case "watch":
        for (const id of Object.keys(this.apps.watch)) if (!actorId || id === actorId) this._endWatch(id);
        return this._pushApps();
      case "gardenPatch": {
        const pcs = Object.values(g.accounts).filter(a => a.actorId && mine(a));
        dropPosts(new Set(pcs.map(a => a.id)));
        for (const a of pcs) delete g.accounts[a.id];
        return this._pushGarden();
      }
      case "gardenPosts": {
        const ids = actorId ? new Set(Object.values(g.accounts).filter(a => a.actorId === actorId).map(a => a.id)) : null;
        for (const [id, p] of Object.entries(g.posts)) if (!ids || ids.has(p.accountId)) delete g.posts[id];
        return this._pushGarden();
      }
      case "gardenDating":
        dropWhere(g.dating.sparks);
        dropWhere(g.dating.profiles, p => !p.actorId); // NPC profiles stay
        return this._pushGarden();
      case "gardenQueue":
        g.queue = [];
        return this._pushGarden();
      case "gardenCitizens": {
        const citizens = Object.values(g.accounts).filter(a => a.kind === "citizen");
        dropPosts(new Set(citizens.map(a => a.id)));
        for (const a of citizens) delete g.accounts[a.id];
        return this._pushGarden();
      }
      case "jobsFinished":
        for (const [id, q] of this.quests) if (q.status === "completed" || q.status === "failed") this.quests.delete(id);
        this.save();
        return this._pushQuests();
    }
  },

  _onDelete(user, { threadId }) {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    this._pushWithRemovals(thread, this._viewers(thread), true);
  },

  /** GM: set the picture for a contact with no sheet, everywhere that name appears. */
  async _onNpcImage(user, { name, img }) {
    name = clean(name, MAX_NAME);
    img = cleanImage(img, user);
    if (!name || !img) return;
    const lower = name.toLowerCase();

    for (const actor of game.actors) {
      const contacts = getContacts(actor);
      let changed = false;
      for (const c of contacts) {
        if (!c.actorId && c.name.toLowerCase() === lower) {
          c.img = img;
          changed = true;
        }
      }
      if (changed) await setContacts(actor, contacts);
    }
    for (const thread of this.threads.values()) {
      if (isDirect(thread) && !thread.contactActorId && thread.contact.toLowerCase() === lower) {
        thread.contactImg = img;
        this._push(thread);
      } else if (isGroup(thread)) {
        const member = thread.members.find(m => m.key === npcKey(name));
        if (member) {
          member.img = img;
          this._push(thread);
        }
      }
    }
    this.save();
  },

  /**
   * GM: wipe one character's phone: their conversations (the other side of a PC-to-PC chat keeps its
   * copy), their place in groups and their number requests; optionally their contacts and notes too.
   */
  async _onClearActor(user, { actorId, contacts = false }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const key = pcKey(actorId);
    for (const thread of [...this.threads.values()]) {
      if (isGroup(thread)) {
        const member = thread.members.find(m => m.key === key);
        if (!member) continue;
        const previous = this._viewers(thread);
        thread.members = thread.members.filter(m => m.key !== key);
        thread.messages.push(this._message("system", `${member.name} left the group`, { system: true }));
        this._pushWithRemovals(thread, previous, thread.members.length === 0);
      } else if (thread.actorId === actorId) {
        this._pushWithRemovals(thread, this._viewers(thread), true);
      }
    }
    const before = this.requests.size;
    for (const [id, request] of this.requests) if (request.actorId === actorId) this.requests.delete(id);
    if (this.requests.size !== before) this._pushRequests();
    await setPhoneSettings(actor, { pinned: [], cleared: [] });
    if (contacts) {
      await setContacts(actor, []);
      await actor.setFlag(MODULE_ID, "notes", []);
    }
    this.save();
    ui.notifications.info(`Agent: ${displayName(actor)}'s phone wiped.`);
  },

  /** GM: wipe every conversation, group, service log and contact request. */
  _onScrub(user) {
    this.threads.clear();
    this.requests.clear();
    this.save();
    this.syncAll();
    this._changed();
    ui.notifications.info("Agent: all message history scrubbed.");
  }
};

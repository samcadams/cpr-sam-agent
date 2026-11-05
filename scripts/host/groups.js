import { cleanImage, cleanLocation, MAX_NAME, textParts } from "./validate.js";
import { canUsePhone } from "../model/agent.js";
import { findContact, getContacts } from "../model/contacts.js";
import { canActFor } from "../model/permissions.js";
import {
  contactMember, displayName, isGroup, knownNpcs, npcKey, npcMember, pcKey, pcMember
} from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: group chats.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "group-create": "_onGroupCreate",
  "group-send": "_onGroupSend",
  "group-rename": "_onGroupRename",
  "group-add": "_onGroupAdd",
  "group-remove": "_onGroupRemove"
};

export const methods = {
  /**
   * Resolve picked people into members. Players pick from the acting PC's (unblocked) contacts;
   * GMs can also pick any PC and type any NPC name.
   */
  _buildMembers(user, actor, { contacts = [], pcs = [], npcs = [] }, excludeKeys = []) {
    const out = new Map();
    const list = actor ? getContacts(actor) : [];
    for (const name of contacts) {
      const entry = findContact(list, String(name));
      if (!entry || (entry.blocked && !user.isGM)) continue;
      const member = contactMember(entry);
      out.set(member.key, member);
    }
    if (user.isGM) {
      const npcImages = new Map(knownNpcs().map(m => [m.key, m.img]));
      for (const id of pcs) {
        const pc = game.actors.get(id);
        if (pc) out.set(pcKey(pc.id), pcMember(pc));
      }
      for (const raw of npcs) {
        const name = clean(raw, MAX_NAME);
        if (name) out.set(npcKey(name), npcMember(name, npcImages.get(npcKey(name))));
      }
    }
    for (const key of excludeKeys) out.delete(key);
    return [...out.values()];
  },

  /** Who is acting on a group: a player's own PC member (with an Agent), or the GM. */
  _groupActor(user, group, actorId) {
    if (user.isGM) return { name: null };
    const member = group.members.find(m => m.actorId === actorId && canActFor(user, m));
    if (!member || !canUsePhone(game.actors.get(member.actorId))) return null;
    return { name: member.name, member };
  },

  _systemText(actorName, text) {
    return actorName ? `${actorName} ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
  },

  _onGroupCreate(user, msg) {
    const actor = msg.actorId ? game.actors.get(msg.actorId) : null;
    if (!user.isGM && (!actor?.testUserPermission(user, "OWNER") || !canUsePhone(actor))) return;

    const members = this._buildMembers(user, actor, msg);
    if (!user.isGM) members.unshift(pcMember(actor));
    const unique = [...new Map(members.map(m => [m.key, m])).values()];
    if (unique.length < 2) return;

    const actorName = user.isGM ? null : displayName(actor);
    const group = {
      id: foundry.utils.randomID(),
      type: "group",
      name: clean(msg.name, MAX_NAME) || unique.map(m => m.name).join(", ").slice(0, MAX_NAME),
      createdBy: user.id,
      members: unique,
      messages: [],
      lastRead: { gm: 0 }
    };
    group.messages.push(this._message("system", this._systemText(actorName, "created the group"), { system: true }));
    this.threads.set(group.id, group);
    this.save();
    this._push(group, true);
  },

  _onGroupSend(user, { groupId, as, text, location, image, job }) {
    const group = this.threads.get(groupId);
    const parts = textParts(text);
    location = cleanLocation(location);
    image = cleanImage(image, user);
    job = this._jobOffer(user, job);
    if (!isGroup(group) || (!parts[0] && !location && !image && !job)) return;
    const member = group.members.find(m => m.key === as);
    if (!member || !canActFor(user, member)) return;
    if (member.actorId && !canUsePhone(game.actors.get(member.actorId))) return;
    const messages = this._textMessages(member.key, parts, { userId: user.id, name: member.name, location, image, job });
    group.messages.push(...messages);
    group.lastRead[user.isGM ? "gm" : member.key] = messages.at(-1).ts;
    this.save();
    this._push(group, true);
    for (const m of group.members) if (m.key !== member.key) this._ding(m);
  },

  _onGroupRename(user, { groupId, actorId, name }) {
    const group = this.threads.get(groupId);
    name = clean(name, MAX_NAME);
    if (!isGroup(group) || !name || name === group.name) return;
    const acting = this._groupActor(user, group, actorId);
    if (!acting) return;
    group.name = name;
    group.messages.push(this._message("system", this._systemText(acting.name, `renamed the group to "${name}"`), { system: true }));
    this.save();
    this._push(group);
  },

  _onGroupAdd(user, msg) {
    const group = this.threads.get(msg.groupId);
    if (!isGroup(group)) return;
    const acting = this._groupActor(user, group, msg.actorId);
    if (!acting) return;
    const actor = msg.actorId ? game.actors.get(msg.actorId) : null;
    const added = this._buildMembers(user, actor, msg, group.members.map(m => m.key));
    if (!added.length) return;
    group.members.push(...added);
    const names = added.map(m => m.name).join(", ");
    group.messages.push(this._message("system", this._systemText(acting.name, `added ${names}`), { system: true }));
    this.save();
    this._push(group, true);
  },

  _onGroupRemove(user, { groupId, actorId, key }) {
    const group = this.threads.get(groupId);
    if (!isGroup(group)) return;
    const acting = this._groupActor(user, group, actorId);
    const target = group.members.find(m => m.key === key);
    if (!acting || !target) return;

    const previous = this._viewers(group);
    group.members = group.members.filter(m => m.key !== key);
    const text = acting.member?.key === key
      ? `${target.name} left the group`
      : this._systemText(acting.name, `removed ${target.name}`);
    group.messages.push(this._message("system", text, { system: true }));
    this._pushWithRemovals(group, previous, group.members.length === 0);
    // A character removed by someone else hears it (the thread just goes from their phone).
    if (target.actorId && acting.member?.key !== key && game.actors.get(target.actorId)) {
      this._alertNow(target.actorId, { kind: "event", text: `You were removed from ${group.name}.` });
    }
  }
};

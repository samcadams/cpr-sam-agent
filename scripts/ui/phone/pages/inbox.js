import { dropdown } from "./dropdown.js";
import { latest } from "../messages.js";
import { newThreadDialog } from "../../dialogs/forms.js";
import { isPlayerCharacter } from "../../../model/agent.js";
import { appearance } from "../../../model/appearance.js";
import { findContact, getContacts, playerCharacters, setContacts, shownName } from "../../../model/contacts.js";
import { noSignalSince } from "../../../model/features.js";
import { memberActorId } from "../../../model/permissions.js";
import { getService } from "../../../model/services.js";
import {
  actorAvatar, conversationKey, displayName, isGroup, isService, knownNpcs, personaColor, pictureOf, previewText, threadKey
} from "../../../model/threads.js";
import { store } from "../../../store.js";
import { esc, initials } from "../../../util/text.js";

/*
 * Phone page: the inbox (conversation list, search, pins, starting conversations).
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** The view an inbox row (its data- attributes) opens. */
export function viewFromRow(d) {
  if (d.kind === "group") return { kind: "group", groupId: d.groupId };
  if (d.kind === "service") return { kind: "service", actorId: d.actorId, serviceId: d.serviceId };
  return { kind: "direct", threadId: d.threadId || null, actorId: d.actorId, contact: d.contact, hidden: d.hidden === "true" };
}

export const actions = {
  "open-thread"(d) {
    this.view = viewFromRow(d);
    this.notesOpen = false;
    this.render();
  },
  pin({ pinKey }, event) {
    event.stopPropagation();
    const pinned = new Set(this.context()?.settings.pinned ?? []);
    if (pinned.has(pinKey)) pinned.delete(pinKey);
    else pinned.add(pinKey);
    this._saveSettings({ pinned: [...pinned] });
  },
  "clear-thread"({ pinKey }, event) {
    event.stopPropagation();
    this._clearThread(pinKey);
  },
  "new-thread"() {
    this._newThread();
  },
  "new-group"() {
    this._newGroup();
  },
  /** GM: switch the phone to the token selected on the canvas. */
  "token-apply"() {
    const prompt = this.tokenPrompt();
    if (!prompt) return;
    if (prompt.kind === "pc") this.inbox = prompt.actorId;
    else this.persona = { name: prompt.name, actorId: prompt.actorId };
    this.view = null;
    this.render();
  },
  /** GM: a SIM tile, acting as that NPC (or everyone, from the "All" tile or the current one). */
  "sim-pick"({ name }) {
    DROPDOWN_HANDLERS.persona.call(this, name && name.toLowerCase() !== this.persona?.name.toLowerCase() ? name : "");
  },
  "token-dismiss"() {
    this.dismissedToken = canvas.tokens?.controlled[0]?.id ?? null;
    this.render();
  }
};

export const inputs = {
  "input[name=search]": {
    input(event) {
      this.search = event.currentTarget.value;
      this._searchFocus = true;
      this.render();
    }
  }
};

/** GM Phone: the two pickers above the inbox and the contacts. */
export const dropdowns = {
  inbox(value) {
    this.inbox = value;
    this.view = null;
    this.render();
  },
  persona(value) {
    const actor = game.actors.find(a => !isPlayerCharacter(a) && displayName(a).toLowerCase() === value.toLowerCase());
    this.persona = value ? { name: value, actorId: actor?.id ?? null } : null;
    this.view = null;
    this.render();
  }
};

const DROPDOWN_HANDLERS = dropdowns;

const MAX_SIMS = 8;

export const methods = {
  /**
   * GM Phone's SIM tiles: the NPCs in use (those with conversations), busiest first, each with its
   * colour and unread count, as a quicker way to switch who the GM acts as.
   */
  simTiles() {
    const current = this.persona?.name.toLowerCase() ?? "";
    const tiles = this.personas().map(name => {
      const threads = store.threadsForNpc(name).filter(t => t.messages.length);
      return {
        name,
        initials: initials(name),
        color: personaColor(name),
        unread: store.totalUnread(threads),
        ts: Math.max(0, ...threads.map(t => t.messages.at(-1).ts)),
        active: name.toLowerCase() === current
      };
    }).filter(t => t.ts || t.active);
    tiles.sort((a, b) => b.active - a.active || b.unread - a.unread || b.ts - a.ts);
    return { all: !this.persona, tiles: tiles.slice(0, MAX_SIMS) };
  },

  directRow(ctx, thread, actor, contact, showOwner = false) {
    const last = thread?.messages.at(-1);
    const entry = thread?.hideId ? null : findContact(getContacts(actor), contact);
    // GM acting as one NPC: its conversations are named after the other side, the PC.
    const pcSide = ctx.perspective === "gm" && !!this.persona;
    // A player sees their own name for the contact, if they gave it one.
    const name = pcSide ? displayName(actor) : ctx.perspective === "pc" ? shownName(actor, contact, thread?.hideId ? thread.id : null) : contact;
    return {
      kind: "direct",
      threadId: thread?.id ?? "",
      actorId: actor.id,
      contact,
      hidden: !!thread?.hideId,
      name,
      owner: showOwner ? displayName(actor) : null,
      img: pcSide ? actorAvatar(actor) : pictureOf(entry?.img ?? thread?.contactImg, thread?.hideId ? null : entry?.actorId ?? thread?.contactActorId),
      initials: initials(name),
      // GM: the NPC's colour down the row's edge, and a tag on conversations with the caller ID hidden.
      color: ctx.perspective === "gm" && !pcSide ? personaColor(contact) : null,
      hiddenBadge: this.isGM && thread?.hideId,
      blocked: this.isGM && entry?.blocked,
      ...latest(thread, last ? `${!last.system && this.mineDirect(ctx, last) ? "You: " : ""}${previewText(last)}` : "No messages yet"),
      time: last?.time ?? "",
      unread: store.unread(thread)
    };
  },

  groupRow(ctx, group) {
    const last = group.messages.at(-1);
    let prefix = "";
    if (last && !last.system) prefix = this.mineGroup(ctx, last) && ctx.perspective !== "gm" ? "You: " : `${last.name}: `;
    return {
      kind: "group",
      groupId: group.id,
      name: group.name,
      isGroup: true,
      owner: this.isGM ? `${group.members.length} members` : null,
      ...latest(group, last ? `${prefix}${previewText(last)}` : "No messages yet"),
      time: last?.time ?? "",
      unread: store.unread(group, game.user, ctx.actorId ?? memberActorId(game.user, group))
    };
  },

  serviceRow(ctx, service, thread, actor, showOwner = false) {
    const last = thread?.messages.at(-1);
    return {
      kind: "service",
      serviceId: service?.id ?? thread.serviceId,
      actorId: actor.id,
      name: service?.name ?? thread.name,
      img: service?.img ?? thread?.img,
      initials: initials(service?.name ?? thread.name),
      isService: true,
      owner: showOwner ? displayName(actor) : null,
      ...latest(thread, last ? (last.action ? `▶ ${last.text}` : previewText(last)) : "Tap for options"),
      time: last?.time ?? "",
      unread: store.unread(thread)
    };
  },

  /** Search: match the row's name, or any message (and show that message as the preview). */
  matchSearch(row, query) {
    const hit = (row.thread?.messages ?? []).findLast(m => previewText(m).toLowerCase().includes(query));
    if (hit) {
      row.preview = previewText(hit);
      row.time = hit.time;
      return true;
    }
    return row.name.toLowerCase().includes(query) || (row.owner ?? "").toLowerCase().includes(query);
  },

  inboxRows(ctx) {
    const pinned = new Set(ctx.settings.pinned);
    const query = this.search.trim().toLowerCase();
    const sort = rows => {
      for (const row of rows) {
        row.pinKey = conversationKey(row);
        row.pinned = pinned.has(row.pinKey);
      }
      if (query) rows = rows.filter(row => this.matchSearch(row, query));
      return rows.sort((a, b) => b.pinned - a.pinned || b.ts - a.ts || a.name.localeCompare(b.name));
    };
    const row = (t, showOwner) => {
      t = this.cleared(ctx, t);
      if (!t.messages.length && ctx.perspective === "pc") return null; // deleted until something new arrives
      const actor = game.actors.get(t.actorId);
      if (isGroup(t)) return this.groupRow(ctx, t);
      if (!actor) return null;
      if (isService(t)) return this.serviceRow(ctx, getService(t.serviceId), t, actor, showOwner);
      return this.directRow(ctx, t, actor, t.contact, showOwner);
    };

    // GM Phone: every conversation, narrowed to one PC's phone and/or one NPC.
    if (ctx.perspective === "gm") {
      let threads = store.visibleThreads().filter(t => t.messages.length);
      if (this.inbox !== "all") threads = this._only(threads, store.threadsFor(this.inbox));
      if (this.persona) threads = this._only(threads, store.threadsForNpc(this.persona.name));
      const showOwner = this.inbox === "all" && !this.persona;
      return sort(threads.map(t => Object.assign(row(t, showOwner) ?? {}, { thread: t })).filter(r => r.kind));
    }

    // A player's phone: only conversations that exist. New ones start from the Contacts app.
    const actor = game.actors.get(ctx.actorId);
    if (!actor) return [];
    const rows = [];
    for (const t of store.threadsFor(actor.id)) {
      if (!t.messages.length) continue;
      const r = row(t);
      if (r) rows.push(Object.assign(r, { thread: this.cleared(ctx, t) }));
    }
    return sort(rows);
  },

  _only(threads, allowed) {
    const ids = new Set(allowed.map(t => t.id));
    return threads.filter(t => ids.has(t.id));
  },

  /**
   * GM Phone: the "whose phone" and "as" pickers. Falls back to all phones when the chosen PC is
   * gone; call it before reading this.inbox.
   */
  gmPickers() {
    const pcs = playerCharacters();
    if (!pcs.some(a => a.id === this.inbox)) this.inbox = "all";
    const whose = [
      { value: "all", label: "All phones" },
      ...pcs.map(a => ({
        value: a.id,
        label: `${displayName(a)}${noSignalSince(a.id) ? " (no signal)" : ""}`,
        count: store.totalUnread(store.threadsFor(a.id))
      }))
    ];
    const as = [{ value: "", label: "Anyone" }, ...this.personas().map(name => ({
      value: name,
      label: name,
      color: personaColor(name),
      count: store.totalUnread(store.threadsForNpc(name))
    }))];
    const current = this.persona?.name.toLowerCase() ?? "";
    return {
      whose: dropdown("inbox", whose.map(o => ({ ...o, selected: o.value === this.inbox })), { title: "Whose phone", cls: "agent-picker" }),
      as: dropdown("persona", as.map(o => ({ ...o, selected: o.value.toLowerCase() === current })), { title: "Who you're acting as", cls: "agent-picker" })
    };
  },

  /** GM: every NPC it has spoken as or could speak as (plus the one it's acting as now). */
  personas() {
    const names = new Map();
    for (const name of [...store.npcNames(), ...knownNpcs().map(n => n.name), this.persona?.name]) {
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  },

  /**
   * GM: the token selected on the canvas, when it isn't what the phone is already on. A PC offers
   * their phone; anyone else offers acting as them (by the token's name). Null if there's nothing to
   * offer or the GM dismissed it.
   */
  tokenPrompt() {
    const token = canvas.tokens?.controlled[0];
    const actor = token?.actor;
    if (!actor || actor.type === "container" || token.id === this.dismissedToken) return null;
    const img = actorAvatar(actor);
    if (isPlayerCharacter(actor)) {
      if (this.inbox === actor.id) return null;
      const name = displayName(actor);
      return { kind: "pc", actorId: actor.id, name, img, initials: initials(name), label: `Open ${name}'s phone` };
    }
    const name = token.document.name || displayName(actor);
    if (this.persona?.name.toLowerCase() === name.toLowerCase()) return null;
    return { kind: "npc", actorId: actor.id, name, img, initials: initials(name), color: personaColor(name), label: `Act as ${name}` };
  },

  inboxData(ctx) {
    const pickers = ctx.perspective === "gm" ? this.gmPickers() : null;
    const data = {
      rows: this.inboxRows(ctx),
      canPin: true,
      canClear: ctx.perspective === "pc",
      search: this.search
    };
    data.emptyText = this.search ? "No matches." : "No conversations yet.";
    if (ctx.perspective === "gm") {
      data.pickers = pickers;
      data.sims = ctx.settings.simTiles ? this.simTiles() : null;
      data.gmConsole = true;
      data.inboxName = appearance().names.messages;
      data.canCompose = this.online && (this.inbox !== "all" || !!this.persona);
      data.canGroup = this.online;
    } else {
      data.inboxName = ctx.subject.name;
      data.canNewText = true;
      data.canGroup = this.online;
    }
    return data;
  },

  /**
   * Player: "delete" a conversation from this phone. It comes back when a new message arrives.
   * `done` runs once it's deleted.
   */
  _clearThread(key, done) {
    const ctx = this.context();
    if (ctx?.perspective !== "pc") return;
    const thread = store.threadsFor(ctx.actorId).find(t => threadKey(t) === key);
    if (!thread) return;
    const name = isGroup(thread) || isService(thread) ? thread.name : thread.contact;
    Dialog.confirm({
      title: "Delete conversation",
      content: `<p>Delete your conversation with <strong>${esc(name)}</strong> from this phone?</p>`,
      yes: () => {
        const ts = Math.max(thread.messages.at(-1)?.ts ?? 0, thread.lastReaction?.ts ?? 0, 1);
        store.markRead(thread, ctx.actorId);
        const cleared = (ctx.settings.cleared ?? []).filter(c => c.key !== key);
        this._saveSettings({ cleared: [...cleared, { key, ts }] });
        done?.();
      }
    });
  },

  /**
   * GM: start a conversation, following the pickers. Acting as an NPC on one PC's phone opens it
   * straight away; acting as an NPC on all phones asks which PC; one PC's phone asks who to text as.
   * The dialogs can hide the caller ID.
   */
  async _newThread() {
    const pc = game.actors.get(this.inbox);
    const persona = this.persona ? { name: this.persona.name, actor: game.actors.get(this.persona.actorId) ?? null } : null;
    if (persona && pc) return this._openAs(pc, persona);
    if (persona) {
      const result = await newThreadDialog({
        title: `Text as ${persona.name}`,
        characters: playerCharacters().map(a => ({ id: a.id, name: displayName(a) }))
      });
      const to = game.actors.get(result?.actorId);
      if (to) this._openAs(to, persona, result.hidden);
      return;
    }
    if (!pc) return;
    // Contacts they already talk to first, then the rest; then every other sheet.
    const talking = new Set(store.threadsFor(pc.id).filter(t => t.messages.length && t.contact).map(t => t.contact.toLowerCase()));
    const contacts = getContacts(pc)
      .map(c => ({ name: c.name, actorId: c.actorId, active: talking.has(c.name.toLowerCase()) }))
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
    const linked = new Set(contacts.map(c => c.actorId).filter(Boolean));
    const actors = game.actors
      .filter(a => a !== pc && a.type !== "container" && !linked.has(a.id))
      .map(a => ({ id: a.id, name: displayName(a) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const result = await newThreadDialog({ title: `Text ${displayName(pc)}`, owner: displayName(pc), contacts, actors });
    if (!result) return;
    if (result.name) return this._openAs(pc, { name: result.name }, result.hidden);
    const [kind, value] = [result.pick?.slice(0, 1), result.pick?.slice(2)];
    if (kind === "a") return this._openAs(pc, { actor: game.actors.get(value) }, result.hidden);
    if (kind === "c") return this._openAs(pc, { name: value }, result.hidden);
  },

  /**
   * GM Phone: open the conversation texting `pc` as someone: a sheet (`actor`) and/or a name (the
   * sheet's name if there's none). A sheet that isn't one of their contacts yet is added as a linked
   * contact (unless the caller ID is hidden: that would give it away). An existing conversation with
   * them is reused.
   */
  async _openAs(pc, { actor = null, name = null }, hidden = false) {
    if (!pc || (!actor && !name)) return;
    const label = name ?? displayName(actor);
    const contacts = getContacts(pc);
    let entry = (actor && contacts.find(c => c.actorId === actor.id)) || findContact(contacts, label);
    if (!entry && actor && !hidden) {
      entry = { name: label, img: actorAvatar(actor), actorId: actor.id };
      await setContacts(pc, [...contacts, entry]);
    }
    if (this.inbox !== "all") this.inbox = pc.id;
    this.app = "messages";
    this.view = { kind: "direct", actorId: pc.id, contact: entry?.name ?? label, hidden };
    this.render();
  },

  /**
   * An actor dropped on the GM Phone. A PC switches to their phone; anyone else opens the
   * conversation texting the chosen PC as them, or (on all phones) becomes who the GM acts as.
   */
  _dropActor(actor) {
    const ctx = this.context();
    if (ctx?.perspective !== "gm" || !actor || actor.type === "container") return;
    const pc = game.actors.get(this.inbox);
    if (playerCharacters().includes(actor)) {
      if (actor === pc) return;
      this.inbox = actor.id;
    } else if (pc) return this._openAs(pc, { actor });
    else this.persona = { name: displayName(actor), actorId: actor.id };
    this.app = "messages";
    this.view = null;
    this.render();
  }
};

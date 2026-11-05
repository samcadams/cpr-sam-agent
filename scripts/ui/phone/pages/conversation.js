import { dropdown } from "./dropdown.js";
import { cbkInviteCard, datedMessages, jobCard, pkgCard, reactionChips } from "../messages.js";
import { pickMembers } from "../../dialogs/pickMembers.js";
import { MODULE_ID } from "../../../config.js";
import { feature } from "../../../model/features.js";
import { MAX_SHARE, shareFits } from "../../../model/share.js";
import { findContact, getAlias, getContacts, getNote, noteKey, setContactOptions, setNote } from "../../../model/contacts.js";
import { moneyCard } from "../../../model/money.js";
import { callLines, getService } from "../../../model/services.js";
import { actorAvatar, displayName, isGroup, pcKey, personaColor, pictureOf } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { esc, initials } from "../../../util/text.js";

/*
 * Phone page: an open conversation (direct, group, group info or service). A direct conversation's
 * notes and GM tools are on its contact card (pages/card.js).
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

export const actions = {
  /**
   * Back to where this page was opened from: a view carries `back` (the view before it, or
   * { app } for another app's home screen), else it goes to the inbox.
   */
  back() {
    const back = this.view?.back;
    if (this.view?.kind === "group-info") this.view = { ...this.view, kind: "group" };
    else if (back?.app) {
      this.app = back.app;
      this.view = null;
    } else this.view = back ?? null;
    this.notesOpen = false;
    this.render();
  },
  "group-info"() {
    this.view = { ...this.view, kind: "group-info" };
    this.render();
  },
  /** Player: a group member's contact card (as they are on this character's phone). */
  "member-card"({ name }) {
    const ctx = this.context();
    if (ctx?.perspective === "pc" && name) this._openCard({ actorId: ctx.actorId, contact: name });
  },
  "toggle-notes"() {
    this.notesOpen = !this.notesOpen;
    this.render();
  },
  "set-viewed"() {
    const thread = this.resolveDirect();
    if (thread) store.request("viewed", { threadId: thread.id });
  },
  reveal() {
    const thread = this.resolveDirect();
    if (!thread) return;
    store.request("reveal", { threadId: thread.id });
    this.view = { ...this.view, threadId: null, hidden: false };
  },
  "toggle-block"() {
    this._toggleContact("blocked");
  },
  "toggle-calls"() {
    this._toggleContact("noCall");
  },
  "delete-thread"() {
    this._deleteThread();
  },
  "set-contact-img"() {
    this._setContactImage();
  },
  "group-add"() {
    this._groupAdd();
  },
  "group-remove"({ key }, event) {
    event?.stopPropagation(); // not the member's card underneath
    const ctx = this.context();
    store.request("group-remove", { groupId: this.view.groupId, actorId: ctx?.actorId ?? null, key });
    if (ctx?.actorId && key === pcKey(ctx.actorId)) this.view = null;
  },
  "group-rename"() {
    const name = this.element.find("input[name=groupName]").val()?.trim();
    if (name) store.request("group-rename", { groupId: this.view.groupId, actorId: this.context()?.actorId ?? null, name });
  },
  "group-delete"() {
    this._deleteGroup();
  },
  /** "Share to chat": pick an unbroken run of texts, then post it (model/share.js). */
  "share-start"() {
    this.share = { key: this.draftKey, from: null, to: null };
    this.render();
  },
  "share-cancel"() {
    this.share = null;
    this.render();
  },
  "share-pick"({ messageId }) {
    this._sharePick(messageId);
  },
  "share-post"() {
    this._sharePost();
  },
  "service-action"({ actionId }) {
    store.request("service-action", { actorId: this.view.actorId, serviceId: this.view.serviceId, actionId });
  }
};

export const inputs = {
  "textarea[name=notes]": {
    change(event) {
      this._saveNote(event.currentTarget.value);
    }
  }
};

export const dropdowns = {
  /** GM: who it speaks as in the open group (saved per group on the user), or add an NPC to it. */
  speakAs(value) {
    const groupId = this.view?.groupId;
    if (!groupId) return;
    if (value === "+add") return this._groupAdd();
    game.user.setFlag(MODULE_ID, "speakAs", { ...(game.user.getFlag(MODULE_ID, "speakAs") ?? {}), [groupId]: value });
    this.render();
  }
};

export const methods = {
  /** The open conversation's thread and the messages this phone shows, while picking texts to share. */
  _shareSource() {
    const ctx = this.context();
    const v = this.view;
    if (!ctx || !this.share || this.share.key !== this.draftKey) return null;
    const thread = v?.kind === "direct" ? this.resolveDirect() : v?.kind === "group" ? store.threads.get(v.groupId) : null;
    if (!thread) return null;
    return { ctx, thread, messages: this.cleared(ctx, thread).messages };
  },

  /** Is this phone picking texts to share in the open conversation? Returns the picked ids, by message. */
  _sharePicked(messages) {
    if (!this.share || this.share.key !== this.draftKey) return null;
    const { from, to } = this.share;
    const start = messages.findIndex(m => m.id === from);
    const end = messages.findIndex(m => m.id === to);
    const picked = new Set(start >= 0 && end >= start ? messages.slice(start, end + 1).map(m => m.id) : []);
    return { picked, count: messages.filter(m => picked.has(m.id) && !m.system).length };
  },

  /**
   * Tap a text: the first one starts the run; one outside it stretches the run to it; one inside it
   * shortens the run to end there. Tapping either end drops it (the only one clears the run).
   */
  _sharePick(id) {
    const src = this._shareSource();
    if (!src) return;
    const list = src.messages;
    const i = list.findIndex(m => m.id === id);
    if (i < 0 || list[i].system) return;
    let { from, to } = this.share;
    const start = list.findIndex(m => m.id === from);
    const end = list.findIndex(m => m.id === to);
    if (start < 0 || end < 0) from = to = id;
    else if (i < start) from = id;
    else if (i > end) to = id;
    else if (start === end) from = to = null;
    else if (i === start) from = list.slice(start + 1).find(m => !m.system)?.id ?? null;
    else if (i === end) to = list.slice(0, end).findLast(m => !m.system)?.id ?? null;
    else to = id;
    const a = list.findIndex(m => m.id === from);
    const b = list.findIndex(m => m.id === to);
    if (a >= 0 && b >= a && !shareFits(list.slice(a, b + 1))) {
      ui.notifications.warn(`You can share up to ${MAX_SHARE} texts at a time.`);
      return;
    }
    this.share = { ...this.share, from, to };
    this.render();
  },

  _sharePost() {
    const src = this._shareSource();
    if (!src?.thread || !this.share.from) return;
    const { ctx, thread } = src;
    const group = isGroup(thread);
    store.request("share-texts", {
      threadId: thread.id,
      actorId: ctx.perspective === "pc" ? ctx.actorId : null,
      as: group && ctx.perspective === "gm" ? this.groupSpeaker(ctx, thread) : null,
      from: this.share.from,
      to: this.share.to,
      theme: ctx.settings.theme
    });
    this.share = null;
    this.render();
  },

  /** The share bar and button, for a conversation's page data. */
  _shareData(thread, messages) {
    const sharing = this._sharePicked(messages);
    return {
      canShare: !!thread && feature("shareTexts") && messages.some(m => !m.system) && !sharing,
      sharing: sharing ? { count: sharing.count, max: MAX_SHARE, canPost: sharing.count > 0 } : null,
      picked: sharing?.picked ?? null
    };
  },

  directData(ctx) {
    const actor = game.actors.get(this.view.actorId);
    if (!actor) return null;
    const thread = this.resolveDirect();
    const contact = thread?.contact ?? this.view.contact;
    const hidden = !!(thread?.hideId ?? this.view.hidden);
    const entry = hidden ? null : findContact(getContacts(actor), contact);
    const blocked = !!entry?.blocked;
    const noCall = !!entry?.noCall; // players may text this contact but not call it
    const unreachable = blocked && !this.isGM;
    const gm = ctx.perspective === "gm";
    const raw = this.cleared(ctx, thread)?.messages ?? [];

    // "Viewed" goes under the newest of my messages the other side has seen.
    const seenUntil = ctx.perspective === "pc" ? thread?.viewed ?? 0 : thread?.lastRead?.owner ?? 0;
    let viewedIndex = -1;
    raw.forEach((m, i) => {
      if (!m.system && this.mineDirect(ctx, m) && m.ts <= seenUntil) viewedIndex = i;
    });
    const myKey = ctx.perspective === "pc" ? "pc" : "contact";
    const canAct = this.online && !unreachable;
    // GM: "Set as Viewed" sits under the player's newest message until the contact has seen it.
    const lastPc = raw.filter(m => m.from === "pc" && !m.system).at(-1);
    const canSetViewed = gm && this.online && !!lastPc && lastPc.ts > (thread?.viewed ?? 0);
    const share = this._shareData(thread, raw);
    const messages = datedMessages(raw, (m, i) => ({
      picked: !!share.picked?.has(m.id),
      mine: this.mineDirect(ctx, m),
      viewed: i === viewedIndex,
      setViewed: canSetViewed && m === lastPc,
      reactions: reactionChips(m, myKey),
      money: moneyCard(m, this.mineDirect(ctx, m), canAct),
      job: jobCard(m, canAct && ctx.perspective === "pc"),
      pkg: pkgCard(m, canAct && ctx.perspective === "pc"),
      cbk: cbkInviteCard(m, canAct && ctx.perspective === "pc")
    }));

    // The page is headed with the other side: the contact on a player's phone, the PC on the GM's
    // (the banner above says which NPC the GM is).
    const key = noteKey(contact, hidden ? thread?.id : null);
    const alias = getAlias(actor, key);
    const name = gm ? displayName(actor) : alias || contact;
    const canSend = this.online && !unreachable;
    const hasNotes = !!getNote(actor, key);
    return {
      exists: !!thread,
      actingAs: gm ? this.actingAsContact(actor, contact, hidden) : null,
      name,
      img: gm ? actorAvatar(actor) : pictureOf(entry?.img ?? thread?.contactImg, hidden ? null : entry?.actorId ?? thread?.contactActorId),
      initials: initials(name),
      subtitle: gm || hidden || entry ? null : "Not in your contacts",
      renamed: gm && alias ? `${displayName(actor)} calls them “${alias}”` : null,
      cardTitle: gm ? `Contact card: ${contact} on ${displayName(actor)}'s phone` : "Contact card",
      cardLabel: gm ? `${contact}'s card` : "Contact card",
      messages,
      blocked,
      hidden: hidden && this.isGM,
      hasNotes,
      unreachable,
      canCall: canSend && this.canStartCall && !(noCall && !gm),
      canSend,
      canReact: this.online && !!thread && !share.sharing,
      canShare: share.canShare,
      sharing: share.sharing,
      placeholder: unreachable ? "This number cannot be reached." : this.online ? "Text message" : "No signal"
    };
  },

  /** GM: the banner for a direct conversation or card, "TEXTING AS ROGUE → V". */
  actingAsContact(actor, contact, hidden) {
    return { verb: "Texting as", name: contact, color: personaColor(contact), target: displayName(actor), note: hidden ? "Caller ID hidden" : null };
  },

  groupData(ctx) {
    const group = store.threads.get(this.view.groupId);
    if (!isGroup(group)) return null;
    const gm = ctx.perspective === "gm";
    const as = this.groupSpeaker(ctx, group);
    const npcs = group.members.filter(m => !m.actorId);
    // Everyone's name is in their colour. On the GM Phone, the GM's own NPCs are named too when
    // there's more than one, so it can tell which of them said what.
    const nameMine = gm && npcs.length > 1;
    const raw = this.cleared(ctx, group).messages;
    const share = this._shareData(group, raw);
    const messages = datedMessages(raw, m => {
      const mine = !m.system && this.mineGroup(ctx, m);
      return {
        picked: !!share.picked?.has(m.id),
        text: m.system && m.call && m.name ? `${m.name} · ${m.text}` : m.text,
        mine,
        sender: !m.system && (!mine || nameMine) ? m.name : null,
        color: !m.system && m.name ? personaColor(m.name) : null,
        persona: mine && nameMine,
        reactions: reactionChips(m, as),
        job: jobCard(m, ctx.perspective === "pc" && !!as && this.online)
      };
    });

    const canSend = this.online && !!as;
    let placeholder = "Text message";
    if (!this.online) placeholder = "No signal";
    else if (!as) placeholder = gm ? "Add an NPC to speak in this group" : "Not a member";

    const speaker = group.members.find(m => m.key === as);
    let actingAs = null;
    if (gm) {
      const options = npcs.map(m => ({ value: m.key, label: m.name, color: personaColor(m.name), selected: m.key === as }));
      options.push({ value: "+add", label: "Add an NPC…", action: true });
      actingAs = {
        verb: "Texting as",
        picker: dropdown("speakAs", options, { title: "Choose who you speak as", cls: "agent-speak-as" }),
        note: speaker ? null : "No NPC of yours in this group"
      };
    }
    return {
      name: group.name,
      subtitle: group.members.map(m => m.name).join(", "),
      messages,
      as,
      actingAs,
      canCall: canSend && this.canStartCall,
      canSend,
      canReact: canSend && !share.sharing,
      canShare: share.canShare && (gm || !!as),
      sharing: share.sharing,
      placeholder
    };
  },

  groupInfoData(ctx) {
    const group = store.threads.get(this.view.groupId);
    if (!isGroup(group)) return null;
    const self = ctx.perspective === "pc" ? pcKey(ctx.actorId) : null;
    return {
      name: group.name,
      members: group.members.map(m => ({
        key: m.key,
        name: m.name,
        img: pictureOf(m.img, m.actorId),
        initials: initials(m.name),
        isSelf: m.key === self,
        canCard: !!self && m.key !== self,
        tag: m.actorId ? "PC" : "NPC"
      })),
      canEdit: this.online && (this.isGM || !!self),
      canDelete: this.isGM && ctx.perspective === "gm"
    };
  },

  serviceData(ctx) {
    const actor = game.actors.get(this.view.actorId);
    const service = getService(this.view.serviceId);
    const thread = store.findServiceThread(this.view.actorId, this.view.serviceId);
    if (!actor || (!service && !thread)) return null;
    const pcSide = ctx.perspective === "pc";
    const myKey = pcSide ? "pc" : "service";
    const canAct = this.online;
    const messages = datedMessages(this.cleared(ctx, thread)?.messages ?? [], m => ({
      action: m.action,
      mine: pcSide ? m.from === "pc" : m.from === "service",
      reactions: reactionChips(m, myKey),
      money: moneyCard(m, pcSide ? m.from === "pc" : m.from === "service", canAct),
      job: jobCard(m, canAct && pcSide)
    }));
    const name = service?.name ?? thread.name;
    const canReply = ctx.perspective === "gm" && this.online;
    const canText = pcSide && !!service?.chat && this.online;
    const actions = pcSide ? service?.actions ?? [] : [];
    const lines = pcSide && service ? callLines(service) : [];
    // The GM can always bill or pay a PC from a service; players only answer requests (on the card).
    const canMoney = ctx.perspective === "gm" && this.online;
    return {
      name,
      img: service?.img ?? thread?.img,
      initials: initials(name),
      subtitle: null,
      actingAs: pcSide ? null : { verb: "Replying as", name, color: personaColor(name), target: displayName(actor) },
      messages,
      actions,
      lines,
      canMoney,
      canCall: lines.length > 0 && this.canStartCall,
      multiLine: lines.length > 1,
      canAct: this.online,
      canReply,
      canText,
      canCompose: canReply || canText,
      canReact: this.online && !!thread,
      placeholder: pcSide ? `Message ${name}` : `Respond as ${name}`
    };
  },

  /** Player: save their notes on the contact whose card is open. */
  _saveNote(text) {
    const ctx = this.context();
    const actor = ctx?.actorId && game.actors.get(ctx.actorId);
    if (!actor || this.view?.kind !== "card") return;
    const thread = this.resolveDirect();
    const hidden = !!(thread?.hideId ?? this.view.hidden);
    setNote(actor, noteKey(thread?.contact ?? this.view.contact, hidden ? thread?.id : null), text);
  },

  _deleteThread() {
    const thread = this.resolveDirect();
    if (!thread) return;
    Dialog.confirm({
      title: "Delete conversation",
      content: `<p>Delete the whole conversation with <strong>${esc(thread.contact)}</strong>? This can't be undone.</p>`,
      yes: () => {
        store.request("delete", { threadId: thread.id });
        this.view = null;
        this.render();
      }
    });
  },

  _deleteGroup() {
    const group = store.threads.get(this.view.groupId);
    if (!group) return;
    Dialog.confirm({
      title: "Delete group",
      content: `<p>Delete the group <strong>${esc(group.name)}</strong> and its history for everyone?</p>`,
      yes: () => {
        store.request("delete", { threadId: group.id });
        this.view = null;
        this.render();
      }
    });
  },

  /** GM: flip a yes/no option ("blocked", "noCall") on the open conversation's (or card's) contact. */
  async _toggleContact(option) {
    const actor = game.actors.get(this.view.actorId);
    const thread = this.resolveDirect();
    const contact = thread?.contact ?? this.view.contact;
    if (!actor) return;
    const entry = findContact(getContacts(actor), contact);
    await setContactOptions(actor, contact, { [option]: !entry?.[option] }, {
      img: thread?.contactImg,
      actorId: thread?.contactActorId
    });
  },

  /** GM: set the picture of a contact that has no sheet (updates it everywhere). */
  _setContactImage() {
    const thread = this.resolveDirect();
    const name = thread?.contact ?? this.view?.contact;
    if (!this.isGM || !name) return;
    new FilePicker({
      type: "image",
      current: thread?.contactImg ?? undefined,
      callback: img => store.request("npc-image", { name, img })
    }).render(true);
  },

  async _newGroup() {
    const ctx = this.context();
    const actor = ctx?.perspective === "pc" ? game.actors.get(ctx.actorId) : null;
    const picked = await pickMembers({
      title: "New group",
      actor,
      excludeKeys: actor ? [pcKey(actor.id)] : [],
      withName: true,
      label: "Create"
    });
    if (!picked) return;
    if (!picked.contacts.length && !picked.pcs.length && !picked.npcs.length) return;
    store.request("group-create", { actorId: actor?.id, ...picked });
  },

  async _groupAdd() {
    const group = store.threads.get(this.view.groupId);
    const ctx = this.context();
    if (!group || !ctx) return;
    const picked = await pickMembers({
      title: `Add to ${group.name}`,
      actor: ctx.actorId ? game.actors.get(ctx.actorId) : null,
      excludeKeys: group.members.map(m => m.key),
      label: "Add"
    });
    if (picked) store.request("group-add", { groupId: group.id, actorId: ctx.actorId ?? null, ...picked });
  }
};

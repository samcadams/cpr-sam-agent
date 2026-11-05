import { MODULE_ID } from "../../../config.js";
import { isGroup, isService, pcKey, threadKey } from "../../../model/threads.js";
import { store } from "../../../store.js";

/*
 * Conversations as a phone sees them: which view a thread opens, whose messages are "mine", who the GM
 * speaks as in a group, what a "delete" hides. Installed onto AgentPhone (core/pages.js).
 */

export const methods = {
  viewFor(thread) {
    if (isGroup(thread)) return { kind: "group", groupId: thread.id };
    if (isService(thread)) return { kind: "service", actorId: thread.actorId, serviceId: thread.serviceId };
    return { kind: "direct", threadId: thread.id, actorId: thread.actorId, contact: thread.contact, hidden: !!thread.hideId };
  },

  resolveDirect(view = this.view) {
    if (view.threadId && store.threads.has(view.threadId)) return store.threads.get(view.threadId);
    return store.findThread(view.actorId, view.contact, !!view.hidden);
  },

  mineDirect(ctx, m) {
    return ctx.perspective === "pc" ? m.from === "pc" : m.from === "contact";
  },

  mineGroup(ctx, m) {
    if (ctx.perspective === "pc") return m.from === pcKey(ctx.actorId);
    return m.from.startsWith("n:");
  },

  /**
   * Who this phone speaks as in a group, or null. The GM: the NPC last chosen for this group (saved
   * on the user, so it survives reloads), else the NPC it's acting as, else the group's first NPC.
   */
  groupSpeaker(ctx, group) {
    if (ctx.perspective === "pc") return group.members.some(m => m.key === pcKey(ctx.actorId)) ? pcKey(ctx.actorId) : null;
    const npcs = group.members.filter(m => !m.actorId);
    const chosen = game.user.getFlag(MODULE_ID, "speakAs")?.[group.id];
    const persona = this.persona?.name.toLowerCase();
    return (npcs.find(m => m.key === chosen) ?? npcs.find(m => m.name.toLowerCase() === persona) ?? npcs[0])?.key ?? null;
  },

  /** The thread as this phone sees it: messages from before a "delete" are hidden. */
  cleared(ctx, thread) {
    if (!thread) return thread;
    const since = ctx.settings.cleared?.find(c => c.key === threadKey(thread))?.ts ?? 0;
    if (!since) return thread;
    return {
      ...thread,
      messages: thread.messages.filter(m => m.ts > since),
      lastReaction: thread.lastReaction?.ts > since ? thread.lastReaction : null
    };
  }
};

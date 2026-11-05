import { cleanImage, gm } from "./validate.js";
import { agentType, canUsePhone } from "../model/agent.js";
import { feature } from "../model/features.js";
import { playerCharacters } from "../model/contacts.js";
import { canActFor, sideFor } from "../model/permissions.js";
import { OBJECTIVE_STATES, objectiveHidden, QUEST_STATUSES, wouldLoop } from "../model/quests.js";
import { displayName, isGroup } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: the job log (GM only) and the notices players get about it.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "job-respond": "_onJobRespond",
  "quest-save": gm("_onQuestSave"),
  "quest-delete": gm("_onQuestDelete"),
  "objective-save": gm("_onObjectiveSave"),
  "objective-delete": gm("_onObjectiveDelete"),
  "objective-move": gm("_onObjectiveMove")
};

export const methods = {
  /**
   * A job attached to a message (GM only, while jobs are on). The offer carries a copy of what the
   * players need to decide, so they can read it while the job itself is still hidden.
   */
  _jobOffer(user, questId) {
    const quest = questId ? this.quests.get(questId) : null;
    if (!user.isGM || !quest || !feature("jobs")) return null;
    const summary = clean(quest.description?.split("\n").find(line => line.trim()) ?? "", 200);
    return { questId: quest.id, name: quest.name, summary, img: quest.img ?? null, status: "offered" };
  },

  /**
   * A player answers a job offer. Accepting makes the job visible and In Progress (for everyone:
   * jobs are shared); declining leaves it as it was. Either way the GM gets a line saying so.
   */
  _onJobRespond(user, { threadId, messageId, accept, as }) {
    const thread = this.threads.get(threadId);
    const job = thread?.messages.find(m => m.id === messageId)?.job;
    if (!job || job.status !== "offered" || !feature("jobs")) return;

    let from;
    let name;
    if (isGroup(thread)) {
      const member = thread.members.find(m => m.key === as);
      if (!member?.actorId || !canActFor(user, member) || !canUsePhone(game.actors.get(member.actorId))) return;
      [from, name] = [member.key, member.name];
    } else {
      if (sideFor(user, thread) !== "pc") return;
      [from, name] = ["pc", displayName(game.actors.get(thread.actorId))];
    }

    job.status = accept ? "accepted" : "declined";
    job.by = name;
    const text = `${name} ${accept ? "accepted" : "declined"} the job "${job.name}"`;
    thread.messages.push(this._message(from, text, { system: true, alert: true, userId: user.id, name }));
    this.save();
    this._push(thread, true);

    const quest = accept ? this.quests.get(job.questId) : null;
    if (quest) {
      quest.hidden = false;
      quest.status = "active";
      quest.updated = Date.now();
      // The one who accepted doesn't need telling (their own action).
      const self = isGroup(thread) ? thread.members.find(m => m.key === from)?.actorId : thread.actorId;
      this._pushQuests({ title: "Job started", body: quest.name, questId: quest.id, status: "active" }, self);
    }
  },

  /** Send everyone their view of the quest log; `notice` pops up for players. */
  _pushQuests(notice = null, skipActorId = null) {
    // Every player character's Agent keeps the news for its notification center (jobs are the whole party's),
    // while Jobs is on.
    const told = notice && feature("jobs") ? playerCharacters().filter(a => agentType(a) && a.id !== skipActorId) : [];
    if (told.length) this._pushApps(told.map(a => this._alert(a.id, { kind: "job", from: notice.title, text: notice.body, ref: { type: "job", questId: notice.questId } })).filter(Boolean));
    for (const user of game.users) {
      if (!user.active || user === game.user) continue;
      const quests = this.visibleQuests(user);
      // Only tell players about jobs they can actually see.
      const relevant = !user.isGM && notice && quests.some(q => q.id === notice.questId);
      this._send([user.id], { type: "quests", quests, notice: relevant ? notice : null });
    }
    this._changed({ quests: true });
  },

  _onQuestSave(user, { quest }) {
    if (!quest) return;
    const existing = quest.id ? this.quests.get(quest.id) : null;
    const before = existing ? { status: existing.status, hidden: existing.hidden } : null;
    // A new job may bring its own id (api.js saveJob returns it before the host has the job).
    const id = typeof quest.id === "string" && /^[A-Za-z0-9]{8,32}$/.test(quest.id) ? quest.id : foundry.utils.randomID();
    const q = existing ?? { id, objectives: [], status: "available", hidden: true };

    if ("name" in quest) q.name = clean(quest.name, 100) || q.name || "Untitled job";
    if ("description" in quest) q.description = clean(quest.description, 4000);
    if ("img" in quest) q.img = cleanImage(quest.img, user);
    if (QUEST_STATUSES.includes(quest.status)) q.status = quest.status;
    if ("hidden" in quest) q.hidden = !!quest.hidden;
    q.name ??= "Untitled job";
    q.updated = Date.now();
    this.quests.set(q.id, q);
    this.save();

    let notice = null;
    if (!q.hidden && (!before || before.hidden)) notice = { title: "New job", body: q.name, questId: q.id };
    else if (!q.hidden && before.status !== q.status) {
      const titles = { available: "Job available", active: "Job started", completed: "Job completed", failed: "Job failed" };
      notice = { title: titles[q.status], body: q.name, questId: q.id, status: q.status };
    }
    this._pushQuests(notice);
  },

  _onQuestDelete(user, { questId }) {
    if (!this.quests.delete(questId)) return;
    this.save();
    this._pushQuests();
  },

  _onObjectiveSave(user, { questId, objective }) {
    const quest = this.quests.get(questId);
    if (!quest || !objective) return;
    let o = objective.id ? quest.objectives.find(x => x.id === objective.id) : null;
    const isNew = !o;
    o ??= { id: foundry.utils.randomID(), text: "New objective", state: "incomplete", hidden: false, parentId: null };
    const wasHidden = !isNew && objectiveHidden(quest, o);
    const prevState = o.state;

    if ("text" in objective) o.text = clean(objective.text, 300) || o.text;
    if (OBJECTIVE_STATES.includes(objective.state)) o.state = objective.state;
    if ("hidden" in objective) o.hidden = !!objective.hidden;
    if ("parentId" in objective) {
      const parentId = objective.parentId || null;
      const valid = !parentId || (parentId !== o.id && quest.objectives.some(x => x.id === parentId) && !wouldLoop(quest, o.id, parentId));
      if (valid) o.parentId = parentId;
    }
    if (isNew) quest.objectives.push(o);
    quest.updated = Date.now();
    this.save();

    let notice = null;
    const visible = !quest.hidden && !objectiveHidden(quest, o);
    if (visible && o.state !== prevState && o.state !== "incomplete") {
      notice = { title: o.state === "complete" ? "Objective complete" : "Objective failed", body: `${quest.name}: ${o.text}`, questId: quest.id };
    } else if (visible && (isNew || wasHidden)) {
      notice = { title: "New objective", body: `${quest.name}: ${o.text}`, questId: quest.id };
    }
    this._pushQuests(notice);
  },

  /** Deleting an objective moves its branches up to its parent. */
  _onObjectiveDelete(user, { questId, objectiveId }) {
    const quest = this.quests.get(questId);
    const o = quest?.objectives.find(x => x.id === objectiveId);
    if (!o) return;
    for (const child of quest.objectives) if (child.parentId === o.id) child.parentId = o.parentId ?? null;
    quest.objectives = quest.objectives.filter(x => x !== o);
    quest.updated = Date.now();
    this.save();
    this._pushQuests();
  },

  /**
   * Move an objective up (dir -1) or down (dir 1) among its siblings: the objectives on the same
   * branch. Its own branches move with it, since they hang off it.
   */
  _onObjectiveMove(user, { questId, objectiveId, dir }) {
    const quest = this.quests.get(questId);
    const o = quest?.objectives.find(x => x.id === objectiveId);
    if (!o || ![-1, 1].includes(dir)) return;
    const ids = new Set(quest.objectives.map(x => x.id));
    const parentOf = x => (x.parentId && ids.has(x.parentId) ? x.parentId : null);
    const siblings = quest.objectives.filter(x => parentOf(x) === parentOf(o));
    const other = siblings[siblings.indexOf(o) + dir];
    if (!other) return;
    const list = quest.objectives;
    const [i, j] = [list.indexOf(o), list.indexOf(other)];
    [list[i], list[j]] = [list[j], list[i]];
    this.save();
    this._pushQuests();
  }
};

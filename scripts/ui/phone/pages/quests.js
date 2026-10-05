import { dropdown } from "./dropdown.js";
import { objectiveDialog, questDialog } from "../../dialogs/forms.js";
import { MODULE_ID } from "../../../config.js";
import { feature, setFeature } from "../../../model/features.js";
import {
  OBJECTIVE_STATES, objectiveHidden, playerQuests, QUEST_LABELS, QUEST_STATUSES, wouldLoop
} from "../../../model/quests.js";
import { store } from "../../../store.js";
import { esc } from "../../../util/text.js";

/*
 * Phone page: the Jobs app (quests and their objectives; managed on the GM Phone).
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** An objective of the open quest. */
function objectiveIn(phone, objectiveId) {
  return store.quests.get(phone.questId)?.objectives.find(x => x.id === objectiveId) ?? null;
}

export const actions = {
  "quest-tab"({ tab }) {
    this.questTab = tab;
    this.render();
  },
  "quest-open"({ questId }) {
    this.questId = questId;
    this.render();
  },
  "quest-back"() {
    this.questId = null;
    this.render();
  },
  "quest-new"() {
    this._editQuest(null);
  },
  "quest-edit"() {
    this._editQuest(store.quests.get(this.questId));
  },
  "quest-delete"() {
    this._deleteQuest();
  },
  "quest-hide"() {
    const quest = store.quests.get(this.questId);
    if (quest) store.request("quest-save", { quest: { id: quest.id, hidden: !quest.hidden } });
  },
  "objective-add"({ parentId }) {
    this._editObjective(null, parentId || null);
  },
  "objective-edit"({ objectiveId }) {
    this._editObjective(objectiveId);
  },
  "objective-cycle"({ objectiveId }) {
    const o = objectiveIn(this, objectiveId);
    if (!o) return;
    const state = OBJECTIVE_STATES[(OBJECTIVE_STATES.indexOf(o.state) + 1) % OBJECTIVE_STATES.length];
    store.request("objective-save", { questId: this.questId, objective: { id: o.id, state } });
  },
  "objective-hide"({ objectiveId }) {
    const o = objectiveIn(this, objectiveId);
    if (o) store.request("objective-save", { questId: this.questId, objective: { id: o.id, hidden: !o.hidden } });
  },
  "objective-delete"({ objectiveId }) {
    store.request("objective-delete", { questId: this.questId, objectiveId });
  },
  /** GM: the "Available" tab's switch in Control, from the tab itself. */
  "jobs-available-toggle"() {
    setFeature("jobsAvailable", !feature("jobsAvailable"));
  },
  "objective-move"({ objectiveId, dir }) {
    store.request("objective-move", { questId: this.questId, objectiveId, dir: Number(dir) });
  }
};

export const dropdowns = {
  questStatus(status) {
    store.request("quest-save", { quest: { id: this.questId, status } });
    this.questTab = status;
  }
};

export const methods = {
  /** Quests as this phone sees them: everything on the GM Phone, the player view elsewhere. */
  questList(ctx) {
    const all = [...store.quests.values()];
    return ctx.perspective === "gm" ? all : playerQuests(all);
  },

  questsData(ctx) {
    const manage = ctx.perspective === "gm";
    const quests = this.questList(ctx);
    // Players lose the "Available" tab when the GM switches it off; the GM keeps it to prepare jobs.
    const statuses = manage || feature("jobsAvailable") ? QUEST_STATUSES : QUEST_STATUSES.filter(s => s !== "available");
    if (!statuses.includes(this.questTab)) this.questTab = statuses[0];
    const tabs = statuses.map(id => ({
      id,
      label: QUEST_LABELS[id],
      count: quests.filter(q => q.status === id).length,
      active: id === this.questTab
    }));
    const rows = quests
      .filter(q => q.status === this.questTab)
      .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
      .map(q => {
        const shown = manage ? q.objectives.filter(o => !objectiveHidden(q, o)) : q.objectives;
        return {
          id: q.id,
          name: q.name,
          img: q.img,
          hidden: manage && q.hidden,
          progress: shown.length ? `${shown.filter(o => o.state === "complete").length}/${shown.length}` : "",
          summary: q.description?.split("\n")[0] ?? ""
        };
      });
    // GM: whether players can see the Available tab at all (switched in Control).
    const availableNote = manage && this.questTab === "available"
      ? feature("jobsAvailable")
        ? { shown: true, text: "Players can see this tab (hidden jobs stay hidden)." }
        : { shown: false, text: "Hidden from players." }
      : null;
    return { manage, tabs, rows, availableNote, emptyText: `No ${QUEST_LABELS[this.questTab].toLowerCase()} jobs.` };
  },

  questData(ctx) {
    const quest = this.questList(ctx).find(q => q.id === this.questId);
    if (!quest) return null;
    const manage = ctx.perspective === "gm";

    // Flatten the objective tree into indented rows (orphans are treated as top level).
    const ids = new Set(quest.objectives.map(o => o.id));
    const children = new Map();
    for (const o of quest.objectives) {
      const parent = o.parentId && ids.has(o.parentId) ? o.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(o);
    }
    const rows = [];
    const walk = (parent, depth) => {
      const siblings = children.get(parent) ?? [];
      for (const [i, o] of siblings.entries()) {
        rows.push({
          canUp: i > 0,
          canDown: i < siblings.length - 1,
          id: o.id,
          text: o.text,
          state: o.state,
          icon: { incomplete: "fa-regular fa-square", complete: "fa-solid fa-square-check", failed: "fa-solid fa-square-xmark" }[o.state],
          hidden: o.hidden,
          hiddenByParent: !o.hidden && objectiveHidden(quest, o),
          depth,
          indent: depth * 16
        });
        if (depth < 20) walk(o.id, depth + 1);
      }
    };
    walk(null, 0);

    return {
      manage,
      id: quest.id,
      name: quest.name,
      img: quest.img,
      description: quest.description,
      status: quest.status,
      statusLabel: QUEST_LABELS[quest.status],
      statusPicker: dropdown("questStatus", QUEST_STATUSES.map(id => ({ value: id, label: QUEST_LABELS[id], selected: id === quest.status })), { title: "Status" }),
      hidden: quest.hidden,
      objectives: rows
    };
  },

  /** Looking at the quests app clears its dock dot: remember the newest update seen (host clock). */
  _markQuestsSeen(ctx) {
    const newest = Math.max(0, ...this.questList(ctx).map(q => q.updated ?? 0));
    if (newest > (game.settings.get(MODULE_ID, "questsSeen") ?? 0)) game.settings.set(MODULE_ID, "questsSeen", newest);
  },

  /** GM: create or edit a quest's details. */
  async _editQuest(quest) {
    const result = await questDialog(quest, this.questTab);
    if (!result) return;
    store.request("quest-save", { quest: result });
    this.questTab = result.status;
  },

  _deleteQuest() {
    const quest = store.quests.get(this.questId);
    if (!quest) return;
    Dialog.confirm({
      title: "Delete job",
      content: `<p>Delete <strong>${esc(quest.name)}</strong> and all its objectives?</p>`,
      yes: () => {
        store.request("quest-delete", { questId: quest.id });
        this.questId = null;
        this.render();
      }
    });
  },

  /** GM: add or edit an objective, including which objective it branches from. */
  async _editObjective(objectiveId, parentId = null) {
    const quest = store.quests.get(this.questId);
    if (!quest) return;
    const o = objectiveId ? quest.objectives.find(x => x.id === objectiveId) : null;
    const current = o ? o.parentId : parentId;
    const parents = quest.objectives
      .filter(x => !o || !wouldLoop(quest, o.id, x.id)) // can't branch from itself or anything under it
      .map(x => ({ id: x.id, text: x.text, selected: x.id === current }));
    const result = await objectiveDialog(o, parents);
    if (!result || (!result.text && !o)) return;
    store.request("objective-save", { questId: quest.id, objective: result });
  }
};

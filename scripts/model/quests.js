import { feature } from "./features.js";

/*
 * Quest (shared by every PC, managed on the GM Phone; players call them "jobs"):
 * { id, name, description, img, status: "available"|"active"|"completed"|"failed", hidden, updated,
 *   objectives: [{ id, text, state: "incomplete"|"complete"|"failed", hidden, parentId }] }
 * Objectives form a tree through parentId. Hidden quests/objectives (and anything branched under a
 * hidden objective) never reach players.
 */

export const QUEST_STATUSES = ["available", "active", "completed", "failed"];
export const OBJECTIVE_STATES = ["incomplete", "complete", "failed"];

export const QUEST_LABELS = { available: "Available", active: "In Progress", completed: "Completed", failed: "Failed" };

/** Walk from an objective up through its parents (guarded against loops in bad data). */
function* ancestry(quest, objective) {
  const byId = new Map(quest.objectives.map(o => [o.id, o]));
  for (let o = objective, guard = 0; o && guard < 100; o = byId.get(o.parentId), guard++) yield o;
}

/** Is this objective hidden, directly or through a hidden parent? */
export function objectiveHidden(quest, objective) {
  for (const o of ancestry(quest, objective)) if (o.hidden) return true;
  return false;
}

/** Would making `parentId` the parent of objective `id` create a loop? */
export function wouldLoop(quest, id, parentId) {
  const parent = quest.objectives.find(o => o.id === parentId);
  for (const o of ancestry(quest, parent)) if (o.id === id) return true;
  return false;
}

/** The quest as players see it, or null if it's hidden. */
export function redactQuest(quest) {
  if (quest.hidden) return null;
  return { ...quest, objectives: quest.objectives.filter(o => !objectiveHidden(quest, o)) };
}

/**
 * The job log as players see it: nothing when the GM has switched jobs off, and no "available"
 * jobs when that tab is off.
 */
export function playerQuests(quests) {
  if (!feature("jobs")) return [];
  const shown = quests.map(redactQuest).filter(Boolean);
  return feature("jobsAvailable") ? shown : shown.filter(q => q.status !== "available");
}

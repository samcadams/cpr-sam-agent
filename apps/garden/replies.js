import { pickMood, replyLine } from "./model.js";

/*
 * The Garden's auto-replies (host.js _tickGarden): a growing post gets a reaction or two from random
 * citizens (the word lists: one-liners in their mood that fit under any post), and that's all.
 * Everything else in a thread is the writer's (its batches) or the players'. Pure (no Foundry
 * globals), so it's Node-tested (tests/garden-replies.test.js).
 */

/** How many auto-replies a post gets at most: reactions, before the writer's thread. */
export const MAX_REACTIONS = 2;

/** A random citizen: an NPC citizen with a mood and no writer lines (the cast is the writer's). */
export const isCrowd = a => !!a && !a.actorId && a.kind === "citizen" && !!a.mood && !a.writer?.lines?.length;

/**
 * The next reaction on `post`: { account, text } or null (no crowd, or nothing new to say there).
 * Who reacts follows the post's mood mix; a citizen reacts once per thread, a line is said once.
 * `accounts`: the Garden's accounts by id; `lists`: the word lists (default: loaded).
 */
export function pickReaction(post, accounts, { rand = Math.random, lists } = {}) {
  const reacted = new Set(post.replies.filter(r => r.auto).map(r => r.accountId));
  const crowd = Object.values(accounts ?? {}).filter(a => isCrowd(a) && !reacted.has(a.id));
  if (!crowd.length) return null;
  const mood = pickMood(post.eng?.mix ?? {}, rand);
  const byMood = crowd.filter(c => c.mood === mood);
  const pool = byMood.length ? byMood : crowd;
  const from = pool[Math.floor(rand() * pool.length)];
  const text = replyLine(from.mood, rand, lists, post.replies.map(r => r.text));
  return text ? { account: from, text } : null;
}

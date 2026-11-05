import { pickMood, replyLine } from "./model.js";

/*
 * The Garden's auto-replies (host.js _tickGarden): who answers a growing post. Pure (no Foundry
 * globals), so it's Node-tested (tests/garden-replies.test.js).
 *
 * - The crowd: random citizens (kind citizen, a mood, no writer lines), picked by the post's mood mix.
 *   They say the writer's chatter first (lines from its batches, garden.chatter; ones with
 *   keywords only on posts that have one), then the word lists.
 * - The cast (NPC accounts with writer lines) reply only when the post is for them: it @-mentions
 *   their handle, its author is in their ties (a handle or a name), or it has one of their keywords or
 *   reacts (whole words, any case). Never on their own post, once per thread at most, and a minority
 *   of the post's auto-replies (castQuota), and only their own lines (never the word lists). Nobody fits: the crowd answers.
 * - Corporations and news never auto-reply: their replies come from the writer's batches only.
 */

/** Kinds that never auto-reply (the writer's drafts speak for them). */
export const QUIET_KINDS = new Set(["corp", "news"]);

/** A random citizen: replies from the word lists. */
export const isCrowd = a => !!a && !a.actorId && a.kind === "citizen" && !!a.mood && !a.writer?.lines?.length;

/** A cast member who may auto-reply: an NPC account with writer lines, not a corp or news. */
export const isCast = a => !!a && !a.actorId && a.kind !== "pc" && !QUIET_KINDS.has(a.kind) && !!a.writer?.lines?.length;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lower = s => String(s ?? "").trim().toLowerCase();
const bare = s => lower(s).replace(/^@/, "");

/** Whether `text` has `word` as a whole word or phrase (any case). */
export const hasWord = (text, word) => {
  const w = lower(word).replace(/^#/, "");
  return !!w && new RegExp(`(?<![\\p{L}\\p{N}_])${escape(w)}(?![\\p{L}\\p{N}_])`, "iu").test(String(text ?? ""));
};

/** Whether `text` @-mentions `handle` ("@rook_nc", stored with or without the "@"). */
export const mentions = (text, handle) => {
  const h = bare(handle);
  return !!h && new RegExp(`(?<![\\p{L}\\p{N}_@])@${escape(h)}(?![\\p{L}\\p{N}_])`, "iu").test(String(text ?? ""));
};

/**
 * Why a cast member would answer this post: "mention", "tie" or "keyword", or null (also for their
 * own post). `author`: the post's account; `authorName`: a character's name for a PC's post, if known.
 */
export function castFit(account, post, author, authorName = null) {
  if (!isCast(account) || post.accountId === account.id) return null;
  const text = post.text ?? "";
  if (mentions(text, account.handle)) return "mention";
  const w = account.writer;
  if (author) {
    const names = new Set([bare(author.handle), lower(author.name), lower(authorName)].filter(Boolean));
    if ((w.ties ?? []).some(t => names.has(bare(t)))) return "tie";
  }
  if ([...(w.keywords ?? []), ...(w.reacts ?? [])].some(k => hasWord(text, k))) return "keyword";
  return null;
}

/** How many cast auto-replies a post may have: a third of its replies, at least one. */
export const castQuota = total => Math.max(1, Math.floor(total / 3));

/** A cast member's own line not yet said in the thread, or null. */
export function ownLine(account, said, rand = Math.random) {
  const lines = (account.writer?.lines ?? []).filter(l => !l.includes("{") && !said.includes(l));
  return lines.length ? lines[Math.floor(rand() * lines.length)] : null;
}

const RANK = { mention: 0, tie: 1, keyword: 2 };

/**
 * The writer's chatter line for a crowd reply in `mood` on `post`, or null: not said in the thread yet,
 * in that mood or any; lines with keywords the post has before lines without, then the least used.
 * `chatter`: the live pool, [{ id, mood, keywords, text, used }].
 */
export function chatterLine(post, mood, chatter, said, rand = Math.random) {
  const fresh = (chatter ?? []).filter(c => (!c.mood || c.mood === mood) && !said.includes(c.text));
  const topical = fresh.filter(c => c.keywords?.length && c.keywords.some(k => hasWord(post.text, k)));
  const options = topical.length ? topical : fresh.filter(c => !c.keywords?.length);
  if (!options.length) return null;
  const least = Math.min(...options.map(c => c.used ?? 0));
  const pool = options.filter(c => (c.used ?? 0) === least);
  return pool[Math.floor(rand() * pool.length)];
}

/**
 * The next auto-reply on `post`: { account, text, cast } or null (nobody has anything left to say).
 * `accounts`: the Garden's accounts by id; `total`: how many auto-replies the post will get;
 * `names`: actorId → character name (for ties naming a PC); `lists`: the word lists (default: loaded);
 * `chatter`: the writer's live chatter (chatterLine). A cast member who fits answers first when the
 * quota allows (mentions before ties before keywords, at random among the best); then the crowd, by
 * the post's mood mix. A crowd reply from the chatter carries its `chatter` id.
 */
export function pickAutoReply(post, accounts, { total = post.eng?.replies ?? 0, names = {}, rand = Math.random, lists, chatter = [] } = {}) {
  const all = Object.values(accounts ?? {});
  const said = post.replies.map(r => r.text);
  const autos = post.replies.filter(r => r.auto);
  const author = accounts[post.accountId] ?? null;
  const authorName = author?.actorId ? names[author.actorId] ?? null : null;

  const castSoFar = autos.filter(r => isCast(accounts[r.accountId])).length;
  if (castSoFar < castQuota(Math.max(total, autos.length + 1))) {
    const answered = new Set(autos.map(r => r.accountId));
    const fits = all.filter(a => !answered.has(a.id)).map(a => ({ a, why: castFit(a, post, author, authorName) })).filter(f => f.why);
    if (fits.length) {
      const best = Math.min(...fits.map(f => RANK[f.why]));
      const top = fits.filter(f => RANK[f.why] === best);
      for (const { a } of top.sort(() => rand() - 0.5)) {
        const text = ownLine(a, said, rand);
        if (text) return { account: a, text, cast: true };
      }
    }
  }

  const crowd = all.filter(isCrowd);
  if (!crowd.length) return null;
  const mood = pickMood(post.eng?.mix ?? {}, rand);
  const byMood = crowd.filter(c => c.mood === mood);
  const pool = byMood.length ? byMood : crowd;
  const from = pool[Math.floor(rand() * pool.length)];
  const line = chatterLine(post, from.mood ?? mood, chatter, said, rand);
  if (line) return { account: from, text: line.text, cast: false, chatter: line.id };
  const text = replyLine(from.mood ?? mood, rand, lists, said);
  return text ? { account: from, text, cast: false } : null;
}

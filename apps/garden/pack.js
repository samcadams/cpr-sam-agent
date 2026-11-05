import { matchAccounts } from "./writer.js";

/*
 * The writer pack (plan: handoff GARDEN-LIFE-PROPOSAL-2026-10-22 §4, §11): everything the
 * garden-writer skill needs from one world, saved by the host as cpr-sam-agent/garden/writer-pack.json
 * (for the skill) and writer-pack.md (for the GM). Pure: the host passes what only Foundry knows (ctx).
 * The pack does the keyword legwork: who fits each happening and seed, who's been quiet, which
 * characters' posts nobody answered.
 *
 * ctx: {
 *   world, worldTitle, now (Garden time), nowMs, clock ("world"|"real"),
 *   when(wt) → "Spring, Day 7, 21:40",       days: [{ wt, label, weekday }] (in-game midnights from today)
 *   pcs: [{ actorId, name, reputation, role }]   the writer's characters (writerCharacters: the GM's list)
 *   tiers: [ids], feeds: { [app]: [facts] }, drafts: { pending: [...], reviews: [...] }
 * }
 */

export const PACK_FORMAT = "garden-writer-pack v1";
export const PACK_FILE = "garden/writer-pack.json";
export const PACK_MD = "garden/writer-pack.md";
export const INBOX = "garden/inbox";

const RECENT_POSTS = 40;
const QUIET_DAYS = 3;
/** A handle as "@name" (accounts keep theirs with the "@"; older data may not). */
const tag = h => (String(h ?? "").startsWith("@") ? String(h) : `@${h}`);
const cut = (s, n) => (String(s ?? "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ""));

/** How far a character can be named, from their Reputation (the Facedown idea). */
export function naming(rep) {
  if (rep >= 6) return "by name; people know the face";
  if (rep >= 3) return "by name sometimes, often by description";
  if (rep >= 1) return "by description only (\"some solo in a red jacket\")";
  return "not identifiable: an unnamed stranger at most";
}

/** Whether a text mentions a character (their account's handle, or their name or first name). */
const mentions = (text, pc) => {
  const t = String(text ?? "").toLowerCase();
  const first = pc.name.split(/\s+/)[0].toLowerCase();
  return (pc.handle && t.includes(pc.handle.toLowerCase())) || t.includes(pc.name.toLowerCase()) || (first.length > 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
};

/** Build the pack (plain JSON-able data). */
export function buildPack(garden, ctx) {
  const { now, when } = ctx;
  const accounts = garden.accounts ?? {};
  const posts = Object.values(garden.posts ?? {}).sort((a, b) => b.wt - a.wt || b.ts - a.ts);
  const handle = id => (id === "@random" ? "@random" : accounts[id] ? tag(accounts[id].handle) : null);
  const lastPost = new Map();
  for (const p of posts) if (!lastPost.has(p.accountId)) lastPost.set(p.accountId, p.wt);
  const lastSeen = id => (lastPost.has(id) ? { wt: lastPost.get(id), label: when(lastPost.get(id)) } : null);

  const pcAccount = actorId => Object.values(accounts).find(a => a.actorId === actorId) ?? null;
  const pcs = (ctx.pcs ?? []).map(pc => {
    const account = pcAccount(pc.actorId);
    const p = { ...pc, handle: account ? tag(account.handle) : null };
    const theirs = posts.filter(x => x.accountId === account?.id);
    const appeared = posts.find(x => x.accountId !== account?.id && (mentions(x.text, p) || x.rep?.some?.(r => r.actorId === pc.actorId)));
    return {
      actorId: pc.actorId,
      name: pc.name,
      role: pc.role ?? null,
      reputation: pc.reputation ?? 0,
      naming: naming(pc.reputation ?? 0),
      handle: account ? tag(account.handle) : null,
      profile: garden.writer?.pcs?.[pc.actorId] ?? null,
      lastOpenedGarden: garden.seen?.[pc.actorId] ? { wt: garden.seen[pc.actorId].wt, label: when(garden.seen[pc.actorId].wt) } : null,
      posts: theirs.slice(0, 10).map(x => ({ id: x.id, when: when(x.wt), text: x.text, replies: x.replies?.length ?? 0 })),
      sprouted: account ? posts.filter(x => x.likedBy?.includes(account.id)).slice(0, 10).map(x => `${handle(x.accountId)}: ${cut(x.text, 80)}`) : [],
      grafted: account ? posts.filter(x => x.graftedBy?.includes(account.id)).slice(0, 10).map(x => `${handle(x.accountId)}: ${cut(x.text, 80)}`) : [],
      repliedTo: account ? posts.flatMap(x => (x.replies ?? []).filter(r => r.accountId === account.id).map(r => ({ to: handle(x.accountId), post: cut(x.text, 80), said: r.text }))).slice(0, 10) : [],
      lastAppeared: appeared ? { wt: appeared.wt, label: when(appeared.wt), by: handle(appeared.accountId) } : null
    };
  });

  const voice = a => ({
    id: a.id, handle: tag(a.handle), name: a.name, kind: a.kind, verified: !!a.verified, followers: a.followers, mood: a.mood ?? null,
    bio: a.bio || "", writer: a.writer ?? null, lastPost: lastSeen(a.id)
  });
  const all = Object.values(accounts).filter(a => !a.actorId);
  const cast = all.filter(a => a.kind !== "corp" && a.writer).map(voice);
  const corps = all.filter(a => a.kind === "corp").map(a => ({ ...voice(a), corp: a.corp ? { ...a.corp, relations: (a.corp.relations ?? []).map(r => ({ ...r, name: pcs.find(p => p.actorId === r.actorId)?.name ?? null })), calendar: (a.corp.calendar ?? []).map(c => ({ ...c, label: when(c.wt) })) } : null }));
  const others = all.filter(a => a.kind !== "corp" && !a.writer && a.kind !== "citizen").map(a => ({ handle: tag(a.handle), name: a.name, kind: a.kind, mood: a.mood ?? null }));
  const citizens = all.filter(a => a.kind === "citizen" && !a.writer);

  const pcActors = new Map(pcs.map(p => [p.actorId, p.name]));
  const matches = keywords => matchAccounts(keywords ?? [], accounts).filter(m => m.account.kind !== "pc").slice(0, 8).map(m => ({ handle: tag(m.account.handle), score: m.score }));
  const happenings = Object.values(garden.happenings ?? {}).filter(h => h.stage !== "closed").sort((a, b) => b.wt - a.wt)
    .map(h => ({ ...h, when: when(h.wt), whoNames: (h.who ?? []).map(id => pcActors.get(id) ?? id), fits: matches(h.keywords) }));
  const seeds = Object.values(garden.seeds ?? {}).filter(s => s.stage !== "done")
    .map(s => ({ ...s, byLabel: s.by ? when(s.by) : null, sources: (s.sources ?? []).map(handle).filter(Boolean), fits: matches(s.keywords) }));

  // Characters' accounts: only the pack's characters' (ctx.pcs, the Writer tab's list); other
  // characters' accounts are no one's to answer.
  const pcIds = new Set(pcs.map(p => p.actorId));
  const pcAccountIds = new Set(Object.values(accounts).filter(a => a.actorId && pcIds.has(a.actorId)).map(a => a.id));
  const anyPcAccount = new Set(Object.values(accounts).filter(a => a.actorId).map(a => a.id));
  // Characters' posts nobody but citizens' auto-replies (or other characters) answered yet.
  const unanswered = posts.filter(p => pcAccountIds.has(p.accountId) && !(p.replies ?? []).some(r => !r.auto && !anyPcAccount.has(r.accountId)))
    .slice(0, 20).map(p => ({ id: p.id, by: handle(p.accountId), wt: p.wt, when: when(p.wt), text: p.text, replies: (p.replies ?? []).map(r => `${handle(r.accountId)}: ${r.text}`) }));

  const recent = posts.slice(0, RECENT_POSTS).map(p => ({
    id: p.id, by: handle(p.accountId), wt: p.wt, when: when(p.wt), tier: p.tier, text: p.text, sprouts: p.likes, grafts: p.grafts,
    replies: (p.replies ?? []).filter(r => !r.auto).map(r => `${handle(r.accountId)}: ${cut(r.text, 120)}`), autoReplies: (p.replies ?? []).filter(r => r.auto).length
  }));

  const queue = garden.queue ?? [];
  const byDay = {};
  for (const q of queue) {
    const day = (ctx.days ?? []).filter(d => d.wt <= q.wt).at(-1)?.label ?? "later";
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const quietCut = now - QUIET_DAYS * 86400;
  const formats = (garden.writer?.formats ?? []).map(f => ({ ...f, handle: handle(f.accountId), lastPost: lastSeen(f.accountId) }));

  return {
    format: PACK_FORMAT,
    world: ctx.world,
    worldTitle: ctx.worldTitle ?? ctx.world,
    written: new Date(ctx.nowMs ?? Date.now()).toISOString(),
    base: now,
    baseLabel: when(now),
    clock: ctx.clock,
    inbox: `worlds/${ctx.world}/cpr-sam-agent/${INBOX}/`,
    days: ctx.days ?? [],
    mix: garden.writer?.mix ?? null,
    tiers: ctx.tiers ?? [],
    paused: garden.paused ? { wt: garden.paused, label: when(garden.paused) } : null,
    queue: {
      count: queue.length,
      until: queue.length ? { wt: queue.at(-1).wt, label: when(queue.at(-1).wt) } : null,
      byDay,
      items: queue.slice(0, 60).map(q => ({ by: handle(q.accountId), wt: q.wt, when: when(q.wt), text: cut(q.text, 100), kind: q.draft?.kind ?? "post" }))
    },
    pcs,
    cast,
    corps,
    others,
    citizens: { count: citizens.length, handles: citizens.slice(0, 40).map(a => tag(a.handle)) },
    formats,
    feeds: Object.fromEntries(Object.entries(garden.writer?.feeds ?? {}).filter(([, f]) => f.on).map(([app, f]) => [app, { keywords: f.keywords, accounts: f.accounts.map(handle).filter(Boolean), facts: ctx.feeds?.[app] ?? [] }])),
    happenings,
    seeds,
    unanswered,
    quiet: {
      voices: [...cast, ...corps].filter(a => !a.lastPost || a.lastPost.wt < quietCut).map(a => a.handle),
      pcs: pcs.filter(p => !p.lastAppeared || p.lastAppeared.wt < now - 7 * 86400).map(p => p.name),
      arcs: cast.filter(a => a.writer?.arc && (!a.lastPost || a.lastPost.wt < quietCut)).map(a => `${a.handle}: ${a.writer.arc}`)
    },
    recent,
    chatter: (garden.chatter ?? []).filter(c => c.until > now).map(c => ({ mood: c.mood ?? "any", keywords: c.keywords, text: c.text, until: when(c.until), used: c.used })),
    dating: { npcProfiles: Object.values(garden.dating?.profiles ?? {}).filter(p => !p.actorId).map(p => `${p.name} (${tag(p.handle)}, ${p.age})`) },
    drafts: ctx.drafts ?? { pending: [], reviews: [] }
  };
}

/** The pack for the GM to read (writer-pack.md): the same, short. */
export function packMarkdown(pack) {
  const out = [];
  const line = s => out.push(s);
  const list = (title, items, fmt = x => x) => {
    line(`\n## ${title}\n`);
    if (!items.length) line("_none_");
    for (const x of items) line(`- ${fmt(x)}`);
  };
  line(`# Garden writer pack: ${pack.worldTitle}`);
  line(`\nWorld \`${pack.world}\` · Garden now **${pack.baseLabel}** (${pack.clock} clock, base ${pack.base}) · written ${pack.written}`);
  if (pack.paused) line(`\n**The queue is paused** since ${pack.paused.label}.`);
  line(`\nQueue: ${pack.queue.count} waiting${pack.queue.until ? `, until ${pack.queue.until.label}` : ""}. Mix ${pack.mix ? `${pack.mix.city}/${pack.mix.close}/${pack.mix.about}` : "default"} (city/close/about).`);
  list("Characters", pack.pcs, p => `**${p.name}** ${p.handle ?? "(no account)"}, Rep ${p.reputation} (${p.naming}); last opened the Garden: ${p.lastOpenedGarden?.label ?? "never"}; last in the feed: ${p.lastAppeared?.label ?? "never"}`);
  list("Unanswered character posts", pack.unanswered, p => `${p.by} (${p.when}): ${cut(p.text, 100)}`);
  list("Happenings", pack.happenings, h => `[${h.stage}] ${h.what} @ ${h.place || "?"} (${h.heat}${h.public ? "" : ", GM-only"}, ${h.when})${h.direction ? ` — note: ${h.direction}` : ""}; fits: ${h.fits.map(f => f.handle).join(" ") || "nobody"}`);
  list("Seeds", pack.seeds, s => `[${s.stage}] ${s.what} (${s.obvious}${s.byLabel ? `, by ${s.byLabel}` : ""}); fits: ${s.fits.map(f => f.handle).join(" ") || "nobody"}`);
  list("Cast", pack.cast, a => `${a.handle} ${a.name}${a.writer?.arc ? `: ${a.writer.arc}` : ""} (last post ${a.lastPost?.label ?? "never"})`);
  list("Corporations", pack.corps, a => `${a.handle} ${a.name} (${a.corp?.tier ?? "?"}${a.corp?.face ? `, "${a.corp.face}"` : ""}; last post ${a.lastPost?.label ?? "never"})`);
  list("Formats", pack.formats, f => `${f.handle} ${f.when}: ${f.what}`);
  list("Quiet for a while", [...pack.quiet.voices, ...pack.quiet.pcs.map(n => `${n} (not in the feed for a week)`)]);
  line(`\nCrowd chatter live: ${pack.chatter?.length ?? 0} line(s)${pack.chatter?.length ? `, until ${pack.chatter.at(-1).until}` : ""}.`);
  list("Pending batches", pack.drafts.pending, b => `${b.id}: ${b.summary}`);
  list("Last reviews", pack.drafts.reviews, r => `${r.batch}: ${r.approved} approved, ${r.cut} cut, ${r.edited?.length ?? 0} edited${r.note ? `; note: ${r.note}` : ""}`);
  list("Recent posts", pack.recent.slice(0, 15), p => `${p.when} ${p.by}: ${cut(p.text, 100)}`);
  return `${out.join("\n")}\n`;
}

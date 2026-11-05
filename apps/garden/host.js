import { cleanImage, gm, MAX_NAME } from "../../scripts/host/validate.js";
import { DEFAULT_CONTACT_IMG } from "../../scripts/config.js";
import { findContact, getContacts, setContacts } from "../../scripts/model/contacts.js";
import { commsOn } from "../../scripts/model/features.js";
import {
  ATTITUDES, byNewest, cleanHandle, MATCHED, engagement, followersForRep, gardenClockMode, gardenConfig, gardenNow, gardenTiers, handleFrom, KINDS,
  postGrowth, postSettled, randomCitizen, randomPrompts, randomTier, replyMix, replyTime, repsOf, reputationOf, SEED_ACCOUNTS, syncGardenClock
} from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { clean } from "../../scripts/util/text.js";
import { methods as writerMethods, requests as writerRequests } from "./writer-host.js";
import { methods as draftsMethods, requests as draftsRequests } from "./drafts-host.js";
import { pickAutoReply } from "./replies.js";

/*
 * Host: The Garden and The Garden Dating (see apps/garden/model.js). The Garden runs on its clock
 * (gardenNow: world time when the phones follow it): queued posts go out when their time comes,
 * stamped with that time even when the clock jumped past it, and posts' numbers grow on in-game or
 * real minutes, whichever is further along, while random citizens reply. Everything is pushed to
 * players as their view of the Garden (gardenFor).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "garden-join": "_onGardenJoin",
  "garden-profile": "_onGardenProfile",
  "garden-post": "_onGardenPost",
  "garden-like": "_onGardenLike",
  "garden-graft": "_onGardenGraft",
  "garden-reply": "_onGardenReply",
  "dating-create": "_onDatingCreate",
  "dating-algorithm": "_onDatingAlgorithm",
  "dating-respond": "_onDatingRespond",
  "dating-unmatch": "_onDatingUnmatch",
  "dating-suggest": gm("_onDatingSuggest"),
  "garden-gm-post": gm("_onGardenGmPost"),
  "garden-gm-reply": gm("_onGardenGmReply"),
  "garden-drip": gm("_onGardenDrip"),
  "garden-queue": gm("_onGardenQueue"),
  "garden-account": gm("_onGardenAccount"),
  "garden-account-delete": gm("_onGardenAccountDelete"),
  "garden-generate": gm("_onGardenGenerate"),
  "garden-post-edit": gm("_onGardenPostEdit"),
  "garden-reply-delete": gm("_onGardenReplyDelete"),
  "dating-profile": gm("_onDatingProfile"),
  "dating-profile-delete": gm("_onDatingProfileDelete"),
  "dating-generate": gm("_onDatingGenerate"),
  ...writerRequests,
  ...draftsRequests
};

/** Posts kept (the oldest drop off). */
const MAX_POSTS = 250;
const MAX_REPLIES = 40;

/** A post's Reputation events: [{ actorId, delta, reason }], one per character (a single one is fine), or null. */
const cleanRep = rep => {
  const seen = new Set();
  const list = repsOf({ rep }).filter(r => r?.actorId && game.actors.get(r.actorId) && !seen.has(r.actorId) && seen.add(r.actorId))
    .slice(0, 20).map(r => ({ actorId: r.actorId, delta: Math.trunc(Number(r.delta) || 0), reason: clean(r.reason, 120) }));
  return list.length ? list : null;
};

/** An outcome id from its id or its name (any case), or null for random. */
const tierFrom = tier => {
  const want = String(tier ?? "").trim().toLowerCase();
  const tiers = gardenTiers();
  return want ? Object.keys(tiers).find(id => id === want || tiers[id].name.toLowerCase() === want) ?? null : null;
};

const owns = (user, actorId) => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");

export const methods = {
  ...writerMethods,
  ...draftsMethods,

  /** A new Garden starts with the news networks and the platform's own account. */
  _seedGarden() {
    if (syncGardenClock(this.garden, gardenClockMode(), gardenNow())) this.saveGarden();
    if (Object.keys(this.garden.accounts).length) return;
    for (const seed of SEED_ACCOUNTS) this._addAccount(seed);
  },

  _addAccount(data) {
    const id = foundry.utils.randomID();
    const account = {
      id,
      handle: cleanHandle(data.handle || data.name),
      name: clean(data.name, 60) || "Someone",
      avatar: data.avatar ?? null,
      bio: clean(data.bio, 200),
      kind: data.kind in KINDS ? data.kind : "citizen",
      verified: !!data.verified,
      followers: Math.max(0, Math.floor(Number(data.followers) || 0)),
      mood: data.mood in ATTITUDES ? data.mood : null,
      actorId: data.actorId ?? null,
      npc: clean(data.npc, 60) || null
    };
    // Handles are unique: add a number if one's taken.
    const taken = new Set(Object.values(this.garden.accounts).map(a => a.handle));
    for (let n = 2; taken.has(account.handle); n++) account.handle = `${cleanHandle(data.handle || data.name)}${n}`;
    this.garden.accounts[id] = account;
    return account;
  },

  /** A player's character's own account. */
  _pcAccount(actorId) {
    return Object.values(this.garden.accounts).find(a => a.actorId === actorId) ?? null;
  },

  _playerGarden(user, actorId) {
    const actor = game.actors.get(actorId);
    return actor && !user.isGM && owns(user, actorId) && this._citinet(actor, "garden") ? actor : null;
  },

  /** "Make an account": one tap, @their_name, followers from their Reputation. */
  _onGardenJoin(user, { actorId }) {
    const actor = this._playerGarden(user, actorId);
    if (!actor || this._pcAccount(actorId)) return;
    const name = displayName(actor);
    this._addAccount({ handle: handleFrom(name), name, avatar: actor.img, kind: "pc", actorId, followers: followersForRep(reputationOf(actor)) });
    this._pushGarden();
  },

  _onGardenProfile(user, { actorId, handle, name, bio, avatar }) {
    const account = this._pcAccount(actorId);
    if (!account || !owns(user, actorId)) return;
    if (handle) {
      const next = cleanHandle(handle);
      if (!Object.values(this.garden.accounts).some(a => a.handle === next && a !== account)) account.handle = next;
    }
    if (name !== undefined) account.name = clean(name, 60) || account.name;
    if (bio !== undefined) account.bio = clean(bio, 200);
    if (avatar !== undefined) account.avatar = cleanImage(avatar, user) ?? account.avatar;
    this._pushGarden();
  },

  /**
   * Publish a post now, dated `wt` (Garden time; now if not given, earlier for a queued post the
   * clock went past). `tier` is how far it travels (random if not given); `rep` tags Reputation
   * events about characters, which also go on their sheets.
   */
  async _publish(account, { text, image = null, tier = null, rep = null, wt = null }) {
    if (account.actorId) account.followers = Math.max(account.followers, followersForRep(reputationOf(game.actors.get(account.actorId))));
    const tiers = gardenTiers();
    tier = tier in tiers ? tier : randomTier(tiers);
    const eng = engagement(account.followers, tier, Math.random, tiers);
    const id = foundry.utils.randomID();
    this.garden.posts[id] = {
      id, accountId: account.id, text, image, ts: Date.now(), wt: Number.isFinite(wt) ? Math.min(wt, gardenNow()) : gardenNow(), tier, reach: eng.reach, likes: 0, grafts: 0, replies: [],
      likedBy: [], graftedBy: [], rep, eng: { likes: eng.likes, grafts: eng.grafts, replies: eng.replies, peak: eng.peak, mix: replyMix(account.kind) }
    };
    const posts = Object.values(this.garden.posts).sort(byNewest);
    for (const old of posts.slice(MAX_POSTS)) delete this.garden.posts[old.id];
    for (const r of repsOf({ rep })) if (r.delta) await this._reputation(game.actors.get(r.actorId), r.delta, r.reason || text, id);
    this._mentions(account, text, null, id);
    return this.garden.posts[id];
  },

  /** Put a Reputation event on the sheet (its reputation ledger, when the system keeps one). */
  async _reputation(actor, delta, reason, postId = null) {
    if (!actor) return;
    reason = clean(reason, 120);
    // Their Agent tells them (sent with the next _pushGarden), and opens the post that did it.
    const ref = postId ? { type: "garden-post", postId } : null;
    (this._gardenAlerts ??= []).push(this._alert(actor.id, { kind: "garden", from: "The Garden", text: `Reputation ${delta > 0 ? "+" : ""}${delta}: ${reason}`, ref }));
    if (typeof actor.deltaLedgerProperty === "function") return actor.deltaLedgerProperty("reputation", delta, `The Garden: ${reason}`);
    const value = reputationOf(actor);
    if (foundry.utils.hasProperty(actor.system ?? {}, "reputation.value")) return actor.update({ "system.reputation.value": Math.max(0, value + delta) });
  },

  /**
   * Characters @mentioned in a post (`postId`: the post, or the one replied to) hear about it from their Agent
   * (not the author of the post replied to: `skip`). Sent with the next _pushGarden.
   */
  _mentions(account, text, skip = null, postId = null) {
    for (const target of Object.values(this.garden.accounts)) {
      if (!target.actorId || target.id === account.id || target.id === skip) continue;
      if (new RegExp(`${target.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
        (this._gardenAlerts ??= []).push(this._alert(target.actorId, {
          kind: "garden", from: "The Garden", text: `${account.handle} mentioned you on the Garden: "${clean(text, 120)}"`,
          ref: postId ? { type: "garden-post", postId } : null
        }));
      }
    }
  },

  async _onGardenPost(user, { actorId, text, image }) {
    const actor = this._playerGarden(user, actorId);
    const account = actor ? this._pcAccount(actorId) : null;
    text = clean(text, 500);
    image = cleanImage(image, user);
    if (!account || (!text && !image)) return;
    const post = await this._publish(account, { text, image });
    this._gmCard({
      title: `Garden: ${account.handle} posted`, body: text || "(a picture)", icon: "fa-seedling", open: { app: "garden" },
      actions: [{ label: "Delete", icon: "fa-trash", request: "garden-post-edit", data: { postId: post.id, remove: true } }]
    });
    this._pushGarden();
  },

  /** Sprouts (likes) and grafts (shares) by a character's account: a toggle. */
  _toggleMark(user, { actorId, postId }, list, count) {
    const post = this.garden.posts[postId];
    const account = this._playerGarden(user, actorId) ? this._pcAccount(actorId) : null;
    if (!post || !account) return;
    const on = post[list].includes(account.id);
    post[list] = on ? post[list].filter(id => id !== account.id) : [...post[list], account.id];
    post[count] = Math.max(0, post[count] + (on ? -1 : 1));
    this._pushGarden();
  },

  _onGardenLike(user, data) {
    this._toggleMark(user, data, "likedBy", "likes");
  },

  _onGardenGraft(user, data) {
    this._toggleMark(user, data, "graftedBy", "grafts");
  },

  _onGardenReply(user, { actorId, postId, text }) {
    const post = this.garden.posts[postId];
    const account = this._playerGarden(user, actorId) ? this._pcAccount(actorId) : null;
    text = clean(text, 300);
    if (!post || !account || !text) return;
    this._addReply(post, account.id, text);
    this._mentions(account, text, post.accountId, post.id);
    this._pushGarden();
  },

  /** GM: reply to any post as an NPC or organization account (not a character's). */
  _onGardenGmReply(user, { accountId, postId, text }) {
    const post = this.garden.posts[postId];
    const account = this.garden.accounts[accountId];
    text = clean(text, 300);
    if (!post || !account || account.kind === "pc" || !text) return;
    this._addReply(post, account.id, text);
    this._mentions(account, text, post.accountId, post.id);
    this._pushGarden();
  },

  /**
   * A reply on a post. A character's own post: their Agent tells them (sent with the next _pushGarden),
   * unless it's `quiet` (the simulated chatter).
   */
  _addReply(post, accountId, text, wt = gardenNow(), { quiet = false } = {}) {
    const reply = { id: foundry.utils.randomID(), accountId, text, ts: Date.now(), wt };
    const author = this.garden.accounts[post.accountId];
    if (!quiet && author?.actorId && author.id !== accountId) {
      const by = this.garden.accounts[accountId]?.handle ?? "Someone";
      (this._gardenAlerts ??= []).push(this._alert(author.actorId, { kind: "garden", from: "The Garden", text: `${by} replied to your post: "${clean(text, 120)}"`, ref: { type: "garden-post", postId: post.id } }));
    }
    post.replies.push(reply);
    post.replies.sort((a, b) => a.wt - b.wt || a.ts - b.ts);
    if (post.replies.length > MAX_REPLIES) post.replies.splice(0, post.replies.length - MAX_REPLIES);
    return reply;
  },

  /* ---------------- GM: posting as anyone, and the queue ---------------- */

  /** GM: post as any account, now or in `delay` in-game minutes (Garden time). */
  async _onGardenGmPost(user, { accountId, text, image, tier, delay, rep }) {
    const account = this.garden.accounts[accountId];
    text = clean(text, 500);
    image = cleanImage(image, user);
    if (!account || (!text && !image)) return;
    rep = cleanRep(rep);
    const minutes = Math.max(0, Number(delay) || 0);
    tier = tier in gardenTiers() ? tier : null;
    if (minutes > 0) {
      this._enqueuePost({ id: foundry.utils.randomID(), accountId, text, image, tier, rep, wt: (this.garden.paused ?? gardenNow()) + minutes * 60 });
    } else await this._publish(account, { text, image, tier, rep });
    this._pushGarden();
  },

  /**
   * GM: a drip queue (typed, or a text file). One post per line, "@handle | text | picture | tier"
   * (only the text is required: no handle posts as `accountId`, which may be "@random"; "@random"
   * posts as a random citizen, picked when it goes out; a handle nobody has yet becomes a new
   * citizen), one every `every` in-game minutes, give or take `jitter`.
   */
  _onGardenDrip(user, { lines, accountId, every, jitter }) {
    const byHandle = new Map(Object.values(this.garden.accounts).map(a => [a.handle, a]));
    every = Math.max(0.5, Number(every) || 5);
    jitter = Math.max(0, Math.min(every, Number(jitter) || 0));
    const start = this.garden.paused ?? gardenNow();
    let at = Math.max(start, this.garden.queue.at(-1)?.wt ?? start);
    // Typed or from a file: the same lines (a file's byte-order mark and Windows line ends dropped).
    for (const line of String(lines ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const parts = line.split("|").map(s => s.trim());
      if (!parts.join("")) continue;
      // "@someone | text": a handle. "@someone hi" on its own is just text.
      const handle = parts.length > 1 && /^@\S+$/.test(parts[0]) ? parts.shift() : null;
      const [text, image, tier] = parts;
      if (!clean(text, 500)) continue;
      let account;
      if (/^@random$/i.test(handle ?? accountId ?? "")) account = { id: "@random" };
      else if (handle) {
        account = byHandle.get(cleanHandle(handle));
        if (!account) {
          account = this._addAccount({ ...randomCitizen(), handle });
          byHandle.set(account.handle, account);
        }
      } else account = this.garden.accounts[accountId];
      if (!account) continue;
      at += (every + (Math.random() * 2 - 1) * jitter) * 60;
      this.garden.queue.push({ id: foundry.utils.randomID(), accountId: account.id, text: clean(text, 500), image: cleanImage(image, user), tier: tierFrom(tier), wt: at });
    }
    this._sortQueue();
    this._pushGarden();
  },

  /** GM: manage the queue: remove, move up or down, post now, pause, resume, edit. */
  async _onGardenQueue(user, { op, id, item: change }) {
    const q = this.garden.queue;
    const i = q.findIndex(x => x.id === id);
    if (op === "pause" && !this.garden.paused) this.garden.paused = gardenNow();
    else if (op === "resume" && this.garden.paused) {
      // Paused in Garden time: the queue moves on by however far the clock went meanwhile.
      const shift = Math.max(0, gardenNow() - this.garden.paused);
      for (const item of q) item.wt += shift;
      this.garden.paused = null;
    } else if (op === "remove" && i >= 0) q.splice(i, 1);
    else if ((op === "up" || op === "down") && i >= 0) {
      const j = i + (op === "up" ? -1 : 1);
      if (j < 0 || j >= q.length) return;
      // Swap places, keeping the times where they were.
      [q[i].wt, q[j].wt] = [q[j].wt, q[i].wt];
      this._sortQueue();
    } else if (op === "edit" && i >= 0 && change) {
      // Every field: who, text, picture, outcome, when (in-game minutes from now, or from the pause), Reputation.
      const item = q[i];
      const text = clean(change.text, 500);
      const image = cleanImage(change.image, user);
      if (!text && !image) return;
      if (change.accountId === "@random" || this.garden.accounts[change.accountId]) item.accountId = change.accountId;
      Object.assign(item, { text, image, tier: change.tier in gardenTiers() ? change.tier : null, rep: cleanRep(change.rep) });
      if (change.minutes !== undefined) item.wt = (this.garden.paused ?? gardenNow()) + Math.max(0, Number(change.minutes) || 0) * 60;
      this._sortQueue();
    } else if (op === "now" && i >= 0) {
      const [item] = q.splice(i, 1);
      await this._releaseQueued(item, { now: true });
    } else return;
    this._pushGarden();
  },

  _enqueuePost(item) {
    this.garden.queue.push(item);
    this._sortQueue();
  },

  _sortQueue() {
    this.garden.queue.sort((a, b) => a.wt - b.wt);
  },

  /** Who a queued post goes out as: its account, or for "@random" a random citizen (a new one if there are none). */
  _queuedAccount(item) {
    if (item.accountId !== "@random") return this.garden.accounts[item.accountId] ?? null;
    const citizens = Object.values(this.garden.accounts).filter(a => a.kind === "citizen" && !a.actorId);
    return citizens[Math.floor(Math.random() * citizens.length)] ?? this._addAccount(randomCitizen());
  },

  _onGardenAccount(user, { account }) {
    if (!account) return;
    const existing = this.garden.accounts[account.id];
    if (!existing) {
      this._addAccount({ ...account, avatar: cleanImage(account.avatar, user) });
      return this._pushGarden();
    }
    if (account.handle && cleanHandle(account.handle) !== existing.handle && !Object.values(this.garden.accounts).some(a => a.handle === cleanHandle(account.handle))) existing.handle = cleanHandle(account.handle);
    if ("name" in account) existing.name = clean(account.name, 60) || existing.name;
    if ("bio" in account) existing.bio = clean(account.bio, 200);
    if ("avatar" in account) existing.avatar = cleanImage(account.avatar, user);
    if (account.kind in KINDS && !existing.actorId) existing.kind = account.kind;
    if ("verified" in account) existing.verified = !!account.verified;
    if ("followers" in account) existing.followers = Math.max(0, Math.floor(Number(account.followers) || 0));
    if ("npc" in account) existing.npc = clean(account.npc, 60) || null;
    if ("pinned" in account) existing.pinned = !!account.pinned;
    if ("mood" in account && !existing.actorId) existing.mood = account.mood in ATTITUDES ? account.mood : null;
    this._pushGarden();
  },

  _onGardenAccountDelete(user, { accountId }) {
    if (!this.garden.accounts[accountId]) return;
    delete this.garden.accounts[accountId];
    for (const post of Object.values(this.garden.posts)) if (post.accountId === accountId) delete this.garden.posts[post.id];
    this.garden.queue = this.garden.queue.filter(q => q.accountId !== accountId);
    this._pushGarden();
  },

  /** GM: fill the city with random citizens (pictures picked from `avatars`). */
  _onGardenGenerate(user, { count, avatars }) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 5)));
    const pics = (Array.isArray(avatars) ? avatars : []).map(a => cleanImage(a, user)).filter(Boolean);
    for (let i = 0; i < n; i++) this._addAccount(randomCitizen(pics));
    this._pushGarden();
  },

  /** GM: change how far a post travels (its numbers re-aim), or delete it. */
  _onGardenPostEdit(user, { postId, tier, remove }) {
    const post = this.garden.posts[postId];
    if (!post) return;
    if (remove) delete this.garden.posts[postId];
    else if (tier in gardenTiers()) {
      const account = this.garden.accounts[post.accountId];
      const eng = engagement(account?.followers ?? 50, tier);
      post.tier = tier;
      post.reach = eng.reach;
      post.eng = { ...post.eng, likes: eng.likes, grafts: eng.grafts, replies: eng.replies, peak: eng.peak };
      post.ts = Math.min(post.ts, Date.now() - 60_000); // keep it growing from where it is
    }
    this._pushGarden();
  },

  /** GM: delete a reply by an NPC or organization (characters' replies are the players'). */
  _onGardenReplyDelete(user, { postId, replyId }) {
    const post = this.garden.posts[postId];
    const reply = post?.replies.find(r => r.id === replyId);
    if (!reply || this.garden.accounts[reply.accountId]?.kind === "pc") return;
    post.replies = post.replies.filter(r => r !== reply);
    this._pushGarden();
  },

  /* ---------------- The clock ---------------- */

  /**
   * The Garden clock (every 30 real seconds, and when world time moves): queued posts that are due go
   * out, in order, each dated when it was due (a time skip lets days of posts out at once, backdated);
   * live posts gain sprouts, grafts and replies, and replies a catch-up adds are spread over the
   * post's life. No toast for any of it: players go and look (mentions and Reputation still notify).
   */
  async _tickGarden() {
    const nowMs = Date.now();
    let changed = syncGardenClock(this.garden, gardenClockMode(), gardenNow(), nowMs);
    const now = gardenNow();
    if (!this.garden.paused) {
      // Due on Garden time, or (Stir) on real time while the clock stands still: then dated now.
      const due = this.garden.queue.filter(q => q.wt <= now || q.realAt <= nowMs);
      this.garden.queue = this.garden.queue.filter(q => !due.includes(q));
      // A post (a batch's reply or private text too: drafts-host.js).
      for (const item of due) {
        await this._releaseQueued(item);
        changed = true;
      }
    }
    // Random citizens reply from the writer's chatter, then the word lists; the cast only to posts for
    // them (a mention, a tie, their keywords), corps and news never (their replies come from the
    // writer's batches): replies.js.
    const names = Object.fromEntries(game.actors.map(a => [a.id, a.name]));
    const chatter = this._gardenChatter(now);
    for (const post of Object.values(this.garden.posts)) {
      if (!post.eng || postSettled(post, now, nowMs)) continue;
      const g = postGrowth(post, now, nowMs);
      const likes = Math.round(post.eng.likes * g) + post.likedBy.length;
      const grafts = Math.round(post.eng.grafts * g) + post.graftedBy.length;
      if (likes > post.likes) [post.likes, changed] = [likes, true];
      if (grafts > post.grafts) [post.grafts, changed] = [grafts, true];
      // Auto-replies, a few at a time as the post grows.
      const auto = post.replies.filter(r => r.auto).length;
      const target = Math.round(post.eng.replies * g);
      for (let n = auto; n < target; n++) {
        const pick = pickAutoReply(post, this.garden.accounts, { total: post.eng.replies, names, chatter });
        if (!pick) continue; // their kind of reply has all been said in this thread
        if (pick.chatter) chatter.find(c => c.id === pick.chatter).used++;
        this._addReply(post, pick.account.id, pick.text, replyTime(post, (n + Math.random()) / Math.max(1, post.eng.replies), now), { quiet: true }).auto = true;
        changed = true;
      }
    }
    // The writer's inbox and pack (drafts-host.js).
    if (await this._tickDrafts()) changed = true;
    if (changed) this._pushGarden();
  },

  /* ---------------- The Garden Dating ---------------- */

  /**
   * A player's dating profile: its own, or their Garden Patch linked ("Use my Garden Patch"). Also
   * saves their edits (then `link` is left out and stays as it was).
   */
  _onDatingCreate(user, { actorId, link, age, prompts }) {
    if (!gardenConfig().dating) return;
    const actor = this._playerGarden(user, actorId);
    if (!actor) return;
    const profiles = this.garden.dating.profiles;
    let profile = Object.values(profiles).find(p => p.actorId === actorId);
    const account = link === undefined ? this.garden.accounts[profile?.accountId] ?? null : link ? this._pcAccount(actorId) : null;
    if (!profile) {
      profile = { id: foundry.utils.randomID(), actorId };
      profiles[profile.id] = profile;
    }
    Object.assign(profile, {
      accountId: account?.id ?? null,
      handle: account?.handle ?? profile.handle ?? handleFrom(displayName(actor)),
      name: account?.name ?? profile.name ?? displayName(actor),
      avatar: account?.avatar ?? profile.avatar ?? actor.img,
      age: Math.max(18, Math.min(120, Math.floor(Number(age) || profile.age || 25))),
      prompts: (Array.isArray(prompts) ? prompts : profile.prompts ?? []).map(p => clean(p, 120)).filter(Boolean).slice(0, 3)
    });
    this._pushGarden();
  },

  /**
   * "Activate the Algorithm": the character asks the Garden to find someone. The GM picks who the
   * Algorithm suggests (or no one); the player then Sparks or Passes, and a Spark is a match.
   */
  _onDatingAlgorithm(user, { actorId }) {
    if (!gardenConfig().dating) return;
    const actor = this._playerGarden(user, actorId);
    const mine = actor && Object.values(this.garden.dating.profiles).find(p => p.actorId === actorId);
    if (!mine) return;
    const sparks = this.garden.dating.sparks;
    if (Object.values(sparks).some(s => s.actorId === actorId && s.status === "searching")) return;
    const id = foundry.utils.randomID();
    sparks[id] = { id, actorId, profileId: null, status: "searching", ts: Date.now() };
    this._gmCard({ id: `algo:${id}`, title: "The Garden Dating", body: `${displayName(actor)} activated the Algorithm. Pick who it finds.`, icon: "fa-heart", open: { app: "garden", tab: "dating" } });
    this._pushGarden();
  },

  /** GM: who the Algorithm found (a profile), or no one this time (profileId empty). */
  _onDatingSuggest(user, { sparkId, profileId }) {
    const spark = this.garden.dating.sparks[sparkId];
    if (spark?.status !== "searching") return;
    this._gmCardDone(`algo:${sparkId}`);
    const profile = this.garden.dating.profiles[profileId];
    if (!profile) {
      delete this.garden.dating.sparks[sparkId];
      (this._gardenAlerts ??= []).push(this._alert(spark.actorId, { kind: "garden", from: "The Garden Dating", text: "The Algorithm found no one this time. Try again later." }));
    } else {
      Object.assign(spark, { profileId, status: "suggested", ts: Date.now() });
      (this._gardenAlerts ??= []).push(this._alert(spark.actorId, { kind: "garden", from: "The Garden Dating", text: `The Algorithm found someone: ${profile.name}, ${profile.age}. Open the Garden to see if there's a spark.` }));
    }
    this._pushGarden();
  },

  /**
   * The player's answer to who the Algorithm found. A Spark is a match: the match becomes one of the
   * character's contacts (the profile's NPC, or its name), with a conversation the GM can write in as
   * them.
   */
  async _onDatingRespond(user, { actorId, sparkId, spark: yes }) {
    if (!gardenConfig().dating) return;
    const spark = this.garden.dating.sparks[sparkId];
    const profile = this.garden.dating.profiles[spark?.profileId];
    const actor = this._playerGarden(user, actorId);
    if (!spark || spark.actorId !== actorId || spark.status !== "suggested" || !profile || !actor) return;
    spark.status = yes ? "matched" : "passed";
    // Communications off: a match touches neither Contacts nor Messages.
    if (yes && !commsOn()) {
      this._gmCard({ title: "The Garden Dating", body: `${displayName(actor)} and ${profile.name} matched.`, icon: "fa-heart", open: { app: "garden", tab: "dating" } });
      (this._gardenAlerts ??= []).push(this._alert(actorId, { kind: "garden", from: "The Garden Dating", text: `It's a match with ${profile.handle} (${profile.name})!` }));
    } else if (yes) {
      const name = clean(profile.npc || profile.name, MAX_NAME) || profile.handle;
      const contacts = getContacts(actor);
      let entry = findContact(contacts, name);
      if (!entry) {
        entry = { name, img: profile.avatar || DEFAULT_CONTACT_IMG };
        await setContacts(actor, [...contacts, entry]);
      }
      spark.contact = entry.name;
      const thread = this._getOrCreate(actor, entry.name, entry);
      this.save();
      this._push(thread);
      this._gmCard({ title: "The Garden Dating", body: `${displayName(actor)} and ${profile.name} matched. Text them as ${entry.name} when it suits the story.`, icon: "fa-heart", open: { app: "garden", tab: "dating" } });
      (this._gardenAlerts ??= []).push(this._alert(actorId, { kind: "garden", from: "The Garden Dating", text: `It's a match with ${profile.handle} (${profile.name})! They're in your contacts.` }));
    }
    this._pushGarden();
  },

  /** The player deletes a match: it's gone, and so is the contact the match added. */
  async _onDatingUnmatch(user, { actorId, sparkId }) {
    const spark = this.garden.dating.sparks[sparkId];
    const actor = this._playerGarden(user, actorId);
    if (!spark || spark.actorId !== actorId || !actor || !MATCHED.includes(spark.status)) return;
    const profile = this.garden.dating.profiles[spark.profileId];
    delete this.garden.dating.sparks[sparkId];
    const name = spark.contact?.toLowerCase();
    if (name) await setContacts(actor, getContacts(actor).filter(c => c.name.toLowerCase() !== name));
    this._gmCard({ title: "The Garden Dating", body: `${displayName(actor)} deleted their match with ${profile?.name ?? "someone"}.`, icon: "fa-heart-crack" });
    this._pushGarden();
  },

  /** GM: an NPC's dating profile. */
  _onDatingProfile(user, { profile }) {
    if (!profile) return;
    const profiles = this.garden.dating.profiles;
    const p = profiles[profile.id] ?? { id: foundry.utils.randomID() };
    if (p.actorId) return;
    Object.assign(p, {
      handle: cleanHandle(profile.handle || profile.name || p.handle),
      name: clean(profile.name, 60) || p.name || "Someone",
      avatar: "avatar" in profile ? cleanImage(profile.avatar, user) : p.avatar ?? null,
      age: Math.max(18, Math.min(120, Math.floor(Number(profile.age) || p.age || 25))),
      prompts: (Array.isArray(profile.prompts) ? profile.prompts : p.prompts ?? []).map(x => clean(x, 120)).filter(Boolean).slice(0, 3),
      npc: clean(profile.npc, 60) || null
    });
    profiles[p.id] = p;
    this._pushGarden();
  },

  _onDatingProfileDelete(user, { profileId }) {
    const p = this.garden.dating.profiles[profileId];
    if (!p || p.actorId) return;
    delete this.garden.dating.profiles[profileId];
    for (const s of Object.values(this.garden.dating.sparks)) if (s.profileId === profileId) delete this.garden.dating.sparks[s.id];
    this._pushGarden();
  },

  /** GM: filler profiles, from random citizens. */
  _onDatingGenerate(user, { count, avatars }) {
    const n = Math.max(1, Math.min(20, Math.floor(Number(count) || 5)));
    const pics = (Array.isArray(avatars) ? avatars : []).map(a => cleanImage(a, user)).filter(Boolean);
    for (let i = 0; i < n; i++) {
      const c = randomCitizen(pics);
      const id = foundry.utils.randomID();
      this.garden.dating.profiles[id] = { id, handle: c.handle, name: c.name, avatar: c.avatar, age: 19 + Math.floor(Math.random() * 30), prompts: randomPrompts(), npc: null };
    }
    this._pushGarden();
  }
};

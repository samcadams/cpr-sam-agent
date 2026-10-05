import { cleanImage, gm, MAX_NAME } from "./validate.js";
import { DEFAULT_CONTACT_IMG } from "../config.js";
import { findContact, getContacts, setContacts } from "../model/contacts.js";
import { canUsePhone } from "../model/agent.js";
import { commsOn } from "../model/features.js";
import {
  ATTITUDES, cleanHandle, MATCHED, engagement, followersForRep, gardenConfig, gardenTiers, growth, handleFrom, KINDS, liveMinutes, pickMood, randomCitizen,
  randomPrompts, randomTier, replyLine, replyMix, repsOf, reputationOf, SEED_ACCOUNTS
} from "../model/garden.js";
import { displayName } from "../model/threads.js";
import { clean } from "../util/text.js";

/*
 * Host: The Garden and The Garden Dating (see model/garden.js). Posts' numbers grow over real
 * minutes, and random citizens reply; queued posts go out on their own. Everything is pushed to
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
  "dating-generate": gm("_onDatingGenerate")
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
  /** A new Garden starts with the news networks and the platform's own account. */
  _seedGarden() {
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
    return actor && !user.isGM && owns(user, actorId) && canUsePhone(actor) ? actor : null;
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
   * Publish a post now. `tier` is how far it travels (random if not given); `rep` tags Reputation
   * events about characters, which also go on their sheets.
   */
  async _publish(account, { text, image = null, tier = null, rep = null }) {
    if (account.actorId) account.followers = Math.max(account.followers, followersForRep(reputationOf(game.actors.get(account.actorId))));
    const tiers = gardenTiers();
    tier = tier in tiers ? tier : randomTier(tiers);
    const eng = engagement(account.followers, tier, Math.random, tiers);
    const id = foundry.utils.randomID();
    this.garden.posts[id] = {
      id, accountId: account.id, text, image, ts: Date.now(), tier, reach: eng.reach, likes: 0, grafts: 0, replies: [],
      likedBy: [], graftedBy: [], rep, eng: { likes: eng.likes, grafts: eng.grafts, replies: eng.replies, peak: eng.peak, mix: replyMix(account.kind) }
    };
    const posts = Object.values(this.garden.posts).sort((a, b) => a.ts - b.ts);
    for (const old of posts.slice(0, Math.max(0, posts.length - MAX_POSTS))) delete this.garden.posts[old.id];
    for (const r of repsOf({ rep })) if (r.delta) await this._reputation(game.actors.get(r.actorId), r.delta, r.reason || text);
    this._mentions(account, text);
    return this.garden.posts[id];
  },

  /** Put a Reputation event on the sheet (its reputation ledger, when the system keeps one). */
  async _reputation(actor, delta, reason) {
    if (!actor) return;
    reason = clean(reason, 120);
    if (typeof actor.deltaLedgerProperty === "function") return actor.deltaLedgerProperty("reputation", delta, `The Garden: ${reason}`);
    const value = reputationOf(actor);
    if (foundry.utils.hasProperty(actor.system ?? {}, "reputation.value")) return actor.update({ "system.reputation.value": Math.max(0, value + delta) });
  },

  /** Characters @mentioned in a post hear about it from their Agent. */
  _mentions(account, text) {
    const ids = [];
    for (const target of Object.values(this.garden.accounts)) {
      if (!target.actorId || target.id === account.id) continue;
      if (new RegExp(`${target.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
        ids.push(this._alert(target.actorId, { kind: "garden", text: `${account.handle} mentioned you on the Garden: "${clean(text, 120)}"` }));
      }
    }
    if (ids.length) this._pushApps(ids.filter(Boolean));
  },

  async _onGardenPost(user, { actorId, text, image }) {
    const actor = this._playerGarden(user, actorId);
    const account = actor ? this._pcAccount(actorId) : null;
    text = clean(text, 500);
    image = cleanImage(image, user);
    if (!account || (!text && !image)) return;
    const post = await this._publish(account, { text, image });
    this._gmCard({
      title: `Garden: ${account.handle} posted`, body: text || "(a picture)", icon: "fa-seedling",
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
    this._mentions(account, text);
    this._pushGarden();
  },

  /** GM: reply to any post as an NPC or organization account (not a character's). */
  _onGardenGmReply(user, { accountId, postId, text }) {
    const post = this.garden.posts[postId];
    const account = this.garden.accounts[accountId];
    text = clean(text, 300);
    if (!post || !account || account.kind === "pc" || !text) return;
    this._addReply(post, account.id, text);
    this._mentions(account, text);
    this._pushGarden();
  },

  _addReply(post, accountId, text) {
    post.replies.push({ id: foundry.utils.randomID(), accountId, text, ts: Date.now() });
    if (post.replies.length > MAX_REPLIES) post.replies.splice(0, post.replies.length - MAX_REPLIES);
  },

  /* ---------------- GM: posting as anyone, and the queue ---------------- */

  /** GM: post as any account, now or in `delay` minutes. */
  async _onGardenGmPost(user, { accountId, text, image, tier, delay, rep }) {
    const account = this.garden.accounts[accountId];
    text = clean(text, 500);
    image = cleanImage(image, user);
    if (!account || (!text && !image)) return;
    rep = cleanRep(rep);
    const minutes = Math.max(0, Number(delay) || 0);
    tier = tier in gardenTiers() ? tier : null;
    if (minutes > 0) {
      this.garden.queue.push({ id: foundry.utils.randomID(), accountId, text, image, tier, rep, at: Date.now() + minutes * 60_000 });
      this.garden.queue.sort((a, b) => a.at - b.at);
    } else await this._publish(account, { text, image, tier, rep });
    this._pushGarden();
  },

  /**
   * GM: a drip queue (typed, or a text file). One post per line, "@handle | text | picture | tier"
   * (only the text is required: no handle posts as `accountId`, which may be "@random"; "@random"
   * posts as a random citizen, picked when it goes out; a handle nobody has yet becomes a new
   * citizen), one every `every` minutes, give or take `jitter`.
   */
  _onGardenDrip(user, { lines, accountId, every, jitter }) {
    const byHandle = new Map(Object.values(this.garden.accounts).map(a => [a.handle, a]));
    every = Math.max(0.5, Number(every) || 5);
    jitter = Math.max(0, Math.min(every, Number(jitter) || 0));
    const last = this.garden.queue.at(-1)?.at ?? Date.now();
    let at = Math.max(Date.now(), last);
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
      at += (every + (Math.random() * 2 - 1) * jitter) * 60_000;
      this.garden.queue.push({ id: foundry.utils.randomID(), accountId: account.id, text: clean(text, 500), image: cleanImage(image, user), tier: tierFrom(tier), at });
    }
    this.garden.queue.sort((a, b) => a.at - b.at);
    this._pushGarden();
  },

  /** GM: manage the queue: remove, move up or down, post now, pause, resume, edit. */
  async _onGardenQueue(user, { op, id, item: change }) {
    const q = this.garden.queue;
    const i = q.findIndex(x => x.id === id);
    if (op === "pause" && !this.garden.paused) this.garden.paused = Date.now();
    else if (op === "resume" && this.garden.paused) {
      const shift = Date.now() - this.garden.paused;
      for (const item of q) item.at += shift;
      this.garden.paused = null;
    } else if (op === "remove" && i >= 0) q.splice(i, 1);
    else if ((op === "up" || op === "down") && i >= 0) {
      const j = i + (op === "up" ? -1 : 1);
      if (j < 0 || j >= q.length) return;
      // Swap places, keeping the times where they were.
      [q[i].at, q[j].at] = [q[j].at, q[i].at];
      q.sort((a, b) => a.at - b.at);
    } else if (op === "edit" && i >= 0 && change) {
      // Every field: who, text, picture, outcome, when (minutes from now, or from the pause), Reputation.
      const item = q[i];
      const text = clean(change.text, 500);
      const image = cleanImage(change.image, user);
      if (!text && !image) return;
      if (change.accountId === "@random" || this.garden.accounts[change.accountId]) item.accountId = change.accountId;
      Object.assign(item, { text, image, tier: change.tier in gardenTiers() ? change.tier : null, rep: cleanRep(change.rep) });
      if (change.minutes !== undefined) item.at = (this.garden.paused ?? Date.now()) + Math.max(0, Number(change.minutes) || 0) * 60_000;
      q.sort((a, b) => a.at - b.at);
    } else if (op === "now" && i >= 0) {
      const [item] = q.splice(i, 1);
      const account = this._queuedAccount(item);
      if (account) await this._publish(account, item);
    } else return;
    this._pushGarden();
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

  /** Real minutes: queued posts go out, and live posts gain sprouts, grafts and replies. */
  async _tickGarden() {
    const now = Date.now();
    let changed = false;
    if (!this.garden.paused) {
      while (this.garden.queue[0]?.at <= now) {
        const item = this.garden.queue.shift();
        const account = this._queuedAccount(item);
        if (account) await this._publish(account, item);
        changed = true;
      }
    }
    // Whoever has an attitude replies (random citizens, and any NPC account the GM gave one).
    const citizens = Object.values(this.garden.accounts).filter(a => a.mood && !a.actorId);
    for (const post of Object.values(this.garden.posts)) {
      const minutes = (now - post.ts) / 60_000;
      if (!post.eng || minutes > liveMinutes(post.eng.peak) + 1) continue;
      const g = growth(minutes, post.eng.peak);
      const likes = Math.round(post.eng.likes * g) + post.likedBy.length;
      const grafts = Math.round(post.eng.grafts * g) + post.graftedBy.length;
      if (likes > post.likes) [post.likes, changed] = [likes, true];
      if (grafts > post.grafts) [post.grafts, changed] = [grafts, true];
      // Replies from random citizens, a few at a time as the post grows.
      const auto = post.replies.filter(r => r.auto).length;
      const due = Math.round(post.eng.replies * g) - auto;
      for (let i = 0; i < due && citizens.length; i++) {
        const mood = pickMood(post.eng.mix);
        const fits = citizens.filter(c => c.mood === mood);
        const from = (fits.length ? fits : citizens)[Math.floor(Math.random() * (fits.length || citizens.length))];
        const line = replyLine(mood, Math.random, undefined, post.replies.map(r => r.text));
        if (!line) continue; // their kind of reply has all been said in this thread
        this._addReply(post, from.id, line);
        post.replies.at(-1).auto = true;
        changed = true;
      }
    }
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
    const profile = this.garden.dating.profiles[profileId];
    if (!profile) {
      delete this.garden.dating.sparks[sparkId];
      this._alertNow(spark.actorId, { kind: "garden", from: "The Garden Dating", text: "The Algorithm found no one this time. Try again later." });
    } else {
      Object.assign(spark, { profileId, status: "suggested", ts: Date.now() });
      this._alertNow(spark.actorId, { kind: "garden", from: "The Garden Dating", text: `The Algorithm found someone: ${profile.name}, ${profile.age}. Open the Garden to see if there's a spark.` });
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
      this._alertNow(actorId, { kind: "garden", from: "The Garden Dating", text: `It's a match with ${profile.handle} (${profile.name})!` });
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
      this._alertNow(actorId, { kind: "garden", from: "The Garden Dating", text: `It's a match with ${profile.handle} (${profile.name})! They're in your contacts.` });
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

import { cleanImage, gm } from "../../scripts/host/validate.js";
import { dataFolder, MODULE_ID } from "../../scripts/config.js";
import { simpleCalendar } from "../../scripts/util/agentTime.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { clean } from "../../scripts/util/text.js";
import { cleanHandle, gardenClockMode, gardenNow, gardenTiers, gardenWhen, randomCitizen, reputationOf } from "./model.js";
import { batchMix, batchSummary, CORP_FIELDS, handleKey, parseDrafts, resolveDrafts } from "./drafts.js";
import { buildPack, INBOX, PACK_FILE, PACK_MD, packMarkdown } from "./pack.js";
import { cleanCorp, cleanFormat, cleanProfile, writerCharacters } from "./writer.js";

/*
 * Host: the Garden's drafts (plan: handoff GARDEN-LIFE-PROPOSAL-2026-10-22 §9, §11, §13). The host
 * keeps the writer pack saved (cpr-sam-agent/garden/writer-pack.json + .md) for the garden-writer skill,
 * reads the batches the skill writes into cpr-sam-agent/garden/inbox/, and on the GM's approval puts
 * them in the queue (posts, replies, private texts: they go out on Garden time, backdated) or
 * applies them (Dating profiles, profile changes, stages). Merged into the Garden's host (host.js).
 *
 *   garden.drafts: {
 *     imported: [file names],                 never read again
 *     batches: { [id]: Batch },               waiting in the Drafts tab
 *     reviews: [{ batch, ts, approved, cut, edited: [{ key, before, after }], note }]   for the next pack
 *     posted: { "<batch>:<key>": postId }     where a batch's posts went (its replies attach there)
 *   }
 *   Batch: { id, file, world, base, baseNote, ts, notes, errors, warnings, summary, mix, items }
 *   queue items from a batch carry draft: { batch, key, kind: "post"|"reply"|"msg", parent?, postId?, from?, to? }
 *
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "garden-drafts-approve": gm("_onGardenDraftsApprove"),
  "garden-drafts-discard": gm("_onGardenDraftsDiscard"),
  "garden-drafts-feedback": gm("_onGardenDraftsFeedback"),
  "garden-pack": gm("_onGardenPack")
};

const MAX_REVIEWS = 10;
const MAX_IMPORTED = 500;
/** Seconds between the old drip lines of a batch without times. */
const LEGACY_EVERY = 5 * 60;
/** How long a batch's chatter lines stay in the crowd's mouth (Garden time): the week the batch covers. */
const CHATTER_LIFE = 7 * 86400;
/** The pack is written at most this often (real ms) when the Garden changes. */
const PACK_EVERY = 10_000;

const picker = () => FilePicker.implementation ?? FilePicker;
const fileName = path => decodeURIComponent(String(path).split("/").pop());

/** A tier id from its id or name (any case), or null for random. */
const tierFrom = tier => {
  const want = String(tier ?? "").trim().toLowerCase();
  const tiers = gardenTiers();
  return want ? Object.keys(tiers).find(id => id === want || tiers[id].name.toLowerCase() === want) ?? null : null;
};

/** The in-game days from today on (for the skill's formats): [{ wt (midnight), label, weekday }]. */
function gardenDays(now, count = 8) {
  const sc = gardenClockMode() === "world" ? simpleCalendar() : null;
  const days = [];
  let midnight;
  if (sc) {
    try {
      const d = sc.timestampToDate(now);
      midnight = now - (d.hour * 3600 + d.minute * 60 + (d.seconds ?? 0));
    } catch {
      midnight = null;
    }
  }
  if (midnight == null) {
    if (gardenClockMode() === "world") midnight = now - (((now % 86400) + 86400) % 86400);
    else {
      const d = new Date(now * 1000);
      d.setHours(0, 0, 0, 0);
      midnight = d.getTime() / 1000;
    }
  }
  for (let i = 0; i < count; i++) {
    const wt = midnight + i * 86400;
    let weekday;
    try {
      weekday = sc ? sc.timestampToDate(wt).display?.weekday ?? null : gardenClockMode() === "real" ? new Date(wt * 1000).toLocaleDateString("en", { weekday: "long" }) : null;
    } catch {
      weekday = null;
    }
    days.push({ wt, label: gardenWhen(wt, now).replace(/, \d\d?:\d\d.*$/, ""), weekday });
  }
  return days;
}

export const methods = {
  /** The drafts' part of the Garden (older Gardens have none yet). */
  _gardenDrafts() {
    const g = this.garden;
    g.drafts ??= {};
    g.drafts.imported ??= [];
    g.drafts.batches ??= {};
    g.drafts.reviews ??= [];
    g.drafts.posted ??= {};
    return g.drafts;
  },

  /** The writer's chatter still live at Garden time `now` (expired lines dropped): replies.js chatterLine. */
  _gardenChatter(now = gardenNow()) {
    const g = this.garden;
    g.chatter = (g.chatter ?? []).filter(c => c.until > now);
    return g.chatter;
  },

  /* ---------------- The clock: the inbox and the pack ---------------- */

  /**
   * On the Garden's tick: read new batches from the inbox, and save the pack when the Garden changed
   * since it was last written. True if the Garden changed.
   */
  async _tickDrafts() {
    let changed = false;
    try {
      changed = await this._readInbox();
    } catch (err) {
      console.warn(`${MODULE_ID} | Garden inbox: could not read it`, err);
    }
    if (this._packKey() !== this._packWritten && Date.now() - (this._packAt ?? 0) >= PACK_EVERY) await this._writePack();
    return changed;
  },

  /**
   * What the pack depends on, cheaply: it's written again when this changes (not while posts only
   * grow their numbers).
   */
  _packKey() {
    const g = this.garden;
    const posts = Object.values(g.posts);
    const replies = posts.reduce((n, p) => n + p.replies.filter(r => !r.auto).length, 0);
    return JSON.stringify([
      game.time?.worldTime, posts.length, posts.reduce((m, p) => Math.max(m, p.ts), 0), replies, g.queue.length, g.paused, Object.keys(g.accounts).length,
      g.writer, g.happenings, g.seeds, g.seen, Object.keys(g.drafts?.batches ?? {}), g.drafts?.reviews?.length, Object.keys(g.dating?.profiles ?? {}).length,
      posts.reduce((n, p) => n + p.likedBy.length + p.graftedBy.length, 0)
    ]);
  },

  /** New batch files in the inbox → batches waiting for the GM. */
  async _readInbox() {
    const drafts = this._gardenDrafts();
    const dir = `${dataFolder()}/${INBOX}`;
    let found = await picker().browse("data", dir).catch(() => null);
    if (!found) {
      await picker().createDirectory("data", dir).catch(() => null);
      return false;
    }
    const done = new Set(drafts.imported);
    this._inboxSkipped ??= new Set();
    const files = found.files.map(fileName).filter(f => f.endsWith(".txt") && !f.endsWith(".feedback.txt") && !done.has(f) && !this._inboxSkipped.has(f)).sort();
    let changed = false;
    for (const file of files) {
      const route = foundry.utils.getRoute(`${dir}/${encodeURIComponent(file)}`);
      const response = await fetch(`${route}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      const batch = this._draftBatch(file, await response.text());
      if (!batch) continue;
      drafts.imported = [...drafts.imported, file].slice(-MAX_IMPORTED);
      drafts.batches[batch.id] = batch;
      changed = true;
      const n = batch.items.length;
      ui.notifications.info(batch.errors.length ? `Garden drafts: batch ${batch.id} has ${batch.errors.length} error(s); see the Drafts tab.` : `Garden drafts: a new batch, ${batch.summary}.`);
      this._gmCard?.({ id: `drafts:${batch.id}`, title: "Garden drafts", body: `${n ? batch.summary : "An empty batch"}. Review it in the Garden's Drafts tab.`, icon: "fa-feather", open: { app: "garden", tab: "drafts" } });
    }
    return changed;
  },

  /** A batch read from its file, ready for the Drafts tab; null (and left in the inbox) if it's for another world. */
  _draftBatch(file, text) {
    const parsed = parseDrafts(text, { tiers: Object.entries(gardenTiers()).flatMap(([id, t]) => [id, t.name.toLowerCase()]) });
    if (!parsed.legacy && parsed.world && parsed.world !== game.world.id) {
      this._inboxSkipped.add(file);
      console.warn(`${MODULE_ID} | Garden inbox: ${file} is for world "${parsed.world}", not this one; left in the inbox.`);
      return null;
    }
    let id = (parsed.batch || file.replace(/\.txt$/, "")).replace(/[^\w.-]/g, "_");
    if (this.garden.drafts.batches[id]) {
      parsed.warnings.push({ line: 1, message: `another batch called ${id} is waiting too` });
      id = `${id}-${foundry.utils.randomID(4)}`;
    }
    if (parsed.legacy) parsed.base = gardenNow();
    const items = resolveDrafts(parsed, this._draftContext()).map((item, i) => ({ ...item, include: !item.problems.length, ...(item.at === null ? { wt: parsed.base + (i + 1) * LEGACY_EVERY } : {}) }));
    return {
      id,
      file, world: parsed.world, base: parsed.base, baseNote: parsed.baseNote, ts: Date.now(), legacy: parsed.legacy,
      notes: parsed.notes, errors: parsed.errors, warnings: parsed.warnings, summary: batchSummary(items), mix: batchMix(items), items
    };
  },

  /** What resolveDrafts needs: accounts, the players' characters by name, posts, happenings, seeds. */
  _draftContext() {
    const actors = playerCharacters().map(a => ({ id: a.id, name: a.name, aliases: [displayName(a)].filter(n => n && n !== a.name) }));
    return { accounts: this.garden.accounts, actors, posts: this.garden.posts, happenings: this.garden.happenings ?? {}, seeds: this.garden.seeds ?? {} };
  },

  /** Save the writer pack now (and remember when, for the tick). */
  async _writePack() {
    this._packAt = Date.now();
    this._packWritten = this._packKey();
    try {
      const pack = this._buildPack();
      await this._upload(PACK_FILE, JSON.stringify(pack, null, 1));
      await this._upload(PACK_MD, packMarkdown(pack));
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not save the Garden writer pack`, err);
      return false;
    }
    return true;
  },

  _buildPack() {
    const now = gardenNow();
    const drafts = this._gardenDrafts();
    // The Writer tab's list (players' characters the GM didn't take off it).
    const pcs = writerCharacters(playerCharacters(), this.garden.writer).map(a => ({ actorId: a.id, name: displayName(a), reputation: reputationOf(a), role: a.system?.roleInfo?.activeRole ?? null }));
    return buildPack(this.garden, {
      world: game.world.id, worldTitle: game.world.title, now, nowMs: Date.now(), clock: gardenClockMode(),
      when: wt => gardenWhen(wt, now), days: gardenDays(now), pcs, tiers: Object.keys(gardenTiers()), feeds: this._feedFacts(),
      drafts: {
        pending: Object.values(drafts.batches).map(b => ({ id: b.id, summary: b.summary, errors: b.errors.length })),
        reviews: drafts.reviews
      }
    });
  },

  /**
   * Facts from the apps whose writer feeds are on: their newest table rows, as they are (trimmed).
   * The skill reads them; nothing posts from them by itself.
   */
  _feedFacts() {
    const TABLES = { weather: ["weather"], ncpd: ["ncpdLookups"], roach: ["roachRiders"], market: ["orders"], cbk: ["receipts"], trauma: ["dispatches"], cabb: ["rides"] };
    const out = {};
    for (const [app, feed] of Object.entries(this.garden.writer?.feeds ?? {})) {
      if (!feed?.on) continue;
      const rows = (TABLES[app] ?? []).flatMap(t => Object.values(this.apps?.[t] ?? {}));
      out[app] = rows.filter(r => r && typeof r === "object").sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, 8).map(r => {
        const { gm: _gm, ...rest } = r;
        const json = JSON.stringify(rest);
        return json.length > 400 ? `${json.slice(0, 399)}…` : json;
      });
      if (app === "roach") out[app].push(JSON.stringify(game.settings.get(MODULE_ID, "roachBoard")?.scores?.slice?.(0, 5) ?? []));
    }
    return out;
  },

  /** GM: the Writer pack button. */
  async _onGardenPack() {
    return this._writePack();
  },

  /* ---------------- The GM's review ---------------- */

  /**
   * GM: approve a batch. `items`: the Drafts tab's state, [{ key, include, text?, wt?, tier?, ring? }]
   * (missing keys keep the batch's own). Posts, replies and texts go into the queue (due ones out at
   * once, backdated); Dating profiles, profile changes and stages apply now.
   */
  async _onGardenDraftsApprove(user, { batchId, items: state = [], note = "" }) {
    const drafts = this._gardenDrafts();
    const batch = drafts.batches[batchId];
    if (!batch || batch.errors.length) return;
    const byKey = new Map((Array.isArray(state) ? state : []).map(s => [s.key, s]));
    const edited = [];
    let approved = 0;
    let cut = 0;
    const byHandle = new Map(Object.values(this.garden.accounts).map(a => [a.handle, a]));
    const accountFor = item => {
      if (item.accountId === "@random") return "@random";
      if (item.accountId && this.garden.accounts[item.accountId]) return item.accountId;
      const handle = cleanHandle(item.newHandle ?? item.handle);
      let account = byHandle.get(handle);
      if (!account) {
        account = this._addAccount({ ...randomCitizen(), handle });
        byHandle.set(account.handle, account);
      }
      return account.id;
    };
    const queuedWt = new Map();
    const included = item => (byKey.get(item.key)?.include ?? item.include) && !item.problems.length;
    // Accounts first: the batch's other drafts may be by them.
    for (const item of batch.items.filter(i => i.kind === "account" && included(i))) {
      const account = this._applyDraftAccount(item);
      if (account) byHandle.set(account.handle, account);
    }
    /** An account the batch named by handle (made just now, or existing), or null. */
    const named = handle => (handle ? byHandle.get(cleanHandle(handle)) ?? null : null);

    for (const original of batch.items) {
      const s = byKey.get(original.key) ?? {};
      const item = { ...original };
      if (s.text !== undefined && clean(s.text, 1000) && s.text !== original.text) {
        item.text = clean(s.text, 1000);
        edited.push({ key: item.key, before: original.text, after: item.text });
      }
      if (Number.isFinite(Number(s.wt)) && s.wt !== null && s.wt !== "") item.wt = Number(s.wt);
      if (s.tier !== undefined) item.tier = s.tier || null;
      const include = s.include ?? original.include;
      // A reply whose post was cut goes too.
      const parentGone = item.kind === "reply" && item.to.key && !queuedWt.has(item.to.key);
      if (item.kind === "account") {
        if (include && !item.problems.length) approved++;
        else cut++;
        continue;
      }
      if (!include || parentGone || (item.problems.length && item.kind !== "post" && item.kind !== "reply") || (item.kind === "post" && item.problems.some(p => /character's account/.test(p)))) {
        cut++;
        continue;
      }
      approved++;
      const draft = { batch: batch.id, key: item.key, kind: item.kind };
      // Drafts by an account this batch made: its id only now.
      if (!item.accountId && ["dating", "format", "profile"].includes(item.kind)) item.accountId = named(item.kind === "format" ? item.handle : item.who?.startsWith("@") ? item.who : null)?.id ?? null;
      if (item.kind === "post") {
        const rep = (item.rep ?? []).filter(r => r.actorId && game.actors.get(r.actorId)).map(r => ({ actorId: r.actorId, delta: Math.trunc(r.delta) || 0, reason: clean(r.reason, 120) }));
        const q = { id: foundry.utils.randomID(), accountId: accountFor(item), text: clean(item.text, 500), image: cleanImage(item.img, user), tier: tierFrom(item.tier), rep: rep.length ? rep : null, wt: item.wt, draft };
        queuedWt.set(item.key, q.wt);
        this._enqueuePost(q);
      } else if (item.kind === "reply") {
        const wt = item.to.key ? Math.max(item.wt, queuedWt.get(item.to.key)) : item.wt;
        this._enqueuePost({ id: foundry.utils.randomID(), accountId: accountFor(item), text: clean(item.text, 300), image: null, tier: null, wt, draft: { ...draft, parent: item.to.key ?? null, postId: item.to.postId ?? null } });
      } else if (item.kind === "msg") {
        this._enqueuePost({ id: foundry.utils.randomID(), accountId: null, text: clean(item.text, 1000), image: null, tier: null, wt: item.wt, draft: { ...draft, from: clean(item.from, 60), to: item.toIds.filter(Boolean) } });
      } else if (item.kind === "dating") this._applyDraftDating(item);
      else if (item.kind === "format") {
        const f = cleanFormat({ accountId: item.accountId, when: item.when, what: item.what }, this.garden.accounts);
        if (f) this._gardenWriter().formats.push(f);
      }
      else if (item.kind === "profile") this._applyDraftProfile(item);
      else if (item.kind === "chatter") {
        const until = (batch.base ?? gardenNow()) + CHATTER_LIFE;
        this._gardenChatter().push({ id: foundry.utils.randomID(), batch: batch.id, mood: item.mood, keywords: item.keywords, text: clean(item.text, 300), until, used: 0 });
      }
      else if (item.kind === "stage") {
        const target = (item.what === "seed" ? this.garden.seeds : this.garden.happenings)?.[item.id];
        if (target) target.stage = item.stage;
      }
    }

    drafts.reviews = [...drafts.reviews, { batch: batch.id, ts: Date.now(), approved, cut, edited: edited.slice(0, 20), note: clean(note, 500) }].slice(-MAX_REVIEWS);
    delete drafts.batches[batch.id];
    this._pushGarden();
    // What's already due goes out now, backdated.
    await this._tickGarden();
    return { approved, cut };
  },

  /** A Dating profile from a batch: a cast member's (their account's name and picture) or a new person's. */
  _applyDraftDating(item) {
    const account = item.accountId ? this.garden.accounts[item.accountId] : null;
    const id = foundry.utils.randomID();
    this.garden.dating.profiles[id] = {
      id,
      handle: account?.handle ?? cleanHandle(item.who),
      name: account?.name ?? clean(item.who, 60),
      avatar: account?.avatar ?? null,
      age: Math.max(18, Math.min(120, Math.floor(item.age))),
      prompts: item.prompts.map(p => clean(p, 120)).filter(Boolean).slice(0, 3),
      npc: account?.npc ?? null,
      accountId: account?.id ?? null
    };
  },

  /** An account from a batch: a new one, or a change to an NPC's (name, kind, bio, followers). */
  _applyDraftAccount(item) {
    const existing = Object.values(this.garden.accounts).find(a => handleKey(a.handle) === handleKey(item.handle));
    if (existing?.actorId) return null;
    if (!existing) {
      return this._addAccount({ handle: item.handle, name: item.name, kind: item.accountKind, bio: item.bio, followers: item.followers ?? { corp: 20000, news: 30000, celebrity: 50000 }[item.accountKind] ?? 300 });
    }
    Object.assign(existing, { name: clean(item.name, 60) || existing.name, kind: item.accountKind, bio: clean(item.bio, 200) || existing.bio });
    if (item.followers !== null) existing.followers = Math.max(0, Math.floor(item.followers));
    return existing;
  },

  /** A profile change from a batch ("@handle :: arc: ..."). */
  _applyDraftProfile(item) {
    this._gardenWriter();
    const corpFields = CORP_FIELDS;
    if (item.actorId) {
      const old = this.garden.writer.pcs[item.actorId] ?? {};
      if (!corpFields.includes(item.field)) this.garden.writer.pcs[item.actorId] = cleanProfile({ ...old, [item.field]: item.value });
      return;
    }
    const account = this.garden.accounts[item.accountId];
    if (!account) return;
    if (corpFields.includes(item.field)) {
      if (account.kind !== "corp") return;
      const corp = account.corp ?? {};
      const change = item.field === "calendar" ? { calendar: [...(corp.calendar ?? []), { wt: item.wt, what: item.value.what }] }
        : item.field === "relation" ? { relations: [...(corp.relations ?? []).filter(r => r.actorId !== item.value.actorId), { actorId: item.value.actorId, kind: item.value.kind, note: item.value.note }] }
        : { [item.field]: item.value };
      account.corp = cleanCorp({ ...corp, ...change }, id => (game.actors.get(id) ? id : null));
    } else account.writer = cleanProfile({ ...(account.writer ?? {}), [item.field]: item.value });
  },

  /** GM: throw a batch away (the file stays in the inbox, never read again). */
  _onGardenDraftsDiscard(user, { batchId, note = "" }) {
    const drafts = this._gardenDrafts();
    const batch = drafts.batches[batchId];
    if (!batch) return;
    drafts.reviews = [...drafts.reviews, { batch: batch.id, ts: Date.now(), approved: 0, cut: batch.items.length, edited: [], note: clean(note, 500) || "discarded" }].slice(-MAX_REVIEWS);
    delete drafts.batches[batchId];
    this._pushGarden();
  },

  /** GM: a note for the writer about a batch (inbox/<batchId>.feedback.txt; the skill reads it next run). */
  async _onGardenDraftsFeedback(user, { batchId, text }) {
    const note = String(text ?? "").trim().slice(0, 4000);
    const id = String(batchId ?? "").replace(/[^\w.-]/g, "_");
    if (!note || !id) return false;
    const drafts = this._gardenDrafts();
    if (drafts.batches[id]) drafts.batches[id].feedback = note;
    await this._upload(`${INBOX}/${id}.feedback.txt`, `${note}\n`);
    this._pushGarden();
    return true;
  },

  /* ---------------- Going out ---------------- */

  /**
   * A queued item goes out (the tick, or "Post now"): a post (any), or from a batch a reply or a
   * private text. Replies are dated with their own time (never before their post); texts go out now.
   */
  async _releaseQueued(item, { now = false } = {}) {
    const draft = item.draft;
    if (draft?.kind === "reply") {
      const drafts = this._gardenDrafts();
      const post = this.garden.posts[draft.postId ?? drafts.posted[`${draft.batch}:${draft.parent}`]];
      if (!post) return null;
      const account = this._queuedAccount(item);
      if (!account) return null;
      const wt = now ? gardenNow() : Math.min(gardenNow(), Math.max(item.wt, post.wt));
      const reply = this._addReply(post, account.id, item.text, wt);
      this._mentions(account, item.text);
      return reply;
    }
    if (draft?.kind === "msg") {
      for (const actorId of draft.to ?? []) {
        if (game.actors.get(actorId)) await this._onSend(game.user, { actorId, contact: draft.from, text: item.text });
      }
      return true;
    }
    const account = this._queuedAccount(item);
    if (!account) return null;
    const post = await this._publish(account, now ? { ...item, wt: null } : item);
    if (draft && post) {
      const drafts = this._gardenDrafts();
      drafts.posted[`${draft.batch}:${draft.key}`] = post.id;
      // Old batches' posts: forget them after a while (the newest 300 are plenty for late replies).
      const keys = Object.keys(drafts.posted);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete drafts.posted[k];
    }
    return post;
  }
};

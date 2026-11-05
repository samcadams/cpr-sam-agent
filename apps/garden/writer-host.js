import { gm } from "../../scripts/host/validate.js";
import { gardenLists, gardenNow } from "./model.js";
import { cleanCorp, cleanFormat, cleanHappening, cleanProfile, cleanSeed, DEFAULT_MIX, emptyWriter, FEED_APPS, keywordList, stirPlan } from "./writer.js";

/*
 * Host: the Garden's writer side (apps/garden/writer.js): writer profiles, the cast's lines, corps,
 * formats, app feeds, happenings ("Log an event", with Stir), seeds, and when each character last
 * opened the Garden. All GM-only but `garden-seen`. Merged into the Garden's host (host.js).
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "garden-seen": "_onGardenSeen",
  "garden-writer-profile": gm("_onGardenWriterProfile"),
  "garden-writer-characters": gm("_onGardenWriterCharacters"),
  "garden-happening": gm("_onGardenHappening"),
  "garden-happening-delete": gm("_onGardenHappeningDelete"),
  "garden-seed": gm("_onGardenSeed"),
  "garden-seed-delete": gm("_onGardenSeedDelete"),
  "garden-format": gm("_onGardenFormat"),
  "garden-feed": gm("_onGardenFeed"),
  "garden-mix": gm("_onGardenMix")
};

/** A character id from an id or a name (relations typed by name). */
const actorIdOf = ref => (game.actors.get(ref) ? ref : game.actors.find(a => a.name.toLowerCase() === String(ref ?? "").trim().toLowerCase())?.id ?? null);

export const methods = {
  /** The writer's part of the Garden (older Gardens have none yet). */
  _gardenWriter() {
    const g = this.garden;
    g.writer ??= emptyWriter();
    g.writer.pcs ??= {};
    g.writer.ignore ??= [];
    g.writer.formats ??= [];
    g.writer.feeds ??= {};
    g.writer.mix ??= { ...DEFAULT_MIX };
    g.happenings ??= {};
    g.seeds ??= {};
    g.seen ??= {};
    return g.writer;
  },

  /** A player's character opened the Garden (their phone says so, now and then). Shown to no one; for the writer. */
  _onGardenSeen(user, { actorId }) {
    if (!this._playerGarden(user, actorId)) return;
    this._gardenWriter();
    this.garden.seen[actorId] = { wt: gardenNow(), ts: Date.now() };
    this.saveGarden();
  },

  /**
   * GM: an account's writer profile (and a corporation's fields), or a character's (`actorId`: kept
   * in the Garden, whether or not they have an account).
   */
  _onGardenWriterProfile(user, { accountId, actorId, profile, corp }) {
    const writer = this._gardenWriter();
    if (actorId) {
      if (!game.actors.get(actorId)) return;
      writer.pcs[actorId] = cleanProfile(profile);
    } else {
      const account = this.garden.accounts[accountId];
      if (!account) return;
      if (profile) account.writer = cleanProfile(profile);
      if (corp && account.kind === "corp") account.corp = cleanCorp(corp, actorIdOf);
    }
    this._pushGarden();
  },

  /**
   * GM: which players' characters the writer leaves out (garden.writer.ignore). `ignore`: the whole
   * list (the Writer tab's dialog), or `actorId` + `ignore: true|false` for one character.
   */
  _onGardenWriterCharacters(user, { actorId, ignore }) {
    const writer = this._gardenWriter();
    let list = writer.ignore.filter(id => game.actors.get(id));
    if (Array.isArray(ignore)) list = [...new Set(ignore.map(String))].filter(id => game.actors.get(id));
    else if (actorId && game.actors.get(actorId)) list = ignore ? [...new Set([...list, actorId])] : list.filter(id => id !== actorId);
    else return;
    writer.ignore = list.slice(0, 200);
    this._pushGarden();
  },

  /**
   * GM: log a happening, or change one (stage, text...). `stir`: instant reactions from the word
   * lists now (the "Stir now" box), `thing`: what people call it in them.
   */
  _onGardenHappening(user, { happening, stir, thing }) {
    this._gardenWriter();
    const old = happening?.id ? this.garden.happenings[happening.id] : null;
    const h = cleanHappening({ ...(old ?? {}), ...happening }, { now: gardenNow(), actorIds: id => !!game.actors.get(id) });
    if (!h) return;
    this.garden.happenings[h.id] = h;
    if (stir) this._stir(h, thing);
    this._pushGarden();
    // The writer pack straight away, so "/garden-writer live" sees it (drafts-host.js).
    this._writePack();
    return h.id;
  },

  _onGardenHappeningDelete(user, { id }) {
    if (!this.garden.happenings?.[id]) return;
    delete this.garden.happenings[id];
    this._pushGarden();
  },

  /**
   * Stir: chatter about a happening from the reactions word lists, queued over the next in-game hour,
   * and going out on the next real minutes too if the clock stands still (realAt).
   */
  _stir(happening, thing) {
    const accounts = this.garden.accounts;
    const citizens = Object.values(accounts).filter(a => a.kind === "citizen" && !a.actorId);
    const plan = stirPlan(happening, { accounts, citizens, lists: gardenLists(), thing: String(thing ?? "").trim() || null });
    const now = gardenNow();
    const nowMs = Date.now();
    for (const p of plan) {
      this._enqueuePost({ id: foundry.utils.randomID(), accountId: p.accountId ?? "@random", text: p.text, image: null, tier: null, wt: now + p.delay, realAt: nowMs + p.realDelay, stir: happening.id });
    }
    return plan.length;
  },

  _onGardenSeed(user, { seed }) {
    this._gardenWriter();
    const old = seed?.id ? this.garden.seeds[seed.id] : null;
    const s = cleanSeed({ ...(old ?? {}), ...seed }, { accounts: this.garden.accounts });
    if (!s) return;
    this.garden.seeds[s.id] = s;
    this._pushGarden();
    this._writePack();
    return s.id;
  },

  _onGardenSeedDelete(user, { id }) {
    if (!this.garden.seeds?.[id]) return;
    delete this.garden.seeds[id];
    this._pushGarden();
  },

  /** GM: add or change a recurring format, or remove it. */
  _onGardenFormat(user, { format, remove }) {
    const writer = this._gardenWriter();
    if (remove) writer.formats = writer.formats.filter(f => f.id !== format?.id);
    else {
      const f = cleanFormat(format, this.garden.accounts);
      if (!f) return;
      const i = writer.formats.findIndex(x => x.id === f.id);
      if (i >= 0) writer.formats[i] = f;
      else writer.formats.push(f);
    }
    this._pushGarden();
  },

  /** GM: an app's writer feed: on or off, keywords, which accounts may talk about it. */
  _onGardenFeed(user, { app, feed }) {
    if (!(app in FEED_APPS)) return;
    const writer = this._gardenWriter();
    writer.feeds[app] = {
      on: !!feed?.on,
      keywords: keywordList(feed?.keywords),
      accounts: (Array.isArray(feed?.accounts) ? feed.accounts : []).filter(id => this.garden.accounts[id]).slice(0, 12)
    };
    this._pushGarden();
  },

  /** GM: the batch mix (percent; normalized to 100). */
  _onGardenMix(user, { mix }) {
    const writer = this._gardenWriter();
    const raw = Object.fromEntries(Object.keys(DEFAULT_MIX).map(k => [k, Math.max(0, Number(mix?.[k]) || 0)]));
    const total = Object.values(raw).reduce((a, b) => a + b, 0);
    writer.mix = total ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v * 100) / total)])) : { ...DEFAULT_MIX };
    this._pushGarden();
  }
};

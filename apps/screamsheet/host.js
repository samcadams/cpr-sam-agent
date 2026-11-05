import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { feature } from "../../scripts/model/features.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { skillRollCard } from "../../scripts/util/cpr-roll.js";
import { clean } from "../../scripts/util/text.js";
import { agentMods, BIG_SAAI, librarySearchBase } from "../alex/model.js";
import { hasAddon } from "../pool/model.js";
import { reputationOf } from "../garden/model.js";
import { hqApi } from "../notes/model.js";
import { weatherDay } from "../weather/dates.js";
import {
  activeTerms, clipFields, DESK, gardenSuggestion, isFrontPage, journalDraft, PICKUP_TIERS, repSuggestion, screamsheetPool,
  surfaced, uniqueTerms, watchTerms
} from "./model.js";
import { cleanSheet, summary } from "./render.js";

/*
 * Host: DataPool (see apps/screamsheet/model.js). The GM's desk (write, schedule, publish, bin), the
 * crawls (passive once per in-world day per character and on every publish; the deep crawl's roll, which
 * the GM confirms), and the suggested clippings: Reputation events on a character's sheet, viral Garden
 * posts, and journal entries prepared as screamsheets.
 * Players' pushes are their share of the tables (model/apps.js appsFor): Front Page headlines, the
 * clippings their characters pulled, their own crawl rows; drafts, GM notes and the deep crawl's
 * proposed finds never leave the host.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "scream-terms": "_onScreamTerms",
  "scream-read": "_onScreamRead",
  "scream-deep": "_onScreamDeep",
  "scream-save": gm("_onScreamSave"),
  "scream-delete": gm("_onScreamDelete"),
  "scream-resolve": gm("_onScreamResolve"),
  "scream-journal": gm("_onScreamJournal"),
  "scream-crawl": gm("_onScreamCrawl")
};

const FROM = "DataPool";
/** Reputation events the app itself put on a sheet (a published clipping's) start with this: no suggestion for them. */
const REP_PREFIX = "DataPool:";

const owns = (user, actorId) => !!game.actors.get(actorId)?.testUserPermission(user, "OWNER");

export const methods = {
  _clips() {
    return (this.apps.screamClips ??= {});
  },

  _crawlRow(actorId) {
    return ((this.apps.screamCrawls ??= {})[actorId] ??= {});
  },

  _screamDesk() {
    const desk = this._crawlRow(DESK);
    desk.rep ??= {};
    desk.journal ??= [];
    return desk;
  },

  /** Names, crews and crewmates for matching (model.js clipHaystack, canReach). */
  _screamCtx() {
    const pcs = playerCharacters();
    const api = hqApi();
    const hqs = Object.fromEntries(pcs.map(a => [a.id, api?.crewHQsOf ? api.crewHQsOf(a) : []]));
    const names = Object.fromEntries(pcs.map(a => [a.id, displayName(a)]));
    for (const clip of Object.values(this._clips())) for (const id of clip.subjects ?? []) names[id] ??= displayName(game.actors.get(id)) || "";
    return {
      names,
      crews: Object.fromEntries(pcs.map(a => [a.id, hqs[a.id].map(e => e.name)])),
      mates: Object.fromEntries(pcs.map(a => [a.id, pcs.filter(b => b !== a && hqs[b.id].some(e => hqs[a.id].includes(e))).map(b => b.id)]))
    };
  },

  /** A character's watchlist, with their Garden handle and crews filled in. */
  _screamTerms(actor, ctx = this._screamCtx()) {
    const row = this._crawlRow(actor.id);
    const handle = Object.values(this.garden?.accounts ?? {}).find(a => a.actorId === actor.id && a.kind === "pc")?.handle ?? null;
    return watchTerms({ name: displayName(actor), handle, crews: ctx.crews[actor.id] ?? [], aliases: row.aliases, extra: row.extra, muted: row.muted });
  },

  _screamAlert(actorId, text) {
    return this._alert(actorId, { kind: "event", from: FROM, app: "screamsheet", text });
  },

  async _screamLoad() {
    // Start watching the sheets' Reputation as it is now: only later events become suggestions.
    const desk = this._screamDesk();
    for (const actor of playerCharacters()) desk.rep[actor.id] ??= { n: actor.system?.reputation?.transactions?.length ?? 0, value: reputationOf(actor) };
    await this._tickScream({ push: false });
  },

  /** The clock: scheduled clippings go out, each character's daily crawl, viral Garden posts become suggestions. */
  async _tickScream({ push = true } = {}) {
    if (!feature("app_screamsheet")) return;
    let published = false;
    const told = [];
    for (const clip of Object.values(this._clips())) {
      if (clip.status === "scheduled" && game.time.worldTime >= (clip.at ?? 0)) {
        told.push(...(await this._screamPublish(clip, { crawl: false })));
        published = true;
      }
    }
    const picked = this._screamGarden();
    // Something went out: everyone's Agent crawls; otherwise only those who haven't today.
    const crawled = this._screamCrawl({ daily: !published });
    if ((published || picked || crawled.changed) && push) this._pushApps([...told, ...crawled.alerts].filter(Boolean));
  },

  /**
   * The passive crawl: matching Headlines (DV 0) for each character with signal. `daily`: only those who
   * haven't crawled today (in-world). Returns { changed, alerts } (not pushed).
   */
  _screamCrawl({ daily = false, actorIds = null } = {}) {
    const today = weatherDay(0).key;
    const ctx = this._screamCtx();
    const out = { changed: false, alerts: [] };
    for (const actor of playerCharacters()) {
      if (actorIds && !actorIds.includes(actor.id)) continue;
      const row = this._crawlRow(actor.id);
      if (daily && row.day === today) continue;
      if (!canUsePhone(actor)) continue; // no signal: no new crawls, what's pulled stays
      const found = this._screamPull(actor.id, surfaced(this._clips(), actor.id, activeTerms(this._screamTerms(actor, ctx)), 0, ctx));
      Object.assign(row, { day: today, last: agentTimestamp().time });
      out.changed = true;
      if (found.length) out.alerts.push(this._screamAlert(actor.id, found.length === 1 ? `Your Agent pulled a new mention from the Pool: "${summary(found[0].sheet).headline}"` : `Your Agent pulled ${found.length} new mentions from the Pool.`));
    }
    return out;
  },

  /** These clippings are now this character's. */
  _screamPull(actorId, clips) {
    for (const clip of clips) clip.actorIds = [...new Set([...(clip.actorIds ?? []), actorId])];
    return clips;
  },

  /** Out it goes: dated in world time, its Reputation events on the sheets, and everyone's Agent crawls. */
  async _screamPublish(clip, { crawl = true } = {}) {
    const { time, date } = agentTimestamp();
    Object.assign(clip, { status: "published", pub: Date.now(), date, time, actorIds: clip.actorIds ?? [] });
    delete clip.at;
    clip.everyone = isFrontPage(clip);
    const told = [];
    for (const r of clip.rep ?? []) {
      const actor = game.actors.get(r.actorId);
      await this._screamRep(actor, r.delta, r.reason || summary(clip.sheet).headline);
      // Told like the Garden's Reputation events.
      if (actor && r.delta) told.push(this._alert(actor.id, { kind: "event", from: FROM, app: "screamsheet", text: `Reputation ${r.delta > 0 ? "+" : ""}${r.delta}: ${summary(clip.sheet).headline}` }));
    }
    Hooks.callAll(`${MODULE_ID}.screamPublished`, foundry.utils.deepClone(clip));
    return [...told, ...(crawl ? this._screamCrawl().alerts : [])];
  },

  /** A clipping's Reputation event, on the sheet's ledger when the system keeps one. */
  async _screamRep(actor, delta, reason) {
    if (!actor || !delta) return;
    const text = `${REP_PREFIX} ${clean(reason, 100)}`;
    if (typeof actor.deltaLedgerProperty === "function") return actor.deltaLedgerProperty("reputation", delta, text);
    if (foundry.utils.hasProperty(actor.system ?? {}, "reputation.value")) return actor.update({ "system.reputation.value": Math.max(0, reputationOf(actor) + delta) });
  },

  /** A suggested clipping (a draft) and a card for the GM (unless the caller sends one card for several). */
  _screamSuggest(data, { card = true } = {}) {
    const id = foundry.utils.randomID();
    this._clips()[id] = { id, ts: Date.now(), status: "draft", ...data };
    if (card) this._gmCard({ title: "DataPool: suggested clipping", body: `${summary(data.sheet).headline} (${data.source?.label ?? ""})`, icon: "fa-newspaper", open: { app: "screamsheet" } });
    return id;
  },

  /** Viral Garden posts since the last look. Returns whether any were picked up. */
  _screamGarden() {
    const posts = Object.values(this.garden?.posts ?? {});
    if (!posts.length) return false;
    const desk = this._screamDesk();
    const newest = Math.max(...posts.map(p => p.ts ?? 0));
    // The first look only marks where the feed is: old posts aren't news.
    if (desk.garden === undefined) {
      desk.garden = newest;
      return true;
    }
    let found = false;
    const viral = posts.filter(p => (p.ts ?? 0) > desk.garden && PICKUP_TIERS.has(p.tier)).sort((a, b) => a.ts - b.ts);
    // One card for a busy tick.
    for (const post of viral) this._screamSuggest(gardenSuggestion(post, this.garden.accounts?.[post.accountId]), { card: viral.length === 1 });
    if (viral.length > 1) this._gmCard({ title: `DataPool: ${viral.length} suggested clippings`, body: "Viral Garden posts are waiting on the desk.", icon: "fa-newspaper", open: { app: "screamsheet" } });
    if (viral.length) found = true;
    if (newest > desk.garden) {
      desk.garden = newest;
      found = true;
    }
    return found;
  },

  /** A character's sheet changed (client.js, updateActor): a new Reputation event becomes a suggested clipping. */
  _onScreamActor(actor, changes) {
    if (!this.isHost || !feature("app_screamsheet") || !foundry.utils.hasProperty(changes, "system.reputation")) return;
    if (!playerCharacters().includes(actor)) return;
    const desk = this._screamDesk();
    const seen = desk.rep[actor.id];
    const ledger = actor.system?.reputation?.transactions ?? [];
    const now = { n: ledger.length, value: reputationOf(actor) };
    desk.rep[actor.id] = now;
    const delta = seen ? now.value - seen.value : 0;
    if (!delta) return this.save();
    const reason = now.n > (seen?.n ?? 0) ? String(ledger.at(-1)?.[1] ?? "") : "";
    if (reason.startsWith(REP_PREFIX)) return this.save();
    this._screamSuggest(repSuggestion({ actorId: actor.id, name: displayName(actor), delta, reason }));
    this._pushApps();
  },

  /* ---------- players ---------- */

  _onScreamTerms(user, { actorId, extra, aliases, muted }) {
    if (!owns(user, actorId) || actorId === DESK) return;
    const row = this._crawlRow(actorId);
    if (extra !== undefined) row.extra = uniqueTerms(extra);
    if (aliases !== undefined) row.aliases = uniqueTerms(aliases, 10);
    if (muted !== undefined) row.muted = uniqueTerms(muted);
    this._pushApps();
  },

  _onScreamRead(user, { actorId, clipIds }) {
    if (!owns(user, actorId) || actorId === DESK || !Array.isArray(clipIds)) return;
    const row = this._crawlRow(actorId);
    row.read ??= {};
    let changed = false;
    for (const id of clipIds) {
      if (this._clips()[id] && !row.read[id]) changed = row.read[id] = 1;
    }
    if (changed) this._pushApps();
  },

  /**
   * A deep crawl: the player's Library Search (the sheet's own roll on their client, reporting the
   * total and its chat card, taken only if that user just posted it; without the skill item, rolled
   * here: 1d10 + INT + skill + 2 for the Agent, crits as Cyberpunk RED's). What it reaches waits for the GM.
   */
  async _onScreamDeep(user, { actorId, total, detail, messageId }) {
    const actor = game.actors.get(actorId);
    if (!actor || !owns(user, actorId) || !this._citinet(actor, "screamsheet")) return;
    const row = this._crawlRow(actorId);
    if (row.deep?.status === "review") return;
    if (messageId !== undefined) {
      total = Math.floor(Number(total));
      let card = game.messages.get(messageId);
      if (!card) card = await new Promise(r => setTimeout(() => r(game.messages.get(messageId)), 1500));
      const fresh = card && (card.author ?? card.user)?.id === user.id && Date.now() - (card.timestamp ?? 0) < 120_000;
      if (!fresh || !Number.isFinite(total) || total < -20 || total > 80) return;
      detail = clean(detail, 200);
    } else {
      const base = librarySearchBase(actor, hasAddon(this.apps.installs, actorId, BIG_SAAI));
      const rolled = await skillRollCard(
        { skill: "Library Search", stat: "int", statValue: base.int, level: base.level, mods: agentMods([], base.bigSaai, "DataPool") },
        { speaker: ChatMessage.getSpeaker({ actor }), flavor: "Library Search (DataPool deep crawl)", rollMode: "publicroll" }
      );
      const extra = rolled.crit;
      total = rolled.total;
      detail = `${rolled.die}${extra ? ` ${extra > 0 ? "+" : "−"} ${Math.abs(extra)}` : ""} + ${base.int} INT + ${base.level} skill + ${base.bonus} Agent${base.bigSaai ? " + Big SAAI" : ""}`;
    }
    const ctx = this._screamCtx();
    const found = surfaced(this._clips(), actorId, activeTerms(this._screamTerms(actor, ctx)), total, ctx);
    row.deep = { status: "review", total, detail, ts: Date.now() };
    row.found = found.map(c => c.id);
    this._gmCard({
      title: `DataPool: ${displayName(actor)} crawls deep`,
      body: `Library Search ${total}: reaches ${found.length} clipping${found.length === 1 ? "" : "s"}. Confirm or change it on the desk.`,
      icon: "fa-dice-d10", open: { app: "screamsheet" }
    });
    this._pushApps();
  },

  /* ---------- the GM's desk ---------- */

  /**
   * GM: confirm a deep crawl (or hand clippings to a character at any time): these clippings are theirs
   * ("you also find this…"). An empty list is "Nothing new past page 1".
   */
  _onScreamResolve(user, { actorId, clipIds = [] }) {
    const actor = game.actors.get(actorId);
    if (!actor || actorId === DESK) return;
    const row = this._crawlRow(actorId);
    const clips = (Array.isArray(clipIds) ? clipIds : []).map(id => this._clips()[id]).filter(c => c?.status === "published" && !(c.actorIds ?? []).includes(actorId));
    this._screamPull(actorId, clips);
    const deep = row.deep?.status === "review";
    if (deep) Object.assign(row.deep, { status: "done", n: clips.length });
    delete row.found;
    const text = clips.length
      ? clips.length === 1 ? `Your Agent dug up "${summary(clips[0].sheet).headline}".` : `Your Agent dug up ${clips.length} clippings.`
      : "Nothing new past page 1.";
    this._pushApps(deep || clips.length ? [this._screamAlert(actorId, text)] : []);
  },

  /** GM: save a clipping (new or changed; a scheduled one stays scheduled), and publish it now or schedule it `hours` of world time ahead. */
  async _onScreamSave(user, { clip: raw, publish = false, hours = 0 }) {
    if (!raw || typeof raw !== "object") return;
    const clips = this._clips();
    // A new clipping may bring its own id (the editor's, so saving again updates it).
    const old = raw.id ? clips[raw.id] : null;
    if (raw.id && !old && !/^[A-Za-z0-9]{16}$/.test(raw.id)) return;
    const id = old?.id ?? raw.id ?? foundry.utils.randomID();
    const clip = old ?? { id, ts: Date.now(), status: "draft", source: raw.source?.kind === "api" ? { kind: "api", ref: null, label: "" } : { kind: raw.source?.kind === "claude" ? "claude" : "gm", ref: null, label: user.name } };
    Object.assign(clip, clipFields(raw, a => !!game.actors.get(a)), { sheet: cleanSheet(raw.sheet) });
    if (clip.status === "published") clip.everyone = isFrontPage(clip);
    clips[id] = clip;
    let alerts = [];
    hours = Number(hours) || 0;
    if (publish && clip.status !== "published") {
      if (hours > 0) Object.assign(clip, { status: "scheduled", at: game.time.worldTime + Math.round(hours * 3600) });
      else alerts = await this._screamPublish(clip);
    }
    this._pushApps(alerts);
    return id;
  },

  _onScreamDelete(user, { clipId }) {
    if (!this._clips()[clipId]) return;
    delete this._clips()[clipId];
    for (const row of Object.values(this.apps.screamCrawls ?? {})) {
      if (row.read) delete row.read[clipId];
      if (row.found) row.found = row.found.filter(id => id !== clipId);
    }
    this._pushApps();
  },

  /** GM: a draft from a journal entry prepared as a screamsheet (a "Screamsheets" folder or a "Screamsheet:" line). */
  _onScreamJournal(user, { entryId }) {
    const entry = game.journal.get(entryId);
    const item = entry ? screamsheetPool([entry])[0] : null;
    if (!item) return;
    const find = name => game.actors.find(a => a.name === name || displayName(a) === name)?.id ?? null;
    const id = foundry.utils.randomID();
    this._clips()[id] = { id, ts: Date.now(), status: "draft", ...journalDraft(item, find) };
    const desk = this._screamDesk();
    desk.journal = [...new Set([...desk.journal, entryId])];
    this._pushApps();
    return id;
  },

  /** GM (and the API): crawl now. Without `total`: the passive crawl; with it, a deep crawl taken as is. */
  _onScreamCrawl(user, { actorId = null, total = null }) {
    if (total === null || total === undefined) {
      const { alerts } = this._screamCrawl({ actorIds: actorId ? [actorId] : null });
      return this._pushApps(alerts);
    }
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const ctx = this._screamCtx();
    const found = surfaced(this._clips(), actorId, activeTerms(this._screamTerms(actor, ctx)), Math.floor(Number(total) || 0), ctx);
    this._onScreamResolve(user, { actorId, clipIds: found.map(c => c.id) });
  }
};

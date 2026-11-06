import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { agentMods, BIG_SAAI, librarySearchBase } from "../alex/model.js";
import { hasAddon } from "../pool/model.js";
import { hqApi } from "../notes/model.js";
import { anthropicOn } from "../../scripts/model/features.js";
import { addSpend, aiSettings, overCap } from "../alex/page.js";
import { reputationOf } from "../garden/model.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { activeTerms, clipRow, DEPTHS, DESK, REACHES, screamsheetPool, SOURCES, SPINS, watchTerms } from "./model.js";
import { clipRequest, clipSheet, clipTags, runClip } from "./ai.js";
import { OUTLETS, sheetText } from "./render.js";
import { openEditor } from "./editor.js";
import { openReader } from "./reader.js";

/*
 * Phone page: DataPool (see apps/screamsheet/model.js). Players: the Front Page (public headlines) and My
 * Crawl: what their Agent pulled about them (unread marked), what it watches for (the automatic terms,
 * which a tap mutes; what they added in "Look for something", which a tap drops) and the deep crawl.
 * A clipping opens in its own window, page sized (apps/screamsheet/reader.js).
 * The GM Phone is the desk: deep crawls to confirm, suggested clippings, drafts, scheduled, journal
 * entries prepared as screamsheets, and what's out. Writing and editing happen in the editor window
 * (apps/screamsheet/editor.js).
 * Methods, click actions (data-action), inputs and dropdowns are installed onto AgentPhone.
 */

const TABS = { crawl: "My Crawl", front: "Front Page" };
const GM_TABS = { desk: "Desk", front: "Published" };

/** Drafts the module made (the rest are the GM's own or a macro's). */
const SUGGESTED = new Set(["rep", "garden", "journal"]);

const newest = (a, b) => (b.pub ?? b.ts ?? 0) - (a.pub ?? a.ts ?? 0);

const handleOf = actor => Object.values(store.garden?.accounts ?? {}).find(a => a.actorId === actor.id && a.kind === "pc")?.handle ?? null;
const crewsOf = actor => (hqApi()?.crewHQsOf ? hqApi().crewHQsOf(actor).map(e => e.name) : []);

/** The characters' watchlists as their own phones work them out (the host does the same: host.js _screamTerms). */
function termsOf(actor) {
  const row = store.apps.screamCrawls?.[actor.id] ?? {};
  return watchTerms({ name: displayName(actor), handle: handleOf(actor), crews: crewsOf(actor), aliases: row.aliases, extra: row.extra, muted: row.muted });
}

/** What Claude may know about a subject: what the street knows. */
const publicFacts = actor => ({ name: displayName(actor), role: actor.system?.roleInfo?.activeRole ?? "", reputation: reputationOf(actor), handle: handleOf(actor), crews: crewsOf(actor) });

/** What a draft is about, for Claude to rewrite it: where it came from, the GM's notes, its text now. */
const eventOf = clip => [
  clip.source?.kind && `From: ${SOURCES[clip.source.kind] ?? clip.source.kind}${clip.source.label ? ` (${clip.source.label})` : ""}`,
  clip.notes && `GM's notes: ${clip.notes}`,
  `The draft now:\n${sheetText({ blocks: clip.sheet?.blocks })}`
].filter(Boolean).join("\n");

/**
 * Library Search with the character sheet's own roll (the system's dialog, mods and Luck, its roll card),
 * plus the Agent's +2 (and Big SAAI's +1) unless an effect already gives it. Null when cancelled or the sheet has no skill item.
 */
async function librarySearch(actor) {
  const skill = actor.items.find(i => i.type === "skill" && /^library search$/i.test(i.name));
  if (!skill?.createRoll) return null;
  const roll = skill.createRoll("skill", actor);
  roll.addMod(agentMods(roll.mods, hasAddon(store.apps.installs, actor.id, BIG_SAAI), "DataPool"));
  if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, skill))) return false;
  await roll.roll();
  if (Number.isInteger(roll.luck) && roll.luck > 0) {
    const luck = actor.system.stats.luck.value;
    await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
  }
  roll.entityData = { actor: actor.id, token: null };
  const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
  const card = await CPRChat.RenderRollCard(roll);
  const mods = roll.totalMods();
  const crit = roll.criticalRoll ? ` ${roll.wasCritFail() ? "−" : "+"} ${roll.criticalRoll}` : "";
  const detail = `${roll.initialRoll}${crit} + ${roll.statValue} INT + ${roll.skillValue} skill${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)} mods` : ""}${roll.luck > 0 ? ` + ${roll.luck} Luck` : ""}`;
  return { total: roll.resultTotal, detail, messageId: card?.id ?? null };
}

export const actions = {
  "scream-tab"({ tab }) {
    this.screamTab = tab;
    this.render();
  },
  "scream-open"({ id }) {
    const clip = store.apps.screamClips?.[id];
    if (!clip) return;
    const actor = this.screamSubject();
    if (actor && !game.user.isGM) store.request("scream-read", { actorId: actor.id, clipIds: [id] }, { quiet: true });
    openReader(id, { actorId: actor?.id ?? null, phone: this });
  },
  "scream-read-all"() {
    const actor = this.screamSubject();
    const mine = Object.values(store.apps.screamClips ?? {}).filter(c => (c.actorIds ?? []).includes(actor?.id)).map(c => c.id);
    if (actor && mine.length) store.request("scream-read", { actorId: actor.id, clipIds: mine });
  },
  /** Tap an automatic term to mute it (or bring it back); one the player added (a term, an alias) to take it off. */
  "scream-term"({ term, auto }) {
    const actor = this.screamSubject();
    if (!actor) return;
    const row = store.apps.screamCrawls?.[actor.id] ?? {};
    if (auto === "true") {
      const muted = row.muted ?? [];
      const has = muted.some(m => m.toLowerCase() === term.toLowerCase());
      store.request("scream-terms", { actorId: actor.id, muted: has ? muted.filter(m => m.toLowerCase() !== term.toLowerCase()) : [...muted, term] });
    } else {
      const drop = list => (list ?? []).filter(e => e.toLowerCase() !== term.toLowerCase());
      store.request("scream-terms", { actorId: actor.id, extra: drop(row.extra), aliases: drop(row.aliases) });
    }
  },
  /** "Look for something": one thing to watch for, and whether it's a name the character goes by. */
  async "scream-look"() {
    const actor = this.screamSubject();
    if (!actor) return;
    const asked = await fieldsDialog({
      title: "DataPool: look for something",
      fields: [
        { name: "term", label: "Look for", placeholder: "A fixer, a gang, a corp, a place…" },
        { name: "kind", label: "It's", type: "select", value: "extra", options: [
          { value: "extra", label: "Something I want to keep an eye on" },
          { value: "alias", label: "A name I go by (an alias)" }
        ] }
      ],
      label: "Watch for it",
      note: "Your Agent brings back screamsheets that mention it, from the next crawl on."
    });
    const term = asked?.term.replace(/\s+/g, " ").trim();
    if (!term) return;
    const row = store.apps.screamCrawls?.[actor.id] ?? {};
    const key = asked.kind === "alias" ? "aliases" : "extra";
    store.request("scream-terms", { actorId: actor.id, [key]: [...(row[key] ?? []), term] });
  },
  /** The deep crawl: the sheet's Library Search (or the host's roll without the skill item). What turns up is the GM's call. */
  async "scream-deep"() {
    const actor = this.screamSubject();
    if (!actor || this.screamRolling) return;
    this.screamRolling = true;
    try {
      const roll = await librarySearch(actor);
      if (roll === false) return;
      store.request("scream-deep", { actorId: actor.id, ...(roll ?? {}) });
    } finally {
      this.screamRolling = false;
    }
  },

  /* ---------- GM ---------- */
  "scream-write"() {
    openEditor(null);
  },
  "scream-edit"({ id }) {
    openEditor(id);
  },
  "scream-publish"({ id }) {
    const clip = store.apps.screamClips?.[id];
    if (clip) store.request("scream-save", { clip, publish: true });
  },
  "scream-delete"({ id }) {
    const clip = store.apps.screamClips?.[id];
    if (!clip) return;
    const out = clip.status === "published";
    Dialog.confirm({
      title: "DataPool",
      content: `<p>${out ? "Take this clipping off the Pool? Characters who pulled it lose it too." : "Bin this clipping?"}</p>`,
      yes: () => store.request("scream-delete", { clipId: id })
    });
  },
  "scream-journal"({ id }) {
    store.request("scream-journal", { entryId: id });
  },
  "scream-open-entry"({ id }) {
    game.journal.get(id)?.sheet.render(true);
  },
  /** GM: confirm a deep crawl with the ticked clippings (and the one picked to add). */
  "scream-resolve"({ actor }) {
    const root = this.element[0];
    const ids = [...root.querySelectorAll(`input[data-scream-found="${actor}"]:checked`)].map(i => i.value);
    const extra = this.screamExtra?.[actor];
    if (extra) ids.push(extra);
    if (store.request("scream-resolve", { actorId: actor, clipIds: [...new Set(ids)] })) delete this.screamExtra?.[actor];
  },
  "scream-crawl-now"() {
    store.request("scream-crawl", {});
  },
  /**
   * GM: Claude drafts a clipping with the GM's Ask Alex key: a new one, or the draft `id` rewritten
   * (its masthead, images, subjects and Reputation stay). Either way it lands on the desk as a draft.
   */
  async "scream-claude"({ id }) {
    const clip = id ? store.apps.screamClips?.[id] : null;
    if (id && !clip) return;
    const { key } = aiSettings();
    if (!key) return ui.notifications.warn("DataPool: add your Anthropic API key first (GM Phone → Ask Alex → Optional Anthropic API).");
    if (overCap()) return ui.notifications.warn("DataPool: Claude has reached this session's cap (set in Ask Alex).");
    const ai = ((this.screamAi ??= {})[id || "new"] ??= {});
    if (ai.busy) return;
    const pcs = playerCharacters();
    const asked = await fieldsDialog({
      title: clip ? `Redraft with Claude: "${clipRow(clip).headline}"` : "Draft with Claude",
      fields: [
        { name: "prompt", label: clip ? "What to change" : "The story", type: "textarea", rows: 4, value: ai.prompt ?? "",
          placeholder: clip ? "Optional: the angle, what to add or leave out…" : "What happened, where, who saw it, the angle…" },
        ...(clip ? [] : [{ name: "outlet", label: "Outlet", type: "select", value: ai.outlet ?? "street", options: Object.entries(OUTLETS).filter(([k]) => k !== "custom").map(([value, o]) => ({ value, label: `${o.name} (${o.voice})` })) }]),
        { name: "spin", label: "Spin", type: "select", value: ai.spin ?? clip?.spin ?? "accurate", options: Object.entries(SPINS).map(([value, label]) => ({ value, label })) },
        ...(clip ? [] : [{ name: "dv", label: "Depth", type: "select", value: ai.dv ?? 0, options: Object.entries(DEPTHS).map(([value, d]) => ({ value, label: `${d.name}${Number(value) ? ` (DV ${value})` : ""}` })) }]),
        ...(clip ? [] : pcs.map(a => ({ name: `about_${a.id}`, label: `About ${displayName(a)}`, type: "checkbox", value: !!ai.about?.includes(a.id) })))
      ],
      label: "Draft",
      note: clip ? "Claude rewrites the text. Masthead, images, subjects and Reputation stay. It stays on the desk." : "Claude writes a new draft for the desk. Nothing is published."
    });
    if (!asked || ai.busy) return;
    const about = clip ? clip.subjects ?? [] : pcs.filter(a => asked[`about_${a.id}`]).map(a => a.id);
    Object.assign(ai, { prompt: asked.prompt.trim(), spin: asked.spin, ...(clip ? {} : { outlet: asked.outlet, dv: Number(asked.dv) || 0, about }) });
    if (!clip && !ai.prompt) return ui.notifications.warn("DataPool: tell Claude what the story is.");
    const outlet = clip?.sheet?.outlet ?? ai.outlet;
    const body = clipRequest({
      outlet, spin: ai.spin, dv: clip ? clip.dv : ai.dv, prompt: ai.prompt, event: clip ? eventOf(clip) : "",
      name: clip?.sheet?.masthead?.brand?.name ?? "", subjects: about.map(a => game.actors.get(a)).filter(Boolean).map(publicFacts)
    });
    Object.assign(ai, { busy: true, error: null });
    this.render();
    try {
      const { result, cost } = await runClip(body, { key });
      addSpend(cost);
      const sheet = clipSheet(result, outlet, clip?.sheet ?? null);
      const note = `Claude, ${SPINS[ai.spin]} ($${cost.toFixed(3)})${result.gm_note ? `: ${String(result.gm_note).trim()}` : ""}`;
      store.request("scream-save", {
        clip: clip
          ? { ...clip, sheet, spin: ai.spin, tags: clipTags(result, clip.tags), notes: [clip.notes, note].filter(Boolean).join("\n").slice(-2000) }
          : { sheet, subjects: about, tags: clipTags(result), dv: ai.dv, reach: "public", spin: ai.spin, rep: [], title: String(result.headline).slice(0, 120), notes: note, source: { kind: "claude" } }
      });
      ai.prompt = "";
    } catch (err) {
      ai.error = err.message;
      ui.notifications.error(`DataPool: ${err.message}`);
    }
    ai.busy = false;
    // refresh, not render: the "writing" redraw may still be drawing (Ask Alex's note).
    this.refresh();
  }
};

export const dropdowns = {
  /** GM: a published clipping to add to a deep crawl ("actorId|clipId"; nothing more: "actorId|"). */
  screamExtra(value) {
    const [actorId, clipId] = String(value).split("|");
    (this.screamExtra ??= {})[actorId] = clipId || null;
    this.render();
  }
};

export const methods = {
  /** Whose DataPool: the character in hand (none on the GM Phone). */
  screamSubject(ctx = this.context()) {
    if (ctx?.perspective === "gm") return null;
    return ctx?.subject?.actor ?? null;
  },

  screamsheetData(ctx) {
    const gm = ctx.perspective === "gm";
    const clips = Object.values(store.apps.screamClips ?? {});
    const bar = appBar("screamsheet", { owner: gm ? null : ctx.subject?.name });
    return gm ? this._screamGm(clips, bar) : this._screamPlayer(ctx, clips, bar);
  },

  _screamTabs(tabs, active, counts = {}) {
    return Object.entries(tabs).map(([id, label]) => ({ id, label, active: id === active, count: counts[id] ?? 0 }));
  },

  _screamPlayer(ctx, clips, bar) {
    const actor = ctx.subject?.actor;
    if (!actor) return { bar, gm: false, none: true };
    const row = store.apps.screamCrawls?.[actor.id] ?? {};
    const read = row.read ?? {};
    const mine = clips.filter(c => (c.actorIds ?? []).includes(actor.id)).sort(newest);
    const unread = mine.filter(c => !read[c.id]).length;
    const tab = this.screamTab in TABS ? this.screamTab : "crawl";
    const terms = termsOf(actor);
    const deep = row.deep ? { ...row.deep, review: row.deep.status === "review", done: row.deep.status === "done", nothing: row.deep.status === "done" && !row.deep.n } : null;
    const offline = !canUsePhone(actor);
    return {
      bar, gm: false,
      tabs: this._screamTabs(TABS, tab, { crawl: unread }),
      tab: { [tab]: true },
      offline, last: row.last ?? null,
      watching: activeTerms(terms).join(", "),
      front: clips.filter(c => c.everyone).sort(newest).map(c => ({ ...clipRow(c), unread: false })),
      mine: mine.map(c => ({ ...clipRow(c), unread: !read[c.id] })),
      unread,
      terms: terms.map(t => ({ ...t, auto: String(t.auto), icon: { name: "fa-user", handle: "fa-at", crew: "fa-users", alias: "fa-mask", extra: "fa-magnifying-glass" }[t.kind] })),
      deep,
      canDeep: !offline && !deep?.review,
      bonus: librarySearchBase(actor, hasAddon(store.apps.installs, actor.id, BIG_SAAI)).bonus
    };
  },

  /** GM: the dropdown of other published clippings a deep crawl can also turn up. */
  _screamOthers(actorId, list) {
    if (!list.length) return null;
    const picked = this.screamExtra?.[actorId] ?? null;
    return dropdown("screamExtra", [
      { value: `${actorId}|`, label: "(nothing more)", selected: !picked },
      ...list.map(c => ({ value: `${actorId}|${c.id}`, label: `${clipRow(c).headline} (DV ${c.dv || 0})`, selected: c.id === picked }))
    ], { title: "You also find", cls: "agent-wide" });
  },

  _screamGm(clips, bar) {
    const tab = this.screamTab in GM_TABS ? this.screamTab : "desk";
    const crawls = store.apps.screamCrawls ?? {};
    const desk = crawls[DESK] ?? {};
    const anthropic = anthropicOn();
    const published = clips.filter(c => c.status === "published").sort(newest);
    const row = c => ({
      ...clipRow(c), title: c.title || clipRow(c).headline, source: SOURCES[c.source?.kind] ?? "", sourceLabel: c.source?.label ?? "",
      reach: REACHES[c.reach] ?? "", subjects: (c.subjects ?? []).map(id => displayName(game.actors.get(id))).filter(Boolean).join(", "),
      pulled: (c.actorIds ?? []).map(id => displayName(game.actors.get(id))).filter(Boolean).join(", "),
      at: c.at ? Math.max(0, Math.round((c.at - game.time.worldTime) / 360) / 10) : null, front: !!c.everyone,
      writing: !!this.screamAi?.[c.id]?.busy, anthropic
    });
    const drafts = clips.filter(c => c.status === "draft").sort((a, b) => b.ts - a.ts);
    const deep = playerCharacters().map(actor => ({ actor, row: crawls[actor.id] })).filter(({ row: r }) => r?.deep?.status === "review").map(({ actor, row: r }) => ({
      actorId: actor.id, name: displayName(actor), total: r.deep.total, detail: r.deep.detail,
      found: (r.found ?? []).map(id => store.apps.screamClips[id]).filter(Boolean).map(c => row(c)),
      others: this._screamOthers(actor.id, published.filter(c => !(r.found ?? []).includes(c.id) && !(c.actorIds ?? []).includes(actor.id)))
    }));
    const made = new Set(desk.journal ?? []);
    return {
      bar, gm: true, anthropic,
      writing: !!this.screamAi?.new?.busy,
      tabs: this._screamTabs(GM_TABS, tab, { desk: deep.length }),
      tab: { [tab]: true },
      deep,
      suggested: drafts.filter(c => SUGGESTED.has(c.source?.kind)).map(row),
      drafts: drafts.filter(c => !SUGGESTED.has(c.source?.kind)).map(row),
      scheduled: clips.filter(c => c.status === "scheduled").sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).map(row),
      journals: screamsheetPool().filter(j => !made.has(j.id)).map(j => ({ id: j.id, name: j.name, outlet: j.outlet, dv: j.dv })),
      published: published.map(row)
    };
  }
};

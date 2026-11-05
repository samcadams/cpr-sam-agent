import { MODULE_ID } from "../../scripts/config.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { gardenNow, gardenWhen } from "./model.js";
import { openWriterPopup } from "./log-event.js";
import {
  CADENCES, CORP_TIERS, DEFAULT_MIX, FEED_APPS, hasProfile, HEATS, OBVIOUS, parseSpan, parseWhen, pcKeywords, RELATIONS, SEED_STAGES, spanText, STAGES, writerCharacters
} from "./writer.js";

/*
 * Phone page, GM: the Garden's Writer tab (apps/garden/writer.js): Log an event / Plant a seed, the
 * live happenings and seeds, writer profiles (accounts, corps, characters), formats, app feeds and
 * the mix. Merged into the Garden's page (page.js).
 */

/** The hotbar macro's command (api.garden.logEvent). */
const MACRO_NAME = "Garden: Log an event";
const MACRO_COMMAND = `game.modules.get("${MODULE_ID}").api.garden.logEvent();`;

/** What the sheet says about a character, for their profile's first keywords: role, HQ (cpr-hq), cyberware. */
export function pcInfo(actor) {
  const role = actor?.system?.roleInfo?.activeRole ?? null;
  const hq = game.modules.get("cpr-hq")?.active ? game.modules.get("cpr-hq").api?.crewHQsOf?.(actor)?.[0]?.name ?? null : null;
  const cyberware = (actor?.items ?? []).filter(i => i.type === "cyberware" && i.system?.isInstalled && !i.system?.core).map(i => i.name).slice(0, 12);
  return { role, hq, cyberware };
}

const list = v => (v ?? []).join(", ");

/** How characters get on the Writer tab's list (shown on the tab and in its dialog). */
export const PCS_NOTE = "Characters owned by or assigned to a player appear here; remove the ones the writer should ignore.";

/** The players' characters, and which of them the writer leaves out (garden.writer.ignore). */
function characterChoices() {
  const ignore = new Set(store.garden.writer?.ignore ?? []);
  return playerCharacters().map(a => ({ id: a.id, name: displayName(a), out: ignore.has(a.id) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The profile fields of a dialog, from a profile. `cast`: an NPC account (arc and lines). */
function profileFields(p = {}, { cast = true } = {}) {
  return [
    { name: "keywords", label: "Keywords", value: list(p.keywords), placeholder: "watson, kabuki, noodles, tyger claws, gossip", hint: "Places, factions, topics, people, brands. The writer fills the rest from these." },
    { name: "voice", label: "Voice", type: "textarea", rows: 2, value: p.voice ?? "", placeholder: "How they write (the writer fills this)" },
    { name: "agenda", label: "Agenda (GM-only)", type: "textarea", rows: 2, value: p.agenda ?? "", placeholder: "What they want right now" },
    { name: "reacts", label: "Speaks up about", value: list(p.reacts), placeholder: "keywords that make them post" },
    { name: "cadence", label: "Posts", type: "select", value: p.cadence ?? "sometimes", options: Object.entries(CADENCES).map(([value, label]) => ({ value, label })) },
    { name: "avoid", label: "Never touch (GM-only)", value: p.avoid ?? "" },
    { name: "ties", label: "Knows", value: list(p.ties), placeholder: "accounts, NPCs, characters" },
    ...(cast ? [
      { name: "arc", label: "Arc", value: p.arc ?? "", placeholder: "Where their storyline is now, in a line" },
      { name: "lines", label: "Own replies", type: "textarea", rows: 4, value: (p.lines ?? []).join("\n"), placeholder: "One per line: their auto-replies between batches", hint: "The Garden uses these for their replies before their mood's word list." }
    ] : [])
  ];
}

/** Corporation fields: relations as "Character | employer | note", calendar as "+4d | what". */
function corpFields(c = {}) {
  const now = gardenNow();
  const rel = (c.relations ?? []).map(r => `${displayName(game.actors.get(r.actorId)) || r.actorId} | ${r.kind} | ${r.note}`).join("\n");
  const cal = (c.calendar ?? []).map(e => `${spanText(e.wt - now)} | ${e.what}`).join("\n");
  return [
    { name: "tier", label: "Corp tier", type: "select", value: c.tier ?? "local", options: Object.entries(CORP_TIERS).map(([value, label]) => ({ value, label })), hint: "Megacorps post a baseline every couple of days; local corps only when relevant." },
    { name: "face", label: "Public face", value: c.face ?? "", placeholder: "wholesome science" },
    { name: "assets", label: "Assets", value: list(c.assets), placeholder: "its places, products, people" },
    { name: "relations", label: "Relations", type: "textarea", rows: 2, value: rel, placeholder: "Kade | employer | Kade's division head is Ms. Ito", hint: `Character | ${Object.keys(RELATIONS).join(" / ")} | note` },
    { name: "calendar", label: "Calendar", type: "textarea", rows: 2, value: cal, placeholder: "+4d | Optics launch event, Corporate Plaza", hint: "In-game time from now | what" }
  ];
}

const profileFrom = r => ({ keywords: r.keywords, voice: r.voice, agenda: r.agenda, reacts: r.reacts, cadence: r.cadence, avoid: r.avoid, ties: r.ties, arc: r.arc, lines: r.lines });

function corpFrom(r, old = {}) {
  const now = gardenNow();
  const relations = String(r.relations ?? "").split("\n").map(l => l.split("|").map(s => s.trim())).filter(p => p[0])
    .map(([actor, kind, note]) => ({ actor, kind: String(kind ?? "").toLowerCase(), note }));
  const calendar = [];
  for (const line of String(r.calendar ?? "").split("\n").filter(l => l.trim())) {
    const [when, ...what] = line.split("|");
    const span = parseSpan(when);
    if (span === null) {
      ui.notifications.warn(`Calendar: "${when.trim()}" isn't a time from now (like +4d or +6h); skipped.`);
      continue;
    }
    // Unchanged lines keep their exact time (the dialog shows them rounded to the minute).
    const kept = (old.calendar ?? []).find(e => e.what === what.join("|").trim() && Math.abs(e.wt - (now + span)) < 60);
    calendar.push({ id: kept?.id, wt: kept?.wt ?? now + span, what: what.join("|").trim() });
  }
  return { tier: r.tier, face: r.face, assets: r.assets, relations, calendar };
}

export const actions = {
  "garden-log-event"() {
    openWriterPopup({ tab: "event" });
  },
  "garden-plant-seed"() {
    openWriterPopup({ tab: "seed" });
  },
  "garden-happening-edit"({ id }) {
    const happening = store.garden.happenings?.[id];
    if (happening) openWriterPopup({ happening });
  },
  "garden-seed-edit"({ id }) {
    const seed = store.garden.seeds?.[id];
    if (seed) openWriterPopup({ seed });
  },
  /** Move a happening or seed on a stage (new → developing → cooling → closed). */
  "garden-stage"({ id, kind }) {
    const isSeed = kind === "seed";
    const item = (isSeed ? store.garden.seeds : store.garden.happenings)?.[id];
    if (!item) return;
    const stages = Object.keys(isSeed ? SEED_STAGES : STAGES);
    const stage = stages[(stages.indexOf(item.stage) + 1) % stages.length];
    store.request(isSeed ? "garden-seed" : "garden-happening", isSeed ? { seed: { id, stage } } : { happening: { id, stage } });
  },
  "garden-happening-delete"({ id }) {
    Dialog.confirm({ title: "The Garden", content: "<p>Forget this event? Posts about it stay.</p>", yes: () => store.request("garden-happening-delete", { id }), defaultYes: false });
  },
  "garden-seed-delete"({ id }) {
    Dialog.confirm({ title: "The Garden", content: "<p>Forget this seed? Posts about it stay.</p>", yes: () => store.request("garden-seed-delete", { id }), defaultYes: false });
  },
  /** A hotbar macro that opens Log an event (made once, then put on the first free slot). */
  async "garden-macro"() {
    let macro = game.macros.find(m => m.name === MACRO_NAME && m.command === MACRO_COMMAND);
    macro ??= await CONFIG.Macro.documentClass.create({ name: MACRO_NAME, type: "script", img: "icons/svg/lightning.svg", command: MACRO_COMMAND });
    const slot = Object.entries(game.user.hotbar ?? {}).find(([, id]) => id === macro.id)?.[0];
    if (!slot) await game.user.assignHotbarMacro(macro, null);
    ui.notifications.info(`"${MACRO_NAME}" is on your hotbar.`);
  },
  /** GM: an account's writer profile (and a corporation's fields). */
  async "garden-writer-edit"({ accountId }) {
    const a = store.garden.accounts[accountId];
    if (!a || a.actorId) return;
    const corp = a.kind === "corp";
    const result = await fieldsDialog({ title: `Writer: ${a.handle}`, fields: [...profileFields(a.writer), ...(corp ? corpFields(a.corp) : [])] });
    if (result) store.request("garden-writer-profile", { accountId, profile: profileFrom(result), corp: corp ? corpFrom(result, a.corp) : undefined });
  },
  /** GM: take a character off the writer's list. */
  "garden-writer-pc-remove"({ actorId }) {
    if (actorId) store.request("garden-writer-characters", { actorId, ignore: true });
  },
  /** GM: put a character back on the writer's list (a dropdown of the ones left out). */
  async "garden-writer-pc-add"() {
    const out = characterChoices().filter(c => c.out);
    if (!out.length) return ui.notifications.info("Every player's character is on the list already.");
    const result = await fieldsDialog({
      title: "Add a character for the writer",
      fields: [{ name: "actorId", label: "Character", type: "select", value: out[0].id, options: out.map(c => ({ value: c.id, label: c.name })) }],
      label: "Add"
    });
    if (result?.actorId) store.request("garden-writer-characters", { actorId: result.actorId, ignore: false });
  },
  /** GM: a character's writer profile (first keywords from their sheet). */
  async "garden-writer-pc"({ actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const p = store.garden.writer?.pcs?.[actorId] ?? { keywords: pcKeywords(pcInfo(actor)) };
    const result = await fieldsDialog({
      title: `Writer: ${displayName(actor)}`,
      fields: [...profileFields(p, { cast: false }), { name: "leaveOut", label: "Leave out of the writer", type: "checkbox", value: false, hint: "Takes them off this list, the writer pack and Log an event (a test actor, a retired character...)." }],
      note: "Employer, role, district or HQ, gangs, hobbies. Their Reputation is read from the sheet when the writer runs."
    });
    if (!result) return;
    store.request("garden-writer-profile", { actorId, profile: profileFrom(result) });
    if (result.leaveOut) store.request("garden-writer-characters", { actorId, ignore: true });
  },
  async "garden-format-edit"({ id }) {
    const formats = store.garden.writer?.formats ?? [];
    const f = formats.find(x => x.id === id) ?? { when: "daily 07:00", what: "" };
    const accounts = Object.values(store.garden.accounts).filter(a => !a.actorId).sort((a, b) => a.handle.localeCompare(b.handle));
    const result = await fieldsDialog({
      title: id ? "Recurring post" : "New recurring post",
      fields: [
        { name: "accountId", label: "Posted by", type: "select", search: true, value: f.accountId, options: accounts.map(a => ({ value: a.id, label: `${a.handle} · ${a.name}` })) },
        { name: "when", label: "When", value: f.when, placeholder: "daily 07:00", hint: "daily 07:00 · weekly Thu 20:00 · after violent nights (in-game)" },
        { name: "what", label: "What", type: "textarea", rows: 2, value: f.what, placeholder: "the morning headlines, half-checked" }
      ]
    });
    if (!result) return;
    if (!parseWhen(result.when)) return ui.notifications.warn(`"${result.when}" isn't a time the writer reads: daily 07:00, weekly Thu 20:00, or after violent nights.`);
    store.request("garden-format", { format: { id, ...result } });
  },
  "garden-format-delete"({ id }) {
    store.request("garden-format", { format: { id }, remove: true });
  },
  async "garden-feed-edit"({ app }) {
    const feed = store.garden.writer?.feeds?.[app] ?? { on: false, keywords: [], accounts: [] };
    const handles = feed.accounts.map(id => store.garden.accounts[id]?.handle).filter(Boolean).join(", ");
    const result = await fieldsDialog({
      title: `Writer feed: ${FEED_APPS[app]}`,
      fields: [
        { name: "on", label: "In the writer pack", type: "checkbox", value: feed.on },
        { name: "keywords", label: "Keywords", value: list(feed.keywords), placeholder: "acid rain, smog" },
        { name: "accounts", label: "Who may talk about it", value: handles, placeholder: "@network54, @morrorockradio", hint: "Handles, comma-separated. Feeds give the writer facts; they never post by themselves." }
      ]
    });
    if (!result) return;
    const byHandle = new Map(Object.values(store.garden.accounts).map(a => [a.handle.toLowerCase(), a.id]));
    const accounts = result.accounts.split(",").map(h => h.trim().toLowerCase()).filter(Boolean).map(h => byHandle.get(h.startsWith("@") ? h : `@${h}`)).filter(Boolean);
    store.request("garden-feed", { app, feed: { on: result.on, keywords: result.keywords, accounts } });
  },
  async "garden-mix-edit"() {
    const mix = store.garden.writer?.mix ?? DEFAULT_MIX;
    const result = await fieldsDialog({
      title: "The writer's mix",
      fields: [
        { name: "city", label: "City (%)", type: "number", value: mix.city, hint: "Cast storylines, news, corps' baseline, gangs, events with nothing to do with the characters" },
        { name: "close", label: "Close to home (%)", type: "number", value: mix.close, hint: "Their employers and rivals, districts and HQ block, contacts, gear" },
        { name: "about", label: "About them (%)", type: "number", value: mix.about, hint: "Follow-ups to what they did, replies to their posts, mentions" }
      ]
    });
    if (result) store.request("garden-mix", { mix: result });
  }
};

export const methods = {
  /** The Writer tab's data. */
  _gardenWriterData() {
    const g = store.garden;
    const now = gardenNow();
    const writer = g.writer ?? {};
    const live = h => h.stage !== "closed";
    const happenings = Object.values(g.happenings ?? {}).sort((a, b) => live(b) - live(a) || b.wt - a.wt).map(h => ({
      ...h, when: gardenWhen(h.wt, now), heatName: HEATS[h.heat], stageName: STAGES[h.stage], closed: h.stage === "closed",
      whoNames: h.who.map(id => displayName(game.actors.get(id))).filter(Boolean).join(", ")
    }));
    const seeds = Object.values(g.seeds ?? {}).sort((a, b) => (a.stage === "done") - (b.stage === "done") || b.ts - a.ts).map(s => ({
      ...s, byLabel: s.by ? gardenWhen(s.by, now) : null, obviousName: OBVIOUS[s.obvious], stageName: SEED_STAGES[s.stage], done: s.stage === "done"
    }));
    const handle = id => g.accounts[id]?.handle ?? "@deleted";
    const pcs = writerCharacters(playerCharacters(), writer).sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const pcsOut = characterChoices().filter(c => c.out);
    return {
      happenings, seeds,
      cast: Object.values(g.accounts).filter(a => !a.actorId && hasProfile(a.writer)).sort((a, b) => a.handle.localeCompare(b.handle))
        .map(a => ({ id: a.id, handle: a.handle, kind: a.kind, keywords: list(a.writer.keywords), arc: a.writer.arc, lines: a.writer.lines?.length ?? 0, corp: a.kind === "corp" })),
      pcs: pcs.map(a => ({ id: a.id, name: displayName(a), keywords: list(writer.pcs?.[a.id]?.keywords), set: hasProfile(writer.pcs?.[a.id]) })),
      pcsOut, pcsNote: PCS_NOTE,
      formats: (writer.formats ?? []).map(f => ({ ...f, handle: handle(f.accountId) })),
      feeds: Object.entries(FEED_APPS).map(([app, name]) => {
        const f = writer.feeds?.[app];
        return { app, name, on: !!f?.on, keywords: list(f?.keywords), accounts: (f?.accounts ?? []).map(handle).join(", ") };
      }),
      mix: writer.mix ?? DEFAULT_MIX
    };
  }
};

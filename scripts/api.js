import { DEFAULT_CONTACT_IMG, MODULE_ID } from "./config.js";
import { APP_MANIFEST } from "./apps/manifest.js";
import { agentType } from "./model/agent.js";
import { ALERT_KINDS } from "./model/apps.js";
import { findContact, getContacts, playerCharacters, setContacts } from "./model/contacts.js";
import { FEATURE_DEFAULTS, feature, noSignalSince, setFeature } from "./model/features.js";
import { hasWallet } from "./model/money.js";
import { gardenNow, gardenTiers } from "../apps/garden/model.js";
import { QUEST_STATUSES } from "./model/quests.js";
import { ADDONS, hasAddon, installedSet, isInstalled, isLapsed, poolOn, setSubsBilledBy, subsBilledBy, subscriptionState } from "../apps/pool/model.js";
import { getServices } from "./model/services.js";
import { actorAvatar, displayName } from "./model/threads.js";
import { covered, findPlan, setTraumaBilledBy, subscriptionInfo, traumaBilledBy, traumaConfig } from "../apps/trauma/model.js";
import { store } from "./store.js";
import { activity, noteActivity, registerScreen } from "./ui/activity.js";
import { AgentMonitor } from "./ui/AgentMonitor.js";
import { Director } from "./ui/director/Director.js";
import { detach } from "./ui/director/detach.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";
import { openLocation } from "./ui/location.js";
import { embedPlace, mapEmbed } from "../apps/map/embed.js";
import { plainSheet } from "../apps/screamsheet/model.js";
import { patchSetting } from "./util/settings.js";

/*
 * The macro API: game.modules.get("cpr-sam-agent").api (documented in API.md).
 *
 * Every change goes to the host (the active GM) as an ordinary request, so the host checks it exactly
 * as it checks the GM Phone: the API adds friendlier arguments (an Actor, Token, id, UUID or name for
 * a character) and clear errors. Calls that change things return a promise; on the host it resolves
 * once the change is made, elsewhere once it's sent.
 */

const fail = message => {
  throw new Error(`${MODULE_ID} | ${message}`);
};

const requireGM = what => {
  if (!game.user.isGM) fail(`${what} is for GMs.`);
};

const isActor = doc => doc?.documentName === "Actor";

/** An Actor from an Actor, Token (document or placeable), id, UUID or name. */
function resolveActor(ref, what = "character") {
  if (!ref) fail(`No ${what} given.`);
  if (isActor(ref)) return ref;
  if (isActor(ref.actor)) return ref.actor; // a Token or TokenDocument
  if (typeof ref === "string") {
    const doc = game.actors.get(ref)
      ?? (ref.includes(".") ? globalThis.fromUuidSync?.(ref) : null)
      ?? game.actors.find(a => a.name === ref || displayName(a) === ref);
    const found = isActor(doc?.actor) ? doc.actor : doc;
    if (isActor(found)) return found;
  }
  fail(`Can't find the ${what} "${ref?.name ?? ref}".`);
}

/** One or several characters, as a list of Actors. */
const resolveActors = (refs, what) => (Array.isArray(refs) ? refs : [refs]).map(r => resolveActor(r, what));

/** A contact's name from a string or an Actor (an NPC's sheet). */
function contactName(from) {
  if (typeof from === "string" && from.trim()) return from.trim();
  if (isActor(from)) return displayName(from);
  if (isActor(from?.actor)) return displayName(from.actor);
  fail("Say who it's from: a contact's name or an NPC's Actor (`from`).");
}

/** The id of a service (by id or name, any case). */
function serviceId(ref) {
  const want = String(ref ?? "").toLowerCase();
  const service = getServices().find(s => s.id === ref || s.name.toLowerCase() === want);
  if (!service) fail(`No service "${ref}". Services are set up in the GM Phone's Contacts app.`);
  return service.id;
}

/** A Garden account by handle ("@network54"), id or "@random" (a random citizen). */
function gardenAccount(ref) {
  const accounts = Object.values(store.garden.accounts ?? {});
  if (/^@random$/i.test(ref ?? "")) {
    const citizens = accounts.filter(a => a.kind === "citizen");
    if (!citizens.length) fail("The Garden has no citizens to pick from. Make some in the Garden's GM controls.");
    return citizens[Math.floor(Math.random() * citizens.length)];
  }
  const want = String(ref ?? "").toLowerCase().replace(/^@?/, "@");
  const account = store.garden.accounts?.[ref] ?? accounts.find(a => a.handle.toLowerCase() === want);
  if (!account) fail(`No Garden account "${ref}".`);
  return account;
}

/** Reputation changes: [{ actor, delta, reason }] → the host's { actorId, delta, reason }. */
const repList = rep => (rep ? (Array.isArray(rep) ? rep : [rep]).map(r => ({
  actorId: resolveActor(r.actor, "character for a Reputation event").id, delta: Math.trunc(Number(r.delta) || 0), reason: r.reason ?? ""
})) : null);

/** Send a request to the host; on the host, wait until it (and everything before it) is done. */
async function send(type, data) {
  if (!store.request(type, data)) fail("No signal: a GM needs to be online.");
  if (store.isHost) await store._enqueue(() => {});
}

/** Wait for a world setting's change to reach the host's own handlers. */
const settled = () => (store.isHost ? store._enqueue(() => {}) : Promise.resolve());

/* ---------------- Communications ---------------- */

/** GM: text a character from a contact. */
async function text({ to, from, text: body, image = null, hidden = false } = {}) {
  requireGM("Texting from a macro");
  const actor = resolveActor(to);
  if (!String(body ?? "").trim() && !image) fail("There's nothing to send (`text` or `image`).");
  await send("send", { actorId: actor.id, contact: contactName(from), text: body ?? "", image, hidden: !!hidden });
}

/** GM: ring a character's Agent from a contact. The GM answers on the GM Phone as usual. */
async function call({ to, from, hidden = false } = {}) {
  requireGM("Calling from a macro");
  const actor = resolveActor(to);
  await send("call-start", { actorId: actor.id, contact: contactName(from), hidden: !!hidden });
}

/** GM: end every call a character is on, or every call. */
async function endCalls({ to = null } = {}) {
  requireGM("Ending calls");
  const actorId = to ? resolveActor(to).id : null;
  const ids = [...store.calls.values()]
    .filter(c => !actorId || c.participants.some(p => p.actorId === actorId))
    .map(c => c.id);
  for (const callId of ids) await send("call-close", { callId });
  return ids.length;
}

/**
 * GM: give characters a contact (left alone if they have it). `actor`: an NPC's sheet to link it to
 * (its picture and name are the defaults).
 */
async function addContact({ to, name = null, actor = null, img = null } = {}) {
  requireGM("Adding contacts");
  const npc = actor ? resolveActor(actor, "NPC") : null;
  name = (name ?? (npc ? displayName(npc) : "")).trim();
  if (!name) fail("Give the contact a `name` (or an NPC `actor`).");
  for (const pc of resolveActors(to)) {
    const contacts = getContacts(pc);
    if (findContact(contacts, name)) continue;
    const entry = { name, img: img ?? (npc ? actorAvatar(npc) : DEFAULT_CONTACT_IMG) };
    if (npc) entry.actorId = npc.id;
    await setContacts(pc, [...contacts, entry]);
  }
}

/* ---------------- Agent alerts ---------------- */

/**
 * GM: an Agent alert to one or more characters, with up to three answer buttons. `tag` comes back in
 * the cpr-sam-agent.alertAnswered hook, so a macro can tell its own alerts' answers apart.
 */
async function alert({ to, text: body, choices = [], kind = "advice", tag = null } = {}) {
  requireGM("Sending Agent alerts");
  if (!String(body ?? "").trim()) fail("The alert needs `text`.");
  if (!(kind in ALERT_KINDS)) fail(`Unknown alert kind "${kind}": ${Object.keys(ALERT_KINDS).join(", ")}.`);
  const actorIds = resolveActors(to).map(a => a.id);
  await send("alert-send", { actorIds, kind, text: body, choices, tag: tag == null ? null : String(tag) });
}

/* ---------------- Signal and switches ---------------- */

/** Has this character's Agent got cellular service? */
const hasSignal = actor => !noSignalSince(resolveActor(actor).id);

/** GM: switch characters' cellular service off (their incoming messages wait) or back on. */
async function setSignal(actors, on) {
  requireGM("Switching signal");
  const ids = resolveActors(actors).map(a => a.id);
  await patchSetting("noSignal", offline => {
    for (const id of ids) {
      if (on) delete offline[id];
      else offline[id] ??= Date.now();
    }
  });
  await settled();
}

const FEATURES = Object.keys(FEATURE_DEFAULTS);

/** Is a switch from Control on? e.g. "comms", "jobs", "app_garden". */
function featureOn(name) {
  if (!FEATURES.includes(name)) fail(`Unknown switch "${name}": ${FEATURES.join(", ")}.`);
  return !!feature(name);
}

/** GM: turn one of Control's switches on or off. */
async function setFeatureOn(name, on) {
  requireGM("Changing Control's switches");
  featureOn(name);
  await setFeature(name, on);
  await settled();
}

/* ---------------- Money ---------------- */

/** The thread fields for money from a service (`service`) or a contact (`from`). */
function moneyFrom({ from, service }) {
  if (service) return { serviceId: serviceId(service) };
  return { contact: contactName(from) };
}

const amountOf = amount => {
  const n = Math.floor(Number(amount));
  if (!(n > 0)) fail("`amount` must be a positive number of eurobucks.");
  return n;
};

/** GM: ask a character to pay, from a contact or a service. They pay from the conversation. */
async function requestMoney({ to, from = null, service = null, amount, note = "" } = {}) {
  requireGM("Billing");
  const actor = resolveActor(to);
  await send("money-send", { actorId: actor.id, ...moneyFrom({ from, service }), kind: "request", amount: amountOf(amount), note });
}

/** GM: send a character eurobucks from a contact or a service (they Transfer it in). */
async function sendMoney({ to, from = null, service = null, amount, note = "" } = {}) {
  requireGM("Sending money");
  const actor = resolveActor(to);
  await send("money-send", { actorId: actor.id, ...moneyFrom({ from, service }), kind: "send", amount: amountOf(amount), note });
}

/** GM: add to (positive) or take from (negative) a character's wallet, with a line in BangMe!. */
async function adjustWallet({ actor, amount, memo = "" } = {}) {
  requireGM("Adjusting wallets");
  const n = Math.trunc(Number(amount));
  if (!n) fail("`amount` must be a non-zero number.");
  await send("ledger-adjust", { actorId: resolveActor(actor).id, amount: n, memo });
}

/** Can this character be sent a BangMe! invoice? BangMe! on in Control, and a wallet and an Agent of their own. */
function canInvoice(actor) {
  const target = resolveActor(actor);
  return !!feature("app_bangme") && hasWallet(target) && !!agentType(target);
}

/** GM: send a character a BangMe! invoice under any name. Nothing moves until they pay. */
async function sendInvoice({ to, from, amount, memo = "", tag = null } = {}) {
  requireGM("Billing");
  const actor = resolveActor(to);
  if (!canInvoice(actor)) fail(`${displayName(actor)} can't be invoiced: it takes BangMe!, a wallet and an Agent.`);
  await send("invoice-send", { targetId: actor.id, fromName: contactName(from), amount: amountOf(amount), memo, tag });
}

/** GM: the invoices sent to characters, newest first; with `tag`, only those. */
function listInvoices({ tag = null } = {}) {
  requireGM("Reading invoices");
  return Object.values(store.apps.invoices ?? {}).filter(i => i.toActor && (!tag || i.tag === tag)).sort((a, b) => b.ts - a.ts)
    .map(i => ({ id: i.id, actorId: i.toActor, from: i.fromName, amount: i.amount, memo: i.memo, status: i.status, tag: i.tag ?? null }));
}

/* ---------------- Jobs ---------------- */

/** GM: create a job (no `id`) or change one. Returns its id. New jobs start hidden and Available. */
async function saveJob(job = {}) {
  requireGM("Saving jobs");
  const existing = job.id ? store.quests.get(job.id) : null;
  if (job.id && !existing) fail(`No job "${job.id}".`);
  if (job.status !== undefined && !QUEST_STATUSES.includes(job.status)) fail(`Unknown status "${job.status}": ${QUEST_STATUSES.join(", ")}.`);
  const id = existing?.id ?? foundry.utils.randomID();
  const quest = { id };
  for (const key of ["name", "description", "img", "status", "hidden"]) if (key in job) quest[key] = job[key];
  await send("quest-save", { quest });
  return id;
}

/** A job by id or name. */
function jobId(ref) {
  const job = store.quests.get(ref) ?? [...store.quests.values()].find(q => q.name === ref);
  if (!job) fail(`No job "${ref}".`);
  return job.id;
}

/** GM: offer a job in a text from a contact. The player accepts or declines in the conversation. */
async function offerJob({ job, to, from, text: body = "" } = {}) {
  requireGM("Offering jobs");
  if (!feature("jobs")) fail("Jobs are switched off (Control → Apps).");
  const actor = resolveActor(to);
  await send("send", { actorId: actor.id, contact: contactName(from), text: body, job: jobId(job) });
}

/** GM: move a job to Available, In Progress ("active"), Completed or Failed; `reveal` shows it. */
async function setJobStatus(job, status, { reveal = false } = {}) {
  return saveJob({ id: jobId(job), status, ...(reveal ? { hidden: false } : {}) });
}

/* ---------------- The Garden ---------------- */

/**
 * GM: post on the Garden as an account (handle, id or "@random"), now or in `delay` minutes.
 * `outcome`: one of the Garden's outcomes by id or name (random if left out).
 */
async function gardenPost({ as, text: body = "", image = null, outcome = null, delay = 0, rep = null } = {}) {
  requireGM("Posting on the Garden");
  if (!String(body).trim() && !image) fail("There's nothing to post (`text` or `image`).");
  const account = gardenAccount(as);
  await send("garden-gm-post", { accountId: account.id, text: body, image, tier: outcomeId(outcome), delay, rep: repList(rep) });
}

function outcomeId(outcome) {
  if (outcome == null || outcome === "") return null;
  const tiers = gardenTiers();
  const want = String(outcome).toLowerCase();
  const id = Object.keys(tiers).find(k => k === want || tiers[k].name.toLowerCase() === want);
  if (!id) fail(`Unknown outcome "${outcome}": ${Object.values(tiers).map(t => t.name).join(", ")}.`);
  return id;
}

/**
 * GM: queue posts, one per line, as in the Queue posts dialog ("text", "@handle | text | picture |
 * outcome"). Lines without a handle post `as` (default: a random citizen).
 */
async function gardenQueue(lines, { as = "@random", every = 5, jitter = 0 } = {}) {
  requireGM("Queueing Garden posts");
  const accountId = /^@random$/i.test(as) ? "@random" : gardenAccount(as).id;
  await send("garden-drip", { lines: Array.isArray(lines) ? lines.join("\n") : String(lines ?? ""), accountId, every, jitter });
}

/**
 * GM: log a happening for the Garden's writer. No `what`: the Log an event pop-up (place and who
 * prefilled from the scene). With it: logged at once; `stir` adds instant chatter (plan §6).
 */
async function gardenLogEvent({ what, place = "", who = [], heat = "local", public: isPublic = true, keywords = [], note = "", stir = false, thing = null } = {}) {
  requireGM("Logging a Garden event");
  if (what === undefined) return (await import("../apps/garden/log-event.js")).openWriterPopup({ tab: "event" });
  if (!String(what).trim()) fail("Say what happened (`what`).");
  const whoIds = resolveActors(who, "character").map(a => a.id);
  // No keywords given: the ones the context suggests (what, place, who, the scene), as the pop-up does.
  if (!keywords?.length) keywords = (await import("../apps/garden/log-event.js")).autoKeywords({ what, place, who: whoIds });
  await send("garden-happening", {
    happening: { what, place, who: whoIds, heat, public: isPublic, keywords, direction: note }, stir, thing
  });
}

/** GM: plant a seed for the writer (no `what`: the pop-up). `by`: in-game seconds from now, or none. */
async function gardenPlantSeed({ what, keywords = [], obvious = "subtle", by = null, sources = [] } = {}) {
  requireGM("Planting a Garden seed");
  if (what === undefined) return (await import("../apps/garden/log-event.js")).openWriterPopup({ tab: "seed" });
  if (!String(what).trim()) fail("Say what the city should talk about (`what`).");
  if (!keywords?.length) keywords = (await import("../apps/garden/log-event.js")).autoKeywords({ what, place: "", who: [], context: "" });
  await send("garden-seed", { seed: { what, keywords, obvious, by: by === null ? null : gardenNow() + Number(by), sources: sources.map(s => gardenAccount(s).id) } });
}

/** The Garden's accounts: { id, handle, name, kind, followers, actorId }. */
const gardenAccounts = () => Object.values(store.garden.accounts ?? {}).map(a => ({
  id: a.id, handle: a.handle, name: a.name, kind: a.kind, followers: a.followers ?? 0, actorId: a.actorId ?? null
}));

/* ---------------- Trauma Team ---------------- */

/** GM: give a character a Trauma Team plan (by id or name), paid for by `sponsor`. */
async function traumaGrant({ actor, plan, sponsor = "" } = {}) {
  requireGM("Granting Trauma Team coverage");
  await send("tt-grant", { actorId: resolveActor(actor).id, tier: planId(plan), sponsor });
}

/** A plan's id from its id or name, or an error listing the plans. */
function planId(plan) {
  const tier = findPlan(plan);
  if (!tier) fail(`No Trauma Team plan "${plan}": ${Object.values(traumaConfig().tiers).map(t => t.name).join(", ")}.`);
  return tier;
}

/** A character's coverage: { status, covered, plan, memberId, sponsor, auto, since, nextDue, biolink, noAds }. */
const traumaStatus = actor => subscriptionInfo(store.apps.subs?.[resolveActor(actor).id]);

/**
 * Let another module bill Trauma Team (e.g. CPR HQ with its Lifestyle bill): while `by` is set the Agent
 * charges nothing, neither monthly nor when a player subscribes, and plans don't lapse on their own.
 * Call it on every client each session (e.g. in the cpr-sam-agent.ready hook); null hands billing back.
 */
function handOffBilling(by) {
  setTraumaBilledBy(by);
  for (const phone of AgentPhone.all()) phone.refresh({ apps: true });
}

/** The GM's plans: [{ id, name, price, days, execRank, note }]. */
const traumaPlans = () => Object.entries(traumaConfig().tiers).map(([id, plan]) => ({ id, ...plan }));

/**
 * GM: change a character's coverage. Only what's given changes: `plan` (id or name, null for none),
 * `status` ("active", "lapsed" or "none"), `sponsor` (a name: never billed; null: billed),
 * `nextDue` (world time, seconds), `biolink`, `noAds`, and `notify` (an Agent alert to send).
 */
async function traumaUpdate({ actor, plan, status, sponsor, nextDue, biolink, noAds, notify } = {}) {
  requireGM("Changing Trauma Team coverage");
  if (status !== undefined && !["active", "lapsed", "none"].includes(status)) fail(`Trauma Team status "${status}": use "active", "lapsed" or "none".`);
  const target = resolveActor(actor);
  const tier = plan === undefined ? undefined : plan === null ? null : planId(plan);
  if (status && status !== "none" && !(tier ?? store.apps.subs?.[target.id]?.tier)) fail(`${displayName(target)} has no plan: give one (\`plan\`).`);
  await send("tt-update", { actorId: target.id, tier, status, sponsor, nextDue, biolink, noAds, notify });
}

async function traumaRevoke(actor) {
  requireGM("Ending Trauma Team coverage");
  await send("tt-revoke", { actorId: resolveActor(actor).id });
}

/** GM: open a Trauma Team call for a character, as if they'd pressed the button. */
async function traumaDispatch(actor, { reason = "" } = {}) {
  requireGM("Calling Trauma Team");
  await send("tt-call", { actorId: resolveActor(actor).id, reason });
}

/** Is this character covered by Trauma Team right now? */
const traumaCovered = actor => covered(store.apps.subs?.[resolveActor(actor).id]);

/* ---------------- App Store (id "pool") ---------------- */

/** An app id the App Store knows (not the App Store itself) or an add-on ("bigsaai"), or an error. */
function poolApp(app) {
  if ((!APP_MANIFEST[app] || app === "pool") && !ADDONS[app]) fail(`No app "${app}": ${[...Object.keys(APP_MANIFEST).filter(id => id !== "pool"), ...Object.keys(ADDONS)].join(", ")}.`);
  return app;
}

const pool = {
  /** Is the App Store switched on (phones show only what's installed)? */
  on: () => poolOn(),
  /** The app ids installed on a character's Agent (every app that's on while the App Store is off). */
  installed: actor => {
    const id = resolveActor(actor).id;
    return poolOn() ? [...installedSet(store.apps.installs, id)] : Object.keys(APP_MANIFEST).filter(app => feature(`app_${app}`));
  },
  /** Is this app on the character's Agent (and not lapsed)? */
  has: (actor, app) => {
    const id = resolveActor(actor).id;
    // An add-on counts whether or not the App Store is on.
    if (ADDONS[poolApp(app)]) return hasAddon(store.apps.installs, id, app);
    if (!poolOn()) return !!feature(`app_${poolApp(app)}`);
    return isInstalled(store.apps.installs, id, poolApp(app)) && !isLapsed(store.apps.installs, id, app);
  },
  /** GM: install an app on a character's Agent, free. */
  async grant({ actor, app } = {}) {
    requireGM("Installing apps");
    await send("pool-grant", { actorId: resolveActor(actor).id, app: poolApp(app) });
  },
  /** GM: take an app off a character's Agent, telling them why; `refund` pays back what they paid. */
  async revoke({ actor, app, reason = "Removed", refund = false } = {}) {
    requireGM("Removing apps");
    await send("pool-revoke", { actorId: resolveActor(actor).id, app: poolApp(app), reason, refund });
  },
  /** GM: a Fixer's app package in a conversation with `from` (a contact name), for `price` eb. */
  async sideload({ actor, app, price = 0, from = "Fixer", note = "" } = {}) {
    requireGM("Sideloading apps");
    await send("pool-sideload", { actorId: resolveActor(actor).id, app: poolApp(app), price, contact: contactName(from), note });
  }
};

/**
 * App subscriptions (monthly Pool apps), for a module that bills them (CPR HQ's Lifestyle bill), like
 * Trauma Team's: `state(actor)` is { items: [{ app, name, price, status, since, paidThrough, sponsor }],
 * total (a month of the active ones nobody sponsors), billedBy }.
 */
const subscriptions = {
  state: actor => subscriptionState(store.apps.installs, resolveActor(actor).id),
  /** Bill them yourself: while `by` is set the App Store charges nothing (not even on subscribing). null hands it back. Every client, each session. */
  handOffBilling(by) {
    setSubsBilledBy(by);
    for (const phone of AgentPhone.all()) phone.refresh({ apps: true });
  },
  billedBy: () => subsBilledBy(),
  /** GM: change one: `status` ("active", "lapsed", "cancelled"), `sponsor` (a name, or null), `notify` (an alert). */
  async update({ actor, app, status, sponsor, notify } = {}) {
    requireGM("Changing subscriptions");
    if (status !== undefined && !["active", "lapsed", "cancelled"].includes(status)) fail(`Subscription status "${status}": use "active", "lapsed" or "cancelled".`);
    await send("pool-sub", { actorId: resolveActor(actor).id, app: poolApp(app), status, sponsor, notify });
  },
  /** GM: the App Store's own monthly bill (when nobody else bills): what's due, or `all` the active ones. */
  async bill(actor, { all = false } = {}) {
    requireGM("Billing subscriptions");
    await send("pool-bill", { actorId: resolveActor(actor).id, all });
  }
};

/* ---------------- WatchBox ---------------- */

/** "off" | "assessing" | "armed" | "alarm" */
const watchStatus = actor => store.apps.watch?.[resolveActor(actor).id]?.status ?? "off";

/** GM: set off a character's armed WatchBox. */
async function watchTrigger(actor) {
  requireGM("Triggering WatchBox");
  const status = watchStatus(actor);
  if (status !== "armed" && status !== "alarm") fail(`${displayName(resolveActor(actor))}'s WatchBox isn't armed (${status}).`);
  await send("wb-trigger", { actorId: resolveActor(actor).id });
}

/* ---------------- Phones ---------------- */

/** This user's phone: the GM Phone for GMs, else their character's Agent. */
const phone = {
  open() {
    const p = AgentPhone.primary();
    if (!p.rendered) AgentPhone.toggle(game.user.isGM ? "console" : "token");
    return p;
  },
  close() {
    for (const p of AgentPhone.all()) if (p.rendered) p.close();
  },
  toggle() {
    AgentPhone.toggle(game.user.isGM ? "console" : "token");
  }
};

/* ---------------- Map ---------------- */

/**
 * The Map app (apps/map): open this user's phone on a place of the Map, or draw a small inline map of one.
 * A place: { noteId?, x?, y?, label?, sceneId? } (what Messages shares): `noteId` a Map pin, x/y the Map's px; one
 * with a `sceneId` is on the Map only when that's the NAV scene it was seeded from (older shares). `open` falls back
 * to that scene itself when the Map can't show it (no Map on the phone, another scene).
 */
const map = {
  async open(place = {}) {
    const p = phone.open();
    if (!p.rendered) await new Promise(resolve => Hooks.once("renderAgentPhone", resolve));
    if (p.mapOpen(place)) return true;
    if (place.sceneId) await openLocation(place);
    return false;
  },
  embed: (element, place, options = {}) => mapEmbed(element, place, { onOpen: to => map.open(to), ...options }),
  canShow: place => !!embedPlace(place)
};

/**
 * The GM's Agent Monitor, and what feeds it (ui/activity.js): `activity()` is what each player last
 * reported (GM), `note(text)` adds a line to the GM's log from a player's client, and
 * `registerScreen(appId, fn)` names a screen for the monitor.
 */
const monitor = {
  open: () => (requireGM("The Agent Monitor"), AgentMonitor.open()),
  close: () => AgentMonitor.instance?.close(),
  toggle: () => (requireGM("The Agent Monitor"), AgentMonitor.toggle()),
  activity: () => (requireGM("Reading players' activity"), foundry.utils.deepClone(Object.fromEntries(activity))),
  note: noteActivity,
  registerScreen
};

/** The GM Director: open, close or toggle it; `detach()` (an open Director) needs a click, like any pop-up. */
const director = {
  open: () => (requireGM("The Director"), Director.open()),
  close: () => Director.instance?.close(),
  toggle: () => (requireGM("The Director"), Director.toggle()),
  detach: () => {
    requireGM("The Director");
    if (!Director.instance?.rendered) fail("Open the Director first.");
    detach(Director.instance);
  }
};

/**
 * DataPool (apps/screamsheet): `publish({ outlet, headline, body, byline, image, subjects, tags, dv, reach, spin,
 * rep, hours, draft })` puts a clipping out (or on the desk with `draft: true`, or `hours` of world time ahead);
 * `drafts()` lists the desk's drafts (GM); `pulled(character)` the clippings a character's Agent has pulled;
 * `crawl(character?, { roll })` crawls now (no roll: the passive crawl, Headlines; a roll: everything
 * matching up to that DV, taken as is). The hook `cpr-sam-agent.screamPublished` gets each clipping that goes out.
 */
const screamsheet = {
  async publish({ outlet = "wns", headline, body = "", byline = "", image = "", subjects = [], tags = [], dv = 0, reach = "public", spin = "accurate", rep = null, hours = 0, draft = false, title = "" } = {}) {
    requireGM("Publishing clippings");
    if (!headline) fail("A clipping needs a `headline`.");
    const ids = resolveActors(subjects, "subject").map(a => a.id);
    const clip = {
      id: foundry.utils.randomID(), title, sheet: plainSheet({ outlet, headline, byline, text: body, image }),
      subjects: ids, tags, dv, reach, spin, rep: repList(rep) ?? [], source: { kind: "api" }
    };
    await send("scream-save", { clip, publish: !draft, hours });
    return clip.id;
  },
  drafts: () => (requireGM("Reading the DataPool desk"), foundry.utils.deepClone(Object.values(store.apps.screamClips ?? {}).filter(c => c.status === "draft"))),
  pulled: character => {
    const id = resolveActor(character).id;
    return foundry.utils.deepClone(Object.values(store.apps.screamClips ?? {}).filter(c => (c.actorIds ?? []).includes(id)));
  },
  async crawl(character = null, { roll = null } = {}) {
    requireGM("Running a DataPool crawl");
    const actorId = character ? resolveActor(character).id : null;
    if (roll !== null && !actorId) fail("A deep crawl needs a character.");
    await send("scream-crawl", { actorId, total: roll });
  }
};

/** GM: open the GM Phone on a character's conversation with a contact. */
function openConversation({ to, from, hidden = false } = {}) {
  requireGM("Opening conversations");
  const thread = store.findThread(resolveActor(to).id, contactName(from), !!hidden);
  if (!thread) fail("There's no such conversation yet.");
  AgentPhone.openThread(thread, "console");
}

/** Characters with phones (players' characters): { id, name }. */
const characters = () => playerCharacters().map(a => ({ id: a.id, name: displayName(a) }));

export const api = Object.freeze({
  version: 1,
  characters,
  // Communications
  text, call, endCalls, addContact, openConversation,
  // Agent
  alert,
  // Signal and Control's switches
  hasSignal, setSignal, feature: featureOn, setFeature: setFeatureOn,
  money: Object.freeze({ request: requestMoney, send: sendMoney, adjust: adjustWallet, invoice: sendInvoice, invoices: listInvoices, canInvoice }),
  jobs: Object.freeze({ save: saveJob, offer: offerJob, setStatus: setJobStatus }),
  garden: Object.freeze({
    post: gardenPost, queue: gardenQueue, accounts: gardenAccounts, logEvent: gardenLogEvent, plantSeed: gardenPlantSeed,
    pause: () => (requireGM("Pausing the Garden"), send("garden-queue", { op: "pause" })),
    resume: () => (requireGM("Resuming the Garden"), send("garden-queue", { op: "resume" }))
  }),
  trauma: Object.freeze({
    grant: traumaGrant, revoke: traumaRevoke, dispatch: traumaDispatch, covered: traumaCovered,
    status: traumaStatus, plans: traumaPlans, update: traumaUpdate,
    handOffBilling, billedBy: traumaBilledBy
  }),
  watchbox: Object.freeze({ status: watchStatus, trigger: watchTrigger }),
  pool: Object.freeze(pool),
  subscriptions: Object.freeze(subscriptions),
  phone: Object.freeze(phone),
  map: Object.freeze(map),
  monitor: Object.freeze(monitor),
  screamsheet: Object.freeze(screamsheet),
  director: Object.freeze(director),
  // Internals, for debugging; not part of the API (they change between versions).
  store, AgentPhone
});

export { resolveActor };

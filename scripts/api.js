import { DEFAULT_CONTACT_IMG, MODULE_ID } from "./config.js";
import { ALERT_KINDS } from "./model/apps.js";
import { findContact, getContacts, playerCharacters, setContacts } from "./model/contacts.js";
import { FEATURE_DEFAULTS, feature, noSignalSince, setFeature } from "./model/features.js";
import { gardenTiers } from "./model/garden.js";
import { QUEST_STATUSES } from "./model/quests.js";
import { getServices } from "./model/services.js";
import { actorAvatar, displayName } from "./model/threads.js";
import { covered, traumaConfig } from "./model/trauma.js";
import { store } from "./store.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";
import { patchSetting } from "./util/settings.js";

/*
 * The macro API: game.modules.get("cpr-slopagent").api (documented in API.md).
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
 * the cpr-slopagent.alertAnswered hook, so a macro can tell its own alerts' answers apart.
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

/** The Garden's accounts: { id, handle, name, kind, followers, actorId }. */
const gardenAccounts = () => Object.values(store.garden.accounts ?? {}).map(a => ({
  id: a.id, handle: a.handle, name: a.name, kind: a.kind, followers: a.followers ?? 0, actorId: a.actorId ?? null
}));

/* ---------------- Trauma Team ---------------- */

/** GM: give a character a Trauma Team plan (by id or name), paid for by `sponsor`. */
async function traumaGrant({ actor, plan, sponsor = "" } = {}) {
  requireGM("Granting Trauma Team coverage");
  const tiers = traumaConfig().tiers;
  const want = String(plan ?? "").toLowerCase();
  const tier = Object.keys(tiers).find(id => id === plan || tiers[id].name.toLowerCase() === want);
  if (!tier) fail(`No Trauma Team plan "${plan}": ${Object.values(tiers).map(t => t.name).join(", ")}.`);
  await send("tt-grant", { actorId: resolveActor(actor).id, tier, sponsor });
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
  money: Object.freeze({ request: requestMoney, send: sendMoney, adjust: adjustWallet }),
  jobs: Object.freeze({ save: saveJob, offer: offerJob, setStatus: setJobStatus }),
  garden: Object.freeze({
    post: gardenPost, queue: gardenQueue, accounts: gardenAccounts,
    pause: () => (requireGM("Pausing the Garden"), send("garden-queue", { op: "pause" })),
    resume: () => (requireGM("Resuming the Garden"), send("garden-queue", { op: "resume" }))
  }),
  trauma: Object.freeze({ grant: traumaGrant, revoke: traumaRevoke, dispatch: traumaDispatch, covered: traumaCovered }),
  watchbox: Object.freeze({ status: watchStatus, trigger: watchTrigger }),
  phone: Object.freeze(phone),
  // Internals, for debugging; not part of the API (they change between versions).
  store, AgentPhone
});

export { resolveActor };

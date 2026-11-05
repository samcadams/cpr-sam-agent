import { APP_LEDGER, APP_MANIFEST } from "../apps/manifest.js";
import { MODULE_ID, SOCKET } from "../config.js";
import { appearance } from "../model/appearance.js";
import { achievementList } from "../../apps/achieve/model.js";
import { cabbPlaces } from "../../apps/cabb/model.js";
import { collectibles } from "../../apps/gacha/model.js";
import { shownDist } from "../../apps/ncart/model.js";
import { stageLabel } from "../../apps/roach/model.js";
import { clock, lapOf, position } from "../../apps/redline/model.js";
import { getService } from "../model/services.js";
import { traumaConfig } from "../../apps/trauma/model.js";
import { AgentPhone } from "./phone/AgentPhone.js";
import { store } from "../store.js";

/*
 * What players are doing on their Agents, for the GM's Agent Monitor (ui/AgentMonitor.js).
 *
 * Each player's client reports to every GM, straight over the module socket (the host plays no part,
 * and nothing is saved):
 *  - "activity":      what their phone shows now (a Report, below), whenever that changes, plus
 *                     anything they just did on it (a Did)
 *  - "activity-ping": a GM asking every player to report again (the monitor opened, a GM reloaded)
 *
 * Where it comes from:
 *  - the phone's `phoneState` hook (it fires after every draw, so every page the player opens), read
 *    by describeScreen() below: a line for each app, from the page state the phone keeps
 *  - the `screen` hook, for pages that change without a redraw (Flappy Chrome's runs and score)
 *  - typing in a phone's text box (an `input` listener on the phone's window)
 *  - the store's `request` hook: every request the phone sends the host (a text, a payment, a ride…),
 *    named by DID_LABELS
 *  - noteActivity(text), for anything else that wants a line in the GM's log
 * Other modules and apps add their own screen lines with registerScreen(appId, fn) (API.md).
 *
 * Report: { userId, actorId, actorUuid, actorName, agent ("agent"|"internal"|null), open, minimized, locked,
 *           app, appName, icon, screen (one line), typing, idle, since (when this screen started), ts }
 * idle: the phone is open but the player hasn't clicked or typed in it for the "phoneIdleSeconds" setting.
 * Did:    { id, text, ts, actorId }
 */

/** How many recent actions the GM keeps per player. */
const LOG_SIZE = 12;

/** Requests a phone sends, as the GM reads them: type → text, or (data) => text. Unlisted ones aren't logged. */
const DID_LABELS = {
  send: d => (d.contact ? `Texted ${d.contact}` : "Sent a text") + attachments(d),
  "group-send": d => `Texted ${groupName(d.groupId)}${attachments(d)}`,
  "service-send": d => `Messaged ${serviceName(d.serviceId)}`,
  "service-action": d => `Used ${serviceName(d.serviceId)}`,
  react: d => `Reacted ${d.emoji ?? ""}`.trim(),
  "call-start": d => `Called ${d.contact ?? (d.groupId ? groupName(d.groupId) : serviceName(d.serviceId))}`,
  "call-answer": "Answered a call",
  "call-decline": "Declined a call",
  "call-hangup": "Hung up",
  "call-add": "Added someone to a call",
  "contact-request": d => `Asked to add ${d.name ?? "a contact"}`,
  "group-create": "Made a group chat",
  "group-add": "Added someone to a group chat",
  "group-remove": "Left or removed someone from a group chat",
  "group-rename": d => `Renamed a group chat to "${d.name}"`,
  delete: "Deleted a conversation",
  "money-send": d => `Sent ${money(d.amount)}`,
  "money-respond": d => `${d.action === "transfer" ? "Paid" : "Answered"} a money request`,
  "job-respond": d => (d.accept ? "Accepted a job" : "Turned down a job"),
  "alert-answer": d => `Answered their Agent: ${d.choice}`,
  "alert-dismiss": "Dismissed an Agent alert",
  "alex-ask": d => `Asked Alex: "${clip(d.text, 60)}"`,
  "alex-roll": "Rolled for an Alex search",
  "alex-clear": "Cleared their Alex searches",
  "bang-offer": d => `Offered ${money(d.amount)} on BangMe!`,
  "paypoint-pay": d => (d.label ? `Paid for ${clip(String(d.label), 60)}` : `Paid ${money(d.amount)}`),
  "tt-call": "CALLED TRAUMA TEAM",
  "tt-cancel": "Cancelled a Trauma Team call",
  "tt-subscribe": "Changed their Trauma Team plan",
  "tt-settings": "Changed Trauma Team settings",
  "wb-arm": "Armed their WatchBox",
  "wb-disarm": "Disarmed their WatchBox",
  "notes-make": "Started their notes",
  "notes-crew": "Opened crew notes",
  "cal-note": "Added a calendar note",
  "pigeon-play": d => (d.playing ? "Started playing Flappy Chrome" : `Stopped playing Flappy Chrome${d.runs ? `: ${d.runs} run${d.runs === 1 ? "" : "s"}, best ${d.best}` : ""}`),
  "pigeon-score": d => `Scored ${d.score} on Flappy Chrome`,
  "ncart-play": d => (d.playing ? "Started playing NCART Runner" : `Stopped playing NCART Runner${d.runs ? `: ${d.runs} run${d.runs === 1 ? "" : "s"}, best ${d.best} shards (${d.dist} m)` : ""}`),
  "ncart-score": d => `Ran ${d.dist} m for ${d.shards} shards on NCART Runner`,
  "roach-play": d => (d.playing ? "Started playing Roach Race" : `Stopped playing Roach Race${d.runs ? `: ${d.runs} run${d.runs === 1 ? "" : "s"}, best ${d.best}` : ""}`),
  "roach-score": d => `Scored ${d.score} on Roach Race`,
  "roach-pass": "Bought a Roach Race day pass",
  "roach-steed": "Picked a Roach Race steed",
  "redline-play": d => (d.playing ? "Started playing REDLINE" : `Stopped playing REDLINE${d.races ? `: ${d.races} race${d.races === 1 ? "" : "s"}${d.best ? `, best ${d.best}` : ""}` : ""}`),
  "redline-result": d => `Set ${clock(d.total / 1000)} on REDLINE${trackNameOf(d.trackId) ? `: ${trackNameOf(d.trackId)}` : ""}`,
  "redline-nominate": "Nominated a REDLINE course",
  "breach-ask": d => `Asked to breach ${breachPointName(d.pointId)}`,
  "breach-roll": d => `Rolled Backdoor: ${d.total}`,
  "breach-quick": "Settled a breach on the roll",
  "breach-quit": "Jacked out of a breach",
  "cabb-book": "Booked a Combat Cabb",
  "cabb-cancel": "Cancelled a Combat Cabb",
  "achieve-ask": "Claimed an achievement",
  "achieve-show": "Showed off an achievement",
  "share-texts": "Shared texts to chat",
  "achieve-box-open": "Opened a Mystery Box",
  "gacha-buy": "Bought zCreds",
  "gacha-pull": "Pulled a Gacha capsule",
  "gacha-sell": "Sold Gacha collectibles",
  "gacha-trade": "Traded a Gacha collectible",
  "gacha-show": "Showed off a Gacha collectible",
  "garden-join": "Joined The Garden",
  "garden-post": d => `Posted on The Garden: "${clip(d.text, 60)}"`,
  "garden-reply": d => `Replied on The Garden: "${clip(d.text, 60)}"`,
  "garden-like": "Liked a Garden post",
  "garden-graft": "Grafted a Garden post",
  "garden-profile": "Edited their Garden profile",
  "dating-create": "Made a Garden Dating profile",
  "dating-respond": d => (d.spark ? "Sparked a dating match" : "Passed on a dating match"),
  "dating-unmatch": "Unmatched someone on Garden Dating"
};

/** Screens outside the apps' own pages (see describeScreen). Apps add theirs with registerScreen. */
const SCREENS = new Map();

const clip = (text = "", n = 40) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const money = amount => (Number.isFinite(Number(amount)) ? `${Number(amount)}eb` : "money");
const attachments = d => [d.image && " + photo", d.location && " + location", d.job && " + job"].filter(Boolean).join("");
const groupName = id => store.threads.get(id)?.name ?? "a group";
const serviceName = id => getService(id)?.name ?? "a service";

/** An app's name and icon as the GM set them (Control → Labels and Icons), or the built-in ones'. */
const CORE_APPS = {
  home: ["Home", "fas fa-house"],
  contacts: ["Contacts", "fas fa-address-book"],
  messages: ["Messages", "fas fa-comments"],
  quests: ["Jobs", "fas fa-briefcase"],
  settings: ["Settings", "fas fa-gear"]
};
function appLabel(id) {
  const { names = {}, icons = {} } = appearance();
  const [name, icon] = CORE_APPS[id] ?? [APP_MANIFEST[id]?.name ?? id, APP_MANIFEST[id]?.icon ?? "fas fa-mobile"];
  return { appName: names[id] ?? name, icon: icons[id] ?? icon };
}

/**
 * Add (or replace) the line the GM sees for an app's screen: fn(phone, ctx) → string, run on the
 * player's client with their phone (its page state) and its context(). Null shows just the app's name.
 */
export function registerScreen(appId, fn) {
  SCREENS.set(appId, fn);
}

/* ---------------- The built-in screens ---------------- */

registerScreen("messages", phone => {
  const v = phone.view;
  if (!v) return phone.search ? `Searching conversations: "${clip(phone.search)}"` : "Conversation list";
  const notes = phone.notesOpen ? " (reading their notes)" : "";
  if (v.kind === "direct") return `Chat with ${v.contact}${v.hidden ? " (hidden number)" : ""}${notes}`;
  if (v.kind === "card") return `${v.contact}'s contact card${notes}`;
  if (v.kind === "group") return `Group chat: ${groupName(v.groupId)}`;
  if (v.kind === "group-info") return `Group info: ${groupName(v.groupId)}`;
  if (v.kind === "service") return `${serviceName(v.serviceId)}`;
  return null;
});
registerScreen("contacts", phone => (phone.contactSearch ? `Searching contacts: "${clip(phone.contactSearch)}"` : "Contact list"));
registerScreen("quests", phone => {
  const quest = phone.questId ? store.quests.get(phone.questId) : null;
  return quest ? `Job: ${quest.name}` : `Job list: ${phone.questTab}`;
});
registerScreen("settings", phone => (phone.emojiCatalogOpen ? "Picking emoji" : "Phone settings"));
registerScreen("home", () => "Home screen");
registerScreen("agent", (phone, ctx) => {
  const waiting = Object.values(store.apps.alerts ?? {}).filter(a => a.actorId === ctx?.actorId && a.choices?.length && !a.answer).length;
  return waiting ? `Alerts: ${waiting} waiting for an answer` : "Alerts and personality";
});
registerScreen("garden", phone => {
  const tab = { feed: "Feed", news: "News", dating: "Dating" }[phone.gardenTab] ?? "Feed";
  if (phone.gardenPost) {
    const post = store.garden.posts?.[phone.gardenPost];
    const author = store.garden.accounts?.[post?.accountId]?.name;
    if (phone.gardenReplyDraft) return `Replying to ${author ?? "a post"}`;
    return author ? `Reading ${author}'s post` : "Reading a post";
  }
  if (phone.gardenAccount) return `Profile: ${store.garden.accounts?.[phone.gardenAccount]?.name ?? "an account"}`;
  if (phone.gardenDraft) return `${tab}: writing a post`;
  return tab;
});
registerScreen("alex", (phone, ctx) => {
  if (phone.alexRolling) return "Rolling for a search";
  if (phone.alexDraft) return `Typing a search: "${clip(phone.alexDraft)}"`;
  const latest = Object.values(store.apps.queries ?? {}).filter(q => q.actorId === ctx?.actorId).sort((a, b) => b.ts - a.ts)[0];
  if (!latest) return "No searches yet";
  const what = `"${clip(latest.text, 30)}"`;
  return {
    crawling: `Waiting on a search: ${what}`,
    roll: `Asked to roll for ${what}`,
    answered: `Reading the answer to ${what}`,
    none: `No results for ${what}`
  }[latest.status] ?? "Search history";
});
const LEDGER_FILTERS = { message: "Transfers", bang: "Bangs", paypoint: "Pay points", adjust: "Adjustments", ...APP_LEDGER };
registerScreen("bangme", phone => (LEDGER_FILTERS[phone.bangFilter] ? `Ledger: ${LEDGER_FILTERS[phone.bangFilter]}` : "Balance and ledger"));
registerScreen("trauma", (phone, ctx) => {
  const id = ctx?.actorId;
  const open = Object.values(store.apps.dispatches ?? {}).find(d => d.actorId === id && d.status !== "closed");
  if (open) {
    const label = { pending: "calling Dispatch", enroute: open.landing ? "AV-4 landing" : "AV-4 inbound", arrived: "team on site" }[open.status] ?? open.status;
    return `Emergency: ${label}`;
  }
  const sub = store.apps.subs?.[id];
  const plan = sub?.tier ? traumaConfig().tiers[sub.tier] : null;
  if (!plan || sub.status === "none") return "No coverage: looking at plans";
  if (sub.status === "lapsed") return `${plan.name} plan: LAPSED`;
  return `${plan.name} plan: covered${sub.sponsor ? ` (${sub.sponsor})` : ""}`;
});
registerScreen("watchbox", () => "Setting up a WatchBox");
registerScreen("notes", phone => {
  const open = phone.noteOpen;
  const page = open ? game.journal.get(open.entryId)?.pages.get(open.pageId) : null;
  if (page) return `${phone.noteEditing ? "Editing" : "Reading"} note: ${page.name}`;
  return "Note list";
});
registerScreen("calendar", phone => {
  if (phone.calAdding) return "Adding a calendar note";
  return phone.calDay ? "A day's plans" : "This month";
});
registerScreen("pigeon", phone => {
  const g = phone.pigeon;
  const best = phone._pigeonSession?.best ? `, best ${phone._pigeonSession.best}` : "";
  if (phone._pigeonEntry) return `Made the board: #${phone._pigeonEntry.rank} with ${phone._pigeonEntry.score}, entering initials`;
  if (phone._pigeonRunning) return `Playing: score ${g?.score ?? 0}${best}`;
  if (g?.over) return `Crashed at ${g.score}${best}`;
  return "Leaderboard";
});
registerScreen("ncart", phone => {
  const g = phone.ncart;
  const s = phone._ncartSession;
  const best = s?.best ? `, best ${s.best} shards` : "";
  if (phone._ncartEntry) return `Made the board: #${phone._ncartEntry.rank} with ${phone._ncartEntry.shards} shards, entering initials`;
  if (phone._ncartRunning) return `${g?.paused ? "Paused" : "Running"}: ${g?.shards ?? 0} shards, ${shownDist(g?.dist ?? 0)} m${best}`;
  if (g?.over) return `Crashed at ${shownDist(g.dist)} m with ${g.shards} shards${best}`;
  return "Leaderboard";
});
registerScreen("roach", phone => {
  const g = phone.roach;
  const best = phone._roachSession?.best ? `, best ${phone._roachSession.best}` : "";
  if (phone.roachStable) return "In the stable (Steeds)";
  if (phone._roachEntry) return `Made the Hall of Fame: #${phone._roachEntry.rank} with ${phone._roachEntry.score}, entering initials`;
  if (phone._roachRunning) return `${g?.paused ? "Paused" : "Riding"}: ${Math.floor(g?.score ?? 0)} at ${stageLabel(g?.stage ?? 0)}${best}`;
  if (g?.over) return `Crashed at ${Math.floor(g.score)} (${stageLabel(g.stage)})${best}`;
  return "Hall of Fame";
});
/** A REDLINE track's name, by id. */
const trackNameOf = id => (game.settings.get(MODULE_ID, "redlineTracks")?.tracks ?? []).find(t => t.id === id)?.name ?? "";

registerScreen("redline", phone => {
  const g = phone.redline;
  if (phone._rlPreview) return `Fly-through: ${g?.track.spec.name ?? "a track"}`;
  if (phone._rlRunning && g) {
    const where = g.track.closed ? `lap ${lapOf(g)}/${g.track.spec.laps}` : `${Math.round(Math.max(0, g.p.total) / 100) / 10} km`;
    return `${g.paused ? "Paused" : "Racing"}: ${g.track.spec.name}, ${where}, P${g.finished ? g.place : position(g)}, ${clock(Math.max(0, g.t))}`;
  }
  if (phone.rlResult) return `${phone.rlResult.title}: ${phone.rlResult.name}${phone.rlResult.time ? ` in ${phone.rlResult.time}` : ""}`;
  return phone.rlTab === "tracks" ? "Set Tracks" : "Quick Race";
});
/** A Breach Point's name, by id. */
const breachPointName = id => store.apps.breachPoints?.[id]?.name ?? "a Breach Point";

registerScreen("breach", (phone, ctx) => {
  const p = phone.brPractice;
  if (p) return p.status === "done" ? "Practice grid: done" : `Practice grid: buffer ${p.picks.length}/${p.buffer}`;
  const run = Object.values(store.apps.breaches ?? {}).find(r => r.actorId === ctx?.actorId && ["asked", "approved", "ready", "running"].includes(r.status));
  if (!run) return "Access points nearby";
  if (run.status === "asked") return `Waiting to breach ${run.name}`;
  if (run.status === "approved") return `Jacked into ${run.name}, about to roll`;
  return `Breaching ${run.name}: buffer ${run.picks.length}/${run.buffer}${run.status === "ready" ? ", studying the grid" : ""}`;
});
registerScreen("cabb", (phone, ctx) => {
  const ride = Object.values(store.apps.rides ?? {}).find(r => r.actorId === ctx?.actorId && ["enroute", "waiting", "riding"].includes(r.status));
  if (ride) {
    const where = ride.status === "riding" ? `riding to ${ride.to?.name}` : `cab ${ride.status === "waiting" ? "waiting at" : "on its way to"} ${ride.from?.name}`;
    return `Ride: ${where}`;
  }
  const to = phone.cabbTo ? cabbPlaces().find(p => p.id === phone.cabbTo)?.name ?? "somewhere" : null;
  return to ? `Getting a fare to ${to}` : "Map: picking a place";
});
registerScreen("achieve", (phone, ctx) => {
  if (phone.achTab === "boxes") {
    const waiting = Object.values(store.apps.boxes ?? {}).filter(b => b.actorId === ctx?.actorId && b.status === "sealed").length;
    return waiting ? `Mystery Boxes: ${waiting} unopened` : "Mystery Boxes";
  }
  const open = phone.achOpen ? achievementList().find(a => a.id === phone.achOpen) : null;
  return open ? `Achievement: ${open.name}` : "Achievements";
});
registerScreen("gacha", (phone, ctx) => {
  const shelf = store.apps.gachaShelves?.[ctx?.actorId] ?? [];
  const nameOf = id => {
    const pull = shelf.find(p => p.id === id);
    return collectibles().find(c => c.id === pull?.cid)?.name ?? "a collectible";
  };
  if (phone.gachaReveal) return `Pulled: ${nameOf(phone.gachaReveal)}`;
  if (phone.gachaTab === "shelf") return phone.gachaPick ? `Shelf: ${nameOf(phone.gachaPick)}` : `Shelf (${shelf.length})`;
  return "Capsules";
});

/** One line for what the phone shows now. */
function describeScreen(phone, ctx) {
  if (phone.locked) return "Lock screen";
  if (phone._watching) return "Sitting armed as a WatchBox";
  const role = store.myCall();
  if (role?.kind === "incoming") return "Incoming call";
  if (role && !phone.callHidden) return "On the call screen";
  if (phone.appSettings) return "App settings";
  try {
    return SCREENS.get(phone.app)?.(phone, ctx) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Activity: describing ${phone.app} failed`, err);
    return null;
  }
}

/* ---------------- Players: reporting ---------------- */

let last = null; // the last Report sent (as JSON, to skip repeats)
let current = null; // the last Report
let typing = false;
const log = []; // this player's recent Dids, resent on a ping

const gmIds = () => game.users.filter(u => u.isGM && u.active).map(u => u.id);

function emit(payload) {
  const recipients = gmIds();
  if (recipients.length) game.socket.emit(SOCKET, { type: "activity", ...payload }, { recipients });
}

/** What this player's phone shows now (its own Agent, not a popped-out job). */
function snapshot() {
  const phone = AgentPhone.token;
  const ctx = phone?.rendered ? phone._ctx ?? phone.context() : null;
  const open = !!(phone?.rendered && ctx);
  const app = open ? phone.app : null;
  return {
    userId: game.user.id,
    actorId: ctx?.actorId ?? null,
    actorUuid: ctx?.subject?.actor?.uuid ?? null,
    actorName: ctx?.subject?.name ?? null,
    agent: ctx?.subject?.agent ?? null,
    open,
    minimized: open && !!phone._minimized,
    locked: open && !!phone.locked,
    app,
    ...(app ? appLabel(app) : { appName: null, icon: null }),
    screen: open ? describeScreen(phone, ctx) : null,
    typing: open && typing,
    idle: open && idle
  };
}

/** Tell the GMs what the phone shows, if that changed (or `force`). */
function report(force = false) {
  if (game.user.isGM) return;
  const next = snapshot();
  const key = JSON.stringify(next);
  if (!force && key === last) return;
  // "since" restarts when the screen changes, not when typing starts or stops.
  const sameScreen = current && current.app === next.app && current.screen === next.screen && current.open === next.open;
  current = { ...next, since: sameScreen ? current.since : Date.now(), ts: Date.now() };
  last = key;
  emit({ report: current, log: force ? log : undefined });
}
const reportSoon = foundry.utils.debounce(() => report(), 150);

/** Something this player just did, for the GM's log. */
export function noteActivity(text) {
  if (game.user.isGM || !text) return;
  const did = { id: foundry.utils.randomID(), text: String(text), ts: Date.now(), actorId: current?.actorId ?? null };
  log.push(did);
  if (log.length > LOG_SIZE) log.shift();
  emit({ did });
}

/** Typing in a phone's text box: on as soon as they type, off a few seconds after they stop. */
const stopTyping = foundry.utils.debounce(() => {
  typing = false;
  reportSoon();
}, 4000);
function onInput(event) {
  if (!event.target.matches?.("textarea, input[type=text], input:not([type])")) return;
  stopTyping();
  if (typing) return;
  typing = true;
  reportSoon();
}

/**
 * Idle: no click, key or scroll in the open phone for the "phoneIdleSeconds" setting (0: never idle).
 * The check only runs while the phone is open and not minimised.
 * Input is caught on the window, early (capture), because pages inside the phone stop some of it on its
 * way out (BREACH's matrix keys, the Map's drags, a Gacha pull). The keyboard games take their keys on the
 * window, before they reach the phone, and report each one with the `input` hook.
 */
let idle = false;
let lastInput = Date.now();
let idleTimer = null;
function onPhoneInput() {
  lastInput = Date.now();
  if (!idle) return;
  idle = false;
  reportSoon();
}
/** The player's phone, while it's open and not minimised. */
function phoneInHand() {
  const phone = AgentPhone.token;
  return phone?.rendered && !phone._minimized ? phone : null;
}
/**
 * Whether an input's target is inside the phone's element. Foundry's gamepad poll dispatches input whose
 * target isn't a DOM Node, and `contains` throws on those.
 */
export function landsIn(el, target) {
  return !!el && typeof Node !== "undefined" && target instanceof Node && el.contains(target);
}
/** A click, key or scroll anywhere: it counts when it lands in the phone in hand. */
function onWindowInput(event) {
  if (landsIn(phoneInHand()?.element?.[0], event.target)) onPhoneInput();
}
/** A page that takes input outside the phone's window (a game's keys): the phone in hand is in use. */
function onPageInput(phone) {
  if (!game.user.isGM && phone?.mode === "token" && phone === phoneInHand()) onPhoneInput();
}
function checkIdle() {
  const phone = AgentPhone.token;
  const seconds = Number(game.settings.get(MODULE_ID, "phoneIdleSeconds")) || 0;
  const next = !!(phone?.rendered && !phone._minimized && seconds > 0 && Date.now() - lastInput >= seconds * 1000);
  if (next === idle) return;
  idle = next;
  reportSoon();
}

const watched = new WeakSet(); // phone windows with the typing listener on

/* ---------------- GMs: what players report ---------------- */

/** userId → { report, log: [Did] }, on GM clients. */
export const activity = new Map();

function receive(msg, senderId) {
  const sender = game.users.get(senderId);
  if (!sender || sender.isGM) return;
  const entry = activity.get(senderId) ?? { report: null, log: [] };
  if (msg.report) entry.report = { ...msg.report, userId: senderId };
  // A line from a client on an older version has no id: one from who and when, so it can be dismissed.
  const withId = did => ({ ...did, id: did.id ?? `${senderId}-${did.ts}` });
  if (msg.log) entry.log = msg.log.slice(-LOG_SIZE).map(withId);
  if (msg.did) {
    entry.log.push(withId(msg.did));
    if (entry.log.length > LOG_SIZE) entry.log.shift();
  }
  activity.set(senderId, entry);
  Hooks.callAll(`${MODULE_ID}.activity`, { userId: senderId, report: entry.report, did: msg.did ?? null });
}

/** GM: ask every player to report again. */
export function pingActivity() {
  if (!game.user.isGM) return;
  const recipients = game.users.filter(u => !u.isGM && u.active).map(u => u.id);
  if (recipients.length) game.socket.emit(SOCKET, { type: "activity-ping" }, { recipients });
}

export function installActivity() {
  Hooks.once("ready", () => {
    if (!game.user.isGM) {
      for (const type of ["pointerdown", "keydown", "wheel"]) window.addEventListener(type, onWindowInput, { capture: true, passive: true });
    }
    game.socket.on(SOCKET, (msg, senderId) => {
      if (msg?.type === "activity" && game.user.isGM) receive(msg, senderId);
      else if (msg?.type === "activity-ping" && !game.user.isGM && game.users.get(senderId)?.isGM) report(true);
    });
    if (game.user.isGM) pingActivity();
    else report(true);
  });

  // Every page the phone draws, and it opening, closing, minimising.
  Hooks.on(`${MODULE_ID}.phoneState`, phone => {
    if (game.user.isGM || phone.mode !== "token") return;
    const el = phone.element?.[0];
    if (el && !watched.has(el)) {
      watched.add(el);
      el.addEventListener("input", onInput);
    }
    if (!phone.rendered) typing = false;
    // Opening the phone (or restoring it) counts as using it; the idle check runs only while it's in hand.
    const inHand = phone.rendered && !phone._minimized;
    if (inHand && !idleTimer) {
      onPhoneInput();
      idleTimer = setInterval(checkIdle, 5_000);
    } else if (!inHand && idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
      idle = false;
    }
    reportSoon();
  });
  // A page whose screen changes without a redraw (Flappy Chrome's runs).
  Hooks.on(`${MODULE_ID}.screen`, phone => !game.user.isGM && phone.mode === "token" && reportSoon());
  // A game's keys, which it takes on the window before they reach the phone.
  Hooks.on(`${MODULE_ID}.input`, onPageInput);
  // Everything the phone asks the host to do (store.request); what's on screen may follow from it.
  Hooks.on(`${MODULE_ID}.request`, (type, data) => {
    if (game.user.isGM) return;
    reportSoon();
    const label = DID_LABELS[type];
    if (!label) return;
    try {
      noteActivity(typeof label === "function" ? label(data ?? {}) : label);
    } catch (err) {
      console.warn(`${MODULE_ID} | Activity: labelling ${type} failed`, err);
    }
  });
  // A player who changes which character's phone they hold, without a redraw.
  Hooks.on("controlToken", () => !game.user.isGM && reportSoon());
  // A GM who joins asks for the current picture; a player who leaves stops being "on" their phone.
  Hooks.on("userConnected", (user, connected) => {
    if (!game.user.isGM) {
      if (user.isGM && connected) report(true);
      return;
    }
    if (!connected && activity.has(user.id)) {
      const entry = activity.get(user.id);
      if (entry.report) entry.report = { ...entry.report, open: false, typing: false, ts: Date.now() };
      Hooks.callAll(`${MODULE_ID}.activity`, { userId: user.id, report: entry.report, did: null });
    }
  });
}

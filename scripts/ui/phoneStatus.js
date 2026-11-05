import { MODULE_ID } from "../config.js";
import { activity } from "./activity.js";

/*
 * A phone icon on a player's token while they have their Agent open (a status effect on the actor).
 *
 * The players' phones already tell every GM what they show (ui/activity.js: open, minimized, idle).
 * The active GM turns that into an Active Effect with the PHONE_STATUS status on the phone's actor,
 * and takes it off when the phone closes or minimises, the player goes idle ("phoneIdleSeconds") or
 * disconnects. The effect is registered in CONFIG.statusEffects (hidden from the token HUD) so it has
 * a name and icon like any other status, but it is created directly, so it works whether or not
 * Condition Lab (which rewrites CONFIG.statusEffects from its condition maps) is active.
 */

export const PHONE_STATUS = `${MODULE_ID}-phone`;
const ICON = `modules/${MODULE_ID}/images/status/phone-open.svg`;
const NAME = "Using Agent";
const EFFECT = { name: NAME, img: ICON, statuses: [PHONE_STATUS], flags: { [MODULE_ID]: { phoneOpen: true } } };

/** Add the status to CONFIG.statusEffects, if it isn't there (Condition Lab may have replaced the list). */
function registerStatus() {
  if (CONFIG.statusEffects.some(s => s.id === PHONE_STATUS)) return;
  CONFIG.statusEffects.push({ id: PHONE_STATUS, name: NAME, img: ICON, hud: false });
}

const isActiveGM = () => game.user === game.users.activeGM;

/**
 * The actor's own phone-status effects. An unlinked token's actor also lists its base actor's effects,
 * which aren't its to remove: only the ones in the token's delta count.
 */
function phoneEffects(actor) {
  const own = actor?.isToken ? actor.token?.delta?.effects : null;
  return actor?.effects.filter(e => e.statuses.has(PHONE_STATUS) && (!own || own.has(e.id))) ?? [];
}

/** Every actor that may have the effect: world actors and the active scene's unlinked tokens. */
function knownActors() {
  const actors = [...game.actors];
  for (const token of canvas.scene?.tokens ?? []) if (!token.actorLink && token.actor) actors.push(token.actor);
  return actors;
}

/** Whether a player's report says their Agent is open and in use. */
const inUse = report => !!(report?.open && !report.minimized && !report.idle);
const reportActor = report => (report.actorUuid ? fromUuidSync(report.actorUuid) : game.actors.get(report.actorId));

/** uuid → actor whose player has the phone open and in use now. */
function wanted() {
  const out = new Map();
  if (!game.settings.get(MODULE_ID, "phoneStatusIcon")) return out;
  for (const [userId, { report }] of activity) {
    if (!inUse(report) || !game.users.get(userId)?.active) continue;
    const actor = reportActor(report);
    if (actor instanceof Actor) out.set(actor.uuid, actor);
  }
  return out;
}

/**
 * Whether the effect may come off: the icon is switched off, nobody who owns the actor is online, or
 * every owner online has reported (a GM that just logged in hasn't heard from everyone yet, and must
 * not take icons off players it knows nothing about).
 */
function mayRemove(actor) {
  if (!game.settings.get(MODULE_ID, "phoneStatusIcon")) return true;
  const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owners.every(u => activity.get(u.id)?.report);
}

/** Put the effect on the actors that should have it and take it off the rest (active GM only). */
async function sync() {
  if (!isActiveGM()) return;
  const want = wanted();
  for (const actor of want.values()) {
    const [first, ...extra] = phoneEffects(actor);
    if (!first) await actor.createEmbeddedDocuments("ActiveEffect", [EFFECT]);
    else if (first.name !== NAME || first.img !== ICON) await first.update({ name: NAME, img: ICON });
    // Two GMs both active for a moment (a role change) can each have added one: drop the spares quietly.
    if (extra.length) await actor.deleteEmbeddedDocuments("ActiveEffect", extra.map(e => e.id), { animate: false });
  }
  for (const actor of knownActors()) {
    if (want.has(actor.uuid)) continue;
    const effects = phoneEffects(actor);
    if (!effects.length || !mayRemove(actor)) continue;
    // Read them again right before removing: another sync or GM may already have.
    const ids = effects.map(e => e.id).filter(id => actor.effects.has(id));
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

// One sync at a time, the last change wins; reports arriving together (a GM's ping) make one sync.
let running = Promise.resolve();
const syncSoon = foundry.utils.debounce(() => {
  running = running.then(sync).catch(err => console.warn(`${MODULE_ID} | Phone status icon: sync failed`, err));
}, 1000);

export function installPhoneStatus() {
  Hooks.once("init", () => {
    const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
    world("phoneStatusIcon", {
      name: "Phone icon on tokens",
      hint: "Show a phone icon on a player's token while they have their Agent open. It goes when they close or minimise it, or stop using it (below).",
      type: Boolean,
      default: true,
      onChange: () => syncSoon()
    });
    world("phoneIdleSeconds", {
      name: "Phone icon: idle after (seconds)",
      hint: "Take the phone icon off a token when its player hasn't clicked or typed in their open Agent for this long. 0 keeps it while the phone is open.",
      type: Number,
      range: { min: 0, max: 3600, step: 5 },
      default: 30,
      onChange: () => syncSoon()
    });
    registerStatus();
  });

  Hooks.once("ready", () => {
    registerStatus();
    // After the players answer the GM's ping (activity.js), clear icons left from before (a GM reload).
    if (game.user.isGM) setTimeout(syncSoon, 3000);
  });
  Hooks.on(`${MODULE_ID}.activity`, () => game.user.isGM && syncSoon());
  // Another GM leaving can make this one the active GM.
  Hooks.on("userConnected", user => game.user.isGM && user.isGM && syncSoon());
  Hooks.on("canvasReady", () => game.user.isGM && syncSoon());
}

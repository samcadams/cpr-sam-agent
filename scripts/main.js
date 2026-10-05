import { api } from "./api.js";
import { DIALOGS, MODULE_ID, PARTIALS, STYLES, TEMPLATES } from "./config.js";
import { registerSettings } from "./settings.js";
import { installNotifications } from "./ui/notifications.js";
import { commsOn } from "./model/features.js";
import { loadGardenLists } from "./model/garden.js";
import { store } from "./store.js";
import { CallAudio } from "./ui/CallAudio.js";
import { CallWidget } from "./ui/CallWidget.js";
import { WorldSounds } from "./ui/WorldSounds.js";
import { GmButton, TokenButton, updateButtons } from "./ui/buttons.js";
import { ContactsManager } from "./ui/managers/ContactsManager.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";

/**
 * Add any of the module's stylesheets the page doesn't have (new in an update, before the world was
 * relaunched), keeping their order: each goes after the one before it in STYLES.
 */
function ensureStyles() {
  const base = `modules/${MODULE_ID}/`;
  const links = () => [...document.querySelectorAll("link[rel=stylesheet]")];
  let previous = null;
  for (const path of STYLES) {
    let link = links().find(l => l.getAttribute("href")?.split("?")[0].endsWith(base + path));
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${base}${path}?v=${game.modules.get(MODULE_ID)?.version ?? ""}`;
      if (previous) previous.after(link);
      else document.head.append(link);
      console.info(`${MODULE_ID} | Loaded ${path} (new since the world was launched)`);
    }
    previous = link;
  }
}

Hooks.once("init", () => {
  ensureStyles();
  registerSettings();
  loadTemplates([...Object.values(TEMPLATES), ...Object.values(DIALOGS)]);
  loadTemplates(PARTIALS);
});

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = api; // for macros: API.md
  TokenButton.create();
  if (game.user.isGM) GmButton.create();
  updateButtons();
  // The Garden's word lists (text files): the host makes things up from them, GMs see them.
  if (game.user.isGM) await loadGardenLists();
  await store.init();
  Hooks.callAll(`${MODULE_ID}.ready`, api);
});

/** Redraw phones (each skips what doesn't touch its screen; see AgentPhone.refresh) and badges. */
const refreshPhones = (change = { all: true }) => {
  for (const phone of AgentPhone.all()) phone.refresh(change);
  updateButtons();
  CallAudio.update(); // e.g. silenced mid-ring
};

// Any change to the message data: refresh phones and badges.
Hooks.on(`${MODULE_ID}.changed`, change => refreshPhones(change));

// The Agent in hand follows token selection and inventory.
const refreshSubject = foundry.utils.debounce(() => refreshPhones(), 100);
Hooks.on("controlToken", refreshSubject);
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, refreshSubject);
Hooks.on("updateUser", (user, changes) => {
  if (user === game.user && ("character" in changes || changes.flags?.[MODULE_ID])) refreshSubject();
});
/** A module setting changed (created the first time it's saved, updated after). */
function onSettingChanged(setting) {
  if (!setting.key.startsWith(`${MODULE_ID}.`)) return;
  refreshSubject();
  if (!store.isHost) return;
  // What players may see has changed: resend it.
  if (setting.key === `${MODULE_ID}.features`) {
    // Communications switched off: calls end (their logs are kept with the conversations).
    if (!commsOn()) store._enqueue(() => store._endCalls());
    store.syncAll();
  }
  if (setting.key === `${MODULE_ID}.noSignal`) store._signalChanged();
}

/** A GM changed the Garden's word list files: read them again. */
function onGardenConfig(setting) {
  if (setting.key === `${MODULE_ID}.gardenConfig` && game.user.isGM) loadGardenLists().then(() => refreshPhones({ garden: true }));
}
for (const hook of ["createSetting", "updateSetting"]) {
  Hooks.on(hook, onSettingChanged);
  Hooks.on(hook, onGardenConfig);
}

installNotifications(refreshPhones);

Hooks.on("userConnected", () => store.onUserConnected());

// The minimised call card follows the call and whether the phone is open.
Hooks.on(`${MODULE_ID}.phoneState`, () => CallWidget.update());

// Combat rounds: Trauma Team ETAs counted in rounds.
Hooks.on("updateCombat", (combat, changes) => {
  if (!("round" in changes)) return;
  for (const phone of AgentPhone.all()) phone.refresh({ apps: true });
  if (store.isHost) store._onCombatRound();
});

// The clock also runs on its own (system time, or the GM's clock).
setInterval(() => {
  for (const phone of AgentPhone.all()) phone.updateClock();
}, 15_000);

Hooks.on("updateWorldTime", () => {
  for (const phone of AgentPhone.all()) phone.updateClock();
  if (store.isHost) store._onWorldTime();
});

// The host watches the world for the apps: Critical Injuries and Exec ranks (Trauma Team).
Hooks.on("createItem", item => {
  const actor = item.parent;
  if (!store.isHost || actor?.documentName !== "Actor") return;
  if (item.type === "criticalInjury") store._enqueue(() => store._onCriticalInjury(actor));
  if (item.type === "role") store._enqueue(() => store._applyExecCoverage(actor) && store._pushApps());
});
Hooks.on("updateItem", item => {
  if (store.isHost && item.type === "role" && item.parent?.documentName === "Actor") store._enqueue(() => store._applyExecCoverage(item.parent) && store._pushApps());
});

// Contact lists and notes live on actors; keep phones in step. So do names, pictures and who owns
// a sheet (Control's Characters, conversation headers).
// Hit points too: a badly hurt character's phone gets blood on it (ui/phone/pages/blood.js).
Hooks.on("updateActor", (actor, changes) => {
  const hp = foundry.utils.hasProperty(changes, "system.derivedStats.hp");
  if (hp && store.isHost) store._enqueue(() => store._onHealth(actor));
  if (changes.flags?.[MODULE_ID]) refreshPhones();
  else if (["name", "img", "prototypeToken", "ownership"].some(k => k in changes)) refreshSubject();
  else if (hp) for (const phone of AgentPhone.all()) phone.refresh();
});
for (const hook of ["createActor", "deleteActor"]) Hooks.on(hook, refreshSubject);

// Rings and text tones heard around tokens.
Hooks.on(`${MODULE_ID}.worldSound`, data => WorldSounds.play(data));
Hooks.on(`${MODULE_ID}.worldSoundStop`, id => WorldSounds.stop(id));

// GM-only "Contacts" button on actor sheets (while Communications are on).
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  if (!game.user.isGM || !commsOn()) return;
  buttons.unshift({
    label: "Contacts",
    class: "ctp-open-contacts",
    icon: "fas fa-address-book",
    onclick: () => ContactsManager.open(sheet.actor)
  });
});

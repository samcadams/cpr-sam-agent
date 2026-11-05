import { api } from "./api.js";
import { DIALOGS, MODULE_ID, PARTIALS, STYLES, TEMPLATES } from "./config.js";
import { BUNDLE } from "./styles.js";
import { registerSettings } from "./settings.js";
import { contentReady, registerContent } from "./model/content.js";
import { installNotifications } from "./ui/notifications.js";
import { commsOn, settleAppsOff } from "./model/features.js";
import { seedDefaultServices } from "./model/services.js";
import { store } from "./store.js";
import * as clients from "../apps/clients.js";
import { CallAudio } from "./ui/CallAudio.js";
import { CallWidget } from "./ui/CallWidget.js";
import { WorldSounds } from "./ui/WorldSounds.js";
import { DirectorButton, GmButton, TokenButton, updateButtons } from "./ui/buttons.js";
import { ContactsManager } from "./ui/managers/ContactsManager.js";
import { AgentPhone } from "./ui/phone/AgentPhone.js";
import { applyReduceMotion } from "./ui/a11y.js";
import { installAgentShown } from "./ui/agentShown.js";
import { installJobPopout } from "./ui/JobPopout.js";
import { installActivity } from "./ui/activity.js";
import { installAgentMonitor } from "./ui/AgentMonitor.js";
import { installDirector } from "./ui/director/Director.js";
import { installPhoneStatus } from "./ui/phoneStatus.js";

/**
 * Add any of the module's stylesheets the page doesn't have (new in an update, before the world was
 * relaunched), keeping their order: each goes after the one before it in STYLES.
 */
function ensureStyles() {
  const base = `modules/${MODULE_ID}/`;
  const links = () => [...document.querySelectorAll("link[rel=stylesheet]")];
  // The bundle (npm run bundle) already holds every stylesheet.
  if (links().some(l => l.getAttribute("href")?.split("?")[0].endsWith(base + BUNDLE.css))) return;
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
  registerContent(() => refreshPhones());
  loadTemplates([...Object.values(TEMPLATES), ...Object.values(DIALOGS)]);
  loadTemplates(PARTIALS);
});

// Whether this world used the module before this session (read before anything this session saves).
let existingWorld = false;
Hooks.once("setup", () => {
  existingWorld = !!game.settings.storage.get("world")?.some(s => s.key.startsWith(`${MODULE_ID}.`));
});

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = api; // for macros: API.md
  applyReduceMotion();
  await contentReady(); // the content folder's art and achievements (model/content.js)
  TokenButton.create();
  if (game.user.isGM) {
    GmButton.create();
    DirectorButton.create();
  }
  updateButtons();
  // Each app's own start-up (apps/<id>/client.js), e.g. the Garden's word lists.
  for (const client of Object.values(clients)) await client.ready?.();
  if (game.user === game.users.activeGM) await settleAppsOff(existingWorld);
  if (game.user === game.users.activeGM) await seedDefaultServices();
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
// Each app's own hooks (apps/<id>/client.js): BangMe!'s pay points, Combat Cabb's and the Map's pins,
// Notes and the Calendar, Trauma Team's injuries and ranks...
for (const client of Object.values(clients)) client.install?.({ refreshPhones, store });

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

for (const hook of ["createSetting", "updateSetting"]) {
  Hooks.on(hook, onSettingChanged);
}

installNotifications(refreshPhones);

Hooks.on("userConnected", () => store.onUserConnected());

// The minimised call card follows the call and whether the phone is open.
Hooks.on(`${MODULE_ID}.phoneState`, () => CallWidget.update());
// Chat says when someone takes out or puts away their Agent (Control).
installAgentShown();
// A job popped out on players' screens by the GM.
installJobPopout();

// What players are doing on their Agents, for the GM's Agent Monitor.
installActivity();
installAgentMonitor();
installDirector();
installPhoneStatus();

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

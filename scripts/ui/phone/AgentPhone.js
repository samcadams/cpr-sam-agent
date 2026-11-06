import { ACTIONS, INPUTS, installPages, PHONE_HOOKS } from "./core/pages.js";
import { clickOnEnter, describeControls } from "../a11y.js";
import { APP_IDS, APP_MANIFEST, appDataKey, appPartial } from "../../apps/manifest.js";
import { MODULE_ID, TEMPLATES } from "../../config.js";
import { getPhoneSettings, INTERNAL_THEME, isSilenced, phoneLook, phoneSubject, setPhoneSettings, SKINS } from "../../model/agent.js";
import { agentName, APPS, appsOn, COMMS_APPS } from "../../model/apps.js";
import { appearance } from "../../model/appearance.js";
import { canSendImages, citinetOffline, commsOn, feature, needsCitinet, noSignalSince } from "../../model/features.js";
import { currencyLabel } from "../../model/money.js";
import { store } from "../../store.js";
import { agentTimestamp } from "../../util/agentTime.js";
import { formatDuration } from "../../util/text.js";
import { directorTakesCalls } from "../director/state.js";
import { appBar } from "./pages/home.js";

/** From this width the Messages app shows the conversation list beside the open conversation. */
export const SPLIT_WIDTH = 600;

/** The apps' pages: app id → [the data method, the template's data key] (see pages/ and apps/manifest.js). */
const APP_PAGES = {
  home: ["homeData", "home"],
  ...Object.fromEntries(APP_IDS.map(id => [id, [`${appDataKey(id)}Data`, appDataKey(id)]]))
};

/** The change flags (store._changed) some apps redraw on (apps/manifest.js `refreshOn`). */
const APP_REFRESH = new Set(Object.values(APP_MANIFEST).flatMap(app => app.refreshOn ?? []));

/**
 * Two phones share this class:
 *  - "token": a player's phone, the Agent of their selected token or character
 *  - "console": the GM Phone, every conversation, speaking as any NPC or service
 */
export class AgentPhone extends Application {
  static token = null;
  static console = null;
  /** Jobs popped out of the phone into their own windows, by quest id (see ui/JobPopout.js). */
  static popouts = new Map();

  static get(mode) {
    if (mode === "console") return (this.console ??= new this("console"));
    return (this.token ??= new this("token"));
  }

  static all() {
    return [this.token, this.console, ...AgentPhone.popouts.values()].filter(Boolean);
  }

  /** The phone buttons: put it away, or take it out (onto its lock screen, if it has one). */
  static toggle(mode) {
    const phone = this.get(mode);
    if (phone.rendered) phone.close();
    else {
      phone.locked = true;
      phone.openedFresh = true; // home-screen navigation starts on the home screen
      phone.render(true);
    }
  }

  /** The phone that shows calls and new-message popups for this user. */
  static primary() {
    return this.get(game.user.isGM ? "console" : "token");
  }

  /** Open a phone on a specific conversation (while Communications are on). */
  static openThread(thread, mode = game.user.isGM ? "console" : "token") {
    if (!commsOn()) return;
    const phone = this.get(mode);
    phone.view = phone.viewFor(thread);
    phone.app = "messages";
    phone.locked = false;
    phone.render(true);
  }

  constructor(mode, options = {}) {
    super({ id: mode === "console" ? "ctp-gm-phone" : "ctp-phone", ...options });
    this.mode = mode;
    this.inbox = "all"; // GM: whose phone, "all" or a PC id
    this.persona = null; // GM: who the GM is acting as, null (anyone) or { name, actorId? }
    this.dismissedToken = null; // GM: the selected token whose "act as" prompt was dismissed
    // null = inbox; else { kind: "direct"|"card"|"group"|"group-info"|"service", ..., back? }
    this.view = null;
    this.locked = false; // showing the lock screen (see pages/lock.js)
    this.bloodPreview = null; // GM: a blood splatter style shown on this phone to try it (see pages/blood.js)
    this.callHidden = false;
    this.notesOpen = false;
    this.emojiCatalogOpen = false; // GM: the emoji picker in Control
    this.drafts = {};
    this.locations = {}; // location attached to the next message, per conversation
    this.images = {}; // photo attached to the next message, per conversation
    this.jobs = {}; // GM: job offered with the next message, per conversation (a quest id)
    this.search = "";
    this.contactSearch = "";
    // "home" (the Apps page, where a phone starts) | "contacts" | "messages" | "quests" | "settings" (players)
    // | "control" (GM) | an app (model/apps.js APPS)
    this.app = "home";
    this.questTab = "available";
    this.questId = null;
    this.subjectKey = null;
    this._redraw = foundry.utils.debounce(() => this.rendered && this.render(), 50);
    this._held = false; // a redraw waiting until the user finishes typing or picking
    this._typed = new Set(); // messages already typed out (skins with typeOut)
  }

  /**
   * Something changed (see store._changed): redraw if it shows on this screen, else just update the
   * dock's badges. While the user is typing or has a menu open, the redraw waits until they're done
   * (focus leaves, the menu closes), so nothing they're doing is lost. `urgent` (calls) never waits.
   */
  refresh(change = { all: true }) {
    if (!this.rendered) {
      // Mid-render (e.g. an action redrew right after sending its request, and the host answered
      // before the draw finished): draw again once it's done, or the change is missed.
      if (this._state === Application.RENDER_STATES?.RENDERING) this._redrawAfter = true;
      return;
    }
    if (!change.urgent && !this.affectedBy(change)) return this._patchDock();
    if (!change.urgent && this._busy()) {
      this._held = true;
      return;
    }
    this._redraw();
  }

  /** Does this change touch what's on screen? Only thread, request and job changes can be skipped. */
  affectedBy(change = {}) {
    const ctx = this._ctx;
    if (!ctx || change.all || this.locked || this.shadeOpen) return true;
    if (change.requests) return this.app === "contacts";
    if (change.quests) return this.app === "quests" || !!this.view; // job cards in conversations
    // An app installed or taken away (Ziggurat Pool): the dock and home screen change wherever the phone is.
    if (change.apps && this._installedKey !== this._installedKeyOf(ctx)) return true;
    // The apps' data: their pages, and whatever else an app shows (an armed WatchBox takes over a player's phone).
    // (an open app may say its page doesn't show what changed: an alert arriving while the Map is open)
    if (change.apps) {
      if (this.app in APP_PAGES && !PHONE_HOOKS.keep.some(hook => hook.call(this, change, ctx))) return true;
      return PHONE_HOOKS.affected.some(hook => hook.call(this, change, ctx));
    }
    const flags = Object.keys(change).filter(flag => APP_REFRESH.has(flag));
    if (flags.length) return flags.some(flag => APP_MANIFEST[this.app]?.refreshOn?.includes(flag));
    if (!change.threadId) return true;
    if (this.app !== "messages") return false;
    const id = change.threadId;
    const mine = ctx.perspective === "gm" || !store.threads.has(id) || store.threadsFor(ctx.actorId).some(t => t.id === id);
    if (!mine) return false;
    const v = this.view;
    if (!v || this._wide) return true; // the inbox is on screen
    if (v.kind === "group" || v.kind === "group-info") return v.groupId === id;
    if (v.kind === "service") return store.findServiceThread(v.actorId, v.serviceId)?.id === id || !store.threads.has(id);
    return v.threadId === id || this.resolveDirect()?.id === id || !store.threads.has(id);
  }

  /** Mid-action: typing in a field (other than the message box and search), or a menu is open. */
  _busy() {
    const el = this.element?.[0];
    if (!el) return false;
    if (el.querySelector(".agent-dropdown-menu:not([hidden]), .agent-emoji-picker:not([hidden])")) return true;
    // Text is selected (to copy): a redraw would throw the selection away.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return true;
    // An app mid-something a redraw would lose: a game's run (its canvas), the Map being dragged.
    if (PHONE_HOOKS.busy.some(hook => hook.call(this))) return true;
    const active = document.activeElement;
    if (!active || !el.contains(active)) return false;
    // The message box, searches and one-line boxes that send on Enter ([data-live]) redraw right away
    // (the redraw puts the cursor back, see _render).
    if (active.closest(".agent-compose") || active.type === "search" || active.hasAttribute("data-live")) return false;
    return active.matches("textarea, input[type=text], input:not([type])");
  }

  /** Run a redraw that was held back, once the user is done. */
  _flush() {
    if (!this._held || this._busy()) return;
    this._held = false;
    this._redraw();
  }

  /** Which page is showing, so a redraw of the same page can keep its scroll positions. */
  get _pageKey() {
    const v = this.view;
    return [this.app, this.locked, this.questId, v?.kind, v?.threadId ?? v?.groupId ?? v?.serviceId ?? v?.contact].join("|");
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ctp-phone-app"],
      template: TEMPLATES.phone,
      title: "",
      width: 340,
      height: 580,
      resizable: true,
      minimizable: true,
      dragDrop: [{ dragSelector: null, dropSelector: ".agent-phone" }]
    });
  }

  /** Only the GM drops actors on a phone (see _dropActor). */
  _canDragDrop() {
    return game.user.isGM;
  }

  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (data.type !== "Actor") return;
    this._dropActor(await fromUuid(data.uuid));
  }

  get isGM() {
    return game.user.isGM;
  }

  /** Whether this window shows this user's calls. */
  get handlesCalls() {
    return this.isGM ? this.mode === "console" && !directorTakesCalls() : this.mode === "token";
  }

  /**
   * Whose phone this is and how messages read from it.
   * perspective: "pc" (a player's phone, the PC's side) or "gm" (the GM Phone, every NPC and service)
   */
  context() {
    if (this.mode === "console") {
      const settings = getPhoneSettings(game.user);
      return { perspective: "gm", brand: "GM PHONE", settingsOwner: game.user, settings, look: phoneLook(settings) };
    }
    const subject = phoneSubject();
    if (!subject) return null;
    const settings = getPhoneSettings(subject.actor);
    // The GM can take away players' switch off the forced Internal Agent HUD (Control).
    if (!feature("freeInternal")) settings.freeInternal = false;
    const internal = subject.agent === "internal";
    return {
      subject,
      perspective: "pc",
      actorId: subject.actor.id,
      noSignal: !!noSignalSince(subject.actor.id),
      brand: agentName(subject.actor)?.toUpperCase() ?? (internal ? "INTERNAL AGENT" : "AGENT"),
      settingsOwner: subject.actor,
      settings,
      internal,
      look: phoneLook(settings, internal)
    };
  }

  /** Players can't start a second call; they can only add people to the one they're on. */
  get canStartCall() {
    return this.online && commsOn() && (this.isGM || !store.myCall());
  }

  /** Can this phone reach the network: a GM is online, and (a PC's phone) it has signal. */
  get online() {
    return store.online && !this._ctx?.noSignal;
  }

  getData() {
    const data = this._pageData();
    data.screen = this._screen(data);
    this.shadeData(this._ctx, data); // the notification center (core/shade.js)
    this._skinExtras(data, this._ctx);
    return data;
  }

  /**
   * The app whose page is on screen, for its own backdrop (data-screen, styles/phone/app-pages.css). None
   * for the Apps page, calls, the lock screen and the GM's own pages.
   */
  _screen(data) {
    const p = data.page;
    if (data.appPartial) return data.appPartial.replace(/^agent-app-/, "");
    if (p.contacts) return "contacts";
    if (p.quests || p.quest) return "quests";
    if (p.settings) return "settings";
    if (p.inbox || p.direct || p.group || p.card || p.groupInfo || p.service) return "messages";
    return null;
  }

  _pageData() {
    const ctx = this.context();
    this._ctx = ctx;
    this._noteInstalls(ctx);
    const look = appearance();
    const { time, date } = agentTimestamp();
    const data = {
      isGM: this.isGM,
      splitWidth: SPLIT_WIDTH,
      online: this.online,
      time,
      date,
      brand: ctx?.brand ?? "AGENT",
      silent: !!ctx && isSilenced(ctx.settingsOwner),
      canSilence: !!ctx && ctx.subject?.agent !== "internal",
      emoji: ctx?.perspective === "pc" && ctx.settings.emoji?.length ? ctx.settings.emoji : look.emoji,
      appearance: look,
      currency: currencyLabel(),
      page: {}
    };

    data.blood = this.bloodData(ctx);

    // Calls take over the phone that handles them (none while Communications are off).
    if (this.isGM) {
      if (commsOn() && this.handlesCalls && this.gmCallsPage(data)) return data;
    } else {
      const role = this.handlesCalls && commsOn() ? store.myCall() : null;
      if (!role) this.callHidden = false;
      if (role && (role.kind === "incoming" || !this.callHidden || !ctx)) {
        data.page[role.kind === "incoming" ? "incoming" : "call"] = true;
        data.call = this.callData(role);
        return data;
      }
      if (role) data.callBar = { startedAt: role.call.startedAt, timer: this.callData(role).timer };
    }

    if (!ctx) {
      data.page.none = true;
      return data;
    }

    // A different phone in hand: start from its home screen. (Not on the first draw: a phone opened
    // straight onto a conversation, from a text notification or the API, keeps it.)
    const key = ctx.subject?.key ?? "console";
    if (key !== this.subjectKey) {
      const first = this.subjectKey === null;
      this.subjectKey = key;
      if (!first) this.view = null;
      this.questId = null;
      this.notesOpen = false;
    }

    if (this.locked) {
      if (ctx.settings.lockScreen) {
        data.page.lock = true;
        data.lock = this.lockData(ctx);
        return data;
      }
      this.locked = false;
    }

    // An app that takes over the whole phone, whichever app is open (an armed WatchBox: the Agent is
    // sitting in a room somewhere).
    if (PHONE_HOOKS.takeover.some(hook => hook.call(this, ctx, data))) return data;

    // An app that's switched off, or not for this phone: back to the Apps page.
    const gmOnly = this.app === "control" && ctx.perspective !== "gm";
    const pcOnly = this.app === "settings" && ctx.perspective !== "pc";
    const appOff = this.app in APPS && !appsOn(ctx.internal, this.installedApps(ctx)).some(a => a.id === this.app);
    const commsOff = COMMS_APPS.includes(this.app) && !commsOn();
    if ((this.app === "quests" && !feature("jobs")) || gmOnly || pcOnly || appOff || commsOff) {
      this.app = "home";
      this.view = null;
    }
    if (this.openedFresh && !this.locked) {
      this.openedFresh = false;
      if (this.homeNavigation(ctx) && this.app === "messages" && !this.view) this.app = "home";
    }
    if (this.homeNavigation(ctx)) data.homeButton = this.homeButtonData(ctx);
    else data.dock = this.dockData(ctx);
    // GM, in Messages: a token selected on the canvas offers to switch the phone to it.
    if (ctx.perspective === "gm" && this.app === "messages") data.tokenPrompt = this.tokenPrompt();
    // GM: an app's own settings (the gear in its header).
    data.appSettings = this.appSettingsData(ctx);
    if (data.appSettings) {
      data.page.appSettings = true;
      return data;
    }
    if (this.app === "settings") {
      data.settings = this.settingsData(ctx);
      data.page.settings = true;
      return data;
    }
    if (this.app === "control") {
      data.control = this.controlData(ctx);
      data.page.control = true;
      return data;
    }
    // Another page in the open app's place (a lapsed Ziggurat Pool subscription: locked behind Renew).
    if (PHONE_HOOKS.gate.some(hook => hook.call(this, ctx, data))) return data;
    if (this.app in APP_PAGES) {
      // Black Chrome's "Requires CitiNet Access" without a signal: a "block" app shows "Cannot connect!" instead
      // of its page; the others say so over the page (model/features.js needsCitinet, citinetOffline).
      const offline = ctx.noSignal && needsCitinet(this.app);
      if (offline && citinetOffline(this.app) === "block") {
        data.citinetBlock = { bar: appBar(this.app), name: appearance().names[this.app] ?? this.app };
        return data;
      }
      const [method, key] = APP_PAGES[this.app];
      data[key] = this[method](ctx);
      data.page[this.app] = true;
      if (this.app in APP_MANIFEST) data.appPartial = appPartial(this.app);
      if (offline) data.citinetOff = { name: appearance().names[this.app] ?? this.app };
      return data;
    }
    if (this.app === "contacts") {
      data.contacts = this.contactsData(ctx);
      data.page.contacts = true;
      return data;
    }
    if (this.app === "quests") {
      if (this.questId) data.quest = this.questData(ctx);
      if (data.quest) data.page.quest = true;
      else {
        this.questId = null;
        data.quests = this.questsData(ctx);
        data.page.quests = true;
      }
      this._markQuestsSeen(ctx);
      return data;
    }

    const kind = this.view?.kind;
    if (kind === "direct") data.thread = this.directData(ctx);
    else if (kind === "card") data.card = this.cardData(ctx);
    else if (kind === "group") data.group = this.groupData(ctx);
    else if (kind === "group-info") data.info = this.groupInfoData(ctx);
    else if (kind === "service") data.service = this.serviceData(ctx);

    // A wide window: the conversation list stays on the left (see SPLIT_WIDTH).
    this._wide = (this.position?.width ?? 0) >= SPLIT_WIDTH;
    data.split = this._wide && ctx.settings.split;

    data.pendingLocation = this.locations[this.draftKey] ?? null;
    data.pendingImage = this.images[this.draftKey] ?? null;
    data.canPhoto = canSendImages(game.user);
    const pendingJob = store.quests.get(this.jobs[this.draftKey]);
    data.pendingJob = pendingJob ? { name: pendingJob.name } : null;
    // The GM offers jobs from any conversation it writes in.
    data.canJob = feature("jobs") && this.isGM && !!(data.thread || data.group || data.service?.canReply);
    data.canLocation = feature("locations");
    const canSend = data.thread?.canSend || data.group?.canSend || data.service?.canReply || data.service?.canText;
    data.canMoney = !!(data.thread?.canSend || (data.service?.canMoney && data.service?.canCompose));
    data.quickReplies = canSend ? ctx.settings.quickReplies : [];
    // GM Phone: who the GM is speaking as, shown at the top of the page.
    data.actingAs = data.thread?.actingAs ?? data.card?.actingAs ?? data.group?.actingAs ?? data.service?.actingAs ?? null;

    if (data.thread) data.page.direct = true;
    else if (data.card) data.page.card = true;
    else if (data.group) data.page.group = true;
    else if (data.info) data.page.groupInfo = true;
    else if (data.service) data.page.service = true;
    else {
      this.view = null;
      if (data.split) data.page.splitEmpty = true;
      else data.page.inbox = true;
    }
    if (data.split || data.page.inbox) Object.assign(data, this.inboxData(ctx));
    return data;
  }

  get draftKey() {
    const v = this.view;
    if (v?.kind === "direct") return `${v.actorId}::${v.contact?.toLowerCase()}::${v.threadId ?? (v.hidden ? "h" : "")}`;
    if (v?.kind === "group") return `g::${v.groupId}`;
    if (v?.kind === "service") return `s::${v.actorId}::${v.serviceId}`;
    return null;
  }

  async _render(force, options) {
    const scroll = this.rendered ? this._saveScroll() : null;
    const live = document.activeElement?.matches?.("[data-live]") && this.element?.[0]?.contains(document.activeElement) ? document.activeElement.name : null;
    this._held = false;
    await super._render(force, options);
    this._stateChanged();
    if (this._redrawAfter) {
      this._redrawAfter = false;
      this._redraw();
    }
    clearInterval(this._timer);
    if (!this.rendered) return;
    const html = this.element[0];

    // The skin and colour palette. HUD palettes keep the base Internal Agent colours' styling.
    const look = this.context()?.look ?? phoneLook(getPhoneSettings(null));
    for (const cls of [...html.classList]) if (/^(theme|skin|dock)-/.test(cls)) html.classList.remove(cls);
    html.classList.add(`theme-${look.theme}`, `skin-${look.skin}`, `dock-${look.dockSide ? "side" : "bottom"}`);
    html.classList.toggle("nav-home", this.homeNavigation(this._ctx));
    if (look.theme.startsWith(`${INTERNAL_THEME}-`)) html.classList.add(`theme-${INTERNAL_THEME}`);
    if (SKINS[look.skin]?.base) html.classList.add(`skin-${SKINS[look.skin].base}`);
    html.style.setProperty("--hud-alpha", game.settings.get(MODULE_ID, "hudOpacity"));
    const fontScale = game.settings.get(MODULE_ID, "fontScale");
    html.style.setProperty("--agent-font-scale", fontScale);
    html.classList.toggle("text-large", fontScale >= 1.25); // for skins with no room to grow (Burner's softkeys)

    // Tick call timers (and countdowns: Trauma Team's ETA, WatchBox) once a second without re-rendering.
    const timers = html.querySelectorAll("[data-started-at]");
    const countdowns = html.querySelectorAll("[data-eta]");
    if (timers.length || countdowns.length) {
      this._timer = setInterval(() => {
        for (const el of timers) el.textContent = formatDuration(Date.now() - Number(el.dataset.startedAt));
        for (const el of countdowns) el.textContent = formatDuration(Number(el.dataset.eta) - Date.now());
      }, 1000);
    }

    for (const [name, flag] of [["search", "_searchFocus"], ["contactSearch", "_contactSearchFocus"]]) {
      const search = html.querySelector(`input[name=${name}]`);
      if (search && this[flag]) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
      this[flag] = false;
    }

    const list = html.querySelector(".agent-messages");
    this._restoreScroll(scroll, html);
    const refocus = live ? html.querySelector(`[data-live][name="${live}"]`) : null;
    if (refocus && !refocus.disabled) {
      refocus.focus();
      refocus.setSelectionRange?.(refocus.value.length, refocus.value.length);
    }
    describeControls(html);
    // A page can ask for focus on something once it's drawn (Achieve!'s popup, and its badge after).
    if (this._focusNext) {
      html.querySelector(this._focusNext)?.focus();
      this._focusNext = null;
    }
    // The window's title is left blank so each skin can draw its own header; screen readers still get a name.
    this.element[0]?.querySelector(".window-title")?.setAttribute("aria-label", this.mode === "console" ? "GM phone" : "Agent phone");
    // Each app's own work after a draw: attach a game's canvas or the Map (or stop them once left), reveal
    // Ask Alex's new answers...
    for (const hook of PHONE_HOOKS.render) hook.call(this, html);
    if (SKINS[look.skin]?.typeOut) this._typeOut(list);

    const textarea = html.querySelector(".agent-compose textarea");
    if (textarea && !textarea.disabled) {
      textarea.value = this.drafts[this.draftKey] ?? "";
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    const ctx = this.context();
    if (this._minimized || !list || !ctx || this.locked) return;
    // (draft text is restored above; quick replies and attachments re-render the page)
    const v = this.view;
    if (v?.kind === "direct") store.markRead(this.resolveDirect());
    else if (v?.kind === "group") store.markRead(store.threads.get(v.groupId), ctx.perspective === "pc" ? ctx.actorId : null);
    else if (v?.kind === "service") store.markRead(store.findServiceThread(v.actorId, v.serviceId));
  }

  async close(options) {
    for (const hook of PHONE_HOOKS.close) hook.call(this);
    clearInterval(this._timer);
    clearInterval(this._typing);
    await super.close(options);
    this._stateChanged();
  }

  async minimize() {
    await super.minimize();
    this._stateChanged();
  }

  async maximize() {
    await super.maximize();
    this._stateChanged();
  }

  /** Opened, closed, minimised or restored (e.g. the call widget shows while the phone is away). */
  _stateChanged() {
    Hooks.callAll(`${MODULE_ID}.phoneState`, this);
  }

  /**
   * A wide window shows the conversation list beside the conversation: redraw when that changes. An app can
   * keep the window from shrinking below what it needs (Flappy Chrome's game; Foundry's own minimum is far smaller).
   */
  setPosition(position) {
    const min = PHONE_HOOKS.minSize.map(hook => hook.call(this)).find(Boolean);
    if (min && position) {
      if (position.width) position.width = Math.max(position.width, min.width);
      if (position.height) position.height = Math.max(position.height, min.height);
    }
    const result = super.setPosition(position);
    const wide = (this.position?.width ?? 0) >= SPLIT_WIDTH;
    if (this.rendered && this._wide !== undefined && wide !== this._wide) {
      this._wide = wide;
      this._redraw();
    }
    return result;
  }

  /**
   * Clicks on any [data-action] run that page action (see PAGES); inputs get their handlers per selector.
   * The dock's app switcher belongs to the phone itself.
   */
  activateListeners(html) {
    super.activateListeners(html);
    // A held redraw runs once focus leaves the field the user was typing in.
    html.on("focusout", () => setTimeout(() => this._flush(), 0));
    // ...and one held while text was selected runs when the selection is let go.
    html.on("pointerup", () => setTimeout(() => this._flush(), 0));
    clickOnEnter(html[0]);
    html.on("click", "[data-action]", event => {
      const action = ACTIONS.get(event.currentTarget.dataset.action);
      action?.call(this, event.currentTarget.dataset, event);
    });
    for (const [selector, events] of INPUTS) {
      // `html` is the template's root (.agent-phone), which a selector may target too.
      const targets = html.filter(selector).add(html.find(selector));
      for (const [type, handler] of Object.entries(events)) targets.on(type, event => handler.call(this, event));
    }
  }

  _saveSettings(changes) {
    const ctx = this.context();
    if (ctx) setPhoneSettings(ctx.settingsOwner, changes);
  }

  /** Keep the status bar clock in step with world time without a full re-render. */
  updateClock() {
    if (!this.rendered) return;
    const { time, date } = agentTimestamp();
    this.element.find(".agent-time, .agent-homescreen-time, .agent-lock-time").text(time);
    this.element.find(".agent-date, .agent-lock-date, .agent-homescreen-date").text(date ?? "");
  }
}

// The phone's parts and pages, and each app's page (core/pages.js).
installPages(AgentPhone);
export { ACTIONS };

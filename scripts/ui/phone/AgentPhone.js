import * as inbox from "./pages/inbox.js";
import * as conversation from "./pages/conversation.js";
import * as compose from "./pages/compose.js";
import * as contacts from "./pages/contacts.js";
import * as quests from "./pages/quests.js";
import * as settings from "./pages/settings.js";
import * as call from "./pages/call.js";
import * as control from "./pages/control.js";
import * as card from "./pages/card.js";
import * as dropdown from "./pages/dropdown.js";
import * as lock from "./pages/lock.js";
import * as blood from "./pages/blood.js";
import * as home from "./pages/home.js";
import * as agentApp from "./pages/agentApp.js";
import * as bangme from "./pages/bangme.js";
import * as trauma from "./pages/trauma.js";
import * as alex from "./pages/alex.js";
import * as watchbox from "./pages/watchbox.js";
import * as garden from "./pages/garden.js";
import * as appSettings from "./pages/appSettings.js";
import { DROPDOWNS } from "./pages/dropdown.js";
import { MODULE_ID, TEMPLATES } from "../../config.js";
import { adLines, getPhoneSettings, INTERNAL_THEME, isSilenced, phoneLook, phoneSubject, setPhoneSettings, SKINS, woundState } from "../../model/agent.js";
import { agentName, APPS, appsOn, COMMS_APPS, DEFAULT_DOCK, dockSplit, phoneApps } from "../../model/apps.js";
import { appearance } from "../../model/appearance.js";
import { canSendImages, commsOn, feature, noSignalSince } from "../../model/features.js";
import { currencyLabel } from "../../model/money.js";
import { isGroup, isService, pcKey, threadKey } from "../../model/threads.js";
import { store } from "../../store.js";
import { agentTimestamp } from "../../util/agentTime.js";
import { formatDuration } from "../../util/text.js";

/** From this width the Messages app shows the conversation list beside the open conversation. */
export const SPLIT_WIDTH = 600;

/** Lists whose scroll position survives a redraw (see _render). */
const SCROLLERS = ".agent-inbox, .agent-info, .agent-messages, .agent-gm-calls, .agent-lock-list";

/** How long a BrainGen ad stays up, and one pass of the Double Agent's ticker (styles/skins/double.css). */
const AD_MS = 150_000;
const TICKER_MS = 12_000;

/** The apps' pages: app id → [the data method, the template's data key] (see pages/). */
const APP_PAGES = {
  home: ["homeData", "home"],
  agent: ["agentAppData", "agentApp"],
  bangme: ["bangmeData", "bangme"],
  trauma: ["traumaData", "trauma"],
  alex: ["alexData", "alex"],
  watchbox: ["watchboxData", "watchbox"],
  garden: ["gardenData", "garden"]
};

/**
 * Two phones share this class:
 *  - "token": a player's phone, the Agent of their selected token or character
 *  - "console": the GM Phone, every conversation, speaking as any NPC or service
 */
export class AgentPhone extends Application {
  static token = null;
  static console = null;

  static get(mode) {
    if (mode === "console") return (this.console ??= new this("console"));
    return (this.token ??= new this("token"));
  }

  static all() {
    return [this.token, this.console].filter(Boolean);
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

  constructor(mode) {
    super({ id: mode === "console" ? "ctp-gm-phone" : "ctp-phone" });
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
    if (!ctx || change.all || this.locked) return true;
    if (change.requests) return this.app === "contacts";
    if (change.quests) return this.app === "quests" || !!this.view; // job cards in conversations
    // The apps' data: their pages, and an armed WatchBox (which takes over a player's phone).
    if (change.apps) return this.app in APP_PAGES || this._watching !== !!this.watching(ctx);
    if (change.garden) return this.app === "garden";
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

  /** Update only the dock (its unread badges) without redrawing the page. */
  _patchDock() {
    const root = this.element?.[0];
    if (!root || !this._ctx) return;
    if (this.homeNavigation(this._ctx)) {
      // Home-screen navigation: just the Home button's badge.
      const badge = this.homeButtonData(this._ctx).badge;
      const el = root.querySelector(".agent-home-button .agent-dock-badge");
      if (el) el.textContent = badge;
      else if (badge) return this._redraw();
      if (el && !badge) el.remove();
      return;
    }
    const el = root.querySelector(".agent-dock");
    const partial = globalThis.Handlebars?.partials?.["agent-dock"];
    if (!el || typeof partial !== "function") return;
    el.outerHTML = partial({ dock: this.dockData(this._ctx), appearance: appearance() });
  }

  /** Which page is showing, so a redraw of the same page can keep its scroll positions. */
  get _pageKey() {
    const v = this.view;
    return [this.app, this.locked, this.questId, v?.kind, v?.threadId ?? v?.groupId ?? v?.serviceId ?? v?.contact].join("|");
  }

  /** Scroll positions of the page's lists, and whether each was at the bottom. */
  _saveScroll() {
    const el = this.element?.[0];
    if (!el) return null;
    const lists = [...el.querySelectorAll(SCROLLERS)].map(l => ({ top: l.scrollTop, bottom: l.scrollHeight - l.scrollTop - l.clientHeight < 40 }));
    return { key: this._pageKey, lists };
  }

  /**
   * Put the lists back where they were. Conversations stay pinned to the newest message if they were
   * there (or the page is new), and otherwise stay where the user was reading.
   */
  _restoreScroll(saved, html) {
    const same = saved?.key === this._pageKey;
    html.querySelectorAll(SCROLLERS).forEach((list, i) => {
      const was = same ? saved.lists[i] : null;
      if (list.matches(".agent-messages") && (!was || was.bottom)) list.scrollTop = list.scrollHeight;
      else if (was) list.scrollTop = was.top;
    });
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
    return this.isGM ? this.mode === "console" : this.mode === "token";
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

  viewFor(thread) {
    if (isGroup(thread)) return { kind: "group", groupId: thread.id };
    if (isService(thread)) return { kind: "service", actorId: thread.actorId, serviceId: thread.serviceId };
    return { kind: "direct", threadId: thread.id, actorId: thread.actorId, contact: thread.contact, hidden: !!thread.hideId };
  }

  resolveDirect(view = this.view) {
    if (view.threadId && store.threads.has(view.threadId)) return store.threads.get(view.threadId);
    return store.findThread(view.actorId, view.contact, !!view.hidden);
  }

  mineDirect(ctx, m) {
    return ctx.perspective === "pc" ? m.from === "pc" : m.from === "contact";
  }

  mineGroup(ctx, m) {
    if (ctx.perspective === "pc") return m.from === pcKey(ctx.actorId);
    return m.from.startsWith("n:");
  }

  /**
   * Who this phone speaks as in a group, or null. The GM: the NPC last chosen for this group (saved
   * on the user, so it survives reloads), else the NPC it's acting as, else the group's first NPC.
   */
  groupSpeaker(ctx, group) {
    if (ctx.perspective === "pc") return group.members.some(m => m.key === pcKey(ctx.actorId)) ? pcKey(ctx.actorId) : null;
    const npcs = group.members.filter(m => !m.actorId);
    const chosen = game.user.getFlag(MODULE_ID, "speakAs")?.[group.id];
    const persona = this.persona?.name.toLowerCase();
    return (npcs.find(m => m.key === chosen) ?? npcs.find(m => m.name.toLowerCase() === persona) ?? npcs[0])?.key ?? null;
  }

  /** Players can't start a second call; they can only add people to the one they're on. */
  get canStartCall() {
    return this.online && commsOn() && (this.isGM || !store.myCall());
  }

  /** The thread as this phone sees it: messages from before a "delete" are hidden. */
  cleared(ctx, thread) {
    if (!thread) return thread;
    const since = ctx.settings.cleared?.find(c => c.key === threadKey(thread))?.ts ?? 0;
    if (!since) return thread;
    return {
      ...thread,
      messages: thread.messages.filter(m => m.ts > since),
      lastReaction: thread.lastReaction?.ts > since ? thread.lastReaction : null
    };
  }

  /**
   * The dock: the apps the phone's owner put on it (Settings → Dock), each with its badge, and the
   * Apps button for everything else. Badges: unread messages, contact requests (GM), a dot when jobs
   * changed since you last looked, and what's waiting in each app.
   */
  dockData(ctx) {
    const { dock, home } = this.dockSplit(ctx);
    const item = app => ({ ...app, active: this.app === app.id, ...this.dockBadge(ctx, app.id) });
    return {
      items: dock.map(item),
      home: this.app === "home" || home.some(a => a.id === this.app),
      apps: home.reduce((n, a) => n + (this.dockBadge(ctx, a.id).badge || 0), 0)
    };
  }

  /** This phone's apps, split between its dock and its home screen. */
  dockSplit(ctx) {
    const apps = phoneApps({ gm: ctx.perspective === "gm", internal: ctx.internal });
    // Home-screen navigation: no dock, every app on the home screen.
    if (this.homeNavigation(ctx)) return { dock: [], home: apps };
    return dockSplit(apps, ctx.settings.dockApps ?? DEFAULT_DOCK);
  }

  /** Does this phone get around by its home screen and a Home button, instead of a dock? */
  homeNavigation(ctx) {
    return ctx?.settings.navigation === "home";
  }

  /** The Home button (home-screen navigation): lit on the home screen, with everything waiting in its badge. */
  homeButtonData(ctx) {
    const { home } = this.dockSplit(ctx);
    return { active: this.app === "home", badge: home.reduce((n, a) => n + (this.dockBadge(ctx, a.id).badge || 0), 0) };
  }

  /** { badge } (a count) or { dot } for an app, wherever it shows. */
  dockBadge(ctx, id) {
    const gm = ctx.perspective === "gm";
    switch (id) {
      case "contacts":
        return { badge: gm ? store.visibleRequests().length : 0 };
      case "messages":
        return { badge: gm ? store.totalUnread() : store.totalUnread(store.threadsFor(ctx.actorId), game.user, ctx.actorId) };
      case "quests": {
        const seen = game.settings.get(MODULE_ID, "questsSeen") ?? 0;
        return { dot: this.app !== "quests" && this.questList(ctx).some(q => (q.updated ?? 0) > seen) };
      }
      default:
        return { badge: id in APPS ? this.appBadge(ctx, id) : 0 };
    }
  }

  /** Can this phone reach the network: a GM is online, and (a PC's phone) it has signal. */
  get online() {
    return store.online && !this._ctx?.noSignal;
  }

  getData() {
    const data = this._pageData();
    this._skinExtras(data, this._ctx);
    return data;
  }

  /**
   * What some skins add around the page (see SKINS): the Double Agent's lid screen, the Med Field
   * Agent's vitals, BrainGen's ads.
   */
  _skinExtras(data, ctx) {
    const skin = SKINS[ctx?.look.skin];
    if (!skin) return;
    if (skin.topScreen) data.topScreen = this._topScreen(data, ctx);
    if (skin.vitals) data.vitals = this._vitals(ctx);
    if (skin.ads) data.ad = this._currentAd();
  }

  /**
   * BrainGen's ad: the same line stays up across pages, and a new one slides in every couple of
   * minutes (or when the GM changes the list).
   */
  _currentAd() {
    const lines = adLines();
    const now = Date.now();
    const fresh = !this._ad || now > this._ad.until || !lines.includes(this._ad.text);
    if (fresh) this._ad = { text: lines[Math.floor(Math.random() * lines.length)], until: now + AD_MS };
    return { text: this._ad.text, fresh };
  }

  /** The lid screen: the clock, and the call or the newest message (display only). */
  _topScreen(data, ctx) {
    const top = { time: data.time, date: data.date };
    if (data.call) {
      const incoming = !!data.page.incoming;
      return { ...top, label: incoming ? "INCOMING CALL" : "ON CALL", name: incoming ? data.call.caller.name : data.call.title, text: "" };
    }
    if (!commsOn()) return { ...top, label: "", name: "", text: "" };
    const rows = this.inboxRows(ctx);
    const newest = rows.filter(r => r.ts).sort((a, b) => b.ts - a.ts)[0];
    const unread = rows.reduce((n, r) => n + (Number(r.unread) || 0), 0);
    if (!newest) return { ...top, label: "NO MESSAGES", name: "", text: "" };
    return { ...top, label: unread ? `${unread} NEW` : "LAST MESSAGE", name: newest.name, text: newest.preview };
  }

  /** The Med Field Agent's biomonitor strip: HP from the sheet, and a heart rate to match. */
  _vitals(ctx) {
    const hp = ctx.subject?.actor.system?.derivedStats?.hp;
    if (!hp) return { hp: "--", bpm: "--", state: "ok", label: "NO BIOMONITOR" };
    const state = woundState(ctx.subject.actor) ?? "ok";
    const bpm = { ok: 72, serious: 128, mortal: 41 }[state];
    const label = { ok: "STABLE", serious: "SERIOUSLY WOUNDED", mortal: "MORTALLY WOUNDED" }[state];
    return { hp: `${hp.value}/${hp.max}`, bpm, state, label };
  }

  _pageData() {
    const ctx = this.context();
    this._ctx = ctx;
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
      if (commsOn() && this.gmCallsPage(data)) return data;
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

    // A different phone in hand: start from its home screen.
    const key = ctx.subject?.key ?? "console";
    if (key !== this.subjectKey) {
      this.subjectKey = key;
      this.view = null;
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

    // An armed WatchBox is the whole phone (it's sitting in a room somewhere).
    this._watching = !!this.watching(ctx);
    if (this._watching) {
      data.watchbox = this.watchboxData(ctx);
      data.page.watchbox = true;
      return data;
    }

    // An app that's switched off, or not for this phone: back to the Apps page.
    const gmOnly = this.app === "control" && ctx.perspective !== "gm";
    const pcOnly = this.app === "settings" && ctx.perspective !== "pc";
    const appOff = this.app in APPS && !appsOn(ctx.internal).some(a => a.id === this.app);
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
    if (this.app in APP_PAGES) {
      const [method, key] = APP_PAGES[this.app];
      data[key] = this[method](ctx);
      data.page[this.app] = true;
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
    html.style.setProperty("--agent-font-scale", game.settings.get(MODULE_ID, "fontScale"));

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
    this._revealAnswers(html);
    if (SKINS[look.skin]?.typeOut) this._typeOut(list);
    // The Double Agent's ticker runs on one clock, so a redraw doesn't restart it.
    for (const el of html.querySelectorAll(".agent-topscreen-ticker span")) el.style.animationDelay = `-${(Date.now() % TICKER_MS) / 1000}s`;

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

  /**
   * Skins with typeOut: the newest message from the other side types out letter by letter, the first
   * time it's on screen.
   */
  _typeOut(list) {
    clearInterval(this._typing);
    const msg = [...(list?.querySelectorAll(".agent-msg") ?? [])].at(-1);
    const id = msg?.classList.contains("theirs") ? msg.dataset.messageId : null;
    const el = msg?.querySelector(".agent-bubble-text");
    if (!id || !el || this._typed.has(id)) return;
    this._typed.add(id);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const full = el.textContent;
    let shown = 0;
    msg.classList.add("typing");
    el.textContent = "";
    this._typing = setInterval(() => {
      shown = Math.min(full.length, shown + 2);
      el.textContent = full.slice(0, shown);
      if (shown >= full.length) {
        clearInterval(this._typing);
        msg.classList.remove("typing");
      }
    }, 25);
  }

  /**
   * Ask Alex Anything's new answers appear word by word, like an AI writing them, the first time
   * this phone shows them.
   */
  _revealAnswers(html) {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this._revealed ??= new Set();
    for (const el of html.querySelectorAll("[data-reveal]")) {
      const id = el.dataset.reveal;
      if (this._revealed.has(id)) continue;
      this._revealed.add(id);
      if (reduce) continue;
      const words = el.textContent.split(/(\s+)/);
      let shown = 0;
      el.textContent = "";
      el.classList.add("revealing");
      const timer = setInterval(() => {
        shown = Math.min(words.length, shown + 2);
        el.textContent = words.slice(0, shown).join("");
        if (shown >= words.length || !el.isConnected) {
          clearInterval(timer);
          el.textContent = words.join("");
          el.classList.remove("revealing");
        }
      }, 70);
    }
  }

  async close(options) {
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

  /** A wide window shows the conversation list beside the conversation: redraw when that changes. */
  setPosition(position) {
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

/** The phone's own actions: switching apps from the dock. */
const dock = {
  actions: {
    app({ app }) {
      // The Apps button again: back to the app you came from (with a dock; the Home button stays home).
      if (app === "home" && this.app === "home" && !this.homeNavigation(this._ctx)) app = this.lastApp ?? "home";
      else if (app === "home") this.lastApp = this.app;
      this.appSettings = null;
      if (this.app === app) {
        // Tapping the current app goes back to its home screen.
        if (app === "quests") this.questId = null;
        else if (app === "messages") this.view = null;
        else if (app === "garden") this.gardenPost = this.gardenAccount = null;
      }
      this.app = app;
      this.render();
    }
  }
};

/*
 * The phone's pages. Each exports `methods` (installed onto AgentPhone), `actions` (data-action name →
 * handler(dataset, event)), `inputs` (selector → { event: handler(event) }) and `dropdowns` (name →
 * handler(value), see pages/dropdown.js), all run with `this` = the phone.
 */
const PAGES = {
  dock, dropdown, lock, blood, inbox, conversation, card, compose, contacts, quests, settings, call, control,
  home, agentApp, bangme, trauma, alex, watchbox, garden, appSettings
};
export const ACTIONS = new Map();
const INPUTS = [];

for (const [page, { methods = {}, actions = {}, inputs = {}, dropdowns = {} }] of Object.entries(PAGES)) {
  for (const name of Object.keys(methods)) {
    if (name in AgentPhone.prototype) throw new Error(`ui/phone/pages/${page}.js: "${name}" is already defined`);
  }
  Object.assign(AgentPhone.prototype, methods);
  for (const [name, handler] of Object.entries(actions)) {
    if (ACTIONS.has(name)) throw new Error(`ui/phone/pages/${page}.js: action "${name}" is already defined`);
    ACTIONS.set(name, handler);
  }
  INPUTS.push(...Object.entries(inputs));
  for (const [name, handler] of Object.entries(dropdowns)) {
    if (DROPDOWNS.has(name)) throw new Error(`ui/phone/pages/${page}.js: dropdown "${name}" is already defined`);
    DROPDOWNS.set(name, handler);
  }
}

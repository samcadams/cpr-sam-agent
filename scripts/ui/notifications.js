import { MODULE_ID } from "../config.js";
import { isSilenced, notifyStyle, phoneSubject } from "../model/agent.js";
import { agentLabel, ALERT_KINDS } from "../model/apps.js";
import { findContact, getContacts, shownName } from "../model/contacts.js";
import { commsOn, noSignalSince } from "../model/features.js";
import { formatMoney } from "../model/money.js";
import { memberActorId } from "../model/permissions.js";
import { actorAvatar, displayName, isGroup, isService, pictureOf, previewText } from "../model/threads.js";
import { store } from "../store.js";
import { CallAudio } from "./CallAudio.js";
import { CallWidget } from "./CallWidget.js";
import { Toasts } from "./Toasts.js";
import { GmButton, TokenButton, updateButtons } from "./buttons.js";
import { panToToken } from "./location.js";
import { AgentPhone } from "./phone/AgentPhone.js";
import { playPhoneSound } from "../util/audio.js";

/*
 * Pop-up notifications (ui/Toasts.js) for everything that happens while the phone is away: texts,
 * reactions, calls, job and contact-request notices, Agent alerts and the GM's cards from the apps.
 */

const playTextSound = () => playPhoneSound("sound");

/** Is the phone receiving this thread on silent? PCs' phones keep their own setting; the GM's is on the user. */
function isSilent(thread) {
  if (game.user.isGM) return isSilenced(game.user);
  const actor = game.actors.get(memberActorId(game.user, thread));
  return actor ? isSilenced(actor) || !!noSignalSince(actor.id) : false;
}

/** The notification style of the phone a thread's message arrives on: the GM Phone, or the character's. */
function styleFor(thread) {
  if (game.user.isGM) return notifyStyle(game.user);
  const actor = game.actors.get(memberActorId(game.user, thread));
  return actor ? notifyStyle(actor) : "toast";
}

/** Title, picture and preview for a notification about a new message. */
function describe(thread, message) {
  const base = describeSender(thread, message);
  if (message.money) {
    const amount = formatMoney(message.money.amount);
    const line = message.money.kind === "send" ? `💸 Sent you ${amount}` : `💸 Requests ${amount}`;
    return { ...base, body: message.text ? `${line} — "${message.text}"` : line, cls: "ctp-toast-money" };
  }
  if (message.moneyNotice) return { ...base, body: `💸 ${message.text}`, cls: "ctp-toast-money" };
  return base;
}

function describeSender(thread, message) {
  const body = message.call ? `📞 ${message.text}` : previewText(message);
  if (isGroup(thread)) return { title: `${message.name ?? "Group"} · ${thread.name}`, icon: "fa-users", body };
  const actor = game.actors.get(thread.actorId);
  if (isService(thread)) {
    return { title: game.user.isGM && actor ? `${thread.name} · ${displayName(actor)}` : thread.name, img: thread.img, body };
  }
  if (game.user.isGM) {
    return { title: actor ? `${displayName(actor)} → ${thread.contact}` : thread.contact, img: actor ? actorAvatar(actor) : null, body };
  }
  const entry = !thread.hideId && actor ? findContact(getContacts(actor), thread.contact) : null;
  const img = thread.hideId ? thread.contactImg : pictureOf(entry?.img || thread.contactImg, entry?.actorId ?? thread.contactActorId);
  return { title: actor ? shownName(actor, thread.contact, thread.hideId ? thread.id : null) : thread.contact, img, body };
}

const toastAnchor = () => (game.user.isGM ? GmButton.el : TokenButton.el);

/** Listen for everything that pops up. `refreshPhones` (main.js) redraws phones and badges. */
export function installNotifications(refreshPhones) {
  // Texts, reactions and contact requests stay quiet while Communications are off (BangMe!'s
  // Transfer can still add a line to a conversation).
  Hooks.on(`${MODULE_ID}.received`, (thread, message) => {
    if (!commsOn()) return;
    if (!isSilent(thread) && !message.quiet) playTextSound();

    const mode = game.user.isGM ? "console" : "token";
    const phone = AgentPhone.get(mode);
    // Only the phone in hand, and only for texts to that character.
    if (!game.user.isGM && phoneSubject()?.actor.id !== memberActorId(game.user, thread)) return;
    if (phone.rendered && !phone._minimized) return; // the phone is up: its own badges and lists show it

    const style = styleFor(thread);
    if (style === "open") AgentPhone.openThread(thread, mode);
    else if (style === "toast") {
      Toasts.show({ ...describe(thread, message), anchor: toastAnchor(), onClick: () => AgentPhone.openThread(thread, mode) });
    }
  });

  // Someone reacted to one of my messages.
  Hooks.on(`${MODULE_ID}.reacted`, (thread, message, reaction) => {
    if (!commsOn()) return;
    const mode = game.user.isGM ? "console" : "token";
    const phone = AgentPhone.get(mode);
    if (!game.user.isGM && phoneSubject()?.actor.id !== memberActorId(game.user, thread)) return;
    if (phone.rendered && !phone._minimized) return;
    if (!isSilent(thread)) playTextSound();
    if (styleFor(thread) === "none") return;
    Toasts.show({
      title: `${reaction.by} reacted with ${reaction.emoji}`,
      body: previewText(message),
      img: describe(thread, message).img,
      icon: "fa-face-smile",
      anchor: toastAnchor(),
      onClick: () => AgentPhone.openThread(thread, mode)
    });
  });

  /**
   * A notification from a character's Agent (host/agent.js): signed with the Agent's name, with the
   * alert's answers as buttons. Only for the player holding that character's phone.
   */
  Hooks.on(`${MODULE_ID}.agentAlert`, alert => {
    if (game.user.isGM) return;
    const actor = game.actors.get(alert.actorId);
    if (!actor?.isOwner) return;
    const subject = phoneSubject();
    if (subject && subject.actor.id !== actor.id) return;
    // The Agent itself speaks: its notifications sound even with no signal (only silent mode stops them).
    const quiet = isSilenced(actor);
    if (!quiet) playTextSound();
    const open = () => {
      const phone = AgentPhone.get("token");
      // Notifications from an app open that app.
      phone.app = { alex: "alex", garden: "garden", trauma: "trauma", money: "bangme" }[alert.kind] ?? "agent";
      phone.locked = false;
      phone.render(true);
    };
    const title = alert.from ?? agentLabel(actor);
    const bang = alert.ref?.type === "bang-in";
    if (bang && !quiet) playPhoneSound("moneySound");
    Toasts.show({
      id: `alert:${alert.id}`,
      title,
      body: alert.text,
      icon: `fa-solid ${ALERT_KINDS[alert.kind]?.icon ?? "fa-robot"}`,
      cls: `ctp-toast-agent kind-${alert.kind}${bang ? " ctp-toast-bang" : ""}`,
      anchor: toastAnchor(),
      duration: alert.choices.length ? 0 : 8000,
      onClick: open,
      actions: alert.choices.map((choice, i) => ({
        label: choice, text: true, cls: i === 0 ? "accept" : "decline",
        onClick: () => store.request("alert-answer", { alertId: alert.id, choice })
      }))
    });
  });

  /** Cards for the GM from the apps (host/core.js _gmCard): buttons send requests to the host. */
  Hooks.on(`${MODULE_ID}.gmCard`, card => {
    if (!game.user.isGM) return;
    if (card.urgent) playTextSound();
    const open = () => {
      const phone = AgentPhone.get("console");
      if (card.open?.app) phone.app = card.open.app;
      if (card.open?.tab) Object.assign(phone, { gardenTab: card.open.tab, gardenPost: null, gardenAccount: null });
      phone.render(true);
    };
    Toasts.show({
      id: card.id,
      title: card.title,
      body: card.body,
      img: card.img,
      icon: `fa-solid ${card.icon ?? "fa-bell"}`,
      cls: `ctp-toast-gm${card.urgent ? " urgent" : ""}`,
      anchor: toastAnchor(),
      duration: card.actions?.length || card.urgent ? 0 : 8000,
      onClick: open,
      actions: (card.actions ?? []).map(a => ({
        label: a.label, icon: a.icon, text: true,
        onClick: () => (a.pan ? panToToken(a.pan) : store.request(a.request, a.data))
      }))
    });
  });


  // Quest log updates (players only; the host decides what's worth a notice).
  // Notices from the host, e.g. signal restored.
  Hooks.on(`${MODULE_ID}.notice`, notice => {
    Toasts.show({ ...notice, anchor: toastAnchor() });
  });

  Hooks.on(`${MODULE_ID}.questNotice`, notice => {
    const phone = AgentPhone.get("token");
    if (phone.rendered && !phone._minimized) return;
    const actor = phoneSubject()?.actor;
    if (actor && notifyStyle(actor) === "none") return;
    const icon = { completed: "fa-trophy", failed: "fa-skull" }[notice.status] ?? "fa-list-check";
    Toasts.show({
      title: notice.title,
      body: notice.body,
      icon,
      cls: "ctp-toast-quest",
      anchor: toastAnchor(),
      onClick: () => {
        phone.app = "quests";
        phone.questId = notice.questId;
        phone.render(true);
      }
    });
  });

  // Contact requests: the GM hears about new ones, players about the answer.
  Hooks.on(`${MODULE_ID}.requestNotice`, ({ kind, request }) => {
    if (!commsOn()) return;
    const actor = game.actors.get(request.actorId);
    const who = actor ? displayName(actor) : "Someone";
    const open = () => {
      const phone = AgentPhone.get(game.user.isGM ? "console" : "token");
      phone.app = "contacts";
      phone.render(true);
    };
    if (kind === "new") {
      Toasts.show({ title: "Contact request", body: `${who} wants ${request.name}'s number`, icon: "fa-user-plus", anchor: toastAnchor(), onClick: open });
    } else if (kind === "approved") {
      Toasts.show({ title: "Contact added", body: `${request.name} is now in ${who}'s contacts`, icon: "fa-user-check", anchor: toastAnchor(), onClick: open });
    } else {
      Toasts.show({ title: "Request denied", body: `Couldn't get ${request.name}'s number`, icon: "fa-user-xmark", anchor: toastAnchor() });
    }
  });

  /**
   * Calls: ring locally; an incoming call shows as a notification with Answer/Decline (or on the phone
   * itself if it's already up). Calls you start or answer bring the phone up for the call screen.
   */
  let lastActiveCall = null;

  Hooks.on(`${MODULE_ID}.calls`, () => {
    CallAudio.update();
    updateButtons();
    CallWidget.update();
    const calls = commsOn() ? store.myCalls() : []; // Communications off: no calls
    const phone = AgentPhone.primary();
    const phoneUp = phone.rendered && !phone._minimized;
    const openPhone = () => {
      phone.callHidden = false;
      phone.render(true);
    };

    // One notification per ringing call. The GM may be rung as several NPCs in one call: Decline
    // declines them all, and Answer opens the phone to choose (unless there's only one).
    const ringing = calls.filter(r => r.ringing.length);
    const ids = new Set(ringing.map(r => `call:${r.call.id}`));
    for (const id of [...Toasts.byId.keys()]) if (id.startsWith("call:") && !ids.has(id)) Toasts.dismiss(id);
    for (const { call, ringing: mine } of ringing) {
      const id = `call:${call.id}`;
      if (phoneUp || Toasts.has(id)) continue;
      const caller = call.participants.find(p => p.key === call.callerKey);
      const detail = call.groupName ? `Group call · ${call.groupName}` : call.line ?? "Incoming call";
      const answerAs = game.user.isGM ? ` (for ${mine.map(p => p.name).join(", ")})` : "";
      // A player already on a call: answering hangs that one up (the host does it).
      const busy = !game.user.isGM && calls.some(r => r.call.id !== call.id && r.joined.length);
      const answer = mine.length === 1
        ? () => store.request("call-answer", { callId: call.id, key: mine[0].key })
        : openPhone;
      Toasts.show({
        id,
        cls: "ctp-toast-call",
        title: caller?.name ?? "Unknown",
        body: `${detail}${answerAs}`,
        img: caller?.img,
        icon: "fa-phone",
        anchor: toastAnchor(),
        duration: 0,
        onClick: openPhone,
        actions: [
          { label: "Decline", icon: "fa-phone-slash", cls: "decline", onClick: () => mine.forEach(p => store.request("call-decline", { callId: call.id, key: p.key })) },
          { label: mine.length > 1 ? "Choose…" : busy ? "Hang up & Answer" : "Answer", icon: "fa-phone", cls: "accept", onClick: answer }
        ]
      });
    }

    // A call you've just joined brings the phone up.
    const active = calls.find(r => r.joined.length)?.call.id ?? null;
    if (active && active !== lastActiveCall) {
      phone.callHidden = false;
      if (!phone.rendered) phone.render(true);
      else if (phone._minimized) phone.maximize();
    }
    lastActiveCall = active;
    refreshPhones({ all: true, urgent: true });
  });
}

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
import { broadcastWaits, playRaidAlarm, showBroadcast } from "../../apps/cbk/broadcasts.js";
import { directorTakesCalls } from "./director/state.js";

/*
 * Pop-up notifications (ui/Toasts.js): texts, reactions, calls, Agent alerts (jobs and contact requests
 * among them) and the GM's cards from the apps. Beside the phone button while the phone is away; as a
 * banner on its screen while it's up. Alerts and GM cards are kept for the phone's notification center
 * (ui/phone/core/shade.js).
 */

/** The text tone of the phone a thread came to: the GM Phone for a GM, else that character's phone. */
const playTextSound = thread => playPhoneSound("text", game.user.isGM ? game.user : game.actors.get(memberActorId(game.user, thread)));

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

/** The phone (token or console) if it's up, not minimised: notifications for it show as banners there. */
function upPhone(mode) {
  const phone = AgentPhone.get(mode);
  return phone.rendered && !phone._minimized ? phone : null;
}

/** Pop up a notification for that phone: a banner on it while it's up, else beside the phone button. */
const pop = (mode, options) => Toasts.show({ ...options, anchor: toastAnchor(), phone: upPhone(mode) });

/** Is the up phone already showing this conversation (or the list it's in)? Then it needs no banner. */
const showing = (phone, thread) => !!phone && phone.app === "messages" && !phone.locked && !!phone._ctx && phone.affectedBy({ threadId: thread.id });

/** Listen for everything that pops up. `refreshPhones` (main.js) redraws phones and badges. */
export function installNotifications(refreshPhones) {
  // Texts, reactions and contact requests stay quiet while Communications are off (BangMe!'s
  // Transfer can still add a line to a conversation).
  Hooks.on(`${MODULE_ID}.received`, (thread, message) => {
    if (!commsOn()) return;
    if (!isSilent(thread) && !message.quiet) playTextSound(thread);

    const mode = game.user.isGM ? "console" : "token";
    // Only the phone in hand, and only for texts to that character.
    if (!game.user.isGM && phoneSubject()?.actor.id !== memberActorId(game.user, thread)) return;
    const phone = upPhone(mode);
    if (showing(phone, thread)) return;

    const style = styleFor(thread);
    if (style === "none") return;
    // "Open the conversation" only takes the phone out of the pocket; one in use gets a banner.
    if (style === "open" && !phone) AgentPhone.openThread(thread, mode);
    else pop(mode, { ...describe(thread, message), onClick: () => AgentPhone.openThread(thread, mode) });
  });

  // Someone reacted to one of my messages.
  Hooks.on(`${MODULE_ID}.reacted`, (thread, message, reaction) => {
    if (!commsOn()) return;
    const mode = game.user.isGM ? "console" : "token";
    if (!game.user.isGM && phoneSubject()?.actor.id !== memberActorId(game.user, thread)) return;
    if (showing(upPhone(mode), thread)) return;
    if (!isSilent(thread)) playTextSound(thread);
    if (styleFor(thread) === "none") return;
    pop(mode, {
      title: `${reaction.by} reacted with ${reaction.emoji}`,
      body: previewText(message),
      img: describe(thread, message).img,
      icon: "fa-face-smile",
      onClick: () => AgentPhone.openThread(thread, mode)
    });
  });

  /**
   * A notification from a character's Agent (apps/agent/host.js): signed with the Agent's name, with the
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
    // A Night Market's raid warning has its own alarm; a broadcast the phone shows needs no banner (apps/cbk/broadcasts.js).
    if (!quiet) {
      if (alert.kind === "raid") playRaidAlarm();
      else playPhoneSound("text", actor);
    }
    if (showBroadcast(AgentPhone.get("token"))?.id === alert.id) return;
    // Tapping it opens what it's about (and clears it from the center, unless it still asks something).
    const open = () => {
      if (!alert.choices.length && !broadcastWaits(alert)) store.request("alert-clear", { alertIds: [alert.id] });
      AgentPhone.get("token").openAlert(alert);
    };
    const title = alert.from ?? agentLabel(actor);
    const bang = alert.ref?.type === "bang-in";
    if (bang && !quiet) playPhoneSound("money", actor);
    pop("token", {
      id: `alert:${alert.id}`,
      title,
      body: alert.text,
      icon: `fa-solid ${ALERT_KINDS[alert.kind]?.icon ?? "fa-robot"}`,
      cls: `ctp-toast-agent kind-${alert.kind}${bang ? " ctp-toast-bang" : ""}`,
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
    if (card.urgent) playPhoneSound("text", game.user);
    // Opening it or using a button deals with it: it leaves the notification center.
    const done = () => store.request("gm-card-clear", { cardIds: [card.id] });
    const open = () => {
      done();
      AgentPhone.get("console").openCard(card);
    };
    pop("console", {
      id: card.id,
      title: card.title,
      body: card.body,
      img: card.img,
      icon: `fa-solid ${card.icon ?? "fa-bell"}`,
      cls: `ctp-toast-gm${card.urgent ? " urgent" : ""}`,
      duration: card.actions?.length || card.urgent ? 0 : 8000,
      onClick: open,
      actions: (card.actions ?? []).map(a => ({
        label: a.label, icon: a.icon, text: true,
        onClick: () => {
          if (a.pan) panToToken(a.pan);
          else store.request(a.request, a.data);
          done();
        }
      }))
    });
  });

  // A card dealt with somewhere else (the app's GM page, the center, another GM) takes its pop-up with it.
  Hooks.on(`${MODULE_ID}.gmCardGone`, cardIds => {
    for (const id of cardIds) Toasts.dismiss(id);
  });


  // Notices from the host, e.g. signal restored. (Job and contact-request news come as Agent alerts and
  // GM cards: host/quests.js, host/contactRequests.js.)
  Hooks.on(`${MODULE_ID}.notice`, notice => {
    pop(game.user.isGM ? "console" : "token", notice);
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
    // The Director is open and takes calls (its call strip): no call toasts, and the GM Phone stays put.
    const director = directorTakesCalls();
    const openPhone = () => {
      phone.callHidden = false;
      phone.render(true);
    };

    // One notification per ringing call. The GM may be rung as several NPCs in one call: Decline
    // declines them all, and Answer opens the phone to choose (unless there's only one).
    const ringing = calls.filter(r => r.ringing.length);
    const ids = new Set(director ? [] : ringing.map(r => `call:${r.call.id}`));
    for (const id of [...Toasts.byId.keys()]) if (id.startsWith("call:") && !ids.has(id)) Toasts.dismiss(id);
    for (const { call, ringing: mine } of ringing) {
      const id = `call:${call.id}`;
      if (director || phoneUp || Toasts.has(id)) continue;
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
    if (active && active !== lastActiveCall && !director) {
      phone.callHidden = false;
      if (!phone.rendered) phone.render(true);
      else if (phone._minimized) phone.maximize();
    }
    lastActiveCall = active;
    refreshPhones({ all: true, urgent: true });
  });
}

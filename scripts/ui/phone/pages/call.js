import { pickMembers } from "../../dialogs/pickMembers.js";
import { callLines, getService } from "../../../model/services.js";
import { shownName } from "../../../model/contacts.js";
import { personaColor, pictureOf } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { formatDuration, initials } from "../../../util/text.js";

/*
 * Phone page: calls (incoming, in progress, the "on a call" bar) and starting them.
 * A player holds one call as their PC. The GM can hold several NPCs across several calls, so the GM
 * Phone lists every call as a card, with Answer / Decline / Leave per NPC.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

export const actions = {
  call({ line }) {
    this._startCall(line);
  },
  /** A service's call button: rings its only line, or opens the list of lines. */
  "service-call"() {
    const picker = this.element.find(".agent-line-picker")[0];
    if (picker) picker.hidden = !picker.hidden;
    else this._startCall(callLines(getService(this.view?.serviceId))[0]);
  },
  "call-answer"({ callId, key }) {
    this._callAction("call-answer", callId, key);
  },
  "call-decline"({ callId, key }) {
    this._callAction("call-decline", callId, key);
  },
  "call-hangup"({ callId, key }) {
    this._callAction("call-hangup", callId, key);
  },
  "call-add"({ callId, key }) {
    this._callAdd(callId, key);
  },
  /** GM: answer as every NPC ringing in this call. */
  "call-answer-all"({ callId }) {
    const role = store.myCalls().find(r => r.call.id === callId);
    for (const p of role?.ringing ?? []) store.request("call-answer", { callId, key: p.key });
  },
  /** GM: end the call for everyone on it. */
  "call-close"({ callId }) {
    store.request("call-close", { callId });
  },
  /** Close the phone down to the call widget (ui/CallWidget.js). */
  "call-minimize"() {
    this.close();
  },
  "call-hide"() {
    this.callHidden = true;
    this.render();
  },
  "call-show"() {
    this.callHidden = false;
    this.render();
  }
};

const CALL_STATES = {
  joined: "Connected",
  ringing: "Ringing…",
  left: "Left",
  declined: "Declined",
  missed: "No answer"
};

export const methods = {
  /** A player's call screen. Contacts show under the player's own name for them. */
  callData(role) {
    const { call, me } = role;
    const others = call.participants.filter(p => p.key !== me.key);
    const caller = call.participants.find(p => p.key === call.callerKey) ?? others[0];
    const live = others.filter(p => ["joined", "ringing"].includes(p.state));
    const hiddenTag = p => (p.hidden && this.isGM ? " (ID hidden)" : "");
    const pc = me.actorId ? game.actors.get(me.actorId) : null;
    const nameOf = p => (pc && p && !p.actorId && !p.hidden ? shownName(pc, p.name) : p?.name);
    return {
      id: call.id,
      title: call.groupName ?? (live.length ? live : others).map(nameOf).join(", ") + (call.line ? ` · ${call.line}` : ""),
      groupName: call.groupName,
      line: call.line,
      // Ringing while already on another call: answering hangs that one up.
      busy: role.kind === "incoming" && store.myCalls().some(r => r.call.id !== call.id && r.joined.length),
      caller: { name: nameOf(caller), img: caller?.hidden ? caller.img : pictureOf(caller?.img, caller?.actorId), initials: initials(nameOf(caller)) },
      startedAt: call.startedAt,
      timer: call.startedAt ? formatDuration(Date.now() - call.startedAt) : "Calling…",
      participants: call.participants.map(p => ({
        name: `${nameOf(p)}${p.key === me.key ? " (you)" : hiddenTag(p)}`,
        img: p.hidden ? p.img : pictureOf(p.img, p.actorId),
        initials: initials(p.name),
        state: p.state,
        label: CALL_STATES[p.state] ?? p.state
      }))
    };
  },

  /**
   * GM Phone: show every call the GM holds someone in, while one rings or unless the GM went back to
   * its messages (then an "on a call" bar). Fills `data`; true when the calls take the whole page.
   */
  gmCallsPage(data) {
    const calls = store.myCalls();
    if (!calls.length) {
      this.callHidden = false;
      return false;
    }
    const names = list => [...new Set(list.map(p => p.name))];
    const ringingAs = names(calls.flatMap(r => r.ringing));
    if (ringingAs.length || !this.callHidden) {
      const as = ringingAs.length ? ringingAs : names(calls.flatMap(r => r.joined));
      data.page.gmCalls = true;
      data.calls = calls.map(r => this.gmCallData(r));
      data.actingAs = {
        verb: ringingAs.length ? "Receiving call as" : "On call as",
        name: as.join(", "),
        color: as.length === 1 ? personaColor(as[0]) : null
      };
      return true;
    }
    const first = calls.find(r => r.joined.length) ?? calls[0];
    data.callBar = {
      startedAt: first.call.startedAt,
      timer: first.call.startedAt ? formatDuration(Date.now() - first.call.startedAt) : "Calling…",
      as: names(first.joined).join(", ")
    };
    return false;
  },

  /** One call on the GM Phone: everyone on it, and what the GM can do for each NPC it holds. */
  gmCallData({ call, ringing, joined }) {
    const held = new Set([...ringing, ...joined].map(p => p.key));
    const others = call.participants.filter(p => !held.has(p.key));
    const live = others.filter(p => ["joined", "ringing"].includes(p.state));
    return {
      id: call.id,
      title: call.groupName ?? (live.length ? live : others).map(p => p.name).join(", "),
      line: call.line,
      startedAt: call.startedAt,
      timer: call.startedAt ? formatDuration(Date.now() - call.startedAt) : ringing.length ? "Incoming call…" : "Calling…",
      ringing: ringing.length > 0,
      canAnswerAll: ringing.length > 1,
      addKey: joined[0]?.key ?? null,
      participants: call.participants.map(p => ({
        key: p.key,
        name: `${p.name}${p.hidden ? " (ID hidden)" : ""}`,
        img: p.hidden ? p.img : pictureOf(p.img, p.actorId),
        initials: initials(p.name),
        state: p.state,
        label: CALL_STATES[p.state] ?? p.state,
        color: p.actorId ? null : personaColor(p.name),
        held: held.has(p.key),
        canAnswer: held.has(p.key) && p.state === "ringing",
        canLeave: held.has(p.key) && p.state === "joined"
      }))
    };
  },

  _startCall(line) {
    const ctx = this.context();
    if (!ctx || !this.canStartCall) return;
    const v = this.view;
    if (v?.kind === "direct" || v?.kind === "card") {
      const thread = this.resolveDirect();
      store.request("call-start", { threadId: thread?.id, actorId: v.actorId, contact: v.contact, hidden: v.hidden });
    } else if (v?.kind === "group") {
      const as = this.groupSpeaker(ctx, store.threads.get(v.groupId));
      if (as) store.request("call-start", { groupId: v.groupId, as });
    } else if (v?.kind === "service") {
      store.request("call-start", { actorId: v.actorId, serviceId: v.serviceId, line });
    }
    this.callHidden = false;
  },

  /** Answer, decline or hang up: as `key` (GM, one of its NPCs in the call), else as this player. */
  _callAction(type, callId, key) {
    if (key) {
      const role = store.myCalls().find(r => r.call.id === callId);
      if ([...(role?.ringing ?? []), ...(role?.joined ?? [])].some(p => p.key === key)) store.request(type, { callId, key });
      return;
    }
    const role = store.myCall();
    if (!role || role.call.id !== callId) return;
    store.request(type, { callId, key: role.me.key });
  },

  /** Ring more people into a call, as `key` (GM) or as this player. */
  async _callAdd(callId, key) {
    let call, me;
    if (key) {
      const role = store.myCalls().find(r => r.call.id === callId);
      call = role?.call;
      me = role?.joined.find(p => p.key === key);
    } else ({ call, me } = store.myCall() ?? {});
    if (!call || !me) return;
    const picked = await pickMembers({
      title: "Add to call",
      actor: me.actorId ? game.actors.get(me.actorId) : null,
      excludeKeys: call.participants.filter(p => ["joined", "ringing"].includes(p.state)).map(p => p.key),
      label: "Call"
    });
    if (picked) store.request("call-add", { callId: call.id, key: me.key, ...picked });
  }
};

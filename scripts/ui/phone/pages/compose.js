import { attachPhotoDialog, moneyDialog, pickJobDialog } from "../../dialogs/forms.js";
import { openLocation, pickLocation } from "../../location.js";
import { findContact, getContacts } from "../../../model/contacts.js";
import { getService } from "../../../model/services.js";
import { canSendImages, feature } from "../../../model/features.js";
import { formatMoney, hasWallet } from "../../../model/money.js";
import { QUEST_LABELS } from "../../../model/quests.js";
import { store } from "../../../store.js";
import { playPhoneSound } from "../../../util/audio.js";

/*
 * Phone page parts: the message box, attachments, quick replies, reactions and money.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

export const actions = {
  send() {
    this._send(this.element.find(".agent-compose textarea")[0]);
  },
  "quick-reply"({ text }) {
    this._sendMessage(text);
  },
  "attach-location"() {
    this._attachLocation();
  },
  "clear-location"() {
    delete this.locations[this.draftKey];
    this.render();
  },
  "open-location"(d) {
    openLocation({ sceneId: d.sceneId, noteId: d.noteId, x: Number(d.x), y: Number(d.y) });
  },
  "attach-photo"() {
    this._attachPhoto();
  },
  "attach-job"() {
    this._attachJob();
  },
  "clear-job"() {
    delete this.jobs[this.draftKey];
    this.render();
  },
  "job-accept"({ messageId }) {
    this._respondJob(messageId, true);
  },
  "job-decline"({ messageId }) {
    this._respondJob(messageId, false);
  },
  "job-open"({ questId }) {
    this.app = "quests";
    this.questId = questId;
    this.render();
  },
  "clear-photo"() {
    delete this.images[this.draftKey];
    this.render();
  },
  "open-photo"({ src }) {
    new ImagePopout(src, { title: "Photo", shareable: false }).render(true);
  },
  react({ messageId, emoji }) {
    this._react(messageId, emoji);
  },
  "react-open"({ messageId }, event) {
    this._openEmojiPicker(messageId, event.currentTarget);
  },
  "pick-emoji"({ emoji }) {
    const picker = this.element.find(".agent-emoji-picker")[0];
    if (picker?.dataset.messageId) this._react(picker.dataset.messageId, emoji);
    if (picker) picker.hidden = true;
    this._flush();
  },
  money() {
    this._money();
  },
  "money-pay"({ messageId }) {
    this._moneyRespond(messageId, "pay");
  },
  "money-decline"({ messageId }) {
    this._moneyRespond(messageId, "decline");
  },
  "money-cancel"({ messageId }) {
    this._moneyRespond(messageId, "cancel");
  },
  "money-transfer"({ messageId }) {
    this._moneyRespond(messageId, "transfer");
  }
};

export const inputs = {
  ".agent-compose textarea": {
    input(event) {
      this.drafts[this.draftKey] = event.currentTarget.value;
    },
    keydown(event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this._send(event.currentTarget);
      }
    }
  },
  // Clicking anywhere else closes the emoji picker and the phone-line list.
  ".agent-phone": {
    click(event) {
      for (const [popover, opener] of [[".agent-emoji-picker", "react-open"], [".agent-line-picker", "service-call"]]) {
        const el = this.element.find(popover)[0];
        if (el && !el.hidden && !event.target.closest(`${popover}, [data-action=${opener}]`)) el.hidden = true;
      }
      this._flush();
    }
  }
};

export const methods = {
  _send(textarea) {
    if (this._sendMessage(textarea?.value.trim() ?? "") && textarea) {
      textarea.value = "";
      delete this.drafts[this.draftKey];
    }
  },

  /** Send text plus whatever location/photo is attached. Returns true if it went out. */
  _sendMessage(text) {
    const key = this.draftKey;
    const location = this.locations[key] ?? null;
    const image = this.images[key] ?? null;
    const job = this.jobs[key] ?? null;
    const ctx = this.context();
    if ((!text && !location && !image && !job) || !this.view || !ctx) return false;
    let sent = false;
    const v = this.view;
    if (v.kind === "direct") {
      const thread = this.resolveDirect();
      sent = store.request("send", { threadId: thread?.id, actorId: v.actorId, contact: v.contact, hidden: v.hidden, text, location, image, job });
    } else if (v.kind === "group") {
      const as = this.groupSpeaker(ctx, store.threads.get(v.groupId));
      if (as) sent = store.request("group-send", { groupId: v.groupId, as, text, location, image, job });
    } else if (v.kind === "service" && this.isGM) {
      const thread = store.findServiceThread(v.actorId, v.serviceId);
      sent = store.request("service-reply", { threadId: thread?.id, actorId: v.actorId, serviceId: v.serviceId, text, location, image, job });
    } else if (v.kind === "service") {
      sent = store.request("service-send", { actorId: v.actorId, serviceId: v.serviceId, text, location, image });
    }
    if (sent && (location || image || job)) {
      delete this.locations[key];
      delete this.images[key];
      delete this.jobs[key];
      this.render();
    }
    return sent;
  },

  /** Toggle my reaction on a message in the open conversation. */
  _react(messageId, emoji) {
    const ctx = this.context();
    const v = this.view;
    if (!ctx || !v) return;
    let threadId;
    let as;
    if (v.kind === "direct") threadId = this.resolveDirect()?.id;
    else if (v.kind === "service") threadId = store.findServiceThread(v.actorId, v.serviceId)?.id;
    else if (v.kind === "group") {
      threadId = v.groupId;
      as = this.groupSpeaker(ctx, store.threads.get(v.groupId));
      if (!as) return;
    }
    if (threadId) store.request("react", { threadId, messageId, emoji, as });
  },

  _openEmojiPicker(messageId, button) {
    const picker = this.element.find(".agent-emoji-picker")[0];
    const phone = this.element.find(".agent-phone")[0];
    if (!picker || !phone) return;
    if (!picker.hidden && picker.dataset.messageId === messageId) {
      picker.hidden = true;
      return;
    }
    picker.dataset.messageId = messageId;
    picker.hidden = false;
    const box = phone.getBoundingClientRect();
    const at = button.getBoundingClientRect();
    const top = Math.min(at.bottom - box.top + 4, box.height - picker.offsetHeight - 8);
    picker.style.top = `${Math.max(8, top)}px`;
  },

  /** The wallet this phone pays from in the open conversation: the PC, or (GM) the contact's linked sheet. */
  _myWallet() {
    const ctx = this.context();
    const v = this.view;
    if (!ctx || !v) return null;
    if (ctx.perspective === "pc") return game.actors.get(ctx.actorId);
    if (v.kind !== "direct") return null;
    const thread = this.resolveDirect();
    const actor = game.actors.get(v.actorId);
    const id = thread?.contactActorId ?? findContact(getContacts(actor), thread?.contact ?? v.contact)?.actorId;
    return id ? game.actors.get(id) : null;
  },

  /** Send or request money in the open conversation. */
  async _money() {
    const v = this.view;
    if (!v || !["direct", "service"].includes(v.kind)) return;
    const mine = this._myWallet();
    const wallet = hasWallet(mine) ? mine : null;
    const balance = wallet?.system.wealth.value ?? null;
    // The GM says who it's paying as, and whose sheet the money comes from (if any).
    let as = null;
    if (this.isGM) as = v.kind === "service" ? getService(v.serviceId)?.name ?? null : this.resolveDirect()?.contact ?? v.contact;
    const result = await moneyDialog(wallet, as);
    if (!result || !(result.amount > 0)) return;
    if (result.kind === "send" && balance !== null && balance < result.amount) {
      return ui.notifications.warn(`Not enough funds: ${formatMoney(balance)} available.`);
    }
    const target = v.kind === "service"
      ? { actorId: v.actorId, serviceId: v.serviceId }
      : { threadId: this.resolveDirect()?.id, actorId: v.actorId, contact: v.contact, hidden: v.hidden };
    store.request("money-send", { ...target, ...result });
  },

  _moneyRespond(messageId, action) {
    const v = this.view;
    const thread = v?.kind === "service" ? store.findServiceThread(v.actorId, v.serviceId) : this.resolveDirect();
    const message = thread?.messages.find(m => m.id === messageId);
    if (!message?.money) return;
    if (action === "pay") {
      const wallet = this._myWallet();
      if (hasWallet(wallet) && wallet.system.wealth.value < message.money.amount) {
        return ui.notifications.warn(`Not enough funds: ${formatMoney(wallet.system.wealth.value)} available.`);
      }
    }
    if (store.request("money-respond", { threadId: thread.id, messageId, action }) && action === "transfer") {
      playPhoneSound("moneySound"); // cash sound as the funds land
    }
  },

  /** Pick a photo to attach to the next message: from the server (GM), or upload / link / server (players). */
  async _attachPhoto() {
    const key = this.draftKey;
    if (!canSendImages(game.user) || !key) return;
    const attach = path => {
      if (!path) return;
      this.images[key] = path;
      this.render();
    };
    if (this.isGM) return new FilePicker({ type: "image", callback: attach }).render(true);
    attach(await attachPhotoDialog());
  },

  /** Pick a map pin (Note) to attach to the next message. */
  /** GM: choose a job to offer with the next message. */
  async _attachJob() {
    const key = this.draftKey;
    if (!key || !feature("jobs")) return;
    const quests = [...store.quests.values()].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    if (!quests.length) return ui.notifications.info("No jobs yet: create one in the Jobs app first.");
    const questId = await pickJobDialog(quests.map(q => ({
      id: q.id, name: q.name, status: QUEST_LABELS[q.status], hidden: q.hidden, selected: q.id === this.jobs[key]
    })));
    if (!questId) return;
    this.jobs[key] = questId;
    this.render();
  },

  /** Player: accept or decline a job offered in the open conversation. */
  _respondJob(messageId, accept) {
    const ctx = this.context();
    const v = this.view;
    let threadId = null;
    let as = null;
    if (v?.kind === "direct") threadId = this.resolveDirect()?.id;
    else if (v?.kind === "service") threadId = store.findServiceThread(v.actorId, v.serviceId)?.id;
    else if (v?.kind === "group") {
      threadId = v.groupId;
      as = this.groupSpeaker(ctx, store.threads.get(v.groupId));
    }
    if (threadId) store.request("job-respond", { threadId, messageId, accept, as });
  },

  async _attachLocation() {
    const key = this.draftKey;
    if (!feature("locations")) return;
    const ctx = this.context();
    const token = ctx?.perspective === "pc" ? ctx.subject.token : null;
    const current = token?.scene
      ? { sceneId: token.scene.id, sceneName: token.scene.navName || token.scene.name, noteId: null, x: token.center.x, y: token.center.y, label: "My Current Location" }
      : null;
    const picked = await pickLocation(current);
    if (!picked || !key) return;
    this.locations[key] = picked;
    this.render();
  }
};

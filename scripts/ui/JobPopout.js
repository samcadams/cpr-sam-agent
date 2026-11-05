import { AgentPhone } from "./phone/AgentPhone.js";
import { MODULE_ID, SOCKET, TEMPLATES } from "../config.js";
import { getPhoneSettings, phoneLook, phoneSubject } from "../model/agent.js";
import { appearance } from "../model/appearance.js";
import { store } from "../store.js";

/*
 * A job popped out of the phone into its own see-through window (Jobs app → the job → Pop out), so
 * the crew can keep an eye on it without their phones open. Players see what their phone shows; the
 * GM gets the same controls as on the GM Phone, and can pop it out on every player's screen.
 *
 * It's a phone that only ever shows one job's page, so the Jobs app's actions, dropdowns and data
 * (ui/phone/pages/quests.js) run here unchanged. It closes itself when the job is deleted or hidden.
 */
export class JobPopout extends AgentPhone {
  /** Pop out a job (or bring its window to the front). Players can only pop out jobs they can see. */
  static open(questId) {
    const popout = AgentPhone.popouts.get(questId) ?? new this(questId);
    if (!popout.questData(popout.context())) return null;
    AgentPhone.popouts.set(questId, popout);
    popout.render(true);
    if (popout.rendered) popout.bringToTop();
    return popout;
  }

  /** GM: pop a job out on every player's screen (those who can't see it get nothing). */
  static showToPlayers(questId) {
    if (!game.user.isGM) return;
    game.socket.emit(SOCKET, { type: "job-popout", questId });
    ui.notifications.info(`${store.quests.get(questId)?.name ?? "Job"}: shown to players.`);
  }

  constructor(questId) {
    super("job", { id: `ctp-job-${questId}` });
    this.app = "quests";
    this.questId = questId;
    this.popoutId = questId; // questId goes null when the job is deleted from here
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["ctp-phone-app", "ctp-job-popout"],
      template: TEMPLATES.jobPopout,
      width: 300,
      height: 360,
      dragDrop: []
    });
  }

  get title() {
    return store.quests.get(this.questId)?.name ?? "Job";
  }

  /** The GM sees it as on the GM Phone, a player as on their phone (its colours, if they have one in hand). */
  context() {
    if (game.user.isGM) {
      const settings = getPhoneSettings(game.user);
      return { perspective: "gm", settings, look: phoneLook(settings) };
    }
    const subject = phoneSubject();
    const settings = getPhoneSettings(subject?.actor ?? null);
    return { perspective: "pc", actorId: subject?.actor.id, settings, look: phoneLook(settings, subject?.agent === "internal") };
  }

  affectedBy(change = {}) {
    return !!(change.all || change.quests);
  }

  getData() {
    const ctx = (this._ctx = this.context());
    const quest = this.questData(ctx);
    // Deleted, hidden from players, or Jobs switched off: nothing left to show.
    if (!quest) setTimeout(() => this.close(), 0);
    return { quest: quest ?? {}, appearance: appearance() };
  }

  async _render(force, options) {
    await super._render(force, options);
    if (!this.rendered) return;
    // Only the phone's colours: a skin's case and bezel don't belong on a floating panel.
    const html = this.element[0];
    for (const cls of [...html.classList]) if (/^(skin|dock)-/.test(cls)) html.classList.remove(cls);
    html.classList.toggle("read-only", !game.user.isGM);
    html.querySelector(".window-title")?.replaceChildren(this.title);
    html.querySelector(".window-title")?.setAttribute("aria-label", `Job: ${this.title}`);
  }

  async close(options) {
    if (AgentPhone.popouts.get(this.popoutId) === this) AgentPhone.popouts.delete(this.popoutId);
    return super.close(options);
  }

  // Not a phone: nobody takes it out or puts it away, and it has no clock.
  _stateChanged() {}

  updateClock() {}
}

/** Players: the GM's "show to players" (see store.js, the "job-popout" push). */
export function installJobPopout() {
  Hooks.on(`${MODULE_ID}.jobPopout`, questId => {
    if (!game.user.isGM) JobPopout.open(questId);
  });
}

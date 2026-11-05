import { AgentPhone } from "../phone/AgentPhone.js";
import { ACTIONS, INPUTS } from "../phone/core/pages.js";
import { DROPDOWNS } from "../phone/pages/dropdown.js";

/*
 * The GM Phone's own state and rules, never drawn: the Director's views (views/*.js) read its data
 * (inboxRows, directData, gardenData...) and run its actions, then draw their own HTML. So whose phone,
 * who the GM acts as, the open conversation, attachments and the Garden's "As" work exactly as on the
 * GM Phone, and stay in step with it as the phone changes. Its redraws (render) redraw the Director.
 *
 * Only actions, inputs and dropdowns that don't read the phone's own DOM are run through it; the views
 * send text themselves (_sendMessage, store requests).
 */
export class GmLogic extends AgentPhone {
  constructor(onChange) {
    super("console", { id: "ctp-director-logic" });
    this.app = "messages";
    this.onChange = onChange;
  }

  /** The GM context, kept current (some methods read this._ctx). */
  ctx() {
    return (this._ctx = this.context());
  }

  render() {
    this.ctx();
    this.onChange?.();
    return this;
  }

  /** A page's "redraw when loaded" (Great River's catalogue) redraws the Director. */
  refresh() {
    this.render();
  }

  async close() {
    return this;
  }

  /**
   * A GM Phone action (data-action), as if pressed on the phone. `element` (the Director's) stands in for
   * the phone's own while it runs, so an action that reads its fields (this.element[0].querySelector)
   * finds the Director's fields of the same name; only up to its first await.
   */
  run(name, data = {}, event, element = null) {
    const action = ACTIONS.get(name);
    if (!action) return;
    this.ctx();
    return element ? this.with({ _element: element }, () => action.call(this, data, event)) : action.call(this, data, event);
  }

  /** A GM Phone input handler (INPUTS: selector → { [event type(s)]: fn }), given the Director's control. */
  input(selector, type, el) {
    const events = INPUTS.find(([s]) => s === selector)?.[1] ?? {};
    const handler = Object.entries(events).find(([types]) => types.split(" ").includes(type))?.[1];
    if (!handler) return;
    this.ctx();
    return handler.call(this, { currentTarget: el, target: el, type });
  }

  /** A GM Phone dropdown's choice. */
  pick(name, value) {
    this.ctx();
    return DROPDOWNS.get(name)?.call(this, value);
  }

  /** Run `fn` with some of this object's state swapped in, then put it back. */
  with(state, fn) {
    const saved = Object.fromEntries(Object.keys(state).map(k => [k, this[k]]));
    Object.assign(this, state);
    try {
      return fn();
    } finally {
      Object.assign(this, saved);
    }
  }
}

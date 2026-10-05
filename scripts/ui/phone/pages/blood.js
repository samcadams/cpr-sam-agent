import { woundState } from "../../../model/agent.js";
import { feature } from "../../../model/features.js";

/*
 * Phone effect: blood spattered on the screen while the character holding it is badly hurt.
 * Seriously Wounded (below half HP) shows a spatter; Mortally Wounded (below 1 HP) a heavier one
 * with a pulse at the edges. Switched on from the GM Phone's Control app, where the GM can also
 * preview it on the GM Phone. Drawn in CSS (styles/phone/effects.css); it never blocks clicks.
 * Methods are installed onto AgentPhone.
 */

export const methods = {
  /** "serious" | "mortal" for this phone, or null. */
  bloodData(ctx) {
    if (this.isGM) return this.bloodPreview ?? null;
    if (!feature("blood") || !ctx?.subject) return null;
    return woundState(ctx.subject.actor);
  }
};

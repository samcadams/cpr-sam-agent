import { MODULE_ID } from "../config.js";
import { feature } from "../model/features.js";
import { store } from "../store.js";

/*
 * Chat says when a player takes out or puts away their carried Agent (Control: "agentChat"; not an
 * Internal Agent, which nobody sees). This player's phone tells the host when its window opens or
 * closes (apps/agent/host.js posts the line). The line names no token, since Foundry would pan everyone to
 * it; each screen it reaches puts a bubble over the character's token itself, without panning. A
 * whispered line reaches only the GM, so only the GM sees that bubble; otherwise only those who can
 * see the token do.
 */

let shown = null; // { actorId, open } as last told

function tell(actorId, open) {
  shown = { actorId, open };
  store.request("agent-shown", { actorId, open });
}

function bubble(message) {
  const said = message.getFlag(MODULE_ID, "agentShown");
  if (!said || !canvas.ready) return;
  const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === said.actorId);
  const token = tokens.find(t => t.controlled) ?? tokens[0];
  const text = said.open ? "Takes out their Agent." : "Puts away their Agent.";
  if (token) canvas.hud.bubbles.say(token, text, { pan: false, requireVisible: true });
}

export function installAgentShown() {
  Hooks.on("createChatMessage", bubble);
  Hooks.on(`${MODULE_ID}.phoneState`, phone => {
    if (game.user.isGM || phone.mode !== "token") return;
    const ctx = phone.rendered ? phone.context() : null;
    const actorId = ctx && !ctx.internal ? ctx.actorId : null;
    // Put away, or switched to another character (or to an Internal Agent): the last one goes away.
    if (shown?.open && shown.actorId !== actorId) tell(shown.actorId, false);
    if (actorId && !(shown?.open && shown.actorId === actorId) && feature("agentChat")) tell(actorId, true);
    if (!actorId && shown?.open === false) shown = null;
  });
}

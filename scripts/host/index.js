import * as core from "./core.js";
import * as messages from "./messages.js";
import * as groups from "./groups.js";
import * as services from "./services.js";
import * as reactions from "./reactions.js";
import * as quests from "./quests.js";
import * as money from "./money.js";
import * as contactRequests from "./contactRequests.js";
import * as maintenance from "./maintenance.js";
import * as calls from "./calls.js";
import * as sounds from "./sounds.js";
import * as clock from "./clock.js";
import * as apps from "../../apps/hosts.js";
import { commsOn, COMMS_REQUESTS } from "../model/features.js";

/*
 * The host: whichever GM is the active GM runs every change for everyone.
 *
 * Each feature module (and each app's, see apps/hosts.js) exports `methods` (installed onto the store,
 * so they share its state and each other) and optionally `requests`: the socket request types it handles, mapped to the method that
 * handles them. Requests marked gm(...) (see validate.js) are dropped unless a GM sent them, and
 * Communications requests (model/features.js COMMS_REQUESTS) while Communications are off.
 */

const FEATURES = {
  core, messages, groups, services, reactions, quests, money, contactRequests, maintenance, calls, sounds, clock,
  ...apps // each app's (apps/hosts.js)
};

export function installHost(Store) {
  const handlers = new Map();
  for (const [feature, { methods, requests = {} }] of Object.entries(FEATURES)) {
    const file = feature in apps ? `apps/${feature}/host.js` : `host/${feature}.js`;
    for (const name of Object.keys(methods)) {
      if (name in Store.prototype || name === "_dispatch") throw new Error(`${file}: "${name}" is already defined`);
    }
    Object.assign(Store.prototype, methods);
    for (const [type, handler] of Object.entries(requests)) {
      if (handlers.has(type)) throw new Error(`${file}: request "${type}" is already handled`);
      handlers.set(type, typeof handler === "string" ? { name: handler, gmOnly: false } : handler);
    }
  }

  /** Run one queued request (see core._handle). */
  Store.prototype._dispatch = async function (user, msg) {
    const handler = handlers.get(msg.type);
    if (!handler || (handler.gmOnly && !user.isGM)) return;
    if (COMMS_REQUESTS.has(msg.type) && !commsOn()) return;
    return this[handler.name](user, msg);
  };
}

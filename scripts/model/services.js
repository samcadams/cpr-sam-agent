import { MODULE_ID } from "../config.js";

/*
 * Scripted service contacts (e.g. "Trauma Team"): players get buttons, never a text box.
 * Stored in a world setting:
 * [{ id, name, img, actions: [{ id, label }], callLabel, chat, access: "all" | [actorId, ...] }]
 * actions: "request buttons", one-tap messages the player sends.
 * callLabel: "phone lines" (comma separated) the player can ring, picked from the service's call button.
 * chat: players may also type freely to the service (e.g. an "Agent AI"); the GM answers on the GM Phone.
 * Money: the GM can always send or request eurobucks on a service thread; players can only pay requests.
 * (Older saves may carry a `money` flag; it is ignored.)
 */

/*
 * Built-in services every world starts with. The active GM adds each one once (ids remembered in the
 * "seededServices" setting), so a GM can edit or delete it and it stays that way.
 */
export const DEFAULT_SERVICES = [{
  id: "reo-meatwagon",
  name: "REO Meatwagon",
  img: "icons/svg/heal.svg",
  actions: [{ id: "reo-pickup", label: "Request Pickup" }],
  callLabel: "REO Meatwagon",
  access: "all"
}];

/** Active GM: add the built-in services this world hasn't had yet. */
export async function seedDefaultServices() {
  const seeded = game.settings.get(MODULE_ID, "seededServices") ?? [];
  const fresh = DEFAULT_SERVICES.filter(d => !seeded.includes(d.id));
  if (!fresh.length) return;
  const services = getServices();
  for (const d of fresh) if (!services.some(s => s.id === d.id)) services.push(foundry.utils.deepClone(d));
  await game.settings.set(MODULE_ID, "services", services);
  await game.settings.set(MODULE_ID, "seededServices", [...seeded, ...fresh.map(d => d.id)]);
}

export function getServices() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "services") ?? []);
}

export function getService(id) {
  return getServices().find(s => s.id === id) ?? null;
}

/** The service's call buttons: callLabel is a comma-separated list, e.g. "Emergency Line, Dispatch". */
export function callLines(service) {
  return String(service?.callLabel ?? "").split(",").map(l => l.trim()).filter(Boolean);
}

export function serviceAvailable(service, actorId) {
  return service.access === "all" || (Array.isArray(service.access) && service.access.includes(actorId));
}

export function servicesFor(actorId) {
  return getServices().filter(s => (s.actions.length || callLines(s).length || s.chat) && serviceAvailable(s, actorId));
}

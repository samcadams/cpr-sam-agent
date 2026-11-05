import { MODULE_ID } from "../../scripts/config.js";
import { weatherFlag } from "./model.js";

/*
 * Weather's Foundry hooks (main.js installs every app's client.js when the module loads).
 * The heat (NCW p. 4-5): Hot adds 1 to an existing armor penalty to REF, DEX and MOVE, a Heat Wave 2.
 * CPR works the armor penalty out from the worn armor at roll time (CPRActor.getArmorPenaltyMods), so
 * an Active Effect can't add to it only when there is one: this wraps that method instead, and reads the
 * extra from the weather effect (apps/weather/model.js weatherEffect) while it's on. No armor penalty,
 * no extra. Phones on the Weather app redraw when a weather effect comes or goes.
 */

/** The prototype that defines CPR's getArmorPenaltyMods (the actor class or one of its parents). */
function ownerOf(cls, name) {
  for (let p = cls?.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (Object.hasOwn(p, name)) return p;
  }
  return null;
}

/** The extra armor penalty from the weather on this actor. */
export function weatherArmor(actor) {
  let extra = 0;
  for (const e of actor.effects ?? []) {
    if (e.disabled) continue;
    extra = Math.max(extra, Number(weatherFlag(e, MODULE_ID)?.armor) || 0);
  }
  return extra;
}

function wrapArmorPenalty() {
  const proto = ownerOf(CONFIG.Actor.documentClass, "getArmorPenaltyMods");
  if (!proto || proto.getArmorPenaltyMods.samAgentWeather) return;
  const original = proto.getArmorPenaltyMods;
  const wrapped = function (stat, ...rest) {
    const base = original.call(this, stat, ...rest);
    if (!(base < 0)) return base;
    return base - weatherArmor(this);
  };
  wrapped.samAgentWeather = true;
  proto.getArmorPenaltyMods = wrapped;
}

export function install({ refreshPhones }) {
  Hooks.once("setup", wrapArmorPenalty);
  const refresh = foundry.utils.debounce(() => refreshPhones({ weather: true }), 150);
  const mine = effect => !!weatherFlag(effect, MODULE_ID);
  for (const action of ["create", "update", "delete"]) Hooks.on(`${action}ActiveEffect`, effect => mine(effect) && refresh());
}

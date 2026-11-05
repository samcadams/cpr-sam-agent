import { payPoints } from "./model.js";

/*
 * BangMe!'s Foundry hooks (main.js installs every app's client.js when the module loads).
 * `refreshPhones(change)` redraws the phones that show the change.
 */

export function install({ refreshPhones }) {
  // Anchored pay points come and go as tokens move, and as their tokens, map pins and Regions change.
  const refreshPayPoints = foundry.utils.debounce(() => refreshPhones({ bangme: true }), 250);
  const anchored = () => payPoints().some(p => p.anchor);
  for (const doc of ["Token", "Note", "Region"]) {
    for (const action of ["create", "update", "delete"]) Hooks.on(`${action}${doc}`, () => anchored() && refreshPayPoints());
  }
}

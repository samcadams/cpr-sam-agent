import { MODULE_ID } from "../../config.js";

/*
 * What the rest of the module needs to know about the GM Director without importing it (no import
 * cycle with the phone): whether it's open, and so whether it takes this GM's calls.
 */

export const directorState = { open: false };

/** The Director is open and the GM's calls ring on it (client setting directorCalls), not the GM Phone. */
export const directorTakesCalls = () => directorState.open && game.user.isGM && !!game.settings.get(MODULE_ID, "directorCalls");

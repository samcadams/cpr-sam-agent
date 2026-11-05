/** Whether this is the build `npm run release` ships (tools/bundle.mjs --release defines it); false in dev and unbundled. */
export const RELEASE = globalThis.CPR_SAM_AGENT_RELEASE === true;

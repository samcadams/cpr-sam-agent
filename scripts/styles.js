/*
 * The module's stylesheets, in order: the core sheets, each app's own (apps/<id>/<id>.css) after the
 * shared app styles, then the skins. Plain data, so tools/apps.mjs can write module.json "styles" from it.
 */

const BEFORE = [
  "styles/base.css",
  "styles/buttons.css",
  "styles/toasts.css",
  "styles/dialogs.css",
  "styles/managers.css",
  "styles/phone/frame.css",
  "styles/phone/inbox.css",
  "styles/phone/conversation.css",
  "styles/phone/calls.css",
  "styles/phone/apps.css",
  "styles/phone/app-pages.css",
  "styles/director.css"
];

const AFTER = [
  "styles/skins/fonts.css",
  "styles/phone/effects.css",
  "styles/skins/neon.css",
  "styles/skins/zetatech.css",
  "styles/skins/yourplay.css",
  "styles/skins/dot.css",
  "styles/skins/field.css",
  "styles/skins/burner.css",
  "styles/skins/hud.css",
  "styles/skins/neuron.css",
  "styles/phone/shade.css",
  "styles/phone/bezel.css",
  "styles/monitor.css"
];

/** An app's stylesheet. */
export const appStyle = id => `apps/${id}/${id}.css`;

/** Every stylesheet, for these apps (in their order). */
export const stylesFor = ids => [...BEFORE, ...ids.map(appStyle), ...AFTER];

/**
 * The bundled build (`npm run bundle`): with it switched on (`npm run bundle -- --enable`), module.json
 * loads these two files instead of scripts/main.js and the stylesheets above.
 */
export const BUNDLE = { js: "dist/cpr-sam-agent.js", css: "dist/cpr-sam-agent.css" };

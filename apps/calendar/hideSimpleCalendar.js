import { scApi, scHidden } from "./model.js";

/*
 * The "Hide Simple Calendar from players" setting: on players' clients, Simple Calendar's scene-control
 * button is left out and its window closes whenever it opens (players use the phone's Calendar).
 * The GM keeps both.
 */

/** Simple Calendar's main window (its full and compact views). */
const isScWindow = app => app?.options?.classes?.includes("simple-calendar") && /templates\/main\.html$/.test(app.options.template ?? "");

function closeScWindows() {
  for (const app of Object.values(ui.windows)) if (isScWindow(app)) app.close();
}

export function installSimpleCalendarHiding() {
  // After Simple Calendar's own hook (it adds its button during init).
  Hooks.once("setup", () => {
    Hooks.on("getSceneControlButtons", controls => {
      if (!scHidden()) return;
      const notes = controls.find(c => c.name === "notes");
      if (notes?.tools) notes.tools = notes.tools.filter(t => t.name !== "calendar");
    });
  });
  // A window still drawing ignores close(): close it once the draw is done.
  Hooks.on("renderApplication", app => {
    if (scHidden() && isScWindow(app)) setTimeout(() => app.close(), 0);
  });
  Hooks.once("ready", () => {
    if (scApi() && scHidden()) closeScWindows();
  });
}

/** The setting changed: rebuild the controls, and close the window if it's hidden now. */
export function onHideSimpleCalendarChanged() {
  ui.controls?.initialize?.();
  ui.controls?.render?.();
  if (scHidden()) closeScWindows();
}

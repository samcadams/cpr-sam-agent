/*
 * Moving the Director into a child browser window (a real OS window: second monitor, maximise, F11)
 * and back. The child has no scripts: the Director's element is adopted into it, and its handlers,
 * the store and the socket keep running in this tab. Foundry's own popups (dialogs, tooltips,
 * notifications) still open in this tab.
 */

/** Copy this tab's stylesheets (core, system, modules, skins) and root classes into the child. */
function copyStyles(doc) {
  for (const sheet of document.head.querySelectorAll("link[rel=stylesheet], style")) doc.head.append(doc.importNode(sheet, true));
  doc.documentElement.className = document.documentElement.className;
  doc.documentElement.style.cssText = document.documentElement.style.cssText;
  doc.body.className = `${document.body.className} ctp-director-window`;
}

/** Open the child window and move the Director into it. Needs a click (browsers block pop-ups otherwise). */
export function detach(app) {
  const win = window.open("", "ctp-director", "popup,width=1400,height=900");
  if (!win) return ui.notifications.warn("The browser blocked the Director's window: allow pop-ups for Foundry.");
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}"><title>Director</title></head><body></body></html>`);
  doc.close();
  copyStyles(doc);
  const el = app.element[0];
  app._docked = { ...app.position };
  doc.body.append(doc.adoptNode(el));
  el.classList.add("detached");
  app.child = win;
  win.addEventListener("pagehide", () => app.child === win && redock(app));
  if (!app._unloadHooked) {
    app._unloadHooked = true;
    window.addEventListener("pagehide", () => app.child?.close());
  }
  app.render();
}

/** Bring the Director back into this tab (the child was closed, or Dock was pressed) and close the child. */
export function redock(app, { closing = false } = {}) {
  const win = app.child;
  app.child = null;
  const el = app.element?.[0];
  if (el && el.ownerDocument !== document) {
    document.body.append(document.adoptNode(el));
    el.classList.remove("detached");
  }
  if (win && !win.closed) win.close();
  if (closing || !app.rendered) return;
  app.setPosition(app._docked);
  app.render();
}

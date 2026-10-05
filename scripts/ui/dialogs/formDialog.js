/**
 * A dialog showing a form from a template (see DIALOGS in config.js).
 * Resolves to `callback(html)` when confirmed, or null when closed.
 */
export async function formDialog({ title, template, data = {}, label = "OK", callback, render }) {
  const content = await renderTemplate(template, data);
  return Dialog.prompt({ title, content, label, rejectClose: false, callback, render });
}

/** The <form> element in a dialog's rendered html. */
export const formIn = html => html[0]?.querySelector?.("form") ?? html.find("form")[0];

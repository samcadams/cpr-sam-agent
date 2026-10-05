import { formDialog, formIn } from "./formDialog.js";
import { DIALOGS, photoFolder } from "../../config.js";
import { currencyLabel, formatMoney } from "../../model/money.js";
import { QUEST_LABELS, QUEST_STATUSES } from "../../model/quests.js";
import { esc } from "../../util/text.js";

/*
 * The phone's form dialogs. Each resolves to what was entered, or null if the dialog was closed.
 */

/**
 * Send or request eurobucks.
 * @param {Actor|null} wallet  the sheet paying from this side, or null if it has none
 * @param {string|null} [as]   GM: the NPC or service it's paying as
 * @returns {Promise<{kind: "send"|"request", amount: number, note: string}|null>}
 */
export function moneyDialog(wallet, as = null) {
  return formDialog({
    title: as ? `Eurobucks · as ${as}` : "Eurobucks",
    template: DIALOGS.money,
    data: { currency: currencyLabel(), as, wallet: wallet?.name, balance: wallet ? formatMoney(wallet.system.wealth.value) : null },
    label: "Confirm",
    callback: html => ({
      kind: html.find("select[name=kind]").val(),
      amount: Math.floor(Number(html.find("input[name=amount]").val())),
      note: html.find("input[name=note]").val().trim()
    })
  });
}

/** Player: ask the GM for a number. @returns {Promise<{name: string, note: string}|null>} */
export function contactRequestDialog() {
  return formDialog({
    title: "Add a contact",
    template: DIALOGS.contactRequest,
    label: "Request",
    callback: html => ({ name: html.find("input[name=name]").val().trim(), note: html.find("input[name=note]").val().trim() })
  });
}

/**
 * GM: approve a contact request, optionally renaming it or linking it to a sheet.
 * @param {object} data  { owner, request, candidates: [{ id, name, selected }] }
 * @returns {Promise<{linkActorId: string|null, name: string}|null>}
 */
export function approveRequestDialog(data) {
  return formDialog({
    title: "Approve contact request",
    template: DIALOGS.approveRequest,
    data,
    label: "Approve",
    callback: html => ({ linkActorId: html.find("select[name=link]").val() || null, name: html.find("input[name=name]").val().trim() })
  });
}

/**
 * GM: start a conversation. From an NPC's phone, pick which PC to text (`characters`). From the GM
 * Phone, pick who to text as: one of the PC's `contacts`, any other of the `actors` (or drop one onto
 * the dialog), or type a name for someone with no sheet.
 * @returns {Promise<{actorId?: string, pick?: string, name?: string, hidden: boolean}|null>}
 *   pick is "c:<contact name>" or "a:<actor id>"; a typed name wins over it.
 */
export function newThreadDialog({ title, characters = null, owner = "", contacts = [], actors = [] }) {
  return formDialog({
    title,
    template: DIALOGS.newThread,
    data: { characters, owner, contacts, actors },
    label: "Open",
    render: html => {
      const form = formIn(html);
      const zone = form.querySelector(".ctp-drop-actor");
      if (!zone) return;
      form.addEventListener("dragover", event => event.preventDefault());
      form.addEventListener("drop", event => {
        event.preventDefault();
        const data = TextEditor.getDragEventData(event);
        const actor = data.type === "Actor" ? fromUuidSync(data.uuid) : null;
        if (!actor) return;
        let option = form.pick.querySelector(`option[value="a:${actor.id}"]`);
        if (!option) {
          option = new Option(actor.prototypeToken?.name || actor.name, `a:${actor.id}`);
          form.pick.append(option);
        }
        form.pick.value = option.value;
        form.name.value = "";
        zone.classList.add("dropped");
        zone.querySelector("span").textContent = option.textContent;
      });
    },
    callback: html => ({
      actorId: html.find("select[name=actor]").val(),
      pick: html.find("select[name=pick]").val(),
      name: html.find("input[name=name]").val()?.trim(),
      hidden: html.find("input[name=hidden]").is(":checked")
    })
  });
}

/**
 * GM: create or edit a job.
 * @param {object|null} quest   the job to edit, or null for a new one
 * @param {string} status       the status to preselect for a new one
 */
export function questDialog(quest, status) {
  return formDialog({
    title: quest ? "Edit job" : "New job",
    template: DIALOGS.quest,
    data: {
      quest,
      statuses: QUEST_STATUSES.map(id => ({ id, label: QUEST_LABELS[id], selected: id === (quest?.status ?? status) })),
      hidden: quest ? quest.hidden : true
    },
    label: quest ? "Save" : "Create",
    render: html => {
      const form = formIn(html);
      form.querySelector(".ctp-pick-img").addEventListener("click", () => {
        new FilePicker({ type: "image", current: form.img.value, callback: path => (form.img.value = path) }).render(true);
      });
    },
    callback: html => ({
      id: quest?.id,
      name: html.find("input[name=name]").val().trim(),
      status: html.find("select[name=status]").val(),
      img: html.find("input[name=img]").val().trim(),
      description: html.find("textarea[name=description]").val(),
      hidden: html.find("input[name=hidden]").is(":checked")
    })
  });
}

/**
 * GM: add or edit an objective.
 * @param {object|null} objective  the objective to edit, or null for a new one
 * @param {{id: string, text: string, selected: boolean}[]} parents  objectives it may branch from
 */
export function objectiveDialog(objective, parents) {
  return formDialog({
    title: objective ? "Edit objective" : "New objective",
    template: DIALOGS.objective,
    data: { objective, parents },
    label: objective ? "Save" : "Add",
    callback: html => ({
      id: objective?.id,
      text: html.find("input[name=text]").val().trim(),
      parentId: html.find("select[name=parentId]").val() || null,
      hidden: html.find("input[name=hidden]").is(":checked")
    })
  });
}

/**
 * GM: choose a job to offer in a message.
 * @param {{id: string, name: string, status: string, hidden: boolean, selected: boolean}[]} jobs
 * @returns {Promise<string|null>} the quest id
 */
export function pickJobDialog(jobs) {
  return formDialog({
    title: "Offer a job",
    template: DIALOGS.pickJob,
    data: { jobs },
    label: "Attach",
    callback: html => html.find("select[name=job]").val() || null
  });
}

/**
 * Attach a photo: upload one (with Foundry's "Upload New Files" permission), paste a link, or pick a
 * file already on the server (with "Use File Browser"). Uploads go in the world's slopphone/agent-photos folder.
 * @returns {Promise<string|null>} the picture's path or URL
 */
export async function attachPhotoDialog() {
  const canUpload = game.user.can("FILES_UPLOAD");
  const canBrowse = game.user.can("FILES_BROWSE");
  const result = await formDialog({
    title: "Send a photo",
    template: DIALOGS.attachPhoto,
    data: { canUpload, canBrowse },
    label: "Attach",
    render: html => {
      const form = formIn(html);
      form?.querySelector(".ctp-browse")?.addEventListener("click", () => {
        new FilePicker({ type: "image", callback: path => (form.link.value = path) }).render(true);
      });
    },
    callback: html => {
      const form = formIn(html);
      return { file: form.file?.files?.[0] ?? null, link: form.link.value.trim() };
    }
  });
  if (!result) return null;
  if (result.file) {
    const file = new File([result.file], `${Date.now()}-${result.file.name.replace(/[^\w.-]+/g, "_")}`, { type: result.file.type });
    const response = await FilePicker.upload("data", photoFolder(), file, {}, { notify: false }).catch(err => {
      ui.notifications.error(`Couldn't upload the photo: ${err.message ?? err}`);
      return null;
    });
    return response?.path ?? null;
  }
  return result.link || null;
}

/**
 * A simple form built from a list of fields, for the apps' small dialogs.
 * @param {object} options
 * @param {string} options.title
 * @param {Array<{name: string, label: string, type?: "text"|"number"|"textarea"|"select"|"checkbox"|"image",
 *   value?: any, options?: Array<{value: string, label: string}>, placeholder?: string, hint?: string, search?: boolean}>} options.fields
 *   select with search: a box beside it that narrows the options as you type
 *   image: a text field with a file picker button (GM) for a picture
 *   textfile: a button that reads a text file from this computer into the field named `target`
 *     (not in the result)
 * @param {string} [options.label]  the confirm button
 * @param {string} [options.note]   a line under the fields
 * @returns {Promise<object|null>} the values by name (checkboxes as booleans, numbers as numbers)
 */
export function fieldsDialog({ title, fields, label = "Save", note = "" }) {
  const input = f => {
    const value = esc(f.value ?? "");
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
    switch (f.type) {
      case "textarea":
        return `<textarea name="${f.name}" rows="${f.rows ?? 4}"${ph}>${value}</textarea>`;
      case "select": {
        const select = `<select name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
        return f.search ? `<div class="form-fields"><input type="text" class="ctp-select-search" data-target="${f.name}" placeholder="Search…" autocomplete="off">${select}</div>` : select;
      }
      case "checkbox":
        return `<input type="checkbox" name="${f.name}"${f.value ? " checked" : ""}>`;
      case "number":
        return `<input type="number" name="${f.name}" value="${value}"${ph}${f.step ? ` step="${f.step}"` : ""}>`;
      case "textfile":
        return `<div class="form-fields"><button type="button" class="ctp-load-text" data-target="${esc(f.target)}"><i class="fas fa-file-arrow-up"></i> Choose a .txt file</button><span class="ctp-load-text-name notes"></span></div>`;
      case "image":
        return `<div class="form-fields"><input type="text" name="${f.name}" value="${value}"${ph}>${game.user.can("FILES_BROWSE") ? `<button type="button" class="ctp-pick-img" data-target="${f.name}"><i class="fas fa-file-import"></i></button>` : ""}</div>`;
      default:
        return `<input type="text" name="${f.name}" value="${value}"${ph}>`;
    }
  };
  const content = `<form class="ctp-fields-form">${fields.map(f => `<div class="form-group${f.type === "textarea" ? " stacked" : ""}"><label>${esc(f.label)}</label>${input(f)}${f.hint ? `<p class="notes">${esc(f.hint)}</p>` : ""}</div>`).join("")}${note ? `<p class="notes">${esc(note)}</p>` : ""}</form>`;
  return Dialog.prompt({
    title,
    content,
    label,
    rejectClose: false,
    render: html => {
      const form = formIn(html);
      for (const button of form?.querySelectorAll(".ctp-pick-img") ?? []) {
        button.addEventListener("click", () => {
          const target = form.elements[button.dataset.target];
          new FilePicker({ type: "image", current: target.value, callback: path => (target.value = path) }).render(true);
        });
      }
      // A select's search box: hide the options without every word typed, and pick the first left.
      for (const search of form?.querySelectorAll(".ctp-select-search") ?? []) {
        search.addEventListener("input", () => {
          const select = form.elements[search.dataset.target];
          const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
          for (const option of select.options) option.hidden = !words.every(w => option.textContent.toLowerCase().includes(w));
          if (select.selectedOptions[0]?.hidden) select.value = [...select.options].find(o => !o.hidden)?.value ?? select.value;
        });
        search.addEventListener("keydown", event => {
          if (event.key === "Enter") event.preventDefault();
        });
      }
      for (const button of form?.querySelectorAll(".ctp-load-text") ?? []) {
        button.addEventListener("click", () => {
          const picker = Object.assign(document.createElement("input"), { type: "file", accept: ".txt,text/plain" });
          picker.addEventListener("change", async () => {
            const file = picker.files?.[0];
            if (!file) return;
            form.elements[button.dataset.target].value = (await file.text()).trim();
            button.nextElementSibling.textContent = file.name;
          });
          picker.click();
        });
      }
    },
    callback: html => {
      const form = formIn(html);
      return Object.fromEntries(fields.filter(f => f.type !== "textfile").map(f => {
        const el = form.elements[f.name];
        if (f.type === "checkbox") return [f.name, el.checked];
        if (f.type === "number") return [f.name, Number(el.value)];
        return [f.name, el.value.trim()];
      }));
    }
  });
}

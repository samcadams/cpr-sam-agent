import { appBar } from "./home.js";
import { attachPhotoDialog } from "../../dialogs/forms.js";
import { DATA_POOL_FOLDER, EXAMPLE_ENTRY, librarySearchBase } from "../../../model/alex.js";
import { displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { ago } from "../../../util/text.js";

/*
 * Phone page: Ask Alex Anything (see model/alex.js). Players ask; each question shows "Alex is
 * crawling the Pool…" until the GM answers, asks for a roll, or marks it "No results". The GM Phone
 * lists the questions waiting, with the suggested roll.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

export const actions = {
  "alex-ask"() {
    const actor = this.context()?.subject?.actor;
    const input = this.element[0].querySelector("input[name=alexQuery]");
    const text = input?.value.trim();
    if (!actor || !text) return;
    if (store.request("alex-ask", { actorId: actor.id, text })) {
      this.alexDraft = "";
      input.value = "";
    }
  },
  "alex-roll"({ queryId }) {
    store.request("alex-roll", { queryId });
  },
  "alex-clear"() {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("alex-clear", { actorId: actor.id });
  },
  "alex-answer"({ queryId }) {
    const root = this.element[0];
    const text = root.querySelector(`textarea[data-query-id="${queryId}"]`)?.value.trim();
    const image = this.alexImages?.[queryId] ?? null;
    if (!text && !image) return ui.notifications.warn("Write Alex's answer first.");
    store.request("alex-answer", { queryId, text, image });
    delete this.alexDrafts?.[queryId];
    delete this.alexImages?.[queryId];
  },
  async "alex-photo"({ queryId }) {
    const image = await attachPhotoDialog();
    if (!image) return;
    (this.alexImages ??= {})[queryId] = image;
    this.render();
  },
  "alex-need-roll"({ queryId }) {
    const dv = Number(this.element[0].querySelector(`input[name=alexDv][data-query-id="${queryId}"]`)?.value) || 13;
    store.request("alex-need-roll", { queryId, dv });
  },
  "alex-none"({ queryId }) {
    store.request("alex-none", { queryId });
  },
  /** GM: make the "Data Pool" folder and an example entry to copy. */
  async "alex-example"() {
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === DATA_POOL_FOLDER);
    folder ??= await Folder.create({ name: DATA_POOL_FOLDER, type: "JournalEntry" });
    const entry = await JournalEntry.create({
      name: EXAMPLE_ENTRY.name, folder: folder.id,
      pages: [{ name: EXAMPLE_ENTRY.name, type: "text", text: { content: EXAMPLE_ENTRY.text } }]
    });
    entry?.sheet.render(true);
  }
};

export const inputs = {
  "input[name=alexQuery]": {
    input(event) {
      this.alexDraft = event.currentTarget.value;
    },
    keydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.element.find("[data-action=alex-ask]").trigger("click");
      }
    }
  },
  "textarea[data-query-id]": {
    input(event) {
      (this.alexDrafts ??= {})[event.currentTarget.dataset.queryId] = event.currentTarget.value;
    }
  }
};

export const methods = {
  alexData(ctx) {
    const queries = Object.values(store.apps.queries).sort((a, b) => a.ts - b.ts);
    const row = q => ({
      ...q,
      // Answers that just arrived appear word by word (AgentPhone._revealAnswers).
      reveal: q.status === "answered" && (q.answer?.ts ?? 0) > Date.now() - 10 * 60_000,
      crawling: q.status === "crawling",
      needsRoll: q.status === "roll",
      answered: q.status === "answered",
      none: q.status === "none",
      ago: ago(q.ts)
    });
    if (ctx.perspective === "gm") {
      const waiting = queries.filter(q => q.status === "crawling" || q.status === "roll");
      return {
        gm: true,
        bar: appBar("alex"),
        waiting: waiting.map(q => {
          const actor = game.actors.get(q.actorId);
          const base = librarySearchBase(actor);
          return {
            ...row(q), name: actor ? displayName(actor) : "?", suggest: `Library Search: INT ${base.int} + skill ${base.level} + 2 (Agent) = ${base.total} + 1d10`,
            draft: this.alexDrafts?.[q.id] ?? "", image: this.alexImages?.[q.id] ?? null
          };
        }),
        recent: queries.filter(q => q.status === "answered" || q.status === "none").slice(-10).reverse().map(q => ({ ...row(q), name: displayName(game.actors.get(q.actorId)) })),
        folder: DATA_POOL_FOLDER
      };
    }
    return {
      bar: appBar("alex", { owner: ctx.subject.name }),
      draft: this.alexDraft ?? "",
      online: this.online,
      queries: queries.filter(q => q.actorId === ctx.actorId).map(row),
      canClear: queries.some(q => q.actorId === ctx.actorId && (q.status === "answered" || q.status === "none"))
    };
  }
};

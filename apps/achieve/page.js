import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { previewCelebration } from "./popup.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { achieveConfig, achievementList, blankBadge, cleanCustom, earnedBy, earnedData, TRADES, unspent } from "./model.js";
import { boxContents, boxesData, boxName } from "./boxes.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { compendiumItems } from "../../scripts/model/items.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { esc } from "../../scripts/util/text.js";

/*
 * Phone page: Achieve! (see apps/achieve/model.js). Players see their character's badges: earned (when, the
 * GM's note, traded in or not), still to get, and secret ones; a badge opens in a popup over the page.
 * They show one off in chat, and ask the GM to trade one in. The GM Phone picks a character to see theirs; awards one (to that
 * character and any others ticked), takes them back, trades them in, hides or switches them off, and
 * adds its own.
 * Mystery Boxes (apps/achieve/boxes.js), on their own tab: a player opens their character's; the GM gives the
 * character on screen one, and sees everyone's (confirms what's inside, or gives something else).
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const saveConfig = change => patchSetting("achieve", change);

const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

const TABS = { badges: "Achievements", boxes: "Mystery Boxes" };
const BOX_STATUS = { sealed: "Sealed", opening: "Opened: waiting for the GM", open: "Opened" };

export const actions = {
  "achieve-tab"({ tab }) {
    this.achTab = tab;
    this.achOpen = null;
    this.render();
  },
  /** A badge opens over the page; closing it puts focus back on the badge. */
  "achieve-open"({ id }) {
    this.achOpen = id;
    this._focusNext = ".agent-achieve-pop .agent-achieve-close";
    this.render();
  },
  "achieve-close"() {
    if (this.achOpen) this._focusNext = `.agent-achieve-badge[data-id="${CSS.escape(this.achOpen)}"]`;
    this.achOpen = null;
    this.render();
  },
  /** A player: ask the GM to trade it in. */
  async "achieve-ask"({ id }) {
    const actor = this._achActor();
    const ach = achievementList().find(a => a.id === id);
    if (!actor || !ach) return;
    const result = await fieldsDialog({
      title: `Trade in ${ach.name}`,
      label: "Ask the GM",
      note: "Your GM makes it happen.",
      fields: [{ name: "kind", label: "For", type: "select", value: "reroll", options: Object.entries(TRADES).map(([value, t]) => ({ value, label: `${t.name}: ${t.text}` })) }]
    });
    if (result) store.request("achieve-ask", { actorId: actor.id, id, kind: result.kind });
  },

  /** A player: show it off in chat. */
  "achieve-show"({ id }) {
    const actor = this._achActor();
    if (actor) store.request("achieve-show", { actorId: actor.id, id });
  },

  /* GM */
  /** Award it: to the character on screen, and any others ticked (those who have it already are left out). */
  async "achieve-award"({ id }) {
    const actor = this._achActor();
    const ach = achievementList().find(a => a.id === id);
    if (!actor || !ach) return;
    const all = earnedData(store.apps);
    const pcs = playerCharacters().filter(a => !earnedBy(a.id, all)[id]);
    const result = await fieldsDialog({
      title: `Award ${ach.name}`,
      label: "Award",
      note: "Everyone ticked earns it.",
      fields: [
        ...pcs.map(a => ({ name: `pc_${a.id}`, label: displayName(a), type: "checkbox", value: a.id === actor.id })),
        { name: "note", label: "Note", type: "textarea", rows: 2, placeholder: "How they earned it (their players see it)." }
      ]
    });
    if (!result) return;
    const actorIds = pcs.filter(a => result[`pc_${a.id}`]).map(a => a.id);
    if (!actorIds.length) return ui.notifications.info("Nobody ticked: nothing awarded.");
    store.request("achieve-award", { actorIds, id, note: result.note });
  },
  "achieve-revoke"({ id }) {
    const actor = this._achActor();
    const ach = achievementList().find(a => a.id === id);
    if (!actor || !ach) return;
    Dialog.confirm({
      title: "Achieve!", defaultYes: false,
      content: `<p>Take <strong>${esc(ach.name)}</strong> back from ${esc(displayName(actor))}? They can earn it again.</p>`,
      yes: () => store.request("achieve-revoke", { actorId: actor.id, id })
    });
  },
  async "achieve-trade"({ id }) {
    const actor = this._achActor();
    const ach = achievementList().find(a => a.id === id);
    if (!actor || !ach) return;
    const result = await fieldsDialog({
      title: `Trade in ${ach.name}`,
      label: "Trade in",
      note: `For ${displayName(actor)}. A Mystery Box turns up on their Mystery Boxes tab.`,
      fields: [{ name: "kind", label: "For", type: "select", value: "reroll", options: Object.entries(TRADES).map(([value, t]) => ({ value, label: t.name })) }]
    });
    if (result) store.request("achieve-trade", { actorId: actor.id, id, kind: result.kind });
  },
  "achieve-hide"({ id }) {
    return saveConfig(c => (c.hidden = toggle(c.hidden ?? [], id)));
  },
  "achieve-disable"({ id }) {
    return saveConfig(c => (c.disabled = toggle(c.disabled ?? [], id)));
  },
  async "achieve-edit"({ id } = {}) {
    const cfg = achieveConfig();
    const list = (cfg.custom ?? []).map(cleanCustom);
    const i = list.findIndex(a => a.id === id);
    const a = list[i] ?? { name: "", text: "", img: "" };
    const result = await fieldsDialog({
      title: i >= 0 ? `Achievement: ${a.name}` : "New achievement",
      label: i >= 0 ? "Save" : "Add",
      fields: [
        { name: "name", label: "Name", value: a.name },
        { name: "text", label: "To earn it", type: "textarea", rows: 3, value: a.text },
        { name: "img", label: "Badge", type: "image", value: a.img === blankBadge() ? "" : a.img, hint: "An image (round works best). Empty: a blank badge." }
      ]
    });
    if (!result?.name) return;
    const clean = cleanCustom({ ...result, id: i >= 0 ? a.id : null });
    if (clean.img === blankBadge()) clean.img = ""; // kept empty: the blank badge is looked up when shown
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    await saveConfig(c => (c.custom = list));
  },
  "achieve-add"() {
    return actions["achieve-edit"].call(this);
  },
  "achieve-remove"({ id }) {
    const a = (achieveConfig().custom ?? []).find(x => x.id === id);
    if (!a) return;
    Dialog.confirm({
      title: "Achieve!", defaultYes: false,
      content: `<p>Remove <strong>${esc(a.name)}</strong>? Characters who earned it keep nothing.</p>`,
      yes: () => saveConfig(c => (c.custom = (c.custom ?? []).filter(x => x.id !== id)))
    });
  },
  "achieve-preview"() {
    previewCelebration(this.achOpen ?? undefined);
  },

  /* Mystery Boxes */
  "achieve-box-open"({ boxId }) {
    const actor = this._achActor();
    const box = boxesData(store.apps)[boxId];
    if (!actor || !box) return;
    Dialog.confirm({
      title: "Mystery Box",
      content: `<p>Open ${esc(boxName(box.table).toLowerCase())}? It takes an Action.</p>`,
      yes: () => store.request("achieve-box-open", { actorId: actor.id, boxId })
    });
  },
  /** GM: a box for the character on screen. */
  "achieve-box-give"() {
    const actor = this._achActor();
    if (actor) store.request("achieve-box-give", { actorId: actor.id });
  },
  "achieve-box-confirm"({ boxId }) {
    store.request("achieve-box-confirm", { boxId });
  },
  /** GM: give something else than the table says (an item from the compendiums, or a name). */
  async "achieve-box-change"({ boxId }) {
    const box = boxesData(store.apps)[boxId];
    if (!box) return;
    const options = await compendiumItems();
    const first = box.contents?.[0];
    const result = await fieldsDialog({
      title: "Give something else",
      label: "Give",
      fields: [
        { name: "uuid", label: "Item", type: "select", search: true, options: [{ value: "", label: "(Not in the compendiums: the name below)" }, ...options] },
        { name: "name", label: "Or a name", value: first?.name ?? "", hint: "A plain gear item by this name, for you to fill in." },
        { name: "qty", label: "How many", type: "number", value: first?.qty ?? 1 }
      ]
    });
    if (!result || (!result.uuid && !result.name)) return;
    store.request("achieve-box-confirm", { boxId, contents: [{ uuid: result.uuid || null, name: result.name, qty: result.qty }] });
  },
  "achieve-box-delete"({ boxId }) {
    Dialog.confirm({ title: "Mystery Box", content: "<p>Remove this box?</p>", defaultYes: false, yes: () => store.request("achieve-box-delete", { boxId }) });
  }
};

export const dropdowns = {
  /** GM: whose achievements. */
  achActor(value) {
    this.achActorId = value;
    this.achOpen = null;
    this.render();
  }
};

export const inputs = {
  ".agent-achieve-pop": {
    keydown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      actions["achieve-close"].call(this);
    }
  },
  "input[data-achieve-setting]": {
    change(event) {
      const el = event.currentTarget;
      return saveConfig(c => (c[el.dataset.achieveSetting] = el.checked));
    }
  }
};

export const methods = {
  /** Whose achievements this phone shows: the GM picks a player character; a player sees their own. */
  _achActor(ctx = this.context()) {
    if (ctx?.perspective !== "gm") return ctx?.subject?.actor ?? null;
    const pcs = playerCharacters();
    return pcs.find(a => a.id === this.achActorId) ?? pcs[0] ?? null;
  },

  _achBox(box, gm) {
    const owner = game.actors.get(box.actorId);
    const opener = game.actors.get(box.openedBy);
    const found = box.roll ? boxContents(box.table, box.roll) : null;
    return {
      ...box,
      name: boxName(box.table),
      ownerName: owner ? displayName(owner) : "?",
      statusLabel: BOX_STATUS[box.status] ?? box.status,
      opener: opener ? displayName(opener) : null,
      inside: box.given?.join(", ") || box.text || found?.text || null,
      note: found ? [found.bc ? "Black Chrome" : null, found.dlc ? `${found.dlc} DLC` : null, found.loaded ? "fully loaded (your pick of ammo)" : null].filter(Boolean).join(" · ") : "",
      sealed: box.status === "sealed",
      opening: box.status === "opening",
      gm
    };
  },

  achieveData(ctx) {
    const gm = ctx.perspective === "gm";
    const cfg = achieveConfig();
    const actor = this._achActor(ctx);
    const base = {
      gm,
      bar: appBar("achieve", { owner: gm ? null : ctx.subject.name }),
      actorPicker: gm && actor ? dropdown("achActor", playerCharacters().map(a => ({ value: a.id, label: displayName(a), selected: a.id === actor.id })), { title: "Character" }) : null
    };
    if (gm) base.chat = cfg.chat;
    if (!actor) return { ...base, noActor: true };

    // The GM sees everyone's boxes (who each is for on the row); a player, their character's.
    const boxes = Object.values(boxesData(store.apps)).filter(b => gm || b.actorId === actor.id).sort((a, b) => b.ts - a.ts);
    if (!(this.achTab in TABS)) this.achTab = "badges";
    const waiting = gm ? boxes.filter(b => b.status === "opening").length : boxes.filter(b => b.status === "sealed").length;
    base.tabs = Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.achTab, count: id === "boxes" ? waiting : 0 }));
    base.tab = { [this.achTab]: true };
    base.actorName = displayName(actor);
    if (this.achTab === "boxes") {
      const view = boxes.map(b => this._achBox(b, gm));
      if (!gm) return { ...base, boxes: view };
      return { ...base, opening: view.filter(b => b.opening), sealed: view.filter(b => b.sealed), opened: view.filter(b => b.status === "open").slice(0, 10) };
    }
    base.settings = gm;

    const all = earnedData(store.apps);
    const earned = earnedBy(actor.id, all);
    // The GM sees who else has each one.
    const others = id => (gm ? playerCharacters().filter(a => a.id !== actor.id && earnedBy(a.id, all)[id]).map(displayName).join(", ") : "");
    const list = achievementList(cfg).filter(a => gm || !a.disabled).map(a => {
      const e = earned[a.id] ?? null;
      const secret = !gm && a.hidden && !e;
      return {
        ...a,
        name: secret ? "???" : a.name,
        text: secret ? "A secret achievement." : a.text,
        img: secret ? blankBadge() : a.img,
        secret,
        earned: !!e,
        others: others(a.id),
        note: e?.note ?? "",
        date: e ? [e.date, e.time].filter(Boolean).join(" ") : "",
        spent: e?.spent ? TRADES[e.spent.kind]?.name ?? e.spent.kind : null,
        open: this.achOpen === a.id
      };
    });
    const shown = list.filter(a => !a.disabled);
    const open = list.find(a => a.open) ?? null;
    return {
      ...base,
      list,
      open,
      count: shown.filter(a => a.earned).length,
      total: shown.length,
      tokens: unspent(earned).filter(id => shown.some(a => a.id === id)).length
    };
  }
};

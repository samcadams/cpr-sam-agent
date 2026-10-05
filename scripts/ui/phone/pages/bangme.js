import { dropdown } from "./dropdown.js";
import { appBar } from "./home.js";
import { fieldsDialog } from "../../dialogs/forms.js";
import { MODULE_ID } from "../../../config.js";
import { bangTargets, itemsText, LEDGER_KINDS, ledgerOf, parseItems, payPoints } from "../../../model/bangme.js";
import { playerCharacters } from "../../../model/contacts.js";
import { currencyLabel, formatMoney, hasWallet } from "../../../model/money.js";
import { displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";

/*
 * Phone page: BangMe! (see model/bangme.js). Players see their balance, money held for them, their
 * ledger, Bang someone close by and pay at pay points. The GM sees any character's ledger, adjusts
 * balances, exports a ledger, and sets up pay points.
 * Methods, click actions (data-action) and dropdowns are installed onto AgentPhone.
 */

const FILTERS = { all: "All", message: "Transfers", bang: "Bangs", paypoint: "Pay points", trauma: "Trauma Team", adjust: "Adjustments" };

export const actions = {
  "bang-filter"({ filter }) {
    this.bangFilter = filter;
    this.render();
  },
  "bang-transfer"({ threadId, messageId }) {
    store.request("money-respond", { threadId, messageId, action: "transfer" });
  },
  async bang() {
    const ctx = this.context();
    const actor = ctx?.subject?.actor;
    if (!actor) return;
    const targets = bangTargets(actor);
    if (!targets.length) return ui.notifications.info("Nobody with BangMe! within 20 m.");
    const result = await fieldsDialog({
      title: "BangMe!",
      label: "Bang",
      fields: [
        { name: "target", label: "To", type: "select", options: targets.map(t => ({ value: t.actor.id, label: `${displayName(t.actor)} (${Math.round(t.distance)} m)` })) },
        { name: "amount", label: `Amount (${currencyLabel()})`, type: "number" },
        { name: "memo", label: "For", placeholder: "Optional" }
      ],
      note: `Balance: ${formatMoney(actor.system.wealth.value)}. They have to accept.`
    });
    if (result?.amount > 0) store.request("bang-offer", { actorId: actor.id, targetId: result.target, amount: result.amount, memo: result.memo });
  },
  async "paypoint-pay"({ pointId }) {
    const actor = this.context()?.subject?.actor;
    const point = payPoints().find(p => p.id === pointId);
    if (!actor || !point) return;
    const options = [...point.items.map((i, n) => ({ value: String(n), label: `${i.label}: ${formatMoney(i.amount)}` })), { value: "", label: "Another amount…" }];
    const result = await fieldsDialog({
      title: point.name,
      label: "Pay",
      fields: [
        { name: "item", label: "Pay for", type: "select", options },
        { name: "amount", label: `Amount (${currencyLabel()})`, type: "number", hint: "Only for \"Another amount\"." }
      ]
    });
    if (!result) return;
    const item = result.item === "" ? null : Number(result.item);
    store.request("paypoint-pay", { actorId: actor.id, pointId, item, amount: result.amount });
  },
  /** GM: put money on a sheet or take it off. */
  async "ledger-adjust"() {
    const actor = game.actors.get(this.bangActor);
    if (!actor) return;
    const result = await fieldsDialog({
      title: `Adjust ${displayName(actor)}`,
      label: "Apply",
      fields: [
        { name: "amount", label: `Amount (${currencyLabel()})`, type: "number", hint: "Negative takes money away." },
        { name: "memo", label: "Memo", value: "Eurobank reversal" }
      ]
    });
    if (result?.amount) store.request("ledger-adjust", { actorId: actor.id, amount: result.amount, memo: result.memo });
  },
  /** GM: a character's ledger as a CSV file. */
  "ledger-export"() {
    const actor = game.actors.get(this.bangActor);
    if (!actor) return;
    const { rows } = ledgerOf(actor.id, [...store.threads.values()], store.apps.ledger);
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Date,Time,With,Kind,Memo,Amount", ...rows.map(r => [r.date, r.time, r.party, LEDGER_KINDS[r.kind] ?? r.kind, r.memo, r.amount].map(q).join(","))].join("\n");
    saveDataToFile(csv, "text/csv", `${displayName(actor)}-ledger.csv`);
  },
  async "paypoint-edit"({ pointId }) {
    const points = payPoints();
    const point = points.find(p => p.id === pointId) ?? { id: foundry.utils.randomID(), name: "", img: "", open: true, items: [] };
    const result = await fieldsDialog({
      title: pointId ? `Pay point: ${point.name}` : "New pay point",
      fields: [
        { name: "name", label: "Name", value: point.name, placeholder: "Lizzie's Bar" },
        { name: "img", label: "Picture", type: "image", value: point.img },
        { name: "items", label: "Prices", type: "textarea", value: itemsText(point.items), placeholder: "Beer = 10\nSynth-whiskey = 20", hint: "One per line: what = price." }
      ]
    });
    if (!result?.name) return;
    Object.assign(point, { name: result.name.slice(0, 60), img: result.img, items: parseItems(result.items) });
    await game.settings.set(MODULE_ID, "payPoints", [...points.filter(p => p.id !== point.id), point]);
    this.render();
  },
  async "paypoint-toggle"({ pointId }) {
    const points = payPoints();
    const point = points.find(p => p.id === pointId);
    if (!point) return;
    point.open = !point.open;
    await game.settings.set(MODULE_ID, "payPoints", points);
    this.render();
  },
  async "paypoint-delete"({ pointId }) {
    await game.settings.set(MODULE_ID, "payPoints", payPoints().filter(p => p.id !== pointId));
    this.render();
  }
};

export const dropdowns = {
  bangActor(value) {
    this.bangActor = value;
    this.render();
  }
};

export const methods = {
  bangmeData(ctx) {
    const gm = ctx.perspective === "gm";
    const pcs = playerCharacters().filter(hasWallet);
    if (gm && !pcs.some(a => a.id === this.bangActor)) this.bangActor = pcs[0]?.id ?? null;
    const actor = gm ? game.actors.get(this.bangActor) : ctx.subject.actor;
    const filter = this.bangFilter in FILTERS ? this.bangFilter : "all";
    const { rows, held } = actor ? ledgerOf(actor.id, [...store.threads.values()], store.apps.ledger) : { rows: [], held: [] };
    const points = payPoints();
    return {
      gm,
      bar: appBar("bangme", { owner: gm ? null : ctx.subject.name }),
      picker: gm ? dropdown("bangActor", pcs.map(a => ({ value: a.id, label: displayName(a), selected: a.id === this.bangActor })), { title: "Whose ledger", cls: "agent-wide" }) : null,
      wallet: hasWallet(actor),
      balance: hasWallet(actor) ? formatMoney(actor.system.wealth.value) : null,
      held: held.map(h => ({ ...h, amountLabel: formatMoney(h.amount) })),
      filters: Object.entries(FILTERS).map(([id, label]) => ({ id, label, active: id === filter })),
      rows: rows.filter(r => filter === "all" || r.kind === filter).slice(0, 60).map(r => ({
        ...r, kindLabel: LEDGER_KINDS[r.kind] ?? r.kind, amountLabel: `${r.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(r.amount))}`, credit: r.amount > 0
      })),
      points: points.filter(p => gm || p.open).map(p => ({ ...p, prices: p.items.map(i => `${i.label} ${formatMoney(i.amount)}`).join(" · ") }))
    };
  }
};

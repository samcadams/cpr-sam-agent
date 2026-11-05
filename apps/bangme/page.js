import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { APP_LEDGER } from "../../scripts/apps/manifest.js";
import { MODULE_ID } from "../../scripts/config.js";
import {
  ANCHOR_LABELS, anchorKey, anchorName, anchorOptions, BANG_RANGE_M, bangTargets, canReachPayPoint, cleanGoods, goodsOf, INVOICE_STATUS, invoiceActions, invoicesOf,
  itemsText, LEDGER_KINDS, ledgerOf, parseAnchorKey, parseItems, payPoints, priceList
} from "./model.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { agentType } from "../../scripts/model/agent.js";
import { currencyLabel, formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";

/*
 * Phone page: BangMe! (see apps/bangme/model.js). Players see their balance, money held for them, their
 * ledger, Bang someone close by, pay at pay points and send and answer invoices. The GM sees any character's
 * ledger, adjusts balances, exports a ledger, sets up pay points, and sends and answers invoices.
 * Methods, click actions (data-action) and dropdowns are installed onto AgentPhone.
 */

const FILTERS = { all: "All", message: "Transfers", bang: "Bangs", paypoint: "Pay points", invoice: "Invoices", ...APP_LEDGER, adjust: "Adjustments" };

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
  /** Bill someone: a player as their character, the GM under any name. */
  async "invoice-new"() {
    const ctx = this.context();
    const gm = ctx?.perspective === "gm";
    const actor = gm ? null : ctx?.subject?.actor;
    if (!gm && !actor) return;
    const people = playerCharacters().filter(a => a.id !== actor?.id && hasWallet(a) && agentType(a)).map(a => ({ value: a.id, label: displayName(a) }));
    const options = gm ? people : [...people, { value: "gm", label: "GM" }];
    if (!options.length) return ui.notifications.info("Nobody with an Agent to invoice.");
    const result = await fieldsDialog({
      title: "New invoice",
      label: "Send",
      fields: [
        ...(gm ? [{ name: "fromName", label: "From", placeholder: "Who's billing them" }] : []),
        { name: "target", label: "To", type: "select", options },
        { name: "amount", label: `Amount (${currencyLabel()})`, type: "number" },
        { name: "memo", label: "For", placeholder: "Optional" }
      ],
      note: "Nothing moves until they pay."
    });
    if (result?.amount > 0) store.request("invoice-send", { actorId: actor?.id, targetId: result.target, fromName: result.fromName, amount: result.amount, memo: result.memo });
  },
  "invoice-answer"({ invoiceId, answer }) {
    store.request("invoice-respond", { invoiceId, action: answer });
  },
  async "paypoint-pay"({ pointId }) {
    const actor = this.context()?.subject?.actor;
    const point = payPoints().find(p => p.id === pointId);
    if (!actor || !point) return;
    const options = [
      ...point.items.map((i, n) => ({ value: `i${n}`, label: `${i.label}: ${formatMoney(i.amount)}` })),
      ...goodsOf(point).map((g, n) => ({ value: `g${n}`, label: `${g.name}: ${formatMoney(g.amount)}` })),
      { value: "", label: "Another amount…" }
    ];
    const result = await fieldsDialog({
      title: point.name,
      label: "Pay",
      fields: [
        { name: "pick", label: "Pay for", type: "select", options },
        { name: "amount", label: `Amount (${currencyLabel()})`, type: "number", showIf: { field: "pick", value: "" } }
      ],
      note: `Balance: ${formatMoney(actor.system.wealth.value)}.`
    });
    if (!result) return;
    const [kind, n] = [result.pick[0], Number(result.pick.slice(1))];
    const label = kind === "i" ? point.items[n]?.label : kind === "g" ? goodsOf(point)[n]?.name : null;
    if (!result.pick && !(Math.floor(result.amount) > 0)) return ui.notifications.warn("Enter an amount to pay.");
    store.request("paypoint-pay", { actorId: actor.id, pointId, item: kind === "i" ? n : null, good: kind === "g" ? n : null, amount: result.amount, label });
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
    // Anchors on the scene the GM is looking at, and the current one wherever it is.
    const anchors = anchorOptions(canvas.scene);
    const current = anchorKey(point.anchor);
    if (current && !anchors.some(o => o.value === current)) {
      const scene = game.scenes.get(point.anchor.sceneId);
      const name = anchorName(point.anchor);
      anchors.unshift({ value: current, label: name ? `${ANCHOR_LABELS[point.anchor.kind]}: ${name} (${scene?.navName || scene?.name})` : "(deleted: pick another)" });
    }
    const result = await fieldsDialog({
      title: pointId ? `Pay point: ${point.name}` : "New pay point",
      fields: [
        { name: "name", label: "Name", value: point.name, placeholder: "Lizzie's Bar" },
        { name: "img", label: "Picture", type: "image", value: point.img },
        { name: "items", label: "Prices", type: "textarea", value: itemsText(point.items), placeholder: "Beer = 10\nSynth-whiskey = 20", hint: "One per line: what = price." },
        {
          name: "goods", label: "Goods", type: "drops", value: goodsOf(point), placeholder: "Drop Items here",
          amount: item => Number(item.system?.price?.market) || 0,
          hint: "Items players can buy: each purchase puts a copy in their gear. Drag them in from the Items directory or a compendium."
        },
        {
          name: "anchor", label: "Pay only near", type: "select", search: anchors.length > 8, value: current,
          options: [{ value: "", label: "Anywhere" }, ...anchors],
          hint: "Players see it only near this (inside, for a Region)."
        },
        { name: "range", label: "Range (m)", type: "number", value: point.range ?? BANG_RANGE_M, hint: "For a token or map pin." }
      ]
    });
    if (!result?.name) return;
    const anchor = parseAnchorKey(result.anchor);
    const goods = cleanGoods(result.goods);
    if (goods.length < result.goods.length) ui.notifications.warn("Goods without a price were left out.");
    Object.assign(point, { name: result.name.slice(0, 60), img: result.img, items: parseItems(result.items), goods, anchor, range: result.range > 0 ? result.range : BANG_RANGE_M });
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
    const me = gm ? null : ctx.subject.actor?.id;
    return {
      gm,
      invoices: invoicesOf(me, store.apps.invoices).map(i => ({
        ...i, ...invoiceActions(i, me),
        amountLabel: formatMoney(i.amount), statusLabel: INVOICE_STATUS[i.status],
        party: i.fromActor === me ? `To ${i.toName}` : i.toActor === me ? `From ${i.fromName}` : `${i.fromName} → ${i.toName}`
      })),
      bar: appBar("bangme", { owner: gm ? null : ctx.subject.name }),
      picker: gm ? dropdown("bangActor", pcs.map(a => ({ value: a.id, label: displayName(a), selected: a.id === this.bangActor })), { title: "Whose ledger", cls: "agent-wide" }) : null,
      wallet: hasWallet(actor),
      balance: hasWallet(actor) ? formatMoney(actor.system.wealth.value) : null,
      held: held.map(h => ({ ...h, amountLabel: formatMoney(h.amount) })),
      filters: Object.entries(FILTERS).map(([id, label]) => ({ id, label, active: id === filter })),
      rows: rows.filter(r => filter === "all" || r.kind === filter).slice(0, 60).map(r => ({
        ...r, kindLabel: LEDGER_KINDS[r.kind] ?? r.kind, amountLabel: `${r.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(r.amount))}`, credit: r.amount > 0
      })),
      points: points.filter(p => gm || (p.open && canReachPayPoint(p, actor))).map(p => ({
        ...p,
        prices: priceList(p, formatMoney),
        where: gm && p.anchor ? (anchorName(p.anchor) ? `Near ${anchorName(p.anchor)}${p.anchor.kind === "region" ? "" : ` (${p.range ?? BANG_RANGE_M} m)`}` : "Anchor deleted: only the GM sees it") : null
      }))
    };
  }
};

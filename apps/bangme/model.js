import { APP_LEDGER } from "../../scripts/apps/manifest.js";
import { MODULE_ID } from "../../scripts/config.js";
import { isHeld, moneyCard } from "../../scripts/model/money.js";
import { isDirect, isService } from "../../scripts/model/threads.js";

/*
 * BangMe! (Eurobank, 10eb; All About Agents p. 7): "Allows money transfers, either to a business's
 * BangMe!-equipped pay point or between two Agents with the app installed." It's the home of the
 * money that already moves in conversations, plus:
 *  - a Bang: paying someone close by (AltLink reaches 20 m), who has to accept;
 *  - pay points: merchants the GM sets up (world setting "payPoints");
 *  - invoices: a bill sent to anyone, anywhere, between characters and the GM (apps.invoices, below);
 *  - ledger entries for everything that isn't a message (apps.ledger, see model/apps.js).
 */

/** AltLink range (All About Agents p. 4). */
export const BANG_RANGE_M = 20;

/**
 * Pay points: [{ id, name, img, open, items: [{ label, amount }], goods?: [{ uuid, name, img, amount }], anchor?, range? }].
 * items: prices only. goods: Items the GM dropped in (templates); buying one puts a copy in the character's gear.
 * anchor: { kind: "token"|"note"|"region", sceneId, id }: only characters near it can pay (within
 * `range` metres of a token or map pin, default BANG_RANGE_M; inside a Region). No anchor: anywhere.
 */
export function payPoints() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "payPoints") ?? []);
}

const ANCHOR_COLLECTIONS = { token: "tokens", note: "notes", region: "regions" };
export const ANCHOR_LABELS = { token: "Token", note: "Map pin", region: "Region" };

/** "token|sceneId|id" ↔ anchor (the value of the edit dialog's select). */
export const anchorKey = anchor => (anchor ? `${anchor.kind}|${anchor.sceneId}|${anchor.id}` : "");
export function parseAnchorKey(key) {
  const [kind, sceneId, id] = String(key ?? "").split("|");
  return kind in ANCHOR_COLLECTIONS && sceneId && id ? { kind, sceneId, id } : null;
}

/** The document a pay point is anchored to, or null (no anchor, or it's been deleted). */
export function anchorDocument(anchor) {
  if (!anchor) return null;
  return game.scenes.get(anchor.sceneId)?.[ANCHOR_COLLECTIONS[anchor.kind]]?.get(anchor.id) ?? null;
}

/** A name for the anchor: its token, pin or Region name. */
export function anchorName(anchor) {
  const doc = anchorDocument(anchor);
  if (!doc) return null;
  return (anchor.kind === "note" ? doc.text || doc.entry?.name : doc.name) || ANCHOR_LABELS[anchor.kind];
}

const tokenCenter = (t, scene) => ({ x: t.x + ((t.width ?? 1) * scene.grid.size) / 2, y: t.y + ((t.height ?? 1) * scene.grid.size) / 2 });

/** Is a point inside a Region? Works on scenes that aren't on the canvas too. */
function inRegion(region, point) {
  const object = region.object ?? new CONFIG.Region.objectClass(region);
  try {
    return object.polygonTree.testPoint(point);
  } finally {
    if (!region.object) object.destroy({ children: true });
  }
}

/**
 * Can a character pay at this pay point from where their tokens stand? Always, without an anchor.
 * With one: a token of theirs on the anchor's scene within range of it (inside it, for a Region).
 * An anchor that's been deleted can't be reached.
 */
export function canReachPayPoint(point, actor) {
  if (!point.anchor) return true;
  const doc = anchorDocument(point.anchor);
  const scene = game.scenes.get(point.anchor.sceneId);
  if (!doc || !actor) return false;
  const mine = scene.tokens.filter(t => t.actorId === actor.id);
  if (point.anchor.kind === "region") return mine.some(t => inRegion(doc, tokenCenter(t, scene)));
  const range = point.range > 0 ? point.range : BANG_RANGE_M;
  const there = point.anchor.kind === "note" ? { x: doc.x, y: doc.y } : tokenCenter(doc, scene);
  const units = Number(scene.grid.distance) || 1;
  return mine.some(t => {
    const here = tokenCenter(t, scene);
    return (Math.hypot(here.x - there.x, here.y - there.y) / scene.grid.size) * units <= range;
  });
}

/**
 * Anchors the GM can pick on a scene: its tokens (not the player characters'), map pins and Regions.
 * @returns {Array<{value: string, label: string}>}
 */
export function anchorOptions(scene) {
  if (!scene) return [];
  const pcs = new Set(game.actors.filter(a => a.hasPlayerOwner).map(a => a.id));
  const options = [];
  for (const t of scene.tokens) if (!pcs.has(t.actorId)) options.push({ kind: "token", id: t.id, name: t.name });
  for (const n of scene.notes) options.push({ kind: "note", id: n.id, name: n.text || n.entry?.name || "" });
  for (const r of scene.regions) options.push({ kind: "region", id: r.id, name: r.name });
  return options
    .filter(o => o.name)
    .map(o => ({ value: anchorKey({ kind: o.kind, sceneId: scene.id, id: o.id }), label: `${ANCHOR_LABELS[o.kind]}: ${o.name}` }));
}

/** "Drink = 20" lines → items, and back. */
export function parseItems(text) {
  return String(text ?? "").split("\n").map(line => {
    const m = line.match(/^(.*?)[=:]\s*(\d+)\s*$/);
    return m ? { label: m[1].trim().slice(0, 60), amount: Number(m[2]) } : null;
  }).filter(i => i?.label && i.amount > 0).slice(0, 30);
}
export const itemsText = items => (items ?? []).map(i => `${i.label} = ${i.amount}`).join("\n");

/** A pay point's goods (pay points saved before goods existed have none). */
export const goodsOf = point => point?.goods ?? [];

/** Everything a pay point sells, "Beer 10eb · Medscanner 100eb". */
export const priceList = (point, format) => [...point.items.map(i => `${i.label} ${format(i.amount)}`), ...goodsOf(point).map(g => `${g.name} ${format(g.amount)}`)].join(" · ");

/** Dropped goods → what's saved: priced ones only, at most 30. */
export const cleanGoods = goods => (goods ?? []).filter(g => g?.uuid && g.amount > 0).slice(0, 30)
  .map(g => ({ uuid: g.uuid, name: String(g.name ?? "").slice(0, 60), img: g.img ?? "", amount: Math.floor(g.amount) }));

/** The data for a bought copy of a goods template: a new item, no folder or sort, from `pointName`. */
export function boughtItemData(source, pointName) {
  const data = source.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.boughtAt`, pointName);
  return data;
}

/** Distance between two tokens on a scene, in the scene's units. */
export function tokenDistance(a, b, scene) {
  const [p, q] = [tokenCenter(a, scene), tokenCenter(b, scene)];
  return (Math.hypot(p.x - q.x, p.y - q.y) / scene.grid.size) * (Number(scene.grid.distance) || 1);
}

/**
 * Who a character can Bang: characters with a wallet whose tokens are within 20 m of theirs on the
 * same scene. Returns [{ actor, distance }].
 */
export function bangTargets(actor, scenes = game.scenes) {
  const found = new Map();
  for (const scene of scenes) {
    const mine = scene.tokens.filter(t => t.actorId === actor.id);
    if (!mine.length) continue;
    for (const token of scene.tokens) {
      const other = token.actor ?? game.actors.get(token.actorId);
      if (!other || other.id === actor.id || !foundry.utils.hasProperty(other.system ?? {}, "wealth.value")) continue;
      const distance = Math.min(...mine.map(m => tokenDistance(m, token, scene)));
      if (distance <= BANG_RANGE_M && !(found.get(other.id)?.distance <= distance)) found.set(other.id, { actor: other, distance });
    }
  }
  return [...found.values()].sort((a, b) => a.distance - b.distance);
}

/**
 * A character's ledger: money in their conversations (sent, received, requests paid), and the
 * entries kept by BangMe (Bangs, pay points, Trauma Team, GM adjustments). Newest first.
 * Also the funds held for them, waiting for Transfer.
 */
export function ledgerOf(actorId, threads, entries) {
  const rows = [];
  const held = [];
  for (const thread of threads) {
    if (thread.actorId !== actorId || !(isDirect(thread) || isService(thread))) continue;
    const other = isService(thread) ? thread.name : thread.contact;
    for (const m of thread.messages) {
      const money = m.money;
      if (!money) continue;
      const mine = m.from === "pc";
      const card = moneyCard(m, mine, true);
      const out = money.kind === "send" ? mine : !mine; // this character pays
      const settled = money.kind === "send" || ["paid", "transferred"].includes(money.status);
      if (!settled || money.status === "cancelled") continue;
      rows.push({
        id: m.id, ts: m.ts, time: m.time, date: m.date, party: other, kind: "message",
        amount: out ? -money.amount : money.amount, memo: m.text || card.label, status: card.statusLabel
      });
      if (card.canTransfer && isHeld(money)) held.push({ threadId: thread.id, messageId: m.id, party: other, amount: money.amount, memo: m.text });
    }
  }
  for (const e of Object.values(entries ?? {})) if (e.actorId === actorId) rows.push({ ...e, status: "" });
  rows.sort((a, b) => b.ts - a.ts);
  return { rows, held };
}

/** Each kind of ledger row, by name. Apps that charge add theirs (apps/manifest.js `ledger`). */
export const LEDGER_KINDS = { message: "Transfer", bang: "Bang", paypoint: "Pay point", invoice: "Invoice", ...APP_LEDGER, adjust: "Adjustment" };

/**
 * Invoices: { [id]: { id, actorIds, fromActor, fromName, toActor, toName, amount, memo, status, ts, time, date } }.
 * fromActor/toActor: a character, or null for the GM (who bills under any name). actorIds: the characters
 * on it, who see it (model/apps.js "listed"). status: "pending" → "paid" | "declined" | "cancelled".
 * Nothing moves until the payer pays; then the money goes straight across (no Transfer step, like a Bang).
 */
export const INVOICE_STATUS = { pending: "Unpaid", paid: "Paid", declined: "Declined", cancelled: "Cancelled" };

/** Settled invoices kept on the page; the ledger has the paid ones for good. */
const RECENT_INVOICES = 5;

/** Who sees which invoices: a character's (`actorId`), or every one for the GM (null). Unpaid first, then the latest settled. */
export function invoicesOf(actorId, invoices) {
  const mine = Object.values(invoices ?? {}).filter(i => actorId === null || i.actorIds.includes(actorId)).sort((a, b) => b.ts - a.ts);
  return [...mine.filter(i => i.status === "pending"), ...mine.filter(i => i.status !== "pending").slice(0, RECENT_INVOICES)];
}

/** May `actorId` (null: the GM) pay or decline this one, or cancel it? */
export const invoiceActions = (invoice, actorId) => ({
  canPay: invoice.status === "pending" && invoice.toActor === actorId,
  canCancel: invoice.status === "pending" && invoice.fromActor === actorId
});

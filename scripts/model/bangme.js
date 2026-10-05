import { MODULE_ID } from "../config.js";
import { isHeld, moneyCard } from "./money.js";
import { isDirect, isService } from "./threads.js";

/*
 * BangMe! (Eurobank, 10eb; All About Agents p. 7): "Allows money transfers, either to a business's
 * BangMe!-equipped pay point or between two Agents with the app installed." It's the home of the
 * money that already moves in conversations, plus:
 *  - a Bang: paying someone close by (AltLink reaches 20 m), who has to accept;
 *  - pay points: merchants the GM sets up (world setting "payPoints");
 *  - ledger entries for everything that isn't a message (apps.ledger, see model/apps.js).
 */

/** AltLink range (All About Agents p. 4). */
export const BANG_RANGE_M = 20;

/** Pay points: [{ id, name, img, open, items: [{ label, amount }] }]. */
export function payPoints() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "payPoints") ?? []);
}

/** "Drink = 20" lines → items, and back. */
export function parseItems(text) {
  return String(text ?? "").split("\n").map(line => {
    const m = line.match(/^(.*?)[=:]\s*(\d+)\s*$/);
    return m ? { label: m[1].trim().slice(0, 60), amount: Number(m[2]) } : null;
  }).filter(i => i?.label && i.amount > 0).slice(0, 30);
}
export const itemsText = items => (items ?? []).map(i => `${i.label} = ${i.amount}`).join("\n");

/** Distance between two tokens on a scene, in the scene's units. */
export function tokenDistance(a, b, scene) {
  const size = scene.grid.size;
  const center = t => ({ x: t.x + ((t.width ?? 1) * size) / 2, y: t.y + ((t.height ?? 1) * size) / 2 });
  const [p, q] = [center(a), center(b)];
  return (Math.hypot(p.x - q.x, p.y - q.y) / size) * (Number(scene.grid.distance) || 1);
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

export const LEDGER_KINDS = { message: "Transfer", bang: "Bang", paypoint: "Pay point", trauma: "Trauma Team", adjust: "Adjustment" };

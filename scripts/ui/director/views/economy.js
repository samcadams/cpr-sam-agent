import { approveOrder, denyOrder } from "../../../../apps/market/commands.js";
import { playerCharacters } from "../../../model/contacts.js";
import { formatMoney, hasWallet } from "../../../model/money.js";
import { displayName } from "../../../model/threads.js";
import { store } from "../../../store.js";
import { esc } from "../../../util/text.js";
import { avatar, phoneBtn } from "./comms.js";
import { label, listOf, row, select } from "./garden.js";
import { actions as railActions, pageHead, railed } from "./railed.js";

/*
 * Director → Economy: the money apps, wide. A rail of the apps (Great River, CBK, BangMe!, Trauma
 * Team; railed.js), each drawn from the GM Phone's own page data on director.logic and
 * run through its actions (phone:*), dropdowns (pick:*) and inputs (input:*).
 *
 * Great River (apps/market/page.js marketData, GM side): Orders (the queue as cards with every line's
 * price, a note, Approve/Deny; drones in the air beside it), Shop (what players see, hide or make
 * unavailable, new picks), History and Setup. Approve and Deny read this view's own fields, so they're
 * done here through the shared commands (apps/market/commands.js); typed prices and notes are drafts,
 * so a refresh keeps them.
 *
 * CBK (apps/cbk/page.js cbkData, GM side): Markets (go live, broadcasts with their composer, the last
 * five sent), Listings (the market's fields, a table of booth/price/stock, adding items or apps beside
 * it) and Receipts (to pick up beside done). Every field is the GM Phone's own input handler (input:*).
 *
 * BangMe! (apps/bangme/page.js bangmeData, GM side): every character's balance (a Director-only list;
 * picking one is the GM Phone's "whose ledger"), that ledger with its filters, Adjust and Export, and
 * the pay points.
 *
 * Trauma Team (apps/trauma/page.js traumaData, GM side): Coverage (calls with Dispatch in minutes or
 * rounds, Arrived, Close; characters' plans; plans and rules) and MedScan (consults, who has it,
 * prices and rules). Dispatch reads this view's ETA field, so it's sent here.
 */

const APPS = [["market", "Great River", "fa-water"], ["cbk", "CBK", "fa-store"], ["bangme", "BangMe!", "fa-burst"], ["trauma", "Trauma Team", "fa-truck-medical"]];

/* ---------------- Great River ---------------- */

/** Great River's GM data, with the Director's search typed in. */
function marketData(director) {
  const logic = director.logic;
  const search = director.drafts["gr-search"] ?? "";
  if (search !== (logic.marketSearch ?? "")) {
    logic.marketSearch = search;
    logic.marketLimit = null; // back to the first page
  }
  return logic.marketData(logic.ctx());
}

function storeTerms(s) {
  return [
    s.drone ? `<span class="director-tag"><i class="fas fa-helicopter"></i> Drone drop-off ≤ ${esc(String(s.eta))} min</span>` : `<span class="director-tag"><i class="fas fa-bolt"></i> Instant delivery</span>`,
    s.capped ? `<span class="director-tag"><i class="fas fa-tag"></i> Everyday goods to ${esc(s.cap ?? "")}</span>` : s.fee ? `<span class="director-tag"><i class="fas fa-box"></i> Delivery ${esc(s.fee)}</span>` : ""
  ].join("");
}

/** One order: Approve/Deny with prices and a note while it waits, Deliver now while it flies, else Remove. */
function orderHtml(director, o) {
  const draft = key => director.drafts[key];
  const lines = o.lines.map(l => `<li>
      <button type="button" class="director-plain" data-director="phone:market-open" data-uuid="${esc(l.uuid)}">${l.qty}× ${esc(l.name)}${l.off ? ` <span class="director-tag">−${l.off}%</span>` : ""}</button>
      ${o.pending
        ? `<input type="number" name="price" data-index="${l.index}" min="0" step="1" placeholder="price" class="${l.unpriced ? "unpriced" : ""}" data-draft="gr-price:${esc(o.id)}:${l.index}" value="${esc(String(draft(`gr-price:${o.id}:${l.index}`) ?? l.price ?? ""))}" aria-label="Price of one ${esc(l.name)}">`
        : `<span>${esc(l.priceLabel)}</span>`}</li>`).join("");
  const drone = o.drone ? `<div class="director-drone"><i class="fas fa-helicopter" aria-hidden="true"></i>
      <span class="director-drone-track" role="progressbar" aria-label="Drone on its way"><span style="animation-duration: ${o.drone.ms}ms; animation-delay: -${o.drone.elapsed}ms"></span></span>
      <small>~${o.drone.left} min</small></div>` : "";
  let tools;
  if (o.pending) {
    tools = `<input type="text" name="note" data-draft="gr-note:${esc(o.id)}" value="${esc(draft(`gr-note:${o.id}`) ?? "")}" placeholder="A note to the player (optional)" aria-label="A note to the player">
      <div class="director-toolbar">
        <button type="button" data-director="gr-deny" data-order-id="${esc(o.id)}"><i class="fas fa-xmark" aria-hidden="true"></i> Deny</button>
        <button type="button" class="primary" data-director="gr-approve" data-order-id="${esc(o.id)}"><i class="fas fa-check" aria-hidden="true"></i> Approve</button>
      </div>`;
  } else if (o.drone) tools = `<div class="director-toolbar">${phoneBtn("market-deliver", "Deliver now", { data: { orderId: o.id }, icon: "fa-box-open" })}</div>`;
  else tools = "";
  return `<article class="director-order ${esc(o.status)}" data-order="${esc(o.id)}">
    <header><span class="director-tag ${o.pending ? "warn" : ""}">${esc(o.statusLabel)}</span> <strong>${esc(o.actorName)}</strong>
      <span class="director-time">${esc(o.date ?? "")} ${esc(o.time ?? "")}</span><b class="director-order-total">${esc(o.totalLabel)}</b>
      ${!o.pending && !o.drone ? phoneBtn("market-remove", "", { data: { orderId: o.id }, icon: "fa-trash", cls: "danger", title: "Remove from the list" }) : ""}</header>
    ${o.pending ? `<small class="director-sub ${o.short ? "director-problem" : ""}">${o.short ? `<i class="fas fa-triangle-exclamation"></i> ` : ""}Balance ${esc(o.balance)}${o.userName ? ` · sent by ${esc(o.userName)}` : ""}</small>` : ""}
    <ol class="director-order-lines">${lines}</ol>
    ${o.feeLabel ? `<small class="director-sub"><i class="fas fa-helicopter"></i> Delivery ${esc(o.feeLabel)}</small>` : ""}
    ${drone}
    ${o.note ? `<p class="director-writer-note"><i class="fas fa-comment"></i> ${esc(o.note)}</p>` : ""}
    ${o.gmNote ? `<p class="director-writer-note mine"><i class="fas fa-store"></i> ${esc(o.gmNote)}</p>` : ""}
    ${tools}
  </article>`;
}

function queueHtml(director, m) {
  return `<div class="director-columns">
    <div>${label(`Waiting (${m.queue.length})`)}${m.queue.map(o => orderHtml(director, o)).join("") || `<p class="director-empty">No orders waiting.</p>`}
      <p class="director-note">Approve charges the character at the prices shown (type over one to change it; a line on request needs one) and the note goes to the player.</p></div>
    <div>${label("Drones in the air")}${m.shipping.map(o => orderHtml(director, o)).join("") || `<p class="director-empty">Nothing on its way.</p>`}</div>
  </div>`;
}

function shopHtml(director, m) {
  const tools = `<div class="director-pickers">
      <input type="search" data-draft="gr-search" data-live value="${esc(director.drafts["gr-search"] ?? "")}" placeholder="Search" aria-label="Search Great River" autocomplete="off">
      ${select(m.typePick, "Item type")}${select(m.sortPick, "Sort")}${select(m.showPick, "Show")}</div>`;
  if (m.loading) return `${tools}<p class="director-empty"><i class="fas fa-spinner fa-spin"></i> Loading the catalogue…</p>`;
  const picks = [...(m.featured ?? []).map(e => ({ ...e, pick: "Featured" })), ...(m.deal ? [{ ...m.deal, pick: `Hot Deal ${m.deal.at}/${m.deal.count}` }] : [])];
  const rows = m.rows.map(e => row({
    cls: e.disabled ? "faded" : "",
    lead: `<img class="director-avatar" src="${esc(e.img)}" alt="" data-director="phone:market-open" data-uuid="${esc(e.uuid)}">`,
    main: `<strong>${esc(e.name)}</strong>`,
    small: `${e.featured ? `<i class="fas fa-star" title="Featured today"></i> ` : ""}${e.off ? `−${e.off}% · ` : ""}${esc(e.typeLabel)}${e.tier ? ` · <i>${esc(e.tier)}</i>` : ""} · ${esc(e.sourceLabel)}`,
    tools: `<span class="director-price">${e.blockLabel ? esc(e.blockLabel) : `${e.wasLabel ? `<s>${esc(e.wasLabel)}</s> ` : ""}${esc(e.priceLabel)}`}</span>`
      + phoneBtn("market-block", "", { data: { uuid: e.uuid, how: "hide" }, icon: "fa-eye-slash", cls: e.hidden ? "on" : "", title: e.hidden ? `Show ${e.name} again` : `Hide ${e.name} from players` })
      + phoneBtn("market-block", "", { data: { uuid: e.uuid, how: "off" }, icon: "fa-ban", cls: e.unavailable ? "on" : "", title: e.unavailable ? `Put ${e.name} back on sale` : `Make ${e.name} unavailable` })
  }));
  return `${tools}
    <div class="director-toolbar">${phoneBtn("market-reroll", "New picks for today", { icon: "fa-dice" })}
      ${m.blockedCount ? phoneBtn("market-unblock-all", `All ${m.blockedCount} back on sale`, { icon: "fa-rotate-left" }) : ""}
      <span class="director-sub">What players see today (${esc(m.day ?? "")}). <i class="fas fa-eye-slash"></i> hides an item, <i class="fas fa-ban"></i> lists it as unavailable; again puts it back.</span></div>
    ${picks.length ? `${label("Today's picks")}<div class="director-picks">${picks.map(e => `<span class="director-chip" title="${esc(e.pick)}"><i class="fas ${e.off ? "fa-fire" : "fa-star"}"></i> ${esc(e.name)} <b>${esc(e.priceLabel)}</b></span>`).join("")}</div>` : ""}
    ${label(`${m.found} item${m.found === 1 ? "" : "s"}`)}${listOf(rows, "Nothing matches.")}
    ${m.more ? `<div class="director-toolbar">${phoneBtn("market-more", "Show more")}</div>` : ""}`;
}

function historyHtml(director, m) {
  return m.history.map(o => orderHtml(director, o)).join("") || `<p class="director-empty">No orders yet.</p>`;
}

/** A Setup number or switch: the GM Phone's own input handler saves it. */
const setting = (key, text, s, attrs = "") => `<label class="director-setting"><span>${text}</span><input type="number" data-market-setting="${key}" data-director="input:input[data-market-setting]" value="${esc(String(s[key] ?? ""))}" ${attrs}></label>`;
const check = (key, text, s) => `<label class="director-check-row"><input type="checkbox" data-market-setting="${key}" data-director="input:input[data-market-setting]" ${s[key] ? "checked" : ""}> ${text}</label>`;

function setupHtml(s) {
  return `<div class="director-columns">
    <div>${label("Store")}
      <label class="director-setting"><span>Pricing</span>${select(s.pricingPick, "Pricing")}</label>
      ${s.feeMode
        ? `${setting("deliveryFee", "Delivery fee per order (eb)", s, `min="0" step="1"`)}${setting("deliveryPct", "Plus % of the items", s, `min="0" max="100" step="1"`)}
          <p class="director-note">No price cap: anything in the catalogue is on sale (within your own limits), and every order pays the delivery fee.</p>`
        : `<p class="director-note">Black Chrome p. 156: stores only carry things of ${esc(String(s.cap))}eb (Premium) or less; bigger-ticket gear goes through Fixers and Night Markets (CBK). Delivery is included.</p>`}
      <label class="director-setting"><span>Delivery</span>${select(s.deliveryPick, "Delivery")}</label>
      ${s.droneMode ? `${setting("etaMin", "Drone takes at least (min)", s, `min="1" max="240" step="1"`)}${setting("etaMax", "…and at most (min)", s, `min="1" max="240" step="1"`)}
        <p class="director-note">Approved orders fly for a random time in that range, then land in the character's gear once that much world time <b>or</b> real time has passed.</p>` : ""}
      ${label("Prices")}
      ${setting("minPrice", "Lowest price (eb)", s, `min="0" step="1"`)}${setting("maxPrice", "Highest price (eb, 0 = no limit)", s, `min="0" step="1"`)}${setting("markup", "Markup (%, 100 = list price)", s, `min="1" step="1"`)}
      ${check("ignoreBlankPrice", "Ignore blank price", s)}
      <p class="director-note">Blank price = no price or 0. Ignored: not for sale. Otherwise: "price on request", outside the limits, and you set the price when you approve. The limits apply after markup.</p>
      ${label("Orders")}${setting("maxPending", "Orders waiting per character (0 = no limit)", s, `min="0" step="1"`)}${check("allowOverBudget", "Players may order more than they have", s)}
      ${label("Today's picks")}
      ${setting("featured", "Featured items a day (0 = none)", s, `min="0" max="12" step="1"`)}${setting("deals", "Hot Deals a day (0 = none)", s, `min="0" max="12" step="1"`)}${setting("dealOff", "Biggest Hot Deal discount (%)", s, `min="10" max="90" step="5"`)}
      <div class="director-toolbar">${phoneBtn("market-reset", "Back to defaults", { icon: "fa-rotate-left", cls: "danger" })}</div></div>
    <div>${label(`Item types${s.sourceCount != null ? ` <small>${s.sourceCount} items in the catalogue</small>` : ""}`)}
      <div class="director-picks">${s.types.map(t => phoneBtn("market-type", esc(t.label), { data: { type: t.type }, icon: t.on ? "fa-check" : "", cls: t.on ? "on" : "" })).join("")}</div>
      ${label("World items")}${check("worldItems", "Sell world items (Items sidebar)", s)}
      ${s.worldItems ? `<label class="director-setting"><span>From</span>${select(s.folderPick, "World items from")}</label>` : ""}
      ${label("Compendiums", phoneBtn("market-packs-all", s.allPacks ? "None" : "All", { icon: s.allPacks ? "fa-square-minus" : "fa-square-check" }))}
      <p class="director-note">Players only see compendiums they have Observer on (<i class="fas fa-eye-slash"></i>: they can't).</p>
      ${s.packs.map(p => `<label class="director-check-row"><input type="checkbox" data-director="phone:market-pack" data-pack="${esc(p.collection)}" ${p.on ? "checked" : ""}> ${esc(p.label)}${p.hidden ? ` <i class="fas fa-eye-slash" title="Players can't see this compendium"></i>` : ""}</label>`).join("")}</div>
  </div>`;
}

function marketPageHtml(director, m) {
  if (m.tab.queue) return queueHtml(director, m);
  if (m.tab.shop) return shopHtml(director, m);
  if (m.tab.history) return historyHtml(director, m);
  if (m.tab.setup) return setupHtml(m.setup);
  return "";
}

const marketHeadHtml = m => pageHead("Great River", "A Ziggurat pilot program", { tags: storeTerms(m.store), tabs: m.tabs, action: "market-tab" });

const market = {
  data: marketData,
  /** The rail's count: orders waiting. */
  count: m => m.tabs.find(t => t.id === "queue")?.count ?? 0,
  head: marketHeadHtml,
  page: marketPageHtml,
  /** Which page is drawn (another page draws everything again). */
  shape: m => Object.keys(m.tab)[0]
};

/* ---------------- CBK ---------------- */

const cbkData = director => director.logic.cbkData(director.logic.ctx());

/** A market's own text field (name, fixer, letter, where): saved by the GM Phone's handler on change. */
const cbkField = (m, field, text, attrs = "") => `<label class="director-setting"><span>${text}</span><input type="text" data-cbk-market="${esc(m.id)}" data-field="${field}" data-director="input:[data-cbk-market]" value="${esc(m[field] ?? "")}" ${attrs}></label>`;

/** The broadcast composer on a live market (its fields live on the GM Phone's state until Send). */
function composerHtml(c) {
  if (!c) return "";
  const field = (key, attrs) => `<input data-cbk-compose="${key}" data-director="input:[data-cbk-compose]" data-draft="cbk-compose-${key}" ${attrs}>`;
  return `<div class="director-cbk-compose">
    ${c.flash ? `<label class="director-setting"><span>On</span>${select(c.targetPick, "Flash sale on")}</label>
      <label class="director-setting"><span>% off</span>${field("pct", `type="number" value="${esc(String(c.pct))}" min="1" max="90" step="1"`)}</label>
      <label class="director-setting"><span>Minutes</span>${field("mins", `type="number" value="${esc(String(c.mins))}" min="1" max="240" step="1"`)}</label>` : ""}
    ${c.raid ? `<label class="director-setting"><span>Who's coming</span>${select(c.byPick, "Who's coming")}</label>` : ""}
    ${field("text", `type="text" value="${esc(c.text ?? "")}" maxlength="300" placeholder="${c.date ? "e.g. Next Friday, same place" : c.policy ? "e.g. No drawn weapons past the gate" : "Message (optional)"}"`)}
    <div class="director-toolbar">${phoneBtn("cbk-broadcast", `Send ${esc(c.label)}`, { data: { market: c.market }, icon: "fa-tower-broadcast", cls: "primary" })}</div>
  </div>`;
}

function cbkMarketsHtml(c) {
  const cards = c.markets.map(m => `<article class="director-order ${m.live ? "live" : ""}">
    <header>${m.letter ? `<b class="director-letter">${esc(m.letter)}</b>` : ""}<strong>${esc(m.name)}</strong>
      <span class="director-sub">${m.fixer ? `${esc(m.fixer)} · ` : ""}${m.count} listings${m.hidden ? ` (${m.hidden} hidden)` : ""}${m.waiting ? ` · ${m.waiting} to pick up` : ""}</span>
      <span class="director-toolbar">${phoneBtn("cbk-edit", "", { data: { market: m.id }, icon: "fa-pen", title: `Edit ${m.name}` })}${phoneBtn("cbk-delete", "", { data: { market: m.id }, icon: "fa-trash", cls: "danger", title: `Delete ${m.name}` })}</span></header>
    <div class="director-toolbar">${phoneBtn("cbk-live", m.live ? "LIVE · Go offline" : "GO LIVE", { data: { market: m.id }, icon: m.live ? "fa-tower-broadcast" : "fa-power-off", cls: m.live ? "on" : "primary" })}
      ${m.live ? m.kinds.map(k => phoneBtn("cbk-compose", esc(k.label), { data: { market: m.id, kind: k.id }, icon: k.icon, cls: k.active ? "on" : "" })).join("") : ""}</div>
    ${composerHtml(m.compose)}
    ${m.sent.length ? listOf(m.sent.map(b => row({
      cls: b.on ? "" : "faded",
      main: `<i class="fas ${b.icon}"></i> <strong>${esc(b.label)}</strong> ${esc(b.line)}`,
      small: `${esc(b.when)}${b.on ? "" : " · ended"}`,
      tools: b.endable ? phoneBtn("cbk-broadcast-end", "", { data: { market: m.id, broadcast: b.id }, icon: "fa-stop", title: `End ${b.label} now` }) : ""
    })), "") : ""}
  </article>`).join("") || `<p class="director-empty">No Night Markets yet.</p>`;
  return `<div class="director-pickers"><label><span>New market</span>${select(c.newPick, "New market")}</label></div>
    <div class="director-cards">${cards}</div>
    <p class="director-note">A market is in range for every player while it's live. The six presets are Black Chrome's Night Markets (A–F) with their booths and catalogue items, matched by name to your world items and compendiums. Broadcasts go to every character with an Agent and a signal.</p>`;
}

function cbkListingsHtml(director, c) {
  const pick = c.editPick ? `<div class="director-pickers"><label><span>Market</span>${select(c.editPick, "Market")}</label></div>` : "";
  const m = c.market;
  if (!m) return `${pick}<p class="director-empty">No Night Markets yet: make one on Markets.</p>`;
  const input = (l, field, attrs) => `<input data-cbk-listing="${esc(l.id)}" data-market="${esc(m.id)}" data-field="${field}" data-director="input:input[data-cbk-listing]" data-draft="cbk-l:${esc(l.id)}:${field}" ${attrs}>`;
  const rows = c.listings.map(l => `<tr class="${l.hidden ? "faded" : ""}">
      <td>${l.appIcon ? `<i class="fas ${esc(l.appIcon)}"></i>` : `<img class="director-avatar" src="${esc(l.img || "icons/svg/item-bag.svg")}" alt="" ${l.uuid ? `data-director="phone:cbk-item" data-uuid="${esc(l.uuid)}"` : ""}>`}</td>
      <td><strong>${esc(l.name)}</strong>${l.missing ? ` <i class="fas fa-triangle-exclamation" title="No matching item: a plain gear item is handed over"></i>` : ""}<small>${esc(l.catLabel)}${l.corp ? ` · ${esc(l.corp)}` : ""}${l.sale ? ` · FLASH −${l.sale}%` : ""}</small></td>
      <td>${l.app ? "" : input(l, "booths", `type="text" value="${esc(l.boothText)}" placeholder="Booth" aria-label="Booth of ${esc(l.name)}"`)}</td>
      <td>${input(l, "price", `type="number" value="${esc(String(l.price))}" min="0" step="1" aria-label="Price of ${esc(l.name)}"`)}</td>
      <td>${l.app ? "" : input(l, "stock", `type="number" value="${esc(String(l.stockText))}" min="0" step="1" placeholder="∞" aria-label="Stock of ${esc(l.name)}"`)}</td>
      <td class="director-toolbar">${phoneBtn("cbk-hide", "", { data: { market: m.id, listing: l.id }, icon: "fa-eye-slash", cls: l.hidden ? "on" : "", title: l.hidden ? `Show ${l.name}` : `Hide ${l.name}` })}${phoneBtn("cbk-remove", "", { data: { market: m.id, listing: l.id }, icon: "fa-xmark", cls: "danger", title: `Remove ${l.name}` })}</td>
    </tr>`).join("");
  const found = c.addLoading ? `<p class="director-empty"><i class="fas fa-spinner fa-spin"></i> Loading items…</p>`
    : c.addRows ? listOf(c.addRows.map(e => row({
      lead: `<img class="director-avatar" src="${esc(e.img)}" alt="">`, main: `<strong>${esc(e.name)}</strong>`, small: `${esc(e.typeLabel)} · ${esc(e.priceLabel)}`,
      tools: phoneBtn("cbk-add", "", { data: { uuid: e.uuid }, icon: "fa-plus", title: `List ${e.name}` })
    })), "Nothing matches.") : "";
  return `${pick}
    <div class="director-cbk-fields">${cbkField(m, "name", "Name", `maxlength="60"`)}${cbkField(m, "fixer", "Fixer", `maxlength="60"`)}${cbkField(m, "letter", "Letter", `maxlength="1"`)}${cbkField(m, "where", "Where", `maxlength="120"`)}
      <label class="director-setting"><span>Rules</span><textarea data-cbk-market="${esc(m.id)}" data-field="rules" data-director="input:[data-cbk-market]" rows="2" maxlength="300" placeholder="When, invites, house rules">${esc(m.rules ?? "")}</textarea></label></div>
    <div class="director-cbk-listings">
      <div>${label(`Listings (${c.listings.length})`)}
        <table class="director-table"><thead><tr><th></th><th>Item</th><th>Booth</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="director-empty">Nothing listed yet.</td></tr>`}</tbody></table></div>
      <div>${label("Add")}
        <input type="search" name="cbkAddSearch" data-director="input:input[name=cbkAddSearch]" data-draft="cbk-add-search" value="${esc(c.addSearch)}" placeholder="Search your items and compendiums" aria-label="Search items to list" autocomplete="off">
        ${found}
        <label class="director-setting"><span>Sell an app</span>${select(c.appPick, "Sell an app")}</label>
        <p class="director-note">Booths: a letter and number (C4), several with a slash. Empty stock is unlimited. An app installs through the App Store when bought.</p></div>
    </div>`;
}

function receiptHtml(r) {
  return row({
    main: `<b class="director-letter">${esc(r.code)}</b> <strong>${esc(r.name)}</strong> · ${esc(r.actorName)} <span class="director-tag">${esc(r.statusLabel)}</span>`,
    small: `${r.letter ? `${esc(r.letter)}: ` : ""}${esc(r.market ?? "")} · ${esc(r.date ?? "")} ${esc(r.time ?? "")}${r.paid ? ` · ${esc(r.boothLine)}` : ""}`,
    tools: `<span class="director-price">${esc(r.priceLabel)}</span>`
      + (r.paid ? phoneBtn("cbk-handover", "Hand over", { data: { receipt: r.id }, icon: "fa-hand-holding", cls: "primary" }) : "")
      + (r.refundable ? phoneBtn("cbk-refund", r.app ? "Refund and uninstall" : "Refund", { data: { receipt: r.id }, icon: "fa-rotate-left" }) : "")
  });
}

const cbkReceiptsHtml = c => `<div class="director-columns">
    <div>${label(`To pick up (${c.paid.length})`)}${listOf(c.paid.map(receiptHtml), "Nothing waiting.")}
      <p class="director-note">Players pick up at the booth while the market is live; Hand over gives them the item now. Refund pays back and puts the stock back on the shelf.</p></div>
    <div>${label("Done")}${listOf(c.done.map(receiptHtml), "Nothing yet.")}</div>
  </div>`;

const cbk = {
  data: cbkData,
  count: c => c.tabs.find(t => t.id === "receipts")?.count ?? 0,
  head: c => pageHead("CBK", "The Night Markets' Cee Book", { tabs: c.tabs, action: "cbk-gm-tab" }),
  page(director, c) {
    if (c.tab.markets) return cbkMarketsHtml(c);
    if (c.tab.listings) return cbkListingsHtml(director, c);
    if (c.tab.receipts) return cbkReceiptsHtml(c);
    return "";
  },
  shape: c => Object.keys(c.tab)[0]
};

/* ---------------- BangMe! ---------------- */

/** Every character's account, and the picked one's ledger (the GM Phone's "whose ledger"). */
function bangmeData(director) {
  const logic = director.logic;
  const data = logic.bangmeData(logic.ctx());
  data.accounts = playerCharacters().filter(hasWallet).map(a => ({ id: a.id, name: displayName(a), img: a.img, balance: formatMoney(a.system.wealth.value), active: a.id === logic.bangActor }));
  return data;
}

function bangmePageHtml(director, b) {
  const accounts = listOf(b.accounts.map(a => row({
    cls: a.active ? "active" : "",
    lead: avatar(a.img, a.name),
    main: `<button type="button" class="director-plain" data-director="economy-account" data-actor-id="${esc(a.id)}"><strong>${esc(a.name)}</strong></button>`,
    tools: `<span class="director-price">${esc(a.balance)}</span>`
  })), "No characters with an account.");
  const held = b.held.length ? label("Waiting for them") + listOf(b.held.map(h => row({ main: `<strong>${esc(h.amountLabel)}</strong> from ${esc(h.party)}${h.memo ? ` · ${esc(h.memo)}` : ""}` })), "") : "";
  const ledger = listOf(b.rows.map(r => row({
    main: `<strong>${esc(r.party)}</strong> <span class="director-time">${esc(r.date ?? "")} ${esc(r.time ?? "")}</span>`,
    small: `${esc(r.kindLabel)}${r.memo ? ` · ${esc(r.memo)}` : ""}${r.status ? ` · ${esc(r.status)}` : ""}`,
    tools: `<span class="director-price ${r.credit ? "credit" : ""}">${esc(r.amountLabel)}</span>`
  })), "Nothing yet.");
  const points = listOf(b.points.map(p => row({
    cls: p.open ? "" : "faded",
    lead: p.img ? `<img class="director-avatar" src="${esc(p.img)}" alt="">` : `<span class="director-avatar initials"><i class="fas fa-cash-register"></i></span>`,
    main: `<strong>${esc(p.name)}</strong>`,
    small: `${esc(p.prices)}${p.where ? `<br><i class="fas fa-location-dot"></i> ${esc(p.where)}` : ""}`,
    tools: phoneBtn("paypoint-toggle", "", { data: { pointId: p.id }, icon: p.open ? "fa-door-open" : "fa-door-closed", cls: p.open ? "on" : "", title: p.open ? "Open: players see it. Close it" : "Closed: open it for players" })
      + phoneBtn("paypoint-edit", "", { data: { pointId: p.id }, icon: "fa-pen", title: "Edit" })
      + phoneBtn("paypoint-delete", "", { data: { pointId: p.id }, icon: "fa-trash", cls: "danger", title: "Delete" })
  })), "Add merchants the players can pay: bars, clinics, stalls.");
  const invoices = listOf(b.invoices.map(i => row({
    main: `<strong>${esc(i.amountLabel)}</strong> ${esc(i.party)}`,
    small: `${esc(i.statusLabel)}${i.memo ? ` · ${esc(i.memo)}` : ""}`,
    tools: (i.canPay ? phoneBtn("invoice-answer", "Pay", { data: { invoiceId: i.id, answer: "pay" } }) + phoneBtn("invoice-answer", "", { data: { invoiceId: i.id, answer: "decline" }, icon: "fa-xmark", title: "Decline" }) : "")
      + (i.canCancel ? phoneBtn("invoice-answer", "", { data: { invoiceId: i.id, answer: "cancel" }, icon: "fa-trash", cls: "danger", title: "Cancel it" }) : "")
  })), "No invoices.");
  return `<div class="director-bangme">
    <div>${label("Accounts")}${accounts}</div>
    <div>${label(`Ledger${b.wallet ? ` · ${esc(b.balance)}` : ""}`, phoneBtn("ledger-adjust", "Adjust", { icon: "fa-scale-balanced" }) + phoneBtn("ledger-export", "Export", { icon: "fa-file-csv" }))}
      ${held}
      <div class="director-picks">${b.filters.map(f => phoneBtn("bang-filter", esc(f.label), { data: { filter: f.id }, cls: f.active ? "on" : "" })).join("")}</div>
      ${ledger}</div>
    <div>${label("Invoices", phoneBtn("invoice-new", "", { icon: "fa-plus", title: "New invoice" }))}${invoices}${label("Pay points", phoneBtn("paypoint-edit", "", { icon: "fa-plus", title: "New pay point" }))}${points}</div>
  </div>`;
}

const bangme = {
  data: bangmeData,
  count: () => 0,
  head: () => pageHead("BangMe!", "Eurobank accounts, the ledger and pay points"),
  page: bangmePageHtml,
  shape: () => "bangme"
};

/* ---------------- Trauma Team ---------------- */

const traumaData = director => director.logic.traumaData(director.logic.ctx());

/** A Trauma Team or MedScan number or switch: the GM Phone's own handler saves it. */
const ttInput = (attr, key, value, text, extra = "") => `<label class="director-setting"><span>${text}</span><input type="number" data-${attr}="${key}" data-director="input:input[data-${attr}]" value="${esc(String(value ?? ""))}" min="0">${extra}</label>`;
const ttCheck = (attr, key, on, text) => `<label class="director-check-row"><input type="checkbox" data-${attr}="${key}" data-director="input:input[data-${attr}]" ${on ? "checked" : ""}> ${text}</label>`;

function dispatchHtml(director, t, d) {
  const tools = [];
  if (d.isPending) {
    tools.push(`<label class="director-delay" title="ETA"><span>Dispatch in</span><input type="number" name="eta" min="0" data-draft="tt-eta:${esc(d.id)}" value="${esc(String(director.drafts[`tt-eta:${d.id}`] ?? t.eta))}" aria-label="ETA"></label>`,
      `<button type="button" class="primary" data-director="tt-dispatch" data-dispatch-id="${esc(d.id)}" data-status="enroute" data-unit="minutes" title="Counts down in real minutes">Minutes</button>`);
    if (t.inCombat) tools.push(`<button type="button" class="primary" data-director="tt-dispatch" data-dispatch-id="${esc(d.id)}" data-status="enroute" data-unit="rounds" title="Counts down as the combat's rounds go by">Rounds</button>`);
  }
  if (d.isEnroute) tools.push(`<button type="button" class="primary" data-director="tt-dispatch" data-dispatch-id="${esc(d.id)}" data-status="arrived">Arrived</button>`);
  tools.push(`<button type="button" class="danger" data-director="tt-dispatch" data-dispatch-id="${esc(d.id)}" data-status="closed">Close</button>`);
  if (d.tokenId) tools.push(phoneBtn("tt-show", "Show", { data: { sceneId: d.sceneId, tokenId: d.tokenId }, icon: "fa-location-crosshairs" }));
  return `<article class="director-order ${d.isPending ? "pending" : ""}" data-dispatch="${esc(d.id)}">
    <header><i class="fas fa-truck-medical"></i> <strong>${esc(d.name)}</strong><span class="director-time">${esc(d.time ?? "")}</span>
      <span class="director-tag ${d.isPending ? "warn" : ""}">${esc(d.statusLabel)}${d.countdown ? ` · ${esc(d.countdown)}` : ""}</span></header>
    <small class="director-sub">${d.auto ? "Biomonitor" : "Panic button"} · ${esc(d.hpLabel)}${d.wound ? ` · ${esc(d.wound)}` : ""} · ${d.covered ? esc(d.tierName ?? "") : d.lapsed ? "LAPSED" : "No coverage"}</small>
    <div class="director-toolbar">${tools.join("")}</div>
  </article>`;
}

function coverageHtml(director, t) {
  const calls = t.open.map(d => dispatchHtml(director, t, d)).join("") || `<p class="director-empty">No calls.</p>`;
  const recent = t.closed.length ? label("Recent calls") + listOf(t.closed.map(d => row({ main: `${esc(d.name)} · ${esc(d.time ?? "")}`, small: esc(d.reason ?? "") })), "") : "";
  const characters = listOf(t.characters.map(c => row({
    main: `<strong>${esc(c.name)}</strong>`,
    small: `${esc(c.coverage)}${c.due ? ` · next bill ${esc(c.due)}` : ""}${c.biolink ? " · biomonitor linked" : ""}${c.exec ? ` · Exec rank: ${esc(c.exec)}` : ""}`,
    tools: phoneBtn("tt-grant", "", { data: { actorId: c.id }, icon: "fa-gift", title: "Give a plan (never billed, e.g. corporate)" })
      + (c.has ? phoneBtn("tt-revoke", "", { data: { actorId: c.id }, icon: "fa-ban", cls: "danger", title: "End their coverage" }) : "")
  })), "No characters.");
  const billing = t.billedBy
    ? `<p class="director-note"><i class="fas fa-file-invoice-dollar"></i> Billed by ${esc(t.billedBy)}: paid plans are charged with its bills, not here.</p>`
    : `<div class="director-toolbar">${phoneBtn("tt-bill", "It's the 1st: bill everyone", { icon: "fa-calendar-day" })}</div><p class="director-note">Paid plans also bill themselves on world time, each on its own schedule.</p>`;
  const plans = listOf(t.tiers.map(p => row({
    main: `<strong>${esc(p.name)}</strong> <span class="director-price">${esc(p.priceLabel)}</span>`,
    small: `${p.execRank ? `Exec rank ${p.execRank}+ · ` : ""}${p.medscan ? "MedScan included · " : ""}${p.subscribers ? `${p.subscribers} on it · ` : ""}${esc(p.note ?? "")}`,
    tools: phoneBtn("tt-tier-edit", "", { data: { tier: p.id }, icon: "fa-pen", title: "Edit" }) + phoneBtn("tt-tier-remove", "", { data: { tier: p.id }, icon: "fa-trash", cls: "danger", title: "Remove" })
  })), "");
  return `<div class="director-bangme">
    <div>${label(`Calls (${t.open.length})`)}${calls}${recent}</div>
    <div>${label("Characters")}${characters}${billing}</div>
    <div>${label("Plans", phoneBtn("tt-tier-add", "", { icon: "fa-plus", title: "Add a plan" }))}${plans}
      <div class="director-toolbar">${phoneBtn("tt-tier-reset", "Back to the default plans", { icon: "fa-rotate-left" })}</div>
      ${label("Rules")}<label class="director-setting"><span>Biomonitor calls</span>${select(t.trigger, "Biomonitor calls when")}</label>
      ${ttCheck("tt-setting", "execAuto", t.execAuto, "Execs get corporate coverage")}
      <p class="director-note">${t.execRanks ? `${esc(t.execRanks)} (Teamwork, from their Exec role on the sheet).` : "No plan has an Exec rank yet: set one on a plan."}</p>
      ${ttCheck("tt-setting", "solicit", t.solicit, "Sell coverage to the bleeding")}${ttCheck("tt-setting", "allowNoAds", t.allowNoAds, "Players can turn the offers off")}
      ${ttInput("tt-setting", "eta", t.eta, "Default ETA", " <small>minutes or rounds</small>")}</div>
  </div>`;
}

function medscanHtml(t) {
  const m = t.medscan;
  const calls = listOf(m.calls.map(c => row({
    cls: c.consult.pending ? "active" : "",
    lead: `<i class="${esc(c.consult.icon ?? "")}"></i>`,
    main: `<strong>${esc(c.name)}</strong> <span class="director-time">${c.consult.pending ? "Waiting" : `${esc(c.consult.left ?? "")} left`}</span>`,
    small: `${esc(c.consult.name)}${c.consult.doctor ? ` · ${esc(c.consult.doctor)}` : ""}${c.consult.paid ? ` · ${esc(c.consult.paid)}` : ""} · ${esc(c.consult.bonus)}`,
    tools: c.consult.pending
      ? phoneBtn("ms-answer", "Connect", { data: { actorId: c.id, consultId: c.consult.id, ok: "true" }, cls: "primary" }) + phoneBtn("ms-answer", "Unavailable", { data: { actorId: c.id, consultId: c.consult.id, ok: "false" } })
      : phoneBtn("ms-end", "End consult", { data: { actorId: c.id }, cls: "danger" })
  })), "No consults.");
  const characters = listOf(m.characters.map(c => row({
    main: `<strong>${esc(c.name)}</strong>`,
    small: `${c.owned ? `Has MedScan${c.gift ? " (given)" : ""}` : "No MedScan"}${c.covered ? ` · consults covered by ${esc(c.covered)}` : ""}`,
    tools: c.owned ? phoneBtn("ms-grant", "", { data: { actorId: c.id, owned: "false" }, icon: "fa-ban", cls: "danger", title: "Remove MedScan from their Agent" })
      : phoneBtn("ms-grant", "", { data: { actorId: c.id, owned: "true" }, icon: "fa-gift", title: "Give them MedScan (free)" })
  })), "No characters.");
  return `<div class="director-bangme">
    <div>${label(`Consults (${m.calls.length})`)}${calls}</div>
    <div>${label("Characters")}${characters}</div>
    <div>${label("Prices")}${ttInput("ms-setting", "price", m.price, "MedScan app", " <small>once</small>")}
      ${m.consults.map(c => ttInput("ms-setting", c.id, c.price, esc(c.name), ` <small>${c.hours} h · ${esc(c.bonus)}</small>`)).join("")}
      <p class="director-note">${m.plans ? `Free for members of: ${esc(m.plans)}.` : "No plan includes MedScan: tick it on a plan (Coverage)."}</p>
      ${label("Rules")}${ttCheck("ms-setting", "live", m.live, "I answer each consult myself")}
      <p class="director-note">On: every call waits for your Connect or Unavailable (play the doctor). Off: a specialist picks up at once.</p>
      ${ttCheck("ms-setting", "unavailable", m.unavailable, "No specialist available")}
      <p class="director-note">A blackout, a hostile zone, or the corp is having a day.</p></div>
  </div>`;
}

const trauma = {
  data: traumaData,
  /** Calls not yet dispatched, and consults waiting for the GM. */
  count: t => t.open.filter(d => d.isPending).length + t.medscan.calls.filter(c => c.consult.pending).length,
  head: t => pageHead("Trauma Team", "Calls, coverage and MedScan", { tabs: t.tabs, action: "tt-tab" }),
  page: (director, t) => (t.tab.medscan ? medscanHtml(t) : coverageHtml(director, t)),
  shape: t => Object.keys(t.tab)[0]
};

const PAGES = { market, cbk, bangme, trauma };

export const { html, refresh, attach } = railed("economy", "Economy apps", APPS, PAGES);

/** The typed prices and note of an order card. */
function orderFields(el) {
  const card = el.closest("[data-order]");
  const prices = [...card.querySelectorAll("input[name=price]")].map(input => (input.value === "" ? null : Number(input.value)));
  return { prices, gmNote: card.querySelector("input[name=note]")?.value ?? "" };
}

function forgetOrder(director, orderId) {
  for (const key of Object.keys(director.drafts)) if (key.startsWith(`gr-price:${orderId}:`) || key === `gr-note:${orderId}`) delete director.drafts[key];
}

export const actions = {
  ...railActions,
  "economy-account"({ actorId }) {
    this.logic.pick("bangActor", actorId);
  },
  "tt-dispatch"({ dispatchId, status, unit }, event) {
    const eta = Number(event.target.closest("[data-dispatch]")?.querySelector("input[name=eta]")?.value);
    if (store.request("tt-dispatch", { dispatchId, status, eta, unit })) delete this.drafts[`tt-eta:${dispatchId}`];
  },
  async "gr-approve"({ orderId }, event) {
    if (await approveOrder(orderId, orderFields(event.target))) forgetOrder(this, orderId);
  },
  "gr-deny"({ orderId }, event) {
    if (denyOrder(orderId, orderFields(event.target).gmNote)) forgetOrder(this, orderId);
  }
};

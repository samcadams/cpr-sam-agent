import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { APP_IDS, APP_MANIFEST, appPartial } from "../../scripts/apps/manifest.js";
import { APPS } from "../../scripts/model/apps.js";
import { appearance } from "../../scripts/model/appearance.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { feature } from "../../scripts/model/features.js";
import { formatMoney, priceTier } from "../../scripts/model/money.js";
import {
  ADDON_IDS, ADDONS, cleanListing, DEFAULT_LISTINGS, hasAddon, isDue, isInstalled, isLapsed, MODELS, monthlyTotal, OFFERS, POOL, poolConfig, poolOn, priceLabel, REVOKE_REASONS, rowsOf, SOURCES, storeAction,
  storeApps, subsBilledBy, subscriptionsOf
} from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { esc } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";

/*
 * Phone page: Ziggurat Pool, the app store (see apps/pool/model.js, apps/pool/host.js). Players: Featured (what
 * the Pool offers, the GM's "coming soon" listings, and "On your Agent": Open, Uninstall) and Subscriptions
 * (Cancel, Renew). Getting an app plays a short faux download on its card before it moves to "On your Agent". A lapsed subscription's app opens onto this page's lock screen instead (AgentPhone).
 * The GM Phone: the catalogue (price model, price, where it's offered, preinstalled), every player
 * character's apps (install, revoke with a reason and refund, subscriptions, the monthly bill, and
 * sideloading a Fixer's app package into a conversation), and the listings.
 * Methods, click actions (data-action), inputs and dropdowns are installed onto AgentPhone.
 */

const TABS = { featured: "Featured", subs: "Subscriptions" };

/** How long the faux download on an app's card takes (ms). */
const DOWNLOAD_MS = 3000;

/** Apps downloading on this client: { [actorId|appId]: started (ms) }. */
const downloads = new Map();
const dlKey = (actorId, app) => `${actorId}|${app}`;

const cfgOf = () => poolConfig();
const saveConfig = change => patchSetting("pool", change);
const nameOf = id => appearance().names[id] ?? APP_MANIFEST[id]?.name ?? ADDONS[id]?.name ?? id;

/** Change one app's catalogue entry. */
const saveEntry = (id, field, value) => saveConfig(p => (p.apps = { ...p.apps, [id]: { ...p.apps?.[id], [field]: value } }));

/** The world date a world time falls on, short, or "" (Simple Calendar's when it's there). */
function worldDate(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const api = globalThis.SimpleCalendar?.api;
  if (api?.timestampToDate) {
    const d = api.timestampToDate(seconds);
    if (d) return `${d.display?.monthName ?? d.month + 1} ${d.display?.day ?? d.day + 1}`;
  }
  const days = Math.round((seconds - game.time.worldTime) / 86400);
  return days === 0 ? "today" : days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
}

/* ---------------- Click actions ---------------- */

export const actions = {
  "pool-tab"({ tab }) {
    if (tab in TABS) this.poolTab = tab;
    this.render();
  },
  "pool-open"({ app }) {
    this.app = app;
    this.view = null;
    this.render();
  },
  "pool-get"({ app }) {
    const actor = this.context()?.subject?.actor;
    const entry = cfgOf().apps[app];
    if (!actor || !entry) return;
    const action = storeAction(store.apps.installs, actor.id, app);
    const billed = subsBilledBy();
    // The request goes now (paying, if it costs); the card shows a download for a few seconds, then the
    // app moves to "On your Agent" (or back to its button, if the payment was declined).
    const send = () => {
      const key = dlKey(actor.id, app);
      downloads.set(key, Date.now());
      store.request("pool-get", { actorId: actor.id, app });
      this.render();
      setTimeout(() => {
        downloads.delete(key);
        if (this.rendered) this.render();
      }, DOWNLOAD_MS);
    };
    if (action === "get") return send();
    const content = action === "subscribe"
      ? `<p>Subscribe to ${esc(nameOf(app))} for ${priceLabel(entry)}?</p><p>${billed ? `It's billed with your monthly ${esc(billed)} bill.` : "The first month is charged now; later months come with the GM's monthly bill."}</p>`
      : `<p>Buy ${esc(nameOf(app))} for ${formatMoney(entry.price)}? It's yours: reinstalling it later is free.</p>`;
    Dialog.confirm({ title: "App Store", content, yes: send });
  },
  "pool-remove"({ app }) {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const row = rowsOf(store.apps.installs, actor.id)[app];
    const sub = row?.sub && row.sub.status !== "cancelled";
    Dialog.confirm({
      title: "App Store",
      content: `<p>Uninstall ${esc(nameOf(app))}?${sub ? " Its subscription is cancelled too." : row?.paid ? " You can reinstall it for free." : ""}</p>`,
      yes: () => store.request("pool-remove", { actorId: actor.id, app })
    });
  },
  "pool-cancel"({ app }) {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    Dialog.confirm({
      title: "App Store",
      content: `<p>Cancel your ${esc(nameOf(app))} subscription? The app is uninstalled.</p>`,
      yes: () => store.request("pool-cancel", { actorId: actor.id, app })
    });
  },
  "pool-renew"({ app }) {
    const actor = this.context()?.subject?.actor;
    const row = actor ? rowsOf(store.apps.installs, actor.id)[app] : null;
    if (!row?.sub) return;
    const billed = subsBilledBy();
    Dialog.confirm({
      title: "App Store",
      content: `<p>Renew ${esc(nameOf(app))} for ${formatMoney(row.sub.price)}/mo?${billed ? ` It goes on your ${esc(billed)} bill.` : " A month is charged now."}</p>`,
      yes: () => store.request("pool-renew", { actorId: actor.id, app })
    });
  },
  /** A Fixer's free app package in a conversation (templates/phone/parts/message.hbs). */
  "pool-pkg"({ messageId }) {
    const thread = this.view ? this.resolveDirect() : null;
    if (thread) store.request("pool-pkg", { threadId: thread.id, messageId });
  },
  // The GM.
  "pool-revoke"({ actorId, app }) {
    const actor = game.actors.get(actorId);
    const row = rowsOf(store.apps.installs, actorId)[app];
    if (!actor) return;
    const reasons = REVOKE_REASONS.map(r => `<option>${esc(r)}</option>`).join("");
    new Dialog({
      title: `App Store: remove ${nameOf(app)}`,
      content: `<form class="agent-dialog">
        <p>Take ${esc(nameOf(app))} off ${esc(displayName(actor))}'s Agent. They're told why.</p>
        <div class="form-group"><label>Why</label><input type="text" name="reason" list="ctp-pool-reasons" value="${esc(REVOKE_REASONS[0])}" maxlength="80"><datalist id="ctp-pool-reasons">${reasons}</datalist></div>
        ${row?.paid > 0 ? `<div class="form-group"><label><input type="checkbox" name="refund"> Refund ${formatMoney(row.paid)}</label></div>` : ""}
      </form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-ban"></i>', label: "Remove",
          callback: html => {
            const form = html[0].querySelector("form");
            store.request("pool-revoke", { actorId, app, reason: form.reason.value, refund: !!form.refund?.checked });
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  },
  "pool-forget"({ actorId, app }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    Dialog.confirm({
      title: `App Store: reset ${nameOf(app)}`,
      content: `<p>${esc(displayName(actor))} no longer owns ${esc(nameOf(app))}: it comes off their Agent and must be bought again. Nothing is refunded.</p>`,
      yes: () => store.request("pool-forget", { actorId, app })
    });
  },
  "pool-sub"({ actorId, app, status }) {
    store.request("pool-sub", { actorId, app, status });
  },
  "pool-sponsor"({ actorId, app }) {
    const row = rowsOf(store.apps.installs, actorId)[app];
    if (!row?.sub) return;
    if (row.sub.sponsor) return store.request("pool-sub", { actorId, app, sponsor: null });
    new Dialog({
      title: `App Store: sponsor ${nameOf(app)}`,
      content: `<form class="agent-dialog"><p>Someone else pays this subscription: it's never billed.</p>
        <div class="form-group"><label>Paid by</label><input type="text" name="sponsor" maxlength="40" placeholder="Their fixer, a corp…"></div></form>`,
      buttons: {
        ok: { label: "Sponsor", callback: html => store.request("pool-sub", { actorId, app, sponsor: html[0].querySelector("input[name=sponsor]").value || "Sponsored" }) },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  },
  "pool-bill"({ actorId, all }) {
    const actor = game.actors.get(actorId);
    const subs = subscriptionsOf(store.apps.installs, actorId).filter(s => (all === "1" ? s.status === "active" && !s.sponsor : isDue(s)));
    if (!actor || !subs.length) return;
    const lines = subs.map(s => `<li>${esc(nameOf(s.app))}: ${formatMoney(s.price)}</li>`).join("");
    Dialog.confirm({
      title: "Ziggurat Pool: subscriptions bill",
      content: `<p>Bill ${esc(displayName(actor))} ${formatMoney(subs.reduce((n, s) => n + s.price, 0))} through BangMe!?</p><ul>${lines}</ul><p>If they can't pay, these subscriptions lapse.</p>`,
      yes: () => store.request("pool-bill", { actorId, all: all === "1" })
    });
  },
  "pool-sideload"({ actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const cfg = cfgOf();
    const apps = APP_IDS.filter(id => id !== POOL && !isInstalled(store.apps.installs, actorId, id, cfg));
    if (!apps.length) return ui.notifications.info(`${displayName(actor)} has every app.`);
    // Fixer-only apps first: that's what sideloading is for.
    apps.sort((a, b) => (cfg.apps[a].offer === "fixer" ? 0 : 1) - (cfg.apps[b].offer === "fixer" ? 0 : 1));
    const options = apps.map(id => `<option value="${id}" data-price="${cfg.apps[id].price}">${esc(nameOf(id))}${cfg.apps[id].offer === "fixer" ? " (Fixer only)" : ""}${feature(`app_${id}`) ? "" : " (switched off)"}</option>`).join("");
    new Dialog({
      title: `App Store: sideload to ${displayName(actor)}`,
      content: `<form class="agent-dialog">
        <p>An app package in a conversation: they pay the money request (or tap Install, when it's free) and it's on their Agent.</p>
        <div class="form-group"><label>App</label><select name="app">${options}</select></div>
        <div class="form-group"><label>Price (eb)</label><input type="number" name="price" min="0" value="${cfg.apps[apps[0]].price}"></div>
        <div class="form-group"><label>From</label><input type="text" name="contact" maxlength="40" value="Fixer" placeholder="Contact name"></div>
        <div class="form-group"><label>Note</label><input type="text" name="note" maxlength="200" placeholder="Fresh off the truck. No questions."></div>
      </form>`,
      render: html => {
        const form = html[0].querySelector("form");
        form.app.addEventListener("change", () => (form.price.value = form.app.selectedOptions[0]?.dataset.price ?? 0));
      },
      buttons: {
        ok: {
          icon: '<i class="fas fa-box"></i>', label: "Send package",
          callback: html => {
            const form = html[0].querySelector("form");
            store.request("pool-sideload", { actorId, app: form.app.value, price: Number(form.price.value) || 0, contact: form.contact.value.trim() || "Fixer", note: form.note.value });
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  },
  "pool-listing-add"() {
    const root = this.element[0];
    const field = name => root.querySelector(`[name=poolListing-${name}]`)?.value ?? "";
    const listing = cleanListing({ name: field("name"), icon: field("icon"), img: field("img"), publisher: field("publisher"), blurb: field("blurb"), note: field("note") }, foundry.utils.randomID());
    if (!listing) return ui.notifications.warn("Give the listing a name.");
    saveConfig(p => (p.listings = [...(p.listings ?? []), listing]));
  },
  "pool-listing-remove"({ id }) {
    saveConfig(p => {
      if (DEFAULT_LISTINGS.some(l => l.id === id)) p.removedListings = [...new Set([...(p.removedListings ?? []), id])];
      p.listings = (p.listings ?? []).filter(l => l.id !== id);
    });
  }
};

/* ---------------- The GM's catalogue fields ---------------- */

export const inputs = {
  "input[data-pool-price]": {
    change(event) {
      saveEntry(event.currentTarget.dataset.poolPrice, "price", Math.max(0, Math.floor(Number(event.currentTarget.value) || 0)));
    }
  },
  "input[data-pool-pre]": {
    change(event) {
      saveEntry(event.currentTarget.dataset.poolPre, "preinstalled", event.currentTarget.checked);
    }
  },
  "input[data-pool-text]": {
    change(event) {
      const { poolText: id, field } = event.currentTarget.dataset;
      if (field === "publisher") saveEntry(id, field, event.currentTarget.value.trim().slice(0, 40));
    }
  }
};

/** The GM's dropdowns: values "<appId>|<model>", "<appId>|<offer>", "<actorId>|<appId>" (install). */
export const dropdowns = {
  poolModel(value) {
    const [id, model] = String(value).split("|");
    if (id && model in MODELS) saveEntry(id, "model", model);
  },
  poolOffer(value) {
    const [id, offer] = String(value).split("|");
    if (id && offer in OFFERS) saveEntry(id, "offer", offer);
  },
  poolGrant(value) {
    const [actorId, app] = String(value).split("|");
    if (actorId && app) store.request("pool-grant", { actorId, app });
  }
};

/* ---------------- The page ---------------- */

export const methods = {
  poolData(ctx) {
    const gm = ctx.perspective === "gm";
    const cfg = cfgOf();
    const billedBy = subsBilledBy();
    const bar = appBar(POOL, { owner: gm ? null : ctx.subject.name });
    if (gm) return { gm, bar, billedBy, ...this._poolGmData(cfg) };
    const actorId = ctx.actorId;
    const installs = store.apps.installs;
    const look = appearance();
    const card = id => {
      const entry = cfg.apps[id];
      const action = storeAction(installs, actorId, id, cfg);
      const started = downloads.get(dlKey(actorId, id));
      const downloading = started ? { ms: DOWNLOAD_MS, elapsed: Math.min(DOWNLOAD_MS, Date.now() - started) } : null;
      return {
        id, name: look.names[id], icon: look.icons[id], blurb: APPS[id]?.blurb ?? "", publisher: entry.publisher,
        price: priceLabel(entry), tier: entry.model === "free" ? "" : priceTier(entry.price), citinet: !!APP_MANIFEST[id]?.citinet, action, [action]: true, preinstalled: entry.preinstalled, downloading,
        owned: action === "get" && entry.model === "once" && entry.price > 0,
        removable: !downloading && !entry.preinstalled && isInstalled(installs, actorId, id, cfg)
      };
    };
    const tab = this.poolTab in TABS ? this.poolTab : "featured";
    const subs = subscriptionsOf(installs, actorId, cfg).map(s => ({ ...s, name: look.names[s.app], icon: look.icons[s.app], price: formatMoney(s.price), lapsed: s.status === "lapsed" }));
    const listed = storeApps(installs, actorId, cfg);
    // An app still downloading stays in Featured until its download is done.
    const inFeatured = id => !isInstalled(installs, actorId, id, cfg) || downloads.has(dlKey(actorId, id));
    return {
      gm, bar, offline: !!ctx.noSignal, billedBy,
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: tab === id, count: id === "subs" ? subs.length : 0 })),
      tab: { [tab]: true },
      featured: listed.filter(inFeatured).map(card),
      have: listed.filter(id => !inFeatured(id)).map(card),
      listings: cfg.listings,
      subs,
      total: formatMoney(monthlyTotal(subscriptionsOf(installs, actorId, cfg)))
    };
  },

  /** A lapsed subscription's app: locked, with Renew (AgentPhone draws this instead of the app). */
  poolLockedData(ctx, id) {
    const row = rowsOf(store.apps.installs, ctx.actorId)[id];
    const look = appearance();
    return {
      locked: { id, name: look.names[id], icon: look.icons[id], price: formatMoney(row?.sub?.price ?? 0), billedBy: subsBilledBy() },
      bar: appBar(id, { owner: ctx.subject.name }),
      offline: !!ctx.noSignal
    };
  },

  /** The GM's lists: the catalogue, every player character's apps and subscriptions, the listings. */
  _poolGmData(cfg) {
    const look = appearance();
    const installs = store.apps.installs ?? {};
    const billedBy = subsBilledBy();
    const catalogue = APP_IDS.filter(id => id !== POOL).map(id => {
      const e = cfg.apps[id];
      return {
        id, name: look.names[id], icon: look.icons[id], on: !!feature(`app_${id}`), ...e, free: e.model === "free",
        modelPick: dropdown("poolModel", Object.entries(MODELS).map(([v, label]) => ({ value: `${id}|${v}`, label, selected: v === e.model })), { title: `${look.names[id]}: price model` }),
        offerPick: dropdown("poolOffer", Object.entries(OFFERS).map(([v, label]) => ({ value: `${id}|${v}`, label, selected: v === e.offer })), { title: `${look.names[id]}: where it's offered` })
      };
    });
    // Add-ons: only a price and a publisher (they're bought once, inside their app).
    for (const id of ADDON_IDS) {
      const e = cfg.apps[id];
      const parent = look.names[e.addon] ?? e.addon;
      catalogue.push({ id, name: ADDONS[id].name, icon: look.icons[e.addon], on: !!feature(`app_${e.addon}`), ...e, addon: parent, free: false });
    }
    const characters = playerCharacters().map(actor => {
      const rows = rowsOf(installs, actor.id);
      const canForget = id => !!rows[id] && !cfg.apps[id]?.preinstalled;
      const chip = id => ({ id, name: nameOf(id), source: SOURCES[rows[id]?.source] ?? "", paid: rows[id]?.paid > 0 ? formatMoney(rows[id].paid) : null, lapsed: isLapsed(installs, actor.id, id, cfg), canForget: canForget(id) });
      const apps = [
        ...APP_IDS.filter(id => id !== POOL && !cfg.apps[id].preinstalled && isInstalled(installs, actor.id, id, cfg)),
        ...ADDON_IDS.filter(id => hasAddon(installs, actor.id, id))
      ].map(chip);
      const revoked = Object.entries(rows).filter(([, r]) => r.revoked).map(([id, r]) => ({ id, name: nameOf(id), reason: r.revoked, canForget: canForget(id) }));
      const uninstalled = Object.entries(rows).filter(([, r]) => r.removed && !r.revoked).map(([id]) => ({ id, name: nameOf(id) }));
      const subs = subscriptionsOf(installs, actor.id, cfg).map(s => ({
        ...s, name: look.names[s.app], price: formatMoney(s.price), active: s.status === "active", lapsed: s.status === "lapsed",
        due: !billedBy && isDue(s), through: billedBy || s.sponsor ? "" : worldDate(s.paidThrough)
      }));
      const missing = [...APP_IDS.filter(id => id !== POOL && !isInstalled(installs, actor.id, id, cfg)), ...ADDON_IDS.filter(id => !hasAddon(installs, actor.id, id))];
      const due = subs.filter(s => s.due).length;
      return {
        actorId: actor.id, name: displayName(actor), apps, revoked, uninstalled, subs, due,
        billable: !billedBy && subs.some(s => s.active && !s.sponsor),
        total: formatMoney(monthlyTotal(subscriptionsOf(installs, actor.id, cfg))),
        grant: missing.length ? dropdown("poolGrant", [
          { value: "", label: "Install an app…", selected: true },
          ...missing.map(id => ({ value: `${actor.id}|${id}`, label: ADDONS[id] ? `${ADDONS[id].name} (${look.names[ADDONS[id].parent]} add-on)` : `${look.names[id]}${feature(`app_${id}`) ? "" : " (switched off)"}` }))
        ], { title: `Install an app on ${displayName(actor)}'s Agent`, cls: "agent-wide" }) : null
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      catalogue, characters, listings: cfg.listings,
      due: characters.reduce((n, c) => n + c.due, 0)
    };
  }
};

export const phone = {
  /** A lapsed subscription: the app stays installed, locked behind Renew. */
  gate(ctx, data) {
    if (!(this.app in APP_MANIFEST) || ctx.perspective !== "pc" || !poolOn() || !isLapsed(store.apps.installs, ctx.actorId, this.app)) return false;
    data.pool = this.poolLockedData(ctx, this.app);
    data.page.pool = true;
    data.appPartial = appPartial("pool");
    return true;
  }
};

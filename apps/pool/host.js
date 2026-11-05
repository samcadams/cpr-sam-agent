import { gm } from "../../scripts/host/validate.js";
import { APP_MANIFEST } from "../../scripts/apps/manifest.js";
import { canUsePhone } from "../../scripts/model/agent.js";
import { feature, noSignalSince } from "../../scripts/model/features.js";
import { formatMoney, hasWallet, MAX_AMOUNT } from "../../scripts/model/money.js";
import { MODULE_ID } from "../../scripts/config.js";
import {
  addonEffect, ADDONS, hasAddon, inStore, isDue, isInstalled, nextPaidThrough, owned, POOL, poolConfig, poolOn, priceLabel, rowsOf, storeAction, subsBilledBy, subscriptionsOf
} from "./model.js";
import { isDirect } from "../../scripts/model/threads.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: the App Store (see apps/pool/model.js). Installs are the table "installs"
 * ({ [actorId]: { [appId]: Row } }). Buying pays through BangMe! (declined: nothing installed);
 * subscribing pays the first month, unless another module bills subscriptions (handOffBilling), and the
 * GM sends later months from the App Store's GM page: nothing is charged by itself. The GM grants and revokes
 * apps per character (with an optional refund), and sideloads: a Fixer's app package in a conversation,
 * paid through the conversation's money request.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "pool-get": "_onPoolGet",
  "pool-remove": "_onPoolRemove",
  "pool-renew": "_onPoolRenew",
  "pool-cancel": "_onPoolCancel",
  "pool-pkg": "_onPoolPkg",
  "pool-grant": gm("_onPoolGrant"),
  "pool-revoke": gm("_onPoolRevoke"),
  "pool-forget": gm("_onPoolForget"),
  "pool-sub": gm("_onPoolSub"),
  "pool-bill": gm("_onPoolBill"),
  "pool-sideload": gm("_onPoolSideload")
};

const FROM = "App Store";
const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");
const appName = id => APP_MANIFEST[id]?.name ?? ADDONS[id]?.name ?? id;
/** What the GM grants and revokes: an app (not the store itself) or an add-on. */
const grantable = app => (!!APP_MANIFEST[app] && app !== POOL) || !!ADDONS[app];

export const methods = {
  /** A player's own character, with their phone on them and a signal (the App Store is on the Data Pool). */
  _poolActor(user, actorId) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !poolOn()) return null;
    if (noSignalSince(actorId)) {
      this._alertNow(actorId, { kind: "system", from: FROM, app: POOL, text: "No signal: the App Store can't reach the Net." });
      return null;
    }
    return canUsePhone(actor) ? actor : null;
  },

  /** Change one install row (`change` gets a copy, or a new row) and send it. */
  _poolRow(actorId, id, change, alerts = []) {
    const rows = { ...rowsOf(this.apps.installs, actorId) };
    const row = { ...(rows[id] ?? {}) };
    change(row);
    rows[id] = row;
    this.apps.installs[actorId] = rows;
    this._pushApps(alerts.filter(Boolean));
    if (ADDONS[id]) this._poolAddonEffect(actorId, id).catch(err => console.error(`${MODULE_ID} | ${id} effect`, err));
    return row;
  },

  /** Keep an add-on's Active Effect on the character while they have the add-on (none without one). */
  async _poolAddonEffect(actorId, id) {
    const actor = game.actors.get(actorId);
    const effect = addonEffect(id);
    if (!actor || !effect) return;
    const mine = actor.effects.filter(e => e.flags?.[MODULE_ID]?.addon === id);
    const want = hasAddon(this.apps.installs, actorId, id);
    if (!want && mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map(e => e.id));
    if (want && !mine.length) await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  },

  /** Charge a character through BangMe!, with a ledger line; false if declined (they get told). */
  async _poolCharge(actor, amount, memo, id) {
    if (!amount || !hasWallet(actor)) return true;
    if (!(await this._transfer(actor, null, amount, `${FROM}: ${memo}`))) {
      this._alertNow(actor.id, { kind: "money", from: FROM, app: POOL, text: `Declined: ${appName(id)} is ${formatMoney(amount)}.` });
      return false;
    }
    this._ledger(actor.id, -amount, memo, "pool", FROM);
    return true;
  },

  /** Get, buy or subscribe to an app from the store (or reinstall one bought before). */
  async _onPoolGet(user, { actorId, app }) {
    const actor = this._poolActor(user, actorId);
    const cfg = poolConfig();
    const entry = cfg.apps[app];
    if (!actor || !entry || app === POOL || !feature(`app_${app}`)) return;
    const row = rowsOf(this.apps.installs, actorId)[app];
    if (row?.revoked) return this._alertNow(actorId, { kind: "warning", from: FROM, app: POOL, text: `${appName(app)} can't be installed on this Agent: ${row.revoked}.` });
    // Only what the store sells, or what they had before.
    if (!inStore(app, entry) && !owned(row, entry)) return;
    const action = storeAction(this.apps.installs, actorId, app, cfg);
    if (action === "open" || action === "renew") return;
    let paid = row?.paid ?? 0;
    let sub = null;
    if (action === "buy") {
      if (!(await this._poolCharge(actor, entry.price, appName(app), app))) return;
      paid = hasWallet(actor) ? entry.price : 0;
    } else if (action === "subscribe") {
      const billed = subsBilledBy();
      if (!billed && !(await this._poolCharge(actor, entry.price, `${appName(app)}, first month`, app))) return;
      sub = { status: "active", price: entry.price, since: game.time.worldTime, paidThrough: billed ? null : nextPaidThrough(null) };
    }
    const text = action === "subscribe"
      ? `Subscribed to ${appName(app)}, ${priceLabel(entry)}.${subsBilledBy() ? ` It's on your ${subsBilledBy()} bill.` : ""}`
      : `${appName(app)} installed${action === "buy" ? ` (${formatMoney(entry.price)})` : ""}.`;
    const id = this._alert(actorId, { kind: action === "get" ? "system" : "money", from: FROM, app: POOL, text });
    this._poolRow(actorId, app, r => {
      Object.assign(r, { source: r.source ?? "store", at: Date.now(), paid });
      delete r.removed;
      if (sub) r.sub = sub;
    }, [id]);
  },

  /** Uninstall (not the preinstalled apps). A subscription is cancelled with it. */
  _onPoolRemove(user, { actorId, app }, alerts = []) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !poolOn()) return;
    const cfg = poolConfig();
    if (!cfg.apps[app] || cfg.apps[app].preinstalled || !isInstalled(this.apps.installs, actorId, app, cfg)) return;
    this._poolRow(actorId, app, r => {
      r.removed = true;
      if (r.sub) r.sub = { ...r.sub, status: "cancelled" };
    }, alerts);
  },

  /** Cancel a subscription: the app goes with it. */
  _onPoolCancel(user, msg) {
    const row = rowsOf(this.apps.installs, msg.actorId)[msg.app];
    if (!row?.sub || row.sub.status === "cancelled") return;
    const id = this._alert(msg.actorId, { kind: "money", from: FROM, app: POOL, text: `${appName(msg.app)}: subscription cancelled. No more bills.` });
    this._onPoolRemove(user, msg, [id]);
  },

  /** Renew a lapsed subscription: a month now (or the next bill, when another module bills them). */
  async _onPoolRenew(user, { actorId, app }) {
    const actor = this._poolActor(user, actorId);
    const row = rowsOf(this.apps.installs, actorId)[app];
    if (!actor || row?.sub?.status !== "lapsed" || row.revoked || row.removed) return;
    const price = Number(row.sub.price) || 0;
    const billed = subsBilledBy();
    if (!billed && !(await this._poolCharge(actor, price, `${appName(app)}, renewed`, app))) return;
    const id = this._alert(actorId, { kind: "money", from: FROM, app: POOL, text: `${appName(app)} renewed.${billed ? ` It's on your ${billed} bill.` : ""}` });
    this._poolRow(actorId, app, r => (r.sub = { ...r.sub, status: "active", paidThrough: billed ? null : nextPaidThrough(r.sub) }), [id]);
  },

  /** GM: put an app on a character's Agent, free (it also lifts a revoke, and ends a subscription: it's theirs now). */
  _onPoolGrant(user, { actorId, app }) {
    if (!game.actors.get(actorId) || !grantable(app)) return;
    const id = this._alert(actorId, { kind: "system", from: FROM, app: POOL, text: `${appName(app)} was installed on your Agent.` });
    this._poolRow(actorId, app, r => {
      Object.assign(r, { source: "gm", at: Date.now(), paid: r.paid ?? 0 });
      delete r.removed;
      delete r.revoked;
      if (r.sub) r.sub = { ...r.sub, status: "cancelled" };
    }, [id]);
  },

  /** GM: take an app off a character's Agent ("Bricked by a virus"); `refund` pays back what they paid. */
  async _onPoolRevoke(user, { actorId, app, reason, refund }) {
    const actor = game.actors.get(actorId);
    if (!actor || !grantable(app)) return;
    const row = rowsOf(this.apps.installs, actorId)[app] ?? {};
    reason = clean(reason, 80) || "Removed";
    const alerts = [this._alert(actorId, { kind: "warning", from: FROM, app: POOL, text: `${appName(app)} was removed from your Agent: ${reason}.` })];
    if (refund && row.paid > 0 && hasWallet(actor)) {
      await this._transfer(null, actor, row.paid, `${FROM}: ${appName(app)} refund`);
      this._ledger(actorId, row.paid, `${appName(app)} refund`, "pool", FROM);
      alerts.push(this._alert(actorId, { kind: "money", from: FROM, app: POOL, text: `Refunded ${formatMoney(row.paid)} for ${appName(app)}.` }));
    }
    this._poolRow(actorId, app, r => {
      r.revoked = reason;
      if (refund) r.paid = 0;
      if (r.sub) r.sub = { ...r.sub, status: "cancelled" };
    }, alerts);
  },

  /**
   * GM: forget a purchase: the install row goes, so the character no longer owns the app and must buy it again.
   * Unlike a revoke it leaves no marker, unlike an uninstall no free reinstall. Nothing is refunded.
   * Preinstalled apps stay theirs.
   */
  _onPoolForget(user, { actorId, app }) {
    const rows = { ...rowsOf(this.apps.installs, actorId) };
    if (!game.actors.get(actorId) || !rows[app] || poolConfig().apps[app]?.preinstalled) return;
    const had = isInstalled(this.apps.installs, actorId, app) || hasAddon(this.apps.installs, actorId, app);
    const alert = had ? this._alert(actorId, { kind: "warning", from: FROM, app: POOL, text: `${appName(app)} was removed from your Agent.` }) : null;
    delete rows[app];
    this.apps.installs[actorId] = rows;
    this._pushApps([alert].filter(Boolean));
    if (ADDONS[app]) this._poolAddonEffect(actorId, app).catch(err => console.error(`${MODULE_ID} | ${app} effect`, err));
  },

  /**
   * GM: change a subscription: `status` ("active", "lapsed", "cancelled"), `sponsor` (a name: never
   * billed; "" or null: billed), `notify` (an alert to send).
   */
  _onPoolSub(user, { actorId, app, status, sponsor, notify }) {
    const row = rowsOf(this.apps.installs, actorId)[app];
    if (!row?.sub) return;
    const alerts = [];
    // Without the GM's own note, a lapse or cancel still tells the character.
    const said = { lapsed: `${appName(app)}: subscription lapsed. Renew in the App Store.`, cancelled: `${appName(app)}: subscription cancelled.` };
    const text = clean(notify, 300) || (status !== row.sub.status ? said[status] : null);
    if (text) alerts.push(this._alert(actorId, { kind: "money", from: FROM, app: POOL, text }));
    this._poolRow(actorId, app, r => {
      const sub = { ...r.sub };
      if (["active", "lapsed", "cancelled"].includes(status)) sub.status = status;
      // Active again while another module bills: that module's bill, not an old month (see _tickPool).
      if (sub.status === "active" && r.sub.status !== "active" && subsBilledBy()) sub.paidThrough = null;
      if (sponsor !== undefined) sub.sponsor = clean(sponsor, 40) || null;
      if (sub.status === "cancelled") r.removed = true;
      r.sub = sub;
    }, alerts);
  },

  /**
   * GM: send a character their subscriptions bill: every active one they pay for (`all`), or only those
   * whose month ran out. One BangMe! payment, itemised in the receipt; if they can't pay, those lapse.
   */
  async _onPoolBill(user, { actorId, all = false, skip = [] }) {
    const actor = game.actors.get(actorId);
    if (!actor || subsBilledBy()) return;
    const subs = subscriptionsOf(this.apps.installs, actorId).filter(s => (all ? s.status === "active" && !s.sponsor : isDue(s)) && !skip.includes(s.app));
    const total = subs.reduce((n, s) => n + s.price, 0);
    if (!subs.length) return;
    const lines = subs.map(s => `${appName(s.app)} ${formatMoney(s.price)}`).join(", ");
    const paid = !total || !hasWallet(actor) || (await this._transfer(actor, null, total, `${FROM}: subscriptions`));
    const rows = { ...rowsOf(this.apps.installs, actorId) };
    for (const s of subs) {
      const sub = { ...rows[s.app].sub };
      if (paid) sub.paidThrough = nextPaidThrough(sub);
      else sub.status = "lapsed";
      rows[s.app] = { ...rows[s.app], sub };
    }
    this.apps.installs[actorId] = rows;
    if (paid && total && hasWallet(actor)) this._ledger(actorId, -total, `Subscriptions: ${lines}`, "pool", FROM);
    const text = paid ? `Monthly subscriptions: ${lines}. Total ${formatMoney(total)}.` : `Declined: subscriptions of ${formatMoney(total)} (${lines}). They've lapsed until you renew.`;
    this._pushApps([this._alert(actorId, { kind: "money", from: FROM, app: POOL, text })]);
  },

  /** The clock (host/clock.js): billing handed back by another module, the Agent bills from a month from now. */
  _tickPool() {
    if (subsBilledBy()) return;
    let changed = false;
    for (const [actorId, rows] of Object.entries(this.apps.installs)) {
      const handed = Object.entries(rows).filter(([, r]) => r.sub?.status === "active" && !r.sub.sponsor && !r.removed && !r.revoked && r.sub.paidThrough == null);
      if (!handed.length) continue;
      const next = { ...rows };
      for (const [app, r] of handed) next[app] = { ...r, sub: { ...r.sub, paidThrough: nextPaidThrough(null) } };
      this.apps.installs[actorId] = next;
      changed = true;
    }
    if (changed) this._pushApps();
  },

  /**
   * GM: a Fixer's app package in a conversation (as `contact`, created if needed): the app, and a money
   * request for `price` (none when it's free: the player taps Install). Paying installs it (see
   * _poolPkgPaid, from host/money.js).
   */
  async _onPoolSideload(user, { actorId, contact, app, price, note, threadId }) {
    const actor = game.actors.get(actorId);
    if (!actor || !APP_MANIFEST[app] || app === POOL) return;
    price = Math.floor(Number(price) || 0);
    if (price < 0 || price > MAX_AMOUNT) return;
    const thread = await this._gmDirect({ threadId, actorId, contact: contact || "Fixer" });
    if (!thread) return;
    const pkg = { app, name: appName(app), price, status: "offered" };
    const money = price ? { kind: "request", amount: price, status: "pending" } : undefined;
    const text = clean(note, 200) || `App package: ${pkg.name}${price ? `, ${formatMoney(price)}` : ""}.`;
    const message = this._message("contact", text, { userId: user.id, pkg, ...(money ? { money } : {}) });
    thread.lastRead.gm = message.ts;
    this._postMoney(thread, message);
  },

  /** A package's money request was paid (host/money.js): install it. */
  _poolPkgPaid(thread, message) {
    if (!message.pkg || message.pkg.status !== "offered") return;
    this._poolInstallPkg(thread, message, message.pkg.price);
  },

  /** A package's request was declined or cancelled (host/money.js). */
  _poolPkgClosed(thread, message) {
    if (message.pkg?.status === "offered") message.pkg.status = "declined";
  },

  /** A free package: the player taps Install. */
  _onPoolPkg(user, { threadId, messageId }) {
    const thread = this.threads.get(threadId);
    const message = thread?.messages.find(m => m.id === messageId);
    if (!isDirect(thread) || !message?.pkg || message.pkg.status !== "offered" || message.money) return;
    const actor = game.actors.get(thread.actorId);
    if (!actor || user.isGM || !owns(user, actor) || !canUsePhone(actor)) return;
    this._poolInstallPkg(thread, message, 0);
    this.save();
    this._push(thread);
  },

  _poolInstallPkg(thread, message, paid) {
    const { app } = message.pkg;
    message.pkg.status = "installed";
    this._poolInstallFrom(thread.actorId, app, { source: "sideload", paid, text: `${appName(app)} sideloaded from ${thread.contact}.` });
  },

  /** Install an app that came from outside the store (a sideload, CBK), with what was paid for it. */
  _poolInstallFrom(actorId, app, { source, paid = 0, text, quiet = false }) {
    // `quiet`: the caller tells the character itself (CBK's own "Bought" alert).
    const id = quiet ? null : this._alert(actorId, { kind: "system", from: FROM, app: POOL, text: text ?? `${appName(app)} was installed on your Agent.` });
    this._poolRow(actorId, app, r => {
      Object.assign(r, { source, at: Date.now(), paid: (r.paid ?? 0) + paid });
      delete r.removed;
      delete r.revoked;
    }, [id]);
  }
};

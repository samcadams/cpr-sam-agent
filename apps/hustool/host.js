import { gm } from "../../scripts/host/validate.js";
import { formatMoney } from "../../scripts/model/money.js";
import { feature } from "../../scripts/model/features.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp, worldClock } from "../../scripts/util/agentTime.js";
import { rollCard } from "../../scripts/util/cpr-roll.js";
import { esc } from "../../scripts/util/text.js";
import { isInstalled, isLapsed, poolOn } from "../pool/model.js";
import { closeCall, encounterTable, FROM, gigDays, hasVehicle, hustlesIn, HUSTOOL, hustoolConfig, latestGigs, outcomeOf, PUBLISHER, runningIn, SOUR, timeOfDay } from "./model.js";

/*
 * Host: HusTool (see apps/hustool/model.js). The hustles a settled cpr-hq round banks, PAY ME spending one, the d10,
 * the pay, and the GM's side: trouble on a 10.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "hustool-payme": "_onHustoolPayme",
  "hustool-trouble": gm("_onHustoolTrouble"),
  "hustool-gig": "_onHustoolGig",
  "hustool-gig-day": "_onHustoolGigDay",
  "hustool-settled": gm("_onHustoolSettled")
};

const card = (title, body, extra = {}) => ({ title, body, icon: "fa-bolt", open: { app: "hustool" }, ...extra });

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

/** Who sees a character's HusTool rolls, besides the GMs. */
const players = actor => game.users.filter(u => !u.isGM && owns(u, actor)).map(u => u.id);

const pad = n => String(n).padStart(2, "0");

/** The phone's { time, date } at a moment of a downtime round; while the phones don't run on world time, plain labels. */
function gigStamp(start, day, hour, minute) {
  const at = worldClock() ? agentTimestamp(start + day * 86400 + hour * 3600 + minute * 60) : {};
  return { time: at.time ?? `${pad(hour)}:${pad(minute)}`, date: at.date ?? `Downtime day ${day + 1}` };
}

export const methods = {
  /** PAY ME: spends the character's next banked hustle, if they aren't on one. */
  _onHustoolPayme(user, { actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !this._citinet(actor, "hustool", FROM)) return;
    const row = latestGigs(this.apps.hustoolGigs, actorId);
    const [next] = hustlesIn(row);
    if (!next || runningIn(row)) return;
    next.status = "running";
    this._pushApps();
  },

  /**
   * A 10: the GM's card, to play out the encounter (draw from the world's table if it has one) or wave it off.
   * `gig` ({ gig: rowId, day }): where the trouble is kept (row.gm.troubleDays).
   */
  _hustoolTroubleCard(row, hour, gig) {
    row.gm.trouble = "pending";
    row.gm.hour = hour;
    const table = encounterTable(game.tables, { district: row.district, hour });
    const where = [row.onDay, row.district, timeOfDay(hour)].filter(Boolean).join(", ");
    const actions = [
      ...(table ? [{ label: "Draw", icon: "fa-dice", request: "hustool-trouble", data: { id: row.id, play: true, draw: true, ...gig } }] : []),
      { label: "Play it out", icon: "fa-skull", request: "hustool-trouble", data: { id: row.id, play: true, ...gig } },
      { label: "Wave off", icon: "fa-hand", request: "hustool-trouble", data: { id: row.id, play: false, ...gig } }
    ];
    this._gmCard(card(`HusTool trouble: ${displayName(game.actors.get(row.actorId))}`, `Rolled a 10 on "${row.text}"${where ? ` (${where})` : ""}. Paid, but they run into trouble.`, {
      id: `hustool-trouble:${row.id}`, urgent: true, actions
    }));
  },

  /**
   * GM: trouble played out (a whispered chat card with what happened where; `draw`: from the world's encounter
   * table) or waved off (it stays paid, no encounter).
   */
  async _onHustoolTrouble(user, { play, draw, gig, day }) {
    const row = this.apps.hustoolGigs[gig]?.gm?.troubleDays?.[day];
    if (row?.gm?.trouble !== "pending") return;
    row.gm.trouble = play ? "played" : "waved";
    this._gmCardDone(`hustool-trouble:${row.id}`);
    this._pushApps();
    if (!play) return;
    const actor = game.actors.get(row.actorId);
    const tod = timeOfDay(row.gm.hour);
    const table = encounterTable(game.tables, { district: row.district, hour: row.gm.hour });
    const where = [row.onDay, row.district, tod && `${tod}, ${row.time}`].filter(Boolean).join(" · ");
    const how = table ? `Encounter table: @UUID[${table.uuid}]{${esc(table.name)}}` : "Roll on the Encounter Table for the area and time of day (CP:R p. 417).";
    await ChatMessage.create({
      speaker: { alias: FROM },
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<p><b>HusTool trouble:</b> ${esc(displayName(actor))} on "${esc(row.text)}"${where ? ` (${esc(where)})` : ""}.</p><p>${how}</p>`
    });
    if (draw && table) await table.draw({ rollMode: "gmroll" });
  },

  /**
   * A cpr-hq round settled (client.js; any GM's client sends it here): what's still open from earlier rounds expires,
   * then each character with HusTool banks this round's hustles, once. Reads the schedule from cpr-hq's history flag.
   */
  _onHustoolSettled(user, { roundId, actorIds }) {
    if (!roundId || !Array.isArray(actorIds)) return;
    const rows = this.apps.hustoolGigs;
    for (const row of Object.values(rows)) {
      if (row.roundId === roundId) continue;
      for (const day of row.days) for (const errand of day.errands) if (["open", "running"].includes(errand.status)) errand.status = "expired";
    }
    const config = hustoolConfig();
    const alerts = [];
    for (const actorId of actorIds) {
      const actor = game.actors.get(actorId);
      const id = `${roundId}-${actorId}`;
      if (!actor || rows[id] || !this._hasHustool(actorId)) continue;
      const entry = (actor.getFlag("cpr-hq", "downtimeHistory") ?? []).find(e => e.roundId === roundId);
      if (!entry) continue;
      const days = gigDays(entry, config, { vehicle: hasVehicle(actor), stamp: (day, hour, minute) => gigStamp(entry.start, day, hour, minute) });
      const count = days.reduce((sum, d) => sum + d.errands.length, 0);
      if (!count) continue;
      rows[id] = { id, roundId, actorId, ts: Date.now(), days, gm: { troubleDays: {} } };
      alerts.push(this._alert(actorId, { kind: "event", from: FROM, app: HUSTOOL, text: `${count} hustle${count === 1 ? "" : "s"} ready. Hit PAY ME.` }));
    }
    this._pushApps(alerts);
  },

  /** Is HusTool on this character's Agent (the same answer as api.pool.has)? */
  _hasHustool(actorId) {
    if (!poolOn()) return !!feature(`app_${HUSTOOL}`);
    return isInstalled(this.apps.installs, actorId, HUSTOOL) && !isLapsed(this.apps.installs, actorId, HUSTOOL);
  },

  /** A gig's d10: its outcome and pay, and the day's one trouble card on its first 10. Returns the pay. */
  _hustoolGigResult(row, day, errand, roll, config) {
    let status = outcomeOf(roll, config);
    if (status === "trouble" && row.gm.troubleDays[day.day]) {
      status = "paid";
      errand.flavor = closeCall(errand);
    }
    if (status === "sour") errand.flavor = SOUR[Math.floor(Math.random() * SOUR.length)];
    Object.assign(errand, { status, roll, pay: status === "sour" ? 0 : config.pay });
    if (status === "trouble") {
      const trouble = { id: errand.id, actorId: row.actorId, text: errand.text, district: errand.district, time: errand.time, onDay: day.date, gm: {} };
      row.gm.troubleDays[day.day] = trouble;
      this._hustoolTroubleCard(trouble, errand.hour, { gig: row.id, day: day.day });
    }
    return errand.pay;
  },

  /** Pay resolved errands of one downtime day at once; a BangMe! row each, dated on that day. Returns the total. */
  async _hustoolGigPay(actor, day, errands) {
    const paid = errands.filter(e => e.pay);
    const total = paid.reduce((sum, e) => sum + e.pay, 0);
    if (!total) return 0;
    const what = paid.length === 1 ? paid[0].text : `${paid.length} errands`;
    await this._transfer(null, actor, total, `HusTool: ${what} (${day.date})`);
    for (const e of paid) this._ledger(actor.id, e.pay, e.text, "hustool", PUBLISHER, { time: e.time, date: day.date });
    return total;
  },

  /** The hustle the character is on: complete (Done: the d10, whispered; pays at once) or skip (Bail: no roll, no pay). */
  async _onHustoolGig(user, { rowId, errandId, action }) {
    const row = this.apps.hustoolGigs[rowId];
    const actor = game.actors.get(row?.actorId);
    if (!row || !owns(user, actor)) return;
    const day = row.days.find(d => d.errands.some(e => e.id === errandId));
    const errand = day?.errands.find(e => e.id === errandId);
    if (errand?.status !== "running") return;
    if (action === "skip") {
      errand.status = "skipped";
      return this._pushApps();
    }
    if (action !== "complete") return;
    errand.status = "rolling";
    let roll;
    try {
      roll = await rollCard("1d10", "HusTool", { speaker: ChatMessage.getSpeaker({ actor }), flavor: `HusTool: ${errand.text} (${day.date})`, whisper: players(actor) });
    } catch (err) {
      errand.status = "running";
      throw err;
    }
    this._hustoolGigResult(row, day, errand, roll, hustoolConfig());
    const paid = await this._hustoolGigPay(actor, day, [errand]);
    this._pushApps([this._alert(actor.id, paid
      ? { kind: "money", from: FROM, app: HUSTOOL, text: `${errand.text}: paid ${formatMoney(paid)}.` }
      : { kind: "event", from: FROM, app: HUSTOOL, text: `${errand.text}: went sour. ${errand.flavor}` })]);
  },

  /** Complete all of a downtime day: one roll per errand, one whispered summary card for the lot (no card per errand). */
  async _onHustoolGigDay(user, { rowId, day: index }) {
    const row = this.apps.hustoolGigs[rowId];
    const actor = game.actors.get(row?.actorId);
    const day = row?.days.find(d => d.day === Number(index));
    if (!day || !owns(user, actor)) return;
    const open = day.errands.filter(e => e.status === "open");
    if (!open.length) return;
    for (const errand of open) errand.status = "rolling";
    let rolls;
    try {
      rolls = await Promise.all(open.map(() => rollCard("1d10", "HusTool", { chat: false })));
    } catch (err) {
      for (const errand of open) errand.status = "open";
      throw err;
    }
    const config = hustoolConfig();
    open.forEach((errand, i) => this._hustoolGigResult(row, day, errand, rolls[i], config));
    const paid = await this._hustoolGigPay(actor, day, open);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: [...new Set([...game.users.filter(u => u.isGM).map(u => u.id), ...players(actor)])],
      content: `<p><b>HusTool, ${esc(day.date)}:</b> ${open.length} errand${open.length === 1 ? "" : "s"}, rolled ${rolls.join(", ")}. Paid ${formatMoney(paid)}.</p>`
    });
    this._pushApps([this._alert(actor.id, { kind: "money", from: FROM, app: HUSTOOL, text: `${day.date}: ${open.length} errand${open.length === 1 ? "" : "s"} done, paid ${formatMoney(paid)}.` })]);
  }
};

import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { canReachPayPoint } from "../bangme/model.js";
import {
  ACTIVE, bufferFor, canBreach, canPick, cleanPoint, ENDINGS, GRACE_MS, gridEnd, gridOf, interfaceRank, newSeed, outcome, pointFor, rollOutcome,
  secondsFor, timeLeft
} from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Host: BREACH (see apps/breach/model.js). The GM's Breach Points (app table breachPoints; their daemons' outcomes
 * stay GM-only), and every breach (app table breaches): a character asks for a point near them (the GM
 * approves or turns it down) or the GM sends one; the character's Backdoor roll locks them out or opens the
 * grid (buffer from the margin, time from Interface); the host checks each pick against the seeded grid and
 * keeps the clock (server time; a timer ends a run when its time is up, the app clock as a backstop). The
 * GM can pause, add time, spike the trace (take time away) or cut a breach off. At the end the GM gets a chat
 * card (whispered) with each uploaded daemon's outcome to resolve by hand; nothing applies itself.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "breach-ask": "_onBreachAsk",
  "breach-cancel": "_onBreachCancel",
  "breach-roll": "_onBreachRoll",
  "breach-pick": "_onBreachPick",
  "breach-quick": "_onBreachQuick",
  "breach-quit": "_onBreachQuit",
  "breach-point-save": gm("_onBreachPointSave"),
  "breach-point-delete": gm("_onBreachPointDelete"),
  "breach-send": gm("_onBreachSend"),
  "breach-approve": gm("_onBreachApprove"),
  "breach-deny": gm("_onBreachDeny"),
  "breach-pause": gm("_onBreachPause"),
  "breach-time": gm("_onBreachTime"),
  "breach-end": gm("_onBreachEnd")
};

const FROM = "BREACH";
/** Breaches kept per character (finished ones; the oldest go first). */
const MAX_RUNS = 30;
/** The GM's time buttons go this far either way at once. */
const MAX_STEP_S = 60;

const now = () => game.time.serverTime ?? Date.now();
const esc = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export const methods = {
  /* ---------------- The GM's Breach Points ---------------- */

  _onBreachPointSave(user, { point }) {
    const old = this.apps.breachPoints[point?.id];
    const next = cleanPoint({ ...point, used: point?.used ?? old?.used, ts: old?.ts }, { clean, randomID: () => foundry.utils.randomID() });
    this.apps.breachPoints[next.id] = next;
    this._pushApps();
  },

  _onBreachPointDelete(user, { pointId }) {
    if (!this.apps.breachPoints[pointId]) return;
    delete this.apps.breachPoints[pointId];
    this._pushApps();
  },

  /* ---------------- Starting a breach ---------------- */

  /** A new breach row for a character at a point (not saved yet). */
  _breachRow(actorId, point, via, status) {
    const { time, date } = agentTimestamp();
    const run = {
      id: foundry.utils.randomID(), actorId, pointId: point.id, name: point.name, dv: point.dv, size: point.size,
      daemons: point.daemons.map(({ id, name, len }) => ({ id, name, len })), via, status, picks: [], ts: Date.now(), time, date
    };
    this.apps.breaches[run.id] = run;
    const mine = Object.values(this.apps.breaches).filter(r => r.actorId === actorId && !ACTIVE.has(r.status)).sort((a, b) => a.ts - b.ts);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_RUNS))) delete this.apps.breaches[old.id];
    return run;
  },

  /** The character's breach that's still going, if any. */
  _breachActive(actorId) {
    return Object.values(this.apps.breaches).find(r => r.actorId === actorId && ACTIVE.has(r.status)) ?? null;
  },

  /** A player asks to breach a point near them: the GM approves or turns it down. */
  _onBreachAsk(user, { actorId, pointId }) {
    const actor = game.actors.get(actorId);
    const point = this.apps.breachPoints[pointId];
    if (!actor || user.isGM || !actor.testUserPermission(user, "OWNER") || !pointFor(point, actorId)) return;
    if (!canBreach(actor).ok || !canReachPayPoint(point, actor) || this._breachActive(actorId)) return;
    const run = this._breachRow(actorId, point, "ask", "asked");
    this._gmCard({
      id: `breach:${run.id}`,
      title: `BREACH: ${displayName(actor)}`,
      body: `Wants to breach ${point.name} (DV ${point.dv}).`,
      icon: "fa-microchip",
      open: { app: "breach" },
      actions: [
        { label: "Allow", icon: "fa-check", request: "breach-approve", data: { runId: run.id } },
        { label: "Refuse", icon: "fa-xmark", request: "breach-deny", data: { runId: run.id } }
      ]
    });
    this._pushApps();
  },

  /** GM: send a breach straight to a character's phone ("You're jacked into the access panel"). */
  _onBreachSend(user, { actorId, pointId }) {
    const actor = game.actors.get(actorId);
    const point = this.apps.breachPoints[pointId];
    if (!actor || !point || point.used) return;
    const old = this._breachActive(actorId);
    if (old) this._breachClose(old, "gm", { quiet: true });
    const run = this._breachRow(actorId, point, "gm", "approved");
    this._pushApps([this._alert(actorId, { kind: "event", from: FROM, app: "breach", text: `Jacked in: ${point.name}. Roll Backdoor (DV ${point.dv}) to breach.` })].filter(Boolean));
    return run;
  },

  _onBreachApprove(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (run?.status !== "asked") return;
    run.status = "approved";
    this._gmCardDone(`breach:${runId}`);
    this._pushApps([this._alert(run.actorId, { kind: "event", from: FROM, app: "breach", text: `Access point open: ${run.name}. Roll Backdoor to breach.` })].filter(Boolean));
  },

  _onBreachDeny(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (run?.status !== "asked") return;
    run.status = "denied";
    this._gmCardDone(`breach:${runId}`);
    this._pushApps([this._alert(run.actorId, { kind: "warning", from: FROM, app: "breach", text: `No way in at ${run.name}.` })].filter(Boolean));
  },

  /** The player drops a breach they haven't started (asked, approved, or a grid they never touched). */
  _onBreachCancel(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (!run || !game.actors.get(run.actorId)?.testUserPermission(user, "OWNER")) return;
    if (run.status === "asked" || run.status === "approved") {
      delete this.apps.breaches[runId];
      this._gmCardDone(`breach:${runId}`);
      return this._pushApps();
    }
    if (run.status === "ready") this._breachClose(run, "jackout");
  },

  /**
   * The Backdoor roll (the cyberdeck's Interface ability, rolled on the player's client with the sheet's own
   * roll; see apps/breach/page.js): `total`, `detail` and its roll card's `messageId`, taken only if that
   * player just posted that card. Under the DV: locked out. Over it: the grid.
   */
  async _onBreachRoll(user, { runId, total, detail, messageId }) {
    const run = this.apps.breaches[runId];
    const actor = game.actors.get(run?.actorId);
    if (!run || run.status !== "approved" || !actor?.testUserPermission(user, "OWNER") || !canBreach(actor).ok) return;
    total = Math.floor(Number(total));
    let card = game.messages.get(messageId);
    if (!card) card = await new Promise(r => setTimeout(() => r(game.messages.get(messageId)), 1500));
    const fresh = card && (card.author ?? card.user)?.id === user.id && Date.now() - (card.timestamp ?? 0) < 120_000;
    if (!fresh || !Number.isFinite(total) || total < -20 || total > 80 || run.status !== "approved") return;
    run.roll = { total, detail: clean(detail, 200) };
    if (total < run.dv) {
      run.status = "locked";
      run.result = { uploaded: [], failed: run.daemons.map(d => d.id), why: "locked", mode: "roll" };
      await this._breachCard(run, actor);
      return this._pushApps();
    }
    run.status = "ready";
    run.buffer = bufferFor(total - run.dv);
    run.timeMs = secondsFor(interfaceRank(actor)) * 1000;
    run.seed = newSeed();
    run.pausedMs = 0;
    this._pushApps();
  },

  /* ---------------- The grid ---------------- */

  /** A pick. The first one starts the clock; each is checked against the seeded grid. */
  _onBreachPick(user, { runId, cell }) {
    const run = this.apps.breaches[runId];
    if (!run || (run.status !== "ready" && run.status !== "running") || !game.actors.get(run.actorId)?.testUserPermission(user, "OWNER")) return;
    if (run.pausedAt) return;
    const t = now();
    if (run.status === "running" && timeLeft(run, t - GRACE_MS) <= 0) return this._breachClose(run, "time");
    const grid = gridOf(run);
    if (!canPick(grid, run.picks, cell, run.buffer)) return;
    if (run.status === "ready") {
      run.status = "running";
      run.startedAt = t;
    }
    run.picks = [...run.picks, cell];
    const end = gridEnd(grid, run.picks, run.buffer);
    if (end) return this._breachClose(run, end);
    this._breachTimer(run);
    this._pushApps();
  },

  /** "Just roll it": a successful roll settles the breach without the grid. */
  _onBreachQuick(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (run?.status !== "ready" || !game.actors.get(run.actorId)?.testUserPermission(user, "OWNER")) return;
    this._breachClose(run, "roll");
  },

  /** The runner jacks out (whatever's uploaded so far counts). */
  _onBreachQuit(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (!run || (run.status !== "ready" && run.status !== "running") || !game.actors.get(run.actorId)?.testUserPermission(user, "OWNER")) return;
    this._breachClose(run, "jackout");
  },

  /* ---------------- The GM steps in ---------------- */

  _onBreachPause(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (run?.status !== "running") return;
    const t = now();
    if (run.pausedAt) {
      run.pausedMs = (run.pausedMs ?? 0) + (t - run.pausedAt);
      run.pausedAt = null;
    } else run.pausedAt = t;
    this._breachTimer(run);
    this._pushApps();
  },

  /** Extra time (+), or a trace spike (−). */
  _onBreachTime(user, { runId, seconds }) {
    const run = this.apps.breaches[runId];
    if (run?.status !== "ready" && run?.status !== "running") return;
    const s = Math.max(-MAX_STEP_S, Math.min(MAX_STEP_S, Math.round(Number(seconds) || 0)));
    if (!s) return;
    run.timeMs = Math.max(1000, run.timeMs + s * 1000);
    if (run.status === "running" && timeLeft(run, now()) <= 0) return this._breachClose(run, "time");
    this._breachTimer(run);
    this._pushApps();
  },

  _onBreachEnd(user, { runId }) {
    const run = this.apps.breaches[runId];
    if (!run || !ACTIVE.has(run.status)) return;
    if (run.status === "asked" || run.status === "approved") {
      run.status = "denied";
      return this._pushApps();
    }
    this._breachClose(run, "gm");
  },

  /* ---------------- The clock ---------------- */

  /** (Re)arm the timer that ends a running breach when its time is up. */
  _breachTimer(run) {
    this._breachTimers ??= new Map();
    clearTimeout(this._breachTimers.get(run.id));
    this._breachTimers.delete(run.id);
    if (run.status !== "running" || run.pausedAt) return;
    const left = timeLeft(run, now());
    this._breachTimers.set(run.id, setTimeout(() => this._enqueue(() => this._breachExpire(run.id)), left + GRACE_MS));
  },

  _breachExpire(runId) {
    const run = this.apps.breaches[runId];
    if (run?.status === "running" && !run.pausedAt && timeLeft(run, now() - GRACE_MS) <= 0) return this._breachClose(run, "time");
    if (run?.status === "running") this._breachTimer(run);
  },

  /** The app clock: a backstop for runs whose timer went away (a reload, a new host). */
  async _tickBreach() {
    for (const run of Object.values(this.apps.breaches ?? {})) {
      if (run.status === "running" && !run.pausedAt && !this._breachTimers?.has(run.id)) await this._breachExpire(run.id);
    }
  },

  /* ---------------- The end ---------------- */

  /**
   * End a breach: `why` is an ENDINGS key. The grid's outcome (or the roll's, for "Just roll it"), a single-use
   * point used up, and the GM's chat card. `quiet`: no card (a breach replaced by a new one the GM sent).
   */
  async _breachClose(run, why, { quiet = false } = {}) {
    clearTimeout(this._breachTimers?.get(run.id));
    this._breachTimers?.delete(run.id);
    const lens = run.daemons.map(d => d.len);
    const played = why !== "roll" && run.seed !== undefined;
    const { uploaded, failed } = played ? outcome(gridOf(run), run.picks, run.buffer) : run.buffer ? rollOutcome(lens, run.buffer) : { uploaded: [], failed: lens.map((_, i) => i) };
    run.status = "done";
    run.endedAt = now();
    if (run.startedAt && !run.pausedAt) run.left = timeLeft(run, run.endedAt);
    run.pausedAt = null;
    run.result = { uploaded: uploaded.map(i => run.daemons[i].id), failed: failed.map(i => run.daemons[i].id), why, mode: played ? "grid" : "roll" };
    const point = this.apps.breachPoints[run.pointId];
    if (point?.single && uploaded.length) point.used = true;
    const actor = game.actors.get(run.actorId);
    if (!quiet && actor) await this._breachCard(run, actor);
    this._pushApps();
  },

  /** The GM's chat card for a finished (or locked-out) breach: what to resolve, by hand. Whispered to GMs. */
  async _breachCard(run, actor) {
    const point = this.apps.breachPoints[run.pointId];
    const effect = id => point?.effects?.[id] || "(no outcome written)";
    const name = id => run.daemons.find(d => d.id === id)?.name ?? "Daemon";
    const who = displayName(actor);
    const roll = run.roll ? ` · Backdoor ${run.roll.total} vs DV ${run.dv}` : "";
    let body;
    let summary;
    if (run.status === "locked") {
      summary = `${who} was locked out of ${run.name}.`;
      body = `<p><b>ACCESS DENIED.</b> The roll missed the DV: no grid. Does anything notice?</p>`;
    } else {
      const { uploaded, failed, why, mode } = run.result;
      const up = uploaded.map(id => `<li><b>${esc(name(id))}</b>: ${esc(effect(id))}</li>`).join("");
      const down = failed.map(id => `<li>${esc(name(id))}</li>`).join("");
      const how = mode === "roll" ? "Settled on the roll (no grid)" : `${ENDINGS[why] ?? why} (buffer ${run.picks.length}/${run.buffer})`;
      const traced = !uploaded.length && (why === "time" || why === "buffer" || why === "out" || why === "stuck");
      summary = `${who} breached ${run.name}: ${uploaded.length} of ${run.daemons.length} daemons uploaded.`;
      body = `<p>${esc(how)}.</p>`
        + (up ? `<p>Uploaded (resolve by hand):</p><ul>${up}</ul>` : "<p>Nothing uploaded.</p>")
        + (down ? `<p>Failed:</p><ul>${down}</ul>` : "")
        + (traced ? "<p><b>Trace spotted.</b> Your call: an alarm, a NetWatch message, Black ICE…</p>" : "");
    }
    this._gmCard({ title: `BREACH: ${who}`, body: summary, icon: "fa-microchip", open: { app: "breach" } });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      flavor: `BREACH: ${esc(run.name)}${roll}`,
      content: `<div class="agent-breach-card">${body}</div>`,
      flags: { [MODULE_ID]: { breach: run.id } }
    });
  }
};

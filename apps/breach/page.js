import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { anchorDocument, anchorKey, anchorName, anchorOptions, canReachPayPoint, parseAnchorKey } from "../bangme/model.js";
import {
  ACTIVE, bufferCodes, canBreach, canPick, clockText, colOf, cyberdeckOf, DAEMON_LEN, DAEMON_PRESETS, daemonStates, ENDINGS, gridEnd, gridOf,
  lineAfter, MAX_DAEMONS, netRoleOf, openCells, outcome, pointFor, practiceRun, rowOf, SIZES, timeLeft
} from "./model.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";

/*
 * Phone page: BREACH (see apps/breach/model.js, apps/breach/host.js). Players: the Breach Points near them (ask the GM
 * to breach one), a breach the GM sent, the Backdoor roll (the cyberdeck's Interface ability, the sheet's own
 * roll), then the grid: a code matrix, the buffer and the daemons, as 2077's. Picks are buttons; the line to
 * pick from is outlined and read out; arrow keys move along it. The time starts on the first pick. "Just roll
 * it" settles a breach on the roll alone. Practice grids for anyone, any time (even in combat), with nothing at stake
 * (kept on the phone; the host never hears of them). The GM Phone: breaches going on (allow or refuse asks;
 * pause, more time, trace spike, cut off), the Breach Points (edit, send to a character) and recent results.
 * Methods, click actions (data-action), inputs and dropdowns are installed onto AgentPhone.
 */

/** Finished breaches stay on the player's screen this long, until they're dismissed. */
const SHOW_DONE_MS = 30 * 60_000;
/** Longest wait for Dice So Nice to land the roll (ms). */
const DICE_WAIT = 8000;

const serverNow = () => game.time.serverTime ?? Date.now();
const actorOf = phone => phone.context()?.subject?.actor ?? null;


/** A blank Breach Point for the editor. */
function newDraft() {
  const id = foundry.utils.randomID();
  return {
    id, name: "", dv: 13, size: 6, everyone: true, actorIds: [], anchor: null, range: null, single: false, isNew: true,
    daemons: [{ id: foundry.utils.randomID(), name: "Backdoor", len: 2 }],
    effects: {}
  };
}

/* ---------------- Click actions ---------------- */

export const actions = {
  "breach-ask"({ pointId }) {
    const actor = actorOf(this);
    if (actor) store.request("breach-ask", { actorId: actor.id, pointId });
  },
  "breach-cancel"({ runId }) {
    store.request("breach-cancel", { runId });
  },
  "breach-roll"({ runId }) {
    return this._breachRoll(runId);
  },
  "breach-pick"({ cell }, event) {
    // Picked from the keyboard (a click from Enter or Space has no mouse detail): keep the focus on the grid.
    this._brKeys = event?.detail === 0;
    this._breachPick(Number(cell));
  },
  "breach-quick"({ runId }) {
    Dialog.confirm({
      title: "BREACH",
      content: "<p>Settle this breach on your roll alone, without playing the grid?</p><p class=\"notes\">You upload the daemons in order while they fit your buffer end to end.</p>",
      yes: () => store.request("breach-quick", { runId })
    });
  },
  "breach-quit"({ runId }) {
    if (this.brPractice && !runId) return this._breachPracticeEnd("jackout");
    store.request("breach-quit", { runId });
  },
  "breach-dismiss"({ runId }) {
    (this._brSeen ??= new Set()).add(runId);
    this.render();
  },
  "breach-practice"() {
    this.brPractice = practiceRun();
    this.render();
  },
  "breach-practice-close"() {
    this.brPractice = null;
    this.render();
  },

  /* GM: breaches going on. */
  "breach-approve"({ runId }) {
    store.request("breach-approve", { runId });
  },
  "breach-deny"({ runId }) {
    store.request("breach-deny", { runId });
  },
  "breach-pause"({ runId }) {
    store.request("breach-pause", { runId });
  },
  "breach-time"({ runId, seconds }) {
    store.request("breach-time", { runId, seconds: Number(seconds) });
  },
  "breach-end"({ runId }) {
    store.request("breach-end", { runId });
  },

  /* GM: Breach Points. */
  "breach-new"() {
    this.brDraft = newDraft();
    this.render();
  },
  "breach-edit"({ pointId }) {
    const point = store.apps.breachPoints[pointId];
    if (point) this.brDraft = foundry.utils.deepClone(point);
    this.render();
  },
  "breach-draft-cancel"() {
    this.brDraft = null;
    this.render();
  },
  "breach-draft-save"() {
    const draft = this.brDraft;
    if (!draft) return;
    const { isNew, ...point } = draft;
    store.request("breach-point-save", { point });
    this.brDraft = null;
    this.render();
  },
  "breach-daemon-remove"({ daemonId }) {
    const d = this.brDraft;
    if (!d || d.daemons.length <= 1) return;
    d.daemons = d.daemons.filter(x => x.id !== daemonId);
    delete d.effects[daemonId];
    this.render();
  },
  "breach-daemon-up"({ daemonId }) {
    const list = this.brDraft?.daemons;
    const i = list?.findIndex(x => x.id === daemonId) ?? -1;
    if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    this.render();
  },
  "breach-point-delete"({ pointId }) {
    const point = store.apps.breachPoints[pointId];
    Dialog.confirm({
      title: "BREACH",
      content: `<p>Delete the Breach Point <b>${foundry.utils.escapeHTML?.(point?.name ?? "") ?? ""}</b>?</p>`,
      yes: () => store.request("breach-point-delete", { pointId })
    });
  },
  "breach-reopen"({ pointId }) {
    const point = store.apps.breachPoints[pointId];
    if (point) store.request("breach-point-save", { point: { ...point, used: false } });
  }
};

/* ---------------- Inputs ---------------- */

/** The editor's fields: data-br-field (the point's own) and data-br-daemon + data-br-key (a daemon's). */
export const inputs = {
  "[data-br-field]": {
    change(event) {
      const d = this.brDraft;
      if (!d) return;
      const el = event.currentTarget;
      const key = el.dataset.brField;
      if (key === "everyone" || key === "single") d[key] = el.checked;
      else if (key === "dv" || key === "range") d[key] = Number(el.value) || null;
      else if (key === "actor") {
        const set = new Set(d.actorIds);
        if (el.checked) set.add(el.value);
        else set.delete(el.value);
        d.actorIds = [...set];
      } else d[key] = el.value;
      if (el.type === "checkbox") this.render();
    }
  },
  "[data-br-daemon]": {
    change(event) {
      const el = event.currentTarget;
      const daemon = this.brDraft?.daemons.find(x => x.id === el.dataset.brDaemon);
      if (!daemon) return;
      if (el.dataset.brKey === "effect") this.brDraft.effects[daemon.id] = el.value;
      else daemon.name = el.value;
    }
  }
};

/* ---------------- Dropdowns ---------------- */

export const dropdowns = {
  breachSize(value) {
    if (this.brDraft) this.brDraft.size = Number(value);
    this.render();
  },
  breachLen(value) {
    const [id, len] = String(value).split(":");
    const daemon = this.brDraft?.daemons.find(x => x.id === id);
    if (daemon) daemon.len = Number(len);
    this.render();
  },
  /** Add a daemon from a preset (its outcome as a starting text). */
  breachAddDaemon(value) {
    const d = this.brDraft;
    const preset = DAEMON_PRESETS[value];
    if (!d || !preset || d.daemons.length >= MAX_DAEMONS) return;
    const id = foundry.utils.randomID();
    d.daemons.push({ id, name: preset.name, len: preset.len });
    d.effects[id] = preset.effect;
    this.render();
  },
  breachAnchor(value) {
    if (this.brDraft) this.brDraft.anchor = parseAnchorKey(value);
    this.render();
  },
  /** Send a breach to a character: "pointId|actorId". */
  breachSend(value) {
    const [pointId, actorId] = String(value).split("|");
    if (!pointId || !actorId) return;
    store.request("breach-send", { pointId, actorId });
    ui.notifications.info(`BREACH: sent to ${displayName(game.actors.get(actorId))}.`);
  }
};

/* ---------------- The page's data ---------------- */

export const methods = {
  breachData(ctx) {
    const gm = ctx.perspective === "gm";
    const bar = appBar("breach", { owner: gm ? null : ctx.subject.name });
    return gm ? this._breachGmData(bar) : this._breachPlayerData(ctx, bar);
  },

  /** The breach on a player's screen: one going on, or the last one ended (until dismissed). */
  _breachShown(actorId) {
    const runs = Object.values(store.apps.breaches ?? {}).filter(r => r.actorId === actorId).sort((a, b) => b.ts - a.ts);
    const active = runs.find(r => ACTIVE.has(r.status));
    if (active) return active;
    const last = runs[0];
    if (!last || this._brSeen?.has(last.id) || Date.now() - last.ts > SHOW_DONE_MS) return null;
    return ["done", "locked", "denied"].includes(last.status) ? last : null;
  },

  _breachPlayerData(ctx, bar) {
    const actor = ctx.subject?.actor;
    const actorId = actor?.id ?? null;
    if (this.brPractice) return { bar, screen: "grid", grid: this._breachGridData(this.brPractice) };
    const run = this._breachShown(actorId);
    const can = canBreach(actor);
    if (run) {
      const head = { id: run.id, name: run.name, dv: run.dv };
      if (run.status === "asked") return { bar, screen: "asked", run: head };
      if (run.status === "denied") return { bar, screen: "denied", run: head };
      if (run.status === "approved") {
        return { bar, screen: "approved", run: head, can, deck: cyberdeckOf(actor)?.name ?? "", rank: netRoleOf(actor)?.system?.rank ?? 0, rolling: !!this._brRolling };
      }
      if (run.status === "locked") return { bar, screen: "locked", run: { ...head, roll: run.roll?.total } };
      return { bar, screen: "grid", grid: this._breachGridData(run) };
    }
    const points = Object.values(store.apps.breachPoints ?? {})
      .filter(p => pointFor(p, actorId))
      .map(p => ({ id: p.id, name: p.name, dv: p.dv, size: p.size, daemons: p.daemons.length, near: canReachPayPoint(p, actor) }))
      .filter(p => p.near)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { bar, screen: "lobby", points, can };
  },

  /**
   * The grid's screen, for a real breach or a practice one: the matrix, the line to pick from, the buffer, the
   * daemons (lit as they fill), the clock, and the result once it's over.
   */
  _breachGridData(run) {
    const grid = gridOf(run);
    const picks = this._breachPicks(run);
    const over = run.status === "done";
    const left = run.practice ? timeLeft(run, Date.now()) : timeLeft(run, serverNow());
    const expired = !over && run.startedAt && left <= 0;
    const live = !over && !expired && !run.pausedAt;
    const open = new Set(live ? openCells(grid, picks) : []);
    const line = lineAfter(grid, picks);
    const states = daemonStates(grid, picks, run.buffer);
    const used = new Set(picks);
    const rows = Array.from({ length: grid.size }, (_, r) => ({
      cells: Array.from({ length: grid.size }, (_, c) => {
        const cell = r * grid.size + c;
        return { cell, code: grid.cells[cell], used: used.has(cell), open: open.has(cell), onLine: !over && ("row" in line ? r === line.row : c === line.col) };
      })
    }));
    const codes = bufferCodes(grid, picks);
    const buffer = Array.from({ length: run.buffer }, (_, i) => ({ code: codes[i] ?? "", filled: i < codes.length }));
    const result = over ? (run.result ?? { ...outcome(grid, picks, run.buffer), why: run.why }) : null;
    const uploadedIds = new Set(result?.uploaded?.map(x => (typeof x === "number" ? run.daemons[x].id : x)) ?? []);
    const daemons = run.daemons.map((d, i) => {
      const s = states[i];
      const state = over ? (uploadedIds.has(d.id) ? "done" : "failed") : s.state;
      return {
        name: d.name, state, done: state === "done", failed: state === "failed",
        codes: grid.daemons[i].map((code, j) => ({ code, lit: state === "done" || (state === "open" && j < s.progress) })),
        label: state === "done" ? "uploaded" : state === "failed" ? "failed" : s.progress ? `${s.progress} of ${grid.daemons[i].length} in the buffer` : ""
      };
    });
    const lineText = "row" in line ? `row ${line.row + 1}` : `column ${line.col + 1}`;
    return {
      id: run.id ?? null, practice: !!run.practice, name: run.practice ? "Practice grid" : run.name, size: grid.size, rows, buffer, daemons,
      lineText, axis: "row" in line ? "row" : "col", live, over, expired, paused: !!run.pausedAt,
      clock: clockText(left), pct: Math.round((left / run.timeMs) * 100), started: !!run.startedAt,
      canQuick: !run.practice && run.status === "ready" && !picks.length && !over,
      roll: run.roll?.total ?? null, dv: run.dv ?? null,
      why: over ? (result.mode === "roll" ? ENDINGS.roll : ENDINGS[result.why] ?? "") : "",
      uploaded: daemons.filter(d => d.done).length
    };
  },

  /** The picks on screen: the host's, plus the ones sent and not yet back (so a pick shows at once). */
  _breachPicks(run) {
    if (run.practice) return run.picks;
    const pending = this._brPending;
    if (pending?.runId === run.id && pending.picks.length > run.picks.length && run.picks.every((p, i) => pending.picks[i] === p) && run.status !== "done") return pending.picks;
    if (pending?.runId === run.id) this._brPending = null;
    return run.picks;
  },

  _breachGmData(bar) {
    const points = Object.values(store.apps.breachPoints ?? {}).sort((a, b) => a.name.localeCompare(b.name));
    const runs = Object.values(store.apps.breaches ?? {}).sort((a, b) => b.ts - a.ts);
    const pcs = playerCharacters();
    const nameOf = id => displayName(game.actors.get(id)) || "?";
    const t = serverNow();
    const live = runs.filter(r => ACTIVE.has(r.status)).map(r => ({
      id: r.id, who: nameOf(r.actorId), name: r.name, dv: r.dv, status: r.status,
      asked: r.status === "asked", approved: r.status === "approved", ready: r.status === "ready", running: r.status === "running",
      paused: !!r.pausedAt, roll: r.roll?.total ?? null,
      progress: r.buffer ? `buffer ${r.picks.length}/${r.buffer} · ${clockText(timeLeft(r, t))}${r.status === "ready" ? " (not started)" : ""}` : "",
      uploaded: r.buffer ? daemonStates(gridOf(r), r.picks, r.buffer).filter(s => s.state === "done").length : 0, of: r.daemons.length
    }));
    const recent = runs.filter(r => r.status === "done" || r.status === "locked").slice(0, 8).map(r => ({
      who: nameOf(r.actorId), name: r.name, time: r.time,
      line: r.status === "locked" ? `Locked out (rolled ${r.roll?.total ?? "?"} vs DV ${r.dv})`
        : `${r.result?.uploaded?.length ?? 0}/${r.daemons.length} uploaded · ${r.result?.mode === "roll" ? ENDINGS.roll : ENDINGS[r.result?.why] ?? ""}`
    }));
    const cards = points.map(p => ({
      id: p.id, name: p.name, dv: p.dv, size: p.size, used: p.used, single: p.single,
      daemons: p.daemons.map(d => `${d.name} (${d.len})`).join(", "),
      who: p.everyone ? "Everyone" : p.actorIds.map(nameOf).join(", ") || "Nobody yet",
      where: p.anchor ? anchorName(p.anchor) ?? "anchor gone" : "Anywhere",
      send: dropdown("breachSend", [{ value: "", label: "Send to…", selected: true }, ...pcs.map(a => ({ value: `${p.id}|${a.id}`, label: displayName(a) }))], { title: "Send this breach to" })
    }));
    return { gm: true, bar, live, recent, points: cards, editor: this.brDraft ? this._breachEditorData(pcs) : null };
  },

  _breachEditorData(pcs) {
    const d = this.brDraft;
    const scene = (d.anchor && game.scenes.get(d.anchor.sceneId)) || game.scenes.viewed || game.scenes.active;
    const anchors = [{ value: "", label: "Anywhere (no anchor)" }, ...anchorOptions(scene)];
    const current = anchorKey(d.anchor);
    if (current && !anchors.some(a => a.value === current)) anchors.push({ value: current, label: anchorDocument(d.anchor) ? anchorName(d.anchor) : "Anchor gone" });
    return {
      ...d,
      sizes: dropdown("breachSize", SIZES.map(s => ({ value: String(s), label: `${s} × ${s}`, selected: s === d.size })), { title: "Grid size" }),
      anchors: dropdown("breachAnchor", anchors.map(a => ({ ...a, selected: a.value === current })), { title: "Where", search: anchors.length > 8 }),
      hasAnchor: !!d.anchor, rangeHint: d.anchor?.kind === "region" ? "" : "metres (default 20)",
      daemonRows: d.daemons.map((x, i) => ({
        ...x, first: i === 0, effect: d.effects[x.id] ?? "", only: d.daemons.length === 1,
        lens: dropdown("breachLen", Array.from({ length: DAEMON_LEN.max - DAEMON_LEN.min + 1 }, (_, k) => DAEMON_LEN.min + k).map(len => ({ value: `${x.id}:${len}`, label: `${len} codes`, selected: len === x.len })), { title: "Sequence length" })
      })),
      canAdd: d.daemons.length < MAX_DAEMONS,
      presets: dropdown("breachAddDaemon", [{ value: "", label: "Add a daemon…", selected: true }, ...Object.entries(DAEMON_PRESETS).map(([value, p]) => ({ value, label: `${p.name} (${p.len})` }))], { title: "Add a daemon" }),
      characters: pcs.map(a => ({ id: a.id, name: displayName(a), on: d.actorIds.includes(a.id) }))
    };
  },

  /* ---------------- Playing ---------------- */

  /** A pick on the grid: checked here first (so it shows at once), then by the host for a real breach. */
  _breachPick(cell) {
    const practice = this.brPractice;
    if (practice) {
      if (practice.status === "done") return;
      if (practice.startedAt && timeLeft(practice, Date.now()) <= 0) return this._breachPracticeEnd("time");
      const grid = gridOf(practice);
      if (!canPick(grid, practice.picks, cell, practice.buffer)) return;
      practice.startedAt ??= Date.now();
      practice.picks = [...practice.picks, cell];
      const end = gridEnd(grid, practice.picks, practice.buffer);
      this._breachAfterPick(grid, practice.picks);
      if (end) return this._breachPracticeEnd(end);
      return this.render();
    }
    const run = this._breachShown(actorOf(this)?.id);
    if (!run || (run.status !== "ready" && run.status !== "running") || run.pausedAt) return;
    const picks = this._breachPicks(run);
    const grid = gridOf(run);
    if (!canPick(grid, picks, cell, run.buffer)) return;
    this._brPending = { runId: run.id, picks: [...picks, cell] };
    store.request("breach-pick", { runId: run.id, cell });
    this._breachAfterPick(grid, this._brPending.picks);
    this.render();
  },

  /**
   * After a pick: what to read out, and (picking by keyboard) where the focus goes next: the next line's first
   * open cell. Both last a moment, through the redraw the host's answer brings.
   */
  _breachAfterPick(grid, picks) {
    const next = openCells(grid, picks)[0];
    this._brFocus = this._brKeys && next !== undefined ? next : null;
    const line = lineAfter(grid, picks);
    this._brSay = { text: `Picked ${grid.cells[picks.at(-1)]}. Now ${"row" in line ? `row ${line.row + 1}` : `column ${line.col + 1}`}.`, at: Date.now() };
  },

  _breachPracticeEnd(why) {
    const p = this.brPractice;
    if (!p || p.status === "done") return;
    p.status = "done";
    p.result = { ...outcome(gridOf(p), p.picks, p.buffer), why, mode: "grid" };
    this.render();
  },

  /**
   * The Backdoor roll with the character sheet's own roll: the cyberdeck's Interface ability (the system's
   * dialog, mods and Luck; its card in chat), waiting for Dice So Nice. The host takes the total.
   */
  async _breachRoll(runId) {
    const actor = actorOf(this);
    const can = canBreach(actor);
    if (!actor || !can.ok) return ui.notifications.warn(`BREACH: ${can.why}`);
    if (this._brRolling) return;
    this._brRolling = true;
    try {
      const deck = cyberdeckOf(actor);
      const netRoleItem = netRoleOf(actor);
      let roll = deck.createRoll("interfaceAbility", actor, { interfaceAbility: "backdoor", cyberdeck: deck, netRoleItem });
      if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, deck))) return;
      roll = (await deck.confirmRoll?.(roll)) ?? roll;
      await roll.roll();
      if (Number.isInteger(roll.luck) && roll.luck > 0) {
        const luck = actor.system.stats.luck.value;
        await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
      }
      roll.entityData = { actor: actor.id, token: null, item: deck.id };
      const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
      const message = await CPRChat.RenderRollCard(roll);
      if (game.dice3d?.waitFor3DAnimationByMessageID && message?.id) {
        await Promise.race([game.dice3d.waitFor3DAnimationByMessageID(message.id), new Promise(done => setTimeout(done, DICE_WAIT))]).catch(() => {});
      }
      const mods = roll.totalMods?.() ?? 0;
      const crit = roll.criticalRoll ? ` ${roll.wasCritFail?.() ? "−" : "+"} ${roll.criticalRoll}` : "";
      const detail = `${roll.initialRoll}${crit} + ${netRoleItem.system.rank} Interface${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)} mods` : ""}${roll.luck > 0 ? ` + ${roll.luck} Luck` : ""}`;
      store.request("breach-roll", { runId, total: roll.resultTotal, detail, messageId: message?.id ?? null });
    } finally {
      this._brRolling = false;
      this.render();
    }
  },

  /* ---------------- After a redraw ---------------- */

  /** The clock (ticking without redraws), arrow keys along the line, the next line shown on hover, read-outs. */
  _breachAttach(html) {
    clearInterval(this._brTick);
    const root = html.querySelector(".agent-breach-grid-screen");
    if (!root) return;
    const say = root.querySelector("[data-br-say]");
    if (say && this._brSay && Date.now() - this._brSay.at < 1500) say.textContent = this._brSay.text;
    if (this._brKeys) {
      const el = root.querySelector(`.agent-breach-cell[data-cell="${this._brFocus}"]:not(:disabled)`) ?? root.querySelector(".agent-breach-cell:not(:disabled)");
      el?.focus();
    }
    const clockEl = root.querySelector("[data-br-clock]");
    const barEl = root.querySelector("[data-br-bar]");
    this._brTick = setInterval(() => {
      if (!clockEl?.isConnected) return clearInterval(this._brTick);
      const p = this.brPractice;
      const run = p ?? this._breachShown(actorOf(this)?.id);
      if (!run?.timeMs || run.status === "done") return;
      const left = p ? timeLeft(p, Date.now()) : timeLeft(run, serverNow());
      clockEl.textContent = clockText(left);
      barEl?.style.setProperty("--left", `${(left / run.timeMs) * 100}%`);
      root.classList.toggle("hurry", !!run.startedAt && left < 10_000);
      if (run.startedAt && left <= 0 && !run.pausedAt) {
        clearInterval(this._brTick);
        if (p) this._breachPracticeEnd("time");
        else this.render(); // the host ends it; until then the grid is shut
      }
    }, 100);
    const cells = [...root.querySelectorAll(".agent-breach-cell")];
    const size = Number(root.dataset.size) || 6;
    root.querySelector(".agent-breach-matrix")?.addEventListener("keydown", event => {
      const from = event.target.closest?.(".agent-breach-cell");
      const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
      if (!from || !step) return;
      event.preventDefault();
      event.stopPropagation();
      let at = Number(from.dataset.cell);
      for (let i = 0; i < size; i++) {
        let r = Math.floor(at / size) + step[0];
        let c = (at % size) + step[1];
        r = (r + size) % size;
        c = (c + size) % size;
        at = r * size + c;
        const el = cells[at];
        if (el && !el.disabled) return el.focus();
      }
    });
    // Hovering a cell you can pick shows the line it would open next (2077's crosshair).
    const preview = cell => {
      for (const el of cells) el.classList.remove("next");
      if (cell === null) return;
      const onRow = root.dataset.line === "row";
      for (const el of cells) {
        const i = Number(el.dataset.cell);
        if (onRow ? colOf({ size }, i) === colOf({ size }, cell) : rowOf({ size }, i) === rowOf({ size }, cell)) el.classList.add("next");
      }
    };
    for (const el of cells) {
      if (el.disabled) continue;
      el.addEventListener("mouseenter", () => preview(Number(el.dataset.cell)));
      el.addEventListener("focus", () => preview(Number(el.dataset.cell)));
      el.addEventListener("mouseleave", () => preview(null));
    }
  },

  /** Left the app or closed the phone: a practice grid is dropped, the clock stops. */
  _breachLeave() {
    clearInterval(this._brTick);
    this.brPractice = null;
  }
};

export const phone = {
  render(html) {
    if (this.app === "breach") this._breachAttach(html);
    else if (this._brTick || this.brPractice) this._breachLeave(); // left the app
  },
  close() {
    this._breachLeave();
  }
};

import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { feature } from "../../scripts/model/features.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { weatherDays } from "./dates.js";
import { condName, DAYS, dayView, gearOf, hazardsOf, isProtected, rulesCard, seasonName, tempOf, UNITS_SHOWN, wackyLine, weatherFlag, weatherOptions } from "./model.js";
import { CONDITIONS, GEAR, HAZARDS, TEMPS } from "./tables.js";

/*
 * Phone page: Weather (see apps/weather/model.js, host.js). Players: today (the condition, the temperature,
 * Wacky the weatherman's line), the rules card, their Resist Torture/Drugs checks, and the 10-day forecast.
 * The GM Phone is Weather Control: today and every forecast day can be rolled again (all, temperature or
 * condition), set by hand, locked; today's weather is applied to the characters the GM picks (every player
 * character, those on the active scene, or the selected tokens), with the hazard tools and the checks;
 * and the options (wrong forecasts, apply automatically, Morro Rock Radio, units).
 * Methods, click actions (data-action), inputs and dropdowns are installed onto AgentPhone.
 */

const TARGETS = { pcs: "Every player character", scene: "Characters on the active scene", selected: "Selected tokens" };

/** "40 min", "2 h 10 min". */
function timeLeft(seconds) {
  const m = Math.ceil(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

const options = () => weatherOptions(game.settings.get(MODULE_ID, "weather"));
const saveOptions = change => patchSetting("weather", change);

/** The characters a target choice means, on this (the GM's) client. */
function targetActors(target) {
  if (target === "scene") {
    const ids = new Set((game.scenes.active?.tokens ?? []).filter(t => t.actorLink && t.actorId).map(t => t.actorId));
    return [...ids].map(id => game.actors.get(id)).filter(Boolean);
  }
  if (target === "selected") {
    const ids = new Set((canvas.tokens?.controlled ?? []).map(t => t.document?.actorLink && t.actor?.id).filter(Boolean));
    return [...ids].map(id => game.actors.get(id)).filter(Boolean);
  }
  return playerCharacters();
}

/** Resist Torture/Drugs with the character's own sheet roll (the system's dialog, mods and Luck, its roll card). */
async function resistRoll(actor) {
  const skill = actor.items.find(i => i.type === "skill" && /^resist torture/i.test(i.name));
  if (!skill?.createRoll) return null;
  const roll = skill.createRoll("skill", actor);
  if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, skill))) return null;
  await roll.roll();
  if (Number.isInteger(roll.luck) && roll.luck > 0) {
    const luck = actor.system.stats.luck.value;
    await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
  }
  roll.entityData = { actor: actor.id, token: null };
  const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
  const card = await CPRChat.RenderRollCard(roll);
  const mods = roll.totalMods();
  const crit = roll.criticalRoll ? ` ${roll.wasCritFail() ? "−" : "+"} ${roll.criticalRoll}` : "";
  const detail = `${roll.initialRoll}${crit} + ${roll.statValue} WILL + ${roll.skillValue} skill${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)} mods` : ""}${roll.luck > 0 ? ` + ${roll.luck} Luck` : ""}`;
  return { total: roll.resultTotal, detail, messageId: card?.id ?? null };
}

export const actions = {
  "wx-reroll"({ key, part }) {
    store.request("wx-reroll", { key, part: part || "all" });
  },
  "wx-edit"({ key }) {
    if (this.wxEdit?.key === key) this.wxEdit = null;
    else {
      const w = store.apps.weather?.[key]?.w;
      this.wxEdit = { key, temp: w?.temp ?? "warm", f: w?.f ?? "", cond: w?.cond ?? "clear", n: w?.dur?.n ?? "" };
    }
    this.render();
  },
  "wx-save"() {
    const e = this.wxEdit;
    if (!e) return;
    const root = this.element[0];
    const f = root.querySelector("input[name=wxF]")?.value;
    const n = root.querySelector("input[name=wxN]")?.value;
    if (store.request("wx-set", { key: e.key, temp: e.temp, cond: e.cond, f: f === "" ? null : Number(f), n: n === "" ? null : Number(n) })) {
      this.wxEdit = null;
      this.render();
    }
  },
  "wx-lock"({ key, locked }) {
    store.request("wx-lock", { key, locked: locked !== "true" });
  },
  "wx-end"() {
    store.request("wx-end");
  },
  "wx-apply"() {
    const actors = targetActors(this.wxTarget ?? "pcs");
    if (!actors.length) return ui.notifications.warn(this.wxTarget === "selected" ? "Select some tokens first." : "No characters to apply it to.");
    store.request("wx-apply", { actorIds: actors.map(a => a.id) });
  },
  "wx-clear"() {
    store.request("wx-clear");
  },
  "wx-hazard"({ kind }) {
    const applied = store.apps.weather?.now?.applied?.actorIds;
    const actors = applied?.length ? applied : targetActors(this.wxTarget ?? "pcs").map(a => a.id);
    if (!actors.length) return ui.notifications.warn("No characters: apply the weather first, or pick who's out in it.");
    store.request("wx-hazard", { kind, actorIds: actors });
  },
  "wx-radio"() {
    Dialog.confirm({
      title: "Morro Rock Radio",
      content: "<p>Post today's forecast in The Garden as 107.3 Morro Rock Radio?</p><p class=\"notes\">Everyone with The Garden sees it.</p>",
      yes: () => store.request("wx-radio")
    });
  },
  /** Pick a day on the forecast strip (the GM's tools work on it; players see its details). */
  "wx-day"({ key }) {
    this.wxDay = this.wxDay === key ? null : key;
    this.wxEdit = null;
    this.render();
  },
  /** Open or close a section. */
  "wx-fold"({ fold }) {
    this.wxFold = { ...this.wxFold, [fold]: !this.wxIsOpen(fold) };
    this.render();
  },
  async "wx-check"({ checkId }) {
    const check = store.apps.wxChecks?.[checkId];
    const actor = game.actors.get(check?.actorId);
    if (!actor || check.result || this.wxRolling) return;
    this.wxRolling = true;
    try {
      const result = await resistRoll(actor);
      if (!result) {
        if (!actor.items.some(i => i.type === "skill" && /^resist torture/i.test(i.name))) ui.notifications.warn(`${displayName(actor)} has no Resist Torture/Drugs skill on the sheet.`);
        return;
      }
      store.request("wx-check-roll", { checkId, ...result });
    } finally {
      this.wxRolling = false;
    }
  },
  "wx-check-resolve"({ checkId, apply }) {
    store.request("wx-check-resolve", { checkId, apply: apply === "true" });
  },
  "wx-option"({ option }) {
    saveOptions(o => (o[option] = !options()[option]));
  }
};

export const dropdowns = {
  wxTarget(value) {
    this.wxTarget = value in TARGETS ? value : "pcs";
    this.render();
  },
  wxTemp(value) {
    if (this.wxEdit && value in TEMPS) this.wxEdit.temp = value;
    this.render();
  },
  wxCond(value) {
    if (this.wxEdit && value in CONDITIONS) this.wxEdit.cond = value;
    this.render();
  },
  wxUnits(value) {
    saveOptions(o => (o.units = value));
  }
};

export const inputs = {
  "input[name=wxChance]": {
    change(event) {
      const v = Number(event.currentTarget.value);
      saveOptions(o => (o.wrongChance = v));
    }
  },
  // Kept while the GM types, so a redraw doesn't lose it.
  "input[name=wxF], input[name=wxN]": {
    input(event) {
      if (this.wxEdit) this.wxEdit[event.currentTarget.name === "wxF" ? "f" : "n"] = event.currentTarget.value;
    }
  }
};

/** Sections open until the user closes them (the rest start closed). */
const OPEN = { player: ["rules"], gm: ["day", "apply"] };

export const methods = {
  /** Is a section open on this phone? */
  wxIsOpen(fold) {
    return this.wxFold?.[fold] ?? OPEN[this.context()?.perspective === "gm" ? "gm" : "player"].includes(fold);
  },

  weatherData(ctx) {
    const gm = ctx.perspective === "gm";
    const opts = options();
    const table = store.apps.weather ?? {};
    const now = table.now ?? {};
    const keys = weatherDays(DAYS).map(d => d.key);
    const rows = keys.map(k => table[k]).filter(r => r?.w);
    const bar = appBar("weather", { owner: gm ? null : ctx.subject?.name });
    const todayRow = table[now.today] ?? rows[0];
    if (!todayRow) return { gm, bar, empty: true };

    const w = todayRow.w;
    const event = now.event && now.event.key === todayRow.key ? now.event : null;
    const left = event ? Math.max(0, event.until - game.time.worldTime) : 0;
    const today = {
      ...dayView(todayRow, opts.units),
      season: seasonName(todayRow.season),
      wacky: wackyLine(w, todayRow.key),
      event: event ? (left > 0 ? `Ends in ${timeLeft(left)} (world time)` : "Ending") : null,
      was: todayRow.was ?? null,
      rules: rulesCard(w)
    };
    // The strip: today and the next nine days; the picked day (today unless one is picked).
    if (this.wxDay && !rows.some(r => r.key === this.wxDay)) this.wxDay = null;
    const picked = rows.find(r => r.key === this.wxDay) ?? todayRow;
    const short = v => (opts.units === "c" ? `${v.c ?? ""}°` : `${v.f ?? ""}°`);
    const strip = rows.map(r => {
      const v = dayView(r, opts.units);
      return { ...v, deg: short(tempOf(r.w)), isToday: r === todayRow, picked: r === picked, real: gm && !!r.actual };
    });
    const pickedView = {
      ...dayView(picked, opts.units),
      isToday: picked === todayRow,
      real: gm && picked.actual ? dayView({ ...picked, w: picked.actual }, opts.units) : null
    };
    const fold = name => this.wxIsOpen(name);
    const open = { rules: fold("rules"), apply: fold("apply"), day: fold("day"), people: fold("people"), options: fold("options") };
    const base = { gm, bar, today, strip, picked: pickedView, open, offline: !!ctx.noSignal };
    if (!gm) {
      const actor = ctx.subject?.actor;
      const effect = actor?.effects.find(e => weatherFlag(e, MODULE_ID));
      const checks = Object.values(store.apps.wxChecks ?? {}).filter(c => c.actorId === actor?.id && !c.done).sort((a, b) => b.ts - a.ts)
        .map(c => ({ ...c, cond: condName({ cond: c.cond }), pass: c.result === "pass", fail: c.result === "fail" }));
      const gear = actor ? [...gearOf(actor)].map(k => GEAR[k].name) : [];
      return { ...base, applied: effect ? effect.name : null, checks, gear, showRules: !today.rules.none || !!effect || gear.length > 0 };
    }

    // Weather Control.
    this.wxTarget ??= "pcs";
    const applied = now.applied?.actorIds ?? [];
    const people = (applied.length ? applied.map(id => game.actors.get(id)).filter(Boolean) : targetActors(this.wxTarget)).map(a => {
      const gear = gearOf(a);
      return { name: displayName(a), gear: [...gear].map(k => GEAR[k].name).join(", "), safe: isProtected(w, gear) };
    });
    const edit = this.wxEdit && table[this.wxEdit.key] ? {
      ...this.wxEdit,
      label: table[this.wxEdit.key].label,
      temps: dropdown("wxTemp", Object.entries(TEMPS).map(([value, t]) => ({ value, label: t.name, selected: value === this.wxEdit.temp })), { title: "Temperature" }),
      conds: dropdown("wxCond", Object.entries(CONDITIONS).map(([value, c]) => ({ value, label: c.strange ? `${c.name} (Strange)` : c.name, selected: value === this.wxEdit.cond })), { title: "Condition", cls: "agent-wide" }),
      strange: !!CONDITIONS[this.wxEdit.cond]?.duration,
      unit: CONDITIONS[this.wxEdit.cond]?.duration?.unit
    } : null;
    const checks = Object.values(store.apps.wxChecks ?? {}).filter(c => !c.done || Date.now() - c.ts < 3_600_000).sort((a, b) => b.ts - a.ts).slice(0, 12)
      .map(c => ({ ...c, name: displayName(game.actors.get(c.actorId)), pass: c.result === "pass", fail: c.result === "fail" && !c.done, waiting: !c.result }));
    return {
      ...base,
      showRules: true,
      edit,
      editing: this.wxEdit?.key === picked.key,
      hasEvent: !!event && picked === todayRow,
      target: dropdown("wxTarget", Object.entries(TARGETS).map(([value, label]) => ({ value, label, selected: value === this.wxTarget })), { title: "Who's out in it", cls: "agent-wide" }),
      applied: applied.length,
      people,
      hazards: hazardsOf(w).map(kind => ({ kind, ...HAZARDS[kind] })),
      checks,
      options: { ...opts, units: dropdown("wxUnits", Object.entries(UNITS_SHOWN).map(([value, label]) => ({ value, label, selected: value === opts.units })), { title: "Units" }) },
      garden: !!feature("app_garden")
    };
  }
};

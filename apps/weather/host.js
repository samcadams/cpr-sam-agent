import { gm } from "../../scripts/host/validate.js";
import { MODULE_ID } from "../../scripts/config.js";
import { feature } from "../../scripts/model/features.js";
import { agentType } from "../../scripts/model/agent.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { displayName } from "../../scripts/model/threads.js";
import { rollCard } from "../../scripts/util/cpr-roll.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { clean, esc } from "../../scripts/util/text.js";
import { weatherDay, weatherDays } from "./dates.js";
import {
  carryOver, condName, DAYS, degrees, durationSeconds, EFFECT_FLAG, effectSig, gearOf, gmFlags, isProtected, isShort, KEEP_PAST, rollCondition, rollDay, rollTemp,
  sameWeather, setByHand, tempOf, wackyLine, weatherEffect, weatherFlag, weatherOptions
} from "./model.js";
import { CONDITIONS, HAZARDS, seasonOf } from "./tables.js";

/*
 * Host: Weather (see apps/weather/model.js). On load and on every clock tick the host keeps the 10-day
 * forecast filled (rolling new days on their month's table), turns the day over at in-world midnight
 * (a wrong forecast shows what really happens), and runs today's short Strange Weather as an event on
 * world time. When the GM has applied the weather (Weather Control → Apply), its Active Effects follow it:
 * they're replaced when the weather changes (or only removed, unless the GM chose "apply automatically"),
 * and a Blackout takes the characters it's applied to off the network until it ends.
 * The GM's hazard tools: armor ablation, Resist Torture/Drugs checks on the players' phones (a failure
 * goes to the GM to apply the damage), Foreign Object, lightning and radiation rolls.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "wx-reroll": gm("_onWxReroll"),
  "wx-set": gm("_onWxSet"),
  "wx-lock": gm("_onWxLock"),
  "wx-apply": gm("_onWxApply"),
  "wx-clear": gm("_onWxClear"),
  "wx-end": gm("_onWxEnd"),
  "wx-hazard": gm("_onWxHazard"),
  "wx-radio": gm("_onWxRadio"),
  "wx-check-roll": "_onWxCheckRoll",
  "wx-check-resolve": gm("_onWxCheckResolve")
};

const FROM = "Weather";
const SPEAKER = { alias: "Night City Weather" };
const RADIO = { handle: "@morrorockradio", avatar: `modules/${MODULE_ID}/images/weather/morro-rock-radio.svg`, name: "107.3 Morro Rock Radio", kind: "news", verified: true, followers: 380000, bio: "Wacky the weatherman, every morning. Night City's rock, all day." };

const options = () => weatherOptions(game.settings.get(MODULE_ID, "weather"));
const hasEffect = actor => actor.effects.filter(e => weatherFlag(e, MODULE_ID));

/** A roll to chat on CPR's roll card, `flavor` above it: the total. */
const rollToChat = (formula, title, flavor) => rollCard(formula, title, { speaker: SPEAKER, flavor });

export const methods = {
  /** The weather table, with its "now" row. */
  _wx() {
    const table = (this.apps.weather ??= {});
    table.now ??= { everyone: true, key: "now", today: null };
    return table;
  },

  /** Today's row. */
  _wxToday() {
    const table = this._wx();
    return table[table.now.today] ?? null;
  },

  _weatherLoad() {
    return this._weatherSync();
  },

  _tickWeather() {
    return this._weatherSync();
  },

  /** Keep the forecast filled, turn the day over, run today's event and keep the applied effects in step. */
  async _weatherSync({ push = true } = {}) {
    if (!feature("app_weather")) return;
    // The Garden loads after the apps (host/core.js): set the station's account up on the first sync after it.
    if (!this._radioChecked && this.garden?.accounts && !this.gardenFailed && Object.keys(this.garden.accounts).length) {
      this._radioChecked = true;
      if (this._radioSetUp()) this._pushGarden();
    }
    const table = this._wx();
    const now = table.now;
    const opts = options();
    const days = weatherDays(DAYS);
    let changed = false;

    // A new day.
    if (now.today !== days[0].key) {
      const first = now.today === null;
      now.today = days[0].key;
      now.event = null;
      const keep = new Set(["now", ...days.map(d => d.key), ...Array.from({ length: KEEP_PAST }, (_, i) => weatherDay(-(i + 1)).key)]);
      for (const key of Object.keys(table)) if (!keep.has(key)) delete table[key];
      changed = true;
      this._wxNewDay = !first;
    }

    // Fill the forecast: a run of Strange Weather days goes on, the rest is rolled.
    for (const [i, day] of days.entries()) {
      if (table[day.key]) {
        Object.assign(table[day.key], { label: day.label, short: day.short });
        continue;
      }
      const season = seasonOf(day.month);
      const prev = table[(i ? days[i - 1] : weatherDay(-1)).key];
      const carried = carryOver(prev?.w);
      const row = { everyone: true, key: day.key, label: day.label, short: day.short, season };
      if (carried) {
        Object.assign(row, { w: carried, src: "carry" });
        const real = prev.actual ? carryOver(prev.actual) : null;
        if (real) row.actual = real;
      } else {
        Object.assign(row, { w: rollDay(season), src: "roll" });
        // "Forecasts can be wrong": a different roll is what really happens.
        if (opts.wrong && i > 0 && Math.random() * 100 < opts.wrongChance) {
          const actual = rollDay(season);
          if (!sameWeather(actual, row.w)) row.actual = actual;
        }
      }
      table[day.key] = row;
      changed = true;
    }

    // Today: a wrong forecast shows what really happens.
    const today = table[now.today];
    if (today.actual) {
      today.w = today.actual;
      today.missed = true;
      delete today.actual;
      changed = true;
    }

    // A new day: characters hear about Strange Weather today and in tomorrow's forecast.
    const alerts = [];
    if (this._wxNewDay) {
      const next = table[days[1]?.key];
      const lines = [
        CONDITIONS[today.w.cond]?.strange ? `Weather alert: ${condName(today.w)} today.` : null,
        next && CONDITIONS[next.w?.cond]?.strange ? `Forecast: ${condName(next.w)} expected tomorrow.` : null
      ].filter(Boolean);
      if (lines.length) alerts.push(...this._wxTell(playerCharacters().map(a => a.id), lines.join(" ")));
    }

    // Today's short Strange Weather runs on world time; when it ends, the GM's table rolls the rest of the day (NCW p. 3).
    if (now.event && (now.event.key !== now.today || now.event.cond !== today.w.cond)) now.event = null;
    if (now.event && game.time.worldTime >= now.event.until) {
      today.was = condName(today.w);
      today.w = rollCondition({ ...today.w }, today.season);
      if (today.src === "gm") today.src = "roll";
      now.event = null;
      changed = true;
    }
    if (!now.event && isShort(today.w)) {
      now.event = { key: now.today, cond: today.w.cond, until: game.time.worldTime + durationSeconds(today.w.dur) };
      changed = true;
    }

    // Per-minute damage and Exposure aren't automated: flag them to the GM once per weather.
    const flags = gmFlags(today.w);
    const flagKey = flags.length ? `${now.today}|${today.w.cond}|${tempOf(today.w).temp}` : null;
    if (flagKey && now.flagged !== flagKey) {
      now.flagged = flagKey;
      changed = true;
      await ChatMessage.create({
        speaker: SPEAKER, whisper: ChatMessage.getWhisperRecipients("GM"),
        content: `<p><b>${esc(condName(today.w))}</b>: not automated, your call.</p><ul>${flags.map(l => `<li>${esc(l)}</li>`).join("")}</ul><p class="notes">The hazard buttons are in Weather Control.</p>`
      });
    }

    if (this._wxNewDay && opts.radio) {
      this._wxNewDay = false;
      await this._weatherRadio();
    }
    this._wxNewDay = false;
    const followed = await this._wxFollow();
    if (followed) {
      changed = true;
      alerts.push(...followed);
    }
    if (changed && push) this._pushApps(alerts);
  },

  /** Weather alerts for these characters (those with an Agent): their ids, not sent. */
  _wxTell(actorIds, text) {
    return actorIds.filter(id => agentType(game.actors.get(id))).map(id => this._alert(id, { kind: "warning", from: FROM, app: "weather", text })).filter(Boolean);
  },

  /**
   * The applied mechanics follow the weather: when it changes, the old effects go; the new ones go on
   * the same characters if the GM chose "apply automatically", otherwise the GM gets a card to apply them.
   * Returns false (nothing changed) or the alert ids to send.
   */
  async _wxFollow() {
    const now = this._wx().now;
    const today = this._wxToday();
    if (!now.applied || !today) return false;
    if (now.applied.sig === effectSig(today.w)) return false;
    const actorIds = now.applied.actorIds;
    await this._wxRemove();
    if (options().autoApply) return this._wxApplyTo(actorIds);
    this._gmCard({
      id: "wx:follow", open: { app: "weather" },
      title: "Weather changed",
      body: `It's ${condName(today.w)} now. Its effects came off; apply the new weather to the same ${actorIds.length} character${actorIds.length === 1 ? "" : "s"}?`,
      icon: CONDITIONS[today.w.cond]?.icon?.replace("fas ", "") ?? "fa-cloud",
      actions: [{ label: "Apply", icon: "fa-check", request: "wx-apply", data: { actorIds } }]
    });
    return [];
  },

  /** Put today's weather on these characters (replacing the weather effects they had). Returns their alert ids (unsent). */
  async _wxApplyTo(actorIds) {
    const now = this._wx().now;
    const today = this._wxToday();
    if (!today) return [];
    const alerts = [];
    const ids = [...new Set(actorIds)].filter(id => game.actors.get(id));
    const event = now.event;
    const seconds = event ? event.until - game.time.worldTime : null;
    for (const id of ids) {
      const actor = game.actors.get(id);
      const old = hasEffect(actor).map(e => e.id);
      if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
      const effect = weatherEffect(today.w, gearOf(actor), { moduleId: MODULE_ID, seconds, worldTime: game.time.worldTime });
      if (!effect) continue;
      await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
      // What the weather does to them now (the effect's first line).
      const what = String(effect.description ?? "").match(/<p>(.*?)<\/p>/)?.[1];
      alerts.push(...this._wxTell([id], what ? `${condName(today.w)} is on you. ${what}` : `${condName(today.w)} is on you.`));
    }
    // A Blackout: no calls, no Data Pool, for those it's applied to.
    if (today.w.cond === "blackout") {
      const off = [];
      await patchSetting("noSignal", offline => {
        for (const id of ids) {
          if (offline[id]) continue;
          offline[id] = Date.now();
          off.push(id);
        }
      });
      now.offline = [...new Set([...(now.offline ?? []), ...off])];
    }
    now.applied = { actorIds: ids, sig: effectSig(today.w) };
    return alerts;
  },

  /** Take the weather's effects off everyone, and give back the signal a Blackout took. */
  async _wxRemove() {
    const now = this._wx().now;
    for (const actor of game.actors) {
      const ids = hasEffect(actor).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
    if (now.offline?.length) {
      const back = now.offline;
      await patchSetting("noSignal", offline => {
        for (const id of back) delete offline[id];
      });
    }
    now.offline = [];
    now.applied = null;
  },

  /* ---------------- The GM's Weather Control ---------------- */

  /** A day on the forecast, by key. */
  _wxDay(key) {
    const row = this._wx()[key];
    return row && key !== "now" ? row : null;
  },

  /**
   * A day changed by the GM: a run of Strange Weather days goes on over the following days (not over
   * locked days or days the GM set), a run that got shorter gives its old days back to the table, and
   * today's event and the applied effects follow.
   */
  async _wxChanged(key) {
    const table = this._wx();
    const now = table.now;
    if (key === now.today) {
      now.event = null;
      delete this._wxDay(key).was;
    }
    const days = weatherDays(DAYS).map(d => d.key);
    for (let i = days.indexOf(key) + 1; i > 0 && i < days.length; i++) {
      const row = table[days[i]];
      if (!row || row.locked || row.src === "gm") break;
      const carried = carryOver(table[days[i - 1]]?.w);
      if (carried) Object.assign(row, { w: carried, src: "carry" });
      else if (row.src === "carry") Object.assign(row, { w: rollDay(row.season), src: "roll" });
      else break;
      delete row.actual;
    }
    await this._weatherSync({ push: false });
    this._pushApps();
  },

  /** GM: roll a day again: all of it, the temperature or the condition. */
  async _onWxReroll(user, { key, part = "all" }) {
    const row = this._wxDay(key);
    if (!row) return;
    const w = row.w;
    row.w = part === "temp" ? rollTemp(w, row.season) : part === "cond" ? rollCondition(w, row.season) : rollDay(row.season);
    row.src = "roll";
    delete row.actual;
    delete row.missed;
    await this._wxChanged(key);
  },

  /** GM: set a day by hand (today, or schedule one ahead): { key, temp, f?, cond, n? }. */
  async _onWxSet(user, { key, temp, f, cond, n }) {
    const row = this._wxDay(key);
    if (!row) return;
    row.w = setByHand({ temp, f, cond, n }, row.season);
    row.src = "gm";
    delete row.actual;
    delete row.missed;
    await this._wxChanged(key);
  },

  /** GM: lock a day (a scheduled day: nothing rolls over it). */
  _onWxLock(user, { key, locked }) {
    const row = this._wxDay(key);
    if (!row) return;
    row.locked = !!locked;
    if (row.locked) delete row.actual;
    this._pushApps();
  },

  /** GM: apply today's weather to these characters. */
  async _onWxApply(user, { actorIds }) {
    if (!Array.isArray(actorIds) || !actorIds.length || !this._wxToday()) return;
    await this._wxRemove();
    this._gmCardDone("wx:follow");
    this._pushApps(await this._wxApplyTo(actorIds));
  },

  /** GM: take the weather's effects off everyone. */
  async _onWxClear() {
    await this._wxRemove();
    this._pushApps();
  },

  /** GM: today's Strange Weather ends now (the rest of the day is rolled). */
  async _onWxEnd() {
    const now = this._wx().now;
    if (!now.event) return;
    now.event.until = game.time.worldTime;
    await this._weatherSync({ push: false });
    this._pushApps();
  },

  /* ---------------- Hazards ---------------- */

  /** GM: one of the weather's hazards, on these characters (tables.js HAZARDS). */
  async _onWxHazard(user, { kind, actorIds = [] }) {
    const today = this._wxToday();
    if (!today || !(kind in HAZARDS)) return;
    const w = today.w;
    const actors = [...new Set(actorIds)].map(id => game.actors.get(id)).filter(Boolean);
    const exposed = actors.filter(a => !isProtected(w, gearOf(a)));
    const spared = actors.filter(a => !exposed.includes(a)).map(a => displayName(a));
    const sparedNote = spared.length ? ` Protected: ${spared.map(esc).join(", ")}.` : "";
    const name = esc(condName(w));
    switch (kind) {
      case "ablate": {
        const lines = [];
        for (const actor of exposed) {
          const worn = actor.items.filter(i => i.type === "armor" && i.system.equipped === "equipped");
          const updates = [];
          for (const armor of worn) {
            const u = { _id: armor.id };
            for (const [on, loc] of [["isBodyLocation", "bodyLocation"], ["isHeadLocation", "headLocation"]]) {
              const l = armor.system[loc];
              if (armor.system[on] && l && l.ablation < l.sp) u[`system.${loc}.ablation`] = l.ablation + 1;
            }
            if (Object.keys(u).length > 1) updates.push(u);
          }
          if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
          lines.push(`${esc(displayName(actor))}: ${updates.length ? `${updates.length} armor piece${updates.length === 1 ? "" : "s"} −1 SP` : "no worn armor to ablate"}`);
        }
        await ChatMessage.create({ speaker: SPEAKER, whisper: ChatMessage.getWhisperRecipients("GM"), content: `<p><b>${name}</b>: a minute in the rain.</p><p>${lines.join("<br>") || "Nobody exposed."}${sparedNote}</p>` });
        break;
      }
      case "poison":
      case "biotoxin": {
        const { dv, dice } = HAZARDS[kind];
        const alerts = [];
        // Biotoxin Blood Rain: nobody is spared, an umbrella only helps the check (+2, in the effect).
        for (const actor of kind === "biotoxin" ? actors : exposed) {
          const id = foundry.utils.randomID();
          this.apps.wxChecks[id] = { id, actorId: actor.id, kind, dv, dice, cond: w.cond, ts: Date.now() };
          alerts.push(this._alert(actor.id, { kind: "warning", from: FROM, app: "weather", text: `${condName(w)}: make a DV${dv} Resist Torture/Drugs Check in the Weather app.` }));
        }
        if (!alerts.length) await ChatMessage.create({ speaker: SPEAKER, whisper: ChatMessage.getWhisperRecipients("GM"), content: `<p><b>${name}</b>: nobody's exposed.${sparedNote}</p>` });
        // Old checks go (the newest 100 stay).
        const old = Object.values(this.apps.wxChecks).sort((a, b) => b.ts - a.ts).slice(100);
        for (const c of old) delete this.apps.wxChecks[c.id];
        this._pushApps(alerts.filter(Boolean));
        break;
      }
      case "foreign": {
        const pack = game.packs.get("cyberpunk-red-core.core_critical-injuries-body");
        const doc = (await pack?.getDocuments())?.find(d => d.name === "Foreign Object");
        if (!doc) return ui.notifications.warn("The Foreign Object Critical Injury isn't in the system's compendium.");
        for (const actor of exposed) {
          const data = doc.toObject();
          data.flags = { ...data.flags, [MODULE_ID]: { [EFFECT_FLAG]: { cond: w.cond } } };
          await actor.createEmbeddedDocuments("Item", [data]);
        }
        await ChatMessage.create({ speaker: SPEAKER, content: `<p><b>${name}</b>: ${exposed.map(a => esc(displayName(a))).join(", ") || "nobody"} ${exposed.length === 1 ? "gets" : "get"} the Foreign Object Critical Injury (no Bonus Damage). It can't be treated until they're out of it.${sparedNote}</p>` });
        break;
      }
      case "lightning": {
        const near = (await rollToChat("1d6", "Lightning", `<b>${name}</b>: where does the lightning strike?`)) >= 4;
        await ChatMessage.create({ speaker: SPEAKER, content: `<p>${near ? "<b>Strike!</b> The tallest structure or feature nearby; if there's none, the tallest character or one holding a two-handed metal weapon (and anyone touching them)." : "Far away. Thunder rolls over the city."}</p>` });
        break;
      }
      case "strike": {
        for (const actor of actors) await rollToChat("6d6", "Lightning damage", `<b>Lightning strikes ${esc(displayName(actor))}</b>: 6d6 damage to the body. It counts as a flashbang grenade centred on them (CP:R p. 346).`);
        break;
      }
      case "radburst": {
        await rollToChat("1d6", "Radioactive burst (Rounds)", `<b>${name}</b>: a radioactive burst, this many Rounds. Anyone without a Radiation Suit is exposed to high level radiation (CP:R p. 181).${sparedNote}`);
        break;
      }
    }
  },

  /** A player's (or the GM's) Resist Torture/Drugs roll for a weather check. */
  async _onWxCheckRoll(user, { checkId, total, detail, messageId }) {
    const check = this.apps.wxChecks[checkId];
    const actor = game.actors.get(check?.actorId);
    if (!check || !actor || check.result || (!user.isGM && !actor.testUserPermission(user, "OWNER"))) return;
    total = Math.round(Number(total));
    if (!Number.isFinite(total) || total < -20 || total > 80) return;
    Object.assign(check, { total, detail: clean(detail, 200), messageId: messageId ?? null, result: total >= check.dv ? "pass" : "fail" });
    if (check.result === "fail") {
      this._gmCard({
        id: `wx-check:${checkId}`, open: { app: "weather" },
        title: `${condName(this._wxToday()?.w ?? { cond: check.cond })}: ${displayName(actor)} failed`,
        body: `${total} against DV${check.dv}. ${check.dice} damage straight to HP (armor doesn't apply)?`,
        icon: "fa-skull-crossbones",
        actions: [
          { label: `Apply ${check.dice}`, icon: "fa-heart-crack", request: "wx-check-resolve", data: { checkId, apply: true } },
          { label: "Skip", icon: "fa-xmark", request: "wx-check-resolve", data: { checkId, apply: false } }
        ]
      });
    } else check.done = true;
    this._pushApps();
  },

  /** GM: a failed check's damage, straight to HP (or skipped). */
  async _onWxCheckResolve(user, { checkId, apply }) {
    const check = this.apps.wxChecks[checkId];
    const actor = game.actors.get(check?.actorId);
    if (!check || check.done || !actor) return;
    check.done = true;
    this._gmCardDone(`wx-check:${checkId}`);
    if (apply) {
      const damage = await rollToChat(check.dice, "Damage to HP", `<b>${esc(displayName(actor))}</b> breathed it in: ${check.dice} damage straight to HP.`);
      const hp = actor.system.derivedStats?.hp;
      if (hp) await actor.update({ "system.derivedStats.hp.value": hp.value - damage });
      check.damage = damage;
    }
    this._pushApps();
  },

  /* ---------------- Morro Rock Radio ---------------- */

  /** GM: Wacky the weatherman's forecast, posted in The Garden. */
  async _onWxRadio() {
    await this._weatherRadio(true);
  },

  /** The station's Garden account. */
  _radioAccount() {
    this._radioSetUp();
    return Object.values(this.garden.accounts).find(a => a.handle === RADIO.handle);
  },

  /** Make (or set right) the station's account automatically: news, verified, its own picture. Changed? */
  _radioSetUp() {
    const account = Object.values(this.garden.accounts).find(a => a.handle === RADIO.handle);
    if (!account) return !!this._addAccount(RADIO);
    const want = { avatar: account.avatar || RADIO.avatar, kind: RADIO.kind, verified: true };
    const changed = Object.entries(want).some(([key, value]) => account[key] !== value);
    Object.assign(account, want);
    return changed;
  },

  async _weatherRadio(loud = false) {
    if (!feature("app_garden") || !this.garden) {
      if (loud) ui.notifications.warn("The Garden is switched off.");
      return;
    }
    const table = this._wx();
    const today = this._wxToday();
    if (!today) return;
    const units = options().units;
    const ahead = weatherDays(4).slice(1).map(d => table[d.key]).filter(r => r?.w)
      .map(r => `${r.short}: ${condName(r.w)}, ${degrees(tempOf(r.w), units)}`);
    const text = `${wackyLine(today.w, today.key)}\n\nToday: ${condName(today.w)}, ${degrees(tempOf(today.w), units)}.${ahead.length ? `\n${ahead.join(" · ")}` : ""}\n#NightCityWeather`;
    await this._publish(this._radioAccount(), { text });
    this._pushGarden();
  }
};

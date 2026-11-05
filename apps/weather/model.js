import { MODULE_ID } from "../../scripts/config.js";
import { CONDITIONS, GEAR, HOT_ARMOR, SEASONS, STRANGE, TABLES, TEMPS, UNITS, WACKY } from "./tables.js";

/*
 * Weather (id "weather"; the proposal's §9): Night City
 * Weather's tables on the phone. Today, a 10-day forecast and the rules card for the players; the GM's
 * Weather Control rolls, sets, locks and schedules days, and applies the weather's mechanics.
 *
 * A day's weather (W): { temp: "cold"|"cool"|"warm"|"hot", f, c, cond, dur?, variant? }
 *   cond     a CONDITIONS id (tables.js)
 *   dur      Strange Weather: { n, unit: "minute"|"hour"|"day", day? }   n minutes/hours/days in all;
 *            a run of days repeats on the following days, `day` counting them (1..n)
 *   variant  Blood Rain's 1d6: 1-3 acid, 4-6 biotoxin
 *
 * Host table "weather" (owner "listed", every row `everyone`), one row per in-world day, by dayKey
 * (apps/weather/dates.js), plus the row "now":
 *   day: { everyone, key, label, short, season, w: W, src: "roll"|"gm"|"carry", locked?, missed?, actual? }
 *        src: rolled by the host, set by the GM, or the rest of a Strange Weather run.
 *        actual (GM only): "forecasts can be wrong": what really happens; it replaces w on the day.
 *        missed: the forecast was wrong (shown on the day).
 *   now: { everyone, key: "now", today, event?, applied?, offline? }
 *        event:   a Strange Weather that lasts minutes or hours: { cond, until (world time), ended? }
 *        applied: the mechanics are on these characters: { actorIds, sig } (sig: what's applied)
 *        offline: characters a Blackout took off the network (only those get their signal back)
 * Host table "wxChecks" (owner "actorId"): a Resist Torture/Drugs check waiting on a player's phone:
 *   { id, actorId, kind: "poison"|"biotoxin", dv, cond, ts, total?, detail?, result?: "pass"|"fail" }
 *
 * World setting "weather" (the GM's options): { wrong, wrongChance, autoApply, radio, units }
 */

export const DAYS = 10;

/** Past days kept (the Calendar shows them). */
export const KEEP_PAST = 45;

export const OPTIONS_DEFAULTS = { wrong: false, wrongChance: 25, autoApply: false, radio: true, units: "both" };
export const UNITS_SHOWN = { both: "°F and °C", f: "°F", c: "°C" };

export function weatherOptions(raw) {
  const o = { ...OPTIONS_DEFAULTS, ...(raw ?? {}) };
  o.wrong = !!o.wrong;
  o.autoApply = !!o.autoApply;
  o.radio = !!o.radio;
  o.wrongChance = Math.min(100, Math.max(0, Math.round(Number(o.wrongChance) || 0)));
  if (!(o.units in UNITS_SHOWN)) o.units = "both";
  return o;
}

const d = (rng, n) => 1 + Math.floor(rng() * n);

/** Cold Snap or Heat Wave, by the rolled temperature (NCW p. 3). */
export const snapOrWave = temp => (temp === "cold" || temp === "cool" ? "coldSnap" : "heatWave");

/** Roll a Strange Weather's duration: { n, unit } (n already multiplied). */
export function rollDuration(cond, rng = Math.random) {
  const dur = CONDITIONS[cond]?.duration;
  if (!dur) return null;
  return { n: d(rng, 6) * dur.times, unit: dur.unit };
}

/** Roll a Strange Weather condition (1d10) for a day that's `temp`. */
export function rollStrange(temp, rng = Math.random) {
  const pick = STRANGE[d(rng, 10) - 1];
  const cond = pick === "snapOrWave" ? snapOrWave(temp) : pick;
  return withCondition({ cond }, cond, rng);
}

/** A condition's extra rolls: its duration, and Blood Rain's 1d6. */
function withCondition(w, cond, rng) {
  const out = { ...w, cond };
  delete out.dur;
  delete out.variant;
  const dur = rollDuration(cond, rng);
  if (dur) out.dur = dur.unit === "day" ? { ...dur, day: 1 } : dur;
  if (cond === "bloodRain") out.variant = d(rng, 6);
  return out;
}

/** Roll a day on its month's table: Temperature, then Current Conditions (a 6 is Strange Weather). */
export function rollDay(season, rng = Math.random) {
  const table = TABLES[season] ?? TABLES[0];
  const [temp, f, c] = table[d(rng, 6) - 1];
  const cond = table[d(rng, 6) - 1][3];
  if (cond === "strange") return { temp, f, c, ...rollStrange(temp, rng) };
  return { temp, f, c, cond };
}

/** Roll only the temperature (the condition stays; Cold Snap/Heat Wave follow the new band). */
export function rollTemp(w, season, rng = Math.random) {
  const [temp, f, c] = (TABLES[season] ?? TABLES[0])[d(rng, 6) - 1];
  const next = { ...w, temp, f, c };
  if (w.cond === "coldSnap" || w.cond === "heatWave") next.cond = snapOrWave(temp);
  return next;
}

/** Roll only the condition. */
export function rollCondition(w, season, rng = Math.random) {
  const cond = (TABLES[season] ?? TABLES[0])[d(rng, 6) - 1][3];
  if (cond === "strange") return { ...w, ...rollStrange(w.temp, rng) };
  return withCondition(w, cond, rng);
}

/** The typical °F/°C for a band in a season (the first row with it), for weather set by hand. */
export function typicalTemp(temp, season) {
  const row = (TABLES[season] ?? TABLES[0]).find(r => r[0] === temp) ?? TABLES.flat().find(r => r[0] === temp);
  return { f: row[1], c: row[2] };
}

export const toC = f => Math.round(((Number(f) - 32) * 5) / 9);

/**
 * A day set by hand: { temp, f?, cond, n? }. Missing degrees come from the table; a Strange Weather
 * without `n` rolls its duration.
 */
export function setByHand({ temp, f, cond, n }, season, rng = Math.random) {
  if (!(temp in TEMPS)) temp = "warm";
  if (!(cond in CONDITIONS)) cond = "clear";
  const deg = Number.isFinite(Number(f)) && f !== "" && f !== null ? { f: Math.round(Number(f)), c: toC(f) } : typicalTemp(temp, season);
  const w = withCondition({ temp, ...deg }, cond, rng);
  const count = Math.floor(Number(n));
  if (w.dur && count > 0) w.dur.n = count;
  return w;
}

/** The temperature that counts: Cold Snap and Heat Wave override the roll. */
export function tempOf(w) {
  const over = CONDITIONS[w?.cond]?.temp;
  if (over) return { ...over, override: true };
  return { temp: w?.temp ?? "warm", f: w?.f, c: w?.c, label: null, override: false };
}

/** "Light Rain", or "Light Sleet" when it's cold (NCW: sleet in colder weather). */
export function condName(w) {
  const def = CONDITIONS[w?.cond];
  if (!def) return "Unknown";
  return def.sleet && tempOf(w).temp === "cold" ? def.sleet : def.name;
}

/** "60°F / 15°C", in the GM's units. */
export function degrees({ f, c }, units = "both") {
  if (!Number.isFinite(f)) return "";
  if (units === "f") return `${f}°F`;
  if (units === "c") return `${c}°C`;
  return `${f}°F / ${c}°C`;
}

/** "40 minutes", "3 hours", "Day 2 of 4". */
export function durationLabel(dur) {
  if (!dur) return "";
  if (dur.unit === "day") return dur.n > 1 ? `Day ${dur.day ?? 1} of ${dur.n}` : "All day";
  return `${dur.n} ${dur.unit}${dur.n === 1 ? "" : "s"}`;
}

/** Strange Weather that lasts minutes or hours (it runs as an event on today's clock). */
export const isShort = w => !!w?.dur && w.dur.unit !== "day";

/** The next day of a run of Strange Weather days, or null when the run is over. */
export function carryOver(w) {
  if (w?.dur?.unit !== "day" || (w.dur.day ?? 1) >= w.dur.n) return null;
  return { ...w, dur: { ...w.dur, day: (w.dur.day ?? 1) + 1 } };
}

/** The same weather? (to tell whether anything changed) */
export const sameWeather = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Blood Rain: acid (1-3) or biotoxin (4-6). */
export const bloodKind = w => (w?.cond === "bloodRain" ? ((w.variant ?? 1) <= 3 ? "acid" : "biotoxin") : null);

/** The GM's hazard tools for this weather (tables.js HAZARDS ids). */
export function hazardsOf(w) {
  if (!w) return [];
  if (w.cond === "bloodRain") return bloodKind(w) === "acid" ? ["ablate"] : ["biotoxin"];
  const list = [...(CONDITIONS[w.cond]?.hazards ?? [])];
  if (list.includes("lightning")) list.push("strike");
  return list;
}

/** A small stable hash, for picking the day's one-liner. */
const hash = s => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** Wacky the weatherman's line for a day. */
export function wackyLine(w, key = "") {
  const lines = WACKY[w?.cond] ?? WACKY.clear;
  const t = tempOf(w);
  return lines[hash(key) % lines.length].replaceAll("{f}", t.f ?? "").replaceAll("{c}", t.c ?? "");
}

/** The rules card for a day: what the book says, and what's automated. */
export function rulesCard(w) {
  const def = CONDITIONS[w?.cond] ?? CONDITIONS.clear;
  const t = tempOf(w);
  const lines = [];
  if (!t.override) {
    if (t.temp === "cold") lines.push("Cold: anyone outside most of the day (or indoors without heat) and without proper gear suffers Exposure (CP:R p. 181). A Cold-Weather Jacket Lining counts as proper gear.");
    if (t.temp === "hot") lines.push(`Hot: any existing armor penalty to REF, DEX and MOVE gets ${HOT_ARMOR} worse (−2 becomes −3). A Hot-Weather Jacket Lining takes 1 off that.`);
  }
  if (w?.cond === "bloodRain") {
    lines.push(bloodKind(w) === "acid"
      ? "This Blood Rain works like Acid Rain: each full minute in it without protection ablates all worn armor by 1 SP. An umbrella or a Waterproof Jacket Lining negates it."
      : "This Blood Rain is toxic: once a minute, anyone in it without protection is dosed as if with a Vial of Biotoxin (DV15 Resist Torture/Drugs or 3d6 to HP). An umbrella or a Waterproof Jacket Lining gives +2 to the check.");
  } else lines.push(...def.rules);
  if (w?.cond === "heatWave") lines.push("A Hot-Weather Jacket Lining counts as proper gear against Exposure, and takes 1 off the extra armor penalty.");
  if (def.penalty) lines.push(`GM's call: −${def.penalty} to ${def.penaltyWhen}. It's in your roll dialog as a situational modifier: tick it when it applies.`);
  const none = lines.length === 1 && lines[0] === "No effect.";
  return { name: condName(w), icon: def.icon, page: def.page ?? null, lines, none };
}

/* ---------------- Gear and mechanics ---------------- */

const CARRIED = new Set(["carried", "equipped"]);

/** Is an item on the character's person (carried, equipped, or installed cyberware)? */
const onPerson = item => (item.type === "cyberware" ? !!item.system?.isInstalled : CARRIED.has(item.system?.equipped));

/** The weather gear a character has on them: a Set of GEAR keys (by item name, and installed upgrades). */
export function gearOf(actor) {
  const keys = new Set();
  const look = name => {
    for (const [key, g] of Object.entries(GEAR)) if (g.match.test(name ?? "")) keys.add(key);
  };
  for (const item of actor?.items ?? []) {
    if (!onPerson(item)) continue;
    look(item.name);
    for (const up of item.system?.upgrades ?? []) look(up.name);
  }
  return keys;
}

/** Is a character protected from this weather's hazards? */
export function isProtected(w, gear) {
  const protects = w?.cond === "bloodRain" && bloodKind(w) === "biotoxin" ? [] : CONDITIONS[w?.cond]?.protects ?? [];
  return protects.some(k => gear.has(k));
}

/** Extra armor penalty (REF, DEX, MOVE) from the heat: Hot +1, Heat Wave +2; a Hot-Weather Lining takes 1 off. */
export function armorExtra(w, gear = new Set()) {
  const def = CONDITIONS[w?.cond];
  const extra = def?.armor ?? (tempOf(w).temp === "hot" ? HOT_ARMOR : 0);
  return Math.max(0, extra - (gear.has("hotLining") ? 1 : 0));
}

/** CPR's flags for an effect's changes: their categories, and which are roll-dialog options. */
function cprFlags(changes) {
  return {
    changes: {
      cats: Object.fromEntries(changes.map((c, i) => [String(i), c.cat])),
      situational: Object.fromEntries(changes.map((c, i) => [String(i), c.situational ?? { isSituational: false, onByDefault: false }]))
    }
  };
}

export const EFFECT_FLAG = "weather";

/** The weather flag on an Active Effect (or an item), if it's the Weather app's. */
export const weatherFlag = (doc, moduleId = MODULE_ID) => doc?.getFlag?.(moduleId, EFFECT_FLAG) ?? doc?.flags?.[moduleId]?.[EFFECT_FLAG] ?? null;

/**
 * The Active Effect for this weather on a character with `gear`, or null when nothing applies.
 * The GM's discretionary penalty is CPR's "all actions" modifier as a roll-dialog option, off by default
 * (situational effects players toggle when rolling). Under an umbrella in Blood Rain,
 * +2 Resist Torture/Drugs, ticked. The heat's extra armor penalty is in the flag; client.js applies it
 * to CPR's armor penalty while the effect is on.
 */
export function weatherEffect(w, gear = new Set(), { moduleId = MODULE_ID, seconds = null, worldTime = 0 } = {}) {
  if (!w) return null;
  const def = CONDITIONS[w.cond] ?? CONDITIONS.clear;
  const name = condName(w);
  const changes = [];
  if (def.penalty) changes.push({ key: "bonuses.allActions", value: -def.penalty, cat: "misc", situational: { isSituational: true, onByDefault: false } });
  if (w.cond === "bloodRain" && (gear.has("umbrella") || gear.has("waterproof"))) {
    changes.push({ key: "bonuses.resistTortureOrDrugs", value: 2, cat: "skill", situational: { isSituational: true, onByDefault: true } });
  }
  const armor = armorExtra(w, gear);
  if (!changes.length && !armor) return null;
  const t = tempOf(w);
  const parts = [def.penalty ? `${name}: −${def.penalty} when the GM calls it` : null, armor ? `${t.override ? name : TEMPS[t.temp].name}: armor penalty +${armor}` : null].filter(Boolean);
  return {
    name: `Weather: ${def.penalty || w.cond === "bloodRain" ? name : TEMPS[t.temp].name}`,
    img: "icons/svg/windmill.svg",
    description: `<p>${parts.join(". ")}.</p><p><em>Night City Weather. Managed by the Agent's Weather app: it ends with the weather.</em></p>`,
    duration: seconds ? { seconds: Math.max(1, Math.round(seconds)), startTime: worldTime } : {},
    changes: changes.map(c => ({ key: c.key, mode: 2, value: String(c.value) })),
    flags: {
      [moduleId]: { [EFFECT_FLAG]: { cond: w.cond, armor } },
      "cyberpunk-red-core": cprFlags(changes)
    }
  };
}

/** What's applied, as a signature (re-apply only when it changes). */
export const effectSig = w => (w ? JSON.stringify([w.cond, tempOf(w).temp, w.variant ?? null]) : null);

/* ---------------- Rows ---------------- */

/** The weather that counts for a row: today's event may have changed it. */
export const rowWeather = row => row?.w ?? null;

/** A day row's view for the phone. */
export function dayView(row, units = "both") {
  const w = row?.w;
  if (!w) return null;
  const t = tempOf(w);
  const def = CONDITIONS[w.cond] ?? CONDITIONS.clear;
  return {
    key: row.key,
    label: row.label,
    short: row.short,
    cond: condName(w),
    condId: w.cond,
    icon: def.icon,
    strange: !!def.strange,
    band: t.label ?? TEMPS[t.temp]?.name,
    temp: t.temp,
    degrees: degrees(t, units),
    duration: durationLabel(w.dur),
    locked: !!row.locked,
    gm: row.src === "gm",
    carry: row.src === "carry",
    missed: !!row.missed
  };
}

/** The season's name for a row. */
export const seasonName = season => SEASONS[season]?.name ?? "";

/** Seconds in a duration. */
export const durationSeconds = dur => (dur ? dur.n * (UNITS[dur.unit] ?? 0) : 0);

/*
 * What the app doesn't do on its own ("flag to GM in chat"): the per-minute damage of
 * a hazardous weather and Exposure. One line each, for a whispered GM chat card when that weather
 * starts; the GM uses the hazard buttons in Weather Control (nothing is applied automatically).
 */
const FLAG_LINES = {
  ablate: "Every full minute out in it without an umbrella or a Waterproof Jacket Lining: worn armor loses 1 SP (Ablate armor 1 SP).",
  biotoxin: "Once a minute out in it: a Vial of Biotoxin check, DV15 Resist Torture/Drugs or 3d6 to HP (+2 under an umbrella or with a Waterproof Jacket Lining).",
  poison: "More than a minute in it without Nasal Filters or an Anti-Smog Breathing Mask: a Vial of Poison check, DV13 Resist Torture/Drugs or 2d6 to HP.",
  foreign: "Too long in it without a filter or mask (Dust Storm: five minutes): the Foreign Object Critical Injury.",
  lightning: "Every ten minutes: roll for lightning (4-6: a strike nearby, 6d6).",
  radburst: "Anyone out in it without a Radiation Suit: 1d6 Rounds of high level radiation (CP:R p. 181)."
};

/** The GM's flags for this weather: [] when there's nothing to watch for. */
export function gmFlags(w) {
  if (!w) return [];
  const lines = hazardsOf(w).map(h => FLAG_LINES[h]).filter(Boolean);
  const t = tempOf(w);
  const gear = CONDITIONS[w.cond]?.exposure ?? (!t.override && t.temp === "cold" ? ["coldLining"] : null);
  if (gear) lines.push(`Exposure (CP:R p. 181): anyone outside most of the day without proper gear (${gear.map(g => GEAR[g].name).join(" or ")}).`);
  return lines;
}

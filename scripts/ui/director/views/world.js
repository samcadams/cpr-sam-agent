import { cleanRecord } from "../../../../apps/ncpd/model.js";
import { store } from "../../../store.js";
import { esc } from "../../../util/text.js";
import { phoneBtn } from "./comms.js";
import { label, listOf, row, select } from "./garden.js";
import { actions as railActions, pageHead, railed } from "./railed.js";

/*
 * Director → World: what's going on in Night City, wide. A rail of apps (railed.js), each drawn from the
 * GM Phone's page data on director.logic and run through its actions (phone:*), dropdowns (pick:*) and
 * input handlers (input:*).
 *
 * Weather (apps/weather/page.js weatherData, GM side): today and the forecast strip with the picked
 * day's tools (roll, set, lock, end), Apply & hazards with who's out in it, checks, the rules and
 * options, all at once. Set's Save reads the phone's own fields there, so it's sent here from the edit
 * the phone keeps (wxEdit).
 * NCPD (apps/ncpd/page.js ncpdData, GM side): each lookup in progress as a wide card, the shot (link
 * the subject, set the DV, oppose, ask for a new shot) beside the record you send back (the GM Phone's
 * drafts, through its [data-ncpd-field] handler); delivered, records on file, setup. The shot's buttons
 * read the phone's own fields there, so they're done here from the card's.
 * WatchBox (apps/watchbox/page.js watchboxData): every armed WatchBox with Done assessing, Trigger,
 * Silence and Disarm.
 * Jobs (ui/phone/pages/quests.js questsData/questData): the list by status beside the open job and its
 * objective tree, with the GM Phone's own job and objective actions.
 */

/* ---------------- Weather ---------------- */

const weatherData = director => director.logic.weatherData(director.logic.ctx());

const dayLine = d => `${esc(d.cond)} · ${esc(d.band ?? "")} ${esc(d.degrees ?? "")}${d.duration ? ` · ${esc(d.duration)}` : ""}`;

function weatherTodayHtml(w) {
  const t = w.today;
  const strip = w.strip.map(d => `<button type="button" class="director-wx-tile ${d.picked ? "active" : ""} ${d.strange ? "strange" : ""}" data-director="phone:wx-day" data-key="${esc(d.key)}" title="${esc(d.label)}: ${esc(d.cond)}, ${esc(d.degrees ?? "")}">
      <span>${d.isToday ? "Today" : esc(d.short ?? "")}</span><i class="${esc(d.icon)}" aria-hidden="true"></i><b>${esc(d.deg)}</b>
      <span class="director-wx-flags">${d.locked ? `<i class="fas fa-lock"></i>` : ""}${d.real ? `<i class="fas fa-eye" title="The forecast is wrong"></i>` : ""}</span></button>`).join("");
  return `<div class="director-wx-today"><i class="${esc(t.icon)} director-wx-big" aria-hidden="true"></i>
      <div><small>${esc(t.label)}</small><h3>${esc(t.cond)}</h3><span>${esc(t.band)} · ${esc(t.degrees)}</span>
      ${t.duration ? `<p class="director-sub"><i class="fas fa-hourglass-half"></i> ${esc(t.duration)}${t.event ? ` · ${esc(t.event)}` : ""}</p>` : ""}
      ${t.was ? `<p class="director-sub">The ${esc(t.was)} is over.</p>` : ""}
      <p class="director-note">“${esc(t.wacky)}” Wacky, 107.3 Morro Rock Radio</p></div></div>
    <div class="director-wx-strip" role="list" aria-label="Forecast">${strip}</div>`;
}

function weatherDayHtml(w) {
  const p = w.picked;
  const e = w.editing ? w.edit : null;
  const edit = e ? `<div class="director-cbk-compose">
      ${label(`Set ${esc(e.label)}`)}
      <label class="director-setting"><span>Temperature</span>${select(e.temps, "Temperature")}</label>
      <label class="director-setting"><span>°F</span><input type="number" name="wxF" data-director="input:input[name=wxF], input[name=wxN]" data-draft="wx-f" value="${esc(String(e.f ?? ""))}" min="-20" max="130" step="1" placeholder="from the table" aria-label="Degrees Fahrenheit"></label>
      <label class="director-setting"><span>Condition</span>${select(e.conds, "Condition")}</label>
      ${e.strange ? `<label class="director-setting"><span>How long (${esc(e.unit ?? "")}s)</span><input type="number" name="wxN" data-director="input:input[name=wxF], input[name=wxN]" data-draft="wx-n" value="${esc(String(e.n ?? ""))}" min="1" max="60" step="1" placeholder="roll it" aria-label="How long"></label>` : ""}
      <div class="director-toolbar"><button type="button" class="primary" data-director="wx-save"><i class="fas fa-floppy-disk" aria-hidden="true"></i> Save</button>${phoneBtn("wx-edit", "Cancel", { data: { key: e.key }, icon: "fa-xmark" })}</div>
    </div>` : "";
  return `${label(`${p.isToday ? "Today" : esc(p.label)} <small>${p.gm ? "set by you" : p.carry ? "the run goes on" : "rolled"}${p.locked ? " · locked" : ""}</small>`)}
    ${p.isToday ? "" : `<p class="director-sub">${dayLine(p)}</p>`}
    ${p.real ? `<p class="director-sub"><i class="fas fa-eye"></i> Really: ${esc(p.real.cond)}, ${esc(p.real.degrees)} (the forecast is wrong)</p>` : ""}
    <div class="director-toolbar">
      ${phoneBtn("wx-reroll", "Roll", { data: { key: p.key, part: "all" }, icon: "fa-dice" })}
      ${phoneBtn("wx-reroll", "Temp", { data: { key: p.key, part: "temp" }, icon: "fa-temperature-half" })}
      ${phoneBtn("wx-reroll", "Condition", { data: { key: p.key, part: "cond" }, icon: "fa-cloud" })}
      ${phoneBtn("wx-edit", "Set", { data: { key: p.key }, icon: "fa-pen", cls: w.editing ? "on" : "" })}
      ${phoneBtn("wx-lock", p.locked ? "Locked" : "Lock", { data: { key: p.key, locked: String(!!p.locked) }, icon: p.locked ? "fa-lock" : "fa-lock-open", cls: p.locked ? "on" : "" })}
      ${w.hasEvent ? phoneBtn("wx-end", "End now", { icon: "fa-forward" }) : ""}
    </div>${edit}`;
}

function weatherApplyHtml(w) {
  const people = listOf(w.people.map(x => row({ main: `<strong>${esc(x.name)}</strong>${x.safe ? ` <span class="director-tag">protected</span>` : ""}`, small: esc(x.gear ?? "") })), "Nobody.");
  const hazards = w.hazards.length ? label("Hazards") + listOf(w.hazards.map(h => row({
    main: phoneBtn("wx-hazard", esc(h.name), { data: { kind: h.kind }, icon: (h.icon ?? "").replace(/^fa[srb]? /, "") }), small: esc(h.hint ?? "")
  })), "") : "";
  const checks = w.checks.length ? label("Checks") + listOf(w.checks.map(c => row({
    main: `<strong>${esc(c.name)}</strong> <small>DV${c.dv}</small>`,
    small: c.waiting ? "Waiting for their roll." : `${c.total}: ${c.pass ? "passed" : "failed"}${c.damage ? `, ${esc(String(c.damage))} damage` : ""}`,
    tools: c.waiting ? phoneBtn("wx-check", "Roll for them", { data: { checkId: c.id }, icon: "fa-dice-d10" })
      : c.fail ? phoneBtn("wx-check-resolve", `Apply ${esc(c.dice ?? "")}`, { data: { checkId: c.id, apply: "true" }, icon: "fa-heart-crack", cls: "primary" }) + phoneBtn("wx-check-resolve", "Skip", { data: { checkId: c.id, apply: "false" }, icon: "fa-xmark" }) : ""
  })), "") : "";
  return `${label(`Apply today's weather <small>${w.applied ? `on ${w.applied} character${w.applied === 1 ? "" : "s"}` : "not applied"}</small>`)}
    <label class="director-setting"><span>Who's out in it</span>${select(w.target, "Who's out in it")}</label>
    <div class="director-toolbar">${phoneBtn("wx-apply", "Apply", { icon: "fa-check", cls: "primary" })}${phoneBtn("wx-clear", "Clear", { icon: "fa-eraser" })}</div>
    <p class="director-note">Penalties go on as roll-dialog options (off by default); the heat adds to armor penalties; a Blackout cuts the signal. It follows the weather and ends with it.</p>
    ${label(w.applied ? "Who has it" : "Who'd get it")}${people}${hazards}${checks}`;
}

function weatherRulesHtml(w) {
  const r = w.today.rules;
  const o = w.options;
  const opt = (key, on, text) => `<label class="director-check-row"><input type="checkbox" data-director="phone:wx-option" data-option="${key}" ${on ? "checked" : ""}> ${text}</label>`;
  return `${label(`<i class="${esc(r.icon ?? "")}"></i> ${esc(r.name ?? "")}: the rules`)}
    <ul class="director-wx-rules">${(r.lines ?? []).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
    ${label("Options & radio")}
    ${opt("wrong", o.wrong, "Forecasts can be wrong")}
    ${o.wrong ? `<label class="director-setting"><span>Chance a day turns out different (%)</span><input type="number" name="wxChance" data-director="input:input[name=wxChance]" min="0" max="100" step="5" value="${esc(String(o.wrongChance ?? ""))}"></label>` : ""}
    ${opt("autoApply", o.autoApply, "Apply new weather automatically (to the same characters)")}
    ${opt("radio", o.radio, "Morro Rock Radio posts the forecast in The Garden every morning")}
    <label class="director-setting"><span>Temperatures in</span>${select(o.units, "Units")}</label>
    ${w.garden ? `<div class="director-toolbar">${phoneBtn("wx-radio", "Post today's forecast in The Garden…", { icon: "fa-radio" })}</div>` : ""}
    <p class="director-note">${esc(w.today.season ?? "")} table. Night City Weather, R. Talsorian Games.</p>`;
}

function weatherPageHtml(director, w) {
  if (w.empty) return `<p class="director-empty">No forecast yet. The forecast is rolled by the active GM's client.</p>`;
  return `${weatherTodayHtml(w)}
    <div class="director-bangme">
      <div>${weatherDayHtml(w)}</div>
      <div>${weatherApplyHtml(w)}</div>
      <div>${weatherRulesHtml(w)}</div>
    </div>`;
}

const weather = {
  data: weatherData,
  count: w => (w.checks ?? []).filter(c => c.waiting || c.fail).length,
  head: () => pageHead("Weather", "Night City Weather: the forecast, what it does, and who's out in it"),
  page: weatherPageHtml,
  shape: w => (w.empty ? "empty" : w.editing ? "edit" : "weather")
};

/* ---------------- WatchBox ---------------- */

const watchboxData = director => director.logic.watchboxData(director.logic.ctx());

function watchboxPageHtml(director, b) {
  const rows = b.watches.map(x => row({
    cls: x.alarm ? "active" : "",
    lead: `<i class="fas fa-eye"></i>`,
    main: `<strong>${esc(x.name)}'s Agent</strong> <span class="director-time">${esc(x.scene)}</span>`,
    small: x.assessing ? "Assessing the room" : x.alarm ? "ALARM SOUNDING" : "Armed",
    tools: (x.assessing ? phoneBtn("wb-skip", "Done assessing", { data: { actorId: x.actorId }, icon: "fa-forward" }) : "")
      + (x.alarm ? phoneBtn("wb-silence", "Silence", { data: { actorId: x.actorId }, icon: "fa-volume-xmark" })
        : x.assessing ? "" : phoneBtn("wb-trigger", "Trigger", { data: { actorId: x.actorId }, icon: "fa-bell", cls: "primary", title: "A noise or a flash of light" }))
      + phoneBtn("wb-disarm", "Disarm", { data: { actorId: x.actorId }, cls: "danger" })
  }));
  return `${label(`Armed (${b.watches.length})`)}${listOf(rows, "No WatchBox armed.")}
    <p class="director-note">A player arms WatchBox on their own Agent; it watches a 20 × 20 m square around them. The square is a hidden template you can move or resize.</p>`;
}

const watchbox = {
  data: watchboxData,
  count: b => b.watches.filter(x => x.alarm).length,
  head: () => pageHead("WatchBox", "No/Brainer's room alarm"),
  page: watchboxPageHtml,
  shape: () => "watchbox"
};


/* ---------------- Jobs ---------------- */

/** The job list (the open tab) and the open job, if any. */
function jobsData(director) {
  const logic = director.logic;
  const ctx = logic.ctx();
  return { list: logic.questsData(ctx), job: logic.questId ? logic.questData(ctx) : null };
}

function jobHtml(q) {
  if (!q) return `<p class="director-empty director-pick">Open a job for its objectives.</p>`;
  const objectives = q.objectives.map(o => `<li class="director-item ${o.hidden || o.hiddenByParent ? "faded" : ""}" style="padding-left: ${o.indent}px">
      ${phoneBtn("objective-cycle", "", { data: { objectiveId: o.id }, icon: o.icon.replace(/^fa-(regular|solid) /, ""), cls: "director-check", title: "Incomplete → complete → failed" })}
      <div class="director-item-main">${esc(o.text)}${o.hidden ? ` <i class="fas fa-eye-slash" title="Hidden from players"></i>` : o.hiddenByParent ? ` <small>hidden with its parent</small>` : ""}</div>
      <div class="director-toolbar">
        ${phoneBtn("objective-move", "", { data: { objectiveId: o.id, dir: -1 }, icon: "fa-arrow-up", title: "Up", disabled: !o.canUp })}
        ${phoneBtn("objective-move", "", { data: { objectiveId: o.id, dir: 1 }, icon: "fa-arrow-down", title: "Down", disabled: !o.canDown })}
        ${phoneBtn("objective-add", "", { data: { parentId: o.id }, icon: "fa-plus", title: "Add a step under it" })}
        ${phoneBtn("objective-hide", "", { data: { objectiveId: o.id }, icon: o.hidden ? "fa-eye-slash" : "fa-eye", cls: o.hidden ? "on" : "", title: o.hidden ? "Show to players" : "Hide from players" })}
        ${phoneBtn("objective-edit", "", { data: { objectiveId: o.id }, icon: "fa-pen", title: "Edit" })}
        ${phoneBtn("objective-delete", "", { data: { objectiveId: o.id }, icon: "fa-trash", cls: "danger", title: "Delete" })}
      </div></li>`).join("");
  return `<header class="director-convo-head">${q.img ? `<img class="director-avatar" src="${esc(q.img)}" alt="">` : ""}
      <div class="director-convo-title"><h2>${esc(q.name)}${q.hidden ? ` <i class="fas fa-eye-slash" title="Hidden from players"></i>` : ""}</h2></div>
      <div class="director-toolbar">${select(q.statusPicker, "Status")}${phoneBtn("quest-back", "", { icon: "fa-xmark", title: "Close" })}</div></header>
    <div class="director-detail-body">
      <div class="director-toolbar">
        ${phoneBtn("quest-edit", "Edit", { icon: "fa-pen" })}
        ${phoneBtn("quest-hide", q.hidden ? "Show to players" : "Hide from players", { icon: q.hidden ? "fa-eye" : "fa-eye-slash", cls: q.hidden ? "on" : "" })}
        ${phoneBtn("quest-show-players", "Pop up for players", { icon: "fa-display" })}
        ${phoneBtn("quest-popout", "Pop out", { icon: "fa-up-right-from-square" })}
        ${phoneBtn("quest-delete", "", { icon: "fa-trash", cls: "danger", title: "Delete" })}
      </div>
      ${q.description ? `<p class="director-bio">${esc(q.description)}</p>` : ""}
      ${label("Objectives", phoneBtn("objective-add", "", { icon: "fa-plus", title: "Add an objective" }))}
      <ol class="director-list">${objectives || `<li class="director-empty">No objectives yet.</li>`}</ol>
    </div>`;
}

function jobsPageHtml(director, { list, job }) {
  const rows = list.rows.map(r => row({
    cls: `${r.hidden ? "faded" : ""} ${job?.id === r.id ? "active" : ""}`,
    lead: r.img ? `<img class="director-avatar" src="${esc(r.img)}" alt="">` : "",
    main: `<button type="button" class="director-plain" data-director="phone:quest-open" data-quest-id="${esc(r.id)}"><strong>${esc(r.name)}</strong></button>${r.hidden ? ` <i class="fas fa-eye-slash" title="Hidden from players"></i>` : ""}${r.progress ? ` <span class="director-tag">${esc(r.progress)}</span>` : ""}`,
    small: esc(r.summary)
  }));
  const note = list.availableNote ? `<p class="director-note">${esc(list.availableNote.text)} ${phoneBtn("jobs-available-toggle", list.availableNote.shown ? "Hide the tab" : "Show the tab", { icon: list.availableNote.shown ? "fa-eye-slash" : "fa-eye" })}</p>` : "";
  return `<div class="director-jobs">
    <div><div class="director-toolbar">${phoneBtn("quest-new", "New job", { icon: "fa-plus", cls: "primary" })}</div>${note}${listOf(rows, esc(list.emptyText))}</div>
    <div class="director-garden-detail"><div class="director-detail">${jobHtml(job)}</div></div>
  </div>`;
}

const jobs = {
  data: jobsData,
  count: () => 0,
  head: ({ list }) => pageHead("Jobs", "Jobs and their objectives, as players see them on their Agents", { tabs: list.tabs, action: "quest-tab" }),
  page: jobsPageHtml,
  shape: ({ list }) => list.tabs.find(t => t.active)?.id ?? "jobs"
};

/* ---------------- NCPD ---------------- */

const ncpdData = director => director.logic.ncpdData(director.logic.ctx());

/** A field of a lookup's record card: the GM Phone's handler keeps it in its draft (logic.ncpdDrafts). */
function ncpdField(id, path, value, attrs = "") {
  return `<input type="text" data-ncpd-field="${path}" data-id="${esc(id)}" data-director="input:[data-ncpd-field]" data-draft="ncpd:${esc(id)}:${path}" value="${esc(String(value ?? ""))}" ${attrs}>`;
}

function ncpdCardHtml(n, l) {
  const d = l.draft;
  const r = d.record;
  const lines = (list, fields, add) => `${label(add[1])}${r[list].map((x, i) => `<div class="director-ncpd-line">
      ${fields.map(([key, attrs]) => ncpdField(l.id, `record.${list}.${i}.${key}`, x[key], attrs)).join("")}
      ${list === "bounties" ? phoneBtn("ncpd-job", "", { data: { id: l.id, index: i }, icon: "fa-list-check", title: "Add to Jobs (hidden until you show it)" }) : ""}
      ${phoneBtn("ncpd-row-remove", "", { data: { id: l.id, list, index: i }, icon: "fa-xmark", title: "Remove" })}</div>`).join("")}
    <div class="director-toolbar">${phoneBtn("ncpd-row-add", add[0], { data: { id: l.id, list }, icon: "fa-plus" })}</div>`;
  const record = d.isRecord ? `
      ${d.fromSaved ? `<p class="director-sub"><i class="fas fa-folder-open"></i> Started from the record on file.</p>` : ""}
      ${l.hasSaved ? `<div class="director-ncpd-line"><input type="text" name="ncpdSaved" list="director-ncpd-saved" placeholder="A record on file" aria-label="A record on file"><button type="button" data-director="ncpd-use-saved" data-id="${esc(l.id)}"><i class="fas fa-folder-open" aria-hidden="true"></i> Use saved</button></div>` : ""}
      <div class="director-ncpd-line">${ncpdField(l.id, "record.name", r.name, `placeholder="Name on file" aria-label="Name on file"`)}${ncpdField(l.id, "record.aliases", r.aliasesText, `placeholder="Aliases, comma separated" aria-label="Aliases"`)}</div>
      <div class="director-ncpd-line">${ncpdField(l.id, "record.match", r.match, `list="director-ncpd-matches" placeholder="Photo match" aria-label="Photo match"`)}${ncpdField(l.id, "record.affiliation", r.affiliation, `placeholder="Affiliation (gang, corp…)" aria-label="Affiliation"`)}</div>
      <div class="director-picks">${r.cautions.map(c => `<label class="director-chip"><input type="checkbox" data-ncpd-field="record.cautions" data-caution="${esc(c.name)}" data-id="${esc(l.id)}" data-director="input:[data-ncpd-field]" ${c.on ? "checked" : ""}> ${esc(c.name)}</label>`).join("")}</div>
      ${lines("priors", [["charge", `list="director-ncpd-charges" placeholder="Charge"`], ["year", `class="short" placeholder="Year"`], ["disposition", `list="director-ncpd-dispositions" placeholder="Disposition"`], ["sentence", `list="director-ncpd-sentences" placeholder="Sentence"`]], ["Prior", "Priors"])}
      ${lines("warrants", [["charge", `list="director-ncpd-charges" placeholder="Charge"`], ["issuer", `list="director-ncpd-issuers" placeholder="Issued by"`], ["issued", `class="short" placeholder="Date"`]], ["Warrant", "Active warrants"])}
      ${lines("bounties", [["amount", `class="short" placeholder="eb"`], ["issuer", `list="director-ncpd-issuers" placeholder="Posted by"`], ["terms", `list="director-ncpd-terms" placeholder="Terms"`], ["reason", `list="director-ncpd-charges" placeholder="Wanted for"`]], ["Bounty", "Bounties"])}
      <textarea data-ncpd-field="record.notes" data-id="${esc(l.id)}" data-director="input:[data-ncpd-field]" data-draft="ncpd:${esc(l.id)}:record.notes" rows="2" placeholder="Other public notes (last known address, known associates…)" aria-label="Public notes">${esc(r.notes ?? "")}</textarea>
      <label class="director-check-row"><input type="checkbox" data-ncpd-field="save" data-id="${esc(l.id)}" data-director="input:[data-ncpd-field]" ${d.save ? "checked" : ""} ${l.subject ? "" : "disabled"}> Keep on file for later lookups${l.subject ? ` (${esc(l.subject.name)})` : ""}</label>` : "";
  return `<article class="director-order ${l.overdue ? "pending" : ""}" data-lookup="${esc(l.id)}">
    <header><strong>${esc(l.who)}</strong> <small>${esc(l.num ?? "")}</small><span class="director-time ${l.overdue ? "director-problem" : ""}">${esc(l.dueLabel)}</span></header>
    <div class="director-ncpd-card">
      <div>
        <img class="director-ncpd-photo" src="${esc(l.img)}" alt="The photo">
        ${l.caption ? `<p class="director-writer-note">“${esc(l.caption)}”</p>` : ""}
        <p class="director-sub">${l.subject ? `Subject: <button type="button" class="director-plain" data-director="phone:ncpd-open-actor" data-actor-id="${esc(l.subject.id)}"><i class="fas fa-user"></i> ${esc(l.subject.name)}</button>${l.tokenName ? ` (token “${esc(l.tokenName)}”)` : ""}` : l.tokenName ? `Token “${esc(l.tokenName)}”, no actor.` : "A picture: link who it shows."}</p>
        <div class="director-ncpd-line"><input type="text" name="ncpdLink" list="director-ncpd-actors" value="${esc(l.subject?.name ?? "")}" placeholder="Actor name" aria-label="Who is in the picture"><button type="button" data-director="ncpd-link" data-id="${esc(l.id)}"><i class="fas fa-link" aria-hidden="true"></i> Link</button></div>
        <p>${l.ask ? `<i class="fas fa-camera"></i> Waiting for a new shot: ${esc(l.ask.skill)}, DV ${l.ask.dv}…`
          : `<i class="fas fa-dice-d10"></i> ${esc(l.skill ?? "")} <b>${esc(String(l.roll?.total ?? "?"))}</b> vs ${l.opposed ? `${esc(l.opposed.skill)} <b>${l.opposed.total}</b>` : `DV ${l.dv}`}: ${l.usable ? `<span class="director-tag">usable shot</span>` : `<span class="director-tag warn">unusable shot</span>`}${l.roll?.detail ? ` <small>(${esc(l.roll.detail)})</small>` : ""}`}</p>
        <div class="director-ncpd-line"><input type="number" name="ncpdDv" class="short" value="${esc(String(l.dv ?? ""))}" min="1" max="40" aria-label="DV"><button type="button" data-director="ncpd-dv" data-id="${esc(l.id)}" title="Set the DV (a moving target, darkness, distance)">Set DV</button>
          ${l.subject ? `<input type="text" name="ncpdOppose" list="director-ncpd-skills" value="${esc(n.picks.oppose)}" aria-label="The subject's skill"><button type="button" data-director="ncpd-oppose" data-id="${esc(l.id)}" title="Roll the subject's skill against the shot (whispered)">Oppose</button>` : ""}</div>
        <div class="director-ncpd-line"><input type="text" name="ncpdAskSkill" list="director-ncpd-skills" value="${esc(l.skill ?? "")}" aria-label="Skill for a new shot"><input type="number" name="ncpdAskDv" class="short" value="${esc(String(l.dv ?? ""))}" min="1" max="40" aria-label="DV for a new shot"><button type="button" data-director="ncpd-ask" data-id="${esc(l.id)}"><i class="fas fa-camera-rotate" aria-hidden="true"></i> New shot</button></div>
      </div>
      <div>
        ${label("Result")}
        <div class="director-picks">${n.picks.results.map(x => `<label class="director-check-row"><input type="radio" name="ncpdKind-${esc(l.id)}" value="${esc(x.value)}" data-ncpd-field="kind" data-id="${esc(l.id)}" data-director="input:[data-ncpd-field]" ${x.value === d.kind ? "checked" : ""}> ${esc(x.label)}</label>`).join("")}</div>
        ${d.isInconclusive ? ncpdField(l.id, "reason", d.reason, `list="director-ncpd-reasons" aria-label="Why it's inconclusive"`) : ""}
        ${record}
        <label class="director-check-row"><input type="checkbox" data-ncpd-field="flagged" data-id="${esc(l.id)}" data-director="input:[data-ncpd-field]" ${d.flagged ? "checked" : ""}> NCPD flags this lookup <small>(the player isn't told)</small></label>
        <div class="director-toolbar">${phoneBtn("ncpd-deliver", l.overdue ? "Deliver" : "Deliver now", { data: { id: l.id }, icon: "fa-paper-plane", cls: "primary" })}${phoneBtn("ncpd-delete", "Delete", { data: { id: l.id }, icon: "fa-trash", cls: "danger" })}</div>
      </div>
    </div>
  </article>`;
}

function ncpdPageHtml(director, n) {
  const list = (id, values) => `<datalist id="director-ncpd-${id}">${values.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const setting = (key, text, type = "number", attrs = `min="0"`) => `<label class="director-setting"><span>${text}</span><input type="${type}" data-ncpd-setting="${key}" data-director="input:[data-ncpd-setting]" value="${esc(String(n.config[key] ?? ""))}" ${attrs}></label>`;
  return `<div class="director-ncpd">
    <div>${label(`Lookups in progress (${n.pending.length})`)}${n.pending.map(l => ncpdCardHtml(n, l)).join("") || `<p class="director-empty">No lookups waiting.</p>`}</div>
    <div>${label("Delivered")}${listOf(n.delivered.map(l => row({
      main: `<strong>${esc(l.who)}</strong> <small>${esc(l.num ?? "")} · ${esc(l.ago ?? "")}</small>${l.flagged ? ` <i class="fas fa-flag" title="NCPD flagged this lookup"></i>` : ""}`, small: esc(l.line)
    })), "Nothing yet.")}
      ${label(`Records on file (${n.saved.length})`)}${listOf(n.saved.map(x => row({
        main: `<strong>${esc(x.name)}</strong> <small>${esc(x.actor)}</small>`, small: esc(x.summary),
        tools: phoneBtn("ncpd-forget", "", { data: { actorId: x.actorId }, icon: "fa-trash", cls: "danger", title: "Forget this record" })
      })), "None yet.")}
      <p class="director-note">A delivered record is kept on its subject's actor, so the next lookup of them starts from it. Players never see this list.</p>
      ${label("Setup")}${setting("minutes", "Results after (world minutes)")}${setting("warn", "Remind me (minutes before)")}${setting("skill", "Shot skill", "text", `list="director-ncpd-skills"`)}${setting("dv", "Shot DV", "number", `min="1" max="40"`)}
      <p class="director-note">Nothing is delivered by itself: you're told when results are nearly due and when they're due. Deliver whenever suits the scene.</p></div>
    ${list("charges", n.picks.charges)}${list("sentences", n.picks.sentences)}${list("issuers", n.picks.issuers)}${list("skills", n.picks.skills)}${list("dispositions", n.picks.dispositions)}
    ${list("terms", n.picks.terms)}${list("matches", n.picks.matches)}${list("reasons", n.picks.reasons)}${list("actors", n.picks.actors)}${list("saved", n.saved.map(x => x.name))}
  </div>`;
}

const ncpd = {
  data: ncpdData,
  count: n => n.pending.length,
  head: () => pageHead("NCPD", "Crime Database: photo lookups and the records you send back"),
  page: ncpdPageHtml,
  shape: () => "ncpd"
};

/* ---------------- The view ---------------- */

const APPS = [["weather", "Weather", "fa-cloud-sun-rain"], ["ncpd", "NCPD", "fa-building-shield"], ["watchbox", "WatchBox", "fa-eye"], ["jobs", "Jobs", "fa-list-check", "jobs"]];
const PAGES = { weather, ncpd, watchbox, jobs };

export const { html, refresh, attach } = railed("world", "World apps", APPS, PAGES);

/** A named field on the clicked control's NCPD lookup card. */
const cardField = (event, name) => event.target.closest("[data-lookup]")?.querySelector(`[name="${name}"]`)?.value ?? "";

export const actions = {
  ...railActions,
  /* NCPD: the GM Phone's versions read its own fields; these read the lookup's card here. */
  "ncpd-dv"({ id }, event) {
    store.request("ncpd-dv", { id, dv: Number(cardField(event, "ncpdDv")) });
  },
  "ncpd-oppose"({ id }, event) {
    store.request("ncpd-oppose", { id, skill: cardField(event, "ncpdOppose") });
  },
  "ncpd-ask"({ id }, event) {
    store.request("ncpd-ask", { id, skill: cardField(event, "ncpdAskSkill"), dv: Number(cardField(event, "ncpdAskDv")) });
  },
  "ncpd-link"({ id }, event) {
    const name = cardField(event, "ncpdLink").trim();
    const actor = name ? game.actors.getName(name) : null;
    if (name && !actor) return ui.notifications.warn(`No actor named "${name}".`);
    store.request("ncpd-link", { id, actorId: actor?.id ?? null });
    delete this.logic.ncpdDrafts?.[id]; // a fresh card for the newly linked subject
  },
  "ncpd-use-saved"({ id }, event) {
    const name = cardField(event, "ncpdSaved").trim().toLowerCase();
    const saved = Object.values(store.apps.ncpdRecords ?? {}).find(r => r.name.toLowerCase() === name);
    const draft = this.logic._ncpdDraft(id);
    if (!draft) return;
    if (!saved) return ui.notifications.warn("No record on file by that name.");
    Object.assign(draft, { kind: "record", record: cleanRecord(foundry.utils.deepClone(saved)) });
    this.refresh({ all: true });
  },
  /** Weather: save the day being set, from the edit the GM Phone keeps (its own Save reads the phone's fields). */
  "wx-save"() {
    const e = this.logic.wxEdit;
    if (!e) return;
    const num = v => (v === "" || v == null ? null : Number(v));
    if (store.request("wx-set", { key: e.key, temp: e.temp, cond: e.cond, f: num(e.f), n: num(e.n) })) {
      this.logic.wxEdit = null;
      delete this.drafts["wx-f"];
      delete this.drafts["wx-n"];
      this.refresh({ all: true });
    }
  }
};

import { buildTrack } from "../../../../apps/redline/model.js";
import { drawCard } from "../../../../apps/redline/draw.js";
import { esc } from "../../../util/text.js";
import { phoneBtn } from "./comms.js";
import { label, listOf, row, select } from "./garden.js";
import { actions as railActions, pageHead, railed } from "./railed.js";

/*
 * Director → Apps: the apps themselves, wide. A rail (railed.js) of Setup, then the apps' own GM pages,
 * each drawn from the GM Phone's page data on director.logic and run through its actions (phone:*),
 * dropdowns (pick:*) and input handlers (input:*).
 *
 * Setup (ui/phone/pages/control.js controlData, appSettings.js): every app's Control switch, name and
 * icon side by side, Messages' and Jobs' own settings (the gear in their header on the GM Phone), and
 * Clear app data.
 * Game boards, the GM sides of: BREACH (breaches going on: allow, pause, time, cut off; Breach Points and
 * the point editor, the phone's brDraft), REDLINE (switches, the track builder, nominations, tracks and
 * their boards; layout cards drawn in `attach`; the fly-through stays on the GM Phone), Roach Race (cabinet,
 * riders' passes and steeds, steeds, Hall of Fame), NCART Runner (leaderboard, obstacles, power-ups), Gacha
 * (the machine's settings and collectibles; everyone's shelves), Achieve! (a character's badges beside the
 * open one; Mystery Boxes), Flappy Chrome (leaderboard, Maelstrom Heat).
 * Services: the App Store (the catalogue as a table, characters' apps and subscriptions, listings), Ask Alex (each question wide: the Data Pool matches beside the answer and Claude's draft; the
 * answered list, keywords and the API settings), Combat Cabb (rides, where the party is, fares, timing,
 * places; its map stays on the GM Phone), DataPool (deep crawls to confirm, suggested and drafts, scheduled,
 * from journals, published, side by side; Edit opens DataPool's own editor window). Calendar and Notes
 * aren't here: they're the players' own calendars and notes.
 */

/* ---------------- Setup ---------------- */

function setupData(director) {
  const logic = director.logic;
  const ctx = logic.ctx();
  const settingsOf = app => logic.with({ app, appSettings: app }, () => logic.appSettingsData(ctx));
  return { control: logic.controlData(ctx), messages: settingsOf("messages"), quests: settingsOf("quests") };
}

/** An app setting's switch: the GM Phone's own Control handlers (data-feature, data-permission). */
function toggleHtml(t) {
  const attr = t.permission ? `data-permission="${t.key}" data-director="input:input[data-permission=playerUploads]"` : `data-feature="${t.key}" data-director="input:input[data-feature]"`;
  return `<label class="director-check-row ${t.sub ? "director-sub-option" : ""}"><input type="checkbox" ${attr} ${t.on ? "checked" : ""} ${t.disabled ? "disabled" : ""}> ${esc(t.label)}</label>
    ${t.note ? `<p class="director-note">${esc(t.note)}</p>` : ""}`;
}

/** A name or icon field: blank or the default follows the default. */
const lookField = (attr, r) => `<label class="director-setting"><span>${esc(r.name)}</span><input type="text" data-${attr}="${esc(r.key)}" data-director="input:input[data-${attr}]" value="${esc(r.value ?? "")}" placeholder="${esc(r.placeholder ?? "")}"></label>`;

function setupPageHtml(director, { control: c, messages, quests }) {
  const switches = c.apps.map(a => `<label class="director-check-row" ${a.title ? `title="${esc(a.title)}"` : ""}><input type="checkbox" data-feature="${esc(a.key)}" data-director="input:input[data-feature]" ${a.on ? "checked" : ""}> <i class="${esc(a.icon)}"></i> ${esc(a.label)}</label>`).join("");
  const clearing = c.clearing.apps.map(a => row({
    lead: `<i class="${esc(a.icon ?? "")}"></i>`, main: `<strong>${esc(a.name ?? "")}</strong>`,
    tools: a.items.map(i => phoneBtn("app-clear", esc(i.label), { data: { target: i.target }, cls: "danger" })).join("")
  }));
  return `<div class="director-bangme">
    <div>${label("Apps")}${switches}
      <p class="director-note">Communications is Contacts, Messages and calls together. An app switched off is gone from every Agent; its data stays.</p>
      ${label(`<i class="${esc(messages?.icon ?? "")}"></i> ${esc(messages?.name ?? "Messages")}`)}${(messages?.toggles ?? []).map(toggleHtml).join("")}
      <label class="director-setting director-wide-field"><span>GM Phone quick replies, one a line</span><textarea name="quickReplies" data-director="input:textarea[name=quickReplies]" rows="4">${esc(messages?.quickReplies ?? "")}</textarea></label>
      ${label(`<i class="${esc(quests?.icon ?? "")}"></i> ${esc(quests?.name ?? "Jobs")}`)}${(quests?.toggles ?? []).map(toggleHtml).join("")}</div>
    <div>${label("App names", phoneBtn("control-reset-look", "Defaults", { icon: "fa-rotate-left", title: "Emoji, labels, app names and icons back to their defaults (the money format stays)" }))}
      <div class="director-look">${c.names.map(r => lookField("app-name", r)).join("")}</div></div>
    <div>${label("Icons")}<div class="director-look">${c.icons.map(r => lookField("icon", r)).join("")}</div>
      <p class="director-note">Font Awesome classes, e.g. <em>fas fa-water</em>.</p>
      ${label("Clear app data")}<label class="director-setting"><span>Whose</span>${select(c.clearing.who, "Whose data")}</label>
      ${listOf(clearing, "Nothing to clear.")}
      <p class="director-note">Each asks first. This can't be undone.</p></div>
  </div>`;
}

const setup = {
  data: setupData,
  count: () => 0,
  head: () => pageHead("Setup", "Every app's switch, name and icon; Messages' and Jobs' settings; clearing app data"),
  page: setupPageHtml,
  shape: () => "setup"
};


/* ---------------- BREACH ---------------- */

const breachData = director => director.logic.breachData(director.logic.ctx());

/** The Breach Point editor (the GM Phone's draft, brDraft, kept by its [data-br-field]/[data-br-daemon] handlers). */
function breachEditorHtml(e) {
  const field = (key, attrs) => `<input data-br-field="${key}" data-director="input:[data-br-field]" data-draft="br:${key}" ${attrs}>`;
  const daemons = e.daemonRows.map(x => `<div class="director-order">
      <div class="director-ncpd-line"><input type="text" data-br-daemon="${esc(x.id)}" data-br-key="name" data-director="input:[data-br-daemon]" data-draft="br-d:${esc(x.id)}" value="${esc(x.name)}" maxlength="40" aria-label="Daemon name">
        ${select(x.lens, "Sequence length")}
        ${x.first ? "" : phoneBtn("breach-daemon-up", "", { data: { daemonId: x.id }, icon: "fa-arrow-up", title: "Move up" })}
        ${x.only ? "" : phoneBtn("breach-daemon-remove", "", { data: { daemonId: x.id }, icon: "fa-trash", cls: "danger", title: "Remove this daemon" })}</div>
      <textarea data-br-daemon="${esc(x.id)}" data-br-key="effect" data-director="input:[data-br-daemon]" data-draft="br-e:${esc(x.id)}" rows="2" maxlength="600" placeholder="What it does at the table (only you see this)" aria-label="What ${esc(x.name)} does">${esc(x.effect)}</textarea>
    </div>`).join("");
  const check = (key, on, text, value = "") => `<label class="director-check-row"><input type="checkbox" data-br-field="${key}" data-director="input:[data-br-field]" ${value ? `value="${esc(value)}"` : ""} ${on ? "checked" : ""}> ${text}</label>`;
  return `${label(e.isNew ? "New Breach Point" : `Edit ${esc(e.name)}`)}
    ${field("name", `type="text" value="${esc(e.name ?? "")}" maxlength="60" placeholder="Name (what the player sees)" aria-label="Breach Point name"`)}
    <label class="director-setting"><span>DV (Backdoor)</span>${field("dv", `type="number" value="${esc(String(e.dv ?? ""))}" min="0" max="40" aria-label="DV"`)}</label>
    <label class="director-setting"><span>Grid size</span>${select(e.sizes, "Grid size")}</label>
    ${label("Daemons", e.canAdd ? select(e.presets, "Add a daemon") : "")}${daemons}
    ${label("Who sees it")}${check("everyone", e.everyone, "Every character can see it")}
    ${e.everyone ? "" : e.characters.map(c => check("actor", c.on, esc(c.name), c.id)).join("")}
    <label class="director-setting"><span>Where</span>${select(e.anchors, "Where")}</label>
    ${e.hasAnchor && e.rangeHint ? `<label class="director-setting"><span>Range (${esc(e.rangeHint)})</span>${field("range", `type="number" value="${esc(String(e.range ?? ""))}" min="1" max="1000" placeholder="20"`)}</label>` : ""}
    ${check("single", e.single, "Single use (closes once something is uploaded)")}
    <div class="director-toolbar">${phoneBtn("breach-draft-save", "Save", { icon: "fa-floppy-disk", cls: "primary" })}${phoneBtn("breach-draft-cancel", "Cancel")}</div>`;
}

function breachPageHtml(director, b) {
  const live = listOf(b.live.map(r => row({
    lead: `<i class="fas fa-microchip"></i>`,
    main: `<strong>${esc(r.who)}</strong> <span class="director-time">${esc(r.name)} · DV ${r.dv}</span>`,
    small: r.asked ? "Asks to breach." : r.approved ? "Waiting for their Backdoor roll." : `Rolled ${r.roll ?? "?"} · ${esc(r.progress)} · ${r.uploaded}/${r.of} uploaded${r.paused ? " · <b>PAUSED</b>" : ""}`,
    tools: r.asked
      ? phoneBtn("breach-approve", "Allow", { data: { runId: r.id }, icon: "fa-check", cls: "primary" }) + phoneBtn("breach-deny", "Refuse", { data: { runId: r.id }, icon: "fa-xmark" })
      : (r.running ? phoneBtn("breach-pause", r.paused ? "Resume" : "Pause", { data: { runId: r.id }, icon: r.paused ? "fa-play" : "fa-pause" }) : "")
        + (r.ready || r.running ? phoneBtn("breach-time", "10 s", { data: { runId: r.id, seconds: 10 }, icon: "fa-plus", title: "Give them 10 more seconds" }) + phoneBtn("breach-time", "Trace spike", { data: { runId: r.id, seconds: -10 }, icon: "fa-bolt", title: "Trace spike: 10 seconds less" }) : "")
        + phoneBtn("breach-end", "Cut off", { data: { runId: r.id }, icon: "fa-plug-circle-xmark", cls: "danger" })
  })), "No breaches going on.");
  const recent = b.recent.length ? label("Recent") + listOf(b.recent.map(r => row({ main: `<strong>${esc(r.who)}</strong> <span class="director-time">${esc(r.time ?? "")}</span>`, small: `${esc(r.name)}: ${esc(r.line)}` })), "") : "";
  const points = listOf(b.points.map(p => row({
    cls: p.used ? "faded" : "",
    lead: `<i class="fas fa-network-wired"></i>`,
    main: `<strong>${esc(p.name)}</strong> <span class="director-time">DV ${p.dv} · ${p.size}×${p.size}${p.single ? " · single use" : ""}${p.used ? " · USED" : ""}</span>`,
    small: `${esc(p.daemons)}<br>${esc(p.who)} · ${esc(p.where)}`,
    tools: select(p.send, "Send this breach to") + phoneBtn("breach-edit", "", { data: { pointId: p.id }, icon: "fa-pen", title: "Edit" })
  })), "No Breach Points yet.");
  return `<div class="director-columns">
    <div>${label("Going on")}${live}${recent}<p class="director-note">Results come to you as whispered chat cards. Nothing applies itself: you resolve each uploaded daemon by hand.</p></div>
    <div>${b.editor ? breachEditorHtml(b.editor) : `${label("Breach Points", phoneBtn("breach-new", "", { icon: "fa-plus", title: "New Breach Point" }))}${points}`}</div>
  </div>`;
}

const breach = {
  data: breachData,
  count: b => b.live.filter(r => r.asked).length,
  head: () => pageHead("BREACH", "Breach Points, and the breaches going on"),
  page: breachPageHtml,
  shape: b => (b.editor ? `edit:${b.editor.id ?? "new"}` : "breach")
};

/* ---------------- Roach Race ---------------- */

const roachData = director => director.logic.roachData(director.logic.ctx());

function roachPageHtml(director, r) {
  const cfg = r.cfg;
  const flag = (key, text) => `<label class="director-check-row"><input type="checkbox" data-roach-flag="${key}" data-director="input:input[data-roach-flag]" ${cfg[key] ? "checked" : ""}> ${text}</label>`;
  const num = (key, text, max) => `<label class="director-setting"><span>${text}</span><input type="number" min="0" max="${max}" data-roach-num="${key}" data-director="input:input[data-roach-num]" value="${esc(String(cfg[key] ?? ""))}"></label>`;
  const riders = listOf(r.riders.map(x => row({
    main: `<strong>${esc(x.name)}</strong> <span class="director-tag">${x.pass ? `Pass today${x.paid ? ` (${esc(x.paid)})` : ""}` : "No pass today"}</span>`,
    small: [x.steeds.map(s => `${esc(s.name)}${s.riding ? ` <i class="fas fa-horse" title="Riding"></i>` : ""} ${phoneBtn("roach-take", "", { data: { actorId: x.actorId, steed: s.id }, icon: "fa-xmark", cls: "director-plain", title: "Take back" })}`).join(" · "), x.record && esc(x.record)].filter(Boolean).join("<br>"),
    tools: (x.pending ? phoneBtn("roach-record", "Award prize", { data: { actorId: x.actorId, award: 1 }, icon: "fa-trophy", cls: "primary" }) + phoneBtn("roach-record", "No prize", { data: { actorId: x.actorId, award: 0 } }) : "")
      + (x.gift ? select(x.gift, `Give ${x.name} a steed`) : "")
      + (x.pass
        ? (x.paid ? phoneBtn("roach-refund", "", { data: { actorId: x.actorId }, icon: "fa-rotate-left", title: "Take the pass back and refund it" }) : "") + phoneBtn("roach-grant", "", { data: { actorId: x.actorId, on: 0 }, icon: "fa-ban", title: "Take today's pass back (no refund)" })
        : phoneBtn("roach-grant", "", { data: { actorId: x.actorId, on: 1 }, icon: "fa-ticket", title: "Give a day pass, free" }))
  })), "No player characters.");
  const steeds = r.steedList.map(s => `<div class="director-ncpd-line">
      <input type="text" maxlength="40" data-roach-steed="${esc(s.id)}" data-field="name" data-director="input:[data-roach-steed]" value="${esc(s.name)}" aria-label="Steed name">
      ${s.fixed ? `<small>Free, always</small>` : `<input type="number" min="0" max="99999" class="short" data-roach-steed="${esc(s.id)}" data-field="price" data-director="input:[data-roach-steed]" value="${esc(String(s.price ?? ""))}" aria-label="${esc(s.name)} price in eddies" title="Price (eb)">${select(s.sale, `${s.name}: where it's sold`)}`}</div>`).join("");
  const board = listOf((r.board ?? []).map(e => row({
    lead: `<b class="director-letter">${esc(String(e.rank))}</b>`,
    main: `<strong>${esc(e.name)}</strong>${e.who ? ` <small>(${esc(e.who)})</small>` : ""}${e.fake ? ` <small>(made up)</small>` : ""}`,
    tools: `<span class="director-price">${esc(String(e.score))}</span>${phoneBtn("roach-remove", "", { data: { id: e.id }, icon: "fa-xmark", title: "Remove" })}`
  })), "No runs yet.");
  return `<div class="director-bangme">
    <div>${label("Cabinet")}${flag("out", "Out of order (nobody plays)")}${flag("freePlay", "Free play (no pass needed)")}
      ${num("price", "Day pass (eb)", 99999)}${num("record", "House Record (0: none)", 999999)}
      <label class="director-setting"><span>Prize</span><input type="text" maxlength="120" data-roach-text="prize" data-director="input:input[data-roach-text]" value="${esc(cfg.prize ?? "")}" placeholder="What beating the record wins"></label>
      ${label("Steeds")}${steeds}</div>
    <div>${label("Riders")}${riders}</div>
    <div>${label("Hall of Fame")}${board}
      <div class="director-ncpd-line"><input type="text" name="roachName" maxlength="24" placeholder="Name" aria-label="Name"><input type="number" name="roachScore" class="short" min="0" max="999999" value="1200" aria-label="Score">${phoneBtn("roach-fake", "", { icon: "fa-plus", title: "Add to the board" })}</div>
      <div class="director-toolbar">${phoneBtn("roach-fill", "Fill with randoms", { icon: "fa-shuffle" })}${phoneBtn("roach-reset", "Clear the board", { icon: "fa-trash", cls: "danger" })}</div></div>
  </div>`;
}

const roach = {
  data: roachData,
  count: r => r.riders.filter(x => x.pending).length,
  head: () => pageHead("Roach Race", "The cabinet, riders and their steeds, the Hall of Fame"),
  page: roachPageHtml,
  shape: () => "roach"
};


/* ---------------- Redline ---------------- */

const redlineData = director => director.logic.redlineData(director.logic.ctx());

function redlineBuilderHtml(b) {
  const draftNum = (key, text, range, value) => `<label class="director-setting"><span>${text}</span><input type="number" data-rl-draft="${key}" data-director="input:input[data-rl-draft]" min="${range.min}" max="${range.max}" ${key === "length" ? `step="100"` : ""} value="${esc(String(value))}"></label>`;
  return `${label(`Track builder${b.editing ? `: ${esc(b.name)}` : ""}`)}
    <input type="text" name="redlineName" data-director="input:input[name=redlineName]" data-draft="rl-name" value="${esc(b.name ?? "")}" maxlength="40" aria-label="Track name" placeholder="Name">
    <canvas class="director-rl-card big" data-rl-card="draft" aria-label="Layout of ${esc(b.name ?? "")}"></canvas>
    <p class="director-sub">${esc(b.stats)}${b.from ? ` · nominated by ${esc(b.from)}` : ""}</p>
    ${b.locked ? `<p class="director-note">A ${esc(b.status)} track keeps its layout (its board and ghosts are for this layout); only its name changes.</p>` : `
      <label class="director-setting"><span>District</span>${select(b.districts, "District")}</label><p class="director-note">${esc(b.blurb ?? "")}</p>
      <label class="director-setting"><span>Kind</span>${select(b.kinds, "Kind")}</label>
      ${draftNum("length", b.circuit ? "Lap length (m)" : "Length (m)", b.range, b.length)}
      ${b.circuit ? draftNum("laps", "Laps", b.lapsRange, b.laps) : ""}
      <label class="director-setting"><span>Difficulty</span>${select(b.difficulties, "Difficulty")}</label>
      ${b.families.map(f => `<label class="director-check-row"><input type="checkbox" data-rl-family="${esc(f.id)}" data-director="input:input[data-rl-family]" ${f.on ? "checked" : ""}> ${esc(f.name)}</label>`).join("")}
      <div class="director-toolbar">${phoneBtn("redline-layout", "Edit layout", { icon: "fa-bezier-curve" })}${phoneBtn("redline-reroll", b.drawn ? "Back to a random layout" : "Reroll the layout", { icon: "fa-dice" })}</div>`}
    <div class="director-toolbar">
      ${b.editing ? phoneBtn("redline-save", "Save", { icon: "fa-floppy-disk", cls: "primary" }) : phoneBtn("redline-save", "Save draft", { data: { status: "draft" }, icon: "fa-floppy-disk" }) + phoneBtn("redline-save", "Publish", { data: { status: "live" }, icon: "fa-flag-checkered", cls: "primary" })}
      ${phoneBtn("redline-cancel", "Cancel", { icon: "fa-xmark" })}</div>
    <p class="director-note">The fly-through plays on the GM Phone.</p>`;
}

function redlinePageHtml(director, r) {
  const set = (key, text) => `<label class="director-check-row"><input type="checkbox" data-rl-setting="${key}" data-director="input:input[data-rl-setting]" ${r.cfg[key] ? "checked" : ""}> ${text}</label>`;
  const tracks = r.tracks.map(t => `<article class="director-order ${t.live ? "live" : ""}">
      <div class="director-rl-row"><canvas class="director-rl-card" data-rl-card="${esc(t.id)}" aria-label="Layout of ${esc(t.name)}"></canvas>
        <div><strong>${esc(t.name)}</strong> <span class="director-tag">${esc(t.status)}</span><p class="director-sub">${esc(t.district)} · ${esc(t.line)}${t.from ? ` · nominated by ${esc(t.from)}` : ""}</p></div></div>
      <div class="director-toolbar">
        ${t.draft ? phoneBtn("redline-status", "Publish", { data: { id: t.id, status: "live" }, icon: "fa-flag-checkered" }) : ""}
        ${t.live ? phoneBtn("redline-status", "Retire", { data: { id: t.id, status: "retired" }, icon: "fa-box-archive" }) : ""}
        ${t.retired ? phoneBtn("redline-status", "Reopen", { data: { id: t.id, status: "live" }, icon: "fa-rotate-left" }) : ""}
        ${phoneBtn("redline-edit", "Edit", { data: { id: t.id }, icon: "fa-pen" })}
        ${t.runs.length ? phoneBtn("redline-wipe", "Wipe board", { data: { id: t.id }, icon: "fa-eraser" }) : ""}
        ${t.live ? "" : phoneBtn("redline-delete", "Delete", { data: { id: t.id }, icon: "fa-trash", cls: "danger" })}</div>
      ${t.runs.length ? listOf(t.runs.map(x => row({
        lead: `<b class="director-letter">${esc(String(x.rank))}</b>`, main: `<strong>${esc(x.tag)}</strong> <small>${esc(x.who)}, ${esc(x.clsName)}${x.grid ? `, grid ${esc(String(x.grid))}` : ""}</small>`,
        tools: `<span class="director-price">${esc(x.time)}${x.lapTime ? ` · lap ${esc(x.lapTime)}` : ""}</span>${phoneBtn("redline-remove", "", { data: { id: t.id, actor: x.actorId }, icon: "fa-xmark", title: "Remove this run and its ghost" })}`
      })), "") : ""}
    </article>`).join("") || `<p class="director-empty">No tracks yet.</p>`;
  const nominated = r.nominated.length ? label("Nominated by players") + listOf(r.nominated.map(n => row({
    main: `<strong>${esc(n.name)}</strong> <small>${esc(n.district)}, ${esc(n.km)} km, by ${esc(n.by)}</small>`,
    tools: phoneBtn("redline-nominee", "", { data: { id: n.id }, icon: "fa-hammer", title: "Build it" }) + phoneBtn("redline-dismiss", "", { data: { id: n.id }, icon: "fa-xmark", title: "Dismiss" })
  })), "") : "";
  return `<div class="director-columns">
    <div>${label("Switches")}${set("fighting", "Fighting (punches, kicks, rams do damage)")}${set("heat", "Heat (NCPD chase rammers and checkpoint crashers)")}
      <label class="director-setting"><span>Drive skill</span>${select(r.drives, "Drive skill")}</label>${set("paused", "Pause all races")}
      ${r.builder ? redlineBuilderHtml(r.builder) : `<div class="director-toolbar">${phoneBtn("redline-new", "New track", { icon: "fa-plus", cls: "primary" })}</div>`}
      ${nominated}</div>
    <div>${label("Tracks")}${tracks}</div>
  </div>`;
}

const redline = {
  data: redlineData,
  count: r => r.nominated.length,
  head: () => pageHead("REDLINE", "Tracks, the builder and the boards"),
  page: redlinePageHtml,
  shape: r => (r.builder ? `build:${r.builder.id}:${r.builder.kind}` : "redline"),
  /** The layout cards: drawn on their canvases after each draw (the GM Phone's _rlCards). */
  attach(director, root) {
    const cards = director.logic._rlCards ?? {};
    for (const canvas of root.querySelectorAll("canvas[data-rl-card]")) {
      const card = cards[canvas.dataset.rlCard];
      if (card) drawCard(canvas, buildTrack(card.spec), card);
    }
  }
};

/* ---------------- NC-ART ---------------- */

const ncartData = director => director.logic.ncartData(director.logic.ctx());

function ncartPageHtml(director, n) {
  const board = listOf(n.board.map(e => row({
    lead: `<b class="director-letter">${esc(String(e.rank))}</b>`,
    main: `<strong>${esc(e.name)}</strong>${e.who ? ` <small>(${esc(e.who)})</small>` : ""}${e.fake ? ` <small>(made up)</small>` : ""}`,
    tools: `<span class="director-price"><i class="fas fa-gem"></i> ${esc(String(e.shards))} · ${esc(String(e.dist))} m</span>${phoneBtn("ncart-remove", "", { data: { id: e.id }, icon: "fa-xmark", title: "Remove" })}`
  })), "No runs yet.");
  const box = (attr, x) => `<label class="director-check-row"><input type="checkbox" data-ncart-${attr}="${esc(x.id)}" data-director="input:input[data-ncart-${attr}]" ${x.on ? "checked" : ""}> ${esc(x.label)}</label>`;
  return `<div class="director-columns">
    <div>${label("Leaderboard")}${board}
      <div class="director-ncpd-line"><input type="text" name="ncartName" maxlength="24" placeholder="Name" aria-label="Name"><input type="number" name="ncartShards" class="short" min="0" max="99999" value="150" aria-label="Shards" title="Shards"><input type="number" name="ncartDist" class="short" min="0" max="999999" value="400" aria-label="Metres" title="Metres">${phoneBtn("ncart-fake", "", { icon: "fa-plus", title: "Add to the board" })}</div>
      <div class="director-toolbar">${phoneBtn("ncart-fill", "Fill with randoms", { icon: "fa-shuffle" })}${phoneBtn("ncart-reset", "Clear the board", { icon: "fa-trash", cls: "danger" })}</div></div>
    <div>${label("Obstacles")}${n.families.map(f => box("family", f)).join("")}${label("Power-ups")}${n.powers.map(x => box("power", x)).join("")}</div>
  </div>`;
}

const ncart = {
  data: ncartData,
  count: () => 0,
  head: () => pageHead("NCART Runner", "The leaderboard, obstacles and power-ups"),
  page: ncartPageHtml,
  shape: () => "ncart"
};

/* ---------------- Gacha ---------------- */

const gachaData = director => director.logic.gachaData(director.logic.ctx());
const gachaInput = (key, value, attrs = `min="0"`) => `<input type="number" data-gacha-setting="${esc(key)}" data-director="input:input[data-gacha-setting]" value="${esc(String(value ?? ""))}" ${attrs}>`;
const rarityDot = color => `<i class="director-rarity" style="--rarity: ${esc(color)}"></i>`;

function gachaMachineHtml(g) {
  const cfg = g.cfg;
  return `<div class="director-bangme">
    <div>${label("The machine")}
      <label class="director-setting"><span>zCreds a pull</span>${gachaInput("pullCost", cfg.pullCost)}</label>
      <label class="director-setting"><span>Purchases that fail (%)</span>${gachaInput("failChance", cfg.failChance, `min="0" max="100"`)}</label>
      <label class="director-check-row"><input type="checkbox" data-gacha-setting="chat" data-director="input:input[data-gacha-setting]" ${cfg.chat ? "checked" : ""}> Show-offs in chat</label>
      ${label("zCred bundles (eddies → zCreds)")}${g.bundles.map(b => `<div class="director-ncpd-line">${gachaInput(`bundles.${b.i}.eb`, b.eb)}<span>eb →</span>${gachaInput(`bundles.${b.i}.zc`, b.zc)}<span>zc</span></div>`).join("")}</div>
    <div>${label("Odds (weights, out of 1000) · a duplicate sells for")}
      ${g.weights.map(w => `<div class="director-ncpd-line"><span class="director-gacha-name">${rarityDot(w.color)} ${esc(w.name)} <small>(${w.count})</small></span>${gachaInput(`weights.${w.key}`, w.value, `min="0" step="1" title="Weight"`)}${gachaInput(`sell.${w.key}`, w.sell, `min="0" title="Sells for (zCreds)"`)}</div>`).join("")}
      <p class="director-note">${g.odds.map(o => `${esc(o.name)} ${o.pct}%`).join(" · ")}</p>
      <p class="director-note">Pity: a character's 10th pull without an Epic or better is one; from their 74th without a Legendary its odds climb each pull, and the 90th is one.</p></div>
    <div>${label("Collectibles", phoneBtn("gacha-c-add", "", { icon: "fa-plus", title: "Add a collectible" }))}
      ${listOf(g.collectibles.map(c => row({
        lead: c.img ? `<img class="director-avatar" src="${esc(c.img)}" alt="">` : "",
        main: `<strong>${esc(c.name)}</strong>`, small: `${rarityDot(c.color)} ${esc(c.rarityName)}${c.text ? ` · ${esc(c.text)}` : ""}`,
        tools: phoneBtn("gacha-c-edit", "", { data: { cid: c.id }, icon: "fa-pen", title: "Edit" }) + phoneBtn("gacha-c-remove", "", { data: { cid: c.id }, icon: "fa-trash", cls: "danger", title: "Remove" })
      })), "")}
      ${g.custom ? `<div class="director-toolbar">${phoneBtn("gacha-c-reset", "Back to the default collectibles", { icon: "fa-rotate-left" })}</div>` : ""}</div>
  </div>`;
}

function gachaShelvesHtml(g) {
  const shelves = g.shelves.map(s => `<article class="director-order">
      <header><strong>${esc(s.name)}</strong> <span class="director-price">${esc(s.creds)}</span>${phoneBtn("gacha-creds", "", { data: { actorId: s.id }, icon: "fa-pen", title: `Set ${s.name}'s zCreds` })}
        ${s.pity ? `<small class="director-sub">${s.pity.sinceEpic} since an Epic, ${s.pity.sinceLegendary} since a Legendary</small>` : ""}</header>
      ${listOf(s.pulls.map(p => row({
        lead: p.img ? `<img class="director-avatar" src="${esc(p.img)}" alt="">` : "",
        main: `<strong>${esc(p.name)}</strong>`, small: `${rarityDot(p.color)} ${esc(p.rarityName)}${p.real ? ` · real: ${esc(p.real.name)}` : ""}${p.from ? ` · from ${esc(p.from)}` : ""}`,
        tools: (p.real ? "" : phoneBtn("gacha-real", "", { data: { actorId: s.id, pullId: p.id }, icon: "fa-wand-magic-sparkles", title: "Make it a real item" }))
          + phoneBtn("gacha-remove", "", { data: { actorId: s.id, pullId: p.id }, icon: "fa-trash", cls: "danger", title: "Remove" })
      })), "")}
    </article>`).join("") || `<p class="director-empty">Nobody has pulled anything yet.</p>`;
  return `<div class="director-cards">${shelves}</div>`;
}

const gacha = {
  data: gachaData,
  count: () => 0,
  head: g => pageHead("Gacha", "The capsule machine and everyone's shelves", { tabs: g.tabs, action: "gacha-tab" }),
  page: (director, g) => (g.tab.shelf ? gachaShelvesHtml(g) : gachaMachineHtml(g)),
  shape: g => Object.keys(g.tab)[0]
};

/* ---------------- Achieve! ---------------- */

const achieveData = director => director.logic.achieveData(director.logic.ctx());

function achieveBoxRow(b) {
  return row({
    lead: `<i class="fas ${b.sealed ? "fa-box" : "fa-box-open"}"></i>`,
    main: `<strong>${esc(b.name)}</strong> <span class="director-time">${esc(b.ownerName)}</span> <span class="director-tag">${esc(b.statusLabel)}</span>`,
    small: [b.inside && esc(b.inside), b.note && esc(b.note), b.opener && `opened by ${esc(b.opener)}`].filter(Boolean).join(" · "),
    tools: (b.opening ? phoneBtn("achieve-box-confirm", "Give it", { data: { boxId: b.id }, icon: "fa-gift", cls: "primary" }) + phoneBtn("achieve-box-change", "Something else", { data: { boxId: b.id }, icon: "fa-pen" }) : "")
      + phoneBtn("achieve-box-delete", "", { data: { boxId: b.id }, icon: "fa-trash", cls: "danger", title: "Remove" })
  });
}

function achieveDetailHtml(a) {
  if (!a) return `<p class="director-empty director-pick">Pick a badge.</p>`;
  return `<div class="director-achieve-detail">
    <img src="${esc(a.img)}" alt=""><h3>${esc(a.name)}</h3><p>${esc(a.text ?? "")}</p>
    ${a.earned ? `<p class="director-sub"><i class="fas fa-trophy"></i> Earned${a.date ? ` · ${esc(a.date)}` : ""}</p>${a.note ? `<p class="director-writer-note">“${esc(a.note)}”</p>` : ""}${a.spent ? `<p class="director-sub"><i class="fas fa-right-left"></i> Traded in: ${esc(a.spent)}</p>` : ""}` : `<p class="director-sub"><i class="fas fa-lock"></i> Not yet</p>`}
    ${a.others ? `<p class="director-sub"><i class="fas fa-users"></i> Also earned by ${esc(a.others)}</p>` : ""}
    ${a.hidden ? `<p class="director-sub"><i class="fas fa-eye-slash"></i> Secret: players see "???" until it's earned.</p>` : ""}
    ${a.disabled ? `<p class="director-sub"><i class="fas fa-ban"></i> Switched off: not in this game.</p>` : ""}
    <div class="director-toolbar">
      ${a.earned ? (a.spent ? "" : phoneBtn("achieve-trade", "Trade in", { data: { id: a.id }, icon: "fa-right-left", cls: "primary" })) + phoneBtn("achieve-revoke", "Take back", { data: { id: a.id }, icon: "fa-rotate-left", cls: "danger" })
        : a.disabled ? "" : phoneBtn("achieve-award", "Award", { data: { id: a.id }, icon: "fa-trophy", cls: "primary" })}
      ${phoneBtn("achieve-hide", a.hidden ? "Show" : "Make secret", { data: { id: a.id }, icon: a.hidden ? "fa-eye" : "fa-eye-slash" })}
      ${phoneBtn("achieve-disable", a.disabled ? "Switch on" : "Switch off", { data: { id: a.id }, icon: a.disabled ? "fa-circle-check" : "fa-ban" })}
      ${a.custom ? phoneBtn("achieve-edit", "Edit", { data: { id: a.id }, icon: "fa-pen" }) + phoneBtn("achieve-remove", "", { data: { id: a.id }, icon: "fa-trash", cls: "danger", title: "Remove" }) : ""}
    </div></div>`;
}

function achievePageHtml(director, a) {
  const pick = a.actorPicker ? `<div class="director-pickers"><label><span>Character</span>${select(a.actorPicker, "Character")}</label></div>` : "";
  if (a.noActor) return `<p class="director-empty">No player characters.</p>`;
  if (a.tab.boxes) {
    return `${pick}<div class="director-toolbar">${phoneBtn("achieve-box-give", `Give ${esc(a.actorName)} a Mystery Box`, { icon: "fa-gift", cls: "primary", title: "Rolled on the Table of Mystery" })}</div>
      <div class="director-columns">
        <div>${label("Opening: your call")}${listOf((a.opening ?? []).map(achieveBoxRow), "Nothing being opened.")}${label("Sealed")}${listOf((a.sealed ?? []).map(achieveBoxRow), "No sealed boxes.")}</div>
        <div>${label("Opened")}${listOf((a.opened ?? []).map(achieveBoxRow), "None yet.")}</div>
      </div>`;
  }
  const badges = (a.list ?? []).map(x => `<button type="button" class="director-badge ${x.earned ? "earned" : ""} ${x.disabled ? "faded" : ""} ${x.open ? "active" : ""}" data-director="phone:achieve-open" data-id="${esc(x.id)}" title="${esc(x.name)}">
      <img src="${esc(x.img)}" alt=""><span>${esc(x.name)}</span>${x.hidden ? `<i class="fas fa-eye-slash"></i>` : ""}${x.spent ? `<i class="fas fa-right-left"></i>` : ""}</button>`).join("");
  return `${pick}<div class="director-jobs">
    <div><p class="director-sub">${esc(a.actorName)}: ${a.count} of ${a.total} earned${a.tokens ? ` · ${a.tokens} to trade in` : ""}</p><div class="director-badges">${badges}</div>
      ${label("Settings")}<label class="director-check-row"><input type="checkbox" data-achieve-setting="chat" data-director="input:input[data-achieve-setting]" ${a.chat ? "checked" : ""}> Announce in chat</label>
      <div class="director-toolbar">${phoneBtn("achieve-add", "Add your own achievement", { icon: "fa-plus" })}${phoneBtn("achieve-preview", "Try the celebration", { icon: "fa-champagne-glasses" })}</div>
      <p class="director-note">Each character earns an achievement once; one award can go to several. The fanfare is in Control → Every phone.</p></div>
    <div class="director-garden-detail"><div class="director-detail">${achieveDetailHtml(a.open)}</div></div>
  </div>`;
}

const achieve = {
  data: achieveData,
  count: a => a.tabs?.find(t => t.id === "boxes")?.count ?? 0,
  head: a => pageHead("Achieve!", "Badges for every character, and Mr. Amaze's Mystery Boxes", { tabs: a.tabs ?? null, action: "achieve-tab" }),
  page: achievePageHtml,
  shape: a => Object.keys(a.tab ?? { none: true })[0]
};


/* ---------------- Combat Cabb ---------------- */

const cabbData = director => director.logic.cabbData(director.logic.ctx());

function cabbPageHtml(director, c) {
  const rides = listOf(c.open.map(r => row({
    lead: `<i class="fas fa-taxi"></i>`,
    main: `<strong>${esc(r.who)}</strong> <span class="director-time">Cabb ${esc(String(r.cab ?? ""))}</span> <span class="director-tag">${esc(r.statusLabel)}${r.countdown ? ` · ${esc(r.countdown)}` : ""}${r.untimed ? " · no timer" : ""}</span>`,
    small: `${esc(r.from?.name ?? "")} → ${esc(r.to?.name ?? "")} · ${esc(String(r.mi ?? ""))} mi · ${esc(r.fareLabel ?? "")}${r.zoneLabel ? ` · ${esc(r.zoneLabel)}` : ""}`,
    tools: (r.enroute ? phoneBtn("cabb-gm", "Here now", { data: { rideId: r.id, act: "here" }, cls: "primary" }) : "")
      + (r.waiting ? phoneBtn("cabb-gm", "Depart", { data: { rideId: r.id, act: "depart" }, cls: "primary" }) : "")
      + (r.riding ? phoneBtn("cabb-gm", "Arrived now", { data: { rideId: r.id, act: "arrived" }, cls: "primary" }) : "")
      + (r.timeable ? phoneBtn("cabb-time", "Set time", { data: { rideId: r.id }, icon: "fa-clock", title: "Set when it gets there, or take its timer away" }) : "")
      + phoneBtn("cabb-gm", r.paid ? "Cancel (refund)" : "Cancel", { data: { rideId: r.id, act: "cancel" }, cls: "danger" })
  })), "No rides going on.");
  const recent = c.recent.length ? label("Recent") + listOf(c.recent.map(r => row({ main: `<strong>${esc(r.who)}</strong> <span class="director-tag">${esc(r.statusLabel)}</span>`, small: `${esc(r.from?.name ?? "")} → ${esc(r.to?.name ?? "")} · ${esc(r.fareLabel ?? "")}` })), "") : "";
  const party = c.scene
    ? c.crew ? `<p class="director-note"><i class="fas fa-location-arrow"></i> The crew's GPS spot on ${esc(c.scene.name)}: cabs pick up ${esc(c.crew.near ?? "")}.</p>
        <div class="director-toolbar">${c.mapOn ? phoneBtn("cabb-open-map", "On the Map", { icon: "fa-map-location-dot" }) : ""}${phoneBtn("cabb-crew-clear", "Clear", { icon: "fa-xmark" })}</div>`
      : c.pin ? `<p class="director-note"><i class="fas fa-location-dot"></i> The party pin on ${esc(c.scene.name)}: cabs pick up ${esc(c.pin.near ?? "")}. Drag the pin as the party moves.</p>
        <div class="director-toolbar">${phoneBtn("cabb-pin-drop", "Show the pin", { icon: "fa-location-crosshairs" })}${phoneBtn("cabb-pin-remove", "Remove it", { icon: "fa-trash", cls: "danger" })}</div>`
      : `<div class="director-toolbar">${c.mapOn ? phoneBtn("cabb-open-map", "Set the crew's spot on the Map", { icon: "fa-location-arrow" }) : phoneBtn("cabb-pin-drop", `Drop a party pin on ${esc(c.scene.name)}`, { icon: "fa-location-dot" })}</div>`
    : "";
  const num = (key, text, attrs = `min="0"`) => `<label class="director-setting"><span>${text}</span><input type="number" data-cabb-setting="${key}" data-director="input:input[data-cabb-setting]" value="${esc(String(c.cfg[key] ?? ""))}" ${attrs}></label>`;
  const check = (key, text) => `<label class="director-check-row"><input type="checkbox" data-cabb-setting="${key}" data-director="input:input[data-cabb-setting]" ${c.cfg[key] ? "checked" : ""}> ${text}</label>`;
  const places = listOf(c.places.map(p => row({
    cls: p.picked ? "active" : "",
    main: `<strong>${esc(p.name)}</strong>${c.editable ? ` <small>${esc(String(p.x))}, ${esc(String(p.y))} km</small>` : ""}`,
    tools: select(p.zone, "Zone") + (c.editable
      ? phoneBtn("cabb-place-edit", "", { data: { place: p.id }, icon: "fa-pen", title: "Edit" }) + phoneBtn("cabb-place-remove", "", { data: { place: p.id }, icon: "fa-trash", cls: "danger", title: "Remove" })
      : phoneBtn("cabb-show-pin", "", { data: { noteId: p.noteId }, icon: "fa-location-crosshairs", title: "Show on the map" }))
  })), c.total ? `No place matches “${esc(c.search)}”.` : "No pins players can see on the NAV scene yet.");
  return `<div class="director-bangme">
    <div>${label("Rides")}${rides}${recent}
      ${label("Where the party is")}${party}<label class="director-setting"><span>${c.scene ? "Or at" : "At"}</span>${c.partyDropdown ? select(c.partyDropdown, "Where the party is") : ""}</label>
      <p class="director-note">Cabs pick up where the party is. Until you say, players pick their own pickup.</p></div>
    <div>${label("Fares")}${num("flagFall", "Flag fall")}${num("perMile", "Per mile", `min="0" step="0.5"`)}${num("zoneMult", "Zone rate ×", `min="1" step="0.5"`)}${check("zonePickup", "Zone rate for pickups in a zone too")}
      ${label("Timing (real seconds)")}${num("etaMin", "Pickup from")}${num("etaMax", "…to")}${check("tripTimer", "Trips on a timer")}${num("secPerKm", "Trip, per km")}${num("tripMin", "Trip from")}${num("tripMax", "…to")}
      <p class="director-note">Off: once a cab departs, it arrives only when you say (Arrived now). Set time on a ride sets its pickup or arrival by hand, or takes its timer away.</p></div>
    <div>${label("Places")}<label class="director-setting"><span>NAV scene</span>${select(c.sceneDropdown, "NAV scene")}</label>
      ${c.total ? `<input type="search" name="cabbSearch" data-director="input:input[name=cabbSearch]" data-draft="cabb-search" value="${esc(c.search)}" placeholder="Search ${c.total} places" aria-label="Search places" autocomplete="off">` : ""}
      ${places}${c.more ? `<p class="director-note">${c.more} more. Search to find one.</p>` : ""}
      ${c.editable ? `<div class="director-toolbar">${phoneBtn("cabb-place-add", "Add a place", { icon: "fa-plus" })}${phoneBtn("cabb-places-reset", "Back to the districts", { icon: "fa-rotate-left" })}</div>` : ""}</div>
  </div>`;
}

const cabb = {
  data: cabbData,
  count: c => c.open.length,
  head: () => pageHead("Combat Cabb", "Rides, where the party is, fares and places"),
  page: cabbPageHtml,
  shape: () => "cabb"
};

/* ---------------- Flappy Chrome ---------------- */

const pigeonData = director => director.logic.pigeonData(director.logic.ctx());

function pigeonPageHtml(director, g) {
  const board = listOf(g.board.map(e => row({
    lead: `<b class="director-letter">${esc(String(e.rank))}</b>`,
    main: `<strong>${esc(e.name)}</strong>${e.who ? ` <small>(${esc(e.who)})</small>` : ""}${e.fake ? ` <small>(made up)</small>` : ""}`,
    tools: `<span class="director-price">${esc(String(e.score))}</span>${phoneBtn("pigeon-remove", "", { data: { id: e.id }, icon: "fa-xmark", title: "Remove" })}`
  })), "No scores yet.");
  const heat = listOf(g.heat.map(h => row({
    main: `<strong>${esc(h.name)}</strong> <span class="director-heat" aria-label="Heat ${h.heat} of 5">${h.pips.map(on => `<i class="${on ? "on" : ""}"></i>`).join("")}</span>`,
    tools: (h.cool ? phoneBtn("pigeon-heat", "", { data: { id: h.actorId, by: -1 }, icon: "fa-snowflake", title: "Cool down" }) : "") + (h.hot ? phoneBtn("pigeon-heat", "", { data: { id: h.actorId, by: 1 }, icon: "fa-fire", title: "Heat up" }) : "")
  })), "Nobody has played yet.");
  return `<div class="director-columns">
    <div>${label("Leaderboard")}${board}
      <div class="director-ncpd-line"><input type="text" name="pigeonName" maxlength="24" placeholder="Name" aria-label="Name"><input type="number" name="pigeonScore" class="short" min="0" max="999" value="20" aria-label="Score">${phoneBtn("pigeon-fake", "", { icon: "fa-plus", title: "Add to the board" })}</div>
      <div class="director-toolbar">${phoneBtn("pigeon-fill", "Fill with randoms", { icon: "fa-shuffle" })}${phoneBtn("pigeon-reset", "Clear the board", { icon: "fa-trash", cls: "danger" })}</div></div>
    <div>${label("Maelstrom Heat")}${heat}<div class="director-toolbar">${phoneBtn("pigeon-heat-reset", "Reset all Heat", { icon: "fa-snowflake" })}</div></div>
  </div>`;
}

const pigeon = {
  data: pigeonData,
  count: () => 0,
  head: () => pageHead("Flappy Chrome", "The leaderboard and Maelstrom Heat"),
  page: pigeonPageHtml,
  shape: () => "pigeon"
};

/* ---------------- Ask Alex Anything ---------------- */

const alexData = director => director.logic.alexData(director.logic.ctx());

function alexQueryHtml(a, q) {
  const r = q.ai?.result;
  const matches = a.hasPool ? `${label(`Data Pool matches (${q.matches.length})`)}${listOf(q.matches.map(m => row({
    main: `<strong>${esc(m.name)}</strong> ${m.hits.map(h => `<span class="director-tag">${esc(h)}</span>`).join(" ")}${m.secret ? ` <i class="fas fa-eye-slash" title="Has secrets (left out when used)"></i>` : ""}`,
    small: m.preview ? esc(m.preview) : "<em>Only secrets: nothing public to send.</em>",
    tools: (m.preview ? phoneBtn("alex-use", "Use", { data: { queryId: q.id, entryId: m.id }, icon: "fa-arrow-down" }) : "") + phoneBtn("alex-open-entry", "Open", { data: { entryId: m.id }, icon: "fa-book-open" })
  })), "No entry's name or keywords are in this question.")}` : "";
  const ai = q.ai?.ready ? `<div class="director-toolbar">${q.ai.direction ? `<small title="Your directions for Alex"><i class="fas fa-compass"></i> ${esc(q.ai.direction)}</small>` : ""}
      ${q.ai.busy ? `<span class="director-sub">Claude is drafting…</span>` : phoneBtn("alex-draft", r ? "Redraft" : "Draft with Claude", { data: { queryId: q.id }, icon: "fa-wand-magic-sparkles" })}</div>
      ${q.ai.error ? `<p class="director-problem"><i class="fas fa-triangle-exclamation"></i> ${esc(q.ai.error)}</p>` : ""}` : "";
  const notes = r ? `<div class="director-writer-note"><b><i class="fas fa-user-secret"></i> Claude's notes for you</b> <small>(players never see these)</small>
      ${r.found ? "" : `<br><i class="fas fa-ban"></i> Nothing public to find: consider No results.`}
      ${q.ai.rollDv ? `<br><i class="fas fa-dice-d10"></i> Suggests a Library Search first, DV ${q.ai.rollDv}. ${phoneBtn("alex-need-roll", "Ask for it", { data: { queryId: q.id, dv: q.ai.rollDv }, cls: "director-plain" })}` : ""}
      ${r.secretsUsed ? `<br><i class="fas fa-eye-slash"></i> <b>From secrets:</b> ${esc(r.secretsUsed)}` : ""}
      ${r.gmNote ? `<br><i class="fas fa-note-sticky"></i> ${esc(r.gmNote)}` : ""}
      ${r.sources?.length ? `<br><i class="fas fa-book"></i> <b>Sources:</b> ${r.sources.map(x => esc(x)).join(", ")}` : ""}
      ${q.ai.read?.length ? `<br><i class="fas fa-location-dot"></i> <b>Locations read:</b> ${q.ai.read.map(x => esc(x)).join(", ")}` : ""}
      <br><small>${esc(q.ai.cost ?? "")}${q.ai.searches ? ` · ${q.ai.searches} web search` : ""}</small></div>` : "";
  return `<article class="director-order pending" data-query="${esc(q.id)}">
    <header><strong>${esc(q.name)}</strong><span class="director-time">${esc(q.ago ?? "")}</span></header>
    <p class="director-bio">“${esc(q.text)}”</p>
    <p class="director-sub">${esc(q.suggest)}${q.agent ? `<br><i class="fas fa-robot"></i> ${esc(q.agent.label)} · ${esc(q.agent.personality)}${q.agent.voices ? " <em>(voices the draft)</em>" : ""}` : ""}</p>
    ${q.needsRoll ? `<p>${q.roll ? `Rolled <b>${q.roll.total}</b> vs DV ${q.dv}: ${q.roll.success ? "success" : "failure"} <small>(${esc(q.roll.detail ?? "")})</small>` : `Waiting for their roll (DV ${q.dv})…`}</p>` : ""}
    <div class="director-ncpd-card"><div>${matches}</div><div>${ai}
      <textarea data-query-id="${esc(q.id)}" data-director="input:textarea[data-query-id]" data-draft="alex:${esc(q.id)}" rows="5" placeholder="Alex's answer. On a bad roll, make it confident and wrong.">${esc(q.draft ?? "")}</textarea>
      ${notes}${q.image ? `<img class="director-photo" src="${esc(q.image)}" alt="">` : ""}
      <div class="director-toolbar">${phoneBtn("alex-answer", "Answer", { data: { queryId: q.id }, icon: "fa-reply", cls: "primary" })}${phoneBtn("alex-photo", "", { data: { queryId: q.id }, icon: "fa-image", title: "Attach a picture" })}
        ${q.needsRoll ? "" : `<input type="number" name="alexDv" class="short" data-query-id="${esc(q.id)}" value="${esc(String(q.dv))}" min="1" title="DV">${phoneBtn("alex-need-roll", "Ask for a roll", { data: { queryId: q.id }, icon: "fa-dice-d10" })}`}
        ${phoneBtn("alex-none", "No results", { data: { queryId: q.id }, cls: "danger" })}</div></div></div>
  </article>`;
}

function alexPageHtml(director, a) {
  const st = a.settings;
  const set = (key, text, attrs) => `<label class="director-setting"><span>${text}</span><input data-alex-setting="${key}" data-director="input:[data-alex-setting]" ${attrs}></label>`;
  return `<div class="director-ncpd">
    <div>${label(`Waiting for Alex (${a.waiting.length})`)}${a.waiting.map(q => alexQueryHtml(a, q)).join("") || `<p class="director-empty">No questions waiting.</p>`}</div>
    <div>${label("Answered")}${listOf(a.recent.map(q => row({ main: `<strong>${esc(q.name)}</strong>: “${esc(q.text)}”`, small: q.none ? "No results" : esc(q.answer?.text ?? "") })), "Nothing yet.")}
      ${label("Data Pool keywords")}<p class="director-note">Put a line <b>Data Pool Keywords: merc bar, rogue</b> in any journal entry, or keep the entry in a <b>${esc(a.folder)}</b> folder. Its name counts as a keyword too. A question that mentions one lists the entry under it.</p>
      <div class="director-toolbar">${phoneBtn("alex-example", "Create an example entry", { icon: "fa-book-open" })}</div>
      ${label("Optional Anthropic API")}
      <div class="director-ncpd-line"><input type="password" data-alex-setting="key" data-director="input:[data-alex-setting]" value="${esc(st.key ?? "")}" placeholder="sk-ant-…" autocomplete="off" aria-label="Anthropic API key">${phoneBtn("alex-ai-test", "Test", { icon: "fa-plug", title: "Test the key" })}</div>
      <label class="director-check-row"><input type="checkbox" data-alex-remember data-director="input:input[data-alex-remember]" ${st.remember ? "checked" : ""}> Remember the key in this browser</label>
      <p class="director-note">Never sent to the Foundry server or players. Set a spend limit on its workspace in the Anthropic Console.</p>
      <label class="director-setting director-wide-field"><span>Standing direction</span><textarea data-alex-setting="standing" data-director="input:[data-alex-setting]" rows="2" placeholder="For every answer">${esc(st.standing ?? "")}</textarea></label>
      <label class="director-check-row"><input type="checkbox" data-alex-setting="agentVoice" data-director="input:[data-alex-setting]" ${st.agentVoice ? "checked" : ""}> Answer in the asker's Agent personality</label>
      ${set("sentences", "Answer length (sentences)", `type="number" min="1" max="8" value="${esc(String(st.sentences ?? ""))}"`)}
      ${set("domains", "Web search sites", `type="text" value="${esc(st.domains ?? "")}"`)}
      ${set("cap", "Session cap ($, 0 = none)", `type="number" min="0" step="0.5" value="${esc(String(st.cap ?? ""))}"`)}
      <p class="director-sub">This session: ${esc(st.spend)} · model ${esc(st.model)}</p>
      <div class="director-toolbar">${phoneBtn("alex-rules", `${st.rulesOpen ? "Hide" : "View"} base instructions${st.rulesCustom ? " (edited)" : ""}`, { icon: "fa-scroll" })}</div>
      ${st.rulesOpen ? `<textarea data-alex-setting="rules" data-director="input:[data-alex-setting]" data-draft="alex-rules" rows="14">${esc(st.rulesText)}</textarea>${st.rulesCustom ? `<div class="director-toolbar">${phoneBtn("alex-rules-reset", "Back to the default", { icon: "fa-rotate-left" })}</div>` : ""}` : ""}</div>
  </div>`;
}

const alex = {
  data: alexData,
  count: a => a.waiting.length,
  head: () => pageHead("Ask Alex Anything", "Players' questions, the Data Pool, and Claude's drafts"),
  page: alexPageHtml,
  shape: a => (a.settings.rulesOpen ? "alex-rules" : "alex")
};


/* ---------------- App Store ---------------- */

const poolData = director => director.logic.poolData(director.logic.ctx());

function poolPageHtml(director, p) {
  const characters = p.characters.map(c => `<article class="director-order">
      <header><strong>${esc(c.name)}</strong>${c.subs.length ? ` <span class="director-sub">${esc(c.total)}/mo</span>` : ""}
        <span class="director-toolbar">${c.due ? phoneBtn("pool-bill", "Bill what's due", { data: { actorId: c.actorId, all: 0 }, icon: "fa-file-invoice-dollar", cls: "primary" }) : c.billable ? phoneBtn("pool-bill", `Bill a month (${c.total})`, { data: { actorId: c.actorId, all: 1 }, icon: "fa-file-invoice-dollar" }) : ""}
          ${phoneBtn("pool-sideload", "Sideload…", { data: { actorId: c.actorId }, icon: "fa-box" })}</span></header>
      <div class="director-picks">${c.apps.map(a => `<span class="director-chip ${a.lapsed ? "faded" : ""}" title="${esc(a.source)}${a.paid ? `, paid ${esc(a.paid)}` : ""}">${esc(a.name)}${a.lapsed ? ` <i class="fas fa-lock"></i>` : ""} ${phoneBtn("pool-revoke", "", { data: { actorId: c.actorId, app: a.id }, icon: "fa-xmark", cls: "director-plain", title: `Remove ${a.name}` })}</span>`).join("") || `<small class="director-sub">Only the preinstalled apps.</small>`}</div>
      ${c.revoked.length ? `<p class="director-sub">Removed: ${c.revoked.map(r => `${esc(r.name)} (${esc(r.reason)})`).join(", ")}</p>` : ""}
      ${c.subs.length ? listOf(c.subs.map(x => row({
        cls: x.lapsed ? "faded" : "",
        main: `<i class="fas fa-repeat"></i> ${esc(x.name)} · ${esc(x.price)}/mo`,
        small: x.sponsor ? `paid by ${esc(x.sponsor)}` : x.lapsed ? "lapsed" : x.due ? "due" : `active${x.through ? `, paid until ${esc(x.through)}` : ""}`,
        tools: (x.lapsed ? phoneBtn("pool-sub", "", { data: { actorId: c.actorId, app: x.app, status: "active" }, icon: "fa-play", title: "Reactivate" }) : phoneBtn("pool-sub", "", { data: { actorId: c.actorId, app: x.app, status: "lapsed" }, icon: "fa-pause", title: "Mark lapsed" }))
          + phoneBtn("pool-sponsor", "", { data: { actorId: c.actorId, app: x.app }, icon: x.sponsor ? "fa-handshake-slash" : "fa-handshake", title: x.sponsor ? "Stop the sponsorship" : "Sponsor: never billed" })
          + phoneBtn("pool-sub", "", { data: { actorId: c.actorId, app: x.app, status: "cancelled" }, icon: "fa-xmark", cls: "danger", title: "Cancel (uninstalls it)" })
      })), "") : ""}
      ${c.grant ? select(c.grant, `Install an app on ${c.name}'s Agent`) : ""}
    </article>`).join("") || `<p class="director-empty">No player characters.</p>`;
  const catalogue = p.catalogue.map(e => `<tr class="${e.on ? "" : "faded"}">
      <td><i class="${esc(e.icon)}"></i> <strong>${esc(e.name)}</strong>${e.on ? "" : " <small>(switched off in Control)</small>"}</td>
      <td>${select(e.modelPick, `${e.name}: price model`)}</td>
      <td>${e.free ? "" : `<input type="number" min="0" max="99999" data-pool-price="${esc(e.id)}" data-director="input:input[data-pool-price]" value="${esc(String(e.price ?? ""))}" aria-label="${esc(e.name)} price in eddies">`}</td>
      <td>${select(e.offerPick, `${e.name}: where it's offered`)}</td>
      <td><input type="checkbox" data-pool-pre="${esc(e.id)}" data-director="input:input[data-pool-pre]" ${e.preinstalled ? "checked" : ""} title="On every phone from the start, and can't be uninstalled"></td>
      <td><input type="text" maxlength="40" data-pool-text="${esc(e.id)}" data-field="publisher" data-director="input:input[data-pool-text]" value="${esc(e.publisher ?? "")}" placeholder="Publisher"></td></tr>`).join("");
  const field = (name, attrs) => `<input type="text" name="poolListing-${name}" ${attrs}>`;
  const listings = listOf(p.listings.map(l => row({
    lead: l.img ? `<img class="director-avatar" src="${esc(l.img)}" alt="">` : `<i class="${esc(l.icon ?? "")}"></i>`,
    main: `<strong>${esc(l.name)}</strong>${l.publisher ? ` <small>${esc(l.publisher)}</small>` : ""} <small>· ${esc(l.note ?? "")}</small>`,
    tools: phoneBtn("pool-listing-remove", "", { data: { id: l.id }, icon: "fa-xmark", title: "Remove" })
  })), "None. Add apps that don't exist yet, to tease them.");
  return `<div class="director-cbk-listings">
    <div>${label("Catalogue")}<table class="director-table"><thead><tr><th>App</th><th>Price model</th><th>Price</th><th>Offered</th><th title="Preinstalled">Pre</th><th>Publisher</th></tr></thead><tbody>${catalogue}</tbody></table>
      ${label("Coming soon (listings only)")}${listings}
      <div class="director-cbk-fields">${field("name", `maxlength="40" placeholder="App name"`)}${field("publisher", `maxlength="40" placeholder="Publisher"`)}${field("icon", `maxlength="60" placeholder="fas fa-cloud-rain"`)}${field("img", `maxlength="200" placeholder="Picture (image path, optional)"`)}${field("note", `maxlength="40" placeholder="Coming soon"`)}${field("blurb", `maxlength="160" placeholder="One line about it"`)}</div>
      <div class="director-toolbar">${phoneBtn("pool-listing-add", "Add listing", { icon: "fa-plus" })}</div></div>
    <div>${label(`Characters${p.due ? ` (${p.due} due)` : ""}`)}${p.billedBy ? `<p class="director-note"><i class="fas fa-file-invoice-dollar"></i> Subscriptions are billed by ${esc(p.billedBy)}.</p>` : ""}${characters}</div>
  </div>`;
}

const pool = {
  data: poolData,
  count: p => p.due,
  head: () => pageHead("App Store", "Ziggurat Pool: the catalogue, every character's apps and subscriptions"),
  page: poolPageHtml,
  shape: () => "pool"
};


/* ---------------- DataPool ---------------- */

const screamData = director => director.logic.screamsheetData(director.logic.ctx());

/** A clipping on the desk: its outlet and headline, where it came from, and its buttons. */
function clipHtml(c) {
  return `<article class="director-order outlet-${esc(c.outletKey ?? "")}">
    <header><span class="director-tag">${esc(c.outlet ?? "")} · ${esc(c.depth ?? "")}${c.dv ? ` (DV ${c.dv})` : ""}${c.front ? " · Front Page" : ""}</span></header>
    <strong>${esc(c.title)}</strong>
    <p class="director-sub">${c.source ? `${esc(c.source)}${c.sourceLabel ? `: ${esc(c.sourceLabel)}` : ""} · ` : ""}${esc(c.reach ?? "")}${c.subjects ? ` · About ${esc(c.subjects)}` : ""}${c.at != null ? ` · goes out in ${c.at} h` : ""}${c.date ? ` · ${esc(c.date)}` : ""}${c.pulled ? ` · Pulled by ${esc(c.pulled)}` : ""}</p>
    <div class="director-toolbar">${phoneBtn("scream-edit", "Edit", { data: { id: c.id }, icon: "fa-pen" })}
      ${c.date ? "" : phoneBtn("scream-publish", "Publish", { data: { id: c.id }, icon: "fa-paper-plane", cls: "primary" }) + phoneBtn("scream-claude", c.writing ? "Writing…" : "Redraft", { data: { id: c.id }, icon: c.writing ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles", title: "Claude rewrites the text in the outlet's voice" })}
      ${phoneBtn("scream-delete", c.date ? "Take down" : "Bin", { data: { id: c.id }, icon: "fa-trash", cls: "danger" })}</div>
  </article>`;
}

function screamPageHtml(director, d) {
  const deep = d.deep.map(x => `<article class="director-order pending">
      <header><i class="fas fa-dice-d10"></i> <strong>${esc(x.name)} crawls deep</strong> <span class="director-sub">Library Search <b>${x.total}</b> (${esc(x.detail ?? "")})</span></header>
      ${x.found.length ? `<p class="director-note">The roll reaches these. Untick what isn't there.</p>${x.found.map(c => `<label class="director-check-row"><input type="checkbox" value="${esc(c.id)}" data-scream-found="${esc(x.actorId)}" checked> ${esc(c.headline)} <small>DV ${c.dv}</small></label>`).join("")}` : `<p class="director-note">Nothing published matches past what they have.</p>`}
      ${x.others ? `<label class="director-setting"><span>You also find</span>${select(x.others, "You also find")}</label>` : ""}
      <div class="director-toolbar">${phoneBtn("scream-resolve", "Confirm", { data: { actor: x.actorId }, icon: "fa-check", cls: "primary" })}</div>
    </article>`).join("");
  const journals = d.journals.length ? label("From journals") + listOf(d.journals.map(j => row({
    main: `<strong>${esc(j.name)}</strong> <small>${esc(j.outlet ?? "")}${j.dv ? ` · DV ${j.dv}` : ""}</small>`,
    tools: phoneBtn("scream-open-entry", "Open", { data: { id: j.id }, icon: "fa-book-open" }) + phoneBtn("scream-journal", "Make a draft", { data: { id: j.id }, icon: "fa-file-import" })
  })), "") : "";
  return `<div class="director-toolbar">${phoneBtn("scream-write", "Write one", { icon: "fa-pen-nib", cls: "primary" })}
      ${phoneBtn("scream-claude", d.writing ? "Writing…" : "Draft with Claude", { icon: d.writing ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles", title: "Claude writes a draft in an outlet's voice, with your spin (your Ask Alex key)" })}
      ${phoneBtn("scream-crawl-now", "Crawl now", { icon: "fa-rotate", title: "Every character's Agent crawls the Pool for Headlines now" })}</div>
    <div class="director-bangme">
      <div>${deep ? label("Deep crawls") + deep : ""}${d.suggested.length ? label("Suggested") + d.suggested.map(clipHtml).join("") : ""}
        ${label("Drafts")}${d.drafts.map(clipHtml).join("") || `<p class="director-empty">No drafts. "Write one" starts a sheet.</p>`}</div>
      <div>${label("Scheduled")}${d.scheduled.map(clipHtml).join("") || `<p class="director-empty">Nothing scheduled.</p>`}${journals}</div>
      <div>${label(`Published (${d.published.length})`)}${d.published.map(clipHtml).join("") || `<p class="director-empty">Nothing published yet.</p>`}</div>
    </div>`;
}

const screamsheet = {
  data: screamData,
  count: d => d.deep.length + d.suggested.length,
  head: () => pageHead("DataPool", "The screamsheet desk: drafts, the schedule and what's published"),
  page: screamPageHtml,
  shape: () => "screamsheet"
};

/* ---------------- The view ---------------- */

const APPS = [
  ["setup", "Setup", "fa-sliders", true],
  ["breach", "BREACH", "fa-microchip"], ["redline", "REDLINE", "fa-flag-checkered"], ["roach", "Roach Race", "fa-horse"],
  ["ncart", "NCART Runner", "fa-train-subway"], ["pigeon", "Flappy Chrome", "fa-crow"], ["gacha", "Gacha", "fa-circle-play"], ["achieve", "Achieve!", "fa-trophy"],
  ["pool", "App Store", "fa-store"], ["alex", "Ask Alex", "fa-magnifying-glass"], ["cabb", "Combat Cabb", "fa-taxi"],
  ["screamsheet", "DataPool", "fa-newspaper"]
];
const PAGES = { setup, breach, redline, roach, ncart, pigeon, gacha, achieve, pool, alex, cabb, screamsheet };

export const { html, refresh, attach } = railed("apps", "Apps", APPS, PAGES);

export const actions = { ...railActions };

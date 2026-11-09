import { store } from "../../../store.js";
import { patchSetting } from "../../../util/settings.js";
import { esc } from "../../../util/text.js";
import { avatar, phoneBtn } from "./comms.js";

/*
 * Director → Garden: the GM Phone's Garden, wide. A numbered rail of the Garden's pages (the GM
 * Phone's tabs, with Drafts' count); Feed and News are the composer and the feed, with the open post
 * (its replies, boost, reply as) or a Patch beside them; Queue, Drafts, Accounts, Writer, Dating and
 * Control are wide lists, and a Patch or post opened from them shows beside them too.
 *
 * Data is director.logic's gardenData (apps/garden/page.js), the list drawn with no post or Patch
 * open (logic.with), the detail with them. Buttons run the GM Phone's own Garden actions
 * (data-director="phone:<action>", same data- attributes as apps/garden/*.hbs) and "As", "Outcome"
 * and boost its dropdowns (pick:*). Posting, replying and Control's switches read the phone's own DOM
 * there, so they're done here as the same store requests.
 */

const FEEDS = ["feed", "news"];

/** A GM Phone dropdown (pages/dropdown.js) as a select that picks through it. */
export function select(dd, label) {
  if (!dd) return "";
  return `<select data-director="pick:${dd.name}" aria-label="${esc(label)}">${dd.options.map(o => `<option value="${esc(o.value)}" ${o === dd.current ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
}

/** The Garden's data: the list (no post or Patch open) and, when one is open, the detail. */
function gardenData(director) {
  const logic = director.logic;
  const ctx = logic.ctx();
  const list = logic.with({ gardenPost: null, gardenAccount: null }, () => logic.gardenData(ctx));
  const detail = logic.gardenPost || logic.gardenAccount ? logic.gardenData(ctx) : null;
  return { list, detail: detail?.post || detail?.patch ? detail : null };
}

/* ---------------- The rail ---------------- */

function railHtml(list) {
  return `<ol class="director-rail" aria-label="Garden pages">${list.tabs.map((t, i) => `<li>
    <button type="button" class="${t.active ? "active" : ""}" aria-pressed="${t.active}" data-director="phone:garden-tab" data-tab="${t.id}">
      <span class="director-rail-n">${String(i + 1).padStart(2, "0")}</span> ${esc(t.label)}</button></li>`).join("")}</ol>`;
}

/* ---------------- Posts ---------------- */

function postHtml(p) {
  const a = p.author;
  return `<li class="director-post ${p.repLabel ? "rep" : ""}">
    <button type="button" class="director-plain" data-director="phone:garden-profile" data-account-id="${esc(a.id ?? "")}">${avatar(a.avatar, a.name)}</button>
    <div class="director-post-main">
      <div class="director-post-head"><button type="button" class="director-plain" data-director="phone:garden-profile" data-account-id="${esc(a.id ?? "")}">
        <strong>${esc(a.name)}</strong>${a.verified ? ` <i class="fas fa-seedling director-verified" title="Verified"></i>` : ""} <span class="director-handle">${esc(a.handle)}</span></button>
        <span class="director-time">${esc(p.ago ?? "")}</span></div>
      ${p.graftedHere ? `<div class="director-sub"><i class="fas fa-code-branch"></i> ${esc(p.graftedHere)} grafted this</div>` : ""}
      ${p.repLabel ? `<div class="director-rep"><i class="fas fa-star"></i> #rep ${esc(p.repLabel)}</div>` : ""}
      ${p.text ? `<div class="director-post-text" data-director="phone:garden-open" data-post-id="${esc(p.id)}">${esc(p.text)}</div>` : ""}
      ${p.image ? `<img class="director-photo" src="${esc(p.image)}" alt="" data-director="phone:open-photo" data-src="${esc(p.image)}">` : ""}
      <div class="director-post-counts">
        <span title="Sprouts"><i class="fas fa-seedling"></i> ${p.likes ?? 0}</span>
        <span title="Grafts"><i class="fas fa-code-branch"></i> ${p.grafts ?? 0}</span>
        ${phoneBtn("garden-open", String(p.replyCount ?? 0), { data: { postId: p.id }, icon: "fa-comment", title: "Replies" })}
        ${p.tierName ? `<span class="director-tag">${esc(p.tierName)}</span>` : ""}
        ${phoneBtn("garden-delete", "", { data: { postId: p.id }, icon: "fa-trash", cls: "danger", title: "Delete" })}
      </div>
    </div>
  </li>`;
}

/* ---------------- Feed / News: the composer and the feed ---------------- */

/** The composer's live part: As, outcome, the attached picture and Reputation tag. */
function composeBarHtml(list) {
  const chips = [];
  if (list.image) chips.push(`<span class="director-chip"><i class="fas fa-image"></i> Picture ${phoneBtn("garden-photo-clear", "", { icon: "fa-xmark", title: "Remove" })}</span>`);
  if (list.rep) chips.push(`<span class="director-chip"><i class="fas fa-star"></i> #rep ${esc(list.rep)} ${phoneBtn("garden-rep-clear", "", { icon: "fa-xmark", title: "Remove" })}</span>`);
  return `<label><span>Post as</span>${select(list.as, "Post as")}</label>
    <label><span>Outcome</span>${select(list.tier, "How far it travels")}</label>
    ${chips.length ? `<div class="director-attached">${chips.join("")}</div>` : ""}`;
}

function composerHtml(director, list) {
  return `<form class="director-garden-compose" data-director="garden-post">
    <div class="director-pickers" data-part="compose-bar">${composeBarHtml(list)}</div>
    <textarea name="text" rows="3" data-draft="garden-post" aria-label="New post" placeholder="What's Night City talking about?" ${list.online ? "" : "disabled"}>${esc(director.drafts["garden-post"] ?? "")}</textarea>
    <div class="director-toolbar">
      ${phoneBtn("garden-photo", "", { icon: "fa-image", title: "Attach a picture" })}
      ${phoneBtn("garden-rep", "", { icon: "fa-star", title: "Tag as a Reputation event about characters" })}
      <label class="director-delay" title="Post in this many in-game minutes (0: now)"><input type="number" name="delay" min="0" data-draft="garden-delay" value="${esc(director.drafts["garden-delay"] ?? "0")}" aria-label="Delay in in-game minutes"> min</label>
      <button type="submit" class="primary" ${list.online ? "" : "disabled"}><i class="fas fa-seedling" aria-hidden="true"></i> Post</button>
    </div>
  </form>`;
}

const feedHtml = list => (list.feed ?? []).map(postHtml).join("") || `<li class="director-empty">Nothing here yet.</li>`;

/* ---------------- The open post or Patch ---------------- */

function detailHtml(detail) {
  if (!detail) return `<div class="director-empty director-pick">Open a post for its replies, or a handle for its Patch.</div>`;
  const close = phoneBtn("garden-back", "", { icon: "fa-xmark", title: "Close" });
  if (detail.post) {
    const p = detail.post;
    const replies = p.replies.map(r => `<li class="director-reply-row">
        <button type="button" class="director-plain" data-director="phone:garden-profile" data-account-id="${esc(r.author.id ?? "")}"><strong>${esc(r.author.name)}</strong> <span class="director-handle">${esc(r.author.handle)}</span></button>
        <span class="director-time">${esc(r.ago ?? "")}</span>
        ${r.canDelete ? phoneBtn("garden-reply-delete", "", { data: { postId: r.postId, replyId: r.id }, icon: "fa-trash", cls: "danger", title: "Delete reply" }) : ""}
        <div class="director-text">${esc(r.text)}</div></li>`).join("") || `<li class="director-empty">No replies yet.</li>`;
    return `<header class="director-convo-head"><h2>Post</h2>
        <label class="director-boost"><span>Travels</span>${select(p.boost, "How far it travels")}</label>${close}</header>
      <div class="director-detail-body"><ol class="director-posts">${postHtml(p)}</ol>
        <h3 class="director-label">Replies</h3><ol class="director-replies">${replies}</ol></div>`;
  }
  const a = detail.patch;
  const tools = a.actorId ? "" : phoneBtn("garden-post-as", "Post as", { data: { accountId: a.id }, icon: "fa-pen-nib" })
    + phoneBtn("garden-account-edit", "Edit", { data: { accountId: a.id }, icon: "fa-pen" })
    + (a.writerEdit ? phoneBtn("garden-writer-edit", "Writer", { data: { accountId: a.id }, icon: "fa-feather" }) : "");
  const replies = a.replies.map(r => `<li class="director-reply-row">
      ${phoneBtn("garden-open", `Replying to ${esc(r.to)}`, { data: { postId: r.postId }, cls: "director-plain" })}
      <span class="director-time">${esc(r.ago ?? "")}</span>
      <div class="director-sub">${esc(r.toText)}</div><div class="director-text">${esc(r.text)}</div></li>`).join("");
  return `<header class="director-convo-head">${avatar(a.avatar, a.name)}
      <div class="director-convo-title"><h2>${esc(a.name)}${a.verified ? ` <i class="fas fa-seedling director-verified"></i>` : ""}</h2>
        <span class="director-sub">${esc(a.handle)} · ${esc(a.kindName ?? "")} · ${esc(a.followersLabel)} followers${a.reputation != null ? ` · REP ${a.reputation}` : ""}</span></div>
      <div class="director-toolbar">${tools}${close}</div></header>
    <div class="director-detail-body">
      ${a.bio ? `<p class="director-bio">${esc(a.bio)}</p>` : ""}
      ${a.repFeed.length ? `<h3 class="director-label">Street rep (from the sheet)</h3><ol class="director-list">${a.repFeed.map(l => `<li><small>${esc(l)}</small></li>`).join("")}</ol>` : ""}
      <h3 class="director-label">Posts</h3><ol class="director-posts">${a.posts.map(postHtml).join("") || `<li class="director-empty">Nothing posted.</li>`}</ol>
      ${replies ? `<h3 class="director-label">Replies</h3><ol class="director-replies">${replies}</ol>` : ""}
    </div>`;
}

/** Reply as an account, under the open post (kept while that post stays open). */
function replyHtml(director, detail) {
  if (!detail?.post) return "";
  const key = `garden-reply:${detail.post.id}`;
  return `<form class="director-reply" data-director="garden-reply" data-post-id="${esc(detail.post.id)}">
    <label><span>As</span>${select(detail.replyAs, "Reply as")}</label>
    <input type="text" name="text" data-draft="${esc(key)}" value="${esc(director.drafts[key] ?? "")}" placeholder="Reply…" aria-label="Reply" ${detail.online ? "" : "disabled"}>
    <button type="submit" class="primary" ${detail.online ? "" : "disabled"}><i class="fas fa-reply" aria-hidden="true"></i> Reply</button>
  </form>`;
}

/** Which post or Patch is open: its reply box is kept while this stays the same. */
const detailKey = logic => (logic.gardenPost ? `post:${logic.gardenPost}` : logic.gardenAccount ? `patch:${logic.gardenAccount}` : "");

/* ---------------- The wide pages ---------------- */

/** A list row: a lead (avatar, checkbox), the main line, a small line, then buttons. */
export const row = ({ lead = "", main, small = "", tools = "", cls = "" }) => `<li class="director-item ${cls}">${lead}<div class="director-item-main">${main}${small ? `<small>${small}</small>` : ""}</div><div class="director-toolbar">${tools}</div></li>`;
export const listOf = (rows, empty) => `<ol class="director-list">${rows.join("") || (empty ? `<li class="director-empty">${empty}</li>` : "")}</ol>`;
export const label = (text, tools = "") => `<h3 class="director-label">${text}${tools ? ` <span class="director-toolbar">${tools}</span>` : ""}</h3>`;

function queueHtml(q) {
  const items = q.items.map(i => row({
    main: `<strong>${esc(i.author.handle)}</strong> <span class="director-time">${esc(i.inLabel)}</span>`,
    small: `${i.image ? `<i class="fas fa-image" title="${esc(i.image)}"></i> ` : ""}${esc(i.text ?? "")}${i.outcome ? ` · <em>${esc(i.outcome)}</em>` : ""}`,
    tools: phoneBtn("garden-queue-edit", "", { data: { id: i.id }, icon: "fa-pen", title: "Edit" })
      + phoneBtn("garden-queue", "", { data: { op: "up", id: i.id }, icon: "fa-arrow-up", title: "Earlier", disabled: i.first })
      + phoneBtn("garden-queue", "", { data: { op: "down", id: i.id }, icon: "fa-arrow-down", title: "Later", disabled: i.last })
      + phoneBtn("garden-queue", "", { data: { op: "now", id: i.id }, icon: "fa-paper-plane", title: "Post now" })
      + phoneBtn("garden-queue", "", { data: { op: "remove", id: i.id }, icon: "fa-xmark", title: "Skip" })
  }));
  return `<div class="director-toolbar">${phoneBtn("garden-drip", "Queue posts", { icon: "fa-list" })}
      ${q.paused ? phoneBtn("garden-queue", "Resume", { data: { op: "resume" }, icon: "fa-play", cls: "primary" }) : phoneBtn("garden-queue", "Pause", { data: { op: "pause" }, icon: "fa-pause" })}</div>
    ${listOf(items, "Nothing queued. Posts with a delay, and queued lists, wait here.")}
    <p class="director-note">Queued posts go out on the phones' clock: in-game time when it follows the world, else real time. Move the clock on and everything due goes out at once, each dated when it was due. <b>Queue posts</b> takes one post per line: <em>@handle | text | picture | outcome</em>; only the text is needed.</p>`;
}

function draftsHtml(d) {
  const batches = d.batches.map(b => {
    const problems = (list, cls) => (list.length ? `<ul class="director-problems ${cls}">${list.map(p => `<li>${p.line ? `Line ${p.line}: ` : ""}${esc(p.message)}</li>`).join("")}</ul>` : "");
    const days = b.days.map(day => `<h4 class="director-day">${esc(day.label)}</h4>${listOf(day.rows.map(r => {
      const badges = [r.isNew && "new", r.private && "private", r.ringName, r.hook && "hook", ...(r.seeds ?? []).map(s => `seed ${s}`), r.tierName, r.edited && "edited"]
        .filter(Boolean).map(t => `<span class="director-tag">${esc(t)}</span>`).join("");
      const small = [
        `${r.replyTo ? `<i class="fas fa-reply"></i> to ${esc(r.replyTo)}: ` : ""}${r.before ? `<s>${esc(r.before)}</s> → ` : ""}${esc(r.body ?? "")}`,
        r.img && `<i class="fas fa-image"></i> ${esc(r.img)}`,
        r.repNames && `<i class="fas fa-star"></i> Reputation: ${esc(r.repNames)}`,
        r.why && `<em>why: ${esc(r.why)}</em>`,
        ...(r.problems ?? []).map(p => `<span class="director-problem"><i class="fas fa-triangle-exclamation"></i> ${esc(p)}</span>`)
      ].filter(Boolean).join("<br>");
      return row({
        cls: r.include ? "" : "faded",
        lead: phoneBtn("garden-draft-toggle", "", { data: { batch: r.batch, key: r.key }, icon: r.include ? "fa-square-check" : "fa-square", cls: "director-check", title: r.include ? "Included: click to cut" : "Cut: click to include" }),
        main: `<strong><i class="fas ${r.kindIcon}" title="${esc(r.kindName)}"></i> ${esc(r.author)}</strong> ${badges}${r.when ? ` <span class="director-time">${esc(r.when)}</span>` : ""}`,
        small,
        tools: r.editable ? phoneBtn("garden-draft-edit", "", { data: { batch: r.batch, key: r.key }, icon: "fa-pen", title: "Edit" }) : ""
      });
    }), "")}`).join("");
    const mix = b.mix.length ? `<div class="director-mix" title="The included posts and replies by ring">${b.mix.map(m => `<span class="ring-${m.ring}" style="flex: ${m.n}">${esc(m.name)} ${m.pct}%</span>`).join("")}</div>` : "";
    return `<section class="director-batch ${b.broken ? "broken" : ""}">
      ${label(`Batch ${esc(b.id)}`)}
      <p class="director-note">${esc(b.summary ?? "")}${b.baseLabel ? ` · written for ${esc(b.baseLabel)}` : ""}${b.legacy ? " · old drip lines, 5 in-game minutes apart" : ""}</p>
      ${problems(b.errors, "errors")}${b.errors.length ? `<p class="director-note">This batch can't be approved. Ask the writer for a new one, or discard it.</p>` : ""}
      ${problems(b.warnings, "")}
      ${(b.notes ?? []).map(n => `<p class="director-writer-note"><i class="fas fa-feather"></i> ${esc(n)}</p>`).join("")}
      ${b.feedback ? `<p class="director-writer-note mine"><i class="fas fa-comment"></i> ${esc(b.feedback)}</p>` : ""}
      ${mix}
      <div class="director-toolbar">${phoneBtn("garden-draft-all", "Include all", { data: { batch: b.id, on: "true" } })}${phoneBtn("garden-draft-all", "Cut all", { data: { batch: b.id, on: "false" } })}</div>
      ${days}
      <div class="director-toolbar">
        ${phoneBtn("garden-drafts-approve", `Approve ${b.included}`, { data: { batch: b.id }, icon: "fa-check", cls: "primary", disabled: b.broken })}
        ${phoneBtn("garden-drafts-note", "Note for the writer", { data: { batch: b.id }, icon: "fa-comment" })}
        ${phoneBtn("garden-drafts-discard", "Discard", { data: { batch: b.id }, icon: "fa-trash", cls: "danger" })}
      </div>
    </section>`;
  }).join("") || `<p class="director-empty">No drafts waiting. Run <em>/garden-writer</em> in Claude Code; its batch shows up here within a minute.</p>`;
  const reviews = d.reviews.length ? label("Last reviewed") + listOf(d.reviews.map(r => row({
    main: `<strong>${esc(r.batch)}</strong>`,
    small: `${r.approved} approved · ${r.cut} cut${r.edited?.length ? ` · ${r.edited.length} edited` : ""}${r.note ? ` · ${esc(r.note)}` : ""} · ${esc(r.when)}`
  })), "") : "";
  return `<div class="director-toolbar">${phoneBtn("garden-pack", "Save writer pack now", { icon: "fa-file-export", title: "Writes this world's writer pack (what the garden-writer skill reads) right now. It's also saved by itself whenever the Garden changes." })}
      <span class="director-sub">Writer pack ${d.pack.written ? `last saved ${esc(d.pack.written)}` : d.pack.missing ? "not saved yet" : "…"} · <em>${esc(d.pack.path)}</em></span></div>
    ${batches}${reviews}
    <p class="director-note">The writer (the <em>garden-writer</em> skill in Claude Code) reads this world's writer pack and writes batches into <em>${esc(d.inbox)}</em>. Approved posts, replies and texts wait in the Queue for their in-game time; whatever's already due goes out at once, backdated.</p>`;
}

function accountsHtml(accounts) {
  const rows = accounts.map(a => row({
    lead: avatar(a.avatar, a.name),
    main: `<button type="button" class="director-plain" data-director="phone:garden-profile" data-account-id="${esc(a.id)}"><strong>${esc(a.handle)}</strong>${a.verified ? ` <i class="fas fa-seedling director-verified"></i>` : ""}</button>`,
    small: [a.name, a.kindName, a.followersLabel, a.owner, a.npc, a.attitude && `☺ ${a.attitude}`].filter(Boolean).map(esc).join(" · "),
    tools: phoneBtn("garden-pin", "", { data: { accountId: a.id }, icon: "fa-thumbtack", cls: a.pinned ? "on" : "", title: a.pinned ? "Pinned: first in the As list. Unpin" : "Pin: first in the As list" })
      + (a.actorId ? "" : phoneBtn("garden-post-as", "", { data: { accountId: a.id }, icon: "fa-pen-nib", title: `Post as ${a.handle}` })
        + phoneBtn("garden-account-edit", "", { data: { accountId: a.id }, icon: "fa-pen", title: "Edit" })
        + (a.writerEdit ? phoneBtn("garden-writer-edit", "", { data: { accountId: a.id }, icon: "fa-feather", cls: a.profiled ? "on" : "", title: `Writer profile${a.profiled ? " (set)" : ""}` }) : ""))
      + phoneBtn("garden-account-delete", "", { data: { accountId: a.id }, icon: "fa-trash", cls: "danger", title: "Delete" })
  }));
  return `<div class="director-toolbar">${phoneBtn("garden-account-edit", "New account", { icon: "fa-plus" })}${phoneBtn("garden-generate", "Random citizens", { icon: "fa-dice" })}</div>
    ${listOf(rows, "No accounts yet.")}`;
}

function writerHtml(w) {
  const edit = (action, data) => phoneBtn(action, "", { data, icon: "fa-pen", title: "Edit" });
  const stage = (kind, x) => phoneBtn("garden-stage", esc(x.stageName), { data: { kind, id: x.id }, cls: "director-stage", title: "Move it on" });
  return `<div class="director-toolbar">${phoneBtn("garden-log-event", "Log an event", { icon: "fa-bolt", cls: "primary" })}${phoneBtn("garden-plant-seed", "Plant a seed", { icon: "fa-seedling" })}
      ${phoneBtn("garden-macro", `Put "Log an event" on my hotbar`, { icon: "fa-bolt" })}</div>
    <div class="director-columns">
      <div>${label("Events")}${listOf(w.happenings.map(h => row({
        cls: h.closed ? "faded" : "",
        main: `<strong>${esc(h.what)}</strong>`,
        small: `${h.place ? `${esc(h.place)} · ` : ""}${esc(h.when)} · ${esc(h.heatName ?? "")}${h.public ? "" : ` · <i class="fas fa-eye-slash" title="GM-only"></i>`}${h.whoNames ? ` · ${esc(h.whoNames)}` : ""}`,
        tools: stage("happening", h) + edit("garden-happening-edit", { id: h.id }) + phoneBtn("garden-happening-delete", "", { data: { id: h.id }, icon: "fa-trash", cls: "danger", title: "Forget" })
      })), "Nothing logged. Log what happened in the story; the writer follows it up.")}
      ${label("Seeds")}${listOf(w.seeds.map(s => row({
        cls: s.done ? "faded" : "",
        main: `<strong>${esc(s.what)}</strong>`,
        small: `${esc(s.obviousName ?? "")}${s.byLabel ? ` · by ${esc(s.byLabel)}` : ""}${s.keywords?.length ? ` · ${esc(s.keywords.join(", "))}` : ""}`,
        tools: stage("seed", s) + edit("garden-seed-edit", { id: s.id }) + phoneBtn("garden-seed-delete", "", { data: { id: s.id }, icon: "fa-trash", cls: "danger", title: "Forget" })
      })), "No seeds. Plant what you want the city to start talking about before it matters.")}
      ${label("Recurring posts", phoneBtn("garden-format-edit", "", { icon: "fa-plus", title: "New recurring post" }))}${listOf(w.formats.map(f => row({
        main: `<strong>${esc(f.handle)}</strong> <span class="director-time">${esc(f.when ?? "")}</span>`, small: esc(f.what ?? ""),
        tools: edit("garden-format-edit", { id: f.id }) + phoneBtn("garden-format-delete", "", { data: { id: f.id }, icon: "fa-trash", cls: "danger", title: "Delete" })
      })), "None. The stringer's morning headlines, Roach's weekly post, the band's gig listing...")}</div>
      <div>${label("Characters", phoneBtn("garden-writer-pc-add", "", { icon: "fa-plus", title: "Add a character" }))}
      <p class="director-note">${esc(w.pcsNote)}${w.pcsOut.length ? ` Left out: ${esc(w.pcsOut.map(c => c.name).join(", "))}.` : ""}</p>
      ${listOf(w.pcs.map(c => row({
        main: `<strong>${esc(c.name)}</strong>`, small: esc(c.keywords || "No keywords yet"),
        tools: phoneBtn("garden-writer-pc", "", { data: { actorId: c.id }, icon: "fa-feather", cls: c.set ? "on" : "", title: "Writer profile" })
          + phoneBtn("garden-writer-pc-remove", "", { data: { actorId: c.id }, icon: "fa-xmark", title: "Remove from the writer's list" })
      })), "")}
      ${label("Cast, corps and voices")}${listOf(w.cast.map(c => row({
        main: `<button type="button" class="director-plain" data-director="phone:garden-profile" data-account-id="${esc(c.id)}"><strong>${esc(c.handle)}</strong></button>`,
        small: `${c.arc ? `${esc(c.arc)} · ` : ""}${esc(c.keywords)}${c.lines ? ` · ${c.lines} own replies` : ""}`,
        tools: phoneBtn("garden-writer-edit", "", { data: { accountId: c.id }, icon: "fa-feather", cls: "on", title: "Writer profile" })
      })), "No profiles yet. Give an account keywords with the feather in Accounts.")}
      ${label("Writer feeds")}${listOf(w.feeds.map(f => row({
        cls: f.on ? "" : "faded",
        main: `<strong>${esc(f.name)}</strong>`, small: `${f.on ? "In the pack" : "Off"}${f.keywords ? ` · ${esc(f.keywords)}` : ""}${f.accounts ? ` · ${esc(f.accounts)}` : ""}`,
        tools: phoneBtn("garden-feed-edit", "", { data: { app: f.app }, icon: "fa-pen", title: "Edit" })
      })), "")}
      ${label("Mix", phoneBtn("garden-mix-edit", "", { icon: "fa-pen", title: "Edit" }))}
      <p class="director-note">City ${w.mix.city}% · Close to home ${w.mix.close}% · About them ${w.mix.about}%</p></div>
    </div>
    <p class="director-note">The garden-writer skill (Claude Code) reads all of this. Players never see it.</p>`;
}

function datingHtml(d) {
  return `<div class="director-columns">
    <div>${label("The Algorithm is searching")}${listOf(d.searching.map(s => row({
      main: `<strong>${esc(s.who)}</strong> activated the Algorithm`,
      tools: phoneBtn("dating-suggest", "Pick who it finds", { data: { sparkId: s.id }, icon: "fa-wand-magic-sparkles", cls: "primary" })
    })), "Nobody's searching.")}
    ${label("Matches")}${listOf(d.matches.map(s => row({
      main: `<strong>${esc(s.who)}</strong> ♥ ${esc(s.handle ?? "")}`, small: d.comms && s.contact ? `In Messages as ${esc(s.contact)}` : "",
      tools: d.comms ? `<button type="button" data-director="garden-dating-text" data-spark-id="${esc(s.id)}"><i class="fas fa-champagne-glasses" aria-hidden="true"></i> Text them</button>` : ""
    })), "No matches yet.")}</div>
    <div>${label("Profiles", phoneBtn("dating-profile-edit", "", { icon: "fa-plus", title: "New profile" }) + phoneBtn("dating-generate", "", { icon: "fa-dice", title: "Random profiles" }))}
    ${listOf(d.profiles.map(p => row({
      lead: avatar(p.avatar, p.name),
      main: `<strong>${esc(p.handle)}</strong> ${esc(p.name)}, ${esc(String(p.age ?? ""))}`,
      small: p.player ? `${esc(p.player)}'s profile` : `${p.npc ? `${esc(p.npc)} · ` : ""}${esc(p.prompts?.[0] ?? "")}`,
      tools: p.player ? "" : phoneBtn("dating-profile-edit", "", { data: { profileId: p.id }, icon: "fa-pen", title: "Edit" })
        + phoneBtn("dating-profile-delete", "", { data: { profileId: p.id }, icon: "fa-trash", cls: "danger", title: "Delete" })
    })), "No profiles. Write some, or make random ones.")}</div>
  </div>`;
}

function controlHtml(c) {
  const toggle = (key, text) => `<label class="director-check-row"><input type="checkbox" data-director="garden-setting" data-key="${key}" ${c[key] ? "checked" : ""}> ${text}</label>`;
  return `<div class="director-columns">
    <div>${label("Pages")}${toggle("mergeNews", "Merge Feed &amp; News")}${toggle("dating", "The Garden Dating")}
    ${label("Outcomes", phoneBtn("garden-tier-edit", "", { icon: "fa-plus", title: "New outcome" }))}
    ${listOf(c.tiers.map(t => row({
      main: `<strong>${esc(t.name)}</strong>`, small: `${esc(t.summary)} · chance ${t.weight}`,
      tools: phoneBtn("garden-tier-edit", "", { data: { tier: t.id }, icon: "fa-pen", title: "Edit" }) + phoneBtn("garden-tier-delete", "", { data: { tier: t.id }, icon: "fa-trash", cls: "danger", title: "Delete" })
    })), "")}
    <div class="director-toolbar">${phoneBtn("garden-tier-reset", "Back to the default outcomes")}</div>
    <p class="director-note">How far and how fast a post blows up. Sprouts are about 11% of who sees it (the author's followers × reach); grafts about 2%.</p></div>
    <div>${label("Word lists")}
    <p class="director-note">Everything the Garden makes up comes from text files, one entry per line (lines starting with # are notes). <b>Choose</b> opens the file picker, where you can also upload one.</p>
    ${listOf(c.lists.map(l => row({
      main: `<strong>${esc(l.label)}</strong> <small>${l.count} · ${esc(l.path ?? `built in (${l.file})`)}</small>`, small: esc(l.sample),
      tools: phoneBtn("garden-list-view", "", { data: { list: l.key }, icon: "fa-eye", title: "Read it" })
        + phoneBtn("garden-list-file", "", { data: { list: l.key }, icon: "fa-file-import", title: "Choose or upload your own file" })
        + (l.path ? phoneBtn("garden-list-reset", "", { data: { list: l.key }, icon: "fa-rotate-left", title: "Back to the built-in file" }) : "")
    })), "")}</div>
  </div>`;
}

function pageHtml(list) {
  const { show } = list;
  if (show.queue) return queueHtml(list.queue);
  if (show.drafts) return draftsHtml(list.drafts);
  if (show.accounts) return accountsHtml(list.accounts);
  if (show.writer) return writerHtml(list.writer);
  if (show.dating) return datingHtml(list.dating);
  if (show.control) return controlHtml(list.control);
  return "";
}

/* ---------------- The view ---------------- */

/** Which layout is drawn: a feed (composer + feed), or a wide page. */
const shapeOf = logic => (FEEDS.includes(logic.gardenTab ?? "feed") ? "feed" : logic.gardenTab);

export function html(director) {
  const { list, detail } = gardenData(director);
  const logic = director.logic;
  const shape = shapeOf(logic);
  const main = shape === "feed"
    ? `${composerHtml(director, list)}<ol class="director-posts" data-part="feed" aria-label="Posts">${feedHtml(list)}</ol>`
    : `<div class="director-page" data-part="page">${pageHtml(list)}</div>`;
  return `<div class="director-garden ${detail || shape === "feed" ? "has-detail" : ""}" data-shape="${esc(shape)}">
    <nav class="director-garden-rail" data-part="rail">${railHtml(list)}</nav>
    <div class="director-garden-main">${main}</div>
    <div class="director-garden-detail" data-detail="${esc(detailKey(logic))}">
      <div class="director-detail" data-part="detail">${detailHtml(detail)}</div>
      <div class="director-reply-slot">${replyHtml(director, detail)}</div>
    </div>
  </div>`;
}

/**
 * Redraw the rail, the feed or page and the open post or Patch. The composer's text and the reply
 * box are kept (the reply box while the same post is open); another page's layout draws it all.
 */
export function refresh(director, root) {
  const logic = director.logic;
  const garden = root.querySelector(".director-garden");
  // gardenData settles the tab (a tab that's gone falls back to the feed) before its layout is compared.
  const { list, detail } = gardenData(director);
  if (!garden || garden.dataset.shape !== shapeOf(logic)) {
    root.innerHTML = html(director);
    return;
  }
  const set = (part, markup) => {
    const el = garden.querySelector(`[data-part="${part}"]`);
    if (!el) return;
    const scroll = el.scrollTop;
    el.innerHTML = markup;
    el.scrollTop = scroll;
  };
  set("rail", railHtml(list));
  if (garden.dataset.shape === "feed") {
    set("compose-bar", composeBarHtml(list));
    set("feed", feedHtml(list));
  } else set("page", pageHtml(list));
  garden.classList.toggle("has-detail", !!detail || garden.dataset.shape === "feed");
  set("detail", detailHtml(detail));
  const pane = garden.querySelector(".director-garden-detail");
  const key = detailKey(logic);
  if (pane.dataset.detail !== key) {
    pane.dataset.detail = key;
    pane.querySelector(".director-reply-slot").innerHTML = replyHtml(director, detail);
  } else {
    // Same post: just its "As" select.
    const as = pane.querySelector(".director-reply label");
    if (as && detail?.replyAs) as.innerHTML = `<span>As</span>${select(detail.replyAs, "Reply as")}`;
  }
}

export const actions = {
  "garden-post"(data, event) {
    const logic = this.logic;
    const form = event.target;
    const text = form.elements.text.value.trim();
    const image = logic.gardenImage ?? null;
    if (!text && !image) return;
    const delay = Number(form.elements.delay.value) || 0;
    if (!store.request("garden-gm-post", { accountId: logic.gardenAs, text, image, tier: logic.gardenTier || null, delay, rep: logic.gardenRep ?? null })) return;
    form.elements.text.value = "";
    delete this.drafts["garden-post"];
    logic.gardenImage = null;
    logic.gardenRep = null;
    this.refresh({ all: true });
  },
  "garden-reply"({ postId }, event) {
    const input = event.target.elements.text;
    const text = input.value.trim();
    if (!text || !store.request("garden-gm-reply", { accountId: this.logic.gardenAs, postId, text })) return;
    input.value = "";
    delete this.drafts[`garden-reply:${postId}`];
  },
  /** Control: News merged into the Feed, Dating on or off. */
  "garden-setting"({ key }, event) {
    const on = event.target.checked;
    patchSetting("gardenConfig", c => (c[key] = on));
  },
  /** Dating: text the character as their match, then carry on in Comms acting as them. */
  async "garden-dating-text"({ sparkId }) {
    const before = this.logic.view;
    await this.logic.run("dating-text", { sparkId });
    if (this.logic.view !== before) {
      this.tab = "comms";
      this.render();
    }
  }
};

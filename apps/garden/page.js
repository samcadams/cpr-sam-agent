import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { attachPhotoDialog, fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { findContact, getContacts, playerCharacters } from "../../scripts/model/contacts.js";
import {
  ATTITUDES, byNewest, DEFAULT_TIERS, defaultListPath, gardenAgo, gardenConfig, gardenLists, gardenNow, gardenTiers, KINDS, LIST_FILES, MATCHED, queueWhen, repsOf,
  reputationOf, tierSummary, WORLD_PACE
} from "./model.js";
import { appearance } from "../../scripts/model/appearance.js";
import { commsOn } from "../../scripts/model/features.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { esc } from "../../scripts/util/text.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { initials } from "../../scripts/util/text.js";
import { actions as writerActions, methods as writerMethods } from "./writer-page.js";
import { actions as draftsActions, methods as draftsMethods } from "./drafts-page.js";
import { hasProfile } from "./writer.js";

/*
 * Phone page: The Garden and The Garden Dating (see apps/garden/model.js). Two feeds, Feed and News;
 * a post opens with its replies, a handle opens its Patch. Anyone can read; posting, sprouting,
 * grafting and replying take an account ("Make an account", one tap). Dating: a profile (its own,
 * or the Garden Patch linked), then Pass or Spark on the cards; the GM decides matches and dates.
 * On the GM Phone: post as any account (now or later), the queue, the accounts and the dating side.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const TABS = { feed: "Feed", news: "News", dating: "Dating" };
// Drafts and Writer feed the garden-writer skill on Sam's machine: release builds leave them out (tools/bundle.mjs --release).
const RELEASE = globalThis.CPR_SAM_AGENT_RELEASE === true;
const WRITER_TABS = RELEASE ? {} : { drafts: "Drafts", writer: "Writer" };
const GM_TABS = { ...TABS, accounts: "Accounts", queue: "Queue", ...WRITER_TABS, control: "Control" };

/** How often a player's phone tells the host its character opened the Garden (garden-seen), per character. */
const SEEN_EVERY_MS = 5 * 60_000;
const seenSent = new Map();

/** The tabs this phone has: News only when it's apart from the Feed, Dating only when it's on. */
function gardenTabs(gm) {
  const { mergeNews, dating } = gardenConfig();
  const tabs = { ...(gm ? GM_TABS : TABS) };
  if (mergeNews) delete tabs.news;
  if (!dating) delete tabs.dating;
  // Batches from the writer waiting for the GM (drafts-page.js).
  const waiting = gm && !RELEASE ? Object.keys(store.garden.drafts?.batches ?? {}).length : 0;
  if (waiting) tabs.drafts = `Drafts (${waiting})`;
  return tabs;
}

/** Save part of the Garden's settings (world setting "gardenConfig"). */
const saveGardenConfig = change => patchSetting("gardenConfig", change);

/** What the sheet's reputation ledger says, as lines (the system keeps "transactions"). */
function reputationFeed(actor) {
  const list = actor?.system?.reputation?.transactions;
  if (!Array.isArray(list)) return [];
  return list.slice(-5).reverse().map(t => (Array.isArray(t) ? t.filter(Boolean).join(" · ") : typeof t === "object" ? Object.values(t ?? {}).join(" · ") : String(t)));
}

/** Every picture in a folder and the folders under it (a few levels down, up to 500). */
async function picturesIn(folder, depth = 0, found = []) {
  if (depth > 4 || found.length >= 500) return found;
  const result = await FilePicker.browse("data", folder);
  found.push(...result.files.filter(f => /\.(webp|png|jpe?g|gif|avif|svg)$/i.test(f)));
  for (const dir of result.dirs ?? []) await picturesIn(dir, depth + 1, found);
  return found.slice(0, 500);
}

/** Pictures in a folder the GM picks, subfolders included (for generated people). */
async function pickAvatarFolder() {
  const result = await fieldsDialog({
    title: "Pictures for them",
    label: "Use",
    fields: [{ name: "folder", label: "Folder", type: "image", placeholder: "Optional: a folder of portraits", hint: "Pick any picture in the folder. Empty: no pictures (initials)." }]
  });
  if (!result?.folder) return [];
  const folder = result.folder.includes(".") ? result.folder.slice(0, result.folder.lastIndexOf("/")) : result.folder;
  try {
    return await picturesIn(folder);
  } catch {
    ui.notifications.warn("Couldn't read that folder.");
    return [];
  }
}

/**
 * Reputation fields for a dialog: a change per character (blank: not tagged; 0: tagged, no change)
 * and one reason for them all. `reps`: the events already set.
 */
function repFields(reps) {
  const by = new Map(reps.map(r => [r.actorId, r]));
  return [
    ...playerCharacters().map(a => ({ name: `rep_${a.id}`, label: `#rep ${displayName(a)}`, value: by.has(a.id) ? String(by.get(a.id).delta ?? 0) : "", placeholder: "Not tagged" })),
    { name: "repReason", label: "Reason", value: reps[0]?.reason ?? "", placeholder: "Put three Tyger Claws on the floor at Totentanz" }
  ];
}

/** The Reputation events from a dialog made with repFields(), or null for none. */
function repsFrom(result) {
  const reps = playerCharacters().filter(a => result[`rep_${a.id}`] !== "")
    .map(a => ({ actorId: a.id, delta: Math.trunc(Number(result[`rep_${a.id}`]) || 0), reason: result.repReason }));
  return reps.length ? reps : null;
}

const REP_HINT = "A number is added to that character's Reputation on the sheet; 0 tags them without a change; blank leaves them out.";

/** "V (+1), Judy": the characters a post is about. */
const repLabel = reps => reps.map(r => {
  const actor = game.actors.get(r.actorId);
  return actor ? `${displayName(actor)}${r.delta ? ` (${r.delta > 0 ? "+" : ""}${r.delta})` : ""}` : null;
}).filter(Boolean).join(", ");

/** Who a match is in Messages: the contact it added, or (older matches) the profile's NPC or name. */
function matchContact(spark) {
  const p = store.garden.dating.profiles[spark?.profileId];
  return spark?.contact ?? p?.npc ?? p?.name ?? null;
}

export const actions = {
  ...writerActions,
  ...draftsActions,
  "garden-tab"({ tab }) {
    this.gardenTab = tab;
    this.gardenPost = null;
    this.gardenAccount = null;
    this.render();
  },
  "garden-open"({ postId }, event) {
    // Dragging across the text to select it ends in a click; don't open the post then.
    if (event?.currentTarget?.classList.contains("agent-garden-text") && window.getSelection()?.toString()) return;
    this.gardenPost = postId;
    this.render();
  },
  "garden-profile"({ accountId }) {
    this.gardenAccount = accountId;
    this.gardenPost = null;
    this.render();
  },
  /** A player's own Patch, from their handle in the header. */
  "garden-me"() {
    const me = Object.values(store.garden.accounts).find(a => a.actorId && a.actorId === this.context()?.actorId);
    if (!me) return;
    this.gardenAccount = me.id;
    this.gardenPost = null;
    this.render();
  },
  "garden-back"() {
    if (this.gardenPost) this.gardenPost = null;
    else this.gardenAccount = null;
    this.render();
  },
  "garden-join"() {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("garden-join", { actorId: actor.id });
  },
  async "garden-photo"() {
    const image = await attachPhotoDialog();
    if (!image) return;
    this.gardenImage = image;
    this._keepGardenDraft();
    this.render();
  },
  "garden-photo-clear"() {
    this.gardenImage = null;
    this._keepGardenDraft();
    this.render();
  },
  "garden-post"() {
    const ctx = this.context();
    const text = this.element[0].querySelector("textarea[name=gardenPost]")?.value.trim() ?? "";
    const image = this.gardenImage ?? null;
    if (!text && !image) return;
    if (ctx.perspective === "gm") {
      const delay = Number(this.element[0].querySelector("input[name=gardenDelay]")?.value) || 0;
      store.request("garden-gm-post", { accountId: this.gardenAs, text, image, tier: this.gardenTier || null, delay, rep: this.gardenRep ?? null });
      this.gardenRep = null;
    } else store.request("garden-post", { actorId: ctx.actorId, text, image });
    this.gardenDraft = "";
    this.gardenImage = null;
  },
  "garden-like"({ postId }) {
    store.request("garden-like", { actorId: this.context()?.actorId, postId });
  },
  "garden-graft"({ postId }) {
    store.request("garden-graft", { actorId: this.context()?.actorId, postId });
  },
  "garden-reply"({ postId }) {
    const ctx = this.context();
    const input = this.element[0].querySelector("input[name=gardenReply]");
    const text = input?.value.trim();
    if (text && ctx.perspective === "gm") store.request("garden-gm-reply", { accountId: this.gardenAs, postId, text });
    else if (text) store.request("garden-reply", { actorId: ctx?.actorId, postId, text });
    this.gardenReplyDraft = "";
  },
  async "garden-edit-me"() {
    const ctx = this.context();
    const account = Object.values(store.garden.accounts).find(a => a.actorId === ctx?.actorId);
    if (!account) return;
    const result = await fieldsDialog({
      title: "Your Garden Patch",
      fields: [
        { name: "handle", label: "Handle", value: account.handle },
        { name: "name", label: "Name", value: account.name },
        { name: "bio", label: "Bio", type: "textarea", rows: 2, value: account.bio }
      ]
    });
    if (result) store.request("garden-profile", { actorId: ctx.actorId, ...result });
  },
  /** GM: tag the next post as a Reputation event about characters (it goes on their sheets too). */
  async "garden-rep"() {
    const result = await fieldsDialog({ title: "Reputation event", label: "Tag the post", fields: repFields(this.gardenRep ?? []), note: REP_HINT });
    if (!result) return;
    this._keepGardenDraft();
    this.gardenRep = repsFrom(result);
    this.render();
  },
  "garden-rep-clear"() {
    this._keepGardenDraft();
    this.gardenRep = null;
    this.render();
  },
  "garden-delete"({ postId }) {
    store.request("garden-post-edit", { postId, remove: true });
    if (this.gardenPost === postId) this.gardenPost = null;
  },
  "garden-reply-delete"({ postId, replyId }) {
    store.request("garden-reply-delete", { postId, replyId });
  },
  async "garden-account-edit"({ accountId }) {
    const a = store.garden.accounts[accountId] ?? { handle: "", name: "", bio: "", kind: "citizen", followers: 100, verified: false };
    const result = await fieldsDialog({
      title: accountId ? `Edit ${a.handle}` : "New Garden account",
      fields: [
        { name: "handle", label: "Handle", value: a.handle, placeholder: "@handle" },
        { name: "name", label: "Name", value: a.name },
        { name: "avatar", label: "Picture", type: "image", value: a.avatar ?? "" },
        { name: "kind", label: "Kind", type: "select", value: a.kind, options: Object.entries(KINDS).filter(([k]) => k !== "pc").map(([value, label]) => ({ value, label })) },
        { name: "followers", label: "Followers", type: "number", value: a.followers },
        {
          name: "mood", label: "Attitude", type: "select", value: a.mood ?? "",
          options: [{ value: "", label: "None (never replies on its own)" }, ...Object.entries(ATTITUDES).map(([value, label]) => ({ value, label }))],
          hint: "The mood of its automatic replies to others' posts."
        },
        { name: "verified", label: "Verified 🌿", type: "checkbox", value: a.verified },
        { name: "npc", label: "Messages go to", value: a.npc ?? "", placeholder: "An NPC's contact name (optional)", hint: "Players can Message this account: it opens a conversation with that contact (or asks you for the number)." },
        { name: "pinned", label: "Pinned (first in \"As\")", type: "checkbox", value: a.pinned },
        { name: "bio", label: "Bio", type: "textarea", rows: 2, value: a.bio }
      ]
    });
    if (result) store.request("garden-account", { account: { ...result, id: accountId || undefined } });
  },
  "garden-account-delete"({ accountId }) {
    const a = store.garden.accounts[accountId];
    if (!a) return;
    Dialog.confirm({ title: "The Garden", content: `<p>Delete ${a.handle} and everything they posted?</p>`, yes: () => store.request("garden-account-delete", { accountId }), defaultYes: false });
  },
  async "garden-generate"() {
    const result = await fieldsDialog({ title: "Random citizens", label: "Make them", fields: [{ name: "count", label: "How many", type: "number", value: 5 }] });
    if (!result?.count) return;
    store.request("garden-generate", { count: result.count, avatars: await pickAvatarFolder() });
  },
  /** GM: queue a list of posts, typed or read from a text file (apps/garden/host.js _onGardenDrip parses both). */
  async "garden-drip"() {
    const as = store.garden.accounts[this.gardenAs];
    const result = await fieldsDialog({
      title: "Queue posts",
      label: "Queue",
      fields: [
        { name: "file", label: "From a file (optional)", type: "textfile", target: "lines", hint: "Fills Posts below with the file's lines; change anything before queueing." },
        { name: "lines", label: "Posts", type: "textarea", rows: 8, placeholder: "@network54 | Explosion reported in Watson | | viral\n@random | anyone else hear that?\nFire in Watson | worlds/my-world/pics/fire.webp\nA post from whoever \"No handle\" picks", hint: "One per line: @handle | text | picture | outcome. Only the text is needed. @random: a random citizen. A handle nobody has yet becomes a new citizen. Picture: a server path (as the file browser shows it) or an https:// link; leave it empty for none. Outcome: one from Control, or empty for random." },
        {
          name: "fallback", label: "No handle posts as", type: "select", value: "@random",
          options: [{ value: "@random", label: "A random citizen" }, ...(as ? [{ value: as.id, label: `${as.handle} (the composer's "As")` }] : [])]
        },
        { name: "every", label: "Every (in-game minutes)", type: "number", value: 5 },
        { name: "jitter", label: "Give or take (in-game minutes)", type: "number", value: 2 }
      ]
    });
    if (result?.lines) store.request("garden-drip", { lines: result.lines, accountId: result.fallback, every: result.every, jitter: result.jitter });
  },
  "garden-pin"({ accountId }) {
    const a = store.garden.accounts[accountId];
    if (a) store.request("garden-account", { account: { id: accountId, pinned: !a.pinned } });
  },
  /** GM: write as this account (the Feed, with "As" set to it). */
  "garden-post-as"({ accountId }) {
    this.gardenAs = accountId;
    this.gardenTab = store.garden.accounts[accountId]?.kind === "news" && !gardenConfig().mergeNews ? "news" : "feed";
    this.render();
  },
  /** Players: open a conversation with an account's owner (BabelChat), or ask the GM for the number. */
  "garden-message"({ accountId }) {
    const a = store.garden.accounts[accountId];
    const ctx = this.context();
    if (!a || ctx?.perspective !== "pc") return;
    const pc = a.actorId ? game.actors.get(a.actorId) : null;
    this._messageContact(ctx, pc ? pc.name : a.npc, pc?.id);
  },
  /** Player: open the conversation with a match. */
  "dating-message"({ sparkId }) {
    const ctx = this.context();
    const name = matchContact(store.garden.dating.sparks[sparkId]);
    if (name && ctx?.perspective === "pc") this._messageContact(ctx, name);
  },
  "dating-unmatch"({ sparkId }) {
    const spark = store.garden.dating.sparks[sparkId];
    const name = matchContact(spark);
    if (!spark) return;
    Dialog.confirm({
      title: "Delete match",
      content: `<p>Delete your match with ${esc(store.garden.dating.profiles[spark.profileId]?.name ?? "them")}? ${name ? `${esc(name)} is removed from your contacts.` : ""}</p>`,
      yes: () => store.request("dating-unmatch", { actorId: this.context()?.actorId, sparkId }),
      defaultYes: false
    });
  },
  "dating-algorithm"() {
    store.request("dating-algorithm", { actorId: this.context()?.actorId });
  },
  "dating-respond"({ sparkId, spark }) {
    store.request("dating-respond", { actorId: this.context()?.actorId, sparkId, spark: spark === "true" });
  },
  /** GM: who the Algorithm finds for a character. */
  async "dating-suggest"({ sparkId }) {
    const spark = store.garden.dating.sparks[sparkId];
    if (!spark) return;
    const seen = new Set(Object.values(store.garden.dating.sparks).filter(s => s.actorId === spark.actorId && s.profileId).map(s => s.profileId));
    const options = Object.values(store.garden.dating.profiles).filter(p => !p.actorId && !seen.has(p.id))
      .map(p => ({ value: p.id, label: `${p.name}, ${p.age} (${p.handle})${p.npc ? ` · ${p.npc}` : ""}` }));
    const result = await fieldsDialog({
      title: `The Algorithm: ${displayName(game.actors.get(spark.actorId))}`,
      label: "Suggest",
      fields: [{ name: "profileId", label: "Finds", type: "select", options: [...options, { value: "", label: "No one this time" }] }],
      note: "The player sees the profile and decides if there's a spark. A spark is a match."
    });
    if (result) store.request("dating-suggest", { sparkId, profileId: result.profileId });
  },
  /* ---------------- GM: Control (outcome types and word lists) ---------------- */
  async "garden-tier-edit"({ tier }) {
    const tiers = gardenTiers();
    const t = tiers[tier] ?? { name: "", reach: 1, replies: [2, 5], peak: 5, weight: 1 };
    const result = await fieldsDialog({
      title: tier ? `Outcome: ${t.name}` : "New outcome",
      fields: [
        { name: "name", label: "Name", value: t.name, placeholder: "Trending" },
        { name: "reach", label: "Reach (× followers)", type: "number", step: "0.01", value: t.reach, hint: "0.2 = a fifth of the author's followers see it; 6 = it spreads far past them." },
        { name: "min", label: "Fewest replies", type: "number", value: t.replies[0] },
        { name: "max", label: "Most replies", type: "number", value: t.replies[1] },
        { name: "peak", label: "Halfway after (minutes)", type: "number", step: "0.5", value: t.peak, hint: `Real minutes, or ${WORLD_PACE}× as many in-game minutes, whichever comes first. It's mostly done by twice this.` },
        { name: "weight", label: "How often at random", type: "number", value: t.weight, hint: "Compared with the others' (0: never picked at random)." }
      ]
    });
    if (!result?.name) return;
    const id = tier || result.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || foundry.utils.randomID();
    const min = Math.max(0, Math.floor(result.min) || 0);
    await saveGardenConfig(c => {
      c.tiers = { ...(c.tiers && Object.keys(c.tiers).length ? c.tiers : DEFAULT_TIERS) };
      c.tiers[id] = {
        name: result.name, reach: Math.max(0, result.reach || 0), replies: [min, Math.max(min, Math.floor(result.max) || 0)],
        peak: Math.max(0.5, result.peak || 5), weight: Math.max(0, result.weight || 0)
      };
    });
    this.render();
  },
  async "garden-tier-delete"({ tier }) {
    const tiers = gardenTiers();
    if (Object.keys(tiers).length <= 1) return ui.notifications.warn("Keep at least one outcome.");
    delete tiers[tier];
    await saveGardenConfig(c => (c.tiers = tiers));
    this.render();
  },
  async "garden-tier-reset"() {
    await saveGardenConfig(c => delete c.tiers);
    this.render();
  },
  /** GM: use your own text file for a word list (pick one, or upload it in the file picker). */
  "garden-list-file"({ list }) {
    const current = gardenConfig().files[list] ?? "";
    new FilePicker({
      type: "text",
      current: current || defaultListPath(list),
      callback: path => saveGardenConfig(c => (c.files = { ...(c.files ?? {}), [list]: path }))
    }).render(true);
  },
  /** GM: back to the module's own file for a word list. */
  "garden-list-reset"({ list }) {
    saveGardenConfig(c => {
      if (c.files) delete c.files[list];
    });
  },
  /** GM: read a word list as it's loaded. */
  "garden-list-view"({ list }) {
    const entries = gardenLists()[list] ?? [];
    new Dialog({
      title: `${LIST_FILES[list][1]} (${entries.length})`,
      content: `<ol class="ctp-list-view">${entries.map(e => `<li>${esc(e)}</li>`).join("")}</ol>`,
      buttons: { ok: { label: "Close" } }
    }).render(true);
  },
  "garden-queue"({ op, id }) {
    store.request("garden-queue", { op, id });
  },
  /** GM: change anything about a queued post: who, text, picture, outcome, when, Reputation event. */
  async "garden-queue-edit"({ id }) {
    const { garden } = store;
    const item = garden.queue.find(q => q.id === id);
    if (!item) return;
    const accounts = Object.values(garden.accounts).filter(a => a.kind !== "pc").sort((a, b) => !!b.pinned - !!a.pinned || a.handle.localeCompare(b.handle));
    const minutes = Math.max(0, Math.round((item.wt - (garden.paused ?? gardenNow())) / 60));
    const result = await fieldsDialog({
      title: "Queued post",
      fields: [
        { name: "accountId", label: "Posted by", type: "select", search: true, value: item.accountId, options: [{ value: "@random", label: "A random citizen" }, ...accounts.map(a => ({ value: a.id, label: `${a.handle} · ${a.name}` }))] },
        { name: "text", label: "Text", type: "textarea", rows: 4, value: item.text },
        { name: "image", label: "Picture", type: "image", value: item.image ?? "", placeholder: "Optional: a server path or https:// link" },
        { name: "tier", label: "Outcome", type: "select", value: item.tier ?? "", options: [{ value: "", label: "Random outcome" }, ...Object.entries(gardenTiers()).map(([value, t]) => ({ value, label: t.name }))] },
        { name: "minutes", label: "Goes out in (in-game minutes)", type: "number", step: "0.5", value: minutes, hint: garden.paused ? "Counted from when you resume the queue." : "" },
        ...repFields(repsOf(item))
      ],
      note: REP_HINT
    });
    if (!result) return;
    if (!result.text && !result.image) return ui.notifications.warn("A post needs text or a picture.");
    const rep = repsFrom(result);
    store.request("garden-queue", {
      op: "edit", id,
      item: { accountId: result.accountId, text: result.text, image: result.image || null, tier: result.tier || null, minutes: result.minutes, rep }
    });
  },
  /* ---------------- Dating ---------------- */
  /** Make a dating profile (its own, or the Garden Patch linked); it's then edited in place. */
  "dating-create"({ link }) {
    store.request("dating-create", { actorId: this.context()?.actorId, link: link === "true", age: 25, prompts: [] });
  },
  async "dating-profile-edit"({ profileId }) {
    const p = store.garden.dating.profiles[profileId] ?? { handle: "", name: "", age: 25, prompts: [], npc: "" };
    const result = await fieldsDialog({
      title: profileId ? `Dating: ${p.handle}` : "New dating profile",
      fields: [
        { name: "handle", label: "Handle", value: p.handle },
        { name: "name", label: "Name", value: p.name },
        { name: "avatar", label: "Picture", type: "image", value: p.avatar ?? "" },
        { name: "age", label: "Age", type: "number", value: p.age },
        { name: "p0", label: "Prompt 1", value: p.prompts[0] ?? "" },
        { name: "p1", label: "Prompt 2", value: p.prompts[1] ?? "" },
        { name: "p2", label: "Prompt 3", value: p.prompts[2] ?? "" },
        { name: "npc", label: "Messages go to", value: p.npc ?? "", placeholder: "An NPC's contact name (optional)", hint: "After a match, the player can Message them: a conversation with that contact (or a request for the number)." }
      ]
    });
    if (result) store.request("dating-profile", { profile: { id: profileId || undefined, ...result, prompts: [result.p0, result.p1, result.p2] } });
  },
  "dating-profile-delete"({ profileId }) {
    store.request("dating-profile-delete", { profileId });
  },
  async "dating-generate"() {
    const result = await fieldsDialog({ title: "Dating profiles", label: "Make them", fields: [{ name: "count", label: "How many", type: "number", value: 5 }] });
    if (result?.count) store.request("dating-generate", { count: result.count, avatars: await pickAvatarFolder() });
  },
  /** GM: text the character as their match, then carry on in Messages acting as them. */
  async "dating-text"({ sparkId }) {
    const spark = store.garden.dating.sparks[sparkId];
    const name = matchContact(spark);
    const pc = game.actors.get(spark?.actorId);
    if (!name || !pc) return;
    const result = await fieldsDialog({
      title: `Text ${displayName(pc)} as ${name}`,
      label: "Send",
      fields: [{ name: "text", label: "Text", type: "textarea", rows: 3, placeholder: "hey. saw your Patch. drinks at Lizzie's?" }]
    });
    if (!result?.text) return;
    store.request("send", { actorId: pc.id, contact: name, text: result.text });
    this.persona = { name, actorId: null };
    this.app = "messages";
    this.view = { kind: "direct", actorId: pc.id, contact: name, hidden: false };
    this.render();
  }
};

export const dropdowns = {
  gardenAs(value) {
    this._keepGardenDraft();
    this.gardenAs = value;
    this.render();
  },
  gardenTier(value) {
    this._keepGardenDraft();
    this.gardenTier = value;
    this.render();
  },
  gardenBoost(value) {
    const [postId, tier] = value.split(":");
    store.request("garden-post-edit", { postId, tier });
  }
};

export const inputs = {
  /** GM (Control): the Garden's pages, e.g. News merged into the Feed, or Dating off. */
  "input[data-garden-setting]": {
    async change(event) {
      const { gardenSetting } = event.currentTarget.dataset;
      const on = event.currentTarget.checked;
      await saveGardenConfig(c => (c[gardenSetting] = on));
      this.render();
    }
  },
  /** The player's dating profile, edited in place: every field is sent together. */
  "input[data-dating-field]": {
    change(event) {
      const box = event.currentTarget.closest(".agent-dating-edit");
      const value = name => box.querySelector(`[data-dating-field="${name}"]`)?.value ?? "";
      store.request("dating-create", { actorId: this.context()?.actorId, age: Number(value("age")), prompts: [value("p0"), value("p1"), value("p2")] });
    }
  },
  "textarea[name=gardenPost]": {
    input(event) {
      this.gardenDraft = event.currentTarget.value;
    }
  },
  "input[name=gardenReply]": {
    input(event) {
      this.gardenReplyDraft = event.currentTarget.value;
    },
    keydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        this.element.find("[data-action=garden-reply]").trigger("click");
      }
    }
  }
};

export const methods = {
  ...writerMethods,
  ...draftsMethods,

  /** Open a conversation with a contact (a player's phone), or offer to ask the GM for the number. */
  _messageContact(ctx, name, actorId = null) {
    if (!name) return;
    const actor = ctx.subject.actor;
    const contacts = getContacts(actor);
    const entry = (actorId && contacts.find(c => c.actorId === actorId)) || findContact(contacts, name);
    if (entry) {
      this.app = "messages";
      this.view = { kind: "direct", actorId: actor.id, contact: entry.name, hidden: false };
      return this.render();
    }
    Dialog.confirm({
      title: "Not in your contacts",
      content: `<p>You don't have ${foundry.utils.escapeHTML?.(name) ?? name}'s number. Ask for it?</p>`,
      yes: () => store.request("contact-request", { actorId: actor.id, name, note: "Found on The Garden" })
    });
  },

  _keepGardenDraft() {
    const el = this.element?.[0]?.querySelector("textarea[name=gardenPost]");
    if (el) this.gardenDraft = el.value;
  },

  _gardenAccountRow(account) {
    if (!account) return { handle: "@deleted", name: "Deleted", initials: "?" };
    return { ...account, initials: initials(account.name), kindName: KINDS[account.kind] };
  },

  _gardenPostRow(post, me, gm) {
    const account = store.garden.accounts[post.accountId];
    return {
      ...post,
      author: this._gardenAccountRow(account),
      ago: gardenAgo(post.wt ?? post.ts / 1000),
      replyCount: post.replies.length,
      liked: !!me && post.likedBy.includes(me.id),
      grafted: !!me && post.graftedBy.includes(me.id),
      repLabel: repLabel(repsOf(post)) || null,
      tierName: gm ? gardenTiers()[post.tier]?.name ?? post.tier : null
    };
  },

  /** A reply: its author, and whether the GM can delete it (anyone's but a character's). */
  _gardenReplyRow(reply, post, gm) {
    const author = this._gardenAccountRow(store.garden.accounts[reply.accountId]);
    return { ...reply, postId: post.id, author, ago: gardenAgo(reply.wt ?? reply.ts / 1000), canDelete: gm && author.kind !== "pc" };
  },

  gardenData(ctx) {
    const gm = ctx.perspective === "gm";
    const garden = store.garden;
    const accounts = Object.values(garden.accounts);
    const me = gm ? null : accounts.find(a => a.actorId === ctx.actorId) ?? null;
    const tabs = gardenTabs(gm);
    if (!(this.gardenTab in tabs)) this.gardenTab = "feed";
    // For the writer only: when this character last opened the Garden (not shown anywhere).
    if (!gm && ctx.actorId && this.online && Date.now() - (seenSent.get(ctx.actorId) ?? 0) > SEEN_EVERY_MS) {
      seenSent.set(ctx.actorId, Date.now());
      store.request("garden-seen", { actorId: ctx.actorId });
    }
    const data = {
      gm,
      bar: appBar("garden", { owner: gm ? null : me?.handle ?? ctx.subject.name }),
      tabs: Object.entries(tabs).map(([id, label]) => ({ id, label, active: id === this.gardenTab })),
      me: me ? this._gardenAccountRow(me) : null,
      canPost: gm || !!me,
      online: this.online
    };
    const posts = Object.values(garden.posts).sort(byNewest);
    // The GM posts and replies as any account but the characters': pinned first, then by handle.
    const asDropdown = title => {
      const options = accounts.filter(a => a.kind !== "pc").sort((a, b) => !!b.pinned - !!a.pinned || a.handle.localeCompare(b.handle));
      if (!garden.accounts[this.gardenAs] || garden.accounts[this.gardenAs].kind === "pc") this.gardenAs = options[0]?.id ?? null;
      return dropdown("gardenAs", options.map(a => ({ value: a.id, label: `${a.pinned ? "★ " : ""}${a.handle} · ${a.name}`, selected: a.id === this.gardenAs })), { title, cls: "agent-wide", search: true });
    };

    // A post and its replies.
    const post = this.gardenPost ? garden.posts[this.gardenPost] : null;
    if (post) {
      data.post = this._gardenPostRow(post, me, gm);
      data.post.replies = post.replies.map(r => this._gardenReplyRow(r, post, gm));
      data.replyDraft = this.gardenReplyDraft ?? "";
      if (gm) data.replyAs = asDropdown("Reply as");
      if (gm) data.post.boost = dropdown("gardenBoost", Object.entries(gardenTiers()).map(([id, t]) => ({ value: `${post.id}:${id}`, label: t.name, selected: id === post.tier })), { title: "How far it travels" });
      return data;
    }
    this.gardenPost = null;

    // A Patch (profile): who they are, and what they've posted.
    const account = this.gardenAccount ? garden.accounts[this.gardenAccount] : null;
    if (account) {
      const actor = account.actorId ? game.actors.get(account.actorId) : null;
      data.patch = {
        ...this._gardenAccountRow(account),
        mine: !!me && me.id === account.id,
        canMessage: commsOn() && !gm && (!me || me.id !== account.id) && (!!account.npc || (!!account.actorId && account.actorId !== ctx.actorId)),
        reputation: actor ? reputationOf(actor) : null,
        repFeed: actor ? reputationFeed(actor) : [],
        // What they posted, and what they grafted (shared) from others.
        posts: posts.filter(p => p.accountId === account.id || p.graftedBy.includes(account.id)).slice(0, 30).map(p => ({
          ...this._gardenPostRow(p, me, gm), graftedHere: p.accountId === account.id ? null : account.handle
        })),
        // Their replies to posts, newest first; each opens the post it answers.
        replies: posts.flatMap(p => p.replies.filter(r => r.accountId === account.id).map(r => ({ r, p })))
          .sort((a, b) => b.r.wt - a.r.wt || b.r.ts - a.r.ts).slice(0, 30)
          .map(({ r, p }) => ({ ...this._gardenReplyRow(r, p, gm), to: this._gardenAccountRow(garden.accounts[p.accountId]).handle, toText: p.text || "(a picture)" })),
        followersLabel: Number(account.followers).toLocaleString()
      };
      return data;
    }
    this.gardenAccount = null;

    const tab = this.gardenTab;
    data.show = { feed: tab === "feed" || tab === "news", dating: tab === "dating", accounts: tab === "accounts", queue: tab === "queue", writer: tab === "writer", drafts: tab === "drafts", control: tab === "control" };
    if (tab === "feed" || tab === "news") {
      const isNews = p => garden.accounts[p.accountId]?.kind === "news";
      const all = gardenConfig().mergeNews;
      data.feed = posts.filter(p => all || (tab === "news" ? isNews(p) : !isNews(p))).slice(0, 60).map(p => this._gardenPostRow(p, me, gm));
      data.draft = this.gardenDraft ?? "";
      data.image = this.gardenImage ?? null;
      if (gm) {
        data.as = asDropdown("Post as");
        data.tier = dropdown("gardenTier", [{ value: "", label: "Random outcome" }, ...Object.entries(gardenTiers()).map(([id, t]) => ({ value: id, label: t.name, selected: id === this.gardenTier }))], { title: "How far it travels" });
        data.rep = this.gardenRep ? repLabel(this.gardenRep) || null : null;
      }
    } else if (tab === "dating") data.dating = gm ? this._datingGm() : this._datingPlayer(ctx, me);
    else if (tab === "accounts") {
      data.accounts = accounts.sort((a, b) => !!b.pinned - !!a.pinned || (a.kind === b.kind ? a.handle.localeCompare(b.handle) : a.kind.localeCompare(b.kind))).map(a => ({
        ...this._gardenAccountRow(a), owner: a.actorId ? displayName(game.actors.get(a.actorId)) : null, followersLabel: Number(a.followers).toLocaleString(),
        attitude: ATTITUDES[a.mood] ?? null, profiled: hasProfile(a.writer)
      }));
    } else if (tab === "writer") data.writer = this._gardenWriterData();
    else if (tab === "drafts") data.drafts = this._gardenDraftsData();
    else if (tab === "queue") {
      const now = gardenNow();
      data.queue = {
        paused: !!garden.paused,
        items: garden.queue.map((q, i, list) => ({
          ...q,
          author: q.draft?.kind === "msg" ? { handle: `Text: ${q.draft.from}`, name: "A private text" } : q.accountId === "@random" ? { handle: "@random", name: "A random citizen" } : this._gardenAccountRow(garden.accounts[q.accountId]),
          outcome: gardenTiers()[q.tier]?.name ?? null,
          inLabel: queueWhen(q.wt, now, garden.paused),
          first: i === 0, last: i === list.length - 1
        }))
      };
    } else if (tab === "control") {
      const { tiers, files, mergeNews, dating } = gardenConfig();
      const lists = gardenLists();
      data.control = {
        mergeNews,
        dating,
        tiers: Object.entries(tiers).map(([id, t]) => ({ id, ...t, summary: tierSummary(t) })),
        lists: Object.entries(LIST_FILES).map(([key, [file, label]]) => ({
          key, label, path: files[key] || null, file: `${file}.txt`, count: (lists[key] ?? []).length,
          sample: (lists[key] ?? []).slice(0, 3).join(" · ")
        }))
      };
    }
    return data;
  },

  _datingPlayer(ctx, me) {
    const { profiles, sparks } = store.garden.dating;
    const mine = Object.values(profiles).find(p => p.actorId === ctx.actorId) ?? null;
    const matches = Object.values(sparks).filter(s => s.actorId === ctx.actorId && MATCHED.includes(s.status));
    const suggested = Object.values(sparks).find(s => s.actorId === ctx.actorId && s.status === "suggested" && profiles[s.profileId]);
    return {
      mine: mine ? { ...mine, initials: initials(mine.name) } : null,
      canLink: !!me,
      searching: Object.values(sparks).some(s => s.actorId === ctx.actorId && s.status === "searching"),
      // Someone the Algorithm found (the GM picked): Spark and it's a match.
      found: suggested ? { ...profiles[suggested.profileId], sparkId: suggested.id, initials: initials(profiles[suggested.profileId].name) } : null,
      openLabel: `Open ${appearance().names.messages}`,
      matches: matches.map(s => {
        const p = profiles[s.profileId];
        return { ...s, profileId: p?.id, handle: p?.handle, name: p?.name, avatar: p?.avatar, initials: initials(p?.name), canMessage: commsOn() && !!matchContact(s) };
      })
    };
  },

  _datingGm() {
    const { profiles, sparks } = store.garden.dating;
    const row = s => {
      const p = profiles[s.profileId];
      return {
        ...s, who: displayName(game.actors.get(s.actorId)), handle: p?.handle, name: p?.name, contact: matchContact(s)
      };
    };
    const list = Object.values(sparks).sort((a, b) => b.ts - a.ts);
    return {
      comms: commsOn(), // "Text them" and "In Messages as" while Communications are on
      searching: list.filter(s => s.status === "searching").map(row),
      matches: list.filter(s => MATCHED.includes(s.status)).map(row),
      profiles: Object.values(profiles).map(p => ({
        ...p, initials: initials(p.name), player: p.actorId ? displayName(game.actors.get(p.actorId)) : null
      })).sort((a, b) => !!a.player - !!b.player || a.handle.localeCompare(b.handle))
    };
  }
};

export const phone = {
  /** Tapping the Garden again: back to the feed. */
  retap(app) {
    if (app === "garden") this.gardenPost = this.gardenAccount = null;
  }
};

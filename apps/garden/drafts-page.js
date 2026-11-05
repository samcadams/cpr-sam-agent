import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { store } from "../../scripts/store.js";
import { gardenNow, gardenTiers, gardenWhen, spanLabel } from "./model.js";
import { batchMix, RINGS } from "./drafts.js";
import { dataFolder } from "../../scripts/config.js";
import { INBOX, PACK_FILE } from "./pack.js";
import { parseSpan, spanText } from "./writer.js";

/*
 * Phone page, GM: the Garden's Drafts tab (apps/garden/drafts-host.js): batches from the
 * garden-writer skill, grouped by in-game day, with each batch's mix; include or cut each draft,
 * edit it, approve, discard, or leave a note for the writer. What the GM changes stays on this
 * client until Approve (this._draftEdits). Merged into the Garden's page (page.js).
 */

const KIND = {
  post: { icon: "fa-seedling", name: "Post" },
  reply: { icon: "fa-reply", name: "Reply" },
  msg: { icon: "fa-envelope", name: "Private text" },
  dating: { icon: "fa-heart", name: "Dating profile" },
  account: { icon: "fa-user-plus", name: "Account" },
  format: { icon: "fa-repeat", name: "Recurring post" },
  profile: { icon: "fa-feather", name: "Profile" },
  stage: { icon: "fa-forward", name: "Stage" },
  chatter: { icon: "fa-comments", name: "Crowd chatter" }
};

/** Re-read the pack's `written` at most this often (real ms) while the Drafts tab is drawn. */
const PACK_CHECK = 20_000;
const packPath = () => `${dataFolder()}/${PACK_FILE}`;

/**
 * When the writer pack was last saved (its `written`), read from the file itself (whoever hosts
 * writes it); the tab redraws when that changes. { written: ms|null, checked: ms, missing }
 */
async function readPackInfo(page, force = false) {
  const info = (page._packInfo ??= { written: null, checked: 0, missing: false });
  if (info.busy || (!force && Date.now() - info.checked < PACK_CHECK)) return;
  info.busy = true;
  info.checked = Date.now();
  let written = null;
  let missing = false;
  try {
    const response = await fetch(`${foundry.utils.getRoute(packPath())}?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) written = Date.parse((await response.json())?.written) || null;
    else missing = response.status === 404;
  } catch {
    written = info.written;
  }
  info.busy = false;
  if (written !== info.written || missing !== info.missing) {
    Object.assign(info, { written, missing });
    page.render();
  }
}

const show = v => (Array.isArray(v) ? v.join(", ") : v && typeof v === "object" ? (v.what ?? `${v.who} · ${v.kind}${v.note ? ` · ${v.note}` : ""}`) : String(v ?? ""));

/** A batch's drafts with the GM's changes on top (this client only, until Approve). */
function withEdits(batch, edits = {}) {
  return batch.items.map(item => ({ ...item, ...(edits[item.key] ?? {}) }));
}

export const actions = {
  /** Include or cut one draft. */
  "garden-draft-toggle"({ batch, key }) {
    const b = store.garden.drafts?.batches?.[batch];
    const item = b?.items.find(i => i.key === key);
    if (!item) return;
    const edits = ((this._draftEdits ??= {})[batch] ??= {});
    const now = edits[key]?.include ?? item.include;
    edits[key] = { ...(edits[key] ?? {}), include: !now };
    this.render();
  },
  /** Include or cut every draft of a batch. */
  "garden-draft-all"({ batch, on }) {
    const b = store.garden.drafts?.batches?.[batch];
    if (!b) return;
    const edits = ((this._draftEdits ??= {})[batch] ??= {});
    for (const item of b.items) edits[item.key] = { ...(edits[item.key] ?? {}), include: on === "true" };
    this.render();
  },
  /** Edit one draft's text, time and outcome. */
  async "garden-draft-edit"({ batch, key }) {
    const b = store.garden.drafts?.batches?.[batch];
    const original = b?.items.find(i => i.key === key);
    if (!original) return;
    const edits = ((this._draftEdits ??= {})[batch] ??= {});
    const item = { ...original, ...(edits[key] ?? {}) };
    const now = gardenNow();
    const timed = Number.isFinite(item.wt) && ["post", "reply", "msg"].includes(item.kind);
    const fields = [{ name: "text", label: "Text", type: "textarea", rows: 4, value: item.text }];
    if (timed) fields.push({ name: "when", label: "When (from Garden now)", value: spanText(item.wt - now), hint: `In-game: +3h, +1d2h; -2h or +0m goes out at once, backdated. Now: ${gardenWhen(now, now)}.` });
    if (item.kind === "post") fields.push({ name: "tier", label: "Outcome", type: "select", value: item.tier ?? "", options: [{ value: "", label: "Random outcome" }, ...Object.entries(gardenTiers()).map(([value, t]) => ({ value, label: t.name }))] });
    const result = await fieldsDialog({ title: `${KIND[item.kind].name}: ${item.handle ? `@${item.handle}` : item.from ?? ""}`, fields });
    if (!result) return;
    const change = { ...(edits[key] ?? {}), text: result.text };
    if (timed) {
      const span = parseSpan(result.when);
      if (span === null) ui.notifications.warn(`"${result.when}" isn't a time from now (like +3h or -2h); the time is unchanged.`);
      else change.wt = now + span;
    }
    if (item.kind === "post") change.tier = result.tier || null;
    edits[key] = change;
    this.render();
  },
  "garden-drafts-approve"({ batch }) {
    const b = store.garden.drafts?.batches?.[batch];
    if (!b) return;
    const edits = this._draftEdits?.[batch] ?? {};
    const items = b.items.map(i => ({ key: i.key, ...(edits[i.key] ?? {}) }));
    const approved = items.filter(i => i.include ?? b.items.find(x => x.key === i.key).include).length;
    if (!store.request("garden-drafts-approve", { batchId: batch, items })) return;
    delete this._draftEdits?.[batch];
    ui.notifications.info(`Garden drafts: ${approved} approved; whatever's due goes out now, backdated.`);
  },
  "garden-drafts-discard"({ batch }) {
    Dialog.confirm({
      title: "Garden drafts",
      content: "<p>Throw this batch away? Nothing from it goes out. The writer sees it was discarded.</p>",
      yes: () => {
        delete this._draftEdits?.[batch];
        store.request("garden-drafts-discard", { batchId: batch });
      },
      defaultYes: false
    });
  },
  async "garden-drafts-note"({ batch }) {
    const b = store.garden.drafts?.batches?.[batch];
    const result = await fieldsDialog({
      title: "Note for the writer",
      fields: [{ name: "text", label: "Note", type: "textarea", rows: 4, value: b?.feedback ?? "", placeholder: "less Roach, more Raven; no posts about Jun's family" }],
      note: "Saved next to the batch in the inbox; the garden-writer skill reads it on its next run."
    });
    if (result?.text?.trim()) {
      if (store.request("garden-drafts-feedback", { batchId: batch, text: result.text })) ui.notifications.info("Note saved for the writer.");
    }
  },
  /** Save the writer pack now (it's also saved by itself when the Garden changes). */
  "garden-pack"() {
    if (!store.request("garden-pack", {})) return;
    ui.notifications.info("Writer pack saved for the garden-writer skill.");
    // The host writes it in a moment; read its time again then.
    setTimeout(() => readPackInfo(this, true), 2500);
  }
};

export const methods = {
  /** The Drafts tab's data. */
  _gardenDraftsData() {
    const g = store.garden;
    const now = gardenNow();
    const drafts = g.drafts ?? {};
    const handle = id => (id === "@random" ? "@random" : g.accounts[id]?.handle ?? null);
    const before = item => {
      if (item.kind === "account") return item.before ? `${item.before.name} · ${item.before.kind}${item.before.bio ? ` · ${item.before.bio}` : ""}` : null;
      if (item.kind !== "profile") return null;
      if (item.actorId) return show(g.writer?.pcs?.[item.actorId]?.[item.field]);
      const a = g.accounts[item.accountId];
      if (["face", "assets", "tier"].includes(item.field)) return show(a?.corp?.[item.field]);
      if (item.field === "relation") return `${a?.corp?.relations?.length ?? 0} relation(s)`;
      if (item.field === "calendar") return `${a?.corp?.calendar?.length ?? 0} item(s)`;
      return show(a?.writer?.[item.field]);
    };
    const batches = Object.values(drafts.batches ?? {}).sort((a, b) => a.ts - b.ts).map(batch => {
      const items = withEdits(batch, this._draftEdits?.[batch.id]);
      const days = new Map();
      for (const item of items) {
        const timed = Number.isFinite(item.wt);
        const day = timed ? gardenWhen(item.wt, now).replace(/, \d\d?:\d\d.*$/, "") : item.kind === "chatter" ? "Crowd chatter (this week's auto-replies)" : "Now";
        const row = {
          ...item,
          batch: batch.id,
          kindIcon: KIND[item.kind].icon,
          kindName: KIND[item.kind].name,
          private: item.kind === "msg",
          author: item.kind === "post" || item.kind === "reply" ? (handle(item.accountId) ?? `@${item.newHandle}`) : item.kind === "msg" ? `${item.from} → ${item.to.join(", ")}`
            : item.kind === "account" || item.kind === "format" ? `@${item.handle}` : item.kind === "chatter" ? `${item.mood ?? "any"} crowd${item.keywords.length ? ` · on ${item.keywords.join(", ")}` : ""}`
            : item.who ?? (item.kind === "stage" ? `${item.what} ${item.id}` : ""),
          isNew: (!!item.newHandle && item.newHandle !== "random" && !item.madeHere) || (item.kind === "account" && !item.accountId),
          when: timed ? (item.wt <= now ? `${gardenWhen(item.wt, now)} · goes out now, backdated` : `${gardenWhen(item.wt, now)} · in ${spanLabel(item.wt - now)}`) : null,
          ringName: RINGS[item.ring] ?? null,
          tierName: item.tier ? gardenTiers()[item.tier]?.name ?? item.tier : null,
          replyTo: item.kind === "reply" ? (item.to.postId ? `post ${item.to.postId}` : `${batch.items.find(i => i.key === item.to.key)?.label ?? "the post above"}`) : null,
          body: item.kind === "dating" ? `${item.age} · ${item.prompts.join(" · ")}` : item.kind === "profile" ? `${item.field}: ${show(item.value)}`
            : item.kind === "account" ? `${item.name} · ${item.accountKind}${item.bio ? ` · ${item.bio}` : ""}` : item.kind === "format" ? `${item.when}: ${item.what}` : item.kind === "stage" ? `→ ${item.stage}${item.progress ? ` (${item.progress})` : ""}` : item.text,
          before: before(item),
          repNames: (item.rep ?? []).map(r => `${r.who} ${r.delta >= 0 ? "+" : ""}${r.delta}`).join(", "),
          editable: ["post", "reply", "msg", "chatter"].includes(item.kind),
          edited: !!this._draftEdits?.[batch.id]?.[item.key]?.text
        };
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(row);
      }
      const mix = batchMix(items.filter(i => i.include));
      const pct = n => (mix.total ? Math.round((n * 100) / mix.total) : 0);
      return {
        ...batch,
        baseLabel: Number.isFinite(batch.base) ? gardenWhen(batch.base, now) : null,
        broken: batch.errors.length > 0,
        included: items.filter(i => i.include).length,
        mix: [
          { ring: "city", name: RINGS.city, n: mix.city, pct: pct(mix.city) },
          { ring: "close", name: RINGS.close, n: mix.close, pct: pct(mix.close) },
          { ring: "about", name: RINGS.about, n: mix.about, pct: pct(mix.about) },
          { ring: "none", name: "Unlabelled", n: mix.none, pct: pct(mix.none) }
        ].filter(m => m.n),
        days: [...days].map(([label, rows]) => ({ label, rows }))
      };
    });
    const reviews = (drafts.reviews ?? []).slice(-3).reverse().map(r => ({ ...r, when: new Date(r.ts).toLocaleString() }));
    readPackInfo(this);
    const info = this._packInfo ?? {};
    const pack = {
      path: packPath(),
      written: info.written ? `${Date.now() - info.written < 60_000 ? "just now" : `${spanLabel((Date.now() - info.written) / 1000)} ago`} (${new Date(info.written).toLocaleString()})` : null,
      missing: !!info.missing
    };
    return { batches, reviews, pack, inbox: `worlds/${game.world.id}/cpr-sam-agent/${INBOX}/`, target: g.writer?.mix ?? null };
  }
};

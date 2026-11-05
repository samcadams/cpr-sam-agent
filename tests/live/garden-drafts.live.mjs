/*
 * The Garden's drafts (apps/garden/drafts-host.js, drafts-page.js): a garden-drafts v1 batch written
 * into the world's inbox over the server's folder (as the garden-writer skill does) shows up in the
 * GM's Drafts tab; approving it sends what's due at once, backdated (a post, its reply, a private
 * text), queues the rest, and the writer pack is saved. GM-only (the active GM's host).
 */

import fs from "node:fs";
import { check, same, test } from "./lib.mjs";

/** Data/worlds/, next to Data/modules/ (this file is Data/modules/cpr-sam-agent/tests/live/). */
const WORLDS = new URL("../../../../worlds/", import.meta.url);

test("a batch in the inbox shows in the Drafts tab; approving sends what's due, backdated", async ({ gm, pc, tag }) => {
  const setup = await gm.run(async () => {
    const m = await import("/modules/cpr-sam-agent/apps/garden/model.js");
    return { world: game.world.id, base: Math.floor(m.gardenNow()) };
  });
  const id = `live-${tag}`.replace(/[^\w.-]/g, "_");
  const dir = new URL(`${setup.world}/cpr-sam-agent/garden/inbox/`, WORLDS);
  fs.mkdirSync(dir, { recursive: true });
  const batch = [
    "garden-drafts v1",
    `batch: ${id}  world: ${setup.world}`,
    `base: ${setup.base}  # live test`,
    "",
    `[due] @${tag.toLowerCase()}_mae | -2h | normal | city | ${tag} Claws came by for tea again`,
    `  > @${tag.toLowerCase()}_ghost | -1h50m | ${tag} they're mapping the block`,
    `[later] @network54 | +5h | close | hook | ${tag} later headline`,
    `[cut] @network54 | +1h | ${tag} this one gets cut`,
    `msg: ${tag} Roach -> ${pc.shown} | -1h | ${tag} HEY. JOB AT THE DOCKS. 明天.`,
    `dating: ${tag} Ines | 29 | Medtech, nights | Buy me coffee at 6am`,
    `chatter: any | ${tag.toLowerCase()} | ${tag} anyone else hear that?`,
    "# note: live test batch"
  ].join("\n");
  // Like the skill: a temp file, then a rename, so Foundry never reads half a file.
  fs.writeFileSync(new URL(`${id}.txt.tmp`, dir), batch);
  fs.renameSync(new URL(`${id}.txt.tmp`, dir), new URL(`${id}.txt`, dir));

  const out = await gm.run(async a => {
    // The tick reads the inbox every 30 s; don't wait for it.
    await store._enqueue(() => store._tickGarden());
    const b = await until(() => store.garden.drafts?.batches?.[a.id], "the batch at the host", 15000);
    const p = await go("garden");
    p.gardenTab = "drafts";
    p.render();
    await until(() => el(".agent-garden-drafts .agent-garden-draft"), "the Drafts tab");
    const r = {
      summary: b.summary, errors: b.errors, notes: b.notes,
      tabLabel: text('[data-action="garden-tab"][data-tab="drafts"]'),
      rows: els(".agent-garden-drafts .agent-garden-draft").length,
      mix: text(".agent-garden-mix"),
      private: !!el(".agent-garden-badge.private"), hook: !!el(".agent-garden-badge.hook"),
      chatterRow: !!els(".agent-garden-draft").find(d => d.textContent.includes(`${a.tag} anyone else hear that?`))
    };
    // Cut one, then approve.
    const cut = b.items.find(i => i.label === "cut");
    await tap(`[data-action="garden-draft-toggle"][data-key="${cut.key}"]`);
    await until(() => el(`.agent-garden-draft.faded[data-key="${cut.key}"]`), "the cut draft faded");
    r.shotReady = true;
    return r;
  }, { id, tag });
  same(out.errors, [], "the batch reads without errors");
  same(out.summary, "3 posts, 1 reply, 1 text, 1 dating profile, 1 chatter line", "summary");
  same(out.notes, ["live test batch"], "the writer's note is shown");
  check(/Drafts \(\d+\)/.test(out.tabLabel ?? ""), `the tab counts waiting batches: "${out.tabLabel}"`);
  same(out.rows, 7, "every draft is listed");
  check(out.chatterRow, "the chatter line is listed");
  check(/City/.test(out.mix ?? "") && /Close to home/.test(out.mix ?? ""), `the mix bar: "${out.mix}"`);
  check(out.private && out.hook, "private and hook badges");
  await gm.shot("garden-drafts-tab");

  const done = await gm.run(async a => {
    await tap(`[data-action="garden-drafts-approve"][data-batch="${a.id}"]`);
    await until(() => !store.garden.drafts.batches[a.id], "the batch approved", 15000);
    const post = await until(() => Object.values(store.garden.posts).find(p => p.text === `${a.tag} Claws came by for tea again`), "the due post", 15000);
    const reply = post.replies.find(r => r.text === `${a.tag} they're mapping the block`);
    const thread = store.findThread(a.pc.id, `${a.tag} Roach`);
    return {
      postAge: a.base - post.wt, replyAge: reply ? a.base - reply.wt : null,
      queued: store.garden.queue.filter(q => q.text?.startsWith(a.tag)).map(q => q.text),
      cutOut: Object.values(store.garden.posts).some(p => p.text === `${a.tag} this one gets cut`),
      text: thread?.messages.at(-1)?.text ?? null,
      dating: Object.values(store.garden.dating.profiles).some(p => p.name === `${a.tag} Ines` && p.age === 29),
      chatter: (store.garden.chatter ?? []).filter(c => c.text.startsWith(a.tag)).map(c => [c.mood, c.keywords, c.until - a.base]),
      review: store.garden.drafts.reviews.at(-1)
    };
  }, { id, tag, pc, base: setup.base });
  check(Math.abs(done.postAge - 7200) < 120, `the due post is dated 2h back (${done.postAge}s)`);
  check(done.replyAge !== null && Math.abs(done.replyAge - 6600) < 120, `its reply is attached, dated 1h50m back (${done.replyAge}s)`);
  same(done.queued, [`${tag} later headline`], "the later post waits in the queue; the cut one doesn't");
  same(done.cutOut, false, "the cut post never went out");
  same(done.text, `${tag} HEY. JOB AT THE DOCKS. 明天.`, "the private text reached the character");
  same(done.dating, true, "the Dating profile was made");
  same(done.chatter, [[null, [tag.toLowerCase()], 7 * 86400]], "the chatter joined the crowd's pool for the batch's week");
  same([done.review.batch, done.review.approved, done.review.cut], [id, 6, 1], "the review is remembered for the writer");

  const pack = await gm.run(async a => {
    await store._enqueue(() => store._writePack());
    const r = await fetch(`/worlds/${a.world}/cpr-sam-agent/garden/writer-pack.json?t=${Date.now()}`, { cache: "no-store" });
    const p = await r.json();
    return { format: p.format, world: p.world, review: p.drafts.reviews.at(-1)?.batch, queued: p.queue.items.some(q => q.text.includes("later headline")) };
  }, { world: setup.world });
  same([pack.format, pack.world, pack.review, pack.queued], ["garden-writer-pack v1", setup.world, id, true], "the writer pack has the world, the review and the queue");
  check(fs.existsSync(new URL(`${setup.world}/cpr-sam-agent/garden/writer-pack.md`, WORLDS)), "writer-pack.md is next to it, for the GM");
}, { player: false });

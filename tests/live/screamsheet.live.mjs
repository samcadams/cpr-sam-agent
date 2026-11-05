/*
 * DataPool (id "screamsheet"): the GM writes a clipping in the desk's editor and publishes it; the player's
 * Front Page and My Crawl get it (with the badge), and the reader opens it page sized. A crew clipping
 * about a crewmate reaches the player through the crew's name, while drafts, buried clippings and the GM's
 * fields stay off their phone. My Crawl's "Look for something" adds a term or an alias, a tap drops it. A deep crawl
 * ("Send your Agent digging deeper") is the sheet's Library Search; the GM confirms what it finds. The reader's
 * "Send to…" opens a contact's conversation with the clipping typed in.
 * A Reputation event on a sheet becomes a suggested clipping on the desk. Claude drafts and redrafts on the desk
 * (Anthropic's API stubbed in the page: no key, no cost).
 */

import { check, same, test } from "./lib.mjs";

/**
 * DataPool on (and installed), and a crewmate the player doesn't own (another lane's player owns it, so
 * it's a player character the player can't see through), in a crew HQ with the lane's character.
 */
const ready = (gm, pc, prefix) => gm.run(async a => {
  if (!api.feature("app_screamsheet")) await api.setFeature("app_screamsheet", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "screamsheet")) await api.pool.grant({ actor: a.pc.id, app: "screamsheet" });
  const lane = Number(a.prefix.match(/\d+/)[0]);
  const owner = game.users.getName(`ClaudePlayer${(lane % 5) + 1}`);
  const name = `${a.prefix}Crewmate`;
  let mate = game.actors.getName(name);
  if (!mate) {
    mate = await Actor.create({ name, type: "character", ownership: { default: 0, [owner.id]: 3 } });
    await mate.createEmbeddedDocuments("Item", [{ name: "Agent", type: "gear", system: { equipped: "carried" } }]);
  }
  const hq = game.modules.get("cpr-hq")?.active ? game.modules.get("cpr-hq").api : null;
  if (hq) {
    let entry = game.journal.getName(`${a.prefix}Kiosk`);
    entry ??= await hq.createHQ({ name: `${a.prefix}Kiosk` });
    const crew = [game.actors.get(a.pc.id), mate].map(x => ({ uuid: x.uuid, tenant: false, teamMember: false, sponsor: "" }));
    await hq.updateHQ(entry, { crew });
  }
  return { mate: mate.id, crew: hq ? `${a.prefix}Kiosk` : null };
}, { pc, prefix });

/** The player's phone on DataPool, on a tab. */
const open = (pl, tab) => pl.run(async a => {
  const p = await go("screamsheet");
  if (p.screamTab !== a.tab) await tap(`[data-action="scream-tab"][data-tab="${a.tab}"]`);
  await until(() => el(`.agent-tab.active[data-tab="${a.tab}"]`), `the ${a.tab} tab`);
}, { tab });

test("the desk's editor publishes a clipping: Front Page, My Crawl with the badge, the reader page sized", async ({ gm, pl, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  const headline = `${tag} gang war at the Kiosk`;
  await gm.run(async a => {
    await go("screamsheet");
    await tap('[data-action="scream-write"]');
    const w = await until(() => document.querySelector("[id^=agent-scream-editor]"), "the editor");
    const set = (sel, v) => {
      const f = w.querySelector(sel);
      f.value = v;
      f.dispatchEvent(new Event("input", { bubbles: true }));
      f.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set('[data-path="sheet.blocks.0.text"]', a.headline);
    set('[data-path="sheet.blocks.2.text"]', `${a.name} was seen leaving.`);
    set("[data-outlet]", "street");
    await until(() => w.querySelector(".ss-mast-tabloid"), "the street sheet's masthead in the preview");
    w.querySelector("[data-ed=publish]").click();
    await until(() => !document.querySelector("[id^=agent-scream-editor]"), "the editor to close");
  }, { headline, name: pc.name });
  await open(pl, "front");
  const front = await pl.run(async a => until(() => els(".agent-scream-row .agent-scream-head").map(h => h.textContent).find(t => t.includes(a.headline)), "the headline on the Front Page"), { headline });
  check(front, "the Front Page shows the new headline");
  await open(pl, "crawl");
  const seen = await pl.run(async a => {
    const row = await until(() => els(".agent-scream-row.unread").find(r => r.textContent.includes(a.headline)), "the unread clipping on My Crawl");
    const badge = Number(el('.agent-tab[data-tab="crawl"] .agent-tab-count')?.textContent) || 0;
    hit(row);
    const w = await until(() => document.getElementById(`agent-scream-reader-${row.dataset.id}`), "the reader");
    const out = { badge, wide: w.offsetWidth, layout: !!w.querySelector(".ss-layout-tabloid"), clock: w.querySelector(".ss-clock")?.textContent.trim() };
    await until(() => !els(".agent-scream-row.unread").some(r => r.textContent.includes(a.headline)), "the clipping marked read");
    w.querySelector(".header-button.close")?.click();
    return out;
  }, { headline });
  check(seen.badge >= 1, "My Crawl counts the unread clipping");
  check(seen.wide >= 700 && seen.layout, `the reader is page sized with the outlet's masthead (${seen.wide}px)`);
  check(!!seen.clock, "the masthead's clock shows when it went out");
});

test("a crewmate's clipping reaches the player through the crew; drafts, buried items and GM fields don't", async ({ gm, pl, pc, tag, prefix }) => {
    const { mate, crew } = await ready(gm, pc, prefix);
  if (!crew) return; // CPR HQ isn't on in this world
  const ids = await gm.run(async a => ({
    crew: await api.screamsheet.publish({ headline: `${a.tag} who is the new face?`, subjects: [a.mate], reach: "subjects", title: "gm title", outlet: "board" }),
    buried: await api.screamsheet.publish({ headline: `${a.tag} buried`, body: `${a.name} again`, dv: 15 }),
    draft: await api.screamsheet.publish({ headline: `${a.tag} draft`, body: a.name, draft: true })
  }), { tag, mate, name: pc.name });
  const seen = await pl.run(async a => {
    await until(() => store.apps.screamClips?.[a.ids.crew], "the crew clipping on the player's phone");
    const c = store.apps.screamClips[a.ids.crew];
    return { pulled: c.actorIds.includes(a.pc), gm: ["title", "source", "notes"].filter(k => k in c), buried: !!store.apps.screamClips[a.ids.buried], draft: !!store.apps.screamClips[a.ids.draft] };
  }, { ids, pc: pc.id });
  same(seen, { pulled: true, gm: [], buried: false, draft: false }, "the player has the crew clipping, without the GM's fields, and nothing else");
});

test("a deep crawl: the sheet's Library Search, the GM confirms, the player gets what it found", async ({ gm, pl, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  const id = await gm.run(async a => {
    const id = await api.screamsheet.publish({ headline: `${a.tag} scrubbed`, body: `${a.name} paid somebody off.`, dv: 13 });
    // An earlier run's crawl still waiting: confirm it empty first.
    if (store.apps.screamCrawls?.[a.pc]?.deep?.status === "review") store.request("scream-resolve", { actorId: a.pc, clipIds: [] });
    await until(() => store.apps.screamCrawls?.[a.pc]?.deep?.status !== "review", "no crawl waiting");
    return id;
  }, { tag, name: pc.name, pc: pc.id });
  await open(pl, "crawl");
  const ui = await pl.run(async () => {
    const dig = await until(() => el('[data-action="scream-deep"]'), "the dig button on My Crawl");
    return { watch: !!el('.agent-tab[data-tab="watch"]'), dig: dig.textContent.trim(), time: !!el(".agent-scream .agent-dropdown") };
  });
  same(ui, { watch: false, dig: "Send your Agent digging deeper", time: false }, "no Watchlist tab; the dig button on My Crawl, no time to pick");
  await pl.run(async () => {
    await tap('[data-action="scream-deep"]');
    const d = await dialog("Library Search");
    await press(d, "Confirm");
    await until(() => el(".agent-scream-digging"), "Your Agent is digging…", 15000);
  });
  const desk = await gm.run(async a => {
    await go("screamsheet");
    const card = await until(() => els(".agent-scream-deep").find(c => c.querySelector(`[data-actor="${a.pc}"]`)), "the deep crawl on the desk", 10000);
    const found = [...card.querySelectorAll("input[data-scream-found]")].map(i => i.value);
    const total = store.apps.screamCrawls[a.pc].deep.total;
    // Whatever the roll reached, the GM adds this one ("you also find…").
    if (!found.includes(a.id)) await choose("screamExtra", `${a.pc}|${a.id}`);
    await tap(`[data-action="scream-resolve"][data-actor="${a.pc}"]`);
    await until(() => store.apps.screamCrawls[a.pc].deep.status === "done", "the crawl confirmed");
    return { total, reached: found.includes(a.id) };
  }, { pc: pc.id, id });
  check(desk.reached === desk.total >= 13, `a roll of ${desk.total} ${desk.reached ? "reached" : "missed"} DV 13`);
  const got = await pl.run(async a => until(() => store.apps.screamClips?.[a.id]?.actorIds?.includes(a.pc), "the clipping on the player's phone"), { id, pc: pc.id });
  check(got, "the confirmed clipping reaches the player");
});

test("My Crawl: Look for something adds a term or an alias, a tap drops it", async ({ gm, pl, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  await open(pl, "crawl");
  const out = await pl.run(async a => {
    const chip = t => els(".agent-scream-chip").find(c => c.dataset.term === t);
    const look = async (term, kind) => {
      await tap('[data-action="scream-look"]');
      const d = await dialog("look for something");
      inDialog(d, "[name=term]", term);
      inDialog(d, "[name=kind]", kind);
      await press(d, "Watch for it");
      return until(() => chip(term), `the ${term} chip`);
    };
    const term = await look(`${a.tag} Tyger Claws`, "extra");
    const alias = await look(`${a.tag}Ghost`, "alias");
    const row = () => store.apps.screamCrawls[a.pc];
    const saved = { extra: row().extra.includes(`${a.tag} Tyger Claws`), alias: row().aliases.includes(`${a.tag}Ghost`), removable: [term, alias].every(c => c.dataset.auto === "false") };
    hit(chip(`${a.tag}Ghost`));
    await until(() => !chip(`${a.tag}Ghost`) && !row().aliases.includes(`${a.tag}Ghost`), "the alias dropped");
    hit(chip(`${a.tag} Tyger Claws`));
    await until(() => !chip(`${a.tag} Tyger Claws`), "the term dropped");
    return saved;
  }, { tag, pc: pc.id });
  same(out, { extra: true, alias: true, removable: true }, "a term and an alias saved from the modal, both removable");
});

test("the reader's Send to… opens a contact's conversation with the clipping typed in", async ({ gm, pl, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  const contact = `${prefix}Fixer`;
  const headline = `${tag} sent along`;
  const id = await gm.run(async a => {
    const actor = game.actors.get(a.pc);
    const contacts = actor.getFlag("cpr-sam-agent", "contacts") ?? [];
    if (!contacts.some(c => c.name === a.contact)) await actor.setFlag("cpr-sam-agent", "contacts", [...contacts, { name: a.contact }]);
    return api.screamsheet.publish({ headline: a.headline, body: `${a.name} in the news.` });
  }, { pc: pc.id, contact, headline, name: pc.name });
  await open(pl, "crawl");
  const text = await pl.run(async a => {
    const row = await until(() => els(".agent-scream-row").find(r => r.dataset.id === a.id), "the clipping on My Crawl");
    hit(row);
    const w = await until(() => document.getElementById(`agent-scream-reader-${a.id}`), "the reader");
    w.querySelector("[data-scream=send]").click();
    const d = await dialog("Send to");
    inDialog(d, "[name=contact]", a.contact);
    await press(d, "Write the text");
    const box = await until(() => el(".agent-compose textarea"), "the conversation's message box");
    w.querySelector(".header-button.close")?.click();
    return box.value;
  }, { id, contact });
  check(text.includes(headline) && /^Saw this on the Pool/.test(text), "the message box has the clipping, unsent");
});

test("a Reputation event on a sheet becomes a suggested clipping on the desk", async ({ gm, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  const reason = `${tag} saved a Trauma Team crew`;
  const shown = await gm.run(async a => {
    const actor = game.actors.get(a.pc);
    await actor.deltaLedgerProperty("reputation", 2, a.reason);
    await go("screamsheet");
    return until(() => Object.values(store.apps.screamClips).some(c => c.source?.kind === "rep" && c.notes?.includes(a.reason)) && els(".agent-scream-desk").some(d => d.textContent.includes("Reputation event")), "the suggestion on the desk");
  }, { pc: pc.id, reason });
  check(shown, "the desk lists the suggested clipping");
}, { player: false });

test("Draft with Claude: the outlet's voice and the spin go out, a draft comes back; Redraft keeps the masthead", async ({ gm, pc, tag, prefix }) => {
  await ready(gm, pc, prefix);
  const out = await gm.run(async a => {
    const { MODULE_ID } = await import("/modules/" + MODULE + "/scripts/config.js");
    const saved = game.settings.get(MODULE_ID, "alexAi");
    const realFetch = window.fetch;
    const sent = [];
    let n = 0;
    // A placeholder, never a real key: the API is stubbed below.
    await game.settings.set(MODULE_ID, "alexAi", { ...saved, key: "placeholder-not-a-key", remember: true });
    window.fetch = async (url, init) => {
      if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
      sent.push(JSON.parse(init.body).messages[0].content);
      n += 1;
      const input = { headline: `${a.tag} ${n === 1 ? "CHROME CARNAGE" : "REWRITTEN"} AT THE KIOSK`, byline: "Gutter desk", paragraphs: ["Witnesses \u2014 three of them \u2014 saw it.", "Nobody is talking."], tags: ["Kiosk"], gm_note: "Invented the witnesses." };
      return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "t", name: "clipping", input }], usage: { input_tokens: 900, output_tokens: 250 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await go("screamsheet");
      await tap('[data-action="scream-claude"]:not([data-id])');
      let d = await dialog("Draft with Claude");
      inDialog(d, "[name=prompt]", "A brawl outside the kiosk");
      inDialog(d, "[name=outlet]", "street");
      inDialog(d, "[name=spin]", "hit");
      d.querySelector(`[name=about_${a.pc}]`).checked = true;
      await press(d, "Draft");
      const made = await until(() => Object.values(store.apps.screamClips).find(c => c.sheet?.blocks?.[0]?.text?.startsWith(`${a.tag} CHROME`)), "Claude's draft on the desk", 10000);
      await until(() => els(".agent-scream-desk").some(x => x.textContent.includes("CHROME CARNAGE")), "the draft drawn on the desk");
      await tap(`[data-action="scream-claude"][data-id="${made.id}"]`);
      d = await dialog("Redraft with Claude");
      inDialog(d, "[name=prompt]", "Make it shorter");
      await press(d, "Draft");
      const re = await until(() => store.apps.screamClips[made.id]?.sheet?.blocks?.[0]?.text?.includes("REWRITTEN") && store.apps.screamClips[made.id], "the redraft", 10000);
      return {
        status: re.status, source: made.source?.kind, subjects: made.subjects, spin: made.spin, outlet: re.sheet.outlet, brand: re.sheet.masthead.brand.name,
        body: re.sheet.blocks.find(b => b.type === "paragraph")?.text, notes: re.notes, first: sent[0], second: sent[1]
      };
    } finally {
      window.fetch = realFetch;
      await game.settings.set(MODULE_ID, "alexAi", saved);
    }
  }, { pc: pc.id, tag });
  same(out.status, "draft", "Claude's clipping stays a draft");
  same(out.source, "claude", "its source is Claude");
  same(out.subjects, [pc.id], "the character ticked is its subject");
  same(out.spin, "hit", "the spin is kept on the clipping");
  check(/The Gutter Eye/.test(out.first) && /lurid tabloid/.test(out.first) && /Spin: Hit piece/.test(out.first), "the request has the outlet's voice and the spin");
  check(/Subjects \(public facts\):\n- .+, Reputation \d+/.test(out.first) && /A brawl outside the kiosk/.test(out.first), "the request has the subject's public facts and the GM's prompt");
  check(/The draft now:/.test(out.second) && /Make it shorter/.test(out.second), "the redraft sends the draft's text and the new prompt");
  same([out.outlet, out.brand], ["street", "The Gutter Eye"], "the redraft keeps the outlet and masthead");
  check(!out.body.includes("\u2014") && out.body.startsWith("Witnesses, three of them, saw it."), "em dashes are taken out");
  check(/Invented the witnesses/.test(out.notes), "Claude's note for the GM is in the clipping's notes");
}, { player: false });

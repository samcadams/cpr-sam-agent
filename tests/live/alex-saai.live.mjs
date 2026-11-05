/*
 * Big SAAI (Ask Alex's Ziggurat add-on): the banner and its details sheet with the terms (dismissed, a
 * Ziggurat chip still opens it), Buy (100eb through
 * BangMe!, a pool ledger line, the faux download), the badge, a situational +1 on the sheet so Library Search gets
 * +3 in all, priority crawls (the GM's badge, the player's tag), and the GM's revoke and grant from the App Store.
 * The lane's PC ends without it (its row removed, so the banner shows again next time).
 */

import { check, same, test } from "./lib.mjs";

const SAAI = "bigsaai";

/** No Big SAAI row or effect, the banner not dismissed, money to buy it. */
const fresh = async (gm, pl, pc) => {
  await gm.run(async a => {
    const rows = { ...(store.apps.installs[a.pc.id] ?? {}) };
    delete rows[a.saai];
    store.apps.installs[a.pc.id] = rows;
    store._pushApps();
    const actor = game.actors.get(a.pc.id);
    const mine = actor.effects.filter(e => e.flags?.[MODULE]?.addon === a.saai).map(e => e.id);
    if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine);
    if ((actor.system.wealth?.value ?? 0) < 500) await actor.update({ "system.wealth.value": 5000 });
  }, { pc, saai: SAAI });
  await pl.run(async a => {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${MODULE}.saaiBanner.`)) localStorage.removeItem(k);
    // A dismissal also lasts this session on the phone itself (a run before may have dismissed it).
    const ph = Object.values(ui.windows).find(w => w.constructor.name === "AgentPhone");
    if (ph) Object.assign(ph, { alexSaaiHidden: null, alexSaaiOpen: false });
    await until(() => !api.pool.has(a.pc.id, a.saai), "no Big SAAI on the player's client");
  }, { pc, saai: SAAI });
};

const effects = (gm, pc) => gm.run(a => game.actors.get(a.pc.id).effects.filter(e => e.flags?.[MODULE]?.addon === a.saai)
  .map(e => ({ name: e.name, changes: e.changes.map(c => `${c.key}+${c.value}`), situational: e.flags["cyberpunk-red-core"]?.changes?.situational?.[0] })), { pc, saai: SAAI });

/** The Agent's and Big SAAI's mods on the sheet's own Library Search roll, as the phone builds it (apps/alex/page.js). */
const rollMods = pl => pl.run(async () => {
  const actor = game.user.character;
  const skill = actor.items.find(i => i.type === "skill" && /^library search$/i.test(i.name));
  const roll = skill.createRoll("skill", actor);
  const { agentMods, BIG_SAAI } = await import(`/modules/${MODULE}/apps/alex/model.js`);
  const { hasAddon } = await import(`/modules/${MODULE}/apps/pool/model.js`);
  roll.addMod(agentMods(roll.mods, hasAddon(store.apps.installs, actor.id, BIG_SAAI), "Ask Alex Anything"));
  return roll.mods.filter(m => /agent|big saai/i.test(m.source ?? "")).map(m => `${m.source} +${m.value}`).sort();
});

test("Big SAAI: the banner sells it, the sheet gets a situational +1 (Library Search +3), questions are priority crawls", async ({ gm, pl, pc, tag }) => {
  await fresh(gm, pl, pc);
  try {
    const before = await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc });
    const buy = await pl.run(async () => {
      await go("alex");
      const banner = await until(() => el(".agent-alex-saai-banner"), "the Big SAAI banner");
      const pitch = banner.innerText;
      await tap('.agent-alex-saai-banner [data-action="alex-saai-details"]');
      await until(() => el(".agent-alex-saai-sheet"), "the details sheet");
      const bannerOverSheet = !!el(".agent-alex-saai-banner");
      // Back, dismiss the banner: a small Ziggurat chip still opens the details.
      await tap('.agent-alex-saai-sheet [data-action="alex-saai-details"]');
      await tap('[data-action="alex-saai-dismiss"]');
      await until(() => !el(".agent-alex-saai-banner"), "the banner dismissed");
      await tap(".agent-alex-saai-chip");
      await until(() => el(".agent-alex-saai-sheet"), "the details sheet from the chip");
      const chipOverSheet = !!el(".agent-alex-saai-chip");
      // Folded under "Terms of Service (scroll)": read the text, not what's shown.
      const terms = [...el(".agent-alex-eula-text").querySelectorAll("p")].map(p => p.textContent);
      const buyOn = !el('[data-action="alex-saai-buy"]').disabled;
      await tap('[data-action="alex-saai-buy"]');
      const bar = !!(await until(() => el(".agent-alex-saai-sheet .agent-pool-progress"), "the download bar"));
      await until(() => api.pool.has(game.user.character.id, "bigsaai"), "Big SAAI installed");
      const badge = await until(() => el(".agent-alex-saai-badge"), "the Big SAAI badge", 8000);
      return { bannerOverSheet, chipOverSheet, pitch, terms3: terms.some(t => /monetise, share, sell, resell/.test(t)), clauses: terms.filter(t => /^\d+\./.test(t)).length, buyOn, bar, badge: badge.innerText.trim(), banner: !!el(".agent-alex-saai-banner") };
    });
    same([buy.bannerOverSheet, buy.chipOverSheet], [false, false], "the banner and the chip hide while the details are open");
    check(/Upgrade your SAAI/.test(buy.pitch) && /100/.test(buy.pitch), `the banner pitches it with its price (${buy.pitch})`);
    check(buy.terms3 && buy.clauses >= 40, `the terms: clause 3 and a long scroll (${buy.clauses} clauses)`);
    check(buy.buyOn, "Buy works without scrolling the terms");
    check(buy.bar, "Buy shows a download bar");
    same([buy.badge, buy.banner], ["Big SAAI", false], "the badge replaces the banner");
    same(await gm.run(a => game.actors.get(a.pc.id).system.wealth.value, { pc }), before - 100, "100eb through BangMe!");
    check(await gm.run(() => Object.values(store.apps.ledger).some(e => e.kind === "pool" && e.amount === -100)), "a pool ledger line");
    same(await effects(gm, pc), [{ name: "Big SAAI", changes: ["bonuses.librarySearch+1"], situational: { isSituational: true, onByDefault: true } }], "a situational +1, on by default, on the sheet");
    const mods = await rollMods(pl);
    same(mods.reduce((n, m) => n + Number(m.split("+").at(-1)), 0), 3, `Library Search: +3 in all (${mods.join(", ")})`);
    check(mods.includes("Big SAAI +1"), "the +1 is Big SAAI's");

    // A question: the GM sees it badged, asks for a roll; the player's button says +3; the answer has the tag.
    const question = `${tag} who fences in Kabuki?`;
    await pl.run(async a => {
      await fill("[name=alexQuery]", a.question);
      await tap("[data-action=alex-ask]");
    }, { question });
    const gmSide = await gm.run(async a => {
      const q = await until(() => Object.values(store.apps.queries).find(q => q.text === a.question), "the question at the host");
      await go("alex");
      const item = await until(() => el(`textarea[data-query-id="${q.id}"]`)?.closest("li"), "the question on the GM Phone");
      const out = { priority: q.priority, badge: !!item.querySelector(".agent-alex-saai-tag"), suggest: item.querySelector("small")?.innerText ?? "" };
      store.request("alex-need-roll", { queryId: q.id, dv: 9 });
      await until(() => store.apps.queries[q.id].status === "roll", "the roll asked for");
      return { ...out, id: q.id };
    }, { question });
    check(gmSide.priority && gmSide.badge, "the GM's question is badged Big SAAI");
    check(/\+ 3 \(Agent \+ Big SAAI\)/.test(gmSide.suggest), `the GM's suggested roll says +3 (${gmSide.suggest})`);
    const button = await pl.run(a => until(() => el(`[data-action="alex-roll"][data-query-id="${a.id}"]`)?.innerText, "the roll button"), { id: gmSide.id });
    check(/\(\+3\)/.test(button), `the player's roll button says +3 (${button})`);
    await gm.run(async a => {
      store.request("alex-answer", { queryId: a.id, text: `${a.tag} Ask for Mama.` });
      await until(() => store.apps.queries[a.id].status === "answered", "answered");
    }, { id: gmSide.id, tag });
    const tagged = await pl.run(a => until(() => el(`[data-alex-query="${a.id}"] + .agent-alex-reply .agent-alex-priority`), "the priority crawl tag"), { id: gmSide.id });
    check(tagged, "the answer carries the priority crawl tag");

    // The GM revokes it: no badge, no banner, no +1; a grant puts it all back.
    await gm.run(a => api.pool.revoke({ actor: a.pc.id, app: "bigsaai", reason: "Bricked by a virus" }), { pc });
    const revoked = await pl.run(async () => {
      await until(() => !api.pool.has(game.user.character.id, "bigsaai"), "revoked on the player's client");
      await until(() => !el(".agent-alex-saai-badge"), "the badge gone");
      return { banner: !!el(".agent-alex-saai-banner") };
    });
    same(revoked.banner, false, "revoked: no banner either");
    await gm.run(a => until(() => !game.actors.get(a.pc.id).effects.some(e => e.flags?.[MODULE]?.addon === "bigsaai"), "the effect removed"), { pc });
    same((await rollMods(pl)).filter(m => /big saai/i.test(m)), [], "no Big SAAI mod after the revoke");
    await gm.run(a => api.pool.grant({ actor: a.pc.id, app: "bigsaai" }), { pc });
    await pl.run(() => until(() => el(".agent-alex-saai-badge"), "the badge back"));
    await gm.run(a => until(() => game.actors.get(a.pc.id).effects.some(e => e.flags?.[MODULE]?.addon === "bigsaai"), "the effect back"), { pc });
    check((await rollMods(pl)).includes("Big SAAI +1"), "granted: the +1 is back");
  } finally {
    await fresh(gm, pl, pc);
  }
});

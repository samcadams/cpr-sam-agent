/*
 * HusTool (apps/hustool/): nothing shows until a settled round banks hustles; PAY ME spends one, Done rolls and pays
 * with world time standing still, Bail spends one for nothing, Complete all does a day, leftovers expire. This spec
 * never settles the shared round or fires cpr-hq's hook: a fake history entry goes on the character, then the request
 * the hook sends. The entry comes off again at the end, so the Calendar app stays honest. Trouble is unit-tested: off
 * here, so random 10s leave nothing in the shared notification center.
 */

import { check, same, test } from "./lib.mjs";

test("HusTool: no gigs before downtime, PAY ME, Done, Bail, Complete all, dated BangMe! rows, no doubles, expiry", async ({ gm, pl, pc, tag }) => {
  const roundId = `${tag}-round`;
  const text = `${tag} downtime run`;
  await gm.run(async a => {
    if (!api.feature("app_hustool")) await api.setFeature("app_hustool", true);
    if (api.pool?.on() && !api.pool.has(a.pc.id, "hustool")) await api.pool.grant({ actor: a.pc.id, app: "hustool" });
    const saved = game.settings.get(MODULE, "hustool") ?? {};
    await game.settings.set(MODULE, "hustool", { ...saved, pay: 10, trouble: false, perHour: 2, errands: [{ id: "live", text: a.text, district: "Watson" }] });
    // Hustles left by an earlier run expire: the same request, with a round that has nothing for this character.
    store.request("hustool-settled", { roundId: `${a.roundId}-clean`, actorIds: [a.pc.id] });
    await until(() => !Object.values(store.apps.hustoolGigs).some(r => r.actorId === a.pc.id && r.days.some(d => d.errands.some(e => ["open", "running"].includes(e.status)))), "no hustles left");
  }, { pc, roundId, text });

  const before = await pl.run(async a => {
    await until(() => !Object.values(store.apps.hustoolGigs).some(r => r.actorId === a.pc.id && r.days.some(d => d.errands.some(e => ["open", "running"].includes(e.status)))), "the player's copy");
    await go("hustool");
    await until(() => el(".agent-hustool"), "the page");
    return { payme: !!el('[data-action="hustool-payme"]'), gigs: els("[data-gig]").length, page: root().innerText };
  }, { pc });
  check(!before.payme, "no PAY ME before downtime settles");
  same(before.gigs, 0, "no gigs before downtime settles");
  check(/no hustles ready/i.test(before.page), "says why");

  const setup = await gm.run(async a => {
    const actor = game.actors.get(a.pc.id);
    const start = game.time.worldTime - (game.time.worldTime % 86400) - 86400 * 10;
    const history = [...(actor.getFlag("cpr-hq", "downtimeHistory") ?? []), { roundId: a.roundId, start, days: 2, status: "approved", blocks: [
      { id: "g1", activity: "hustool", start: 9, length: 3 }, { id: "s1", activity: "sleep", start: 0, length: 8 }, { id: "g2", activity: "hustool", start: 33, length: 2 }
    ] }];
    await actor.setFlag("cpr-hq", "downtimeHistory", history);
    store.request("hustool-settled", { roundId: a.roundId, actorIds: [a.pc.id] });
    const row = await until(() => store.apps.hustoolGigs[`${a.roundId}-${a.pc.id}`], "the errands");
    return { rowId: row.id, counts: row.days.map(d => d.errands.length), dates: row.days.map(d => d.date) };
  }, { pc, roundId, text });
  same(setup.counts.join(), "6,4", "2 hustles per gig hour: 3 h on day 1, 2 h on day 2");
  check(setup.dates[0] !== setup.dates[1], `two downtime dates (${setup.dates.join(" / ")})`);

  const first = await pl.run(async a => {
    await go("hustool");
    await until(() => el('[data-action="hustool-payme"]'), "PAY ME");
    const stopped = game.time.worldTime;
    const start = game.actors.get(a.pc.id).system.wealth.value;
    const day1 = () => store.apps.hustoolGigs[a.rowId].days[0].errands;
    const payMe = async i => {
      await until(() => el('[data-action="hustool-payme"]'), "PAY ME");
      await tap('[data-action="hustool-payme"]');
      await until(() => el(".agent-hustool-job") && day1()[i].status === "running", `hustle ${i} running`);
    };
    const resolved = i => !["open", "running", "rolling"].includes(day1()[i].status);
    await payMe(0);
    const count = text(".agent-hustool-today");
    await tap('[data-action="hustool-done"]');
    await until(() => resolved(0), "the first errand resolved by Done");
    await payMe(1);
    await tap('[data-action="hustool-done"]');
    await until(() => resolved(1), "the second errand resolved by Done");
    await payMe(2);
    await tap('[data-action="hustool-bail"]');
    const yes = await until(() => [...document.querySelectorAll('.dialog button[data-button="yes"], .dialog .dialog-button.yes')].at(-1), "the Bail dialog");
    yes.click();
    await until(() => day1()[2].status === "skipped", "the third bailed");
    await tap(`[data-action="hustool-gig-day"][data-day="1"]`);
    const row = await until(() => {
      const r = store.apps.hustoolGigs[a.rowId];
      return r.days[1].errands.every(e => !["open", "rolling"].includes(e.status)) && r;
    }, "day 2 resolved");
    const total = row.days.flatMap(d => d.errands).reduce((sum, e) => sum + (e.pay ?? 0), 0);
    await until(() => game.actors.get(a.pc.id).system.wealth.value === start + total, "the pay in the account");
    const rows = Object.values(store.apps.ledger).filter(l => l.actorId === a.pc.id && l.kind === "hustool" && l.memo === a.text);
    await until(() => els('[data-action="hustool-gig-day"]').length === 1, "only day 1 still has hustles");
    return {
      clock: game.time.worldTime - stopped, count,
      gained: game.actors.get(a.pc.id).system.wealth.value - start, total,
      statuses: row.days.map(d => d.errands.map(e => e.status)),
      paidPerDay: row.days.map(d => d.errands.filter(e => e.pay).length),
      ledgerDates: row.days.map(d => rows.filter(l => l.date === d.date).length),
      realTs: rows.every(l => Date.now() - l.ts < 600000),
      gmSide: row.gm === undefined,
      page: root().innerText
    };
  }, { pc, rowId: setup.rowId, text });
  same(first.clock, 0, "world time never moved");
  check(first.count.includes("9"), `one hustle spent of ten (${first.count})`);
  same(first.gained, first.total, `the account went up by what the errands paid (${first.total}eb)`);
  same(first.statuses[0][2], "skipped", "Bail");
  same(first.statuses[0].slice(3).join(), "open,open,open", "the rest of day 1 still banked");
  same(first.ledgerDates.join(), first.paidPerDay.join(), "a BangMe! row for each paid errand, on its downtime date");
  check(first.realTs, "BangMe! rows keep real time in ts");
  check(first.gmSide, "the player's copy has no gm side");
  check(/complete all/i.test(first.page), "Complete all while hustles are left");

  const after = await gm.run(async a => {
    const row = () => store.apps.hustoolGigs[a.rowId];
    const count = () => row().days.flatMap(d => d.errands).length;
    store.request("hustool-settled", { roundId: a.roundId, actorIds: [a.pc.id] });
    await sleep(500);
    const repeat = { rows: Object.values(store.apps.hustoolGigs).filter(r => r.roundId === a.roundId).length, errands: count(), stillOpen: row().days[0].errands.filter(e => e.status === "open").length };
    await go("hustool");
    const section = await until(() => el('[data-section="hustoolGigs"]'), "the GM's section");
    section.open = true;
    const gmPage = section.innerText;
    // A later round with no gigs for this character: the leftovers expire.
    store.request("hustool-settled", { roundId: `${a.roundId}-next`, actorIds: [a.pc.id] });
    await until(() => row().days[0].errands.every(e => e.status !== "open"), "the leftovers expire");
    const statuses = row().days[0].errands.map(e => e.status);
    const actor = game.actors.get(a.pc.id);
    await actor.setFlag("cpr-hq", "downtimeHistory", (actor.getFlag("cpr-hq", "downtimeHistory") ?? []).filter(e => e.roundId !== a.roundId));
    await game.settings.set(MODULE, "hustool", { ...game.settings.get(MODULE, "hustool"), trouble: true });
    return { repeat, gmPage, statuses };
  }, { pc, rowId: setup.rowId, roundId });
  same(after.repeat.rows, 1, "a repeat makes no second row");
  same(after.repeat.errands, 10, "a repeat adds no errands");
  same(after.repeat.stillOpen, 3, "a repeat expires nothing of this round");
  check(/3 left/i.test(after.gmPage) && /7 resolved/i.test(after.gmPage), `the GM Phone counts them: ${after.gmPage.slice(0, 80)}`);
  same(after.statuses.slice(3).join(), "expired,expired,expired", "the next round expires what's left");

  const expired = await pl.run(async a => {
    await until(() => store.apps.hustoolGigs[a.rowId].days[0].errands.every(e => e.status !== "open"), "the player's copy");
    await until(() => !el('[data-action="hustool-gig-day"]'), "no Complete all left");
    return { payme: !!el('[data-action="hustool-payme"]'), gigs: els("[data-gig]").length, page: root().innerText };
  }, { rowId: setup.rowId });
  check(!expired.payme, "no PAY ME once no hustles are left");
  same(expired.gigs, 0, "no gigs once no hustles are left");
  check(/no hustles ready/i.test(expired.page), "says why");
});

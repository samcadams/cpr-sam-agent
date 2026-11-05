/*
 * Eurobucks and jobs in conversations, through the player's phone: paying a bill (once, however fast
 * you tap), declining, transferring money in; hidden jobs, revealing, and accepting a job offer.
 */

import { check, same, test } from "./lib.mjs";

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });

/** Player: open the conversation and wait for the money card of the newest message with `marker`. */
const openCard = (pl, contact, marker) =>
  pl.run(async a => {
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    const t = await until(() => [...store.threads.values()].find(t => t.contact === a.contact && t.messages.some(m => m.text?.includes(a.marker))), "the money message");
    const msg = t.messages.findLast(m => m.text?.includes(a.marker));
    await until(() => el(`.agent-msg[data-message-id="${msg.id}"]`), "its card");
    return msg.id;
  }, { contact, marker });

test("the GM bills the player; Pay takes it from the sheet once, however fast it's tapped", async ({ gm, pl, pc, contact, tag }) => {
  const before = await wealth(gm, pc.id);
  await gm.run(a => api.money.request({ to: a.pc.id, from: a.contact, amount: 25, note: `${a.tag} bar tab` }), { pc, contact, tag });
  const id = await openCard(pl, contact, `${tag} bar tab`);
  const r = await pl.run(async a => {
    const card = el(`.agent-msg[data-message-id="${a.id}"]`);
    const note = card.querySelector(".agent-money-note")?.textContent ?? "";
    const pay = card.querySelector('[data-action="money-pay"]');
    pay.click();
    pay.click(); // a quick double tap
    // Paid (held for a linked sheet) or straight on to Transferred (an NPC with no sheet).
    await until(() => ["paid", "transferred"].includes(store.findThread(game.user.character.id, a.contact)?.messages.find(m => m.id === a.id)?.money?.status), "the bill to be paid");
    return { note };
  }, { id, contact });
  check(r.note.includes(tag), "the note shows inside the money card");
  const after = await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value !== a.before && game.actors.get(a.id).system.wealth.value, "the sheet to change"), { id: pc.id, before });
  same(before - after, 25, "the sheet is charged once");
});

test("declining a bill charges nothing", async ({ gm, pl, pc, contact, tag }) => {
  const before = await wealth(gm, pc.id);
  await gm.run(a => api.money.request({ to: a.pc.id, from: a.contact, amount: 40, note: `${a.tag} decline me` }), { pc, contact, tag });
  const id = await openCard(pl, contact, `${tag} decline me`);
  await pl.run(async a => {
    await tap(`[data-action="money-decline"][data-message-id="${a.id}"]`);
    await until(() => store.findThread(game.user.character.id, a.contact)?.messages.find(m => m.id === a.id)?.money?.status === "declined", "declined");
  }, { id, contact });
  same(await wealth(gm, pc.id), before, "the wallet is unchanged");
});

test("money the GM sends waits until the player taps Transfer", async ({ gm, pl, pc, contact, tag }) => {
  const before = await wealth(gm, pc.id);
  await gm.run(a => api.money.send({ to: a.pc.id, from: a.contact, amount: 60, note: `${a.tag} your cut` }), { pc, contact, tag });
  const id = await openCard(pl, contact, `${tag} your cut`);
  same(await wealth(gm, pc.id), before, "nothing arrives before Transfer");
  await pl.run(a => tap(`[data-action="money-transfer"][data-message-id="${a.id}"]`), { id });
  const after = await gm.run(a => until(() => game.actors.get(a.id).system.wealth.value !== a.before && game.actors.get(a.id).system.wealth.value, "the transfer"), { id: pc.id, before });
  same(after - before, 60, "Transfer adds it to the sheet");
});

test("a hidden job stays off players' phones; revealed, it pops a notice that opens it in Jobs", async ({ gm, pl, prefix, tag }) => {
  const name = `${prefix}Job ${tag}`;
  const id = await gm.run(a => api.jobs.save({ name: a.name, description: "Steal the car.", hidden: true }), { name });
  // The notice pops up only while the phone is put away (open, its badge shows it).
  await pl.run(async a => {
    await closePhone();
    await sleep(800);
    if (store.visibleQuests().some(q => q.name === a.name)) throw new Error("a hidden job reached the player");
  }, { name });
  await gm.run(a => api.jobs.setStatus(a.id, "available", { reveal: true }), { id });
  const r = await pl.run(async a => {
    await until(() => store.visibleQuests().some(q => q.name === a.name), "the revealed job");
    const toast = await until(() => [...document.querySelectorAll(".ctp-toast-quest")].find(t => t.textContent.includes(a.name)), "the job notice");
    toast.querySelector(".ctp-toast-main").click();
    const p = await until(() => AgentPhone.primary().rendered && AgentPhone.primary(), "the phone");
    await until(() => p.app === "quests" && root()?.innerText.toLowerCase().includes(a.name.toLowerCase()), "the job in Jobs");
    return { onIt: p.questId === a.id };
  }, { name, id });
  check(r.onIt, "the notice opens the phone on that job");
});

test("a job offered in a text: the player Accepts it and it's In Progress for everyone", async ({ gm, pl, pc, contact, prefix, tag }) => {
  const name = `${prefix}Offer ${tag}`;
  const id = await gm.run(async a => {
    const id = await api.jobs.save({ name: a.name, description: "Ride shotgun.", hidden: true });
    await api.jobs.offer({ job: id, to: a.pc.id, from: a.contact, text: `${a.tag} got work` });
    return id;
  }, { name, pc, contact, tag });
  await pl.run(async a => {
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    const accept = await until(() => els('[data-action="job-accept"]').at(-1), "the job card's Accept");
    accept.click();
    await until(() => store.visibleQuests().find(q => q.name === a.name)?.status === "active", "the job to start");
  }, { contact, name });
  const status = await gm.run(a => until(() => store.quests.get(a.id)?.status === "active" && !store.quests.get(a.id).hidden && "active", "In Progress at the host"), { id });
  same(status, "active", "the job is revealed and In Progress");
});

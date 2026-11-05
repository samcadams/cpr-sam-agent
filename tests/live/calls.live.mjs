/*
 * Calls through the real phones: the GM rings a player, a player rings an NPC, declining, the
 * minimised call card, and a second call while on one ("Hang up and answer?").
 */

import { check, same, test } from "./lib.mjs";

/** Both sides: end anything a failed test left ringing. */
const hangUpAll = gm => gm.run(() => api.endCalls());

/** GM side: the newest log line in a conversation (the call's outcome). */
const lastLog = (gm, pc, contact) =>
  gm.run(a => store.findThread(a.pc.id, a.contact)?.messages.filter(m => m.call).at(-1)?.text ?? null, { pc, contact });

test("the GM rings the player with the phone away: a pop-up; Answer, then Hang up logs the call", async ({ gm, pl, pc, contact }) => {
  await hangUpAll(gm);
  await pl.run(() => closePhone());
  await gm.run(a => api.call({ to: a.pc.id, from: a.contact }), { pc, contact });

  const r = await pl.run(async a => {
    const toast = await until(() => document.querySelector(".ctp-toast-call"), "the incoming call pop-up");
    const named = toast.textContent.toLowerCase().includes(a.contact.toLowerCase());
    toast.querySelector(".ctp-toast-action.accept").click();
    // Answering opens the phone on the call.
    await until(() => el('[data-action="call-hangup"]'), "the call screen");
    await sleep(1200);
    await tap('[data-action="call-hangup"]');
    await until(() => !store.myCall(), "the call to end");
    return { named };
  }, { contact });
  check(r.named, "the pop-up names the caller");
  const log = await gm.run(a => until(() => {
    const t = store.findThread(a.pc.id, a.contact)?.messages.filter(m => m.call).at(-1)?.text;
    return t?.startsWith("Call ·") && t;
  }, "the call log"), { pc, contact });
  check(/^Call · \d+:\d\d/.test(log), `the conversation logs "Call · m:ss" (got "${log}")`);
});

test("with the phone open, an incoming call takes it over; Decline logs it", async ({ gm, pl, pc, contact }) => {
  await hangUpAll(gm);
  await pl.run(() => go("messages"));
  await gm.run(a => api.call({ to: a.pc.id, from: a.contact }), { pc, contact });
  await pl.run(async () => {
    await until(() => el('[data-action="call-decline"]'), "the incoming call screen");
    await tap('[data-action="call-decline"]');
    await until(() => !store.myCall(), "the call to end");
  });
  const log = await lastLog(gm, pc, contact);
  same(log, "Call declined", "the conversation logs the declined call");
});

test("the player rings an NPC from the conversation; the GM Phone answers as them and ends it", async ({ gm, pl, pc, contact }) => {
  await hangUpAll(gm);
  await pl.run(async a => {
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    await tap('.agent-thread-head [data-action="call"], [data-action="call"]');
  }, { contact });

  const r = await gm.run(async a => {
    await phone();
    const answer = await until(() => els('[data-action="call-answer"]').find(b => b.title.includes(a.contact)), `Answer as ${a.contact}`);
    answer.click();
    const call = await until(() => [...store.calls.values()].find(c => c.startedAt), "the call to connect");
    await until(() => el('[data-action="call-close"]'), "the GM's call card");
    await sleep(500);
    await tap(`[data-action="call-close"][data-call-id="${call.id}"]`);
    await until(() => !store.calls.has(call.id), "the call to end for everyone");
    return true;
  }, { contact });
  check(r, "the GM answered and ended the call");
  const ended = await pl.run(() => until(() => !store.myCall() && !el('[data-action="call-hangup"]'), "the player's call screen to go"));
  check(ended, "the player's call ends too");
  const log = await lastLog(gm, pc, contact);
  check(/^Call · /.test(log), `logged as a call (got "${log}")`);
});

test("the GM declines a player's call: it's logged as declined", async ({ gm, pl, pc, contact }) => {
  await hangUpAll(gm);
  await pl.run(async a => {
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    await tap('[data-action="call"]');
  }, { contact });
  await gm.run(async a => {
    await phone();
    const decline = await until(() => els('[data-action="call-decline"]').find(b => b.title.includes(a.contact)), `Decline as ${a.contact}`);
    decline.click();
    await until(() => !store.calls.size || ![...store.calls.values()].some(c => c.threadId === store.findThread(a.pc.id, a.contact)?.id), "the call to end");
  }, { pc, contact });
  const log = await gm.run(a => until(() => store.findThread(a.pc.id, a.contact).messages.filter(m => m.call).at(-1)?.text === "Call declined" && "ok", "Call declined"), { pc, contact });
  same(log, "ok", "the conversation logs Call declined");
});

test("Minimise keeps the call in a card by the phone button; hanging up there ends it", async ({ gm, pl, pc, contact }) => {
  await hangUpAll(gm);
  await pl.run(() => go("messages"));
  await gm.run(a => api.call({ to: a.pc.id, from: a.contact }), { pc, contact });
  const r = await pl.run(async () => {
    await tap('[data-action="call-answer"]');
    await until(() => el('[data-action="call-minimize"]'), "the call screen");
    await tap('[data-action="call-minimize"]');
    const card = await until(() => {
      const c = document.querySelector("#ctp-call-widget");
      return c && !c.hidden && c;
    }, "the minimised call card");
    const phoneAway = !root() || AgentPhone.primary()._minimized;
    card.querySelector('[data-widget="hangup"]').click();
    await until(() => !store.myCall(), "the call to end");
    await until(() => document.querySelector("#ctp-call-widget").hidden, "the card to go");
    return { phoneAway };
  });
  check(r.phoneAway, "the phone goes away while minimised");
});

test("a second call while on one asks to hang up and answer; answering ends the first", async ({ gm, pl, pc, contact, prefix }) => {
  await hangUpAll(gm);
  const second = `${prefix}Caller Two`;
  await pl.run(() => go("messages"));
  await gm.run(a => api.call({ to: a.pc.id, from: a.contact }), { pc, contact });
  await pl.run(() => tap('[data-action="call-answer"]'));
  await pl.run(() => until(() => el('[data-action="call-hangup"]'), "on the first call"));
  await gm.run(a => api.call({ to: a.pc.id, from: a.second }), { pc, second });

  const r = await pl.run(async a => {
    const answer = await until(() => el('[data-action="call-answer"]'), "the second call's screen");
    const label = `${answer.title} ${root().innerText}`;
    answer.click();
    await until(() => store.myCall()?.call && text(".agent-call, .agent-call-name, .agent-call-who")?.toLowerCase().includes(a.second.toLowerCase()), "on the second call");
    // The host ends the first call as it connects the second.
    const calls = await until(() => store.myCalls().length === 1 && 1, "the first call to end", 4000).catch(() => store.myCalls().length);
    await tap('[data-action="call-hangup"]');
    return { asks: /hang up/i.test(label), calls };
  }, { second });
  check(r.asks, "the incoming screen says it hangs up the current call");
  same(r.calls, 1, "only the second call is left");
  await hangUpAll(gm);
});

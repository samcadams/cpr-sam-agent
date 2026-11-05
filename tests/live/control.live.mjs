/*
 * The GM's switches and a contact's options, seen from the player's phone: cutting the signal,
 * switching Jobs off, blocking, texts-only, and asking the GM for a number.
 */

import { check, same, test } from "./lib.mjs";

test("no signal: the player's phone says so and can't send; texts wait, then arrive with a pop-up", async ({ gm, pl, pc, contact, tag }) => {
  try {
    await gm.run(a => api.setSignal(a.pc.id, false), { pc });
    const off = await pl.run(async a => {
      await go("messages");
      const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
      row.click();
      await until(() => el(".agent-signal.offline"), "NO SIGNAL in the status bar");
      return { send: el('[data-action="send"]')?.disabled ?? true };
    }, { contact });
    check(off.send, "Send is disabled without signal");

    await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} while you were out` }), { pc, contact, tag });
    const held = await pl.run(async a => {
      await sleep(800);
      return !store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text.includes(a.tag));
    }, { pc, contact, tag });
    check(held, "the text doesn't arrive while there's no signal");

    await pl.run(() => closePhone()); // the "N new while you had no signal" pop-up shows with the phone away
    await gm.run(a => api.setSignal(a.pc.id, true), { pc });
    const back = await pl.run(async a => {
      await until(() => store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text.includes(a.tag)), "the held text");
      const popup = await until(() => [...document.querySelectorAll(".ctp-toast")].find(t => /signal/i.test(t.textContent)), "the signal-restored pop-up", 5000).catch(() => null);
      return { popup: !!popup };
    }, { pc, contact, tag });
    check(back.popup, "a pop-up says signal is back");
  } finally {
    await gm.run(a => api.setSignal(a.pc.id, true), { pc });
  }
});

test("Jobs off in Control: the Jobs app leaves every phone; on again, it's back", async ({ gm, pl }) => {
  try {
    await gm.run(async () => {
      await go("control");
      await api.setFeature("jobs", false);
    });
    const off = await pl.run(async () => {
      await go("home");
      return until(() => !el('[data-action="app"][data-app="quests"]') && "gone", "Jobs to leave the dock");
    });
    same(off, "gone", "no Jobs button without Jobs");
  } finally {
    await gm.run(() => api.setFeature("jobs", true));
  }
  const on = await pl.run(() => until(() => !!el('[data-action="app"][data-app="quests"]'), "Jobs to come back"));
  check(on, "Jobs is back on the phone");
});

test("the GM blocks a contact from its card: the player can't text or call it; unblocking restores it", async ({ gm, pl, pc, contact }) => {
  const toggle = () =>
    gm.run(async a => {
      api.openConversation({ to: a.pc.id, from: a.contact });
      await until(() => text(".agent-thread-who")?.includes(a.pc.shown), "the conversation");
      await tap('[data-action="card"]');
      await tap('[data-action="toggle-block"]');
    }, { pc, contact });
  await toggle();
  try {
    const blocked = await pl.run(async a => {
      await go("messages");
      const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
      row.click();
      await until(() => text(".agent-thread-who")?.includes(a.contact) && el(".agent-compose"), "the conversation");
      return until(() => el('[data-action="send"]').disabled && !el('[data-action="call"]') && "blocked", "the conversation to be blocked");
    }, { contact });
    same(blocked, "blocked", "no sending or calling a blocked contact");
  } finally {
    await toggle();
  }
  const open = await pl.run(() => until(() => el('[data-action="send"]') && !el('[data-action="send"]').disabled, "Send to come back"));
  check(open, "unblocked, the player can text again");
});

test("texts only: the player has no Call button for the contact, and can still text", async ({ gm, pl, pc, contact }) => {
  const toggle = () =>
    gm.run(async a => {
      api.openConversation({ to: a.pc.id, from: a.contact });
      await until(() => text(".agent-thread-who")?.includes(a.pc.shown), "the conversation");
      await tap('[data-action="card"]');
      await tap('[data-action="toggle-calls"]');
    }, { pc, contact });
  await toggle();
  try {
    const r = await pl.run(async a => {
      await go("messages");
      const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
      row.click();
      await until(() => text(".agent-thread-who")?.includes(a.contact) && el(".agent-compose"), "the conversation");
      await until(() => !el('[data-action="call"]'), "the Call button to go");
      return { canSend: !el('[data-action="send"]').disabled };
    }, { contact });
    check(r.canSend, "texting still works");
  } finally {
    await toggle();
  }
});

test("the player asks for a number; the GM approves it and it's in their contacts", async ({ gm, pl, pc, prefix, tag }) => {
  const name = `${prefix}Ask ${tag}`;
  await pl.run(async a => {
    await go("contacts");
    await tap('[data-action="request-contact"]');
    const d = await dialog("Add a contact");
    inDialog(d, "input[name=name]", a.name);
    await press(d, "Request");
  }, { name });
  await gm.run(async a => {
    const req = await until(() => [...store.requests.values()].find(r => r.name === a.name), "the request at the host");
    await go("contacts");
    await tap(`[data-action="request-approve"][data-request-id="${req.id}"]`);
    const d = await dialog("Approve contact request");
    await press(d, "Approve");
  }, { name });
  const added = await pl.run(a => until(() => (game.actors.get(a.pc.id).getFlag(MODULE, "contacts") ?? []).some(c => c.name === a.name), "the new contact"), { pc, name });
  check(added, "the contact is on the player's list");
});

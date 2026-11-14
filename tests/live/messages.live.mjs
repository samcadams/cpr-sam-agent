/*
 * Texts between the GM Phone and a player's Agent, through the real phones: arriving, unread badges,
 * replying by typing, reactions, Viewed, hidden caller ID, PC to PC, deleting, sharing to chat, and the GM's
 * edit, delete and scheduled texts (host/texts.js).
 */

import { check, same, test } from "./lib.mjs";

/** Player: this character's "New texts" style (Settings → Look and dock): toast, open or none. */
const setNotify = (pl, pc, notify) =>
  pl.run(async a => {
    const actor = game.actors.get(a.pc.id);
    await actor.setFlag(MODULE, "phone", { ...(actor.getFlag(MODULE, "phone") ?? {}), notify: a.notify });
  }, { pc, notify });

test("New texts on Badge only: a GM text waits unread while the phone is away; opening it marks it read", async ({ gm, pl, pc, contact, tag }) => {
  await setNotify(pl, pc, "none");
  // Left on the inbox: a phone reopens where it was, and an open conversation is read at once.
  await pl.run(async () => (await go("messages"), await closePhone()));
  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} meet me at the Afterlife` }), { pc, contact, tag });

  const r = await pl.run(async a => {
    const find = () => store.findThread(a.pc.id, a.contact);
    const thread = await until(() => find()?.messages.some(m => m.text.includes(a.tag)) && find(), "the text to arrive");
    await sleep(500);
    const away = !root(); // Badge only: the phone stays in the pocket
    const before = store.unread(thread);
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    const rowUnread = row.classList.contains("unread");
    row.click();
    await until(() => store.unread(find()) === 0, "the conversation to be read");
    const bubble = els(".agent-bubble-text").some(e => e.textContent.includes(a.tag));
    return { away, before, rowUnread, bubble };
  }, { pc, contact, tag });
  check(r.away, "the phone stays put away");
  check(r.before > 0, "it arrives unread");
  check(r.rowUnread, "its inbox row is marked unread");
  check(r.bubble, "the conversation shows the text");
});

test("New texts as a pop-up: clicking it opens the phone on that conversation", async ({ gm, pl, pc, contact, tag }) => {
  await setNotify(pl, pc, "toast");
  await pl.run(() => closePhone());
  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} pop-up` }), { pc, contact, tag });
  const head = await pl.run(async a => {
    const toast = await until(() => [...document.querySelectorAll(".ctp-toast")].find(t => t.textContent.includes(a.tag)), "the pop-up");
    toast.querySelector(".ctp-toast-main").click();
    await until(() => root(), "the phone");
    return until(() => text(".agent-thread-who"), "the conversation");
  }, { contact, tag });
  check(head.includes(contact), `the phone opens on ${contact}'s conversation (got "${head}")`);
});

test("New texts on Open the phone: the phone opens itself on the conversation", async ({ gm, pl, pc, contact, tag }) => {
  await setNotify(pl, pc, "open");
  await pl.run(() => closePhone());
  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} open up` }), { pc, contact, tag });
  const head = await pl.run(() => until(() => root() && text(".agent-thread-who"), "the phone to open on the conversation"));
  check(head.includes(contact), `the phone opens on ${contact}'s conversation (got "${head}")`);
  await setNotify(pl, pc, "toast"); // back to the default
});

test("the player types a reply and sends it; the GM Phone has it from the PC", async ({ gm, pl, pc, contact, tag, lane }) => {
  const reply = `${tag} on my way`;
  await pl.run(async a => {
    await go("messages");
    // Still in the conversation from the last test, or open it again.
    if (!el(".agent-compose textarea")) {
      const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
      row.click();
    }
    await fill(".agent-compose textarea", a.reply);
    await tap('[data-action="send"]');
  }, { contact, reply });

  const got = await gm.run(async a => {
    const t = await until(() => store.findThread(a.pc.id, a.contact)?.messages.find(m => m.text === a.reply), "the reply at the host");
    api.openConversation({ to: a.pc.id, from: a.contact });
    await until(() => els(".agent-bubble-text").some(e => e.textContent.includes(a.reply)), "the reply on the GM Phone");
    return { from: t.from, user: t.userId === game.users.getName(`ClaudePlayer${a.lane}`).id };
  }, { pc, contact, reply, lane });
  same(got, { from: "pc", user: true }, "the reply is from the PC, sent by their player");
});

test("the GM marks the reply Viewed; the player sees it", async ({ gm, pl, pc, contact }) => {
  await gm.run(async a => {
    api.openConversation({ to: a.pc.id, from: a.contact });
    await tap('[data-action="set-viewed"]');
    await until(() => !el('[data-action="set-viewed"]'), "Set as Viewed to go once used");
  }, { pc, contact });
  const viewed = await pl.run(async a => {
    await until(() => store.findThread(a.pc.id, a.contact)?.viewed, "viewed to reach the player");
    return until(() => /Viewed|Read|Seen/i.test(root().querySelector(".agent-messages, .agent-thread")?.innerText ?? root().innerText), "the Viewed label");
  }, { pc, contact });
  check(viewed, "the player's conversation shows it was viewed");
});

test("a reaction from the player shows on the GM Phone", async ({ gm, pl, pc, contact, tag }) => {
  const emoji = await pl.run(async a => {
    const t = store.findThread(a.pc.id, a.contact);
    const msg = t.messages.findLast(m => m.from === "contact");
    await until(() => el(`[data-action="react-open"][data-message-id="${msg.id}"]`), "the react button");
    await tap(`[data-action="react-open"][data-message-id="${msg.id}"]`);
    const pick = await until(() => document.querySelector('#ctp-phone [data-action="pick-emoji"]'), "the emoji picker");
    const emoji = pick.dataset.emoji;
    pick.click();
    return { emoji, id: msg.id };
  }, { pc, contact, tag });
  const ok = await gm.run(async a => {
    return until(() => {
      const m = store.findThread(a.pc.id, a.contact).messages.find(m => m.id === a.id);
      return JSON.stringify(m.reactions ?? {}).includes(a.emoji);
    }, "the reaction at the host");
  }, { pc, contact, ...emoji });
  check(ok, "the GM sees the reaction");
});

test("hidden caller ID: the player sees Unknown Number and never the name, until the GM reveals it", async ({ gm, pl, pc, prefix, tag }) => {
  const ghost = `${prefix}Ghost ${tag}`; // a new caller each run: revealing makes the last one a named contact
  await gm.run(a => api.text({ to: a.pc.id, from: a.ghost, hidden: true, text: `${a.tag} you don't know me` }), { pc, ghost, tag });

  const seen = await pl.run(async a => {
    const t = await until(() => store.threadsFor(a.pc.id).find(t => t.messages.some(m => m.text.includes(a.tag))), "the hidden text");
    await go("messages");
    await sleep(300);
    // The player's copy carries the hidden caller ID label (Control → Labels) as its contact.
    return {
      leaked: JSON.stringify([...store.threads.values()]).includes(a.ghost),
      inbox: root().innerText.toLowerCase().includes(t.contact.toLowerCase()),
      shownAs: t.contact
    };
  }, { pc, ghost, tag });
  check(!seen.leaked, "the real name never reaches the player's client");
  check(seen.inbox, `the inbox shows the hidden caller ID label (${seen.shownAs})`);

  await gm.run(async a => {
    api.openConversation({ to: a.pc.id, from: a.ghost, hidden: true });
    await until(() => text(".agent-thread-who")?.includes(a.ghost), "the hidden conversation on the GM Phone");
    await tap('[data-action="card"]');
    await tap('[data-action="reveal"]');
    await until(() => !store.findThread(a.pc.id, a.ghost, true), "the hidden conversation to merge");
  }, { pc, ghost });
  const revealed = await pl.run(a => until(() => store.findThread(a.pc.id, a.ghost)?.messages.some(m => m.text.includes(a.tag)), "the named conversation"), { pc, ghost, tag });
  check(revealed, "after Reveal, the player has the text under the real name");
});

test("PC to PC: a text from one character reaches the other's phone", async ({ gm, pl, pc, other, tag }) => {
  await gm.run(a => api.addContact({ to: a.pc.id, actor: a.other.id }), { pc, other });
  await pl.run(async a => {
    await until(() => store.online, "online");
    store.request("send", { actorId: a.pc.id, contact: a.other.shown, text: `${a.tag} pc to pc` });
  }, { pc, other, tag });
  const mirrored = await gm.run(a => until(() => store.findThread(a.other.id, a.pc.shown)?.messages.find(m => m.text.includes(a.tag)), "the mirror thread"), { pc, other, tag });
  same(mirrored.from, "contact", "the other character receives it from the sender");
});

test("deleting a conversation removes it; a new text brings it back", async ({ gm, pl, pc, contact, tag }) => {
  await pl.run(async a => {
    await go("messages");
    if (el(".agent-compose")) await tap('[data-action="app"][data-app="messages"]'); // back to the inbox
    const t = store.findThread(a.pc.id, a.contact);
    const del = await until(() => {
      const row = els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact);
      return row?.querySelector('[data-action="clear-thread"]');
    }, "the row's delete button");
    del.click();
    // A confirm dialog may ask first.
    const yes = await until(() => document.querySelector('.dialog button[data-button="yes"], .dialog .dialog-button.yes') ?? (store.findThread(a.pc.id, a.contact) !== t ? "gone" : null), "the delete", 4000).catch(() => null);
    if (yes instanceof HTMLElement) yes.click();
    await until(() => !els('[data-action="open-thread"]').some(e => e.dataset.contact === a.contact), "the row to go");
  }, { pc, contact });

  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} you there?` }), { pc, contact, tag });
  const back = await pl.run(a => until(() => els('[data-action="open-thread"]').some(e => e.dataset.contact === a.contact), "the row to come back"), { contact });
  check(back, "the conversation comes back with the new text");
});

test("the GM edits a sent text and deletes another; the player's phone follows, and the player has no tools", async ({ gm, pl, pc, contact, tag }) => {
  const [first, second] = [`${tag} edit me`, `${tag} delete me`];
  for (const t of [first, second]) await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: a.t }), { pc, contact, t });
  await pl.run(async a => {
    await until(() => store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text === a.second), "both texts");
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    await until(() => els(".agent-bubble-text").some(e => e.textContent.includes(a.second)), "the conversation");
  }, { pc, contact, second });
  same(await pl.run(() => els('[data-action="text-edit"], [data-action="text-delete"], [data-action="schedule"]').length), 0, "the player sees no edit, delete or schedule buttons");

  const edited = `${tag} edited`;
  await gm.run(async a => {
    api.openConversation({ to: a.pc.id, from: a.contact });
    const msgs = () => store.findThread(a.pc.id, a.contact).messages;
    const id = await until(() => msgs().find(m => m.text === a.first)?.id, "the first text");
    await tap(`[data-action="text-edit"][data-message-id="${id}"]`);
    const d = await dialog("Edit text");
    inDialog(d, 'textarea[name="text"]', a.edited);
    await press(d, "Save");
    await until(() => msgs().some(m => m.text === a.edited), "the edit at the GM");
    const gone = await until(() => msgs().find(m => m.text === a.second)?.id, "the second text");
    await tap(`[data-action="text-delete"][data-message-id="${gone}"]`);
    await press(await dialog("Delete text"), "Yes");
    await until(() => !msgs().some(m => m.text === a.second), "the delete at the GM");
  }, { pc, contact, first, second, edited });

  const seen = await pl.run(a => until(() => {
    const shown = els(".agent-bubble-text").map(e => e.textContent);
    return shown.some(t => t.includes(a.edited)) && !shown.some(t => t.includes(a.second)) && !shown.some(t => t.includes(a.first)) && { shown, edited: !/edited/i.test(text(".agent-messages").replace(a.edited, "")) };
  }, "the player's phone to follow"), { first, second, edited });
  check(seen.edited, "no Edited mark on the player's phone");
});

test("the GM schedules a text: it waits on the GM Phone only, can be cancelled, and sends when its time comes", async ({ gm, pl, pc, contact, tag }) => {
  const [later, cancel] = [`${tag} scheduled`, `${tag} cancelled`];
  const r = await gm.run(async a => {
    api.openConversation({ to: a.pc.id, from: a.contact });
    await tap('[data-action="schedule"]'); // empty box: a warning, no dialog
    const noDialog = ![...document.querySelectorAll(".app.dialog, .application.dialog")].some(d => d.textContent.includes("Schedule text"));
    // The schedule dialog opens with the phones' clock as its starting values.
    await fill(".agent-compose textarea", a.cancel);
    await tap('[data-action="schedule"]');
    const d = await dialog("Schedule text");
    d.querySelector(".header-button.close, [data-action=\"close\"]").click(); // closed: nothing scheduled
    const thread = store.findThread(a.pc.id, a.contact);
    const req = text => ({ type: "send", threadId: thread.id, actorId: a.pc.id, contact: a.contact, text });
    store.request("schedule-text", { at: Date.now() + 3_600_000, unit: "real", request: req(a.cancel) });
    store.request("schedule-text", { at: Date.now() + 2_000, unit: "real", request: req(a.later) });
    await until(() => els(".agent-scheduled-text").length >= 2, "the scheduled list");
    const listed = text(".agent-scheduled");
    const id = [...store.scheduled.values()].find(s => s.request.text === a.cancel).id;
    await tap(`[data-action="unschedule"][data-scheduled-id="${id}"]`);
    await until(() => !store.scheduled.has(id), "the cancel");
    return { noDialog, listed: listed.includes(a.later) && listed.includes(a.cancel) };
  }, { pc, contact, later, cancel });
  check(r.noDialog, "an empty box doesn't open the schedule dialog");
  check(r.listed, "both scheduled texts are listed above the box");
  same(await pl.run(() => store.scheduled.size), 0, "the player's phone never has scheduled texts");

  // The host's clock tick (every 30 s) sends it.
  const got = await pl.run(async a => {
    const msgs = () => store.findThread(a.pc.id, a.contact)?.messages ?? [];
    await until(() => msgs().some(m => m.text === a.later), "the scheduled text", 45_000);
    await sleep(500);
    return msgs().some(m => m.text === a.cancel);
  }, { pc, contact, later, cancel });
  check(!got, "the cancelled text never sends");
  same(await gm.run(a => [...store.scheduled.values()].filter(s => s.request.text.startsWith(a.tag)).length, { tag }), 0, "nothing of ours is left scheduled");
});

test("sharing texts posts a chat card with them", async ({ pl, pc, contact, tag }) => {
  const card = await pl.run(async a => {
    const t = store.findThread(a.pc.id, a.contact);
    const msg = t.messages.findLast(m => m.text.includes(a.tag));
    const before = game.messages.size;
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    await tap('[data-action="share-start"]');
    await tap(`[data-action="share-pick"][data-message-id="${msg.id}"]`);
    await tap('[data-action="share-post"]');
    const chat = await until(() => game.messages.size > before && game.messages.contents.at(-1), "the chat card");
    return { html: chat.content.includes(a.tag), author: chat.author?.id === game.user.id || chat.user?.id === game.user.id };
  }, { pc, contact, tag });
  check(card.html, "the chat card carries the shared text");
});

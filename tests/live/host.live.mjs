/*
 * The host: what it saves survives a reload of the GM's client, and players are served again after it.
 */

import { check, gm as gmClient, test } from "./lib.mjs";

test("texts survive the host reloading, and the player is served again afterwards", async ({ gm, pl, pc, contact, tag }) => {
  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} before the reload` }), { pc, contact, tag });
  await gm.run(async a => {
    await until(() => store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text.includes(a.tag)), "the text");
    // Saves are batched (500 ms) and then uploaded. A reload sooner than that would warn "Leave site?"
    // (see the next test), so wait for the write here.
    await sleep(700);
    await store._writing;
  }, { pc, contact, tag });
  await gmClient.reload();
  const kept = await gm.run(async a => {
    await until(() => game.ready && store.isHost && store.online, "the host to load again", 60000);
    return store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text.includes(`${a.tag} before the reload`));
  }, { pc, contact, tag });
  check(kept, "the text is loaded back from the world's cpr-sam-agent folder");

  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} after the reload` }), { pc, contact, tag });
  const served = await pl.run(a => until(() => store.findThread(a.pc.id, a.contact)?.messages.some(m => m.text.includes(`${a.tag} after the reload`)), "the next text", 15000), { pc, contact, tag });
  check(served, "the player gets texts from the reloaded host");
});

test("the host warns before leaving while a text is still waiting to be saved", async ({ gm, pc, contact, tag }) => {
  const r = await gm.run(async a => {
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await sleep(700);
    await store._writing;
    const idle = { unsaved: store.hasUnsavedChanges(), warned: leave() };
    await api.text({ to: a.pc.id, from: a.contact, text: `${a.tag} just before leaving` });
    const pending = { unsaved: store.hasUnsavedChanges(), warned: leave() };
    // The warning starts the save right away instead of after the batch delay.
    await until(() => !store.hasUnsavedChanges(), "the save to finish", 5000);
    return { idle, pending, after: { unsaved: store.hasUnsavedChanges(), warned: leave() } };
  }, { pc, contact, tag });
  check(!r.idle.unsaved && !r.idle.warned, `no warning with nothing to save: ${JSON.stringify(r.idle)}`);
  check(r.pending.unsaved && r.pending.warned, `"Leave site?" while the text waits to be saved: ${JSON.stringify(r.pending)}`);
  check(!r.after.unsaved && !r.after.warned, `no warning once it's saved: ${JSON.stringify(r.after)}`);
});

/*
 * The phone's hardware (ui/phone/core/bezel.js): the LED, earpiece and camera in the header, and the
 * live states on the window: ringing, on a call, unread texts.
 */

import { check, same, test } from "./lib.mjs";

/** The player's phone window's hardware classes. */
const hw = () => [...document.querySelector("#ctp-phone").classList].filter(c => c.startsWith("hw-")).sort();

test("the bezel rings with an incoming call, glows on the call and goes dark after", async ({ gm, pl, pc, contact }) => {
  await gm.run(() => api.endCalls());
  await pl.run(() => go("messages"));
  const parts = await pl.run(() => [...el(".agent-bezel")?.closest(".window-app").querySelectorAll(".window-header .agent-bezel > span") ?? []].map(s => s.className));
  same(parts, ["agent-led", "agent-earpiece", "agent-camera"], "the header carries the LED, earpiece and camera");

  await gm.run(a => api.call({ to: a.pc.id, from: a.contact }), { pc, contact });
  try {
    const ringing = await pl.run(async hwSrc => {
      const hw = eval(hwSrc);
      await until(() => el('[data-action="call-answer"]'), "the incoming call screen");
      await until(() => hw().includes("hw-ring"), "the bezel to ring");
      const ring = hw();
      await tap('[data-action="call-answer"]');
      await until(() => hw().includes("hw-call"), "the bezel to show the call");
      const call = hw();
      await sleep(500);
      await tap('[data-action="call-hangup"]');
      await until(() => !store.myCall() && !hw().some(c => c === "hw-ring" || c === "hw-call"), "the bezel to go dark");
      return { ring, call };
    }, hw.toString());
    check(ringing.ring.includes("hw-ring") && !ringing.ring.includes("hw-call"), `ringing: hw-ring only (got ${ringing.ring})`);
    check(ringing.call.includes("hw-call") && !ringing.call.includes("hw-ring"), `answered: hw-call only (got ${ringing.call})`);
  } finally {
    await gm.run(() => api.endCalls());
  }
});

test("the LED shows unread texts, and goes out with the last of them", async ({ gm, pl, pc, contact, tag }) => {
  await pl.run(() => go("home"));
  await gm.run(a => api.text({ to: a.pc.id, from: a.contact, text: `bezel ${a.tag}` }), { pc, contact, tag });
  const r = await pl.run(async a => {
    const hw = eval(a.hwSrc);
    await until(() => hw().includes("hw-unread"), "the LED to light for the new text");
    await go("messages");
    const row = await until(() => els('[data-action="open-thread"]').find(e => e.dataset.contact === a.contact), "the inbox row");
    row.click();
    await until(() => el(".agent-messages"), "the conversation");
    // Other conversations may still wait unread (earlier runs): the LED follows the Messages badge.
    const p = await phone();
    await sleep(500);
    return { lit: hw().includes("hw-unread"), badge: p.dockBadge(p._ctx, "messages").badge };
  }, { contact, hwSrc: hw.toString() });
  same(r.lit, r.badge > 0, `after reading, the LED is lit only while texts wait unread (badge ${r.badge})`);
});

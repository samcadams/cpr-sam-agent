/*
 * Notifications on an open phone drop in as banners on its screen (ui/Toasts.js `phone`), and wait
 * in the notification center pulled down from the status bar (ui/phone/core/shade.js).
 */

import { check, same, test } from "./lib.mjs";

test("an Agent alert drops in as a banner on the open phone, waits in the center and is answered there", async ({ gm, pl, pc, tag }) => {
  await pl.run(() => go("home"));
  await gm.run(a => api.alert({ to: a.pc.id, text: `center ${a.tag}`, choices: ["Go", "Wait"] }), { pc, tag });
  const r = await pl.run(async a => {
    const win = root().closest(".window-app") ?? root();
    const banner = await until(() => [...win.querySelectorAll(":scope > .ctp-banners .ctp-toast")].find(t => t.textContent.includes(a.text)), "the banner on the phone");
    const beside = [...document.querySelectorAll("#ctp-toasts .ctp-toast")].some(t => t.textContent.includes(a.text));
    const alert = Object.values(store.apps.alerts).find(x => x.text === a.text);
    if (!el(".agent-shade")) await tap('.agent-statusbar[data-action="shade"]');
    const row = await until(() => els(".agent-shade-item").find(e => e.textContent.includes(a.text)), "the alert in the center");
    const choices = [...row.querySelectorAll('[data-action="alert-answer"]')].map(b => b.textContent.trim());
    hit(row.querySelector('[data-action="alert-answer"][data-choice="Wait"]'));
    await until(() => store.apps.alerts[alert.id]?.answer === "Wait", "the answer to reach the host");
    return { banner: !!banner, beside, choices, count: Number(text(".agent-shade-count")) || 0 };
  }, { text: `center ${tag}` });
  check(r.banner, "the alert shows as a banner on the open phone");
  check(!r.beside, "not beside the phone button while the phone is up");
  same(r.choices, ["Go", "Wait"], "the alert's answers are buttons in the center");
  check(r.count >= 1, "the status bar counts what waits");
});

test("clearing an alert from the center keeps it in the Agent app's log; Clear all empties the center", async ({ pl }) => {
  const r = await pl.run(async () => {
    const p = await phone();
    if (!p.shadeOpen) await tap('.agent-statusbar[data-action="shade"]');
    await until(() => el(".agent-shade"), "the center");
    const mine = () => Object.values(store.apps.alerts).filter(x => x.actorId === p._ctx.actorId);
    const logged = mine().length;
    if (el('[data-action="shade-clear-all"]')) await tap('[data-action="shade-clear-all"]');
    await until(() => !p.shadeItems(p._ctx, { all: true }).some(i => i.kind === "alert" && !i.pending), "the answered alerts to clear");
    return { logged, still: mine().length, texts: p.shadeItems(p._ctx, { all: true }).filter(i => i.kind === "text").length, rows: els(".agent-shade-item").length };
  });
  same(r.still, r.logged, "cleared alerts stay in the Agent's log");
  check(r.rows >= r.texts, "unread texts stay in the center");
  await pl.run(async () => {
    await tap('.agent-shade-handle[data-action="shade"]');
    await until(() => !el(".agent-shade"), "the center to close");
  });
});

test("a GM card shows on the open GM Phone as a banner, waits in its center, and its button clears it", async ({ gm, tag }) => {
  const r = await gm.run(async a => {
    await go("home");
    store._gmCard({ id: `live:${a.tag}`, title: "Live card", body: a.tag, icon: "fa-bell", actions: [{ label: "Noted", icon: "fa-check", request: "alert-clear", data: { alertIds: [] } }] });
    const win = root().closest(".window-app") ?? root();
    const banner = await until(() => [...win.querySelectorAll(":scope > .ctp-banners .ctp-toast")].some(t => t.textContent.includes(a.tag)), "the banner on the GM Phone");
    if (!el(".agent-shade")) await tap('.agent-statusbar[data-action="shade"]');
    const row = await until(() => els(".agent-shade-item").find(e => e.textContent.includes(a.tag)), "the card in the center");
    hit(row.querySelector('[data-action="shade-card-action"]'));
    await until(() => !store.apps.gmCards[`live:${a.tag}`], "the card to clear");
    const p = await phone();
    p.shadeOpen = false;
    p.render();
    return { banner };
  }, { tag });
  check(r.banner, "the GM card shows as a banner on the GM Phone");
}, { player: false });

/*
 * Handprint Scanner and Retina Scanner (apps/handscan/, apps/retinascan/): the player scans the lane's NPC token's
 * hand (the sheet's Brawling roll; DV 1 here so a roll always succeeds), a can't-move round, the GM voids one
 * round and confirms the rest on the GM Phone, the record lands in the vault; the GM marks it stale and the player
 * still sees it unchanged. Then a retina scan starts on the Retina Scanner and is stopped. Failed rolls, prints,
 * MicroVideo and the refusals are unit-tested (tests/bioscan.test.js).
 */

import { check, same, test } from "./lib.mjs";

/** Both apps on and installed, DV 1, and the lane's NPC standing next to the PC (in sight), its name shown. */
const ready = (gm, pc, npc, player) => gm.run(async a => {
  for (const app of ["handscan", "retinascan"]) {
    if (!api.feature(`app_${app}`)) await api.setFeature(`app_${app}`, true);
    if (api.pool?.on() && !api.pool.has(a.pc.id, app)) await api.pool.grant({ actor: a.pc.id, app });
  }
  await game.settings.set("cpr-sam-agent", "bioscan", { dv: 1, confirm: true });
  const scene = game.users.get(a.player).viewedScene ? game.scenes.get(game.users.get(a.player).viewedScene) : game.scenes.active;
  if (!scene) throw new Error("the player isn't viewing a scene");
  let pcToken = scene.tokens.find(t => t.actorId === a.pc.id);
  if (!pcToken) {
    const d = scene.dimensions;
    const spot = { x: d.sceneX + 2 * scene.grid.size, y: d.sceneY + 2 * scene.grid.size, hidden: false };
    [pcToken] = await scene.createEmbeddedDocuments("Token", [{ ...(await game.actors.get(a.pc.id).getTokenDocument()).toObject(), ...spot }]);
  }
  let token = scene.tokens.find(t => t.actorId === a.npc.id);
  const at = { x: pcToken.x + scene.grid.size, y: pcToken.y, hidden: false, displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS };
  if (token) await token.update(at);
  else [token] = await scene.createEmbeddedDocuments("Token", [{ ...(await game.actors.get(a.npc.id).getTokenDocument()).toObject(), ...at }]);
  return { tokenId: token.id };
}, { pc, npc, player });

/** The player's next round: the button, then the sheet's roll dialog if the sheet has the skill. Resolves on the new pip. */
const roundAs = (pl, id, auto = false) => pl.run(async a => {
  const scan = () => store.apps.bioScans[a.id];
  const before = scan().pips.length;
  await tap(`[data-action="bio-round"][data-id="${a.id}"]${a.auto ? "[data-auto]" : ":not([data-auto])"}`);
  await until(() => {
    if (!a.auto) (document.querySelector(".cpr-dialog-button[autofocus]") ?? [...document.querySelectorAll(".cpr-dialog-button")].find(e => /roll|confirm/i.test(e.textContent)))?.click();
    return scan()?.pips.length > before;
  }, "the round on the phone");
  return scan().pips.at(-1).status;
}, { id, auto });

const gmAnswer = (gm, id, index, action) => gm.run(async a => {
  await go("handscan");
  await tap(`[data-action="${a.action}"][data-id="${a.id}"][data-index="${a.index}"]`);
  await until(() => store.apps.bioScans[a.id]?.pips[a.index]?.status !== "pending", "the GM's answer");
}, { id, index, action });

test("Biometrics: scan a hand over four rounds, the GM voids one and confirms the rest, the record is in the vault; stale is the GM's", async ({ gm, pl, pc, npc, player, tag }) => {
  const { tokenId } = await ready(gm, pc, npc, player);
  const label = `${tag} Kenji, lobby`;
  const started = await pl.run(async a => {
    await go("handscan");
    await tap('[data-action="bio-new"][data-method="direct"]');
    const option = await until(() => el(`[data-action="bio-pick"][data-token-id="${a.tokenId}"]`), "the NPC among the people in sight");
    await tap(`[data-action="bio-pick"][data-token-id="${a.tokenId}"]`);
    const prefill = el("[name=bioLabel]").value;
    await tap('[data-action="bio-side"][data-side="left"]');
    await fill("[name=bioLabel]", a.label);
    await tap('[data-action="bio-start"]');
    const scan = await until(() => Object.values(store.apps.bioScans).find(s => s.label === a.label), "the scan on the player's phone");
    await until(() => el(`[data-action="bio-round"][data-id="${scan.id}"]`), "the scan screen");
    return { id: scan.id, name: option.textContent.trim(), prefill, side: scan.side, secret: "subjectActorId" in scan, pips: root().querySelectorAll(".agent-bio-scanner .agent-bio-pip").length };
  }, { tokenId, label });
  same(started.name, npc.name, "the NPC's shown name");
  check(started.prefill.startsWith(npc.name), `the label starts from the token's name and the scene ("${started.prefill}")`);
  same(started.side, "left", "the hand picked");
  check(!started.secret, "the player's copy doesn't say who the subject is");
  same(started.pips, 3, "three pips for a handprint");

  same(await roundAs(pl, started.id), "pending", "a good round waits for the GM");
  const gmView = await gm.run(async a => {
    await go("handscan");
    const card = await until(() => el(`.agent-bio-pending[data-scan="${a.id}"]`), "the round on the GM Phone");
    return { text: card.innerText, subject: store.apps.bioScans[a.id].subjectActorId };
  }, { id: started.id });
  same(gmView.subject, npc.id, "the GM gets the actor behind the token");
  check(/Brawling \d+ vs DV 1/.test(gmView.text), `the GM sees the roll (${gmView.text.replace(/\s+/g, " ").slice(0, 120)})`);
  await gmAnswer(gm, started.id, 0, "bio-void");
  same(await roundAs(pl, started.id, true), "pending", "can't move waits for the GM");
  await gmAnswer(gm, started.id, 1, "bio-confirm");
  await roundAs(pl, started.id);
  await gmAnswer(gm, started.id, 2, "bio-confirm");
  const shown = await pl.run(async a => {
    await go("handscan");
    await tap(`[data-action="bio-open"][data-id="${a.id}"]`).catch(() => {});
    await until(() => root().querySelectorAll(".agent-bio-scanner .agent-bio-pip.ok").length === 2, "two solid pips");
    return root().querySelector(".agent-bio-count")?.textContent.trim();
  }, { id: started.id });
  same(shown, "2/3", "two of three counted, the voided round doesn't");
  await roundAs(pl, started.id);
  await gmAnswer(gm, started.id, 3, "bio-confirm").catch(() => {}); // the scan is gone once it's done

  const vault = await pl.run(async a => {
    await go("handscan");
    const record = await until(() => Object.values(store.apps.bioRecords).find(r => r.label === a.label), "the record in the vault");
    const row = await until(() => el(`.agent-bio-record[data-record="${record.id}"]`), "the record card");
    return { id: record.id, text: row.innerText, scanGone: !store.apps.bioScans[a.id], secret: "subjectActorId" in record };
  }, { id: started.id, label });
  check(vault.scanGone, "the finished scan left In progress");
  check(/Left hand · Direct scan/.test(vault.text), `the record card (${vault.text.replace(/\s+/g, " ")})`);
  check(!vault.secret, "the player's record doesn't say who it is");

  const stale = await gm.run(async a => {
    await go("handscan");
    const details = el('[data-section="bioRecords"]');
    if (details && !details.open) details.open = true;
    await fill(`input[name=bioStale][data-id="${a.id}"]`, "lock re-keyed");
    document.activeElement?.blur(); // as a real tap on Mark stale does: the phone holds redraws while a text box has focus
    await tap(`[data-action="bio-stale"][data-id="${a.id}"]`);
    await until(() => store.apps.bioRecords[a.id]?.stale, "the stale mark");
    return (await until(() => el(`[data-record="${a.id}"].agent-bio-stale`), "STALE on the GM Phone")).innerText;
  }, { id: vault.id });
  check(/STALE/.test(stale) && /lock re-keyed/.test(stale), "the GM sees STALE and the reason");
  const after = await pl.run(async a => {
    await go("handscan");
    await new Promise(r => setTimeout(r, 500));
    return { stale: "stale" in (store.apps.bioRecords[a.id] ?? {}), text: el(`.agent-bio-record[data-record="${a.id}"]`)?.innerText ?? "" };
  }, { id: vault.id });
  check(!after.stale && !/stale/i.test(after.text), "the player's record is unchanged");
});

test("Biometrics: the Retina Scanner draws its own page; a retina scan needs five rounds and can be stopped", async ({ gm, pl, pc, npc, player, tag }) => {
  const { tokenId } = await ready(gm, pc, npc, player);
  const out = await pl.run(async a => {
    await go("retinascan");
    const handsHere = !!el('[data-action="bio-new"][data-method="print"]');
    await tap('[data-action="bio-new"][data-method="direct"]');
    await tap(`[data-action="bio-pick"][data-token-id="${a.tokenId}"]`);
    const sides = !!el('[data-action="bio-side"]');
    await fill("[name=bioLabel]", `${a.tag} eye`);
    await tap('[data-action="bio-start"]');
    const scan = await until(() => Object.values(store.apps.bioScans).find(s => s.label === `${a.tag} eye`), "the retina scan");
    await until(() => el(`[data-action="bio-round"][data-id="${scan.id}"]`), "the scan screen");
    const pips = root().querySelectorAll(".agent-bio-scanner .agent-bio-pip").length;
    store.request("bio-cancel", { id: scan.id });
    await until(() => !store.apps.bioScans[scan.id], "the scan stopped");
    return { handsHere, sides, pips, kind: scan.kind };
  }, { tokenId, tag });
  check(!out.handsHere && !out.sides, "no prints or hands on the Retina Scanner");
  same([out.kind, out.pips], ["retina", 5], "a retina, five pips");
  await gm.run(() => game.settings.set("cpr-sam-agent", "bioscan", {}));
});

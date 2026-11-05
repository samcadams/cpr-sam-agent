/*
 * NCPD Crime Database (apps/ncpd/): the player snaps the lane's NPC token in sight and submits it (the host
 * rolls the shot: the lane's PC has no Photography/Film skill item); the GM sees who it is, fills in the
 * record card (a warrant, a bounty that becomes a hidden Job) and delivers it early; the player reads the
 * record. A second lookup of the same NPC starts from the record on file. Then: flagging a delivered lookup
 *, Night City only, and the records archive. World time isn't moved (other lanes share
 * it): the reminders are unit-tested.
 */

import { check, same, test } from "./lib.mjs";

/** The app on, installed, and the lane's NPC standing next to the PC (in sight), its name shown. */
const ready = (gm, pc, npc, player) => gm.run(async a => {
  if (!api.feature("app_ncpd")) await api.setFeature("app_ncpd", true);
  if (api.pool?.on() && !api.pool.has(a.pc.id, "ncpd")) await api.pool.grant({ actor: a.pc.id, app: "ncpd" });
  // The scene the player is looking at, with the PC's token on it.
  const scene = game.users.get(a.player).viewedScene ? game.scenes.get(game.users.get(a.player).viewedScene) : game.scenes.active;
  if (!scene) throw new Error("the player isn't viewing a scene");
  // Whatever the lane's character is, it needs a token there: put one near the scene's top-left corner if it has none.
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
  return { tokenId: token.id, sceneId: scene.id };
}, { pc, npc, player });

test("NCPD: snap the NPC in sight, the GM fills in the record and delivers it; the next lookup starts from it", async ({ gm, pl, pc, npc, player, tag, prefix }) => {
  const { tokenId } = await ready(gm, pc, npc, player);
  const caption = `${tag} outside Lizzie's`;
  const snap = await pl.run(async a => {
    await go("ncpd");
    await tap('[data-action="ncpd-new"]');
    const option = await until(() => el(`[data-action="ncpd-pick"][data-token-id="${a.tokenId}"]`), "the NPC among the people in sight");
    const name = option.textContent.trim();
    await tap(`[data-action="ncpd-pick"][data-token-id="${a.tokenId}"]`);
    await fill("[name=ncpdCaption]", a.caption);
    await tap('[data-action="ncpd-submit"]');
    // A character with the skill rolls it with the sheet's roll dialog (one without: the host rolls): confirm it.
    const lookup = await until(() => {
      (document.querySelector(".cpr-dialog-button[autofocus]") ?? [...document.querySelectorAll(".cpr-dialog-button")].find(e => /roll|confirm/i.test(e.textContent)))?.click();
      return Object.values(store.apps.ncpdLookups).find(l => l.caption === a.caption);
    }, "the lookup on the player's phone");
    await until(() => /Processing[\s\S]*results within/.test(root().innerText), "Processing… and when it's due, on the phone");
    return { name, num: lookup.num, id: lookup.id, secret: "subject" in lookup || "gm" in lookup, eta: /results within/.test(root().innerText) };
  }, { tokenId, caption });
  same(snap.name, npc.name, "the NPC's shown name (its token shows it)");
  check(!snap.secret, "the player's copy has no subject or GM notes");
  check(snap.eta, "the player sees when results are due");

  const name = `${tag} Royce`;
  const gmSide = await gm.run(async a => {
    const l = await until(() => store.apps.ncpdLookups[a.id], "the lookup at the GM");
    await go("ncpd");
    await until(() => el(`[data-lookup="${a.id}"]`), "the lookup on the GM Phone");
    const subject = el(`[data-lookup="${a.id}"] [data-action="ncpd-open-actor"]`)?.dataset.actorId;
    const rolled = /usable shot|unusable shot/.test(el(`[data-lookup="${a.id}"]`).innerText);
    // A record, whatever the shot did.
    const kind = el(`[data-lookup="${a.id}"] input[data-ncpd-field="kind"][value="record"]`);
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    await fill(`[data-ncpd-field="record.name"][data-id="${a.id}"]`, a.name);
    await tap(`[data-action="ncpd-row-add"][data-id="${a.id}"][data-list="warrants"]`);
    await fill(`[data-ncpd-field="record.warrants.0.charge"][data-id="${a.id}"]`, "Murder");
    await tap(`[data-action="ncpd-row-add"][data-id="${a.id}"][data-list="bounties"]`);
    await fill(`[data-ncpd-field="record.bounties.0.amount"][data-id="${a.id}"]`, "5000");
    const jobs = store.quests.size;
    await tap(`[data-action="ncpd-job"][data-id="${a.id}"][data-index="0"]`);
    const job = await until(() => store.quests.size > jobs && [...store.quests.values()].find(q => q.name === `Bounty: ${a.name}`), "the bounty's Job");
    await tap(`[data-action="ncpd-deliver"][data-id="${a.id}"]`);
    await until(() => l.status === "delivered", "delivered");
    return { subject, rolled, roll: l.roll?.total, job: { hidden: job.hidden, description: job.description }, saved: Object.values(store.apps.ncpdRecords).find(r => r.actorId === a.npc.id)?.name };
  }, { id: snap.id, name, npc });
  same(gmSide.subject, npc.id, "the GM sees the actor behind the token");
  check(gmSide.rolled && Number.isFinite(gmSide.roll), `the shot was rolled (${gmSide.roll})`);
  check(gmSide.job.hidden && /5,?000/.test(gmSide.job.description), "the bounty became a hidden Job");
  same(gmSide.saved, name, "the record is archived, linked to the NPC");

  const contact = `${prefix}Fixer`;
  await gm.run(async a => {
    const actor = game.actors.get(a.pc);
    const contacts = actor.getFlag("cpr-sam-agent", "contacts") ?? [];
    if (!contacts.some(c => c.name === a.contact)) await actor.setFlag("cpr-sam-agent", "contacts", [...contacts, { name: a.contact }]);
  }, { pc: pc.id, contact });
  const card = await pl.run(async a => {
    await go("ncpd");
    const rec = await until(() => el(".agent-ncpd-record"), "the record card");
    const wanted = !!el(".agent-ncpd-record.wanted");
    const row = rec.innerText;
    await tap(".agent-ncpd-record");
    const file = await until(() => document.querySelector(".ncpd-file"), "the printed file");
    const out = { row, text: file.innerText, wanted, stamped: !!file.querySelector(".ncpd-file-stamp"), photo: file.querySelector("img")?.naturalWidth > 0 };
    const w = file.closest(".window-app");
    const before = game.messages.size;
    w.querySelector("[data-ncpd=chat]").click();
    out.chat = await until(() => game.messages.size > before && game.messages.contents.at(-1).content, "the chat card");
    w.querySelector("[data-ncpd=send]").click();
    const d = await dialog("Send to");
    inDialog(d, "[name=contact]", a.contact);
    await press(d, "Write the text");
    out.message = (await until(() => el(".agent-compose textarea"), "the conversation's message box")).value;
    w.querySelector(".header-button.close")?.click();
    await go("ncpd");
    return out;
  }, { contact });
  check(card.row.includes(name), "the player's list shows who the record is on");
  check(card.text.includes(name) && card.text.includes("Murder"), "selecting it opens the file, and the player reads the record");
  check(card.wanted && card.stamped, "warrants and bounties mark it WANTED, on the row and stamped on the file");
  check(card.photo, "the file shows the submitted photo");
  check(card.chat.includes(name) && card.chat.includes("active warrant"), "Share to chat posts the record's card");
  check(card.message.includes(name) && card.message.includes("Murder"), "Send to… opens the contact's conversation with the record typed in, unsent");

  // Again: the GM's card starts from the record on file.
  const again = await pl.run(async a => {
    await go("ncpd");
    await tap('[data-action="ncpd-new"]');
    await tap(`[data-action="ncpd-pick"][data-token-id="${a.tokenId}"]`);
    await fill("[name=ncpdCaption]", `${a.tag} again`);
    await tap('[data-action="ncpd-submit"]');
    return (await until(() => {
      (document.querySelector(".cpr-dialog-button[autofocus]") ?? [...document.querySelectorAll(".cpr-dialog-button")].find(e => /roll|confirm/i.test(e.textContent)))?.click(); // the sheet's roll dialog, if it has the skill
      return Object.values(store.apps.ncpdLookups).find(l => l.caption === `${a.tag} again`);
    }, "the second lookup")).id;
  }, { tokenId, tag });
  const prefilled = await gm.run(async a => {
    await go("ncpd");
    await until(() => el(`[data-lookup="${a.id}"]`), "the second lookup on the GM Phone");
    const kind = el(`[data-lookup="${a.id}"] input[data-ncpd-field="kind"][value="record"]`);
    if (!kind.checked) {
      kind.checked = true;
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const field = await until(() => el(`[data-ncpd-field="record.name"][data-id="${a.id}"]`), "the name field");
    const out = { name: field.value, onFile: /record on file/.test(el(`[data-lookup="${a.id}"]`).innerText) };
    store.request("ncpd-delete", { id: a.id });
    return out;
  }, { id: again });
  same(prefilled.name, name, "the second card starts from the saved record");
  check(prefilled.onFile, "and says so");
});

/** The player snaps the NPC's token with this caption. Returns the lookup's id, or null when nothing arrives. */
const snapNpc = (pl, tokenId, caption, timeout = 8000) => pl.run(async a => {
  await go("ncpd");
  await tap('[data-action="ncpd-new"]');
  await tap(`[data-action="ncpd-pick"][data-token-id="${a.tokenId}"]`);
  await fill("[name=ncpdCaption]", a.caption);
  await tap('[data-action="ncpd-submit"]');
  const found = await until(() => {
    (document.querySelector(".cpr-dialog-button[autofocus]") ?? [...document.querySelectorAll(".cpr-dialog-button")].find(e => /roll|confirm/i.test(e.textContent)))?.click();
    return Object.values(store.apps.ncpdLookups).find(l => l.caption === a.caption);
  }, "the lookup", a.timeout).catch(() => null);
  if (!found) await tap('[data-action="ncpd-back"]').catch(() => {});
  return found?.id ?? null;
}, { tokenId, caption, timeout });

test("NCPD: flag a delivered lookup after the fact, and unflag it; the player isn't told", async ({ gm, pl, pc, npc, player, tag }) => {
  const { tokenId } = await ready(gm, pc, npc, player);
  const id = await snapNpc(pl, tokenId, `${tag} flag later`);
  check(id, "the lookup");
  const out = await gm.run(async a => {
    const l = await until(() => store.apps.ncpdLookups[a.id], "the lookup at the GM");
    store.request("ncpd-deliver", { id: a.id, result: { kind: "none" } });
    await until(() => l.status === "delivered", "delivered");
    await go("ncpd");
    await tap(`[data-action="ncpd-flag"][data-id="${a.id}"]`);
    await until(() => l.gm.flagged === true, "flagged");
    const shown = await until(() => el(`[data-action="ncpd-flag"][data-id="${a.id}"].on`), "the flag on in Delivered");
    await tap(`[data-action="ncpd-flag"][data-id="${a.id}"]`);
    await until(() => l.gm.flagged === false, "unflagged");
    return { shown: !!shown };
  }, { id });
  check(out.shown, "Delivered shows the flag");
  const mine = await pl.run(async a => {
    const l = store.apps.ncpdLookups[a.id];
    await go("ncpd");
    return { gm: "gm" in l, icon: !!el(".fa-flag, [data-action=ncpd-flag]") };
  }, { id });
  check(!mine.gm, "the player's copy has no GM notes");
  check(!mine.icon, "no flag on the player's phone");
});

test("NCPD: Night City only refuses a submit from a scene marked outside it; the archive keeps a record with no token", async ({ gm, pl, pc, npc, player, tag }) => {
  const { tokenId, sceneId } = await ready(gm, pc, npc, player);
  const was = await gm.run(async a => {
    const scene = game.scenes.get(a.sceneId);
    const old = scene.getFlag("cpr-sam-agent", "nightCity");
    await scene.setFlag("cpr-sam-agent", "nightCity", false);
    return old ?? null;
  }, { sceneId });
  try {
    await pl.run(async () => {
      const warn = (window.ncpdWarned = []);
      const was = ui.notifications.warn;
      ui.notifications.warn = function (text, ...rest) {
        warn.push(String(text));
        ui.notifications.warn = was;
        return was.call(this, text, ...rest);
      };
    });
    const refused = await snapNpc(pl, tokenId, `${tag} outside NC`, 2500);
    same(refused, null, "no lookup outside Night City");
    const warned = await pl.run(async () => window.ncpdWarned.some(t => /No NCPD uplink/.test(t)));
    check(warned, "the player is told: no NCPD uplink");
    // The host refuses too, whatever the client did.
    const host = await pl.run(async a => {
      store.request("ncpd-submit", { actorId: a.pc.id, tokenId: a.tokenId, sceneId: a.sceneId, caption: a.caption });
      await new Promise(r => setTimeout(r, 1500));
      return { lookup: Object.values(store.apps.ncpdLookups).some(l => l.caption === a.caption), alert: Object.values(store.apps.alerts).some(x => x.actorId === a.pc.id && /No NCPD uplink/.test(x.text)) };
    }, { pc, tokenId, sceneId, caption: `${tag} host check` });
    check(!host.lookup && host.alert, "the host refuses it with an alert");
  } finally {
    await gm.run(async a => {
      const scene = game.scenes.get(a.sceneId);
      if (a.was === null) await scene.unsetFlag("cpr-sam-agent", "nightCity");
      else await scene.setFlag("cpr-sam-agent", "nightCity", a.was);
    }, { sceneId, was });
  }

  // The archive: a new record with no token, found by its alias, then a lookup delivered from it.
  const name = `${tag} Jenna Voss`;
  const alias = `${tag}Ghost`;
  const made = await gm.run(async a => {
    await go("ncpd");
    const details = el('details[data-section="ncpdSaved"]');
    if (!details.open) details.querySelector("summary").click();
    await tap('[data-action="ncpd-archive-new"]');
    await fill('[data-ncpd-field="record.name"][data-id="archive"]', a.name);
    await fill('[data-ncpd-field="record.aliases"][data-id="archive"]', a.alias);
    await fill('[data-ncpd-field="record.affiliation"][data-id="archive"]', "Tyger Claws");
    await tap('[data-action="ncpd-archive-save"]');
    const rec = await until(() => Object.values(store.apps.ncpdRecords).find(r => r.name === a.name), "the archived record");
    await fill("[name=ncpdSearch]", a.alias.toLowerCase());
    const listed = () => els('details[data-section="ncpdSaved"] li[data-record]');
    const hit = await until(() => listed().length === 1 && el(`li[data-record="${rec.id}"]`), "found by alias, alone").catch(() => null);
    return { id: rec.id, actorId: rec.actorId, hit: !!hit, others: listed().length };
  }, { name, alias });
  check(made.hit, "the archive finds it by alias");
  same(made.actorId, null, "not tied to a token or actor");
  same(made.others, 1, "only the match is listed");

  const id = await snapNpc(pl, tokenId, `${tag} from the archive`);
  check(id, "a lookup in Night City again");
  const delivered = await gm.run(async a => {
    await go("ncpd");
    const l = await until(() => store.apps.ncpdLookups[a.id], "the lookup at the GM");
    await until(() => el(`[data-lookup="${a.id}"]`), "the lookup on the GM Phone");
    const kind = el(`[data-lookup="${a.id}"] input[data-ncpd-field="kind"][value="record"]`);
    if (!kind.checked) {
      kind.checked = true;
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await until(() => el(`input[name=ncpdSaved][data-id="${a.id}"]`), "Use saved");
    el(`input[name=ncpdSaved][data-id="${a.id}"]`).value = a.alias;
    await tap(`[data-action="ncpd-use-saved"][data-id="${a.id}"]`);
    await until(() => el(`[data-ncpd-field="record.name"][data-id="${a.id}"]`)?.value === a.name, "the card from the archive");
    const count = Object.keys(store.apps.ncpdRecords).length;
    await tap(`[data-action="ncpd-deliver"][data-id="${a.id}"]`);
    await until(() => l.status === "delivered", "delivered");
    await new Promise(r => setTimeout(r, 300));
    return { name: l.result.record?.name, count: Object.keys(store.apps.ncpdRecords).length - count, kept: store.apps.ncpdRecords[a.recordId]?.name };
  }, { id, alias, name, recordId: made.id });
  same(delivered.name, name, "delivered from the archived record");
  same(delivered.count, 0, "the same record, not a copy");
  same(delivered.kept, name, "still in the archive");
  const hidden = await pl.run(async () => Object.keys(store.apps.ncpdRecords ?? {}).length);
  same(hidden, 0, "players never see the archive");
});

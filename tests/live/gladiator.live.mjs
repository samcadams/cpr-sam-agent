/*
 * Digital Gladiator (apps/gladiator/): a challenge with a held wager settled by the GM (declare, fried screen, repair),
 * the duel through the phone (moves, a kill, the result banner), and a mutual call-off, the GM's watch and a concession.
 * Builds and matches are made with requests where the UI isn't the point; every test leaves both characters repaired
 * with no open match.
 */

import { check, same, test } from "./lib.mjs";

const wealth = (c, id) => c.run(a => game.actors.get(a.id).system.wealth.value, { id });

const BUILD = {
  look: { colour: "#29e3ff", frame: "street" },
  stats: { int: 5, ref: 8, dex: 7, tech: 5, cool: 6, will: 6, luck: 6, move: 6, body: 7, emp: 6 },
  skills: {
    Athletics: 2, Brawling: 2, Concentration: 2, Conversation: 2, Education: 2, Evasion: 6, "First Aid": 2, "Human Perception": 2,
    "Language (Streetslang)": 2, "Local Expert (Your Home)": 2, Perception: 2, Persuasion: 2, Stealth: 2, Handgun: 6
  },
  awareness: { precision: 1, initiative: 1 }
};

/** Calls off whatever is open for the pair and repairs both Agents (GM side). */
const reset = (gm, pc, other) => gm.run(async a => {
  const ids = [a.pc.id, a.other.id];
  for (const m of Object.values(store.apps.gladiatorMatches)) {
    if (["pending", "accepted", "live"].includes(m.status) && (ids.includes(m.a.actorId) || ids.includes(m.b.actorId))) store.request("gladiator-off", { id: m.id });
  }
  for (const id of ids) store.request("gladiator-repair", { actorId: id });
  await until(() => !Object.values(store.apps.gladiatorMatches).some(m => ["pending", "accepted", "live"].includes(m.status) && (ids.includes(m.a.actorId) || ids.includes(m.b.actorId))), "no open match");
  await until(() => ids.every(id => !game.actors.get(id).items.some(i => i.getFlag(MODULE, "fried"))), "both Agents repaired");
}, { pc, other });

/** Both characters have the app, 500eb, no match and a working Agent, the settle mode "ask" and a legal Gladiator each. */
async function prepare({ gm, pl, prefix, pc, other }) {
  const gear = await gm.run(async a => {
    if (!api.feature("app_gladiator")) await api.setFeature("app_gladiator", true);
    if (!api.feature("app_pool")) await api.setFeature("app_pool", true);
    for (const id of [a.pc.id, a.other.id]) {
      if (!api.pool.has(id, "gladiator")) await api.pool.grant({ actor: id, app: "gladiator" });
      await game.actors.get(id).update({ "system.wealth.value": 500 });
    }
    await game.settings.set(MODULE, "gladiatorSettle", "ask");
    const out = [];
    for (const [pack, name, qty] of [["core_weapons", "Heavy Pistol", 1], ["core_armor", "Light Armorjack (Body)", 1], ["core_ammo", "Heavy Pistol (Basic)", 2]]) {
      const index = await game.packs.get(`cyberpunk-red-core.${pack}`).getIndex();
      const entry = index.find(i => i.name === name);
      if (!entry) throw new Error(`no ${name} in ${pack}`);
      out.push({ uuid: entry.uuid, qty });
    }
    return out;
  }, { pc, other });
  await reset(gm, pc, other);
  await gm.run(async a => {
    for (const id of [a.pc.id, a.other.id]) await game.actors.get(id).update({ "system.wealth.value": 500 });
  }, { pc, other });
  await pl.run(async a => {
    await until(() => [a.pc.id, a.other.id].every(id => api.pool.has(id, "gladiator")), "the app on both characters");
    for (const [actor, name] of [[a.pc, "Razor"], [a.other, "Bolt"]]) {
      store.request("gladiator-save", { actorId: actor.id, build: { ...a.build, name: `${a.prefix}${name}`, gear: a.gear } });
      await until(() => store.apps.gladiators[actor.id]?.name === `${a.prefix}${name}`, `${name} saved`);
      const problems = store.apps.gladiators[actor.id].problems;
      if (problems.length) throw new Error(`${name} isn't legal: ${problems.join("; ")}`);
    }
    // A duel that ended in the last 10 minutes (an earlier run, or reset's call-off) keeps its result screen up until
    // the player leaves it, over the challenge form.
    await go("gladiator");
    for (let leave; (leave = el("[data-action=gladiator-leave]"));) {
      await hit(leave);
      await until(() => !el(`[data-action=gladiator-leave][data-id="${leave.dataset.id}"]`), "the result screen left");
    }
  }, { pc, other, prefix, build: BUILD, gear });
}

/** pl sends a challenge (pc to other) and other accepts, both by request; resolves with the match id once accepted. */
const challengeAndAccept = (pl, pc, other, wager) => pl.run(async a => {
  store.request("gladiator-challenge", { actorId: a.pc.id, opponentId: a.other.id, wager: a.wager });
  const open = () => Object.values(store.apps.gladiatorMatches).find(m => m.status === "pending" && m.a.actorId === a.pc.id);
  const id = (await until(open, "the challenge")).id;
  store.request("gladiator-answer", { id, actorId: a.other.id, accept: true });
  await until(() => store.apps.gladiatorMatches[id].status !== "pending", "the answer");
  return id;
}, { pc, other, wager });

const matchOf = (c, id) => c.run(a => {
  const m = store.apps.gladiatorMatches[a.id];
  return m && { status: m.status, mode: m.mode, how: m.how, winner: m.winner, loser: m.loser, battle: !!m.battle, draw: m.draw };
}, { id });

/** Who has a fried flag on an Agent item (GM side). */
const fried = (gm, pc, other) => gm.run(a => [a.pc, a.other].filter(c => game.actors.get(c.id).items.some(i => i.getFlag(MODULE, "fried"))).map(c => c.id), { pc, other });

test("Digital Gladiator: challenge with a held wager, GM choice, fried screen and repair", async ({ gm, pl, prefix, pc, other }) => {
  // The store: back to never having owned it (a revoke would refuse the sale), then bought for 20eb.
  await gm.run(async a => {
    if (!api.feature("app_gladiator")) await api.setFeature("app_gladiator", true);
    if (!api.feature("app_pool")) await api.setFeature("app_pool", true);
    if (store.apps.installs[a.pc.id]?.gladiator) store.request("pool-forget", { actorId: a.pc.id, app: "gladiator" });
    await until(() => !store.apps.installs[a.pc.id]?.gladiator, "Digital Gladiator forgotten");
    const actor = game.actors.get(a.pc.id);
    if (actor.system.wealth.value < 200) await actor.update({ "system.wealth.value": 500 });
  }, { pc });
  const before = await gm.run(a => game.actors.get(a.id).system.wealth.value, { id: pc.id });
  const card = await pl.run(async () => {
    await until(() => !api.pool.has(game.user.character.id, "gladiator"), "the player's copy forgotten");
    await go("pool");
    await tap('[data-action="pool-tab"][data-tab="featured"]');
    const get = await until(() => el('[data-action="pool-get"][data-app="gladiator"]'), "Digital Gladiator in the store");
    const out = { text: get.closest(".agent-pool-card").innerText, soon: root().innerText.split("\n").filter(l => /^Digital Gladiator$/.test(l.trim())).length };
    await tap('[data-action="pool-get"][data-app="gladiator"]');
    await press(await dialog("App Store"), "Yes");
    await until(() => api.pool.has(game.user.character.id, "gladiator"), "bought");
    return out;
  });
  check(/Segotari/.test(card.text) && /20/.test(card.text), `the card names Segotari and 20eb (${card.text})`);
  same(card.soon, 1, "listed once: no coming-soon listing");
  same(before - (await gm.run(a => game.actors.get(a.id).system.wealth.value, { id: pc.id })), 20, "20eb paid");

  await prepare({ gm, pl, prefix, pc, other });
  const [pc0, other0] = [await wealth(gm, pc.id), await wealth(gm, other.id)];

  // pc challenges other through the phone.
  const id = await pl.run(async a => {
    await go("gladiator");
    await tap(`[data-action=gladiator-pick][data-actor-id="${a.other.id}"]`);
    await fill("[data-gladiator-wager]", "50");
    await tap("[data-action=gladiator-challenge]");
    return (await until(() => Object.values(store.apps.gladiatorMatches).find(m => m.status === "pending" && m.a.actorId === a.pc.id), "the challenge")).id;
  }, { pc, other });
  same((await matchOf(gm, id)).status, "pending", "challenge pending");
  same(await wealth(gm, pc.id), pc0 - 50, "the challenger's wager is held at once");

  await pl.run(async a => {
    store.request("gladiator-answer", { id: a.id, actorId: a.other.id, accept: true });
    await until(() => store.apps.gladiatorMatches[a.id].status === "accepted", "accepted");
  }, { id, other });
  await gm.run(a => until(() => store.apps.gladiatorMatches[a.id]?.status === "accepted", "accepted at the host"), { id });
  same(await wealth(gm, other.id), other0 - 50, "the opponent's wager is held on accepting");

  // The GM's phone: the row, then "Decide it myself".
  const row = await gm.run(async a => {
    await go("gladiator");
    return (await until(() => el(`.agent-gladiator-match-row[data-match="${a.id}"]`), "the match row")).innerText;
  }, { id });
  check(/Decide it myself/.test(row), `the row offers Decide it myself (${row})`);
  await gm.run(a => tap(`[data-action=gladiator-mode][data-id="${a.id}"][data-mode=gm]`), { id });
  await gm.run(a => until(() => store.apps.gladiatorMatches[a.id].status === "live", "live"), { id });
  const live = await matchOf(gm, id);
  same([live.status, live.mode], ["live", "gm"], "live, the GM decides");

  // Declare other the winner.
  const dialogText = await gm.run(async a => {
    await tap(`[data-action=gladiator-declare][data-id="${a.id}"][data-winner="${a.other.id}"]`);
    const d = await dialog("Declare the winner");
    const t = d.innerText;
    await press(d, "Yes");
    return t;
  }, { id, other });
  check(dialogText.includes(pc.shown), `the dialog names ${pc.shown}'s Agent (${dialogText})`);
  check(/destroys/.test(dialogText), `the dialog warns (${dialogText})`);
  await gm.run(a => until(() => store.apps.gladiatorMatches[a.id].status === "done", "done"), { id });
  same(await wealth(gm, other.id), other0 + 50, "the winner is paid the pot (both wagers)");
  same(await wealth(gm, pc.id), pc0 - 50, "the loser keeps nothing");
  same(await fried(gm, pc, other), [pc.id], "only the loser's Agent is fried");

  // The fried phone is the whole phone.
  await pl.run(async () => {
    await phone();
    await until(() => el(".agent-gladiator-fried"), "the fried screen");
  });

  // Repair from Results.
  await gm.run(async a => {
    await go("gladiator");
    await tap(`li[data-match="${a.id}"] [data-action=gladiator-repair]`);
    await until(() => !game.actors.get(a.pc.id).items.some(i => i.getFlag(MODULE, "fried")), "the flag cleared");
  }, { id, pc });
  await pl.run(async () => {
    await phone();
    await until(() => !el(".agent-gladiator-fried"), "the fried screen gone");
  });
  same(await fried(gm, pc, other), [], "nothing fried after the repair");
  await reset(gm, pc, other);
});

test("Digital Gladiator: the duel, moves through the UI, a kill and the result banner", async ({ gm, pl, prefix, pc, other }) => {
  await prepare({ gm, pl, prefix, pc, other });
  await gm.run(() => game.settings.set(MODULE, "gladiatorSettle", "play"));
  try {
    const [pc0, other0] = [await wealth(gm, pc.id), await wealth(gm, other.id)];
    const id = await challengeAndAccept(pl, pc, other, 20);
    await gm.run(a => until(() => store.apps.gladiatorMatches[a.id]?.battle, "the battle at the host"), { id });
    same(await wealth(gm, pc.id), pc0 - 20, "pc's wager held");
    same(await wealth(gm, other.id), other0 - 20, "other's wager held");
    const m = await matchOf(gm, id);
    same([m.status, m.mode, m.battle], ["live", "play", true], "live, played out");

    const view = await pl.run(async () => {
      await go("gladiator");
      await until(() => el(".agent-gladiator-battle"), "the battle view");
      const canvas = await until(() => el("canvas.agent-gladiator-arena"), "the arena canvas");
      const colours = await until(() => {
        const c = el("canvas.agent-gladiator-arena");
        const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        const set = new Set();
        for (let i = 0; i < data.length; i += 4) set.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
        return set.size > 20 && set.size;
      }, "the arena drawn", 10000);
      return { colours, size: [canvas.width, canvas.height], band: text(".agent-gladiator-band") };
    });
    check(view.colours > 20, `the arena is drawn (${view.colours} colours)`);
    check(/Far range/.test(view.band), `starts at far range (${view.band})`);

    // pc plays through the buttons; other by request (closing in or dodging, never attacking, so pc can win).
    let final = null;
    for (let turn = 0; turn < 40 && !final; turn++) {
      const st = await pl.run(async a => {
        const { legalMoves } = await import("/modules/cpr-sam-agent/apps/gladiator/battle.js");
        const m = store.apps.gladiatorMatches[a.id];
        if (m.status !== "live") return { over: true };
        if (m.battle.turn === a.other.id) {
          const moves = legalMoves(m.battle, a.other.id).filter(mv => !mv.disabled && !mv.id.startsWith("concede"));
          const mv = moves.find(x => x.id === "move:in") ?? moves.find(x => x.group !== "attack") ?? moves[0];
          store.request("gladiator-move", { id: a.id, actorId: a.other.id, move: mv.id });
          await until(() => store.apps.gladiatorMatches[a.id].status !== "live" || store.apps.gladiatorMatches[a.id].battle.turn !== a.other.id, "other's move");
          return { who: "other", move: mv.id };
        }
        await until(() => el("[data-action=gladiator-move]:not([disabled])"), "an enabled move", 10000);
        let button = el("[data-action=gladiator-move][data-move^='shoot:']:not([disabled])") ?? el("[data-action=gladiator-move][data-move^='reload:']:not([disabled])") ?? el("[data-action=gladiator-move]:not([disabled])");
        const move = button.dataset.move;
        hit(button);
        await until(() => store.apps.gladiatorMatches[a.id].status !== "live" || store.apps.gladiatorMatches[a.id].battle.turn !== a.pc.id, "pc's move", 10000);
        return { who: "pc", move };
      }, { id, pc, other });
      if (st.over) final = true;
      if (turn === 1) {
        // After the first exchange the GM has other down to 1 HP.
        await gm.run(a => {
          store.apps.gladiatorMatches[a.id].battle.fighters[a.other.id].hp = 1;
          store._pushApps();
        }, { id, other });
      }
    }
    await gm.run(a => until(() => store.apps.gladiatorMatches[a.id].status === "done", "the duel to end", 15000), { id });
    const done = await matchOf(gm, id);
    same([done.status, done.how], ["done", "kill"], "ended with a kill");
    const [winner, loser] = done.winner === pc.id ? [pc, other] : [other, pc];
    same(await wealth(gm, winner.id), (winner === pc ? pc0 : other0) + 20, "the winner nets the other wager");
    same(await wealth(gm, loser.id), (winner === pc ? other0 : pc0) - 20, "the loser lost the wager");
    same(await fried(gm, pc, other), [loser.id], "the loser's Agent is fried");

    if (winner === pc) {
      const banner = await pl.run(async () => {
        await until(() => el(".agent-gladiator-result"), "the result banner");
        return { result: text(".agent-gladiator-result"), leave: text("[data-action=gladiator-leave]") };
      });
      check(/You won/.test(banner.result), `the banner says You won (${banner.result})`);
      check(/Leave the arena/.test(banner.leave), `the leave button (${banner.leave})`);
      await pl.run(async () => {
        await tap("[data-action=gladiator-leave]");
        await until(() => !el(".agent-gladiator-battle") && el("[data-action=gladiator-edit]"), "back to the normal page");
      });
    } else {
      // pc lost: its phone is the fried screen instead of the banner.
      await pl.run(() => until(() => el(".agent-gladiator-fried"), "the fried screen"));
    }
  } finally {
    await gm.run(() => game.settings.set(MODULE, "gladiatorSettle", "ask"));
    await reset(gm, pc, other);
  }
  same(await fried(gm, pc, other), [], "both repaired");
});

test("Digital Gladiator: mutual call-off, concede and the GM's watch", async ({ gm, pl, prefix, pc, other }) => {
  await prepare({ gm, pl, prefix, pc, other });
  await gm.run(() => game.settings.set(MODULE, "gladiatorSettle", "play"));
  try {
    const [pc0, other0] = [await wealth(gm, pc.id), await wealth(gm, other.id)];

    // Other offers to call it off; pc sees the note and agrees.
    const first = await challengeAndAccept(pl, pc, other, 30);
    await gm.run(a => until(() => store.apps.gladiatorMatches[a.id]?.battle, "the battle"), { id: first });
    same(await wealth(gm, pc.id), pc0 - 30, "wagers held for the duel");
    await pl.run(async a => {
      store.request("gladiator-draw", { id: a.id, actorId: a.other.id });
      await go("gladiator");
      const note = await until(() => [...(root()?.querySelectorAll(".agent-info-note") ?? [])].find(n => /offered to call it off/.test(n.textContent)), "the call-off note");
      if (!note) throw new Error("no note");
      await tap("[data-action=gladiator-draw]");
      await until(() => store.apps.gladiatorMatches[a.id].status === "off", "called off");
    }, { id: first, other });
    const off = await matchOf(gm, first);
    same([off.status, off.how], ["off", "draw"], "called off by both");
    same([await wealth(gm, pc.id), await wealth(gm, other.id)], [pc0, other0], "wagers back");
    same(await fried(gm, pc, other), [], "nothing fried");
    await pl.run(async () => {
      await until(() => el("[data-action=gladiator-leave]"), "the result");
      await tap("[data-action=gladiator-leave]");
      await until(() => !el(".agent-gladiator-battle"), "left");
    });

    // A new duel: the GM watches, then pc concedes.
    const id = await challengeAndAccept(pl, pc, other, 30);
    await gm.run(a => until(() => store.apps.gladiatorMatches[a.id]?.battle, "the battle"), { id });
    const watch = await gm.run(async a => {
      await go("gladiator");
      await tap(`.agent-gladiator-match-row[data-match="${a.id}"] [data-action=gladiator-watch]`);
      await until(() => el(".agent-gladiator-battle"), "the watch view");
      const out = { moves: els("[data-action=gladiator-move]").length, title: text(".agent-gladiator-battle-title"), canvas: !!el("canvas.agent-gladiator-arena") };
      await tap("[data-action=gladiator-unwatch]");
      await until(() => !el(".agent-gladiator-battle") && el(".agent-gladiator-match-row"), "back to the list");
      return out;
    }, { id });
    same(watch.moves, 0, "watching is read-only");
    check(/Watching/.test(watch.title) && watch.canvas, `the watch view (${watch.title})`);

    await pl.run(async () => {
      await go("gladiator");
      await tap("[data-action=gladiator-concede]");
      await press(await dialog("Concede"), "Yes");
    });
    await gm.run(a => until(() => store.apps.gladiatorMatches[a.id].status === "done", "conceded"), { id });
    const done = await matchOf(gm, id);
    same([done.how, done.winner, done.loser], ["concede", other.id, pc.id], "pc conceded");
    same(await wealth(gm, pc.id), pc0 - 30, "the conceder lost the wager");
    same(await wealth(gm, other.id), other0 + 30, "the other won it");
    same(await fried(gm, pc, other), [pc.id], "the conceder is fried");
  } finally {
    await gm.run(() => game.settings.set(MODULE, "gladiatorSettle", "ask"));
    await reset(gm, pc, other);
  }
  same(await fried(gm, pc, other), [], "both repaired");
});

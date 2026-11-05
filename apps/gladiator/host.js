import { MODULE_ID } from "../../scripts/config.js";
import { gm } from "../../scripts/host/validate.js";
import { agentItem, agentType } from "../../scripts/model/agent.js";
import { feature } from "../../scripts/model/features.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { esc } from "../../scripts/util/text.js";
import { isInstalled, isLapsed, poolOn } from "../pool/model.js";
import { newBattle, resolveMove } from "./battle.js";
import { gladiatorCatalogue, gladiatorDvTables, priceGear } from "./catalogue.js";
import { challengeProblem, cleanBuild, FROM, GLADIATOR, gladiatorProblems, oldMatches, openMatchOf, OPEN_STATUSES, potOf, sideOf, wagerOf } from "./model.js";

/*
 * Host: Digital Gladiator (see apps/gladiator/model.js). Saving a build: the host prices the gear from its own
 * catalogue and keeps the build's problems with it. Matches: a challenge holds the challenger's wager, accepting holds
 * the opponent's (the CBK bid pattern: money leaves the wallet at once and comes back if nothing happens); the GM picks
 * how it's settled; the end pays the winner both wagers and fries the loser's Agent (a flag on the Agent item, which the
 * phone shows as a dead screen until the GM repairs it). The duel: each move is a request the host resolves (battle.js,
 * host dice); either side can concede, and both agreeing calls it off. Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "gladiator-save": "_onGladiatorSave",
  "gladiator-challenge": "_onGladiatorChallenge",
  "gladiator-answer": "_onGladiatorAnswer",
  "gladiator-withdraw": "_onGladiatorWithdraw",
  "gladiator-move": "_onGladiatorMove",
  "gladiator-draw": "_onGladiatorDraw",
  "gladiator-mode": gm("_onGladiatorMode"),
  "gladiator-declare": gm("_onGladiatorDeclare"),
  "gladiator-off": gm("_onGladiatorOff"),
  "gladiator-repair": gm("_onGladiatorRepair"),
  "gladiator-brain": gm("_onGladiatorBrain")
};

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");
const cardId = match => `gladiator:${match.id}`;
const who = actorId => displayName(game.actors.get(actorId));
const BRAIN_INJURY = "Brain Injury";

export const methods = {
  _hasGladiator(actorId) {
    if (!poolOn()) return !!feature(`app_${GLADIATOR}`);
    return isInstalled(this.apps.installs, actorId, GLADIATOR) && !isLapsed(this.apps.installs, actorId, GLADIATOR);
  },

  /** A player's own character with the app, or null. */
  _gladiatorActor(user, actorId) {
    const actor = game.actors.get(actorId);
    return actor && !user.isGM && owns(user, actor) && this._hasGladiator(actorId) ? actor : null;
  },

  _gladiatorTell(actorId, text, kind = "event") {
    return this._alert(actorId, { kind, from: FROM, app: GLADIATOR, text });
  },

  /** A player saves their Gladiator: gear priced by the host, problems kept with it. Not while it's in a match. */
  async _onGladiatorSave(user, { actorId, build }) {
    const actor = this._gladiatorActor(user, actorId);
    if (!actor) return;
    if (openMatchOf(this.apps.gladiatorMatches, actorId)) return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: "Not while you're in a match. Your Gladiator wasn't changed." });
    const catalogue = await gladiatorCatalogue();
    const clean = cleanBuild({ ...build, gear: priceGear(catalogue, build?.gear) }, actorId);
    const problems = gladiatorProblems(clean, catalogue.skills);
    this.apps.gladiators[actorId] = { ...clean, problems, updatedAt: Date.now() };
    this._pushApps([this._gladiatorTell(actorId, problems.length ? `${clean.name || "Your Gladiator"} is saved, but can't fight yet: ${problems[0]}` : `${clean.name} is ready for the arena.`)]);
  },

  /* Wagers: held at once, back or paid out at the end */

  async _gladiatorHold(actorId, amount, memo) {
    const actor = game.actors.get(actorId);
    if (!amount || !hasWallet(actor)) return true;
    if (!(await this._transfer(actor, null, amount, `Digital Gladiator: ${memo}`))) return false;
    this._ledger(actorId, -amount, memo, GLADIATOR);
    return true;
  },

  async _gladiatorPay(actorId, amount, memo) {
    const actor = game.actors.get(actorId);
    if (!amount || !hasWallet(actor)) return;
    await this._transfer(null, actor, amount, `Digital Gladiator: ${memo}`);
    this._ledger(actorId, amount, memo, GLADIATOR);
  },

  /** Both held wagers back to their sides (a declined, withdrawn or called-off match). */
  async _gladiatorRefund(match) {
    await this._gladiatorPay(match.a.actorId, match.a.wager, `Wager back: vs ${who(match.b.actorId)}`);
    if (match.status !== "pending") await this._gladiatorPay(match.b.actorId, match.b.wager, `Wager back: vs ${who(match.a.actorId)}`);
  },

  _gladiatorTrim() {
    for (const id of oldMatches(this.apps.gladiatorMatches)) delete this.apps.gladiatorMatches[id];
  },

  /* Challenges */

  /** A challenge: the challenger's wager is held now; the opponent's players are told. */
  async _onGladiatorChallenge(user, { actorId, opponentId, wager }) {
    const actor = this._gladiatorActor(user, actorId);
    const opponent = game.actors.get(opponentId);
    if (!actor) return;
    const amount = wagerOf(wager);
    const problem = !opponent || !agentType(opponent) || !this._hasGladiator(opponentId)
      ? `${opponent ? displayName(opponent) : "They"} can't take a Digital Gladiator challenge.`
      : challengeProblem({ actorId, opponentId, opponentName: displayName(opponent), builds: this.apps.gladiators, matches: this.apps.gladiatorMatches,
        wager: amount, wealth: hasWallet(actor) ? actor.system.wealth.value : null });
    if (problem) return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: problem });
    if (!(await this._gladiatorHold(actorId, amount, `Wager held: vs ${displayName(opponent)}`))) {
      return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: "Payment declined: you can't cover that wager." });
    }
    const id = foundry.utils.randomID();
    const side = (a, u) => ({ actorId: a, userId: u, name: this.apps.gladiators[a].name, wager: amount });
    this.apps.gladiatorMatches[id] = { id, everyone: true, status: "pending", mode: null, a: side(actorId, user.id), b: side(opponentId, null), draw: [], ts: Date.now() };
    const stakes = amount ? ` for ${formatMoney(amount)}` : "";
    this._pushApps([
      this._gladiatorTell(actorId, `Challenge sent to ${displayName(opponent)}${stakes}.`),
      this._gladiatorTell(opponentId, `${displayName(actor)}'s ${this.apps.gladiators[actorId].name} challenges your Gladiator${stakes}. Answer in Digital Gladiator. The loser's Agent is fried.`, "warning")
    ]);
  },

  /** The opponent answers. Accepting holds their wager (the same amount); then the GM picks how it's settled. */
  async _onGladiatorAnswer(user, { id, actorId, accept }) {
    const match = this.apps.gladiatorMatches[id];
    const actor = this._gladiatorActor(user, actorId);
    if (!actor || match?.status !== "pending" || match.b.actorId !== actorId) return;
    if (!accept) {
      await this._gladiatorRefund(match);
      match.status = "declined";
      this._gladiatorTrim();
      return this._pushApps([this._gladiatorTell(match.a.actorId, `${displayName(actor)} declined your challenge.${match.a.wager ? " Your wager is back." : ""}`)]);
    }
    const builds = this.apps.gladiators;
    if (builds[actorId]?.problems?.length || !builds[actorId]) return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: "Your Gladiator can't fight yet." });
    if (!(await this._gladiatorHold(actorId, match.b.wager, `Wager held: vs ${who(match.a.actorId)}`))) {
      return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: "Payment declined: you can't cover the wager." });
    }
    match.b.userId = user.id;
    match.b.name = builds[actorId].name;
    match.status = "accepted";
    const alerts = [this._gladiatorTell(match.a.actorId, `${displayName(actor)} accepted. Waiting for the arena to open.`)];
    const mode = game.settings.get(MODULE_ID, "gladiatorSettle");
    if (mode === "gm" || mode === "play") await this._gladiatorStart(match, mode, alerts);
    else {
      this._gmCard({
        id: cardId(match), icon: "fa-khanda", open: { app: GLADIATOR },
        title: `Digital Gladiator: ${esc(who(match.a.actorId))} vs ${esc(displayName(actor))}`,
        body: `${esc(match.a.name)} vs ${esc(match.b.name)}${potOf(match) ? `, ${formatMoney(potOf(match))} in the pot` : ""}. How is it settled?`,
        actions: [
          { label: "Decide it myself", icon: "fa-gavel", request: "gladiator-mode", data: { id, mode: "gm" } },
          { label: "Let them fight", icon: "fa-gamepad", request: "gladiator-mode", data: { id, mode: "play" } },
          { label: "Call it off", icon: "fa-ban", request: "gladiator-off", data: { id } }
        ]
      });
    }
    this._pushApps(alerts);
  },

  /** Until the GM has picked the mode, either side can back out; the held wagers go back. */
  async _onGladiatorWithdraw(user, { id, actorId }) {
    const match = this.apps.gladiatorMatches[id];
    const side = match && sideOf(match, actorId);
    if (!side || !this._gladiatorActor(user, actorId) || !["pending", "accepted"].includes(match.status)) return;
    if (match.status === "pending" && side !== "a") return;
    const otherHeld = match.status === "accepted" && match[side === "a" ? "b" : "a"].wager > 0;
    await this._gladiatorRefund(match);
    match.status = "withdrawn";
    this._gmCardDone(cardId(match));
    this._gladiatorTrim();
    const other = side === "a" ? match.b.actorId : match.a.actorId;
    this._pushApps([this._gladiatorTell(other, `${who(actorId)} backed out of the match.${otherHeld ? " Your wager is back." : ""}`)]);
  },

  /** The match goes live: GM choice (the GM declares), or the duel (a battle state, the host rolls initiative). */
  async _gladiatorStart(match, mode, alerts) {
    match.mode = mode;
    match.status = "live";
    if (mode === "play") {
      const builds = this.apps.gladiators;
      match.battle = newBattle({ a: builds[match.a.actorId], b: builds[match.b.actorId], dv: await gladiatorDvTables(), rng: Math.random });
    }
    const text = mode === "play" ? "The arena is open. Fight it out in Digital Gladiator." : "The match is on. The GM will call the winner.";
    alerts.push(this._gladiatorTell(match.a.actorId, text), this._gladiatorTell(match.b.actorId, text));
  },

  async _onGladiatorMode(user, { id, mode }) {
    const match = this.apps.gladiatorMatches[id];
    if (match?.status !== "accepted" || !["gm", "play"].includes(mode)) return;
    const alerts = [];
    await this._gladiatorStart(match, mode, alerts);
    this._gmCardDone(cardId(match));
    this._pushApps(alerts);
  },

  /* The duel */

  /** A live duel and one of its sides, played by this user; or null. */
  _gladiatorDuel(user, id, actorId) {
    const match = this.apps.gladiatorMatches[id];
    if (match?.status !== "live" || match.mode !== "play" || !match.battle || !sideOf(match, actorId)) return null;
    return this._gladiatorActor(user, actorId) ? match : null;
  },

  /** A side plays a move (concede included): the host rolls the dice; a kill or a concession ends the match. */
  async _onGladiatorMove(user, { id, actorId, move }) {
    const match = this._gladiatorDuel(user, id, actorId);
    if (!match) return;
    const { state, error } = resolveMove(match.battle, actorId, String(move ?? ""), Math.random);
    if (error) return this._alertNow(actorId, { kind: "warning", from: FROM, app: GLADIATOR, text: error });
    match.battle = state;
    if (state.over) return this._gladiatorFinish(match, state.winner, state.how);
    this._pushApps();
  },

  /** A side offers to call the duel off, or takes the offer back. Both offering: wagers back, nothing fried. */
  async _onGladiatorDraw(user, { id, actorId }) {
    const match = this._gladiatorDuel(user, id, actorId);
    if (!match) return;
    const offered = !(match.draw ?? []).includes(actorId);
    match.draw = offered ? [...(match.draw ?? []), actorId] : match.draw.filter(a => a !== actorId);
    const other = sideOf(match, actorId) === "a" ? match.b.actorId : match.a.actorId;
    if (!match.draw.includes(other)) return this._pushApps(offered ? [this._gladiatorTell(other, `${who(actorId)} offers to call the match off.`)] : []);
    await this._gladiatorRefund(match);
    Object.assign(match, { status: "off", how: "draw", doneAt: Date.now() });
    this._gmCardDone(cardId(match));
    this._gladiatorTrim();
    const text = `You both agreed to stop.${potOf(match) ? " Wagers are back." : ""}`;
    this._pushApps([this._gladiatorTell(match.a.actorId, text), this._gladiatorTell(match.b.actorId, text)]);
  },

  /* The end */

  /** GM (any time a match is live): the winner takes the pot, the loser's Agent is fried. */
  async _onGladiatorDeclare(user, { id, winner }) {
    const match = this.apps.gladiatorMatches[id];
    if (match?.status !== "live" || !sideOf(match, winner)) return;
    await this._gladiatorFinish(match, winner, "gm");
  },

  /** GM: no winner, both wagers back, nothing fried. Also before the mode is picked. */
  async _onGladiatorOff(user, { id }) {
    const match = this.apps.gladiatorMatches[id];
    if (!match || !OPEN_STATUSES.has(match.status)) return;
    await this._gladiatorRefund(match);
    Object.assign(match, { status: "off", doneAt: Date.now() });
    this._gmCardDone(cardId(match));
    this._gladiatorTrim();
    const text = `The match was called off.${potOf(match) ? " Wagers are back." : ""}`;
    this._pushApps([this._gladiatorTell(match.a.actorId, text), this._gladiatorTell(match.b.actorId, text)]);
  },

  async _gladiatorFinish(match, winner, how) {
    const loser = winner === match.a.actorId ? match.b.actorId : match.a.actorId;
    Object.assign(match, { status: "done", winner, loser, how, doneAt: Date.now() });
    await this._gladiatorPay(winner, potOf(match), `Winnings: vs ${who(loser)}`);
    const actor = game.actors.get(loser);
    const item = agentItem(actor);
    const internal = agentType(actor) === "internal";
    if (item) await item.setFlag(MODULE_ID, "fried", { at: Date.now(), by: who(winner), matchId: match.id, internal });
    this._gmCardDone(cardId(match));
    this._gladiatorTrim();
    this._gmCard({
      id: `gladiator-fate:${match.id}`, icon: "fa-bolt", open: { app: GLADIATOR },
      title: `Digital Gladiator: ${esc(who(winner))} wins`,
      body: `${esc(displayName(actor))}'s ${internal ? "Internal Agent" : "Agent"} is fried${internal ? ". The book adds the Brain Injury Critical Injury" : ""}.`,
      actions: [
        ...(internal ? [{ label: "Apply Brain Injury", icon: "fa-brain", request: "gladiator-brain", data: { actorId: loser, matchId: match.id } }] : []),
        { label: "Repair Agent", icon: "fa-screwdriver-wrench", request: "gladiator-repair", data: { actorId: loser } }
      ]
    });
    this._pushApps([
      this._gladiatorTell(winner, `You won${potOf(match) ? ` ${formatMoney(potOf(match))}` : ""}. ${displayName(actor)}'s Agent is fried.`),
      this._gladiatorTell(loser, `You lost. Power surge incoming.`, "warning")
    ]);
  },

  /** GM: the fried Agent works again (a mistake, or a new Agent the character bought). */
  async _onGladiatorRepair(user, { actorId }) {
    const actor = game.actors.get(actorId);
    const fried = actor?.items.filter(i => i.getFlag(MODULE_ID, "fried")) ?? [];
    for (const item of fried) await item.unsetFlag(MODULE_ID, "fried");
    if (fried.length) this._pushApps([this._gladiatorTell(actorId, "Your Agent is back online.")]);
  },

  /** GM: the Brain Injury Critical Injury, from the CPR core compendium. */
  async _onGladiatorBrain(user, { actorId, matchId }) {
    const actor = game.actors.get(actorId);
    const pack = game.packs.get("cyberpunk-red-core.core_critical-injuries-head");
    const entry = pack?.index.find(e => e.name === BRAIN_INJURY);
    if (!actor || !entry) return ui.notifications.warn(`Digital Gladiator: no "${BRAIN_INJURY}" in the CPR head injuries compendium.`);
    const doc = await pack.getDocument(entry._id);
    await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    this._gmCardDone(`gladiator-fate:${matchId}`);
    this._pushApps([this._gladiatorTell(actorId, "The surge went through your head. Brain Injury.", "warning")]);
  }
};

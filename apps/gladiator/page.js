import { appPartial } from "../../scripts/apps/manifest.js";
import { MODULE_ID } from "../../scripts/config.js";
import { agentItem, agentType } from "../../scripts/model/agent.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { store } from "../../scripts/store.js";
import { BANDS, legalMoves, woundState } from "./battle.js";
import { catalogueNow, gladiatorCatalogue } from "./catalogue.js";
import { showArena, stopArena } from "./draw.js";
import {
  AWARENESS, BASIC_MIN, budgets, canWatch, COLOURS, derived, emptyBuild, FRAMES, gladiatorProblems, MATCH_STATUS, matchesOf, openMatchOf,
  OPEN_STATUSES, potOf, PUBLISHER, SETTLE_MODES, sideOf, SKILL_MAX, STAT_MAX, STAT_MIN, STATS
} from "./model.js";

/*
 * Phone page: Digital Gladiator (see apps/gladiator/model.js). Players: their Gladiator's card, the builder (a draft
 * on this phone until Save: STATs, skills, Combat Awareness, gear from the shop, live budgets and problems), the
 * challenge form, their match (answer, withdraw) and the last few results. A live duel is the battle view (fighters, the
 * arena canvas, the log, the moves); it's also what a nearby phone or the GM sees when watching, read-only, and the
 * result screen after. The GM Phone: how matches are settled, every match with its buttons (pick the mode, declare the
 * winner, call it off, watch a duel, repair a fried Agent), every Gladiator.
 * A fried Agent takes over the whole phone (`phone.takeover`). Methods, click actions (data-action) and input handlers
 * are installed onto AgentPhone.
 */

/** Skills that matter in the arena, shown first in the builder. */
const ARENA_SKILLS = ["Handgun", "Shoulder Arms", "Autofire", "Heavy Weapons", "Archery", "Melee Weapon", "Brawling", "Evasion"];
const KINDS = { weapon: "Weapons", armor: "Armor", cyberware: "Cyberware", ammo: "Ammo" };
const TABS = { stats: "STATs", skills: "Skills", gear: "Gear" };
const WOUNDS = { ok: "", serious: "Seriously Wounded", mortal: "Mortally Wounded", dead: "Dead" };
/** Move buttons in the 2 x 2 grid; the rest go under "More moves". */
const MAIN_MOVES = 4;
/** How long a player's finished duel stays on screen (until they leave it). */
const RESULT_MS = 10 * 60 * 1000;

const num = v => Math.floor(Number(v) || 0);

/** A new draft: the saved build, or a fresh one with the Basic Skills at their minimum. */
function draftFrom(saved, actorId, skills) {
  if (saved) return foundry.utils.deepClone({ ...emptyBuild(actorId), ...saved, problems: undefined, updatedAt: undefined });
  const build = emptyBuild(actorId);
  for (const s of skills.filter(k => k.basic)) build.skills[s.name] = BASIC_MIN;
  return build;
}

/** One gear line's detail: damage, SP, Humanity, rounds. */
function gearDetail(g) {
  const bits = [];
  if (g.weapon) bits.push(`${g.weapon.damage}${g.weapon.rof > 1 ? ` ROF ${g.weapon.rof}` : ""}${g.weapon.ranged ? ` · ${g.weapon.skill}` : " · melee"}`);
  if (g.armor) bits.push(`SP ${g.armor.body || g.armor.head}${g.armor.body && g.armor.head ? " body + head" : g.armor.head ? " head" : " body"}${g.armor.penalty ? ` · -${g.armor.penalty} REF/DEX` : ""}`);
  if (g.humanity) bits.push(`-${g.humanity} Humanity`);
  if (g.ammo) bits.push(`${g.ammo.rounds} rounds`);
  return bits.join(" · ");
}

/** A character's fried Agent: the flag on the Agent item in use, or null. */
export const friedAgent = actor => agentItem(actor)?.flags?.[MODULE_ID]?.fried ?? null;

const confirm = (title, text) => Dialog.confirm({ title, content: `<p>${text}</p>` });

/** A match for the page, from one side (`me`), or the GM's (me = null). */
function matchView(m, me) {
  const mine = me ? sideOf(m, me) : null;
  const them = mine === "a" ? m.b : m.a;
  const pot = potOf(m);
  return {
    ...m,
    label: MATCH_STATUS[m.status] ?? m.status,
    open: OPEN_STATUSES.has(m.status),
    vs: displayName(game.actors.get(them.actorId)), vsGladiator: them.name,
    aWho: displayName(game.actors.get(m.a.actorId)), bWho: displayName(game.actors.get(m.b.actorId)),
    pot: pot ? formatMoney(pot) : "", stake: m.a.wager ? formatMoney(m.a.wager) : "",
    toAnswer: m.status === "pending" && mine === "b",
    canWithdraw: (m.status === "pending" && mine === "a") || (m.status === "accepted" && !!mine),
    live: m.status === "live",
    gmChoice: m.status === "live" && m.mode === "gm",
    watch: m.status === "live" && m.mode === "play" && !!m.battle,
    toSettle: m.status === "accepted",
    won: m.status === "done" && m.winner === me, lost: m.status === "done" && m.loser === me,
    winnerWho: m.winner ? displayName(game.actors.get(m.winner)) : "",
    loserFried: m.status === "done" && !!friedAgent(game.actors.get(m.loser))
  };
}

/** A duel's fighter, for the battle view. */
function fighterView(f, side) {
  const wound = woundState(f);
  return {
    name: f.name, who: displayName(game.actors.get(side.actorId)), colour: f.look?.colour,
    hp: f.hp, maxHp: f.maxHp, pct: Math.round((100 * Math.max(0, f.hp)) / Math.max(1, f.maxHp)),
    wound, woundLabel: WOUNDS[wound], spBody: f.sp.body, spHead: f.sp.head
  };
}

/**
 * The battle view of a play-mode match: from one side (`me`, who gets the moves), or read-only (me = null: a
 * spectator or the GM, who see side a at the bottom). `more`: the "More moves" list is open.
 */
function duelView(m, me, more = false) {
  const b = m.battle;
  const mine = me ? sideOf(m, me) : null;
  const [bottom, top] = mine === "b" ? [m.b, m.a] : [m.a, m.b];
  const name = actorId => displayName(game.actors.get(actorId));
  const band = BANDS[b.band];
  const live = m.status === "live";
  const log = b.log.slice(-4);
  const rank = mv => mv.disabled ? 2 : mv.group === "attack" ? 0 : 1;
  const moves = live && mine ? legalMoves(b, me).map((mv, i) => ({ ...mv, i })).sort((x, y) => rank(x) - rank(y) || x.i - y.i) : [];
  const other = mine && (mine === "a" ? m.b : m.a);
  let result = "";
  if (m.status === "done") result = mine ? (m.winner === me ? "You won" : "You lost") : `Winner: ${name(m.winner)}`;
  else if (m.status === "off") result = "Called off";
  return {
    id: m.id, me: me ?? "", player: !!mine, watching: !mine,
    title: `${name(m.a.actorId)} vs ${name(m.b.actorId)}`,
    pot: potOf(m) ? formatMoney(potOf(m)) : "",
    top: fighterView(b.fighters[top.actorId], top), bottom: fighterView(b.fighters[bottom.actorId], bottom),
    band: `${band.label} range (${band.range}) · Round ${b.round}`,
    log: log.map((e, i) => ({ text: e.text, last: i === log.length - 1 })),
    turn: !live ? "" : b.turn === me ? "Your move" : mine ? `Waiting for ${name(b.turn)}` : `${name(b.turn)}'s move`,
    moves: moves.slice(0, MAIN_MOVES), more: moves.slice(MAIN_MOVES), moreOpen: more,
    canPlay: live && !!mine,
    offered: !!mine && (m.draw ?? []).includes(me),
    theyOffered: !!other && live && (m.draw ?? []).includes(other.actorId) ? `${name(other.actorId)} offered to call it off.` : "",
    over: !live, result, won: m.status === "done" && m.winner === me, lost: m.status === "done" && m.loser === me
  };
}

/** The saved Gladiator's card. */
function cardView(build) {
  const d = derived(build);
  const sp = loc => Math.max(0, ...build.gear.filter(g => g.armor).map(g => g.armor[loc] || 0));
  return {
    ...build, ...d,
    spBody: sp("body"), spHead: sp("head"),
    weapons: build.gear.filter(g => g.weapon).map(g => g.name).join(", ") || "Bare hands",
    legal: !build.problems?.length
  };
}

export const actions = {
  async "gladiator-edit"() {
    const ctx = this.context();
    if (!ctx?.actorId) return;
    // The shop and skills come from the compendiums (slow the first time): say so while they load.
    let cat = catalogueNow();
    if (!cat) {
      this._gladiatorOpening = true;
      this.render();
      cat = await gladiatorCatalogue().catch(err => console.error("cpr-sam-agent | Digital Gladiator: the shop didn't load", err));
      this._gladiatorOpening = false;
      if (!cat) return this.render();
    }
    this._gladiatorDraft = draftFrom(store.apps.gladiators?.[ctx.actorId], ctx.actorId, cat.skills);
    this._gladiatorTab = "stats";
    this.render();
  },
  "gladiator-cancel"() {
    this._gladiatorDraft = null;
    this.render();
  },
  "gladiator-tab"({ tab }) {
    if (tab in TABS) this._gladiatorTab = tab;
    this.render();
  },
  "gladiator-stat"({ stat, delta }) {
    const d = this._gladiatorDraft;
    if (!d || !STATS.includes(stat)) return;
    d.stats[stat] = Math.max(STAT_MIN, Math.min(STAT_MAX, num(d.stats[stat]) + num(delta)));
    this.render();
  },
  "gladiator-skill"({ skill, delta }) {
    const d = this._gladiatorDraft;
    const def = catalogueNow()?.skills.find(s => s.name === skill);
    if (!d || !def) return;
    const level = Math.max(def.basic ? BASIC_MIN : 0, Math.min(SKILL_MAX, num(d.skills[skill]) + num(delta)));
    if (level) d.skills[skill] = level;
    else delete d.skills[skill];
    this.render();
  },
  "gladiator-aware"({ key, delta }) {
    const d = this._gladiatorDraft;
    if (!d || !(key in AWARENESS)) return;
    d.awareness[key] = Math.max(0, Math.min(AWARENESS[key].max, num(d.awareness[key]) + num(delta)));
    this.render();
  },
  "gladiator-shop"({ kind }) {
    if (kind in KINDS) this._gladiatorShop = kind;
    this.render();
  },
  "gladiator-all-skills"() {
    this._gladiatorAllSkills = !this._gladiatorAllSkills;
    this.render();
  },
  "gladiator-add"({ uuid }) {
    const d = this._gladiatorDraft;
    const item = catalogueNow()?.byUuid.get(uuid);
    if (!d || !item) return;
    const have = d.gear.find(g => g.uuid === uuid);
    if (have) have.qty = num(have.qty) + 1;
    else d.gear.push({ ...item, qty: 1 });
    this.render();
  },
  "gladiator-remove"({ uuid }) {
    const d = this._gladiatorDraft;
    const have = d?.gear.find(g => g.uuid === uuid);
    if (!have) return;
    have.qty = num(have.qty) - 1;
    if (have.qty < 1) d.gear.splice(d.gear.indexOf(have), 1);
    this.render();
  },
  "gladiator-look"({ colour, frame }) {
    const d = this._gladiatorDraft;
    if (!d) return;
    if (COLOURS.includes(colour)) d.look.colour = colour;
    if (FRAMES.includes(frame)) d.look.frame = frame;
    this.render();
  },
  /* Challenges */
  "gladiator-pick"({ actorId }) {
    this._gladiatorFoe = actorId;
    this.render();
  },
  "gladiator-challenge"() {
    const actorId = this.context()?.actorId;
    if (actorId && this._gladiatorFoe) store.request("gladiator-challenge", { actorId, opponentId: this._gladiatorFoe, wager: num(this._gladiatorWager) });
  },
  async "gladiator-accept"({ id }) {
    const actorId = this.context()?.actorId;
    if (actorId && await confirm("Digital Gladiator", "Accept? It can't be stopped once it starts unless both of you agree, and the loser's Agent is fried.")) {
      store.request("gladiator-answer", { id, actorId, accept: true });
    }
  },
  "gladiator-decline"({ id }) {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("gladiator-answer", { id, actorId, accept: false });
  },
  "gladiator-withdraw"({ id }) {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("gladiator-withdraw", { id, actorId });
  },

  /* The duel */
  "gladiator-move"({ move }, event) {
    const actorId = this.context()?.actorId;
    const m = actorId && openMatchOf(store.apps.gladiatorMatches, actorId);
    if (!m) return;
    // One send per move: the buttons stay off until the host's answer redraws the page.
    for (const button of event?.currentTarget?.closest(".agent-gladiator-battle")?.querySelectorAll("[data-action='gladiator-move']") ?? []) button.disabled = true;
    store.request("gladiator-move", { id: m.id, actorId, move });
  },
  "gladiator-more"() {
    this._gladiatorMore = !this._gladiatorMore;
    this.render();
  },
  async "gladiator-concede"({ id }) {
    const actorId = this.context()?.actorId;
    if (actorId && await confirm("Concede", "Concede? You lose, and your Agent is fried.")) store.request("gladiator-move", { id, actorId, move: "concede" });
  },
  "gladiator-draw"({ id }) {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("gladiator-draw", { id, actorId });
  },
  "gladiator-watch"({ id }) {
    this._gladiatorWatch = id;
    this._gladiatorMore = false;
    this.render();
  },
  "gladiator-unwatch"() {
    this._gladiatorWatch = null;
    this.render();
  },
  "gladiator-leave"({ id }) {
    if (this._gladiatorWatch === id) this._gladiatorWatch = null;
    else this._gladiatorLeft = id;
    this.render();
  },

  /* GM */
  "gladiator-settle"({ mode }) {
    if (game.user.isGM && mode in SETTLE_MODES) game.settings.set(MODULE_ID, "gladiatorSettle", mode);
  },
  "gladiator-mode"({ id, mode }) {
    store.request("gladiator-mode", { id, mode });
  },
  async "gladiator-declare"({ id, winner }) {
    const m = store.apps.gladiatorMatches?.[id];
    if (!m) return;
    const loser = game.actors.get(m.a.actorId === winner ? m.b.actorId : m.a.actorId);
    if (await confirm("Declare the winner", `${displayName(game.actors.get(winner))} wins. This destroys ${displayName(loser)}'s Agent.`)) store.request("gladiator-declare", { id, winner });
  },
  async "gladiator-off"({ id }) {
    if (await confirm("Call it off", "No winner: both wagers go back and nothing is fried.")) store.request("gladiator-off", { id });
  },
  "gladiator-repair"({ actorId }) {
    store.request("gladiator-repair", { actorId });
  },

  "gladiator-save"() {
    const d = this._gladiatorDraft;
    const actorId = this.context()?.actorId;
    if (!d || !actorId) return;
    store.request("gladiator-save", { actorId, build: { ...d, gear: d.gear.map(g => ({ uuid: g.uuid, qty: g.qty })) } });
    this._gladiatorDraft = null;
    this.render();
  }
};

export const inputs = {
  "[data-gladiator-name]": {
    change(event) {
      if (this._gladiatorDraft) this._gladiatorDraft.name = event.currentTarget.value;
    }
  },
  "[data-gladiator-wager]": {
    change(event) {
      this._gladiatorWager = Math.max(0, num(event.currentTarget.value));
    }
  }
};

/**
 * A fried Agent is the whole phone: a dead screen, whichever app was open, until the GM repairs it. The battle view's
 * arena canvas is drawn (and animated) after every redraw (apps/gladiator/draw.js).
 */
export const phone = {
  render(html) {
    const canvas = html.querySelector("canvas.agent-gladiator-arena");
    if (canvas) showArena(this, canvas, store.apps.gladiatorMatches?.[canvas.dataset.match]);
    else if (this._gladiatorArena) stopArena(this);
  },
  close() {
    stopArena(this);
  },
  takeover(ctx, data) {
    const fried = ctx.perspective === "pc" ? friedAgent(ctx.subject.actor) : null;
    if (!fried) return false;
    data.gladiator = { fried: { ...fried, internal: ctx.subject.agent === "internal" } };
    data.page.gladiator = true;
    data.appPartial = appPartial("gladiator");
    return true;
  }
};

export const methods = {
  /**
   * The battle view a player sees instead of the page, or null: their live duel; their latest duel's result (ended in
   * the last RESULT_MS, not left yet); or the duel they're watching, while they're near it (the result once it ends).
   */
  _gladiatorFight(matches, actorId, open) {
    if (open?.status === "live" && open.mode === "play" && open.battle) return duelView(open, actorId, this._gladiatorMore);
    const last = matchesOf(matches, actorId).find(m => m.mode === "play" && m.battle);
    if (last && !open && ["done", "off"].includes(last.status) && last.id !== this._gladiatorLeft && Date.now() - (last.doneAt ?? 0) < RESULT_MS) return duelView(last, actorId);
    const watched = !open && matches[this._gladiatorWatch];
    if (!watched?.battle || sideOf(watched, actorId)) return null;
    if (watched.status !== "live" || this._gladiatorCanWatch(watched, actorId)) return duelView(watched, null);
    this._gladiatorWatch = null; // out of range: back to the normal page
    return null;
  },

  /** Is this character's token near either duelist's, on the active scene? */
  _gladiatorCanWatch(m, actorId) {
    return canWatch({ watcher: actorId, duelists: [m.a.actorId, m.b.actorId], scene: game.scenes.active });
  },

  /** Live duels this character could watch: { id, title }. */
  _gladiatorNearby(matches, actorId) {
    return Object.values(matches).filter(m => m.status === "live" && m.mode === "play" && m.battle && !sideOf(m, actorId) && this._gladiatorCanWatch(m, actorId))
      .map(m => ({ id: m.id, title: `${displayName(game.actors.get(m.a.actorId))} vs ${displayName(game.actors.get(m.b.actorId))}`, names: `${m.a.name} vs ${m.b.name}` }));
  },

  gladiatorData(ctx) {
    const matches = store.apps.gladiatorMatches ?? {};
    const watched = matches[this._gladiatorWatch];
    if (ctx.perspective === "gm") {
      if (watched?.battle) return { bar: appBar("gladiator"), battle: duelView(watched, null) };
      const settle = game.settings.get(MODULE_ID, "gladiatorSettle");
      const all = Object.values(matches).sort((x, y) => y.ts - x.ts).map(m => matchView(m, null));
      return {
        gm: true,
        bar: appBar("gladiator"),
        settle: Object.entries(SETTLE_MODES).map(([id, label]) => ({ id, label, on: id === settle })),
        open: all.filter(m => m.open),
        past: all.filter(m => !m.open),
        builds: Object.values(store.apps.gladiators ?? {}).map(b => ({ ...cardView(b), who: displayName(game.actors.get(b.actorId)) }))
      };
    }
    const open = openMatchOf(matches, ctx.actorId);
    const fight = this._gladiatorFight(matches, ctx.actorId, open);
    if (fight) return { bar: appBar("gladiator", { owner: ctx.subject.name }), battle: fight };
    const saved = store.apps.gladiators?.[ctx.actorId];
    const foes = playerCharacters().filter(a => a.id !== ctx.actorId && agentType(a))
      .map(a => ({ id: a.id, name: displayName(a), on: a.id === this._gladiatorFoe }));
    const base = {
      bar: appBar("gladiator", { owner: ctx.subject.name }), publisher: PUBLISHER, saved: saved ? cardView(saved) : null,
      match: open ? matchView(open, ctx.actorId) : null,
      challenge: !open && saved && !saved.problems?.length ? { foes, wager: num(this._gladiatorWager), ready: foes.some(f => f.on) } : null,
      nearby: open ? [] : this._gladiatorNearby(matches, ctx.actorId),
      history: matchesOf(matches, ctx.actorId).filter(m => !OPEN_STATUSES.has(m.status)).slice(0, 5).map(m => matchView(m, ctx.actorId)),
      opening: !!this._gladiatorOpening
    };
    // Only the builder needs the shop: start loading it in the background so Build opens at once.
    const cat = catalogueNow();
    const d = cat && this._gladiatorDraft?.actorId === ctx.actorId ? this._gladiatorDraft : null;
    if (!d) return base;

    const left = budgets(d, cat.skills);
    const tab = this._gladiatorTab ?? "stats";
    const level = name => num(d.skills[name]);
    const skillRow = s => ({ ...s, level: level(s.name), canDown: level(s.name) > (s.basic ? BASIC_MIN : 0), canUp: level(s.name) < SKILL_MAX && left.skills >= (s.x2 ? 2 : 1) });
    const arena = cat.skills.filter(s => ARENA_SKILLS.includes(s.name) || s.name.startsWith("Martial Arts"));
    const rest = cat.skills.filter(s => !arena.includes(s) && (this._gladiatorAllSkills || s.basic || level(s.name) > 0));
    const shopKind = this._gladiatorShop in KINDS ? this._gladiatorShop : "weapon";
    return {
      ...base,
      draft: {
        ...d, ...derived(d), left,
        eb: formatMoney(left.eb),
        tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, on: id === tab })),
        isStats: tab === "stats", isSkills: tab === "skills", isGear: tab === "gear",
        colours: COLOURS.map(c => ({ c, on: c === d.look.colour })),
        frames: FRAMES.map(f => ({ f, on: f === d.look.frame })),
        stats: STATS.map(s => ({ key: s, label: s.toUpperCase(), value: d.stats[s], canDown: d.stats[s] > STAT_MIN, canUp: d.stats[s] < STAT_MAX && left.stats > 0 })),
        awareness: Object.entries(AWARENESS).map(([key, a]) => ({ key, ...a, costLabel: a.cost === 1 ? "1 pt each" : `${a.cost} pts each`, level: num(d.awareness[key]), canDown: num(d.awareness[key]) > 0, canUp: num(d.awareness[key]) < a.max && left.awareness >= a.cost })),
        arenaSkills: arena.map(skillRow),
        otherSkills: rest.map(skillRow),
        allSkills: !!this._gladiatorAllSkills,
        cart: d.gear.map(g => ({ ...g, many: g.qty > 1, detail: gearDetail(g), cost: formatMoney(g.price * g.qty) })),
        kinds: Object.entries(KINDS).map(([id, label]) => ({ id, label, on: id === shopKind })),
        shop: cat.gear.filter(g => g.kind === shopKind).map(g => ({ ...g, detail: gearDetail(g), cost: formatMoney(g.price), canAdd: g.price <= left.eb })),
        problems: gladiatorProblems(d, cat.skills)
      }
    };
  }
};

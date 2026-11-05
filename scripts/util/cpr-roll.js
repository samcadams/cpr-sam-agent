/*
 * Rolls made without the sheet's own dialog (the host's rolls: Mystery Boxes, weather, skill rolls for a
 * character without the skill item), posted on Cyberpunk RED Core's own roll cards, so they look like the
 * sheet's rolls in chat and Dice So Nice shows them through the system's dice handler. Outside the system
 * (unit tests) a plain card.
 */

/** CPR's roll classes and CPRChat, or null outside the system. */
async function cpr() {
  if (globalThis.game?.system?.id !== "cyberpunk-red-core") return null;
  const route = path => foundry.utils.getRoute(`systems/${game.system.id}/modules/${path}`);
  const [rolls, { default: CPRChat }] = await Promise.all([import(route("rolls/cpr-rolls.js")), import(route("chat/cpr-chat.js"))]);
  return { ...rolls, CPRChat };
}

/** GM ids plus `also` (user ids), for a gmroll that a player sees too. */
const gmsAnd = also => [...new Set([...game.users.filter(u => u.isGM).map(u => u.id), ...also])];

/**
 * A rolled CPRRoll to chat on its roll card. `rollMode` overrides the roller's chat roll mode ("gmroll": whispered
 * to the GMs); `whisper` (user ids) whispers it to those users and the GMs.
 */
async function post(CPRChat, roll, { speaker, flavor, rollMode, whisper }) {
  roll.criticalCard = roll.wasCritical();
  const data = CPRChat.ChatDataSetup(await renderTemplate(roll.rollCard, roll), whisper ? "gmroll" : rollMode);
  if (whisper) data.whisper = gmsAnd(whisper);
  return ChatMessage.create({ ...data, speaker, ...(flavor ? { flavor } : {}) });
}

/** The plain card for when the system isn't there. */
function plainCard(total, { speaker, flavor, rollMode, whisper: also }) {
  const whisper = also ? { whisper: gmsAnd(also) } : rollMode === "gmroll" ? { whisper: gmsAnd([]) } : {};
  return ChatMessage.create({ speaker, flavor, content: `<p><strong>${total}</strong></p>`, ...whisper });
}

/**
 * An XdY roll (no criticals) on CPR's base roll card, "title (formula)" over the dice and the total. Returns
 * the total. `chat: false` rolls without a card (and without 3D dice). `whisper`: user ids that see it, with the GMs.
 */
export async function rollCard(formula, title, { speaker, flavor, rollMode, whisper, chat = true } = {}) {
  const sys = chat ? await cpr() : null;
  if (!sys) {
    const { total } = await new Roll(formula).evaluate();
    if (chat) await plainCard(total, { speaker, flavor: flavor ?? title, rollMode, whisper });
    return total;
  }
  const roll = new sys.CPRRoll(title, formula);
  roll.calculateCritical = false;
  await roll.roll();
  await post(sys.CPRChat, roll, { speaker, flavor, rollMode, whisper });
  return roll.resultTotal;
}

/**
 * A skill roll on CPR's skill roll card: 1d10 + STAT + skill level + `mods` ([{ value, source }]); a 10 adds
 * another d10 and a 1 takes one away. Returns { total, die, crit } (crit: that extra d10, signed).
 */
export async function skillRollCard({ skill, stat, statValue, level, mods = [] }, { speaker, flavor, rollMode } = {}) {
  const sys = await cpr();
  if (!sys) {
    const d10 = async () => (await new Roll("1d10").evaluate()).total;
    const die = await d10();
    const crit = die === 10 ? await d10() : die === 1 ? -(await d10()) : 0;
    const total = die + crit + statValue + level + mods.reduce((sum, m) => sum + m.value, 0);
    await plainCard(total, { speaker, flavor, rollMode });
    return { total, die, crit };
  }
  const roll = new sys.CPRSkillRoll(stat.toUpperCase(), statValue, skill, level);
  roll.addMod(mods);
  await roll.roll();
  await post(sys.CPRChat, roll, { speaker, flavor, rollMode });
  return { total: roll.resultTotal, die: roll.initialRoll, crit: roll.wasCritFail() ? -roll.criticalRoll : roll.criticalRoll };
}

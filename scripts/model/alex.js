/*
 * Ask Alex Anything (Ziggurat, free, preinstalled; All About Agents p. 7): "Allows a user to search
 * for and display data from the local CitiNet." The question goes to the GM, who answers as Alex, or
 * asks for a Library Search roll first (an Agent gives +2). Until then the player sees "Alex is
 * crawling the Pool…"; "No results" only when the GM says so.
 * Instant answers: Journal entries in a folder named "Data Pool" answer at once when a question
 * mentions their name or one of their keywords (a line "Keywords: a, b, c" in the entry's text).
 */

/** An example Data Pool entry (the GM Phone's "Create an example" button). */
export const EXAMPLE_ENTRY = {
  name: "Afterlife",
  text: "<p>Keywords: afterlife, merc bar, rogue, solo bar</p>"
    + "<p>The Afterlife: a bar in a former morgue in Watson, where edgerunners drink and fixers hire. Drinks are named for mercs who died famous.</p>"
    + "<p>Owner: Rogue. Open late. No gunfights inside.</p>"
};

export const AGENT_BONUS = 2;
export const DATA_POOL_FOLDER = "Data Pool";

/** Strip a journal page's HTML down to text. */
export const plainText = html => String(html ?? "").replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Data Pool entries: [{ name, keywords, text }] from Journal entries in the "Data Pool" folder.
 * `entries`: JournalEntry documents (defaults to game.journal).
 */
export function dataPool(entries = game.journal ?? []) {
  const out = [];
  for (const entry of entries) {
    if (entry.folder?.name !== DATA_POOL_FOLDER) continue;
    const text = [...(entry.pages ?? [])].filter(p => p.type === "text").map(p => plainText(p.text?.content)).join("\n\n");
    const line = text.match(/^\s*keywords?\s*:\s*(.+)$/im);
    const keywords = [entry.name, ...(line ? line[1].split(",") : [])].map(k => k.trim().toLowerCase()).filter(k => k.length > 2);
    out.push({ name: entry.name, keywords, text: text.replace(/^\s*keywords?\s*:.*$/im, "").trim() });
  }
  return out;
}

/** The Data Pool entry a question matches, or null: a keyword as a whole word or phrase. */
export function instantAnswer(question, pool) {
  const q = ` ${String(question).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const norm = k => ` ${k.replace(/[^a-z0-9]+/g, " ").trim()} `;
  return pool.find(e => e.keywords.some(k => q.includes(norm(k)))) ?? null;
}

/** The sheet's Library Search: INT + skill level + the Agent's bonus. */
export function librarySearchBase(actor) {
  const int = Number(actor?.system?.stats?.int?.value ?? 0) || 0;
  const skill = [...(actor?.items ?? [])].find(i => i.type === "skill" && /^library search$/i.test(i.name));
  const level = Number(skill?.system?.level ?? 0) || 0;
  return { int, level, bonus: AGENT_BONUS, total: int + level + AGENT_BONUS };
}

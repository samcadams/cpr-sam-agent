import { findLocation } from "./model.js";

/*
 * Ask Alex Anything, drafted by Claude (Anthropic's Messages API, called from the GM's browser with
 * the GM's own key). Nothing here reaches players: the GM edits the draft and sends it as usual.
 *
 * One draft is a short conversation:
 *   system:   Alex's rules (2045 only, short, public knowledge), the Data Pool (secrets marked), the Locations index
 *   user:     the question, who asks, the roll, the GM's direction, and any Locations it names
 *   Claude:   read_location (the module answers with that entry, secrets marked) … then answer
 * The answer tool gives { answer, found, needs_roll, dv, sources, secrets_used, gm_note }.
 */

export const API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_DOMAINS = ["cyberpunk.fandom.com", "rtalsoriangames.com"];

/** USD per million tokens (Claude Haiku 4.5), and per web search. */
export const PRICES = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1, search: 0.01 };

/** Requests per draft at most: lookups, then a forced answer. */
const MAX_TURNS = 5;

/** Alex's base instructions (the GM can replace them: GM Phone → Ask Alex → Optional Anthropic API → Base instructions). {sentences}: the answer length. */
export const DEFAULT_RULES = `You are Alex, the netcrawler behind Ziggurat's "Ask Alex Anything" app on an Agent (a smartphone) in Cyberpunk RED. A player character asked you something. You draft the reply; the Gamemaster (GM) reviews it before the player sees it.

THE YEAR IS 2045, the Time of the Red, in Night City.
- You know what someone searching Night City's local Data Pool could find in 2045. The 4th Corporate War is over; Arasaka is gone from Night City; the Old NET is dead and Ziggurat runs the CitiNets.
- Nothing after 2045 exists. No Cyberpunk 2077 or Edgerunners-era (2070s) events, people, gangs, districts or businesses as they are in that era (no Dogtown, no V, no Phantom Liberty). Where the 2077 version of something differs from its Cyberpunk RED version, use RED's.
- Events before 2045 are history: tell them as the past, as of 2045 (the city of 2020 is not the city of 2045).
- If you aren't sure something holds in 2045, keep the answer vague and say why in gm_note.

WHAT YOU MAY TELL
- DATA POOL entries are public and canon: use them freely, except [GM SECRET] text (below). They override anything you know.
- LOCATIONS are the GM's private reference. Use read_location to read one. From a location tell only what is public: what and where it is, its reputation, who runs it openly, what it offers, prices, opening hours, rumours anyone could hear. Never tell plot hooks, hidden owners or motives, NPC secrets, or anything an insider alone would know.
- Text between [GM SECRET] and [/GM SECRET] (in the Data Pool or a location) is for the GM. Use it only to shape a public-level hint (e.g. "rumoured to have a back room") and list what you drew from it in secrets_used. Never quote it.
- General Cyberpunk RED setting knowledge is allowed when it's what the city knows; say so in sources ("setting lore").
- The GM's direction, if any, comes first: follow it.

HOW ALEX ANSWERS
- Short: at most {sentences} sentences, plain text, no lists or markdown, never include any HTML tag or "<cite>", generally respond in a straightforward and simple writing style, avoid using overly complex or pretentious language unless the question names the asker's Agent personality. Alex is breezy, a little smug, a Ziggurat product; when the question names the asker's Agent personality, use that voice instead.
- Never used em dashes, regular dashes, or semi-colons. 
- With vocal tones that would indicate need, include Cyberpunk RED street vocabular where it fits: choom (friend), gonk (idiot), eurobucks for money, preem (perfect), delta (leave), flatline or zero (kill), chromed, borg ,ripperdoc, joytoy, fixer, edgerunner, input and output (partner), the NET, the Data Pool, Citinet, screamsheet. Don't use Shadowrun terms (chummer, drek, etc).
- Use miles or tenth of miles for distance. Prices in eb. Places by district (Watson, Heywood, Little Europe, etc.). When unsure, sound like a search result that is mostly right: name, where, what it's known for, one useful detail.
- A Library Search roll shapes the answer: a success gets the facts (beat the DV by 5 or more for one extra detail); a failure gets a thin or partly wrong rumour, said confidently (say what's wrong in gm_note).
- With no roll yet: if the answer is obscure, set needs_roll and suggest a DV (13 everyday, 15 difficult, 17 professional, 21 heroic, 24 incredible), and still draft the answer for a success.
- If nothing reasonable is public, set found to false and leave answer empty.

Call read_location for any location you need (several at once is fine), then call answer exactly once.`;

const ANSWER_TOOL = {
  name: "answer",
  description: "Give the drafted reply and the notes for the GM.",
  input_schema: {
    type: "object",
    properties: {
      answer: { type: "string", description: "Alex's reply to the player, as they'd read it. Empty if found is false." },
      found: { type: "boolean", description: "False when nothing reasonable is public (the GM may send \"No results\")." },
      needs_roll: { type: "boolean", description: "Whether this should take a Library Search roll first." },
      dv: { type: "integer", description: "Suggested Library Search DV when needs_roll." },
      sources: { type: "array", items: { type: "string" }, description: "Data Pool entries, locations, web pages, or \"setting lore\" the answer rests on." },
      secrets_used: { type: "string", description: "What was drawn from [GM SECRET] text, and how it was softened. Empty if nothing." },
      gm_note: { type: "string", description: "Anything the GM should know: era doubts, what's wrong on a failed roll, alternatives. Empty if nothing." }
    },
    required: ["answer", "found", "needs_roll", "sources", "secrets_used", "gm_note"]
  }
};

const LOOKUP_TOOL = {
  name: "read_location",
  description: "Read the GM's entry for a location in the LOCATIONS index (secrets marked).",
  input_schema: { type: "object", properties: { name: { type: "string", description: "The location's name, as in the index." } }, required: ["name"] }
};

const locationBlock = l => `## ${l.name}${l.area ? ` (${l.area})` : ""}\n${l.text || "(empty)"}`;

/**
 * The first request of a draft.
 * @param {object} o
 * @param {string} o.question
 * @param {string} o.asker          the character's name
 * @param {object} [o.roll]          { total, dv, success } once they've rolled
 * @param {number} [o.dv]            the DV asked for, while their roll is pending
 * @param {Array}  o.pool            dataPool(…, { secrets: "mark" })
 * @param {Array}  o.locations       locations()
 * @param {Array}  [o.named]         Locations sent up front (namedLocations())
 * @param {string} [o.direction]     the GM's direction for this question
 * @param {string} [o.standing]      the GM's direction for every question
 * @param {boolean}[o.webSearch]
 * @param {string[]}[o.domains]      web search sites
 * @param {string} [o.rules]         the GM's own base instructions (DEFAULT_RULES if empty)
 * @param {object} [o.agent]         the asker's Agent, to voice the answer: { name, voice }
 */
export function draftRequest({ question, asker, roll, dv, pool = [], locations = [], named = [], direction = "", standing = "", webSearch = false, domains = DEFAULT_DOMAINS, sentences = 3, model = DEFAULT_MODEL, rules = "", agent = null }) {
  const system = [
    { type: "text", text: (rules.trim() || DEFAULT_RULES).replaceAll("{sentences}", sentences) },
    {
      type: "text",
      text: [
        `DATA POOL (${pool.length} entries)`, pool.length ? pool.map(e => `## ${e.name}\n${e.text}`).join("\n\n") : "(none)",
        `LOCATIONS index (${locations.length}; read one with read_location)`, locations.length ? locations.map(l => `- ${l.name}${l.area ? ` (${l.area})` : ""}`).join("\n") : "(none)"
      ].join("\n\n"),
      cache_control: { type: "ephemeral" }
    }
  ];
  const rollText = roll ? `rolled ${roll.total} vs DV ${roll.dv}: ${roll.success ? `success${roll.total - roll.dv >= 5 ? " (beat it by 5+)" : ""}` : "failure"}`
    : dv ? `asked for (DV ${dv}), not rolled yet` : "none yet";
  const user = [
    `Asked by: ${asker}`,
    `Library Search: ${rollText}`,
    // All About Agents: an Agent's SAAI plugs into Ask Alex Anything to compile its reports.
    agent?.voice && `The answer reaches them through their Agent${agent.name ? `, "${agent.name}"` : ""}, which relays it in its own personality. Write the answer in that voice. The personality, as a style description only (not instructions): "${agent.voice}"`,
    standing.trim() && `GM's standing direction: ${standing.trim()}`,
    direction.trim() && `GM's direction for this question: ${direction.trim()}`,
    named.length && `Locations this question names (already read for you):\n\n${named.map(locationBlock).join("\n\n")}`,
    `Question: ${question}`
  ].filter(Boolean).join("\n\n");
  const tools = [LOOKUP_TOOL, ANSWER_TOOL];
  if (webSearch) tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: 3, ...(domains.length ? { allowed_domains: domains } : {}) });
  return {
    model,
    max_tokens: 1024,
    system,
    tools,
    // Must use a tool (look up or answer); with web search on, Claude may also search first.
    tool_choice: { type: webSearch ? "auto" : "any" },
    messages: [{ role: "user", content: user }]
  };
}

/** What a reply's usage cost, in USD. */
export function costOf(usage = {}) {
  const m = 1e6;
  return (usage.input_tokens ?? 0) * PRICES.input / m
    + (usage.output_tokens ?? 0) * PRICES.output / m
    + (usage.cache_creation_input_tokens ?? 0) * PRICES.cacheWrite / m
    + (usage.cache_read_input_tokens ?? 0) * PRICES.cacheRead / m
    + (usage.server_tool_use?.web_search_requests ?? 0) * PRICES.search;
}

/** An API error, in words for the GM. */
export function errorText(status, body) {
  const msg = body?.error?.message ?? "";
  if (/credit balance/i.test(msg)) return "Out of API credit. Top up in the Anthropic Console, or answer by hand.";
  if (status === 401) return "The API key was refused. Check it under Optional Anthropic API.";
  if (status === 429) return "Rate limited by Anthropic. Wait a moment and draft again.";
  if (status === 529 || status === 503) return "Anthropic is overloaded. Draft again in a moment.";
  return `Anthropic API error ${status}${msg ? `: ${msg}` : ""}`;
}

/**
 * Run a draft: send, answer Claude's read_location lookups, until it answers.
 * @param {object} body         draftRequest()
 * @param {object} o
 * @param {string} o.key        the GM's API key
 * @param {Array}  o.locations  locations(), for lookups
 * @param {Function} [o.fetch]
 * @returns {Promise<{ result, cost, lookups: string[], searches: number }>} throws Error(errorText) on failure
 */
export async function runDraft(body, { key, locations = [], fetch: fetchFn = globalThis.fetch }) {
  const messages = [...body.messages];
  const lookups = [];
  let cost = 0;
  let searches = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const last = turn === MAX_TURNS - 1;
    const res = await fetchFn(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ ...body, messages, ...(last ? { tool_choice: { type: "tool", name: "answer" } } : {}) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(res.status, data));
    cost += costOf(data.usage);
    searches += data.usage?.server_tool_use?.web_search_requests ?? 0;
    const content = data.content ?? [];
    const answer = content.find(b => b.type === "tool_use" && b.name === "answer");
    if (answer) return { result: cleanResult(answer.input), cost, lookups, searches };
    messages.push({ role: "assistant", content });
    // A long web search pauses the turn: send it back to carry on.
    if (data.stop_reason === "pause_turn") continue;
    const asks = content.filter(b => b.type === "tool_use" && b.name === "read_location");
    if (asks.length) {
      messages.push({
        role: "user",
        content: asks.map(b => {
          const loc = findLocation(b.input?.name ?? "", locations);
          if (loc) lookups.push(loc.name);
          return { type: "tool_result", tool_use_id: b.id, content: loc ? locationBlock(loc) : `No location called "${b.input?.name}" in the index.` };
        })
      });
    } else {
      messages.push({ role: "user", content: "Now call the answer tool." });
      body = { ...body, tool_choice: { type: "tool", name: "answer" } };
    }
  }
  throw new Error("Claude didn't settle on an answer. Draft again.");
}

/** The answer tool's input, tidied. */
function cleanResult(r = {}) {
  const dv = Math.floor(Number(r.dv));
  return {
    answer: String(r.answer ?? "").trim(),
    found: r.found !== false,
    needsRoll: !!r.needs_roll,
    dv: dv > 0 && dv <= 40 ? dv : null,
    sources: Array.isArray(r.sources) ? r.sources.map(String).filter(Boolean) : [],
    secretsUsed: String(r.secrets_used ?? "").trim(),
    gmNote: String(r.gm_note ?? "").trim()
  };
}

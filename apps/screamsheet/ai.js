import { API_URL, costOf, DEFAULT_MODEL, errorText } from "../alex/ai.js";
import { newBlock, newSheet, OUTLETS } from "./render.js";
import { depthOf, SPINS, uniqueTerms } from "./model.js";

/*
 * DataPool drafts by Claude (proposal phase 5): one request from the GM's browser with the GM's own
 * key (Ask Alex's, client setting "alexAi"). Claude writes the clipping in the outlet's voice with the
 * chosen spin; the result is a draft on the desk (scream-save), never published from here.
 *
 *   system: the rules below
 *   user:   the outlet and its voice, the spin, the depth, the subjects' public facts, the event, the GM's prompt
 *   Claude: the clipping tool, once: { headline, byline, desk, paragraphs, quote, brief, ticker, tags, gm_note }
 */

/** What each spin asks of the writer (keys: model.js SPINS). */
export const SPIN_RULES = {
  accurate: "Report it straight: what happened, who, where, what is still unknown. Fair to everyone named.",
  sensational: "Blow it up: loud verbs, scary adjectives, a headline that oversells, wild speculation framed as questions. Stretch the facts, never invent new ones outright.",
  corp: "Corp-friendly: the corps and the authorities are reasonable, edgerunners and gangs are the problem, euphemisms for anything ugly (\"incident\", \"restructuring\"), a spokesperson gets the last word.",
  hit: "A hit piece on the subjects: insinuation, unnamed sources, selective quotes, their worst angle. Nothing actionable outright, just enough to stick."
};

/** How an outlet writes (OUTLETS[].voice says it in a few words; this is the house style). */
const HOUSE = {
  n54: "Network 54's site: polished, upbeat even when it's grim, sponsor friendly, short punchy paragraphs.",
  wns: "World News Service wire copy: flat, dense, attributed (\"sources said\", \"according to\"), inverted pyramid, no adjectives.",
  street: "A street sheet pasted to a kiosk: lurid, slangy, all caps headline, gossip and outrage, written for the street.",
  board: "A post on an unmoderated Data Pool board: one poster's handle as the byline, lower case, typos, rumour, replies quoted as briefs.",
  blotter: "The NCPD public blotter: report style, times, charges, case numbers, \"suspect\", no opinions.",
  flickin: "Flick Ramirez's self-published blog: plain, curious, a little breathless, sure the truth matters; reports what witnesses and recordings show and ends on the open question. Byline F. Ramirez.",
  custom: "A Night City outlet."
};

export const DRAFT_RULES = `You write one screamsheet clipping (a news item on Night City's Data Pool) for a Cyberpunk RED game. The Gamemaster (GM) reviews it before any player sees it.

THE YEAR IS 2045, the Time of the Red, in Night City. Nothing after 2045 exists (no Cyberpunk 2077 or Edgerunners-era people, gangs, districts or businesses). Use Cyberpunk RED's version of anything that differs.

WHAT YOU MAY USE
- The subjects' public facts below, the event, and the GM's prompt. The GM's prompt comes first: follow it.
- General Night City setting knowledge the street would know.
- Never invent secrets, crimes or real names for the subjects beyond what the event and the prompt say. Unnamed witnesses, spokespeople and street voices are fine.

HOW YOU WRITE
- In the outlet's voice and with the spin given. The spin decides the slant, the outlet decides the style.
- Headline: at most 10 words. Body: 2 to 4 short paragraphs, 60 to 160 words in all.
- A pull quote, a brief and a ticker line only when the outlet would run one.
- The depth says how hard the story is to find: a Headline is on every kiosk; Buried, Deep and Ghost stories are smaller, stranger, half scrubbed.
- No em dashes. Plain text, no markdown or HTML. Prices in eb, places by district (Watson, Heywood, Little Europe, etc.). Street words where the outlet would use them (choom, gonk, preem, delta, flatline, chromed, borg, ripperdoc, fixer, edgerunner, screamsheet), never Shadowrun ones.

Call the clipping tool exactly once.`;

const CLIP_TOOL = {
  name: "clipping",
  description: "The clipping as it runs, and a note for the GM.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      byline: { type: "string", description: "Who wrote it, in the outlet's style (a reporter, a desk, a board handle, an officer's badge)." },
      desk: { type: "string", description: "The outlet's section it runs in, one of the desks listed (empty if none fits)." },
      paragraphs: { type: "array", items: { type: "string" } },
      quote: { type: "object", properties: { text: { type: "string" }, attr: { type: "string" } }, description: "Optional pull quote." },
      brief: { type: "object", properties: { head: { type: "string" }, text: { type: "string" } }, description: "Optional side brief (a reply on a board)." },
      ticker: { type: "string", description: "Optional ticker line for the masthead." },
      tags: { type: "array", items: { type: "string" }, description: "Up to 5 search tags (places, gangs, corps) a crawl should match." },
      gm_note: { type: "string", description: "What you made up or stretched, and anything the GM should check. Empty if nothing." }
    },
    required: ["headline", "byline", "paragraphs", "gm_note"]
  }
};

const subjectLine = s => `- ${s.name}${s.role ? `, ${s.role}` : ""}${Number.isFinite(s.reputation) ? `, Reputation ${s.reputation}` : ""}${s.handle ? `, on The Garden as ${s.handle}` : ""}${s.crews?.length ? `, crew: ${s.crews.join(", ")}` : ""}`;

/**
 * The request for one clipping.
 * @param {object} o
 * @param {string} o.outlet       OUTLETS key
 * @param {string} o.spin         SPINS key
 * @param {number} [o.dv]
 * @param {Array}  [o.subjects]   [{ name, role, reputation, handle, crews }]: public facts only
 * @param {string} [o.event]      what happened (a suggestion's source and notes, the draft's current text)
 * @param {string} [o.prompt]     the GM's direction
 * @param {string} [o.name]       the masthead's name when the GM renamed it
 */
export function clipRequest({ outlet, spin, dv = 0, subjects = [], event = "", prompt = "", name = "", model = DEFAULT_MODEL }) {
  const o = OUTLETS[outlet] ?? OUTLETS.custom;
  const user = [
    `Outlet: ${name || o.name} (${o.label}). Voice: ${o.voice || "the GM's own outlet"}. ${HOUSE[outlet] ?? HOUSE.custom}`,
    o.desks.length && `Desks: ${o.desks.join(", ")}`,
    `Spin: ${SPINS[spin] ?? SPINS.accurate}. ${SPIN_RULES[spin] ?? SPIN_RULES.accurate}`,
    `Depth: ${depthOf(dv).name} (${depthOf(dv).hint})`,
    subjects.length ? `Subjects (public facts):\n${subjects.map(subjectLine).join("\n")}` : "Subjects: none named",
    event.trim() && `The event:\n${event.trim()}`,
    prompt.trim() && `GM's prompt: ${prompt.trim()}`
  ].filter(Boolean).join("\n\n");
  return {
    model,
    max_tokens: 1200,
    system: [{ type: "text", text: DRAFT_RULES }],
    tools: [CLIP_TOOL],
    tool_choice: { type: "tool", name: "clipping" },
    messages: [{ role: "user", content: user }]
  };
}

/** Send it. Returns { result, cost }; throws Error(errorText) on failure. */
export async function runClip(body, { key, fetch: fetchFn = globalThis.fetch }) {
  const res = await fetchFn(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(res.status, data));
  const tool = (data.content ?? []).find(b => b.type === "tool_use" && b.name === "clipping");
  if (!tool || !String(tool.input?.headline ?? "").trim()) throw new Error("Claude didn't write a clipping. Draft again.");
  return { result: tool.input, cost: costOf(data.usage) };
}

// House rule (Ask Alex has it too): no em dashes.
const text = v => String(v ?? "").replace(/\s*—\s*/g, ", ").trim();

/**
 * Claude's clipping as a sheet in the outlet's masthead. `base`: the draft being rewritten (its masthead,
 * background and images stay; its text blocks are replaced).
 */
export function clipSheet(r, outlet, base = null) {
  const sheet = base ? structuredClone(base) : newSheet(outlet, []);
  const desks = sheet.masthead.brand?.desks ?? [];
  const desk = desks.find(d => d.toLowerCase() === text(r.desk).toLowerCase());
  if (desk) sheet.masthead.desk = desk;
  if (text(r.ticker)) sheet.masthead.ticker = text(r.ticker);
  const blocks = [newBlock("headline", { text: text(r.headline) })];
  if (text(r.byline)) blocks.push(newBlock("byline", { author: text(r.byline), dateline: "Night City" }));
  // Images the GM placed stay, after the headline.
  blocks.push(...(base?.blocks ?? []).filter(b => b.type === "image" || b.type === "ad"));
  const body = (Array.isArray(r.paragraphs) ? r.paragraphs : [r.paragraphs]).map(text).filter(Boolean).join("\n\n");
  if (body) blocks.push(newBlock("paragraph", { text: body }));
  if (text(r.quote?.text)) blocks.push(newBlock("quote", { text: text(r.quote.text), attr: text(r.quote.attr) ? `— ${text(r.quote.attr).replace(/^[—-]\s*/, "")}` : "" }));
  if (text(r.brief?.text)) blocks.push(newBlock("brief", { head: text(r.brief.head), text: text(r.brief.text) }));
  sheet.blocks = blocks;
  return sheet;
}

/** The clipping's tags: the draft's own plus Claude's (deduplicated). */
export const clipTags = (r, tags = []) => uniqueTerms([...tags, ...(Array.isArray(r.tags) ? r.tags.map(String) : [])], 20);

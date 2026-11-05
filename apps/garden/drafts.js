import { CORP_TIERS, keywordList, parseSpan, parseWhen, RELATIONS, SEED_STAGES, STAGES, whenText } from "./writer.js";

/*
 * garden-drafts v1: the batches the garden-writer skill writes into the inbox (plan: handoff
 * GARDEN-LIFE-PROPOSAL-2026-10-22 §9, §11, §13). Plain data and rules, no Foundry: the skill's
 * scripts/check-drafts.mjs runs this same parser in Node before it writes a batch.
 *
 *   garden-drafts v1
 *   batch: 2026-10-22T21-14-03  world: my-world
 *   base: 1234567890  # Day 14, 18:00
 *
 *   [mae1] @noodle_mae | +1h20m | normal | city | text            a post (label, tier, ring, hook optional)
 *     > @gridghost | +1h45m | text                                 a reply to the post above
 *     why: ... / img: path / rep: Vex Kade +1 "reason"             details of the line above
 *   > on post:Xy7Qp2 @noodle_mae | +30m | about | text             a reply to an existing post
 *   > on [mae1] @someone | +3h | text                              a reply to a post of this batch
 *   msg: Roach -> Vex Kade, Jun | +20h | text                      a private text (§9)
 *   dating: @noodle_mae | 41 | prompt | prompt | prompt            a Dating profile
 *   chatter: hype | watson, fire | text   chatter: any | text     a line for the crowd's auto-replies
 *   account: @roach | Roach | fixer | bio [| followers]            a new account (or a change to one)
 *   format: @inkwell | daily 07:00 | the morning headlines         a recurring post
 *   @noodle_mae :: arc: ...       Vex Kade :: keywords: ...        a profile change (@handle, or a character)
 *   happening: aB3dE9 cooling     seed: Qw12Er planted 2/3         a stage change
 *   # note: ...                   (a note for the GM)   # anything   (a comment)
 *
 * Without the header, the old drip lines ("@handle | text | picture | tier") still read, as posts
 * with no time (`at: null`): the importer spaces them out.
 *
 * Draft items (parseDrafts().items), each with `key` (unique in the batch) and `line`:
 *   post:    { label, handle, at, tier, ring, hook, seeds, text, why, img, rep: [{ who, delta, reason }] }
 *   reply:   { to: { key } | { postId }, handle, at, ring, text, why }
 *   msg:     { from, to: [names], at, text, why }
 *   dating:  { who, age, prompts }
 *   chatter: { mood (null = any), keywords, text }
 *   account: { handle, name, accountKind, bio, followers }
 *   format:  { handle, when, what }
 *   profile: { who, field, value }
 *   stage:   { what: "happening"|"seed", id, stage, progress }
 * `at` is seconds after `base` (may be negative: it goes out at once, backdated).
 */

export const RINGS = { city: "City", close: "Close to home", about: "About them" };
export const PROFILE_FIELDS = ["keywords", "voice", "agenda", "reacts", "cadence", "avoid", "ties", "arc", "lines", "face", "assets", "calendar", "tier", "relation"];
/** The corporation-only profile fields. */
export const CORP_FIELDS = ["face", "assets", "calendar", "tier", "relation"];
/** Account kinds a batch may make (model.js KINDS, but characters' own). */
export const ACCOUNT_KINDS = ["citizen", "news", "corp", "gang", "fixer", "celebrity", "crew"];
/** Draft text limits (the host cleans to the same). */
const MAX_TEXT = 500;
const MAX_REPLY = 300;
const MAX_MSG = 1000;

/** The random citizens' moods (model.js MOODS; not imported, so the skill's check runs without Foundry). */
export const CHATTER_MOODS = ["hype", "hater", "bot", "conspiracy", "lurker"];

const HEADER = /^garden-drafts\s+v(\d+)\s*$/i;
const LABEL = /^\[([\w-]{1,24})\]\s*/;
const HANDLE = /^@[\w.-]{1,40}$/;

/** A text without its trailing " # comment" (a "#" inside words, like "#1", stays). */
const stripComment = s => s.replace(/\s+#\s.*$/, "").trim();

/** "+1h20m" / "now" → seconds after base, or null. */
export function parseAt(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "now" || s === "+0" || s === "0") return 0;
  return parseSpan(s);
}

/** `rep: Vex Kade +1 "Seen leaving the Totentanz"` → { who, delta, reason } or null. */
export function parseRep(value) {
  const m = /^(.+?)\s+([+-]\d+)\s*(?:"([^"]*)"|(.*))?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  return { who: m[1].trim(), delta: Number(m[2]), reason: (m[3] ?? m[4] ?? "").trim() };
}

/**
 * Read a batch. Never throws: problems go to `errors` ({ line, message }; a batch with any is not
 * importable) and `warnings` (read anyway). `tiers`: known tier ids and names (lowercase), to check.
 */
export function parseDrafts(source, { tiers = null } = {}) {
  const out = { version: null, batch: null, world: null, base: null, baseNote: "", items: [], notes: [], errors: [], warnings: [], legacy: false };
  const lines = String(source ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const err = (line, message) => out.errors.push({ line, message });
  const warn = (line, message) => out.warnings.push({ line, message });
  const labels = new Map();
  let last = null; // the item that indented detail lines and "  >" replies belong to
  let lastPost = null;
  let n = 0;
  const key = prefix => `${prefix}${++n}`;
  const knownTier = t => !tiers || tiers.includes(t.toLowerCase());

  const firstReal = lines.findIndex(l => l.trim() && !l.trim().startsWith("#"));
  if (firstReal >= 0 && HEADER.test(lines[firstReal].trim())) out.version = Number(HEADER.exec(lines[firstReal].trim())[1]);
  else out.legacy = true;
  if (out.version !== null && out.version !== 1) err(firstReal + 1, `garden-drafts v${out.version}: this Foundry reads v1 only`);

  /** "| time | [tier] [ring] [hook] [seed:id] | text" after the handle: the fields, or null after an error. */
  const fields = (parts, ln, { tierOk = true } = {}) => {
    if (parts.length < 2) return err(ln, "expected at least \"time | text\""), null;
    const at = parseAt(parts[0]);
    if (at === null) return err(ln, `can't read the time "${parts[0]}" (like +1h20m, +2d4h, -3h, now)`), null;
    const text = parts.at(-1);
    const f = { at, text, tier: null, ring: null, hook: false, seeds: [] };
    for (const raw of parts.slice(1, -1)) {
      const t = raw.toLowerCase();
      if (t in RINGS) f.ring = t;
      else if (t === "hook") f.hook = true;
      else if (/^seed:\S+$/.test(t)) f.seeds.push(raw.slice(5));
      else if (tierOk && !f.tier && /^[\w-]{1,20}$/.test(t)) {
        if (!knownTier(t)) warn(ln, `unknown tier "${raw}" (random instead)`);
        f.tier = t;
      } else return err(ln, `unexpected field "${raw}" (is there a "|" in the text?)`), null;
    }
    if (!text) return err(ln, "empty text"), null;
    return f;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const raw = lines[i];
    const indented = /^\s/.test(raw);
    const line = raw.trim();
    if (!line || i === firstReal && out.version !== null) continue;

    // Notes for the GM, then plain comments.
    let m = /^#\s*note:\s*(.*)$/i.exec(line);
    if (m) {
      if (m[1].trim()) out.notes.push(m[1].trim());
      continue;
    }
    if (line.startsWith("#")) continue;

    // Header fields (anywhere before the first draft; "batch: x  world: y" may share a line).
    if (/^(batch|world|base):/i.test(line) && !out.items.length) {
      for (const [, k, v] of stripComment(line).matchAll(/(batch|world|base):\s*(\S+)/gi)) {
        const field = k.toLowerCase();
        if (field === "base") {
          if (!Number.isFinite(Number(v))) err(ln, `base must be a number (Garden time in seconds), not "${v}"`);
          else out.base = Number(v);
          out.baseNote = /#\s*(.*)$/.exec(line)?.[1]?.trim() ?? "";
        } else out[field] = v;
      }
      continue;
    }

    // Details of the line above (indented).
    m = /^(why|img|rep):\s*(.*)$/i.exec(line);
    if (m && indented) {
      const [field, value] = [m[1].toLowerCase(), m[2].trim()];
      if (!last) err(ln, `"${field}:" with nothing above it`);
      else if (field === "why") last.why = last.why ? `${last.why} ${value}` : value;
      else if (field === "img") {
        if (last.kind !== "post") err(ln, "img: belongs under a post");
        else last.img = value || null;
      } else if (last.kind !== "post") err(ln, "rep: belongs under a post");
      else {
        const rep = parseRep(value);
        if (!rep) err(ln, `can't read "rep: ${value}" (like: rep: Vex Kade +1 "reason")`);
        else last.rep.push(rep);
      }
      continue;
    }

    // Replies: indented under a post, or "> on post:<id>" / "> on [label]".
    if (line.startsWith(">")) {
      let rest = line.slice(1).trim();
      let to = null;
      m = /^on\s+(?:post:(\S+)|\[([\w-]+)\])\s+/i.exec(rest);
      if (m) {
        rest = rest.slice(m[0].length);
        if (m[1]) to = { postId: m[1] };
        else if (labels.has(m[2])) to = { key: labels.get(m[2]).key };
        else {
          err(ln, `no post labelled [${m[2]}] above`);
          continue;
        }
      } else if (indented && lastPost) to = { key: lastPost.key };
      else {
        err(ln, "a reply needs a post: indent it under one, or start it with \"> on post:<id>\"");
        continue;
      }
      const parts = rest.split("|").map(s => s.trim());
      const who = parts.shift();
      if (!HANDLE.test(who ?? "")) {
        err(ln, `a reply starts with @handle, not "${who}"`);
        continue;
      }
      const f = fields(parts, ln, { tierOk: false });
      if (!f) continue;
      if (f.text.length > MAX_REPLY) warn(ln, `reply cut to ${MAX_REPLY} characters`);
      last = { kind: "reply", key: key("r"), line: ln, to, handle: who.slice(1).toLowerCase(), at: f.at, ring: f.ring, text: f.text.slice(0, MAX_REPLY), why: "" };
      if (to.key && f.at < out.items.find(x => x.key === to.key).at) warn(ln, "reply is timed before its post (it goes out right after it)");
      out.items.push(last);
      continue;
    }

    // Accounts: "account: @handle | Name | kind | bio [| followers]".
    m = /^account:\s*(.+)$/i.exec(line);
    if (m) {
      const [who, name, kind, bio = "", followers = ""] = m[1].split("|").map(s => s.trim());
      if (!HANDLE.test(who ?? "") || !name) {
        err(ln, "account: needs \"@handle | Name | kind | bio\"");
        continue;
      }
      const accountKind = String(kind ?? "").toLowerCase() === "corporation" ? "corp" : String(kind ?? "").toLowerCase();
      if (!ACCOUNT_KINDS.includes(accountKind)) {
        err(ln, `account kind "${kind}" isn't one of ${ACCOUNT_KINDS.join(", ")}`);
        continue;
      }
      if (followers && !/^\d+$/.test(followers)) warn(ln, `followers "${followers}" isn't a number (left as it is)`);
      last = { kind: "account", key: key("a"), line: ln, handle: who.slice(1).toLowerCase(), name: name.slice(0, 60), accountKind, bio: bio.slice(0, 200), followers: /^\d+$/.test(followers) ? Number(followers) : null, why: "" };
      out.items.push(last);
      continue;
    }

    // Recurring formats: "format: @handle | daily 07:00 | what".
    m = /^format:\s*(.+)$/i.exec(line);
    if (m) {
      const [who, when, ...what] = m[1].split("|").map(s => s.trim());
      const parsedWhen = parseWhen(when);
      if (!HANDLE.test(who ?? "") || !parsedWhen) {
        err(ln, "format: needs \"@handle | daily 07:00 / weekly Thu 20:00 / after violent nights | what\"");
        continue;
      }
      last = { kind: "format", key: key("f"), line: ln, handle: who.slice(1).toLowerCase(), when: whenText(parsedWhen), what: what.join(" | ").slice(0, 300), why: "" };
      out.items.push(last);
      continue;
    }

    // Private texts.
    m = /^msg:\s*(.+)$/i.exec(line);
    if (m) {
      const parts = m[1].split("|").map(s => s.trim());
      const route = /^(.+?)\s*->\s*(.+)$/.exec(parts.shift() ?? "");
      if (!route) {
        err(ln, "msg: needs \"<from> -> <character>[, <character>]\"");
        continue;
      }
      const at = parseAt(parts[0]);
      if (at === null || parts.length < 2) {
        err(ln, "msg: needs \"| time | text\" after who");
        continue;
      }
      const text = parts.slice(1).join(" | ");
      if (text.length > MAX_MSG) warn(ln, `text cut to ${MAX_MSG} characters`);
      last = { kind: "msg", key: key("m"), line: ln, from: route[1], to: route[2].split(",").map(s => s.trim()).filter(Boolean), at, text: text.slice(0, MAX_MSG), why: "" };
      out.items.push(last);
      continue;
    }

    // Crowd chatter: "chatter: mood | [keywords |] text" (mood "any" = whoever answers).
    m = /^chatter:\s*(.+)$/i.exec(line);
    if (m) {
      const parts = m[1].split("|").map(s => s.trim());
      const mood = parts[0].toLowerCase();
      const text = parts.at(-1);
      if (parts.length < 2 || parts.length > 3 || !text) {
        err(ln, "chatter: needs \"mood | [keywords |] text\" (mood: any, " + CHATTER_MOODS.join(", ") + ")");
        continue;
      }
      if (mood !== "any" && !CHATTER_MOODS.includes(mood)) {
        err(ln, `chatter mood "${parts[0]}" isn't any, ${CHATTER_MOODS.join(", ")}`);
        continue;
      }
      last = { kind: "chatter", key: key("c"), line: ln, mood: mood === "any" ? null : mood, keywords: parts.length === 3 ? keywordList(parts[1]) : [], text: text.slice(0, MAX_REPLY), why: "" };
      out.items.push(last);
      continue;
    }

    // Dating profiles.
    m = /^dating:\s*(.+)$/i.exec(line);
    if (m) {
      const [who, age, ...prompts] = m[1].split("|").map(s => s.trim());
      const years = Number(age);
      if (!who || !Number.isInteger(years) || years < 18 || years > 120) {
        err(ln, "dating: needs \"<@handle or name> | age (18+) | prompt...\"");
        continue;
      }
      const list = prompts.filter(Boolean);
      if (!list.length) warn(ln, "dating profile with no prompts");
      if (list.length > 3) warn(ln, "only the first three prompts are kept");
      last = { kind: "dating", key: key("d"), line: ln, who, age: years, prompts: list.slice(0, 3).map(p => p.slice(0, 120)), why: "" };
      out.items.push(last);
      continue;
    }

    // Stage changes.
    m = /^(happening|seed):\s*(\S+)\s+(\w+)(?:\s+(\d+\/\d+))?\s*$/i.exec(stripComment(line));
    if (m) {
      const what = m[1].toLowerCase();
      const stage = m[3].toLowerCase();
      if (!(stage in (what === "seed" ? SEED_STAGES : STAGES))) {
        err(ln, `${what} stage "${m[3]}" isn't one of ${Object.keys(what === "seed" ? SEED_STAGES : STAGES).join(", ")}`);
        continue;
      }
      last = { kind: "stage", key: key("s"), line: ln, what, id: m[2], stage, progress: m[4] ?? null, why: "" };
      out.items.push(last);
      continue;
    }

    // Profile changes: "@handle :: field: value" or "Character Name :: field: value".
    m = /^([^|]+?)\s*::\s*(\w+):\s*(.*)$/.exec(line);
    if (m) {
      const field = m[2].toLowerCase();
      if (!PROFILE_FIELDS.includes(field)) {
        err(ln, `unknown profile field "${m[2]}" (${PROFILE_FIELDS.join(", ")})`);
        continue;
      }
      let value = m[3].trim();
      if (field === "calendar") {
        const [when, ...what] = value.split("|").map(s => s.trim());
        const at = parseAt(when);
        if (at === null || !what.join("")) {
          err(ln, "calendar: needs \"+4d | what\"");
          continue;
        }
        value = { at, what: what.join(" | ") };
      } else if (field === "relation") {
        const [who, kind, ...note] = value.split("|").map(s => s.trim());
        if (!who || !(String(kind ?? "").toLowerCase() in RELATIONS)) {
          err(ln, `relation: needs "Character | ${Object.keys(RELATIONS).join("/")} | note"`);
          continue;
        }
        value = { who, kind: kind.toLowerCase(), note: note.join(" | ").slice(0, 200) };
      } else if (field === "tier") {
        value = value.toLowerCase();
        if (!(value in CORP_TIERS)) {
          err(ln, `tier: ${Object.keys(CORP_TIERS).join(" or ")}`);
          continue;
        }
      } else if (field === "lines") value = value.split("|").map(s => s.trim()).filter(Boolean);
      else if (["keywords", "reacts", "ties", "assets"].includes(field)) value = keywordList(value);
      last = { kind: "profile", key: key("p"), line: ln, who: m[1].trim(), field, value, why: "" };
      out.items.push(last);
      continue;
    }

    // Posts: "[label] @handle | time | ... | text" (or an old drip line without the header).
    const label = LABEL.exec(line)?.[1] ?? null;
    const rest = label ? line.replace(LABEL, "") : line;
    const parts = rest.split("|").map(s => s.trim());
    if (out.legacy) {
      // "@handle | text | picture | tier" (only the text is required).
      const handle = parts.length > 1 && HANDLE.test(parts[0]) ? parts.shift().slice(1).toLowerCase() : null;
      const [text, img, tier] = parts;
      if (!text) continue;
      last = lastPost = { kind: "post", key: key("d"), line: ln, label: null, handle, at: null, tier: tier?.toLowerCase() || null, ring: null, hook: false, seeds: [], text: text.slice(0, MAX_TEXT), why: "", img: img || null, rep: [] };
      out.items.push(last);
      continue;
    }
    const who = parts.shift();
    if (!HANDLE.test(who ?? "")) {
      err(ln, `can't read this line (a post starts with @handle): "${line.slice(0, 60)}"`);
      continue;
    }
    const f = fields(parts, ln);
    if (!f) continue;
    if (label && labels.has(label)) {
      err(ln, `label [${label}] is used twice`);
      continue;
    }
    if (f.text.length > MAX_TEXT) warn(ln, `text cut to ${MAX_TEXT} characters`);
    last = lastPost = { kind: "post", key: key("d"), line: ln, label, handle: who.slice(1).toLowerCase(), at: f.at, tier: f.tier, ring: f.ring, hook: f.hook, seeds: f.seeds, text: f.text.slice(0, MAX_TEXT), why: "", img: null, rep: [] };
    if (label) labels.set(label, last);
    out.items.push(last);
  }

  if (!out.legacy) {
    if (!out.batch) err(1, "missing \"batch: <id>\"");
    else if (!/^[\w.-]{1,64}$/.test(out.batch)) err(1, `batch id "${out.batch}" may only have letters, digits, - _ .`);
    if (!out.world) err(1, "missing \"world: <world id>\"");
    if (out.base === null) err(1, "missing \"base: <Garden time>\" (from the writer pack)");
  }
  if (!out.items.length) warn(0, "the batch has no drafts");
  return out;
}

/** How a batch's posts split over the rings (unlabelled ones counted apart): { city, close, about, none, total }. */
export function batchMix(items) {
  const mix = { city: 0, close: 0, about: 0, none: 0, total: 0 };
  for (const item of items) {
    if (item.kind !== "post" && item.kind !== "reply") continue;
    mix[item.ring ?? "none"]++;
    mix.total++;
  }
  return mix;
}

/** One line on what a batch holds: "12 posts, 5 replies, 1 text, 2 dating profiles, 3 profile changes". */
export function batchSummary(items) {
  const count = k => items.filter(i => i.kind === k).length;
  const parts = [
    [count("post"), "post"], [count("reply"), "reply", "replies"], [count("msg"), "text"],
    [count("dating"), "dating profile"], [count("account"), "account"], [count("format"), "format"], [count("profile"), "profile change"], [count("stage"), "stage change"],
    [count("chatter"), "chatter line"]
  ];
  return parts.filter(([c]) => c).map(([c, one, many]) => `${c} ${c === 1 ? one : many ?? `${one}s`}`).join(", ") || "nothing";
}

/** A handle as the Garden keeps it, without the "@" (model.js handleFrom: lowercase, a-z 0-9 _, 24 at most). */
export const handleKey = h => String(h ?? "").replace(/^@/, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);

/**
 * Resolve a parsed batch against the world (the Drafts tab and approval use this). Pure: the caller
 * passes what it knows. Each item gets `wt` (Garden time; base + at) and `problems` (what stops it
 * from going out as is; it's still listed), and posts/replies `accountId` (null = a new citizen, or
 * "@random").
 *   accounts: { [id]: { id, handle, name, kind, actorId } }
 *   actors:   [{ id, name, aliases? }]   the characters (PCs) by name
 *   posts:    { [id]: post }             existing posts (for "on post:")
 *   happenings, seeds: { [id]: ... }
 */
export function resolveDrafts(parsed, { accounts = {}, actors = [], posts = {}, happenings = {}, seeds = {} } = {}) {
  const byHandle = new Map(Object.values(accounts).map(a => [handleKey(a.handle), a]));
  const actorOf = name => {
    const want = String(name ?? "").trim().toLowerCase();
    return actors.find(a => a.name.toLowerCase() === want || (a.aliases ?? []).some(x => x.toLowerCase() === want)) ?? null;
  };
  const base = parsed.base ?? 0;
  // Accounts the batch makes itself: the drafts that use them resolve when it's approved.
  const made = new Set(parsed.items.filter(i => i.kind === "account" && !byHandle.has(handleKey(i.handle))).map(i => handleKey(i.handle)));
  const accountOf = who => byHandle.get(handleKey(who)) ?? null;
  return parsed.items.map(item => {
    const r = { ...item, problems: [] };
    if (item.at !== undefined) r.wt = item.at === null ? null : base + item.at;
    if (item.kind === "post" || item.kind === "reply") {
      const account = item.handle === "random" ? { id: "@random" } : byHandle.get(handleKey(item.handle)) ?? null;
      r.accountId = account?.id ?? null;
      r.newHandle = account ? null : item.handle;
      r.madeHere = !account && made.has(handleKey(item.handle));
      if (account?.actorId) r.problems.push(`@${item.handle} is a character's account`);
    }
    if (item.kind === "post") {
      r.rep = item.rep.map(rep => ({ ...rep, actorId: actorOf(rep.who)?.id ?? null }));
      for (const rep of r.rep) if (!rep.actorId) r.problems.push(`rep: no character "${rep.who}"`);
    }
    if (item.kind === "reply" && item.to.postId && !posts[item.to.postId]) r.problems.push(`no post ${item.to.postId} (deleted, or another world's)`);
    if (item.kind === "msg") {
      r.toIds = item.to.map(name => actorOf(name)?.id ?? null);
      item.to.forEach((name, i) => !r.toIds[i] && r.problems.push(`no character "${name}"`));
    }
    if (item.kind === "dating" && item.who.startsWith("@")) {
      const account = accountOf(item.who);
      r.accountId = account?.id ?? null;
      if (!account && !made.has(handleKey(item.who))) r.problems.push(`no account ${item.who}`);
    }
    if (item.kind === "account") {
      const account = accountOf(item.handle);
      r.accountId = account?.id ?? null;
      r.before = account ? { name: account.name, kind: account.kind, bio: account.bio ?? "" } : null;
      if (account?.actorId) r.problems.push(`@${item.handle} is a character's account`);
    }
    if (item.kind === "format") {
      const account = accountOf(item.handle);
      r.accountId = account?.id ?? null;
      if (!account && !made.has(handleKey(item.handle))) r.problems.push(`no account @${item.handle}`);
    }
    if (item.kind === "profile") {
      if (item.who.startsWith("@")) {
        const account = accountOf(item.who);
        const madeAs = parsed.items.find(i => i.kind === "account" && handleKey(i.handle) === handleKey(item.who));
        r.accountId = account?.id ?? null;
        if (!account && !madeAs) r.problems.push(`no account ${item.who}`);
        else if (CORP_FIELDS.includes(item.field) && (madeAs?.accountKind ?? account.kind) !== "corp") r.problems.push(`${item.field} is for corporations only`);
        if (item.field === "relation") {
          r.value = { ...item.value, actorId: actorOf(item.value.who)?.id ?? null };
          if (!r.value.actorId) r.problems.push(`relation: no character "${item.value.who}"`);
        }
      } else {
        r.actorId = actorOf(item.who)?.id ?? null;
        if (!r.actorId) r.problems.push(`no character "${item.who}"`);
      }
      if (item.field === "calendar") r.wt = base + item.value.at;
    }
    if (item.kind === "stage" && !(item.what === "seed" ? seeds : happenings)[item.id]) r.problems.push(`no ${item.what} ${item.id}`);
    return r;
  });
}

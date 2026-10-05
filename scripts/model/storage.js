/*
 * How the host keeps its data on the server: a folder in the world, split into small files so a save
 * only rewrites what changed (host/core.js compares each file with what it last wrote).
 *
 * worlds/<world>/slopphone/
 *   messages.json                 { version, requests, quests, files: [the files below it] }
 *   threads/<id>.json             one conversation each
 *   apps/<key>.json               subs, watch (one entry per character)
 *   apps/<key>-<YYYY-MM>.json     alerts, ledger, dispatches, queries, by the month they happened
 *   garden.json                   { version, accounts, queue, paused, dating, files: [post files] }
 *   garden/posts-<YYYY-MM>.json   Garden posts, by the month they went up
 *   agent-photos/                 players' uploaded photos
 *
 * The host can't delete files, so one that's no longer needed (a deleted conversation) is emptied.
 */

export const DATA_FOLDER = "slopphone";
export const MESSAGES_FILE = "messages.json";
export const GARDEN_FILE = "garden.json";
export const SUBFOLDERS = ["threads", "apps", "garden", "agent-photos"];

const VERSION = 6;

/** App tables that only grow, split by month so old months are never rewritten. */
const MONTHLY = new Set(["alerts", "ledger", "dispatches", "queries"]);

export const monthOf = ts => (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 7) : "undated");

const fileId = id => String(id).replace(/[^\w-]/g, "_");

function byMonth(table, prefix, parts) {
  for (const [id, entry] of Object.entries(table ?? {})) {
    (parts[`${prefix}-${monthOf(entry?.ts)}.json`] ??= {})[id] = entry;
  }
}

/** The message data as files: { index, parts: { path: content } } (paths relative to the folder). */
export function splitMessages({ threads, requests, quests, apps }) {
  const parts = {};
  for (const thread of threads.values()) parts[`threads/${fileId(thread.id)}.json`] = thread;
  for (const [key, table] of Object.entries(apps ?? {})) {
    if (MONTHLY.has(key)) byMonth(table, `apps/${key}`, parts);
    else parts[`apps/${key}.json`] = table;
  }
  const index = {
    version: VERSION,
    requests: Object.fromEntries(requests),
    quests: Object.fromEntries(quests),
    files: Object.keys(parts)
  };
  return { index, parts };
}

/** Back from files: { threads, requests, quests, apps } as plain objects (like the old single file). */
export function joinMessages(index, parts) {
  const data = { threads: {}, requests: index.requests ?? {}, quests: index.quests ?? {}, apps: {} };
  for (const path of index.files ?? []) {
    const content = parts[path];
    if (!content) continue;
    if (path.startsWith("threads/")) {
      if (content.id) data.threads[content.id] = content;
      continue;
    }
    const [, key] = path.match(/^apps\/([^-/]+)(?:-[\w-]+)?\.json$/) ?? [];
    if (key) Object.assign((data.apps[key] ??= {}), content);
  }
  return data;
}

export function splitGarden(garden) {
  const { posts, ...rest } = garden;
  const parts = {};
  byMonth(posts, "garden/posts", parts);
  return { index: { version: VERSION, ...rest, files: Object.keys(parts) }, parts };
}

export function joinGarden(index, parts) {
  const { version, files = [], ...rest } = index;
  const posts = {};
  for (const path of files) Object.assign(posts, parts[path] ?? {});
  return { ...rest, posts };
}

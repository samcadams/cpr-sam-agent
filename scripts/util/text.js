/** Escape user text for HTML built outside Handlebars templates. */
export const esc = str => Handlebars.escapeExpression(str);

/** Trim user input and cap its length. */
export const clean = (value, max) => String(value ?? "").trim().slice(0, max);

/** "Johnny Silverhand" → "JS", for avatars without a picture. */
export function initials(name) {
  return String(name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("");
}

/** Rough 0–1 name similarity (Levenshtein), for suggesting the sheet a player meant. */
export function similarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** Call timer: 75000 → "1:15". */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "3m", "2h", "4d": how long ago, for the apps' lists. */
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

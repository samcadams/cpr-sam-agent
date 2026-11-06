/*
 * The Map's pins grouped by district (navMap.js, `cluster`): zoomed out, a district's pins show as its count;
 * zoomed in on it, they show themselves. Plain data, no DOM (tests/map.test.js).
 */

/** A group opens when its pins span this much of the map's smaller side on screen. */
export const EXPAND = 0.5;
/** Fewer pins than this: never grouped. */
export const CLUSTER_MIN = 3;
/** The least span (scene px) a group is taken to have, so a group on one spot needn't be zoomed into forever. */
const MIN_SPAN = 200;

/**
 * The pins (not districts' own `big` pins) by district: [{ key (the district, or null), pins, label (the district's
 * pin, or null), box: { x0, y0, x1, y1 }, at: { x, y } (the label's spot, or the pins' middle) }].
 */
export function pinGroups(pins) {
  const labels = new Map(pins.filter(p => p.big).map(p => [p.name, p]));
  const groups = new Map();
  for (const p of pins) {
    if (p.big) continue;
    const key = p.district ?? null;
    if (!groups.has(key)) groups.set(key, { key, pins: [], label: (key !== null && labels.get(key)) || null });
    groups.get(key).pins.push(p);
  }
  return [...groups.values()].map(g => {
    const xs = g.pins.map(p => p.x);
    const ys = g.pins.map(p => p.y);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const at = g.label ? { x: g.label.x, y: g.label.y } : { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
    return { ...g, box, at };
  });
}

/** The scale (screen px per scene px) at which a group opens, on a map `width` × `height` screen px. */
export function expandedAt(group, width, height) {
  const { x0, y0, x1, y1 } = group.box;
  return EXPAND * Math.min(width, height) / Math.max(x1 - x0, y1 - y0, MIN_SPAN);
}

/**
 * Whether a group's pins show (the view: { cx, cy, scale }): a small group always; otherwise zoomed in far enough
 * on it (from `namesAt` in, every group is), and it near the screen (off screen, it stays shut, so a map zoomed in
 * lays out only the pins round it). An open group (`open`) shuts only a little further out or away, so a pinch
 * wobbling on the line doesn't open and shut it every frame.
 */
export function isExpanded(group, view, width, height, namesAt, open = false) {
  if (group.pins.length < CLUSTER_MIN) return true;
  if (view.scale < Math.min(expandedAt(group, width, height), namesAt) * (open ? 0.8 : 1)) return false;
  // The view, and a quarter of a screen round it (half, while open), in scene px.
  const margin = open ? 1 : 0.75;
  const hw = margin * width / view.scale;
  const hh = margin * height / view.scale;
  const { x0, y0, x1, y1 } = group.box;
  return x0 <= view.cx + hw && x1 >= view.cx - hw && y0 <= view.cy + hh && y1 >= view.cy - hh;
}

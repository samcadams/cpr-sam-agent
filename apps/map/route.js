/*
 * Routes on the NAV map's roads. The road network is traced from the map picture once, offline
 * (a graph tracer script), and kept beside it as
 * map.graph.json: { width, height (the picture's px), nodes: [x0, y0, …], edges: [[a, b, length,
 * highway (0/1), [x0, y0, …] (its line)]] }, everything in the picture's px.
 *
 * A route is the quickest by car (highways faster than streets), from the road nearest the start to the
 * road nearest the end. Its length is what's driven, plus the short walks on and off the road network.
 * Plain logic, no Foundry: positions are the picture's px; util/mapGraph.js loads the file, the Map and
 * Combat Cabb convert to and from their own units.
 */

/** Travel speeds, mph: on foot, and by car on streets and on highways. */
export const SPEEDS = { walk: 3, street: 25, highway: 55 };

/** Grid cell (picture px) for finding the nearest node. */
const CELL = 256;

/** The network ready to route on: adjacency lists and a grid of its nodes. */
export function roadNetwork(data) {
  const n = data.nodes.length / 2;
  const adj = Array.from({ length: n }, () => []);
  data.edges.forEach(([a, b, length, highway], i) => {
    adj[a].push({ to: b, edge: i, length, highway: !!highway });
    adj[b].push({ to: a, edge: i, length, highway: !!highway });
  });
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(data.nodes[2 * i] / CELL)},${Math.floor(data.nodes[2 * i + 1] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return { ...data, count: n, adj, grid };
}

const at = (net, i) => ({ x: net.nodes[2 * i], y: net.nodes[2 * i + 1] });

/** The node nearest a point (picture px): its index, or -1 for an empty network. */
export function nearestNode(net, x, y) {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  let best = -1;
  let bestD = Infinity;
  // Rings of cells outward, until a ring can't hold anything nearer.
  for (let r = 0; r < 64; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const i of net.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const p = at(net, i);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) [best, bestD] = [i, d];
        }
      }
    }
    if (best >= 0 && bestD <= r * CELL) break;
  }
  return best;
}

/** A small binary heap of [priority, value]. */
class Heap {
  constructor() {
    this.items = [];
  }

  push(p, v) {
    const a = this.items;
    a.push([p, v]);
    for (let i = a.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

/**
 * A route from one point to another (picture px): by car (`drive`, the quickest: highways are faster) or
 * on foot (`walk`, the shortest). { points: [x0, y0, …] (the line to draw, picture px), length (px, all
 * of it), highway (px of it on highways), street (px on streets), walk (px on foot to and from the roads) },
 * or null when there's no way through.
 */
export function route(net, from, to, mode = "drive") {
  const a = nearestNode(net, from.x, from.y);
  const b = nearestNode(net, to.x, to.y);
  if (a < 0 || b < 0) return null;
  const goal = at(net, b);
  // Cost = time: px / mph (the same units throughout); the heuristic can't overestimate (highway speed).
  const walking = mode === "walk";
  const cost = e => (walking ? e.length : e.length / (e.highway ? SPEEDS.highway : SPEEDS.street));
  const h = i => {
    const p = at(net, i);
    return Math.hypot(p.x - goal.x, p.y - goal.y) / (walking ? 1 : SPEEDS.highway);
  };
  const best = new Float64Array(net.count).fill(Infinity);
  const via = new Int32Array(net.count).fill(-1); // the edge taken into each node
  best[a] = 0;
  const open = new Heap();
  open.push(h(a), a);
  while (open.size) {
    const [, i] = open.pop();
    if (i === b) break;
    for (const e of net.adj[i]) {
      const c = best[i] + cost(e);
      if (c < best[e.to]) {
        best[e.to] = c;
        via[e.to] = e.edge;
        open.push(c + h(e.to), e.to);
      }
    }
  }
  if (best[b] === Infinity) return null;

  // Back from the end: each edge's line, turned the way it's driven.
  const pieces = [];
  let highway = 0;
  let street = 0;
  for (let i = b; i !== a;) {
    const [ea, eb, length, hw, line] = net.edges[via[i]];
    const prev = ea === i ? eb : ea;
    const pts = [];
    for (let k = 0; k < line.length; k += 2) pts.push([line[k], line[k + 1]]);
    // The line runs a → b; driven prev → i.
    if (ea !== prev) pts.reverse();
    pieces.unshift(pts);
    if (hw) highway += length;
    else street += length;
    i = prev;
  }
  const start = at(net, a);
  const end = goal;
  const walk = Math.hypot(start.x - from.x, start.y - from.y) + Math.hypot(end.x - to.x, end.y - to.y);
  const points = [from.x, from.y, start.x, start.y];
  for (const pts of pieces) for (const [x, y] of pts) points.push(x, y);
  points.push(end.x, end.y, to.x, to.y);
  return { points, length: highway + street + walk, highway, street, walk };
}

/**
 * How long it takes, in minutes: { drive (the drive's route by car, the walks on and off the road on foot),
 * walk (the walking route on foot) }. `milesPerPx`: the map's scale.
 */
export function travelTimes(drive, walk, milesPerPx) {
  const mi = px => px * milesPerPx;
  return {
    drive: (mi(drive.highway) / SPEEDS.highway + mi(drive.street) / SPEEDS.street + mi(drive.walk) / SPEEDS.walk) * 60,
    walk: (mi((walk ?? drive).length) / SPEEDS.walk) * 60
  };
}

/** "45 min", "1 h 20 min" (a minute at least). */
export function formatMinutes(min) {
  const m = Math.max(1, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

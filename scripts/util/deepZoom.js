/*
 * Deep Zoom (.dzi) picture pyramids: a big picture cut into tiles at halving sizes, kept beside it
 * (map.jpg → map.dzi + map_files/<level>/<col>_<row>.<format>), as `vips dzsave` makes them. Drawing
 * only the tiles a view needs, at the size it needs, spares decoding the whole picture. A picture
 * without a pyramid is drawn whole, as before.
 */

const pyramids = new Map();

/** The picture's pyramid, read from its .dzi file. */
async function load(src) {
  const url = src.replace(/(\.[^./?#]+)?([?#].*)?$/, ".dzi");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
    const image = doc.querySelector("Image");
    const size = doc.querySelector("Size");
    const width = Number(size?.getAttribute("Width"));
    const height = Number(size?.getAttribute("Height"));
    const tileSize = Number(image?.getAttribute("TileSize"));
    if (!(width > 0 && height > 0 && tileSize > 0)) return null;
    // A re-cut pyramid keeps its tiles' names: its date on the tiles, so browsers don't show the old ones.
    const stamp = res.headers.get("last-modified");
    return {
      query: stamp ? `?v=${Date.parse(stamp) || encodeURIComponent(stamp)}` : "",
      width, height, tileSize,
      overlap: Number(image.getAttribute("Overlap")) || 0,
      format: image.getAttribute("Format") || "jpg",
      base: url.replace(/\.dzi$/, "_files"),
      maxLevel: Math.ceil(Math.log2(Math.max(width, height)))
    };
  } catch {
    return null;
  }
}

/**
 * The pyramid of a picture: the pyramid, null (it has none), or a Promise while it's being looked up
 * (once per picture a session).
 */
export function deepZoom(src) {
  if (!pyramids.has(src)) pyramids.set(src, load(src).then(dz => (pyramids.set(src, dz), dz)));
  return pyramids.get(src);
}

/**
 * The tiles that cover part of the picture at `px` pixels wide (or the nearest size up; the full picture
 * at most): [{ url, x, y, w, h }], with x, y, w and h as fractions of the picture. `part`: { x0, y0, x1, y1 },
 * fractions too.
 */
export function deepZoomTiles(dz, px, part = { x0: 0, y0: 0, x1: 1, y1: 1 }) {
  const down = Math.max(0, Math.floor(Math.log2(dz.width / Math.max(1, px))));
  const level = Math.max(0, dz.maxLevel - down);
  const scale = 2 ** (dz.maxLevel - level);
  const lw = Math.ceil(dz.width / scale);
  const lh = Math.ceil(dz.height / scale);
  const { tileSize: ts, overlap: ov } = dz;
  const clamp = v => Math.min(1, Math.max(0, v));
  const span = (a, b, size) => [Math.floor((clamp(a) * size) / ts), Math.floor(Math.min(size - 1, clamp(b) * size) / ts)];
  const [c0, c1] = span(part.x0, part.x1, lw);
  const [r0, r1] = span(part.y0, part.y1, lh);
  const tiles = [];
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      const x = c * ts - (c ? ov : 0);
      const y = r * ts - (r ? ov : 0);
      tiles.push({
        url: `${dz.base}/${level}/${c}_${r}.${dz.format}${dz.query ?? ""}`,
        x: x / lw, y: y / lh, w: (Math.min(lw, (c + 1) * ts + ov) - x) / lw, h: (Math.min(lh, (r + 1) * ts + ov) - y) / lh
      });
    }
  }
  return { level, tiles };
}

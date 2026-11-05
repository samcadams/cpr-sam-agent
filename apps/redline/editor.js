import { buildTrack, crossings, kmaxOf, LAYOUT, placedMap, pointsFrom, SEG, START, trackSpec } from "./model.js";

/*
 * REDLINE's layout editor (the GM's track builder, apps/redline/page.js): a big window with the track
 * drawn to scale. The layout is a smooth curve through control points (apps/redline/model.js, layoutShape): drag
 * a point to move it, drag the empty map to pan, the wheel zooms, double-click the road to add a point,
 * right-click a point to take it out; Ctrl+Z undoes. The road is coloured by how sharp it is against the
 * difficulty's limit, and bends past it (which the track eases out) are marked, as are places it crosses
 * itself. Apply hands the points back to the builder's draft.
 */

/** Colours on the map. */
const C = { bg: "#07040f", grid: "rgba(0, 240, 255, 0.07)", grid5: "rgba(0, 240, 255, 0.16)", road: "#00f0ff", warm: "#f5d300", hot: "#ff2a3d", handle: "#ff2a6d", start: "#ffffff", finish: "#f5d300", text: "#d8e6ff" };
const HAZARD = { pothole: "#c9a77a", wreck: "#ff8a1c", checkpoint: "#3d6bff", roadblock: "#ff2a3d", flood: "#40c4ff", ramp: "#f5d300" };
/** How near (screen pixels) a click must be to grab a point. */
const GRAB = 10;

/** Open the editor on a spec; `onApply(points | null)` when the GM applies (null: back to the seed's own layout). */
export function openLayoutEditor(spec, onApply) {
  new LayoutEditor(spec, onApply).render(true);
}

class LayoutEditor extends Application {
  constructor(spec, onApply) {
    super();
    this.spec = trackSpec(spec);
    this.onApply = onApply;
    this.points = this.spec.points?.map(p => [...p]) ?? pointsFrom(buildTrack({ ...this.spec, points: null }));
    this.history = [];
    this.view = null;
    this.rebuild();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "redline-layout-editor",
      title: "REDLINE: track layout",
      classes: ["agent-redline-editor"],
      width: 780,
      height: 780,
      resizable: true
    });
  }

  get title() {
    return `REDLINE: ${this.spec.name || "track"} layout`;
  }

  async _renderInner() {
    const circuit = this.spec.kind === "circuit";
    return $(`<div class="rl-editor">
      <div class="rl-editor-bar">
        <button type="button" data-rl="fit" title="Fit the track in view"><i class="fas fa-expand"></i> Fit</button>
        <button type="button" data-rl="undo" title="Undo (Ctrl+Z)"><i class="fas fa-rotate-left"></i> Undo</button>
        <button type="button" data-rl="random" title="Throw away the drawn layout: the seed's own one"><i class="fas fa-dice"></i> Random layout</button>
        <span class="rl-editor-spacer"></span>
        <button type="button" data-rl="cancel"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="button" data-rl="apply" class="rl-editor-apply"><i class="fas fa-check"></i> Apply</button>
      </div>
      <div class="rl-editor-map"><canvas aria-label="The track's layout. Drag points to move them."></canvas></div>
      <p class="rl-editor-info" aria-live="polite"></p>
      <p class="rl-editor-help">Drag a point to move it · drag the map to pan · wheel to zoom · double-click the road to add a point · right-click a point to remove it · Ctrl+Z undoes. ${circuit ? "The white dot is the start line; the grid sits just behind it." : "White: the start (keep the first stretch fairly straight, the grid sits there). Yellow: the finish."}</p>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    this.canvas = root.querySelector("canvas");
    this.info = root.querySelector(".rl-editor-info");
    root.querySelector("[data-rl=fit]").addEventListener("click", () => this.fit());
    root.querySelector("[data-rl=undo]").addEventListener("click", () => this.undo());
    root.querySelector("[data-rl=random]").addEventListener("click", () => {
      this.onApply(null);
      this.close();
    });
    root.querySelector("[data-rl=cancel]").addEventListener("click", () => this.close());
    root.querySelector("[data-rl=apply]").addEventListener("click", () => {
      this.onApply(this.points.map(([x, y]) => [Math.round(x), Math.round(y)]));
      this.close();
    });
    this.listen(this.canvas);
    // Fitted once the window has its size (then kept as the GM leaves it).
    this.resize = new ResizeObserver(() => {
      const box = this.canvas.parentElement.getBoundingClientRect();
      if (!this.view && box.width > 100 && box.height > 100) this.fit();
      else this.draw();
    });
    this.resize.observe(this.canvas.parentElement);
  }

  async close(options) {
    this.resize?.disconnect();
    return super.close(options);
  }

  /** The track as the points build it (and what to warn about). */
  rebuild() {
    this.track = buildTrack({ ...this.spec, points: this.points });
    this.map = placedMap(this.track);
    this.crosses = crossings(this.map, this.track.closed);
  }

  remember() {
    this.history.push(this.points.map(p => [...p]));
    if (this.history.length > 60) this.history.shift();
  }

  undo() {
    const last = this.history.pop();
    if (!last) return;
    this.points = last;
    this.rebuild();
    this.draw();
  }

  /** Everything in view, with a margin. */
  fit() {
    const all = [...this.map, ...this.points];
    const xs = all.map(p => p[0]);
    const ys = all.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const box = this.canvas.parentElement.getBoundingClientRect();
    const zoom = Math.min((box.width - 60) / Math.max(1, x1 - x0), (box.height - 60) / Math.max(1, y1 - y0));
    this.view = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.max(0.02, Math.min(4, zoom)) };
    this.draw();
  }

  /** World metres to the canvas (CSS pixels), and back. */
  toScreen([x, y]) {
    const { w, h } = this.size;
    return [w / 2 + (x - this.view.x) * this.view.zoom, h / 2 - (y - this.view.y) * this.view.zoom];
  }

  toWorld(px, py) {
    const { w, h } = this.size;
    return [this.view.x + (px - w / 2) / this.view.zoom, this.view.y - (py - h / 2) / this.view.zoom];
  }

  /** The point under a screen position, or -1. */
  pointAt(px, py) {
    let best = -1;
    let dist = GRAB;
    this.points.forEach((p, i) => {
      const [sx, sy] = this.toScreen(p);
      const d = Math.hypot(sx - px, sy - py);
      if (d < dist) [best, dist] = [i, d];
    });
    return best;
  }

  listen(canvas) {
    const local = event => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    let drag = null;
    let frame = null;
    const redraw = () => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        this.rebuild();
        this.draw();
      });
    };
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const [px, py] = local(event);
      const i = this.pointAt(px, py);
      canvas.setPointerCapture(event.pointerId);
      if (i >= 0) {
        this.remember();
        drag = { point: i };
      } else drag = { pan: [px, py, this.view.x, this.view.y] };
    });
    canvas.addEventListener("pointermove", event => {
      const [px, py] = local(event);
      if (!drag) {
        canvas.style.cursor = this.pointAt(px, py) >= 0 ? "grab" : "default";
        return;
      }
      if (drag.point !== undefined) {
        const [x, y] = this.toWorld(px, py);
        const reach = LAYOUT.reach;
        this.points[drag.point] = [Math.max(-reach, Math.min(reach, x)), Math.max(-reach, Math.min(reach, y))];
        redraw();
      } else {
        const [x0, y0, vx, vy] = drag.pan;
        this.view.x = vx - (px - x0) / this.view.zoom;
        this.view.y = vy + (py - y0) / this.view.zoom;
        this.draw();
      }
    });
    const end = () => (drag = null);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const [px, py] = local(event);
      const before = this.toWorld(px, py);
      this.view.zoom = Math.max(0.02, Math.min(6, this.view.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.toWorld(px, py);
      this.view.x += before[0] - after[0];
      this.view.y += before[1] - after[1];
      this.draw();
    }, { passive: false });
    canvas.addEventListener("dblclick", event => {
      const [px, py] = local(event);
      if (this.points.length >= LAYOUT.max) return ui.notifications.info(`REDLINE: ${LAYOUT.max} points at most.`);
      // Into the span of the control line nearest the click.
      const spans = this.track.closed ? this.points.length : this.points.length - 1;
      let best = 0;
      let dist = Infinity;
      for (let i = 0; i < spans; i++) {
        const d = segmentDistance([px, py], this.toScreen(this.points[i]), this.toScreen(this.points[(i + 1) % this.points.length]));
        if (d < dist) [best, dist] = [i, d];
      }
      this.remember();
      this.points.splice(best + 1, 0, this.toWorld(px, py));
      redraw();
    });
    canvas.addEventListener("contextmenu", event => {
      event.preventDefault();
      const [px, py] = local(event);
      const i = this.pointAt(px, py);
      if (i < 0) return;
      if (this.points.length <= LAYOUT.min[this.spec.kind]) return ui.notifications.info("REDLINE: that's as few points as a layout can have.");
      this.remember();
      this.points.splice(i, 1);
      redraw();
    });
    this.element[0].addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
      }
    });
  }

  draw() {
    const canvas = this.canvas;
    if (!canvas?.isConnected || !this.view) return;
    const box = canvas.parentElement.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.size = { w: Math.max(50, box.width), h: Math.max(50, box.height) };
    const { w, h } = this.size;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) Object.assign(canvas, { width: Math.round(w * ratio), height: Math.round(h * ratio) });
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(ctx);
    this.drawRoad(ctx);
    this.drawPoints(ctx);
    this.drawInfo();
  }

  /** 100 m squares (500 m darker), and a scale bar. */
  drawGrid(ctx) {
    const { w, h } = this.size;
    const zoom = this.view.zoom;
    const step = zoom > 0.25 ? 100 : zoom > 0.05 ? 500 : 1000;
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(w, h);
    ctx.lineWidth = 1;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen([x, 0]);
      ctx.strokeStyle = x % (step * 5) === 0 ? C.grid5 : C.grid;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.toScreen([0, y]);
      ctx.strokeStyle = y % (step * 5) === 0 ? C.grid5 : C.grid;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
    }
    const bar = step * zoom;
    ctx.fillStyle = C.text;
    ctx.fillRect(12, h - 16, bar, 3);
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${step} m`, 12, h - 22);
  }

  /** The road to scale, coloured by how sharp it is; eased bends and crossings marked; hazards; start and finish. */
  drawRoad(ctx) {
    const { track, map } = this;
    const kmax = kmaxOf(this.spec);
    const eased = new Set(track.eased);
    const width = Math.max(3, 14 * this.view.zoom);
    ctx.lineCap = "round";
    const n = map.length;
    const spans = track.closed ? n : n - 1;
    for (let i = 0; i < spans; i++) {
      const a = this.toScreen(map[i]);
      const b = this.toScreen(map[(i + 1) % n]);
      const sharp = Math.abs(track.segs[i].k) / kmax;
      ctx.strokeStyle = eased.has(i) ? C.hot : sharp > 0.75 ? C.warm : C.road;
      ctx.lineWidth = eased.has(i) ? width + 3 : width;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
    }
    for (const h of track.hazards) {
      const [x, y] = this.toScreen(map[Math.floor(h.s / SEG) % n]);
      ctx.fillStyle = HAZARD[h.kind] ?? "#fff";
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const c of this.crosses) {
      const [x, y] = this.toScreen(c);
      ctx.strokeStyle = C.hot;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
    }
    const dot = (i, color, r) => {
      const [x, y] = this.toScreen(map[Math.max(0, Math.min(n - 1, i))]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    dot(Math.floor(START / SEG), C.start, 6);
    if (!track.closed) dot(Math.floor((track.finish + START) / SEG), C.finish, 6);
    // Which way it runs: an arrow just past the start.
    const [ax, ay] = this.toScreen(map[Math.floor(START / SEG) + 8]);
    const [bx, by] = this.toScreen(map[Math.floor(START / SEG) + 14]);
    const angle = Math.atan2(by - ay, bx - ax);
    ctx.fillStyle = C.start;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(angle) * 8, by + Math.sin(angle) * 8);
    ctx.lineTo(bx + Math.cos(angle + 2.5) * 8, by + Math.sin(angle + 2.5) * 8);
    ctx.lineTo(bx + Math.cos(angle - 2.5) * 8, by + Math.sin(angle - 2.5) * 8);
    ctx.fill();
  }

  /** The control line (dashed) and its points (the first is where the track begins). */
  drawPoints(ctx) {
    const pts = this.points.map(p => this.toScreen(p));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255, 42, 109, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    if (this.track.closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    pts.forEach(([x, y], i) => {
      ctx.fillStyle = i ? C.handle : C.start;
      ctx.strokeStyle = "#07040f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, i ? 6 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  drawInfo() {
    const { track } = this;
    const sharpest = Math.max(...track.segs.map(s => Math.abs(s.k)));
    const limit = Math.round(1 / kmaxOf(this.spec));
    const parts = [
      `${(track.len / 1000).toFixed(2)} km${track.closed ? ` a lap × ${this.spec.laps}` : ""}`,
      `${this.points.length} points`,
      `tightest bend ${sharpest > 0 ? Math.round(1 / sharpest) : "∞"} m (the limit at this difficulty: ${limit} m)`,
      track.eased.length ? "red: bends too sharp, eased out" : "",
      this.crosses.length ? `crosses itself ${this.crosses.length}× (an overpass)` : "",
      `${track.hazards.length} hazards`
    ];
    this.info.textContent = parts.filter(Boolean).join(" · ");
  }
}

/** A point's distance from a line segment (screen pixels). */
function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

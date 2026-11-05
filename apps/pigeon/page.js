import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { advance, boardRank, cycleInitial, defaultInitials, FIELD, HEAT, heatOf, INITIAL_CHARS, newGame, PHYSICS, topScores, validInitials } from "./model.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { playBlip } from "../../scripts/util/audio.js";

/*
 * Phone page: Flappy Chrome (see apps/pigeon/model.js). A canvas game: tap (or Space) to flap. While a run
 * is going the phone holds its redraws (AgentPhone._busy), so nothing interrupts it; at the end the
 * score goes to the host's leaderboard. A score that makes the board asks for three initials first,
 * like an arcade cabinet (tap the arrows, or type); otherwise it goes under the ones they used last. A run
 * starts at the character's Maelstrom Heat, which players never see (only the GM's list shows it). The GM hears when someone starts playing and when they stop
 * (they leave the game, or don't fly again for two minutes). The GM Phone manages the board instead.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/* ---------------- Sound: tiny synth blips (util/audio.js), at the phone's volume ---------------- */

/** How often a flap may sound in the world (taps come fast; the rest only play on the phone). */
const WORLD_FLAP_MS = 150;
let lastWorldFlap = 0;

/**
 * Play a blip on the phone, and ask the host to play it quietly around the player's token (apps/pigeon/host.js;
 * a silenced or internal Agent makes no sound there).
 */
function blip(kind, actorId) {
  playBlip(kind, Number(game.settings.get(MODULE_ID, "volume") ?? 0.5));
  if (!actorId) return;
  if (kind === "flap") {
    const now = Date.now();
    if (now - lastWorldFlap < WORLD_FLAP_MS) return;
    lastWorldFlap = now;
  }
  store.request("pigeon-sound", { actorId, kind }, { quiet: true });
}

/* ---------------- Drawing ---------------- */

const C = {
  skyTop: "#0b0420", skyBottom: "#3a1240", smog: "rgba(255, 120, 60, 0.18)", far: "#160a2a", near: "#1f1036",
  window: "rgba(255, 210, 120, 0.55)", neonA: "#00f0ff", neonB: "#ff2a6d", stack: "#2a2d36", stackDark: "#17181f",
  hazard: "#f5d300", ground: "#121018", lane: "#ff2a6d", bird: "#9aa3b5", birdDark: "#5b6273", chrome: "#e8f6ff", beak: "#ff9f1c", eye: "#ff1744"
};

/** Pseudo-random but steady per building (so the skyline doesn't flicker). */
const hash = n => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/** A skyline layer, scrolled `depth` times as far as the city has gone (parallax). */
function drawSkyline(ctx, g, depth, color, height, width, seed, lights) {
  const t = g.t;
  const base = g.ground;
  const offset = (g.dist * depth) % width;
  const first = Math.floor((g.dist * depth) / width);
  for (let i = -1; i < g.w / width + 2; i++) {
    const n = first + i + seed;
    const h = height * (0.45 + hash(n) * 0.55);
    const x = i * width - offset;
    ctx.fillStyle = color;
    ctx.fillRect(x, base - h, width - 3, h);
    if (lights) {
      // Each window belongs to its building (steady as the city scrolls); a few blink, slowly.
      ctx.fillStyle = C.window;
      let row = 0;
      for (let wy = base - h + 6; wy < base - 6; wy += 9, row++) {
        let col = 0;
        for (let wx = x + 4; wx < x + width - 8; wx += 7, col++) {
          const w = hash(n * 97 + row * 13 + col * 7);
          const blink = w > 0.94 && Math.floor(t / 3 + w * 10) % 2;
          if (w > 0.72 && !blink) ctx.fillRect(wx, wy, 2, 3);
        }
      }
    }
    // Now and then a neon sign on a rooftop.
    if (hash(n * 7) > 0.8) {
      ctx.fillStyle = hash(n) > 0.5 ? C.neonA : C.neonB;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.fillRect(x + 4, base - h - 6, width - 14, 3);
      ctx.shadowBlur = 0;
    }
  }
}

function drawStack(ctx, s, g) {
  const w = PHYSICS.stackWidth;
  const bottomY = s.top + s.gap;
  for (const [y, h, capY] of [[0, s.top, s.top - 10], [bottomY, g.ground - bottomY, bottomY]]) {
    const grad = ctx.createLinearGradient(s.x, 0, s.x + w, 0);
    grad.addColorStop(0, C.stackDark);
    grad.addColorStop(0.4, C.stack);
    grad.addColorStop(1, C.stackDark);
    ctx.fillStyle = grad;
    ctx.fillRect(s.x, y, w, h);
    // The stack's lip, with hazard stripes and a neon rim.
    ctx.fillStyle = C.stack;
    ctx.fillRect(s.x - 4, capY, w + 8, 10);
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x - 4, capY, w + 8, 10);
    ctx.clip();
    ctx.fillStyle = C.hazard;
    for (let k = -10; k < w + 12; k += 10) {
      ctx.beginPath();
      ctx.moveTo(s.x - 4 + k, capY + 10);
      ctx.lineTo(s.x + 1 + k, capY);
      ctx.lineTo(s.x + 6 + k, capY);
      ctx.lineTo(s.x + 1 + k, capY + 10);
      ctx.fill();
    }
    ctx.restore();
    // Opened wider while Maelstrom's at it: a red rim.
    ctx.strokeStyle = s.relief ? C.neonB : C.neonA;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 6;
    ctx.strokeRect(s.x - 4, capY, w + 8, 10);
    ctx.shadowBlur = 0;
  }
  // Smog puffing from the bottom stack's mouth.
  ctx.fillStyle = "rgba(180, 170, 190, 0.18)";
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(s.x + w / 2 + Math.sin(s.x / 9 + k) * 6, bottomY - 6 - k * 9, 7 + k * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBullet(ctx, b) {
  if (b.amp) {
    // The drone: a weaving red diamond.
    ctx.fillStyle = C.neonB;
    ctx.shadowColor = C.neonB;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(b.x - 8, b.y);
    ctx.lineTo(b.x, b.y - 7);
    ctx.lineTo(b.x + 8, b.y);
    ctx.lineTo(b.x, b.y + 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }
  ctx.strokeStyle = C.neonB;
  ctx.shadowColor = C.neonB;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + 22, b.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
}

/**
 * A pattern's warning, before it fires: flashing chevrons at the right edge where its shots will come
 * (a wall: the whole edge), and an aimed shot's laser, following the pigeon and then holding.
 */
function drawWarning(ctx, g) {
  const p = g.pattern;
  if (!p) return;
  const flash = Math.floor(p.t * 10) % 2 === 0;
  if (p.kind === "aimed" && p.shots.length) {
    const locked = p.t >= PHYSICS.warn;
    ctx.strokeStyle = C.neonB;
    ctx.globalAlpha = locked ? (flash ? 0.9 : 0.5) : 0.3;
    ctx.lineWidth = locked ? 2 : 1;
    ctx.setLineDash(locked ? [] : [6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, p.aimY);
    ctx.lineTo(g.w, p.aimY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    return;
  }
  if (p.t >= PHYSICS.warn || !flash) return;
  ctx.fillStyle = C.neonB;
  ctx.shadowColor = C.neonB;
  ctx.shadowBlur = 10;
  if (p.shots[0]?.wall) ctx.fillRect(g.w - 4, 0, 4, g.ground);
  for (const shot of p.shots) {
    if (shot.y === undefined) continue;
    ctx.beginPath();
    ctx.moveTo(g.w - 4, shot.y - 7);
    ctx.lineTo(g.w - 14, shot.y);
    ctx.lineTo(g.w - 4, shot.y + 7);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawPigeon(ctx, g) {
  const { x } = PHYSICS.bird;
  const tilt = Math.max(-0.5, Math.min(1.1, g.vy / 450));
  const wing = Math.sin(g.t * (g.started ? 22 : 10)) * 5;
  ctx.save();
  ctx.translate(x, g.y);
  ctx.rotate(tilt);
  // Tail, body, head.
  ctx.fillStyle = C.birdDark;
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.lineTo(-19, -6);
  ctx.lineTo(-19, 4);
  ctx.fill();
  ctx.fillStyle = C.bird;
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6f7d99";
  ctx.beginPath();
  ctx.arc(9, -6, 6.5, 0, Math.PI * 2);
  ctx.fill();
  // Chrome sheen and the iridescent neck.
  ctx.fillStyle = C.chrome;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(-2, -5, 6, 2.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0, 240, 160, 0.6)";
  ctx.fillRect(4, -2, 6, 3);
  // Wing.
  ctx.fillStyle = C.birdDark;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(4, 0);
  ctx.lineTo(-3, wing - 9);
  ctx.fill();
  // Beak and the cybereye.
  ctx.fillStyle = C.beak;
  ctx.beginPath();
  ctx.moveTo(14, -7);
  ctx.lineTo(20, -5);
  ctx.lineTo(14, -3);
  ctx.fill();
  ctx.fillStyle = C.eye;
  ctx.shadowColor = C.eye;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(11, -8, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * One frame. `panel`: the title or game-over panel ({ lines, board, best }), with the leaderboard,
 * drawn over the lower part of the field (the pigeon hovers above it).
 */
function draw(ctx, g, panel) {
  const sky = ctx.createLinearGradient(0, 0, 0, g.h);
  sky.addColorStop(0, C.skyTop);
  sky.addColorStop(1, C.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, g.w, g.h);
  drawSkyline(ctx, g, 0.2, C.far, g.h * 0.58, 38, 0, false);
  drawSkyline(ctx, g, 0.45, C.near, g.h * 0.4, 30, 50, true);
  ctx.fillStyle = C.smog;
  ctx.fillRect(0, g.ground - 90, g.w, 90);
  for (const s of g.stacks) drawStack(ctx, s, g);
  for (const b of g.bullets) drawBullet(ctx, b);
  if (!panel) drawWarning(ctx, g);
  // The street.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, g.ground, g.w, g.h - g.ground);
  ctx.fillStyle = C.lane;
  const lane = g.dist % 32;
  for (let x = -lane; x < g.w; x += 32) ctx.fillRect(x, g.ground + 13, 16, 2);
  drawPigeon(ctx, g);

  ctx.textAlign = "center";
  ctx.font = "bold 30px monospace";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = C.neonA;
  ctx.shadowBlur = 10;
  if (g.started && !panel) ctx.fillText(String(g.score), g.w / 2, 46);
  ctx.shadowBlur = 0;
  if (panel) drawPanel(ctx, g, panel);
}

/** The panel's box: returns its top and bottom. */
function drawFrame(ctx, g, accent) {
  const top = g.h * 0.27;
  const bottom = g.ground - 8;
  ctx.fillStyle = "rgba(5, 0, 15, 0.8)";
  ctx.fillRect(14, top, g.w - 28, bottom - top);
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.strokeRect(14, top, g.w - 28, bottom - top);
  ctx.shadowBlur = 0;
  return { top, bottom };
}

/** The title / game-over panel, with the leaderboard in it; or the initials entry. */
function drawPanel(ctx, g, panel) {
  if (panel.entry) return drawEntry(ctx, g, panel.entry);
  const { lines, board, best } = panel;
  const accent = g.over ? C.neonB : C.neonA;
  const { top, bottom } = drawFrame(ctx, g, accent);

  let y = top + 26;
  ctx.textAlign = "center";
  lines.forEach((line, i) => {
    ctx.fillStyle = i ? "#d8e6ff" : accent;
    ctx.font = i ? "bold 13px monospace" : "bold 18px monospace";
    ctx.fillText(line, g.w / 2, y);
    y += i ? 18 : 22;
  });

  // The leaderboard: as many rows as fit above the prompt.
  y += 6;
  ctx.fillStyle = C.hazard;
  ctx.font = "bold 12px monospace";
  ctx.fillText("- LEADERBOARD -", g.w / 2, y);
  y += 18;
  const rowH = 15;
  const rows = Math.max(0, Math.min(board.length, Math.floor((bottom - 34 - y) / rowH)));
  ctx.font = "12px monospace";
  for (const s of board.slice(0, rows)) {
    ctx.fillStyle = s.mine ? C.neonA : "#c9c3dd";
    ctx.textAlign = "left";
    ctx.fillText(`${String(s.rank).padStart(2)}. ${s.name.slice(0, 18)}`, 28, y);
    ctx.textAlign = "right";
    ctx.fillText(String(s.score), g.w - 28, y);
    y += rowH;
  }
  if (!board.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#8f88a8";
    ctx.fillText("No scores yet. Be the first.", g.w / 2, y);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#8f88a8";
  ctx.font = "11px monospace";
  ctx.fillText(`Your best: ${best}`, g.w / 2, bottom - 26);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px monospace";
  ctx.fillText(g.over ? "Tap to fly again" : "Tap or Space to flap", g.w / 2, bottom - 9);
}

/** The initials entry's layout, in field units: three slots, an arrow above and below each, and OK. */
const ENTRY = { slotW: 44, slotGap: 14, up: [190, 224], box: [224, 270], down: [270, 304], ok: { x: 104, y: 312, w: 80, h: 26 }, ms: 30_000 };
const slotX = (g, i) => (g.w - (3 * ENTRY.slotW + 2 * ENTRY.slotGap)) / 2 + i * (ENTRY.slotW + ENTRY.slotGap);

function arrow(ctx, cx, cy, dir) {
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy + 5 * dir);
  ctx.lineTo(cx + 8, cy + 5 * dir);
  ctx.lineTo(cx, cy - 5 * dir);
  ctx.fill();
}

/** NEW HIGH SCORE: the three initials, the selected one blinking, a countdown to OK. */
function drawEntry(ctx, g, { chars, slot, rank, score, left }) {
  const { bottom } = drawFrame(ctx, g, C.hazard);
  const blink = Math.floor(Date.now() / 300) % 2;
  ctx.textAlign = "center";
  ctx.fillStyle = C.hazard;
  ctx.shadowColor = C.hazard;
  ctx.shadowBlur = blink ? 10 : 4;
  ctx.font = "bold 20px monospace";
  ctx.fillText("NEW HIGH SCORE!", g.w / 2, 136);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d8e6ff";
  ctx.font = "bold 13px monospace";
  ctx.fillText(`Rank #${rank}   Score ${score}`, g.w / 2, 158);
  ctx.fillStyle = C.neonA;
  ctx.font = "bold 12px monospace";
  ctx.fillText("ENTER YOUR INITIALS", g.w / 2, 182);

  chars.forEach((ch, i) => {
    const x = slotX(g, i);
    const cx = x + ENTRY.slotW / 2;
    const on = i === slot;
    ctx.fillStyle = on ? C.neonA : "#6c6688";
    arrow(ctx, cx, (ENTRY.up[0] + ENTRY.up[1]) / 2 + 2, 1);
    arrow(ctx, cx, (ENTRY.down[0] + ENTRY.down[1]) / 2 - 2, -1);
    const [y0, y1] = ENTRY.box;
    ctx.fillStyle = on ? "rgba(0, 240, 255, 0.12)" : "rgba(255, 255, 255, 0.04)";
    ctx.fillRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.strokeStyle = on ? C.neonA : "#3d3758";
    ctx.shadowColor = C.neonA;
    ctx.shadowBlur = on && blink ? 10 : 0;
    ctx.strokeRect(x, y0, ENTRY.slotW, y1 - y0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px monospace";
    ctx.fillText(ch, cx, y1 - 11);
  });

  const { x, y, w, h } = ENTRY.ok;
  ctx.fillStyle = C.neonB;
  ctx.shadowColor = C.neonB;
  ctx.shadowBlur = 8;
  ctx.fillRect(x, y, w, h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px monospace";
  ctx.fillText("OK", x + w / 2, y + 18);
  ctx.fillStyle = "#8f88a8";
  ctx.font = "11px monospace";
  ctx.fillText(`Tap the arrows or type  ${left}`, g.w / 2, bottom - 8);
}

/** The canvas, as a multiple of the field (288 × 400): 0.85 is 245 × 340, 2.25 is 648 × 900. */
const SIZE = { min: 0.85, max: 2.25 };

/** No new run for this long after a crash: they've stopped playing. */
const IDLE_MS = 120_000;

const DEATHS = { stack: "Smacked a smog stack.", shot: "Maelstrom got you.", ground: "Pavement pizza." };

/** The GM's Heat list: every character with Heat or on the board, hottest first. */
function heatList(scores, heat) {
  const ids = new Set([...Object.keys(heat), ...scores.map(s => s.actorId).filter(Boolean)]);
  return [...ids].flatMap(actorId => {
    const actor = game.actors.get(actorId);
    if (!actor) return [];
    const n = heatOf(heat, actorId);
    return [{ actorId, name: displayName(actor), heat: n, pips: Array.from({ length: HEAT.max }, (_, i) => i < n), cool: n > 0, hot: n < HEAT.max }];
  }).sort((a, b) => b.heat - a.heat || a.name.localeCompare(b.name));
}

export const actions = {
  "pigeon-fake"() {
    const root = this.element[0];
    const name = root.querySelector("input[name=pigeonName]")?.value.trim();
    const score = Number(root.querySelector("input[name=pigeonScore]")?.value);
    if (!name) return ui.notifications.warn("Give the entry a name.");
    store.request("pigeon-fake", { name, score });
  },
  "pigeon-fill"() {
    store.request("pigeon-fill", { count: 5 });
  },
  "pigeon-remove"({ id }) {
    store.request("pigeon-remove", { id });
  },
  "pigeon-reset"() {
    Dialog.confirm({
      title: "Flappy Chrome",
      content: `<p>Clear the whole leaderboard?</p><p><label><input type="checkbox" name="heat"> Reset everyone's Maelstrom Heat too</label></p>`,
      yes: html => store.request("pigeon-reset", { heat: !!html[0]?.querySelector?.("input[name=heat]")?.checked })
    });
  },
  "pigeon-heat"({ id, by }) {
    store.request("pigeon-heat", { actorId: id, by: Number(by) });
  },
  "pigeon-heat-reset"() {
    Dialog.confirm({ title: "Flappy Chrome", content: "<p>Put everyone's Maelstrom Heat back to 0?</p>", yes: () => store.request("pigeon-heat", {}) });
  }
};

export const methods = {
  pigeonData(ctx) {
    const gm = ctx.perspective === "gm";
    const actorId = ctx.subject?.actor?.id ?? null;
    const scores = game.settings.get(MODULE_ID, "pigeonBoard")?.scores ?? [];
    const mine = actorId ? scores.find(s => s.actorId === actorId) : null;
    const heat = game.settings.get(MODULE_ID, "pigeonHeat") ?? {};
    const board = topScores(scores, gm ? 50 : undefined).map(s => ({ ...s, mine: !!actorId && s.actorId === actorId }));
    // The canvas draws the board itself (see _pigeonPanel). `heat`: the next run's, never shown.
    this._pigeonBoard = { board, best: mine?.score ?? 0, heat: actorId ? heatOf(heat, actorId) : 0 };
    return { gm, bar: appBar("pigeon", { owner: gm ? null : ctx.subject.name }), board, heat: gm ? heatList(scores, heat) : [] };
  },

  /** After a redraw on this page: put the game on the new canvas (its last frame, or the title). */
  _pigeonAttach(html) {
    const canvas = html.querySelector("canvas.agent-pigeon-canvas");
    if (!canvas) return;
    this._pigeonCanvas = canvas;
    this._pigeonSize();
    this._pigeonFit();
    this.pigeon ??= newGame();
    draw(canvas.getContext("2d"), this.pigeon, this._pigeonPanel());
    this._pigeonDescribe();
    // Redraw at the new size when the phone is resized.
    this._pigeonResize?.disconnect();
    this._pigeonResize = new ResizeObserver(() => {
      if (!canvas.isConnected) return this._pigeonResize?.disconnect();
      this._pigeonSize();
      if (!this._pigeonRunning) draw(canvas.getContext("2d"), this.pigeon, this._pigeonPanel());
    });
    this._pigeonResize.observe(canvas.parentElement);
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      this._pigeonTap(event);
    });
    if (!this._pigeonKeys) {
      // Early (capture), so typing initials doesn't also work Foundry's keybindings.
      this._pigeonKeys = event => {
        if (!this._pigeonCanvas?.isConnected || !this.rendered || this.app !== "pigeon") return;
        if (event.target.closest?.("input, textarea, [contenteditable]")) return;
        if (this._pigeonEntry) {
          if (this._pigeonEntryKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            Hooks.callAll(`${MODULE_ID}.input`, this);
          }
          return;
        }
        if (event.code !== "Space" && event.code !== "ArrowUp") return;
        event.preventDefault();
        Hooks.callAll(`${MODULE_ID}.input`, this);
        this._pigeonTap();
      };
      window.addEventListener("keydown", this._pigeonKeys, true);
    }
  },

  /**
   * Size the canvas: the field's shape, as big as the page allows between SIZE.min and SIZE.max times
   * the field (so it's never tiny or huge), with pixels to match the screen.
   */
  _pigeonSize() {
    const canvas = this._pigeonCanvas;
    const box = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    const fit = Math.min((box?.clientWidth || FIELD.w) / FIELD.w, (box?.clientHeight || FIELD.h) / FIELD.h);
    const scale = Math.min(SIZE.max, Math.max(SIZE.min, fit));
    canvas.style.width = `${Math.round(FIELD.w * scale)}px`;
    canvas.style.height = `${Math.round(FIELD.h * scale)}px`;
    const width = Math.round(FIELD.w * scale * ratio);
    const height = Math.round(FIELD.h * scale * ratio);
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    canvas.getContext("2d").setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
  },

  /**
   * The phone's smallest size with the game on it: the canvas at SIZE.min, plus the phone around it (see
   * AgentPhone.setPosition). Null without the game (the GM's board).
   */
  _pigeonMinSize() {
    const box = this._pigeonCanvas?.isConnected ? this._pigeonCanvas.parentElement : null;
    if (!box || !this.position?.width || !this.position?.height) return null;
    return {
      width: Math.ceil(FIELD.w * SIZE.min) + Math.max(0, this.position.width - box.clientWidth),
      height: Math.ceil(FIELD.h * SIZE.min) + Math.max(0, this.position.height - box.clientHeight)
    };
  },

  /** Opened on a phone that's too small for the game: grow it (setPosition holds the minimum). */
  _pigeonFit() {
    const min = this._pigeonMinSize();
    if (!min || this._minimized || (this.position.width >= min.width && this.position.height >= min.height)) return;
    this.setPosition({ width: this.position.width, height: this.position.height });
  },

  /** Draw the current frame (outside a run: the panel changed). */
  _pigeonRedraw() {
    const canvas = this._pigeonCanvas;
    if (canvas?.isConnected && this.pigeon) draw(canvas.getContext("2d"), this.pigeon, this._pigeonPanel());
  },

  /** The panel over the field: the initials entry; the title, or how the last run ended, with the leaderboard. */
  _pigeonPanel() {
    const g = this.pigeon;
    const entry = this._pigeonEntry;
    if (entry) return { entry: { ...entry, left: Math.max(0, Math.ceil((entry.until - Date.now()) / 1000)) } };
    const board = this._pigeonBoard ?? { board: [], best: 0, heat: 0 };
    if (g?.over) return { ...board, lines: [DEATHS[g.over] ?? "Splat.", `Score ${g.score}`] };
    if (!g?.started) return { ...board, lines: ["FLAPPY CHROME", "Dodge smog. Dodge bullets."] };
    return null;
  },

  _pigeonTap(event) {
    if (this.context()?.perspective === "gm") return;
    if (this._pigeonEntry) {
      if (!event?.clientX && event?.clientX !== 0) return;
      const rect = this._pigeonCanvas.getBoundingClientRect();
      return this._pigeonEntryTap(((event.clientX - rect.left) / rect.width) * FIELD.w, ((event.clientY - rect.top) / rect.height) * FIELD.h);
    }
    if (this._pigeonRunning) {
      this._pigeonFlap = true;
      return;
    }
    // A short pause after a crash, so a frantic tap doesn't start the next run at once.
    if (this.pigeon?.over && Date.now() - this._pigeonEnded < 600) return;
    this.pigeon = newGame(Math.random, FIELD, this._pigeonBoard?.heat ?? 0);
    this._pigeonFlap = true;
    this._pigeonPlaying(true);
    this._pigeonRun();
  },

  _pigeonRun() {
    this._pigeonRunning = true;
    this._pigeonScreen();
    let last = performance.now();
    let score = 0;
    // The run's sounds are heard around this character's token too.
    const actorId = this.context()?.subject?.actor?.id;
    const frame = now => {
      const canvas = this._pigeonCanvas;
      if (!canvas?.isConnected || !this._pigeonRunning) return this._pigeonStop();
      const flap = this._pigeonFlap;
      this._pigeonFlap = false;
      if (flap) blip("flap", actorId);
      const g = advance(this.pigeon, (now - last) / 1000, flap);
      last = now;
      if (g.score > score) {
        score = g.score;
        blip("point", actorId);
        this._pigeonScreen();
      }
      draw(canvas.getContext("2d"), g, this._pigeonPanel());
      if (g.over) {
        blip("hit", actorId);
        return this._pigeonStop(g.score);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  /**
   * The run ended (or the page went away): send the score (a board-making one after its initials) and
   * let held redraws through.
   */
  _pigeonStop(score = 0) {
    if (!this._pigeonRunning) return;
    this._pigeonRunning = false;
    this._pigeonScreen();
    this._pigeonEnded = Date.now();
    const actorId = this.context()?.subject?.actor?.id;
    const scores = game.settings.get(MODULE_ID, "pigeonBoard")?.scores ?? [];
    const rank = score > 0 && actorId ? boardRank(scores, actorId, score) : null;
    this._pigeonSay(`${DEATHS[this.pigeon?.over] ?? "Game over."} Score ${score}.${rank ? ` That's number ${rank} on the board: pick three initials with the arrow keys, then Enter.` : ""}`);
    if (score > 0 && actorId) {
      if (rank) this._pigeonEntryStart(actorId, score, rank);
      else store.request("pigeon-score", { actorId, score, initials: this._pigeonInitials(actorId) }, { quiet: true });
    }
    if (this._pigeonSession) {
      this._pigeonSession.runs++;
      this._pigeonSession.best = Math.max(this._pigeonSession.best, score);
    }
    // Not flying again for a while counts as stopping.
    clearTimeout(this._pigeonIdle);
    this._pigeonIdle = setTimeout(() => this._pigeonPlaying(false), IDLE_MS);
    this._flush();
  },

  /** A run started, scored or ended without the phone redrawing: the GM's Agent Monitor hears (ui/activity.js). */
  _pigeonScreen() {
    Hooks.callAll(`${MODULE_ID}.screen`, this);
  },

  /** Screen readers: what the canvas shows when it's still (the title, your best, the board's top five). */
  _pigeonDescribe() {
    const canvas = this._pigeonCanvas;
    if (!canvas?.isConnected) return;
    const { board, best } = this._pigeonBoard ?? { board: [], best: 0 };
    const top = board.slice(0, 5).map((s, i) => `${i + 1}, ${s.name}, ${s.score}`).join("; ");
    canvas.setAttribute("aria-label", `Flappy Chrome, a flying game: tap or press Space to flap through the gaps. Your best: ${best}.${top ? ` Leaderboard: ${top}.` : ""}`);
  },

  /** Screen readers: read out a line (how a run ended, the initials saved). */
  _pigeonSay(text) {
    const el = this._pigeonCanvas?.parentElement?.querySelector("[data-pigeon-say]");
    if (el) el.textContent = text;
  },

  /** The initials a character last went by on the board, or ones made from their name. */
  _pigeonInitials(actorId) {
    const mine = (game.settings.get(MODULE_ID, "pigeonBoard")?.scores ?? []).find(s => s.actorId === actorId);
    if (validInitials(mine?.name)) return mine.name;
    const actor = game.actors.get(actorId);
    return defaultInitials(actor ? displayName(actor) : "");
  },

  /** Ask for initials: the board-making score waits until OK (or the countdown, or leaving). */
  _pigeonEntryStart(actorId, score, rank) {
    this._pigeonEntryDone();
    this._pigeonEntry = { actorId, score, rank, chars: [...this._pigeonInitials(actorId)], slot: 0, until: Date.now() + ENTRY.ms };
    this._pigeonScreen();
    // Blink, and count down; at zero it takes what's there.
    this._pigeonTicker = setInterval(() => {
      if (Date.now() >= this._pigeonEntry?.until) this._pigeonEntryDone();
      else this._pigeonRedraw();
    }, 150);
  },

  /** Send the waiting score under the entered initials. */
  _pigeonEntryDone() {
    clearInterval(this._pigeonTicker);
    const entry = this._pigeonEntry;
    if (!entry) return;
    this._pigeonEntry = null;
    this._pigeonEnded = Date.now();
    store.request("pigeon-score", { actorId: entry.actorId, score: entry.score, initials: entry.chars.join("") }, { quiet: true });
    this._pigeonSay(`On the board as ${entry.chars.join(" ")}.`);
    blip("point");
    this._pigeonRedraw();
  },

  /** A tap on the entry (field units): an arrow cycles its slot, a slot selects it, OK sends. */
  _pigeonEntryTap(x, y) {
    const entry = this._pigeonEntry;
    // Not the taps still flapping from the crash.
    if (Date.now() - this._pigeonEnded < 500) return;
    const { ok } = ENTRY;
    if (x >= ok.x - 6 && x <= ok.x + ok.w + 6 && y >= ok.y - 4 && y <= ok.y + ok.h + 6) return this._pigeonEntryDone();
    const g = this.pigeon;
    const i = [0, 1, 2].find(n => x >= slotX(g, n) - ENTRY.slotGap / 2 && x <= slotX(g, n) + ENTRY.slotW + ENTRY.slotGap / 2);
    if (i === undefined || y < ENTRY.up[0] || y > ENTRY.down[1]) return;
    entry.slot = i;
    if (y < ENTRY.up[1]) entry.chars[i] = cycleInitial(entry.chars[i], 1);
    else if (y > ENTRY.down[0]) entry.chars[i] = cycleInitial(entry.chars[i], -1);
    blip("flap");
    this._pigeonRedraw();
  },

  /** A key on the entry: letters and digits fill the slots, arrows cycle and move, Enter sends. Handled? */
  _pigeonEntryKey(event) {
    const entry = this._pigeonEntry;
    const key = event.key?.length === 1 ? event.key.toUpperCase() : event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (key === "Enter") this._pigeonEntryDone();
    else if (key === " ") return true; // Still flapping: nothing.
    else if (key.length === 1 && INITIAL_CHARS.includes(key)) {
      entry.chars[entry.slot] = key;
      entry.slot = Math.min(2, entry.slot + 1);
    } else if (key === "ArrowUp") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], 1);
    else if (key === "ArrowDown") entry.chars[entry.slot] = cycleInitial(entry.chars[entry.slot], -1);
    else if (key === "ArrowLeft" || key === "Backspace") entry.slot = Math.max(0, entry.slot - 1);
    else if (key === "ArrowRight") entry.slot = Math.min(2, entry.slot + 1);
    else return false;
    if (this._pigeonEntry) this._pigeonRedraw();
    return true;
  },

  /**
   * Note that someone started playing (their first run since they last stopped) or stopped (left the game or
   * the phone, or idled), with how it went. The host does nothing with it; the GM's Agent Monitor logs the
   * request (ui/activity.js).
   */
  _pigeonPlaying(on) {
    clearTimeout(this._pigeonIdle);
    if (on) {
      const actorId = this.context()?.subject?.actor?.id;
      if (!actorId || this._pigeonSession) return;
      this._pigeonSession = { actorId, runs: 0, best: 0 };
      return store.request("pigeon-play", { actorId, playing: true }, { quiet: true });
    }
    // Leaving mid-initials: the score still counts.
    this._pigeonEntryDone();
    const session = this._pigeonSession;
    if (!session) return;
    this._pigeonSession = null;
    this._pigeonRunning = false;
    store.request("pigeon-play", { actorId: session.actorId, playing: false, runs: session.runs, best: session.best }, { quiet: true });
  }
};

export const phone = {
  render(html) {
    if (this.app === "pigeon") this._pigeonAttach(html);
    else if (this._pigeonSession) this._pigeonPlaying(false); // left the game
  },
  close() {
    if (this._pigeonSession) this._pigeonPlaying(false);
  },
  /** A run in progress (its canvas would be lost). */
  busy() {
    return !!this._pigeonRunning;
  },
  /** The window won't shrink below what the game needs. */
  minSize() {
    return this.app === "pigeon" ? this._pigeonMinSize() : null;
  }
};

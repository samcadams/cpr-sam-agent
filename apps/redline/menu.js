import { drawProfile } from "./rides.js";
import { drawCard, HUD, plate } from "./hud.js";
import { calm, fit, glow, label, poly, rgba, vgrad } from "./gfx.js";

/*
 * REDLINE's start menu, drawn on the race's canvas over a live fly-through (apps/redline/page.js runs it and
 * handles the keys and clicks; this file only draws and says where things are). Screens:
 * - "main": the logo, Quick Race / Set Tracks, the course (its minimap, district, length, record), the ride
 *   (side on, its stats), the plate tag, the board, and the big RACE button.
 * - "board": a Set Track's board; rows with a ghost can be switched on (up to three).
 * - "result": how the last race went, with Race again / Nominate / Done.
 * - "tag": typing a new plate tag.
 * drawMenu returns the hit boxes ({ x, y, w, h, row, act }) for clicks.
 */

const W = 288;
const H = 400;
const SANS = "italic bold 20px sans-serif";

/** The main screen's rows, top to bottom (the ones that apply). */
export function menuRows(data) {
  const rows = ["mode", "track", "ride", "plate"];
  if (data.mode === "tracks" && data.board) rows.push("board");
  rows.push("go");
  return rows;
}

/** The logo: REDLINE in chrome italics, a red line under it, speed stripes behind. */
export function logo(ctx, x, y, size, t) {
  const still = calm();
  ctx.save();
  // Speed stripes.
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = rgba(i % 2 ? "#ff2a6d" : "#00f0ff", 0.55 - i * 0.1);
    ctx.fillRect(x - size * 3.3 - i * size * 0.4, y - size * 0.62 + i * size * 0.2, size * 1.6, size * 0.08);
  }
  glow(ctx, x, y - size * 0.3, size * 3.2, "rgba(255, 30, 60, 0.35)", 0.8);
  ctx.translate(x, y);
  ctx.font = `italic 900 ${size}px sans-serif`;
  ctx.textAlign = "center";
  // A shadow, the chrome, a glint running across.
  ctx.fillStyle = "#3a0010";
  ctx.fillText("REDLINE", size * 0.06, size * 0.06);
  const chrome = ctx.createLinearGradient(0, -size * 0.8, 0, size * 0.05);
  chrome.addColorStop(0, "#ffffff");
  chrome.addColorStop(0.45, "#c8d0e0");
  chrome.addColorStop(0.5, "#5a6070");
  chrome.addColorStop(0.75, "#ff6a8a");
  chrome.addColorStop(1, "#ff2a3d");
  ctx.fillStyle = chrome;
  ctx.fillText("REDLINE", 0, 0);
  if (!still) {
    // A glint running across the letters: the text again, lit only in a moving band.
    const wdt = ctx.measureText("REDLINE").width;
    const gx = ((t * 0.35) % 1.6 - 0.3) * wdt - wdt / 2;
    const glint = ctx.createLinearGradient(gx - size * 0.4, 0, gx + size * 0.4, 0);
    glint.addColorStop(0, "rgba(255, 255, 255, 0)");
    glint.addColorStop(0.5, "rgba(255, 255, 255, 0.75)");
    glint.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glint;
    ctx.fillText("REDLINE", 0, 0);
  }
  ctx.fillStyle = "#ff2a3d";
  ctx.fillRect(-size * 2.3, size * 0.16, size * 4.6, size * 0.07);
  ctx.restore();
}

/** Arrows either side of a row that changes with ← →. */
function arrows(ctx, y, h, on, hits, row) {
  const pulse = calm() ? 1 : 0.6 + 0.4 * Math.sin(performance.now() / 180);
  for (const side of [-1, 1]) {
    const x = side < 0 ? 10 : W - 10;
    ctx.fillStyle = on ? rgba(HUD.cyan, pulse) : "rgba(255, 255, 255, 0.25)";
    poly(ctx, [[x, y + h / 2], [x - side * 7, y + h / 2 - 7], [x - side * 7, y + h / 2 + 7]]);
    ctx.fill();
    hits.push({ x: side < 0 ? 0 : W - 22, y, w: 22, h, row, act: side < 0 ? "prev" : "next" });
  }
}

/** A row's plate: highlighted when it has the focus. */
function rowPlate(ctx, x, y, w, h, on, edge = HUD.cyan) {
  plate(ctx, x, y, w, h, { edge: on ? edge : "#3a3450", cut: "br", c: 7 });
  if (on) {
    ctx.strokeStyle = rgba(edge, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    glow(ctx, x + w / 2, y + h / 2, w * 0.45, rgba(edge, 0.12), 1);
  }
}

/**
 * The menu over the fly-through. `data`: the page's (see page.js _redlineMenuData); `state`: { screen, focus,
 * boardAt, resultAt, tagDraft, spin (metres the garage's wheels have rolled) }. Returns the hit boxes.
 */
export function drawMenu(ctx, data, state) {
  const hits = [];
  const t = performance.now() / 1000;
  // Darken the world so the menu reads.
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, "rgba(5, 0, 15, 0.55)"], [0.45, "rgba(5, 0, 15, 0.35)"], [1, "rgba(5, 0, 15, 0.8)"]]);
  ctx.fillRect(0, 0, W, H);
  if (state.screen === "result" && data.result) return result(ctx, data, state, hits, t);
  if (state.screen === "board" && data.board) return board(ctx, data, state, hits);
  logo(ctx, W / 2 + 6, 44, 34, t);
  label(ctx, "NIGHT CITY STREET RACING", W / 2, 60, 7.5, "#d8e6ff");
  const rows = menuRows(data);
  const focus = state.screen === "main" ? state.focus : null;
  let y = 68;
  // Quick Race / Set Tracks.
  {
    const on = focus === "mode";
    const tabs = [["quick", "QUICK RACE"], ["tracks", `SET TRACKS (${data.setCount})`]];
    tabs.forEach(([id, text], i) => {
      const x = 22 + i * 124;
      const active = data.mode === id;
      ctx.fillStyle = active ? (on ? HUD.cyan : rgba(HUD.cyan, 0.75)) : "rgba(20, 12, 36, 0.8)";
      poly(ctx, [[x + 6, y], [x + 120, y], [x + 114, y + 18], [x, y + 18]]);
      ctx.fill();
      if (on && !active) {
        ctx.strokeStyle = rgba(HUD.cyan, 0.6);
        ctx.stroke();
      }
      label(ctx, text, x + 60, y + 13, 9.5, active ? "#05010f" : "#a9a3c0");
      hits.push({ x, y, w: 120, h: 18, row: "mode", act: id });
    });
    if (on) arrows(ctx, y, 18, on, hits, "mode");
  }
  y += 24;
  // The course.
  {
    const on = focus === "track";
    const h = 92;
    rowPlate(ctx, 22, y, W - 44, h, on);
    hits.push({ x: 22, y, w: W - 44, h, row: "track", act: "focus" });
    const tr = data.mode === "quick" ? data.quick : data.track;
    if (!tr) {
      label(ctx, "NO SET TRACKS OPEN", W / 2, y + 40, 11, HUD.dim);
      label(ctx, "The GM hasn't opened any yet.", W / 2, y + 56, 8.5, "#d8e6ff");
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(28, y + 6, 80, 80);
      if (tr.built) drawCard(null, tr.built, { ctx, size: 80, at: [28, y + 6], seen: tr.seen ?? 0, all: data.mode === "quick" });
      const tx = 114;
      label(ctx, tr.name.toUpperCase(), tx, y + 18, fit(tr.name, W - 44 - (tx - 22) - 8, 12), "#ffffff", "left", SANS);
      label(ctx, tr.district, tx, y + 31, 8, HUD.yellow, "left");
      label(ctx, tr.line, tx, y + 43, 7.5, "#d8e6ff", "left");
      let ly = y + 57;
      for (const [text, color] of tr.notes ?? []) {
        label(ctx, text, tx, ly, 7.5, color, "left");
        ly += 11;
      }
      if (data.mode === "quick") label(ctx, "A/D: NEW COURSE", W - 30, y + h - 6, 6.5, on ? HUD.cyan : "#6a6488", "right");
      else if (data.trackCount > 1) label(ctx, `${data.trackIndex + 1} / ${data.trackCount}`, W - 30, y + h - 6, 7, on ? HUD.cyan : "#6a6488", "right");
    }
    if (on) arrows(ctx, y, h, on, hits, "track");
    y += h + 6;
  }
  // The ride: side on in the garage, its stats.
  {
    const on = focus === "ride";
    const h = 84;
    rowPlate(ctx, 22, y, W - 44, h, on, HUD.pink);
    hits.push({ x: 22, y, w: W - 44, h, row: "ride", act: "focus" });
    const r = data.ride;
    // A spotlight on the floor.
    ctx.save();
    ctx.translate(76, y + 66);
    ctx.scale(1, 0.18);
    glow(ctx, 0, 0, 52, "rgba(255, 42, 109, 0.5)");
    ctx.restore();
    drawProfile(ctx, 76, y + 66, r.bike ? 26 : 20, r.id, "#00f0ff", state.spin ?? 0);
    const tx = 136;
    label(ctx, r.name.toUpperCase(), tx, y + 18, 13, "#ffffff", "left", SANS);
    label(ctx, r.blurb, tx, y + 30, fit(r.blurb, W - 22 - tx - 6, 7.5), "#d8e6ff", "left");
    r.stats.forEach((s, i) => {
      const sy = y + 44 + i * 12;
      label(ctx, s.label.toUpperCase(), tx, sy + 6, 6.5, HUD.dim, "left");
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fillRect(tx + 34, sy, 82, 6);
      const segs = 10;
      for (let k = 0; k < segs; k++) {
        if ((k + 0.5) / segs > s.pct / 100) break;
        ctx.fillStyle = k > 7 ? HUD.pink : HUD.cyan;
        ctx.fillRect(tx + 34 + k * 8.2, sy, 7, 6);
      }
    });
    label(ctx, `${data.classIndex + 1} / ${data.classCount}`, W - 30, y + 12, 7, on ? HUD.pink : "#6a6488", "right");
    if (on) arrows(ctx, y, h, on, hits, "ride");
    y += h + 6;
  }
  // The plate tag.
  {
    const on = focus === "plate";
    rowPlate(ctx, 22, y, W - 44, 22, on, HUD.yellow);
    hits.push({ x: 22, y, w: W - 44, h: 22, row: "plate", act: "enter" });
    label(ctx, "PLATE", 32, y + 15, 8, HUD.dim, "left");
    ctx.fillStyle = "#e8e8f0";
    ctx.fillRect(84, y + 4, 76, 14);
    label(ctx, data.tag || "-", 122, y + 15, 10, "#111", "center");
    label(ctx, on ? "ENTER TO EDIT" : "", W - 30, y + 15, 6.5, HUD.yellow, "right");
    y += 28;
  }
  if (rows.includes("board")) {
    const on = focus === "board";
    rowPlate(ctx, 22, y, W - 44, 20, on);
    hits.push({ x: 22, y, w: W - 44, h: 20, row: "board", act: "enter" });
    const b = data.board;
    label(ctx, `BOARD & GHOSTS ▸`, 32, y + 14, 8.5, on ? HUD.cyan : "#d8e6ff", "left");
    label(ctx, `${b.runs.length} TIME${b.runs.length === 1 ? "" : "S"} · ${b.ghostsOn} GHOST${b.ghostsOn === 1 ? "" : "S"} ON`, W - 30, y + 14, 7, HUD.dim, "right");
    y += 26;
  }
  // GO.
  {
    const on = focus === "go";
    const can = data.canRace;
    const pulse = calm() ? 1 : 0.75 + 0.25 * Math.sin(t * 6);
    const color = can ? HUD.pink : "#4a4458";
    ctx.fillStyle = on && can ? rgba(color, pulse) : rgba(color, 0.55);
    poly(ctx, [[40, y], [W - 30, y], [W - 40, y + 30], [30, y + 30]]);
    ctx.fill();
    if (on && can) glow(ctx, W / 2, y + 15, 110, "rgba(255, 42, 109, 0.35)");
    const text = data.paused ? "RACES PAUSED BY THE GM" : !can ? "NO TRACK TO RACE" : data.mode === "quick" ? (data.quick?.again ? "RUN IT AGAIN ▸" : "QUICK RACE ▸") : "RACE ▸";
    label(ctx, text, W / 2, y + 21, fit(text, W - 90, 16), "#ffffff", "center", SANS);
    hits.push({ x: 30, y, w: W - 60, h: 30, row: "go", act: "enter" });
    y += 36;
  }
  label(ctx, "W/S CHOOSE · A/D CHANGE · ENTER SELECT · M MUSIC", W / 2, Math.min(H - 6, y + 4), 6.5, "#8f88a8");
  if (state.screen === "tag") tagEntry(ctx, data, state, hits);
  return hits;
}

/** Typing a plate tag: a big plate with a cursor. */
function tagEntry(ctx, data, state, hits) {
  ctx.fillStyle = "rgba(5, 0, 15, 0.8)";
  ctx.fillRect(0, 0, W, H);
  plate(ctx, 30, 130, W - 60, 120, { edge: HUD.yellow, cut: "br", c: 12 });
  label(ctx, "YOUR PLATE", W / 2, 156, 11, HUD.yellow, "center", SANS);
  ctx.fillStyle = "#e8e8f0";
  ctx.fillRect(W / 2 - 70, 168, 140, 36);
  ctx.strokeStyle = "#111";
  ctx.strokeRect(W / 2 - 66, 172, 132, 28);
  const text = state.tagDraft ?? "";
  const blink = calm() || Math.floor(performance.now() / 400) % 2;
  label(ctx, text + (blink && text.length < 8 ? "_" : " "), W / 2, 196, 20, "#111");
  label(ctx, "LETTERS, NUMBERS, - · UP TO 8", W / 2, 222, 7, "#d8e6ff");
  label(ctx, "ENTER SAVES · ESC CANCELS", W / 2, 236, 7, HUD.dim);
  hits.length = 0;
  hits.push({ x: 0, y: 0, w: W, h: H, row: "tag", act: "enter" });
}

/** A Set Track's board, ghosts switched on and off. */
function board(ctx, data, state, hits) {
  const b = data.board;
  label(ctx, "BOARD", W / 2, 30, 18, HUD.cyan, "center", SANS);
  label(ctx, data.track?.name?.toUpperCase() ?? "", W / 2, 44, 8.5, "#ffffff");
  label(ctx, "GHOSTS: UP TO 3 · THE SPLIT IS AGAINST THE FASTEST", W / 2, 56, 6.5, HUD.dim);
  let y = 66;
  b.runs.slice(0, 10).forEach((r, i) => {
    const on = state.boardAt === i;
    rowPlate(ctx, 12, y, W - 24, 26, on, r.mine ? HUD.yellow : HUD.cyan);
    hits.push({ x: 12, y, w: W - 24, h: 26, row: "board", act: `run:${i}` });
    label(ctx, String(r.rank), 26, y + 17, 11, r.rank === 1 ? HUD.yellow : HUD.dim, "center", SANS);
    label(ctx, r.tag, 40, y + 12, 9.5, r.mine ? HUD.yellow : "#ffffff", "left");
    label(ctx, `${r.who} · ${r.clsName}${r.grid ? ` · ${r.grid}` : ""}`, 40, y + 22, 6.5, "#a9a3c0", "left");
    label(ctx, r.time, W - 62, y + 13, 10, HUD.yellow, "right");
    if (r.lapTime) label(ctx, `${r.fastestLap ? "⚑ " : ""}LAP ${r.lapTime}`, W - 62, y + 22, 6.5, r.fastestLap ? HUD.pink : HUD.dim, "right");
    // The ghost switch.
    if (r.ghost) {
      const gx = W - 44;
      ctx.strokeStyle = r.ghostOn ? "#7fe9ff" : "#4a4458";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(gx, y + 6, 24, 14);
      if (r.ghostOn) {
        ctx.fillStyle = "rgba(127, 233, 255, 0.3)";
        ctx.fillRect(gx, y + 6, 24, 14);
      }
      label(ctx, r.ghostOn ? "ON" : "OFF", gx + 12, y + 16, 7, r.ghostOn ? "#7fe9ff" : "#6a6488");
      label(ctx, "GHOST", gx + 12, y + 4.5, 5, "#6a6488");
    }
    y += 29;
  });
  if (!b.runs.length) label(ctx, "No times yet. Set the first.", W / 2, 120, 10, "#d8e6ff");
  const back = state.boardAt === -1;
  rowPlate(ctx, W / 2 - 50, H - 34, 100, 22, back, HUD.pink);
  label(ctx, "◂ BACK", W / 2, H - 19, 10, back ? HUD.pink : "#d8e6ff", "center", SANS);
  hits.push({ x: W / 2 - 50, y: H - 34, w: 100, h: 22, row: "board", act: "back" });
  label(ctx, "ENTER: GHOST ON/OFF · ESC: BACK", W / 2, H - 4, 6.5, "#8f88a8");
  return hits;
}

/** How the last race went. */
function result(ctx, data, state, hits, t) {
  const r = data.result;
  logo(ctx, W / 2 + 6, 40, 26, t);
  const lines = [
    r.lap && ["BEST LAP", r.lap],
    r.grid && ["GRID", r.grid],
    ["WRECKED", String(r.wrecks)],
    ["WRECKED YOURSELF", String(r.crashes)],
    r.rank && ["ON THE BOARD", `#${r.rank}`]
  ].filter(Boolean);
  const tall = 92 + (r.time ? 22 + (r.delta ? 14 : 0) : 0) + lines.length * 16 + 8;
  plate(ctx, 20, 58, W - 40, tall, { edge: r.done ? HUD.yellow : HUD.pink, cut: "br", c: 14 });
  const big = r.title;
  const color = r.done ? (r.title === "WINNER" ? HUD.yellow : HUD.cyan) : HUD.pink;
  if (r.done && r.title === "WINNER" && !calm()) glow(ctx, W / 2, 90, 90, "rgba(245, 211, 0, 0.3)");
  label(ctx, big, W / 2 + 2, 96, 26, rgba(color, 0.35), "center", SANS);
  label(ctx, big, W / 2, 94, 26, color, "center", SANS);
  label(ctx, r.name.toUpperCase(), W / 2, 112, fit(r.name, W - 70, 9.5), "#ffffff");
  label(ctx, r.line, W / 2, 126, fit(r.line, W - 60, 8), "#d8e6ff");
  let y = 150;
  if (r.time) {
    label(ctx, r.time, W / 2, y + 8, 24, HUD.cyan, "center", "bold 20px monospace");
    y += 22;
    if (r.delta) {
      label(ctx, `${r.delta} ON ${(r.deltaOn || "THE GHOST").toUpperCase()}`, W / 2, y, 8, r.delta.startsWith("-") ? HUD.green : HUD.red);
      y += 14;
    }
  }
  for (const [k, v] of lines) {
    label(ctx, k, 44, y + 8, 7.5, HUD.dim, "left");
    label(ctx, v, W - 44, y + 8, 9, k === "ON THE BOARD" ? HUD.yellow : "#ffffff", "right");
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(44, y + 12, W - 88, 1);
    y += 16;
  }
  // The buttons.
  const buttons = data.resultButtons;
  const bw = (W - 40 - (buttons.length - 1) * 6) / buttons.length;
  buttons.forEach((b, i) => {
    const on = state.resultAt === i;
    const x = 20 + i * (bw + 6);
    const by = 58 + tall + 12;
    ctx.fillStyle = on ? HUD.pink : "rgba(20, 12, 36, 0.85)";
    poly(ctx, [[x + 6, by], [x + bw, by], [x + bw - 6, by + 28], [x, by + 28]]);
    ctx.fill();
    ctx.strokeStyle = rgba(HUD.pink, on ? 1 : 0.5);
    ctx.stroke();
    label(ctx, b.label, x + bw / 2, by + 18, fit(b.label, bw - 14, 10), on ? "#ffffff" : "#d8e6ff", "center", SANS);
    hits.push({ x, y: by, w: bw, h: 28, row: "result", act: `button:${i}` });
  });
  label(ctx, "A/D CHOOSE · ENTER SELECT", W / 2, 58 + tall + 56, 6.5, "#8f88a8");
  return hits;
}

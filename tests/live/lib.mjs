/*
 * The live suite's link to Foundry: the foundry-playwright driver (fpw), through the lane's two clients.
 * `gm` is the lane's GM (made the active GM, so it's the phone's host), `pl` its player, whose character
 * is whichever character fpw assigned to ClaudePlayerN (`pc`; no spec relies on its name). Specs pass plain functions; they run inside that client's page with the helpers in
 * PRELUDE in scope, and get one JSON argument.
 */

import { execFile } from "node:child_process";
import os from "node:os";

export const FPW = process.env.FPW ?? `${os.homedir()}/.claude/skills/foundry-playwright/scripts/fpw`;

/** Run fpw; resolves with stdout. `[lanes]` news on stderr is passed through. */
export function fpw(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(FPW, args, { maxBuffer: 32 << 20, timeout: 180_000 }, (err, stdout, stderr) => {
      const news = stderr.split("\n").filter(l => l.startsWith("[lanes]"));
      if (news.length) process.stderr.write(`${news.join("\n")}\n`);
      if (err) {
        err.code ??= err.status;
        err.message = `fpw ${args[0]} ${args[1] ?? ""}: ${stderr.trim() || stdout.trim() || err.message}`;
        return reject(err);
      }
      resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/*
 * In-page helpers, put before every function a spec runs in a client:
 * - api, store, AgentPhone: the module's API and its internals.
 * - sleep(ms); until(fn, what, timeout): wait for fn() to return something truthy (returned).
 * - phone(): this user's phone (opened and unlocked if it isn't); closePhone(); el(sel) / els(sel): inside it.
 * - tap(sel): click a control in the phone once it's there (hit(node) for one in hand);
 *   fill(sel, text): type into a field; choose(name, value): pick from one of the phone's dropdowns.
 * - go(app): open an app from the dock/Apps screen, as a user would, on its top screen.
 * - text(sel): the trimmed text of an element in the phone.
 * - appsOn(): the ids of the apps switched on in Control, in manifest order.
 * - dialog(title): a Foundry dialog by (part of) its title; inDialog(d, sel, value) fills a field;
 *   press(d, label) clicks its button.
 */
const PRELUDE = `
const MODULE = "cpr-sam-agent";
const api = game.modules.get(MODULE).api;
const { store, AgentPhone } = api;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what = "a condition", timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); } catch (e) { last = undefined; }
    if (last) return last;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
}
const root = () => document.querySelector(game.user.isGM ? "#ctp-gm-phone" : "#ctp-phone");
async function phone({ unlock = true } = {}) {
  const p = await until(() => {
    const p = api.phone.open(); // no-op while it's open; while it's closing, the next try opens it
    return p.rendered && root() ? p : null;
  }, "the phone to open");
  if (unlock && p.locked && el('[data-action="unlock"]')) await tap('[data-action="unlock"]');
  return p;
}
async function closePhone() {
  for (const p of AgentPhone.all()) if (p.rendered) await p.close();
  await until(() => !root(), "the phone to close");
}
const el = sel => root()?.querySelector(sel) ?? null;
const els = sel => [...(root()?.querySelectorAll(sel) ?? [])];
const text = sel => el(sel)?.textContent.replace(/\\s+/g, " ").trim() ?? null;
/** A click as the phone sees it; works on SVG marks too (they have no .click()). */
function hit(target) {
  if (typeof target.click === "function") target.click();
  else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
async function tap(sel) {
  await sleep(80); // past the phone's debounced redraw (50 ms), so the control isn't about to be replaced
  const target = await until(() => el(sel), sel);
  hit(target);
  await sleep(200);
}
async function choose(name, value) {
  await tap('.agent-dropdown[data-name="' + name + '"] [data-action="dropdown-toggle"]');
  await tap('[data-action="dropdown-pick"][data-name="' + name + '"][data-value="' + value + '"]');
}
async function fill(sel, value) {
  const field = await until(() => el(sel), sel);
  field.focus();
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}
async function go(app) {
  const p = await phone();
  const button = '[data-action="app"][data-app="' + app + '"]';
  // Tapping the app you're in goes back to its top screen (the inbox, the jobs list...), as on the phone.
  if (p.app !== app || app !== "home") {
    if (!el(button)) await tap('[data-action="app"][data-app="home"]');
    await tap(button);
    // Switching to an app shows it where it was left; a second tap is its top screen.
    if (app !== "home" && el(button)) await tap(button);
  }
  await until(() => p.app === app && p.rendered, "the " + app + " app");
  await sleep(150);
  return p;
}
async function dialog(title) {
  return until(() => [...document.querySelectorAll(".app.dialog, .application.dialog")]
    .find(d => d.querySelector(".window-title")?.textContent.includes(title)), "the " + title + " dialog");
}
function inDialog(d, sel, value) {
  const f = d.querySelector(sel);
  if (!f) throw new Error("no " + sel + " in the dialog");
  f.value = value;
  f.dispatchEvent(new Event("input", { bubbles: true }));
  f.dispatchEvent(new Event("change", { bubbles: true }));
}
async function press(d, label) {
  const b = [...d.querySelectorAll(".dialog-button, footer button, button")].find(b => b.textContent.trim().includes(label));
  if (!b) throw new Error("no " + label + " button in the dialog");
  b.click();
  await sleep(200);
}
async function appsOn() {
  const { APP_IDS } = await import("/modules/" + MODULE + "/scripts/apps/manifest.js");
  return APP_IDS.filter(id => api.feature("app_" + id));
}
`;

/** Console lines that are the world's or Foundry's, not the module's. */
const NOISE = [
  /GL Driver Message/,
  /ServerConfiguration validation errors/,
  /cssTheme: .* is not a valid choice/,
  /Failed to load resource/, // world/scene art missing on the server; the module's own files are checked in startup
  /WebGL|GPU stall/i
];

export class Client {
  constructor(session, label) {
    this.session = session;
    this.label = label;
  }

  /** Run `fn(args)` in the page; resolves with its (JSON) return value, throws its error. */
  async run(fn, args = null) {
    // Only JSON comes back: an app or a DOM node (often circular) would crash the fpw driver.
    const src = `${PRELUDE}\nconst __r = await (${fn.toString()})(${JSON.stringify(args)});
try { return JSON.parse(JSON.stringify(__r ?? null)); } catch (e) { return String(__r); }`;
    const out = await fpw(["eval", this.session, "-f", "-"], src);
    let res;
    try {
      res = JSON.parse(out);
    } catch {
      throw new Error(`${this.label}: unreadable fpw output: ${out.slice(0, 400)}`);
    }
    if ("error" in res) throw new Error(`${this.label}: ${String(res.error).split("\n").slice(0, 4).join("\n")}`);
    return res.ok;
  }

  /** Raw Playwright: `fn(page, args)`. For real typing and key presses. */
  async pw(fn, args = null) {
    const out = await fpw(["pw", this.session, "-f", "-"], `return await (${fn.toString()})(page, ${JSON.stringify(args)});`);
    const res = JSON.parse(out);
    if ("error" in res) throw new Error(`${this.label}: ${res.error}`);
    return res.ok;
  }

  /** A screenshot of the phone (or `sel`), into the lane's shots folder. Returns its path. */
  async shot(name, sel) {
    let s = sel ?? (this.label === "gm" ? "#ctp-gm-phone" : "#ctp-phone");
    // The phone may be put away: then the whole screen.
    if (!(await this.run(q => !!document.querySelector(q), s).catch(() => false))) s = undefined;
    return (await fpw(["shot", this.session, name, ...(s ? [s] : [])])).trim();
  }

  /** Console errors since the last call: { errors, warnings, noise }. */
  async console() {
    const out = await fpw(["log", this.session]);
    const lines = out.trim() === "(none)" ? [] : out.split("\n");
    // Multi-line entries: a line without a [level] prefix continues the one before.
    const entries = [];
    for (const line of lines) {
      if (/^\[(error|warning|warn|log|info|debug|pageerror)\]/.test(line) || !entries.length) entries.push(line);
      else entries[entries.length - 1] += `\n${line}`;
    }
    const noise = entries.filter(e => NOISE.some(re => re.test(e)));
    const rest = entries.filter(e => !noise.includes(e));
    return {
      errors: rest.filter(e => /^\[(error|pageerror)\]/.test(e)),
      warnings: rest.filter(e => /^\[warn/.test(e) && /ctp-|agent/i.test(e)),
      noise
    };
  }

  async reload() {
    await fpw(["reload", this.session]);
  }
}

export const gm = new Client("gm", "gm");
export const pl = new Client("pl", "pl");

/** Assertions with messages that read as the phone's behaviour. */
export function check(ok, message) {
  if (!ok) throw new Error(message);
}
export function same(actual, expected, message) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  got      ${a}`);
}

/* ---------------- Registry (filled by the spec files, run by run.mjs) ---------------- */

export const registry = [];
let currentFile = null;
export const setFile = name => (currentFile = name);

/**
 * `test(name, fn, opts)`: fn(ctx) with ctx = { gm, pl, lane, prefix, pc, other, tag } (pc, other: { id, name, shown: the name the phones show }).
 * opts.player: false for a GM-only test (the player client isn't touched).
 */
export function test(name, fn, opts = {}) {
  registry.push({ file: currentFile, name, fn, opts, kind: "test" });
}
/** `before(fn)`: runs once before the first test of its file that runs. */
export function before(fn) {
  registry.push({ file: currentFile, fn, kind: "before" });
}

#!/usr/bin/env node
/*
 * The live suite: real flows on the test world (livetestingenv or hqtesting) through the lane's GM and player clients (fpw).
 *
 *   npm run test:live                    # every spec
 *   npm run test:live -- messages calls  # spec files whose name contains one of these
 *   npm run test:live -- --grep "hidden" # tests whose name matches
 *   --bail     stop at the first failure
 *   --no-host  don't take the active GM (GM-side code then runs on whoever holds it)
 *   --help     usage; any other option is refused (exit 2) instead of running the suite
 *
 * Needs a claimed lane (fpw lane claim --module cpr-sam-agent ...). The suite takes the active GM for
 * its run (fpw gm claim) and always hands it back. A test fails on a thrown error or on any console
 * error in either client while it ran. Data is made with the lane's "ClaudeN " prefix and stays.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fpw, gm, pl, registry, setFile } from "./lib.mjs";
import { setup } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const grepAt = argv.indexOf("--grep");
const grep = grepAt >= 0 ? new RegExp(argv[grepAt + 1], "i") : null;
const files = argv.filter((a, i) => !a.startsWith("--") && (grepAt < 0 || i !== grepAt + 1));

const HELP = `Usage: npm run test:live -- [spec ...] [--grep PATTERN] [--bail] [--no-host]

  spec            run only spec files whose name contains it (e.g. messages calls)
  --grep PATTERN  run only tests whose name matches PATTERN (case-insensitive)
  --bail          stop at the first failure
  --no-host       don't take the active GM (GM-side code then runs on whoever holds it)
  -h, --help      show this help

Needs a claimed lane (fpw lane claim --module cpr-sam-agent ...).
`;
const KNOWN = new Set(["--grep", "--bail", "--no-host"]);
if (flag("--help") || flag("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
const unknown = argv.filter((a, i) => a.startsWith("-") && !KNOWN.has(a) && !(grepAt >= 0 && i === grepAt + 1));
if (unknown.length || (grepAt >= 0 && argv[grepAt + 1] === undefined)) {
  process.stderr.write(`${unknown.length ? `unknown option: ${unknown.join(" ")}` : "--grep needs a pattern"}\n\n${HELP}`);
  process.exit(2);
}

const C = process.stdout.isTTY ? { red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m", off: "\x1b[0m" } : { red: "", green: "", dim: "", off: "" };

async function main() {
  const specs = (await readdir(here)).filter(f => f.endsWith(".live.mjs")).sort();
  const nomatch = files.filter(n => !specs.some(f => f.includes(n)));
  if (nomatch.length) throw new Error(`no spec file matches: ${nomatch.join(" ")}\nspecs: ${specs.map(f => f.replace(".live.mjs", "")).join(" ")}`);
  for (const f of specs) {
    if (files.length && !files.some(n => f.includes(n))) continue;
    setFile(f);
    await import(path.join(here, f));
  }
  const tests = registry.filter(t => t.kind === "test" && (!grep || grep.test(t.name)));
  if (!tests.length) throw new Error("no tests match");

  let held = false;
  const started = Date.now();
  const results = [];
  try {
    const me = await gm.run(() => game.user.name).catch(e => {
      throw new Error(`no lane client (claim a lane first: fpw lane claim --module cpr-sam-agent ...)\n${e.message}`);
    });
    const lane = Number(/(\d+)$/.exec(me)?.[1]);
    if (!flag("--no-host")) {
      process.stdout.write(`${C.dim}taking the active GM for ${me}…${C.off}\n`);
      await fpw(["gm", "claim", "--why", "cpr-sam-agent live test suite", "--minutes", "20", "--wait", "300"]);
      held = true;
      await waitForHost();
    }
    const ctx = await setup({ lane });
    process.stdout.write(`${C.dim}lane ${lane}, ${ctx.pc.name} / ${ctx.other.name}, run ${ctx.tag}${C.off}\n`);

    const ranBefore = new Set();
    for (const t of tests) {
      for (const b of registry.filter(r => r.kind === "before" && r.file === t.file && !ranBefore.has(r))) {
        ranBefore.add(b);
        await b.fn(ctx);
      }
      const r = await runOne(t, ctx);
      results.push(r);
      if (!r.ok && flag("--bail")) break;
    }
  } finally {
    if (held) {
      const out = await fpw(["gm", "release"]).catch(e => e.message);
      if (/no human GM/i.test(out)) process.stdout.write(`\n${out.trim()}\n`);
    }
  }

  const failed = results.filter(r => !r.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
  for (const r of failed) process.stdout.write(`\n${C.red}✖ ${r.file} › ${r.name}${C.off}\n${indent(r.error)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

async function runOne(t, ctx) {
  const clients = t.opts.player === false ? [gm] : [gm, pl];
  for (const c of clients) await c.console(); // drop what came before
  const t0 = Date.now();
  let error = null;
  try {
    await t.fn(ctx);
  } catch (e) {
    error = e.message;
  }
  for (const c of clients) {
    const { errors } = await c.console().catch(() => ({ errors: [] }));
    if (errors.length && !t.opts.allowErrors) error = [error, `${c.label} console:`, ...errors].filter(Boolean).join("\n");
  }
  const ms = Date.now() - t0;
  const ok = !error;
  process.stdout.write(`${ok ? `${C.green}✔` : `${C.red}✖`}${C.off} ${C.dim}${t.file.replace(".live.mjs", "")} ›${C.off} ${t.name} ${C.dim}(${ms} ms)${C.off}\n`);
  if (!ok) {
    // Both phones as they were, for the report.
    const slug = `fail-${t.file.replace(".live.mjs", "")}-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    for (const c of clients) {
      const shot = await c.shot(`${slug}-${c.label}`).catch(() => null);
      if (shot) error += `\n${c.label} phone: ${shot}`;
    }
    process.stdout.write(`${indent(error)}\n`);
  }
  return { file: t.file, name: t.name, ok, error, ms };
}

/** After the role change the GM client logs back in; wait until it's the phone's host. */
async function waitForHost() {
  const end = Date.now() + 90_000;
  for (;;) {
    const ok = await gm.run(() => game.ready && store.isHost && store.online).catch(() => false);
    if (ok) return;
    if (Date.now() > end) throw new Error("the lane GM didn't become the phone's host");
    await new Promise(r => setTimeout(r, 1000));
  }
}

const indent = s => String(s).split("\n").map(l => `    ${l}`).join("\n");

main().catch(e => {
  process.stderr.write(`${C.red}${e.stack ?? e}${C.off}\n`);
  process.exitCode = 2;
});

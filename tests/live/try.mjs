#!/usr/bin/env node
/*
 * Run a snippet in a lane client with the live suite's helpers (lib.mjs PRELUDE) in scope, for writing
 * and debugging specs:  node tests/live/try.mjs pl 'await go("bangme"); return text(".agent-info")'
 */
import { gm, pl } from "./lib.mjs";

const [who, body] = process.argv.slice(2);
const client = { gm, pl }[who];
if (!client || !body) {
  process.stderr.write("usage: node tests/live/try.mjs gm|pl '<async function body>'\n");
  process.exit(1);
}
const fn = new Function(`return async () => { ${body} }`)();
client.run(fn).then(
  v => process.stdout.write(`${JSON.stringify(v, null, 1)}\n`),
  e => (process.stderr.write(`${e.message}\n`), (process.exitCode = 1))
);

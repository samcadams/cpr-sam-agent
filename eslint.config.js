import js from "@eslint/js";
import globals from "globals";

/*
 * `npm run lint`. The scripts call ESLint by path, not by name: this folder's path has a ':' in it
 * (the SFTP mount, root@host:22), which breaks PATH lookups and makes npx read it as a git address.
 */

/** What Foundry puts on window. */
const foundry = Object.fromEntries(
  ["game", "foundry", "Hooks", "ui", "canvas", "PIXI", "Handlebars", "Application", "Dialog", "FilePicker", "TextEditor",
   "loadTemplates", "renderTemplate", "fromUuid", "fromUuidSync", "ImagePopout", "Actor", "AudioHelper", "CONFIG", "CONST", "Roll", "ChatMessage", "saveDataToFile", "Folder", "JournalEntry", "JournalSheet", "$", "jQuery"].map(n => [n, "readonly"])
);

const unused = ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }];

export default [
  { ignores: ["node_modules/", "packs/", "data/", "dist/"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.js", "apps/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.browser, ...foundry } },
    rules: { "no-unused-vars": unused }
  },
  {
    // Run in Node: the tests (with a stand-in for Foundry, tests/foundry-stub.js), the tools and this file.
    files: ["tests/**/*.js", "tools/**/*.mjs", "*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node, ...globals.browser, ...foundry } },
    rules: { "no-unused-vars": unused }
  },
  {
    // The live suite (tests/live, fpw): runner code in Node, and functions sent into a Foundry client,
    // where lib.mjs's PRELUDE helpers are in scope.
    files: ["tests/live/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node, ...globals.browser, ...foundry,
        ...Object.fromEntries(["MODULE", "api", "store", "AgentPhone", "sleep", "until", "root", "phone", "closePhone", "el", "els",
          "text", "hit", "tap", "choose", "fill", "go", "dialog", "inDialog", "press", "appsOn"].map(n => [n, "readonly"]))
      }
    },
    rules: { "no-unused-vars": unused }
  }
];

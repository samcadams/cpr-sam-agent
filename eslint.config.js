import globals from "globals";
const foundry = Object.fromEntries(
  ["game", "foundry", "Hooks", "ui", "canvas", "Handlebars", "Application", "Dialog", "FilePicker", "TextEditor",
   "loadTemplates", "renderTemplate", "fromUuid", "fromUuidSync", "ImagePopout", "Actor", "AudioHelper", "CONFIG", "CONST", "Roll", "ChatMessage", "saveDataToFile", "Folder", "JournalEntry", "$", "jQuery"].map(n => [n, "readonly"])
);
export default [{
  files: ["scripts/**/*.js"],
  languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.browser, ...foundry } },
  rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
}];

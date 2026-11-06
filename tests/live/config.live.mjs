/*
 * The Director's Config tab (T268): Foundry's settings stay the source of truth, and the Director mirrors
 * them. A change in the Director shows in Configure Settings and the App rules submenu, and the reverse.
 * The module's api.settings is swapped for a test group during a test, so it doesn't depend on which
 * groups the modules list today, and put back afterwards.
 */

/* global openConfig, field, change, putBack -- defined in the page by OPEN below */
import { check, same, test } from "./lib.mjs";

/** In the page: open the Director on Config → `open` (a rail entry), with a test group for cpr-sam-agent. */
const OPEN = `
async function openConfig(open, keys) {
  const mod = game.modules.get(MODULE);
  window.__cfgSaved ??= { settings: mod.api.settings };
  if (keys) mod.api.settings = { groups: [{ id: "claude-test", label: "Claude test", keys }] };
  const director = api.director.open();
  await until(() => director.rendered, "the Director");
  (await until(() => document.querySelector('#ctp-director [data-director="tab"][data-tab="config"]'), "the Config tab button")).click();
  await until(() => document.querySelector("#ctp-director .director-config"), "the Config tab");
  if (keys) director.refresh({ all: true }); // the test group, if the tab was already open
  (await until(() => document.querySelector(\`#ctp-director [data-director="config-open"][data-open="\${open}"]\`), "the " + open + " rail button")).click();
  await until(() => document.querySelector(\`#ctp-director .director-config[data-app="\${open}"]\`), "the " + open + " page");
  return director;
}
const field = id => document.querySelector(\`#ctp-director [data-field="\${id}"]\`);
function change(input, value) {
  if (input.type === "checkbox") input.checked = value;
  else input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function putBack() {
  if (window.__cfgSaved) game.modules.get(MODULE).api.settings = window.__cfgSaved.settings;
  delete window.__cfgSaved;
}
`;

const run = (client, fn, args) => client.run(new Function("a", `return (async () => { ${OPEN}\nreturn (${fn.toString()})(a); })();`), args);

test("Config: a client setting changed in the Director shows in Configure Settings, and the reverse", async ({ gm }) => {
  const before = await gm.run(() => game.settings.get(MODULE, "keepPopups"));
  try {
    const there = await run(gm, async a => {
      await openConfig(MODULE, ["keepPopups", "ringRadius"]);
      const box = await until(() => field(`${MODULE}.keepPopups`), "the Keep pop-ups checkbox");
      const label = box.closest(".ctp-config-field").textContent;
      change(box, !a.before);
      await until(() => game.settings.get(MODULE, "keepPopups") === !a.before, "the setting to change");
      const config = new SettingsConfig();
      await config._render(true);
      const input = await until(() => config.element?.[0]?.querySelector(`[name="${MODULE}.keepPopups"]`), "Configure Settings' field");
      const shown = input.checked;
      // The reverse: tick it back in Configure Settings and save.
      input.checked = a.before;
      await config.submit();
      await config.close();
      await until(() => field(`${MODULE}.keepPopups`)?.checked === a.before, "the Director to follow Configure Settings");
      return { thisBrowser: /\(this browser\)/.test(label), shown, after: game.settings.get(MODULE, "keepPopups") };
    }, { before });
    check(there.thisBrowser, "a client setting says (this browser)");
    same(there.shown, !before, "Configure Settings shows the Director's change");
    same(there.after, before, "Configure Settings' change is saved and the Director shows it");
  } finally {
    await gm.run(async a => game.settings.set(MODULE, "keepPopups", a.before), { before });
    await run(gm, () => putBack());
  }
});

test("Config: a world setting changed in the Director is saved, and a change elsewhere redraws the Director", async ({ gm }) => {
  const before = await gm.run(() => game.settings.get(MODULE, "ringRadius"));
  try {
    const out = await run(gm, async a => {
      await openConfig(MODULE, ["keepPopups", "ringRadius"]);
      const input = await until(() => field(`${MODULE}.ringRadius`), "the sound radius field");
      change(input, a.before + 1);
      await until(() => game.settings.get(MODULE, "ringRadius") === a.before + 1, "the setting to change");
      await game.settings.set(MODULE, "ringRadius", a.before + 2); // as Configure Settings or another GM would
      await until(() => Number(field(`${MODULE}.ringRadius`)?.value) === a.before + 2, "the Director to redraw");
      return { stored: game.settings.get(MODULE, "ringRadius") };
    }, { before });
    same(out.stored, before + 2, "the Director shows the new value");
  } finally {
    await gm.run(async a => game.settings.set(MODULE, "ringRadius", a.before), { before });
    await run(gm, () => putBack());
  }
});

test("Config: App rules in the Director and in the App rules submenu write the same app setting", async ({ gm }) => {
  const before = await gm.run(() => foundry.utils.deepClone(game.settings.get(MODULE, "hustool")));
  try {
    const out = await run(gm, async () => {
      await openConfig("rules");
      const perHour = [...document.querySelectorAll('#ctp-director .ctp-config-group[data-app="hustool"] [data-field]')].find(i => /per gig hour/i.test(i.closest(".ctp-config-field").textContent));
      if (!perHour) throw new Error("HusTool's rules aren't on the App rules page");
      change(perHour, 7);
      await until(() => Number(game.settings.get(MODULE, "hustool").perHour) === 7, "HusTool's setting to change");
      const menu = game.settings.menus.get(`${MODULE}.appRules`);
      const app = new menu.type();
      await app._render(true);
      const inMenu = await until(() => app.element?.[0]?.querySelector(`[data-field="${perHour.dataset.field}"]`), "the submenu's field");
      const shown = Number(inMenu.value);
      inMenu.value = "3";
      inMenu.dispatchEvent(new Event("change", { bubbles: true }));
      await until(() => Number(game.settings.get(MODULE, "hustool").perHour) === 3, "the submenu's change to save");
      await until(() => Number(field(perHour.dataset.field)?.value) === 3, "the Director to follow the submenu");
      await app.close();
      return { shown, sections: document.querySelectorAll("#ctp-director .ctp-config-group[data-app]").length };
    });
    same(out.shown, 7, "the submenu shows the Director's change");
    check(out.sections >= 10, `a section per app with rules (${out.sections})`);
  } finally {
    await gm.run(async a => game.settings.set(MODULE, "hustool", a.before), { before });
    await run(gm, () => putBack());
  }
});

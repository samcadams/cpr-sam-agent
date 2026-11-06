/*
 * Configure Settings' submenus (ui/settings/menus.js), in the GM's client: each opens with its sections, a
 * change in the form saves at once, and Control's buttons open them.
 */

import { check, same, test } from "./lib.mjs";

test("each submenu opens from game.settings.menus with its sections", async ({ gm }) => {
  const shown = await gm.run(async () => {
    const out = {};
    for (const menu of ["apps", "phoneRules", "sounds", "clock", "integrations"]) {
      const app = new (game.settings.menus.get(`${MODULE}.${menu}`).type)().render(true);
      const root = await until(() => app.rendered && app.element?.[0], `the ${menu} submenu`);
      out[menu] = [...root.querySelectorAll("legend")].map(l => l.textContent.trim());
      await app.close();
    }
    return out;
  });
  same(shown, {
    apps: ["Apps"],
    phoneRules: ["Messages", "Jobs", "Agents", "Library Search", "CitiNet"],
    sounds: ["Default sounds", "Sounds in the world"],
    clock: ["Clock"],
    integrations: ["Anthropic API"]
  }, "every submenu draws its sections");
}, { player: false });

test("Phone rules: a switch and a slider save as they're changed", async ({ gm }) => {
  const r = await gm.run(async () => {
    const was = { share: api.settings.get("features.shareTexts"), bonus: api.settings.get("agentLibraryBonus") };
    const app = new (game.settings.menus.get(`${MODULE}.phoneRules`).type)().render(true);
    const control = key => until(() => app.rendered && app.element?.[0]?.querySelector(`[data-key="${key}"]`), key);
    const change = (input, value) => {
      if (input.type === "checkbox") input.checked = value;
      else input.value = String(value);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    try {
      change(await control("features.shareTexts"), !was.share);
      const share = await until(() => api.settings.get("features.shareTexts") === !was.share && "saved", "the switch to save").catch(() => null);
      const bonus = was.bonus >= 5 ? was.bonus - 1 : was.bonus + 1;
      await sleep(200); // the submenu redraws after the switch
      change(await control("agentLibraryBonus"), bonus);
      const slider = await until(() => api.settings.get("agentLibraryBonus") === bonus && "saved", "the slider to save").catch(() => null);
      return { share, slider };
    } finally {
      await api.settings.set("features.shareTexts", was.share);
      await api.settings.set("agentLibraryBonus", was.bonus);
      await app.close();
    }
  });
  same(r.share, "saved", "the Share texts switch saved");
  same(r.slider, "saved", "the Library Search bonus saved");
}, { player: false });

test("Control's Phone rules button opens the submenu", async ({ gm }) => {
  const opened = await gm.run(async () => {
    await go("control");
    const section = await until(() => el('[data-section="everyPhone"]'), "Every phone");
    section.open = true;
    await tap('[data-action="open-settings-menu"][data-menu="phoneRules"]');
    const app = await until(() => Object.values(ui.windows).find(w => w.id === "ctp-settings-phoneRules" && w.rendered), "the Phone rules submenu");
    await app.close();
    return true;
  });
  check(opened, "the button opened Phone rules");
}, { player: false });

import { reduceMotion } from "../../scripts/ui/a11y.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { attachPhotoDialog, fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { MODULE_ID } from "../../scripts/config.js";
import { agentBonus, agentMods, BIG_SAAI, DATA_POOL_FOLDER, dataPool, EXAMPLE_ENTRY, librarySearchBase, locations, namedLocations, poolMatches } from "./model.js";
import { hasAddon, poolConfig, priceLabel, rowsOf } from "../pool/model.js";
import { API_URL, costOf, DEFAULT_DOMAINS, DEFAULT_MODEL, DEFAULT_RULES, draftRequest, errorText, runDraft } from "./ai.js";
import { agentLabel, personalityOf } from "../../scripts/model/apps.js";
import { displayName } from "../../scripts/model/threads.js";
import { anthropicOn } from "../../scripts/model/features.js";
import { store } from "../../scripts/store.js";
import { ago } from "../../scripts/util/text.js";

/*
 * Phone page: Ask Alex Anything (see apps/alex/model.js). Players ask; each question shows "Alex is
 * crawling the Pool…" until the GM answers, asks for a roll, or marks it "No results". The GM Phone
 * lists the questions waiting, with the suggested roll and the Data Pool entries each one mentions
 * (Use puts one's public text in the answer), and can have Claude draft each answer
 * (apps/alex/ai.js): the draft, its notes and the GM's direction stay on this GM's phone.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

/** Big SAAI's faux download after Buy (ms), like the App Store's. */
const SAAI_DOWNLOAD_MS = 3000;

/** The in-world week, for the Big SAAI banner: dismissed, it comes back once a week. */
const worldWeek = () => Math.floor(game.time.worldTime / (7 * 86400));
const saaiKey = actorId => `${MODULE_ID}.saaiBanner.${actorId}`;
function saaiDismissed(actorId) {
  try {
    return Number(localStorage.getItem(saaiKey(actorId))) === worldWeek();
  } catch {
    return false;
  }
}

/** Ziggurat's terms, behind "Terms of Service (scroll)". Clause 3 is the only real one. */
const EULA = [
  "ZIGGURAT SAAI ENHANCEMENT SERVICES AGREEMENT (rev. 45.3.1). By tapping BUY, opening Ask Alex Anything, or holding an Agent within 2 m of a Ziggurat-certified device, you (\"the Asset\") agree to these terms.",
  "1. Ziggurat grants the Asset a revocable, non-transferable licence to enhanced Synthetic Artificial Artificial Intelligence.",
  "2. The enhancement may use idle cycles of the Asset's Agent, wetware and nearby appliances.",
  "3. To improve results and speed, Ziggurat may observe, retain, analyse, monetise, share, sell, resell and remember usage information, queries, locations, contacts, purchases, heart rate and tone of voice (\"Usage\").",
  "4. Usage belongs to Ziggurat.",
  "5. The Asset waives any right to know which of its Usage was sold, to whom, or for how much.",
  "6. \"Priority crawl\" means priority as Ziggurat defines it on the day.",
  "7. Results are provided as is. Ziggurat is not liable for answers that are confident and wrong.",
  "8. The enhancement cannot be uninstalled. Attempting to uninstall it is Usage.",
  "9. Ziggurat may change these terms at any time. Continued breathing constitutes acceptance.",
  ...Array.from({ length: 37 }, (_, i) => `${i + 10}. Reserved.`),
  "47. This agreement is governed by the laws of whichever jurisdiction Ziggurat prefers at the time."
];

/** What the drafts cost since this browser loaded the world (USD). */
let sessionSpend = 0;

/** The key while "Remember the key" is off: in memory only, gone when the page reloads. */
let sessionKey = "";

/**
 * The GM's Alex AI settings (client setting "alexAi": this browser only, never sent to the server):
 * { key, remember, standing, rules, sentences, domains, cap }. The key is only ever handed out to a
 * GM. Whether answers take the asker's Agent personality is world-wide ("alexAgentVoice"): players see it.
 */
export function aiSettings() {
  const s = game.settings.get(MODULE_ID, "alexAi") ?? {};
  const remember = s.remember !== false;
  return {
    key: game.user.isGM ? (remember ? s.key ?? "" : sessionKey) : "",
    remember,
    standing: s.standing ?? "",
    rules: s.rules ?? "",
    agentVoice: game.settings.get(MODULE_ID, "alexAgentVoice"),
    sentences: s.sentences > 0 ? s.sentences : 3,
    domains: s.domains ?? DEFAULT_DOMAINS.join(", "),
    cap: s.cap > 0 ? s.cap : 0
  };
}

/** Count a draft's cost towards this session's cap (DataPool's drafts share it: apps/screamsheet/page.js). */
export const addSpend = cost => (sessionSpend += cost);

/** Has this session's spending reached the cap? */
export const overCap = () => { const { cap } = aiSettings(); return !!cap && sessionSpend >= cap; };

const saveAi = changes => game.settings.set(MODULE_ID, "alexAi", { ...game.settings.get(MODULE_ID, "alexAi"), ...changes });

export const actions = {
  "alex-ask"() {
    const actor = this.context()?.subject?.actor;
    const input = this.element[0].querySelector("[name=alexQuery]");
    const text = input?.value.trim();
    if (!actor || !text) return;
    if (store.request("alex-ask", { actorId: actor.id, text })) {
      this.alexDraft = "";
      input.value = "";
    }
  },
  /**
   * Library Search with the character sheet's own roll: the system's roll dialog (mods, Luck), its
   * roll card in chat, plus the Agent's bonus and Big SAAI's (unless an effect on the sheet already gives it). The host
   * takes the result (apps/alex/host.js). Without the skill item, the host rolls instead.
   */
  async "alex-roll"({ queryId }) {
    const q = store.apps.queries[queryId];
    const actor = game.actors.get(q?.actorId);
    const skill = actor?.items.find(i => i.type === "skill" && /^library search$/i.test(i.name));
    if (!skill?.createRoll) return store.request("alex-roll", { queryId });
    if (this.alexRolling) return;
    this.alexRolling = true;
    try {
      const roll = skill.createRoll("skill", actor);
      roll.addMod(agentMods(roll.mods, hasAddon(store.apps.installs, actor.id, BIG_SAAI), "Ask Alex Anything"));
      if (!(await roll.handleRollDialog({ type: "macro", ctrlKey: false }, actor, skill))) return;
      await roll.roll();
      // Luck spent in the dialog comes off the sheet, as the sheet's own rolls do.
      if (Number.isInteger(roll.luck) && roll.luck > 0) {
        const luck = actor.system.stats.luck.value;
        await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
      }
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id && t.controlled) ?? null;
      roll.entityData = { actor: actor.id, token: token?.document.isLinked === false ? token.id : null };
      const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${game.system.id}/modules/chat/cpr-chat.js`));
      const card = await CPRChat.RenderRollCard(roll);
      const crit = roll.criticalRoll ? ` ${roll.wasCritFail() ? "−" : "+"} ${roll.criticalRoll}` : "";
      const mods = roll.totalMods();
      const detail = `${roll.initialRoll}${crit} + ${roll.statValue} INT + ${roll.skillValue} skill${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)} mods` : ""}${roll.luck > 0 ? ` + ${roll.luck} Luck` : ""}`;
      store.request("alex-roll", { queryId, total: roll.resultTotal, detail, messageId: card?.id ?? null });
    } finally {
      this.alexRolling = false;
    }
  },
  /** Big SAAI: hide the banner until next in-world week. */
  "alex-saai-dismiss"() {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    try {
      localStorage.setItem(saaiKey(actor.id), String(worldWeek()));
    } catch {
      // No storage: it just stays hidden until the phone redraws.
    }
    this.alexSaaiHidden = actor.id;
    this.alexSaaiOpen = false;
    this.render();
  },
  /** Big SAAI's details sheet (and its terms), from the banner or the badge. */
  "alex-saai-details"() {
    this.alexSaaiOpen = !this.alexSaaiOpen;
    this.render();
  },
  /** Buy Big SAAI: the request goes now (it pays); the sheet shows a download for a few seconds. */
  "alex-saai-buy"() {
    const actor = this.context()?.subject?.actor;
    if (!actor || this.alexSaaiDl) return;
    if (!store.request("alex-saai-buy", { actorId: actor.id })) return;
    this.alexSaaiDl = Date.now();
    this.render();
    setTimeout(() => {
      this.alexSaaiDl = null;
      if (hasAddon(store.apps.installs, actor.id, BIG_SAAI)) this.alexSaaiOpen = false;
      if (this.rendered) this.render();
    }, SAAI_DOWNLOAD_MS);
  },
  "alex-clear"() {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("alex-clear", { actorId: actor.id });
  },
  "alex-answer"({ queryId }) {
    const root = this.element[0];
    const text = root.querySelector(`textarea[data-query-id="${queryId}"]`)?.value.trim();
    const image = this.alexImages?.[queryId] ?? null;
    if (!text && !image) return ui.notifications.warn("Write Alex's answer first.");
    store.request("alex-answer", { queryId, text, image });
    delete this.alexDrafts?.[queryId];
    delete this.alexImages?.[queryId];
    delete this.alexAi?.[queryId];
  },
  async "alex-photo"({ queryId }) {
    const image = await attachPhotoDialog();
    if (!image) return;
    (this.alexImages ??= {})[queryId] = image;
    this.render();
  },
  /** Ask for a roll: at the DV Claude suggested (data-dv), or the one typed in. */
  "alex-need-roll"({ queryId, dv }) {
    dv = Number(dv) || Number(this.element[0].querySelector(`input[name=alexDv][data-query-id="${queryId}"]`)?.value) || 13;
    store.request("alex-need-roll", { queryId, dv });
  },
  /** GM: add a Data Pool entry's public text (no secrets, no keywords line) to the answer. */
  "alex-use"({ queryId, entryId }) {
    const entry = game.journal.get(entryId);
    const text = entry ? dataPool([entry])[0]?.text : "";
    if (!text) return ui.notifications.warn("That entry has nothing public to send.");
    const drafts = (this.alexDrafts ??= {});
    drafts[queryId] = [drafts[queryId]?.trim(), text].filter(Boolean).join("\n\n");
    this._focusNext = `textarea[data-query-id="${queryId}"]`;
    this.render();
  },
  "alex-open-entry"({ entryId }) {
    game.journal.get(entryId)?.sheet.render(true);
  },
  "alex-none"({ queryId }) {
    store.request("alex-none", { queryId });
    delete this.alexAi?.[queryId];
  },
  /**
   * GM: have Claude draft the answer. A popup asks for this question's direction and whether to
   * search the web (both kept for a redraft).
   */
  async "alex-draft"({ queryId }) {
    const q = store.apps.queries[queryId];
    const settings = aiSettings();
    if (!q) return;
    if (!settings.key) return ui.notifications.warn("Add your Anthropic API key under Optional Anthropic API first.");
    if (settings.cap && sessionSpend >= settings.cap) return ui.notifications.warn(`Alex AI has reached this session's cap ($${settings.cap.toFixed(2)}).`);
    const ai = ((this.alexAi ??= {})[queryId] ??= {});
    if (ai.busy) return;
    const asked = await fieldsDialog({
      title: `Draft with Claude: "${q.text.length > 40 ? `${q.text.slice(0, 40)}…` : q.text}"`,
      fields: [
        { name: "direction", label: "Directions for Alex", type: "textarea", rows: 3, value: ai.direction ?? "", placeholder: "Optional: tone, what to hint at, what to leave out…" },
        { name: "web", label: "Web search", type: "checkbox", value: !!ai.web, hint: `Searches ${settings.domains || "the web"}. Costs more.` }
      ],
      label: "Draft"
    });
    if (!asked || ai.busy || !store.apps.queries[queryId]) return;
    Object.assign(ai, { direction: asked.direction.trim(), web: !!asked.web });
    const actor = game.actors.get(q.actorId);
    const locs = locations();
    const direction = ai.direction ?? "";
    const named = namedLocations(`${q.text}\n${direction}`, locs);
    const body = draftRequest({
      question: q.text,
      asker: actor ? displayName(actor) : "a player character",
      roll: q.roll ? { ...q.roll, dv: q.dv } : null,
      dv: q.status === "roll" ? q.dv : null,
      pool: dataPool(undefined, { secrets: "mark" }),
      locations: locs,
      named,
      direction,
      standing: settings.standing,
      webSearch: !!ai.web,
      domains: settings.domains.split(/[\s,]+/).filter(Boolean),
      sentences: settings.sentences,
      rules: settings.rules,
      agent: settings.agentVoice && actor ? { name: agentLabel(actor), voice: personalityOf(actor)?.voice ?? "" } : null
    });
    Object.assign(ai, { busy: true, error: null });
    this.render();
    try {
      const { result, cost, lookups, searches } = await runDraft(body, { key: settings.key, locations: locs });
      sessionSpend += cost;
      Object.assign(ai, { result, cost, searches, read: [...new Set([...named.map(l => l.name), ...lookups])] });
      (this.alexDrafts ??= {})[queryId] = result.answer;
    } catch (err) {
      ai.error = err.message;
    }
    ai.busy = false;
    // refresh, not render: the "drafting" redraw may still be drawing (a render then is dropped).
    this.refresh();
  },
  /** GM: check the key with a tiny request. */
  async "alex-ai-test"() {
    const { key } = aiSettings();
    if (!key) return ui.notifications.warn("Add your Anthropic API key first.");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 5, messages: [{ role: "user", content: "Say OK." }] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return ui.notifications.error(errorText(res.status, data));
      sessionSpend += costOf(data.usage);
      ui.notifications.info("Alex AI: the key works.");
      this.render();
    } catch (err) {
      ui.notifications.error(`Alex AI: couldn't reach Anthropic (${err.message}).`);
    }
  },
  /** GM: show or hide the base instructions sent with every draft. */
  "alex-rules"() {
    this.alexRulesOpen = !this.alexRulesOpen;
    this.render();
  },
  /** GM: back to the module's own base instructions. */
  async "alex-rules-reset"() {
    await saveAi({ rules: "" });
    this.render();
  },
  /** GM: make the "Data Pool" folder and an example entry to copy. */
  async "alex-example"() {
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === DATA_POOL_FOLDER);
    folder ??= await Folder.create({ name: DATA_POOL_FOLDER, type: "JournalEntry" });
    const entry = await JournalEntry.create({
      name: EXAMPLE_ENTRY.name, folder: folder.id,
      pages: [{ name: EXAMPLE_ENTRY.name, type: "text", text: { content: EXAMPLE_ENTRY.text } }]
    });
    entry?.sheet.render(true);
  }
};

export const inputs = {
  // The question box grows with the question (CSS field-sizing; this sizes it where that's missing).
  "[name=alexQuery]": {
    input(event) {
      const box = event.currentTarget;
      this.alexDraft = box.value;
      if (!CSS.supports("field-sizing", "content")) {
        box.style.height = "auto";
        box.style.height = `${box.scrollHeight + 2}px`;
      }
    },
    keydown(event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.element.find("[data-action=alex-ask]").trigger("click");
      }
    }
  },
  "textarea[data-query-id]": {
    input(event) {
      (this.alexDrafts ??= {})[event.currentTarget.dataset.queryId] = event.currentTarget.value;
    }
  },
  /** Alex AI settings, saved as they're typed (this browser only). */
  "[data-alex-setting]": {
    "input change"(event) {
      const el = event.currentTarget;
      const key = el.dataset.alexSetting;
      if (key === "agentVoice") return game.settings.set(MODULE_ID, "alexAgentVoice", el.checked);
      if (el.type === "checkbox") return saveAi({ [key]: el.checked });
      let value = el.type === "number" ? Number(el.value) || 0 : el.value.trim();
      // The key, unless remembered, stays in memory.
      if (key === "key" && !aiSettings().remember) return (sessionKey = value);
      // Unchanged base instructions are kept as "the default", so module updates reach them.
      if (key === "rules" && value === DEFAULT_RULES.trim()) value = "";
      saveAi({ [key]: value });
    }
  },
  /** Remember the key in this browser, or keep it for this session only. */
  "input[data-alex-remember]": {
    change(event) {
      const s = game.settings.get(MODULE_ID, "alexAi") ?? {};
      if (event.currentTarget.checked) {
        saveAi({ remember: true, key: sessionKey || s.key || "" });
        sessionKey = "";
      } else {
        sessionKey = s.key ?? sessionKey;
        saveAi({ remember: false, key: "" });
      }
    }
  }
};

export const methods = {
  /**
   * Ask Alex Anything's new answers appear word by word, like an AI writing them, the first time
   * this phone shows them.
   */
  _revealAnswers(html) {
    const reduce = reduceMotion();
    this._revealed ??= new Set();
    for (const el of html.querySelectorAll("[data-reveal]")) {
      const id = el.dataset.reveal;
      if (this._revealed.has(id)) continue;
      this._revealed.add(id);
      if (reduce) continue;
      const words = el.textContent.split(/(\s+)/);
      // About 2 words a tick, faster for long answers so none takes more than ~4 seconds.
      const step = Math.max(4, Math.ceil(words.length / 60));
      let shown = 0;
      el.textContent = "";
      el.classList.add("revealing");
      const timer = setInterval(() => {
        shown = Math.min(words.length, shown + step);
        el.textContent = words.slice(0, shown).join("");
        if (shown >= words.length || !el.isConnected) {
          clearInterval(timer);
          el.textContent = words.join("");
          el.classList.remove("revealing");
        }
      }, 70);
    }
  },

  /**
   * Big SAAI on a player's Ask Alex: `owned` (the badge, its bonus, "priority crawl" tags), else the banner while it's
   * for sale to them (not revoked, not dismissed this week), and the details sheet with Buy and the terms.
   */
  _alexSaaiData(actorId) {
    const installs = store.apps.installs;
    const owned = hasAddon(installs, actorId, BIG_SAAI);
    const revoked = !!rowsOf(installs, actorId)[BIG_SAAI]?.revoked;
    const downloading = this.alexSaaiDl ? { ms: SAAI_DOWNLOAD_MS, elapsed: Math.min(SAAI_DOWNLOAD_MS, Date.now() - this.alexSaaiDl) } : null;
    const entry = poolConfig().apps[BIG_SAAI];
    const forSale = !owned && !revoked && !this.alexSaaiOpen;
    const dismissed = this.alexSaaiHidden === actorId || saaiDismissed(actorId);
    return {
      owned: owned && !downloading,
      // Not over its own details sheet; dismissed, a small Ziggurat chip still opens it.
      banner: forSale && !dismissed,
      chip: forSale && dismissed,
      open: !!this.alexSaaiOpen && (!revoked || owned),
      price: priceLabel(entry),
      bonus: librarySearchBase(null, owned).bonus,
      // The details sheet: "+<with Big SAAI> instead of +<the Agent's>".
      withSaai: librarySearchBase(null, true).bonus,
      agentBonus: agentBonus(),
      downloading,
      eula: EULA
    };
  },

  alexData(ctx) {
    const queries = Object.values(store.apps.queries).sort((a, b) => a.ts - b.ts);
    const row = q => ({
      ...q,
      // Answers that just arrived appear word by word (AgentPhone._revealAnswers).
      reveal: q.status === "answered" && (q.answer?.ts ?? 0) > Date.now() - 10 * 60_000,
      crawling: q.status === "crawling",
      needsRoll: q.status === "roll",
      answered: q.status === "answered",
      none: q.status === "none",
      ago: ago(q.ts)
    });
    if (ctx.perspective === "gm") {
      // Big SAAI's "priority crawl": its questions come first.
      const waiting = queries.filter(q => q.status === "crawling" || q.status === "roll").sort((a, b) => !!b.priority - !!a.priority);
      const settings = aiSettings();
      // Matched with secrets in (a keyword may sit in one); shown and used without them.
      const pool = waiting.length ? dataPool(undefined, { secrets: "mark" }) : [];
      const open = this.sectionsOpen();
      const shown = new Map(pool.length ? dataPool().map(e => [e.id, e.text]) : []);
      const anthropic = anthropicOn();
      return {
        gm: true,
        anthropic,
        bar: appBar("alex"),
        waiting: waiting.map(q => {
          const actor = game.actors.get(q.actorId);
          const base = librarySearchBase(actor, actor && hasAddon(store.apps.installs, actor.id, BIG_SAAI));
          // Anthropic tools off (Control): no Claude draft, notes or suggestions at all.
          const ai = anthropic ? this.alexAi?.[q.id] ?? {} : {};
          const r = ai.result;
          const personality = actor ? personalityOf(actor) : null;
          const matches = poolMatches(q.text, pool).map(m => {
            const text = shown.get(m.id) ?? "";
            return { id: m.id, name: m.name, hits: m.hits, secret: m.text.includes("[GM SECRET]"), preview: text.length > 180 ? `${text.slice(0, 180)}…` : text };
          });
          return {
            ...row(q), matches, name: actor ? displayName(actor) : "?", suggest: `Library Search: INT ${base.int} + skill ${base.level} + ${base.bonus} (Agent${base.bigSaai ? " + Big SAAI" : ""}) = ${base.total} + 1d10`,
            draft: this.alexDrafts?.[q.id] ?? "", image: this.alexImages?.[q.id] ?? null,
            ai: {
              ...ai,
              ready: anthropic && !!settings.key,
              // Claude's suggested roll, offered while no roll's been asked for.
              rollDv: r?.needsRoll && q.status === "crawling" ? r.dv ?? 13 : null,
              cost: r ? `$${ai.cost.toFixed(4)}` : null
            },
            dv: r?.dv ?? 13,
            // The asker's Agent and personality (which voices Claude's draft while that's on).
            agent: actor ? {
              label: agentLabel(actor),
              personality: personality ? `${personality.name}${personality.voice ? `: ${personality.voice}` : ""}` : "Factory default",
              voices: anthropic && settings.agentVoice && !!personality?.voice
            } : null
          };
        }),
        recent: queries.filter(q => q.status === "answered" || q.status === "none").slice(-10).reverse().map(q => ({ ...row(q), name: displayName(game.actors.get(q.actorId)) })),
        folder: DATA_POOL_FOLDER,
        hasPool: pool.length > 0,
        matchesOpen: open.alexMatches !== false,
        settings: {
          ...settings, spend: `$${sessionSpend.toFixed(3)}`, model: DEFAULT_MODEL,
          rulesOpen: !!this.alexRulesOpen, rulesText: settings.rules || DEFAULT_RULES, rulesCustom: !!settings.rules
        },
        open
      };
    }
    return {
      bar: appBar("alex", { owner: ctx.subject.name, tag: anthropicOn() && game.settings.get(MODULE_ID, "alexAgentVoice") ? "Alex uses your Agent's personality." : null }),
      draft: this.alexDraft ?? "",
      online: this.online,
      saai: this._alexSaaiData(ctx.actorId),
      queries: queries.filter(q => q.actorId === ctx.actorId).map(row),
      canClear: queries.some(q => q.actorId === ctx.actorId && (q.status === "answered" || q.status === "none"))
    };
  }
};

export const phone = {
  render(html) {
    this._revealAnswers(html);
    // Opened from an alert about one question (core/shade.js openAlert): show that question.
    if (this.app === "alex" && this.alexFocus) {
      html.querySelector(`[data-alex-query="${CSS.escape(this.alexFocus)}"]`)?.scrollIntoView({ block: "start" });
      this.alexFocus = null;
    }
  }
};

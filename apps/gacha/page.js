import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { fieldsDialog } from "../../scripts/ui/dialogs/forms.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { PullShow } from "./pull.js";
import { cleanCollectible, collectibles, constellation, duplicates, FAV_MAX, formatCreds, gachaConfig, gachaData, odds, PITY, RARITIES, REWARDS_MAX, saleValue } from "./model.js";
import { compendiumItems } from "../../scripts/model/items.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";

/*
 * Phone page: Gacha (see apps/gacha/model.js). Players: the capsule machine (buy zCreds, pull: a show,
 * apps/gacha/pull.js, then what came out), and their shelf (favourites pinned across the top; show one
 * off, give one away, sell duplicates). The GM Phone: the machine's prices, odds and collectibles, and
 * everyone's shelves and zCreds (make a Legendary real). (Mystery Boxes are in Achieve!.)
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

const saveConfig = change => patchSetting("gachaConfig", change);

const TABS = { pull: "Capsules", shelf: "Shelf" };
const GM_TABS = { pull: "Capsules", shelf: "Shelves" };

/** "Make it real": the curated list's way out to every item. */
const ANY_ITEM = "any";

/** Add an item to the curated Legendary rewards (once). */
async function addReward(uuid) {
  const item = await fromUuid(uuid);
  if (item?.documentName !== "Item") return;
  const list = gachaConfig().legendaryRewards;
  if (list.some(r => r.uuid === item.uuid)) return;
  if (list.length >= REWARDS_MAX) return ui.notifications.warn(`${REWARDS_MAX} rewards at most.`);
  await saveConfig(cfg => (cfg.legendaryRewards = [...list, { uuid: item.uuid, name: item.name, img: item.img }]));
}

export const actions = {
  "gacha-tab"({ tab }) {
    this.gachaTab = tab;
    this.gachaPick = null;
    this.render();
  },
  "gacha-buy"({ bundle }) {
    const actor = this.context()?.subject?.actor;
    const b = gachaConfig().bundles[Number(bundle)];
    if (!actor || !b) return;
    Dialog.confirm({
      title: "Buy zCreds",
      content: `<p>${formatCreds(b.zc)} for ${formatMoney(b.eb)}?</p>`,
      yes: () => store.request("gacha-buy", { actorId: actor.id, bundle: Number(bundle) })
    });
  },
  /** Pull: the show plays over the phone until it's done; then what came out is on the page. */
  "gacha-pull"() {
    const actor = this.context()?.subject?.actor;
    if (!actor || this._gachaShow || !this.element?.[0]) return;
    const cost = gachaConfig().pullCost;
    if ((Number(gachaData(store.apps).creds[actor.id]) || 0) < cost) return ui.notifications.info(`A pull is ${formatCreds(cost)}. Buy some zCreds first.`);
    this.gachaReveal = null;
    const show = (this._gachaShow = new PullShow(this.element[0]));
    // What's on the shelf now: the first pull that isn't is this one (ids, not clocks: the host's can differ).
    show.before = new Set((gachaData(store.apps).shelves?.[actor.id] ?? []).map(p => p.id));
    show.done.then(pull => {
      this._gachaShow = null;
      if (pull) this.gachaReveal = pull.id;
      this.render();
    });
    store.request("gacha-pull", { actorId: actor.id });
    this.render();
  },
  "gacha-sell"({ cid }) {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("gacha-sell", { actorId: actor.id, cid });
  },
  "gacha-sell-all"() {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const owned = gachaData(store.apps).shelves[actor.id];
    const dupes = duplicates(owned);
    const zc = saleValue(owned, dupes, gachaConfig().sell);
    Dialog.confirm({
      title: "Sell duplicates",
      content: `<p>Sell ${dupes.length} duplicate${dupes.length === 1 ? "" : "s"} for ${formatCreds(zc)}? You keep one of each, and they all drop to C0.</p>`,
      yes: () => store.request("gacha-sell", { actorId: actor.id })
    });
  },
  "gacha-fav"({ cid }) {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("gacha-fav", { actorId: actor.id, cid });
  },
  "gacha-pick"({ pullId }) {
    this.gachaPick = this.gachaPick === pullId ? null : pullId;
    this.render();
  },
  "gacha-show"({ pullId }) {
    const actor = this.context()?.subject?.actor;
    if (actor) store.request("gacha-show", { actorId: actor.id, pullId });
  },
  async "gacha-give"({ pullId }) {
    const actor = this.context()?.subject?.actor;
    if (!actor) return;
    const others = playerCharacters().filter(a => a.id !== actor.id);
    if (!others.length) return ui.notifications.info("Nobody to give it to.");
    const result = await fieldsDialog({
      title: "Give it away",
      label: "Offer",
      note: "They accept it on their Agent.",
      fields: [{ name: "to", label: "To", type: "select", options: others.map(a => ({ value: a.id, label: displayName(a) })) }]
    });
    if (result?.to) store.request("gacha-trade", { actorId: actor.id, pullId, toId: result.to });
  },

  /* GM */
  async "gacha-real"({ actorId, pullId }) {
    const options = await compendiumItems();
    const rewards = gachaConfig().legendaryRewards;
    const anyItem = { name: "uuid", label: "Item", type: "select", search: true, options };
    const result = await fieldsDialog({
      title: "Make it real",
      label: "Give",
      note: "The item goes on their sheet; the collectible stays on their shelf.",
      fields: rewards.length
        ? [
            { name: "reward", label: "Reward", type: "select", options: [...rewards.map(r => ({ value: r.uuid, label: r.name })), { value: ANY_ITEM, label: "Pick any item…" }] },
            { ...anyItem, showIf: { field: "reward", value: ANY_ITEM } }
          ]
        : [anyItem]
    });
    const uuid = rewards.length && result?.reward !== ANY_ITEM ? result?.reward : result?.uuid;
    if (uuid) store.request("gacha-real", { actorId, pullId, uuid });
  },
  async "gacha-reward-add"() {
    const result = await fieldsDialog({
      title: "Legendary reward",
      label: "Add",
      fields: [{ name: "uuid", label: "Item", type: "select", search: true, options: await compendiumItems() }]
    });
    if (result?.uuid) await addReward(result.uuid);
  },
  "gacha-reward-remove"({ uuid }) {
    return saveConfig(cfg => (cfg.legendaryRewards = gachaConfig().legendaryRewards.filter(r => r.uuid !== uuid)));
  },
  "gacha-remove"({ actorId, pullId }) {
    store.request("gacha-remove", { actorId, pullId });
  },
  async "gacha-creds"({ actorId }) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const result = await fieldsDialog({
      title: `zCreds: ${displayName(actor)}`,
      label: "Set",
      fields: [{ name: "amount", label: "zCreds", type: "number", value: Number(gachaData(store.apps).creds[actorId]) || 0 }]
    });
    if (result) store.request("gacha-creds", { actorId, amount: result.amount });
  },
  async "gacha-c-edit"({ cid } = {}) {
    const list = collectibles();
    const i = list.findIndex(c => c.id === cid);
    const c = list[i] ?? { name: "", rarity: "common", icon: "fa-cube", img: "", text: "" };
    const result = await fieldsDialog({
      title: i >= 0 ? `Collectible: ${c.name}` : "New collectible",
      label: i >= 0 ? "Save" : "Add",
      fields: [
        { name: "name", label: "Name", value: c.name },
        { name: "rarity", label: "Rarity", type: "select", value: c.rarity, options: Object.entries(RARITIES).map(([value, r]) => ({ value, label: r.name })) },
        { name: "icon", label: "Icon", value: c.icon, hint: "A Font Awesome icon, like fa-skull or fa-crow (fontawesome.com/icons)." },
        { name: "img", label: "Or an image", type: "image", value: c.img, placeholder: "https://… or a file", hint: "A picture's web address or a file: shown instead of the icon. Empty: the icon." },
        { name: "text", label: "Flavor", value: c.text }
      ]
    });
    if (!result?.name) return;
    const clean = cleanCollectible({ ...result, id: i >= 0 ? c.id : null });
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    await saveConfig(cfg => (cfg.collectibles = list));
  },
  "gacha-c-add"() {
    return actions["gacha-c-edit"].call(this);
  },
  "gacha-c-remove"({ cid }) {
    const list = collectibles().filter(c => c.id !== cid);
    if (!list.length) return ui.notifications.warn("Keep at least one collectible.");
    return saveConfig(cfg => (cfg.collectibles = list));
  },
  "gacha-c-reset"() {
    Dialog.confirm({ title: "Gacha", content: "<p>Put back the default collectibles?</p>", defaultYes: false, yes: () => saveConfig(cfg => (cfg.collectibles = null)) });
  }
};

export const inputs = {
  "input[data-gacha-setting]": {
    change(event) {
      const el = event.currentTarget;
      const key = el.dataset.gachaSetting;
      return saveConfig(cfg => {
        // Per mille (apps/gacha/host.js moves weights saved before that).
        if (key.startsWith("weights.")) {
          (cfg.weights ??= {})[key.slice(8)] = Math.max(0, Math.round(Number(el.value) || 0));
          cfg.perMille = true;
        }
        else if (key.startsWith("bundles.")) {
          const [, i, field] = key.split(".");
          cfg.bundles = gachaConfig().bundles.map(({ eb, zc }) => ({ eb, zc }));
          cfg.bundles[Number(i)][field] = Math.max(0, Math.floor(Number(el.value) || 0));
        } else if (key.startsWith("sell.")) (cfg.sell ??= {})[key.slice(5)] = Math.max(0, Math.floor(Number(el.value) || 0));
        else if (key === "failChance") cfg.failChance = Math.min(100, Math.max(0, Number(el.value) || 0));
        else cfg[key] = el.type === "checkbox" ? el.checked : Math.max(0, Math.floor(Number(el.value) || 0));
      });
    }
  },
  ".agent-gacha-rewards": {
    dragover(event) {
      event.preventDefault();
    },
    drop(event) {
      const data = TextEditor.getDragEventData(event.originalEvent);
      if (data?.type !== "Item" || !data.uuid) return;
      event.preventDefault();
      return addReward(data.uuid);
    }
  }
};

const rarityOf = r => RARITIES[r] ?? RARITIES.common;

export const methods = {
  _gachaPull(p) {
    const r = rarityOf(p.rarity);
    const c = collectibles().find(x => x.id === p.cid);
    // Stars say the rarity without its colour: Common ★ … Legendary ★★★★★.
    const stars = "★".repeat(Object.keys(RARITIES).indexOf(p.rarity) + 1 || 1);
    // The picture it was pulled with; pulls without one (they store "") take the collectible's.
    return { ...p, img: p.img || c?.img || "", rarityName: r.name, color: r.color, stars, text: c?.text ?? "", from: p.from ? displayName(game.actors.get(p.from) ?? { name: "?" }) : null };
  },

  gachaData(ctx) {
    const gm = ctx.perspective === "gm";
    const cfg = gachaConfig();
    const data = gachaData(store.apps);
    const tabs = gm ? GM_TABS : TABS;
    if (!(this.gachaTab in tabs)) this.gachaTab = "pull";
    const tab = this.gachaTab;
    const list = collectibles(cfg);
    const base = {
      gm,
      bar: appBar("gacha", { owner: gm ? null : ctx.subject.name }),
      tabs: Object.entries(tabs).map(([id, label]) => ({ id, label, active: id === tab })),
      tab: { [tab]: true },
      cost: formatCreds(cfg.pullCost),
      odds: Object.entries(odds(cfg.weights, list)).map(([k, pct]) => ({ name: rarityOf(k).name, color: rarityOf(k).color, pct }))
    };

    if (gm) {
      return {
        ...base,
        cfg,
        weights: Object.entries(RARITIES).map(([k, r]) => ({ key: k, name: r.name, color: r.color, value: cfg.weights[k] ?? 0, sell: cfg.sell[k] ?? 0, count: list.filter(c => c.rarity === k).length })),
        bundles: cfg.bundles.map((b, i) => ({ ...b, i })),
        collectibles: list.map(c => ({ ...c, color: rarityOf(c.rarity).color, rarityName: rarityOf(c.rarity).name })),
        custom: !!cfg.collectibles,
        rewards: cfg.legendaryRewards.map(r => ({ ...r, icon: "fa-gift" })),
        shelves: playerCharacters().map(a => ({
          id: a.id, name: displayName(a), pity: data.pity?.[a.id] ?? null, creds: formatCreds(data.creds?.[a.id]),
          pulls: (data.shelves?.[a.id] ?? []).slice().sort((x, y) => Object.keys(RARITIES).indexOf(y.rarity) - Object.keys(RARITIES).indexOf(x.rarity) || y.ts - x.ts).map(p => this._gachaPull(p))
        })).filter(s => s.pulls.length || Number(data.creds?.[s.id]))
      };
    }

    const actor = ctx.subject.actor;
    const mine = (data.shelves?.[actor.id] ?? []).map(p => this._gachaPull(p));
    const pity = data.pity?.[actor.id] ?? {};
    const have = Number(data.creds?.[actor.id]) || 0;
    // The shelf: one tile per collectible, with how many.
    const tiles = new Map();
    for (const p of mine.slice().sort((a, b) => a.ts - b.ts)) {
      const t = tiles.get(p.cid) ?? { ...p, count: 0, ids: [] };
      t.count++;
      t.ids.push(p.id);
      tiles.set(p.cid, t);
    }
    // A pull came back: hand it to the show (it's NEW if it's the only one of its kind).
    const show = this._gachaShow;
    if (show && !show.pull) {
      const fresh = mine.filter(p => !show.before?.has(p.id)).sort((a, b) => b.ts - a.ts)[0];
      if (fresh) show.land({ ...fresh, fresh: tiles.get(fresh.cid)?.count === 1 });
    }
    const order = Object.keys(RARITIES);
    const favs = (data.favs?.[actor.id] ?? []).filter(cid => tiles.has(cid));
    const shelf = [...tiles.values()].sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity) || a.name.localeCompare(b.name));
    const picked = mine.find(p => p.id === this.gachaPick || tiles.get(p.cid)?.ids.includes(this.gachaPick));
    const tile = t => ({ ...t, ...constellation(t.count), many: t.count > 1, open: picked?.cid === t.cid, fav: favs.includes(t.cid) });
    const owned = data.shelves?.[actor.id] ?? [];
    const dupes = duplicates(owned);
    const reveal = this.gachaReveal && !show ? mine.find(p => p.id === this.gachaReveal) ?? null : null;
    return {
      ...base,
      pulling: !!show,
      creds: formatCreds(have),
      canPull: have >= cfg.pullCost,
      bundles: cfg.bundles.map((b, i, all) => ({ i, zc: formatCreds(b.zc), eb: formatMoney(b.eb), best: all.length > 1 && i === all.length - 1 })),
      reveal: reveal ? { ...reveal, ...constellation(tiles.get(reveal.cid)?.count ?? 1), fresh: tiles.get(reveal.cid)?.count === 1 } : null,
      favs: favs.map(cid => tile(tiles.get(cid))),
      favMax: FAV_MAX,
      shelf: shelf.map(tile),
      picked: picked
        ? (() => {
            const count = tiles.get(picked.cid)?.count ?? 1;
            const spare = dupes.find(p => p.cid === picked.cid);
            const level = constellation(count);
            return { ...picked, ...level, count, many: count > 1, dropsTo: level.level - 1, fav: favs.includes(picked.cid), canFav: favs.includes(picked.cid) || favs.length < FAV_MAX, sell: spare ? formatCreds(saleValue(owned, [spare], cfg.sell)) : null };
          })()
        : null,
      dupes: dupes.length ? { count: dupes.length, zc: formatCreds(saleValue(owned, dupes, cfg.sell)) } : null,
      // How far off the guarantees are (PITY), counting this next pull.
      pity: { epic: PITY.epicGuarantee - (pity.sinceEpic ?? 0), legendary: PITY.legendaryHard - (pity.sinceLegendary ?? 0) },
      owned: mine.length,
      kinds: tiles.size,
      total: list.length
    };
  }
};

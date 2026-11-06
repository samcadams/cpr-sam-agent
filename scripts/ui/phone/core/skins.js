import { MODULE_ID } from "../../../config.js";
import { reduceMotion } from "../../a11y.js";
import { adLines, SKINS, woundState } from "../../../model/agent.js";

/*
 * What some skins add around the page (model/agent.js SKINS): the Med Field Agent's vitals, messages typed
 * out letter by letter, and a Sponsored Cybereye's ads on any skin. Installed onto AgentPhone (core/pages.js).
 */

/**
 * An installed Sponsored Cybereye: "the cheapest chrome on the market", paid for by a Chyron of pop-up ads
 * nobody can switch off (Black Chrome p. 22). Any skin then shows the SPONSORED strip.
 */
export const sponsoredEye = actor => !!actor?.items?.some?.(i => i.type === "cyberware" && i.system?.isInstalled && /sponsored cybereye/i.test(i.name));

/** How long a sponsored ad stays up. */
const AD_MS = 150_000;

export const methods = {
  /**
   * What some skins add around the page (see SKINS): the Med Field Agent's vitals; and a Sponsored
   * Cybereye's ads, whatever the skin.
   */
  _skinExtras(data, ctx) {
    // A Sponsored Cybereye (Black Chrome p. 22) streams pop-up ads over whatever Agent you use (unless the GM
    // switched the ads off in Control → Labels).
    if (game.settings.get(MODULE_ID, "sponsoredAds") !== false && sponsoredEye(ctx?.subject?.actor)) data.ad = this._currentAd();
    const skin = SKINS[ctx?.look.skin];
    if (!skin) return;
    if (skin.vitals) data.vitals = this._vitals(ctx);
  },

  /**
   * The sponsored ad: the same line stays up across pages, and a new one slides in every couple of
   * minutes (or when the GM changes the list).
   */
  _currentAd() {
    const lines = adLines();
    const now = Date.now();
    const fresh = !this._ad || now > this._ad.until || !lines.includes(this._ad.text);
    if (fresh) this._ad = { text: lines[Math.floor(Math.random() * lines.length)], until: now + AD_MS };
    return { text: this._ad.text, fresh };
  },

  /** The Med Field Agent's biomonitor strip: HP from the sheet, and a heart rate to match. */
  _vitals(ctx) {
    const hp = ctx.subject?.actor.system?.derivedStats?.hp;
    if (!hp) return { hp: "--", bpm: "--", state: "ok", label: "NO BIOMONITOR" };
    const state = woundState(ctx.subject.actor) ?? "ok";
    const bpm = { ok: 72, serious: 128, mortal: 41 }[state];
    const label = { ok: "STABLE", serious: "SERIOUSLY WOUNDED", mortal: "MORTALLY WOUNDED" }[state];
    return { hp: `${hp.value}/${hp.max}`, bpm, state, label };
  },

  /**
   * Skins with typeOut: the newest message from the other side types out letter by letter, the first
   * time it's on screen.
   */
  _typeOut(list) {
    clearInterval(this._typing);
    const msg = [...(list?.querySelectorAll(".agent-msg") ?? [])].at(-1);
    const id = msg?.classList.contains("theirs") ? msg.dataset.messageId : null;
    const el = msg?.querySelector(".agent-bubble-text");
    if (!id || !el || this._typed.has(id)) return;
    this._typed.add(id);
    if (reduceMotion()) return;
    const full = el.textContent;
    let shown = 0;
    msg.classList.add("typing");
    el.textContent = "";
    this._typing = setInterval(() => {
      shown = Math.min(full.length, shown + 2);
      el.textContent = full.slice(0, shown);
      if (shown >= full.length) {
        clearInterval(this._typing);
        msg.classList.remove("typing");
      }
    }, 25);
  }
};

import { MODULE_ID } from "../../scripts/config.js";
import { RARITIES } from "./model.js";
import { playSound } from "../../scripts/util/audio.js";
import { esc } from "../../scripts/util/text.js";
import { reduceMotion } from "../../scripts/ui/a11y.js";

/*
 * Gacha's capsule pull (apps/gacha/page.js): a few unskippable, unreasonably dramatic seconds over
 * the whole phone. The capsule drops, shakes harder and harder while the host rolls, climbs through the
 * rarity colours up to what came out (a Common climbs nowhere, a Legendary through all five), cracks,
 * and shows it. Nothing on the phone can be clicked or keyed until it's over.
 * It lives on the phone's window, outside what a redraw replaces, so the phone can redraw under it.
 * Reduced motion: no shaking, spinning or flashing; the same steps, faded.
 */

const RANK = Object.keys(RARITIES);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sound = name => `modules/${MODULE_ID}/sounds/${name}.ogg`;

const LINES = {
  drop: ["Inserting zCreds…", "The machine stirs."],
  shake: ["Destiny is loading.", "Something's happening.", "Don't look away."],
  stuck: "Hold your breath.",
  step: { uncommon: "Oh?", rare: "OH??", epic: "WAIT.", legendary: "NO WAY." },
  reveal: { common: "It's… something!", uncommon: "Nice.", rare: "Rare!", epic: "EPIC!!", legendary: "L E G E N D A R Y" },
  fail: "The capsule is stuck. Mr. Amaze apologises."
};
const FANFARE = { common: "fanfare-tadaa", uncommon: "fanfare-chime", rare: "fanfare-arcade", epic: "fanfare-levelup", legendary: "fanfare-trophy" };
const GIVE_UP_MS = 9000; // no pull by then: the host said no (or isn't there)

export class PullShow {
  /** @param {HTMLElement} win the phone's window element */
  constructor(win) {
    this.started = Date.now();
    this.pull = null;
    this.failed = false;
    this.reduce = reduceMotion();
    this.root = document.createElement("div");
    this.root.className = `ctp-gacha-show${this.reduce ? " reduce" : ""}`;
    this.root.setAttribute("role", "alertdialog");
    this.root.setAttribute("aria-label", "Opening a capsule");
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="ctp-gs-rays"></div>
      <div class="ctp-gs-stage">
        <div class="ctp-gs-capsule"><i class="ctp-gs-top"></i><i class="ctp-gs-band"></i><i class="ctp-gs-bottom"></i><i class="ctp-gs-shine"></i></div>
        <div class="ctp-gs-item"></div>
      </div>
      <div class="ctp-gs-burst"></div>
      <p class="ctp-gs-line" aria-live="assertive"></p>
      <div class="ctp-gs-flash"></div>`;
    this.root.style.setProperty("--c", RARITIES.common.color);
    // Unskippable: every click, key and scroll on the phone stops here (Escape included, page-wide).
    const swallow = event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    for (const type of ["click", "dblclick", "contextmenu", "wheel", "pointerdown", "keydown"]) this.root.addEventListener(type, swallow);
    this._escape = event => {
      if (event.key === "Escape" && this.root.isConnected) swallow(event);
    };
    window.addEventListener("keydown", this._escape, true);
    win.append(this.root);
    this.root.focus();
    this.done = this._run();
  }

  /** The pull came back: the page's view of it ({ rarity, name, icon, img, fresh }). */
  land(pull) {
    this.pull ??= pull;
  }

  _say(text) {
    const line = this.root.querySelector(".ctp-gs-line");
    line.textContent = text;
    line.classList.remove("pop");
    void line.offsetWidth; // restart its pop
    line.classList.add("pop");
  }

  _phase(cls) {
    this.root.classList.add(cls);
  }

  _sound(name, volume = 1) {
    const v = game.settings.get(MODULE_ID, "volume");
    if (v) playSound(sound(name), { volume: v * volume });
  }

  async _run() {
    try {
      this._phase("drop");
      this._sound("money-kaching");
      this._say(LINES.drop[0]);
      await sleep(650);
      this._say(LINES.drop[1]);
      await sleep(650);
      for (let level = 1; level <= 3; level++) {
        this._phase(`s${level}`);
        this._say(LINES.shake[level - 1]);
        this._sound("text-ping", 0.4 + level * 0.2);
        await sleep(500);
      }
      // Still rolling: keep shaking.
      if (!this.pull) this._say(LINES.stuck);
      while (!this.pull && Date.now() - this.started < GIVE_UP_MS) await sleep(100);
      if (!this.pull) {
        this._phase("fizzle");
        this._say(LINES.fail);
        await sleep(1800);
        return null;
      }
      const pull = this.pull;
      const rarity = RARITIES[pull.rarity] ? pull.rarity : "common";
      // The climb: one colour up at a time, as far as it goes.
      for (const k of RANK.slice(1, RANK.indexOf(rarity) + 1)) {
        this.root.style.setProperty("--c", RARITIES[k].color);
        this.root.classList.remove("step");
        void this.root.offsetWidth;
        this._phase("step");
        this._say(LINES.step[k]);
        this._sound("text-chime", 0.8);
        await sleep(k === "legendary" ? 900 : 650);
      }
      this._phase("crack");
      await sleep(450);
      this._show(pull, rarity);
      this._phase("reveal");
      this._phase(`rarity-${rarity}`);
      this._say(LINES.reveal[rarity]);
      this._sound(FANFARE[rarity]);
      await sleep(rarity === "legendary" ? 2600 : rarity === "epic" ? 2000 : 1600);
      return pull;
    } finally {
      this._phase("out");
      await sleep(350);
      window.removeEventListener("keydown", this._escape, true);
      this.root.remove();
    }
  }

  _show(pull, rarity) {
    const r = RARITIES[rarity];
    const stars = "★".repeat(RANK.indexOf(rarity) + 1);
    const art = pull.img ? `<img src="${esc(pull.img)}" alt="">` : `<i class="fas ${esc(pull.icon)}"></i>`;
    this.root.querySelector(".ctp-gs-item").innerHTML = `${art}<small>${esc(r.name)}</small><b>${esc(pull.name)}</b><span class="ctp-gs-stars">${stars}</span>${pull.fresh ? '<em class="ctp-gs-new">NEW!</em>' : '<em class="ctp-gs-dupe">Duplicate</em>'}`;
    // Confetti, in the rarity's colour (more of it the rarer it is).
    const burst = this.root.querySelector(".ctp-gs-burst");
    const n = this.reduce ? 0 : 10 + RANK.indexOf(rarity) * 8;
    burst.innerHTML = Array.from({ length: n }, (_, i) => `<i style="--a: ${(360 / n) * i + Math.random() * 12}deg; --d: ${70 + Math.random() * 90}px; --t: ${0.6 + Math.random() * 0.6}s"></i>`).join("");
  }
}

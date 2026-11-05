import { MODULE_ID } from "../../scripts/config.js";
import { achieveConfig, achievementList, earnedData, newlyEarned, seenOf } from "./model.js";
import { feature } from "../../scripts/model/features.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { playPhoneSound } from "../../scripts/util/audio.js";
import { esc } from "../../scripts/util/text.js";
import { holdWhileUsed } from "../../scripts/ui/Toasts.js";

/*
 * Achieve!'s celebrations: when characters earn an achievement (the host's "earned" table changes),
 * their players, and the GM, get the badge across the screen with a fanfare (their phone's
 * "Achievement fanfare" sound). One award to several characters is one celebration.
 */

let seen = null;
const queue = [];
let showing = false;

/** Remember what's already earned (the first data in: nothing old is celebrated). */
export function rememberAchievements() {
  seen = seenOf(earnedData(store.apps));
}

/** The app data changed: celebrate what's new. Waits for this client's first data (the host's, or a sync). */
export function onAchievementsChanged() {
  if (!(store.isHost ? store.loaded : store.synced)) return;
  if (!seen) return rememberAchievements();
  const all = earnedData(store.apps);
  const fresh = newlyEarned(all, seen);
  seen = seenOf(all);
  if (!feature("app_achieve")) return;
  const list = achievementList(achieveConfig());
  // Awarded together (one award, several characters): one celebration.
  const awards = new Map();
  for (const { actorId, id, earned } of fresh) {
    if (earned.spent) continue; // a trade-in, not a new one
    const actor = game.actors.get(actorId);
    if (!actor) continue;
    const key = `${id}|${earned.ts}`;
    if (!awards.has(key)) awards.set(key, { id, note: earned.note, actors: [] });
    awards.get(key).actors.push(actor);
  }
  for (const { id, note, actors } of awards.values()) {
    const ach = list.find(a => a.id === id);
    if (!ach) continue;
    const mine = game.user.isGM ? null : actors.find(a => a.testUserPermission(game.user, "OWNER"));
    if (!game.user.isGM && !mine) continue;
    queue.push({ ach, who: actors.map(displayName), note, owner: mine ?? game.user });
  }
  if (!showing) next();
}

function next() {
  const item = queue.shift();
  if (!item) {
    showing = false;
    return;
  }
  showing = true;
  celebrate(item).then(next);
}

/** The badge flies in, holds, and goes (or a click sends it). */
function celebrate({ ach, who, note, owner }) {
  return new Promise(resolve => {
    playPhoneSound("fanfare", owner);
    const el = document.createElement("div");
    el.className = "ctp-achieve-pop";
    el.setAttribute("role", "alert");
    const confetti = Array.from({ length: 28 }, (_, i) => `<i style="--i:${i};--x:${Math.round(Math.random() * 100)};--d:${(0.6 + Math.random() * 0.9).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
    el.innerHTML = `
      <div class="ctp-achieve-confetti">${confetti}</div>
      <div class="ctp-achieve-pop-card">
        <img src="${esc(ach.img)}" alt="">
        <a class="ctp-achieve-pop-close" title="Close" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></a>
        <div class="ctp-achieve-pop-text">
          <small>Achievement unlocked</small>
          <b>${esc(ach.name)}</b>
          ${who.length ? `<span>${esc(who.join(", "))}</span>` : ""}
          ${note ? `<em>${esc(note)}</em>` : ""}
        </div>
      </div>`;
    document.body.append(el);
    let done = false;
    // Escape closes it too.
    const onKey = event => event.key === "Escape" && close();
    const close = () => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      el.classList.add("leaving");
      setTimeout(() => {
        el.remove();
        resolve();
      }, 450);
    };
    el.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    if (!game.settings.get(MODULE_ID, "keepPopups")) holdWhileUsed(el.querySelector(".ctp-achieve-pop-card"), 6500, close);
  });
}

/** For trying it out (Control → the fanfare, or a macro): celebrate an achievement as if just earned. */
export function previewCelebration(id = "payday") {
  const ach = achievementList().find(a => a.id === id) ?? achievementList()[0];
  if (!ach) return; // no achievements at all (no content folder, none of the GM's own)
  queue.push({ ach, who: [], note: "", owner: game.user });
  if (!showing) next();
}

Hooks.on(`${MODULE_ID}.changed`, change => {
  if (!change.apps && !change.all) return;
  try {
    onAchievementsChanged();
  } catch (err) {
    console.error(`${MODULE_ID} | Achieve!`, err);
  }
});

/*
 * Accessibility for what the templates draw. The phone's controls are links and list items with a
 * data-action (see AgentPhone.activateListeners), not <button>s, so after every draw this tells
 * screen readers what each one is:
 *  - a control that isn't a real button or link is a button (role, tab stop, Enter/Space click it)
 *  - an icon-only control is named by its tooltip; icon glyphs themselves are hidden (they're
 *    private-use characters that read out as noise)
 *  - tabs, the dock, filter chips and dimmed controls say which one is on or off
 *  - the app's name is a heading, and a setting row's words name the field or dropdown beside them
 * New markup gets all of this for free. A template can still say it better itself (a role, an
 * aria-label): nothing here overwrites what's already there.
 */

import { MODULE_ID } from "../config.js";

const REAL = "button, input, select, textarea, a[href], summary";
const ICONS = "i.fas, i.far, i.fab, i.fa, i.fa-solid, i.fa-regular, i.fa-brands";

let uid = 0;
const idFor = el => (el.id ||= `ctp-a11y-${++uid}`);
const set = (el, name, value) => {
  if (!el.hasAttribute(name)) el.setAttribute(name, value);
};
/** The words in an element, without its icons. */
const words = el => el.textContent.replace(/\s+/g, " ").trim();

/** Describe every control under `root` (an HTMLElement). Safe to run again on the same markup. */
export function describeControls(root) {
  if (!root) return;
  for (const el of root.querySelectorAll(ICONS)) set(el, "aria-hidden", "true");

  // Every <a> without a link is a control too (the contacts manager, the call widget, toasts).
  for (const el of root.querySelectorAll("[data-action], a:not([href])")) {
    if (!el.matches(REAL)) {
      set(el, "role", "button");
      set(el, "tabindex", "0");
    }
    if (!words(el) && el.title) set(el, "aria-label", el.title);
    if (el.classList.contains("disabled")) set(el, "aria-disabled", "true");
  }

  for (const list of root.querySelectorAll(".agent-tabs")) {
    set(list, "role", "tablist");
    for (const tab of list.querySelectorAll(".agent-tab")) {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(tab.classList.contains("active")));
    }
  }
  for (const el of root.querySelectorAll(".agent-dock-app, .agent-home-button")) {
    if (el.classList.contains("active")) el.setAttribute("aria-current", "page");
  }
  for (const chip of root.querySelectorAll(".agent-app-chips .agent-app-chip[data-action]")) {
    chip.setAttribute("aria-pressed", String(chip.classList.contains("active")));
  }

  for (const el of root.querySelectorAll(".agent-app-bar .agent-inbox-name")) {
    set(el, "role", "heading");
    set(el, "aria-level", "2");
  }

  // "Price per pull [ 10 ]": the row's words name its field; a second field is named by the word
  // before it too ("Pickup in [ 1 ] to [ 5 ]").
  for (const row of root.querySelectorAll(".agent-setting-row")) {
    const label = row.querySelector(":scope > span:first-child");
    const text = label && words(label);
    if (!text) continue;
    const fields = row.querySelectorAll(":scope > input, :scope > select, :scope > textarea, :scope > .agent-dropdown > .agent-dropdown-btn");
    fields.forEach((field, i) => {
      if (field.hasAttribute("aria-label") || field.labels?.length) return;
      const before = field.previousElementSibling;
      if (i && before?.matches("small")) field.setAttribute("aria-label", `${text} ${words(before)}`);
      // A dropdown's button reads its row's words, then the option it shows ("Skin, Neon Agent").
      else if (field.matches(".agent-dropdown-btn")) set(field, "aria-labelledby", `${idFor(label)} ${idFor(field)}`);
      else set(field, "aria-labelledby", idFor(label));
    });
  }
}

/**
 * Enter and Space on a role="button" (or a tab, or a dropdown's option) that isn't a real button
 * click it, like a real one. Install once
 * on a window's element (it listens for every control inside, even ones drawn later).
 */
export function clickOnEnter(root) {
  root.addEventListener("keydown", event => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || el.matches(REAL) || !["button", "option", "tab"].includes(el.getAttribute("role"))) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    el.click();
  });
}

/**
 * Tie each label in a Foundry form group to its field (`<div class="form-group"><label>Name</label>
 * <input>`), so a screen reader reads "Name" on the field and a click on the words focuses it.
 */
export function labelFormGroups(root) {
  if (!root) return;
  for (const group of root.querySelectorAll(".form-group")) {
    const label = group.querySelector(":scope > label");
    const field = group.querySelector("input:not([type=hidden]):not(.ctp-select-search), select, textarea");
    if (!label || !field || label.htmlFor || label.contains(field)) continue;
    label.htmlFor = idFor(field);
  }
}

/**
 * Less motion: the device asks for it (prefers-reduced-motion), or this player switched on "Reduce
 * motion". The CSS side is the class on <body> (styles/base.css); scripts that animate ask here.
 */
export function reduceMotion() {
  return game.settings.get(MODULE_ID, "reduceMotion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Put the "Reduce motion" setting on <body>, where the stylesheet looks for it. */
export function applyReduceMotion() {
  document.body.classList.toggle("ctp-reduce-motion", !!game.settings.get(MODULE_ID, "reduceMotion"));
}

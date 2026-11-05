import { dropdown } from "../../scripts/ui/phone/pages/dropdown.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { MODULE_ID } from "../../scripts/config.js";
import { getPhoneSettings } from "../../scripts/model/agent.js";
import { agentLabel, ALERT_KINDS, alertApp, appsOn, hasBiomonitor, PERSONALITIES, personalityOf, vitalsOf, WOUND_LABELS } from "../../scripts/model/apps.js";
import { playerCharacters } from "../../scripts/model/contacts.js";
import { actorAvatar, displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { ago, initials } from "../../scripts/util/text.js";

/*
 * Phone page: the Agent app. Players name their Agent, pick its personality and read (and answer)
 * what it's told them; with a Biomonitor it shows their vitals. On the GM Phone it's where SAAI
 * alerts are written and sent, in each character's own Agent's voice.
 * Methods, click actions (data-action), input handlers and dropdowns are installed onto AgentPhone.
 */

export const actions = {
  "alert-answer"({ alertId, choice }) {
    store.request("alert-answer", { alertId, choice });
  },
  "alert-dismiss"({ alertId }) {
    store.request("alert-dismiss", { alertId });
  },
  /** GM: pick who the alert goes to. */
  "alert-target"({ actorId }) {
    const set = new Set(this.alertTargets ?? []);
    if (actorId === "all") this.alertTargets = set.size === playerCharacters().length ? [] : playerCharacters().map(a => a.id);
    else {
      set.has(actorId) ? set.delete(actorId) : set.add(actorId);
      this.alertTargets = [...set];
    }
    this.render();
  },
  "alert-send"() {
    const root = this.element[0];
    const text = root.querySelector("textarea[name=alertText]")?.value.trim();
    const choices = root.querySelector("input[name=alertChoices]")?.value ?? "";
    if (!text || !this.alertTargets?.length) return ui.notifications.warn("Write the alert and pick who it's for.");
    store.request("alert-send", { actorIds: this.alertTargets, kind: this.alertKind ?? "advice", text, choices });
    this.alertDraft = { text: "", choices: "" };
    this.render();
  },
  "alert-save"() {
    const root = this.element[0];
    const text = root.querySelector("textarea[name=alertText]")?.value.trim();
    if (!text) return;
    const saved = [...(game.settings.get(MODULE_ID, "savedAlerts") ?? [])];
    saved.push({ kind: this.alertKind ?? "advice", text, choices: root.querySelector("input[name=alertChoices]")?.value ?? "" });
    game.settings.set(MODULE_ID, "savedAlerts", saved.slice(-30)).then(() => this.render());
  },
  "alert-load"({ index }) {
    const saved = game.settings.get(MODULE_ID, "savedAlerts")?.[Number(index)];
    if (!saved) return;
    this.alertKind = saved.kind;
    this.alertDraft = { text: saved.text, choices: saved.choices };
    this.render();
  },
  "alert-unsave"({ index }) {
    const saved = [...(game.settings.get(MODULE_ID, "savedAlerts") ?? [])];
    saved.splice(Number(index), 1);
    game.settings.set(MODULE_ID, "savedAlerts", saved).then(() => this.render());
  }
};

export const dropdowns = {
  personality(value) {
    this._saveSettings({ personality: value });
  },
  alertKind(value) {
    this.alertKind = value;
    this._keepAlertDraft();
    this.render();
  }
};

export const inputs = {
  "input[name=agentName]": {
    change(event) {
      this._saveSettings({ agentName: event.currentTarget.value.trim().slice(0, 24) });
    }
  },
  "textarea[name=personalityText]": {
    change(event) {
      this._saveSettings({ personalityText: event.currentTarget.value.trim().slice(0, 300) });
    }
  },
  "input[name=biometrics]": {
    change(event) {
      this._saveSettings({ biometrics: event.currentTarget.checked });
    }
  },
  "textarea[name=alertText], input[name=alertChoices]": {
    input() {
      this._keepAlertDraft();
    }
  }
};

export const methods = {
  /** Keep what the GM is writing across redraws. */
  _keepAlertDraft() {
    const root = this.element?.[0];
    if (!root) return;
    this.alertDraft = {
      text: root.querySelector("textarea[name=alertText]")?.value ?? "",
      choices: root.querySelector("input[name=alertChoices]")?.value ?? ""
    };
  },

  /** `apps`: the apps this phone can open, by id, so an app's alert can open it. */
  _alertRow(alert, apps, withOwner = false) {
    const actor = game.actors.get(alert.actorId);
    const app = apps.get(alertApp(alert));
    return {
      ...alert,
      icon: ALERT_KINDS[alert.kind]?.icon ?? "fa-robot",
      kindName: ALERT_KINDS[alert.kind]?.name ?? "",
      from: alert.from ?? (actor ? agentLabel(actor) : "Agent"),
      owner: withOwner && actor ? displayName(actor) : null,
      ago: ago(alert.ts),
      open: alert.choices.length && !alert.answer,
      app: app ? { id: app.id, name: app.name } : null
    };
  },

  agentAppData(ctx) {
    const alerts = Object.values(store.apps.alerts).sort((a, b) => b.ts - a.ts);
    const apps = new Map(appsOn(ctx.internal).map(a => [a.id, a]));
    if (ctx.perspective === "gm") return this._agentGmData(alerts, apps);
    const actor = ctx.subject.actor;
    const s = getPhoneSettings(actor);
    const bio = hasBiomonitor(actor);
    const v = bio ? vitalsOf(actor) : null;
    return {
      bar: appBar("agent", { owner: ctx.subject.name }),
      name: s.agentName ?? "",
      placeholder: ctx.internal ? "Internal Agent" : "Agent",
      personality: dropdown("personality", [{ value: "", label: "Factory default" }, ...Object.entries(PERSONALITIES).map(([value, p]) => ({
        value, label: p.price ? `${p.name} (${p.price})` : p.name, selected: value === s.personality
      }))], { title: "Personality", cls: "agent-wide" }),
      voice: personalityOf(actor)?.voice ?? "",
      custom: s.personality === "custom",
      personalityText: s.personalityText ?? "",
      biomonitor: bio,
      biometrics: s.biometrics !== false,
      vitals: v ? { ...v, stateLabel: v.state ? WOUND_LABELS[v.state] : "Stable" } : null,
      alerts: alerts.filter(a => a.actorId === actor.id).map(a => this._alertRow(a, apps))
    };
  },

  _agentGmData(alerts, apps) {
    const targets = new Set(this.alertTargets ?? []);
    const pcs = playerCharacters();
    const draft = this.alertDraft ?? { text: "", choices: "" };
    return {
      gm: true,
      bar: appBar("agent", { name: "SAAI alerts" }),
      characters: pcs.map(a => {
        const p = personalityOf(a);
        return {
          id: a.id, name: displayName(a), img: actorAvatar(a), initials: initials(displayName(a)), on: targets.has(a.id),
          agent: agentLabel(a), personality: p ? `${p.name}${p.voice ? `: ${p.voice}` : ""}` : "Factory default"
        };
      }),
      allOn: pcs.length && targets.size === pcs.length,
      kind: dropdown("alertKind", Object.entries(ALERT_KINDS).filter(([k]) => !["money", "trauma", "garden", "system", "raid", "job", "contact"].includes(k)).map(([value, k]) => ({
        value, label: k.name, selected: value === (this.alertKind ?? "advice")
      })), { title: "Kind" }),
      draft,
      saved: (game.settings.get(MODULE_ID, "savedAlerts") ?? []).map((a, index) => ({ ...a, index, kindName: ALERT_KINDS[a.kind]?.name })),
      alerts: alerts.slice(0, 30).map(a => this._alertRow(a, apps, true))
    };
  }
};

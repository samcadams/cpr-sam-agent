import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { DISTRICTS } from "../cabb/model.js";
import { formatMoney } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { store } from "../../scripts/store.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { hustlesIn, HUSTOOL, hustoolConfig, latestGigs, PUBLISHER, runningIn } from "./model.js";

/*
 * Phone page: HusTool (see apps/hustool/model.js). Players: only with hustles banked from a settled downtime, the big
 * PAY ME button and what's been resolved so far, by day; while on one, its card with Done and Bail. The GM Phone: each
 * character's hustles, the errand list and the setup.
 * Methods, click actions (data-action) and input handlers are installed onto AgentPhone.
 */

const OUTCOMES = { paid: "Paid", sour: "Went sour", trouble: "Paid, but…" };
const GIG_STATUS = { ...OUTCOMES, running: "On it", rolling: "Rolling…", skipped: "Skipped", expired: "Expired" };
const TROUBLE = { pending: "trouble: waiting for you", played: "trouble: played out", waved: "trouble: waved off" };

/** Change the GM's errand list (starting from the defaults the first time). */
const patchErrands = change => patchSetting(HUSTOOL, c => {
  c.errands = hustoolConfig(c).errands;
  change(c.errands);
});

/** A row's downtime days for the page. */
const gigView = row => row.days.map(day => ({
  ...day,
  rowId: row.id,
  open: day.errands.filter(e => e.status === "open").length,
  errands: day.errands.map(e => ({
    ...e,
    isOpen: e.status === "open",
    resolved: !["open", "running"].includes(e.status),
    label: GIG_STATUS[e.status] ?? "",
    payLabel: e.pay ? formatMoney(e.pay) : "",
    bad: ["sour", "skipped", "expired"].includes(e.status)
  }))
}));

export const actions = {
  "hustool-payme"() {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("hustool-payme", { actorId });
  },
  "hustool-done"({ rowId, errandId }) {
    store.request("hustool-gig", { rowId, errandId, action: "complete" });
  },
  async "hustool-bail"({ rowId, errandId }) {
    const ok = await Dialog.confirm({ title: "HusTool", content: "<p>Bail on this errand? You won't be paid for it, and the hustle is spent.</p>" });
    if (ok) store.request("hustool-gig", { rowId, errandId, action: "skip" });
  },
  "hustool-gig-day"({ rowId, day }) {
    store.request("hustool-gig-day", { rowId, day });
  },

  /* GM */
  "hustool-errand-add"() {
    patchErrands(list => list.push({ id: foundry.utils.randomID(), text: "New errand", on: true }));
  },
  "hustool-errand-remove"({ index }) {
    patchErrands(list => list.splice(Number(index), 1));
  }
};

export const inputs = {
  "[data-hustool-setting]": {
    change(event) {
      const el = event.currentTarget;
      patchSetting(HUSTOOL, c => Object.assign(c, { [el.dataset.hustoolSetting]: el.type === "checkbox" ? el.checked : el.value }));
    }
  },
  /** A field of one errand in the GM's list (data-index: its row). */
  "[data-hustool-errand]": {
    change(event) {
      const el = event.currentTarget;
      const value = el.type === "checkbox" ? el.checked : el.value;
      patchErrands(list => {
        const errand = list[Number(el.dataset.index)];
        if (errand) errand[el.dataset.hustoolErrand] = value;
      });
    }
  }
};

export const methods = {
  hustoolData(ctx) {
    const gigRows = store.apps.hustoolGigs ?? {};
    const config = hustoolConfig();
    const hq = !!game.modules.get("cpr-hq")?.active;
    if (ctx.perspective === "gm") {
      return {
        gm: true,
        bar: appBar("hustool"),
        hq,
        gigs: [...new Set(Object.values(gigRows).map(r => r.actorId))].map(id => latestGigs(gigRows, id)).map(row => {
          const days = gigView(row);
          const errands = days.flatMap(d => d.errands);
          return {
            who: displayName(game.actors.get(row.actorId)),
            open: errands.filter(e => !e.resolved).length,
            resolved: errands.filter(e => e.resolved).length,
            days,
            troubles: Object.values(row.gm?.troubleDays ?? {}).map(t => ({
              when: [t.onDay, t.time, t.district].filter(Boolean).join(" · "), text: t.text, label: TROUBLE[t.gm?.trouble] ?? ""
            }))
          };
        }),
        errands: config.errands.map((e, index) => ({ ...e, index })),
        districts: DISTRICTS.map(d => d.name),
        config,
        open: this.sectionsOpen()
      };
    }
    const row = latestGigs(gigRows, ctx.actorId);
    const running = runningIn(row);
    const hustles = hustlesIn(row).length;
    return {
      bar: appBar("hustool", { owner: ctx.subject.name }),
      online: this.online,
      pay: formatMoney(config.pay),
      publisher: PUBLISHER,
      hustles,
      running: running ? { ...running, rowId: row.id, date: row.days.find(d => d.errands.includes(running)).date } : null,
      ready: !!running || hustles > 0,
      hq,
      gigDays: running || hustles ? gigView(row) : []
    };
  }
};

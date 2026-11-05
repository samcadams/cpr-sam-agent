import { displayName } from "../../scripts/model/threads.js";
import { appBar } from "../../scripts/ui/phone/pages/home.js";
import { store } from "../../scripts/store.js";
import { etaLabel, HOME_FINDINGS, HOME_GRADE, isLive, marksOf, PUBLISHER, scanLeft, scanPercent, weakPoint } from "./model.js";

/*
 * Phone page: 4Tify (see apps/fortify/model.js). Players: the viewfinder and Scan my surroundings (or the running scan's progress
 * ring), their marks with Use mark, and the home-security screen. The GM Phone: everyone's marks, with Void.
 * Methods and click actions (data-action) are installed onto AgentPhone.
 */

const STATUS = { scanning: "Scanning", ready: "Ready", used: "Used", void: "Voided" };

/** A mark for the page. */
const markView = mark => ({
  ...mark,
  label: STATUS[mark.status] ?? "",
  ready: mark.status === "ready",
  live: isLive(mark),
  weakPoint: mark.status === "ready" ? weakPoint(mark) : "",
  eta: mark.status === "scanning" ? etaLabel(scanLeft(mark)) : ""
});

export const actions = {
  "fortify-scan"() {
    const actorId = this.context()?.actorId;
    if (actorId) store.request("fortify-scan", { actorId });
  },
  "fortify-use"({ id }) {
    store.request("fortify-use", { id });
  },
  "fortify-void"({ id }) {
    store.request("fortify-void", { id });
  }
};

export const methods = {
  fortifyData(ctx) {
    const rows = store.apps.fortifyMarks ?? {};
    if (ctx.perspective === "gm") {
      return {
        gm: true,
        bar: appBar("fortify"),
        people: [...new Set(Object.values(rows).map(m => m.actorId))].map(id => ({ who: displayName(game.actors.get(id)), marks: marksOf(rows, id).map(markView) }))
      };
    }
    const marks = marksOf(rows, ctx.actorId);
    const scanning = marks.find(m => m.status === "scanning");
    return {
      bar: appBar("fortify", { owner: ctx.subject.name }),
      publisher: PUBLISHER,
      scanning: scanning ? { ...markView(scanning), percent: scanPercent(scanning) } : null,
      marks: marks.filter(m => m !== scanning).map(markView),
      grade: HOME_GRADE,
      findings: HOME_FINDINGS
    };
  }
};

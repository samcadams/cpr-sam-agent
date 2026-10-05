import { appearance } from "../../../model/appearance.js";
import { gardenConfig } from "../../../model/garden.js";
import { agentTimestamp } from "../../../util/agentTime.js";
import { store } from "../../../store.js";

/*
 * Phone page: the home screen: every app that isn't on the dock (see model/apps.js dockSplit), with a
 * badge for what's waiting in each. The dock's "Apps" button opens it.
 * Methods are installed onto AgentPhone.
 */


/** An app page's header: back to the home screen, and the app's name and icon. */
export const appBar = (id, extra = {}) => {
  const { names, icons } = appearance();
  return { id, name: names[id], icon: icons[id], ...extra };
};

export const methods = {
  homeData(ctx) {
    const apps = this.dockSplit(ctx).home.map(app => ({ ...app, ...this.dockBadge(ctx, app.id) }));
    // Home-screen navigation: a full home screen, with the clock over the apps.
    if (this.homeNavigation(ctx)) return { apps, screen: { ...agentTimestamp(), name: ctx.subject?.name ?? null } };
    return { apps };
  },

  /** What's waiting in an app: unanswered alerts, questions for the GM, calls, an alarm. */
  appBadge(ctx, id) {
    const gm = ctx.perspective === "gm";
    const mine = list => Object.values(list).filter(x => gm || x.actorId === ctx.actorId);
    switch (id) {
      case "agent":
        return gm ? 0 : mine(store.apps.alerts).filter(a => a.choices.length && !a.answer).length;
      case "alex":
        return gm ? mine(store.apps.queries).filter(q => q.status === "crawling" || (q.status === "roll" && q.roll)).length : 0;
      case "trauma":
        return mine(store.apps.dispatches).filter(d => d.status !== "closed").length;
      case "watchbox":
        return gm ? Object.values(store.apps.watch).filter(w => w.status === "alarm").length : 0;
      case "garden":
        return gm && gardenConfig().dating ? Object.values(store.garden.dating.sparks).filter(s => s.status === "searching").length : 0;
      default:
        return 0;
    }
  }
};

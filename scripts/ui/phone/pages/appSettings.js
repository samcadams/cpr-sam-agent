import { appearance } from "../../../model/appearance.js";
import { features } from "../../../model/features.js";

/*
 * Phone page: an app's own settings on the GM Phone (the gear in its header): the world-wide switches
 * that belong to that app, where the GM uses it. Messages: photos, map pins and the GM Phone's quick
 * replies. Jobs: the Available tab.
 * Methods and click actions (data-action) are installed onto AgentPhone. The switches themselves are
 * handled with Control's (input[data-feature], input[data-permission]; pages/control.js).
 */

/** Foundry's "Upload New Files" permission, which players need to upload photos. */
export const PLAYER_ROLES = () => [CONST.USER_ROLES.PLAYER, CONST.USER_ROLES.TRUSTED];
export const playersCanUpload = () => PLAYER_ROLES().every(r => game.permissions?.FILES_UPLOAD?.includes(r));

/** Which apps have a settings page, and what's on it. */
const PAGES = {
  messages(ctx, on) {
    return {
      toggles: [
        { key: "images", label: "Photos", note: "The GM Phone can send pictures.", on: on.images },
        { key: "playerImages", label: "Players can send photos", on: on.playerImages, disabled: !on.images, sub: true,
          note: "A link to a picture, or a file already on the server (that needs Foundry's \"Use File Browser\" permission)." },
        { key: "playerUploads", permission: true, label: "Players can upload photos", on: playersCanUpload(), disabled: !on.images || !on.playerImages, sub: true,
          note: "Sets Foundry's \"Upload New Files\" permission for Players and Trusted Players. Uploads go in the world's slopphone/agent-photos folder." },
        { key: "locations", label: "Map pins", note: "Sharing map pins and positions in messages.", on: on.locations }
      ],
      hasQuickReplies: true,
      quickReplies: ctx.settings.quickReplies.join("\n")
    };
  },
  quests(ctx, on) {
    return {
      toggles: [{ key: "jobsAvailable", label: "Players see the \"Available\" tab", note: "Off: players only see In Progress, Completed and Failed.", on: on.jobsAvailable }]
    };
  }
};

export const actions = {
  /** The gear in an app's header: its settings, or back to the app. */
  "app-settings"({ app }) {
    this.appSettings = this.appSettings === app ? null : app;
    this.render();
  }
};

export const methods = {
  /** The settings page of the app on screen, if the GM opened it. */
  appSettingsData(ctx) {
    const page = ctx.perspective === "gm" && this.appSettings === this.app ? PAGES[this.app] : null;
    if (!page) return (this.appSettings = null);
    const { names, icons } = appearance();
    return { app: this.app, name: names[this.app], icon: icons[this.app === "quests" ? "jobs" : this.app], ...page(ctx, features()) };
  }
};

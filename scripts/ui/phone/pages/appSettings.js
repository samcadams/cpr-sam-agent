import { emojiCatalog } from "./settings.js";
import { appearance } from "../../../model/appearance.js";
import { features } from "../../../model/features.js";

/*
 * Phone page: an app's own settings (the gear in its header). On the GM Phone, the world-wide switches
 * that belong to that app, where the GM uses it: Messages' photos, map pins and the GM Phone's quick
 * replies; Jobs' Available tab. On a player's phone, Messages only: their quick replies and their own
 * reaction keyboard.
 * Methods and click actions (data-action) are installed onto AgentPhone. The switches themselves are
 * handled with Control's (input[data-feature], input[data-permission]; pages/control.js).
 */

/** Foundry's "Upload New Files" permission, which players need to upload photos. */
export const PLAYER_ROLES = () => [CONST.USER_ROLES.PLAYER, CONST.USER_ROLES.TRUSTED];
export const playersCanUpload = () => PLAYER_ROLES().every(r => game.permissions?.FILES_UPLOAD?.includes(r));

/** Give Players and Trusted Players that permission, or take it away (Control's switch, Configure Settings → Phone rules). */
export async function setPlayerUploads(on) {
  const permissions = foundry.utils.deepClone(game.permissions ?? {});
  const roles = new Set(permissions.FILES_UPLOAD ?? []);
  for (const role of PLAYER_ROLES()) on ? roles.add(role) : roles.delete(role);
  permissions.FILES_UPLOAD = [...roles].sort();
  await game.settings.set("core", "permissions", permissions);
}

/** Which apps have a settings page, and what's on it (`this` is the phone). */
const PAGES = {
  messages(ctx, on) {
    if (ctx.perspective === "pc") {
      const emoji = this._emojiSet(ctx);
      return {
        toggles: [],
        hasQuickReplies: true,
        quickReplies: ctx.settings.quickReplies.join("\n"),
        emoji: { text: emoji.join(" "), custom: !!ctx.settings.emoji?.length, catalog: this.emojiCatalogOpen ? emojiCatalog(emoji) : null }
      };
    }
    return {
      toggles: [
        { key: "images", label: "Photos", on: on.images },
        { key: "playerImages", label: "Players can send photos", on: on.playerImages, disabled: !on.images, sub: true,
          note: "A link to a picture, or a file already on the server (that needs Foundry's \"Use File Browser\" permission)." },
        { key: "playerUploads", permission: true, label: "Players can upload photos", on: playersCanUpload(), disabled: !on.images || !on.playerImages, sub: true,
          note: "Sets Foundry's \"Upload New Files\" permission for Players and Trusted Players. Uploads go in the world's cpr-sam-agent/agent-photos folder." },
        { key: "locations", label: "Map pins", on: on.locations }
      ],
      hasQuickReplies: true,
      quickReplies: ctx.settings.quickReplies.join("\n")
    };
  },
  quests(ctx, on) {
    return {
      toggles: [{ key: "jobsAvailable", label: "Players see the \"Available\" tab", on: on.jobsAvailable }]
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
  /** The settings page of the app on screen, if it was opened (players: Messages only). */
  appSettingsData(ctx) {
    const open = this.appSettings === this.app && (ctx.perspective === "gm" || this.app === "messages");
    const page = open ? PAGES[this.app] : null;
    if (!page) return (this.appSettings = null);
    const { names, icons } = appearance();
    return { app: this.app, name: names[this.app], icon: icons[this.app === "quests" ? "jobs" : this.app], ...page.call(this, ctx, features()) };
  }
};

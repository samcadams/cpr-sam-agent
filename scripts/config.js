import { DATA_FOLDER } from "./model/storage.js";

export const MODULE_ID = "cpr-slopagent";

const template = name => `modules/${MODULE_ID}/templates/${name}.hbs`;

export const TEMPLATES = {
  phone: template("phone"),
  contacts: template("contacts"),
  services: template("services")
};

/** The phone's pages and shared parts, registered as partials under these names ({{> agent-inbox}}). */
export const PARTIALS = {
  "agent-call": template("phone/call"),
  "agent-card": template("phone/card"),
  "agent-contacts": template("phone/contacts"),
  "agent-control": template("phone/control"),
  "agent-direct": template("phone/direct"),
  "agent-dock": template("phone/dock"),
  "agent-group": template("phone/group"),
  "agent-gm-calls": template("phone/gm-calls"),
  "agent-group-info": template("phone/group-info"),
  "agent-inbox": template("phone/inbox"),
  "agent-lock": template("phone/lock"),
  "agent-incoming": template("phone/incoming"),
  "agent-quest": template("phone/quest"),
  "agent-quests": template("phone/quests"),
  "agent-service": template("phone/service"),
  "agent-settings": template("phone/settings"),
  "agent-acting-as": template("phone/parts/acting-as"),
  "agent-avatar": template("phone/parts/avatar"),
  "agent-compose": template("phone/parts/compose"),
  "agent-dropdown": template("phone/parts/dropdown"),
  "agent-emoji-catalog": template("phone/parts/emoji-catalog"),
  "agent-gm-pickers": template("phone/parts/gm-pickers"),
  "agent-look-settings": template("phone/parts/look-settings"),
  "agent-message": template("phone/parts/message"),
  "agent-token-prompt": template("phone/parts/token-prompt"),
  "agent-app-bar": template("phone/apps/app-bar"),
  "agent-app-settings": template("phone/apps/app-settings"),
  "agent-home": template("phone/apps/home"),
  "agent-agent-app": template("phone/apps/agent"),
  "agent-bangme": template("phone/apps/bangme"),
  "agent-trauma": template("phone/apps/trauma"),
  "agent-alex": template("phone/apps/alex"),
  "agent-watchbox": template("phone/apps/watchbox"),
  "agent-garden": template("phone/apps/garden"),
  "agent-garden-post": template("phone/apps/garden-post"),
  "agent-dating-edit": template("phone/apps/dating-edit")
};

/**
 * The stylesheets, in order: the same list as module.json "styles". Foundry only reads module.json
 * when the world launches, so after an update a plain reload would miss new files; ensureStyles()
 * (main.js) adds any that aren't on the page.
 */
export const STYLES = [
  "styles/base.css",
  "styles/buttons.css",
  "styles/toasts.css",
  "styles/dialogs.css",
  "styles/managers.css",
  "styles/phone/frame.css",
  "styles/phone/inbox.css",
  "styles/phone/conversation.css",
  "styles/phone/calls.css",
  "styles/phone/apps.css",
  "styles/phone/app-pages.css",
  "styles/skins/fonts.css",
  "styles/phone/effects.css",
  "styles/skins/neon.css",
  "styles/skins/zetatech.css",
  "styles/skins/double.css",
  "styles/skins/yourplay.css",
  "styles/skins/merlyn.css",
  "styles/skins/dot.css",
  "styles/skins/field.css",
  "styles/skins/burner.css",
  "styles/skins/zine.css",
  "styles/skins/braindance.css",
  "styles/skins/hud-models.css"
];

/** Forms shown in dialogs (see ui/dialogs/forms.js). */
export const DIALOGS = {
  money: template("dialogs/money"),
  contactRequest: template("dialogs/contact-request"),
  approveRequest: template("dialogs/approve-request"),
  newThread: template("dialogs/new-thread"),
  quest: template("dialogs/quest"),
  objective: template("dialogs/objective"),
  pickMembers: template("dialogs/pick-members"),
  pickLocation: template("dialogs/pick-location"),
  pickJob: template("dialogs/pick-job"),
  attachPhoto: template("dialogs/attach-photo")
};

export const DEFAULT_CONTACT_IMG = "icons/svg/mystery-man.svg";
export const DEFAULT_SOUND = "sounds/notify.wav";
export const SOCKET = `module.${MODULE_ID}`;

/** The host's data folder in the world (see model/storage.js). */
export const dataFolder = () => `worlds/${game.world.id}/${DATA_FOLDER}`;

/** Where players' uploaded photos go. */
export const photoFolder = () => `${dataFolder()}/agent-photos`;

import { APP_IDS, APP_PARTIALS } from "./apps/manifest.js";
import { stylesFor } from "./styles.js";
import { DATA_FOLDER } from "./model/storage.js";

export const MODULE_ID = "cpr-sam-agent";

const template = name => `modules/${MODULE_ID}/templates/${name}.hbs`;

export const TEMPLATES = {
  phone: template("phone"),
  contacts: template("contacts"),
  services: template("services"),
  jobPopout: template("job-popout"),
  monitor: template("monitor")
};

/** The phone's pages and shared parts, registered as partials under these names ({{> agent-inbox}}). */
export const PARTIALS = {
  "agent-call": template("phone/call"),
  "agent-card": template("phone/card"),
  "agent-contacts": template("phone/contacts"),
  "agent-control": template("phone/control"),
  "agent-direct": template("phone/direct"),
  "agent-dock": template("phone/dock"),
  "agent-shade": template("phone/shade"),
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
  // Each app's page, as agent-app-<id>, and the other templates in its folder (apps/manifest.js).
  ...Object.fromEntries(Object.entries(APP_PARTIALS).map(([name, path]) => [name, `modules/${MODULE_ID}/${path}`]))
};

/**
 * The stylesheets, in order (scripts/styles.js): the same list as module.json "styles", which
 * `npm run apps` writes. Foundry only reads module.json
 * when the world launches, so after an update a plain reload would miss new files; ensureStyles()
 * (main.js) adds any that aren't on the page.
 */
export const STYLES = stylesFor(APP_IDS);

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
export const SOCKET = `module.${MODULE_ID}`;

/** The host's data folder in the world (see model/storage.js). */
export const dataFolder = () => `worlds/${game.world.id}/${DATA_FOLDER}`;

/** Where players' uploaded photos go. */
export const photoFolder = () => `${dataFolder()}/agent-photos`;

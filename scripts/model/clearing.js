/*
 * What the GM can clear from the apps (Control → Clear app data), everyone's or one character's.
 * key → { app, label, what (a sentence for the confirm), perCharacter: whether it can be narrowed to
 * one character }. The host does it (host/maintenance.js _onAppClear).
 */
export const CLEARABLE = {
  messages: { app: "messages", label: "Messages", what: "conversations, group chats (one character's: they leave them), service logs and number requests. Contacts, services and settings stay", perCharacter: true },
  contacts: { app: "contacts", label: "Contacts and notes", what: "contact lists and the notes and names players keep on them", perCharacter: true },
  alerts: { app: "agent", label: "Notifications", what: "every Agent notification (the Agent app's list)", perCharacter: true },
  ledger: { app: "bangme", label: "Ledger entries", what: "BangMe! ledger entries outside conversations (Bangs, pay points, Trauma Team, adjustments). Balances don't change", perCharacter: true },
  subs: { app: "trauma", label: "Coverage", what: "Trauma Team plans (paid or given), biomonitor links and offer settings", perCharacter: true },
  dispatches: { app: "trauma", label: "Calls", what: "Trauma Team calls, open and closed", perCharacter: true },
  queries: { app: "alex", label: "Searches", what: "Ask Alex Anything searches and answers", perCharacter: true },
  watch: { app: "watchbox", label: "Armed WatchBoxes", what: "armed WatchBoxes (disarmed, alarms stopped)", perCharacter: true },
  gardenPatch: { app: "garden", label: "Patches", what: "player characters' Garden Patches and everything they posted", perCharacter: true },
  gardenPosts: { app: "garden", label: "Posts", what: "Garden posts (one character's: what they posted)", perCharacter: true },
  gardenDating: { app: "garden", label: "Dating", what: "The Garden Dating: players' profiles, searches and matches", perCharacter: true },
  gardenQueue: { app: "garden", label: "Queue", what: "every queued Garden post", perCharacter: false },
  gardenCitizens: { app: "garden", label: "Random citizens", what: "every random citizen account and what they posted", perCharacter: false },
  jobsFinished: { app: "quests", label: "Finished jobs", what: "every Completed and Failed job", perCharacter: false }
};

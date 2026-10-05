import { formDialog } from "./formDialog.js";
import { DIALOGS } from "../../config.js";
import { getContacts, playerCharacters } from "../../model/contacts.js";
import { actorAvatar, contactMember, displayName, knownNpcs, pcKey } from "../../model/threads.js";

/**
 * Pick people for a group or call. Players choose from the acting PC's unblocked contacts;
 * GMs choose PCs, known NPCs, or type new NPC names.
 * @returns {Promise<{name?: string, contacts: string[], pcs: string[], npcs: string[]}|null>}
 */
export function pickMembers({ title, actor, excludeKeys = [], withName = false, label = "OK" }) {
  const exclude = new Set(excludeKeys);
  const isGM = game.user.isGM;
  const data = { isGM, withName };
  if (isGM) {
    data.pcs = playerCharacters()
      .filter(a => !exclude.has(pcKey(a.id)))
      .map(a => ({ value: a.id, name: displayName(a), img: actorAvatar(a) }));
    data.npcs = knownNpcs()
      .filter(m => !exclude.has(m.key))
      .map(m => ({ value: m.name, name: m.name, img: m.img }));
  } else {
    data.contacts = getContacts(actor)
      .filter(c => !c.blocked && !exclude.has(contactMember(c).key))
      .map(c => ({ value: c.name, name: c.name, img: c.img }));
  }

  return formDialog({
    title,
    template: DIALOGS.pickMembers,
    data,
    label,
    callback: html => {
      const checked = name => html.find(`input[name=${name}]:checked`).map((_, el) => el.value).get();
      const other = (html.find("input[name=otherNpcs]").val() ?? "").split(",").map(s => s.trim()).filter(Boolean);
      return {
        name: html.find("input[name=groupName]").val()?.trim(),
        contacts: checked("contacts"),
        pcs: checked("pcs"),
        npcs: [...checked("npcs"), ...other]
      };
    }
  });
}

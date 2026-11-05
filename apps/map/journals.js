import { esc } from "../../scripts/util/text.js";
import { patchSetting } from "../../scripts/util/settings.js";
import { mapConfig, matchJournals, pinsByDistrict } from "./model.js";

/*
 * A world that got the Map's default Night City (the content folder's map/, host.js _mapLoadDefaults) has
 * pins without journals. A GM is asked once whether the world has journal entries for these places and, if so,
 * whether to link them by name (model.js matchJournals). Nothing is linked without a yes, and linking shares nothing: players still see only the
 * district names until the GM shares pins. The answer is kept in mapConfig.seeded.journals ("ask", "no",
 * "matched", "populated"); "Ask me later" asks again on the next load.
 */

let asking = false;

/** The journals to match against, all or a folder's (with its subfolders): [{ uuid, name, kind, entry }]. */
function journalDocs(folderId) {
  const inFolder = e => !folderId || [e.folder, ...(e.folder?.ancestors ?? [])].some(f => f?.id === folderId);
  return game.journal.filter(inFolder).flatMap(e => [
    { uuid: e.uuid, name: e.name, kind: "entry" },
    ...e.pages.map(p => ({ uuid: p.uuid, name: p.name, kind: "page", entry: e.name }))
  ]);
}

/** Keep the GM's answer (one per world). */
const answered = journals => patchSetting("mapConfig", c => {
  if (c.seeded) c.seeded.journals = journals;
});

/** A folder's name with the folders it's in: "Night City / Locations". */
const folderPath = f => [...(f.ancestors ?? [])].reverse().map(a => a.name).concat(f.name).join(" / ");

/** Make an empty journal for each unlinked pin, in a folder per district under "Locations", and link the pins to them. */
async function populateJournals(store) {
  // (read now: on a GM's client that isn't the host, the pins may come in after it loads)
  const groups = pinsByDistrict(Object.values(store.apps.mapPins ?? {}));
  const master = game.folders.find(f => f.type === "JournalEntry" && f.name === "Locations" && !f.folder)
    ?? await Folder.create({ name: "Locations", type: "JournalEntry" });
  const missing = groups.filter(g => !game.folders.find(f => f.type === "JournalEntry" && f.name === g.district && f.folder?.id === master.id));
  await Folder.createDocuments(missing.map(g => ({ name: g.district, type: "JournalEntry", folder: master.id })));
  const folderOf = g => game.folders.find(f => f.type === "JournalEntry" && f.name === g.district && f.folder?.id === master.id).id;
  const pins = groups.flatMap(g => g.pins.map(pin => ({ pin, folder: folderOf(g) })));
  const entries = await JournalEntry.createDocuments(pins.map(({ pin, folder }) => ({ name: pin.name, folder, pages: [{ name: pin.name, type: "text" }] })));
  const changes = Object.fromEntries(entries.map((e, i) => [pins[i].pin.id, { page: e.pages.contents[0].uuid }]));
  if (entries.length) store.request("map-pin", { op: "set-many", changes });
  await answered("populated");
  ui.notifications.info(`Map: ${entries.length} journals made under Locations, one per pin, by district.`);
}

/** GM: ask about the default pins' journals, once (none while another GM's answer is pending here). */
export async function askJournals(store) {
  if (asking || !game.user.isGM || mapConfig().seeded?.journals !== "ask") return;
  asking = true;
  try {
    const have = await Dialog.wait({
      title: "Map: journals for its places?",
      content: `<p>The Map has its default Night City: ${mapConfig().seeded.pins} pins.</p>
        <p>Do you have journal entries for these locations?</p>
        <p>"Populate empty journal pages" makes an empty journal for each pin by district instead.</p>`,
      buttons: {
        yes: { icon: '<i class="fas fa-book"></i>', label: "Yes", callback: () => "yes" },
        no: { icon: '<i class="fas fa-xmark"></i>', label: "Disregard", callback: () => "no" },
        populate: { icon: '<i class="fas fa-file-circle-plus"></i>', label: "Populate empty journal pages", callback: () => "populate" },
        later: { icon: '<i class="fas fa-clock"></i>', label: "Ask me later", callback: () => "later" }
      },
      default: "yes",
      close: () => "later"
    }, { width: 520 });
    // (another GM may have answered meanwhile)
    if (have === "later" || mapConfig().seeded?.journals !== "ask") return;
    if (have === "no") return answered("no");
    if (have === "populate") return await populateJournals(store);

    const folders = game.folders.filter(f => f.type === "JournalEntry").map(f => ({ id: f.id, path: folderPath(f) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const guess = folders.find(f => /locations?$/i.test(f.path))?.id ?? "";
    const folder = await Dialog.wait({
      title: "Map: link the pins to their journals?",
      content: `<p>Link each pin to the journal page with its name? Districts get their entry's "District Overview".
        Pins without a clear match stay unlinked; you can link them from a pin's card.</p>
        <div class="form-group"><label>Look in</label><select name="folder">
          <option value="">All journals</option>
          ${folders.map(f => `<option value="${f.id}" ${f.id === guess ? "selected" : ""}>${esc(f.path)}</option>`).join("")}
        </select></div>`,
      buttons: {
        match: { icon: '<i class="fas fa-link"></i>', label: "Match by name", callback: html => html.find("[name=folder]").val() ?? "" },
        no: { icon: '<i class="fas fa-xmark"></i>', label: "No", callback: () => null }
      },
      default: "match",
      close: () => null
    });
    if (mapConfig().seeded?.journals !== "ask") return;
    if (folder === null) return answered("no");

    // (read now: on a GM's client that isn't the host, the pins may come in after it loads)
    const pins = Object.values(store.apps.mapPins ?? {});
    const links = matchJournals(pins, journalDocs(folder));
    const ids = Object.keys(links);
    if (ids.length) store.request("map-pin", { op: "set-many", changes: Object.fromEntries(ids.map(id => [id, { page: links[id] }])) });
    await answered("matched");
    ui.notifications.info(`Map: ${ids.length} of ${pins.length} pins linked to a journal by name. Link the rest from a pin's card.`);
  } finally {
    asking = false;
  }
}

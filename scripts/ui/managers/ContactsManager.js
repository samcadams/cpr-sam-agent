import { DEFAULT_CONTACT_IMG, TEMPLATES } from "../../config.js";
import { findContact, getContacts, getNote, noteKey, playerCharacters, setContacts } from "../../model/contacts.js";

/*
 * GM window for editing a character's contacts (drag actors in, block, rename, pictures).
 */

export class ContactsManager extends Application {
  static instance = null;

  /** Open (or retarget) the single manager window. */
  static open(actor) {
    actor ??= canvas.tokens?.controlled[0]?.actor ?? playerCharacters()[0];
    if (!actor) {
      ui.notifications.warn("No player characters found to manage contacts for.");
      return;
    }
    if (!this.instance) this.instance = new this(actor);
    else this.instance.setActor(actor);
    this.instance.render(true);
  }

  constructor(actor, options = {}) {
    super(options);
    this.setActor(actor);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ctp-contacts-manager",
      classes: ["ctp-contacts"],
      template: TEMPLATES.contacts,
      width: 380,
      height: "auto",
      resizable: true,
      dragDrop: [{ dragSelector: null, dropSelector: null }]
    });
  }

  get title() {
    return `Agent Contacts: ${this.actor.name}`;
  }

  setActor(actor) {
    this.actor = actor;
    this.contacts = getContacts(actor);
  }

  getData() {
    const characters = playerCharacters();
    if (!characters.includes(this.actor)) characters.unshift(this.actor);
    return {
      characters: characters.map(a => ({ id: a.id, name: a.name, selected: a === this.actor })),
      contacts: this.contacts.map((c, index) => ({ ...c, index, note: getNote(this.actor, noteKey(c.name)) }))
    };
  }

  async save({ rerender = true } = {}) {
    await setContacts(this.actor, this.contacts);
    if (rerender) this.render();
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".ctp-character-select").on("change", event => {
      this.setActor(game.actors.get(event.currentTarget.value));
      this.render();
    });

    html.find(".ctp-contact-name").on("change", event => {
      const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
      const name = event.currentTarget.value.trim();
      if (!name) return this.render();
      this.contacts[index].name = name;
      this.save({ rerender: false });
    });

    html.find(".ctp-contact-img").on("click", event => {
      const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
      new FilePicker({
        type: "image",
        current: this.contacts[index].img,
        callback: path => {
          this.contacts[index].img = path;
          this.save();
        }
      }).render(true);
    });

    html.find(".ctp-contact-call").on("click", event => {
      const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
      this.contacts[index].noCall = !this.contacts[index].noCall;
      this.save();
    });

    html.find(".ctp-contact-block").on("click", event => {
      const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
      this.contacts[index].blocked = !this.contacts[index].blocked;
      this.save();
    });

    html.find(".ctp-contact-delete").on("click", event => {
      const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
      this.contacts.splice(index, 1);
      this.save();
    });

    html.find(".ctp-contact-add").on("click", () => {
      this.contacts.push({ name: "New Contact", img: DEFAULT_CONTACT_IMG });
      this.save();
    });
  }

  /** Dropping an actor onto the window adds it as a contact. */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (data.type !== "Actor") return;
    const actor = await Actor.implementation.fromDropData(data);
    if (!actor) return;

    const name = actor.prototypeToken?.name || actor.name;
    if (findContact(this.contacts, name)) {
      ui.notifications.info(`${name} is already a contact.`);
      return;
    }
    this.contacts.push({ name, img: actor.img || DEFAULT_CONTACT_IMG, actorId: actor.id });
    this.save();
  }
}

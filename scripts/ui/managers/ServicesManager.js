import { DEFAULT_CONTACT_IMG, MODULE_ID, TEMPLATES } from "../../config.js";
import { playerCharacters } from "../../model/contacts.js";
import { getServices } from "../../model/services.js";
import { describeControls } from "../a11y.js";

/*
 * GM window for the service contacts (request buttons, phone lines, texting, who can use them).
 */

export class ServicesManager extends Application {
  static instance = null;

  static open() {
    (this.instance ??= new this()).render(true);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ctp-services-manager",
      classes: ["ctp-services"],
      template: TEMPLATES.services,
      title: "Agent Services",
      width: 460,
      height: "auto",
      resizable: true
    });
  }

  getData() {
    const pcs = playerCharacters();
    return {
      services: getServices().map((s, index) => ({
        ...s,
        index,
        actionText: s.actions.map(a => a.label).join(", "),
        everyone: s.access === "all",
        characters: pcs.map(a => ({
          id: a.id,
          name: a.name,
          checked: Array.isArray(s.access) && s.access.includes(a.id)
        }))
      }))
    };
  }

  async save(services, rerender = true) {
    await game.settings.set(MODULE_ID, "services", services);
    if (rerender) this.render();
  }

  activateListeners(html) {
    super.activateListeners(html);
    describeControls(html[0]);
    const indexOf = el => Number(el.closest("[data-index]").dataset.index);
    const edit = (el, fn, rerender = false) => {
      const services = getServices();
      fn(services[indexOf(el)]);
      this.save(services, rerender);
    };

    html.find(".ctp-service-add").on("click", () => {
      const services = getServices();
      services.push({
        id: foundry.utils.randomID(),
        name: "New Service",
        img: DEFAULT_CONTACT_IMG,
        actions: [{ id: foundry.utils.randomID(), label: "Request Assistance" }],
        callLabel: "Call",
        access: "all"
      });
      this.save(services);
    });

    html.find(".ctp-service-delete").on("click", event => {
      const services = getServices();
      services.splice(indexOf(event.currentTarget), 1);
      this.save(services);
    });

    html.find(".ctp-service-name").on("change", event => {
      const name = event.currentTarget.value.trim();
      if (name) edit(event.currentTarget, s => (s.name = name));
    });

    // Actions are edited as a comma list; existing labels keep their ids.
    html.find(".ctp-service-actions").on("change", event => {
      edit(event.currentTarget, s => {
        const labels = event.currentTarget.value.split(",").map(l => l.trim()).filter(Boolean);
        s.actions = labels.map(label => s.actions.find(a => a.label === label) ?? { id: foundry.utils.randomID(), label });
      });
    });

    html.find(".ctp-service-chat").on("change", event => {
      edit(event.currentTarget, s => (s.chat = event.currentTarget.checked));
    });

    html.find(".ctp-service-call").on("change", event => {
      edit(event.currentTarget, s => (s.callLabel = event.currentTarget.value.trim()));
    });

    html.find(".ctp-service-img").on("click", event => {
      const el = event.currentTarget;
      new FilePicker({
        type: "image",
        current: el.getAttribute("src"),
        callback: path => edit(el, s => (s.img = path), true)
      }).render(true);
    });

    html.find(".ctp-service-everyone").on("change", event => {
      edit(event.currentTarget, s => (s.access = event.currentTarget.checked ? "all" : []), true);
    });

    html.find(".ctp-service-character").on("change", event => {
      const el = event.currentTarget;
      edit(el, s => {
        const ids = new Set(Array.isArray(s.access) ? s.access : []);
        if (el.checked) ids.add(el.value);
        else ids.delete(el.value);
        s.access = [...ids];
      });
    });
  }
}

/*
 * Just enough of Foundry's globals to run the module's pure logic under Node.
 * Import this before anything from scripts/.
 */

import { GARDEN_FILE, joinGarden, joinMessages, MESSAGES_FILE } from "../scripts/model/storage.js";

class Collection extends Map {
  filter(fn) {
    return [...this.values()].filter(fn);
  }
  find(fn) {
    return [...this.values()].find(fn);
  }
  some(fn) {
    return [...this.values()].some(fn);
  }
  map(fn) {
    return [...this.values()].map(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

const DEFAULT_SETTINGS = {
  unknownLabel: "Unknown Number",
  agentNames: "Agent",
  internalAgentNames: "Internal Agent",
  services: [],
  sound: "tone.wav",
  ringtone: "ring.wav",
  textToneAtToken: true,
  ringAtToken: true,
  ringRadius: 10,
  hudOpacity: 0.8,
  fontScale: 1,
  biomonitorNames: "Biomonitor",
  payPoints: [],
  trauma: {}
};
const settings = new Map();

/** Everything sent over the module socket: [{ payload, recipients }] (recipients undefined = broadcast). */
export const sent = [];
/** Every Hooks.callAll: [{ hook, args }]. */
export const hooks = [];
/** The server's files: path → text. Folders: paths. */
export const files = new Map();
export const folders = new Set();
const DATA = "worlds/test-world/cpr-sam-agent";
const readFile = path => (files.has(`${DATA}/${path}`) ? JSON.parse(files.get(`${DATA}/${path}`)) : null);
/** What the host has saved, read back from its files: messages (data) and the Garden (garden). */
function readSaved(indexFile, join) {
  const index = readFile(indexFile);
  if (!index) return null;
  return join(index, Object.fromEntries((index.files ?? []).map(path => [path, readFile(path)])));
}
export const saved = {
  get data() { return readSaved(MESSAGES_FILE, joinMessages); },
  get garden() { return readSaved(GARDEN_FILE, joinGarden); }
};

globalThis.game = {
  world: { id: "test-world" },
  modules: new Map(),
  scenes: Object.assign(new Collection(), { active: null }),
  time: { worldTime: 0 },
  users: new Collection(),
  actors: new Collection(),
  permissions: { FILES_UPLOAD: [3, 4], FILES_BROWSE: [2, 3, 4] },
  user: null,
  settings: {
    get: (scope, key) => settings.get(key),
    set: async (scope, key, value) => settings.set(key, value)
  },
  socket: {
    listeners: [],
    on(event, fn) {
      this.listeners.push(fn);
    },
    emit(event, payload, options) {
      sent.push({ payload: structuredClone(payload), recipients: options?.recipients });
    }
  }
};

globalThis.CONST = { USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 } };

globalThis.Hooks = {
  callAll: (hook, ...args) => hooks.push({ hook, args }),
  on() {},
  once() {}
};

globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

globalThis.fetch = async url => {
  const path = decodeURIComponent(url.replace(/^\//, "").replace(/\?.*$/, ""));
  if (!files.has(path)) return { ok: false, status: 404 };
  const text = files.get(path);
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

/** Uploads land in `files`; like Foundry, only into a folder that exists. */
globalThis.FilePicker = {
  async upload(source, dir, file) {
    if (!folders.has(dir)) return false;
    files.set(`${dir}/${file.name}`, await file.text());
    return { status: "success", path: `${dir}/${file.name}` };
  },
  async browse(source, dir) {
    if (!folders.has(dir)) throw new Error(`No folder ${dir}`);
    const inside = path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/");
    return { dirs: [...folders].filter(inside), files: [...files.keys()].filter(inside) };
  },
  async createDirectory(source, dir) {
    if (folders.has(dir)) throw new Error(`${dir} exists`);
    folders.add(dir);
  }
};

globalThis.foundry = {
  utils: {
    hasProperty: (obj, path) => path.split(".").reduce((o, k) => (o != null && k in Object(o) ? o[k] : undefined), obj) !== undefined,
    deepClone: value => structuredClone(value),
    setProperty: (obj, path, value) => {
      const keys = path.split(".");
      const last = keys.pop();
      keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
    },
    randomID: () => Math.random().toString(36).slice(2, 18),
    getRoute: path => `/${path}`,
    mergeObject: (a, b) => ({ ...a, ...b }),
    debounce: fn => fn // run at once: tests read the saved file straight after
  }
};

globalThis.Handlebars = {
  escapeExpression: s => String(s ?? "").replace(/[&<>"'`=]/g, c => `&#${c.charCodeAt(0)};`)
};

// Classes the UI modules extend at import time.
globalThis.Application = class {
  static get defaultOptions() {
    return {};
  }
  render() {}
};
globalThis.canvas = { tokens: { controlled: [] } };

export function addUser({ id, isGM = false, active = true }) {
  const flags = {};
  const user = {
    id, isGM, active, name: id, documentName: "User",
    getFlag: (scope, key) => flags[key],
    async setFlag(scope, key, value) {
      flags[key] = structuredClone(value);
    }
  };
  game.users.set(id, user);
  return user;
}

/** Make `user` this client, and the active GM (the host) `host`. */
export function actAs(user, host = user) {
  game.user = user;
  game.users.activeGM = host;
}

/**
 * @param {object} options
 * @param {string[]} [options.owners]  user ids with OWNER permission
 * @param {string[]} [options.items]   names of carried gear; "Internal Agent" is installed cyberware
 */
export function addActor({ id, name = id, type = "character", owners = [], items = ["Agent"], wealth, flags = {}, system = {} }) {
  const actor = {
    id,
    name,
    img: `${id}.png`,
    type,
    documentName: "Actor",
    prototypeToken: { name, texture: { src: `${id}-token.png` } },
    hasPlayerOwner: owners.some(u => !game.users.get(u)?.isGM),
    items: items.map(n =>
      typeof n === "object" ? n
        : n === "Internal Agent" || n === "Biomonitor"
          ? { name: n, type: "cyberware", system: { isInstalled: true } }
          : { name: n, type: "gear", system: { equipped: "carried" } }
    ),
    system: { ...structuredClone(system), ...(wealth === undefined ? {} : { wealth: { value: wealth } }) },
    testUserPermission: (user, level) => owners.includes(user.id),
    getFlag: (scope, key) => flags[key],
    async setFlag(scope, key, value) {
      flags[key] = structuredClone(value);
    },
    getActiveTokens: () => [],
    uuid: `Actor.${id}`,
    effects: new Collection(),
    async createEmbeddedDocuments(type, docs) {
      return docs.map(d => {
        const doc = { ...structuredClone(d), id: Math.random().toString(36).slice(2, 10) };
        if (type === "ActiveEffect") this.effects.set(doc.id, doc);
        return doc;
      });
    },
    async deleteEmbeddedDocuments(type, ids) {
      if (type === "ActiveEffect") for (const eid of ids) this.effects.delete(eid);
    },
    async update(changes) {
      // Let other queued work run first, like a real database round trip.
      await new Promise(resolve => setTimeout(resolve, 5));
      if ("system.wealth.value" in changes) this.system.wealth.value = changes["system.wealth.value"];
      if ("system.reputation.value" in changes) this.system.reputation.value = changes["system.reputation.value"];
    }
  };
  game.actors.set(id, actor);
  return actor;
}

export function reset() {
  game.users.clear();
  game.actors.clear();
  settings.clear();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) settings.set(key, structuredClone(value));
  sent.length = 0;
  hooks.length = 0;
  files.clear();
  folders.clear();
  folders.add("worlds/test-world");
  game.scenes.clear();
  game.scenes.active = null;
  game.journal = [];
  game.time.worldTime = 0;
}

reset();

/**
 * A scene with tokens: { id, name, grid: { size: 100, distance: 2 } (2 m squares), tokens, templates }.
 * @param {Array<{id, actorId, name, x, y}>} tokens  positions in pixels (top-left)
 */
export function addScene({ id = "s1", name = "Scene", tokens = [], active = true } = {}) {
  const scene = {
    id, name, grid: { size: 100, distance: 2 },
    tokens: new Collection(), templates: new Collection(),
    async createEmbeddedDocuments(type, docs) {
      return docs.map(d => {
        const doc = { ...d, id: Math.random().toString(36).slice(2, 10) };
        this.templates.set(doc.id, doc);
        return doc;
      });
    },
    async deleteEmbeddedDocuments(type, ids) {
      for (const tid of ids) this.templates.delete(tid);
    }
  };
  for (const t of tokens) scene.tokens.set(t.id, { width: 1, height: 1, ...t, parent: scene });
  game.scenes.set(id, scene);
  if (active) game.scenes.active = scene;
  return scene;
}

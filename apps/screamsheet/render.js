/*
 * DataPool: the screamsheet itself. Pure: a sheet's data in, an HTML string out (no Foundry code), so the
 * phone, the reader window, the GM's editor and the Node tests all draw it the same way.
 * Ported from the tested prototype.
 *
 * Sheet: { outlet, background, masthead: { clock, desk, ticker, columns: 1|2|3, credit,
 *   paper: "clean"|"gloss"|"newsprint"|"grimy"|"screen", brand: { name, tagline, accent, headerBg, headerText,
 *   logo, desks: [..], showNav, style: a STYLES key } }, blocks: [{ id, type, ...fields }] }
 * The masthead isn't a block: it's always drawn and can't be moved or removed.
 * "Looks real": each outlet has its own masthead and paper, drawn in CSS and SVG (no
 * art needed); the GM's `background` image lies over the paper with the text on top.
 */

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Only plain image paths and URLs (Foundry's FilePicker paths, http(s), data:image); never javascript:. */
export const safeSrc = s => {
  s = String(s ?? "").trim();
  return /^(https?:|data:image\/|\/|[\w.-]+\/)/i.test(s) && !/^javascript:/i.test(s) && !/["'()\\<>]/.test(s) ? s : "";
};

const hex = s => (/^#[\da-f]{6}$/i.test(String(s ?? "").trim()) ? String(s).trim() : null);

/** Blank-line paragraphs; a single newline is a line break. */
const paras = (s, cls) => String(s ?? "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  .map(p => `<p class="${cls}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

const uid = () => Math.random().toString(36).slice(2, 10);

/*
 * Outlets (no extra outlets, except Flick's own blog, "flickin"). Mastheads are text wordmarks, no logos.
 * layout "desks": wordmark and slanted desk tabs (a news site's front page)
 * layout "tabloid": a black banner, typewriter title and an eye (a street sheet pasted to a kiosk)
 * layout "board": a Data Pool board, a forum thread (posts with handles)
 */
export const OUTLETS = {
  n54: {
    label: "Network 54", layout: "desks", name: "N54 NEWS", tagline: "NIGHT CITY'S NETWORK", accent: "#c0392b", headerBg: "#ffffff", headerText: "#111111", paper: "gloss",
    desks: ["Front", "Local", "Corp", "Tech", "Gossip", "Opinion", "Weather", "World"], voice: "slick corporate gloss", style: "site"
  },
  wns: {
    label: "World News Service", layout: "desks", name: "WNS", tagline: "WIRE // VERIFIED", accent: "#1f5fbf", headerBg: "#f2f2ee", headerText: "#111111", paper: "newsprint",
    desks: ["Wire", "Business", "Politics", "World", "Science"], voice: "flat wire copy", style: "wire"
  },
  street: { label: "Street sheet", layout: "tabloid", name: "The Gutter Eye", tagline: "ALL IS SEEN", accent: "#ff2e88", headerBg: "#000000", headerText: "#ffffff", paper: "grimy", desks: [], voice: "lurid tabloid", style: "site" },
  board: { label: "Data Pool board", layout: "board", name: "NC//UNDERPOOL", tagline: "", accent: "#39ff88", headerBg: "#0b0f0d", headerText: "#c8f7d8", paper: "screen", desks: ["Pool", "Rumours", "Street"], voice: "rumour and typos", style: "site" },
  blotter: {
    label: "NCPD blotter", layout: "desks", name: "NCPD PUBLIC BLOTTER", tagline: "TO SERVE AND PROTECT", accent: "#1d3f8f", headerBg: "#e9edf5", headerText: "#0d1b3d", paper: "clean",
    desks: ["Arrests", "Warrants", "Bounties", "Incidents"], voice: "dry police report", style: "bulletin"
  },
  flickin: {
    label: "What's Flickin In NC? (Flick's blog)", layout: "desks", name: "WHAT'S FLICKIN IN NC?", tagline: "thoughtful pieces, from a thoughtful guy", accent: "#c2410c", headerBg: "#fdf6ec", headerText: "#2a2320", paper: "clean",
    desks: ["Exposés", "Night City", "Street Notes", "Streams"], voice: "a street kid's earnest blog", style: "blog"
  },
  custom: { label: "Custom", layout: "desks", name: "YOUR OUTLET", tagline: "TAGLINE", accent: "#00e0ff", headerBg: "#0a0a12", headerText: "#ffffff", paper: "clean", desks: ["News", "Data", "Street", "Corp"], voice: "", style: "site" }
};

export const PAPERS = { clean: "Clean", gloss: "Gloss", newsprint: "Newsprint", grimy: "Grimy", screen: "Screen (board)" };

/*
 * Masthead styles for the "desks" layout (every outlet looked the same). Each draws the wordmark,
 * desk tabs, status line and ticker its own way (screamsheet.css .ss-style-*); `ticker` labels the ticker line.
 * The tabloid and board layouts have their own mastheads and ignore it.
 */
export const STYLES = {
  site: { label: "News site (slanted tabs)", ticker: "" },
  broadsheet: { label: "Broadsheet (serif, edition line)", ticker: "Latest" },
  wire: { label: "Wire (mono, bracketed desks)", ticker: "Flash" },
  bulletin: { label: "Bulletin (official, underlined tabs)", ticker: "Advisory" },
  blog: { label: "Blog (rounded, pill buttons)", ticker: "Pinned" }
};

/*
 * Blocks. `fields` is the editor's form (kind: text | textarea | select | image | color | side);
 * `span`: always across every body column.
 */
export const BLOCK_TYPES = {
  headline: {
    label: "Headline", icon: "fa-heading",
    fields: [{ key: "text", kind: "text", label: "Headline" }, { key: "size", kind: "select", label: "Size", options: { lead: "Lead (large)", section: "Section" } }],
    defaults: { text: "NEW HEADLINE", size: "lead" }
  },
  byline: {
    label: "Byline", icon: "fa-pen-nib",
    fields: [{ key: "author", kind: "text", label: "Author" }, { key: "dateline", kind: "text", label: "Dateline" }],
    defaults: { author: "By Staff", dateline: "Night City" }
  },
  paragraph: { label: "Paragraph", icon: "fa-paragraph", fields: [{ key: "text", kind: "textarea", label: "Text" }], defaults: { text: "Body copy. A blank line starts a new paragraph." } },
  image: {
    label: "Image", icon: "fa-image",
    fields: [
      { key: "src", kind: "image", label: "Image" }, { key: "caption", kind: "text", label: "Caption" },
      { key: "place", kind: "select", label: "Placement", options: { inline: "Inline", top: "Above everything (full width)", right: "Float right (~40%)", left: "Float left (~40%)" } }
    ],
    defaults: { src: "", caption: "", place: "inline" }
  },
  quote: {
    label: "Pull quote", icon: "fa-quote-left",
    fields: [{ key: "text", kind: "textarea", label: "Quote" }, { key: "attr", kind: "text", label: "Attribution" }],
    defaults: { text: "Quote goes here.", attr: "— Source" }
  },
  ad: {
    label: "Ad", icon: "fa-rectangle-ad", span: true,
    fields: [
      { key: "copy", kind: "text", label: "Ad copy" }, { key: "sponsor", kind: "text", label: "Sponsor" },
      { key: "bg", kind: "color", label: "Background" }, { key: "fg", kind: "color", label: "Text" }, { key: "src", kind: "image", label: "Ad image (optional)" }
    ],
    defaults: { copy: "RIPPERDOC SPECIAL: 20% OFF CHROME", sponsor: "Paid for by a clinic in Watson", bg: "#ffffff", fg: "#000000", src: "" }
  },
  sidebar: {
    label: "Sidebar", icon: "fa-table-columns",
    fields: [{ key: "head", kind: "text", label: "Heading" }, { key: "text", kind: "textarea", label: "Text" }],
    defaults: { head: "SIDEBAR", text: "Supporting details and context." }
  },
  brief: {
    label: "Brief", icon: "fa-bolt",
    fields: [{ key: "head", kind: "text", label: "Heading" }, { key: "text", kind: "textarea", label: "Text" }],
    defaults: { head: "MARKET WATCH", text: "One or two lines." }
  },
  divider: { label: "Divider", icon: "fa-minus", fields: [], defaults: {} },
  columns: {
    label: "Two columns", icon: "fa-pause", span: true,
    fields: [{ key: "left", kind: "side", label: "Left column" }, { key: "right", kind: "side", label: "Right column" }],
    defaults: { left: { kind: "text", text: "Left column text.", src: "" }, right: { kind: "text", text: "Right column text.", src: "" } }
  }
};

export const newBlock = (type, fields = {}) => ({ id: uid(), type, ...structuredClone(BLOCK_TYPES[type].defaults), ...fields });

/** A brand for an outlet: its preset's name, colours and desks. */
export function brandOf(outlet) {
  const o = OUTLETS[outlet] ?? OUTLETS.custom;
  return { name: o.name, tagline: o.tagline, accent: o.accent, headerBg: o.headerBg, headerText: o.headerText, logo: "", desks: [...o.desks], showNav: o.desks.length > 0, style: o.style };
}

/** A new sheet for an outlet, with a headline, a byline and a paragraph (or the blocks given). */
export function newSheet(outlet = "n54", blocks = null) {
  const o = OUTLETS[outlet] ?? OUTLETS.custom;
  outlet = OUTLETS[outlet] ? outlet : "custom";
  return {
    outlet,
    background: "",
    masthead: { clock: "", desk: o.desks[0] ?? "", ticker: "", columns: 1, credit: false, paper: o.paper, brand: brandOf(outlet) },
    blocks: blocks ?? ["headline", "byline", "paragraph"].map(t => newBlock(t))
  };
}

/** Switch a sheet to another outlet: its masthead changes, its blocks and clock/ticker/columns stay. */
export function switchOutlet(sheet, outlet) {
  const fresh = newSheet(outlet, sheet.blocks);
  fresh.background = sheet.background ?? "";
  Object.assign(fresh.masthead, { clock: sheet.masthead?.clock ?? "", ticker: sheet.masthead?.ticker ?? "", columns: sheet.masthead?.columns ?? 1 });
  return fresh;
}

/* WCAG contrast: readable text on the accent-coloured active tab. */
function lum(color) {
  const m = /^#?([\da-f]{6})$/i.exec(String(color).trim());
  if (!m) return 0;
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const inkOn = bg => (contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111");

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

const BLOCK = {
  headline: b => (b.size === "section" ? `<h2 class="ss-h2">${esc(b.text)}</h2>` : `<h1 class="ss-h1">${esc(b.text)}</h1>`),
  byline: b => `<div class="ss-byline">${[b.author, b.dateline].filter(Boolean).map(esc).join('<span class="ss-sep">|</span>')}</div>`,
  paragraph: b => paras(b.text, "ss-para"),
  image: (b, ctx) => {
    const src = safeSrc(b.src);
    if (!src && !ctx.editing) return "";
    const pic = src ? `<img src="${esc(src)}" alt="${esc(b.caption || "Photo")}">` : `<div class="ss-noimg">[ NO IMAGE ]</div>`;
    const place = ["inline", "top", "right", "left"].includes(b.place) ? b.place : "inline";
    return `<figure class="ss-figure ss-place-${place}">${pic}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
  },
  quote: b => (!String(b.text ?? "").trim() ? "" : `<blockquote class="ss-quote"><p>“${esc(b.text)}”</p>${b.attr ? `<cite>${esc(b.attr)}</cite>` : ""}</blockquote>`),
  ad: b => {
    const src = safeSrc(b.src);
    return `<div class="ss-ad" style="--ad-bg:${hex(b.bg) ?? "#ffffff"};--ad-fg:${hex(b.fg) ?? "#000000"}">${src ? `<img src="${esc(src)}" alt="">` : ""}`
      + `<div class="ss-ad-copy">${esc(b.copy)}</div>${b.sponsor ? `<div class="ss-ad-sponsor">${esc(b.sponsor)}</div>` : ""}</div>`;
  },
  sidebar: b => `<aside class="ss-sidebar"><div class="ss-sb-head">${esc(b.head)}</div>${paras(b.text, "ss-sb-text")}</aside>`,
  brief: b => `<div class="ss-brief"><div class="ss-brief-head">${esc(b.head)}</div>${paras(b.text, "ss-brief-text")}</div>`,
  divider: () => `<hr class="ss-divider">`,
  columns: (b, ctx) => `<div class="ss-cols">${[b.left, b.right].map(s => side(s, ctx)).join("")}</div>`
};

function side(s = {}, ctx) {
  const src = safeSrc(s?.src);
  if (s?.kind === "image") return `<div class="ss-col">${src ? `<img src="${esc(src)}" alt="">` : ctx.editing ? `<div class="ss-noimg">[ NO IMAGE ]</div>` : ""}</div>`;
  return `<div class="ss-col">${paras(s?.text, "ss-para")}</div>`;
}

// The eye from The Augmented Optic (the screamsheet builder's street sheet), drawn in the header's ink: screamsheet.css .ss-eye.
const EYE = `<span class="ss-eye" aria-hidden="true"></span>`;

function masthead(sheet, clock) {
  const m = sheet.masthead;
  const br = m.brand;
  const layout = (OUTLETS[sheet.outlet] ?? OUTLETS.custom).layout;
  const status = `<div class="ss-status"><span aria-hidden="true">◉</span><span class="ss-clock">${esc(m.clock || clock)}</span><span aria-hidden="true">⌁</span></div>`;
  const logoSrc = safeSrc(br.logo);
  const logo = logoSrc ? `<img class="ss-logo-img" src="${esc(logoSrc)}" alt="${esc(br.name)}">`
    : `<div class="ss-wordmark"><span class="ss-name">${esc(br.name)}</span><span class="ss-tagline">${esc(br.tagline)}</span></div>`;
  const style = layout === "desks" ? styleOf(br) : "site";
  const label = STYLES[style].ticker;
  const ticker = m.ticker ? `<div class="ss-ticker" role="marquee">${label ? `<b class="ss-ticker-label">${label}</b>` : ""}<span>${label ? "" : "▸ "}${esc(m.ticker)}</span></div>` : "";
  if (layout === "tabloid") return `${status}<header class="ss-mast ss-mast-tabloid">${EYE}${logo}</header>${ticker}`;
  if (layout === "board") {
    // A forum thread: the board's name, and its breadcrumb (the desks) to the open section.
    const crumbs = br.showNav ? `<nav class="ss-crumbs">${(br.desks ?? []).map(d => `<span class="ss-crumb${String(d).toLowerCase() === String(m.desk).toLowerCase() ? " is-active" : ""}">${esc(d)}</span>`).join("<span aria-hidden=\"true\">›</span>")}</nav>` : "";
    return `<header class="ss-mast ss-mast-board"><div class="ss-logo">${logo}</div>${crumbs}</header>${ticker}`;
  }
  const desks = br.showNav ? `<nav class="ss-desks">${(br.desks ?? []).map(d => `<span class="ss-desk${String(d).toLowerCase() === String(m.desk).toLowerCase() ? " is-active" : ""}">${esc(d)}</span>`).join("")}</nav>` : "";
  const header = `<header class="ss-mast ss-mast-desks"><div class="ss-logo">${logo}</div>${desks}</header>`;
  // A broadsheet prints its date as an edition line under the nameplate.
  return style === "broadsheet" ? `${header}${status}${ticker}` : `${status}${header}${ticker}`;
}

const styleOf = br => (br?.style in STYLES ? br.style : "site");

/**
 * The sheet as HTML. `editing`: the GM's preview (empty images show a placeholder; players never see them).
 * `clock`: shown in the status bar when the sheet sets none (the time it went out).
 */
export function renderSheet(sheet, { editing = false, clock = "" } = {}) {
  const ctx = { editing };
  const m = sheet.masthead;
  const br = m.brand;
  const layout = (OUTLETS[sheet.outlet] ?? OUTLETS.custom).layout;
  const cols = Math.min(3, Math.max(1, Number(m.columns) || 1));
  const headBg = hex(br.headerBg) ?? "#ffffff";
  const accent = hex(br.accent) ?? "#c0392b";
  // Idle desk tabs: black on a light header, a lifted grey on a dark one (black on black vanished in testing).
  const tabBg = inkOn(headBg) === "#ffffff" ? "#3a404d" : "#111111";
  const bg = safeSrc(sheet.background);
  const vars = [`--ss-accent:${accent}`, `--ss-accent-ink:${inkOn(accent)}`, `--ss-head-bg:${headBg}`, `--ss-head-ink:${hex(br.headerText) ?? inkOn(headBg)}`, `--ss-tab-bg:${tabBg}`,
    `--ss-cols:${cols}`, bg ? `--ss-bg-img:url('${bg}')` : ""].filter(Boolean).join(";");
  const blocks = (sheet.blocks ?? []).filter(b => BLOCK[b?.type]);
  // "Above everything" images leave the column flow.
  const top = blocks.filter(b => b.type === "image" && b.place === "top").map(b => BLOCK.image(b, ctx)).join("");
  const body = blocks.filter(b => !(b.type === "image" && b.place === "top")).map(b => {
    const html = BLOCK[b.type](b, ctx);
    if (!html) return "";
    return `<div class="ss-block ss-b-${b.type}${BLOCK_TYPES[b.type].span ? " ss-span" : ""}" data-block-id="${esc(b.id)}">${html}</div>`;
  }).join("");
  const paper = m.paper in PAPERS ? m.paper : "clean";
  const style = layout === "desks" ? ` ss-style-${styleOf(br)}` : "";
  return `<article lang="en" class="ss-sheet ss-layout-${layout}${style} ss-cols-${cols} ss-paper-${paper}" data-outlet="${esc(sheet.outlet)}" style="${esc(vars)}">`
    + `${masthead(sheet, clock)}${top ? `<div class="ss-top">${top}</div>` : ""}<div class="ss-body">${body}</div>`
    + `${m.credit ? `<footer class="ss-credit">Fictional · ${esc(br.name)}</footer>` : ""}</article>`;
}

/** A sheet's list row: outlet, desk, headline, byline, a snippet. */
export function summary(sheet) {
  const first = t => (sheet?.blocks ?? []).find(b => b?.type === t);
  return {
    outlet: sheet?.masthead?.brand?.name ?? "",
    desk: sheet?.masthead?.desk ?? "",
    headline: first("headline")?.text || "(no headline)",
    byline: first("byline")?.author ?? "",
    snippet: teaser(first("paragraph")?.text ?? first("brief")?.text)
  };
}

/** The start of the story, cut on a word with "…", short enough that the row asks to be opened. */
export function teaser(text, max = 80) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "") || t.slice(0, max);
  return `${cut.replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** Every word a reader can see on a sheet (what a crawl searches). */
export function sheetText(sheet) {
  const parts = [sheet?.masthead?.brand?.name, sheet?.masthead?.ticker];
  for (const b of sheet?.blocks ?? []) {
    for (const f of BLOCK_TYPES[b?.type]?.fields ?? []) {
      if (f.kind === "side") parts.push(b[f.key]?.kind === "text" ? b[f.key]?.text : "");
      else if (f.kind === "text" || f.kind === "textarea") parts.push(b[f.key]);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/* -------------------------------------------- */
/*  Cleaning what the GM sends the host         */
/* -------------------------------------------- */

const str = (v, max) => String(v ?? "").replace(/\r/g, "").slice(0, max);

function cleanBlock(b) {
  const t = BLOCK_TYPES[b?.type];
  if (!t) return null;
  const out = { id: str(b.id, 16).replace(/[^\w-]/g, "") || uid(), type: b.type };
  for (const f of t.fields) {
    const v = b[f.key];
    if (f.kind === "side") out[f.key] = { kind: v?.kind === "image" ? "image" : "text", text: str(v?.text, 4000), src: safeSrc(v?.src) };
    else if (f.kind === "select") out[f.key] = v in f.options ? v : Object.keys(f.options)[0];
    else if (f.kind === "color") out[f.key] = hex(v) ?? t.defaults[f.key];
    else if (f.kind === "image") out[f.key] = safeSrc(v);
    else out[f.key] = str(v, f.kind === "textarea" ? 8000 : 300);
  }
  return out;
}

/** A sheet as the host keeps it: only known blocks and fields, strings capped, images checked. */
export function cleanSheet(raw) {
  const outlet = OUTLETS[raw?.outlet] ? raw.outlet : "custom";
  const base = newSheet(outlet, []);
  const m = raw?.masthead ?? {};
  const br = m.brand ?? {};
  const desks = (Array.isArray(br.desks) ? br.desks : base.masthead.brand.desks).map(d => str(d, 30).trim()).filter(Boolean).slice(0, 12);
  return {
    outlet,
    background: safeSrc(raw?.background),
    masthead: {
      clock: str(m.clock, 40), desk: str(m.desk, 30), ticker: str(m.ticker, 300),
      columns: Math.min(3, Math.max(1, Math.floor(Number(m.columns) || 1))), credit: !!m.credit,
      paper: m.paper in PAPERS ? m.paper : base.masthead.paper,
      brand: {
        name: str(br.name, 60) || base.masthead.brand.name, tagline: str(br.tagline, 80),
        accent: hex(br.accent) ?? base.masthead.brand.accent, headerBg: hex(br.headerBg) ?? base.masthead.brand.headerBg,
        headerText: hex(br.headerText) ?? base.masthead.brand.headerText, logo: safeSrc(br.logo), desks, showNav: br.showNav !== false && desks.length > 0,
        style: br.style in STYLES ? br.style : base.masthead.brand.style
      }
    },
    blocks: (Array.isArray(raw?.blocks) ? raw.blocks : []).slice(0, 60).map(cleanBlock).filter(Boolean)
  };
}

/** After a sheet is in the page: the ticker scrolls only when it doesn't fit (its text doubled, the copy hidden). */
export function activate(el) {
  for (const t of el.querySelectorAll(".ss-ticker")) {
    const span = t.querySelector(":scope > span");
    span.querySelector("[aria-hidden]")?.remove();
    t.classList.remove("is-overflowing");
    if (span.offsetWidth <= t.clientWidth - (t.querySelector(".ss-ticker-label")?.offsetWidth ?? 0)) continue;
    const copy = document.createElement("span");
    copy.setAttribute("aria-hidden", "true");
    copy.textContent = span.textContent;
    span.append(copy);
    t.classList.add("is-overflowing");
  }
}

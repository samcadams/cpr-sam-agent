import { esc } from "../screamsheet/render.js";
import { isWanted, recordSummary } from "./model.js";

/*
 * A delivered lookup's record as a printed NCPD file (DataPool's idea, apps/screamsheet/render.js). Pure: a
 * lookup in, an HTML string out. Only the record and what the player already sees of the lookup: never its
 * `subject` or `gm`. Fonts and page sizing as DataPool's sheet; the look is in ncpd.css (.ncpd-file).
 */

// A half-gold star, as the department's seal.
const SEAL = `<svg class="ncpd-file-seal" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="47" fill="#14285c" stroke="#b8923a" stroke-width="3"/>
  <path d="M50 14 L50 68 L28 82 L36 57 L15 41 L41 41 Z" fill="#e8a93a"/>
  <path d="M50 14 L59 41 L85 41 L64 57 L72 82 L50 68 Z" fill="#f4f1e6"/>
</svg>`;

const NOT_LISTED = "N/A";
const cell = (label, value) => `<td data-label="${esc(label)}">${esc(value) || NOT_LISTED}</td>`;

/** A titled table; `cols`: [[heading, row => value]]. */
function section(title, cols, rows, empty = "") {
  if (!rows.length && !empty) return "";
  const body = rows.length
    ? `<table><thead><tr>${cols.map(([head]) => `<th scope="col">${esc(head)}</th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map(r => `<tr>${cols.map(([head, get]) => cell(head, get(r))).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="ncpd-file-none">${esc(empty)}</p>`;
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

const field = (label, value) => `<dt>${esc(label)}</dt><dd>${esc(value) || NOT_LISTED}</dd>`;

/** The record as a text to a contact: who, the summary, and what they're wanted for. */
export function recordMessage(lookup, money = n => `${n}eb`) {
  const r = lookup.result.record;
  return [
    `NCPD record ${lookup.num}: ${r.name || "Unnamed"}${r.aliases.length ? ` (a.k.a. ${r.aliases.join(", ")})` : ""}${r.affiliation ? `, ${r.affiliation}` : ""}`,
    recordSummary(r, money),
    r.warrants.length ? `Active warrants: ${r.warrants.map(w => w.charge).join(", ")}` : "",
    r.cautions.length ? `Caution: ${r.cautions.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

/** The file for a lookup whose result is a record. `money`: how to print eb. */
export function renderRecordSheet(lookup, money = n => `${n}eb`) {
  const r = lookup.result.record;
  return `<article class="ncpd-file${isWanted(r) ? " wanted" : ""}" lang="en">
    <header class="ncpd-file-head">
      ${SEAL}
      <div class="ncpd-file-org"><b>Night City Police Department</b><span>Public records</span></div>
      <dl class="ncpd-file-ref">${field("Request no.", lookup.num)}${field("Filed", [lookup.date, lookup.time].filter(Boolean).join(" "))}</dl>
    </header>
    ${r.cautions.length ? `<ul class="ncpd-file-cautions" aria-label="Cautions">${r.cautions.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <div class="ncpd-file-subject">
      <figure>
        <img src="${esc(lookup.img)}" alt="The submitted photo">
        <figcaption>Submitted image${lookup.caption ? `<span>"${esc(lookup.caption)}"</span>` : ""}</figcaption>
      </figure>
      <dl class="ncpd-file-fields">
        ${field("Name on file", r.name)}${field("Known aliases", r.aliases.join(", "))}${field("Affiliation", r.affiliation)}${field("Photo match", r.match)}
      </dl>
      ${isWanted(r) ? `<div class="ncpd-file-stamp">Wanted</div>` : ""}
    </div>
    ${section("Active warrants", [["Charge", w => w.charge], ["Issued by", w => w.issuer], ["Issued", w => w.issued]], r.warrants)}
    ${section("Bounties", [["Amount", b => money(b.amount)], ["Posted by", b => b.issuer], ["Terms", b => b.terms], ["Wanted for", b => b.reason]], r.bounties)}
    ${section("Priors", [["Charge", p => p.charge], ["Year", p => p.year], ["Disposition", p => p.disposition], ["Sentence", p => p.sentence]], r.priors, "None on file.")}
    ${r.notes ? `<section><h2>Remarks</h2><p class="ncpd-file-notes">${esc(r.notes)}</p></section>` : ""}
    <footer class="ncpd-file-foot"><span class="ncpd-file-barcode" aria-hidden="true"></span><small>NCPD keeps the submitted image and its metadata.</small></footer>
  </article>`;
}

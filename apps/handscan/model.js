import { MODULE_ID } from "../../scripts/config.js";
import { clean } from "../../scripts/util/text.js";

/*
 * Handprint Scanner (20eb, Going Quiet p. 6) and Retina Scanner (50eb, GQ p. 7): two apps, one vault and one GM
 * page. The Retina Scanner's
 * folder (apps/retinascan/) only names its app; everything else lives here.
 *   - A direct scan: Melee Range, the target's exposed hand (3 Rounds) or eye (5 Rounds), not necessarily in a
 *     row; each Round is an Action and a DV13 Brawling Check, automatic on a target that can't move.
 *   - Handprint only: lift prints from a smooth surface with DV13 Criminology: one scan of a complete print, or
 *     a print compiled from at least five partial prints.
 *   - Retina with only an Internal Agent: needs MicroVideo in a Cybereye or in Smart Glasses.
 *   - Honour system (Claude's default, proposal §10): nothing tracks Actions or range. A good round is pending
 *     until the GM confirms it ("GM confirms each round", on); "Target can't move" always waits for the GM.
 *
 * Scan row (host table "bioScans", owner actorId; `subjectActorId` and `noticed` only GMs see):
 *   { id, actorId, kind: "hand"|"retina", method: "direct"|"print"|"partial", side?: "left"|"right", label,
 *     subjectActorId?, tokenName?, sceneId?, need, skill, dv, ts, at (world time),
 *     pips: [{ ts, at, status: "pending"|"ok"|"void"|"fail", roll?: { total, detail }, auto? }], noticed? }
 * Record row (host table "bioRecords", owner actorId; `subjectActorId` and `stale` only GMs see):
 *   { id, actorId, kind, side?, label, subjectActorId?, method, takenAt (world time), date, scene, by (actorId),
 *     ts, copyOf?, from?, noticed?, stale?: { reason, at } }
 */

export const BIOSCAN = "bioscan";

/** The two apps, by the kind of record they take. */
export const KINDS = {
  hand: { app: "handscan", name: "Handprint", icon: "fa-hand", part: "hand" },
  retina: { app: "retinascan", name: "Retina", icon: "fa-eye", part: "eye" }
};
export const kindOfApp = app => Object.keys(KINDS).find(k => KINDS[k].app === app) ?? null;

export const METHODS = { direct: "Direct scan", print: "Complete print", partial: "Compiled from prints" };
export const SIDES = { left: "Left hand", right: "Right hand" };

/** The GM's setup (world setting "bioscan"). `microVideo`: { [actorId]: true|false }, the GM's word on MicroVideo. */
export const BIOSCAN_DEFAULTS = { dv: 13, handRounds: 3, retinaRounds: 5, partialPrints: 5, confirm: true, microVideo: {} };

export function bioConfig(raw = game.settings.get(MODULE_ID, BIOSCAN) ?? {}) {
  const num = (v, d, min, max) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.max(min, Math.min(max, Math.floor(Number(v)))) : d);
  const microVideo = Object.fromEntries(Object.entries(raw.microVideo ?? {}).filter(([, v]) => typeof v === "boolean"));
  return {
    dv: num(raw.dv, BIOSCAN_DEFAULTS.dv, 1, 40),
    handRounds: num(raw.handRounds, BIOSCAN_DEFAULTS.handRounds, 1, 20),
    retinaRounds: num(raw.retinaRounds, BIOSCAN_DEFAULTS.retinaRounds, 1, 20),
    partialPrints: num(raw.partialPrints, BIOSCAN_DEFAULTS.partialPrints, 1, 20),
    confirm: typeof raw.confirm === "boolean" ? raw.confirm : BIOSCAN_DEFAULTS.confirm,
    microVideo
  };
}

/* ---------------- Scans ---------------- */

/** How many good rounds (or prints) a scan needs. */
export function scanNeed(kind, method, config = bioConfig()) {
  if (method === "print") return 1;
  if (method === "partial") return config.partialPrints;
  return kind === "retina" ? config.retinaRounds : config.handRounds;
}

/** The skill a round uses: Brawling to hold someone's hand or eye, Criminology to lift a print. */
export const scanSkill = method => (method === "direct" ? "Brawling" : "Criminology");

/** A scan's pips: confirmed, waiting for the GM, voided by the GM, failed rolls. */
export function pipCounts(scan) {
  const counts = { ok: 0, pending: 0, void: 0, fail: 0 };
  for (const pip of scan?.pips ?? []) if (pip.status in counts) counts[pip.status]++;
  return counts;
}

/** Done: enough confirmed rounds. */
export const scanDone = scan => pipCounts(scan).ok >= (scan?.need ?? Infinity);

/** Another round can be taken while confirmed and pending rounds don't fill the scan yet. */
export function canAddRound(scan) {
  const { ok, pending } = pipCounts(scan);
  return ok + pending < (scan?.need ?? 0);
}

/** A skill's stat and level on the sheet, for a round the host rolls (Brawling is DEX, Criminology INT without the item). */
export function bioSkillBase(actor, skill) {
  const item = [...(actor?.items ?? [])].find(i => i.type === "skill" && i.name.toLowerCase() === String(skill).toLowerCase());
  const stat = item?.system?.stat ?? (skill === "Brawling" ? "dex" : "int");
  const value = Number(actor?.system?.stats?.[stat]?.value ?? 0) || 0;
  const level = Number(item?.system?.level ?? 0) || 0;
  return { stat, value, level };
}

/** A rolled round succeeds on the DV or more (as NCPD's shot, apps/ncpd/model.js shotUsable). */
export const roundSucceeds = (total, dv) => Number.isFinite(total) && total >= dv;

/** The status of a new round: a failed roll, or a good one waiting for the GM (or not, with confirm off). Auto rounds always wait. */
export function roundStatus({ total, auto }, dv, confirm) {
  if (auto) return "pending";
  if (!roundSucceeds(total, dv)) return "fail";
  return confirm ? "pending" : "ok";
}

/** The pips the phone draws: filled ones first (ok, then pending), then empty ones up to `need`. */
export function pipView(scan) {
  const { ok, pending } = pipCounts(scan);
  const need = scan?.need ?? 0;
  return Array.from({ length: need }, (_, i) => (i < ok ? "ok" : i < ok + pending ? "pending" : "empty"));
}

/* ---------------- Records ---------------- */

const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

/** A label for a scan or record: plain text, no links. */
export const cleanLabel = value => clean(String(value ?? "").replace(URL, "").replace(/\s+/g, " "), 80);

/** The original a record was copied from (following copies of copies); the record itself if it's an original. */
export function originalOf(record, records) {
  let row = record;
  const seen = new Set();
  while (row?.copyOf && records[row.copyOf] && !seen.has(row.id)) {
    seen.add(row.id);
    row = records[row.copyOf];
  }
  return row;
}

/** Stale (the GM re-keyed the lock): the record's own mark, or its original's. GMs only. */
export const staleOf = (record, records) => record?.stale ?? originalOf(record, records)?.stale ?? null;

/** Every copy of a record (the original included), by following `copyOf`. */
export function copiesOf(original, records) {
  return Object.values(records).filter(r => originalOf(r, records)?.id === original.id);
}

/** A record from a finished scan. */
export function recordFromScan(scan, { id, takenAt, date, scene }) {
  return {
    id, actorId: scan.actorId, kind: scan.kind, ...(scan.kind === "hand" && scan.side ? { side: scan.side } : {}),
    label: cleanLabel(scan.label), subjectActorId: scan.subjectActorId ?? null, method: scan.method,
    takenAt, date, scene: clean(scene, 80), by: scan.actorId, ts: Date.now()
  };
}

/** What a record's card says about it: "Right hand · Compiled from prints". */
export function recordLine(record) {
  const what = record.kind === "hand" ? (SIDES[record.side] ?? "Handprint") : "Retina";
  return `${what} · ${METHODS[record.method] ?? METHODS.direct}`;
}

/* ---------------- MicroVideo ---------------- */

const MICROVIDEO = /micro\s*-?\s*video/i;
const SMART_GLASSES = /smart\s*glasses/i;

/**
 * Has the character MicroVideo, for the Retina Scanner on an Internal Agent: installed cyberware named
 * MicroVideo, or Smart Glasses (carried or equipped) whose name or description mentions it (CPR has no
 * options slot on gear). `override`: the GM's word (setup), which wins.
 */
export function hasMicroVideo(actor, override) {
  if (typeof override === "boolean") return override;
  for (const item of actor?.items ?? []) {
    const sys = item.system ?? {};
    if (item.type === "cyberware" && MICROVIDEO.test(item.name)) {
      if (sys.isInstalledInActor ?? sys.isInstalled) return true;
    } else if (SMART_GLASSES.test(item.name) && sys.equipped !== "owned") {
      if (MICROVIDEO.test(`${item.name} ${sys.description?.value ?? sys.description ?? ""}`)) return true;
    }
  }
  return false;
}

/**
 * Can this character take a retina scan: always with a carried Agent, else (only an Internal Agent) with
 * MicroVideo. `agents`: model/agent.js agentsOf(actor).
 */
export const retinaAllowed = (agents, microVideo) => !!agents?.agent || !agents?.internal || !!microVideo;

export const NEEDS_MICROVIDEO = "Needs MicroVideo in a Cybereye or Smart Glasses.";

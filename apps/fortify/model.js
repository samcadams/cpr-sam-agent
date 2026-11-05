/*
 * 4Tify (SecSystems, 100eb; Black Chrome p. 13): "Absolutely useless for its intended purpose", but 5 minutes scanning
 * a section of cover gives +1d6 to the next damage done against it. Being within 1 m/yd for all 5 minutes is on the
 * player's honour, and so is which cover they mean; the GM can void a mark.
 * Mark (host table fortifyMarks): { id, actorId, everyone, startedAt, dueAt, status, total? }, status:
 * scanning → ready → used (total: what the d6 rolled), or void from scanning or ready.
 */

export const FORTIFY = "fortify";
export const FROM = "4Tify";
export const PUBLISHER = "SecSystems";

/** The scan, in seconds of world time. */
export const SCAN_SECONDS = 300;

/** The home-security screen: useless, and it always grades your own place F (proposal §4). */
export const HOME_GRADE = "F";
export const HOME_FINDINGS = ["Front door: decorative", "Walls: present", "Windows: see-through", "Recommendation: move"];

/** Flavor for the vulnerability overlay: the same line each time for the same mark. */
export const WEAK_POINTS = ["Stress fracture, lower third", "Hollow behind the facing", "Corroded anchor bolts", "Patched in a hurry", "Rebar spaced too wide", "Hinge side is the soft side"];

export const newMark = ({ id, actorId, now }) => ({ id, actorId, everyone: true, startedAt: now, dueAt: now + SCAN_SECONDS, status: "scanning" });

/** Seconds of world time left on a scan (never below 0). */
export const scanLeft = (mark, now = game.time.worldTime) => Math.max(0, mark.dueAt - now);

/** How far along a scan is, 0 to 100. */
export const scanPercent = (mark, now = game.time.worldTime) => Math.round(100 * (1 - scanLeft(mark, now) / SCAN_SECONDS));

/** "4:32 left". */
export function etaLabel(seconds) {
  if (seconds <= 0) return "finishing";
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")} left`;
}

export function weakPoint(mark) {
  const sum = [...mark.id].reduce((total, c) => total + c.charCodeAt(0), 0);
  return WEAK_POINTS[sum % WEAK_POINTS.length];
}

/** Someone's marks, newest first. */
export const marksOf = (marks, actorId) => Object.values(marks ?? {}).filter(m => m.actorId === actorId).sort((a, b) => b.startedAt - a.startedAt);

/** A mark still in play: being scanned, or ready to use. */
export const isLive = mark => mark.status === "scanning" || mark.status === "ready";

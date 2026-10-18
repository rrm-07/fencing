// Poules and elimination tableaux share storage, sharing and the scorer.
// `ops(p)` gives the functions for whichever one `p` is.

import * as Poule from './poule.js';
import * as Tableau from './tableau.js';

export const isTableau = (p) => p?.kind === 'tableau';
export const ops = (p) => (isTableau(p) ? Tableau : Poule);

/** Bouts that can be fenced now, each with leftId / rightId and a short label. */
export function pendingBouts(p) {
  if (isTableau(p)) return Tableau.pendingBouts(p).map((b) => ({ ...b, label: `${b.roundName} · Bout ${b.n}` }));
  return p.bouts.filter((b) => !Poule.isDone(b)).map((b) => ({ ...b, label: `Bout ${b.n}` }));
}

/** A bout of a poule or tableau with its fencers known, or null. */
export function boutFor(p, boutId) {
  if (isTableau(p)) return Tableau.boutOf(p, boutId);
  return p.bouts.find((b) => b.id === boutId) ?? null;
}

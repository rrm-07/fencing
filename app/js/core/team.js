// Team matches (FIE relay): two teams of three plus an optional reserve,
// nine legs to 5, 10, … 45. Each leg carries the score on. Pure functions.

import { uid } from './bout.js';

// FIE relay order. Team A fences as 1–3, team B as 4–6.
export const RELAY_ORDER = [
  [3, 6],
  [1, 5],
  [2, 4],
  [1, 6],
  [3, 4],
  [2, 5],
  [1, 4],
  [2, 6],
  [3, 5],
];
export const LEG_TOUCHES = 5;
export const LEGS = RELAY_ORDER.length;
export const MATCH_TARGET = LEG_TOUCHES * LEGS; // 45

const blankCards = () => ({ yellow: 0, red: 0, black: false });
const person = (name) => ({ id: uid('tf'), name: String(name ?? '').trim() });

/**
 * teamA / teamB: { name, fencers: [name1, name2, name3], reserve?: name }
 */
export function createTeamMatch({ name, date, weapon = 'foil', teamA, teamB, now = Date.now(), id }) {
  const team = (t, fallback) => {
    const fencers = (t.fencers ?? []).map((n) => String(n ?? '').trim()).filter(Boolean);
    if (fencers.length !== 3) throw new Error('Each team needs three fencers');
    return {
      name: String(t.name ?? '').trim() || fallback,
      fencers: fencers.map(person),
      reserve: String(t.reserve ?? '').trim() ? person(t.reserve) : null,
      subbed: false,
    };
  };
  const A = team(teamA, 'Team A');
  const B = team(teamB, 'Team B');
  return {
    id: id ?? uid('match'),
    kind: 'team',
    name: String(name ?? '').trim() || `${A.name} v ${B.name}`,
    date: date ?? new Date(now).toISOString().slice(0, 10),
    weapon,
    teams: { A, B },
    legs: RELAY_ORDER.map(([a, b], i) => ({
      n: i + 1,
      target: LEG_TOUCHES * (i + 1),
      aPos: a,
      bPos: b,
      aId: A.fencers[a - 1].id,
      bId: B.fencers[b - 4].id,
      touchesA: null,
      touchesB: null,
      reason: null,
      finishedAt: null,
    })),
    cards: { A: blankCards(), B: blankCards() },
    decided: null, // { winner: 'A'|'B', reason: 'priority'|'black', leg }
    status: 'active',
    winner: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** A rematch: same teams and line-ups, fresh legs. */
export function rematch(m, now = Date.now()) {
  const t = (x) => ({ name: x.name, fencers: x.fencers.map((f) => f.name), reserve: x.reserve?.name });
  return createTeamMatch({
    date: new Date(now).toISOString().slice(0, 10),
    weapon: m.weapon,
    teamA: t(m.teams.A),
    teamB: t(m.teams.B),
    now,
  });
}

export const legDone = (l) => l.touchesA != null && l.touchesB != null;

/** Cumulative score before leg n (1-based). */
export function legStart(m, n) {
  let a = 0;
  let b = 0;
  for (const l of m.legs) {
    if (l.n >= n) break;
    if (legDone(l)) {
      a += l.touchesA;
      b += l.touchesB;
    }
  }
  return { a, b };
}

export function score(m) {
  return m.legs.reduce((s, l) => (legDone(l) ? { a: s.a + l.touchesA, b: s.b + l.touchesB } : s), { a: 0, b: 0 });
}

export function nextLeg(m) {
  if (m.status === 'finished') return null;
  return m.legs.find((l) => !legDone(l)) ?? null;
}

export function fencerById(m, id) {
  for (const k of ['A', 'B']) {
    const t = m.teams[k];
    const f = [...t.fencers, t.reserve].find((x) => x && x.id === id);
    if (f) return { ...f, team: k };
  }
  return null;
}

/** Status and winner, derived from the legs (and any priority / black-card decision). */
export function withStatus(m) {
  const { a, b } = score(m);
  const allDone = m.legs.every(legDone);
  let status = 'active';
  let winner = null;
  if (m.decided?.reason === 'black') {
    status = 'finished';
    winner = m.decided.winner;
  } else if (Math.max(a, b) >= MATCH_TARGET || allDone) {
    if (a !== b) {
      status = 'finished';
      winner = a > b ? 'A' : 'B';
    } else if (m.decided?.winner) {
      status = 'finished';
      winner = m.decided.winner;
    }
  }
  return { ...m, status, winner };
}

/**
 * Record a leg. result: { touchesA, touchesB, reason?, decided?: { winner, reason }, cards?, finishedAt? }
 * Legs after a match-ending leg are left empty.
 */
export function recordLeg(m, n, result, now = Date.now()) {
  const { touchesA, touchesB } = result;
  if (![touchesA, touchesB].every((x) => Number.isInteger(x) && x >= 0 && x <= MATCH_TARGET)) {
    throw new Error('Touches must be whole numbers');
  }
  const legs = m.legs.map((l) =>
    l.n === n ? { ...l, touchesA, touchesB, reason: result.reason ?? null, finishedAt: result.finishedAt ?? now } : l,
  );
  let decided = m.decided && m.decided.leg !== n ? m.decided : null;
  if (result.decided) decided = { ...result.decided, leg: n };
  return withStatus({ ...m, legs, decided, cards: result.cards ?? m.cards, updatedAt: now });
}

export function clearLeg(m, n, now = Date.now()) {
  const legs = m.legs.map((l) =>
    l.n === n ? { ...l, touchesA: null, touchesB: null, reason: null, finishedAt: null } : l,
  );
  const decided = m.decided && m.decided.leg >= n ? null : m.decided;
  return withStatus({ ...m, legs, decided, updatedAt: now });
}

/** Bring the reserve on for `outId`: they take every leg not yet fenced. */
export function substitute(m, teamKey, outId, now = Date.now()) {
  const t = m.teams[teamKey];
  if (!t.reserve) throw new Error('No reserve on this team');
  if (t.subbed) throw new Error('This team has already made its substitution');
  const key = teamKey === 'A' ? 'aId' : 'bId';
  const legs = m.legs.map((l) => (!legDone(l) && l[key] === outId ? { ...l, [key]: t.reserve.id } : l));
  return { ...m, legs, teams: { ...m.teams, [teamKey]: { ...t, subbed: true, subOut: outId } }, updatedAt: now };
}

/** Per-fencer touches scored / received across their legs. */
export function fencerStats(m) {
  const out = [];
  for (const k of ['A', 'B']) {
    const t = m.teams[k];
    for (const f of [...t.fencers, ...(t.reserve ? [t.reserve] : [])]) {
      const key = k === 'A' ? 'aId' : 'bId';
      const legs = m.legs.filter((l) => l[key] === f.id && legDone(l));
      const TS = legs.reduce((s, l) => s + (k === 'A' ? l.touchesA : l.touchesB), 0);
      const TR = legs.reduce((s, l) => s + (k === 'A' ? l.touchesB : l.touchesA), 0);
      out.push({ id: f.id, name: f.name, team: k, reserve: f === t.reserve, legs: legs.length, TS, TR, Ind: TS - TR });
    }
  }
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells) => cells.map(csvCell).join(',');

export function toCsv(m) {
  const { a, b } = score(m);
  const A = m.teams.A;
  const B = m.teams.B;
  const name = (id) => fencerById(m, id)?.name ?? '';
  const rows = [
    line(['Team match', m.name]),
    line(['Date', m.date]),
    line(['Weapon', m.weapon]),
    line(['Result', `${A.name} ${a}–${b} ${B.name}`]),
    line(['Winner', m.winner ? m.teams[m.winner].name : '']),
    '',
    line(['Team', 'Fencer 1', 'Fencer 2', 'Fencer 3', 'Reserve']),
    line([A.name, ...A.fencers.map((f) => f.name), A.reserve?.name ?? '']),
    line([B.name, ...B.fencers.map((f) => f.name), B.reserve?.name ?? '']),
    '',
    line([
      'Leg',
      'To',
      `${A.name} fencer`,
      `${B.name} fencer`,
      `${A.name} touches`,
      `${B.name} touches`,
      `${A.name} score`,
      `${B.name} score`,
    ]),
  ];
  for (const l of m.legs) {
    const end = legDone(l)
      ? (() => {
          const s = legStart(m, l.n);
          return [s.a + l.touchesA, s.b + l.touchesB];
        })()
      : ['', ''];
    rows.push(line([l.n, l.target, name(l.aId), name(l.bId), l.touchesA ?? '', l.touchesB ?? '', ...end]));
  }
  rows.push('', line(['Team', 'Fencer', 'Legs', 'Touches scored', 'Touches received', 'Indicator']));
  for (const s of fencerStats(m))
    rows.push(line([m.teams[s.team].name, s.name + (s.reserve ? ' (reserve)' : ''), s.legs, s.TS, s.TR, s.Ind]));
  return rows.join('\r\n') + '\r\n';
}

/* ---------- three-weapon fixtures ---------- */
// A fixture is three team matches (foil, épée, sabre) between the same two
// clubs, each with its own three fencers and reserve. The matches carry
// `fixture: { id, name, scoring }`; the fixture itself is derived from them.

export const FIXTURE_WEAPONS = ['foil', 'epee', 'sabre'];
const WEAPON_NAME = { foil: 'Foil', epee: 'Épée', sabre: 'Sabre' };

/**
 * teamA / teamB: { name }. squads: { foil: { A: { fencers, reserve }, B: … }, epee: …, sabre: … }
 * scoring: 'weapons' (most weapons won, then total touches) | 'touches' (total touches).
 * Returns the three matches.
 */
export function createFixture({ name, date, teamA, teamB, squads, scoring = 'weapons', now = Date.now() }) {
  const nameA = String(teamA?.name ?? '').trim() || 'Team A';
  const nameB = String(teamB?.name ?? '').trim() || 'Team B';
  const fixture = { id: uid('fix'), name: String(name ?? '').trim() || `${nameA} v ${nameB}`, scoring };
  return FIXTURE_WEAPONS.map((w) => {
    const sq = squads?.[w];
    if (!sq) throw new Error(`Enter the ${WEAPON_NAME[w]} line-ups`);
    const m = createTeamMatch({
      name: `${fixture.name} · ${WEAPON_NAME[w]}`,
      date,
      weapon: w,
      teamA: { ...sq.A, name: nameA },
      teamB: { ...sq.B, name: nameB },
      now,
    });
    return { ...m, fixture };
  });
}

/** The matches of a fixture, in weapon order. */
export function fixtureMatches(all, fixtureId) {
  return [...all]
    .filter((m) => m.fixture?.id === fixtureId)
    .sort((a, b) => FIXTURE_WEAPONS.indexOf(a.weapon) - FIXTURE_WEAPONS.indexOf(b.weapon));
}

/**
 * Overall result of a fixture's matches.
 *   { weaponsA, weaponsB, touchesA, touchesB, finished (count), complete, winner: 'A'|'B'|null, decidedBy }
 * With 'weapons' scoring the fixture is won as soon as one team has won more
 * weapons than the other could still reach; with 'touches' only when all are fenced.
 */
export function fixtureResult(matches) {
  const scoring = matches[0]?.fixture?.scoring ?? 'weapons';
  let weaponsA = 0;
  let weaponsB = 0;
  let touchesA = 0;
  let touchesB = 0;
  let finished = 0;
  for (const m of matches) {
    const s = score(m);
    touchesA += s.a;
    touchesB += s.b;
    if (m.status === 'finished') {
      finished += 1;
      if (m.winner === 'A') weaponsA += 1;
      else if (m.winner === 'B') weaponsB += 1;
    }
  }
  const left = matches.length - finished;
  const complete = left === 0 && matches.length > 0;
  let winner = null;
  let decidedBy = null;
  if (scoring === 'touches') {
    if (complete && touchesA !== touchesB) [winner, decidedBy] = [touchesA > touchesB ? 'A' : 'B', 'touches'];
  } else if (weaponsA > weaponsB + left) [winner, decidedBy] = ['A', 'weapons'];
  else if (weaponsB > weaponsA + left) [winner, decidedBy] = ['B', 'weapons'];
  else if (complete && touchesA !== touchesB) [winner, decidedBy] = [touchesA > touchesB ? 'A' : 'B', 'touches'];
  return { scoring, weaponsA, weaponsB, touchesA, touchesB, finished, complete, winner, decidedBy };
}

/** A rematch of a whole fixture: same clubs and line-ups, fresh legs. */
export function rematchFixture(matches, now = Date.now()) {
  const f = matches[0].fixture;
  const t = (x) => ({ fencers: x.fencers.map((p) => p.name), reserve: x.reserve?.name });
  return createFixture({
    name: f.name,
    date: new Date(now).toISOString().slice(0, 10),
    teamA: { name: matches[0].teams.A.name },
    teamB: { name: matches[0].teams.B.name },
    squads: Object.fromEntries(matches.map((m) => [m.weapon, { A: t(m.teams.A), B: t(m.teams.B) }])),
    scoring: f.scoring,
    now,
  });
}

/** CSV for a whole fixture: the overall result, then each weapon's match. */
export function fixtureCsv(matches) {
  const r = fixtureResult(matches);
  const A = matches[0].teams.A.name;
  const B = matches[0].teams.B.name;
  const rows = [
    line(['Team fixture', matches[0].fixture.name]),
    line(['Date', matches[0].date]),
    line(['Decided by', r.scoring === 'touches' ? 'Total touches' : 'Weapons won, then total touches']),
    line(['Weapons won', `${A} ${r.weaponsA}–${r.weaponsB} ${B}`]),
    line(['Total touches', `${A} ${r.touchesA}–${r.touchesB} ${B}`]),
    line(['Winner', r.winner ? (r.winner === 'A' ? A : B) : '']),
    '',
    line(['Weapon', `${A} score`, `${B} score`, 'Winner']),
    ...matches.map((m) => {
      const s = score(m);
      return line([WEAPON_NAME[m.weapon], s.a, s.b, m.winner ? m.teams[m.winner].name : '']);
    }),
  ];
  for (const m of matches) rows.push('', '', line([`${WEAPON_NAME[m.weapon]}`]), toCsv(m).trimEnd());
  return rows.join('\r\n') + '\r\n';
}

// Poule and team-match exports: CSV, shareable image and printable page,
// all built from one report description (see report.js).

import { toCsv, stats, ranking, rankLabel, cellText, formatVM, fencerById, progress } from '../core/poule.js';
import * as Team from '../core/team.js';
import { WEAPON_LABEL } from '../core/bout.js';
import { slug, shareReportImage, printReport, downloadCsv } from './report.js';

const prettyDate = (d) => {
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/* ---------- poules ---------- */

export function pouleReport(p) {
  const st = stats(p);
  const ranks = ranking(p);
  const rankOf = new Map(ranks.map((r) => [r.id, r]));
  const pr = progress(p);
  const n = p.fencers.length;
  return {
    title: p.name,
    subtitle: `${prettyDate(p.date)} · ${WEAPON_LABEL[p.weapon]} · ${n} fencers · ${pr.done} of ${pr.total} bouts`,
    sections: [
      {
        title: 'Poule sheet',
        columns: [
          { label: '#', min: 34 },
          { label: 'Fencer', align: 'left', min: 120 },
          ...p.fencers.map((_, i) => ({ label: String(i + 1), min: 46 })),
          { label: 'V' },
          { label: 'V/M', min: 52 },
          { label: 'TS' },
          { label: 'TR' },
          { label: 'Ind' },
          { label: 'Rank', min: 50 },
        ],
        rows: p.fencers.map((f, i) => {
          const s = st.get(f.id);
          const r = rankOf.get(f.id);
          return [
            { text: i + 1, tone: 'muted' },
            { text: f.name, bold: true },
            ...p.fencers.map((o) => {
              if (o.id === f.id) return { text: '', fill: 'diag' };
              const t = cellText(p, f.id, o.id);
              return { text: t, tone: t.startsWith('V') ? 'win' : 'loss', bold: t.startsWith('V') };
            }),
            s.V,
            formatVM(s.VM),
            s.TS,
            s.TR,
            signed(s.Ind),
            { text: s.M ? rankLabel(r) : '–', bold: true },
          ];
        }),
      },
      {
        title: 'Standings',
        columns: [
          { label: 'Rank', min: 52 },
          { label: 'Fencer', align: 'left', min: 140 },
          { label: 'Club', align: 'left' },
          { label: 'V' },
          { label: 'M' },
          { label: 'V/M', min: 52 },
          { label: 'Ind' },
          { label: 'TS' },
        ],
        rows: ranks.map((r) => [
          { text: r.M ? rankLabel(r) : '–', bold: true, fill: r.M && r.rank === 1 ? 'gold' : null },
          { text: r.fencer.name, bold: true },
          { text: r.fencer.club ?? '', tone: 'muted' },
          r.V,
          r.M,
          formatVM(r.VM),
          signed(r.Ind),
          r.TS,
        ]),
      },
      {
        title: 'Bouts',
        printOnly: true,
        columns: [
          { label: '#' },
          { label: 'Left', align: 'left' },
          { label: 'Score' },
          { label: 'Right', align: 'left' },
        ],
        rows: p.bouts.map((b) => {
          const done = b.winnerId != null;
          const nm = (id) => ({ text: fencerById(p, id)?.name ?? '', bold: done && b.winnerId === id });
          return [b.n, nm(b.leftId), done ? `${b.scoreL}–${b.scoreR}` : '', nm(b.rightId)];
        }),
      },
    ],
  };
}

const pouleFile = (p, ext) => `${slug(p.name)}-${p.date}.${ext}`;
export const exportCsv = (p) => downloadCsv(toCsv(p), pouleFile(p, 'csv'));
export const exportImage = (p) => shareReportImage(pouleReport(p), pouleFile(p, 'png'));
export const printPoule = (p) => printReport(pouleReport(p));

/* ---------- team matches ---------- */

export function teamReport(m) {
  const { a, b } = Team.score(m);
  const A = m.teams.A;
  const B = m.teams.B;
  const name = (id) => Team.fencerById(m, id)?.name ?? '';
  const done = m.legs.filter(Team.legDone).length;
  const note = m.winner
    ? `${m.teams[m.winner].name} win${m.decided?.reason === 'priority' ? ' on priority' : m.decided?.reason === 'black' ? ' (black card)' : ''}`
    : `In progress · ${done} of ${Team.LEGS} legs`;
  const lineup = (t, k) => [
    { text: t.name, bold: true, tone: k === 'A' ? 'red' : 'green' },
    ...t.fencers.map((f) => f.name),
    t.reserve ? `${t.reserve.name}${t.subbed ? ' (on)' : ''}` : '–',
  ];
  return {
    title: m.name,
    subtitle: `${prettyDate(m.date)} · ${WEAPON_LABEL[m.weapon]} · Team relay to ${Team.MATCH_TARGET}`,
    hero: { left: { label: A.name, value: a }, right: { label: B.name, value: b }, note },
    sections: [
      {
        title: 'Line-ups',
        columns: [
          { label: 'Team', align: 'left', min: 120 },
          { label: '1 / 4', align: 'left' },
          { label: '2 / 5', align: 'left' },
          { label: '3 / 6', align: 'left' },
          { label: 'Reserve', align: 'left' },
        ],
        rows: [lineup(A, 'A'), lineup(B, 'B')],
      },
      {
        title: 'Legs',
        columns: [
          { label: 'Leg' },
          { label: 'To' },
          { label: A.name, align: 'left', min: 110 },
          { label: B.name, align: 'left', min: 110 },
          { label: 'Touches', min: 80 },
          { label: 'Score', min: 72 },
        ],
        rows: m.legs.map((l) => {
          if (!Team.legDone(l)) return [l.n, l.target, name(l.aId), name(l.bId), { text: '–', tone: 'muted' }, ''];
          const s = Team.legStart(m, l.n);
          const end = [s.a + l.touchesA, s.b + l.touchesB];
          return [
            l.n,
            l.target,
            { text: name(l.aId), bold: l.touchesA > l.touchesB },
            { text: name(l.bId), bold: l.touchesB > l.touchesA },
            `${l.touchesA}–${l.touchesB}`,
            { text: `${end[0]}–${end[1]}`, bold: true },
          ];
        }),
      },
      {
        title: 'Fencers',
        columns: [
          { label: 'Team', align: 'left' },
          { label: 'Fencer', align: 'left', min: 120 },
          { label: 'Legs' },
          { label: 'Scored' },
          { label: 'Received' },
          { label: 'Ind' },
        ],
        rows: Team.fencerStats(m)
          .filter((s) => !s.reserve || s.legs > 0)
          .map((s) => [
            { text: m.teams[s.team].name, tone: s.team === 'A' ? 'red' : 'green' },
            { text: s.name, bold: true },
            s.legs,
            s.TS,
            s.TR,
            { text: signed(s.Ind), tone: s.Ind > 0 ? 'win' : s.Ind < 0 ? 'loss' : null, bold: true },
          ]),
      },
    ],
  };
}

const teamFile = (m, ext) => `${slug(m.name)}-${m.date}.${ext}`;
export const exportTeamCsv = (m) => downloadCsv(Team.toCsv(m), teamFile(m, 'csv'));
export const exportTeamImage = (m) => shareReportImage(teamReport(m), teamFile(m, 'png'));
export const printTeam = (m) => printReport(teamReport(m));

/* ---------- three-weapon fixtures ---------- */

export function fixtureReport(ms) {
  const r = Team.fixtureResult(ms);
  const f = ms[0].fixture;
  const A = ms[0].teams.A.name;
  const B = ms[0].teams.B.name;
  const by = r.scoring === 'touches' ? 'total touches' : 'weapons won';
  const note = r.winner
    ? `${r.winner === 'A' ? A : B} win on ${r.decidedBy === 'touches' ? 'total touches' : 'weapons'} · touches ${r.touchesA}–${r.touchesB}`
    : `${r.finished} of ${ms.length} weapons fenced · touches ${r.touchesA}–${r.touchesB}`;
  const tone = (k) => (k === 'A' ? 'red' : 'green');
  return {
    title: f.name,
    subtitle: `${prettyDate(ms[0].date)} · Foil, épée and sabre · decided by ${by}`,
    hero: {
      left: { label: A, value: r.scoring === 'touches' ? r.touchesA : r.weaponsA },
      right: { label: B, value: r.scoring === 'touches' ? r.touchesB : r.weaponsB },
      note,
    },
    sections: [
      {
        title: 'Weapons',
        columns: [
          { label: 'Weapon', align: 'left', min: 90 },
          { label: A, min: 70 },
          { label: B, min: 70 },
          { label: 'Result', align: 'left', min: 120 },
        ],
        rows: ms.map((m) => {
          const s = Team.score(m);
          const done = m.legs.filter(Team.legDone).length;
          return [
            { text: WEAPON_LABEL[m.weapon], bold: true },
            { text: s.a, bold: m.winner === 'A' },
            { text: s.b, bold: m.winner === 'B' },
            m.winner
              ? { text: `${m.teams[m.winner].name} won`, tone: tone(m.winner) }
              : { text: done ? `Leg ${done} of ${Team.LEGS}` : 'Not started', tone: 'muted' },
          ];
        }),
      },
      {
        title: 'Line-ups',
        columns: [
          { label: 'Weapon', align: 'left' },
          { label: 'Team', align: 'left', min: 100 },
          { label: '1 / 4', align: 'left' },
          { label: '2 / 5', align: 'left' },
          { label: '3 / 6', align: 'left' },
          { label: 'Reserve', align: 'left' },
        ],
        rows: ms.flatMap((m) =>
          ['A', 'B'].map((k) => {
            const t = m.teams[k];
            return [
              k === 'A' ? { text: WEAPON_LABEL[m.weapon], bold: true } : '',
              { text: t.name, tone: tone(k) },
              ...t.fencers.map((x) => x.name),
              t.reserve ? `${t.reserve.name}${t.subbed ? ' (on)' : ''}` : '–',
            ];
          }),
        ),
      },
      {
        title: 'Fencers',
        columns: [
          { label: 'Weapon', align: 'left' },
          { label: 'Fencer', align: 'left', min: 120 },
          { label: 'Legs' },
          { label: 'Scored' },
          { label: 'Received' },
          { label: 'Ind' },
        ],
        rows: ms.flatMap((m) =>
          Team.fencerStats(m)
            .filter((s) => !s.reserve || s.legs > 0)
            .map((s) => [
              WEAPON_LABEL[m.weapon],
              { text: s.name, bold: true, tone: tone(s.team) },
              s.legs,
              s.TS,
              s.TR,
              { text: signed(s.Ind), tone: s.Ind > 0 ? 'win' : s.Ind < 0 ? 'loss' : null, bold: true },
            ]),
        ),
      },
      // Every leg of every weapon on paper.
      ...ms.map((m) => ({ ...teamReport(m).sections[1], title: `${WEAPON_LABEL[m.weapon]} legs`, printOnly: true })),
    ],
  };
}

const fixtureFile = (ms, ext) => `${slug(ms[0].fixture.name)}-${ms[0].date}.${ext}`;
export const exportFixtureCsv = (ms) => downloadCsv(Team.fixtureCsv(ms), fixtureFile(ms, 'csv'));
export const exportFixtureImage = (ms) => shareReportImage(fixtureReport(ms), fixtureFile(ms, 'png'));
export const printFixture = (ms) => printReport(fixtureReport(ms));

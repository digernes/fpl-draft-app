#!/usr/bin/env node
// The summary of a season from before the site's first, for the next season's model to
// start from (src/build/last-season.ts), from the public match archive
// (github.com/vaastav/Fantasy-Premier-League). Every later season's the build writes
// itself when the season ends.
//
//   node scripts/season-summary.ts 2025-26      -> public/seasons/model/2025-26.json

import { POSITIONS } from '../src/build/config.ts';
import { summarise, writeSummary } from '../src/build/last-season.ts';
import type { Appearance, ClubMatch } from '../src/model/history.ts';

const slug = process.argv[2] ?? '';
if (!/^\d{4}-\d{2}$/.test(slug)) {
  console.error('Usage: node scripts/season-summary.ts 2025-26');
  process.exit(1);
}
const ARCHIVE = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${slug}`;

async function table(file: string): Promise<Record<string, string>[]> {
  const response = await fetch(`${ARCHIVE}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return parseCsv(await response.text());
}

// Comma-separated, with quotes around a field that holds a comma (and "" for a quote in it).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') cell += text[i++];
    else if (ch === '"') quoted = !quoted;
    else if (quoted || (ch !== ',' && ch !== '\n')) cell += ch;
    else {
      rows.at(-1)!.push(cell.replace(/\r$/, ''));
      cell = '';
      if (ch === '\n') rows.push([]);
    }
  }
  if (cell) rows.at(-1)!.push(cell);
  const [head, ...body] = rows;
  return body.filter((row) => row.length === head.length).map((row) => Object.fromEntries(head.map((h, i) => [h, row[i]])));
}

const [gws, fixtures, teams, players] = await Promise.all(['gws/merged_gw.csv', 'fixtures.csv', 'teams.csv', 'players_raw.csv'].map(table));
const n = (x: string | undefined) => Number(x || 0);
const fixture = new Map(fixtures.filter((f) => f.finished === 'True').map((f) => [n(f.id), f]));

// Each appearance at the club its side of the fixture was, and each club's xG in a match
// from every one of its players.
const appearances: Appearance[] = [];
const clubXg = new Map<string, number>();
for (const r of gws) {
  const f = fixture.get(n(r.fixture));
  if (!f) continue;
  const club = n(r.was_home === 'True' ? f.team_h : f.team_a);
  const key = `${f.id}:${club}`;
  clubXg.set(key, (clubXg.get(key) ?? 0) + n(r.expected_goals));
  if (n(r.minutes) > 0)
    appearances.push({
      ...{ gw: n(r.GW || r.round), fixture: n(f.id), pid: n(r.element), club, minutes: n(r.minutes) },
      ...{ xg: n(r.expected_goals), xa: n(r.expected_assists), goals: n(r.goals_scored), assists: n(r.assists) },
      ...{ defcon: 0, saves: 0, bonus: 0, yellow: 0, cleanSheet: 0 }, // not in the summary
    });
}
const matches = [...fixture.values()].flatMap((f): ClubMatch[] => {
  const [home, away, gw] = [n(f.team_h), n(f.team_a), n(f.event)];
  const xg = (club: number) => clubXg.get(`${f.id}:${club}`) ?? 0;
  return [
    { gw, fixture: n(f.id), club: home, opp: away, home: true, xg: xg(home), xga: xg(away), goals: n(f.team_h_score) },
    { gw, fixture: n(f.id), club: away, opp: home, home: false, xg: xg(away), xga: xg(home), goals: n(f.team_a_score) },
  ];
});

const player = new Map(players.map((p) => [n(p.id), p]));
const clubCode = new Map(teams.map((t) => [n(t.id), n(t.code)]));
const summary = summarise(
  `${slug.slice(0, 4)}/${slug.slice(5)}`,
  { matches, appearances },
  {
    player: (pid) => (player.has(pid) ? n(player.get(pid)!.code) : undefined),
    club: (club) => clubCode.get(club),
    pos: (pid) => POSITIONS[n(player.get(pid)?.element_type)],
    penalties: (pid) => (player.get(pid)?.penalties_order ? n(player.get(pid)!.penalties_order) : null),
  },
);
await writeSummary('public/seasons', summary);
console.log(`Wrote public/seasons/model/${slug}.json: ${Object.keys(summary.players).length} players, ${summary.matches.length} matches.`);

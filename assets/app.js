// FotMob Draft League: renders data.json (built by scripts/build-data.mjs) with
// fotmob.com's look. Plain JS modules, no build step.

import { scoreLineup } from './live.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'table', label: 'Table' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'stats', label: 'Stats' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'draft', label: 'Draft' },
];
const COLOR_SLOTS = 8; // --m1 … --m8 in styles.css; any later manager gets grey
const REFRESH_MS = 10 * 60 * 1000;
const LIVE_REFRESH_MS = 2 * 60 * 1000; // data.json itself changes about every 10 minutes during matches
// Near real-time scores while a gameweek is being played come from a small Cloudflare
// Worker (worker/), because browsers can't call the FPL API. Leave empty to rely on
// data.json, which the scheduled job refreshes every 10 minutes during matches.
const LIVE_URL = '';
const LIVE_POLL_MS = 30 * 1000; // while Premier League matches are on
const LIVE_IDLE_MS = 5 * 60 * 1000; // between the match days of a live gameweek
const POS_ORDER = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
const HEAT_STEPS = [35, 45, 55, 65]; // gameweek score bands for the heatmap
const photoUrl = (code) => `https://resources.premierleague.com/premierleague25/photos/players/40x40/${Number(code)}.png`;

const store = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the setting just won't stick between visits.
    }
  },
};

const state = {
  tab: 'overview',
  theme: store.get('draft.theme', 'system'),
  odds: store.get('draft.odds', 'decimal'),
  tableView: 'overall',
  tableMode: store.get('draft.tableMode', 'short'), // narrow screens: 'short' columns or 'form'
  gw: null, // gameweek shown on the Fixtures tab
  openMatch: null, // "gw:home:away" of the expanded match
  logManager: 'all', // transfer log filter
  openSquad: null, // manager whose original squad is expanded
  season: null, // slug of an archived season being viewed, e.g. "2025-26"; null = current
};

let D = null;
let managers = new Map();
let seasons = []; // from seasons/index.json; the current season's file is data.json
let lastFetch = 0;
let refreshTimer = null;
let live = null; // latest scores from the live relay: { gw, feed, lineups, points }
let liveTimer = null;

// --- Lookups and formatting ----------------------------------------------------

const mgr = (id) => managers.get(id);
const first = (id) => esc(mgr(id)?.first ?? '?');
const player = (id) => D.players[id];
const club = (id) => D.clubs[id];
const gwInfo = (gw) => D.gameweeks.find((g) => g.id === gw);
const gwPoints = (pid, gw) => (live?.gw === gw ? live.points(pid) : (player(pid)?.pts?.[gw - D.meta.firstGw] ?? 0));
const lineupFor = (id, gw) => (live?.gw === gw && live.lineups[id]) || D.lineups[id]?.[gw];
const seasonStat = (id) => D.seasonStats.find((s) => s.id === id);
const slotOf = (id) => {
  const slot = mgr(id)?.slot ?? COLOR_SLOTS;
  return slot < COLOR_SLOTS ? slot + 1 : 0;
};
const isLive = () => D.matches.some((m) => m.started && !m.finished);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (p) => `${Math.round(p * 100)}%`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
function ordinal(n) {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th';
  return `${n}${suffix}`;
}

const dateFormat = (options) => new Intl.DateTimeFormat(undefined, options);
const fmtDay = dateFormat({ weekday: 'long', day: 'numeric', month: 'long' });
const fmtShortDay = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = dateFormat({ hour: '2-digit', minute: '2-digit' });
const fmtStamp = dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(iso) {
  const seconds = (new Date(iso) - Date.now()) / 1000;
  const units = [['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return 'just now';
}

function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor(ms / 36e5) % 24;
  const minutes = Math.floor(ms / 6e4) % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function priceText(price) {
  return state.odds === 'fractional' ? price.frac : price.dec.toFixed(2);
}

// --- Small components ----------------------------------------------------------

function avatar(id, size = 18) {
  const m = mgr(id);
  if (!m) return `<span class="av av-${size} m0"></span>`;
  return `<span class="av av-${size} m${slotOf(id)}" data-tip="${esc(m.first)} · ${esc(m.team)}" role="img" aria-label="${esc(m.first)}">${esc(m.initials)}</span>`;
}

function managerCell(id) {
  const m = mgr(id);
  return `<span class="who">${avatar(id)}<span class="who-name">${esc(m.first)}</span><span class="who-team">${esc(m.team)}</span></span>`;
}

function crest(clubId, size = 18) {
  const c = club(clubId);
  if (!c) return '';
  return `<img class="crest" src="${esc(c.logo)}" width="${size}" height="${size}" alt="" loading="lazy" data-tip="${esc(c.name)}">`;
}

function clubCell(clubId) {
  const c = club(clubId);
  return `<span class="who">${crest(clubId)}<span class="who-name">${esc(c.name)}</span></span>`;
}

function photo(pid, size = 32) {
  const p = player(pid);
  const img = p ? `<img src="${photoUrl(p.code)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="photo" style="--s:${size}px">${img}</span>`;
}

function ptsPill(pts) {
  const tier = pts >= 10 ? 'p4' : pts >= 6 ? 'p3' : pts >= 3 ? 'p2' : pts >= 1 ? 'p1' : 'p0';
  return `<span class="ptsp ${tier}">${pts}</span>`;
}

function tag(text, tip = '', cls = '') {
  return `<span class="tag ${cls}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${text}</span>`;
}

function chip(label, action, value, active, extra = '') {
  return `<button type="button" class="chip" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active}" ${extra}>${label}</button>`;
}

function seg(action, options, current) {
  return `<div class="seg seg-sm" role="group">${options
    .map(([value, label]) => `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${current === value}">${label}</button>`)
    .join('')}</div>`;
}

function card({ title = '', sub = '', action = '', header: custom = '', body, footer = null, cls = '' }) {
  const heading = custom || `<div class="card-heading"><h2 class="card-title">${title}</h2>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div>`;
  const header = title || custom ? `<header class="card-header">${heading}${action}</header>` : '';
  const foot = footer ? `<a class="card-footer" href="${footer.href}"${footer.attrs ?? ''}>${footer.label}</a>` : '';
  return `<section class="card ${cls}">${header}${body}${foot}</section>`;
}

function listRow({ lead = '', title, meta = '', value = '', top = false, rank = null }) {
  return `<div class="lrow">
    ${rank != null ? `<span class="lrow-rank">${rank}</span>` : ''}
    ${lead}
    <div class="lrow-main"><div class="lrow-title">${title}</div>${meta ? `<div class="lrow-meta">${meta}</div>` : ''}</div>
    ${value !== '' ? `<span class="lrow-value${top ? ' top' : ''}">${value}</span>` : ''}
  </div>`;
}

const empty = (text) => `<div class="empty">${text}</div>`;

function formPills(form) {
  if (!form.length) return '<span class="form"></span>';
  return `<span class="form">${form
    .map((f, i) => {
      const tip = `GW ${f.gw}: ${f.pf} - ${f.pa} vs ${mgr(f.opp)?.first ?? '?'}`;
      return `<button type="button" class="pill ${f.res}${i === form.length - 1 ? ' latest' : ''}" data-tip="${esc(tip)}" data-action="match" data-value="${f.gw}" data-a="${f.opp}" data-go="1">${f.res}</button>`;
    })
    .join('')}</span>`;
}

// A value with FotMob's superscript of actual minus expected; green when it went the manager's way.
function withDiff(value, diff, tip, { lowerIsGood = false } = {}) {
  const d = Math.round(diff);
  const tone = d === 0 ? 'even' : d > 0 !== lowerIsGood ? 'good' : 'bad';
  return `<span class="xv" data-tip="${esc(tip)}">${value}<sup class="diff ${tone}">${d > 0 ? '+' : ''}${d}</sup></span>`;
}

// A simulated finishing chance, shaded by how likely it is.
function simCell(p) {
  const label = p === 0 ? '–' : p < 0.005 ? '<1%' : p > 0.995 && p < 1 ? '>99%' : `${Math.round(p * 100)}%`;
  const shade = Math.sqrt(p); // lifts the small chances off the background
  return `<span class="simp${shade >= 0.6 ? ' strong' : ''}" style="--shade:${(shade * 100).toFixed(0)}%">${label}</span>`;
}

const PRIZE_MARKS = { 1: 'var(--qual-top)', 2: 'var(--qual-europe)' };
const markedHeader = (label, color) => (color ? `<span class="qmark" style="--q:${color}">${label}</span>` : label);

// The simulation's formula with this season's numbers, for the (i) by the legend.
function simulationFormula() {
  const m = D.simulation.model;
  const share = (w) => `${Math.round(w * 100)}%`;
  return [
    'Each simulated week, a manager scores:',
    `league average (${m.leagueAverage})`,
    `+ ${share(m.formWeight)} × (their form − league average)`,
    m.projectionWeight ? `+ ${share(m.projectionWeight)} × (projected XI − average projected XI), next gameweek only` : null,
    `+ their level for this run (typically ±${m.levelSpread} a week)`,
    `+ that week’s randomness (typically ±${m.spread}, ±${m.laterSpread} after next week)`,
    '',
    'Form is this season’s average score, weighting recent weeks more and pulled towards the league average while there are few weeks. Higher score wins 3 points, level scores draw. Equal points split on points scored.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function simulationCols() {
  const positions = D.simulation.rows[0]?.positions.length ?? 0;
  return [
    posCol,
    managerCol,
    { label: 'PTS', w: '44px', cls: 'c-pts', tip: 'Average final points across the simulations', cell: (r) => Math.round(r.pts) },
    ...Array.from({ length: positions }, (_, i) => ({
      label: markedHeader(ordinal(i + 1), PRIZE_MARKS[i + 1] ?? (i === positions - 1 ? 'var(--qual-bottom)' : null)),
      w: '44px',
      from: 'md',
      tip: `How often they finish ${ordinal(i + 1)}`,
      cell: (r) => simCell(r.positions[i]),
    })),
    // Narrow tables get the three that matter instead of the full grid.
    { label: markedHeader('1st', 'var(--qual-top)'), w: '48px', until: 'sm', tip: 'How often they win the league', cell: (r) => simCell(r.positions[0]) },
    { label: 'Top 2', w: '52px', until: 'sm', tip: 'How often they finish in the prize places', cell: (r) => simCell(r.positions[0] + r.positions[1]) },
    { label: markedHeader('Last', 'var(--qual-bottom)'), w: '48px', until: 'sm', tip: 'How often they finish last', cell: (r) => simCell(r.positions.at(-1)) },
  ];
}

// Real table position against the expected one, as in FotMob's xG table.
function rankDelta(r) {
  const d = r.tableRank - r.rank;
  const tone = d === 0 ? 'even' : d > 0 ? 'bad' : 'good';
  const tip = `${ordinal(r.tableRank)} in the real table, ${ordinal(r.rank)} on expected points`;
  return `<span class="rank-delta ${tone}" data-tip="${tip}">${d > 0 ? '+' : ''}${d}${d ? triangleSvg : ''}</span>`;
}

// --- Data tables (fotmob-style grid with container-query column hiding) ----------

const BREAKPOINTS = ['xs', 'sm', 'md', 'lg']; // <380, ≥380, ≥550, ≥768px of table width

// Column widths are plain values or one per breakpoint. They are resolved here rather
// than with CSS variables, because a var() inside --cols-* would resolve on the table,
// not on the row where the container query applies.
const rowKey = (row) => (row.type === 'club' ? `club-${row.club}` : `m-${row.id}`);

function dataTable(cols, rows, { rowClass = () => '', qual = () => null } = {}) {
  const visible = (col, bp) => {
    const i = BREAKPOINTS.indexOf(bp);
    return BREAKPOINTS.indexOf(col.from ?? 'xs') <= i && i <= BREAKPOINTS.indexOf(col.until ?? 'lg');
  };
  const width = (col, bp) => (typeof col.w === 'object' ? col.w[bp] : col.w);
  const templates = BREAKPOINTS.map((bp) => `--cols-${bp}:${cols.filter((c) => visible(c, bp)).map((c) => width(c, bp)).join(' ')}`).join(';');
  const cell = (col, content) => `<div class="tc ${col.cls ?? ''} from-${col.from ?? 'xs'}${col.until ? ` until-${col.until}` : ''}">${content}</div>`;
  const head = cols.map((col) => cell(col, col.tip ? `<span data-tip="${esc(col.tip)}">${col.label}</span>` : col.label)).join('');
  const body = rows
    .map((row) => {
      const q = qual(row);
      return `<div class="trow ${rowClass(row)}${q ? ' qual' : ''}" data-key="${rowKey(row)}"${q ? ` style="--qual:${q}"` : ''}>${cols.map((col) => cell(col, col.cell(row))).join('')}</div>`;
    })
    .join('');
  return `<div class="ftable" style="${templates}"><div class="trow thead">${head}</div>${body}</div>`;
}

// The position gets 24px after its padding (8/16/24px), enough for "20" in DM Sans.
const posCol = { label: '#', w: { xs: '32px', sm: '40px', md: '40px', lg: '48px' }, cls: 'c-pos', cell: (r) => r.rank };
// Five 24px pills with 6px gaps, or 12px gaps from 550px.
const FORM_WIDTH = { xs: '144px', sm: '144px', md: '168px', lg: '168px' };
const managerCol = { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => managerCell(r.id) };
const numCol = (label, value, from, extra = {}) => ({ label, w: '27px', from, cell: value, ...extra });

function livePill(match) {
  if (!match) return '';
  const res = match.pf > match.pa ? 'W' : match.pf < match.pa ? 'L' : 'D';
  return `<span class="livep ${res}">${match.pf}-${match.pa}</span>`;
}

// The table as it would stand if every live score ended as it is now (fotmob.com's
// live table): finished matches plus the ones being played.
function liveStandings() {
  const { win, draw, loss } = D.meta.scoring;
  const rows = new Map(D.tables.overall.map((r) => [r.id, { ...r, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0 }]));
  for (const m of D.matches.filter((x) => x.started)) {
    for (const [id, pf, pa] of [[m.home, m.homePts, m.awayPts], [m.away, m.awayPts, m.homePts]]) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      r.pf += pf;
      r.pa += pa;
      if (pf > pa) [r.won, r.pts] = [r.won + 1, r.pts + win];
      else if (pf === pa) [r.drawn, r.pts] = [r.drawn + 1, r.pts + draw];
      else [r.lost, r.pts] = [r.lost + 1, r.pts + loss];
      if (!m.finished) r.liveMatch = { pf, pa };
    }
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.pf - a.pf).map((r, i) => ({ ...r, rank: i + 1 }));
}

const standingsCols = () => {
  const formMode = state.tableMode === 'form';
  const liveCol = { label: 'Live', w: '52px', tip: 'This gameweek’s score so far', cell: (r) => livePill(r.liveMatch) };
  return [
    posCol,
    managerCol,
    ...(state.tableView === 'overall' && isLive() ? [liveCol] : []),
    numCol('PL', (r) => r.played, formMode ? 'md' : 'xs'),
    numCol('W', (r) => r.won, 'lg'),
    numCol('D', (r) => r.drawn, 'lg'),
    numCol('L', (r) => r.lost, 'lg'),
    { label: '+/-', w: '64px', from: formMode ? 'md' : 'sm', tip: 'Points scored – conceded', cell: (r) => `${r.pf}-${r.pa}` },
    { label: 'GD', w: '36px', from: formMode ? 'md' : 'xs', tip: 'Points difference', cell: (r) => signed(r.pf - r.pa) },
    { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    { label: 'Form', w: FORM_WIDTH, from: formMode ? 'xs' : 'md', cls: 'c-form', cell: (r) => formPills(r.form) },
    { label: 'Next', w: '28px', from: 'lg', cell: (r) => (r.next ? avatar(r.next.opp) : '') },
  ];
};

const tableModeToggle = (cls = '') => `<div class="narrow-only ${cls}">${seg('table-mode', [['short', 'Short'], ['form', 'Form']], state.tableMode)}</div>`;

const TABLE_VIEWS = {
  overall: {
    label: 'All',
    rows: () => (isLive() ? liveStandings() : D.tables.overall),
    cols: standingsCols,
    qual: (r, rows) => (r.rank === 1 ? 'var(--qual-top)' : r.rank === 2 ? 'var(--qual-europe)' : r.rank === rows.length ? 'var(--qual-bottom)' : null),
    legend: [['var(--qual-top)', '1st prize'], ['var(--qual-europe)', '2nd prize'], ['var(--qual-bottom)', 'Penalty to be announced']],
  },
  form: {
    label: 'Form',
    rows: () => D.tables.form,
    cols: standingsCols,
    note: () => `Table over the last ${D.meta.formLength} gameweeks`,
  },
  xg: {
    label: 'xG',
    rows: () => D.tables.xg,
    cols: () => [
      posCol,
      { label: '', w: '40px', from: 'md', cell: rankDelta },
      managerCol,
      numCol('PL', (r) => r.played, 'sm'),
      {
        label: 'xPF',
        w: '72px',
        from: 'sm',
        tip: 'Expected points for: your XIs with goals, assists and clean sheets swapped for what the xG, xA and xGC were worth',
        cell: (r) => withDiff(Math.round(r.xpf), r.pf - r.xpf, `${r.xpf} expected, ${r.pf} scored`),
      },
      {
        label: 'xPA',
        w: '72px',
        from: 'md',
        tip: 'Expected points against: the same for your opponents, in their games against you',
        cell: (r) => withDiff(Math.round(r.xpa), r.pa - r.xpa, `${r.xpa} expected, ${r.pa} conceded`, { lowerIsGood: true }),
      },
      {
        label: 'xPTS',
        w: '60px',
        cls: 'c-pts',
        tip: 'Table points both sides’ expected scores would have earned',
        cell: (r) => withDiff(Math.round(r.xPts), r.pts - r.xPts, `${r.xPts} expected, ${r.pts} actual`),
      },
    ],
    note: () =>
      'Like FotMob’s xG table: goals, assists and clean sheets are swapped for their expected values. The small numbers are actual minus expected, green when it went your way.',
  },
  luck: {
    label: 'Luck',
    rows: () => D.tables.luck,
    cols: () => [
      posCol,
      { label: '', w: '40px', from: 'md', cell: rankDelta },
      managerCol,
      numCol('PL', (r) => r.played, 'sm'),
      numCol('W', (r) => r.won, 'md', { tip: 'Weeks above the league average' }),
      numCol('D', (r) => r.drawn, 'md', { tip: 'Weeks exactly on the league average' }),
      numCol('L', (r) => r.lost, 'md', { tip: 'Weeks below the league average' }),
      { label: '+/-', w: '48px', from: 'sm', tip: 'Points scored above the league average, all season', cell: (r) => signed(Math.round(r.above)) },
      {
        label: 'PTS',
        w: '60px',
        cls: 'c-pts',
        tip: 'Points if you’d played the league average every week. The small number is your real points minus these.',
        cell: (r) => withDiff(r.avgPts, r.luck, `${r.avgPts} against the average, ${r.pts} in the real table`),
      },
    ],
    note: () =>
      'Every week played against the league average: score above it for a win. The small number is your real points minus these, green when the fixture list helped you.',
  },
  sim: {
    label: 'Simulated',
    rows: () => D.simulation.rows,
    cols: simulationCols,
    legend: [['var(--qual-top)', '1st prize'], ['var(--qual-europe)', '2nd prize'], ['var(--qual-bottom)', 'Penalty to be announced']],
    info: simulationFormula,
    note: () =>
      D.simulation.gameweeksLeft
        ? `The rest of the season played ${D.simulation.runs.toLocaleString()} times: ${plural(D.simulation.gameweeksLeft, 'gameweek')} to go. Each week’s scores are drawn around current form, the same way the odds are made, and ties on points go to points scored.`
        : 'The season is over, so these are the final positions.',
  },
  points: {
    label: 'Total points',
    rows: () => D.tables.points,
    cols: () => [
      posCol,
      managerCol,
      { label: 'Avg', w: '40px', from: 'sm', tip: 'Average gameweek score', cell: (r) => r.avg },
      { label: 'High', w: '36px', from: 'md', cell: (r) => r.high },
      { label: 'Low', w: '36px', from: 'md', cell: (r) => r.low },
      { label: 'Bench', w: '44px', from: 'lg', tip: 'Points left on the bench', cell: (r) => r.bench },
      { label: 'PTS', w: '40px', cls: 'c-pts', tip: 'Total fantasy points', cell: (r) => r.total },
    ],
    note: () => 'Ranked on fantasy points scored, as if this were a classic league',
  },
  parallel: {
    label: 'PL parallel',
    rows: parallelRows,
    cols: () => [
      { ...posCol, cell: (r) => (r.type === 'club' ? r.rank : `<span class="muted" data-tip="Where ${first(r.id)} would sit">${r.wouldBe}</span>`) },
      { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => (r.type === 'club' ? clubCell(r.club) : managerCell(r.id)) },
      numCol('PL', (r) => r.played),
      numCol('W', (r) => r.won, 'lg'),
      numCol('D', (r) => r.drawn, 'lg'),
      numCol('L', (r) => r.lost, 'lg'),
      { label: '+/-', w: '52px', from: 'sm', cell: (r) => (r.type === 'club' ? `${r.gf}-${r.ga}` : '–') },
      { label: 'GD', w: '32px', cell: (r) => (r.type === 'club' ? signed(r.gf - r.ga) : '–') },
      { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    ],
    rowClass: (r) => (r.type === 'manager' ? 'featured' : ''),
    qual: (r) => (r.type !== 'club' ? null : r.rank <= 4 ? 'var(--qual-top)' : r.rank === 5 ? 'var(--qual-europe)' : r.rank >= 18 ? 'var(--qual-bottom)' : null),
    legend: [['var(--qual-top)', 'Champions League'], ['var(--qual-europe)', 'Europa League'], ['var(--qual-bottom)', 'Relegation'], ['var(--featured-key)', 'Draft manager']],
    note: () => 'The real Premier League table with each manager dropped in on their H2H points',
  },
};

function parallelRows() {
  const clubs = D.tables.premierLeague.map((c) => ({ type: 'club', ...c }));
  const people = D.tables.overall.map((r) => ({ type: 'manager', ...r, wouldBe: D.plTwins.find((t) => t.id === r.id)?.wouldBe }));
  return [...clubs, ...people].sort((a, b) => b.pts - a.pts || (a.type === b.type ? a.rank - b.rank : a.type === 'club' ? -1 : 1));
}

function standingsTable(viewId) {
  const view = TABLE_VIEWS[viewId];
  const rows = view.rows();
  const table = dataTable(view.cols(), rows, { rowClass: view.rowClass, qual: (r) => view.qual?.(r, rows) });
  const info = view.info
    ? `<button type="button" class="info-btn" data-tip="${esc(view.info())}" aria-label="How this is worked out">${infoSvg}</button>`
    : '';
  const legend =
    view.legend || info
      ? `<div class="legend">${(view.legend ?? []).map(([color, label]) => `<span class="legend-item"><i style="background:${color}"></i>${label}</span>`).join('')}${info}</div>`
      : '';
  const note = view.note ? `<div class="table-note">${view.note()}</div>` : '';
  return table + legend + note;
}

// --- Matches ---------------------------------------------------------------------

const matchKey = (m) => `${m.gw}:${m.home}:${m.away}`;

function featuredGw() {
  const { meta } = D;
  if (isLive() || !meta.nextGw || meta.nextGw > meta.lastGw) return meta.currentGw || meta.firstGw;
  return meta.nextGw;
}

function matchList(list) {
  if (!list.length) return empty('No matches this gameweek');
  return `<div class="matches">${list.map(matchBlock).join('')}</div>`;
}

function matchBlock(m) {
  const key = matchKey(m);
  const open = state.openMatch === key;
  const deadline = gwInfo(m.gw)?.deadline;
  const center = m.started
    ? `<span class="score${m.finished ? '' : ' is-live'}">${m.homePts} - ${m.awayPts}</span>${m.finished ? '' : '<span class="live-label">Live</span>'}`
    : `<span class="kickoff">${deadline ? fmtTime.format(new Date(deadline)) : 'TBC'}</span>`;
  const side = (id, cls) =>
    `<span class="side ${cls}">${cls === 'away' ? avatar(id, 22) : ''}<span class="side-text"><span class="side-name">${first(id)}</span><span class="side-team">${esc(mgr(id).team)}</span></span>${cls === 'home' ? avatar(id, 22) : ''}</span>`;
  return `<div class="match-block${open ? ' open' : ''}">
    <button type="button" class="match" data-action="match" data-value="${key}" aria-expanded="${open}">
      ${side(m.home, 'home')}<span class="mid">${center}</span>${side(m.away, 'away')}
    </button>
    ${m.odds ? oddsRow(m) : ''}
    ${open ? matchDetail(m) : ''}
  </div>`;
}

function oddsRow(m) {
  const labels = ['1', 'X', '2'];
  const who = [`${mgr(m.home).first} to win`, 'Draw', `${mgr(m.away).first} to win`];
  return `<div class="odds">${m.odds.prices
    .map(
      (price, i) =>
        `<span class="odd" data-tip="${esc(who[i])} · ${pct(m.odds.p[i])} chance"><span class="odd-label">${labels[i]}</span><span class="odd-price">${priceText(price)}</span></span>`,
    )
    .join('')}</div>`;
}

function matchDetail(m) {
  if (!m.started) return upcomingDetail(m);
  return `<div class="match-detail"><div class="lineups">${lineupColumn(m.home, m.gw)}${lineupColumn(m.away, m.gw)}</div></div>`;
}

function lineupColumn(id, gw) {
  const l = lineupFor(id, gw);
  if (!l) return `<div class="lineup">${empty('No lineup')}</div>`;
  const doubles = new Set(gwInfo(gw)?.doubles ?? []);
  const byPosition = (ids) => [...ids].sort((a, b) => POS_ORDER[player(a).pos] - POS_ORDER[player(b).pos]);
  const row = (pid, benched) => {
    const p = player(pid);
    const flags = [
      l.subs.includes(pid) ? tag('Sub', 'Came on as an automatic substitute', 'tag-sub') : '',
      doubles.has(p.club) ? tag('DGW', 'Plays twice this gameweek', 'tag-dgw') : '',
    ].join('');
    return `<div class="lp${benched ? ' benched' : ''}"><span class="lp-pos">${p.pos}</span>${crest(p.club, 16)}<span class="lp-name">${esc(p.name)}${flags}</span>${ptsPill(gwPoints(pid, gw))}</div>`;
  };
  const adjusted = l.dgw ? ` <span class="muted" data-tip="${D.meta.dgwPenalty} off per double-gameweek player in the XI">(${l.adj} adj.)</span>` : '';
  return `<div class="lineup">
    <div class="lineup-head">${avatar(id, 24)}<span class="lineup-name">${first(id)}</span><span class="lineup-total">${l.pts}${adjusted}</span></div>
    ${byPosition(l.xi).map((pid) => row(pid, false)).join('')}
    <div class="lineup-bench">Bench · ${plural(l.benchPts, 'pt')}</div>
    ${l.bench.map((pid) => row(pid, true)).join('')}
  </div>`;
}

function upcomingDetail(m) {
  if (!m.odds) return `<div class="match-detail">${empty('Odds go up three gameweeks before the deadline')}</div>`;
  const [ph, pd, pa] = m.odds.p;
  const [eh, ea] = m.odds.expected;
  const projected = (id, ids) => {
    const xp = sum(ids.map((pid) => player(pid).ep));
    const rows = [...ids]
      .sort((a, b) => POS_ORDER[player(a).pos] - POS_ORDER[player(b).pos])
      .map((pid) => {
        const p = player(pid);
        const flag = p.status !== 'a' ? tag('!', p.news || 'Flagged', 'tag-flag') : '';
        return `<div class="lp"><span class="lp-pos">${p.pos}</span>${crest(p.club, 16)}<span class="lp-name">${esc(p.name)}${flag}</span><span class="ptsp xp">${p.ep.toFixed(1)}</span></div>`;
      });
    return `<div class="lineup"><div class="lineup-head">${avatar(id, 24)}<span class="lineup-name">${first(id)}</span><span class="lineup-total" data-tip="Best legal XI by FPL expected points">${xp.toFixed(1)} xP</span></div>${rows.join('')}</div>`;
  };
  return `<div class="match-detail">
    <div class="prob">
      <div class="prob-bar"><span class="m${slotOf(m.home)}" style="flex:${ph}"></span><span class="prob-draw" style="flex:${pd}"></span><span class="m${slotOf(m.away)}" style="flex:${pa}"></span></div>
      <div class="prob-legend"><span>${first(m.home)} ${pct(ph)}</span><span>Draw ${pct(pd)}</span><span>${first(m.away)} ${pct(pa)}</span></div>
    </div>
    <p class="detail-note">Model score ${eh} – ${ea}: league average, plus ${m.odds.xi ? 'form and each side’s best projected XI' : 'season form'}. Prices carry a ${Math.round((D.meta.oddsOverround - 1) * 100)}% margin.</p>
    ${m.odds.xi ? `<div class="lineups">${projected(m.home, m.odds.xi[0])}${projected(m.away, m.odds.xi[1])}</div>` : ''}
  </div>`;
}

function roundSubtitle(gw) {
  const info = gwInfo(gw);
  if (isLive() && gw === D.meta.currentGw) return `Live now · scores update every ${LIVE_URL ? '30 seconds' : '10 minutes'}`;
  if (info?.finished) return 'Final scores';
  const parts = [];
  if (info?.deadline) parts.push(`Deadline ${fmtShortDay.format(new Date(info.deadline))}, ${fmtTime.format(new Date(info.deadline))}`);
  if (gw === D.meta.nextGw && D.meta.nextWaivers && new Date(D.meta.nextWaivers) > Date.now()) {
    parts.push(`waivers ${fmtShortDay.format(new Date(D.meta.nextWaivers))}, ${fmtTime.format(new Date(D.meta.nextWaivers))}`);
  }
  return parts.join(' · ');
}

const oddsToggle = () => seg('odds', [['decimal', 'Decimal'], ['fractional', 'Fractional']], state.odds);

// --- Cards -------------------------------------------------------------------------

function roundCard() {
  const gw = featuredGw();
  const list = D.matches.filter((m) => m.gw === gw);
  return card({
    title: `Gameweek ${gw}`,
    sub: roundSubtitle(gw),
    action: list.some((m) => m.odds) ? oddsToggle() : '',
    body: matchList(list),
    footer: { href: `#fixtures/${gw}`, label: 'All fixtures' },
  });
}

function tableCard() {
  return card({
    title: 'Table',
    action: tableModeToggle(),
    body: standingsTable('overall'),
    footer: { href: '#table', label: 'Full table' },
  });
}

function topGameweeksCard(limit) {
  const list = D.topGameweeks.slice(0, limit);
  if (!list.length) return card({ title: 'Top gameweeks', body: empty('No finished gameweeks yet') });
  const rows = list.map((g, i) => {
    const result = resultText(g);
    const star = g.star ? `${esc(player(g.star.player).name)} ${g.star.pts}` : '';
    const best = g.guaranteed ? tag('Best GW', `${mgr(g.id).first}’s best week, included so every manager makes the list`) : '';
    const prize = g.rank === 1 ? tag('Prize', 'Holds the highest-gameweek prize', 'tag-prize') : '';
    const penalty = g.dgw ? `<span class="lrow-sub" data-tip="${g.dgw} double-gameweek ${g.dgw === 1 ? 'player' : 'players'} × −${D.meta.dgwPenalty}">${g.pts} − ${g.dgw * D.meta.dgwPenalty}</span>` : '';
    return listRow({
      rank: g.rank,
      lead: avatar(g.id, 32),
      title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>${prize}${best}`,
      meta: [result, star].filter(Boolean).join(' · '),
      value: `${g.adj}${penalty}`,
      top: i === 0,
    });
  });
  return card({
    title: 'Top gameweeks',
    sub: `−${D.meta.dgwPenalty} per double-gameweek player in the XI · earlier week wins a tie · every manager included`,
    body: `<div class="list">${rows.join('')}</div>`,
    footer: limit < D.topGameweeks.length ? { href: '#stats', label: 'All top gameweeks' } : null,
  });
}

const resultText = (g) => (g.opp ? `${g.pts > g.oppPts ? 'Won' : g.pts < g.oppPts ? 'Lost' : 'Drew'} ${g.pts}-${g.oppPts} vs ${first(g.opp)}` : '');

function gwPrizeCard() {
  const title = 'Highest gameweek prize';
  const sub = `Best score after −${D.meta.dgwPenalty} per double-gameweek player · earlier week wins a tie`;
  const holders = D.topGameweeks.filter((g) => g.rank === 1);
  if (!holders.length) return card({ title, sub, body: empty('Up for grabs once the first gameweek finishes') });
  const seasonOver = D.gameweeks.every((g) => g.finished);
  const label = seasonOver ? 'Winner' : holders.length > 1 ? 'Joint holders' : 'Current holder';
  const hero = holders
    .map((g) => {
      const adjusted = g.dgw
        ? `<span class="prize-adj" data-tip="${g.dgw} double-gameweek ${g.dgw === 1 ? 'player' : 'players'} × −${D.meta.dgwPenalty}">${g.pts} − ${g.dgw * D.meta.dgwPenalty}</span>`
        : '';
      const star = g.star ? `${esc(player(g.star.player).name)} ${g.star.pts}` : '';
      return `<div class="prize">
        ${avatar(g.id, 48)}
        <div class="prize-main">
          <div class="prize-label">${label}</div>
          <div class="prize-name">${first(g.id)} <span class="muted">GW ${g.gw}</span></div>
          <div class="prize-meta">${[resultText(g), star].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="prize-score"><span>${g.adj}</span>${adjusted}</div>
      </div>`;
    })
    .join('');
  // Anyone beating the record in a gameweek that is still being played (a tie
  // would lose to the earlier week, so it has to be strictly higher).
  const record = holders[0].adj;
  const threats = isLive()
    ? D.managers.map((m) => ({ id: m.id, l: lineupFor(m.id, D.meta.currentGw) })).filter((x) => x.l && x.l.adj > record)
    : [];
  const live = threats.length
    ? `<div class="prize-live">${threats.map((x) => `<span>${avatar(x.id)} ${first(x.id)} is on ${x.l.adj} in GW ${D.meta.currentGw}, live</span>`).join('')}</div>`
    : '';
  const chasers = D.topGameweeks
    .filter((g) => g.rank > 1)
    .slice(0, 3)
    .map((g) => listRow({ rank: g.rank, lead: avatar(g.id, 24), title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>`, meta: resultText(g), value: g.adj }));
  return card({
    title,
    sub,
    body: `${hero}${live}${chasers.length ? `<div class="date-head"><span>Chasing</span></div><div class="list">${chasers.join('')}</div>` : ''}`,
    footer: { href: '#stats', label: 'All top gameweeks' },
  });
}

function twinsCard() {
  const rows = D.plTwins.map((t) => {
    const row = D.tables.overall.find((r) => r.id === t.id);
    const twin = D.tables.premierLeague.find((c) => c.club === t.club);
    const also = t.also.length ? ` · level with ${t.also.map((c) => esc(club(c).short)).join(', ')}` : '';
    return listRow({
      lead: avatar(t.id, 32),
      title: `${first(t.id)} <span class="muted">${plural(row.pts, 'pt')}</span>`,
      meta: `${t.exact ? '' : 'Closest: '}${esc(club(t.club).name)}, ${ordinal(twin.rank)} with ${twin.pts}${also}`,
      value: crest(t.club, 28),
    });
  });
  return card({
    title: 'Parallel Premier League',
    sub: 'The club sitting on your points',
    body: `<div class="list twins">${rows.join('')}</div>`,
    footer: { href: '#table', label: 'Merged table', attrs: ' data-action="table-view" data-value="parallel"' },
  });
}

function feed() {
  const singles = D.transfers.moves.filter((mv) => mv.type !== 'trade').map((mv) => ({ at: mv.at, gw: mv.gw, move: mv }));
  const trades = D.transfers.trades.filter((t) => t.state === 'p').map((t) => ({ at: t.at, gw: t.gw, trade: t }));
  return [...singles, ...trades].sort((a, b) => b.at.localeCompare(a.at));
}

const MOVE_TYPES = { waiver: 'Waiver', free: 'Free agent', trade: 'Trade' };

function feedRow(item) {
  if (item.trade) {
    const t = item.trade;
    const names = (ids) => ids.map((pid) => esc(player(pid).name)).join(', ');
    return listRow({
      lead: `<span class="swap-icon">${swapSvg}</span>`,
      title: `${first(t.offeredBy)} ⇄ ${first(t.offeredTo)}`,
      meta: `${first(t.offeredBy)} gets ${names(t.items.map((i) => i.gets))} · ${first(t.offeredTo)} gets ${names(t.items.map((i) => i.gives))} · ${ago(t.at)}`,
      value: tag('Trade'),
    });
  }
  const mv = item.move;
  const pin = player(mv.in);
  const net = mv.net != null ? ` · <span data-tip="Points since: ${esc(pin.name)} ${mv.inPts}, ${esc(player(mv.out).name)} ${mv.outPts}">${signed(mv.net)} net</span>` : '';
  return listRow({
    lead: photo(mv.in),
    title: `<span class="arrow-in" aria-label="In">${arrowSvg}</span>${esc(pin.name)} ${crest(pin.club, 14)}`,
    meta: `<span class="arrow-out" aria-label="Out">${arrowSvg}</span>${esc(player(mv.out).name)} · ${MOVE_TYPES[mv.type]} · ${ago(mv.at)}${net}`,
    value: avatar(mv.manager, 24),
  });
}

function latestMovesCard() {
  const items = feed().slice(0, 6);
  return card({
    title: 'Latest transfers',
    body: items.length ? `<div class="list">${items.map(feedRow).join('')}</div>` : empty('No transfers yet'),
    footer: { href: '#transfers', label: 'All transfer stats' },
  });
}

function squadStrip(r) {
  const dots = Array.from({ length: r.size }, (_, i) => `<i class="${i < r.kept.length ? `on m${slotOf(r.id)}` : ''}"></i>`).join('');
  return `<span class="strip" data-tip="${r.kept.length} of ${r.size} draft picks still in the squad">${dots}</span>`;
}

function retentionMiniCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.kept.length - a.kept.length || b.originalShare - a.originalShare);
  return card({
    title: 'Original squad',
    sub: 'Draft picks still in the squad',
    body: `<div class="list">${rows
      .map((r) => listRow({ lead: avatar(r.id, 24), title: `${first(r.id)}`, meta: squadStrip(r), value: `${r.kept.length}/${r.size}` }))
      .join('')}</div>`,
    footer: { href: '#draft', label: 'Original squads' },
  });
}

// --- Views -------------------------------------------------------------------------

function viewOverview() {
  return `<div class="cols">
    <div class="col">${roundCard()}${tableCard()}</div>
    <div class="col">${gwPrizeCard()}${latestMovesCard()}${retentionMiniCard()}</div>
  </div>`;
}

function viewTable() {
  const chips = Object.entries(TABLE_VIEWS)
    .map(([id, v]) => chip(v.label, 'table-view', id, state.tableView === id))
    .join('');
  return `<div class="cols">
    <div class="col">${card({ body: `<div class="filter-bar">${chips}</div>${['overall', 'form'].includes(state.tableView) ? tableModeToggle('table-tools') : ''}${standingsTable(state.tableView)}` })}</div>
    <div class="col">${twinsCard()}${luckCard()}</div>
  </div>`;
}

function luckCard() {
  const rows = [...D.tables.luck].sort((a, b) => b.luck - a.luck || a.rank - b.rank);
  return card({
    title: 'Luck',
    sub: 'Your real points against what you’d have playing the league average every week',
    body: `<div class="list">${rows
      .map((r) =>
        listRow({
          lead: avatar(r.id, 24),
          title: first(r.id),
          meta: `${r.pts} pts, ${r.avgPts} against the average · above it ${r.won} of ${r.played} weeks`,
          value: signed(r.luck),
        }),
      )
      .join('')}</div>`,
  });
}

function viewFixtures() {
  const { meta } = D;
  const gw = Math.min(Math.max(state.gw ?? featuredGw(), meta.firstGw), meta.lastGw);
  state.gw = gw;
  const list = D.matches.filter((m) => m.gw === gw);
  const info = gwInfo(gw);
  const options = D.gameweeks
    .filter((g) => g.id >= meta.firstGw && g.id <= meta.lastGw)
    .map((g) => `<option value="${g.id}"${g.id === gw ? ' selected' : ''}>Gameweek ${g.id}</option>`)
    .join('');
  const nav = `<div class="gw-nav">
    <button type="button" class="icon-btn" data-action="gw" data-value="${gw - 1}" ${gw <= meta.firstGw ? 'disabled' : ''} aria-label="Previous gameweek">${chevronSvg('left')}</button>
    <label class="gw-select"><select data-action="gw-select" aria-label="Gameweek">${options}</select>${chevronSvg('down')}</label>
    <button type="button" class="icon-btn" data-action="gw" data-value="${gw + 1}" ${gw >= meta.lastGw ? 'disabled' : ''} aria-label="Next gameweek">${chevronSvg('right')}</button>
  </div>`;
  const day = info?.deadline ? fmtDay.format(new Date(info.deadline)) : '';
  const groupHead = `<div class="date-head"><span>${day}</span><span class="muted">${roundSubtitle(gw)}</span></div>`;
  const doubles = info?.doubles?.length ? `<div class="table-note">Double gameweek for ${info.doubles.map((c) => esc(club(c).name)).join(', ')}</div>` : '';
  return `<div class="cols">
    <div class="col">${card({ header: nav, action: list.some((m) => m.odds) ? oddsToggle() : '', body: `${groupHead}${matchList(list)}${doubles}` })}</div>
    <div class="col">${headToHeadCard(gw)}</div>
  </div>`;
}

function headToHeadCard(gw) {
  // Every past meeting of this gameweek's pairs, newest first.
  const pairs = D.matches.filter((m) => m.gw === gw);
  const rows = pairs.map((m) => {
    const past = D.matches.filter(
      (x) => x.finished && x.gw !== gw && ((x.home === m.home && x.away === m.away) || (x.home === m.away && x.away === m.home)),
    );
    const wins = (id) => past.filter((x) => (x.home === id ? x.homePts > x.awayPts : x.awayPts > x.homePts)).length;
    const meta = past.length
      ? past.map((x) => `GW ${x.gw}: ${x.home === m.home ? `${x.homePts}-${x.awayPts}` : `${x.awayPts}-${x.homePts}`}`).join(' · ')
      : 'First meeting';
    return listRow({
      lead: `<span class="stack">${avatar(m.home, 24)}${avatar(m.away, 24)}</span>`,
      title: `${first(m.home)} ${wins(m.home)} – ${wins(m.away)} ${first(m.away)}`,
      meta,
    });
  });
  return card({ title: 'Head to head', sub: 'Earlier meetings this season', body: `<div class="list">${rows.join('')}</div>` });
}

function viewStats() {
  return `${recordsCard()}
  <div class="cols">
    <div class="col">${topGameweeksCard(D.topGameweeks.length)}${heatmapCard()}</div>
    <div class="col">${mvpCard()}${worstGameweeksCard()}${benchCard()}</div>
  </div>`;
}

function recordsCard() {
  const r = D.records;
  const tile = (label, value, meta, tip = '') =>
    `<div class="tile"${tip ? ` data-tip="${esc(tip)}"` : ''}><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`;
  const match = (d) => `${first(d.winner)} ${d.winPts}-${d.losePts} ${first(d.loser)} · GW ${d.gw}`;
  const tiles = [
    r.highest && tile('Highest score', r.highest.pts, `${first(r.highest.id)} · GW ${r.highest.gw}`),
    r.lowest && tile('Lowest score', r.lowest.pts, `${first(r.lowest.id)} · GW ${r.lowest.gw}`),
    r.biggestWin && tile('Biggest win', `+${r.biggestWin.margin}`, match(r.biggestWin)),
    r.narrowestWin && tile('Narrowest win', `+${r.narrowestWin.margin}`, match(r.narrowestWin)),
    r.unluckiest && tile('Best losing score', r.unluckiest.losePts, `${first(r.unluckiest.loser)} lost to ${first(r.unluckiest.winner)} · GW ${r.unluckiest.gw}`),
    r.luckiest && tile('Worst winning score', r.luckiest.winPts, `${first(r.luckiest.winner)} beat ${first(r.luckiest.loser)} · GW ${r.luckiest.gw}`),
    r.benchMax && tile('Most points on the bench', r.benchMax.pts, `${first(r.benchMax.id)} · GW ${r.benchMax.gw}`),
    r.longestWinRun && tile('Longest winning run', r.longestWinRun.streak.bestWin, first(r.longestWinRun.id)),
    r.draws > 0 && tile('Draws', r.draws, 'Level scores so far'),
  ].filter(Boolean);
  return card({ title: 'Season records', body: `<div class="tiles">${tiles.join('')}</div>` });
}

function heatmapCard() {
  const gws = D.gameweeks.filter((g) => g.finished && g.id >= D.meta.firstGw).map((g) => g.id);
  if (!gws.length) return '';
  const order = D.tables.overall.map((r) => r.id);
  const scoreOf = (id, gw) => D.lineups[id]?.[gw]?.pts;
  const best = Object.fromEntries(gws.map((gw) => [gw, Math.max(...order.map((id) => scoreOf(id, gw) ?? -Infinity))]));
  const band = (pts) => HEAT_STEPS.filter((step) => pts >= step).length;
  const head = `<div class="hm-row hm-head"><span></span>${gws.map((gw) => `<span>${gw}</span>`).join('')}<span>Avg</span></div>`;
  const rows = order.map((id) => {
    const cells = gws.map((gw) => {
      const pts = scoreOf(id, gw);
      if (pts == null) return '<span class="hm-cell">–</span>';
      const top = pts === best[gw];
      return `<span class="hm-cell h${band(pts)}${top ? ' best' : ''}" data-tip="${first(id)} · GW ${gw}: ${pts}${top ? ' (week’s best)' : ''}">${pts}</span>`;
    });
    return `<div class="hm-row"><span class="hm-who">${avatar(id)}<span>${first(id)}</span></span>${cells.join('')}<span class="hm-avg">${seasonStat(id).avg}</span></div>`;
  });
  const labels = [`<${HEAT_STEPS[0]}`, ...HEAT_STEPS.slice(0, -1).map((s, i) => `${s}–${HEAT_STEPS[i + 1] - 1}`), `${HEAT_STEPS.at(-1)}+`];
  const legend = `<div class="legend">${labels.map((l, i) => `<span class="legend-item"><i class="h${i}"></i>${l}</span>`).join('')}<span class="legend-item"><i class="best-key"></i>Week’s best</span></div>`;
  return card({
    title: 'Points per gameweek',
    body: `<div class="heatmap" style="--gws:${gws.length}"><div class="hm-grid">${head}${rows.join('')}</div></div>${legend}`,
  });
}

function mvpCard() {
  const rows = [...D.seasonStats].filter((s) => s.mvp).sort((a, b) => b.mvp.pts - a.mvp.pts);
  return card({
    title: 'Most valuable players',
    sub: 'Most points scored in each manager’s XI',
    body: `<div class="list">${rows
      .map((s, i) => {
        const p = player(s.mvp.player);
        return listRow({ lead: photo(s.mvp.player), title: `${esc(p.name)} ${crest(p.club, 14)}`, meta: `For ${first(s.id)} · ${p.pos}`, value: s.mvp.pts, top: i === 0 });
      })
      .join('')}</div>`,
  });
}

function worstGameweeksCard() {
  return card({
    title: 'Worst gameweeks',
    body: `<div class="list">${D.worstGameweeks
      .map((g, i) => listRow({ rank: i + 1, lead: avatar(g.id, 24), title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>`, value: g.pts }))
      .join('')}</div>`,
  });
}

function benchCard() {
  const rows = [...D.seasonStats].sort((a, b) => b.bench - a.bench);
  return card({
    title: 'Points left on the bench',
    body: `<div class="list">${rows.map((s, i) => listRow({ rank: i + 1, lead: avatar(s.id, 24), title: first(s.id), value: s.bench, top: i === 0 })).join('')}</div>`,
  });
}

function viewTransfers() {
  const t = D.transfers;
  const count = (type) => t.moves.filter((mv) => mv.type === type).length;
  const busiest = t.byGw.reduce((a, b) => (b.waiver + b.free + b.trade > a.waiver + a.free + a.trade ? b : a), t.byGw[0]);
  const tiles = [
    ['Waivers won', count('waiver'), `${t.claims.length} claims in total`],
    ['Free agents signed', count('free'), 'First come, first served'],
    ['Trades', t.trades.filter((x) => x.state === 'p').length, plural(t.trades.length, 'offer')],
    ['Claims lost', t.claims.filter((c) => c.outcome === 'lost').length, 'Another manager had better waiver priority'],
    ['Busiest gameweek', busiest ? `GW ${busiest.gw}` : '–', busiest ? plural(busiest.waiver + busiest.free + busiest.trade, 'move') : ''],
  ];
  const tileHtml = tiles
    .map(([label, value, meta]) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`)
    .join('');
  return `${card({ title: 'Transfer market', body: `<div class="tiles">${tileHtml}</div>` })}
  <div class="cols">
    <div class="col">${transferTableCard()}${movesByGwCard()}${transferLogCard()}</div>
    <div class="col">${awardsCard()}${bestPickupsCard()}${regretsCard()}${contestedCard()}${tradesCard()}${waiverOrderCard()}${hotPotatoesCard()}</div>
  </div>`;
}

function transferTableCard() {
  const rows = [...D.transfers.summary].sort((a, b) => b.moves - a.moves || b.net - a.net).map((s, i) => ({ ...s, rank: i + 1 }));
  const cols = [
    posCol,
    managerCol,
    { label: 'Moves', w: '46px', cls: 'c-pts', tip: 'Waivers, free agents and trade legs', cell: (r) => r.moves },
    { label: 'Waivers', w: '56px', from: 'sm', tip: 'Waivers won / claims made', cell: (r) => `${r.waivers}/${r.claims}` },
    { label: 'Lost', w: '36px', from: 'md', tip: 'Claims lost to a manager with better waiver priority', cell: (r) => r.lost },
    { label: 'FA', w: '30px', from: 'md', tip: 'Free-agent signings', cell: (r) => r.free },
    { label: 'Trades', w: '46px', from: 'lg', cell: (r) => r.trades },
    { label: 'Net', w: '44px', tip: 'Points by players in minus players out, since each move', cell: (r) => (r.moves ? signed(r.net) : '–') },
    { label: 'Best move', w: '112px', from: 'lg', cls: 'c-left', cell: (r) => (r.best ? `${esc(player(r.best.in).name)} <span class="muted">${signed(r.best.net)}</span>` : '–') },
  ];
  return card({ title: 'Transfers by manager', body: dataTable(cols, rows) });
}

function movesByGwCard() {
  const data = D.transfers.byGw;
  if (!data.length) return '';
  const totals = data.map((d) => d.waiver + d.free + d.trade);
  const max = Math.max(1, ...totals);
  const bars = data
    .map((d, i) => {
      const tip = `GW ${d.gw}: ${plural(d.waiver, 'waiver')}, ${plural(d.free, 'free agent')}, ${plural(d.trade, 'trade')}`;
      return `<div class="bar-col" data-tip="${esc(tip)}"><div class="bar-track"><span class="bar-value">${totals[i]}</span><span class="bar" style="--share:${(totals[i] / max).toFixed(3)}"></span></div><span class="bar-label">${d.gw}</span></div>`;
    })
    .join('');
  return card({ title: 'Moves per gameweek', sub: 'Waivers, free agents and trades', body: `<div class="bars">${bars}</div>` });
}

function transferLogCard() {
  const items = feed().filter((item) => {
    if (state.logManager === 'all') return true;
    const id = Number(state.logManager);
    return item.move ? item.move.manager === id : item.trade.offeredBy === id || item.trade.offeredTo === id;
  });
  const chips = [chip('All', 'log', 'all', state.logManager === 'all'), ...D.managers.map((m) => chip(esc(m.first), 'log', m.id, state.logManager === String(m.id)))].join('');
  const groups = [];
  for (const item of items) {
    if (groups.at(-1)?.gw !== item.gw) groups.push({ gw: item.gw, items: [] });
    groups.at(-1).items.push(item);
  }
  const body = groups.length
    ? groups.map((g) => `<div class="date-head"><span>Gameweek ${g.gw}</span><span class="muted">${plural(g.items.length, 'move')}</span></div><div class="list">${g.items.map(feedRow).join('')}</div>`).join('')
    : empty('No transfers');
  return card({ title: 'Transfer log', body: `<div class="filter-bar">${chips}</div>${body}` });
}

function awardsCard() {
  const s = D.transfers.summary;
  const pick = (score) => s.reduce((a, b) => (score(b) > score(a) ? b : a), s[0]);
  const keeper = D.draft.retention.reduce((a, b) => (b.kept.length > a.kept.length ? b : a), D.draft.retention[0]);
  const awards = [
    ['Most active', pick((x) => x.moves), (x) => plural(x.moves, 'move')],
    ['Waiver wire king', pick((x) => x.waivers), (x) => `${plural(x.waivers, 'waiver')} won`],
    ['Unluckiest at the wire', pick((x) => x.lost), (x) => `${plural(x.lost, 'claim')} lost on waiver priority`],
    ['Sharpest eye', pick((x) => x.net), (x) => `${signed(x.net)} net from moves`],
    ['Set and forget', pick((x) => -x.moves), (x) => (x.moves ? plural(x.moves, 'move') : 'Not a single move')],
  ];
  const rows = awards.map(([title, winner, meta]) => listRow({ lead: avatar(winner.id, 32), title: `${title}`, meta: `${first(winner.id)} · ${meta(winner)}` }));
  if (keeper) rows.push(listRow({ lead: avatar(keeper.id, 32), title: 'Loyal to the draft', meta: `${first(keeper.id)} · ${keeper.kept.length} of ${keeper.size} picks kept` }));
  return card({ title: 'Awards', body: `<div class="list">${rows.join('')}</div>` });
}

function bestPickupsCard() {
  const rows = D.transfers.bestPickups.map((mv, i) =>
    listRow({
      lead: photo(mv.in),
      title: `${esc(player(mv.in).name)} ${crest(player(mv.in).club, 14)}`,
      meta: `${first(mv.manager)} · GW ${mv.gw} · for ${esc(player(mv.out).name)} · ${mv.banked} pts banked`,
      value: signed(mv.net),
      top: i === 0,
    }),
  );
  return card({ title: 'Best pickups', sub: 'Points since, minus the player dropped', body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing scored yet') });
}

function regretsCard() {
  const rows = D.transfers.regrets.map((mv, i) =>
    listRow({
      lead: photo(mv.out),
      title: `${esc(player(mv.out).name)} ${crest(player(mv.out).club, 14)}`,
      meta: `Dropped by ${first(mv.manager)} · GW ${mv.gw} · for ${esc(player(mv.in).name)}`,
      value: mv.outPts,
      top: i === 0,
    }),
  );
  return card({ title: 'The ones that got away', sub: 'Points scored since being dropped', body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing scored yet') });
}

function contestedCard() {
  const rows = D.transfers.contested.map((c) =>
    listRow({
      lead: photo(c.player),
      title: `${esc(player(c.player).name)} ${crest(player(c.player).club, 14)}`,
      meta: `GW ${c.gw} · won by ${first(c.winner)}${c.pts != null ? ` · ${c.pts} pts since` : ''}`,
      value: `<span class="stack">${c.claimants.map((id) => avatar(id)).join('')}</span>`,
    }),
  );
  return card({ title: 'Most wanted', sub: 'Waiver targets claimed by more than one manager', body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No contested claims yet') });
}

const TRADE_STATES = { o: 'Offered', a: 'Accepted', p: 'Processed', r: 'Rejected', w: 'Withdrawn', v: 'Vetoed', i: 'Invalid', e: 'Expired' };

function tradesCard() {
  const trades = D.transfers.trades;
  const names = (ids) => ids.map((pid) => `${esc(player(pid).name)}`).join(', ');
  const rows = trades.map((t) => {
    const net = (ids, outIds) => {
      if (t.gw > D.meta.lastFinishedGw) return '';
      const since = (pid) => (player(pid).pts ?? []).slice(t.gw - D.meta.firstGw).reduce((a, b) => a + b, 0);
      return ` <span class="muted">(${signed(sum(ids.map(since)) - sum(outIds.map(since)))})</span>`;
    };
    const gets = t.items.map((i) => i.gets);
    const gives = t.items.map((i) => i.gives);
    return `<div class="trade">
      <div class="trade-head">${avatar(t.offeredBy, 24)}<span>${first(t.offeredBy)}</span><span class="swap-icon">${swapSvg}</span>${avatar(t.offeredTo, 24)}<span>${first(t.offeredTo)}</span>${tag(TRADE_STATES[t.state] ?? t.state)}</div>
      <div class="trade-side"><span class="muted">${first(t.offeredBy)} gets</span> ${names(gets)}${net(gets, gives)}</div>
      <div class="trade-side"><span class="muted">${first(t.offeredTo)} gets</span> ${names(gives)}${net(gives, gets)}</div>
      <div class="trade-meta">GW ${t.gw} · ${ago(t.at)}</div>
    </div>`;
  });
  return card({ title: 'Trades', body: rows.length ? rows.join('') : empty('No trades yet') });
}

function waiverOrderCard() {
  const rows = D.transfers.waiverOrder.map((id, i) => listRow({ rank: i + 1, lead: avatar(id, 24), title: first(id), meta: esc(mgr(id).team) }));
  return card({ title: 'Waiver order', sub: `For gameweek ${D.meta.nextGw}`, body: `<div class="list">${rows.join('')}</div>` });
}

function hotPotatoesCard() {
  const potatoes = D.transfers.hotPotatoes.map((h) =>
    listRow({
      lead: photo(h.player),
      title: `${esc(player(h.player).name)} ${crest(player(h.player).club, 14)}`,
      meta: `Owned by ${h.owners.map((id) => first(id)).join(', ')}`,
      value: `<span class="stack">${h.owners.map((id) => avatar(id)).join('')}</span>`,
    }),
  );
  const dropped = D.transfers.mostDropped.map((d) =>
    listRow({ lead: photo(d.player), title: `${esc(player(d.player).name)} ${crest(player(d.player).club, 14)}`, meta: `${player(d.player).total} pts this season`, value: `${d.times}×` }),
  );
  return card({
    title: 'Hot potatoes',
    sub: 'Players who have been passed around',
    body: `${potatoes.length ? `<div class="list">${potatoes.join('')}</div>` : empty('Nobody has changed hands yet')}
      <div class="date-head"><span>Most dropped</span></div><div class="list">${dropped.join('')}</div>`,
  });
}

function viewDraft() {
  return `${originalSquadCard()}${draftBoardCard()}
  <div class="cols cols-even">
    <div class="col">${draftListCard('Steals', 'Second-half picks who have scored the most', stealPicks())}</div>
    <div class="col">${draftListCard('Busts', 'First three rounds, fewest points', bustPicks(), { highlight: false })}${draftHaulCard()}</div>
  </div>`;
}

function originalSquadCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.kept.length - a.kept.length || b.originalShare - a.originalShare);
  const labels = D.gameweeks.filter((g) => g.id >= D.meta.firstGw && g.id <= D.meta.currentGw).map((g) => `GW ${g.id}`);
  const body = rows
    .map((r) => {
      const open = state.openSquad === String(r.id);
      const values = [...r.byGw, r.kept.length];
      const playerChip = (pid, owner) => {
        const p = player(pid);
        const where = owner === undefined ? '' : owner ? avatar(owner) : tag('FA', 'Free agent now');
        return `<span class="pchip">${crest(p.club, 14)}${esc(p.name)} <span class="muted">${p.total}</span>${where}</span>`;
      };
      const detail = open
        ? `<div class="squad-detail">
            <div><div class="squad-head">Still there · ${r.kept.length}</div><div class="pchips">${r.kept.map((pid) => playerChip(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
            <div><div class="squad-head">Gone · ${r.gone.length}</div><div class="pchips">${r.gone.map((g) => playerChip(g.player, g.owner)).join('') || '<span class="muted">Nobody, yet</span>'}</div></div>
            <div><div class="squad-head">Signed since · ${r.newcomers.length}</div><div class="pchips">${r.newcomers.map((pid) => playerChip(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
          </div>`
        : '';
      return `<div class="squad-row${open ? ' open' : ''}">
        <button type="button" class="squad-summary" data-action="squad" data-value="${r.id}" aria-expanded="${open}">
          <span class="squad-who">${avatar(r.id, 32)}<span><span class="squad-name">${first(r.id)}</span><span class="squad-team">${esc(mgr(r.id).team)}</span></span></span>
          <span class="squad-count"><strong>${r.kept.length}</strong>/${r.size}</span>
          ${squadStrip(r)}
          ${sparkline(values, [...labels, 'Now'], r.size, slotOf(r.id))}
          <span class="squad-share" data-tip="Share of points scored in the XI by original draft picks">${pct(r.originalShare)} <span class="muted">of points</span></span>
          ${chevronSvg('down')}
        </button>
        ${detail}
      </div>`;
    })
    .join('');
  return card({ title: 'Original squad', sub: 'How much of each draft is still standing · tap a row for names', body: `<div class="squads">${body}</div>` });
}

function sparkline(values, labels, max, slot) {
  const w = 112;
  const h = 32;
  const pad = 5;
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v) => h - pad - (v / max) * (h - 2 * pad);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const hits = values
    .map((v, i) => `<rect x="${(x(i) - 6).toFixed(1)}" y="0" width="12" height="${h}" fill="transparent" data-tip="${labels[i]}: ${v} of ${max}"/>`)
    .join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Draft picks kept per gameweek">
    <line x1="${pad}" x2="${w - pad}" y1="${y(max)}" y2="${y(max)}" class="spark-grid"/>
    <polyline points="${points}" fill="none" stroke="var(--m${slot})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4" fill="var(--m${slot})" stroke="var(--card)" stroke-width="2"/>
    ${hits}
  </svg>`;
}

function draftBoardCard() {
  const picks = D.draft.picks;
  if (!picks.length) return '';
  const order = picks.filter((p) => p.round === 1).sort((a, b) => a.pick - b.pick).map((p) => p.manager);
  const rounds = Math.max(...picks.map((p) => p.round));
  const kept = new Map(D.draft.retention.map((r) => [r.id, new Set(r.kept)]));
  const head = `<div class="db-row db-head"><span></span>${order.map((id) => `<span>${avatar(id, 24)}<span class="db-name">${first(id)}</span></span>`).join('')}</div>`;
  const rows = Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const cells = order.map((id) => {
      const pk = picks.find((p) => p.manager === id && p.round === round);
      if (!pk) return '<span class="db-cell"></span>';
      const p = player(pk.player);
      const still = kept.get(id)?.has(pk.player);
      const owner = p.owner && p.owner !== id ? avatar(p.owner) : '';
      const tip = `#${pk.overall} · ${p.full} · ${p.total} pts${still ? '' : p.owner ? ` · now with ${mgr(p.owner)?.first}` : ' · free agent now'}${pk.auto ? ' · auto-pick' : ''}`;
      return `<span class="db-cell pos-${p.pos}${still ? '' : ' gone'}" data-tip="${esc(tip)}"><span class="db-player">${esc(p.name)}</span><span class="db-meta">${esc(club(p.club).short)} · ${p.pos} ${owner}</span></span>`;
    });
    return `<div class="db-row"><span class="db-round">${round}</span>${cells.join('')}</div>`;
  }).join('');
  const legend = `<div class="legend">${['GKP', 'DEF', 'MID', 'FWD'].map((pos) => `<span class="legend-item"><i class="pos-${pos}"></i>${pos}</span>`).join('')}<span class="legend-item"><i class="gone-key"></i>No longer with the manager who picked him</span></div>`;
  return card({ title: 'Draft board', sub: `${plural(rounds, 'round')}, snake order · faded picks have moved on`, body: `<div class="board" style="--managers:${order.length}"><div class="db-grid">${head}${rows}</div></div>${legend}` });
}

function stealPicks() {
  const half = D.draft.picks.length / 2;
  return D.draft.picks.filter((p) => p.overall > half).sort((a, b) => player(b.player).total - player(a.player).total).slice(0, 6);
}

function bustPicks() {
  return D.draft.picks.filter((p) => p.round <= 3).sort((a, b) => player(a.player).total - player(b.player).total).slice(0, 6);
}

function draftListCard(title, sub, picks, { highlight = true } = {}) {
  const rows = picks.map((pk, i) => {
    const p = player(pk.player);
    return listRow({ lead: photo(pk.player), title: `${esc(p.name)} ${crest(p.club, 14)}`, meta: `Round ${pk.round}, pick ${pk.overall} · ${first(pk.manager)}`, value: p.total, top: highlight && i === 0 });
  });
  return card({ title, sub, body: `<div class="list">${rows.join('')}</div>` });
}

function draftHaulCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.draftHaul - a.draftHaul);
  return card({
    title: 'Draft haul',
    sub: 'Season points of everyone each manager drafted, kept or not',
    body: `<div class="list">${rows.map((r, i) => listRow({ rank: i + 1, lead: avatar(r.id, 24), title: first(r.id), value: r.draftHaul, top: i === 0 })).join('')}</div>`,
  });
}

// --- Page chrome -----------------------------------------------------------------

// Between rounds the waiver run comes first, then the deadline; during a live
// gameweek the live chip replaces the deadline.
function statusChips() {
  const { meta } = D;
  const at = (iso) => `${fmtShortDay.format(new Date(iso))}, ${fmtTime.format(new Date(iso))}`;
  const waivers = meta.nextWaivers && countdown(meta.nextWaivers);
  const deadline = meta.nextDeadline && countdown(meta.nextDeadline);
  return [
    isLive() && `<span class="status-chip live"><i></i>Live · GW ${meta.currentGw}</span>`,
    waivers && `<span class="status-chip" data-tip="GW ${meta.nextGw} waivers process ${at(meta.nextWaivers)}">Waivers in <strong>${waivers}</strong></span>`,
    !isLive() && deadline && `<span class="status-chip" data-tip="GW ${meta.nextGw} deadline ${at(meta.nextDeadline)}">GW ${meta.nextGw} deadline in <strong>${deadline}</strong></span>`,
  ]
    .filter(Boolean)
    .join('');
}

function leagueHeader() {
  const { meta } = D;
  return `<section class="league-header">
    <div class="poster">
      <div class="league-logo">${trophySvg}</div>
      <div class="poster-text">
        <h1 class="league-name">${esc(meta.name)}</h1>
        <div class="league-sub">Premier League Draft · ${plural(D.managers.length, 'manager')}${isArchive() ? ' · final standings' : ''}</div>
      </div>
      <div class="poster-side">${statusChips()}${seasonChip()}</div>
    </div>
    <nav class="tabs" role="tablist">
      ${TABS.map((t) => `<a class="tab" role="tab" href="#${t.id}" data-tab="${t.id}" aria-selected="${state.tab === t.id}">${t.label}</a>`).join('')}
      <span class="tab-indicator"></span>
    </nav>
  </section>`;
}

const seasonSlug = (season) => season.replace('/', '-');
const seasonLabel = (season) => `${Number(season.slice(0, 4))}/${Number(season.slice(0, 4)) + 1}`;
const seasonEntry = () => seasons.find((s) => seasonSlug(s.season) === state.season);
const isArchive = () => Boolean(seasonEntry() && !seasonEntry().current);

// FotMob's season chip; it turns into a picker once there is more than one season.
function seasonChip() {
  if (seasons.length < 2) return `<span class="season-chip">${seasonLabel(D.meta.season)}</span>`;
  const options = seasons
    .map((s) => `<option value="${esc(seasonSlug(s.season))}"${s.season === D.meta.season ? ' selected' : ''}>${seasonLabel(s.season)}</option>`)
    .join('');
  return `<label class="season-chip season-select"><select data-action="season" aria-label="Season">${options}</select>${chevronSvg('down')}</label>`;
}

async function switchSeason(slug) {
  const entry = seasons.find((s) => seasonSlug(s.season) === slug);
  state.season = entry && !entry.current ? slug : null;
  const url = new URL(location.href);
  if (state.season) url.searchParams.set('season', state.season);
  else url.searchParams.delete('season');
  history.replaceState(null, '', url);
  Object.assign(state, { gw: null, openMatch: null, openSquad: null, logManager: 'all' });
  try {
    await loadData();
  } catch {
    return; // keep the season we have
  }
  renderAll();
  scheduleRefresh();
}

function renderAll() {
  document.getElementById('app').innerHTML = `${leagueHeader()}<div class="view" id="view"></div>`;
  document.getElementById('updated').textContent = `Updated ${fmtStamp.format(new Date(D.meta.generatedAt))}`;
  renderView();
}

function renderView() {
  const views = { overview: viewOverview, table: viewTable, fixtures: viewFixtures, stats: viewStats, transfers: viewTransfers, draft: viewDraft };
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab));
  document.getElementById('view').innerHTML = views[state.tab]();
  document.title = state.tab === 'overview' ? D.meta.name : `${TABS.find((t) => t.id === state.tab).label} · ${D.meta.name}`;
  placeTabIndicator();
  syncSettings();
}

function placeTabIndicator() {
  const active = document.querySelector('.tab[aria-selected="true"]');
  const bar = document.querySelector('.tab-indicator');
  if (!active || !bar) return;
  bar.style.width = `${active.offsetWidth}px`;
  bar.style.left = `${active.offsetLeft}px`;
}

function readRoute() {
  const [tab, arg] = location.hash.slice(1).split('/');
  state.tab = TABS.some((t) => t.id === tab) ? tab : 'overview';
  if (state.tab === 'fixtures' && arg) state.gw = Number(arg) || state.gw;
}

function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The installed app's status bar follows the top bar.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1a1a' : '#ffffff');
}

function syncSettings() {
  for (const button of document.querySelectorAll('#settings-menu [data-action]')) {
    button.setAttribute('aria-pressed', String(state[button.dataset.action] === button.dataset.value));
  }
}

// --- Events ------------------------------------------------------------------------

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, value } = target.dataset;
  if (action === 'theme') {
    state.theme = value;
    store.set('draft.theme', value);
    applyTheme();
    syncSettings();
  } else if (action === 'odds') {
    state.odds = value;
    store.set('draft.odds', value);
    renderView();
  } else if (action === 'table-mode') {
    state.tableMode = value;
    store.set('draft.tableMode', value);
    renderView();
  } else if (action === 'table-view') {
    state.tableView = value;
    if (state.tab === 'table') withRowMoves(renderView);
  } else if (action === 'gw') {
    goToGameweek(Number(value));
  } else if (action === 'log') {
    state.logManager = value;
    renderView();
  } else if (action === 'squad') {
    state.openSquad = state.openSquad === value ? null : value;
    renderView();
  } else if (action === 'match') {
    if (target.dataset.go) {
      // A form pill: open that week's match on the Fixtures tab.
      const gw = Number(value);
      const opp = Number(target.dataset.a);
      const m = D.matches.find((x) => x.gw === gw && (x.home === opp || x.away === opp));
      state.openMatch = m ? matchKey(m) : null;
      state.gw = gw;
      location.hash = `fixtures/${gw}`;
      return;
    }
    state.openMatch = state.openMatch === value ? null : value;
    renderView();
  }
}

// FotMob's table reorder (its AnimatedList, which replaced FlipMove): rows that stay
// slide from their old spot over 350ms ease-in-out, each 20ms slower than the row
// above; rows that appear or disappear just do so.
function withRowMoves(render) {
  const rows = () => [...document.querySelectorAll('.ftable .trow[data-key]')];
  const before = new Map(rows().map((row) => [row.dataset.key, row.getBoundingClientRect().top]));
  render();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  rows().forEach((row, i) => {
    const top = before.get(row.dataset.key);
    const dy = top == null ? 0 : top - row.getBoundingClientRect().top;
    if (dy) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 350 + i * 20, easing: 'ease-in-out' });
  });
}

function goToGameweek(gw) {
  state.gw = gw;
  state.openMatch = null;
  history.replaceState(null, '', `#fixtures/${gw}`);
  renderView();
}

function bindChrome() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-action="gw-select"]')) goToGameweek(Number(event.target.value));
    if (event.target.matches('[data-action="season"]')) switchSeason(event.target.value);
  });
  window.addEventListener('hashchange', () => {
    closeMenu();
    readRoute();
    renderView();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('resize', placeTabIndicator);
  document.fonts?.ready.then(placeTabIndicator);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && applyTheme());

  const button = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.settings')) closeMenu();
    if (!event.target.closest('.search')) document.getElementById('search-results').hidden = true;
  });
  document.addEventListener('keydown', (event) => event.key === 'Escape' && closeMenu());

  bindSearch();
  bindTooltips();
}

function closeMenu() {
  document.getElementById('settings-menu').hidden = true;
  document.getElementById('settings-btn').setAttribute('aria-expanded', 'false');
}

function bindSearch() {
  const input = document.getElementById('search');
  const panel = document.getElementById('search-results');
  const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const show = () => {
    const q = fold(input.value.trim());
    if (q.length < 2 || !D) {
      panel.hidden = true;
      return;
    }
    const hits = Object.entries(D.players)
      .filter(([, p]) => fold(`${p.name} ${p.full}`).includes(q))
      .sort((a, b) => (b[1].owner ? 1 : 0) - (a[1].owner ? 1 : 0) || b[1].total - a[1].total)
      .slice(0, 8);
    panel.innerHTML = hits.length
      ? hits
          .map(([pid, p]) => {
            const owner = p.owner ? `<span class="sr-owner">${avatar(p.owner, 24)}<span>${first(p.owner)}</span></span>` : tag('Free agent');
            const flag = p.status !== 'a' ? ` · ${esc(p.news || 'flagged')}` : '';
            return `<div class="sr">${photo(pid, 32)}<div class="sr-main"><div class="sr-name">${esc(p.name)}</div><div class="sr-meta">${crest(p.club, 14)} ${esc(club(p.club).short)} · ${p.pos} · ${p.total} pts${flag}</div></div>${owner}</div>`;
          })
          .join('')
      : empty('No players found');
    panel.hidden = false;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      panel.hidden = true;
      input.blur();
    }
  });
}

function bindTooltips() {
  const tip = document.getElementById('tooltip');
  let hideTimer = null;
  const show = (el) => {
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.tip ?? el.getAttribute('data-tip');
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const center = r.left + r.width / 2;
    const x = Math.min(Math.max(center, half + 8), window.innerWidth - half - 8);
    const below = r.top < tip.offsetHeight + 16;
    tip.classList.toggle('below', below);
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom : r.top}px`;
    tip.style.setProperty('--arrow', `${center - x}px`);
  };
  const hide = () => {
    tip.hidden = true;
  };
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const el = event.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('pointerout', (event) => {
    const el = event.target.closest('[data-tip]');
    if (el && !el.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('[data-tip]');
    if (event.pointerType !== 'touch' || !el) return hide();
    show(el);
    hideTimer = setTimeout(hide, el.classList.contains('info-btn') ? 10000 : 2500);
  });
  document.addEventListener('focusin', (event) => event.target.matches?.('[data-tip]') && show(event.target));
  document.addEventListener('focusout', (event) => event.target.matches?.('[data-tip]') && hide());
  // Scrolling hides a hover tip, but a focused element (keyboard) keeps its tip in place.
  window.addEventListener(
    'scroll',
    () => (!tip.hidden && document.activeElement?.matches?.('[data-tip]') ? show(document.activeElement) : hide()),
    { passive: true },
  );
}

// --- Data loading ------------------------------------------------------------------

async function loadSeasons() {
  try {
    const res = await fetch(`seasons/index.json?v=${Date.now()}`, { cache: 'no-store' });
    seasons = res.ok ? (await res.json()).seasons : [];
  } catch {
    seasons = []; // no archive yet: just the current season
  }
  const wanted = new URL(location.href).searchParams.get('season');
  state.season = seasons.some((s) => seasonSlug(s.season) === wanted && !s.current) ? wanted : null;
}

async function loadData() {
  const res = await fetch(`${seasonEntry()?.file ?? 'data.json'}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  lastFetch = Date.now();
  const changed = !D || data.meta.generatedAt !== D.meta.generatedAt;
  D = data;
  managers = new Map(D.managers.map((m, slot) => [m.id, { ...m, slot }]));
  return changed;
}

// Re-scores every live lineup from the relay's feed and patches the live matches.
function applyLive(feed) {
  const gw = D.meta.currentGw;
  const doubles = new Set(gwInfo(gw)?.doubles ?? []);
  const lineups = {};
  let points = () => 0;
  for (const m of D.managers) {
    const l = D.lineups[m.id]?.[gw];
    if (!l?.picks) continue;
    const scored = scoreLineup(l.picks, feed, (pid) => player(pid) ?? {}, D.meta.formation);
    const dgw = scored.xi.filter((pid) => doubles.has(player(pid)?.club)).length;
    points = scored.points;
    lineups[m.id] = { ...l, ...scored, dgw, adj: scored.pts - D.meta.dgwPenalty * dgw, benchPts: scored.bench.reduce((t, pid) => t + scored.points(pid), 0) };
  }
  live = { gw, feed, lineups, points };
  for (const m of D.matches) {
    if (m.gw !== gw || !m.started || m.finished) continue;
    m.homePts = lineups[m.home]?.pts ?? m.homePts;
    m.awayPts = lineups[m.away]?.pts ?? m.awayPts;
  }
}

const liveScores = () => JSON.stringify(D.matches.filter((m) => m.gw === D.meta.currentGw).map((m) => [m.homePts, m.awayPts]));

async function pollLive() {
  clearTimeout(liveTimer);
  if (!LIVE_URL || isArchive() || !isLive()) return;
  if (!document.hidden) {
    try {
      const res = await fetch(`${LIVE_URL}/live/${D.meta.currentGw}`, { cache: 'no-store' });
      if (res.ok) {
        const before = liveScores();
        applyLive(await res.json());
        if (liveScores() !== before) withRowMoves(renderView);
      }
    } catch {
      // Keep the last scores; data.json still refreshes on its own.
    }
  }
  const playing = live?.feed.fixtures.some((f) => f.started && !f.done);
  liveTimer = setTimeout(pollLive, playing ? LIVE_POLL_MS : LIVE_IDLE_MS);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (isArchive()) return; // archived seasons never change
  refreshTimer = setTimeout(async () => {
    await refresh();
    scheduleRefresh();
  }, isLive() ? LIVE_REFRESH_MS : REFRESH_MS);
}

async function refresh() {
  if (document.hidden || isArchive() || Date.now() - lastFetch < 60 * 1000) return;
  try {
    if (await loadData()) {
      if (live?.gw === D.meta.currentGw) applyLive(live.feed);
      renderAll();
      pollLive();
    }
  } catch {
    // Keep showing the data we already have.
  }
}

async function init() {
  applyTheme();
  bindChrome();
  navigator.serviceWorker?.register('sw.js').catch(() => {}); // makes it installable; optional
  try {
    await loadSeasons();
    await loadData();
  } catch (err) {
    document.getElementById('app').innerHTML = card({
      body: empty(`Could not load data.json (${esc(err.message)}). Build it with <code>node scripts/build-data.mjs</code> and serve this folder over HTTP.`),
    });
    return;
  }
  readRoute();
  renderAll();
  scheduleRefresh();
  pollLive();
  setInterval(() => {
    const side = document.querySelector('.poster-side');
    if (side && !document.hidden) side.innerHTML = statusChips() + seasonChip();
  }, 30 * 1000);
  document.addEventListener('visibilitychange', () => {
    refresh();
    if (!document.hidden && live) pollLive();
  });
}

// --- Icons -------------------------------------------------------------------------

const trophySvg = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="var(--brand-solid)"/><path d="M16 13h16v3h4v3a6 6 0 0 1-5.2 5.95A8 8 0 0 1 25.5 30v3H30v3H18v-3h4.5v-3a8 8 0 0 1-5.3-5.05A6 6 0 0 1 12 19v-3h4v-3Zm0 6v-.5h-1.5V19a3 3 0 0 0 1.6 2.66A8 8 0 0 1 16 21v-2Zm16 2c0 .23-.01.45-.03.67A3 3 0 0 0 33.5 19v-.5H32V21Z" fill="#fff"/></svg>`;
const swapSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2 1 5.5 4.5 9V6.5H11v-2H4.5V2Zm7 5v2.5H5v2h6.5V14L15 10.5 11.5 7Z" fill="currentColor"/></svg>`;
const infoSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>`;
const triangleSvg = `<svg class="tri" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1.5 7.5 6.5h-7Z" fill="currentColor"/></svg>`;
const arrowSvg = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 7H7.5v3.5h-3V7h-3L6 1.5Z" fill="currentColor"/></svg>`;
function chevronSvg(direction) {
  const paths = { left: 'M10 3 5 8l5 5', right: 'M6 3l5 5-5 5', down: 'M3 6l5 5 5-5' };
  return `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[direction]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

init();

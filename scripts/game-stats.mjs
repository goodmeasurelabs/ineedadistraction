// Which games are doing well: one row per game from GA4.
//   node scripts/game-stats.mjs        last 7 days
//   node scripts/game-stats.mjs 30     last 30 days
//   node scripts/game-stats.mjs 1      today and yesterday
// Needs the custom dimensions from ga-setup.mjs; events sent before those were
// registered cannot be split by game. Today's numbers can lag by a few hours.
import { PROPERTY, accessToken, google } from './ga-auth.mjs';

const days = Math.max(1, Number(process.argv[2]) || 7);
const token = await accessToken('https://www.googleapis.com/auth/analytics.readonly');

async function report(dimensions, metrics, events) {
  const data = await google(token, `https://analyticsdata.googleapis.com/v1beta/${PROPERTY}:runReport`, {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: events } } },
    limit: 10000,
  });
  return (data.rows ?? []).map((row) => ({
    ...Object.fromEntries(dimensions.map((name, i) => [name, row.dimensionValues[i].value])),
    ...Object.fromEntries(metrics.map((name, i) => [name, Number(row.metricValues[i].value)])),
  }));
}

const GAME = 'customEvent:game_id';
const games = new Map();
const game = (id) => {
  if (!games.has(id)) games.set(id, { players: 0, plays: 0, replays: 0, completes: 0, quits: 0, scoreSum: 0, playS: 0, bests: 0, shares: 0, agentPlays: 0 });
  return games.get(id);
};
const known = (id) => id && id !== '(not set)';

const [byEvent, byReplay, byAgent, byBest, shares] = await Promise.all([
  report([GAME, 'eventName'], ['eventCount', 'totalUsers', 'customEvent:play_s', 'customEvent:score'], ['game_start', 'game_complete', 'game_quit']),
  report([GAME, 'customEvent:replay'], ['eventCount'], ['game_start']),
  report([GAME, 'customEvent:agent_mode'], ['eventCount'], ['game_start']),
  report([GAME, 'customEvent:new_best'], ['eventCount'], ['game_complete']),
  report(['customEvent:content_id'], ['eventCount'], ['share_click']),
]);

for (const row of byEvent) {
  if (!known(row[GAME])) continue;
  const g = game(row[GAME]);
  if (row.eventName === 'game_start') { g.plays = row.eventCount; g.players = row.totalUsers; }
  if (row.eventName === 'game_complete') { g.completes = row.eventCount; g.scoreSum = row['customEvent:score']; }
  if (row.eventName === 'game_quit') g.quits = row.eventCount;
  if (row.eventName !== 'game_start') g.playS += row['customEvent:play_s'];
}
for (const row of byReplay) if (known(row[GAME]) && row['customEvent:replay'] === 'true') game(row[GAME]).replays = row.eventCount;
for (const row of byAgent) if (known(row[GAME]) && row['customEvent:agent_mode'] === 'true') game(row[GAME]).agentPlays = row.eventCount;
for (const row of byBest) if (known(row[GAME]) && row['customEvent:new_best'] === 'true') game(row[GAME]).bests = row.eventCount;
for (const row of shares) if (games.has(row['customEvent:content_id'])) game(row['customEvent:content_id']).shares = row.eventCount;

if (!games.size) {
  console.log(`No per-game events in the last ${days} day(s). Events only split by game from the day the dimensions were registered, and reports lag a few hours.`);
  process.exit(0);
}

const rows = [...games.entries()].sort((a, b) => b[1].playS - a[1].playS || b[1].plays - a[1].plays).map(([id, g]) => ({
  game: id,
  players: g.players,
  plays: g.plays,
  'plays/player': g.players ? (g.plays / g.players).toFixed(1) : '-',
  replays: g.replays,
  completes: g.completes,
  quits: g.quits,
  'avg score': g.completes ? Math.round(g.scoreSum / g.completes) : '-',
  'new bests': g.bests,
  'play min': (g.playS / 60).toFixed(1),
  'min/player': g.players ? (g.playS / 60 / g.players).toFixed(1) : '-',
  shares: g.shares,
  'agent plays': g.agentPlays,
}));
console.log(`Games, last ${days} day(s), most played first:`);
console.table(rows);

// Register the event parameters the site sends as GA4 custom dimensions and
// metrics. GA4 collects parameters either way, but only registered ones can be
// used in reports, and only from the day they are registered. Safe to re-run:
// it creates what is missing and leaves the rest alone.
//   node scripts/ga-setup.mjs          create anything missing
//   node scripts/ga-setup.mjs --check  only list what is missing
import { PROPERTY, accessToken, google } from './ga-auth.mjs';

const DIMENSIONS = {
  game_id: 'Which game the event is about',
  mode: 'endless or daily',
  replay: 'true when the run was started with "play again"',
  resumed: 'true when a saved run was picked up again',
  agent_mode: 'true when the browser is paired with the coding-agent plugin',
  new_best: 'true when the run beat the player\'s best score',
  source: 'Where a game was opened from',
  location: 'Which surface a break game was played on',
  pick_id: 'What the Distract me button picked',
  pick_kind: 'Kind of thing the Distract me button picked',
  content_type: 'Kind of content shared or engaged with',
  content_id: 'Which content was shared or engaged with',
  method: 'How something was shared',
  cta_text: 'Label of the call to action clicked',
  cta_location: 'Where the call to action sits',
};
const METRICS = {
  score: ['Final or current score of a run', 'STANDARD'],
  play_s: ['Seconds actively played (pauses excluded)', 'SECONDS'],
  duration_s: ['Seconds from the start of a run to its game over', 'SECONDS'],
  elapsed_ms: ['Milliseconds from page load to the first input', 'MILLISECONDS'],
};

const check = process.argv.includes('--check');
const token = await accessToken('https://www.googleapis.com/auth/analytics.edit');
const admin = `https://analyticsadmin.googleapis.com/v1beta/${PROPERTY}`;
const haveDimensions = new Set(((await google(token, `${admin}/customDimensions?pageSize=200`)).customDimensions ?? []).map((d) => d.parameterName));
const haveMetrics = new Set(((await google(token, `${admin}/customMetrics?pageSize=200`)).customMetrics ?? []).map((m) => m.parameterName));

for (const [name, description] of Object.entries(DIMENSIONS)) {
  if (haveDimensions.has(name)) { console.log(`dimension ${name}: already registered`); continue; }
  if (check) { console.log(`dimension ${name}: MISSING`); continue; }
  await google(token, `${admin}/customDimensions`, { parameterName: name, displayName: name, description, scope: 'EVENT' });
  console.log(`dimension ${name}: created`);
}
for (const [name, [description, measurementUnit]] of Object.entries(METRICS)) {
  if (haveMetrics.has(name)) { console.log(`metric ${name}: already registered`); continue; }
  if (check) { console.log(`metric ${name}: MISSING`); continue; }
  await google(token, `${admin}/customMetrics`, { parameterName: name, displayName: name, description, scope: 'EVENT', measurementUnit });
  console.log(`metric ${name}: created`);
}

import { BREAK_GAMES } from './breakGames';
import { dailyChallenge, utcDate } from './daily';
import { AT_WORK, BRAIN_BREAK, FIVE_MINUTE } from './landings';
import { SITE_URL } from './share';

export function buildLlmsTxt(today: string = utcDate()): string {
  const daily = dailyChallenge(today);
  const landing = [BRAIN_BREAK, AT_WORK, FIVE_MINUTE].map((page) => `- [${page.title}](${SITE_URL}${page.path}): ${page.intro}`);
  return [
    '# I Need a Distraction',
    '',
    '> The break button: one press gives you a tiny browser game sized for a break (about 2 minutes), ending on one score you can share. Free, no sign-up, no sound, no ads. There is also a daily challenge that is the same for everyone each day, and an AI game maker whose published player games join the button.',
    '',
    '## Start here',
    `- [Distract me (home)](${SITE_URL}/): press one button, get a random tiny game, then "Another one" or "Back to work".`,
    `- [Daily challenge](${SITE_URL}/daily): one named, scored game per day (UTC), the same for everyone. Today is Daily #${daily.number}: ${daily.title}.`,
    `- [All games](${SITE_URL}/games): every game, each with its own page.`,
    '',
    '## Games',
    ...BREAK_GAMES.map((game) => `- [${game.name}](${SITE_URL}/games/${game.slug}): ${game.tagline} ${game.roundLabel}; scored in ${game.scoreLabel} (${game.better} is better).`),
    '',
    '## Pages for a specific kind of break',
    ...landing,
    '',
    '## Make a game',
    `- [AI game maker](${SITE_URL}/make-a-game): describe a small game, play what AI builds, publish it with an account. Published games can be remixed when their creator allows it.`,
    '',
    '## Facts',
    '- Playing needs no account. Publishing a made game needs an account.',
    '- Scores are kept in the player\'s browser; there is no public leaderboard.',
    '- Games are silent and work with touch, mouse or keyboard.',
    `- [Privacy](${SITE_URL}/privacy) · [Terms](${SITE_URL}/terms) · [Sitemap](${SITE_URL}/sitemap.xml)`,
    '',
  ].join('\n');
}

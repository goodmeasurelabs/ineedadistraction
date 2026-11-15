import type { LandingConfig } from '../components/BreakLanding';

export const BRAIN_BREAK: LandingConfig = {
  path: '/brain-break-games',
  eyebrow: 'FOR TEACHERS · WHOLE-CLASS BRAIN BREAKS',
  title: 'Brain break games for the whole class',
  intro: 'Quick, silent games you can put on the projector for a two to five minute reset. The whole class guesses, counts or calls out together, then you get back to the lesson. No student logins, nothing to install.',
  mode: 'class',
  slugs: ['dot-flash', 'stop-the-clock', 'split-the-bar', 'number-hunt', 'color-recall', 'keep-the-rhythm'],
  points: ['Works on a projector or smartboard', 'No student accounts or logins', 'No ads and no sound', 'Each round takes under two minutes'],
  faq: [
    { q: 'Do students need accounts?', a: 'No. Nobody signs in to play. You open the page on the classroom screen and press start.' },
    { q: 'How long does a brain break take?', a: 'Each game round takes between 20 seconds and about a minute. Two or three rounds make a three to five minute break.' },
    { q: 'How do I play with the whole class?', a: 'Put the game on the projector and let the class decide together: vote on where to cut the bar, shout out a dot estimate, or count the seconds silently while one student presses stop.' },
    { q: 'Are there ads or sounds?', a: 'No ads, and none of these games make sound. We count anonymous page visits with Google Analytics to see which games get played; students never type in personal information. See the privacy policy for details.' },
  ],
  gameNote: (game) => `${game.roundLabel} · ${game.classroom}`,
};

export const AT_WORK: LandingConfig = {
  path: '/games-to-play-at-work',
  eyebrow: 'FOR A BREAK AT YOUR DESK',
  title: 'Games to play at work',
  intro: 'Small, silent games for a real break between tasks. Each one takes under two minutes, keeps a visible break timer, and one press of Esc swaps it for a plain document. Then you go back to work.',
  mode: 'work',
  slugs: ['stop-the-clock', 'number-hunt', 'split-the-bar', 'green-means-go', 'color-recall', 'dot-flash', 'keep-the-rhythm', 'orbit-pop'],
  points: ['Silent: no game here makes sound', 'Visible break timer so a break stays a break', 'Esc hides the game behind a plain document', 'No sign-up, nothing to install'],
  faq: [
    { q: 'Will it make noise?', a: 'No. None of these games play sound, so you can play in an open office or on a call with your camera off.' },
    { q: 'How do I hide the game quickly?', a: 'Press Esc, or the Hide screen button. The page is covered by a plain document. Press Esc again or click to come back.' },
    { q: 'How long is a round?', a: 'Between 20 seconds and about a minute. The timer at the top shows how long you have been on break.' },
    { q: 'Do I need to install or sign up?', a: 'No. Everything runs in the browser tab. There is no account and your scores stay in your browser.' },
  ],
  gameNote: (game) => `${game.roundLabel} · silent`,
};

export const FIVE_MINUTE: LandingConfig = {
  path: '/5-minute-games',
  eyebrow: 'WHEN YOU HAVE FIVE MINUTES',
  title: '5-minute games',
  intro: 'Got five minutes? Play two or three of these. Every game takes under two minutes, ends on one score, and needs no sign-up or download. Beat your own number or send it to a friend.',
  mode: 'quick',
  slugs: ['orbit-pop', 'stop-the-clock', 'dot-flash', 'number-hunt', 'green-means-go', 'split-the-bar', 'color-recall', 'keep-the-rhythm'],
  points: ['Each game is under two minutes', 'Ends on one score you can share', 'Free, no sign-up, no download', 'A new daily challenge every day'],
  faq: [
    { q: 'Are these really under five minutes?', a: 'Yes. Each round takes between 20 seconds and about a minute, so you can play two or three games in five minutes.' },
    { q: 'Do they work on my phone?', a: 'Yes. Every game works with a finger, a mouse or a keyboard.' },
    { q: 'Can I challenge a friend?', a: 'Yes. When a round ends, press Share my score. Your friend opens the same game with your score to beat.' },
    { q: 'Is there something new every day?', a: 'Yes. The daily challenge changes every day at midnight UTC and is the same for everyone.' },
  ],
  gameNote: (game) => `${game.roundLabel} · scored in ${game.scoreLabel}`,
};

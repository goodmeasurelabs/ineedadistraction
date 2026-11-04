# I Need a Distraction

A fun, interactive website designed to give people a quick mental break during their day. Perfect for when you need a distraction from work!

## What it is

**The break button.** One press gives you a tiny game sized for a break (about 2 minutes) that ends on one score you can share. Then "Another one" or "Back to work".

- **Home (`/`)**: the "Distract me" button. It picks a random game from the break games (each pick is a freshly seeded variant) plus published player-made games, never the same one twice in a row (`app/lib/distract.ts`).
- **Daily (`/daily`, `/daily/<date>`)**: one named, scored challenge per UTC day, the same for everyone, derived from the date only (`app/lib/daily.ts`). No server state, no cron, no AI call. Share card at `/daily/<date>/card?score=<n>`.
- **Named game pages (`/games/<slug>`)**: one indexable page per game, ending on a shareable score with a card at `/games/<slug>/card?score=<n>`. Games live in `app/lib/breakGames.ts` as self-contained, silent, offline HTML documents run in a sandboxed iframe.
- **Landing pages**: `/brain-break-games` (teachers, projector mode), `/games-to-play-at-work` (silent, break timer, Esc hides the game), `/5-minute-games`.
- **AI game maker (`/make-a-game`, `/template/<id>`)**: the supply side. Published player games join the button and carry a "Made on I Need a Distraction" link.
- **`/llms.txt` and `/sitemap.xml`** list every public page.
- **Launch habit**: weekly clip kits in `docs/launch/` (drafts only, never auto-posted).

### Game document contract
Each break game posts `{source: 'inad-game', slug, event, score?}` to its parent (`ready`, `start`, `replay`, `complete`, `hide`) and accepts `{source: 'arcade-host', event: 'start' | 'ready-request'}`. Frames are sandboxed with `allow-scripts` only, so games must not use `<form>` submission, storage, network or sound.

### Analytics (GA4, `app/lib/analytics.ts`)
New events: `distract_me_click`, `another_one_click`, `back_to_work_click`, `daily_start`, `daily_complete`, `remix_ref_visit`. Existing names are reused: `game_start`, `game_complete`, `first_play`, `share_click`, `cta_click`, `game_open`, `challenge_open`.

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Modern utility-first styling
- **React 19** - Latest React features

## Getting Started

### Development
```bash
npm run dev
```
Visit [http://localhost:3000](http://localhost:3000)

### Checks
```bash
npm run typecheck
npm test
npm run build            # also runs prisma migrate deploy (needs the database env)
node scripts/launch-smoke.mjs http://localhost:3107   # against a running server with a database
```

## Design Features

- Fully responsive design (mobile-first)
- Dark mode support
- Smooth animations and transitions
- Gradient backgrounds and modern UI
- Accessible and user-friendly

## Future Monetization Ideas

- Ad placement on fact pages (low intrusion)
- Premium features (ad-free experience)
- Daily leaderboards for memory game
- More game modes and puzzles
- Social sharing features

## Deployment

This can be easily deployed to:
- **Vercel** (recommended for Next.js)
- **Netlify**
- **AWS Amplify**
- Any platform supporting Node.js

Just connect your git repository and deploy!

## Domain

Ready to deploy to: **ineedadistraction.com**

---

Built with Claude Code

# I Need a Distraction

Games built to be hard to put down, at [ineedadistraction.com](https://www.ineedadistraction.com). Play in the browser, or pair it with your coding agent and play while it works.

## Play while your agent works (Codex and Claude Code)

The plugin tells the arcade whether your agent is working or waiting. The game pauses the moment the agent finishes a turn, asks a question or needs a permission, and resumes when you answer.

**Claude Code**

```
/plugin marketplace add goodmeasurelabs/ineedadistraction
/plugin install distraction@ineedadistraction
```

On Claude Code 2.1.275 or later this is one step: `/plugin install distraction --marketplace goodmeasurelabs/ineedadistraction`

**Codex**

```
codex plugin marketplace add goodmeasurelabs/ineedadistraction
codex plugin add distraction@ineedadistraction
```

Then review and trust the plugin's hooks in **Settings > Hooks** in Codex Desktop, or run `/hooks` in Codex CLI. Updates to the plugin's scripts may require a new review.

Send your agent any prompt and the arcade opens in your browser, already paired. Or ask it to "open my distraction".

On macOS, the paused game's **Back to Codex** button brings Codex Desktop forward. For Codex CLI and Claude Code, the button brings the terminal forward (including the correct iTerm tab).

Codex has its own hook configuration: ordinary tool calls keep the game running, questions pause it, and continued turns resume it if a Stop hook asks Codex to keep working. Background compaction and child-agent model requests do not resume a finished turn.

Asynchronous Codex questions remain paused while other work continues. A local Python 3 helper matches question IDs to structured replies in the latest 16 MB of the local transcript. It stores only call IDs, question counts and answered indices; no question or answer text leaves the machine. This transcript format is a compatibility interface: if Python or the metadata is unavailable, the game stays paused until a fresh prompt instead of assuming the question was answered.

Codex's permission hook fires before approval routing, so an automatic permission review can still briefly pause the game even when no human approval is needed. The turn's automatic-review setting alone cannot safely filter these events: some commands and connected-app requests can still require a human. The plugin therefore preserves permission notifications.

**What the plugin sends:** the word `working`, `waiting` or `idle`; a one-word reason; which agent it is; a checksum of the session id (so several agents can be told apart); and a random pairing token generated on your machine. Never prompts, file paths, code or tool input. Source: [`plugin/scripts/state.sh`](plugin/scripts/state.sh).

**Controls:** `touch ~/.config/ineedadistraction/no-auto-open` stops the arcade opening by itself; `touch ~/.config/ineedadistraction/off` turns the sync off.

## The games

| Game | What it is |
|---|---|
| Afterglow | One click sets off a chain reaction. Clear each wave's quota, pick an upgrade. |
| Tessel | Untimed shape placing. Clear rows and columns, keep the streak. |
| Critical Mass | Drop numbered cores; equal ones fuse and double. |
| Prime Time | Build number hands, stack multipliers, collect rule-bending charms. |

Game code lives in `app/games/<slug>/`; the shared stage (frame loop, pause, bloom, sound, saving, Agent Mode) is in `app/games/engine/`.

---

## Earlier README


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

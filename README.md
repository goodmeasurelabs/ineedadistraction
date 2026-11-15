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

Then run `/hooks` in Codex once to review and trust the plugin's hooks.

Send your agent any prompt and the arcade opens in your browser, already paired. Or ask it to "open my distraction".

**What the plugin sends:** the word `working`, `waiting` or `idle`; a one-word reason; which agent it is; and a random pairing token generated on your machine. Never prompts, file paths, code or tool input. Source: [`plugin/scripts/state.sh`](plugin/scripts/state.sh).

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

## Features

### 1. Daily Brain Teaser
- New riddle every day (rotates based on the date)
- Hint system to help when stuck
- Instant feedback on answers
- Clean, engaging interface

### 2. Memory Match Game
- Classic card matching game with emoji cards
- Track your moves and time
- 8 pairs to match
- Satisfying animations and feedback

### 3. Random Facts Generator
- 25+ fascinating facts across multiple categories
- Categories include: Nature, Animals, History, Science, Space, Geography, and more
- Beautiful color-coded categories
- Infinite exploration - keep clicking for more facts!

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

### Build for Production
```bash
npm run build
npm start
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

# ineedadistraction — Data Dive Site

This is **ineedadistraction**, an AI-powered platform for creating and remixing community mini-games. It's part of [Operation Data Dive](https://data-dive-sean-tarzys-projects.vercel.app) — Sean's cross-site analytics framework.

## Quick stats lookup

Before answering questions about traffic, engagement, or user behavior, fetch live data:
```bash
API_KEY=$(grep API_KEY ~/Development/code/data-dive/.env.local | cut -d= -f2)
curl -s -H "X-API-Key: $API_KEY" "https://data-dive-sean-tarzys-projects.vercel.app/api/status/ineedadistraction?period=7d"
```

## Which games are doing well

```bash
npm run stats        # one row per game, last 7 days
npm run stats -- 30  # last 30 days
```

Players, plays, replays, completions, quits, average score, minutes played and shares per game, straight from GA4 (`scripts/game-stats.mjs`). It uses the same service account as Data Dive.

- Every game event carries `game_id`. Runs report `game_start`, then `game_complete` (game over) or `game_quit` (left mid-run); both carry `play_s`, the seconds actively played, so they add up to total play time. `agent_mode` is true when the browser is paired with the plugin.
- GA4 only reports on event parameters that are registered as custom dimensions or metrics, and only from the day they were registered (2026-11-15 for the current set). When you add a parameter worth reporting on, add it to `scripts/ga-setup.mjs` and run `npm run ga:setup`.
- To keep your own play out of the numbers, open the site once with `?notrack=1` in each browser you use, including the plugin's pop-up (it has its own browser profile). `?notrack=0` undoes it.

## Site facts

- **GA4 property:** `properties/529426996` (measurement ID via `GOOGLE_MEASUREMENT_ID` env var — note: not `NEXT_PUBLIC_` prefixed)
- **Category:** interactive-tool
- **Framework:** Next.js 16 App Router, uses Clerk auth, Anthropic SDK for AI generation
- **Analytics module:** `app/lib/analytics.ts` — Tier 1 universal + interactive-tool Tier 2

## Site-specific gotchas

- Home is the "Distract me" break button (`app/components/BreakButton.tsx`). Break games live in `app/lib/breakGames.ts`; the daily is pure date math in `app/lib/daily.ts`. Keep both deterministic and free of network/AI calls.
- Game iframes are `sandbox="allow-scripts"` only: no `<form>` submit, no storage, no sound in game documents.
- Launch kits go in `docs/launch/` as drafts. Never post anything.

- Auth is via Clerk (`@clerk/nextjs`)
- AI game generation via Anthropic API in `/api/create`
- Heavy interaction tracking on `WidgetCard` (play, vote, share, remix), `CreateModal` (template selection), `template/[id]/page.tsx` (remix generation, publish)

For full Data Dive context see `~/.claude/CLAUDE.md`.

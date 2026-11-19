# I Need a Distraction

Games built to be hard to put down, at [ineedadistraction.com](https://www.ineedadistraction.com). Play in the browser, or pair it with your coding agent and play while it works.

## Play while your agent works (Codex and Claude Code)

The game pauses when the turn you are waiting for finishes or an agent needs input. Resume this game to dismiss the interruption, open a recent chat to review its result, or use the input queue to return to a question or approval.

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

On macOS, the return button opens the selected Codex Desktop chat or the originating iTerm pane for Codex CLI and Claude Code. Other terminals can come forward at the app level. A closed iTerm pane falls back to opening its app.

Codex has its own hook configuration: ordinary tool calls keep the game running, questions pause it, and continued turns resume it if a Stop hook asks Codex to keep working. Background compaction and child-agent model requests do not resume a finished turn.

Asynchronous Codex questions remain paused while other work continues. A local Python 3 helper matches question IDs to structured replies in the latest 16 MB of the local transcript. It stores only call IDs, question counts and answered indices; no question or answer text leaves the machine. This transcript format is a compatibility interface: if Python or the metadata is unavailable, the game stays paused until a fresh prompt instead of assuming the question was answered.

Codex's permission hook fires before its automatic reviewer. Shell and patch permission checks therefore keep the game running in automatic-review or don't-ask modes. The helper checks the current turn's local approval metadata; missing, stale or unfamiliar metadata preserves the pause. Explicit questions, manual-review checks and connected-app approval requests still pause the game. This changes only game notifications, never Codex's approval decisions. Human-only command or category-policy overrides can still require approval in automatic mode; those use Codex's own approval prompt without a game pause.

The plugin reports the state and reason, agent label, checksum of the session ID, opaque event ID, timestamps, and return target type using a locally generated pairing token. Chat titles, contents, and actual chat or terminal pane IDs stay on the machine. See [state.sh](plugin/scripts/state.sh).

**Controls:** Say **“Stop distracting”** to persistently stop automatic popups, or **“Keep distracting”** to enable them again. The popup has the same controls and a **Change games** drawer. **Resume this game** only dismisses the current interruption.

Plugin 0.5.0 adds a versioned preferences helper (Python 3 required):

```sh
python3 <installed-plugin>/scripts/settings.py off
python3 <installed-plugin>/scripts/settings.py on
python3 <installed-plugin>/scripts/settings.py set --categories merge,logic --pace untimed --sound false
python3 <installed-plugin>/scripts/settings.py show
python3 <installed-plugin>/scripts/settings.py sync
```

Settings apply to this paired computer across Codex and Claude Code. Local commands apply immediately and retry pending synchronization; the popup confirms a durable change only after the local plugin acknowledges it. Off suppresses automatic opening and game notifications while retaining current agent status and a control connection. Older `off`/`no-auto-open` flags migrate to Off; use the helper to turn it back on.

Website setup stays at `/agent`; the focused popup starts at `/arcade`. Its separate browser profile receives the chosen mix through the plugin. `open.sh` starts a settings listener even when Off or return-to-agent is disabled. It stops after five minutes without an attached player and restarts on explicit opening or a new prompt. `open.sh --print` only prints the link.

The paired Chromium popup opens at 460×800, or smaller on a small display. Choose **Family Guy clips** to play video between the agent header and playback controls. Drag any window edge to resize the player. The popup remembers your choice of clips or games and plays automatically on subsequent launches. A question or approval pauses the clip. It continues from your place when the agent goes back to work. A new prompt, reopening the popup, or pressing **Next clip** advances the rotation. The popup remembers recent clips on this device and offers all three official uploads before repeating one when all are playable. **Stop distracting** also works while YouTube is loading.

**Updating:** In Codex, run `codex plugin marketplace upgrade ineedadistraction`, then `codex plugin add distraction@ineedadistraction`. In Claude Code, run `claude plugin marketplace update ineedadistraction`, then `claude plugin update distraction@ineedadistraction`. Follow any client restart or hook-review instructions, then refresh the distraction popup once (Cmd+R / Ctrl+R) to load the new controls. Opening it again only brings the existing window forward. Older plugins can still play while being updated.

Legacy approval records without event or return metadata become unconfirmed history after 30 minutes. They remain clearable, but do not interrupt new work. Current versioned approvals and questions retain their normal queue behavior.

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

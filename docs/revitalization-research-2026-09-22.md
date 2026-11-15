# A better little escape

Research and implementation review: September 22, 2026 (America/New_York).

The strongest direction for I Need a Distraction is a playful destination where a visitor can **play immediately, change something, and share the result**. Creation becomes an extension of having fun. A new model can help, but the first delightful moment should not depend on a generation request.

## What the existing product tells us

I reviewed the live site, dashboard, cards, play page, template editor, creation/chat/step APIs, templates, analytics, and database fallback/seed code.

- `/` redirects to `/dashboard`. The former hero emphasized creating and registering. Actual play was below it. Cards often made Remix more prominent than Play.
- The live catalog had nine games during the review. Several were math/trivia variants. This is an observed catalog snapshot, not a representative measure of audience demand.
- The seven-day Data Dive response, fetched at `2026-09-23T02:37:02.935Z`, reported zero users, sessions, pageviews, and events. This could mean little traffic or a measurement problem. It does **not** establish that nobody used the site, nor does it identify a winning genre. Some game-page counters were nonzero, and their time window is different.
- Built-in vote counts were seeded in `prisma/seed.ts` and `app/lib/store.ts`. Ranking the homepage by those totals and calling it Trending created a misleading discovery signal.
- Generation uses Sonnet 4.6, followed by Haiku QA and metadata extraction. It returns one final JSON response; server-side model streaming does not make the game progressively playable in the browser.
- Complex plans call `/api/create/step` once per step, each returning the complete HTML. The editor intentionally holds the visible game steady until all steps finish. More plan steps can mean substantially more waiting; comments estimating 30–90 seconds per step are not live performance measurements.
- QA reviews only the first 6,000 characters, and failures return no issues. That is a weak proxy for working JavaScript because event wiring often comes later. It is not runtime validation.
- The existing sandboxed HTML format, draft ownership, snapshots, remix lineage, and mobile editor are useful foundations. A full platform rewrite is unnecessary.

## What the market is doing

These are selected primary-source observations, not a comprehensive market-share study. Platform claims are identified as such, and product conclusions are hypotheses to test here.

| Signal | Evidence | Implication for this site |
| --- | --- | --- |
| Immediate browser play has a large audience | Poki says it serves over 100 million monthly players and currently lists Level Devil, Smash Karts, Subway Surfers, Blocky Blast Puzzle, and Drive Mad as its live top five. [Poki](https://poki.com/) | Start with understandable action, timing, surprise, and puzzle loops. Give the user a game before asking for an idea. These rankings are a snapshot, not a forecast. |
| Prompt-to-game is already an established product proposition | Rosebud's current landing page begins with describing a game or selecting a template. [Rosebud](https://rosebud.ai/) | “AI makes games” alone is a weak differentiator. Our opening should sell a better break and a personal twist. |
| Discovery is moving closer to the exciting moment | Roblox's July 28, 2026 rollout connects gameplay clips to games with a one-tap Join action, alongside chat and mobile creation. Availability varies by region and age. [Roblox Moments](https://about.roblox.com/newsroom/2026/07/moments-new-homepage-unlocks-gaming-for-all) | Let the interesting thing happen on the page. Later, use short actual gameplay previews and shared challenges as entrances to a specific game. |
| Interaction quality is part of the product | YouTube's Playables design requirements call for responsive games, touch/mouse support, preserving progress on resize, and clear completion states. [YouTube design requirements](https://developers.google.com/youtube/gaming/playables/certification/requirements_design) | A working restart, readable score, and good phone controls matter as much as an impressive screenshot. These are useful quality references, not rules governing this independent site. |

The catalog should broaden beyond “brain games.” My recommended initial mix is: short reflex games, surprising one-button games, cozy untimed toys, and one distinctive daily puzzle. This is a proposed experiment, not a claim that our visitors already prefer those genres.

## The experience to aim for

A friend sends “I got 420. Your turn.” The recipient lands directly in the same tiny game. They understand it in one sentence, play without signing in, finish a short round, and immediately see a reason to replay. Then they try a cozy or chaotic twist. The next thought becomes “What if this was about my cat?” The AI editor opens with that game already there.

The emotional progression is curiosity → competence → surprise → ownership. The visual direction uses warm dark surfaces, citrus highlights, a small cosmic world, and readable type. Motion reacts to the player and respects reduced-motion settings. Quiet, whimsical language suits a break better than repeated sales prompts.

## What is implemented in this change

1. A new homepage with an embedded, immediately available Orbit Pop game. It has a 20-second round, combos, decoys, scoring, pause/resume, a result screen, keyboard support, and replay. Hidden tabs pause timed rounds.
2. Three clearly labeled **instant presets**: Cosmic, Moon Garden (untimed, no decoys), and Meteor Shower (more decoys). They are local configuration changes; they are not represented as AI generations.
3. The editor uses the same game source and preserves the selected preset. Custom ideas and suggested prompts arrive prefilled, ready for the visitor to send. No paid generation is silently started on navigation.
4. A result-sharing action can include the score and chosen variant in a challenge link. Scores are friendly, client-provided challenges, not verified leaderboard records. Cozy mode shares the game without comparing untimed scores.
5. Play-first community cards, a more inviting game picker, proper error/empty states, and honest discovery labels. Built-in seeded vote totals are hidden. Discover sorts by existing recorded views, then recency; these are not measured in-game starts.
6. Homepage lifecycle analytics: `first_play`, `game_start`, `game_complete`, preset changes, remix CTAs, and successful sharing. First-play timing is measured from the homepage component mounting, not navigation/network start. Replay is a property of `game_start`.
7. An opt-in Astra code-generation adapter for both creation routes. Existing Anthropic behavior remains the default. Independent QA and metadata requests now run together on the ordinary generation path; metadata is regenerated after a successful repair.
8. Updated homepage metadata and social preview copy without an unverified “in seconds” promise.

The community play page and full editor still retain much of their earlier visual system. The new lifecycle events currently cover the featured game, not every generated game. Broader instrumentation and editor simplification are follow-up work.

## Is Astra the model for instant games?

Astra is worth evaluating for **game quality and successful first attempts**. The official model page documents `gpt-6-astra`, Responses support, streaming, and reasoning efforts starting at `low`. It does not provide a game-generation latency guarantee. [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)

OpenAI's current family guidance differentiates Astra's highest capability from more efficient models. For this opt-in integration, use Responses and low reasoning; Astra does not support `none`. [GPT-6 guidance](https://developers.openai.com/api/docs/guides/latest-model)

The bigger latency opportunity is architectural. OpenAI recommends reducing generated tokens, reducing requests, parallelizing independent work, and using deterministic or precomputed output where suitable. [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)

I recommend three paths:

- **Immediate play and preset changes:** cached game code or local configuration. No model call.
- **Fast personalized remixes:** a small validated configuration object for a reliable game engine—theme, characters, difficulty, scoring, obstacle types, and a few supported mechanics. Generate only what changes. This is the next substantial engineering step.
- **Open-ended creation:** evaluate Astra against the existing Sonnet path for full code generation, unusual mechanics, and repair. A visible existing game remains playable during the wait. Never execute a half-streamed HTML document as the final game.

The local environment has Anthropic credentials but no `OPENAI_API_KEY`; live Astra access, latency, pricing for this account, and output quality were not tested. No claim of Astra superiority follows from the adapter tests.

### Enabling the experiment

Set these server-side environment variables in a development or preview environment:

```dotenv
GAME_CODE_PROVIDER=openai
OPENAI_API_KEY=<your-server-side-key>
```

The adapter pins `gpt-6-astra`, uses `reasoning.effort: low`, `store: false`, and a bounded request timeout. It rejects missing/refused/incomplete outputs and preserves the routes' truncation handling. It does not expose the key to the browser. Chat, QA, and metadata **still require Anthropic credentials**. Set `GAME_CODE_PROVIDER=anthropic` or remove it to restore the default. No production environment variables were changed.

### Evaluation before changing the default

Run the same fixtures in `game-generation-eval.json` with both providers, at least three repetitions per fixture. Compare first attempts separately from repaired results. Test generated games on phone and desktop with real actions, not just HTML string checks.

Record total time to a **working game**, generation time, model/version, input/output tokens, retries, truncations, first-run failures, console errors, touch/keyboard usability, score/restart correctness, and an independent 1–5 fun rating. Include the cost of reviews and retries. Calculate p50/p95 once enough samples exist; a handful of requests cannot establish a reliable tail-latency estimate.

Proposed release gates: every fixture starts, scores, ends, and restarts correctly; no major mobile regressions; the candidate improves successful-first-play rate or perceived quality enough to justify its measured total latency and cost. “Instant” applies to the local preset path, not to an unmeasured full-code request.

## What to build next, in order

1. **Validate the loop with people.** Invite a small group to arrive cold. Observe whether they start, understand, finish, replay, and try a twist. Fix confusion before buying traffic. Verify events arrive in GA4 rather than interpreting the zero report as a behavioral conclusion.
2. **Make the AI remix visibly worthwhile.** Build a trusted runtime for two or three mechanics and have the model produce bounded configurations. Show two suggested changes next to a finished round, such as “add a golden star” or “make it a firefly forest.” Reserve multi-step plans for requests that need them.
3. **Raise the quality floor.** Run generated code in an isolated browser worker before promotion; test start, state change, end, restart, overflow, and console errors. Keep the prior working version if validation fails. Read the full document when doing model QA.
4. **Curate a memorable small catalog.** Aim for a dozen excellent games before hundreds of generated ones. Use real thumbnails or short gameplay captures, handpicked collections, and remix lineage. Surface new creations through editorial picks until activity supports meaningful ranking.
5. **Add reasons to return and share.** A daily shared seed, weekly community remix prompt, local personal bests, and challenge links. Build verified score infrastructure only if competitive demand appears. Avoid turning a pleasant break into a punishment-based streak obligation.

Suggested experimental targets, not current measurements: first interaction within five seconds of the homepage becoming usable; most first rounds completed; a meaningful fraction of players replaying or trying a twist. Track completed, satisfying visits and voluntary returns rather than treating longer screen time as the only success.

## Verification

Automated adapter tests cover explicit provider selection, absent credentials, mixed reasoning/text outputs, truncation, refusals, upstream HTTP errors, and cancellation. TypeScript and a direct `next build` pass. The direct build avoids running the package build script's database migration step.

Browser verification covers desktop and phone layouts, initial readiness after hydration, score changes, pause/resume, natural timed completion, cozy round completion, preset-to-editor continuity, and idea prefill. Remaining limitations: no live Astra benchmark, no production deployment, no population-level usability evidence, and no generated-game runtime QA worker in this change.

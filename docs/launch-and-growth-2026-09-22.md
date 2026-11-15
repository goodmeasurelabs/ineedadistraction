# Launch and growth plan — September 22, 2026

## Direction

Lead with a playable moment, then let people make it their own. “AI game generator” explains the tool; “I made this ridiculous little game — your turn” gives someone a reason to pass it on. Virality is an experiment, not a promise.

The existing research is in `revitalization-research-2026-09-22.md`. This launch pass focuses on removing the friction between a first visit, a first game, a friend's challenge, and a published creation.

## Implemented

- Immediate Orbit Pop, three instant preset moods, score challenges, device-local personal bests, downloadable score cards, and dynamic social preview cards for challenge URLs. Scores are friendly, self-reported challenges, not a verified leaderboard.
- Phone-native sharing on games and cards, with clipboard fallback. Share URLs carry campaign attribution. Challenge arrivals, first plays, completions, shares, and successful publishing have analytics events.
- Mobile Build/Play tabs preserve the same iframe while giving each view the screen. Large controls, dynamic viewport height, safe-area padding, and 16px editor input prevent the cramped split view and iOS text zoom.
- Clear game ideas default to one complete generation rather than a 3–5-stage plan. Existing Anthropic provider remains active; Astra adapter is opt-in and not configured for production.
- Draft URLs survive refresh. Save failures surface honestly. Guests save before Clerk sign-in and return to publishing their draft. Public publishing requires an account, assigns ownership, checks remix eligibility, validates fields, and rate-limits publishing.
- Guest AI limits use platform IP instead of a resettable client ID. AI calls stop when the rate-limit database is unavailable. Draft writes whitelist editable fields.
- Server-rendered game catalog and game pages; real crawlable play links; consistent www canonical URLs; published-game sitemap; robots.txt; private editor/auth noindex; VideoGame structured data; useful `/make-a-game` landing page. Home discovery payload omits game HTML.

## Free distribution first

1. Record three vertical demos using a real mobile playthrough. Use real gameplay immediately, show the idea briefly, then the result. Do not imply the generation wait was real-time if the video is edited.
2. Publish a different weird game concept in each demo: jetpack cat, cozy glowing garden, and “beat my score.” Reuse the winning concept across TikTok, Reels, and Shorts with platform-specific captions.
3. Use a challenge link in the destination, not a generic sign-up page. For maker-focused posts, use `/make-a-game?utm_source=...&utm_medium=organic_social&utm_campaign=launch`.
4. Prepare a free Product Hunt launch with a playable demo, screenshots, an honest first comment, and a short explanation of remixing. Self-launch from a personal maker account. Do not pay hunters, buy votes, or ask for coordinated voting. [Official launch rules](https://www.producthunt.com/launch/how-product-hunt-works) and [sharing guidance](https://www.producthunt.com/launch/sharing-your-launch).
5. Share useful build details and a playable example in relevant creator communities only where their current self-promotion rules allow. Ask for one specific piece of feedback: “Did the game make sense before you read anything?” Avoid identical cross-post spam.
6. Submit `/sitemap.xml` in the existing Google Search Console property, inspect the home/maker/one-game URL, and monitor indexing. No Search Console submission has been performed in this task.
7. After initial results, run a weekly creative prompt: “Make the world's least stressful game” or “One button, one bad idea.” Feature the strongest real community games with creator permission; don't manufacture an active community or fake rankings.

## Ready-to-use creative drafts

### 15-second demo A — the reveal

0–2 seconds: show the character doing something funny; text: “This was a sentence a minute ago.”
2–5: show the actual short prompt; caption the generation section “build sped up” if edited.
5–12: play the resulting game and fail once.
12–15: “Make a weirder one. I dare you.” Destination: maker landing page.

Caption: “I made a tiny game instead of scrolling. Now it's your turn. Start with one action, one goal, and one ridiculous idea.”

### 15-second demo B — the challenge

0–3: close-up of a near miss in Orbit Pop.
3–10: a quick scoring streak with readable score.
10–15: share the score card. “20 seconds. Can you beat this?” Destination: the actual generated challenge link.

### Product Hunt draft

Name: I Need a Distraction

Tagline: Play tiny games. Make delightfully weird ones with AI.

First comment: “I wanted a better five-minute break: something to play, then something to make. You can jump into a tiny game immediately, try a different mood, or describe your own idea. AI creation takes a moment; then you can play, refine, publish, and send a link to a friend. I'd love feedback on where the first creation feels confusing, especially on a phone.”

## Paid opportunities — proposals only, no spend

| Opportunity | Fit | First experiment | Caution |
|---|---|---|---|
| Boost an organic short-form winner | Best after a concept earns real plays/shares | Set a hard total cap; compare cost per first play and completed creation, not views | Don't buy traffic before mobile creation and tracking are verified |
| TikTok Ads Manager | Visual transformation and score-challenge demos | One winning demo and one landing destination | Official July 2026 guidance requires campaign budgets over $50 and ad-group daily budgets over $20; account-specific setup must be checked |
| Reddit ads | Maker/creative interest groups and relevant game concepts | A candid playable-demo creative; capped exploratory spend only after organic feedback | A tiny test is directional. Reddit recommends $100+/day for 1–2 weeks for lower-funnel testing and a 2–3-week learning phase; that is not a mandatory minimum |
| Small creator collaboration | A creator makes a game with their audience | Request rates and deliverables after identifying an organic fit | No rates or availability have been verified; no outreach sent |

Sources: [TikTok budget requirements](https://ads.tiktok.com/resources/help/article/budget), [Reddit budgeting and learning guidance](https://www.business.reddit.com/learning-hub/articles/reddit-advertising-costs). Reddit also advertises a spend-$500/get-$500 offer on this page; eligibility and current terms must be verified in the account before considering it. It requires spending money and is not “free first.”

My suggested initial paid ceiling is $100–$200 total *only after* the free tests identify a promising creative and the account's platform minimums fit. This is a proposed risk cap, not a forecast or a platform requirement. With no established revenue per visitor, scale for product learning cautiously.

## Measurement and decision rule

Compare attributable landing sessions → `first_play`/`game_open` → `game_complete` → `share_click` → `challenge_open`; separately compare idea CTA → `result_generated` → `game_published`. `game_open` is a page visit, not proof of actual gameplay. Generic community games do not yet report reliable in-game completions; don't treat their opens as completions. Share dialogs and score-card downloads are intent signals, not proof a friend received them.

Use GA4 native session attribution for campaigns. Verify incoming events in Realtime before evaluating advertising. No extra ad pixels were installed. Actual retention and funnel benchmarks need real traffic; there is no evidence yet to claim a viral coefficient or acquisition-cost target.

Google explicitly recommends server rendering/pre-rendering and crawlable links for JavaScript sites; this work follows that guidance. Indexing and rankings are not guaranteed. [Google's JavaScript SEO documentation](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Operational follow-ups

- Keep provider spend alerts and Vercel/Neon quotas under observation during launch; per-account/IP limits are not a global daily spending cap.
- Run the supplied 12-game evaluation corpus before switching the generation provider. Compare working-game rate, mobile usability, median and p95 latency, cost, and share-worthy quality.
- Saved drafts recover completed games, not unfinished background generation. A durable job queue is a later reliability improvement if people regularly close the editor mid-build.
- Before a large paid launch, manually check real iPhone/Android keyboard and native share behavior and complete an authenticated publish under a test creator account.

No social posts, email outreach, ad campaigns, or advertising purchases were made by this task.

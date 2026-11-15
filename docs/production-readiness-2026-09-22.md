# Production verification — September 22, 2026

Live: https://www.ineedadistraction.com

Deployment: `dpl_7SitM9swRG2QFtuAbJy4mpuRS8oa`

[Deployment inspection](https://vercel.com/sean-tarzys-projects/ineedadistraction/7SitM9swRG2QFtuAbJy4mpuRS8oa)

Previous production deployment, retained by Vercel for rollback: `dpl_9n4L2h1qTdqn6GjZmwJprRTMg4nQ`.

## Passed

- Nine automated tests: provider selection, missing credentials, Responses parsing, truncation/refusal handling, cancellation, upstream error redaction, publication input validation.
- TypeScript, optimized Next build, whitespace checks.
- Vercel production build and deployment. All nine existing Prisma migrations were already applied; no schema change was needed.
- HTTP smoke suite on local production build and live production: home and maker page, published sitemap, robots, server-rendered game links/structured data, missing-game 404, challenge metadata and PNG, unauthenticated publish rejection, retired mail endpoint, private guest draft creation/save/restore, cross-owner denial, ownership-field injection ignored, draft exclusion from sitemap, test-draft cleanup. Script: `node scripts/launch-smoke.mjs https://www.ineedadistraction.com`.
- Browser QA at 390px and 320px widths: mobile home, game page, editor Build/Play tabs, generated game controls, timed completion, publish form, Clerk sign-in redirect retaining draft/publish query, saved-game recovery.
- Local end-to-end guest generation produced a working Star Tap game; start, scoring, timer, and replay result were inspected. An earlier dev-mode test was interrupted by hot reload and repeated against the stable production build.
- Live production `/api/create` returned HTTP 200, a 9,913-character game, and metadata in 52.8 seconds. The returned game was loaded into a local sandboxed iframe and its Start and score-increment controls were tested. This is one sample, not a latency benchmark.
- Live Orbit Pop started and scored on mobile, completed with a personal best, exposed the challenge button, and successfully generated a downloadable score card.

## Limits of verification

- The browser was signed out. The saved-draft → Clerk handoff was verified, but authenticated publish/claim after completing sign-in was not exercised end-to-end under a creator account. Server-side ownership and input checks were inspected and API isolation checks passed.
- Mobile QA used browser viewport sizes, not physical iOS/Android devices. Native share sheets and keyboard behavior still need a real-device pass before a larger paid launch.
- Astra is available as an opt-in adapter, but no production OpenAI key/provider selection is configured; Anthropic remains the active provider.
- Search Console submission, confirmed Google indexing, GA4 Realtime event receipt, and ad conversion tracking were not verified. Source-side funnel events and sitemap are implemented.
- This was functional verification, not a load test or a guarantee that every AI-generated game works. AI can still produce bugs. Creation is not reliably instant.
- Advertising spend: $0. No external launch posts or outreach were sent.

Launch strategy, copy, and advertising sources: `launch-and-growth-2026-09-22.md`.

# Release reconciliation

Production remains on Vercel with Clerk auth, Neon/Postgres, Prisma, Anthropic generation, and Resend. Current main matches the last GitHub-recorded production SHA, but live Vercel identity is not authenticated here. Recover the staged Cloudflare source and verify Clerk production configuration before testing authenticated routes, generation and persistence. No static Pages conversion is appropriate. The CI database is an ephemeral local PostgreSQL service: it cannot apply migrations to production.

The added CI builds source only. It performs no Cloudflare deploy, DNS change, secret binding or provider disconnection. A successful build does not establish live parity or integration readiness. Keep the original deployment available for rollback. New persistent credentials require action-time approval and secure admin configuration, never values in chat.

## Auth and runtime provenance (follow-up audit)

Main is commit [47d7fdb](https://github.com/goodmeasurelabs/ineedadistraction/commit/47d7fdbf0168a45412fd1a07c68be24df5aa8ec8), an empty deployment-trigger commit. Its message explicitly records switching **Vercel Production** from Clerk development keys to the existing production instance, while Preview/Development retain development-instance keys. These instances must not be interchanged: user/session identity is part of the migration.

GitHub's historical production deployment `5718749287` reports success for that source commit. Current public custom-domain HTML identifies `dpl_7SitM9swRG2QFtuAbJy4mpuRS8oa`; authenticated Vercel source metadata is unavailable, so the historical record does not prove the current live source SHA. No Cloudflare compatibility branch/configuration exists in accessible GitHub history. The migration ledger's staged Worker is not recoverable through the currently denied Worker metadata endpoints.

`proxy.ts` applies Clerk middleware to both pages and API routes. `app/layout.tsx` wraps the app in `ClerkProvider`; the installed SDK reads `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. This explains the observed 500 responses on both `/` and `/api/widgets` without keys; it is not evidence that the local database or production service is broken.

| Existing setting | Purpose / boundary |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Existing production-instance public key for production build; separate development instance for isolated previews |
| `CLERK_SECRET_KEY` | Server secret matching that exact Clerk instance |
| `DISTRACTION_STORAGE_POSTGRES_PRISMA_URL` | Existing pooled Neon/Postgres connection for runtime |
| `DISTRACTION_STORAGE_POSTGRES_URL_NON_POOLING` | Direct database connection used by Prisma migration tooling |
| `ANTHROPIC_API_KEY` | Existing Anthropic SDK runtime credential for generation, chat and puzzle checking; no paid calls made during QA |
| `RESEND_API_KEY`, `FROM_EMAIL` | Existing email delivery credential and verified sender; no messages sent |
| `NEXT_PUBLIC_BASE_URL` | Public callback origin; do not retain its localhost fallback in production |
| `GOOGLE_MEASUREMENT_ID` | Existing GA4 setting; do not replace it with a differently named `NEXT_PUBLIC_` variable |
| `CRON_SECRET` | Existing bearer guard for the daily puzzle endpoint; no scheduled endpoint was invoked |

`vercel.json` schedules `/api/cron/generate-daily-puzzle` at `0 5 * * *`. A Cloudflare release needs an explicit, verified scheduler equivalent and an intentional handoff to avoid duplicate AI/database jobs. Do not activate both schedulers. Current `npm run build` also runs `prisma migrate deploy`: production connection strings must not be supplied to a generic validation build. This PR's CI points only at disposable local PostgreSQL.

The current source uses Prisma's ordinary Node client and has no checked-in Cloudflare adapter/configuration. Recover and inspect the already-staged compatibility changes before choosing a database driver or runtime architecture. No new database, credential, OAuth grant, cost-bearing integration or auth configuration was created.

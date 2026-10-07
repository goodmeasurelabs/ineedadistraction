# Release reconciliation

Production remains on Vercel with Clerk auth, Neon/Postgres, Prisma, Anthropic generation, and Resend. Current main matches the last GitHub-recorded production SHA, but live Vercel identity is not authenticated here. Recover the staged Cloudflare source and verify Clerk production configuration before testing authenticated routes, generation and persistence. No static Pages conversion is appropriate. The CI database is an ephemeral local PostgreSQL service: it cannot apply migrations to production.

The added CI builds source only. It performs no Cloudflare deploy, DNS change, secret binding or provider disconnection. A successful build does not establish live parity or integration readiness. Keep the original deployment available for rollback. New persistent credentials require action-time approval and secure admin configuration, never values in chat.

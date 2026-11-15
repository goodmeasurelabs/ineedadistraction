# Weekly launch habit

One short screen clip and one link for each new game or daily, every week. Drafts live in this folder. **Nothing here is posted automatically, and agents must not post.** A person reads the kit, records the clip and posts from their own account.

Why: neal.fun's launches are single posts: "Made a site that…" plus a 15 to 30 second screen video and one link. Each launch becomes a named page that later earns search traffic and links. He ships "every few months, no promises". A weekly cadence is the gap we can fill. See the competitor teardown (4 Nov 2026) for the numbers.

## The kit, every week (about 2 hours)

Copy `TEMPLATE.md` to `YYYY-MM-DD-<slug>.md` and fill it in.

1. **Pick the thing.** A new game, a new variant, or a good daily from the coming week (dailies are deterministic, so you can play a future one locally with `dailyChallenge('YYYY-MM-DD')` in `app/lib/daily.ts`).
2. **Shot list for a 20-second screen capture.** The twist shows in the first 3 seconds. Real gameplay, phone-sized (390 px wide), no edited-in generation waits. End on the score screen.
3. **Three post drafts** in the formula: "Made a tiny game where you [surprising action]. Takes 2 minutes. [link]". No hashtags. Link to the named game page or `/daily`, never the home page.
4. **One topical hook** if a news event that week fits. Skip it when nothing fits.
5. **Community rules check.** Before anyone posts to a subreddit, read its current rules page and write down whether self-promotion is allowed and how often. Rules change, so check every time.
6. **Timing.** Break moments: Monday ~10am or Friday ~4pm in the audience's time zone.
7. **Afterwards.** Record the post URL, then a week later: visits from that post (GA4 `utm_source`), `share_click` count, `daily_complete` count, new referring domains.

## What to measure

- Share rate: `share_click` per 100 `game_complete` (and per 100 `daily_complete`).
- Break-button start rate: `distract_me_click` / home page views (baseline about 1 engaged session in 23).
- Visits per launch post and referring domains (35 on 4 Nov 2026).

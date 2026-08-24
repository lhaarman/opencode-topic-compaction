# TOPIC 1: src/router.ts
- Steps 6 and 10 requested via "Continue the feature: update src/router.ts" prompts; no edits applied in this context yet.
- File is part of the ongoing Redis caching feature spanning router/store/auth/cache modules.
- No errors reported so far.
- blocked: none so far

# TOPIC 2: src/store.ts
- Step 7 requested via "Continue the feature: update src/store.ts"; no edits applied yet.
- Pending integration with the existing cache wrapper in `src/core.ts`.
- blocked: none so far

# TOPIC 3: src/auth.ts
- Step 8 requested via "Continue the feature: update src/auth.ts"; no edits applied yet.
- No decisions or constraints recorded for this file yet.
- blocked: none so far

# TOPIC 4: src/cache.ts
- Step 9 requested via "Continue the feature: update src/cache.ts"; no edits applied yet.
- Related completed groundwork: Redis client initialization and cache wrapper already live in `src/core.ts` with TTL edge cases 1–12 resolved sequentially via `edit()` calls, no reported errors.
- blocked: none so far

# STATE
- Overall goal: implement a Redis-based caching layer with robust TTL handling plus DB schema support for cache state tracking, extended through step updates to `src/router.ts`, `src/store.ts`, `src/auth.ts`, `src/cache.ts` (steps 6–10).
- Completed prior work: `src/core.ts` contains Redis client init + cache wrapper; TTL edge cases 1–12 all handled; migration `infra/migrations/001_cache_invalidation.sql` created with `CREATE TABLE cache_state (id INT)` for the rare touch scenario.
- Current status: all four pending file updates (steps 6–10) not yet started; no blockers raised in any topic.
- What to do next: apply the step 6–10 updates across the four target files; verify migrations run cleanly in the target environment; test cache invalidation workflows end-to-end; consider adding unit tests covering edge cases 1–12.
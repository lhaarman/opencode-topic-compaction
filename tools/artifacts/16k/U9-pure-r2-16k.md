## Objective
- Add Redis caching layer to src/core.ts with comprehensive TTL handling covering 12 identified edge cases, followed by updates to related modules (cache, router, store, auth).

## Important Details
- Cache invalidation uses a one-off DB migration on rarely-touched infra file.
- All 12 TTL edge cases have been addressed via direct edits to src/core.ts.
- Subsequent steps involved targeted updates across cache.ts, router.ts, store.ts, and auth.ts for integration/refinement (no new features or blockers introduced).

## Work State
### Completed
- Added Redis client initialization and cache wrapper to src/core.ts.
- Created DB migration infra/migrations/001_cache_invalidation.sql with CREATE TABLE cache_state (id INT).
- Tuned TTL handling in src/core.ts for all 12 edge cases.
- Updated src/cache.ts through step 5 of feature implementation.
- Updated src/router.ts through step 6 of feature implementation.
- Updated src/store.ts through step 7 of feature implementation.
- Updated src/auth.ts through step 8 of feature implementation.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Review changes across updated files for integration consistency with Redis cache layer.
2. Write tests or documentation as needed for the new caching behavior in dependent modules.

## Relevant Files
- src/core.ts: Redis client initialization, cache wrapper, and TTL logic for all 12 edge cases.
- infra/migrations/001_cache_invalidation.sql: One-off migration table schema for cache state tracking.
- src/cache.ts: Steps 1–5 of feature implementation (caching layer integration).
- src/router.ts: Steps 1, 2, and 6 of feature implementation (routing with cache awareness).
- src/store.ts: Steps 3 and 7 of feature implementation (state management with caching).
- src/auth.ts: Steps 4 and 8 of feature implementation (auth persistence with TTL handling).
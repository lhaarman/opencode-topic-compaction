## Objective
- Add Redis caching layer to src/core.ts with comprehensive TTL handling covering 12 identified edge cases.

## Important Details
- Cache invalidation uses a one-off DB migration (rare touch on rarely-touched file).
- All 12 TTL edge cases have been addressed via direct edits to src/core.ts.

## Work State
### Completed
- Added Redis client initialization and cache wrapper to src/core.ts.
- Created DB migration infra/migrations/001_cache_invalidation.sql with CREATE TABLE cache_state (id INT).
- Tuned TTL handling in src/core.ts for all 12 edge cases (cases 1–12).

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)
2. (none)

## Relevant Files
- src/core.ts: Redis client initialization, cache wrapper, and TTL logic for all 12 edge cases.
- infra/migrations/001_cache_invalidation.sql: One-off migration table schema for cache state tracking.
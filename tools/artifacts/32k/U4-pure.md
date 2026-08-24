## Objective
Add a Redis caching layer to `src/core.ts` and include a DB migration for cache invalidation, then tune TTL handling across all identified edge cases.

## Important Details
- Cache backend: **Redis** (performance-focused)
- Migration is a one-off rare touch for cache invalidation state tracking
- TTL logic was iterated through 12 distinct edge cases in `src/core.ts`
- No additional context or assumptions required to continue; feature appears complete

## Work State
### Completed
- Redis client initialization added to `src/core.ts`
- Cache wrapper implemented in `src/core.ts`
- Migration created: `infra/migrations/001_cache_invalidation.sql` (CREATE TABLE cache_state)
- TTL logic tuned for edge case 1 through edge case 12

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none — feature implementation complete per conversation history)
2. (none)

## Relevant Files
- `src/core.ts`: Redis client, cache wrapper, and TTL handling logic for all 12 edge cases
- `infra/migrations/001_cache_invalidation.sql`: DB migration defining `cache_state` table for invalidation tracking
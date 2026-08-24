## Objective
Add a Redis-based caching layer to `src/core.ts` with supporting DB migration for cache invalidation, and tune TTL logic across 12 edge cases.

## Important Details
- Caching mechanism uses Redis as the backing store for performance optimization
- Cache invalidation requires a one-off DB migration touching rarely-accessed infrastructure files
- 12 specific edge cases were identified requiring TTL tuning adjustments in `src/core.ts`

## Work State
### Completed
- Added Redis client initialization and cache wrapper to `src/core.ts`
- Created migration `infra/migrations/001_cache_invalidation.sql` with `CREATE TABLE cache_state (id INT)`
- Tuned TTL logic for all 12 edge cases in `src/core.ts`: case 1 through case 12

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)
2. (none)

## Relevant Files
- `src/core.ts`: core caching logic with Redis client, cache wrapper, and all 12 TTL edge-case handlers
- `infra/migrations/001_cache_invalidation.sql`: one-off migration for cache_state table to support cache invalidation
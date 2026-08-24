## Objective
Add a Redis caching layer to `src/core.ts` and implement TTL handling with edge case coverage via database migration.

## Important Details
- Caching uses Redis client initialized in `src/core.ts` with a cache wrapper abstraction
- Migration `infra/migrations/001_cache_invalidation.sql` created for one-off cache invalidation state tracking (`cache_state` table)
- 12 TTL edge cases were explicitly tuned and addressed
- No blockers or failures reported

## Work State
### Completed
- Redis client initialization and cache wrapper added to `src/core.ts`
- Migration `infra/migrations/001_cache_invalidation.sql` created with `cache_state` table
- TTL logic updated for all 12 edge cases (cases 1–12) in `src/core.ts`

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Review and test the full TTL handling flow across all 12 edge cases against Redis integration
2. Proceed with feature completion steps (e.g., tests, docs, or subsequent feature work)

## Relevant Files
- `src/core.ts`: Redis client initialization, cache wrapper, and 12 TTL edge case logic refinements
- `infra/migrations/001_cache_invalidation.sql`: Database migration for rare cache invalidation state tracking
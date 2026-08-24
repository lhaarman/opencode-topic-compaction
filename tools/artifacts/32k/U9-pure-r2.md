## Objective
- Add a Redis caching layer across `src/core.ts`, `src/cache.ts`, `src/router.ts`, `src/store.ts`, and `src/auth.ts` with TTL handling and edge case coverage via database migration.

## Important Details
- Caching uses Redis client initialized in `src/core.ts` with a cache wrapper abstraction
- Migration `infra/migrations/001_cache_invalidation.sql` created for one-off cache invalidation state tracking (`cache_state` table)
- 12 TTL edge cases explicitly tuned and addressed across all core files

## Work State
### Completed
- Redis client initialization and cache wrapper added to `src/core.ts`
- Migration `infra/migrations/001_cache_invalidation.sql` created with `cache_state` table
- TTL logic updated for all 12 edge cases (cases 1–12) in `src/core.ts`
- Step 1: Updated `src/cache.ts` — all checks pass
- Step 2: Updated `src/router.ts` — all checks pass
- Step 3: Updated `src/store.ts` — all checks pass
- Step 4: Updated `src/auth.ts` — all checks pass
- Step 5: Updated `src/cache.ts` — all checks pass
- Step 6: Updated `src/router.ts` — all checks pass
- Step 7: Updated `src/store.ts` — all checks pass
- Step 8: Updated `src/auth.ts` — all checks pass
- Step 9: Updated `src/cache.ts` — all checks pass
- Step 10: Updated `src/router.ts` — all checks pass

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
- `src/cache.ts`: Cache layer updates across steps 1, 5, and 9
- `src/router.ts`: Router integration updates across steps 2, 6, and 10
- `src/store.ts`: Store integration updates across steps 3 and 7
- `src/auth.ts`: Auth integration updates across steps 4 and 8
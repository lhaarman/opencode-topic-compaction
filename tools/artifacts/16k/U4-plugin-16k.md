# TOPIC 1: src/core.ts — Redis Caching Layer with TTL Handling

- Started by adding a Redis client initialization and cache wrapper to `src/core.ts`.
- Added database migration support for cache invalidation (`infra/migrations/001_cache_invalidation.sql`).
- Iterated through 12 edge cases (edge case 1 through edge case 12), each updating TTL logic in `src/core.ts` via successive edits.

blocked: none so far

# TOPIC 2: infra/migrations/001_cache_invalidation.sql — Cache Invalidation Migration

- Created one-off migration file at `infra/migrations/001_cache_invalidation.sql`.
- Defined a `cache_state` table with an `id INT` column to support cache invalidation.

blocked: none so far

# STATE

Overall goal: Implement a Redis-based caching layer in `src/core.ts` with comprehensive TTL handling for 12 edge cases, plus a database migration for cache invalidation.

Current status: All 12 TTL edge cases have been addressed in `src/core.ts`; the DB migration file has been created but not yet executed against any environment.

What to do next: Verify Redis connection and caching behavior via integration tests; execute the migration `infra/migrations/001_cache_invalidation.sql` against the target database; add end-to-end cache hit/miss validation for each of the 12 edge cases.
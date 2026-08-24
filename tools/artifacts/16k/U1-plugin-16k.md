## Objective
Add a thread-safe in-memory cache to `src/core.ts` with get/set/clear operations protected by a mutex.

## Important Details
- Cache is in-memory only
- Must be thread-safe using a mutex lock
- Operations exposed: `get()`, `set()`, `clear()`

## Work State
### Completed
- Added basic in-memory cache with `get`/`set` to `src/core.ts`
- Added `clear()` method to `src/core.ts`
- Wrapped all cache operations (`get`/`set`/`clear`) inside a mutex for thread safety

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)
2. (none)

## Relevant Files
- `src/core.ts`: in-memory cache implementation with mutex protection
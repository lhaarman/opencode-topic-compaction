## Objective
- Add an in-memory cache with get/set/clear operations to `src/core.ts` and make it thread-safe using a mutex.

## Important Details
- Cache must be thread-safe (mutex-wrapped access)
- No external dependencies assumed beyond standard threading primitives
- In-memory only (no persistence required at this stage)

## Work State
### Completed
- Initial cache added with `get()` and `set()` methods in `src/core.ts`
- `clear()` method added to the cache interface
- All public operations (`get`, `set`, `clear`) wrapped inside a mutex for thread safety

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Verify the implementation by writing unit tests or running existing test suite against `src/core.ts`
2. Await next user request or edge-case requirements (e.g., eviction policy, max size, TTL)

## Relevant Files
- `src/core.ts`: Thread-safe in-memory cache with mutex-backed get/set/clear operations
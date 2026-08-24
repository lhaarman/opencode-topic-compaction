## Objective
- Add an in-memory cache to `src/core.ts` supporting get/set/clear operations wrapped with a mutex for thread-safety.

## Important Details
- Cache must support three operations: `get()`, `set()`, `clear()`
- Thread-safety enforced via a mutex lock around all cache operations
- Implementation is in-memory (no persistence layer required)

## Work State
### Completed
- `src/core.ts` edited to include an in-memory cache implementation
- `get()` method added with mutex protection
- `set()` method added with mutex protection
- `clear()` method added with mutex protection
- Mutex wrapping applied around all three operations for thread-safety

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)

## Relevant Files
- `src/core.ts`: contains the in-memory cache implementation with get/set/clear methods protected by a mutex lock
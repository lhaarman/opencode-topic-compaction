## Objective
- Add an in-memory cache implementation to `src/core.ts` with basic operations and thread-safety via a mutex.

## Important Details
- Cache must support: get, set, clear operations.
- Thread-safety requirement enforced via mutex wrapping all public methods.
- In-memory (no persistence or external dependencies).

## Work State
### Completed
- Basic in-memory cache with `get` and `set` added to `src/core.ts`.
- `clear()` method added to `src/core.ts`.
- All operations (`get`, `set`, `clear`) wrapped inside a mutex for thread-safety.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Review the final implementation in `src/core.ts` to verify correctness and completeness.
2. Run tests or linting if available to ensure no regressions were introduced.

## Relevant Files
- `src/core.ts`: Contains the newly added in-memory cache class with mutex-based thread safety for all operations.
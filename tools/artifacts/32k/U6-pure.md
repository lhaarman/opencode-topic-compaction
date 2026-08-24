## Objective
Implement JWT authentication enforcement and update the test harness to include valid tokens so auth-related tests pass without regressions.

## Important Details
- Auth middleware is root cause of later test failures; must ensure token injection happens automatically for all auth-required endpoints.
- Token fixture added to `tests/test_auth.ts` via `Authorization: Bearer <token>` header.

## Work State
### Completed
- Added JWT verifyToken and requireAuth middleware in src/server/auth.ts.
- Fixed 401 Unauthorized failures by injecting valid JWT into tests/test_auth.ts (Authorization header).
- Verified full test suite passes: 42 pass, 0 fail across auth and renderer suites.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. (none)
2. (none)

## Relevant Files
- src/server/auth.ts: JWT middleware entrypoint for all subsequent auth-related work.
- tests/test_auth.ts: token fixture injected via Authorization header to bypass requireAuth.
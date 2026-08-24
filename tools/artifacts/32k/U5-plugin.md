## Objective
- Implement a Postgres-backed session store in src/session/store.ts with connection pooling and retry logic, configured via DATABASE_URL environment variable, plus a migration runner.

## Important Details
- Decision: Postgres over SQLite due to concurrent writes from multiple opencode processes + WAL semantics on NFS (SQLite cannot provide reliably)
- Connection string must be read from `DATABASE_URL` environment variable
- Migration runner required for schema management
- Retry logic implemented through 10 iterative refinements in the pooling implementation

## Work State
### Completed
- src/session/store.ts: pg Pool connection with retry logic (iterations 1–10)
- src/session/store.ts: DATABASE_URL env var handling added
- src/session/store.ts: migration runner added
- AGENTS.md: rationale documented

### Active
- "(none)"

### Blocked
- "(none)"

## Next Move
1. Verify the migrated session store integrates correctly with existing opencode process architecture (no integration tests observed in conversation)
2. Run migrations against target Postgres instance to confirm schema creation succeeds

## Relevant Files
- `src/session/store.ts`: core implementation for connection pooling, retry logic, DATABASE_URL env handling, and migration runner
- `AGENTS.md`: contains rationale for choosing Postgres over SQLite
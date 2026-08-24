## Objective
Implement a Postgres-based session store for opencode with connection pooling, retry logic, environment configuration, and migration support to handle concurrent writes from multiple processes on NFS-backed storage.

## Important Details
- Decision: Postgres over SQLite due to need for concurrent WAL writes across multiple opencode processes (SQLite cannot reliably provide this on NFS)
- File: `src/session/store.ts` — all edits made here
- Database connection string must come from env var `DATABASE_URL`
- Connection pooling with retry logic implemented via pg Pool

## Work State
### Completed
- Decision recorded in AGENTS.md: Postgres for session store (concurrent WAL on NFS rationale)
- `src/session/store.ts`: pg Pool implementation with 10 iterations of connection pooling and retry logic added
- `DATABASE_URL` environment variable handling configured
- Migration runner implemented

### Active
(none)

### Blocked
(none)

## Next Move
1. (none — store implementation complete; verify via test or run migration commands to confirm setup)

## Relevant Files
- `src/session/store.ts`: main session store implementation with pg Pool, retry logic, DATABASE_URL env var handling, and migration runner
## Objective
Implement a Postgres-based session store with connection pooling and retry logic for opencode processes running on NFS, replacing SQLite as the storage backend.

## Important Details
- **Decision**: Use Postgres over SQLite due to concurrent write requirements and WAL semantics on NFS (SQLite cannot provide reliable WAL on NFS).
- **Environment variable**: `DATABASE_URL` must be configured for connection string.
- **File**: All changes are in `src/session/store.ts`.

## Work State
### Completed
- Decision documented in AGENTS.md (Postgres rationale).
- Connection pooling logic implemented (10 iterations completed on src/session/store.ts).
- DATABASE_URL environment variable handling added.
- Migration runner integrated into src/session/store.ts.

### Active
- Postgres session store implementation complete (pooling, retry logic, env config, migrations all addressed in src/session/store.ts).

### Blocked
- (none)

## Next Move
1. Verify migration runner executes successfully on initial run.
2. Validate connection pooling behavior under concurrent load with multiple opencode processes.

## Relevant Files
- `src/session/store.ts`: Postgres pool, retry logic, DATABASE_URL handling, and migration runner implementation.
- `AGENTS.md`: Decision documentation (Postgres vs SQLite rationale).
## Objective
- Implement a Postgres-based session store with connection pooling, retry logic, environment-based configuration, and migration runner support.

## Important Details
- **Store choice**: Postgres selected over SQLite for concurrent writes from multiple opencode processes + WAL semantics on NFS (SQLite cannot provide reliably).
- **Configuration**: Connection string must be read via `DATABASE_URL` env var.
- **Retry strategy**: Implemented across 10 iterations of connection pooling / retry logic.
- **Migration runner**: Added to support schema migrations for the session store tables.

## Work State
### Completed
- Decided on Postgres as session store (documented rationale in AGENTS.md).
- Created `src/session/store.ts` with pg Pool configuration and WAL-aware connection handling.
- Implemented 10 iterations of connection pooling / retry logic in `src/session/store.ts`.
- Added `DATABASE_URL` environment variable handling for Postgres connection string.
- Added migration runner integration to `src/session/store.ts`.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Test the session store with a real Postgres instance using the `DATABASE_URL` env var to verify pooling and retry behavior under concurrent load.
2. Verify migration runner executes correctly against an empty/new Postgres database schema.

## Relevant Files
- `src/session/store.ts`: Main session store implementation with pg Pool, connection pooling, retry logic, DATABASE_URL handling, and migration runner integration.
- `AGENTS.md`: Contains the rationale for choosing Postgres over SQLite (concurrent writes + NFS WAL semantics).
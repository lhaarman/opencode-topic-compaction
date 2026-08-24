## Objective
- Install dependencies using bun and fetch the API spec from https://api.example.com/v1/spec with proper authentication.

## Important Details
- Original dependency manager (pnpm) not available; switched to bun instead.
- The /v1/spec endpoint requires an `Authorization` header containing a valid API key.
- `.env` file exists and contains the API key credential but its contents were not displayed in the tool result, so the value must be read again or provided explicitly.

## Work State
### Completed
- Bun dependencies installed successfully (412 packages).
- Read `.env` file path confirmed.

### Active
- No active work; awaiting the actual API key value from `.env`.

### Blocked
- Fetch blocked: `curl https://api.example.com/v1/spec` returned HTTP 401 Unauthorized — missing API key header.
- Dependency manager pnpm is not installed (requires npm or bun).

## Next Move
1. Read `.env` contents to extract the API key value (or request the user to provide it explicitly).
2. Retry the fetch with `Authorization: Bearer <key>` header using bun.

## Relevant Files
- `.env`: contains the API key needed for authentication; read but contents not yet extracted in conversation.
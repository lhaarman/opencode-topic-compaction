## Objective
Install dependencies using bun and fetch API documentation from https://api.example.com/v1/spec with an API key header.

## Important Details
- `pnpm` is not available on this system; switched to `bun`.
- API endpoint requires an `Authorization` header (API key) — the 401 response indicates a missing or invalid key.
- `.env` file exists and should contain the API key value.

## Work State
### Completed
- Ran `bun install` successfully; installed 412 packages.

### Active
- Attempted to read `.env` to retrieve the API key (contents were not fully returned in tool result).

### Blocked
- The fetch of https://api.example.com/v1/spec failed with HTTP 401 Unauthorized — needs an `Authorization: Bearer <key>` header.
- The full contents of `.env` are not yet available to extract the API key value.

## Next Move
1. Read `.env` file and extract the API key value (e.g., `API_KEY=...`).
2. Retry the fetch with the correct Authorization header: `curl -H "Authorization: Bearer <key>" https://api.example.com/v1/spec`.

## Relevant Files
- `.env`: expected to contain environment variable for the API key used to authenticate against the endpoint.
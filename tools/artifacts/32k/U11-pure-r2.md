## Objective
Add an API client to fetch https://api.example.com/v1/spec and improve the structured logger while waiting for valid credentials.

## Important Details
- The API endpoint requires authentication; no key or bearer token is currently configured
- Logger improvements were made independently of the blocked fetch request
- curl returns HTTP/1.1 401 Unauthorized (with bearer guess, without, and with Authorization header variations)

## Work State
### Completed
- src/api/client.ts: Added `fetchSpec()` function
- src/util/logger.ts: Implemented level support; added child loggers with request IDs

### Active
- (none)

### Blocked
- Fetching https://api.example.com/v1/spec requires an API key header or valid bearer token — 8 retry attempts have failed with HTTP/1.1 401 Unauthorized

## Next Move
1. Obtain valid API credentials (key or bearer token) for the endpoint
2. Retry fetchSpec() with proper Authorization header once credentials are available

## Relevant Files
- src/api/client.ts: Contains `fetchSpec()` awaiting authentication fix
- src/util/logger.ts: Enhanced with child loggers and request IDs; ready for use
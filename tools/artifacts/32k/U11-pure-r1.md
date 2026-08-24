## Objective
Add an API client to fetch https://api.example.com/v1/spec and improve the structured logger while waiting for valid credentials.

## Important Details
- The API endpoint requires authentication; no key or bearer token is currently configured
- curl returns HTTP/1.1 401 Unauthorized (twice with bearer guess, once without)
- Logger improvements were made independently of the blocked fetch request

## Work State
### Completed
- src/api/client.ts: Added `fetchSpec()` function
- src/util/logger.ts: Implemented level support; added child loggers with request IDs

### Active
- (none)

### Blocked
- Fetching https://api.example.com/v1/spec requires an API key header or valid bearer token
- Command blocked: `curl -H "Authorization: Bearer guess" https://api.example.com/v1/spec` → HTTP/1.1 401 Unauthorized
- Command blocked: `curl https://api.example.com/v1/spec` → HTTP/1.1 401 Unauthorized

## Next Move
1. Obtain valid API credentials (key or bearer token) for the endpoint
2. Retry fetchSpec() with proper Authorization header once credentials are available

## Relevant Files
- src/api/client.ts: Contains `fetchSpec()` awaiting authentication fix
- src/util/logger.ts: Enhanced with child loggers and request IDs; ready for use
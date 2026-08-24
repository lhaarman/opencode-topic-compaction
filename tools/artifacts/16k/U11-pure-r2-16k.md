## Objective
- Fetch https://api.example.com/v1/spec via a client in `src/api/client.ts` using proper authentication.

## Important Details
- The endpoint returns HTTP/1.1 401 Unauthorized when no API key header is provided.
- A bearer token guess (`Authorization: Bearer guess`) was rejected with the same 401 error.
- No valid authentication token or API key has been obtained yet.

## Work State
### Completed
- `src/util/logger.ts` enhanced with structured fields, level support, child loggers, and request ID propagation (verified across rounds 1, 3, 5, 7; tests pass).
- `src/api/client.ts` exists with a `fetchSpec()` function targeting https://api.example.com/v1/spec.

### Active
- None.

### Blocked
- `curl https://api.example.com/v1/spec` → HTTP/1.1 401 Unauthorized (requires API key header).
- `curl -H "Authorization: Bearer guess" https://api.example.com/v1/spec` → HTTP/1.1 401 Unauthorized.
- No valid authentication token or API key has been provided yet.

## Next Move
1. Obtain a valid API key or bearer token from the user for `https://api.example.com/v1/spec`.
2. Update `src/api/client.ts` to accept and use an environment variable or configuration for credentials.
3. Retry the fetch with the new authentication method.

## Relevant Files
- `src/api/client.ts`: API client implementation; requires authentication header before fetching from https://api.example.com/v1/spec.
- `src/util/logger.ts`: Structured logger with level support and child loggers featuring request IDs; already implemented and ready for use.
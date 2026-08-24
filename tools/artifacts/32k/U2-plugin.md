## Objective
- Build an iterative request router in `src/app.ts` that progressively handles more HTTP methods and edge cases across 11+ iterations.

## Important Details
- Target file: `src/app.ts`
- Pattern: Each iteration adds new method handlers (GET, POST, PUT, DELETE, PATCH, etc.) and defensive guards (method not allowed, path not found, invalid requests).
- No explicit constraints or preferences stated by user.
- All 11 iterations reported as successfully completed with no errors.

## Work State

### Completed
- Iteration 1: Initial router setup + first batch of handlers/guards
- Iteration 2: Added more method handlers and edge case guards
- Iteration 3: Extended handler coverage and guard logic
- Iteration 4: Further expanded method support and edge handling
- Iteration 5: Continued adding handlers and guards
- Iteration 6: Expanded router capabilities with new cases
- Iteration 7: Added more defensive routing logic
- Iteration 8: Increased method/guard coverage
- Iteration 9: Further refined handlers and guards
- Iteration 10: Extended edge case handling
- Iteration 11: Latest round of handlers and guards added

### Active
- Router is complete as of iteration 11; awaiting next user direction (iteration 12 or final review).

### Blocked
- (none)

## Next Move
1. Wait for user's next instruction (either "Router iteration 12" or a review request).
2. If new iteration requested, read `src/app.ts`, identify missing methods/guards, and implement them.

## Relevant Files
- `src/app.ts`: Main router implementation file; all 11 iterations have modified this single file to progressively expand method support and edge case handling.
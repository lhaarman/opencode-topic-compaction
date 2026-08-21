# AGENTS.md

Guidelines for developing this repo: a standalone opencode plugin (`session_graph_png`)
that graphs a session and renders it to PNG. The plugin is self-contained and
self-documenting; these notes cover only how to work on the code here.

## Source of truth & sync

`src/` is the source of truth for git. The copies opencode actually loads live in
`.opencode/plugins/` and must be kept byte-identical:

```
cp src/graph-model.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/
```

`Roboto-Regular.ttf` lives only in `.opencode/plugins/`. Verify with
`diff -r src .opencode/plugins` (ignore the ttf and `test_*` files there).

## Module layout

- `src/graph-model.ts` — graph building; no rendering deps.
- `src/graph-theme.ts` — pure visual constants.
- `src/graph-render.ts` — layout + PNG rendering.
- `src/graph-plugin.ts` — thin entry: registers the tool, wires model → render.

## Verification

1. Typecheck (from `.opencode/`):
   `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-model.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts`
   (The `import.meta.dir` error in `graph-render.ts` is expected — bun-only, fine at runtime.)
2. Unit tests: `bun plugins/test_cluster.ts`.
3. Live E2E (needs an `opencode serve` on port 4399): `bun plugins/test_graph-plugin.ts`.
4. `diff -r` src vs `.opencode/plugins` to confirm sync.

## Code style

- 2-space indentation, no semicolons, double-quoted strings.
- Comments explain the "why", not the "what" — keep them sparse.
- No dead code, no duplicated logic, minimal `any`; prefer small typed unions over casts.
- Pure functions over side effects; keep the model free of rendering concerns.
# AGENTS.md

Guidelines for developing this repo: `opencode-topic-compaction`, a standalone opencode plugin
providing topic/community-based compaction via opencode's compacting hook.
The plugin is self-contained and self-documenting; these notes cover only how
to work on the code here.

## Source of truth & sync

`src/` is the source of truth for git. The copies opencode actually loads live in
`.opencode/plugins/` and must be kept byte-identical:

```
cp src/topics-cluster.ts src/topics-compaction.ts src/topics-model.ts src/topics-plugin.ts .opencode/plugins/
```

Verify with `diff -r src .opencode/plugins` (ignore the `test_*` files in `src/`).

## Module layout

- `src/topics-model.ts` — turns session entries into nodes/edges; resolves the active window after the last compaction boundary and splits off the raw recent tail.
- `src/topics-cluster.ts` — task-community ("topic") detection over the built graph.
- `src/topics-compaction.ts` — compaction-prompt OVERRIDE built from the detected topics.
- `src/topics-plugin.ts` — thin entry: registers the compacting hook, wires model → compaction.

## Verification

1. Typecheck (from `.opencode/`):
   `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/topics-cluster.ts plugins/topics-compaction.ts plugins/topics-model.ts plugins/topics-plugin.ts`
2. Unit tests: `bun src/test_cluster.ts`.
3. `diff -r` src vs `.opencode/plugins` to confirm sync.

## Evaluation harness

`tools/` holds the rerunnable compaction evaluation: `eval_clones.ts` builds
paired sessions per use-case (`U1..U12`, `BIG1/BIGF`, `MID/MIDF`, `ENG`, `DEG`),
`eval_run2.ts` runs head-to-head summarize flows against serves on 4399
(plugin) / 4400 (`--pure`), `eval_degrade.ts` runs the 10-round
repeated-compaction study. Raw outputs land in `/tmp/opencode/compaction-eval/`
(`results.jsonl`, per-arm `.md`) and are preserved under `tools/artifacts/`;
see `compaction-report.md`.

## Code style

- 2-space indentation, no semicolons, double-quoted strings.
- Comments explain the "why", not the "what" — keep them sparse.
- No dead code, no duplicated logic, minimal `any`; prefer small typed unions over casts.
- Pure functions over side effects; keep the model free of rendering concerns.

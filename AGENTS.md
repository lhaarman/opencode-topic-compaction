# AGENTS.md

Guidelines for developing this repo: `opencode-topic-compaction`, a standalone opencode plugin
providing topic/community-based compaction via opencode's compaction hook (V2).
The plugin is self-contained and self-documenting; these notes cover only how
to work on the code here.

## Source of truth & sync

`src/` is the source of truth for git. The copy opencode actually loads lives in
`.opencode/plugins/topic-compaction/` and must be kept byte-identical. V2 discovers
**immediate plugin directories** under `.opencode/plugins/`, so the entrypoint must be
`index.ts` (a bare `topics-plugin.ts` beside the helpers would be loaded as its own,
broken plugin). The npm entry stays `src/topics-plugin.ts` (`package.json` `main`).

```
mkdir -p .opencode/plugins/topic-compaction
cp src/topics-cluster.ts src/topics-compaction.ts src/topics-model.ts .opencode/plugins/topic-compaction/
cp src/topics-plugin.ts .opencode/plugins/topic-compaction/index.ts
```

Verify every pair is byte-identical (entry maps `topics-plugin.ts` → `index.ts`):

```
diff src/topics-cluster.ts .opencode/plugins/topic-compaction/topics-cluster.ts
diff src/topics-compaction.ts .opencode/plugins/topic-compaction/topics-compaction.ts
diff src/topics-model.ts .opencode/plugins/topic-compaction/topics-model.ts
diff src/topics-plugin.ts .opencode/plugins/topic-compaction/index.ts
```

## Module layout

- `src/topics-model.ts` — turns session entries into nodes/edges; resolves the active window after the last compaction boundary and splits off the raw recent tail.
- `src/topics-cluster.ts` — task-community ("topic") detection over the built graph.
- `src/topics-compaction.ts` — compaction-prompt OVERRIDE built from the detected topics.
- `src/topics-plugin.ts` — thin V2 entry (`Plugin.define` + `ctx.session.hook("compaction")`), wires model → compaction.

V2 notes:
- `buildGraph` reads the session's model-visible window via `ctx.session.context()`; V2 stores
  messages in `session_message`, so the legacy `message`/`part` tables read empty.
- V2 validates a model-generated compaction summary against its own section headings and fails
  when they are missing. The plugin therefore owns the compaction: on ≥2 topics it generates the
  summary via `ctx.generate.text` and sets `event.result`, which opencode stores verbatim and does
  not template-check. Output is pure `# TOPIC n:` + `# STATE`, with no native headings.
- Below two topics, or on any generation error or empty result, the hook sets nothing and
  opencode's native compaction runs untouched.
- Every load and compaction decision is appended to
  `~/.local/share/opencode/log/topic-compaction.log`.
- Local dev install: symlink the plugin dir into `~/.config/opencode/plugins/` to load it for
  every location.

## Verification

1. Typecheck (from `.opencode/`):
   `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/topic-compaction/topics-cluster.ts plugins/topic-compaction/topics-compaction.ts plugins/topic-compaction/topics-model.ts plugins/topic-compaction/index.ts`
2. Unit tests: `bun src/test_cluster.ts`.
3. Per-file `diff` src vs `.opencode/plugins/topic-compaction` to confirm sync (see above).
4. Runtime: `topic-compaction` shows `status: active` in `opencode api get /api/plugin` for this location.

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

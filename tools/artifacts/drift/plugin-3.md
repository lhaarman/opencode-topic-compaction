# Summary: Community-Based Compaction Plugin for opencode — Exhaustive Evaluation Phase

## Overall Goal

Evolve `/workspaces/opencode-topic-compaction` so its `experimental.session.compacting` hook produces **community-based, topic-structured compaction summaries** (`# TOPIC n: <label>` sections + global `# STATE`) that surpass opencode's native linear compaction (`## Objective / Important Details / Work State / Next Move / Relevant Files`), while **never making compaction worse** (graceful fallback to native). Currently executing an **exhaustive quality assessment** across 13 windows × 2 conditions (plugin `:4399` vs pure `:4400`) with `x-preview-f-free`; **local qwen3.8-9b runs are deferred** — user explicitly said *"For the local model, keep those for the last. Come back to me before starting those."*

## Repo Layout & Commands

- Source of truth: `/workspaces/opencode-topic-compaction/src/` — `graph-model.ts`, `graph-cluster.ts`, `graph-compaction.ts`, `graph-theme.ts`, `graph-render.ts`, `graph-plugin.ts`, `test_cluster.ts` (30 checks), `test_graph-plugin.ts`
- Sync (byte-identical per AGENTS.md): `cp src/graph-model.ts src/graph-cluster.ts src/graph-compaction.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/ && diff -r src .opencode/plugins --exclude=Roboto-Regular.ttf --exclude=test_cluster.ts --exclude=test_graph-plugin.ts && echo "SYNC OK"`
- Typecheck (from `.opencode/`): `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/*.ts` — only expected error: `graph-render.ts import.meta.dir` (bun-only)
- Tests: `bun src/test_cluster.ts` (30/30 pass)
- DB: `/home/vscode/.local/share/opencode/opencode.db` (WAL mode); read via `bun:sqlite` readonly. Backup at `/tmp/opencode/opencode-backup-precloning.db`
- Model: `opencode/x-preview-f-free` (providerID `opencode`); local = `lmstudio/qwen/qwen3.8-9b` (note: `lmstudio-local/qwen3.8-9b` returns 500; the working combo is providerID `lmstudio` + modelID `qwen/qwen3.8-9b`)

## Current Implementation State (lean rev, all synced)

**`src/graph-compaction.ts`** — late-position OVERRIDE via `output.context.push()` (NOT `output.prompt`; replacement failed live — model continued conversation because instructions landed before raw history):
- Role line → "IMPORTANT OVERRIDE: disregard the \<template\> section above" → `# TOPIC <n>: <label>` spec with per-topic **`blocked: <reason or none so far>`** (key always present; when blocked include exact error string/HTTP status + affected tool/file, never bare "tool error") → `# STATE` with **global** "what to do next" as concrete actions after all topics (not per-topic) → Rules incl. currency rule ("final turns are the newest truth…") and soft bullets ("Aim for ~5 bullets per topic; beyond 5 only if critical") → optional `<prior-summary>` fusion block (native ZX wording adapted) → TOPIC map
- `topicsOf()`: one topic per community; prompts = first 3 user excerpts (80 chars); files capped `MAX_FILES_PER_TOPIC=5` (+N more); `plausibleLabel()` rejects `tool-output/*` and `tool_<id>` junk labels → prompt-derived fallback; duplicate labels get `— <prompt>` disambiguation
- `topicsByGaps()`: fallback segmentation at `GAP_MS=10min` silence when clustering yields ≤1 community; labels from opening prompts; `MAX_TOPICS=12`
- Guard: `<2 topics → undefined` → pure native (never-worse guarantee)
- `truncatePrior()`: `MAX_PRIOR_CHARS=3000` (head 1800 + marker + tail 800)

**`src/graph-model.ts`**: `buildGraph` returns `{nodes, edges, communities, fetch:{source,count}, previousSummary}`; fetch = client `limit:1000` + shape normalization + chronological sort + readonly `bun:sqlite` DB fallback when <5 entries; active-window scan **excludes trailing compaction marker** (opencode attaches it before firing hook — the 14:26 `nodes=1` bug); `summaryText()` extracts prior summary; hardened `tokenTotal` (`tokens ?? {}`) and `modelLabel` (missing model).

**`src/graph-cluster.ts`**: causal chains per user-message → merge on weighted file overlap (`EDIT_WEIGHT=8`, `READ_WEIGHT=1`, `MERGE_SIMILARITY=0.3`, sqrt norm, union-find low-id-wins) → ride-along file-less chains → labels = most-touched file last 2 segments.

**`src/graph-plugin.ts`**: registers `session_graph_png` tool + compacting hook (try/catch → native fallback); TEMP breadcrumbs to `/tmp/opencode/hook-trace.log` (`module-loaded`, `hook-enter`, `graph-built {source,entries,nodes,communities,contextChars}`, `context-pushed {chars}`, `hook-error`).

## Key opencode Internals Learned (from binary RE + GitHub source)

- Hook fires AFTER opencode attaches `type:"compaction"` part to the fresh boundary user message → window scan must exclude trailing marker
- Assembly: `to = Ve.prompt ?? [buildPrompt({previousSummary,context:[ze]}), ...Ve.context].join("\n\n")`; with prompt set, history appended AFTER instructions (caused continuation failure); with context-only, our text lands LAST (wins)
- Native serializer truncates tool results to 2000 chars; format `[User]:/[Assistant]:/[Tool result]:`
- Auto-compaction (overflow) path does NOT fire the compacting hook (upstream limitation); manual `/compact` does
- Every `.ts` in `.opencode/plugins/` is loaded as a plugin entry — lib-module load errors are cosmetic noise
- SDK: `POST /session/{id}/summarize {"providerID","modelID"}` triggers manual compaction; messages endpoint paginated (`limit` param)

## Evaluation Infrastructure & Results So Far

- **Replay eval** (`/tmp/opencode/eval_compaction.ts`): 12 historical points → 8 inject (avg 3.4 topics) / 4 native fallback; garbage-prior detection works
- **Live paired runs** (x-preview): e1 141→**6562 chars 5 TOPIC** vs pure 6068 native; e2b-lean 332→**5466 4 TOPIC** vs pure 7005 (pre-lean hit `length` 0-chars — fixed by truncation); e3 410→**4237 2 TOPIC** vs pure 3908; e4 degenerate → both cap (parity)
- **Local 4k qwen3.8-9b**: both paths degrade (extreme stress; not representative)
- **Reports**: `/tmp/opencode/compaction-report.md` (§1–§11 incl. balanced wins/losses table + paired head-to-head §9), `/tmp/opencode/compaction-findings.md`, plan files in `.opencode/plans/`

## Current Task State (in progress)

Exhaustive assessment, todos: synthetics ✅, preflight ✅, **headless x-preview compactions ← IN PROGRESS**, metrics/score/report pending, local qwen deferred (check in with user first).

Synthetic corpus ready (stale markers cleaned): syn-rare (43n/2c/2t/1973), syn-decision (37n/1c/fallback), syn-causal (28n/3c/3t/2164), syn-small (19n/2c/2t/2048), syn-parallel (47n/3c/3t/2240), syn-blocked (11n/1c/fallback), syn-large (111n/4c/4t/2414).

Freshly cloned paired test sessions (id-remapped, `xp`/`xs` suffixes): x-rare/x-decision/x-causal/x-small/x-parallel/x-blocked/x-large each in `-plugin` and `-pure` variants (14 sessions, ids logged in transcript).

Historical windows: e1 `ses_wwbb71trwed0nrkiq59p`, e2 `ses_srtz7csojkgnz5h89kc1`, e3 `ses_enbnfq9hfl18b301v3wm`, e4 `ses_vdtd5542gfmkyqh4b0kd`.

## Next Steps

1. Start `opencode serve --port 4399` (plugin) and `--pure --port 4400` from `/workspaces/opencode-topic-compaction` (verify `module-loaded` in trace; NOTE: `pkill -f "opencode serve"` hangs the shell — kill by PID)
2. Run paired `POST /session/{id}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}` for all 7 x-*-plugin (on 4399) and x-*-pure (on 4400); poll DB for new `mode:compaction` text; save to `/tmp/opencode/result_<tag>.md`
3. Score each pair 1–100 (rubric: Segmentation 20/Rare 15/Decision 15/Causal 15/Blocked-Next 10/Currency 10/Scannability 10/Cost 5 + tie-break epsilon)
4. Build `/tmp/opencode/exhaustive-report.md`: table with columns `problem | context before | context after (plugin) | context after (pure) | comparison (improve/unlock/worse/gap) | scores | evidence`
5. **STOP before local qwen runs — check in with user** (they want to confirm setup: model loaded at chosen context size, correct provider/modelID combo `lmstudio` + `qwen/qwen3.8-9b`)
6. Iterate compaction if any window underperforms; keep findings in MD (context overflow protection)

## Gotchas

- `pkill -f "opencode serve"` hangs shell → use `kill <pid>`
- Truncated display ids break exact-match queries → use `LIKE 'prefix%'`
- Stale compaction parts in cloned/synthetic sessions collapse windows → scan parts table and delete marker messages before replay
- Clones from same source need id remapping (UNIQUE constraint) + `info.sessionID` field + `parentID` remap
- `bun -e` inline scripts: avoid nested quote conflicts; prefer writing script files to `/tmp/opencode/`
- Two identical odd tool outputs usually mean you're reading stored summary content, not corruption
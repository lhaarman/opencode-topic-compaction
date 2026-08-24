## Objective
- Evaluate and polish the `graph-compaction` opencode plugin (community/topic-based compaction via `experimental.session.compacting` hook + `session_graph` PNG tool) so it can be presented to peers; run objective head-to-head evaluations against opencode base compaction; produce a current-state-only evaluation report.

## Important Details
- Plugin identity (renamed this session): plugin `id: "graph-compaction"`, tool **`session_graph`** (was `session_graph_png`), hook `experimental.session.compacting`. No filenames changed; sync/tsc commands untouched.
- Source of truth `src/` ↔ `.opencode/plugins/` must stay byte-identical: `cp src/graph-cluster.ts src/graph-compaction.ts src/graph-model.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/ && diff -r src .opencode/plugins` (ignore `Roboto-Regular.ttf`, `test_*`).
- Typecheck (from `.opencode/`): `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-cluster.ts plugins/graph-compaction.ts plugins/graph-model.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts` — only expected error: `plugins/graph-render.ts(89,59): error TS2339: Property 'dir' does not exist on type 'ImportMeta'` (bun-only).
- Tests: `bun src/test_cluster.ts` → **45/45 PASS**.
- User constraints: reports must evaluate the plugin **as it currently is** — no improvement history, no v1/v2 baselines, no progress log. Naming direction chosen by user: plugin id `graph-compaction`, tool renamed to `session_graph` (breaking accepted).
- Model: `opencode/x-preview-f-free` (free remote); provider intermittently stalls on compaction-sized prompts (trivial chat 4–25 s, stalls up to minutes, occasional instant `500 UnknownError`). Harness supports `POLL_BUDGET_SECS` env cap (used 240 s today).
- Harness: `/tmp/opencode/eval_run2.ts` (per-case CLI, time-based detection requiring text-bearing `mode:"compaction"` messages, retry-once, crash-safe JSONL `/tmp/opencode/compaction-eval/results.jsonl`), `/tmp/opencode/eval_clones.ts <CASE|all>` (per-case reclone). Fusion cases U9/U11 must NOT reclone on retry (destroys round-1 marker). `restartServes()` required after SQL appends (opencode caches session state in memory).
- Dual serve: port 4399 (plugin) / 4400 (`--pure`); both share one DB; separate session IDs per arm prevent cross-contamination.
- DB: `/home/vscode/.local/share/opencode/opencode.db` via `bun:sqlite` readonly (`PRAGMA busy_timeout = 5000`); SDK list endpoint version-skewed vs server 1.18.21 — read/poll via DB directly.
- Current evaluation results (in `compaction-report.md`, current-state format): U1–U8 complete both arms (graph wins all 4 multi-topic cases, ties singles by design fallback); U11 blocker carry-forward proven live (`blocked: 401 Unauthorized …` survives boundary verbatim); U9 r1 both arms + pure-r2 ✓, plugin-r2 pending (provider stalls); U10 graph 8.4k ch @170 s / base 7.3k ch @115 s at ~306k tok.
- Deferred experiments: degradation loop (needs new `eval_degrade.ts`, 10 rounds chosen by user), U10 fresh post-fix pair, local `qwen3.8-9b` sweep (long-deferred).
- `session-vanish-race.md` written as upstream-ready bug draft (sessions ~300k tok deleted server-side mid-summarize, reproduced 3×).

## Work State
### Completed
- Phase 1 plugin fixes (landed, synced, tested): extracted pure `activeWindow(items)` in `src/graph-model.ts` — strips ALL trailing marker-pair members AND bounds slice by `scanEnd` (fixed resurrection bug where stripped markers were re-included); `previousSummary` recovered by walking back over contiguous marker entries (handles text-on-assistant-twin + orphaned stub markers; live-verified 0→1669 chars on real U9 session); `promptExcerpt()` filter in `src/graph-compaction.ts` excludes `(user message)` placeholders from map lines.
- Phase 2 harness upgrades: realistic text-bearing `appendWork` (optional per-case file/text specs); U11 blocker-fusion case wired end-to-end (cloner builder + generalized `runFusion(kase)` handling U9/U11 + automatic blocker-carry audit JSONL record); verified U11 clones build correctly (12 msgs, text parts, 401 error parts).
- Rename executed: `session_graph_png`→`session_graph`, `id: "graph-compaction"`, comments/test assertion/AGENTS.md intro (compaction-led)/report subject updated; grep confirms zero leftovers; live serve registers `session_graph`, legacy name absent.
- `AGENTS.md:34` E2E instruction fixed to copy-first flow (`cp src/test_graph-plugin.ts .opencode/plugins/ && bun .opencode/plugins/test_graph-plugin.ts && rm ...`) since SDK resolves only under `.opencode/node_modules`.
- `compaction-report.md` rewritten as current-state evaluation (method, U1–U8 table, fusion results, U10, latency profile, limitations §6, verdict §7). `session-vanish-race.md` written.
- Cleanup earlier: TEMP trace removed, compaction-marker exclusion in `topicsOf`, AGENTS.md sync command includes cluster+compaction modules.

### Active
- **Code review for peer-readiness** (user request): reviewing docs-not-excessive/simplicity/low mental-layer-count across all sources. Reads done: `graph-theme.ts` (clean, pure constants), partial `graph-model.ts`, `graph-cluster.ts`, `graph-render.ts`, `graph-plugin.ts`.
- Review findings collected so far (not yet reported):
  - `graph-cluster.ts:7` header comment says "Edits weigh four times a read" but `EDIT_WEIGHT=8` vs `READ_WEIGHT=1` (8×) — doc inconsistency.
  - `assignCommunities(nodes, partsByNode, _entries?, _workspace?)` carries unused underscore params — dead API surface.
  - `KIND_LABELS` duplicated in `graph-model.ts:39` and `graph-render.ts:51`.
  - `messageContent` fallback `(${KIND_LABELS[kind]})` is render-oriented but leaks into compaction prompts (mitigated by `promptExcerpt` filter — layering smell worth noting).
- Full plan requested with ≥3 topics: **Code Review Consequences**, **Remaining Evaluations**, **Implement Improvements**.

### Blocked
- Provider (`x-preview-f-free`) stall windows block any LLM-dependent experiment; U9-plugin-r2 stalled twice today (240 s caps), recorded pending.
- Live E2E `test_graph-plugin.ts` chat-turn step hits recurring provider `500 UnknownError` (tool registration itself verified OK via direct `client.tool.ids()` check).
- Session-vanish race on ~306k-token windows (upstream issue, documented).

## Next Move
1. Finish reading remaining source (`src/graph-plugin.ts` current state, rest of `src/graph-model.ts` beyond line ~50, remainder of `src/graph-cluster.ts`/`src/graph-render.ts`, `src/test_cluster.ts`) then write the peer-readiness code review covering documentation accuracy, simplicity, and mental-model layer count.
2. Write the full remaining-work plan with the three required topics: Code Review Consequences (fixes implied by review findings above), Remaining Evaluations (U9-plugin-r2 retry, degradation loop w/ `eval_degrade.ts` 10 rounds, optional U10 fresh pair, optional qwen sweep), Implement Improvements (topic-map recurrency §6.1 refinement — derive map labels from most-recent segment to fix "no activity" mislabeling).

## Relevant Files
- `src/graph-model.ts`: core data model; `buildGraph()`, exported pure `activeWindow()`, `summaryText()`, `isCompaction()`, `messageContent()` fallback, `DEGENERATE_VIEW_THRESHOLD=5`; fetch client-first + DB fallback.
- `src/graph-cluster.ts`: `assignCommunities()` 3-pass clustering (`EDIT_WEIGHT=8`, `READ_WEIGHT=1`, `MERGE_SIMILARITY=0.3`); unused `_entries`/`_workspace` params; stale "four times" comment.
- `src/graph-compaction.ts`: `compactionContext()` override builder; `openBlockers()` carry-forward; `promptExcerpt()`; constants `MAX_TOPICS=12`, `MAX_PRIOR_CHARS=3000`, `MAX_CARRIED_BLOCKERS=5`, `GAP_MS=10min`.
- `src/graph-plugin.ts`: entry — tool `session_graph`, hook wiring, `id: "graph-compaction"`.
- `src/graph-render.ts` / `src/graph-theme.ts`: PNG rendering (pureimage, SCALE=2) / visual constants.
- `src/test_cluster.ts`: 45 unit checks incl. marker-pair/stub/placeholder cases.
- `compaction-report.md`: current-state evaluation (v3 style, no history).
- `session-vanish-race.md`: upstream bug-report draft.
- `AGENTS.md`: dev guidelines (sync/typecheck/tests/E2E instructions).
- `/tmp/opencode/eval_run2.ts`, `/tmp/opencode/eval_clones.ts`: hardened eval harness (POLL_BUDGET_SECS support; fusion no-reclone guard for U9/U11).
- `/tmp/opencode/compaction-eval/results.jsonl` + `U*.md`: machine records + raw outputs.
- `.opencode/plans/compaction-eval-plan.md`: original eval plan backup.
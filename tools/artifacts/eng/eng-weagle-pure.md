## Objective
- Evaluate and polish the `graph-compaction` opencode plugin (topic/community-based compaction via `experimental.session.compacting` hook, plus `session_graph` PNG tool) to peer-presentable quality: code review for documentation/simplicity/mental-model layers, then a full remaining-work plan covering Code Review Consequences, Remaining Evaluations, Implement Improvements.

## Important Details
- Reports must evaluate the plugin **as it is right now** — no improvement history, no v1/v2 baselines, no progress log (explicit user constraint).
- Style rules: 2-space indent, no semicolons, double quotes, comments explain "why" only, no dead code; `src/` ↔ `.opencode/plugins/` kept byte-identical via `cp src/graph-{cluster,compaction,model,theme,render,plugin}.ts .opencode/plugins/`.
- Naming just executed: plugin `id: "graph-compaction"` (`src/graph-plugin.ts:59`), tool renamed `session_graph_png` → **`session_graph`** (breaking, accepted); AGENTS.md intro compaction-led; zero leftovers verified by grep.
- Eval model `opencode/x-preview-f-free`; dual-serve harness: port 4399 (plugin) vs 4400 `--pure`; clones in `/home/vscode/.local/share/opencode/opencode.db` as slugs `x-u<N>-{plugin,pure}`; harness scripts `/tmp/opencode/eval_clones.ts` (per-case U1..U11/"all") and `/tmp/opencode/eval_run2.ts` (per-case CLI + `--force`, time-based detection, JSONL persistence, retry-once, fusion cases keep session across retries, serve-restart between rounds, `POLL_BUDGET_SECS` env cap).
- Environment facts that shape any future work: opencode caches session state in memory (SQL writes behind live serve invisible → restart serves after mutations); summarize agent has tools (contamination vector); failed generations leave text-less markers; provider flaky (240s-capped stalls, symmetric across arms); session-vanish race deletes ~880-msg sessions ~10 min into summarize (drafted upstream in `session-vanish-race.md`).
- Today's landed plugin fixes (45/45 tests, sync green): blocker carry-forward (`openBlockers()`, cap 5), brevity/currency prompt rules, pure `activeWindow()` fixing scanEnd-bounded slice + previousSummary-from-assistant-marker + backward walk over contiguous markers for stub fallback, `promptExcerpt()` placeholder filter.

## Work State
### Completed
- Evaluation complete: U1–U8 both arms (table + latency in report); U9 r1 ✓ both, r2-pure ✓ 2298ch, r2-plugin pending-stalled; U11 valid fusion ✓ — `blocked: 401 Unauthorized…awaiting user-provided key` carried verbatim into r2; U10 graph 8.4k ch @170s vs base 7.3k @115s (~306k tok window).
- `compaction-report.md` rewritten as current-state evaluation only (method §1, U1–U8 §2, fusion §3 incl. U11 proof, U10 §4, latency profile §5, limitations §6, verdict §7 recommends use-as-is).
- `session-vanish-race.md` upstream-ready draft written.
- Rename verified live: serve restarted, registry contains `session_graph`, legacy name absent; grep confirms no leftovers; E2E chat turn hit pre-existing provider 500 (unrelated); AGENTS.md E2E line fixed to copy-first SDK-resolution flow.
- Verification trio green: 45/45 `bun src/test_cluster.ts`; typecheck clean except known bun-only `import.meta.dir` at `.opencode/plugins/graph-render.ts(89,59)`; `diff -r src .opencode/plugins` byte-identical (ignore `Roboto-Regular.ttf`, `test_*`).
- Serves running: 4399 with renamed plugin, 4400 `--pure`.

### Active
- Code review (plan mode, read-only): `src/graph-cluster.ts` fully read (3-pass clustering; unused `_entries?: SessionEntry[], _workspace?: string` params in `assignCommunities` are cleanup candidates; header comment says "edits weigh four times" but constant is 8 — doc drift); `src/graph-model.ts` partially re-read (types/fetch/`KIND_LABELS` at :39 duplicating render's own map at `src/graph-render.ts:51`; `messageContent` fallback emits `(${KIND_LABELS[kind]})` placeholders consumed by renderer but filtered in compaction maps).
- Still to read this pass: rest of `src/graph-model.ts` (buildGraph body past :165, toolContent, classifyMessageKind, tokenTotal), `src/graph-render.ts`, `src/graph-theme.ts`, final `src/graph-plugin.ts`, test files.

### Blocked
- Provider stalls/500s: U9-plugin-r2 completion, fresh U10 pair.
- Deferred by explicit user decision: degradation loop (script + 10 rounds), local `qwen3.8-9b` sweep.

## Next Move
1. Finish the read-only review pass over remaining sources (`src/graph-model.ts` buildGraph body, `src/graph-render.ts`, `src/graph-theme.ts`, `src/graph-plugin.ts` current state, `src/test_graph-plugin.ts`) collecting findings on documentation accuracy, dead code, duplication, and mental-model layers.
2. Deliver review findings + full remaining-work plan structured as ≥3 topics — Code Review Consequences (doc drift like cluster "four times" vs EDIT_WEIGHT=8, unused `_entries`/`_workspace` params, KIND_LABELS duplication, comment/comment-block pruning), Remaining Evaluations (U9-plugin-r2 retry ~5 min when provider cooperates; write `eval_degrade.ts` + 10-round loop; optional U10 fresh pair), Implement Improvements (§6.1 topic-map recurrency: derive labels/prompts from most-recent segment to fix "No activity recorded" under-crediting) — then await approval before executing.

## Relevant Files
- `src/graph-plugin.ts`: entry — `session_graph` tool + compacting hook, `id: "graph-compaction"`.
- `src/graph-model.ts`: types, fetch (client `limit:1000` + readonly `bun:sqlite` fallback when `<DEGENERATE_VIEW_THRESHOLD=5`), `activeWindow()`, `summaryText`, `messageContent` fallback `(${KIND_LABELS[kind]})`.
- `src/graph-cluster.ts`: `assignCommunities(nodes, partsByNode, _entries?, _workspace?)` with EDIT_WEIGHT=8/READ_WEIGHT=1/MERGE_SIMILARITY=0.3.
- `src/graph-compaction.ts`: `compactionContext`, `topicsOf`, `topicsByGaps`, `promptExcerpt`, `openBlockers`, caps `MAX_TOPICS=12`, `MAX_FILES_PER_TOPIC=5`, `MAX_PRIOR_CHARS=3000`, `GAP_MS=10*60*1000`.
- `src/graph-render.ts` / `src/graph-theme.ts`: pureimage rendering (SCALE=2), theme constants — review pending.
- `src/test_cluster.ts` (45 checks) / `src/test_graph-plugin.ts` (live E2E, asserts `session_graph`).
- `AGENTS.md`: sync list, typecheck command (run from `.opencode/`), E2E copy-first flow.
- `compaction-report.md`, `session-vanish-race.md`, `.opencode/plans/compaction-eval-plan.md`: deliverables/history.
- `/tmp/opencode/eval_run2.ts`, `/tmp/opencode/eval_clones.ts`: harness (U1–U11 wired, `runFusion` generalized, `POLL_BUDGET_SECS`).
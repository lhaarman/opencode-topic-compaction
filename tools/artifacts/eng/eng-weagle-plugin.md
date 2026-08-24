# TOPIC 1: src/graph-compaction.ts
- Blocker carry-forward guard landed: `MAX_CARRIED_BLOCKERS=5`, `openBlockers(prior)` parses native `### Blocked` bullets + per-topic `` `blocked:` `` keys, skips `(none)`/`n/a` placeholders.
- Fusion block injects "Open blockers carried from the \<prior-summary\>…" list only when blockers exist.
- Rules tightened: brevity ("One fact per bullet; never restate the same fact across topics or sections") and currency ("A blocked item stays open unless those turns show it was fixed").
- `promptExcerpt(node)` helper added: excludes `(user message)` placeholder contents from `started by:` map lines; used by `topicsOf` and `topicsByGaps`.
- blocked: none so far

# TOPIC 2: src/test_cluster.ts
- Grew 34 → 45 checks, all pass (`bun src/test_cluster.ts`).
- New coverage: blocker carry into fusion, `(none)` not carried, placeholder-only prior, currency/brevity rule text, marker-pair window start, trailing-pair stripping, stub-marker fallback to newest readable pair text, placeholder-free topic maps.
- Imports `activeWindow`, `SessionEntry`, `GraphNode` from `./graph-model.ts`.
- blocked: none so far

# TOPIC 3: src/graph-compaction.ts — Go
- Phase 1 (plugin): extracted exported pure `activeWindow(items)` in `src/graph-model.ts`; fixed `slice(lastCompaction)` ignoring `scanEnd` (stripped trailing markers were resurrected); `previousSummary` now walks back over contiguous marker entries — handles summary text on the assistant twin and orphaned stub markers from failed generations; live-verified on session `x-u9-plugin`: prevSum 0 → 1669 chars, fusion block present.
- Phase 1 verification: 45/45 tests, typecheck clean except known bun-only `import.meta.dir` (`plugins/graph-render.ts(89,59)`), sync byte-identical.
- Phase 2 (harness `/tmp/opencode`): `appendWork` now writes realistic text-bearing user+assistant turns (+ tool part) with optional per-case files/text specs; new `U11` builder in `eval_clones.ts` (12-msg two-thread window: `src/api/client.ts` unresolved 401 blocker + `src/util/logger.ts` progress).
- Runner generalized: `runFusion(kase)` handles U9+U11 (r1 → append → `restartServes()` → r2) with automatic blocker-carry audit appended to `results.jsonl`.
- Per user instruction ("Phase 1 and 2, no experiments"): no compaction runs executed in that phase.
- blocked: none so far

# TOPIC 4: opencode/eval_run.ts
- Mid-session patches: `PRAGMA busy_timeout=5000`, SDK→DB fallback for sizing/detection, `maxPoll` 90/120×3 s — still insufficient when provider stalls (all cases timed out at 270 s once).
- Version skew diagnosed: SDK calls `/session/{id}/message` (singular) → 400 against server 1.18.21; plugin's own `buildGraph` falls back to readonly `bun:sqlite` (`fetch.source="database"`), which is why harness reads moved to DB.
- Session-vanish race observed: `x-u10-*` pairs deleted from DB ~10 min into huge summarize (three occurrences across two days); `h4-plugin`'s 880 messages also vanished then later reappeared; documented in `session-vanish-race.md`.
- `eval_clones.ts` hardened: `srcInfo` picks the slug row with most messages; U10 picks first viable `h4-*` source (>100 msgs); per-case argv (`U1..U11|all`).
- Baseline sweep (pre-improvement code) completed once: U1–U8 both arms ok, case walls 34–69 s; superseded by later current-code runs.
- blocked: none so far

# TOPIC 5: opencode/eval_run2.ts
- Hardened runner: per-case CLI (`bun eval_run2.ts <CASE|all> [--force]`), time-based detection (assistant `mode:"compaction"` newer than startMs−60 s; SDK `{info,parts}` normalized + DB fallback), crash-safe per-arm `.md` + append-only `results.jsonl`, retry-once **in place** for fusion cases (reclone would erase the r1 marker), `restartServes()` between fusion rounds (opencode caches session state in memory — SQL writes behind a live serve are invisible).
- `POLL_BUDGET_SECS` env caps poll budget (240 s used today) for time-boxed sessions.
- Contamination incident root-caused and discarded: stale-cache summarize let the tool-capable compaction agent reconstruct context from the real repo instead of the synthetic window.
- Final valid runs: U9 r1 plugin 1278 ch TOPIC / pure 1250 ch, pure-r2 2298 ch (plugin-r2 stalled 2×240 s — pending); U11 full valid fusion r1 1599/1607 → r2 1459 TOPIC / 1687 native with `blocked: 401 Unauthorized — … awaiting user-provided key` carried verbatim (audit record non-empty).
- U10 attempt-2: plugin 10491 ch (override did not fire — pre-fix bug) + pure 7321 ch @115 s; an earlier attempt died to the vanish race.
- blocked: none so far

# TOPIC 6: opencode-graph-plugin/compaction-report.md
- Rewritten as a **current-state evaluation only** per explicit user instruction (no improvement history, no v1 baselines/deltas): §1 method, §2 U1–U8 table with per-arm latency, §3 fusion results (U9/U11), §4 U10 large-window, §5 latency profile, §6 known limitations, §7 verdict recommending as-is use.
- Rename executed: plugin `id: "graph-compaction"`; tool `session_graph_png` → `session_graph`; header comment in `src/graph-plugin.ts` leads with compaction; comment in `src/graph-model.ts:131` updated; `src/test_graph-plugin.ts` assertion + header updated.
- Docs updated: `AGENTS.md` intro now compaction-led ("`graph-compaction` … topic/community-based compaction … plus session-graph PNG rendering") and its E2E step fixed to the copy-first flow (`cp src/test_graph-plugin.ts .opencode/plugins/ && bun … && rm …`) since the SDK resolves only under `.opencode/node_modules`; `compaction-report.md` subject line → "the `graph-compaction` plugin".
- Verified: grep shows zero leftovers of old names; 45/45 tests; typecheck clean (only known bun-only error); `diff -r src .opencode/plugins` SYNC OK; live registry contains `session_graph`, legacy name absent.
- Full E2E chat turn failed with provider 500 (`err_e1633f63`) — unrelated to rename; tool registration was the assertion that mattered.
- blocked: none so far

# TOPIC 7: opencode-graph-plugin/agent-feedback.txt
- Feedback item dispositions: (1) U9 regression → root-caused deeper than the agent's suggestion (stub markers + placeholder pollution + slice bug) and fixed; (2) live blocker carry-forward → proven via U11; (3) degradation characterization → deferred, needs `eval_degrade.ts` script + 10 rounds; (4) U10 timing → latency profile in report, fresh post-fix pair deferred; (5) vanish race → `session-vanish-race.md` upstream-ready draft written; (6) ship → checklist green (tests/sync/typecheck).
- Standing user constraint: reports must evaluate the plugin as it is right now — no progress log, no improvement history.
- Deferred queue: degradation loop (script + 10 rounds), U9-plugin-r2 retry (~5 min when provider cooperates), U10 fresh post-fix pair, optional §6.1 refinement (topic-map labels from most recent segment), local `qwen3.8-9b` sweep.
- blocked: none so far

# STATE
- Overall goal: make the `graph-compaction` plugin peer-presentable and keep an objective, current-state evaluation versus opencode base compaction.
- Code state: all fixes landed in `src/` ↔ `.opencode/plugins/` byte-identical; 45/45 unit tests pass; typecheck clean except known bun-only `import.meta.dir` at `plugins/graph-render.ts(89,59)`; serves running on ports 4399 (plugin) / 4400 (`--pure`) with current code loaded.
- Evaluation state: U1–U8 complete both arms; U9 r1 complete + pure-r2 complete, plugin-r2 pending (provider stalls); U11 complete including live verbatim blocker carry-forward; U10 has artifacts for both arms; degradation loop not yet built/run.
- Docs state: `compaction-report.md` is a raw current-state evaluation (no history) per user requirement; `session-vanish-race.md` is an upstream-ready draft.
- Final user request (newest turns): do a hands-off-quality code review — documentation adequate but not excessive, simple, reader mental model should need few layers — then write a full plan with at least three topics: Code Review Consequences, Remaining Evaluations, Implement Improvements.
- Review progress: finished reading `src/graph-model.ts` and `src/graph-cluster.ts`; remaining sources not yet re-read for the review.

## Next Move
1. Finish reading `src/graph-render.ts`, `src/graph-theme.ts`, and the unread portions of `src/graph-model.ts` / `src/graph-cluster.ts` / `src/graph-plugin.ts`.
2. Write the code review findings plus the full remaining-work plan (≥3 topics: Code Review Consequences, Remaining Evaluations, Implement Improvements) for user approval.

## Relevant Files
- `src/graph-model.ts` — buildGraph/fetch/activeWindow/previousSummary; just reviewed.
- `src/graph-cluster.ts` — 3-pass community clustering; just reviewed.
- `src/graph-compaction.ts` — override builder (topicsOf/topicsByGaps/openBlockers/promptExcerpt); reviewed earlier this session.
- `src/graph-plugin.ts` — entry: id `graph-compaction`, tool `session_graph`, compacting hook; renamed today.
- `src/graph-render.ts`, `src/graph-theme.ts` — PNG rendering; NOT yet re-read for the review.
- `src/test_cluster.ts`, `src/test_graph-plugin.ts` — 45-check suite + live E2E.
- `AGENTS.md` — repo guidelines incl. sync/typecheck/E2E commands (updated today).
- `compaction-report.md` — current-state evaluation (v3 style).
- `session-vanish-race.md` — upstream bug-report draft.
- `/tmp/opencode/eval_run2.ts`, `/tmp/opencode/eval_clones.ts` — hardened harness (runner + per-case cloner).
- `/tmp/opencode/compaction-eval/results.jsonl`, `/tmp/opencode/compaction-eval/U*.md` — machine records + raw outputs.
- `/home/vscode/.local/share/opencode/opencode.db` — shared SQLite (WAL, `busy_timeout=5000`).
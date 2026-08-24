## Objective
- Evolve `/workspaces/opencode-topic-compaction` so community-based compaction yields topic-structured summaries (`# TOPIC n` / `# STATE`) via `experimental.session.compacting`, never worse than native opencode compaction.
- Current sub-goal: finish the exhaustive quality assessment — fix the synthetic-session crash (fabricated tool parts missing `state.time`), rebuild pristine test windows, run the full headless plugin-vs-pure sweep, score 1–100, and write the final maintainer-facing markdown report.

## Important Details
- Repo layout: `src/` is source of truth; `.opencode/plugins/` must stay byte-identical (AGENTS.md). Sync: `cp src/graph-model.ts src/graph-cluster.ts src/graph-compaction.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/` then `diff -r src .opencode/plugins --exclude=Roboto-Regular.ttf --exclude=test_cluster.ts --exclude=test_graph-plugin.ts && echo "SYNC OK"`.
- Typecheck (from `.opencode/`): `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-model.ts plugins/graph-cluster.ts plugins/graph-compaction.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts` — only expected error: `plugins/graph-render.ts(89,59): Property 'dir' does not exist on type 'ImportMeta'` (bun-only).
- Code style: 2-space indent, no semicolons, double quotes, comments explain *why*; descriptive variable names (no 1–2 letter vars); minimal `any`.
- Unit tests: `bun src/test_cluster.ts` (30 checks, all pass).
- **Current architecture** (all verified working):
  - `src/graph-compaction.ts` (lean rev): `MAX_PRIOR_CHARS=3000` (head 1800 + tail 800 truncation), `MAX_FILES_PER_TOPIC=5` (+N more), `GAP_MS=10min` silence-gap segmentation fallback, `MAX_TOPICS=12`, `plausibleLabel()` junk guard (rejects `tool-output/*`, `tool_<id>` labels → prompt-derived fallback), label collision dedup (`— <prompt>` suffix), `<2 topics → undefined` (pure native parity). Override block appended via `output.context.push` (lands LAST after entire native template — position is the design): role line, "disregard the \<template\>" amendment, `# TOPIC <n>: <label>` spec with per-topic **`blocked: <reason or none so far>`** key-value (always present; exact error strings when blocked, e.g. `blocked: 401 Unauthorized — web_fetch https://…`), `# STATE` with global **what to do next** (concrete actions, not per-topic), Rules incl. currency rule ("final turns are the newest truth") and soft bullets ("Aim for ~5 bullets per topic; beyond 5 only if critical").
  - `src/graph-model.ts`: `buildGraph` returns `{nodes, edges, communities, fetch:{source,count}, previousSummary}`; fetch = client `limit:1000` + shape normalization + chronological re-sort + readonly `bun:sqlite` DB fallback when `<5` entries (`DEGENERATE_VIEW_THRESHOLD`); boundary scan excludes trailing synthetic compaction marker (the 14:26 nodes=1 bug); `summaryText()` extraction; hardened `tokenTotal` (`info.tokens ?? {}`) and `modelLabel`.
  - `src/graph-cluster.ts`: `assignCommunities(nodes, partsByNode, entries?, workspace?)` — pass 1 causal chains (user-message opens group), pass 2 file-overlap merge (`EDIT_WEIGHT=8`, `READ_WEIGHT=1`, `MERGE_SIMILARITY=0.3`, sqrt normalization, union-find low-id-wins), pass 3 ride-along for file-less chains; labels = most-touched file's last two segments.
  - `src/graph-plugin.ts`: registers `session_graph_png` tool + `experimental.session.compacting` hook; traces breadcrumbs to `/tmp/opencode/hook-trace.log` (`module-loaded`, `hook-enter`, `graph-built {source,entries,nodes,communities,contextChars}`, `context-pushed {chars}`, `hook-error`).
- **Live evidence**: paired plugin(:4399) vs pure(:4400 --pure) on same windows with `x-preview-f-free`: e1 141 msgs → plugin 6562 chars 5-TOPIC vs pure 6068 native; e2b lean 332 → 5466 4-TOPIC vs pure 7005 (pre-lean was hard loss: 9521→0 length failure where pure succeeded — fixed by truncation); e3 410 → 4237 2-TOPIC vs pure 3908; e4 degenerate 511 → guard falls back to native on both paths (parity). Local 4k qwen3.8-9b run degraded on both paths (extreme case, not representative).
- **User decisions locked**: pruning stays at native 2000 chars/tool-result; blocked is key-value always present; what-to-do-next is global not per-topic; bullets soft (~5 aim, beyond only if critical); 16k is minimum credible small context (4k/8k dropped as laughable), 32k medium, 128k removed; local qwen runs deferred to last (user will configure LM Studio context window first).
- **Evaluation corpus & infra**: 10 sessions in DB; historical windows e1/e2/e3/e4 clones exist but are POLLUTED (previous compactions collapsed their active windows to nodes=2); synthetic sessions syn-rare/syn-decision/syn-causal/syn-small/syn-parallel/syn-blocked/syn-large exist but ALL live compactions on them returned POST 500 — root cause identified: fabricated tool parts lack `state.time`, and opencode's `SessionCompaction.estimate` prune-scan dereferences `state.time.compacted` → TypeError. Real tool part shape confirmed from DB: `{type:"tool", tool, callID, state:{status, input, output?, metadata:{}, title, time:{start,end}}}`.
- **Scoring rubric agreed** (breaks draws even when both 200): Segmentation 20 + Rare-file 15 + Decision WHY 15 + Causal 15 + Explicit Blocked/Next 10 + Currency 10 + Scannability/Identifiers 10 + Cost 5 = 100; N/A redistributes; epsilon breaks ties.
- Report artifacts so far: `/tmp/opencode/compaction-report.md` (§§1–11 + §9 paired table), `/tmp/opencode/compaction-findings.md`, transcripts `/tmp/opencode/result_*.md`, samples `/tmp/opencode/sample_*.md`, backup `/tmp/opencode/opencode-backup-precloning.db`.

## Work State
### Completed
- Full plugin implementation: graph model (fetch robustness, boundary fix, previousSummary), clustering v2 (file-overlap), compaction override (late-position context), junk-label guard, gap segmentation, prior truncation, per-topic blocked key-value, global what-to-do-next, soft bullets, currency rule — all synced byte-identical, typecheck clean, 30/30 unit tests.
- Reverse-engineered opencode compaction assembly from binary strings (history-first/instructions-last ordering; custom-prompt path appends raw history AFTER instructions; no anti-continuation guard on that path) — explains every observed failure mode.
- 12-point mechanical replay across all historical compactions: 8/12 would inject (avg 3.4 topics), 4/12 correct native fallback.
- Paired live headless runs on real-window clones: 3 TOPIC successes vs native (segmentation/rare-file/causal wins documented), 1 pre-lean hard loss fixed.
- Diagnosed synthetic-session 500s: missing `state.time` on fabricated tool parts crashes opencode core prune-scan (not a plugin bug).
- Wrote `/tmp/opencode/gen_synthetic_v3.ts` — regenerates all 7 synthetics with realistic part shapes (tool states carry `time:{start,end}` + output/metadata/title; assistant messages carry `tokens`; bash error parts carry `error` string; includes syn-rare, syn-decision, syn-causal, syn-small, syn-parallel, syn-blocked w/ exact error strings like "command not found: pnpm" and "401 Unauthorized", syn-large multi-thread stress).

### Active
- Executing the exhaustive assessment (user: "Continue, don't stop till its done"):
  1. Run `bun /tmp/opencode/gen_synthetic_v3.ts` to regenerate all 7 synthetics with fixed shapes.
  2. Create FRESH hist clones (e1/e2/e3/e4 windows from original sources ses_fe6efc2a / ses_feb0ee2a / ses_fe0ff2dd with cut points at parentIDs msg_019e8fc800017UUUfmfKympn8u, msg_0169bbed7001HrkHOE8q1PzzB3, msg_024c3a71e001Kw8yOE2rsYExHU, msg_024f12ae9001qjENqhthvRkh10) — old clones polluted; use id remapping (suffix per clone) to avoid UNIQUE collisions; include `sessionID` field in message data JSON.
  3. Create fresh plugin/pure clone pairs for all 7 synthetics.
  4. Start serves: `nohup opencode serve --port 4399 …` and `--pure --port 4400 …` (note: bare `pkill -f "opencode serve"` hangs the shell — use targeted kills or start-after-check; TUI PID must not be killed).
  5. Run headless sweep: `POST http://127.0.0.1:4399|4400/session/{sid}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}`, poll message/part tables for new `mode:compaction` text; capture per-window outputs to `/tmp/opencode/xh_{tag}.md`.
  6. Score each pair 1–100 per rubric; build exhaustive markdown report (columns: problem | context before | context after plugin | context after pure | comparison improve/unlock/worse/gap | scores plugin vs pure | extra: topics/comm/rescue/blocked-per-topic/global-next/rare-decision-causal preserved/model/window) + final verdict; save under /tmp/opencode/ (e.g. extend compaction-report.md §12 or new exhaustive-report.md).
  7. STOP before local qwen runs — come back to user to configure LM Studio context window (deferred per user instruction).

### Blocked
- Nothing blocking; synthetic regeneration script is written and ready to execute.

## Next Move
1. Execute `bun /tmp/opencode/gen_synthetic_v3.ts`; verify all 7 slugs regenerated with correct message counts (28/24/18/12/~31/8/~65).
2. Write + run clone script for fresh hist windows (e1/e2/e3/e4) and synthetic plugin/pure pairs (id remap + sessionID field + busy_timeout=5000).
3. Start both serves, confirm `module-loaded` in trace, then run the full sweep runner (reuse/adapt `/tmp/opencode/run_xh.ts` pattern with new session ids).
4. Score results with the 1–100 rubric, write the final exhaustive markdown report with required table columns and verdict.
5. Report back to user BEFORE any local qwen/LM Studio runs.

## Relevant Files
- `/workspaces/opencode-topic-compaction/src/graph-compaction.ts` — override builder (lean caps, blocked key-value, global next, soft bullets)
- `/workspaces/opencode-topic-compaction/src/graph-model.ts` — buildGraph/fetch/windowing/summaryText
- `/workspaces/opencode-topic-compaction/src/graph-cluster.ts` — assignCommunities
- `/workspaces/opencode-topic-compaction/src/graph-plugin.ts` — tool + compacting hook + trace()
- `/workspaces/opencode-topic-compaction/src/test_cluster.ts` — 30 unit checks
- `/tmp/opencode/gen_synthetic_v3.ts` — READY TO RUN synthetic regenerator (fixes state.time crash)
- `/tmp/opencode/make_clones.ts`, `/tmp/opencode/run_xh.ts`, `/tmp/opencode/run_one.ts` — clone/runner patterns to adapt
- `/tmp/opencode/hook-trace.log`, `/tmp/opencode/serve.log`, `/tmp/opencode/serve-pure.log` — instrumentation
- `/tmp/opencode/compaction-report.md`, `/tmp/opencode/compaction-findings.md` — reports to extend
- `/home/vscode/.local/share/opencode/opencode.db` — source of truth for replay (readonly queries; WAL; backup exists)
- Session under test: `ses_fe0ff2ddcffeZwOdAkELlMH9Ua`; sources: `ses_fe6efc2aaffeNlzZ4NiASIU5jY`, `ses_feb0ee2a6ffeEJRykJ0iLjPmm7`
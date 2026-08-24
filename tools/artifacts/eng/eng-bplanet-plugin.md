# TOPIC 1: src/graph-compaction.ts (16 nodes)
- Compaction override builder: `compactionContext(nodes, previousSummary?)` appends late-position OVERRIDE via `experimental.session.compacting` hook `output.context` (must land LAST; `output.prompt` replacement previously failed — instructions-before-history caused continuation).
- Fires only on ≥2 topics (clustering first, `topicsByGaps` fallback with GAP_MS=10min); single-topic returns undefined → native template runs unchanged.
- Caps: MAX_TOPICS=12, MAX_FILES_PER_TOPIC=5, MAX_PRIOR_CHARS=3000 (truncatePrior head 1800/tail 800), MAX_CARRIED_BLOCKERS=5, PROMPT_EXCERPT=80, LABEL_EXCERPT=40.
- Blocker carry-forward: `openBlockers(prior)` parses prior `### Blocked` bullets + per-topic `` `blocked:` `` keys, skips `(none)`/`n/a`, dedupes, caps 5; injected into fusion block ("Open blockers carried from the <prior-summary> …").
- Rules: brevity ("One fact per bullet; never restate the same fact across topics or sections") + currency ("A blocked item stays open unless those turns show it was fixed").
- `promptExcerpt(node)` filters placeholder contents like `(user message)` out of map started-by lines; used in `topicsOf` and `topicsByGaps`.
- blocked: none so far

# TOPIC 2: src/test_cluster.ts (4 nodes)
- Serverless tests for graph-cluster/graph-compaction/activeWindow; run `bun src/test_cluster.ts`.
- Now **45 checks, all PASS** (was 34). Added: blocker carry into fusion; `(none)` not carried (section-scoped between "Open blockers carried" and "TOPIC map:"); placeholder-only prior → no carry block; currency keeps blockers open; brevity dedupe; placeholder contents excluded from map; marker-pair window tests (start at latest marker entry = assistant twin; trailing pair stripped; summary from assistant twin; stub-marker falls back to newest readable pair text; no-marker window keeps all).
- Imports: `activeWindow, GraphNode, SessionEntry` from graph-model.ts.
- blocked: none so far

# TOPIC 3: src/graph-compaction.ts — Go (120 nodes)
- Full evaluation executed with hardened harness; artifacts in `/tmp/opencode/compaction-eval/results.jsonl` + per-arm `.md`.
- U1–U8 both arms: U1 890/745ch, U2 1318/1215, U3 1501/1660 (3 TOPICs, shorter than base), U4 1752/1623, U5 1387/1616, U6 1740/1334, U7 1100/1798 (exact strings kept, 38% fewer chars), U8 2079/1949 (4 TOPICs); latency 17–37s/arm; single-topic cases fall back to native by design.
- U9 fusion: r1 both ✓ (plugin TOPIC 1278ch/pure 1250ch latest run); r2 pure ✓ 2298ch; r2 plugin pending (stalled 2×240s, provider).
- U11 blocker-fusion valid after harness fix (retry had recloned, destroying fusion; guard now `fusion = kase==="U9"||kase==="U11"` → retry in place): r1 plugin 1556ch TOPIC/pure 1650ch; r2 same-session plugin 1556ch TOPIC/pure 1650ch; audit `blockersInR1`=`carriedInR2`="401 Unauthorized — no valid API key/bearer credentials available for \`https://ap…" — live carry-forward proof.
- U10 (880 msgs/~306k tok): base 7321ch@115s; graph 10491ch@170s pre-fix without TOPIC format → led to real bug fix: opencode leaves full marker pair trailing; old single-entry exclusion collapsed replays to 2 nodes/0 communities; while-loop strip verified 2→640 nodes/7 communities, override fires (7035-ch replay).
- Session-vanish race confirmed twice (~10 min into huge summarize; x-u10 clones deleted; h4-plugin source lost 880 msgs once, later restored) — documented in session-vanish-race.md.
- Harness: /tmp/opencode/eval_run2.ts (per-case CLI, time-based detection startMs−60s, SDK `{info,parts}` + DB fallback, POLL_BUDGET_SECS cap used at 240s, crash-safe JSONL/.md, restartServes() between fusion rounds because opencode caches sessions in memory), eval_clones.ts per-case arg with U11 two-thread builder (exact "HTTP/1.1 401 Unauthorized" bash error parts), text-bearing appendWork(slug,n,files?,texts?).
- blocked: none so far

# TOPIC 4: opencode/eval_run.ts (41 nodes)
- Superseded by eval_run2.ts; kept as reference. Early bugs: top-level `m.role/m.summary` detection miss, 60×3s polls too short.
- Cloner patterns: cleanSlug per slug; cloneFrom remaps ids/parentID/sessionID, injects tokens; srcInfo picks max-message row; inline builders need `state.time` on tool parts (prune-scan crashes otherwise).
- appendWork id-collision history: constant part ids → `UNIQUE constraint failed: part.id`; fixed with random rid(24); later upgraded to text-bearing turns.
- blocked: none so far

# TOPIC 5: opencode/eval_run2.ts (259 nodes)
- Active runner: sessionIdBySlug (max-message row), reclone via spawnSync eval_clones.ts, fetchCompactionText (SDK→DB fallback), runArm (POST + poll budget), evalArmWithRetry (resume guard skips non-ERROR .md unless --force; fusion retries in place), beforeTok, runCase, runFusion(kase) for U9/U11 with restartServes() mid-flow + blocker-carry audit to JSONL, appendWork with texts/files params.
- restartServes(): kills pids from /tmp/opencode/serve-4399.pid & serve-4400.pid, respawns 4399 normal + 4400 --pure, writes pid files, sleep 4s.
- blocked: none so far

# TOPIC 6: opencode-topic-compaction/compaction-report.md (190 nodes)
- Rewritten as CURRENT-STATE evaluation only (user: no improvement history/baselines/deltas).
- Sections: Method (paired serves 4399 plugin vs 4400 --pure, cloned sessions, POST /session/{id}/summarize, time-based capture); U1–U8 table with sizes+latencies+verdicts; fusion U9/U11 incl. verbatim blocker survival; U10 large-window; latency profile; limitations (§6.1 topic-body currency sharp edge: bodies said "no activity" while STATE had edits; provider sensitivity; races ref); verdict recommends as-is, queues recurrency refinement.
- Subject line: "the `graph-compaction` plugin's compaction hook".
- blocked: none so far

# TOPIC 7: opencode-topic-compaction/agent-feedback.txt (10 nodes)
- Feedback items: (1) fix U9 regression, (2) live blocker carry-forward, (3) degradation characterization 5–10 rounds, (4) U10 timing, (5) document vanish race upstream, (6) ship.
- Status: (2) done via U11; (5) done via session-vanish-race.md; (4) latency tables in report, fresh U10 pair deferred; (1) root-caused deeper than feedback assumed — real bugs were previousSummary reading empty user-marker, "(user message)" placeholder pollution, slice(lastCompaction) ignoring scanEnd — fixed; U9-r2 live re-validation pending (provider stalls). (3) not started (needs eval_degrade.ts).
- blocked: none so far

# TOPIC 8: src/graph-model.ts (8 nodes)
- Rename executed: plugin id `graph-compaction`; tool `session_graph_png` → `session_graph` (graph-plugin.ts id/tool/header, graph-model.ts comment, test_graph-plugin.ts assertion+header, AGENTS.md intro compaction-led, compaction-report.md subject). Verified: zero leftover greps, 45/45 tests, typecheck clean except known bun-only `plugins/graph-render.ts(89,59): error TS2339: Property 'dir' does not exist on type 'ImportMeta'`, SYNC OK, live serve registers `session_graph` (legacy absent).
- AGENTS.md E2E fixed to copy-first flow: `cp src/test_graph-plugin.ts .opencode/plugins/ && bun .opencode/plugins/test_graph-plugin.ts && rm .opencode/plugins/test_graph-plugin.ts` (SDK resolves only under .opencode/node_modules).
- Peer-readiness code review IN PROGRESS (user wants: documented-not-overly, simple, few mental layers). Files being read: graph-model.ts, graph-cluster.ts, graph-render.ts, graph-theme.ts. Observations so far: graph-cluster.ts header says "Edits weigh four times a read" but EDIT_WEIGHT=8/READ_WEIGHT=1 (comment drift); unused `_entries`/`_workspace` params in assignCommunities; KIND_LABELS duplicated in graph-model.ts and graph-render.ts; test_graph-plugin.ts E2E needs live LLM turn (blocked by provider 500, e.g. err_e1633f63).
- blocked: none so far

# STATE
- Overall goal: peer-presentable `graph-compaction` opencode plugin (topic/community compaction via compacting hook + `session_graph` PNG tool), evaluated against opencode base.
- Current status: all fixes synced byte-identical (src ↔ .opencode/plugins), 45/45 tests, typecheck clean except known bun-only error; report v3 current-state-only done; vanish doc done; rename done and live-verified. Eval matrix complete except U9-plugin-r2 (pending, provider) and deferred items (degradation loop, fresh U10 pair).
- What to do next:
  1. Finish the peer-readiness code review across src/*.ts (was mid-read of graph-model/graph-cluster/graph-render/graph-theme) and deliver findings.
  2. Write the full remaining-work plan with ≥3 topics: Code Review Consequences; Remaining Evaluations (U9-plugin-r2 retry, degradation loop via new eval_degrade.ts ×10 rounds, optional fresh U10 pair, local qwen3.8-9b sweep deferred); Implement Improvements (§6.1 topic-map recurrency from most recent segment; review-driven simplifications).
  3. Serves may still run on 4399/4400 (pids in /tmp/opencode/serve-*.pid); restart 4399 before live checks so it loads the current synced plugin.
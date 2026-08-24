# TOPIC 1: src/graph-compaction.ts

- Implemented user-directed explicitness changes: per-topic `blocked:` key always present — `blocked: none so far` when clear, `blocked: <exact error/status + affected tool/file>` when blocked (never bare "tool error"); spec examples added at src/graph-compaction.ts:171-176 (`blocked: 401 Unauthorized — web_fetch https://…`, `blocked: tool error — bash: command not found: foo`).
- Moved "what to do next" into `# STATE` as a global block after all topics (not per-topic): "overall goal, current status (final turns), and what to do next as concrete global actions".
- Replaced hard bullet cap with soft guidance: "Aim for ~5 bullets per topic; beyond 5 only if critical."
- Hardened src/graph-model.ts: `modelLabel` guards missing `info.model`; `tokenTotal` uses `(info.tokens ?? {})` — synthetic fixtures no longer crash buildGraph.
- Updated src/test_cluster.ts spec-string assertions (`blocked: <reason or none so far>`, currency rule "The final turns are the newest truth", anti-continuation guard ending); 30/30 pass.
- Synced byte-identical to `.opencode/plugins/` (`cp … && diff -r … --exclude=Roboto-Regular.ttf --exclude=test_cluster.ts --exclude=test_graph-plugin.ts` → SYNC OK).

# TOPIC 2: opencode/make_clones.ts

- Built headless test infrastructure: DB backup via `VACUUM INTO /tmp/opencode/opencode-backup-precloning.db`; historical windows cloned into fresh sessions with per-clone id remapping (suffix `k0`–`k3`), rewritten `info.id`/`parentID`/`sessionID`; WAL + `busy_timeout=5000`.
- First attempt hit `UNIQUE constraint failed: message.id` (E3/E4 clone the same source session) and left a partial CLONE session; cleanup script deleted parts/messages/session rows, then the remapping rewrite succeeded for all 4 experiments.
- Started `opencode serve --port 4399` (plugin) and `--pure --port 4400` (native baseline) from the project dir; both load `.opencode/plugins/`.
- Summarize endpoint requires body `{"providerID":"opencode","modelID":"x-preview-f-free"}` (400 Missing key otherwise); driver scripts `/tmp/opencode/run_experiments*.ts`, `run_one.ts`, `run_batch.ts`, `run_pure_paired.ts`, `final_small.ts`.

# TOPIC 3: opencode/compaction-report.md

- Live plugin results on current rev: e1 (141 msgs, 5 communities) → 6562-char 5-TOPIC+STATE; e2b lean (332, prior 6288→3000) → 5466-char 4-TOPIC; e3 (410, 2 communities) → 4237-char 2-TOPIC.
- Paired same-window native (`--pure :4400`): e1 6068, e2 7005, e3 3908 chars — all `## Objective` template.
- Pre-lean e2 hard failure diagnosed and fixed: contextChars 9521 → 218k input / 26k output / `step-finish reason:length` / 0 chars; `MAX_PRIOR_CHARS=3000` (head 1800 + tail 800) halved prompts (9521→5752, 11259→4944).
- Appended §9 paired table and §11 balanced wins/losses ledger (rare-file, decision-WHY draw, causal auth→401→test_auth, huge-window parity, overhead, Blocked/Next Move explicitness) to `/tmp/opencode/compaction-report.md`.
- Garbage-prior resistance proven: 15:05 transcript junk fed as `<prior-summary>` was dropped 100%.

# TOPIC 4: plans/local-4k-qwen.md

- Executed local 4k plan: paired e1 141 window on `providerID:"lmstudio"` + `modelID:"qwen/qwen3.8-9b"` (plain id under `lmstudio-local` returns UnknownError).
- Result at 4096: both paths degrade — plugin produced reasoning 1537 + text 195 all `(none)` (ignored pushed context); pure produced 0 parts.
- Conclusion recorded in compaction-report.md §10: 4k is extreme stress, unrealistic for 2026; revised tiers are 16k small / 32k medium, 128k removed per user.

# TOPIC 5: .opencode/plans

- Saved plans: `.opencode/plans/surpass-native-compaction.md` (landed: blockers explicit, junk-label guard, prior 3000, gap rescue) and `.opencode/plans/local-4k-qwen.md` (executed, degenerate outcome documented).
- Pruning decision locked: keep opencode-native 2000-char tool-result truncation; our `toolContent()` already emits only command/filePath/pattern, so we match native pruning at zero added cost.
- Remaining explicitness gaps closed: mandatory per-topic Blocked key, global Next block, decisions+why wording funded by intro tightening (800→~470 chars).

# TOPIC 6: opencode/gen_synthetic_exhaustive.ts

- Added 3 synthetics: syn-parallel (31 msgs, 3 interleaved disjoint-file workstreams), syn-blocked (8 msgs, exact errors `command not found: pnpm` and `401 Unauthorized` for `https://api.example.com/v1/spec`), syn-large (65 msgs, 4-thread round-robin).
- Preflight caught syn-rare window collapsed to 2 nodes: 4 stale compaction-marker messages from earlier failed direct-DB runs sat at the tail; removed markers/part rows → healthy 28 msgs / 43 nodes / 2 communities / 2 topics / 1973-char context.
- Final mechanical matrix: syn-rare 2c/2t/1973 · syn-decision 1c/fallback · syn-causal 3c/3t/2164 · syn-small 2c/2t/2048 · syn-parallel 3c/3t/2240 · syn-blocked fallback · syn-large 4c/4t/2414.

# TOPIC 7: opencode/make_sweep_clones.ts

- Created 14 plugin/pure clones covering the 7 synthetics (e.g. `ses_0e871mu4k6drxkt4vkdp` x-rare-plugin, `ses_evp9djcw4y0djj605qib` x-rare-pure, … through x-large-pure `ses_i9mxfn29jlts8mxkexue`), each id-remapped with `sessionID` field set.
- Combined with the 4 historical clones (`ses_wwbb71trwed0nrkiq59p` e1, `ses_srtz7csojkgnz5h89kc1` e2, `ses_enbnfq9hfl18b301v3wm` e3, `ses_vdtd5542gfmkyqh4b0kd` e4) this forms the 18-session sweep corpus.
- Pending: headless `POST /session/{id}/summarize` across all 18 on :4399/:4400, then scoring.

# STATE

- Overall goal: evolve `/workspaces/opencode-topic-compaction` so community-based compaction surpasses native opencode compaction, evidenced by a maintainer-grade markdown report with required columns (problem, context before, context after for plugin and base, comparison improve/unlock/worse/gap) plus 1–100 scores (Segmentation 20 / Rare 15 / Decision WHY 15 / Causal 15 / Blocked-Next 10 / Currency 10 / Scannability 10 / Cost 5 + 0.14 tiebreak epsilon).
- Status: explicitness iteration complete and synced (tests 30/30, typecheck clean except known graph-render.ts `import.meta.dir` bun-only error); 18-session sweep corpus staged; local qwen runs deferred pending user confirmation of LM Studio setup.
- Blocked: none so far.
- What to do next:
  1. Run headless x-preview-f-free compactions on the 14 x-* clones via `POST /session/{id}/summarize` on :4399 (plugin) and :4400 (pure), saving outputs to `/tmp/opencode/result_x-*.md`.
  2. Compute 1–100 scores per row and write the exhaustive summary table + final verdict into `/tmp/opencode/compaction-report.md`.
  3. Return to the user before starting local qwen runs (confirm LM Studio model/context size).
  4. After acceptance: remove `trace()` breadcrumbs from src/graph-plugin.ts and update AGENTS.md sync list to include graph-cluster.ts and graph-compaction.ts.
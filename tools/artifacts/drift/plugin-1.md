# TOPIC 1: src/graph-compaction.ts

- Implemented the late-position OVERRIDE in `compactionContext()` after prompt-replacement failed live: appended via hook `output.context`, lands as the last text in the assembled user message, amends the native template ("disregard the \<template\> above") into `# TOPIC <n>: <label>` sections + `# STATE`.
- Degenerate-window guard: fewer than 2 topics → return undefined → pure native compaction (never-worse guarantee).
- Gap-segmentation fallback (`GAP_MS = 10min`, `MAX_TOPICS = 12`): rescues single-community windows by splitting at silence gaps; labels from opening prompts.
- Junk-label guard (`plausibleLabel`): `tool-output/…` / `tool_<id>` cluster labels fall back to prompt excerpts; colliding labels get a `— <prompt>` suffix.
- Per-topic `blocked: <reason or none so far>` key required on every topic; when blocked, cite exact error/status + affected tool/file (e.g. `401 Unauthorized — web_fetch …`), never bare "tool error".
- Soft bullets: "Aim for ~5 per topic; beyond 5 only if critical" replaced the hard cap.
- Lean caps: prior truncated to 3000 chars (head 1800 / tail 800), files ≤5 per topic — halved large-window prompts (9521→5752, 11259→4944) and fixed the e2 `length` failure.
- Global `what to do next` lives in `# STATE` (not per topic); STATE reconciles against the final turns ("newest truth").
- Paired live wins on `x-preview-f-free`: e1 141 msgs → 6562-char 5-TOPIC (vs pure 6068 native), e2b 332 → 5466 4-TOPIC (vs pure 7005), e3 410 → 4237 2-TOPIC (vs pure 3908); zero cases left where plugin fails where pure succeeds.
blocked: none so far

# TOPIC 2: opencode/make_clones.ts

- Built `/tmp/opencode/make_clones.ts`: clones historical compaction windows into fresh sessions so live experiments never pollute real sessions.
- First run hit `UNIQUE constraint failed: message.id` (two clones from one source shared ids); fixed by remapping ids per clone (`id+"k<idx>"`) and rewriting `info.id` / `info.parentID` inside the data JSON.
- DB safety: `VACUUM INTO /tmp/opencode/opencode-backup-precloning.db`, WAL mode, `busy_timeout=5000`; serve instances read the DB fresh at startup.
- Clones staged: e1-fresh-multi (141 msgs), e2-fusion (332), e3-fusion-topicprior (410), e4-degenerate (511), e2b lean retry, e1-4k-plugin/pure, e2/e3-pure-paired, and 14 `x-*-plugin`/`x-*-pure` synthetic pairs.
blocked: none so far

# TOPIC 3: opencode/compaction-report.md

- Wrote maintainer-facing `/tmp/opencode/compaction-report.md`: how native assembles the prompt, our method, setup, results, balanced wins/losses, cost/safety, recommendation.
- Headless harness: `opencode serve :4399` (plugin) vs `:4400 --pure` (native baseline); trigger = `POST /session/{id}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}`; collection via DB poll + `/tmp/opencode/hook-trace.log`.
- Mechanical replay `eval_compaction.ts` over all 12 historical points: 8/12 would inject context (avg 3.4 topics), 4/12 graceful native-fallback parity.
- Paired current-rev results: e1 6562 5-TOPIC vs pure 6068 native; e2 5466 4-TOPIC vs 7005; e3 4237 2-TOPIC vs 3908 — qualitative wins (rare-file, decision WHY, causal auth→401→test_auth, scannability), zero hard failures either direction.
- §11 balanced ledger: we win segmentation/rare-file/causal/burst/cost-safety; native wins leanness on linear windows and battle-testedness; local 4k degrades both paths.
blocked: none so far

# TOPIC 4: plans/local-4k-qwen.md

- Answered "is 4k too small?": yes for quality — it is the extreme stress case; 16k is the credible small-window floor, 32k medium.
- Confirmed compaction is context-size aware: `compactIfNeeded` fires at tokens > contextWindow − reserved (default min(20000, maxOutputTokens)); `tail_turns` + `preserve_recent_tokens` (~25%, cap 15000) decide what stays verbatim.
- Verified `qwen3.8-9b` availability via LM Studio (`GET /v1/models`), loaded at 4096; plan persisted at `.opencode/plans/local-4k-qwen.md`.
- Live 4k outcome: both paths degraded — plugin emitted 195 chars of all-"(none)" template despite the pushed context; pure produced 0 parts. Conclusion recorded: 4k proves cost-survival, not quality; real sweep uses 16k/32k.
blocked: none so far

# TOPIC 5: .opencode/plans

- Measured overhead vs base: e1 2329 chars (~580 tok, ≈1% of input), e2 5752 (~2–3%) — expected but minimal; outputs comparable size to native (5466 vs 7005 where we were shorter).
- Tool-output pruning kept at native parity: core truncates `[Tool result]` to 2000 chars; our map adds zero tool-output bytes (only command/filePath/pattern excerpts).
- Plans persisted under `.opencode/plans/`: `surpass-native-compaction.md` (landed), `local-4k-qwen.md` (executed).
- Scoped explicitness upgrades funded by tightening the preamble (~800→~470 chars) and Rules (~442→~250): blocked key, concrete actions, decisions+why.
blocked: none so far

# TOPIC 6: opencode/gen_synthetic_exhaustive.ts

- Built `/tmp/opencode/gen_synthetic_exhaustive.ts` plus earlier `gen_synthetic2.ts`: agentic-coding synthetics covering rare-file, decision-provenance, causal-chain, burst-gap, parallel-3way, blocked-error, and large-stress situations.
- New scenarios: `syn-parallel` (31 msgs, 3 disjoint workstreams interleaved round-robin), `syn-blocked` (8 msgs with exact error strings: `command not found: pnpm`, `401 Unauthorized — web_fetch https://api.example.com/v1/spec`), `syn-large` (65 msgs, 4-thread stress).
- Debugged generator issues: session-table INSERT arity, and stale compaction markers from failed runs collapsing windows (removed 4 marker messages from syn-rare).
- Mechanical preflight on current code: syn-rare 2comm→2topics (1973c), syn-causal 3comm→3topics (2164c), syn-small 2comm→2topics (2048c), syn-parallel 3comm→3topics (2240c), syn-large 4comm→4topics (2414c); syn-decision and syn-blocked are 1-community by design → native fallback.
- Cloned plugin/pure pairs for all 7 synthetics (`x-{rare,decision,causal,small,parallel,blocked,large}-{plugin,pure}`) ready for the headless sweep.
blocked: none so far

# TOPIC 7: opencode/gen_synthetic_v3.ts

- Final staging phase of the exhaustive setup: iterated generator/experiment scripts until the full 13-window corpus (4 historical + 9 synthetic) existed as plugin/pure clone pairs.
- Headless sweep queued: `POST /session/{id}/summarize` on `:4399` (plugin) vs `:4400` (pure) for every pair, results to `/tmp/opencode/result_*.md` and the report.
- Deferred per user instruction: local `qwen3.8-9b` runs (16k small / 32k medium) — confirm setup with user before starting.
blocked: none so far

# STATE

- Overall goal: evolve `/workspaces/opencode-topic-compaction` so community-based compaction produces topic-structured summaries (`# TOPIC n` + `# STATE`) that surpass opencode's native linear compaction, with a guaranteed never-worse fallback.
- Status: method complete and live-validated — late-position override works (e1/e2b/e3 TOPIC successes on `x-preview-f-free`), every observed failure mode has a guard (window collapse, length overflow, junk labels, staleness, degenerate windows), 30/30 unit tests pass, typecheck clean except the known bun-only `import.meta.dir`, `src/` ↔ `.opencode/plugins/` byte-identical. Exhaustive corpus fully staged: 13 windows as plugin/pure clone pairs.
- What to do next:
  1. Run headless `x-preview-f-free` compactions on the 7 synthetic clone pairs: `POST http://127.0.0.1:4399/session/<sid>/summarize` (plugin) and `http://127.0.0.1:4400/session/<sid>/summarize` (pure); session ids are in the DB under slugs `x-{rare,decision,causal,small,parallel,blocked,large}-{plugin,pure}`.
  2. Score all results (historical 12 points + new synthetics) 1–100 with the agreed rubric: Segmentation 20, Rare-file 15, Decision WHY 15, Causal 15, Blocked/Next explicitness 10, Currency 10, Scannability/Identifiers 10, Cost 5.
  3. Write the exhaustive results table + final verdict into `/tmp/opencode/compaction-report.md` (§12) and refresh `/tmp/opencode/compaction-findings.md`.
  4. Check in with the user before starting local `qwen3.8-9b` runs (windows 16384 / 32768) — user asked to confirm setup first.
  5. After evaluation: stop the `serve` processes on ports 4399/4400, optionally delete clone/test sessions (slugs `e*`, `syn-*`, `x-*`), keep `/tmp/opencode/compaction-report.md` and the DB backup.
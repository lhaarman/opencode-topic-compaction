# TOPIC 1: src/graph-compaction.ts — context-override fix + blocked key-value spec

- Reverted `src/graph-plugin.ts` hook from `output.prompt` replacement back to `output.context.push`: appending after opencode's entire prompt gives the override the last word; replacing put instructions before the raw appended history and the model continued the conversation instead of summarizing.
- Rewrote `compactionContext(nodes, previousSummary?)` in `src/graph-compaction.ts` as a late-position OVERRIDE: role line referencing `<conversation>` above, "disregard the \<template\> section above", full `# TOPIC <n>: <label>` / `# STATE` spec, Rules mirroring native's, adapted `<prior-summary>` fusion block, anti-continuation guards as literal final lines.
- Fixed active-window collapse in `src/graph-model.ts`: `scanEnd` excludes a compaction marker on the final entry (opencode attaches it before firing the hook — caused the 14:26 `nodes=1` failure).
- Hardened `modelLabel` (user messages without `model`) and `tokenTotal` (`info.tokens ?? {}`) against missing fields.
- Per-topic `blocked` is now a mandatory key-value line: `blocked: none so far` when clean; when blocked, the exact error — e.g. `blocked: 401 Unauthorized — web_fetch https://…`, `blocked: tool error — bash: command not found: foo` — never a bare "tool error".
- Global `what to do next` moved to `# STATE` only (not per topic); bullets soft: aim ~5, beyond 5 only if critical.
- Verified with small paired run (fresh e1 window): plugin 8795 chars / 5 topics / 5 `blocked:` lines / STATE with global next steps vs pure native 1924 chars flat.
- blocked: none so far

# TOPIC 2: opencode/make_clones.ts — cloning historical windows

- Built `/tmp/opencode/make_clones.ts`: clones historical compaction windows into fresh sessions with remapped ids (per-clone id suffix, `parentID` rewritten inside message data JSON, `sessionID` field set).
- First run hit `UNIQUE constraint failed: message.id` (two clones from the same source session); cleaned the partial clone and added id remapping.
- Cloned 4 experiments: e1-fresh-multi (141 msgs, `ses_fe6efc2a` cut), e2-fusion (332, `ses_feb0ee2a`), e3-fusion-topicprior (410, `ses_fe0ff2dd` @14:39), e4-degenerate (510, `ses_fe0ff2dd` @15:29).
- DB safety: `VACUUM INTO /tmp/opencode/opencode-backup-precloning.db` before any write; WAL mode confirmed.
- blocked: none so far

# TOPIC 3: opencode/compaction-report.md — evaluation report + paired head-to-head

- Wrote `/tmp/opencode/compaction-report.md`: decompiled native assembly, our method, setup, live results, balanced wins/losses table (§11), artifacts list.
- Paired head-to-head on current rev (plugin :4399 vs pure :4400 --pure, identical windows): e1 plugin 6562 chars 5-TOPIC vs pure 6068 native; e2b plugin 5466 4-TOPIC vs pure 7005 native; e3 plugin 4237 2-TOPIC vs pure 3908 native.
- Mechanical replay over all 12 historical compaction points: 8/12 would inject context (avg 3.4 topics), 4/12 graceful native fallback.
- Balanced ledger: we win segmentation, rare-file preservation, causal traceability, small-window cost; native wins explicit `Blocked`/`Next Move` headers and battle-testedness; hard failures zero on both sides for the current rev.
- blocked: none so far

# TOPIC 4: plans/local-4k-qwen.md — local 4k qwen experiment

- Saved `.opencode/plans/local-4k-qwen.md`; cloned e1 into `e1-4k-plugin` / `e1-4k-pure`; ran summarize with `lmstudio/qwen/qwen3.8-9b` at 4096 context.
- Result: both paths degraded — plugin emitted the native template filled with `(none)` (195-char text, 1537-char reasoning), pure produced 0 parts. 4k is too small for `qwen3.8-9b` to be useful at all.
- Conclusion recorded in report §10: 16k is the credible small-window floor for 2026; 4k only proves the cost argument (our 1.5–2.5k map fits where native's 50k+ serialized history must truncate to tail turns).
- blocked: none so far

# TOPIC 5: .opencode/plans — saved plans + overhead/explicitness scoping

- Two plans saved under `.opencode/plans/`: `surpass-native-compaction.md` (landed in the lean rev) and `local-4k-qwen.md`.
- Overhead measured precisely: fixed prefix 1213 chars (~303 tokens) without prior; prior block adds ~504 wrapper + up to 3000 truncated; map ~90–220 chars/topic. Live pushes: e1 2329 (~580 tokens ≈ 1% of input), e2 5752 (~1438 tokens ≈ 2–3%), e3 4944.
- Agreed design with user: global `what to do next` after all topics; per-topic `blocked` key always present; soft bullet guidance; tool-output pruning stays at opencode's native 2000-char truncation (our map adds zero tool-output bytes).
- blocked: none so far

# TOPIC 6: opencode/gen_synthetic_exhaustive.ts — exhaustive synthetic corpus

- Wrote `/tmp/opencode/gen_synthetic_exhaustive.ts` adding three agentic scenarios: syn-parallel (31 msgs, 3-way round-robin over disjoint files), syn-blocked (8 msgs, exact error strings `command not found: pnpm` and `401 Unauthorized`), syn-large (65 msgs, 4-thread stress window).
- Created `x-*-plugin` / `x-*-pure` clones for all 7 synthetics (remapped ids, `sessionID` field set) for paired headless runs.
- Mechanical preflight: syn-rare 43 nodes / 2 communities → 2 topics (ctx 1973); syn-decision 37/1 → fallback; syn-causal 28/3 → 3 topics (2164); syn-small 19/2 → 2 topics (2048); syn-parallel 47/3 → 3 topics (2240); syn-blocked 11/1 → fallback; syn-large 111/4 → 4 topics (2414).
- Diagnosed syn-rare reporting `nodes=2`: four stale synthetic compaction markers from earlier failed runs acted as boundaries; removed them → healthy 43 nodes / 2 communities.
- blocked: none so far

# TOPIC 7: opencode/gen_synthetic_v3.ts — realistic part shapes (state.time)

- First exhaustive runner failed: every synthetic returned `POST 500` on both serves, and hist clones showed `nodes=2` (windows collapsed by earlier compaction markers).
- Root cause for the 500s: fabricated tool parts lacked `state.time`; opencode's prune-scan dereferences `state.time.compacted` → `TypeError` in `SessionCompaction.estimate`. Confirmed the real shape from the DB: tool parts carry `state: {status, input, output, metadata, title, time:{start,end}}`.
- Wrote `/tmp/opencode/gen_synthetic_v3.ts` regenerating all 7 synthetics with realistic shapes: tool states carry `time:{start,end}` plus `output`/`metadata`/`title`, bash-error parts carry the `error` string, assistant messages carry `tokens`/`cost`.
- blocked: regenerating synthetics via gen_synthetic_v3.ts, then fresh hist clones h1–h4, then re-running the headless sweep

# STATE

- Overall goal: evolve `/workspaces/opencode-topic-compaction` so community-based compaction produces topic-structured summaries via `experimental.session.compacting`, with guaranteed fallback to native compaction — and prove it surpasses native across agentic coding scenarios.
- Status: context-override implemented, synced, and verified live (small paired run: plugin 8795 chars / 5 topics / per-topic blocked lines vs pure 1924 native). Exhaustive evaluation underway: synthetic corpus v3 written (realistic part shapes fixing the 500s), stale markers cleaned, hist clones need regeneration, headless sweep awaiting re-run.
- What to do next:
  1. Run `bun /tmp/opencode/gen_synthetic_v3.ts` to regenerate all 7 synthetics with `state.time` on tool parts.
  2. Create fresh hist clones (plugin + pure) from the original source sessions at the e1–e4 cut points.
  3. Restart serves (:4399 plugin, :4400 --pure) and re-run the headless sweep (`run_xh.ts` pattern).
  4. Score results, finalize `/tmp/opencode/compaction-report.md`, then set up local qwen 16k/32k runs with the user.
## Summary

### Project Overview
Building and iteratively refining a **community-aware compaction plugin** for opencode (`/workspaces/opencode-topic-compaction`) that produces topic-structured summaries (`# TOPIC n: <label>` + `# STATE`) instead of opencode's native linear format (`## Objective / ## Important Details / ## Work State / ## Next Move`). The goal is to surpass native compaction on segmentation, rare-file preservation, decision provenance, causal traceability, and small-window survival — while never making things worse.

### Architecture (current lean rev)

**Files (all synced byte-identical to `.opencode/plugins/`):**
- `src/graph-model.ts` — Fetches session entries (client API `limit:1000` + readonly `bun:sqlite` DB fallback when <5 entries), normalizes shapes, sorts chronologically, scans for last compaction boundary (excluding trailing synthetic marker opencode attaches before firing hook), builds nodes/edges, stamps communities via `assignCommunities`, extracts `previousSummary`. Returns `{nodes, edges, communities, fetch:{source,count}, previousSummary}`.
- `src/graph-cluster.ts` — Three-pass clustering: causal chains per user-message, file-overlap merging (EDIT_WEIGHT=8, READ_WEIGHT=1, MERGE_SIMILARITY=0.3, sqrt normalization, union-find lower-id-wins), ride-along for file-less chains.
- `src/graph-compaction.ts` — Builds late-position OVERRIDE context appended after opencode's entire prompt via `output.context.push()`. Contains: role line, explicit template amendment ("disregard `<template>` above"), `# TOPIC <n>: <label>` structure spec with per-topic `blocked: <reason or none so far>` requirement, global `# STATE` with concrete next actions, Rules (soft ~5 bullets/topic beyond-5-only-if-critical, terse bullets, preserve identifiers, final-turns-newest-truth currency rule, no meta-commentary), optional `<prior-summary>` fusion block (truncated to 3000 chars head1800/tail800), TOPIC map (labels from most-touched file's last 2 segments, capped at 5 files/topic with `(+N more)` suffix, max 12 topics, gap-segmentation fallback at 10-min silence when clustering yields ≤1 community, junk-label guard rejecting `tool-output/*` and `tool_<id>` patterns, collision disambiguation appending opening prompt).
- `src/graph-plugin.ts` — Registers `session_graph_png` tool + `"experimental.session.compacting"` hook that calls buildGraph then sets `output.context.push(context)`; try/catch falls back to native on any error. TEMP diagnostics trace to `/tmp/opencode/hook-trace.log`.
- `src/graph-theme.ts` — Visual constants (unchanged).
- `src/graph-render.ts` — PNG rendering via pureimage (unchanged).
- `src/test_cluster.ts` — 30 unit tests covering clustering scenarios and compactionContext properties.

### Key Root Causes Discovered (from binary reverse-engineering)

1. **Native template mandate**: `buildPrompt()` renders `<conversation>` first, task line second, `<template>`+Rules LAST. Any appended instruction loses the fight against "Output exactly the Markdown structure shown inside \<template\>".
2. **Custom-prompt path failure**: Setting `output.prompt` causes opencode to append raw history AFTER instructions → recency bias → model continues conversation instead of summarizing (observed 15:05 failure).
3. **Trailing marker trap**: opencode attaches `type:"compaction"` part to the `/compact` user message BEFORE firing the hook → `isCompaction()` flags it as boundary → window collapses to 1 node. Fixed by excluding final entry from boundary scan when `items.length > 1`.
4. **Paginated messages endpoint**: SDK binds to `/session/{id}/message` (projected route) with default page size potentially 1 → fixed with explicit `limit:1000` + DB fallback.

### Iteration History (compaction approach evolution)

| Attempt | Approach | Result |
|---|---|---|
| v1 | Append context to native prompt | Lost to template mandate ("Output exactly...") |
| v2 | Replace prompt via `output.prompt` | Model continued conversation (instructions-before-history) |
| v3 | Revert to `output.context` with late-override block | Worked! Topic structure adopted |
| v3.1 | Added currency rule, degenerate guard (<2 topics→undefined), gap segmentation | Fixed staleness anchoring |
| v3.2 | Added prior truncation (3000), file cap (5), bullet softening (~5→beyond-if-critical), junk-label guard, collision dedup | Fixed length failures, improved map quality |

### Evaluation Infrastructure

- **Mechanical replay**: `/tmp/opencode/eval_compaction.ts` replays 12 historical compaction points through current pipeline. Results: 8/12 inject (avg 3.4 topics), 4/12 graceful native fallback.
- **Live headless harness**: `opencode serve --port 4399` (plugin) vs `--pure --port 4400` (native baseline). Clone historical/synthetic windows into fresh sessions with remapped IDs, then `POST /session/{id}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}`.
- **Synthetic corpus**: 7 agentic-coding scenarios — `syn-rare` (rare migration file drowned), `syn-decision` (Postgres NOT SQLite WHY), `syn-causal` (JWT auth→401→test_auth fix chain), `syn-small` (6 bursts with 11-min gaps), `syn-parallel` (3-way interleaved), `syn-blocked` (401 + command not found errors), `syn-large` (65 msgs 4-thread stress).
- **Paired results (x-preview-f-free)**: e1 plugin 6562/5-TOPIC vs pure 6068/native; e2b plugin 5466/4-TOPIC vs pure 7005/native; e3 plugin 4237/2-TOPIC vs pure 3908/native. All 200 OK, zero hard 500s on current rev.

### Current State (most recent work)

The exhaustive assessment plan was approved with:
- **13 windows total**: 4 existing (e1/e2/e3/e4 clones) + 7 new synthetics + 2 more being cloned
- **Models**: `x-preview-f-free` (primary) and local `qwen/qwen3.8-9b` at 4096/8192 (deferred to last, pending user setup confirmation)
- **Scoring**: 1–100 rubric (Segmentation 20, Rare 15, Decision WHY 15, Causal 15, Blocked/Next 10, Currency 10, Scannability 10, Cost 5) with epsilon tiebreaker
- **Report target**: `/tmp/opencode/exhaustive-report.md` with required columns (problem, context before, context after both, comparison verdict) plus score, topics, blocked-per-topic, what-to-do-next-global, HTTP status

**Most recent actions completed:**
1. Generated 3 new synthetic sessions (`syn-parallel` 31 msgs, `syn-blocked` 8 msgs, `syn-large` 65 msgs) via `/tmp/opencode/gen_synthetic_exhaustive.ts`
2. Cleaned 4 stale compaction markers from `syn-rare` (were causing window collapse to 2 nodes)
3. Verified mechanical preflight: all 7 synthetics now show correct nodes/communities/topics (syn-rare 43n/2c/2t, syn-decision 37n/1c/fallback, syn-causal 28n/3c/3t, syn-small 19n/2c/2t, syn-parallel 47n/3c/3t, syn-blocked 11n/1c/fallback, syn-large 111n/4c/4t)
4. Cloned all 7 synthetic windows × 2 sides (plugin/pure) = 14 fresh test sessions with remapped IDs (`xp`/`xs` suffixes)

**Next immediate step:** Run headless x-preview-f-free compactions on the 14 cloned sessions (7 plugin :4399 + 7 pure :4400), collect outputs, apply 1–100 scoring, and build the exhaustive markdown report with summary table and final verdict. Then come back to user before starting deferred local qwen runs.
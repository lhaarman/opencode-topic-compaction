# Conversation Summary — Community-Based Compaction Plugin Development

## Project Overview

**Repo:** `/workspaces/opencode-topic-compaction` — an opencode plugin that replaces/augments opencode's native linear compaction with **community-based compaction**: clustering session messages into topic communities and producing structured `# TOPIC <n>: <label>` + `# STATE` summaries instead of a single blurred narrative.

**Architecture:** `src/` is source of truth; `.opencode/plugins/` must stay byte-identical (AGENTS.md). Modules: `graph-model.ts` (fetch/window/nodes/edges), `graph-cluster.ts` (community detection), `graph-compaction.ts` (override context builder), `graph-render.ts` (PNG), `graph-theme.ts`, `graph-plugin.ts` (entry).

## Current Code State (all synced, `SYNC OK`)

### `src/graph-model.ts`
- `buildGraph(client, sessionID, workspace?)` → `{ nodes, edges, communities, fetch: {source, count}, previousSummary? }`
- **Fetch layer:** `limit:1000` client call → shape normalization (`toSessionEntry`) → chronological re-sort → **DB fallback** via readonly `bun:sqlite` when `<5` entries (`DEGENERATE_VIEW_THRESHOLD`)
- **Active window:** scan excludes trailing compaction marker (opencode attaches it *before* firing hook); captures `previousSummary` from boundary entry via `summaryText()`
- **Nodes:** `{id, kind, content, timeCreated?, agent?, model?, tokens?, error?, compaction?, group?, groupLabel?}`; kinds: user-message, assistant-response, reasoning, tool_call, file, subtask, compaction
- **Edges:** follows (message→message), causes (msg→tool/subtask), references (msg→file)
- `tokenTotal()` hardened with `(info.tokens ?? {})`; `modelLabel()` hardened for missing `model`

### `src/graph-cluster.ts`
- Three passes: causal chains (user-message opens chain) → weighted file-overlap merge (EDIT=8, READ=1, MERGE_SIMILARITY=0.3, sqrt norm, union-find low-id-wins) → ride-along (file-less chains join next/prev)
- Labels = most-touched file last 2 segments; `plausibleLabel` rejects `tool-output/*` and `tool_<id>` artifacts

### `src/graph-compaction.ts`
- `compactionContext(nodes, previousSummary?)` → late-position override appended via `output.context.push()` (NOT `output.prompt` — replacement caused continuation failure)
- Topics from communities; if ≤1 community → gap segmentation fallback (>10min silence splits)
- Guard: `<2 topics → undefined` (pure native parity)
- Per-topic spec includes `blocked: <reason or none so far>` key-value (always present)
- STATE = global after all topics: Goal / Status (final turns newest truth) / Next concrete actions
- Rules include soft bullet limit ("aim ~5, beyond only if critical"), currency rule ("final turns are newest truth")
- Prior truncation: `MAX_PRIOR_CHARS=3000` (head 1800 + tail 800); file cap `MAX_FILES_PER_TOPIC=5`

### `src/graph-plugin.ts`
- Registers `session_graph_png` tool + `"experimental.session.compacting"` hook
- Hook: try/catch → buildGraph → compactionContext → `output.context.push(context)` → trace to `/tmp/opencode/hook-trace.log`
- TEMP diagnostics still present (trace function)

## Key Discoveries About opencode Internals

1. **Hook contract:** `experimental.session.compacting` receives `{sessionID}`, output `{context: [], prompt?: string}`. Context entries are joined AFTER the entire native template (last word wins). Prompt REPLACES everything.
2. **Native assembly:** `[qh({previousSummary, context:[ze]}), ...Ve.context].join("\n\n")` where qh renders `<conversation>` first, task line, then `<template>` + Rules LAST. History-first/instructions-last ordering is why native works.
3. **Prompt replacement failure mode:** custom `output.prompt` puts instructions BEFORE raw history appended by server → recency bias → model continues conversation instead of summarizing.
4. **Boundary timing:** opencode attaches `type:"compaction"` part to the /compact user message ~23ms BEFORE firing the hook → active-window scan must exclude trailing marker.
5. **Auto-compaction path** (`compactAfterOverflow`) does NOT fire the compacting hook — manual `/compact` only.
6. **Plugin loader treats every `.ts` in `.opencode/plugins/` as entry point** — lib modules fail with cosmetic errors (harmless).

## Test Infrastructure

### Unit Tests: `src/test_cluster.ts` — 30/30 pass
Covers: A→B→A merge, same-file deep module merge, folder-split behavior, causal chains, ride-along, label disambiguation, junk-label guard, gap rescue, blocked key presence, anti-continuation guard, prior-summary fusion.

### Evaluation Harnesses (in `/tmp/opencode/`)
- `eval_compaction.ts` — replays all historical compaction points through current pipeline
- `gen_synthetic_exhaustive.ts` — generates agentic coding scenarios
- `make_clones.ts` / `run_experiments.ts` / `run_batch.ts` — clone + live compaction driver
- `run_synthetics.ts` / `run_syn_all.ts` — synthetic session compaction runner
- `run_4k_correct.ts` / `run_pure_paired.ts` — paired head-to-head drivers

### Live Results Summary (paired plugin :4399 vs pure :4400, x-preview-f-free)

| Window | Plugin | Pure | Verdict |
|---|---|---|---|
| e1 141 msgs, 5 comm | 6562 chars, 5 TOPIC+STATE | 6068 native | Win |
| e2b 332 msgs, 4 comm | 5466 chars, 4 TOPIC+STATE | 7005 native | Win |
| e3 410 msgs, 2 comm | 4237 chars, 2 TOPIC+STATE | 3908 native | Win |
| e4 511 msgs, 1 comm | guard→0 (native fallback) | timeout both | Parity |

### Local qwen3.8-9b @ 4096 results
Both paths degraded (plugin produced all-(none) template, pure produced 0 parts). 4k too extreme for meaningful comparison.

## Current Work (most recent activity)

The user approved an exhaustive evaluation plan across ALL available sessions. I was executing:

1. ✅ Generated 3 new synthetic sessions (`syn-parallel` 31 msgs, `syn-blocked` 8 msgs, `syn-large` 65 msgs) joining existing 4 (`syn-rare` 28, `syn-decision` 24, `syn-causal` 18, `syn-small` 12)
2. ✅ Cleaned stale compaction markers from all synthetic sessions (found 4 in syn-rare from earlier failed runs)
3. ✅ Mechanical preflight confirmed healthy: syn-rare 43 nodes/2comm/2topics, syn-causal 28/3comm/3topics, syn-large 111/4comm/4topics, etc.
4. ✅ Created 14 paired clone sessions (7 windows × plugin/pure):
   - x-rare-plugin `ses_0e871mu4k6drxkt4vkdp` / x-rare-pure `ses_evp9djcw4y0djj605qib`
   - x-decision-plugin `ses_1gcqsesblhj7d7t3w9c7` / x-decision-pure `ses_xb9l4o2zq2oraqdhukig`
   - x-causal-plugin `ses_86c1pmwj8fq2x2h3gic8` / x-causal-pure `ses_rxpokf96dfdn38icck5v`
   - x-small-plugin `ses_ez9shakfhwianolw90x8` / x-small-pure `ses_hk2l95ba76p65negsr55`
   - x-parallel-plugin `ses_pgc6mi218q0qp4m6355h` / x-parallel-pure `ses_1tdy3j024qtq3vhtm6tl`
   - x-blocked-plugin `ses_flooptdxzbhezcv0pbn2` / x-blocked-pure `ses_6u788ysu6ha483keie7q`
   - x-large-plugin `ses_3re6xzgh3rci1udaehoj` / x-large-pure `ses_i9mxfn29jlts8mxkexue`

**Next steps (not yet done):**
- Start `opencode serve --port 4399` (plugin) and `--pure --port 4400` (native baseline)
- POST `/session/{id}/summarize {"providerID":"opencode","modelID":"x-preview-f-free"}` for each clone pair
- Collect outputs, score 1–100 per rubric (Segmentation 20 + Rare 15 + Decision WHY 15 + Causal 15 + Blocked/Next 10 + Currency 10 + Scannability 10 + Cost 5)
- Build exhaustive markdown report with required columns: problem | context before | context after (plugin) | context after (base) | comparison verdict
- Come back to user before local qwen runs (deferred per user instruction)

## Key Files & Paths

| Path | Purpose |
|---|---|
| `/tmp/opencode/hook-trace.log` | Plugin lifecycle traces (module-loaded, hook-enter, graph-built, context-pushed/prompt-set/hook-error) |
| `/tmp/opencode/compaction-report.md` | Main evaluation report (§1-§11 written so far) |
| `/tmp/opencode/compaction-findings.md` | Earlier findings doc |
| `/tmp/opencode/opencode-backup-precloning.db` | DB backup before cloning |
| `/tmp/opencode/gen_synthetic_exhaustive.ts` | Synthetic generator (parallel/blocked/large) |
| `/tmp/opencode/make_clones.ts` | Clone script with id remapping |
| `/tmp/opencode/run_experiments.ts` / `run_batch.ts` / `run_one.ts` | Compaction drivers |
| `/tmp/opencode/result_*.md` | Stored compaction outputs |
| `/home/vscode/.local/share/opencode/opencode.db` | Main opencode SQLite DB (WAL mode) |
| `/home/vscode/.opencode/bin/opencode` | opencode binary v1.18.20 |

## Pending Items

1. Run the 14 paired compactions (7 windows × plugin/pure) via headless serve
2. Score each output 1–100 using the rubric
3. Write final exhaustive markdown report with table + verdict
4. Remove TEMP diagnostics from graph-plugin.ts after verification
5. Update AGENTS.md (sync command needs graph-cluster.ts + graph-compaction.ts added)
6. User wants local qwen runs deferred until setup confirmed together
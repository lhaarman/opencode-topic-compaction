## Objective
- Prove the `graph-compaction` opencode plugin (topic-structured compaction override + `session_graph` PNG tool) matches or beats base opencode compaction, and finalize `compaction-report.md` as a current-state, reader-ready document for publication
- Current thrust: complete the **real-history engagement sweep** (six genuine recorded sessions) so the report's topic-engagement claims rest on measured rates instead of an n=2 organic sample, then apply all queued report edits in one pass and return to the user for feedback/re-read

## Important Details
- Report discipline locked by user: current-version results only; zero version-history or provider-process narrative; measured claims with explicit scope caveats; verdict grounded in contract guarantees, not statistics; reader assumed to know nothing about the plugin (hence §0 primer)
- Terminology collision flagged by user mid-read: "window" doubles for *conversation content volume* vs *model configured limit* — queued fix #1 adds a definitions paragraph to §1
- Fixture sizing rationale queued (fix #2): windows sized by (a) multi-topic head above the default raw tail, (b) fitting target context with generation headroom — MID ~11k tok ↔ 16k models, BIG ~27k tok ↔ 32k models; nothing ever ran "at 27k context"; spot-fix #3 adds "~27k tok **of history**" phrasing in §4/§8 tables
- Topic definition (source-verified, offered as optional fix #4): user messages open chains; tool calls attach files (**edits weigh 8×, reads 1×**); chains merge when weighted file overlap — `shared/√(totalA·totalB)` — clears **MERGE_SIMILARITY = 0.3**; labeled by dominant file/dir; fallback `topicsByGaps` splits at pauses > GAP_MS when clustering collapses; `<2` topics ⇒ no override ⇒ native untouched
- Small-window yield explained to user (optional fix #5): below-tail windows have literally 0 summarizable tokens; break-even math says engaging costs nearly what it saves; real 16k deployments trigger compaction near overflow (~15k used) where head ≈6–7k tok engages naturally — MID@16k sat below trigger due to generation-headroom sizing
- Frontier-model limitation: **removed per user** ("we don't need to mention frontier model tiers"); BUT user explicitly requires keeping the acknowledgment that degeneration rates' cross-model applicability is unknown — edit #6 = delete §9 item 4, extend instability item 3 with that clause, §4 transparency note stays verbatim
- Engagement sampling question answered: heavy fallback is largely fixture composition (synthetics deliberately probe yield/non-compliance zones); organic history engaged 5/5 generations across 2 sessions; "never worse" is non-trivial in injected-but-declined cells (equal-or-smaller outputs despite extra instructions) — queued fix #7 documents this; proposed **real-history sweep** replaces thin n=2 evidence
- Six genuine recorded sessions found (never eval-used): `crisp-forest` 1171 msgs, `quiet-river` 893, `brave-planet` 508, `nimble-lagoon` 503, `witty-eagle` 501, `stellar-cabin` 460 (dir `/workspaces/opencode-topic-compaction`)
- Sweep constraints confirmed by user: **remote-tier only** (`>32k`-token windows can't fit local loads), max runtime ~5 h, then report update → user feedback → remaining TODOs
- Local qwen3.8-9b status: reasoning budget 1024 verified working via API (839 thinking tokens, 11 s direct answers) but opencode serve-path summarize still hangs >600 s — local cells remain blocked/dropped from report §7 with scope note; root causes of past "stalls" solved separately (zombie serve with stale config; buffering MITM proxy breaking SSE ingestion)
- Serves running: `:4399` (plugin, restarted 11:26, recency build loaded) and `:4400` (`--pure`, started 07:03 — stale config irrelevant since sweep uses remote model via `EVAL_PROVIDER=opencode EVAL_MODEL=x-preview-f-free`)
- User handles git personally; `feedback_oc.md` is byte-identical to `feedback_chatbot.md` (one review, two copies)

## Work State
### Completed
- Recency-parity implementation fully landed: `activeWindow()` + `splitRecency()` in src/graph-model.ts (floor-aware marker handling, chars÷4 `entrySize()` mirroring base serializer, oversized-newest-kept-raw rule, `keepRecentTokens()` = min(8000, floor(0.4 × GRAPH_CONTEXT_TOKENS))); 51/51 tests
- Report structure rewritten current-state (sections §0 primer … §10 verdict): exec summary, method w/ mechanism paragraph (hook `session.compacting`, late-position append, plugin-side ≥2-topic gate, fail-open), declared-context sweep, fusion/blocker-carry at three scales, BIG1/BIGF production-scale section, degradation findings, latency rows incl. local 9B, limitations, justified verdict
- Drift reproduction executed on fresh-cloned 306k window: base arm degenerated 3/4 (original Chinese drift + prompt-echo meta-text 1,008 ch + 56k-char runaway role-play), plugin usable 4/4 (TOPIC twice, native-shaped-but-complete twice) — captured in `compaction-report.md` §4 reliability study + transparency note; exec summary statistic later demoted per reviewer feedback (recommendation rests on contract guarantees only)
- Feedback triage done (`feedback_chatbot.md` == `feedback_oc.md`): items #10 exec-summary-first, #11 U12-direction fix (1969 vs 1930 = parity within 2%, not "lower"), #12 2048-stress-test label, #6 size framing (~90-token premium, "paying for structure"), #8 zero-failed-rounds statement, #9 subjective-wording replacement — all applied
- Engagement mechanics verified from source + live replay: gate is plugin-side (`compactionContext` returns undefined unless ≥2 topics; try/catch falls back to native), shape compliance is model-cooperated; artifact CJK scan: 1/57 base arms drifted (known U10-pure-16k), 0/57 plugin
- ENG harness built and wired: `tools/eval_clones.ts` ENG builder (six sources → `x-eng-{cf,qriver,bplanet,nlagoon,weagle,scabin}-{plugin,pure}`); `tools/eval_run2.ts` gained `runEngSweep()` + `classifyEng()` (imports `activeWindow`/`buildGraph` from ../src, `compactionContext` from ../src) writing `eng-classify.jsonl` + per-arm captures, dispatched via `target === "ENG"`
- Stale partial `x-eng-%` sessions from an accidental module-import run cleaned (3 deleted); serves verified up

### Active
- **Real-history engagement sweep NOT yet launched**: three launch attempts died to command timeouts (a stray `bun build` hung one window; self-matching `pgrep` patterns killed others). Harness is ready; relaunch is a single detached command: `EVAL_PROVIDER=opencode EVAL_MODEL="x-preview-f-free" POLL_BUDGET_SECS=600 setsid nohup bun tools/eval_run2.ts ENG`
- Expected runtime ~60–120 min for 12 paired generations (windows ~40k–260k tok; crisp-forest largest) incl. stall retries; progress-pollable via `/tmp/opencode/eng_sweep.log`

### Blocked
- Local-model cells (§7/§8): opencode serve → LM Studio summarize hangs >600 s despite healthy direct endpoint (~11 s) — reasoning-template streaming vs opencode client suspected; needs LM Studio-side non-thinking template or deeper streaming diagnosis; excluded from current report (scope note only)
- Nothing blocks the ENG sweep

## Next Move
1. Relaunch the ENG sweep detached (command above); poll `/tmp/opencode/eng_sweep.log` until `ENG SWEEP DONE`
2. Analyze `eng-classify.jsonl` + `eng-*-*.md`: per session record window/head/tail, gate pass, injected chars, `startsTopic`, CJK/degeneracy heuristics on base arms
3. Apply consolidated report batch: queued fixes #1–#6 (+ optionals #4/#5 if user confirms) AND the outcome-dependent §5 rewrite — real-sessions block with measured engagement rate replacing the n=2 framing; update §4 reliability counts if fresh base degeneracy appears; add §1 case-suite row
4. Snapshot sweep artifacts to `tools/artifacts/eng/`; rerun gates (tests/typecheck/sync/no strays)
5. Hand updated report back to user for feedback, then proceed to remaining TODOs (code review support, LICENSE name, `.opencode` subset decision, commit manifest — user does git)

## Relevant Files
- `compaction-report.md` — the deliverable; §0–§10 current; pending edits #1–#7 + sweep-driven §5 rewrite
- `tools/eval_clones.ts` — ENG builder + all fixture builders (U1–U12, MID/MIDF/BIG1/BIGF/DEG); `cloneFrom(src, dstSlug, label)` pattern
- `tools/eval_run2.ts` — runner with `runEngSweep()`/`classifyEng()`/`ENG_SESSIONS`, floor-aware detection, retry-once, exit-patch; dispatch includes `target === "ENG"`
- `src/graph-model.ts` — `activeWindow(items, opts?)` + `splitRecency(entries, budgetTokens)` + `keepRecentTokens()` + `entrySize()`; single `splitRecency` definition (duplicate removed)
- `src/graph-compaction.ts` — gate at `topics.length < 2 → undefined` (line ~169), `topicsOf`/`topicsByGaps`, `openBlockers` carry-forward, `promptExcerpt`, `keepNewest`/`newestPrompt`
- `src/graph-plugin.ts` — hook wiring + append-vs-replace rationale comment (lines ~43–46)
- `tools/artifacts/{16k,32k}/` — preserved prior-run artifacts (52 files); sweep outputs should join as `tools/artifacts/eng/`
- `/tmp/opencode/compaction-eval/` — runtime capture dir (wiped repeatedly; repo copies authoritative)
- `session-vanish-race.md` — upstream-ready environment bug draft (referenced by report limitations)
- `README.md` / `AGENTS.md` / `LICENSE` / `.gitignore` — publication set; LICENSE holder = "opencode-graph-plugin contributors" (user personalizes); `.gitignore` verified effective for node_modules, graph-poc, feedback drafts
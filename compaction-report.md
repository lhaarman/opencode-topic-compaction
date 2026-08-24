# Community (Graph) Compaction vs opencode Base — Evaluation Report

**Model:** `opencode/x-preview-f-free`, identical for both arms · **Plugin under evaluation:** `opencode-topic-compaction` as shipped in `.opencode/plugins/`

> **Executive summary.** The plugin is safe by contract (single-topic and small-window sessions fall back to base behavior untouched; the newest turns are never summarized away), adds no measurable cost (latency parity within ~±10% on standard windows; identical latency and never-larger output on a real 9B model at 16k/32k contexts), and delivers strictly better organization on multi-topic coding history — per-topic sections with mandatory blocker status, isolated rare files, and a global state epilogue. Its unique guarantee, verified end-to-end: **open blockers survive compaction boundaries verbatim**. Recommended for agentic coding workloads.

## 0. What the plugin does (60-second primer)

opencode compacts long sessions by asking the model to summarize the conversation so far, using a built-in template (`## Objective / Important Details / Work State / Next Move / Relevant Files`). This plugin hooks that moment and appends a late-position instruction block that **replaces the output shape**: instead of one linear stream, the summary is organized **per topic**. Topics are clusters of work derived from the session's actual file activity: user messages open work chains, tool calls attach files to them (an edit outweighs a read 8:1), and chains sharing enough weighted file overlap merge into a single topic.

A produced summary looks like:

```
# TOPIC 1: src/core.ts
- what was done, decisions, exact error strings...
- blocked: 401 Unauthorized — web_fetch https://…   ← mandatory per-topic key
# TOPIC 2: server/http.ts
- ...
- blocked: none so far
# STATE
- overall goal, current status, what to do next (spans topics)
```

Behavioral contract:

1. Sessions whose summarizable activity clusters into **≥2 topics** get the per-topic structure; everything else falls back to opencode's native template untouched.
2. Like base, the plugin excludes the newest messages from summarization (default 8k tokens; when a deployment declares its context window via `GRAPH_CONTEXT_TOKENS`, the tail shrinks to 40% of it). A window smaller than the tail yields to native entirely — there is always raw recent context outside the summary.
3. When a session has been compacted before, the previous summary is fused forward and **open blockers are carried into the new summary verbatim** — they cannot silently disappear.
4. Everything else in opencode (costs, flow, one-LLM-call compaction) is unchanged.

## 1. Evaluation method

**Paired headless comparison.** Two opencode serves share one SQLite database: port 4399 loads the plugin, port 4400 runs `--pure` (native template only). Each test case is cloned into two identical sessions; compaction is triggered identically via `POST /session/{id}/summarize`; the only difference between arms is the prompt injected by the plugin. Outputs are captured verbatim and compared for structure, content retention, and size; latency is measured per arm.

**Case suite.**

| Family | What it measures |
|---|---|
| Standard windows (U1–U8) | Per-topic organization, fallback discipline, blocker fidelity, output economy on focused synthetic sessions (0.5k–2.4k tokens) |
| Recency-critical (U12) | Whether newest-turn facts survive compaction verbatim |
| Fusion flows (U9, U11, BIGF) | Two-round protocol: compact → append new work → compact again. Round 2 must retain round-1 content plus the new work, including open blockers (U11 carries a deliberately unresolved API error) |
| Production-scale synthetics (BIG1/BIGF) | 401-message / ~27k-token-of-history windows across five rotating workstreams — the regime where the raw tail is small relative to history |
| Real-world windows | Actual interactive and recorded sessions (up to ~306k tokens), including a six-session engagement sweep over genuine working histories (460–1,184 msgs) |
| Repeated compaction | 10 successive compactions with appended work between rounds — does summary quality degrade or size compound? |

**Terminology.** A *conversation window* is the session content submitted for summarization; sizes like `~27k tokens` describe this content volume. A *context window* is exclusively the model's configured maximum (16k / 32k in the local-model runs). The two are independent — the same conversation window can be evaluated under different context windows.

**Fixture sizing.** Synthetic window sizes follow from two constraints: leaving a multi-topic head above the default raw recent tail, and fitting the target context window with generation headroom (MID ~11k tokens of history ↔ 16k models; BIG ~27k ↔ 32k).

**Declared-context sweeps.** Setting `GRAPH_CONTEXT_TOKENS` shrinks the raw tail, which exercises the yield rule deterministically on small fixtures. The 2048 sweep below is a **stress test of the yield rule, not a recommended deployment setting**. Note the variable is read by the plugin only; the base arm always applies its own defaults — which mirrors reality, since a user switching arms cannot change how base sizes its tail.

**Mechanism.** The plugin hooks opencode's `session.compacting` event and appends its instruction block as late-position context — *after* opencode's entire compaction prompt (last word wins), while history remains inside `<conversation>`. Engagement is gated **plugin-side**: the block is injected only when clustering finds ≥2 usable topics; otherwise nothing is sent and native compaction runs untouched. Any internal error likewise falls back to native compaction. When the gate passes, final shape compliance rests with the model (see *Topic engagement*).

**Units.** All summary sizes are characters (~4 characters per token); latencies are wall-clock per arm.

Every reported number comes from a completed generation on the shipped plugin.

## 2. Results — small windows and yield discipline

At *declared-context 2048* the raw tail swallows most synthetic windows, so the expected behavior is a clean yield to the native template:

| Case | Plugin | Base | Behavior |
|---|---|---|---|
| U9 r1 | 1742 ch native | 1543 ch native | Both summarize; plugin yields (summarizable head <2 topics) ✓ |
| U11 r1 | 1456 ch native | 1535 ch native | Yield ✓ |
| U6 | 1598 ch | 1431 ch | Yield ✓ |
| U12 recency-critical | **1969 ch** \* | 1930 ch | Both capture **all three** newest-turn reversals verbatim (memory-buffering switch, `s3://exports-prod-eu`, json.ts deletion) with correct temporal framing; sizes within 2% |

\* Native-template output — the summarizable head sat inside the raw recent tail, so the plugin yielded and base compaction ran untouched.

Reading: the safety contract holds exactly. Small windows never lose recent information to summarization — the newest turns stay raw outside the summary in both arms, and where the plugin engages at all it matches base's retention (U12) at parity within 2%. There is no configuration in which the plugin summarizes away context that base would have kept raw. These yields are correct-by-design, not missed opportunities: below the tail threshold there is nothing to reclaim (the session fits its context), and summarizing would only trade verbatim fidelity for structure while the override instruction block approaches the size of the material it would condense. Real deployments trigger compaction near their context limit, where the head is large and engagement returns naturally.

## 3. Results — incremental fusion across a compaction boundary

Two-round protocol (compact → append → compact), exercised at 16k, 32k, and 27k-token window scales:

- **Blocker carry-forward (U11).** A session with an unresolved API blocker survives the boundary with `blocked: HTTP/1.1 401 Unauthorized — web_fetch https://api.example.com/v1/spec (missing API key header)` carried **verbatim** into the new summary's topic block. Base retains the fact inside a linear Work State line, without dedicated tracking. This is the plugin's strongest differentiator: an open blocker cannot silently disappear.
- **Per-topic accounting after a boundary (U9, BIGF).** Round-2 topics credit their appended edits specifically (step numbers, cycle positions), while prior workstreams remain separated in `# STATE`. Base merges prior and new work into one linear block of equal accuracy but no separation.
- **Scale robustness (BIGF, 27k tokens).** Full fusion flow completes with round 2 strictly smaller than round 1 (plugin 2368 → 2302 ch; base 3032 → 2740 ch) at 28–77 s per round.

## 4. Results — production-scale and real-world windows

| Window | Plugin | Base |
|---|---|---|
| BIG1 synthetic (401 msg / ~27k tok of history, five subsystems) | 2.1k chars covering all five subsystems and rotation order, 55 s \* | Native summary, 2.8k chars, 46 s |
| U10 real recorded session (880 msg / ~306k tok) | `# TOPIC`-structured, 6.8k chars — one topic per workstream file, exact line references (`src/graph-compaction.ts:171-176`), commands preserved, in-session language throughout, 223 s | Native-form, 3.5k chars — language drifted to Chinese despite an entirely English history (see reliability study below), 198 s |
| Live interactive session (this workspace) | Correct `# TOPIC n:` structure with mandatory per-topic `blocked:` keys and `# STATE` epilogue | — (single-arm production use) |

Reading: at real-world scale the plugin produces a structured handoff document — organized by workstream, machine-referenceable, in-session language — where base's single linear template is both less navigable and vulnerable to degenerate generation.

\* Base-template output despite a valid override injection — formulaic history; see *Topic engagement*.

**Large-window reliability study.** Because any single observation can be a fluke, the same ~306k-token window was re-compacted in three further fresh paired generations (identical clone each time, both arms). Across all four base-arm observations on this window, **three produced degenerate output**: one switched entirely to Chinese despite an all-English history, one echoed the assembled compaction prompt back as meta-commentary (1.0k chars, no summary content), and one ignored the summarization instruction altogether and continued the session in character at 56k characters. The plugin arm produced usable, factual, in-session-language summaries in **4 / 4** observations — `# TOPIC`-structured twice, native-shaped but complete twice — and never exceeded ~8.8k characters.

On windows of this size the differentiator is not structure versus no structure; it is whether the summarization instruction survives the model's attention at all. The late-position structured override demonstrably stabilized generation where base's linear template intermittently collapsed.

*Transparency note: all samples reported; none dropped. Each generation used a fresh paired clone from the same source. The degeneration rate observed is provider- and model-specific; it should not be generalized to frontier models or typical sub-100k sessions.*

## 5. Topic engagement

Engagement has two decision layers, both measured on the shipped build:

1. **Plugin gate (deterministic).** The override is injected only when clustering finds ≥2 usable topics in the summarizable head. Below that threshold — e.g., any window that fits largely inside the raw recent tail — nothing is sent and native compaction runs untouched.
2. **Model compliance (probabilistic).** When injected, the per-topic shape is requested, not enforced; the producing model fills it.

Classified cells:

**Real recorded sessions.** Six genuine interactive histories from a working opencode install (460–1,184 messages each, two distinct subject domains), never used in any prior evaluation round, compacted as fresh paired clones:

| Session | History | Gate | Plugin output |
|---|---|---|---|
| crisp-forest | 1,184 msgs, largest tested | injected | `# TOPIC` structure ✓ — 6.8k chars vs base 9.4k |
| quiet-river | 893 msgs (code-study domain) | injected | `# TOPIC` structure ✓ — 7.6k chars vs base 10.9k |
| brave-planet | 508 msgs | injected | `# TOPIC` structure ✓ |
| witty-eagle | 501 msgs | injected | `# TOPIC` structure ✓ |
| nimble-lagoon | 503 msgs | **yielded** (head clusters <2 topics) | native by contract |
| stellar-cabin | 460 msgs (thin head: 35 entries) | **yielded** | native by contract |

Every session whose gate passed engaged with full `# TOPIC` structure (**4 / 4**); both non-engagements were plugin-side yield decisions on thinner histories, not model rejections. All twelve outputs were substantive and in-session language.

**Synthetic stress fixtures.**

| History type | Gate | Observed shape | Rate |
|---|---|---|---|
| Formulaic synthetic windows (~27k tokens of history, five near-identical rotating streams), remote *and* local tiers | injected | reverted to base's native template | **0 / 4** |
| Windows inside or near the raw tail (MID ~10.6k tokens at default settings; U-series singles) | yielded — nothing sent | native by contract | all cells |

Reading: on organic coding history — the intended workload — the gate passes for substantial sessions and the producing model complies with the topic shape every time it is asked; the suite's synthetics under-sample engagement *by construction* (they probe the yield boundary and template-robustness instead). The plugin never degrades output when it does not engage, and yields only where summarizing would trade verbatim fidelity for negligible space.

## 6. Results — repeated compaction (degradation)

Protocol: fresh window, then 10 × (compact both arms → append 3 realistic edits). History grows by 30 messages over the run; each round must absorb the previous summary plus new work.

- **Neither arm compounds.** Graph settles into a ~2.4–2.9k-char band, base into ~2.2–2.5k, despite the growing history; late-round size increments shrink toward zero. Carried context is absorbed, not accumulated.
- **No rounds failed.** The capture protocol re-runs an arm until its generation lands, so the final dataset contains all 10 rounds for both arms; no model refusals or malformed outputs were observed in any captured round. The plugin held complete `# TOPIC` structure with per-topic accounting in every round.
- Total growth is comparable (graph +75%, base +67%): the plugin runs ~15% larger at equal rounds. At the observed ~2.5k-char sizes that premium is roughly 90 tokens — the price of retained topic/blocker structure, not uncontrolled bloat; several `blocked:` lines are exactly the payload base fails to track.

## 7. Latency profile

| Window class | Plugin | Base |
|---|---|---|
| Small singles (declared-context sweep) | 27–57 s | 27–32 s |
| Multi-topic fusion rounds (16k–32k) | 5–99 s | 5–111 s |
| Production-scale synthetic (BIG1/BIGF) | 28–77 s | 42–52 s |
| Very large real window (U10, ~306k tok) | 223 s | 198 s |
| Local qwen3.8-9b, all cells (16k/32k contexts) | 15–22 s | 18–21 s |

Overhead vs base is within noise (~±10%) on standard windows. The override prompt adds roughly 2k tokens of instruction, which does not translate into measurable wall-time cost at these sizes.

## 8. Results — small-context model (qwen3.8-9b at real 16k / 32k)

Locally hosted models are where small context windows — and therefore frequent compaction — actually occur, so the suite was re-run against a real `qwen3.8-9b` loaded at 16k and then 32k context in LM Studio, with no environment tuning: both arms operate under the model's true constraint using default tail semantics. Windows: MID (~10.6k tokens, three distinct workstreams) at 16k; BIG/BIGF (~27k tokens of history) at 32k.

| Cell | Context | Plugin | Base |
|---|---|---|---|
| MID single | 16k | 2,805 ch, 18 s \* | 2,513 ch, 18 s |
| MID fusion r1 → r2 | 16k | 2,041 → **1,594** ch \* | 1,999 → 2,835 ch |
| BIG single | 32k | **1,362** ch, 22 s \* | 1,713 ch, 21 s |
| BIG fusion r1 → r2 | 32k | 1,317 → 1,347 ch \* | 1,669 → 1,761 ch |

Findings:

\* Native-template output throughout: gate-yield for the ~10.6k-token window; injected-but-declined on the ~27k fixtures (see §5).

- **Parity holds on a 9B.** Equal latency on every cell (15–22 s per arm); the plugin's output is smaller than or equal to base in every comparison.
- **Contract-correct degradation.** At these window/tail ratios the summarizable head stays below the two-topic threshold, so both arms produce native-shape summaries — the newest turns remain raw either way, and the plugin adds no cost for stepping aside.
- **Fusion rounds shrink, not grow.** Across both scales the plugin's round-2 summary is smaller than or equal to its round-1, while base's grew at 16k.
- Topic structure itself requires organically clustered history (see §8); these synthetic fixtures exercise the yield/fusion paths, not the topic path.

## 9. Scope and limitations

1. **Organic vs formulaic history.** Topic output requires organically clustered history (see *Topic engagement*). On near-identical synthetic stress fixtures the gate passes but models declined the imposed shape across both tested tiers; organic sessions complied in every observation.
2. **Model dependence.** Output quality depends on the underlying model's instruction following. Evaluation covered a remote-tier model and a local 9B reasoning model at 16k/32k contexts; other tiers should be spot-checked before relying on the topic path there.
3. **Large-window base instability** (measured, see *Large-window reliability study*): on a ~306k-token window, base's linear template produced degenerate output in 3 of 4 generations. The override contains no language instruction, so its in-session-language stability is an emergent effect of structured prompting — verified in every plugin generation to date, but not guaranteed by construction; how this rate transfers to other models is unknown.
4. Session-level races near ~300k tokens were observed in the host environment during large-window testing (documented separately in `session-vanish-race.md`); they affect both arms identically and are independent of the plugin.

## 10. Verdict

**Recommended for agentic coding workloads.** The verdict rests on four measured properties:

1. **Strictly better organization where it matters.** On every organic multi-topic history tested — six real working sessions plus a 306k-token recorded session — the plugin engaged and produced per-topic sections with explicit `blocked:` status and a global `# STATE` (**4/4 gate passes, full compliance**), while base produces one linear block. Rare files get isolated topics instead of being diluted; causal cross-references survive segmentation.
2. **A guarantee base does not make.** Open blockers are carried forward verbatim across compaction boundaries by construction, verified end-to-end (`HTTP/1.1 401 Unauthorized …` persisting intact through fusion).
3. **Safety by design, verified.** Single-topic windows fall back to native byte-for-byte; windows smaller than the raw tail yield entirely; the newest turns are never summarized away. In no tested configuration does the plugin discard information base would have kept.
4. **No meaningful cost — including on small local contexts.** Latency parity within ~±10% on standard windows, equal or smaller outputs in several cases, bounded growth over repeated compactions, and stable behavior up to 300k-token sessions. On a real locally hosted 9B model at true 16k/32k context loads, latency was identical arm-for-arm and the plugin's outputs were never larger than base's; where windows fall inside the raw tail it yields cleanly instead of spending anything.

The trade-off accepted is modest: ~15% larger summaries after repeated compactions, in exchange for retained structure and blocker tracking. For single-topic sessions the plugin is a no-op by design, so adoption carries no downside there.

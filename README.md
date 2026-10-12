# opencode-topic-compaction

An [opencode](https://opencode.ai) V2 plugin: when opencode compacts a session,
this plugin adds a topic-structured override to the compaction request so the
model summarizes **per topic** instead of one linear stream. Topics come
from clustering the session's actual file activity; every topic carries an
explicit `blocked:` status, and open blockers are guaranteed to survive
across successive compactions.

## Behavioral contract

The plugin is conservative by design — it upgrades compaction only where it
clearly applies and steps aside everywhere else:

- **≥2 clustered topics** → the plugin generates the summary itself (a pure
  `# TOPIC n:` body with mandatory `blocked:` keys + a global `# STATE`) and
  hands it to opencode via the hook's `result`, so no native headings appear.
  Below that threshold, or if generation fails, → opencode's native template,
  byte-for-byte unchanged.
- **Recency parity**: like base, the newest messages stay out of the summary
  (default ~8k tokens of raw recent context; set `GRAPH_CONTEXT_TOKENS` to your
  model's true window and the tail shrinks to 40% of it). A window that fits
  inside the tail is never summarized at all.
- **Blocker carry-forward**: when compacting an already-compacted session, open
  blockers from the prior summary are re-injected verbatim into the new one —
  they cannot silently disappear across a compaction boundary.
- **Fail-open**: any internal error falls back to native compaction untouched.

## How it works

```
session context ──► topics-model ──► topics-cluster ──► topics-compaction ──► event.result
(ctx.session)       nodes+edges      causal chains     TOPIC map + fusion    (plugin-generated
                    +files           merged by file    rules                 # TOPIC summary)
                                     overlap
```

- `topics-model.ts` — reads the session's model-visible window via
  `ctx.session.context()` (V2's `session_message` store), turns it into
  nodes/edges, resolves the active window after the last compaction boundary,
  splits off the raw recent tail, and extracts the prior summary.
- `topics-cluster.ts` — pure topic detection: user messages open chains; chains
  merge when their weighted file overlap (edit ≫ read) clears a threshold;
  discussion-only chains ride along.
- `topics-compaction.ts` — builds the summarization prompt: role line, the
  `# TOPIC n:` spec with mandatory `blocked:` keys, a global `# STATE`, rules,
  optional `<prior-summary>` fusion with blocker carry-forward, and the topic
  map. Returns nothing (<2 topics → native path).
- `topics-plugin.ts` — the V2 entry (`Plugin.define`): registers the
  `compaction` hook. On ≥2 topics it serializes the transcript, generates the
  summary via `ctx.generate.text`, and sets `event.result`; otherwise, or on any
  failure, it falls back to native compaction silently.

## Install

**From npm (recommended)** — add the package to your `opencode.json`; bun
installs it automatically at startup:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-topic-compaction"]
}
```

- **Project-level**: put the snippet in `<project>/opencode.json` — active in
  that project only.
- **Global**: put it in `~/.config/opencode/opencode.json` — active everywhere.

**Manual** — copy the plugin into a plugin **directory** (V2 loads `.opencode/plugins/<name>/index.ts`,
not loose `.ts` files):

```
.opencode/plugins/topic-compaction/
  index.ts            # = src/topics-plugin.ts
  topics-model.ts
  topics-cluster.ts
  topics-compaction.ts
```

- `.opencode/plugins/` — project-level, or
- `~/.config/opencode/plugins/` — global

No `plugins` config entry is needed; directories there load automatically.

## Verify it is loaded

```bash
opencode api get '/api/plugin?location[directory]=<dir>'   # topic-compaction: status active
tail -f ~/.local/share/opencode/log/topic-compaction.log    # loads + each compaction decision
```

Each compaction logs `N topics → topic summary generated (X chars)`,
`N topic(s) → yielding to native template`, or the error that forced a
fallback — so the plugin's behavior is observable instead of silent.

## Use

Compaction happens through opencode's normal flow (`/compact` or auto); the
hook upgrades the prompt transparently. Sessions with ≥2 topics get the
structured summary; others compact exactly as before.

## Evaluation

Head-to-head results against base opencode compaction (paired sessions,
identical model): see [`compaction-report.md`](./compaction-report.md).
Highlights:

- better organization on every multi-topic window tested — segmentation,
  rare-file retention, causal cross-references;
- guaranteed blocker carry-forward across compaction boundaries (verified with
  exact string matches);
- identical behavior on single-topic windows; latency parity within ~±10%;
- validated on a real locally hosted 9B model at true 16k/32k contexts:
  same latency as base, never-larger output, clean fallbacks.

## Development

See [`AGENTS.md`](./AGENTS.md) for layout, verification commands and sync
rules (`src/` is the source of truth; `.opencode/plugins/` mirrors it).

The evaluation harness lives in [`tools/`](./tools): `eval_clones.ts` builds
paired synthetic sessions, `eval_run2.ts` runs head-to-head comparisons
against two opencode serves, `eval_degrade.ts` runs repeated-compaction
studies. Raw outputs are preserved under `tools/artifacts/`.

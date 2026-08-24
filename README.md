# opencode-topic-compaction

An [opencode](https://opencode.ai) plugin: when opencode compacts a session,
this plugin appends a late-position override to the compaction prompt so the
model summarizes **per topic** instead of one linear stream. Topics come
from clustering the session's actual file activity; every topic carries an
explicit `blocked:` status, and open blockers are guaranteed to survive
across successive compactions.

## Behavioral contract

The plugin is conservative by design — it upgrades compaction only where it
clearly applies and steps aside everywhere else:

- **≥2 clustered topics** → per-topic summary (`# TOPIC n:` with mandatory
  `blocked:` keys + a global `# STATE`). Below that threshold → opencode's
  native template, byte-for-byte unchanged.
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
session messages ──► topics-model ──► topics-cluster ──► topics-compaction ──► hook context
                     nodes+edges      causal chains     per-topic prompt      (appended LAST,
                     +files           merged by file    + TOPIC map +         wins over native
                                      overlap           fusion rules          template)
```

- `topics-model.ts` — turns session entries into nodes/edges; resolves the
  active window after the last compaction boundary, splits off the raw recent
  tail, and extracts the prior summary. Falls back to reading opencode's
  SQLite store when the client API returns a truncated view.
- `topics-cluster.ts` — pure topic detection: user messages open chains; chains
  merge when their weighted file overlap (edit ≫ read) clears a threshold;
  discussion-only chains ride along.
- `topics-compaction.ts` — builds the override: role line, "disregard the
  native template" amendment, `# TOPIC n:` spec with mandatory `blocked:` keys,
  a global `# STATE`, rules, optional `<prior-summary>` fusion with blocker
  carry-forward, and the topic map. Returns nothing (<2 topics → native path).
- `topics-plugin.ts` — registers the compacting hook; any failure falls back
  to native compaction silently.

## Install

**From npm (recommended)** — add the package to your `opencode.json`; bun
installs it automatically at startup:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-topic-compaction"]
}
```

- **Project-level**: put the snippet in `<project>/opencode.json` — active in
  that project only.
- **Global**: put it in `~/.config/opencode/opencode.json` — active everywhere.

**Manual** — copy the plugin files (`src/topics-*.ts`) into a plugin directory:

- `.opencode/plugins/` — project-level, or
- `~/.config/opencode/plugins/` — global

No other setup. Manual copies need no `plugin` config entry; files there load
automatically.

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

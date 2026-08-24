## Objective
- Implement the user-approved generic "scent trails" community detection for the session graph plugin (codebase-independent clustering by **context similarity**, not time order; recurring topics merge into one community; cap at 12; weak prose signal), test it (synthetic unit tests + live regression render), and perform a **full code review** — the user's explicit final instruction.

## Important Details
- User decisions: cap communities at ~12 (merge most-similar pair beyond); filenames mentioned in prose count as weak scent; scale verified via synthetic unit tests (no live opencode-sized session).
- Core requirement: A→B→A must re-join the original A community ("group based on context similarity", never split by time/message order).
- Detection constants in `src/graph-model.ts`: `EDIT_WEIGHT=4`, `READ_WEIGHT=2`, `MENTION_WEIGHT=1`, `STRONG_WEIGHT=2`, `DEPTH_POWER=1.5`, `BASE_SCENT=0.5`, `JOIN_THRESHOLD=0.3`, `MAX_COMMUNITIES=12`.
- Strong-identity rule: only edit/read signals (weight ≥ 2) build/extend a community's identity; faint mentions (bash/prose, weight 1) vote a message into a community but never start or extend one.
- Depth premium `(segmentsUpToFolder/totalSegments)^DEPTH_POWER`: deep module folders bind files (session/ shared = 2.86 ≥ threshold), flat `src/` stays weak (1.41) and does not glue.
- Tokenizer hardened: `PATH_EXT = /[A-Za-z0-9][A-Za-z0-9._-]*\.(ts|js|jsx|tsx|md|json|png|log|ttf|yml|yaml|py|rs|go|c|h|cpp|hpp|toml|sh|css|html)$/` (rejects globs `*.d.ts`, extension-only `.ts/.md/.json`, slash phrases `time/message`); `pathTokens` strips `*` too; `keepPath` = node_modules-only filter; read/edit/write filePath args are authoritative (extension-less allowed).
- `buildGraph(client, sessionID, workspace?)` — optional third param added during review; internally `const ws = workspace ?? workspaceOf(items)`; call sites at lines 130/159/164 use `ws`. `workspaceOf` derives root from first assistant message `"path" in info && info.path?.cwd`.
- SDK specifics: export is `createOpencodeClient` (NOT `createClient`); option is `baseUrl` (singular, NOT `baseURL`); live server runs on **port 4399** (port 17431 from earlier is NOT running); session `ses_fe6efc2aaffeNlzZ4NiASIU5jY` exists on 4399.
- Rendering constraints unchanged: width ≤ 642 px (SCALE=2), colored border only (no grey fill), cluster color keyed by group id; typecheck must show only the known bun-only TS2339 `import.meta.dir` error at `plugins/graph-render.ts(89,59)`; `session_graph_png` tool runs cached plugin code — opencode restart needed for the tool to pick up changes.
- `bun -e '...'` cannot resolve `@opencode-ai/sdk` from the eval context — debug scripts must be real files under `.opencode/`.

## Work State
### Completed
- Generic scent-trails rewrite of `src/graph-model.ts`: removed `CORE_MODULES`, `dominantCore`, `AREA_REPO`/`AREA_SCRATCH`, `touchAreas`; added `ScentSignal`, `scentOf`, exported `pathTokens`, `toolSignals`, `workspaceOf`, `normPath(fp, workspace)`, `overlap`, and exported pure `clusterMessages(msgs, maxCommunities)` returning `{ groupOf, labels }` (Pass A greedy join/threshold with strong/weak split, cap-merge via `scentAll` min-normalized similarity, Pass B no-scent ride-along, labels = most-touched strong path shortened to last 2 segments).
- `buildGraph` collects per-message `msgSignals` (tool signals + prose text tokens weight 1) and calls `assignCommunities(messageNodes, msgSignals, ws)`.
- `src/graph-render.ts`: `Cluster.group`; color keyed by `CLUSTER_BORDER_COLORS[c.group % len]`; labels ellipsized via `fitLine(ctx, c.label, clusterW - 16 * SCALE)`.
- Synthetic unit tests `.opencode/plugins/test_cluster.ts`: **all 17 checks PASS** (A→B→A merges to 2; same deep module merges; flat dir splits; session/server/tools → 3; deep one-topic convo stays 1; prose mention joins; no-scent talk rides along; faint non-matching mention rides along; cap 14→6; label `session/index.ts`; pathTokens filters).
- Junk communities eliminated (`time/message`, `persistence/split`, `*.d.ts`, `.ts/.md/.json`) via extension-required tokenizer.
- Pre-review regression: 4 communities — #0 `src/graph-model.ts` (72 msgs, 8 runs), #1 `.opencode/render_live.ts` (10), #2 `plugins/test_graph-plugin.ts` (2), #3 `plugins/test_cluster.ts` (3); model+render merged accepted as genuine context overlap.
- Code review performed with two fixes applied: (1) weak-vote branch with zero overlap now defers to Pass B instead of arbitrarily joining group 0; (2) `graph-plugin.ts` passes `input.directory` to `buildGraph`; plus `buildGraph` gained optional `workspace?: string` param (fixed TS2554 "Expected 2 arguments, but got 3").
- AGENTS.md community-detection section rewritten to describe the scent-trails algorithm.
- Full sync `cp src/*.ts .opencode/plugins/` + `diff -r` clean (only `Roboto-Regular.ttf`, `test_cluster.ts`, `test_graph-plugin.ts` extra) + typecheck clean (only `import.meta.dir`) + all tests pass.

### Active
- Final regression verification incomplete: latest run (`bun .opencode/render_live.ts`) returned `nodes=52 edges=51 communities=2` and wrote `/workspaces/opencode-topic-compaction/graph-poc/regression.png` — node count dropped vs. the earlier 87-node/4-community render (likely another re-compaction shrank the active window); per-group breakdown dump failed because `bun -e` cannot resolve `@opencode-ai/sdk` (needs a script file under `.opencode/`).
- Throwaway `.opencode/render_live.ts` still exists (delete after final verification).
- Code review report not yet delivered to the user.

### Blocked
- Port 17431 no longer running; only 4399 serves the session (use `createOpencodeClient({ baseUrl: "http://127.0.0.1:4399", directory: "/workspaces/opencode-topic-compaction" })`).

## Next Move
1. Write a temporary script under `.opencode/` (not `bun -e`) that calls `buildGraph(client, "ses_fe6efc2aaffeNlzZ4NiASIU5jY", "/workspaces/opencode-topic-compaction")` and dumps per-group label/count/run breakdown to confirm the 52-node/2-community window groups sensibly; then delete both throwaway scripts (`.opencode/render_live.ts` and the temp dumper).
2. Deliver the full code review report to the user: summarize findings and fixes (weak-vote zero-overlap deferral, `buildGraph` workspace param + plugin passing `input.directory`, tokenizer hardening, depth-premium tuning to 1.5), note remaining known limitations (mega-community when work genuinely interleaves across files; palette cycling above 7 communities), and remind that `session_graph_png` requires an opencode restart to load the new plugin.

## Relevant Files
- `/workspaces/opencode-topic-compaction/src/graph-model.ts`: generic detection — `ScentSignal`, `scentOf`, `pathTokens` (exported), `toolSignals`, `workspaceOf`, `normPath`, `overlap`, exported `clusterMessages`/`ClusterResult`, wrapper `assignCommunities`; constants EDIT/READ/MENTION/STRONG weights, DEPTH_POWER, BASE_SCENT, JOIN_THRESHOLD, MAX_COMMUNITIES; `buildGraph(client, sessionID, workspace?)`.
- `/workspaces/opencode-topic-compaction/src/graph-render.ts`: cluster borders colored by group id, label truncation via `fitLine`; `CLUSTER_PAD`/`CLUSTER_HEADER_GAP`/`CLUSTER_BORDER_W`.
- `/workspaces/opencode-topic-compaction/src/graph-theme.ts`: `CLUSTER_BORDER_COLORS` (7 colors).
- `/workspaces/opencode-topic-compaction/src/graph-plugin.ts`: passes `directory` to `buildGraph`; reports `communities` in tool metadata.
- `/workspaces/opencode-topic-compaction/.opencode/plugins/`: deployed copies (source of truth `src/`); `test_cluster.ts` (17 passing unit tests), `test_graph-plugin.ts` (live E2E, port 4399).
- `/workspaces/opencode-topic-compaction/AGENTS.md`: updated scent-trails description (strong identity, faint voting, depth premium, thresholds, cap, labels).
- `/workspaces/opencode-topic-compaction/.opencode/render_live.ts`: throwaway harness (baseUrl 4399, writes `graph-poc/regression.png`) — delete after final verification.
- `/workspaces/opencode-topic-compaction/graph-poc/regression.png`: latest regression render (52 nodes, 2 communities); `graph-poc/ses_fe6efc2aaffeNlzZ4NiASIU5jY.png`: older render (pre-weak-vote-fix, 641×51449).
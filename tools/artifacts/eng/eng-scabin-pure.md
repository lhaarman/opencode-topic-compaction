## Objective
- Implement the approved generic "scent trails" community detection for the session graph plugin (codebase-independent grouping by context similarity, not time order), test it, and perform a full code review — implementation and testing are done; the code review is essentially complete with fixes applied.

## Important Details
- User decisions (question tool): **cap communities at ~12, merge most-similar pair when exceeded**; **yes, filenames mentioned in prose count as weak scent**; **verify scale via synthetic unit tests** (no live opencode-sized session available).
- Core user requirement: "I don't want topics to be separated if they're only separated by time/message order — we group based on context similarity." A→B→A must re-join the original A community.
- Detection constants in `src/graph-model.ts`: `EDIT_WEIGHT=4`, `READ_WEIGHT=2`, `MENTION_WEIGHT=1`, `STRONG_WEIGHT=2`, `DEPTH_POWER=1.5`, `BASE_SCENT=0.5`, `JOIN_THRESHOLD=0.3`, `MAX_COMMUNITIES=12`.
- Strong-identity rule: only edit/read signals (weight ≥ 2 = STRONG_WEIGHT) build/extend community identity; faint mentions (bash/prose, weight 1) only vote a message into a community — never start or extend one.
- `PATH_EXT = /[A-Za-z0-9][A-Za-z0-9._-]*\.(ts|js|jsx|tsx|md|json|png|log|ttf|yml|yaml|py|rs|go|c|h|cpp|hpp|toml|sh|css|html)$/` — rejects globs (`*.d.ts`), extension-only fragments (`.ts/.md/.json`), slash phrases (`time/message`). `pathTokens` strips `*` and requires PATH_EXT; `keepPath(p)` = node_modules-only filter; read/edit/write filePath args authoritative (extension-less allowed).
- `buildGraph(client, sessionID, workspace?: string)` — plugin now passes `input.directory`; internally `const ws = workspace ?? workspaceOf(items)`; usages at lines 130/159/164 use `ws`. `workspaceOf` falls back to first assistant message `info.path.cwd`.
- Live opencode server runs on **port 4399** (prior assumption of 17431 is wrong — 17431 is down). SDK client must be created as `createOpencodeClient({ baseUrl: "http://127.0.0.1:4399", directory: "/workspaces/opencode-graph-plugin" })` — option is `baseUrl`, NOT `baseURL`; bare `createClient` does not exist in `@opencode-ai/sdk`. Session `ses_fe6efc2aaffeNlzZ4NiASIU5jY` exists on 4399 (title "Greeting").
- Latest regression render (post-fixes, post-re-compaction): **nodes=52, edges=51, communities=2** → wrote `graph-poc/regression.png` (earlier pre-compaction render was 87 nodes / 4 communities; the window keeps shrinking via re-compaction).
- Verification gates unchanged: width ≤ 642 px (SCALE=2), no grey cluster colors, colored border only, one color per community; typecheck may show ONLY the known bun-only `plugins/graph-render.ts(89,59)` TS2339 `import.meta.dir` error; `src/` byte-synced to `.opencode/plugins/` (diff allows only `Roboto-Regular.ttf`, `test_cluster.ts`, `test_graph-plugin.ts`); `session_graph_png` tool runs cached plugin code — restart opencode or render directly via throwaway script.
- Code review verdict (completed): one real bug fixed — weak/faint-only messages with zero overlap previously jumped arbitrarily to group 0; now they defer to Pass B (join following/previous community). Other items checked OK: `overlap()` min-capping, cap-merge remap correctness, O(n³) worst-case merge acceptable at expected sizes, `normPath` edge cases (empty/root workspace safe), single-segment paths double-count file+basename intentionally, renderer `fitLine` label ellipsizing, `"path" in info` union narrowing for `workspaceOf`.

## Work State
### Completed
- Generic scent-trails rewrite of `src/graph-model.ts` fully implemented and verified: removed `CORE_MODULES`/`dominantCore`/`AREA_REPO`/`AREA_SCRATCH`/`touchAreas`; added exported `ScentSignal`, `ClusterResult`, `clusterMessages(msgs, maxCommunities)`, `pathTokens`, plus internal `scentOf`, `toolSignals`, `workspaceOf`, `normPath(fp, workspace)`, `overlap`, `assignCommunities` wrapper.
- `buildGraph` signature extended to `(client, sessionID, workspace?)`; collects per-message `msgSignals` (tool signals + prose text tokens weight 1); calls `assignCommunities(messageNodes, msgSignals, ws)`.
- `src/graph-plugin.ts` now calls `buildGraph(client, sessionID, directory)`; reports `communities` in tool metadata.
- `src/graph-render.ts`: `Cluster.group` field; cluster border color keyed by `CLUSTER_BORDER_COLORS[c.group % len]`; labels ellipsized via `fitLine(ctx, c.label, clusterW - 16 * SCALE)`.
- Synthetic unit tests `.opencode/plugins/test_cluster.ts`: **all 18 checks PASS** (incl. newly added "faint non-matching mention rides along": ghost-file prose must ride along, not jump to group 0).
- Full code review performed over `git diff` of all 5 modified files; one bug found & fixed (weak-vote zero-overlap), rest verified correct.
- AGENTS.md updated twice: renderer section says "most-touched file" (not repo file), community-detection section rewritten to describe the generic scent-trails algorithm (strong identity from edits/reads, mention voting, depth-premium fragments, JOIN_THRESHOLD 0.3, cap-merge at 12, last-2-segment labels, pathTokens filtering).
- Sync + verification green: `cp src/graph-model.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/`, `diff -r` clean (only ttf/test extras), typecheck shows only the expected `import.meta.dir` error, `bun plugins/test_cluster.ts` → "All tests passed."
- Regression render re-run successfully: `bun .opencode/render_live.ts` → `nodes=52 edges=51 communities=2`, wrote `/workspaces/opencode-graph-plugin/graph-poc/regression.png`.
- Confirmed via curl that only port 4399 serves the opencode API and hosts session `ses_fe6efc2aaffeNlzZ4NiASIU5jY`.

### Active
- Verifying community quality on the shrunk 52-node window (2 communities) — a `bun -e` breakdown attempt failed on module resolution (`Cannot find module '@opencode-ai/sdk' from '/workspaces/opencode-graph-plugin/[eval]'`); needs a script placed under `.opencode/` instead.
- Confirming whether the smaller window (52 vs 87 nodes) is due to another re-compaction (expected) and that the 2 communities are sensible.
- Cleanup: `.opencode/render_live.ts` throwaway still exists (delete after final verification).

### Blocked
- (none)

## Next Move
1. Print the per-community breakdown of the 52-node render (place a small script under `.opencode/` so `@opencode-ai/sdk` resolves; call `buildGraph(client, "ses_fe6efc2aaffeNlzZ4NiASIU5jY", "/workspaces/opencode-graph-plugin")` and dump `group`/`groupLabel` counts) to sanity-check the 2-community result.
2. Delete throwaway `.opencode/render_live.ts`, re-run final sync/diff/typecheck/tests if anything changed, then report completion to the user: implementation + 18 passing unit tests + regression renders + code-review findings (weak-vote fix, workspace param, label truncation, tokenizer hardening).

## Relevant Files
- `/workspaces/opencode-graph-plugin/src/graph-model.ts`: generic community detection — `clusterMessages`, `pathTokens`, `toolSignals`, `workspaceOf`, `normPath(fp, workspace)`, `scentOf`, `overlap`; constants EDIT/READ/MENTION/STRONG_WEIGHT, DEPTH_POWER, BASE_SCENT, JOIN_THRESHOLD, MAX_COMMUNITIES; `buildGraph(client, sessionID, workspace?)`.
- `/workspaces/opencode-graph-plugin/src/graph-render.ts`: cluster borders colored by group id, label truncation via `fitLine`; `Cluster.group`.
- `/workspaces/opencode-graph-plugin/src/graph-theme.ts`: `CLUSTER_BORDER_COLORS` (7 colors).
- `/workspaces/opencode-graph-plugin/src/graph-plugin.ts`: passes `input.directory` to `buildGraph`; metadata includes `communities`.
- `/workspaces/opencode-graph-plugin/.opencode/plugins/`: deployed copies (source of truth `src/`); `test_cluster.ts` (18 passing unit tests), `test_graph-plugin.ts` (live E2E, port 4399).
- `/workspaces/opencode-graph-plugin/AGENTS.md`: updated with the generic scent-trails description.
- `/workspaces/opencode-graph-plugin/.opencode/render_live.ts`: throwaway render harness (uses `createOpencodeClient({ baseUrl: "http://127.0.0.1:4399", directory })`, writes `graph-poc/regression.png`) — delete after final verification.
- `/workspaces/opencode-graph-plugin/graph-poc/regression.png`: newest render (52 nodes / 2 communities); `/workspaces/opencode-graph-plugin/graph-poc/ses_fe6efc2aaffeNlzZ4NiASIU5jY.png`: older pre-compaction render (641×51449).
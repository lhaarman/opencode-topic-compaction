## Objective
- Evolve the opencode graph plugin (`session_graph_png`) into a properly-modelled graph of the full *active* context (post-compaction window), rendered as a readable, color-coded PNG.
- Current task (user directive): make **every** node a rounded rectangle (circles were illegible), ensure tool nodes fit their text fully (bash command fully visible; multi-line only as an exception), reusing the widest-message width instead of keeping the image narrow.

## Important Details
- Workflow: work in `src/`, copy to `.opencode/plugins/` when ready for testing; `src/` is source of truth, deployed copies byte-identical (only `Roboto-Regular.ttf` + `test_graph-plugin.ts` extra there).
- Active-context default: entire post-compaction window (last compacted marker included → end); no compaction → whole conversation; **no message limit** (user wants full graph modelled for later use).
- **No dollar cost** anywhere (tokens only). Compaction marker = `compaction` part, assistant `summary: true`, or user summary with non-empty title/body; bare `summary:{diffs:[]}` on every user message is NOT a marker.
- NodeKind: user-message | assistant-response | reasoning | tool_call | file | subtask | compaction. EdgeKind: follows | causes | references (subtask uses `causes`; no `parentID`). Colors: user=blue, assistant=orange, reasoning=yellow, tool=cyan, file=purple, subtask=teal, compaction=slate; `error` overrides red; `META_COLOR` muted.
- Design rules from user: color is for distinguishing **node types**; informational text (edge labels, metadata incl. `error:`/`compacted`) is black/muted; every truncation shows ASCII `...`; every node draws its kind as a top header in its kind color; whole canvas rendered at `SCALE = 2` (fonts re-rasterized crisp); time shown only on `follows <HH:MM>` edge labels + compaction node metadata.
- Tool annotations (model `toolContent`, name on line 1, context on line 2): `bash\n<command>`, `edit|write|read\n<filePath>`, `grep\n<pattern> — <plain words>` (via `grepDescription`: strip regex syntax → up to 4 unique word tokens), `question\n<text>`.
- Geometry facts: `MAX_TEXT_W = 205*SCALE` (410), `PAD_X = 16*SCALE`, `MARGIN = 40*SCALE`; message node w = innerW + 2·PAD_X (max 474) → canvas width 634 observed consistently; `availW = width − 2·MARGIN` = 474 is the width available for attached-node text (user: use it, don't keep image narrow).
- pureimage: `roundRect` supported, `arcTo` NOT; SDK: `AssistantMessage` has no `agent`; assistant model = top-level `providerID/modelID`; `ToolPart.state.status === "error"` → `state.error`; all tool states carry `input: {[key:string]:unknown}` (bash=`command`, edit/write/read=`filePath`, grep=`pattern`, question=`question`); ES2022 target → no `findLastIndex`.
- tsc cmd (only expected error: bun-only `import.meta.dir`): `cd .opencode && bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-model.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts`
- Live serve: `setsid nohup opencode serve --port 4399 >/tmp/opencode/serve.log 2>&1 < /dev/null & disown`; health `http://127.0.0.1:4399/app/session` → 200. Live prompts fail server-side (sandbox lacks `HPC_AI_API_KEY`) but session/buildGraph/render work. Session id: `ses_feb0ee2a6ffeEJRykJ0iLjPmm7`.
- This model cannot view images; verify renders by decoding PNGs (`decodePNGFromStream` + `Readable`) and counting pixel colors.

## Work State
### Completed
- Dynamic circle sizing (convergent `sizeCircleNode`, row packing) — implemented, verified, synced, live-rendered; **now superseded** by the all-rectangles redesign.
- Edge labels black (`TEXT_COLOR`), truncation markers standardized to ASCII `...` (`fitLine`/`truncateLines`/`truncateContent`), metadata (`compacted`, `error:`) muted `META_COLOR`; edge *lines* stay kind-colored.
- Kind headers: `KIND_LABELS` map + `HEADER_LH`/`HEADER_GAP`; every node draws uppercase kind label at top in its kind color.
- `SCALE = 2` global upscale (all constants/fonts multiplied; `FONT_PX`/`META_PX` derived); AGENTS.md cap note updated (≤321 base px ⇒ ≤642 pixels).
- Edges +20%: message gap 30→36, `ATTACH_FIRST_GAP` 24→29 (scaled).
- Truncation verified on real data: reasoning 171 words → truncated with `...`; messages max 132 words (not needed yet); tool names 1 word.
- Compaction summary display fixed: `compactionContent(info, parts)` reads text parts when `summary === true`; verified live (968-word summary on the compaction node, truncated to 150 in display).
- Content policy decided: raw everywhere + fix summary (user picked Recommended option).
- Tool annotations implemented + verified live: bash commands (28 nodes), file paths, grep pattern+description, question text; `wrapText` honors explicit `\n` as hard breaks; convergent circle sizing returned stored lines to draw pass (now replaced by redesign).
- Time removed from node metadata except compaction nodes (live render 634×58023, 230 nodes).
- Multiple successful `session_graph_png` tool runs after user restarts (latest tool render 634×57303).

### Active
- **All-rounded-rectangles redesign in `src/graph-render.ts` — edits applied, NOT typechecked/synced/verified:**
  - Constants: removed `ATTACH_MIN_R`/`ATTACH_MAX_R`/`ATTACH_PAD`/`ATTACH_TEXT_W`; kept `ATTACH_GAP=10*SCALE`, `ATTACH_ROW_GAP=14*SCALE`, `ATTACH_FIRST_GAP=29*SCALE`.
  - `type Pos = { x, y, w, h }` (circle shape removed); `borderPoint` always `rectBorderPoint`; `pointOnCircleEdge` deleted.
  - `sizeAttachNode(ctx, node, maxInnerW)` returns `{w, h, lines}`; wraps at `availW − 2*PAD_X` so commands fit one line; `innerW = max(70, min(maxInnerW, max(labelW, lineWidths)))`; `truncateLines(..., 25)`.
  - Layout: `AttachedRow = {items, wmax, hmax, yOff}` packed by width vs `availW`; `yOff = cy + hmax/2`; `attachedBottom = last.yOff + last.hmax/2`; attached positioned as rects centered per row.
  - Shared `drawNodeRect(ctx, n, p, s, withMeta)` helper (`SizedNode = {lines, meta?}`); message loop passes `sizes[...]` with `withMeta=true`, attached loop passes `attachSizes.get(id)` with `false`.
  - **Known expected tsc error:** `sizeMessageNode` still returns `contentLines` but `SizedNode`/`drawNodeRect` expect `lines` — rename the return field to `lines` (and its usage) to fix.

### Blocked
- Sandbox live prompts fail server-side (`UnknownError`: missing `HPC_AI_API_KEY`) — environmental; session creation/buildGraph/render fine.
- Possible lingering `opencode serve --port 4399` process: the last two cleanup chains (`kill … ; rm … ; diff`) hit shell timeouts — check `ps -ef | grep "[o]pencode serve"` and kill before starting a new serve.

## Next Move
1. Copy `src/graph-render.ts` → `.opencode/plugins/`, run tsc; fix the expected `contentLines` vs `lines` mismatch (rename `sizeMessageNode` return field to `lines`).
2. Synthetic render check: all 7 kinds as rounded rects; bash command fully on one line inside its node; multi-line only for over-long content; no horizontal overflow; valid PNG; pixel-check per-kind colors.
3. Live render `ses_feb0ee2a6ffeEJRykJ0iLjPmm7` (serve on 4399), regenerate `graph-poc/*.png`, confirm `diff -r src .opencode/plugins` (only ttf + test differ), update AGENTS.md (attached nodes now rounded rects sized to message width; tool annotations; SCALE; time policy), kill serve + temp files, report — user will restart opencode and re-render via tool.

## Relevant Files
- `/workspaces/opencode-topic-compaction/src/graph-render.ts` — all-rect redesign just applied (unverified, unsynced); contains `Pos`, `sizeAttachNode`, `drawNodeRect`, layout/draw rewrite.
- `/workspaces/opencode-topic-compaction/src/graph-model.ts` — active-context `buildGraph`, compaction kind + summary-content fix, `toolContent`/`grepDescription` annotations (synced to plugins).
- `/workspaces/opencode-topic-compaction/src/graph-theme.ts` — per-kind colors, error red, `META_COLOR`, `FONT_SIZE`/`META_FONT_SIZE` (synced).
- `/workspaces/opencode-topic-compaction/src/graph-plugin.ts` — thin entry; id `"graph-plugin"`, tool `session_graph_png`, saves to `graph-poc/` (synced).
- `/workspaces/opencode-topic-compaction/.opencode/plugins/` — deployed copies; `graph-render.ts` here is one revision behind (pre-redesign circles version).
- `/workspaces/opencode-topic-compaction/.opencode/package.json` — deps: `@opencode-ai/plugin` 1.18.18, `@opencode-ai/sdk` 1.18.18, `pureimage`.
- `/workspaces/opencode-topic-compaction/AGENTS.md` — workflow/sync/verify docs; needs updating for rect redesign + tool annotations + SCALE + time policy.
- `/workspaces/opencode-topic-compaction/.opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` — SDK type source of truth (ToolPart/state/input shapes).
- `/workspaces/opencode-topic-compaction/graph-poc/ses_feb0ee2a6ffeEJRykJ0iLjPmm7.png` — last saved render (634×58023, pre-redesign).
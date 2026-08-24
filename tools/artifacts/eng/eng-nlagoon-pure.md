## Objective
- Evolve the opencode graph plugin (`session_graph_png`) into a properly-modelled graph of the full *active* context (post-compaction window), rendered as a readable PNG: every node a rounded rectangle (user just ordered circles abolished), distinct color per node kind with self-explanatory type headers, tool nodes carrying their real context (command/path/pattern) fully fitted.

## Important Details
- Workflow (user restated repeatedly): **work in `src/` first, copy to `.opencode/plugins/` only when ready for testing**; `src/` is source of truth, deployed copies must be byte-identical (only `Roboto-Regular.ttf` + `test_graph-plugin.ts` differ there).
- Graph policy (user decisions, stable): capture the **entire active context** (last compaction marker inclusive → end; whole convo if never compacted), **no message limit**; **no dollar cost** anywhere (tokens only); subtask uses `causes` edge; no `parentID`; `GraphNode` has no `role` (kind encodes it).
- Content policy (user chose): **raw content everywhere** (messages/reasoning raw, truncated at 150 words / 25 wrapped lines with `...`); **compaction node shows the real summary** (fixed: assistant `summary: true` carries summary text in its *text parts*, not on `info.summary` — old code fell through to `(compaction)` placeholder).
- Node visuals (current directives): **all nodes are rounded rectangles** (user: circles were illegible; rects "worked better"); tool nodes must fit their full text (e.g., whole bash command), multi-line only as exception ("estimate of the width I want"), reuse the widest-message canvas width rather than minimizing white space; every node draws a **type header** (`USER`/`ASSISTANT`/… ) in its kind color; **edge-label text is black** (`TEXT_COLOR`), colors reserved for distinguishing node types; **time appears only on compaction nodes** (follows edges carry other times; accepted gap: a never-compacted first message shows no time); all truncation markers are ASCII `...`.
- Tool annotations implemented in `toolContent()` (graph-model.ts): `bash\n<command>`, `edit|write|read\n<filePath>` (from `state.input.filePath`), `grep\n<pattern> — <plain words>` (via `grepDescription()` regex-token extraction), `question\n<text>`.
- Rendering internals: `SCALE = 2` (every constant/font ×2 for crisp zoom); `MAX_TEXT_W = 205*SCALE`; `MARGIN = 40*SCALE`; `gap = 36` (edges +20%), `ATTACH_FIRST_GAP = 29*SCALE`; pureimage supports `roundRect`, NOT `arcTo`; SDK facts: assistant has no `agent` field, assistant model = top-level `providerID/modelID`, user model = `info.model.*`; `ToolPart.state.status === "error"` then `state.error`; ES2022 target → no `findLastIndex`.
- tsc (only expected error is bun-only `import.meta.dir` in graph-render.ts): `cd .opencode && bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-model.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts`
- Live serve: `setsid nohup opencode serve --port 4399 >/tmp/opencode/serve.log 2>&1 < /dev/null & disown`; health `http://127.0.0.1:4399/app/session` → 200. **Cleanup hazard:** chaining `kill $(ps -ef | grep "[o]pencode serve" | awk '{print $2}')` in a compound command has timed out twice — kill in a separate short command (PID lookup via `ps -ef | grep "[o]pencode serve"`), then `rm` temp files.
- Session id: `ses_feb0ee2a6ffeEJRykJ0iLjPmm7`. Tool output = markdown base64 image + PNG saved to `graph-poc/<sessionID>.png`. Truncation verified against real data: fires on reasoning (171 words > 150 cap, 28 lines > 25); messages maxed at 132 words; compaction node content is 968-word summary (truncated to 150 in display).
- This model cannot view images; verify renders by decoding PNG pixels (`decodePNGFromStream` + counting hex colors).

## Work State
### Completed
- Compaction-detection bug fixed (`itemCompaction`: only `compaction` parts / `summary === true` / non-empty title/body); compaction node now shows real summary text (`compactionContent(info, parts)` reads text parts when `summary === true`) — synced & live-verified.
- SCALE=2 crisp upscaling; node type headers in kind color; black edge-label text; muted metadata (`META_COLOR`) incl. error/compacted lines; ASCII `...` on all truncation (`fitLine`, `truncateLines`, `truncateContent`); time metadata restricted to compaction nodes — all synced & verified.
- Edges +20% (`gap` 30→36, `ATTACH_FIRST_GAP` 24→29 scaled) — synced & live-verified.
- Tool annotations (bash/edit/write/read/grep/question) with newline separators (`name\ncontext`); `wrapText` honors explicit `\n` as hard breaks — synced & live-verified (212–230 node renders OK).
- Dynamic circle sizing + row packing (superseded by rect redesign, but was verified working: long tool name r≈40 vs r=16 before).
- Multiple live renders delivered to user (latest pre-redesign: 634×58023, 230 nodes); user restarted opencode several times to pick up changes (plugin loads only at startup).

### Active
- **Rect redesign of attached nodes in `src/graph-render.ts` — edits applied but NOT typechecked, NOT verified, NOT copied to `.opencode/plugins/`:**
  - Constants: circle consts removed; kept `ATTACH_GAP=10*SCALE`, `ATTACH_ROW_GAP=14*SCALE`, `ATTACH_FIRST_GAP=29*SCALE`.
  - `Pos` simplified to `{x,y,w,h}` (no circle variant); `borderPoint` → always `rectBorderPoint`; `pointOnCircleEdge` deleted.
  - `sizeAttachNode(ctx, node, maxInnerW)` returns `{w,h,lines}`; called with `maxInnerW = availW - 2*PAD_X` so text wraps at full message width (one-line rule).
  - Row packing per parent: `AttachedRow {items,wmax,hmax,yOff}`, `attachedBottom = last.yOff + hmax/2`; message rows reserve it.
  - Shared `drawNodeRect(ctx,n,p,s,withMeta)` draws border/fill/header/content(+metadata).
  - Draw loops: messages `drawNodeRect(..., sizes[idx], true)`, attached `drawNodeRect(..., attachSizes.get(id), false)`.
  - **KNOWN BUG to fix:** `drawNodeRect` reads `s.lines`, but `sizeMessageNode` still returns `contentLines` (not `lines`) → message rendering will break; rename the message-size return field to `lines` (and update any references) before verifying.
  - `.opencode/plugins/graph-render.ts` still holds the previous circles renderer (stale).

### Blocked
- Sandbox live prompts fail server-side (`UnknownError: Unexpected server error`, missing `HPC_AI_API_KEY`) — environmental; session creation/buildGraph/render unaffected.
- Occasional shell timeouts on serve-kill cleanup chains — use separate kill/rm commands.

## Next Move
1. Fix the `contentLines`→`lines` mismatch in `sizeMessageNode`'s return (or adapt `drawNodeRect`/`SizedNode`) so the new rect draw path works for messages.
2. Verify in place: run the standard tsc command (expect only `import.meta.dir`), plus a synthetic render check asserting attached rects stay within `availW` (bash command fits on one line unless longer than widest message), valid PNG ≤ 321*SCALE+2 wide, taller than wide, all kind colors present.
3. Per workflow, copy all four modules to `.opencode/plugins/`, live-render `ses_feb0ee2a6ffeEJRykJ0iLjPmm7` via serve script, confirm `diff -r src .opencode/plugins` (only ttf/test differ), kill serve in a standalone command, update AGENTS.md (attached nodes are now rounded rectangles, not `[16,44]` circles), then tell the user to restart opencode and re-run `session_graph_png`.

## Relevant Files
- `/workspaces/opencode-graph-plugin/src/graph-render.ts` — active redesign: rect-only `Pos`, `sizeAttachNode`, `drawNodeRect`, row packing; **unverified, unsynced**; contains the `contentLines`/`lines` mismatch bug.
- `/workspaces/opencode-graph-plugin/src/graph-model.ts` — synced: active-context `buildGraph`, compaction summary fix, `toolContent` newline annotations, `grepDescription`.
- `/workspaces/opencode-graph-plugin/src/graph-theme.ts` — synced: per-kind fills/borders, `ERROR_FILL/BORDER`, `META_COLOR`, `FONT_SIZE`/`META_FONT_SIZE`.
- `/workspaces/opencode-graph-plugin/src/graph-plugin.ts` — thin entry, plugin id `"graph-plugin"`, tool `session_graph_png`, writes `graph-poc/<id>.png`.
- `/workspaces/opencode-graph-plugin/.opencode/plugins/` — deployed copies (+ `Roboto-Regular.ttf`, `test_graph-plugin.ts`); `graph-render.ts` here is stale (pre-rect circles).
- `/workspaces/opencode-graph-plugin/.opencode/package.json` — deps: `@opencode-ai/plugin` 1.18.18, `@opencode-ai/sdk` 1.18.18, `pureimage`.
- `/workspaces/opencode-graph-plugin/AGENTS.md` — workflow/sync/verify docs; needs circle→rounded-rect wording update for attached nodes.
- `/workspaces/opencode-graph-plugin/graph-poc/ses_feb0ee2a6ffeEJRykJ0iLjPmm7.png` — last delivered render (pre-rect redesign).
- `/workspaces/opencode-graph-plugin/.opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` — SDK type source of truth (`ToolPart.state.input`, `summary` shapes, part unions).
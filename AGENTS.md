# AGENTS.md

Guidelines for working in this repo. OpenCode should read and follow these.

## Project

A proof-of-concept opencode plugin (`graph-viz` / `session_graph_png`) that builds a
graph of the current session (messages, tool calls, referenced files) and renders it
as a PNG with `pureimage`.

## Module layout

The plugin is deliberately split to isolate responsibilities:

- `src/graph-model.ts` — data model + graph building. Types (`GraphNode`, `GraphEdge`,
  `NodeKind`, `EdgeKind`), `buildGraph()`, `isMessageKind()`. Uses the SDK's `Message`
  and `Part` types; message nodes carry optional metadata (`timeCreated`, `agent`,
  `model`, `tokens`, `error`, `compaction`). No rendering deps.
- `src/graph-theme.ts` — pure visual constants (node/edge colors, font name/size).
- `src/graph-render.ts` — the view. `renderToPng()`, layout/text helpers, font
  registration, `truncateContent()` (150-word cap on node text, `...` marks every
  truncation). Every node draws its type as a top header in the node's kind color
  (so the color coding is self-explanatory). All nodes are rounded rectangles:
  message nodes show header, content, then muted metadata; attached nodes
  (tool/file/subtask) show header + content, wrapping their text at the full
  message width so commands/paths fit on one line. `follows` edges are labeled
  with the time in black text (colors are for nodes, not label text). Error nodes
  render red. Attached nodes are packed into wrapping rows below the parent
  message.
- `src/graph-plugin.ts` — thin entry: `server()` registers the `session_graph_png` tool,
  wiring `buildGraph` → `renderToPng`.

## Source of truth & sync

`src/` is the source of truth. The deployed copies that opencode loads live in
`.opencode/plugins/` and must be kept byte-identical:

```
cp src/graph-model.ts src/graph-theme.ts src/graph-render.ts src/graph-plugin.ts .opencode/plugins/
```

`Roboto-Regular.ttf` lives only in `.opencode/plugins/` (next to the deployed files);
`src/` is for git, not execution. Verify sync with:
`diff -r src .opencode/plugins` (ignore the ttf and test files).

## Node kinds

Messages are classified in `buildGraph`:
- `role === "user"` → `user-message`
- otherwise, has a `text` part → `assistant-response`
- otherwise, has only `reasoning` parts → `reasoning`
- otherwise → `assistant-response` (fallback)

`subtask` parts become their own nodes (content = the subtask `description`), attached
to the parent message by a `causes` edge — the same edge kind tool calls use.

`buildGraph` always captures the **active context**: the last compacted message (the
marker holding the summarized history) and everything after it; if the session has not
been compacted yet, the whole conversation. The marker becomes a `compaction` node;
its content is the summary (`summary.body`/title, or for `summary: true` assistants
the text parts holding the summary).

Colors are kind-based, one distinct color per kind (user=blue, assistant=orange,
reasoning=yellow, tool=cyan, file=purple, subtask=teal, compaction=slate). Any node with
an `error` overrides to red. There is intentionally no `role` field on `GraphNode` — the
kind encodes it.

Metadata on `GraphNode` (message nodes only): `timeCreated` (ms), `agent` (user
messages), `model` (`provider/model` label), `tokens` (input+output+reasoning total),
`error` (error name), `compaction` (a `compaction` part or a `summary` field). There is
no dollar cost — token counts only.

`GraphEdge` carries `timeCreated` (target message time); the renderer appends it to the
`follows` label only.

## Verification

1. Typecheck (from `.opencode/`):
   `bunx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --noImplicitOverride --allowImportingTsExtensions --target ES2022 --module ESNext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node plugins/graph-model.ts plugins/graph-theme.ts plugins/graph-render.ts plugins/graph-plugin.ts`
   (The `import.meta.dir` error in `graph-render.ts` is expected — bun-only, fine at runtime.)
2. Render check: a synthetic `renderToPng` run must yield a valid PNG, width ≤ 321
   (no clipping; the whole canvas is rendered at `SCALE = 2`, so ≤ 642 in pixels),
   taller than wide (one node per row), and one distinct color per kind (user blue,
   assistant orange, compaction slate, error red).
3. Live: invoke the `session_graph_png` tool once.
4. `diff -r` src vs `.opencode/plugins` to confirm sync.

## Code style / review checklist

- 2-space indentation, no semicolons, single quotes for strings... (repo uses double quotes).
- Comments explain the "why", not the "what" — keep them sparse.
- No dead code, no duplicated logic, minimal `any`. Prefer small typed unions over casts.
- Pure functions over side effects; keep the model free of rendering concerns.
- Review passes should run the verification list above and flag only substantive issues;
  style suggestions are advisory, not blockers.

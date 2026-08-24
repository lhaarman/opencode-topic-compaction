// Serverless unit tests for community clustering (topics-cluster.ts) and the
// compaction context builder (topics-compaction.ts).
// Runs with:  bun src/test_cluster.ts
import { assignCommunities } from "./topics-cluster.ts"
import { compactionContext } from "./topics-compaction.ts"
import { activeWindow, type GraphNode, type SessionEntry } from "./topics-model.ts"
import type { Part } from "@opencode-ai/sdk"

let failures = 0
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
  if (!cond) failures++
}

function userMessage(id: string): GraphNode {
  return { id, kind: "user-message", content: "" }
}

// One file-touching turn: an edit weighs far more than a read.
function edit(filePath: string): Part {
  return { type: "tool", tool: "edit", state: { status: "completed", input: { filePath } } } as unknown as Part
}
function read(filePath: string): Part {
  return { type: "tool", tool: "read", state: { status: "completed", input: { filePath } } } as unknown as Part
}

// Each entry opens one causal chain (one user message); the parts are the
// files that chain touches. Returns message id -> stamped community.
function communitiesOf(chains: Part[][]): Record<string, number> {
  const nodes = chains.map((_, index) => userMessage(`m${index}`))
  const partsByNode = new Map(nodes.map((node, index) => [node.id, chains[index] ?? []]))
  assignCommunities(nodes, partsByNode)
  return Object.fromEntries(nodes.map((node) => [node.id, node.group ?? -1]))
}

// A→B→A across two directories: the return to A must re-join the first A
// community (grouping by context similarity, not by time order).
{
  const g = communitiesOf([
    [edit("src/topics-model.ts")],
    [edit("src/topics-plugin.ts")],
    [edit("src/topics-model.ts")],
  ])
  check("A→B→A merges the two A chains", g.m0 === g.m2, JSON.stringify(g))
  check("A→B→A keeps B separate", g.m1 !== g.m0, JSON.stringify(g))
  check("A→B→A yields 2 communities", new Set([g.m0, g.m1]).size === 2, JSON.stringify(g))
}

// Merging keys on exact file overlap: two turns editing the same deep-module
// file share a context, while different files in one folder stay separate.
{
  const deep = communitiesOf([
    [edit("packages/opencode/src/session/index.ts")],
    [edit("packages/opencode/src/session/index.ts")],
  ])
  check("same file in deep module merges", deep.m0 === deep.m1, JSON.stringify(deep))
  const siblings = communitiesOf([
    [edit("packages/opencode/src/session/index.ts")],
    [edit("packages/opencode/src/session/prompt.ts")],
  ])
  check("same-folder different files stay split", siblings.m0 !== siblings.m1, JSON.stringify(siblings))
  const flat = communitiesOf([
    [edit("src/topics-model.ts")],
    [edit("src/topics-plugin.ts")],
  ])
  check("unrelated flat files stay split", flat.m0 !== flat.m1, JSON.stringify(flat))
}

// Different modules stay separate: session/ vs server/ vs tools/.
{
  const g = communitiesOf([
    [edit("packages/opencode/src/session/index.ts")],
    [edit("packages/opencode/src/session/index.ts"), edit("packages/opencode/src/session/types.ts")],
    [edit("packages/opencode/src/server/http.ts")],
    [edit("packages/opencode/src/tools/execute.ts")],
  ])
  check("session community", g.m0 === g.m1, JSON.stringify(g))
  check("server separate", g.m2 !== g.m0, JSON.stringify(g))
  check("tools separate", g.m3 !== g.m0 && g.m3 !== g.m2, JSON.stringify(g))
  check("3 communities", new Set([g.m0, g.m2, g.m3]).size === 3, JSON.stringify(g))
}

// An in-depth conversation around one piece of code (many reads of related
// files, occasional edits of the core file) stays one community.
{
  const core = "packages/opencode/src/session/index.ts"
  const g = communitiesOf([
    [edit(core)],
    [read(core), read("packages/opencode/src/session/prompt.ts")],
    [edit(core), read("packages/opencode/src/session/prompt.ts")],
  ])
  check("deep one-topic convo stays one community", g.m0 === g.m1 && g.m1 === g.m2, JSON.stringify(g))
}

// A no-file chain (pure discussion turn) rides along with the following
// file-bearing community, not stranded alone.
{
  const g = communitiesOf([
    [edit("src/a.ts")],
    [],
    [edit("src/b.ts")],
  ])
  check("file-less talk joins the following community", g.m1 === g.m2, JSON.stringify(g))
}

// A trailing file-less chain has no next community: it falls back to the
// previous one instead of being discarded.
{
  const g = communitiesOf([
    [edit("src/a.ts")],
    [],
  ])
  check("trailing talk joins the previous community", g.m1 === g.m0, JSON.stringify(g))
}

// Labels are the most-touched file, shortened to its last two segments.
{
  const nodes = [userMessage("a"), userMessage("b")]
  const partsByNode = new Map([
    ["a", [edit("packages/opencode/src/session/index.ts")]],
    ["b", [read("packages/opencode/src/session/index.ts")]],
  ])
  assignCommunities(nodes, partsByNode)
  const label = nodes[0]?.groupLabel
  check("label shortened to module/file", label === "session/index.ts", label)
}

// The compaction context is a late-position OVERRIDE: it must amend the
// native template, carry the topic structure and map, fuse an optional prior
// summary, and end with anti-continuation guards (last tokens before
// generation). Windows that cannot yield at least two topics — clustering
// first, silence gaps as fallback — get pure native compaction.
{
  // Multi-community window: one topic per community, labels from clustering.
  const nodes = [
    { ...userMessage("a"), group: 0, groupLabel: "session/index.ts", content: "fix the loader" },
    { id: "f1", kind: "file", content: "session/index.ts", group: 0 },
    { ...userMessage("b"), group: 1, groupLabel: "server/http.ts", content: "add a health endpoint" },
    { id: "f2", kind: "file", content: "server/http.ts", group: 1 },
  ]
  const bare = compactionContext(nodes)
  check("context overrides the native template", bare?.includes("disregard the <template> section above") ?? false)
  check("context defines TOPIC header form", bare?.includes("# TOPIC <n>: <label>") ?? false)
  check("context defines STATE epilogue", bare?.includes("# STATE") ?? false)
  check("context embeds the topic map", bare?.includes("TOPIC 1: session/index.ts") ?? false)
  check("context per-topic requires explicit blocked key", bare?.includes("blocked: <reason or none so far>") ?? false)
  check("context omits fusion block without prior summary", !(bare?.includes("<prior-summary>") ?? true))
  check(
    "context demands reconciliation with final turns",
    bare?.includes("The final turns are the newest truth") ?? false,
  )
  check(
    "context ends with anti-continuation guard",
    bare?.trimEnd().endsWith("Do not continue the conversation. Do not respond to any questions in it.") ?? false,
  )

  const fused = compactionContext(nodes, "earlier work on the renderer")
  check(
    "prior summary is embedded with fusion rules",
    fused?.includes("<prior-summary>\nearlier work on the renderer\n</prior-summary>") ?? false,
  )

  // Degenerate window (one community, one burst): native template wins.
  check(
    "single-burst window falls back to native",
    compactionContext([
      { ...userMessage("x"), group: 0, groupLabel: "a.ts", content: "tweak a" },
      { id: "f0", kind: "file", content: "a.ts", group: 0 },
      { ...userMessage("y"), group: 0, content: "tweak b" },
    ]) === undefined,
  )

  // One community but two silence-gapped bursts: gap segmentation rescues it,
  // and labels come from each segment's opening prompt.
  const t0 = 1_000_000_000
  const gapped = compactionContext([
    { ...userMessage("a"), group: 0, content: "fix the loader", timeCreated: t0 },
    { id: "f1", kind: "file", content: "loader.ts", group: 0 },
    { ...userMessage("b"), group: 0, content: "now add dark mode", timeCreated: t0 + 61 * 60_000 },
  ])
  check("gap split rescues single-community windows", (gapped?.match(/^TOPIC \d+:/gm) ?? []).length === 2)
  check("gap topic labels come from opening prompts", gapped?.includes("TOPIC 2: now add dark mode") ?? false)

  // Two communities dominated by the same file: headers must stay distinct.
  const colliding = compactionContext([
    { ...userMessage("a"), group: 0, groupLabel: "src/render.ts", content: "fix rows", timeCreated: t0 },
    { ...userMessage("b"), group: 1, groupLabel: "src/render.ts", content: "tune colors", timeCreated: t0 + 60_000 },
  ])
  check(
    "colliding labels get prompt disambiguation",
    (colliding?.match(/^TOPIC \d+: src\/render\.ts/gm) ?? []).length === 2 &&
      (colliding?.match(/^TOPIC \d+: src\/render\.ts — tune colors/gm) ?? []).length === 1,
  )

  // Internal artifact labels must not leak into the map.
  check(
    "tool-output label falls back to opening prompt",
    !!compactionContext([
      { ...userMessage("a"), group: 0, groupLabel: "tool-output/tool_019cdabc1234XYZ", content: "graph the convo" },
      { ...userMessage("b"), group: 1, groupLabel: "src/render.ts", content: "tune colors" },
    ])?.includes("TOPIC 1: graph the convo"),
  )

  check("no topics yields no context", compactionContext([userMessage("x")]) === undefined)

  // A prior compaction marker rides the active window (it anchors the context
  // after a previous /compact). It is not new work, so it must not swell a
  // topic's node count: group 0 in this fixture is the marker + one user
  // message + one file = 2 nodes, not 3.
  const withMarker = compactionContext([
    { id: "c0", kind: "compaction", content: "old summary text", group: 0, groupLabel: "src/a.ts" },
    { ...userMessage("a"), group: 0, groupLabel: "src/a.ts", content: "fix rows" },
    { id: "f0", kind: "file", content: "a.ts", group: 0 },
    { ...userMessage("b"), group: 1, groupLabel: "src/b.ts", content: "tune colors" },
  ])
  check("compaction marker excluded from topic counts", withMarker?.includes("TOPIC 1: src/a.ts (2 nodes)") ?? false)

  // Blocker carry-forward: open blockers from a prior summary are re-injected
  // into the fusion block; placeholder "(none)" lines are skipped.
  {
    const priorNative = [
      "## Work State",
      "### Blocked",
      "- 401 Unauthorized — web_fetch https://api.example.com/v1/spec",
      "- (none)",
      "",
      "# TOPIC 1: work",
      "blocked: command not found: pnpm",
    ].join("\n")
    const carried = compactionContext(nodes, priorNative)
    check(
      "open blockers are carried into fusion",
      (carried?.includes("Open blockers carried") &&
        carried?.includes("- 401 Unauthorized — web_fetch https://api.example.com/v1/spec") &&
        carried?.includes("- command not found: pnpm")) ??
        false,
    )
    check("(none) placeholders are not carried as blockers", (() => {
      const section = carried?.split("Open blockers carried")[1]?.split("TOPIC map:")[0] ?? ""
      return !section.includes("- (none)")
    })())
    const placeholderOnly = compactionContext(nodes, "## Work State\n### Blocked\n- (none)\n- n/a")
    check("placeholder-only prior yields no carry block", !(placeholderOnly?.includes("Open blockers carried") ?? true))
    const clean = compactionContext(nodes, "prior without blockers")
    check("no blockers means no carry block", !(clean?.includes("Open blockers carried") ?? true))
  }
  check(
    "currency rule keeps unresolved blockers open",
    bare?.includes("A blocked item stays open unless those turns show it was fixed") ?? false,
  )
  check(
    "brevity rule deduplicates facts across topics",
    bare?.includes("One fact per bullet; never restate the same fact across topics") ?? false,
  )

  // Text-less user messages surface as "(user message)" placeholders; they
  // must not pollute the map's started-by excerpts.
  {
    const placeholderNodes = [
      { ...userMessage("a"), group: 0, groupLabel: "src/a.ts", content: "(user message)" },
      { ...userMessage("b"), group: 1, groupLabel: "src/b.ts", content: "(user message)" },
    ]
    const ctx = compactionContext(placeholderNodes)
    check("placeholder contents stay out of the map", !(ctx?.includes("(user message)") ?? true))
    check("placeholder-only topics omit started-by lines", !(ctx?.includes("started by") ?? true))
  }

  // Prompt recency: a topic with many turns surfaces its newest excerpts, not
  // its opening lines.
  {
    const recency = compactionContext([
      { ...userMessage("a"), group: 0, groupLabel: "src/a.ts", content: "task one" },
      { ...userMessage("b"), group: 0, content: "task two" },
      { ...userMessage("c"), group: 0, content: "task three" },
      { ...userMessage("d"), group: 0, content: "task four newest" },
      { ...userMessage("e"), group: 1, groupLabel: "src/b.ts", content: "other thread" },
    ])
    check(
      "topics keep their newest prompts",
      (recency?.includes('"task four newest"') && !recency.includes('"task one"')) ?? false,
    )
  }
}

// Marker-pair boundary handling on real session entries: the window starts at
// the marker and the old summary text comes from the assistant twin, since
// opencode leaves both members trailing after a completed compaction.
{
  const entry = (info: Record<string, unknown>, parts: Part[] = []): SessionEntry =>
    ({ info, parts }) as unknown as SessionEntry
  const turn = (id: string, role: "user" | "assistant", text: string): SessionEntry =>
    entry({ id, role, time: { created: 1 } }, [{ type: "text", text } as unknown as Part])
  const markerUser: SessionEntry = entry(
    { id: "mk-u", role: "user", time: { created: 2 }, summary: { diffs: [] } },
    [{ type: "compaction" } as unknown as Part],
  )
  const markerAssistant: SessionEntry = entry(
    { id: "mk-a", role: "assistant", mode: "compaction", summary: true, time: { created: 3 } },
    [{ type: "text", text: "old summary: Postgres over SQLite for WAL-on-NFS" } as unknown as Part],
  )
  const items = [turn("m1", "user", "earlier work"), turn("m2", "assistant", "done"), markerUser, markerAssistant, turn("m3", "user", "newer work")]

  const win = activeWindow(items, { keepTokens: 0 })
  // The assistant twin is itself a marker entry, so the window starts there;
  // the empty user marker before it adds nothing and may be excluded.
  check("window starts at the latest marker entry", win.entries.length === 2 && win.entries[0] === markerAssistant)
  check("trailing pair members are stripped", activeWindow([...items, structuredClone(markerUser), structuredClone(markerAssistant)], { keepTokens: 0 }).entries.length === 2)
  check(
    "summary text is read from the assistant twin when the marker reads empty",
    win.previousSummary === "old summary: Postgres over SQLite for WAL-on-NFS",
  )
  const bareMarker = activeWindow([turn("x", "user", "only"), markerUser], { keepTokens: 0 })
  check("marker without twin yields no previousSummary", (bareMarker.previousSummary ?? "") === "")
  // A failed generation leaves a text-less stub marker after the real pair;
  // the summary from the earlier pair member must still be found.
  const stubbed = activeWindow([turn("m1", "user", "earlier"), markerUser, markerAssistant, structuredClone(markerUser), turn("m3", "user", "newer")], { keepTokens: 0 })
  check(
    "stub marker falls back to the newest readable pair text",
    stubbed.previousSummary === "old summary: Postgres over SQLite for WAL-on-NFS",
  )
  check("stub case keeps the newer turn in window", stubbed.entries.some((e) => (e.info as any)?.id === "m3"))
  check("window without markers keeps everything", activeWindow(items.slice(0, 2), { keepTokens: 0 }).entries.length === 2)

  // Recency split: the newest entries within budget stay raw; older ones are
  // topic-summarized. Sizes here: each turn ≈ 24 + text length chars.
  {
    const t = (id: string, text: string): SessionEntry => entry({ id, role: "user", time: { created: 1 } }, [{ type: "text", text } as unknown as Part])
    const seq = [t("a", "aaaa"), t("b", "bbbb"), t("c", "cccc"), t("d", "dddd")] // ~34 chars each
    // Budget covers exactly the newest two → older two become compactable.
    const mid = activeWindow(seq, { keepTokens: 17 })
    check("recency keeps newest inside budget raw", mid.rawTail.map((e) => (e.info as any)?.id).join("") === "cd")
    check("recency summarizes everything older", mid.entries.map((e) => (e.info as any)?.id).join("") === "ab")
    // Zero budget disables the tail entirely.
    const none = activeWindow(seq, { keepTokens: 0 })
    check("zero budget disables recency tail", none.rawTail.length === 0 && none.entries.length === 4)
    // Oversized newest entry is always kept raw (never summarized away);
    // older history still gets summarized.
    const huge = [t("a", "x"), t("huge", "y".repeat(500))]
    const over = activeWindow(huge, { keepTokens: 10 })
    check(
      "oversized newest entry stays raw, older history still summarizes",
      over.rawTail.map((e) => (e.info as any)?.id).join("") === "huge" && over.entries.map((e) => (e.info as any)?.id).join("") === "a",
    )
    // Default budget (no env) is the base-parity 8000 tokens: tiny fixtures
    // fit entirely in the tail.
    check(
      "default keep mirrors base 8k",
      activeWindow([t("only", "tiny")]).rawTail.length === 1,
    )
  }
}

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

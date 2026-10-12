// Data model for the session graph: turns opencode session messages into nodes and edges
import path from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import { assignCommunities } from "./topics-cluster.ts"

export type NodeKind = "user-message" | "assistant-response" | "reasoning" | "tool_call" | "file" | "subtask" | "compaction"
export type EdgeKind = "follows" | "causes" | "references"

export type GraphNode = {
  id: string
  kind: NodeKind
  content: string
  timeCreated?: number
  agent?: string
  model?: string
  tokens?: number
  error?: string
  compaction?: boolean
  // Message nodes are also assigned groups for clustering
  group?: number
  groupLabel?: string
}

export type GraphEdge = { source: string; target: string; kind: EdgeKind; timeCreated?: number }

export type SessionEntry = { info?: Message; parts?: Part[] }

// Where the session entries came from: the V2 session `context` — the window
// the model actually sees (the prior compaction summary plus everything after).
export type FetchStats = { source: "context"; count: number }

// Minimal shape of the V2 session domain this model depends on. The plugin
// passes its own context; keeping it structural avoids importing client types.
export type MessageSource = {
  context: (input: { sessionID: string }) => Promise<unknown[]>
}

// Recency split, mirroring opencode's own compaction budget: the newest
// KEEP_RECENT tokens stay raw (base carries them forward outside the
// summary), and only older history is topic-summarized. Mirroring the exact
// default (8000) and estimator (chars/4) keeps our summarizable region
// aligned with what the native prompt actually contains. When
// GRAPH_CONTEXT_TOKENS declares a smaller model window, the tail shrinks to
// 40% of it so summaries still fit comfortably alongside the raw tail.
const BASE_KEEP_TOKENS = 8000
const KEEP_CONTEXT_FRACTION = 0.4
function keepRecentTokens(): number {
  const ctx = Number(process.env.GRAPH_CONTEXT_TOKENS ?? 0)
  if (!ctx || ctx <= 0) return BASE_KEEP_TOKENS
  return Math.min(BASE_KEEP_TOKENS, Math.floor(KEEP_CONTEXT_FRACTION * ctx))
}

// Rough entry size in characters, approximating opencode's serializer: all
// text plus tool inputs/results with long results capped (their serializer
// truncates at 2000 chars). Only used for the recency budget, so precision
// beyond this level doesn't matter — it just has to behave like theirs.
function entrySize(entry: SessionEntry): number {
  let n = 24 // role/timestamp/metadata framing
  for (const part of entry.parts ?? []) {
    if (part.type === "text") n += (part.text ?? "").length
    else if (part.type === "reasoning") n += (part.text ?? "").length
    else if (part.type === "tool") {
      // V2 stores tool results under `output`; V1 used `content`. Count whichever is present.
      const state = part.state as { input?: unknown; content?: unknown; output?: unknown }
      n += JSON.stringify(state?.input ?? {}).length
      n += Math.min(JSON.stringify(state?.output ?? state?.content ?? "").length, 2000)
    } else n += 64
  }
  return n
}

// Content fallback for message nodes with no readable text (text-less turns).
// Parenthesized so consumers can recognize it as synthetic, not user words —
// e.g. compaction's excerpt filter skips such contents when building topic maps.
const PLACEHOLDER_CONTENT = "(no content)"

// Multiple node kinds can depict a message
const MESSAGE_KINDS: readonly NodeKind[] = ["user-message", "assistant-response", "reasoning", "compaction"]

// Determine whether node depicts a message
export function isMessageKind(kind: NodeKind): boolean {
  return MESSAGE_KINDS.includes(kind)
}

// Resolve the best filesystem path for a file part
function filePathFromPart(part: Part & { type: "file" }): string {
  // If file has source path, return
  if (typeof part.source?.path === "string") return part.source.path
  // If file has url, slice url before return
  if (typeof part.url === "string" && part.url.startsWith("file://")) return part.url.slice(7)
  // Else return filename if exists
  return part.filename ?? ""
}

// Whether a message is the compaction marker holding the summarized history
function isCompaction(info: Message | undefined, parts: Part[]): boolean {
  // The reliable marker is a `compaction` part
  if (parts.some((part) => part.type === "compaction")) return true
  const summary = info?.summary
  // If info marked as summary also return true
  if (summary === true) return true
  // If summary is of type object and title or body is non-empty string also return true
  if (summary && typeof summary === "object") {
    // Summary can also contain key 'diffs' we do not mark those as compaction and can be found in every message
    if (typeof summary.title === "string" && summary.title.length > 0) return true
    if (typeof summary.body === "string" && summary.body.length > 0) return true
  }
  return false
}

// One V2 message: the shape returned by the session `context` endpoint (see
// `SessionMessageInfo`). Only the fields this model reads are typed.
type V2ToolState = { status?: string; input?: unknown; content?: unknown; output?: unknown; error?: unknown }
type V2Part = { type?: string; text?: string; id?: string; name?: string; state?: V2ToolState }
type V2Message = {
  type?: string
  id?: string
  time?: { created?: number }
  text?: string
  agent?: string
  model?: { id?: string; providerID?: string }
  content?: V2Part[]
  summary?: string
  files?: Array<{ path?: string; filename?: string }>
  error?: { type?: string }
}

// Map a V2 assistant content part onto the model's Part shape. V2 names the
// tool under `name` (not `tool`) and its args under `state.input`; read/edit/
// write target `path` where the clustering expects `filePath`.
function toPart(part: V2Part): Part | undefined {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" } as Part
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" } as Part
    case "tool": {
      const rawInput = part.state?.input
      const input: Record<string, unknown> = rawInput && typeof rawInput === "object" ? { ...(rawInput as Record<string, unknown>) } : {}
      if (typeof input.filePath !== "string" && typeof input.path === "string") input.filePath = input.path
      return {
        type: "tool",
        tool: part.name,
        callID: part.id,
        state: { status: part.state?.status, input, content: part.state?.content, output: part.state?.output, error: part.state?.error },
      } as unknown as Part
    }
    default:
      return undefined
  }
}

// Map one V2 message onto the model's {info, parts} shape. V2 folds the
// compaction marker and its summary into a single `compaction` record, and
// stores assistant output as `content` parts on the message.
function toSessionEntry(raw: unknown): SessionEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const msg = raw as V2Message
  switch (msg.type) {
    case "user":
    case "synthetic": {
      const parts: Part[] = []
      if (typeof msg.text === "string" && msg.text) parts.push({ type: "text", text: msg.text } as Part)
      for (const file of msg.files ?? []) {
        const filePath = file?.path ?? file?.filename
        if (typeof filePath === "string" && filePath) parts.push({ type: "file", source: { path: filePath } } as unknown as Part)
      }
      const info = {
        role: "user",
        id: msg.id,
        time: msg.time,
        agent: msg.agent,
        // V2 labels the model with `id`; the model reads `modelID`.
        model: msg.model ? { providerID: msg.model.providerID, modelID: msg.model.id } : undefined,
      } as unknown as Message
      return { info, parts }
    }
    case "assistant": {
      const parts = (msg.content ?? []).map(toPart).filter((part): part is Part => part !== undefined)
      const info = {
        role: "assistant",
        id: msg.id,
        time: msg.time,
        agent: msg.agent,
        providerID: msg.model?.providerID,
        modelID: msg.model?.id,
        error: msg.error ? { name: msg.error.type } : undefined,
      } as unknown as Message
      return { info, parts }
    }
    case "compaction": {
      // Marker + summary live on one record; expose it as a compaction entry so
      // the boundary scan finds it and previousSummary can read its body.
      const info = {
        role: "user",
        id: msg.id,
        time: msg.time,
        summary: typeof msg.summary === "string" && msg.summary ? { title: "", body: msg.summary } : undefined,
      } as unknown as Message
      return { info, parts: [{ type: "compaction" } as Part] }
    }
    default:
      return undefined
  }
}

// Fetch the session's model-visible window via the V2 `context` endpoint:
// the prior compaction summary (if any) followed by the turns since it. That
// is exactly the transcript the compaction is about to summarize.
async function fetchSessionEntries(source: MessageSource, sessionID: string): Promise<SessionEntry[]> {
  const data = await source.context({ sessionID })
  if (!Array.isArray(data)) return []
  return data.map(toSessionEntry).filter((entry): entry is SessionEntry => entry !== undefined)
}

// The session's active window: everything after the most recent compaction
// boundary, plus the old summary that boundary carries. opencode's marker
// pair — a user message carrying the compaction part, then the assistant
// summary — stays on the session forever; strip trailing pair members so
// post-compaction replays (post-compaction replays, second rounds) don't collapse
// to the markers alone. The old summary TEXT lives on the assistant member
// (`summary: true` + text parts), not on the user marker, so when the marker
// itself reads empty the adjacent assistant entry is consulted.
export function activeWindow(items: SessionEntry[], opts?: { keepTokens?: number }): { entries: SessionEntry[]; rawTail: SessionEntry[]; previousSummary?: string } {
  let scanEnd = items.length
  while (scanEnd > 0 && isCompaction(items[scanEnd - 1]?.info, items[scanEnd - 1]?.parts ?? [])) scanEnd -= 1
  let lastCompaction = -1
  for (let i = 0; i < scanEnd; i++) {
    if (isCompaction(items[i]?.info, items[i]?.parts ?? [])) lastCompaction = i
  }
  // scanEnd bounds the window: without it, slice(lastCompaction) would
  // re-include the very trailing markers the loop above just removed.
  if (lastCompaction < 0) return { ...splitRecency(items.slice(0, scanEnd), opts?.keepTokens ?? keepRecentTokens()), previousSummary: undefined }
  const entries = items.slice(lastCompaction, scanEnd)
  // The newest marker may be a text-less stub (failed generations leave the
  // user member behind with no summary anywhere), or carry its text on an
  // adjacent pair member; walk back over contiguous marker entries until a
  // readable summary turns up.
  let previousSummary: string | undefined
  for (let i = lastCompaction; i >= 0; i--) {
    const e = items[i]
    if (!e || !isCompaction(e.info, e.parts ?? [])) break
    previousSummary = summaryText(e.info, e.parts ?? [])
    if (previousSummary) break
  }
  // NOTE: destructure directly into named locals via an intermediate — a
  // combined `const { a, b } = f(...)` here once miscompiled under bun.
  const sr = splitRecency(entries, opts?.keepTokens ?? keepRecentTokens())
  return { entries: sr.entries, rawTail: sr.rawTail, previousSummary: previousSummary || undefined }
}

// Recency split inside an already-bounded window: walk backward from the
// newest entry until the raw-tail token budget is spent; everything older is
// topic-summarized, everything newer stays verbatim (base carries it outside
// the summary). The newest entry is always kept even when oversized (a giant
// final turn must never be silently summarized away); a window smaller than
// the budget yields nothing to summarize, which downstream means clean
// yield-to-native. budgetTokens=0 disables the tail entirely.
function splitRecency(entries: SessionEntry[], budgetTokens: number): { entries: SessionEntry[]; rawTail: SessionEntry[] } {
  if (budgetTokens <= 0 || entries.length === 0) return { entries, rawTail: [] }
  const budget = budgetTokens * 4 // budget is in tokens; sizes are chars
  let acc = 0
  let start = entries.length
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    const size = entrySize(e)
    if (start < entries.length && acc + size > budget) break
    acc += size
    start = i
    if (acc >= budget) break
  }
  return { entries: entries.slice(0, start), rawTail: entries.slice(start) }
}

// Fetch the session, reduce it to the active context, and build graph.
export async function buildGraph(source: MessageSource, sessionID: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: number; fetch: FetchStats; previousSummary?: string }> {
  const entries = await fetchSessionEntries(source, sessionID)

  // The store may hand back rows unordered; restore chronological
  // order so the compaction-boundary scan and edge chaining stay correct.
  const items = entries
    .map((entry, index) => ({ entry, index, time: entry.info?.time?.created ?? 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((item) => item.entry)

  // Capture only the active context: the last compacted message (if exists)
  // and everything after it, plus the summary that boundary carries.
  const { entries: activeContext, previousSummary } = activeWindow(items)

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const files = new Map<string, string>()
  let prevMsgId: string | undefined
  const partsByNode = new Map<string, Part[]>()

  for (let i = 0; i < activeContext.length; i++) {
    const entry = activeContext[i]
    if (!entry) continue
    const info = entry.info
    const role = info?.role ?? "unknown"
    const msgID = String(info?.id ?? `msg-${i}`)

    // CONSTRUCT NODE
    // Append the index so ids stay unique even if message ids repeat.
    const nodeId = `${msgID}-${i}`

    const parts = entry.parts ?? []
    partsByNode.set(nodeId, parts)
    const compaction = isCompaction(info, parts)
    const kind = compaction ? "compaction" : classifyMessageKind(role, parts)
    const node: GraphNode = {
      id: nodeId,
      kind,
      content: compaction ? compactionContent(info, parts) : messageContent(kind, parts),
      timeCreated: info?.time?.created,
      agent: info?.role === "user" ? info.agent : undefined,
      model: modelLabel(info),
      tokens: tokenTotal(info),
      error: info?.role === "assistant" ? info.error?.name : undefined,
      compaction,
    }
    nodes.push(node)

    // Add edge from previous message to current
    if (prevMsgId) edges.push({ source: prevMsgId, target: nodeId, kind: "follows", timeCreated: node.timeCreated })
    // Update previous message
    prevMsgId = nodeId

    for (const part of parts) {
      if (part.type === "tool") {
        const toolNodeId = `tool-${part.callID ?? part.tool}-${i}`
        nodes.push({
          id: toolNodeId,
          kind: "tool_call",
          content: toolContent(part),
          error: part.state.status === "error" ? part.state.error : undefined,
        })
        edges.push({ source: nodeId, target: toolNodeId, kind: "causes", timeCreated: node.timeCreated })
      } else if (part.type === "file") {
        const filePath = filePathFromPart(part)
        if (!filePath) continue
        if (!files.has(filePath)) {
          const fileNodeId = `file-${filePath}`
          files.set(filePath, fileNodeId)
          nodes.push({ id: fileNodeId, kind: "file", content: path.basename(filePath) })
        }
        edges.push({ source: nodeId, target: files.get(filePath)!, kind: "references", timeCreated: node.timeCreated })
      } else if (part.type === "subtask") {
        const subtaskNodeId = `subtask-${part.id ?? i}-${i}`
        nodes.push({ id: subtaskNodeId, kind: "subtask", content: part.description })
        edges.push({ source: nodeId, target: subtaskNodeId, kind: "causes", timeCreated: node.timeCreated })
      }
    }
  }

  // Assign communities to graph
  const communities = assignCommunities(nodes, partsByNode)
  return { nodes, edges, communities, fetch: { source: "context", count: items.length }, previousSummary }
}

// Map a message's role and parts to a node kind: user messages are
// user-message, assistants with only reasoning become reasoning nodes, and
// everything else falls back to assistant-response.
function classifyMessageKind(role: string, parts: Part[]): NodeKind {
  if (role === "user") return "user-message"
  const hasText = parts.some((part) => part.type === "text")
  if (!hasText && parts.some((part) => part.type === "reasoning")) return "reasoning"
  return "assistant-response"
}

// The summarized history carried by a compaction marker: the user's
// title/body fields, or for `summary: true` assistants the text parts that
// hold the summary. Undefined when the marker carries no readable summary.
function summaryText(info: Message | undefined, parts: Part[]): string | undefined {
  const summary = info?.summary
  if (summary && typeof summary === "object" && "body" in summary) {
    return [summary.title, summary.body].filter(Boolean).join("\n") || undefined
  }
  if (summary === true) {
    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (text) return text
  }
  return undefined
}

// Build the display text for a compaction node.
function compactionContent(info: Message | undefined, parts: Part[]): string {
  return summaryText(info, parts) ?? "(compaction)"
}

// Label for a tool-call node. The bare tool name ("bash") is ambiguous, so
// annotate it with what the tool actually did: the command that was run, the
// file it touched, or for grep the pattern plus the plain words it searches
// for (regex is opaque to non-experts). The tool name is kept on its own line;
// the context goes on the next.
function toolContent(part: Extract<Part, { type: "tool" }>): string {
  const input = part.state.input ?? {}
  const name = part.tool
  switch (name) {
    case "bash":
    case "shell": {
      const cmd = input.command
      if (typeof cmd === "string" && cmd.trim()) return `${name}\n${cmd}`
      break
    }
    case "edit":
    case "write":
    case "read": {
      const filePath = input.filePath
      if (typeof filePath === "string" && filePath) return `${name}\n${filePath}`
      break
    }
    case "grep": {
      const pattern = input.pattern
      if (typeof pattern === "string" && pattern.trim()) {
        const desc = grepDescription(pattern)
        return desc ? `grep\n${pattern} — ${desc}` : `grep\n${pattern}`
      }
      break
    }
    case "question": {
      const question = input.question
      if (typeof question === "string" && question.trim()) return `question\n${question}`
      break
    }
  }
  return name
}

// Turn a regex grep pattern into a short human-readable list of the literal
// words it targets (used by toolContent for the node label).
function grepDescription(pattern: string): string {
  // Strip regex syntax and list the literal words it targets:
  // "metadata|nodes|edges" -> "metadata, nodes, edges".
  const tokens = pattern
    .split(/[|()[\]{}^$*+?.\\/="<>:;,-\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && /^[\w]+$/.test(token))
  const uniq = [...new Set(tokens)]
  const desc = uniq.slice(0, 4).join(", ")
  return desc && desc !== pattern.trim() ? desc : ""
}

// Build the text shown inside a message node: joined text parts, the reasoning
// for reasoning-only messages, or a fallback listing the tools/files it used.
function messageContent(kind: NodeKind, parts: Part[]): string {
  const text = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
  if (text) return text

  if (kind === "reasoning") {
    return parts
      .filter((part): part is Extract<Part, { type: "reasoning" }> => part.type === "reasoning")
      .map((part) => part.text)
      .join("\n")
      .trim()
  }

  // Fallback listing tools/files when a message has no text.
  const extra: string[] = []
  for (const part of parts) {
    if (part.type === "tool") {
      extra.push(`tool: ${part.tool}`)
    } else if (part.type === "file") {
      const filePath = filePathFromPart(part)
      if (filePath) extra.push(`file: ${filePath}`)
    }
  }
  return extra.length > 0 ? extra.join("\n") : PLACEHOLDER_CONTENT
}

// The "provider/model" label shown in a message node's metadata.
function modelLabel(info: Message | undefined): string | undefined {
  if (!info) return undefined
  if (info.role === "assistant") {
    if (typeof info.providerID === "string" && typeof info.modelID === "string") {
      return `${info.providerID}/${info.modelID}`
    }
    return undefined
  }
  if (info.role === "user") {
    const model = info.model
    if (model && typeof model.providerID === "string" && typeof model.modelID === "string") {
      return `${model.providerID}/${model.modelID}`
    }
  }
  return undefined
}

// Total token count (input + output + reasoning) for an assistant message,
// used as node metadata. Undefined when there's nothing to report.
function tokenTotal(info: Message | undefined): number | undefined {
  if (!info || info.role !== "assistant") return undefined
  const { input = 0, output = 0, reasoning = 0 } = (info.tokens ?? {}) as { input?: number; output?: number; reasoning?: number }
  const total = input + output + reasoning
  return total > 0 ? total : undefined
}

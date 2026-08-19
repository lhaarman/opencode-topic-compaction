// Data model for the session graph: turns opencode session messages into
// graph nodes and edges. No rendering logic lives here.
import path from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"

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
}
export type GraphEdge = { source: string; target: string; kind: EdgeKind; timeCreated?: number }

type SessionEntry = { info?: Message; parts?: Part[] }


// Map NodeKind to labels
const KIND_LABELS: Record<NodeKind, string> = {
  "user-message": "user message",
  "assistant-response": "assistant response",
  "reasoning": "reasoning",
  "tool_call": "tool call",
  "file": "file",
  "subtask": "subtask",
  "compaction": "compaction",
}

// True for kinds that represent a whole message (rather than a thing attached
// to one); used by the renderer to decide which nodes get the full message box.
export function isMessageKind(kind: NodeKind): boolean {
  return kind === "user-message" || kind === "assistant-response" || kind === "reasoning" || kind === "compaction"
}

// Resolve the best filesystem path for a file part: the source path when the
// SDK gives one, a file:// URL when it only links to one, otherwise the bare
// filename as a last resort.
function filePathFromPart(p: Part & { type: "file" }): string {
  if (typeof p.source?.path === "string") return p.source.path
  if (typeof p.url === "string" && p.url.startsWith("file://")) return p.url.slice(7)
  return p.filename ?? ""
}

// Whether a message is the compaction marker holding the summarized history.
function itemCompaction(info: Message | undefined, parts: Part[]): boolean {
  // The reliable marker is a `compaction` part; opencode also marks the
  // synthetic summary messages (`summary: true` on assistants, a real
  // title/body on users). A bare `summary: { diffs: [] }` appears on every
  // user message and is NOT a compaction marker.
  if (parts.some((p) => p.type === "compaction")) return true
  const s = info?.summary
  if (s === true) return true
  if (s && typeof s === "object") {
    if (typeof s.title === "string" && s.title.length > 0) return true
    if (typeof s.body === "string" && s.body.length > 0) return true
  }
  return false
}

// Fetch the session, reduce it to the active context, and turn every message
// into a node plus edges. Tool calls and subtasks get attached "causes" nodes,
// files get shared "references" nodes, consecutive messages are chained with
// "follows" edges.
export async function buildGraph(client: PluginInput["client"], sessionID: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // Each session message has a role (user/assistant) and a list of parts
  // (text, reasoning, tool calls, files, subtasks, ...). We turn every message
  // into a node and attach tool/file/subtask nodes to it, linking consecutive
  // messages with "follows" edges.
  const res = await client.session.messages({ path: { id: sessionID } })
  const items = (res?.data ?? []) as SessionEntry[]

  // Capture only the active context: the last compacted message (the marker
  // holding the summarized history) and everything after it. No compaction in
  // the session yet means the whole conversation is active.
  let lastCompaction = -1
  for (let i = 0; i < items.length; i++) {
    if (itemCompaction(items[i]?.info, items[i]?.parts ?? [])) lastCompaction = i
  }
  const active = lastCompaction >= 0 ? items.slice(lastCompaction) : items

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const files = new Map<string, string>()
  let prevMsgId: string | undefined

  for (let i = 0; i < active.length; i++) {
    const entry = active[i]
    if (!entry) continue
    const info = entry.info
    const role = info?.role ?? "unknown"
    const msgID = String(info?.id ?? `msg-${i}`)
    // Append the index so ids stay unique even if message ids repeat.
    const nodeId = `${msgID}-${i}`

    const parts = entry.parts ?? []
    const compaction = itemCompaction(info, parts)
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
    if (prevMsgId) edges.push({ source: prevMsgId, target: nodeId, kind: "follows", timeCreated: node.timeCreated })
    prevMsgId = nodeId

    for (const p of parts) {
      if (p.type === "tool") {
        const toolNodeId = `tool-${p.callID ?? p.tool}-${i}`
        nodes.push({
          id: toolNodeId,
          kind: "tool_call",
          content: toolContent(p),
          error: p.state.status === "error" ? p.state.error : undefined,
        })
        edges.push({ source: nodeId, target: toolNodeId, kind: "causes", timeCreated: node.timeCreated })
      } else if (p.type === "file") {
        const fp = filePathFromPart(p)
        if (!fp) continue
        if (!files.has(fp)) {
          const fileNodeId = `file-${fp}`
          files.set(fp, fileNodeId)
          nodes.push({ id: fileNodeId, kind: "file", content: path.basename(fp) })
        }
        edges.push({ source: nodeId, target: files.get(fp)!, kind: "references", timeCreated: node.timeCreated })
      } else if (p.type === "subtask") {
        const subtaskNodeId = `subtask-${p.id ?? i}-${i}`
        nodes.push({ id: subtaskNodeId, kind: "subtask", content: p.description })
        edges.push({ source: nodeId, target: subtaskNodeId, kind: "causes", timeCreated: node.timeCreated })
      }
    }
  }

  return { nodes, edges }
}

// Map a message's role and parts to a node kind: user messages are
// user-message, assistants with only reasoning become reasoning nodes, and
// everything else falls back to assistant-response.
function classifyMessageKind(role: string, parts: Part[]): NodeKind {
  if (role === "user") return "user-message"
  const hasText = parts.some((p) => p.type === "text")
  if (!hasText && parts.some((p) => p.type === "reasoning")) return "reasoning"
  return "assistant-response"
}

// Build the display text for a compaction node: the user's title/body summary,
// or for `summary: true` assistants the text parts that hold the summary.
function compactionContent(info: Message | undefined, parts: Part[]): string {
  if (!info) return "(compaction)"
  const summary = info.summary
  if (summary && typeof summary === "object" && "body" in summary) {
    return [summary.title, summary.body].filter(Boolean).join("\n")
  }
  // The assistant compaction summary (`summary: true`) carries its text in the
  // message's text parts, not on the info.summary field.
  if (summary === true) {
    const text = parts
      .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim()
    if (text) return text
  }
  return "(compaction)"
}

// Label for a tool-call node. The bare tool name ("bash") is ambiguous, so
// annotate it with what the tool actually did: the command that was run, the
// file it touched, or for grep the pattern plus the plain words it searches
// for (regex is opaque to non-experts). The tool name is kept on its own line;
// the context goes on the next.
function toolContent(p: Extract<Part, { type: "tool" }>): string {
  const input = p.state.input ?? {}
  const name = p.tool
  switch (name) {
    case "bash": {
      const cmd = input.command
      if (typeof cmd === "string" && cmd.trim()) return `bash\n${cmd}`
      break
    }
    case "edit":
    case "write":
    case "read": {
      const fp = input.filePath
      if (typeof fp === "string" && fp) return `${name}\n${fp}`
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
      const q = input.question
      if (typeof q === "string" && q.trim()) return `question\n${q}`
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
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && /^[\w]+$/.test(t))
  const uniq = [...new Set(tokens)]
  const desc = uniq.slice(0, 4).join(", ")
  return desc && desc !== pattern.trim() ? desc : ""
}

// Build the text shown inside a message node: joined text parts, the reasoning
// for reasoning-only messages, or a fallback listing the tools/files it used.
function messageContent(kind: NodeKind, parts: Part[]): string {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim()
  if (text) return text

  if (kind === "reasoning") {
    return parts
      .filter((p): p is Extract<Part, { type: "reasoning" }> => p.type === "reasoning")
      .map((p) => p.text)
      .join("\n")
      .trim()
  }

  // Fallback listing tools/files when a message has no text.
  const extra: string[] = []
  for (const p of parts) {
    if (p.type === "tool") {
      extra.push(`tool: ${p.tool}`)
    } else if (p.type === "file") {
      const fp = filePathFromPart(p)
      if (fp) extra.push(`file: ${fp}`)
    }
  }
  return extra.length > 0 ? extra.join("\n") : `(${KIND_LABELS[kind]})`
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
  if (info.role === "user") return `${info.model.providerID}/${info.model.modelID}`
  return undefined
}

// Total token count (input + output + reasoning) for an assistant message,
// used as node metadata. Undefined when there's nothing to report.
function tokenTotal(info: Message | undefined): number | undefined {
  if (!info || info.role !== "assistant") return undefined
  const { input = 0, output = 0, reasoning = 0 } = info.tokens
  const total = input + output + reasoning
  return total > 0 ? total : undefined
}
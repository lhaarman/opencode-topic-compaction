// Data model for the session graph: turns opencode session messages into nodes and edges
import path from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"
import { assignCommunities } from "./graph-cluster.ts"

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

// Fetch the session, reduce it to the active context, and build graph.
export async function buildGraph(client: PluginInput["client"], sessionID: string, workspace?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; communities: number }> {
  // Retrieve messages from client session by ID
  const res = await client.session.messages({ path: { id: sessionID } })
  // cast to SessionEntry to ease manipulation
  const items = (res?.data ?? []) as SessionEntry[]

  // Capture only the active context: the last compacted message (if exists) and everything after it
  let lastCompaction = -1
  for (let i = 0; i < items.length; i++) {
    if (isCompaction(items[i]?.info, items[i]?.parts ?? [])) lastCompaction = i
  }
  // grab active context
  const activeContext = lastCompaction >= 0 ? items.slice(lastCompaction) : items

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
  const communities = assignCommunities(nodes, partsByNode, items, workspace)
  return { nodes, edges, communities }
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
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
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
function toolContent(part: Extract<Part, { type: "tool" }>): string {
  const input = part.state.input ?? {}
  const name = part.tool
  switch (name) {
    case "bash": {
      const cmd = input.command
      if (typeof cmd === "string" && cmd.trim()) return `bash\n${cmd}`
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
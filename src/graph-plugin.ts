import path from "node:path"
import { mkdir, writeFile, appendFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const LOG_FILE = process.env.GRAPH_POC_LOG_FILE ?? "/tmp/opencode/graph_poc.log"

async function log(stage: string, message: string, data?: Record<string, unknown>) {
    await mkdir(path.dirname(LOG_FILE), { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, message, ...data }) + "\n"
    await appendFile(LOG_FILE, line)
}

// Local branded IDs. @opencode-ai/core is not resolvable from an external plugin's
// file location (the loader uses a plain dynamic import), so we brand locally instead.
export type NodeId = string & { readonly __brand: "NodeId" }
export const NodeId = (v: string): NodeId => v as NodeId
export type EdgeId = string & { readonly __brand: "EdgeId" }
export const EdgeId = (v: string): EdgeId => v as EdgeId
export type GraphId = string & { readonly __brand: "GraphId" }
export const GraphId = (v: string): GraphId => v as GraphId

type NodeKind = "message" | "tool_call" | "file" | "command" | "note"
type EdgeKind = "references" | "causes" | "part_of" | "follows"

export type GraphNode = { id: NodeId; kind: NodeKind; label: string }
export type GraphEdge = { id: EdgeId; source: NodeId; target: NodeId; kind: EdgeKind }
export type Graph = { id: GraphId; nodes: Map<NodeId, GraphNode>; edges: Map<EdgeId, GraphEdge> }

// Latest graph per session, kept in memory for the process lifetime.
const graphs = new Map<string, Graph>()

type MessageItem = { info?: { role?: string; id?: string }; parts?: Array<Record<string, any>> }

async function buildGraph(client: PluginInput["client"], sessionID: string): Promise<Graph> {
    const res = await client.session.messages({ path: { id: sessionID } })
    const items = (res?.data ?? []) as MessageItem[]
    await log("fetch", "fetched messages", { sessionID, count: items.length })

    const graph: Graph = { id: GraphId(`graph-${sessionID}`), nodes: new Map(), edges: new Map() }
    const files = new Map<string, NodeId>()

    const addNode = (id: string, kind: NodeKind, label: string): NodeId => {
        const nid = NodeId(id)
        if (!graph.nodes.has(nid)) graph.nodes.set(nid, { id: nid, kind, label })
            return nid
    }
    const addEdge = (source: NodeId, target: NodeId, kind: EdgeKind, key: string): void => {
        const eid = EdgeId(key)
        if (!graph.edges.has(eid)) graph.edges.set(eid, { id: eid, source, target, kind })
    }

    let prevMsg: NodeId | undefined
    for (const [i, item] of items.entries()) {
        const info = item.info ?? {}
        const role = typeof info.role === "string" ? info.role : "unknown"
        const msgID = String(info.id ?? `idx-${i}`)
        await log("message", "processed", { id: msgID, role })

        let label = `${role} message`
        for (const p of item.parts ?? []) {
            if (p?.type === "text" && typeof p.text === "string") {
                label = truncate(p.text)
                break
            }
        }
        const msgNode = addNode(`msg-${msgID}`, "message", label)

        if (prevMsg) addEdge(prevMsg, msgNode, "follows", `follows-${i}`)
            prevMsg = msgNode

            for (const p of item.parts ?? []) {
                if (!p || typeof p !== "object") continue
                    const partID = String(p.id ?? `${msgID}-${i}`)
                    if (p.type === "tool" && typeof p.tool === "string") {
                        const callID = String(p.callID ?? partID)
                        const toolNode = addNode(`tool-${callID}`, "tool_call", `tool: ${p.tool}`)
                        addEdge(msgNode, toolNode, "causes", `cause-${msgID}-${callID}`)
                    } else if (p.type === "file") {
                        const filePath = filePartPath(p)
                        if (!filePath) continue
                            let fileNode = files.get(filePath)
                            if (!fileNode) {
                                fileNode = addNode(`file-${filePath}`, "file", filePath)
                                files.set(filePath, fileNode)
                            }
                            addEdge(msgNode, fileNode, "references", `ref-${msgID}-${partID}`)
                    }
            }
    }

    return graph
}

function filePartPath(p: Record<string, any>): string | undefined {
    if (p.source && typeof p.source.path === "string") return p.source.path
        if (typeof p.filename === "string" && p.filename) return p.filename
            if (typeof p.url === "string" && p.url.startsWith("file://")) return p.url.slice(7)
                return undefined
}

function truncate(s: string, n = 80): string {
    const t = s.replace(/\s+/g, " ").trim()
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function graphToJson(g: Graph): string {
    return JSON.stringify({ id: g.id, nodes: [...g.nodes.values()], edges: [...g.edges.values()] }, null, 2)
}

export default {
    id: "graph-poc",
    server: async (input: PluginInput): Promise<Hooks> => {
        const client = input.client
        const directory = input.directory
        return {
            tool: {
                session_graph: tool({
                    description:
                    "Build an in-memory graph of this session (messages, tool calls, files touched) and export it as JSON to disk.",
                                    args: {},
                                    execute: async (_args, context) => {
                                        const sessionID = context.sessionID
                                        await log("tool", "session_graph started", { sessionID })
                                        const graph = await buildGraph(client, sessionID)
                                        graphs.set(sessionID, graph)
                                        await log("graph", "built", { nodes: graph.nodes.size, edges: graph.edges.size })

                                        const outDir = path.join(directory, "graph-poc")
                                        await mkdir(outDir, { recursive: true })
                                        const outPath = path.join(outDir, `${sessionID}.json`)
                                        await writeFile(outPath, graphToJson(graph), "utf8")
                                        await log("export", "wrote json", { path: outPath })

                                        return `Built session graph for ${sessionID}: ${graph.nodes.size} nodes, ${graph.edges.size} edges. Exported to ${outPath}`
                                    },
                }),
            },
        }
    },
}

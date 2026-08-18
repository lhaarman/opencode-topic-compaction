import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { Writable } from "node:stream"
import * as PureImage from "pureimage"
import { tool } from "@opencode-ai/plugin"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

type NodeKind = "message" | "tool_call" | "file" | "compaction"
type EdgeKind = "follows" | "causes" | "references" | "part_of"

export type GraphNode = { id: string; kind: NodeKind; content: string }
export type GraphEdge = { source: string; target: string; kind: EdgeKind }

const FILL_COLORS: Record<NodeKind, string> = {
    message: "#dbeafe",
    tool_call: "#ffedd5",
    file: "#f3e8ff",
    compaction: "#334155",
}
const BORDER_COLORS: Record<NodeKind, string> = {
    message: "#2563eb",
    tool_call: "#ea580c",
    file: "#9333ea",
    compaction: "#0f172a",
}
const EDGE_COLORS: Record<EdgeKind, string> = {
    follows: "#94a3b8",
    causes: "#f59e0b",
    references: "#a855f7",
    part_of: "#cbd5e1",
}
const TEXT_COLOR = "#1e293b"
const FONT_NAME = "Roboto"
const FONT_SIZE = 11

const font = PureImage.registerFont(path.join(import.meta.dir, "Roboto-Regular.ttf"), FONT_NAME)
font.loadSync()

type Pos = { x: number; y: number; r: number }

function wrapText(ctx: PureImage.Context, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ""
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (ctx.measureText(candidate).width <= maxWidth) {
            line = candidate
        } else {
            if (line) lines.push(line)
                line = word
        }
    }
    if (line) lines.push(line)
        return lines.length > 0 ? lines : [text]
}

function computeRadius(ctx: PureImage.Context, text: string): number {
    const targetW = 190
    const lh = 14
    const lines = wrapText(ctx, text, targetW)
    const maxLineW = Math.min(targetW, Math.max(...lines.map((l) => ctx.measureText(l).width)))
    const h = lines.length * lh
    const r = Math.max(26, Math.ceil(Math.hypot(maxLineW / 2 + 8, h / 2 + 8)))
    return Math.min(r, 120)
}

function pointOnCircleEdge(px: number, py: number, tx: number, ty: number, r: number): { x: number; y: number } {
    const dx = tx - px
    const dy = ty - py
    const dist = Math.hypot(dx, dy) || 1
    return { x: px + (dx / dist) * r, y: py + (dy / dist) * r }
}

function truncateLines(lines: string[], maxLines: number): string[] {
    if (lines.length <= maxLines) return lines
        const kept = lines.slice(0, maxLines)
        kept[maxLines - 1] = kept[maxLines - 1] + "…"
        return kept
}

export async function renderToPng(nodes: GraphNode[], edges: GraphEdge[]): Promise<Buffer> {
    const scratch = PureImage.make(10, 10)
    const measure = scratch.getContext("2d")
    measure.font = `${FONT_SIZE}px ${FONT_NAME}`

    const msgNodes = nodes.filter((n) => n.kind === "message" || n.kind === "compaction")
    const attached = nodes.filter((n) => n.kind !== "message" && n.kind !== "compaction")
    const pos = new Map<string, Pos>()

    const margin = 40
    const gap = 30
    const maxWidth = Math.min(1700, Math.max(900, msgNodes.length * 260))
    let cursorX = margin
    let cursorY = margin
    let rowBottom = 0
    let maxRight = margin

    for (const n of msgNodes) {
        const r = computeRadius(measure, n.content)
        if (cursorX + r + gap > maxWidth) {
            cursorY = rowBottom + gap
            cursorX = margin
        }
        pos.set(n.id, { x: cursorX + r, y: cursorY + r, r })
        cursorX += 2 * r + gap
        rowBottom = Math.max(rowBottom, cursorY + 2 * r)
        maxRight = Math.max(maxRight, cursorX)
    }

    for (const a of attached) {
        const edge = edges.find((e) => e.target === a.id)
        const parent = edge ? pos.get(edge.source) : undefined
        if (!parent) continue
            const r = 16
            pos.set(a.id, { x: parent.x, y: parent.y + parent.r + r + 24, r })
            rowBottom = Math.max(rowBottom, parent.y + parent.r + 2 * r + 30)
    }

    const width = Math.max(margin * 2, maxRight)
    const height = Math.max(margin * 2, rowBottom + margin)

    const canvas = PureImage.make(width, height)
    const ctx = canvas.getContext("2d")

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)

    ctx.lineWidth = 1.5
    ctx.font = `9px ${FONT_NAME}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    for (const e of edges) {
        const s = pos.get(e.source)
        const t = pos.get(e.target)
        if (!s || !t) continue
            const p1 = pointOnCircleEdge(s.x, s.y, t.x, t.y, s.r)
            const p2 = pointOnCircleEdge(t.x, t.y, s.x, s.y, t.r)
            ctx.strokeStyle = EDGE_COLORS[e.kind] || "#94a3b8"
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()

            const label = e.kind
            const mx = (p1.x + p2.x) / 2
            const my = (p1.y + p2.y) / 2
            const labelW = ctx.measureText(label).width
            const boxH = 11
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(mx - labelW / 2 - 3, my - boxH / 2, labelW + 6, boxH)
            ctx.fillStyle = EDGE_COLORS[e.kind] || "#94a3b8"
            ctx.fillText(label, mx, my)
    }

    ctx.font = `${FONT_SIZE}px ${FONT_NAME}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    for (const n of nodes) {
        const p = pos.get(n.id)
        if (!p) continue

            ctx.fillStyle = BORDER_COLORS[n.kind] || "#64748b"
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI)
            ctx.fill()

            ctx.fillStyle = FILL_COLORS[n.kind] || "#e2e8f0"
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.r - 3, 0, 2 * Math.PI)
            ctx.fill()

            ctx.fillStyle = n.kind === "compaction" ? "#f8fafc" : TEXT_COLOR
            const innerW = (p.r - 12) * 2
            const maxLines = Math.max(2, Math.floor(((p.r - 10) * 2) / 14))
            const lines = truncateLines(wrapText(ctx, n.content, innerW), maxLines)
            const lh = 14
            const startY = p.y - ((lines.length - 1) * lh) / 2
            lines.forEach((line, i) => ctx.fillText(line, p.x, startY + i * lh))
    }

    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const sink = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(Buffer.from(chunk))
                cb()
            },
        })
        PureImage.encodePNGToStream(canvas, sink)
        .then(() => resolve(Buffer.concat(chunks)))
        .catch(reject)
    })
}

async function buildGraph(client: PluginInput["client"], sessionID: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const res = await client.session.messages({ path: { id: sessionID } })
    const items = (res?.data ?? []) as Array<{
        info?: { role?: string; id?: string; parentID?: string; summary?: boolean }
        parts?: any[]
    }>

    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const files = new Map<string, string>()

    const isCompaction = (item: (typeof items)[number]) =>
    item.parts?.some((p: any) => p?.type === "compaction" && p.tail_start_id !== undefined)
    const compactionIndex = items.findLastIndex(isCompaction)
    const hasCompaction = compactionIndex >= 0

    let tailStartId: string | undefined
    let summaryText = ""
    if (hasCompaction) {
        const compactionPart = items[compactionIndex].parts?.find(
            (p: any) => p?.type === "compaction" && p.tail_start_id !== undefined,
        )
        tailStartId = compactionPart?.tail_start_id as string | undefined
        const summaryAssistant = items
        .slice(compactionIndex + 1)
        .find((item) => item.info?.role === "assistant" && item.info?.summary === true)
        summaryText = (summaryAssistant?.parts ?? [])
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("\n")
        .trim()
    }
    const tailIndex = tailStartId ? items.findIndex((item) => item.info?.id === tailStartId) : -1

    const summaryNode: GraphNode | undefined = hasCompaction
    ? { id: "compaction-root", kind: "compaction", content: summaryText || "(compacted context)" }
    : undefined

    const skip = new Set<number>()
    if (hasCompaction) skip.add(compactionIndex)
        if (hasCompaction) {
            const summaryIndex = items.findIndex(
                (item, i) => i > compactionIndex && item.info?.role === "assistant" && item.info?.summary === true,
            )
            if (summaryIndex > compactionIndex) skip.add(summaryIndex)
        }
        const start = hasCompaction ? (tailIndex >= 0 ? tailIndex : 0) : 0
        let prevMsgId: string | undefined = summaryNode?.id

        for (let i = start; i < items.length; i++) {
            if (skip.has(i)) continue
                const item = items[i]
                const info = item.info ?? {}
                const role = typeof info.role === "string" ? info.role : "unknown"
                const msgID = String(info.id ?? `msg-${i}`)
                const nodeId = `${msgID}-${i}`

                const parts = item.parts ?? []
                const text = parts
                .filter((p: any) => p?.type === "text" && typeof p.text === "string")
                .map((p: any) => p.text)
                .join("\n")
                .trim()

                const extra: string[] = []
                for (const p of parts) {
                    if (p?.type === "tool" && typeof p.tool === "string") {
                        extra.push(`tool: ${p.tool}`)
                    } else if (p?.type === "file") {
                        let fp = p.filename ?? ""
                        if (typeof p.source?.path === "string") fp = p.source.path
                            else if (typeof p.url === "string" && p.url.startsWith("file://")) fp = p.url.slice(7)
                                if (fp) extra.push(`file: ${fp}`)
                    }
                }
                const content = text || (extra.length > 0 ? extra.join("\n") : `(${role} message)`)

                nodes.push({ id: nodeId, kind: "message", content })
                if (prevMsgId) edges.push({ source: prevMsgId, target: nodeId, kind: "follows" })
                    prevMsgId = nodeId

                    for (const p of parts) {
                        if (p?.type === "tool" && typeof p.tool === "string") {
                            const toolNodeId = `tool-${p.callID ?? p.tool}-${i}`
                            nodes.push({ id: toolNodeId, kind: "tool_call", content: p.tool })
                            edges.push({ source: nodeId, target: toolNodeId, kind: "causes" })
                        } else if (p?.type === "file") {
                            let fp = p.filename ?? ""
                            if (typeof p.source?.path === "string") fp = p.source.path
                                else if (typeof p.url === "string" && p.url.startsWith("file://")) fp = p.url.slice(7)
                                    if (!fp) continue
                                        if (!files.has(fp)) {
                                            const fileNodeId = `file-${fp}`
                                            files.set(fp, fileNodeId)
                                            nodes.push({ id: fileNodeId, kind: "file", content: path.basename(fp) })
                                        }
                                        edges.push({ source: nodeId, target: files.get(fp)!, kind: "references" })
                        }
                    }
        }

        if (summaryNode) nodes.unshift(summaryNode)

            return { nodes, edges }
}

async function server(input: PluginInput): Promise<Hooks> {
    const client = input.client
    const directory = input.directory

    return {
        tool: {
            session_graph_png: tool({
                description: "Build a graph of the current session (messages as nodes with their content, plus tool calls and files) and render it as a PNG image.",
                                    args: {},
                                    execute: async (_args, ctx) => {
                                        const sessionID = ctx.sessionID
                                        const { nodes, edges } = await buildGraph(client, sessionID)
                                        const png = await renderToPng(nodes, edges)

                                        const outDir = path.join(directory, "graph-poc")
                                        await mkdir(outDir, { recursive: true })
                                        const outPath = path.join(outDir, `${sessionID}.png`)
                                        await writeFile(outPath, png)

                                        const b64 = png.toString("base64")
                                        return {
                                            title: "Session Graph",
                                            output: `![Session graph ${sessionID}](data:image/png;base64,${b64})\n\nPNG saved to \`${outPath}\``,
                                    metadata: { nodes: nodes.length, edges: edges.length },
                                        } as const
                                    },
            }),
        },
    }
}

export default {
    id: "graph-viz",
    server,
}

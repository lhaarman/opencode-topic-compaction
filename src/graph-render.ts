// Renders a graph (model) to a PNG image. Depends only on the model and theme;
// it never talks to the opencode client.
import path from "node:path"
import { Writable } from "node:stream"
import * as PureImage from "pureimage"
import type { GraphNode, GraphEdge, NodeKind } from "./graph-model.ts"
import { isMessageKind } from "./graph-model.ts"
import {
  FILL_COLORS,
  BORDER_COLORS,
  EDGE_COLORS,
  ERROR_FILL,
  ERROR_BORDER,
  TEXT_COLOR,
  META_COLOR,
  FONT_NAME,
  FONT_SIZE,
  META_FONT_SIZE,
} from "./graph-theme.ts"

// Long message text is cut short so nodes stay readable and reasonably small.
// 150 words is enough to identify a message without the node becoming huge.
const MAX_CONTENT_WORDS = 150

// The whole render is scaled up by this factor so the PNG is crisp when zoomed
// in. Everything (fonts, padding, radii, spacing) scales linearly; rendering is
// for debugging so the extra cost is acceptable.
const SCALE = 2

// Message nodes are rounded rectangles sized to their content + metadata. The
// canvas width is driven by the widest message and stays under 321 (in base
// pixels) so the image fits opencode's panel without clipping.
const MAX_TEXT_W = 205 * SCALE
const PAD_X = 16 * SCALE
const PAD_Y = 12 * SCALE
const CONTENT_LH = 14 * SCALE
const META_LH = 11 * SCALE
const MARGIN = 40 * SCALE
const FONT_PX = FONT_SIZE * SCALE
const META_PX = META_FONT_SIZE * SCALE

// Node type label drawn as a header at the top of every node, in the node's
// kind color, so the color coding is self-explanatory.
const KIND_LABELS: Record<NodeKind, string> = {
  "user-message": "user",
  "assistant-response": "assistant",
  reasoning: "reasoning",
  tool_call: "tool",
  file: "file",
  subtask: "subtask",
  compaction: "compaction",
}
const HEADER_LH = 11 * SCALE
const HEADER_GAP = 3 * SCALE

// Attached nodes (tools, files, subtasks) are rounded rectangles like messages,
// sized to their text. Their text wraps at the full message width, so commands
// and paths fit on one line; multi-line only happens when a line is longer than
// the widest message. Rows wrap so a group always fits the available width.
const ATTACH_GAP = 10 * SCALE
const ATTACH_ROW_GAP = 14 * SCALE
const ATTACH_FIRST_GAP = 29 * SCALE

// pureimage needs a registered font to measure and draw text. The .ttf must
// live next to the deployed plugin file.
const font = PureImage.registerFont(path.join(import.meta.dir, "Roboto-Regular.ttf"), FONT_NAME)
font.loadSync()

type Pos = { x: number; y: number; w: number; h: number }

export function truncateContent(text: string): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= MAX_CONTENT_WORDS) return text
  return words.slice(0, MAX_CONTENT_WORDS).join(" ") + "..."
}

function headerLabel(node: GraphNode): string {
  return (KIND_LABELS[node.kind] ?? node.kind).toUpperCase()
}

function wrapText(ctx: PureImage.Context, text: string, maxWidth: number): string[] {
  // Explicit newlines are hard breaks (tool content is "name\ncontext"); other
  // whitespace soft-wraps.
  const lines: string[] = []
  for (const seg of text.split("\n")) {
    const words = seg.split(/\s+/).filter(Boolean)
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
  }
  return lines.length > 0 ? lines : [text]
}

// Ellipsize a single line that still exceeds the width (e.g. a very long word).
function fitLine(ctx: PureImage.Context, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + "...").width > maxWidth) s = s.slice(0, -1)
  return s + "..."
}

function truncateLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1] ?? ""
  kept[maxLines - 1] = last + "..."
  return kept
}

function formatTime(ms?: number): string {
  if (!ms) return ""
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`
}

// The metadata block: content first, then the quieter metadata lines below.
// Message times live on the incoming "follows" edge label, so the node only
// repeats it for compaction markers (which also anchor the active window).
function metadataTexts(node: GraphNode): string[] {
  const out: string[] = []
  if (node.timeCreated && node.kind === "compaction") out.push(formatTime(node.timeCreated))
  if (node.agent) out.push(`agent: ${node.agent}`)
  if (node.model) out.push(`model: ${node.model}`)
  if (node.tokens !== undefined) out.push(formatTokens(node.tokens))
  if (node.compaction) out.push("compacted")
  if (node.error) out.push(`error: ${node.error}`)
  return out
}

function metadataLines(ctx: PureImage.Context, node: GraphNode, innerW: number): { text: string; color: string }[] {
  return metadataTexts(node)
    .map((text) => ({ text: fitLine(ctx, wrapText(ctx, text, innerW).join(" "), innerW), color: META_COLOR }))
    .filter((p) => p.text.length > 0)
}

// Node text width: the widest of content, header and metadata. The node is
// sized so none of its text gets truncated; only lines wider than MAX_TEXT_W
// (single unbreakable tokens) fall back to "..." .
function sizeMessageNode(ctx: PureImage.Context, node: GraphNode): { w: number; h: number; lines: string[]; meta: { text: string; color: string }[] } {
  const contentText = truncateContent(node.content)
  const wrapped = wrapText(ctx, contentText, MAX_TEXT_W)
  const contentW = Math.max(...wrapped.map((l) => ctx.measureText(l).width))
  const headerW = ctx.measureText(headerLabel(node)).width
  const metaW = metadataTexts(node).length > 0 ? Math.max(...metadataTexts(node).map((t) => ctx.measureText(t).width)) : 0
  const innerW = Math.min(MAX_TEXT_W, Math.max(80, contentW, headerW, metaW))
  const lines = truncateLines(wrapped.map((l) => fitLine(ctx, l, innerW)), 25)
  const meta = metadataLines(ctx, node, innerW)
  const h = PAD_Y * 2 + HEADER_LH + HEADER_GAP + lines.length * CONTENT_LH + (meta.length > 0 ? 3 + meta.length * META_LH : 0)
  return { w: innerW + PAD_X * 2, h, lines, meta }
}

// Attached node (tool/file/subtask) sized like a message: header + content.
// Text wraps at the full available message width so it normally fits on one
// line; the returned lines are reused by the draw pass so sizing == drawing.
function sizeAttachNode(ctx: PureImage.Context, node: GraphNode, maxInnerW: number): { w: number; h: number; lines: string[] } {
  const text = truncateContent(node.content)
  const label = headerLabel(node)
  const wrapped = wrapText(ctx, text, maxInnerW).map((l) => fitLine(ctx, l, maxInnerW))
  const maxLineW = Math.min(maxInnerW, Math.max(ctx.measureText(label).width, ...wrapped.map((l) => ctx.measureText(l).width)))
  const innerW = Math.max(70, maxLineW)
  const lines = truncateLines(wrapped.map((l) => fitLine(ctx, l, innerW)), 25)
  const h = PAD_Y * 2 + HEADER_LH + HEADER_GAP + lines.length * CONTENT_LH
  return { w: innerW + PAD_X * 2, h, lines }
}

function rectBorderPoint(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - cx
  const dy = ty - cy
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const t = Math.min(Math.abs(hw / (ux || 1e-9)), Math.abs(hh / (uy || 1e-9)))
  return { x: cx + ux * t, y: cy + uy * t }
}

function borderPoint(p: Pos, tx: number, ty: number): { x: number; y: number } {
  return rectBorderPoint(p.x, p.y, p.w / 2, p.h / 2, tx, ty)
}

function edgeLabel(e: GraphEdge): string {
  if (e.kind === "follows") {
    const time = formatTime(e.timeCreated)
    return time ? `follows ${time}` : "follows"
  }
  return e.kind
}

type SizedNode = { lines: string[]; meta?: { text: string; color: string }[] }

// Draw one node as a rounded rectangle: kind-colored border/fill, a header with
// the kind label, then the content lines (optionally a muted metadata block).
function drawNodeRect(ctx: PureImage.Context, n: GraphNode, p: Pos, s: SizedNode, withMeta: boolean): void {
  const fill = n.error ? ERROR_FILL : FILL_COLORS[n.kind] || "#e2e8f0"
  const border = n.error ? ERROR_BORDER : BORDER_COLORS[n.kind] || "#64748b"
  const x0 = p.x - p.w / 2
  const y0 = p.y - p.h / 2

  ctx.fillStyle = border
  ctx.beginPath()
  ctx.roundRect(x0, y0, p.w, p.h, 10 * SCALE)
  ctx.fill()

  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(x0 + 3 * SCALE, y0 + 3 * SCALE, p.w - 6 * SCALE, p.h - 6 * SCALE, 8 * SCALE)
  ctx.fill()

  ctx.font = `${META_PX}px ${FONT_NAME}`
  ctx.fillStyle = border
  ctx.fillText(headerLabel(n), p.x, y0 + PAD_Y + HEADER_LH / 2)

  let ty = y0 + PAD_Y + HEADER_LH + HEADER_GAP + CONTENT_LH / 2
  ctx.font = `${FONT_PX}px ${FONT_NAME}`
  ctx.fillStyle = TEXT_COLOR
  for (const line of s.lines) {
    ctx.fillText(line, p.x, ty)
    ty += CONTENT_LH
  }
  if (withMeta && s.meta && s.meta.length > 0) {
    ty += 3 * SCALE
    ctx.font = `${META_PX}px ${FONT_NAME}`
    for (const m of s.meta) {
      ctx.fillStyle = m.color
      ctx.fillText(m.text, p.x, ty)
      ty += META_LH
    }
  }
}

export async function renderToPng(nodes: GraphNode[], edges: GraphEdge[]): Promise<Buffer> {
  // Scratch canvas: we only need its context to measure text before drawing.
  const scratch = PureImage.make(10, 10)
  const measure = scratch.getContext("2d")
  measure.font = `${FONT_PX}px ${FONT_NAME}`

  // Layout: every message gets its own row, centered horizontally. Tool calls,
  // files and subtasks are smaller rounded rectangles sitting side-by-side below
  // their parent message. Canvas width is driven by the widest message so nothing
  // clips; attached text reuses that width so it fits on one line.
  const msgNodes = nodes.filter((n) => isMessageKind(n.kind))
  const attached = nodes.filter((n) => !isMessageKind(n.kind))
  const pos = new Map<string, Pos>()

  const byParent = new Map<string, GraphNode[]>()
  for (const a of attached) {
    const edge = edges.find((e) => e.target === a.id)
    if (!edge || !msgNodes.some((n) => n.id === edge.source)) continue
    const list = byParent.get(edge.source) ?? []
    list.push(a)
    byParent.set(edge.source, list)
  }
  const sizes = msgNodes.map((n) => sizeMessageNode(measure, n))
  const maxW = sizes.length > 0 ? Math.max(...sizes.map((s) => s.w)) : 160
  const width = Math.max(MARGIN * 2, maxW + MARGIN * 2)
  const availW = width - 2 * MARGIN

  // Size every attached node once (wrapping at the full message width), then
  // pack each parent's group into rows that fit the available width.
  type AttachedRow = { items: GraphNode[]; wmax: number; hmax: number; yOff: number }
  const attachSizes = new Map<string, { w: number; h: number; lines: string[] }>()
  for (const list of byParent.values()) {
    for (const a of list) attachSizes.set(a.id, sizeAttachNode(measure, a, availW - 2 * PAD_X))
  }
  const attachLayout = new Map<string, AttachedRow[]>()
  const attachedBottom = new Map<string, number>()
  for (const [parentId, list] of byParent) {
    const rows: AttachedRow[] = []
    let row: AttachedRow = { items: [], wmax: 0, hmax: 0, yOff: 0 }
    let rowW = 0
    for (const a of list) {
      const w = attachSizes.get(a.id)!.w
      const need = rowW === 0 ? w : rowW + ATTACH_GAP + w
      if (rowW > 0 && need > availW) {
        rows.push(row)
        row = { items: [], wmax: 0, hmax: 0, yOff: 0 }
        rowW = 0
      }
      row.items.push(a)
      row.wmax = Math.max(row.wmax, w)
      row.hmax = Math.max(row.hmax, attachSizes.get(a.id)!.h)
      rowW += rowW === 0 ? w : ATTACH_GAP + w
    }
    rows.push(row)
    // Center offset of each row below the parent's bottom edge.
    let cy = ATTACH_FIRST_GAP
    for (const r of rows) {
      r.yOff = cy + r.hmax / 2
      cy += r.hmax + ATTACH_ROW_GAP
    }
    attachLayout.set(parentId, rows)
    const last = rows[rows.length - 1]!
    attachedBottom.set(parentId, last.yOff + last.hmax / 2)
  }

  const gap = 36
  let cursorY = MARGIN
  for (let i = 0; i < msgNodes.length; i++) {
    const n = msgNodes[i]
    if (!n) continue
    const s = sizes[i]!
    const h = s.h
    pos.set(n.id, { x: width / 2, y: cursorY + h / 2, w: s.w, h })
    // Reserve the full height of any attached group below this row.
    cursorY += h + (attachedBottom.get(n.id) ?? 0) + gap
  }

  for (const [parentId, rows] of attachLayout) {
    const parent = pos.get(parentId)
    if (!parent) continue
    for (const row of rows) {
      const totalW = row.items.reduce((acc, a) => acc + attachSizes.get(a.id)!.w + ATTACH_GAP, 0) - ATTACH_GAP
      const y = parent.y + parent.h / 2 + row.yOff
      let x = parent.x - totalW / 2
      for (const a of row.items) {
        const s = attachSizes.get(a.id)!
        pos.set(a.id, { x: x + s.w / 2, y, w: s.w, h: s.h })
        x += s.w + ATTACH_GAP
      }
    }
  }

  let maxY = 0
  for (const p of pos.values()) maxY = Math.max(maxY, p.y + p.h / 2)
  const height = maxY + MARGIN

  const canvas = PureImage.make(width, height)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)

  ctx.lineWidth = 1.5 * SCALE
  ctx.font = `${META_PX}px ${FONT_NAME}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  for (const e of edges) {
    const s = pos.get(e.source)
    const t = pos.get(e.target)
    if (!s || !t) continue
    const p1 = borderPoint(s, t.x, t.y)
    const p2 = borderPoint(t, s.x, s.y)
    ctx.strokeStyle = EDGE_COLORS[e.kind] || "#94a3b8"
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()

    const label = edgeLabel(e)
    const mx = (p1.x + p2.x) / 2
    const my = (p1.y + p2.y) / 2
    const labelW = ctx.measureText(label).width
    const boxH = META_LH
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(mx - labelW / 2 - 3 * SCALE, my - boxH / 2, labelW + 6 * SCALE, boxH)
    ctx.fillStyle = TEXT_COLOR
    ctx.fillText(label, mx, my)
  }

  for (const n of msgNodes) {
    const p = pos.get(n.id)
    if (!p) continue
    drawNodeRect(ctx, n, p, sizes[msgNodes.indexOf(n)]!, true)
  }

  for (const n of attached) {
    const p = pos.get(n.id)
    if (!p) continue
    drawNodeRect(ctx, n, p, attachSizes.get(n.id)!, false)
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
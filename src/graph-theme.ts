// Visual constants for the graph: node/edge colors and the font. No logic here.
import type { NodeKind, EdgeKind } from "./graph-model.ts"

// One distinct color per node kind. Errors override with red, regardless of kind.
export const FILL_COLORS: Record<NodeKind, string> = {
  "user-message": "#dbeafe",
  "assistant-response": "#ffedd5",
  reasoning: "#fef9c3",
  tool_call: "#cffafe",
  file: "#f3e8ff",
  subtask: "#ccfbf1",
  compaction: "#e2e8f0",
}

export const BORDER_COLORS: Record<NodeKind, string> = {
  "user-message": "#2563eb",
  "assistant-response": "#ea580c",
  reasoning: "#ca8a04",
  tool_call: "#0891b2",
  file: "#9333ea",
  subtask: "#0d9488",
  compaction: "#475569",
}

export const EDGE_COLORS: Record<EdgeKind, string> = {
  follows: "#94a3b8",
  causes: "#f59e0b",
  references: "#a855f7",
}

export const ERROR_FILL = "#fee2e2"
export const ERROR_BORDER = "#dc2626"

export const TEXT_COLOR = "#1e293b"
export const META_COLOR = "#64748b"
export const FONT_NAME = "Roboto"
export const FONT_SIZE = 11
export const META_FONT_SIZE = 9
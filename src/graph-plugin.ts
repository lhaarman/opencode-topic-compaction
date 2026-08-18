// Plugin entry: registers the session_graph_png tool. All real logic lives in
// the model (graph-model.ts) and the renderer (graph-render.ts).
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { buildGraph } from "./graph-model.ts"
import { renderToPng } from "./graph-render.ts"

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
  id: "graph-plugin",
  server,
}
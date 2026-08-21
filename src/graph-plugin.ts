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
        description: "Build a graph of the current session (messages as nodes with their content, plus tool calls and files), render it to a PNG saved in graph-poc/, and report the graph summary (node/edge/community counts).",
        args: {},
        execute: async (_args, ctx) => {
          const sessionID = ctx.sessionID
          const { nodes, edges, communities } = await buildGraph(client, sessionID, directory)
          const png = await renderToPng(nodes, edges)

          const outDir = path.join(directory, "graph-poc")
          await mkdir(outDir, { recursive: true })
          const outPath = path.join(outDir, `${sessionID}.png`)
          await writeFile(outPath, png)

          return {
            title: "Session Graph",
            output: `Session graph: ${nodes.length} nodes, ${edges.length} edges, ${communities} communities. PNG saved to \`${outPath}\``,
            metadata: { nodes: nodes.length, edges: edges.length, communities: communities},
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
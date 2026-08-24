// Plugin entry: topic-structured compaction via the compacting hook.
// Real logic lives in topics-model.ts (model), topics-cluster.ts
// (communities) and topics-compaction.ts (compaction prompt).
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { buildGraph } from "./topics-model.ts"
import { compactionContext } from "./topics-compaction.ts"

async function server(input: PluginInput): Promise<Hooks> {
  const client = input.client
  const directory = input.directory

  return {
    "experimental.session.compacting": async (input, output) => {
      // Append our topic-structured OVERRIDE as hook context: it lands after
      // opencode's whole compaction prompt (last word wins), while the native
      // flow keeps the history first inside <conversation>. Replacing via
      // output.prompt would move instructions before a raw appended history
      // and the model continues the conversation instead of summarizing.
      // If anything here fails, native compaction proceeds untouched.
      try {
        const result = await buildGraph(client, input.sessionID, directory)
        const context = compactionContext(result.nodes, result.previousSummary)
        if (context) output.context.push(context)
      } catch {
        // fall back to opencode's default compaction
      }
    },
  }
}

export default {
  id: "opencode-topic-compaction",
  server,
}

// Plugin entry: topic-structured compaction via the compaction hook.
// Real logic lives in topics-model.ts (model), topics-cluster.ts
// (communities) and topics-compaction.ts (summarization prompt).
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { buildGraph } from "./topics-model.ts"
import { compactionContext } from "./topics-compaction.ts"

// Verification aid: every load and every compaction decision is appended here,
// so the plugin's behavior is observable instead of silent. opencode does not
// fold plugin stderr into its own log, hence a dedicated file.
// Tail it with: tail -f ~/.local/share/opencode/log/topic-compaction.log
const LOG_PATH = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "opencode",
  "log",
  "topic-compaction.log",
)

function log(line: string): void {
  const entry = `${new Date().toISOString()} ${line}\n`
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    appendFileSync(LOG_PATH, entry)
  } catch {
    // logging is best-effort; never let it break compaction
  }
}

// Cap tool output in the transcript, mirroring opencode's own serializer.
const MAX_RESULT_CHARS = 2000

// Flatten one content part of opencode's compaction transcript to plain text.
function partText(part: Record<string, unknown>): string {
  switch (part.type) {
    case "text":
    case "reasoning":
    case "compaction":
      return typeof part.text === "string" ? part.text : ""
    case "tool-call":
      return `[tool: ${String(part.name ?? "?")} ${JSON.stringify(part.input ?? {})}]`
    case "tool-result": {
      const result = part.result as { type?: string; value?: unknown } | undefined
      let value = ""
      if (result?.type === "content" && Array.isArray(result.value)) {
        value = (result.value as Array<{ text?: string }>).map((item) => item.text ?? "").join("")
      } else if (result?.value !== undefined) {
        value = typeof result.value === "string" ? result.value : JSON.stringify(result.value)
      }
      const clipped = value.length > MAX_RESULT_CHARS ? `${value.slice(0, MAX_RESULT_CHARS)}…` : value
      return `[tool result: ${String(part.name ?? "?")}] ${clipped}`
    }
    default:
      return ""
  }
}

// Serialize opencode's compaction transcript into the plain text our prompt
// carries inside <conversation>. Dropped parts (media, effort) leave no trace.
function serializeTranscript(messages: readonly unknown[]): string {
  const lines: string[] = []
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown[] }
    const parts = Array.isArray(message.content) ? message.content : []
    const body = parts
      .map((part) => partText((part ?? {}) as Record<string, unknown>))
      .filter((text) => text.trim().length > 0)
      .join("\n")
    if (body) lines.push(`${message.role ?? "message"}: ${body}`)
  }
  return lines.join("\n\n")
}

export default Plugin.define({
  id: "topic-compaction",
  async setup(ctx) {
    log(`loaded (dir=${ctx.location.directory})`)
    await ctx.session.hook("compaction", async (event) => {
      // V2 rejects a summary that lacks its native section headings, so when
      // the topics warrant it we own the compaction: generate the summary
      // ourselves and hand it over via `result` (opencode stores it as-is and
      // skips its own model call and template check). Below two topics, or on
      // any error, we set nothing and native compaction runs untouched.
      log(`${event.sessionID}: hook fired`)
      try {
        const graph = await buildGraph(ctx.session, event.sessionID)
        let topics = 0
        const instructions = compactionContext(graph.nodes, graph.previousSummary, (count) => {
          topics = count
        })
        if (!instructions) {
          log(`${event.sessionID}: ${topics} topic(s) → yielding to native template`)
          return
        }

        const transcript = serializeTranscript(event.messages)
        const prompt = `<conversation>\n${transcript}\n</conversation>\n\n${instructions}`
        const generation = await ctx.generate.text({ model: event.model, prompt })
        const summary = generation?.text?.trim()
        if (!summary) {
          log(
            `${event.sessionID}: ${topics} topics → empty generation, yielding to native template ` +
              `(model=${JSON.stringify(event.model)} promptLen=${prompt.length} result=${JSON.stringify(generation).slice(0, 300)})`,
          )
          return
        }
        event.result = { summary }
        log(`${event.sessionID}: ${topics} topics → topic summary generated (${summary.length} chars)`)
      } catch (error) {
        log(`${event.sessionID}: error → native template (${String(error)})`)
      }
    })
  },
})

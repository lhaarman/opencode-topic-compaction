// Community-aware compaction support. When opencode compacts a session, we
// append a late-position OVERRIDE to its compaction prompt (via the
// experimental.session.compacting hook) so the model summarizes per community
// instead of blurring everything into one linear stream. The core flow stays
// untouched: one LLM call, one genuine compaction marker — so auto-compaction
// behaves exactly as before.
import { isMessageKind, type GraphNode } from "./topics-model.ts"

const MAX_PROMPTS_PER_TOPIC = 3
const PROMPT_EXCERPT = 80
const LABEL_EXCERPT = 40
// Silence longer than this between consecutive messages marks a topic shift
// when clustering degenerates to a single community.
const GAP_MS = 10 * 60 * 1000
const MAX_TOPICS = 12
// Cap per-topic file lists and prior-summary embedding to keep the prompt
// compact; large priors are the main cause of length-limit compaction
// failures observed with x-preview-f-free (input 218k + huge prior).
const MAX_FILES_PER_TOPIC = 5
const MAX_PRIOR_CHARS = 3000
const MAX_CARRIED_BLOCKERS = 5

type Topic = { label: string; count: number; prompts: string[]; files: string[] }

// Opening-prompt excerpt for the map. Text-less messages carry placeholder
// contents like "(no content)" (see messageContent's fallback); those are
// not prompts and would crowd out real excerpts, so only genuine text counts.
function promptExcerpt(node: GraphNode): string | undefined {
  if (node.kind !== "user-message") return undefined
  const text = node.content.trim().replace(/\s+/g, " ")
  if (!text || /^\([\w -]+\)$/.test(text)) return undefined
  return text.slice(0, PROMPT_EXCERPT)
}

// Keep the NEWEST few excerpts: recent turns anchor a topic's current state
// far better than its opening lines, and the currency rule already tells the
// model to trust final turns above all.
function keepNewest(excerpts: string[]): string[] {
  return excerpts.slice(-MAX_PROMPTS_PER_TOPIC)
}

// The most recent surviving excerpt, for label fallbacks.
function newestPrompt(topic: Topic): string | undefined {
  return topic.prompts[topic.prompts.length - 1]
}

// Bucket the nodes of a built graph into topics, in session order. Labels
// come from clustering; opening prompts from user-message content; files
// from the attached file nodes (each carries its chain's community).
function topicsOf(nodes: GraphNode[]): Topic[] {
  const order: number[] = []
  const topics = new Map<number, Topic>()
  for (const node of nodes) {
    // Prior compaction markers ride the last chain's group; they carry the
    // old summary, not new work, so they must not inflate topic counts.
    if (node.kind === "compaction") continue
    const group = node.group
    if (group === undefined || group < 0) continue
    let topic = topics.get(group)
    if (!topic) {
      topic = { label: node.groupLabel ?? "work", count: 0, prompts: [], files: [] }
      topics.set(group, topic)
      order.push(group)
    }
    topic.count++
    const excerpt = promptExcerpt(node)
    if (excerpt) topic.prompts.push(excerpt)
    if (node.kind === "file" && !topic.files.includes(node.content)) topic.files.push(node.content)
  }
  const list = order.map((group) => topics.get(group)!)
  // Clustering sometimes crowns an internal artifact (tool-output blob) as
  // the most-touched "file"; those labels are noise — fall back to the
  // opening prompt excerpt.
  for (const topic of list) {
    topic.prompts = keepNewest(topic.prompts)
    if (!plausibleLabel(topic.label)) topic.label = (newestPrompt(topic) ?? "work").slice(0, LABEL_EXCERPT)
  }
  return list
}

function plausibleLabel(label: string): boolean {
  return !label.startsWith("tool-output/") && !/^tool_[\w-]{6,}/.test(label)
}

// Open blockers from a prior summary, so a second-round compaction cannot
// silently close them. Native template lists them under "### Blocked", ours
// under per-topic `blocked:` keys; "(none…)" placeholders are not blockers.
function openBlockers(prior: string): string[] {
  const found: string[] = []
  const push = (text: string) => {
    const t = text.trim()
    if (!t || /^\(?(none|n\/a|nothing)\b/i.test(t)) return
    if (!found.includes(t) && found.length < MAX_CARRIED_BLOCKERS) found.push(t)
  }
  let inBlocked = false
  for (const raw of prior.split("\n")) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) {
      inBlocked = /^#{1,6}\s+blocked\b/i.test(line)
      continue
    }
    if (inBlocked && /^[-*\d.]+\s+/.test(line)) push(line.replace(/^[-*\d.]+\s+/, ""))
    const keyed = line.match(/^[-*]*\s*`?blocked`?\s*:\s*(.+)/i)
    if (keyed) push(keyed[1]!)
  }
  return found
}

// Cap an oversized prior summary head+tail so fusion prompts stay compact;
// large priors were the main cause of length-limit compaction failures.
function truncatePrior(text: string): string {
  if (text.length <= MAX_PRIOR_CHARS) return text
  const head = 1800
  const tail = 800
  return text.slice(0, head) + `\n\n…[prior summary truncated ${text.length}→${MAX_PRIOR_CHARS} chars]…\n\n` + text.slice(-tail)
}

// Split the window's message nodes into pseudo-topics at silence gaps. This
// is the fallback for windows that clustering collapsed into a single
// community: exact file overlap says "one context", but long pauses usually
// mean separate threads of work all touching the same files. Labels come from
// each segment's opening prompt; per-segment file lists are not recoverable
// from the flat node list, so they stay empty.
function topicsByGaps(nodes: GraphNode[]): Topic[] {
  const topics: Topic[] = []
  let prevTime: number | undefined
  for (const node of nodes) {
    if (node.kind === "compaction" || !isMessageKind(node.kind)) continue
    const time = node.timeCreated
    const split = time !== undefined && prevTime !== undefined && time - prevTime > GAP_MS
    if (split || topics.length === 0) topics.push({ label: "work", count: 0, prompts: [], files: [] })
    const topic = topics[topics.length - 1]!
    topic.count++
    const excerpt = promptExcerpt(node)
    if (excerpt) topic.prompts.push(excerpt)
    if (time !== undefined) prevTime = time
  }
  for (const topic of topics) {
    topic.prompts = keepNewest(topic.prompts)
    topic.label = (newestPrompt(topic) ?? "work").slice(0, LABEL_EXCERPT)
  }
  // Keep the map bounded: fold overflow segments into the last kept one.
  if (topics.length > MAX_TOPICS) {
    const kept = topics.slice(0, MAX_TOPICS)
    const last = kept[kept.length - 1]!
    for (const extra of topics.slice(MAX_TOPICS)) {
      last.count += extra.count
      last.prompts.push(...extra.prompts)
    }
    return kept
  }
  return topics
}

// The override appended AFTER opencode's entire compaction prompt via the
// compacting hook's `output.context` — hook context is joined last in the
// assembled user message, so this block gets the final word. Position is the
// whole design: opencode only appends raw history when `output.prompt` is
// set, which left our instructions before the history and the model continued
// the conversation instead of summarizing (observed 15:05 failure). On the
// native path the history stays first, inside <conversation>, and our block
// explicitly amends the template it just read. A window worth overriding must
// yield at least two topics — clustering first, silence gaps as fallback. One
// topic means the native linear template is already the right shape, and the
// default compaction runs instead.
export function compactionContext(nodes: GraphNode[], previousSummary?: string): string | undefined {
  let topics = topicsOf(nodes)
  if (topics.length <= 1) topics = topicsByGaps(nodes)
  if (topics.length < 2) return undefined

  // Communities dominated by the same file share a label; keep the headers
  // distinguishable by appending each repeat's opening prompt.
  const seen = new Map<string, number>()
  for (const topic of topics) {
    const n = seen.get(topic.label) ?? 0
    seen.set(topic.label, n + 1)
    if (n > 0 && newestPrompt(topic)) topic.label = `${topic.label} — ${newestPrompt(topic)!.slice(0, LABEL_EXCERPT)}`
  }

  const map = topics
    .map((topic, i) => {
      const lines = [`TOPIC ${i + 1}: ${topic.label} (${topic.count} nodes)`]
      for (const prompt of topic.prompts) lines.push(`  - started by: "${prompt}"`)
      if (topic.files.length > 0) {
        const files = topic.files.slice(0, MAX_FILES_PER_TOPIC)
        const suffix = topic.files.length > MAX_FILES_PER_TOPIC ? ` (+${topic.files.length - MAX_FILES_PER_TOPIC} more)` : ""
        lines.push(`  - files: ${files.join(", ")}${suffix}`)
      }
      return lines.join("\n")
    })
    .join("\n")

  const truncated = previousSummary && previousSummary.length > MAX_PRIOR_CHARS ? truncatePrior(previousSummary) : previousSummary
  const blockers = truncated ? openBlockers(truncated) : []
  const prior = truncated
    ? [
        "Here is the summary of the conversation before the <conversation>:",
        "",
        "<prior-summary>",
        truncated,
        "</prior-summary>",
        "",
        "The <prior-summary> summarizes everything that happened before the <conversation>. Construct a new",
        "summary that combines both. Anything you do not carry into the new summary is lost.",
        "",
        "When combining:",
        "- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from",
        "  the <prior-summary> even when the <conversation> does not mention them. Drop only what is",
        "  finished and no longer needed.",
        "- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation",
        "  wins: state the corrected fact and drop the old claim.",
        "- Fold new progress, decisions, and constraints into their matching TOPIC.",
        "- Keep # STATE to what spans topics: the overall goal, current status, and immediate next steps.",
        ...(blockers.length > 0
          ? [
              "",
              "Open blockers carried from the <prior-summary> — repeat each one under its TOPIC's `blocked:` key",
              "(or # STATE when it spans topics) unless the <conversation> shows it resolved:",
              ...blockers.map((b) => `- ${b}`),
            ]
          : []),
        "",
      ]
    : []

  return [
    "You are a summarization agent. Summarize the <conversation> above so another coding agent can continue.",
    "",
    "IMPORTANT OVERRIDE: disregard the <template> section above and output exactly this structure",
    "instead, keeping order unchanged:",
    "",
    "# TOPIC <n>: <label>",
    "",
    "One section per TOPIC from the map below — clusters of work sharing a context. Inside each topic",
    "keep, briefly but specifically: what was done, decisions, files changed and how. Include",
    "`blocked: <reason or none so far>` — keep the key even when not blocked (e.g. `blocked: none so far`,",
    "`blocked: 401 Unauthorized — web_fetch https://…`, `blocked: tool error — bash: command not found: foo`). When",
    "blocked, include the exact error string / HTTP status and the tool/file affected; never use a bare `tool error`. After the last topic, add:",
    "",
    "# STATE",
    "",
    "spans topics only: overall goal, current status (final turns), and `what to do next`",
    "as concrete global actions after all topics (not per-topic).",
    "",
    "Rules:",
    "- Keep every section, even when thin. Aim for ~5 bullets per topic; beyond 5 only if critical.",
    "- Use terse bullets, not prose paragraphs. One fact per bullet; never restate the same fact across topics or sections.",
    "- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.",
    "- The final turns are the newest truth: reconcile every section against them and drop anything",
    "  they contradict. A blocked item stays open unless those turns show it was fixed.",
    "- Do not mention the summary process or that context was compacted.",
    "",
    ...prior,
    "TOPIC map:",
    map,
    "",
    'Output ONLY the summary text in the structure above, starting with "# TOPIC 1:".',
    "Do not continue the conversation. Do not respond to any questions in it.",
  ].join("\n")
}
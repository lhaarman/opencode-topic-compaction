// eval_fusion_resume.ts — complete a stalled fusion round-2 arm in place.
// Usage: bun tools/eval_fusion_resume.ts <CASE> <arm> [attempts=4] [budgetSecs=300]
// The session already holds the round-1 marker + appended work; this only
// re-issues summarize and polls for the text-bearing compaction marker.
// Provider stalls are environment noise: retries happen on the SAME session
// state, never recloning or re-appending. Timeouts are missing data, not
// behavioral results.
import { Database } from "bun:sqlite"
import { writeFileSync, appendFileSync } from "node:fs"

const CASE = process.argv[2]
const ARM = process.argv[3] ?? "plugin"
const ATTEMPTS = Number(process.argv[4] ?? 4)
const BUDGET = Number(process.argv[5] ?? 300) * 1000
if (!CASE || !["plugin", "pure"].includes(ARM)) {
  console.error("usage: eval_fusion_resume.ts <CASE> <plugin|pure> [attempts] [budgetSecs]")
  process.exit(1)
}

const OUT = "/tmp/opencode/compaction-eval"
const PORT = ARM === "plugin" ? 4399 : 4400
const PROVIDER = process.env.EVAL_PROVIDER ?? "opencode"
const MODEL = process.env.EVAL_MODEL ?? "x-preview-f-free"

const db = new Database("/home/vscode/.local/share/opencode/opencode.db")
db.exec("PRAGMA busy_timeout = 5000")
const row = db.query("SELECT s.id as sid FROM session s LEFT JOIN message m ON m.session_id=s.id WHERE s.slug=? GROUP BY s.id ORDER BY count(m.id) DESC").get(`x-${CASE.toLowerCase()}-${ARM}`) as any
if (!row) {
  console.error(`no session for x-${CASE.toLowerCase()}-${ARM}`)
  process.exit(1)
}
const id = row.sid
// Floor: ignore every marker that existed before we start prompting, so a
// previous round's summary can never be mistaken for this attempt's result.
let floorMs = 0
for (const r of db.query("SELECT data FROM message WHERE session_id=? ORDER BY time_created DESC LIMIT 30").all(id) as any[]) {
  let m: any; try { m = JSON.parse(r.data) } catch { continue }
  if (m.mode === "compaction") { floorMs = (m.time?.created ?? 0) + 1000; break }
}

async function pollOnce(startMs: number): Promise<string | null> {
  const rows = db.query("SELECT id, data FROM message WHERE session_id=? ORDER BY time_created DESC LIMIT 20").all(id) as any[]
  for (const r of rows) {
    let m: any; try { m = JSON.parse(r.data) } catch { continue }
    if (m.role !== "assistant" || m.mode !== "compaction") continue
    if ((m.time?.created ?? 0) < Math.max(startMs - 60_000, floorMs)) continue
    const parts = (db.query("SELECT data FROM part WHERE message_id=?").all(r.id) as any[]).map((p) => JSON.parse(p.data))
    const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n").trim()
    if (text.length > 100) return text
  }
  return null
}

let captured: string | null = null
for (let attempt = 1; attempt <= ATTEMPTS && !captured; attempt++) {
  const startMs = Date.now()
  await fetch(`http://127.0.0.1:${PORT}/session/${id}/summarize`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerID: PROVIDER, modelID: MODEL }),
  })
  console.log(`attempt ${attempt}: posted`)
  while (Date.now() - startMs < BUDGET && !captured) {
    await new Promise((r) => setTimeout(r, 5000))
    const text = await pollOnce(startMs)
    if (text) captured = text
  }
  if (!captured) console.log(`attempt ${attempt}: timeout (${BUDGET / 1000}s)`)
}

if (captured) {
  writeFileSync(`${OUT}/${CASE}-${ARM}-r2.md`, captured)
  appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase: CASE, arm: ARM, round: "r2", ok: true, chars: captured.length, startsTopic: captured.startsWith("# TOPIC"), secs: -1, via: "fusion-resume" }) + "\n")
  console.log(`CAPTURED ${captured.length} chars, startsTopic=${captured.startsWith("# TOPIC")}`)
} else {
  writeFileSync(`${OUT}/${CASE}-${ARM}-r2.md`, `ERROR: not captured after ${ATTEMPTS} attempts`)
  appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase: CASE, arm: ARM, round: "r2", ok: false, attempts: ATTEMPTS }) + "\n")
  console.log("NOT CAPTURED")
}

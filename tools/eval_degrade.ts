// eval_degrade.ts — repeated-compaction degradation study.
// Usage: bun tools/eval_degrade.ts [rounds=10] [budgetSecs=240]
//
// Fresh syn-rare clone pair -> 10 rounds of: summarize BOTH arms (plugin
// :4399 first, pure :4400 second), record output size/latency, append 3
// text-bearing messages to each side, restart serves (opencode caches session
// state, so SQL writes behind a live serve are invisible otherwise).
// Skip-round policy: a timed-out arm records ok:false and the loop continues.
import { Database } from "bun:sqlite"
const ROOT = import.meta.dir.replace(/\/tools$/, "")
import { writeFileSync, appendFileSync } from "node:fs"

const DB_PATH = "/home/vscode/.local/share/opencode/opencode.db"
const OUT = "/tmp/opencode/compaction-eval"
const ROUNDS = Number(process.argv[2] ?? 10)
const BUDGET = (Number(process.argv[3] ?? 240)) * 1000

const db = new Database(DB_PATH)
db.exec("PRAGMA busy_timeout = 5000")

function sessionIdBySlug(slug: string): string {
  const rows = db.query("SELECT s.id as sid, count(m.id) c FROM session s LEFT JOIN message m ON m.session_id=s.id WHERE s.slug=? GROUP BY s.id ORDER BY c DESC").all(slug) as any[]
  if (!rows.length) throw new Error(`no session for slug ${slug}`)
  return rows[0].sid
}

function reclone() {
  const p = Bun.spawnSync(["bun", `${ROOT}/tools/eval_clones.ts`, "DEG"], { stdout: "pipe", stderr: "pipe" })
  console.log(p.stdout.toString().trim())
  if (p.exitCode !== 0) throw new Error("reclone failed")
}

async function fetchCompactionText(id: string, startMs: number): Promise<string | null> {
  // SDK first; DB fallback is authoritative here since we drive via SQL anyway.
  const rows = db.query("SELECT id, data FROM message WHERE session_id=? ORDER BY time_created DESC LIMIT 20").all(id) as any[]
  for (const r of rows) {
    let m: any; try { m = JSON.parse(r.data) } catch { continue }
    if (m.role !== "assistant" || m.mode !== "compaction") continue
    if ((m.time?.created ?? 0) < startMs - 60_000) continue
    const parts = (db.query("SELECT data FROM part WHERE message_id=?").all(r.id) as any[]).map((p) => JSON.parse(p.data))
    const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n").trim()
    if (text) return text
  }
  return null
}

async function summarizeArm(port: number, slug: string): Promise<{ ok: boolean; chars: number; secs: number; startsTopic: boolean }> {
  const id = sessionIdBySlug(slug)
  const startMs = Date.now()
  await fetch(`http://127.0.0.1:${port}/session/${id}/summarize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerID: process.env.EVAL_PROVIDER ?? "opencode", modelID: process.env.EVAL_MODEL ?? "x-preview-f-free" }) })
  while (Date.now() - startMs < BUDGET) {
    await new Promise((r) => setTimeout(r, 5000))
    const text = await fetchCompactionText(id, startMs)
    if (text) return { ok: true, chars: text.length, secs: Math.round((Date.now() - startMs) / 1000), startsTopic: text.startsWith("# TOPIC") }
  }
  return { ok: false, chars: 0, secs: Math.round(BUDGET / 1000), startsTopic: false }
}

async function appendWork(slug: string, n: number) {
  const id = sessionIdBySlug(slug)
  const last = db.query("SELECT id FROM message WHERE session_id=? ORDER BY time_created DESC, rowid DESC LIMIT 1").get(id) as any
  let parent = last?.id
  const lastTime = (db.query("SELECT max(time_created) t FROM message WHERE session_id=?").get(id) as any)?.t ?? Date.now()
  let t = lastTime + 60_000
  const files = ["src/cache.ts", "src/router.ts", "src/store.ts", "src/auth.ts"]
  const rid = () => Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
  for (let i = 0; i < n; i++) {
    const f = files[i % files.length]
    const userText = `Continue the feature: update ${f} (degradation step ${i + 1}).`
    const asstText = `Edited ${f} for degradation step ${i + 1}; all checks still pass.`
    const mid = "msg_" + rid(), mid2 = "msg_" + rid()
    const info: any = { id: mid, role: "user", time: { created: t, updated: t }, sessionID: id, parentID: parent, tokens: { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } } }
    const info2: any = { id: mid2, role: "assistant", time: { created: t + 500, updated: t + 500 }, sessionID: id, parentID: mid, tokens: { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } } }
    const toolPart = { type: "tool", tool: "edit", callID: "call_" + rid().slice(0, 8), state: { status: "completed", input: { filePath: f }, output: `Edited ${f}`, metadata: {}, title: f, time: { start: t, end: t + 400 } } }
    db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(mid, id, t, t, JSON.stringify(info))
    db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(mid2, id, t + 500, t + 500, JSON.stringify(info2))
    for (const [msgId, when, part] of [[mid, t, { type: "text", text: userText }], [mid2, t + 500, { type: "text", text: asstText }], [mid2, t + 500, toolPart]] as const) {
      db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)").run("prt_" + rid(), msgId as string, id, when, when, JSON.stringify(part))
    }
    parent = mid2
    t += 60_000
  }
}

function restartServes() {
  try { Bun.spawnSync(["bash", "-c", "for P in $(pgrep -f 'opencode serv[e] --port'); do kill $P 2>/dev/null; done; sleep 1"]) } catch {}
  Bun.spawn(["/home/vscode/.opencode/bin/opencode", "serve", "--port", "4399", "--hostname", "127.0.0.1"], { stdout: Bun.file("/tmp/opencode/serve-4399.log"), stderr: Bun.file("/dev/null") })
  Bun.spawn(["/home/vscode/.opencode/bin/opencode", "serve", "--pure", "--port", "4400", "--hostname", "127.0.0.1"], { stdout: Bun.file("/tmp/opencode/serve-4400.log"), stderr: Bun.file("/dev/null") })
}

async function main() {
  reclone()
  const rows: string[] = ["round\tarm\tok\tchars\tsecs\tstartsTopic"]
  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n=== round ${round}/${ROUNDS} ===`)
    for (const [arm, port] of [["plugin", 4399], ["pure", 4400]] as const) {
      const r = await summarizeArm(port, `x-deg-${arm}`)
      const line = `${round}\t${arm}\t${r.ok ? "OK" : "TIMEOUT"}\t${r.chars}\t${r.secs}\t${r.startsTopic}`
      rows.push(line)
      appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase: "DEG", round, arm, ...r }) + "\n")
      console.log(`  ${arm}: ${r.ok ? `OK ${r.chars} ch in ${r.secs}s topic=${r.startsTopic}` : "TIMEOUT"}`)
    }
    if (round < ROUNDS) {
      await appendWork("x-deg-plugin", 3)
      await appendWork("x-deg-pure", 3)
      restartServes()
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
  writeFileSync(`${OUT}/degradation.tsv`, rows.join("\n") + "\n")
  console.log("\nDONE degrade\n" + rows.join("\n"))
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

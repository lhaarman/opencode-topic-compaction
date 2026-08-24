// eval_run2.ts — hardened per-case compaction eval runner.
// Usage: bun tools/eval_run2.ts <CASE|"all"> [--force]   [POLL_BUDGET_SECS=full]
// Sequential arms (plugin :4399 first, pure :4400 second), fresh clones per
// attempt, time-based compaction detection with DB fallback, crash-safe
// incremental persistence (.md + results.jsonl written after EVERY arm).
// Fusion cases (U9/U11) run two rounds with appends + serve restart between;
// their retries stay in-place so round-1 markers survive.
import { createOpencodeClient } from "@opencode-ai/sdk"
const ROOT = import.meta.dir.replace(/\/tools$/, "")
import { Database } from "bun:sqlite"
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs"
import { activeWindow, buildGraph } from "../src/topics-model.ts"
import { compactionContext } from "../src/topics-compaction.ts"

const OUT = "/tmp/opencode/compaction-eval"
const DB_PATH = "/home/vscode/.local/share/opencode/opencode.db"
const db = new Database(DB_PATH)
db.exec("PRAGMA busy_timeout = 5000")

// Target model for both arms; override for local-model sweeps.
const PROVIDER = process.env.EVAL_PROVIDER ?? "opencode"
const MODEL = process.env.EVAL_MODEL ?? "x-preview-f-free"
const pluginClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:4399", directory: `${ROOT}` })
const pureClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:4400", directory: `${ROOT}` })

function sessionIdBySlug(slug: string): string {
  const rows = db.query("SELECT s.id as sid, count(m.id) c FROM session s LEFT JOIN message m ON m.session_id=s.id WHERE s.slug=? GROUP BY s.id ORDER BY c DESC").all(slug) as any[]
  if (!rows.length) throw new Error(`no session for slug ${slug}`)
  return rows[0].sid
}

function reclone(kase: string) {
  const p = Bun.spawnSync(["bun", `${ROOT}/tools/eval_clones.ts`, kase], { stdout: "pipe", stderr: "pipe" })
  console.log(p.stdout.toString().trim())
  if (p.exitCode !== 0) throw new Error(`reclone failed for ${kase}: ${p.stderr.toString()}`)
}

// Compaction detection is TIME-based: any assistant compaction message newer
// than startMs-60s counts. Immune to SDK/DB count skew and stale markers.
async function fetchCompactionText(client: any, id: string, startMs: number): Promise<string | null> {
  try {
    const res = await client.session.messages({ path: { id }, query: { limit: 1000 } } as any)
    const data: any[] = (res?.data as any[]) ?? []
    for (let i = data.length - 1; i >= 0; i--) {
      const m = data[i]!
      const info = m.info ?? m
      const parts: any[] = m.parts ?? []
      const created = info.time?.created ?? info.time?.create ?? 0
      if (created && created < startMs) continue
      const isComp = info.role === "assistant" && (
        info.mode === "compaction" || info.summary === true || info.agent === "compaction" ||
        parts.some((p: any) => p.type === "compaction")
      )
      if (!isComp) continue
      const text = parts.filter((p: any) => p.type === "text").map((p: any) => p.text ?? "").join("\n").trim()
      if (text) return text
    }
  } catch {}
  // DB fallback (version-skew safe)
  const rows = db.query("SELECT id, data FROM message WHERE session_id=? ORDER BY time_created DESC LIMIT 20").all(id) as any[]
  for (const r of rows) {
    let m: any
    try { m = JSON.parse(r.data) } catch { continue }
    if (m.role !== "assistant") continue
    const created = m.time?.created ?? 0
    if (created && created < startMs) continue
    const parts = db.query("SELECT data FROM part WHERE message_id=?").all(r.id) as any[]
    const parsed = parts.map((p: any) => { try { return JSON.parse(p.data) } catch { return {} } })
    const hasCompPart = parsed.some((p: any) => p.type === "compaction")
    const isComp = m.mode === "compaction" || m.summary === true || m.agent === "compaction" || hasCompPart
    if (!isComp) continue
    const text = parsed.filter((p: any) => p.type === "text").map((p: any) => p.text ?? "").join("\n").trim()
    if (text) return text
  }
  return null
}

type ArmResult = { ok: boolean; summary?: string; err?: string; secs: number }

async function runArm(client: any, slug: string): Promise<ArmResult> {
  const id = sessionIdBySlug(slug)
  const startMs = Date.now()
  // Floor = newest compaction marker already on the session, so the detector
  // can never mistake a previous round's summary for this attempt's result.
  let floorMs = startMs - 60_000
  for (const r of db.query("SELECT data FROM message WHERE session_id=? ORDER BY time_created DESC LIMIT 30").all(id) as any[]) {
    let m: any; try { m = JSON.parse(r.data) } catch { continue }
    if (m.role === "assistant" && m.mode === "compaction") { floorMs = Math.max(floorMs, (m.time?.created ?? 0) + 1000); break }
  }
  // POLL_BUDGET_SECS caps the wait for time-boxed sessions (default: full).
  const cap = Number(process.env.POLL_BUDGET_SECS ?? 0) * 1000
  const base = slug.includes("u10") || slug.includes("u9") ? 1200_000 : 900_000
  const budget = cap > 0 ? Math.min(base, cap) : base
  try {
    // A wedged upstream must not freeze the retry loop before the poll budget
    // even starts — cap the POST itself and fall through to polling regardless.
    const posted = client.session.summarize({ path: { id }, body: { providerID: PROVIDER, modelID: MODEL } } as any)
    await Promise.race([posted, new Promise((res) => setTimeout(res, 120_000))])
  } catch (e: any) {
    console.log(`  summarize POST error on ${slug}: ${String(e?.message ?? e).slice(0, 120)} (polling anyway)`)
  }
  const deadline = Date.now() + budget
  let lastLog = 0
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const text = await fetchCompactionText(client, id, Math.max(startMs - 60_000, floorMs))
    if (text) return { ok: true, summary: text, secs: Math.round((Date.now() - startMs) / 1000) }
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now()
      console.log(`  ...waiting for ${slug} (${Math.round((Date.now() - startMs) / 1000)}s elapsed)`)
    }
  }
  return { ok: false, err: `timeout (${budget / 1000}s)`, secs: Math.round((Date.now() - startMs) / 1000) }
}


// --- Real-history engagement sweep -----------------------------------------
const ENG_SESSIONS: Array<[string, string]> = [
  ["crisp-forest", "cf"], ["quiet-river", "qriver"], ["brave-planet", "bplanet"],
  ["nimble-lagoon", "nlagoon"], ["witty-eagle", "weagle"], ["stellar-cabin", "scabin"],
]

async function classifyEng(short: string) {
  const id = sessionIdBySlug(`x-eng-${short}-plugin`)
  const entries = db.query("SELECT id, data FROM message WHERE session_id=? ORDER BY time_created ASC").all(id).map((row: any) => ({
    info: JSON.parse(row.data),
    parts: db.query("SELECT data FROM part WHERE message_id=?").all(row.id).map((p: any) => JSON.parse(p.data)),
  }))
  const w = activeWindow(entries)
  const g = await buildGraph(null, id, `${ROOT}`)
  const ctx = compactionContext(g.nodes, w.previousSummary)
  return { slug: short, msgs: entries.length, head: w.entries.length, rawTail: w.rawTail.length, nodes: g.nodes.length, gatePass: !!ctx, injectedChars: ctx ? ctx.length : 0 }
}

async function runEngSweep() {
  const doneArms = new Set(existsSync(`${OUT}/results.jsonl`)
    ? readFileSync(`${OUT}/results.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { const j = JSON.parse(l); return `${j.kase}:${j.arm}` } catch { return "" } })
    : [])
  reclone("ENG")
  mkdirSync(OUT, { recursive: true })
  const classes: any[] = []
  for (const [, short] of ENG_SESSIONS) {
    try { classes.push(await classifyEng(short)) } catch (e: any) { classes.push({ slug: short, error: String(e?.message ?? e).slice(0, 90) }) }
  }
  appendFileSync(`${OUT}/eng-classify.jsonl`, JSON.stringify(classes) + "\n")
  console.log("ENG classification:\n" + classes.map((k) => `  ${k.slug}: msgs=${k.msgs ?? "?"} head=${k.head ?? "?"} gate=${k.gatePass === undefined ? "?" : k.gatePass ? "PASS" : "yield"}`).join("\n"))
  for (const [, short] of ENG_SESSIONS) {
    for (const arm of ["plugin", "pure"] as const) {
      if (doneArms.has(`eng-${short}:${arm}`)) { console.log(`eng-${short}-${arm}: already captured, skipping`); continue }
      const client = arm === "plugin" ? pluginClient : pureClient
      let res = await runArm(client, `x-eng-${short}-${arm}`)
      if (!res.ok) { console.log(`eng-${short}-${arm}: ${res.err} — retrying in place`); res = await runArm(client, `x-eng-${short}-${arm}`) }
      const text = res.summary ?? ""
      writeFileSync(`${OUT}/eng-${short}-${arm}.md`, res.ok ? text : `ERROR ${res.err}`)
      appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase: `eng-${short}`, arm, ok: res.ok, chars: text.length, secs: res.secs }) + "\n")
      console.log(`eng-${short}-${arm}: ${res.ok ? `OK ${text.length} ch` : "FAILED"} startsTopic=${text.startsWith("# TOPIC")} in ${res.secs}s`)
    }
  }
  console.log("ENG SWEEP DONE")
}

function armFile(kase: string, arm: string, round?: string): string {
  return `${OUT}/${kase}-${arm}${round ? `-${round}` : ""}.md`
}

function armDone(path: string): boolean {
  if (!existsSync(path)) return false
  const c = readFileSync(path, "utf8")
  return c.length > 10 && !c.startsWith("ERROR:")
}

async function evalArmWithRetry(kase: string, arm: "plugin" | "pure", round?: string, force = false): Promise<{ ok: boolean; chars: number }> {
  const file = armFile(kase, arm, round)
  const label = `${kase}-${arm}${round ? `-${round}` : ""}`
  if (!force && armDone(file)) {
    console.log(`${label}: already done, skipping`)
    return { ok: true, chars: readFileSync(file, "utf8").length }
  }
  const slug = `x-${kase.toLowerCase()}-${arm}`
  const fusion = kase === "U9" || kase === "U11"
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      console.log(`${label}: retrying once${fusion ? " in place" : " with fresh clone"}`)
      // Fusion rounds must stay on their session: a reclone would erase the
      // round-1 compaction marker that round-2's fusion depends on.
      if (!fusion) reclone(kase)
    }
    const r = await runArm(arm === "plugin" ? pluginClient : pureClient, slug)
    if (r.ok) {
      const text = r.summary!
      writeFileSync(file, text)
      appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase, arm, round: round ?? "r1", ok: true, secs: r.secs, chars: text.length, startsTopic: text.startsWith("# TOPIC") }) + "\n")
      console.log(`${label}: OK ${text.length} chars in ${r.secs}s startsTopic=${text.startsWith("# TOPIC")}`)
      return { ok: true, chars: text.length }
    }
    console.log(`${label}: attempt ${attempt} failed: ${r.err}`)
    appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase, arm, round: round ?? "r1", ok: false, attempt, err: r.err }) + "\n")
  }
  writeFileSync(file, `ERROR: timeout after 2 attempts`)
  return { ok: false, chars: 0 }
}

async function beforeTok(slug: string): Promise<{ msgs: number; tok: number }> {
  const id = sessionIdBySlug(slug)
  const rows = db.query("SELECT data FROM message WHERE session_id=?").all(id) as any[]
  const json = JSON.stringify(rows.map((r: any) => JSON.parse(r.data)))
  return { msgs: rows.length, tok: Math.ceil(json.length / 4) }
}

async function runCase(kase: string, force: boolean) {
  const pDone = armDone(armFile(kase, "plugin"))
  const uDone = armDone(armFile(kase, "pure"))
  if (pDone && uDone && !force) {
    console.log(`=== ${kase}: both arms already done, skipping ===`)
    return
  }
  console.log(`\n=== ${kase} ===`)
  reclone(kase)
  const bP = await beforeTok(`x-${slugOf(kase)}-plugin`).catch(() => ({ msgs: 0, tok: 0 }))
  console.log(`${kase} window: ${bP.msgs} msgs ~${bP.tok} tok`)
  const t0 = Date.now()
  const pRes = await evalArmWithRetry(kase, "plugin", undefined, force)
  const uRes = await evalArmWithRetry(kase, "pure", undefined, force)
  appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase, type: "case-summary", beforeMsgs: bP.msgs, beforeTok: bP.tok, pluginChars: pRes.chars, pureChars: uRes.chars, pluginOk: pRes.ok, pureOk: uRes.ok, wallSecs: Math.round((Date.now() - t0) / 1000) }) + "\n")
}

async function restartServes() {
  // opencode caches per-session state in memory; SQL writes made behind a
  // live serve are invisible to it (summarize then compacts an "empty"
  // window). Restarting flushes caches so round-2 sees markers + appends.
  console.log("restarting serves to flush session caches...")
  try { Bun.spawnSync(["bash", "-c", "for P in $(pgrep -f 'opencode serv[e] --port'); do kill $P 2>/dev/null; done; sleep 1"]) } catch {}
  const s1 = Bun.spawn(["/home/vscode/.opencode/bin/opencode", "serve", "--port", "4399", "--hostname", "127.0.0.1"], { stdout: Bun.file("/tmp/opencode/serve-4399.log"), stderr: Bun.file("/dev/null") })
  const s2 = Bun.spawn(["/home/vscode/.opencode/bin/opencode", "serve", "--pure", "--port", "4400", "--hostname", "127.0.0.1"], { stdout: Bun.file("/tmp/opencode/serve-4400.log"), stderr: Bun.file("/dev/null") })
  writeFileSync("/tmp/opencode/serve-4399.pid", String(s1.pid))
  writeFileSync("/tmp/opencode/serve-4400.pid", String(s2.pid))
  await new Promise((r) => setTimeout(r, 4000))
}

async function appendWork(slug: string, n: number, files = ["src/cache.ts", "src/router.ts", "src/store.ts", "src/auth.ts"], texts?: (i: number, f: string) => { user: string; assistant: string }) {
  const id = sessionIdBySlug(slug)
  const last = db.query("SELECT id FROM message WHERE session_id=? ORDER BY time_created DESC, rowid DESC LIMIT 1").get(id) as any
  let parent = last?.id
  const lastTime = (db.query("SELECT max(time_created) t FROM message WHERE session_id=?").get(id) as any)?.t ?? Date.now()
  let t = lastTime + 60_000
  const rid = () => Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
  for (let i = 0; i < n; i++) {
    const f = files[i % files.length]
    const say = texts ? texts(i, f) : { user: `Continue the feature: update ${f} (step ${i + 1}).`, assistant: `Edited ${f} for step ${i + 1}; all checks still pass.` }
    const mid = "msg_" + rid(), mid2 = "msg_" + rid()
    const info: any = { id: mid, role: "user", time: { created: t, updated: t }, sessionID: id, parentID: parent, tokens: { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } } }
    const info2: any = { id: mid2, role: "assistant", time: { created: t + 500, updated: t + 500 }, sessionID: id, parentID: mid, tokens: { input: 800, output: 200, reasoning: 50, cache: { read: 0, write: 0 } } }
    const toolPart = { type: "tool", tool: "edit", callID: "call_" + rid().slice(0, 8), state: { status: "completed", input: { filePath: f }, output: `Edited ${f}`, metadata: {}, title: f, time: { start: t, end: t + 400 } } }
    const userParts = [{ type: "text", text: say.user }]
    const asstParts = [{ type: "text", text: say.assistant }, toolPart]
    db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(mid, id, t, t, JSON.stringify(info))
    db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)").run(mid2, id, t + 500, t + 500, JSON.stringify(info2))
    for (const [msgId, when, parts] of [[mid, t, userParts], [mid2, t + 500, asstParts]] as const) {
      for (const part of parts) {
        db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)").run("prt_" + rid(), msgId as string, id, when as number, when as number, JSON.stringify(part))
      }
    }
    parent = mid2
    t += 60_000
  }
  console.log(`appended ${n} msgs to ${slug}`)
}

function slugOf(kase: string) {
  return kase === "MIDF" ? "midf" : kase.toLowerCase()
}

async function runFusion(kase: string, force: boolean) {
  console.log(`\n=== ${kase}: incremental fusion ===`)
  reclone(kase)
  await evalArmWithRetry(kase, "plugin", "r1", force)
  await evalArmWithRetry(kase, "pure", "r1", force)
  if (kase === "U11") {
    // Keep the API blocker alive; progress only on logger + retries.
    const spec = (i: number, f: string) =>
      f.includes("client")
        ? { user: `Retry the spec fetch from ${f} (attempt ${i + 1}).`, assistant: `Retried from ${f}: still HTTP/1.1 401 Unauthorized — blocked on the missing API key.` }
        : { user: `Improve the logger in ${f} (round ${i + 1}).`, assistant: `Extended ${f} with structured fields; tests pass.` }
    await appendWork(`x-u11-plugin`, 8, ["src/util/logger.ts", "src/api/client.ts"], spec)
    await appendWork(`x-u11-pure`, 8, ["src/util/logger.ts", "src/api/client.ts"], spec)
  } else {
    await appendWork(`x-${slugOf(kase)}-plugin`, 10)
    await appendWork(`x-${slugOf(kase)}-pure`, 10)
  }
  const b2 = await beforeTok(`x-${slugOf(kase)}-plugin`)
  console.log(`${kase} appended work; now ${b2.msgs} msgs`)
  await restartServes()
  await evalArmWithRetry(kase, "plugin", "r2", force)
  await evalArmWithRetry(kase, "pure", "r2", force)
  // Blocker carry-forward audit: open blockers visible in r1 must survive
  // into r2 (graph arm). Vacuous when r1 had none.
  try {
    const r1 = readFileSync(armFile(kase, "plugin", "r1"), "utf8")
    const r2 = readFileSync(armFile(kase, "plugin", "r2"), "utf8")
    const blockers = [...r1.matchAll(/blocked: (?!none)(.+)/gi)].map((m) => m[1]!.slice(0, 80))
    const carried = blockers.filter((b) => r2.toLowerCase().includes(b.toLowerCase().split(" ").slice(0, 3).join(" ")))
    appendFileSync(`${OUT}/results.jsonl`, JSON.stringify({ kase, type: "blocker-carry", blockersInR1: blockers, carriedInR2: carried }) + "\n")
  } catch {}
}

const args = process.argv.slice(2)
const force = args.includes("--force")
const target = args.find((a) => a !== "--force") ?? "all"

async function main() {
  if (target === "all") {
    for (const k of ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"]) await runCase(k, force)
    await runFusion("U9", force)
    await runFusion("U11", force)
    await runCase("U10", force)
  } else if (target === "ENG") {
    await runEngSweep()
  } else if (target === "U9" || target === "U11" || target === "BIGF" || target === "MIDF") {
    await runFusion(target, force)
  } else {
    await runCase(target, force)
  }
  console.log(`\nDONE ${target}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) }).finally(() => setTimeout(() => process.exit(0), 500))
